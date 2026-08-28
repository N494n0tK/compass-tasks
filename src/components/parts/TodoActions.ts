'use client';

/**
 * Compass — ToDo 画面まわりの小物（Phase 2B / TASK S3）
 *
 * 出典: HTML:2037（`SIZE_MIN`）、2639（`gl()`）、2730-2735（`activePlanIds` / `planIds`）、
 * 2916-2922（`openAsk` / `toggleItem`）、3636-3642（`sizeChip`）。
 * spec §5.7 / §7.4 / §4.17。
 *
 * `screens/Todo.tsx` から使う共有部分だけを置く。
 * どれもレガシーでは `renderVals` の中に素で書かれていたヘルパで、`lib/logic`（＝レガシーの
 * クラス外関数だけを持つ層）には無い。
 */

import type { AppState, Plans, ISODate, SizeKey } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { clawdCheerText } from '../../lib/logic/clawdTalk';
import { mutExtra, mutReview, mutSeg, openNoteDrill } from './ShellActions';
import { buildTodayItems, todayTotals, type TodayItem } from './ShellTodayItems';
import { dateCtx } from '../useStore';

/**
 * `this.SIZE_MIN`（HTML:2037）。
 * `lib/logic/reviews.ts` / `parts/ShellTodayItems.ts` も同じ値をローカルに持っている
 * （どちらも非公開）ので、ここでも同値のローカル定義を置く。
 */
export const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/** サイズチップの並び（HTML:3643 ほか `['XS','S','M','L']`） */
export const SIZE_KEYS: readonly SizeKey[] = ['XS', 'S', 'M', 'L'];

/**
 * `gl(col, base)`（HTML:2639）。`props.glow = 3` → `glow = 1` 固定なので
 * `'0 0 {base}px color-mix(in srgb, {col} 30%, transparent)'` になる。
 *
 * `parts/ShellTheme.ts` の同名関数は非公開なので同式を再掲する（出力文字列は完全一致）。
 */
const GLOW = Math.max(0, Math.min(10, 3)) / 3;

export function gl(col: string, base: number): string {
  return GLOW === 0
    ? 'none'
    : '0 0 ' +
        Math.round(base * GLOW) +
        'px color-mix(in srgb, ' +
        col +
        ' ' +
        Math.round(30 * Math.min(GLOW, 2)) +
        '%, transparent)';
}

/** `openAsk(id)`（HTML:2916）— 理解度モーダルを開く（この時点では done にしない） */
export function openAsk(store: CompassStore, id: string): void {
  store.setState({ revAsk: id, revAskGrade: null, revAskSize: null, revAskReveal: false, revSel: null });
}

/**
 * `toggleItem(it)`（HTML:2917-2922）。レガシーはカリー化（`(it) => () => {…}`）されているが、
 * ここは呼び出し側で `onClick={() => toggleItem(store, it)}` と書く形にした。
 *
 * - **ノート由来の復習（1 冊 1 枚に束ねたもの）… ドリル画面へ**（v0.10 追加）
 * - seg / extra … `done` を反転
 * - rev かつ未完了 … 理解度モーダルへ（**まだ done にしない**）
 * - rev かつ完了済 … モーダルなしで未完了へ戻す
 */
export function toggleItem(store: CompassStore, it: TodayItem): void {
  // ノートの復習は 1 問ずつモーダルを開くのではなく、その授業の問題だけを並べた
  // ドリル面でまとめて解く（docs/notebook/spec.md §8）
  if (it.noteId && !it.done) {
    openNoteDrill(store, it.noteId);
    return;
  }
  // 片づける向きか、戻す向きか。祝うのは**片づけたときだけ**
  const clearing = !it.done;
  if (it.kind === 'seg') mutSeg(store, it.id, (x) => ((x.done = !x.done), x));
  else if (it.kind === 'extra') mutExtra(store, it.id, (x) => ((x.done = !x.done), x));
  else if (!it.done) openAsk(store, it.id);
  else mutReview(store, it.id, (x) => ((x.done = false), x));
  if (clearing) cheerCleared(store);
}

/**
 * 1 つ片づいたことを Clawd が下から知らせる（要望 2026-08-28）。
 *
 * 数えるのは**片づけたあとの state** なので、この関数は `mut*` のあとに呼ぶこと
 * （`store.setState` は同期反映なので、直後に読めばもう新しい値。`store.ts` の注記 1）。
 *
 * 知らせのトースト（`ShellToast`）には混ぜない。あちらは 1 本しか出せず、
 * 保存の失敗のような**読まないと困ること**の席なので、祝いで潰すわけにいかない。
 */
function cheerCleared(store: CompassStore): void {
  const s = store.getState();
  const totals = todayTotals(buildTodayItems(s, store.getPlans(), dateCtx.today));
  const allDone = totals.totalCount > 0 && totals.doneCount === totals.totalCount;
  // `n` は「今日いくつ片づけたか」。続けて片づけると言葉が回る（乱数を使わない）
  const n = totals.doneCount;
  store.setState({ clawdCheer: { text: clawdCheerText(n, allDone), n } });
}

/** `sizeChip(cur, onPick)(z)` の戻り（HTML:3636-3642） */
export interface SizeChip {
  key: SizeKey;
  label: string;
  c: string;
  bg: string;
  bd: string;
}

/** `['XS','S','M','L'].map(sizeChip(cur, onPick))`（HTML:3643 / 4275） */
export function sizeChips(cur: SizeKey): SizeChip[] {
  return SIZE_KEYS.map((z) => ({
    key: z,
    label: z + '·' + SIZE_MIN[z] + '分',
    c: cur === z ? 'var(--onAcc)' : 'var(--tx2)',
    bg: cur === z ? 'var(--acc)' : 'var(--bg2)',
    bd: cur === z ? 'var(--acc)' : 'var(--line2)',
  }));
}

/**
 * `activePlanIds` → `planIds`（HTML:2730-2735）。
 *
 * TASK I0 で `lib/logic/schedule.ts` へ一本化した（Tests / Cockpit / ToDo / Data が
 * 同じ集合・同じ並びを見るため）。ここは既存 import 互換のための再輸出。
 */
export { orderedPlanIds } from '../../lib/logic/schedule';
