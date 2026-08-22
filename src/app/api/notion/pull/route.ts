/**
 * Compass — GET /api/notion/pull（docs/notebook/notion-pull.md）
 *
 * Notion の「Compass取り込みJSON」ページ（ノート本文の正本）から、日付子ページの
 * コードブロック（`compass-note@2` JSON）を集めて返す。**ここでは JSON の中身を
 * 検証しない** ―― 検証・取り込みはクライアントの既存経路（`parseNoteJson` →
 * `commitNote`）の仕事で、このルートは Notion API の往復だけを引き受ける
 * （トークンをブラウザに出さないためのサーバー側の足）。
 *
 * 必要な env（.env.local。どちらも NEXT_PUBLIC を付けない）:
 *  - `NOTION_TOKEN`         … Notion のインターナルインテグレーションのシークレット
 *  - `NOTION_NOTES_PAGE_ID` … 「Compass取り込みJSON」ページの id（URL 末尾の 32 桁）
 *
 * レスポンス:
 *  - 200 `{ blocks: NotionNoteBlock[] }` … ページ作成の古い順 × ページ内の並び順。
 *    `8月17日 (2)`（再実行ページ）が原本より後に来るので、上書きで後勝ちになる
 *  - 503 `{ error: 'setup', message }`  … env 未設定（クライアントは設定手順を案内）
 *  - 502 `{ error: 'notion', message }` … Notion API 側の失敗（権限・レート・障害）
 */

import { NextResponse } from 'next/server';
import {
  normalizeNotionId,
  notionChildPage,
  notionCodeBlock,
  selectNotionPages,
  type NotionChildPage,
  type NotionNoteBlock,
} from '../../../../lib/logic/notionPull';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * 1 回の受け取りで読む日付ページの上限。1 ページ = API 1 往復なので、全履歴を
 * 毎回なめない（約 6 週間ぶん。古いページは取り込み済みで動かない前提で、
 * もし動けば `last_edited_time` が上がって再びこの窓に入る）。
 */
const MAX_PAGES = 30;

class NotionApiError extends Error {}

/** `blocks.children.list` を最後のページまで読む（1 往復 100 件） */
async function listChildren(token: string, blockId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: string | null = null;
  do {
    const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = await fetch(NOTION_API + '/blocks/' + blockId + '/children' + query, {
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
      // Next のフェッチキャッシュに乗せない（受け取りは常に今の Notion を見る）
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NotionApiError(
        'Notion API ' + res.status + (body ? ': ' + body.slice(0, 300) : ''),
      );
    }
    const json = (await res.json()) as {
      results?: unknown[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    out.push(...(Array.isArray(json.results) ? json.results : []));
    cursor = json.has_more && json.next_cursor ? json.next_cursor : null;
  } while (cursor);
  return out;
}

export async function GET(): Promise<NextResponse> {
  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_NOTES_PAGE_ID;
  if (!token || !pageId) {
    return NextResponse.json(
      {
        error: 'setup',
        message:
          '.env.local に NOTION_TOKEN と NOTION_NOTES_PAGE_ID を設定してください（docs/notebook/notion-pull.md）',
      },
      { status: 503 },
    );
  }

  try {
    const rootChildren = await listChildren(token, normalizeNotionId(pageId));
    const pages: NotionChildPage[] = [];
    rootChildren.forEach((raw) => {
      const page = notionChildPage(raw);
      if (page) pages.push(page);
    });

    const blocks: NotionNoteBlock[] = [];
    for (const page of selectNotionPages(pages, MAX_PAGES)) {
      const children = await listChildren(token, page.id);
      children.forEach((raw) => {
        const code = notionCodeBlock(raw);
        if (!code) return;
        blocks.push({
          pageId: page.id,
          pageTitle: page.title,
          blockId: code.id,
          edited: code.edited,
          text: code.text,
        });
      });
    }
    return NextResponse.json({ blocks });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'notion', message }, { status: 502 });
  }
}
