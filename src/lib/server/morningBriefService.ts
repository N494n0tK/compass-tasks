/**
 * MCP と定期実行が共有する「朝のメモ」生成サービス。
 *
 * 時間割・提出・問題の選び方は `logic/morningBrief.ts` だけが持つ。
 * この層は Firestore からノートを読み、今日（Asia/Tokyo）を決めて、その純ロジックへ渡すだけ。
 */

import { todayISO } from '../logic/dates';
import { buildMorningBrief, type MorningBrief } from '../logic/morningBrief';
import type { ISODate } from '../model/types';
import type { CompassServerStore } from './compassStore';

export type GeneratedMorningBrief =
  | { ok: true; date: ISODate; skipped: true; reason: string }
  | ({ ok: true; skipped: false } & MorningBrief);

/**
 * 引数を省けば、通常の MCP `morning_brief` と同じく「今日・Asia/Tokyo」で作る。
 * `date` は既存 MCP の明示日付呼び出しとテストだけの注入点。
 */
export async function generateMorningBrief(
  store: CompassServerStore,
  date: ISODate = todayISO(),
): Promise<GeneratedMorningBrief> {
  const notes = await store.loadNotes();
  const brief = buildMorningBrief({ date, notes });
  if (!brief) {
    return { ok: true, date, skipped: true, reason: '土日なので朝のメモは作らない' };
  }
  return { ok: true, skipped: false, ...brief };
}
