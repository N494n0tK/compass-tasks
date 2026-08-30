import { describe, expect, it, vi } from 'vitest';
import type { MorningBrief } from '../../logic/morningBrief';
import {
  scheduledMorningBriefJob,
  type MorningBriefJobLogger,
  type MorningBriefNotionStore,
} from '../morningBriefJob';
import type { MorningBriefRunStore } from '../morningBriefRunStore';
import type { GeneratedMorningBrief } from '../morningBriefService';

const DATE = '2026-08-31'; // 月曜
const BODY = '### 今日の時間割\n1 数学\n\n### 持ち物・提出\n- 数学：提出\n\n### 思い出せるか（1問）\n- 問題';

function weekday(body = BODY): GeneratedMorningBrief {
  const brief: MorningBrief = {
    date: DATE,
    weekday: '月',
    slots: ['数学'],
    notices: [{ subject: '数学', notice: '提出', today: true }],
    cards: [
      {
        note_id: 'n1',
        card_id: 'c1',
        date: '2026-08-28',
        subject: '数学',
        unit: '単元',
        q: '問題',
        no: 1,
        origin: 'ai',
        tries: 0,
        last_grade: null,
        last_day: null,
        weakness: 1,
      },
    ],
    body,
  };
  return { ok: true, skipped: false, ...brief };
}

function fakeRuns() {
  const state = { locked: false, claims: 0, created: 0, failed: 0 };
  const runs: MorningBriefRunStore = {
    async claim() {
      state.claims += 1;
      if (state.locked) return { claimed: false, owner: 'other', reason: 'running' };
      state.locked = true;
      return { claimed: true, owner: 'owner' };
    },
    async markCreated() {
      state.created += 1;
    },
    async markFailed() {
      state.failed += 1;
      state.locked = false;
    },
  };
  return { runs, state };
}

function fakeNotion(existingTitle = '') {
  const state = { lookups: 0, creates: 0, savedTitle: '', savedBody: '' };
  const notion: MorningBriefNotionStore = {
    async findDirectChildPage(title) {
      state.lookups += 1;
      return existingTitle === title ? { id: 'existing-page', title } : null;
    },
    async createChildPage(title, body) {
      state.creates += 1;
      state.savedTitle = title;
      state.savedBody = body;
      existingTitle = title;
      return { id: 'new-page', url: 'https://notion.so/new-page' };
    },
  };
  return { notion, state };
}

const silentLogger: MorningBriefJobLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

describe('scheduledMorningBriefJob', () => {
  it('平日は date と body を使って正常作成する', async () => {
    const { notion, state: notionState } = fakeNotion();
    const { runs, state: runState } = fakeRuns();
    const result = await scheduledMorningBriefJob({
      generate: async () => weekday(),
      notion,
      runs,
      logger: silentLogger,
    });

    expect(result).toEqual({ ok: true, date: DATE, status: 'created', skipped: false, pageId: 'new-page' });
    expect(notionState.savedTitle).toBe(DATE);
    expect(notionState.savedBody).toBe(BODY);
    expect(runState.created).toBe(1);
  });

  it('skipped: true なら Notion もロックも触らない', async () => {
    const { notion, state: notionState } = fakeNotion();
    const { runs, state: runState } = fakeRuns();
    const result = await scheduledMorningBriefJob({
      generate: async () => ({
        ok: true,
        date: '2026-08-30',
        skipped: true,
        reason: '土日なので朝のメモは作らない',
      }),
      notion,
      runs,
      logger: silentLogger,
    });

    expect(result.status).toBe('weekend');
    expect(notionState.lookups).toBe(0);
    expect(notionState.creates).toBe(0);
    expect(runState.claims).toBe(0);
  });

  it('同じ date の直下ページがあれば増やさない', async () => {
    const { notion, state: notionState } = fakeNotion(DATE);
    const { runs, state: runState } = fakeRuns();
    const result = await scheduledMorningBriefJob({
      generate: async () => weekday(),
      notion,
      runs,
      logger: silentLogger,
    });

    expect(result.status).toBe('already_exists');
    expect(notionState.creates).toBe(0);
    expect(runState.claims).toBe(0);
  });

  it('body を 1 文字も変更せず Notion へ渡す', async () => {
    const exact = '### A\n\n- x  \n- `###`\n末尾';
    const { notion, state } = fakeNotion();
    const { runs } = fakeRuns();
    await scheduledMorningBriefJob({
      generate: async () => weekday(exact),
      notion,
      runs,
      logger: silentLogger,
    });
    expect(state.savedBody).toBe(exact);
  });

  it('morning_brief 生成失敗時はページを作らず異常終了する', async () => {
    const { notion, state } = fakeNotion();
    const { runs } = fakeRuns();
    await expect(
      scheduledMorningBriefJob({
        generate: async () => {
          throw new Error('Firestore read failed');
        },
        notion,
        runs,
        logger: silentLogger,
      }),
    ).rejects.toThrow('Firestore read failed');
    expect(state.lookups).toBe(0);
    expect(state.creates).toBe(0);
  });

  it('Notion 書き込み失敗を記録して異常終了する', async () => {
    const { notion } = fakeNotion();
    notion.createChildPage = async () => {
      throw new Error('Notion API 503');
    };
    const { runs, state } = fakeRuns();
    await expect(
      scheduledMorningBriefJob({
        generate: async () => weekday(),
        notion,
        runs,
        logger: silentLogger,
      }),
    ).rejects.toThrow('Notion API 503');
    expect(state.created).toBe(0);
    expect(state.failed).toBe(1);
  });

  it('二重起動でも作成は 1 回だけ', async () => {
    const { notion, state } = fakeNotion();
    const { runs } = fakeRuns();
    const input = {
      generate: async () => weekday(),
      notion,
      runs,
      logger: silentLogger,
    };
    const results = await Promise.all([
      scheduledMorningBriefJob(input),
      scheduledMorningBriefJob(input),
    ]);
    expect(state.creates).toBe(1);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
  });
});
