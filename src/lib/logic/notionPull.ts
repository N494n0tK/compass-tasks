/**
 * Compass — Notion からのノート受け取り（docs/notebook/notion-pull.md）
 *
 * ノート本文の**正本は Notion**（「Compass取り込みJSON」ページ）。平日 17:00 の
 * Notion エージェントが日付子ページ（`8月17日` など）に `compass-note@2` JSON の
 * コードブロックを置き、Compass はそれを読みに行って `parseNoteJson` → `commitNote`
 * の**既存の取り込み経路**へ流す。手貼りのモーダルと同じ検証・同じ復習生成を通るので、
 * 受け取り元が増えてもノートの品質規則は 1 か所のまま。
 *
 * このファイルは純ロジック（React / firebase / fetch を import しない）:
 *  - Notion API のレスポンス（`blocks.children.list`）から必要な形だけを抜く読み手
 *    （API ルート `/api/notion/pull` が使う）
 *  - 取り込み済みブロックの読み飛ばしと、上書き先ノートの解決
 *    （クライアント `parts/NotionPull.ts` が使う）
 */

import type { Note } from '../model/notes';
import type { NotionPullLog } from '../model/types';

// ─────────────────────────────────────────────────────────────
// API ルート側: Notion API レスポンスの読み手
// ─────────────────────────────────────────────────────────────

/** ルートページ直下の日付子ページ 1 枚 */
export interface NotionChildPage {
  id: string;
  title: string;
  /** ISO 8601。`(2)` ページの後勝ち順を決めるのに使う */
  created: string;
  /** ISO 8601。「最近動いたページだけ読む」の選別に使う */
  edited: string;
}

/** 日付子ページの中のコードブロック 1 個 = 授業 1 コマぶんの JSON */
export interface NotionCodeBlock {
  id: string;
  edited: string;
  text: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 日付ページの名前か。エージェントの命名規則は `M月D日`（再実行で `8月17日 (2)`）。
 * 運用初期の説明文には `2026-08-13` 形式も書かれていたので、ISO も受ける。
 * これで**指示文ページなどの子ページを読まない**（「【エージェント指示文】…」を弾く）。
 */
export function isNotionDatePageTitle(title: string): boolean {
  const t = title.trim();
  return /^\d{1,2}月\d{1,2}日/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t);
}

/** `blocks.children.list` の 1 要素を子ページとして読む。子ページでなければ `null` */
export function notionChildPage(raw: unknown): NotionChildPage | null {
  const block = rec(raw);
  if (!block || block.type !== 'child_page') return null;
  const child = rec(block.child_page);
  const id = str(block.id);
  if (!id) return null;
  return {
    id,
    title: child ? str(child.title) : '',
    created: str(block.created_time),
    edited: str(block.last_edited_time),
  };
}

/** `blocks.children.list` の 1 要素をコードブロックとして読む。違えば `null` */
export function notionCodeBlock(raw: unknown): NotionCodeBlock | null {
  const block = rec(raw);
  if (!block || block.type !== 'code') return null;
  const id = str(block.id);
  const code = rec(block.code);
  if (!id || !code || !Array.isArray(code.rich_text)) return null;
  const text = (code.rich_text as unknown[])
    .map((rt) => str(rec(rt)?.plain_text))
    .join('');
  if (!text.trim()) return null;
  return { id, edited: str(block.last_edited_time), text };
}

/**
 * 読みに行く日付ページを選ぶ。
 *
 *  - 日付ページ以外（指示文など）は落とす
 *  - **最近編集された `max` 枚だけ**にする ―― 全履歴を毎回なめると、ページ 1 枚に
 *    つき API 1 往復なので受け取りがどんどん遅くなる。古いページは取り込み済みで
 *    動かない前提（動いたら `edited` が上がってまた選ばれる）
 *  - 返す順は**作成の古い順**。同じ授業をやり直した `8月17日 (2)` が原本より
 *    **後に**処理され、上書きで勝つようにするため
 */
export function selectNotionPages(
  pages: readonly NotionChildPage[],
  max: number,
): NotionChildPage[] {
  return pages
    .filter((p) => isNotionDatePageTitle(p.title))
    .sort((a, b) => b.edited.localeCompare(a.edited) || a.id.localeCompare(b.id))
    .slice(0, max)
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

/**
 * env の Notion ページ id を API が受ける形へ。`app.notion.com/p/<32桁hex>` の
 * コピーそのまま（ダッシュ無し）でも動くよう、32 桁 hex なら UUID 形式に整える。
 */
export function normalizeNotionId(raw: string): string {
  const t = raw.trim();
  const hex = t.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return t;
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  ).toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// クライアント側: 読み飛ばしと上書き先の解決
// ─────────────────────────────────────────────────────────────

/** API ルートが返す 1 件（`NotionCodeBlock` + どのページから来たか） */
export interface NotionNoteBlock {
  pageId: string;
  pageTitle: string;
  blockId: string;
  edited: string;
  text: string;
}

/** ルートのレスポンスを信用しない読み手（`sanitizeNotes` と同じ「壊れた行は捨てる」方針） */
export function sanitizeNotionNoteBlocks(raw: unknown): NotionNoteBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: NotionNoteBlock[] = [];
  raw.forEach((item) => {
    const b = rec(item);
    if (!b) return;
    const blockId = str(b.blockId);
    const text = str(b.text);
    if (!blockId || !text.trim()) return;
    out.push({
      pageId: str(b.pageId),
      pageTitle: str(b.pageTitle),
      blockId,
      edited: str(b.edited),
      text,
    });
  });
  return out;
}

/** 保存データから来たログの防御的読み込み（`dataPatch` は生値を通すだけなので使う側で守る） */
export function sanitizeNotionPullLog(raw: unknown): NotionPullLog {
  const src = rec(raw);
  if (!src) return {};
  const out: NotionPullLog = {};
  for (const [blockId, value] of Object.entries(src)) {
    const entry = rec(value);
    if (!blockId || !entry) continue;
    if (typeof entry.noteId !== 'string' || typeof entry.edited !== 'string') continue;
    out[blockId] = { noteId: entry.noteId, edited: entry.edited };
  }
  return out;
}

export interface NotionPullPlan {
  /** まだ取り込んでいない、または Notion 側で編集されたブロック（届いた順のまま） */
  pending: NotionNoteBlock[];
  /** ログと `edited` が一致して読み飛ばした数 */
  skipped: number;
}

/**
 * どのブロックを取り込むか。ログに同じ `edited` で載っていれば取り込み済みとして飛ばす。
 * 検証エラーだったブロック（`noteId: ''`）も同じ規則で飛ぶ ―― Notion 側で直せば
 * `edited` が変わるので、そのとき自然に再挑戦になる。
 */
export function planNotionPull(
  blocks: readonly NotionNoteBlock[],
  log: NotionPullLog,
): NotionPullPlan {
  const pending = blocks.filter((b) => log[b.blockId]?.edited !== b.edited);
  return { pending, skipped: blocks.length - pending.length };
}

/**
 * このブロックの上書き先ノートを探す。
 *
 *  1. ログが指すノート ―― 同じブロックの以前の取り込み先。編集で `edited` が変わっても
 *     同じノートに重ねる（解いた記録・写真・自分のまとめは `parseNoteJson` の
 *     `existing` 経由で引き継がれる）
 *  2. **授業日 + 教科 + 単元が一致するノート** ―― エージェントの再実行は既存ページに
 *     追記せず `8月17日 (2)` と別ページを作る運用なので、ブロック id では同一授業と
 *     分からない。同じ授業の別ブロックを新規ノートにすると丸ごと重複するため、
 *     この 3 つ組を「同じ授業」とみなして上書きに倒す（手動の上書き取り込みと同じ感覚）
 */
export function matchExistingNote(
  notes: readonly Note[],
  log: NotionPullLog,
  blockId: string,
  head: Pick<Note, 'date' | 'subject' | 'unit'>,
): Note | null {
  const entry = log[blockId];
  if (entry && entry.noteId) {
    const hit = notes.find((n) => n.id === entry.noteId);
    if (hit) return hit;
  }
  return (
    notes.find(
      (n) => n.date === head.date && n.subject === head.subject && n.unit === head.unit,
    ) || null
  );
}
