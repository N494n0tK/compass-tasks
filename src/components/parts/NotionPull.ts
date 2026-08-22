'use client';

/**
 * Compass — Notion からノートを受け取る（docs/notebook/notion-pull.md）
 *
 * `/api/notion/pull` が集めてきたコードブロックを、手貼りモーダルと**同じ経路**
 * （`parseNoteJson` → `commitNote`）で取り込む。だから検証規則・復習カードの生成・
 * 上書き時の「解いた記録・写真・自分のまとめの引き継ぎ」はモーダルと寸分違わない。
 *
 * 呼ばれ方は 2 つ:
 *  - 起動時の自動受け取り（`CompassApp`。`auto: true` ―― 新着ゼロや未設定では黙る）
 *  - ノート画面の「Notionから受け取る」ボタン（結果がゼロでもトーストで答える）
 *
 * 冪等性は `state.notionPullLog`（ブロック id → `last_edited_time`）で担保。
 * ログは `compass-ui-data` の永続キーなので端末をまたいで同期され、別の端末が
 * 同じブロックをもう一度取り込んで重複ノートを作ることはない。
 */

import { parseNoteJson } from '../../lib/logic/noteImport';
import {
  matchExistingNote,
  planNotionPull,
  sanitizeNotionNoteBlocks,
  sanitizeNotionPullLog,
  type NotionNoteBlock,
} from '../../lib/logic/notionPull';
import { timetableSubjects } from '../../lib/logic/timetable';
import { getFirebaseAuth, isFirebaseConfigured } from '../../lib/firebase';
import { NOTE_SUBJECT_OTHER } from '../../lib/model/notes';
import type { ISODate } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { commitNote } from './NotebookPersistence';

export const TOAST_NOTION_SETUP =
  'Notion連携が未設定です(.env.local に NOTION_TOKEN を設定してください)';
export const TOAST_NOTION_FAIL_PREFIX = 'Notionから受け取れませんでした: ';
export const TOAST_NOTION_EMPTY = 'Notionに新しいノートはありません';

export interface NotionPullOptions {
  /**
   * 起動時の自動受け取り。**新しいノートが入ったときだけ**トーストを出す
   * （未設定・新着ゼロ・通信失敗では黙る ―― 毎朝の起動のたびに叱られたくない）。
   */
  auto?: boolean;
}

/**
 * 本人確認のヘッダ。公開 URL（Vercel）ではルート側が `NOTION_ALLOWED_EMAILS` で
 * Firebase ログインの ID トークンを要求するので、ログイン中なら必ず付ける。
 * preview / Firebase 未設定ではヘッダ無し（ローカルのルートは本人確認をしない）。
 */
async function authHeaders(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured()) return {};
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return {};
    return { Authorization: 'Bearer ' + (await user.getIdToken()) };
  } catch {
    return {};
  }
}

/** ログへ 1 件書く。取り込み成功は noteId、検証エラーは `''`（同じ内容で再挑戦しない） */
function markLog(store: CompassStore, block: NotionNoteBlock, noteId: string): void {
  store.setState((s) => ({
    notionPullLog: {
      ...sanitizeNotionPullLog(s.notionPullLog),
      [block.blockId]: { noteId, edited: block.edited },
    },
  }));
}

/**
 * Notion から受け取り、結果をトーストで返す。busy フラグで多重実行を防ぐ
 * （起動時の自動受け取りとボタン連打が重なると同じブロックを二重に取り込みうる）。
 */
export async function pullNotionNotes(
  store: CompassStore,
  today: ISODate,
  options: NotionPullOptions = {},
): Promise<void> {
  const auto = !!options.auto;
  if (store.getState().nbNotionBusy) return;
  store.setState({ nbNotionBusy: true });
  try {
    let res: Response;
    try {
      res = await fetch('/api/notion/pull', { headers: await authHeaders() });
    } catch {
      if (!auto) store.showToast(TOAST_NOTION_FAIL_PREFIX + '通信に失敗しました');
      return;
    }
    const body: unknown = await res.json().catch(() => null);
    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!res.ok) {
      if (auto) return;
      const setup = rec?.error === 'setup';
      const message = typeof rec?.message === 'string' ? rec.message : 'HTTP ' + res.status;
      store.showToast(setup ? TOAST_NOTION_SETUP : TOAST_NOTION_FAIL_PREFIX + message);
      return;
    }

    const blocks = sanitizeNotionNoteBlocks(rec?.blocks);
    const log = sanitizeNotionPullLog(store.getState().notionPullLog);
    const { pending } = planNotionPull(blocks, log);
    // 教科の候補は手貼りモーダルと同じく時間割から（spec §3.7）
    const subjects = timetableSubjects().concat([NOTE_SUBJECT_OTHER]);

    let added = 0;
    let updated = 0;
    let failed = 0;
    let reviews = 0;
    let firstError = '';

    for (const block of pending) {
      // 1 回目のパースで授業日・教科・単元を知り、上書き先を解決してから取り込み直す。
      // `existing` は cardId の引き継ぎ元なので、決まる前に本パースはできない
      const first = parseNoteJson(block.text, { today, knownSubjects: subjects });
      if (!first.ok) {
        failed += 1;
        if (!firstError) firstError = block.pageTitle + ': ' + first.errors[0].message;
        markLog(store, block, '');
        continue;
      }
      // `notes` は commitNote のたびに増えるので、毎回読み直す（同じ受け取り内の
      // `8月17日 (2)` ブロックが、直前に作ったノートへ上書きで重なるように）
      const existing = matchExistingNote(store.getState().notes, log, block.blockId, first.note);
      const result = existing
        ? parseNoteJson(block.text, { today, existing, knownSubjects: subjects })
        : first;
      if (!result.ok) {
        failed += 1;
        if (!firstError) firstError = block.pageTitle + ': ' + result.errors[0].message;
        markLog(store, block, '');
        continue;
      }
      const { created } = commitNote(store, result.note, today, {
        removedCardIds: result.diff?.removedCardIds,
      });
      reviews += created;
      if (existing) updated += 1;
      else added += 1;
      markLog(store, block, result.note.id);
    }

    if (!added && !updated && !failed) {
      if (!auto) store.showToast(TOAST_NOTION_EMPTY);
      return;
    }
    const parts = ['Notionから受け取り'];
    if (added) parts.push('新規' + added + '冊');
    if (updated) parts.push('更新' + updated + '冊');
    if (reviews) parts.push('復習カード' + reviews + '件');
    if (failed) parts.push('エラー' + failed + '件(' + firstError + ')');
    store.showToast(parts.join(' · '));
  } finally {
    store.setState({ nbNotionBusy: false });
  }
}
