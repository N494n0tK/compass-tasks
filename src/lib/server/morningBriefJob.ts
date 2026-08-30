/** 朝 7:30 の朝メモ生成 → Notion 保存をまとめる定期ジョブ。 */

import { normalizeNotionId, notionChildPage } from '../logic/notionPull';
import type { ISODate } from '../model/types';
import type { GeneratedMorningBrief } from './morningBriefService';
import {
  createNotionApiClient,
  NOTION_MARKDOWN_API_VERSION,
  type NotionApiClient,
} from './notionApi';
import type { MorningBriefRunStore } from './morningBriefRunStore';

export const MORNING_MEMO_PARENT_PAGE_ID = normalizeNotionId(
  '3c79fcddfdf48118bb3df7d7aced66b0',
);

export interface MorningBriefNotionStore {
  findDirectChildPage(title: string): Promise<{ id: string; title: string } | null>;
  createChildPage(title: string, body: string): Promise<{ id: string; url: string }>;
}

export interface MorningBriefJobLogger {
  info(message: string, data: Record<string, unknown>): void;
  error(message: string, data: Record<string, unknown>): void;
}

export type MorningBriefJobResult =
  | { ok: true; date: ISODate; status: 'weekend'; skipped: true }
  | { ok: true; date: ISODate; status: 'already_exists'; skipped: true; pageId: string }
  | { ok: true; date: ISODate; status: 'in_progress'; skipped: true }
  | { ok: true; date: ISODate; status: 'created'; skipped: false; pageId: string };

export interface MorningBriefJobDependencies {
  /** 引数なしで「今日・Asia/Tokyo」の共通生成サービスを呼ぶ。 */
  generate(): Promise<GeneratedMorningBrief>;
  notion: MorningBriefNotionStore;
  runs: MorningBriefRunStore;
  now?: () => Date;
  logger?: MorningBriefJobLogger;
}

const consoleLogger: MorningBriefJobLogger = {
  info(message, data) {
    console.info(message, data);
  },
  error(message, data) {
    console.error(message, data);
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 既存の `NOTION_TOKEN` を使い、対象親ページ直下だけを読む・書く。 */
export function createMorningBriefNotionStore(
  token: string,
  client: NotionApiClient = createNotionApiClient(token, NOTION_MARKDOWN_API_VERSION),
): MorningBriefNotionStore {
  return {
    async findDirectChildPage(title) {
      const children = await client.listBlockChildren(MORNING_MEMO_PARENT_PAGE_ID);
      for (const raw of children) {
        const child = notionChildPage(raw);
        if (child?.title === title) return { id: child.id, title: child.title };
      }
      return null;
    },

    createChildPage(title, body) {
      return client.createPageFromMarkdown({
        parentPageId: MORNING_MEMO_PARENT_PAGE_ID,
        title,
        // morning_brief の body を一切加工しない。
        markdown: body,
      });
    },
  };
}

export async function scheduledMorningBriefJob(
  deps: MorningBriefJobDependencies,
): Promise<MorningBriefJobResult> {
  const logger = deps.logger ?? consoleLogger;
  const now = deps.now ?? (() => new Date());

  let brief: GeneratedMorningBrief;
  try {
    brief = await deps.generate();
  } catch (error) {
    logger.error('[morning-brief] generation_failed', { error: errorMessage(error) });
    throw error;
  }

  if (brief.skipped) {
    logger.info('[morning-brief] weekend / skipped', {
      date: brief.date,
      status: 'weekend',
      skipped: true,
    });
    return { ok: true, date: brief.date, status: 'weekend', skipped: true };
  }

  const { date } = brief;
  try {
    const existing = await deps.notion.findDirectChildPage(date);
    if (existing) {
      logger.info('[morning-brief] already_exists / skipped', {
        date,
        status: 'already_exists',
        skipped: true,
      });
      return {
        ok: true,
        date,
        status: 'already_exists',
        skipped: true,
        pageId: existing.id,
      };
    }
  } catch (error) {
    logger.error('[morning-brief] notion_lookup_failed', { date, error: errorMessage(error) });
    throw error;
  }

  const claim = await deps.runs.claim(date, now());
  if (!claim.claimed) {
    // 先行実行がロック直後に作成を終えた可能性を拾う。
    const existing = await deps.notion.findDirectChildPage(date);
    if (existing) {
      logger.info('[morning-brief] already_exists / skipped', {
        date,
        status: 'already_exists',
        skipped: true,
      });
      return {
        ok: true,
        date,
        status: 'already_exists',
        skipped: true,
        pageId: existing.id,
      };
    }
    logger.info('[morning-brief] in_progress / skipped', {
      date,
      status: 'in_progress',
      skipped: true,
    });
    return { ok: true, date, status: 'in_progress', skipped: true };
  }

  try {
    // 外部でページが作られた直後でも、create の前にもう一度確認して重複を止める。
    const existing = await deps.notion.findDirectChildPage(date);
    if (existing) {
      await deps.runs.markCreated(date, claim.owner, existing.id, now());
      logger.info('[morning-brief] already_exists / skipped', {
        date,
        status: 'already_exists',
        skipped: true,
      });
      return {
        ok: true,
        date,
        status: 'already_exists',
        skipped: true,
        pageId: existing.id,
      };
    }

    // タイトルと本文を同じ同期 API 呼び出しで作り、空ページを先に残さない。
    const page = await deps.notion.createChildPage(date, brief.body);
    await deps.runs.markCreated(date, claim.owner, page.id, now());

    logger.info('[morning-brief] created', {
      date,
      status: 'created',
      periods: brief.slots.length,
      submissions: Math.min(brief.notices.length, 3),
      questionSubjects: [...new Set(brief.cards.map((card) => card.subject))],
    });
    return { ok: true, date, status: 'created', skipped: false, pageId: page.id };
  } catch (error) {
    const message = errorMessage(error);
    try {
      await deps.runs.markFailed(date, claim.owner, message, now());
    } catch (lockError) {
      logger.error('[morning-brief] lock_failure_record_failed', {
        date,
        error: errorMessage(lockError),
      });
    }
    logger.error('[morning-brief] failed', { date, error: message });
    throw error;
  }
}
