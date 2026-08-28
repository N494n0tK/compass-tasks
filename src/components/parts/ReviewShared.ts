'use client';

/**
 * Compass — 復習まわりの共有小物（Phase 2B / TASK S4）
 *
 * 出典: HTML:2916（`openAsk`）、3260-3266（`statusOf`）、2037（`SIZE_MIN`）、
 * 3188 / 3305（`ttLabel`）。spec §6.3 / §6.4。
 *
 * `openAsk` は Review 画面以外（Cockpit の復習カード / ToDo の `toggleItem` /
 * 集中モードの `completeFocusTask`）からも呼ばれるので、ここから import して使うこと。
 * 理解度モーダル本体は `parts/ReviewAskModal.tsx`。
 */

import { daysUntil, type DateContext } from '../../lib/logic/dates';
import { noteRefOf } from '../../lib/logic/noteCards';
import {
  applyReviewCompletion,
  nextReviewOf,
  orderAfterCompletion,
  selIdAfterCompletion,
} from '../../lib/logic/reviews';
import type { Review, ReviewGrade, SizeKey } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { recordNoteAttempt } from './NotebookPersistence';

/**
 * `this.SIZE_MIN`（HTML:2037）。理解度モーダルのサイズチップのラベル
 * （`z + '·' + SIZE_MIN[z] + '分'`, HTML:4295）が引くだけのために置いてある。
 * `lib/logic/reviews.ts` の同名定数は非公開なのでここにローカル定義した（値は同一）。
 */
export const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/**
 * `openAsk(id)`（HTML:2916）— 理解度モーダルを開く。
 * **開くと同時に復習詳細ドロワーが閉じる**（`revSel:null`）。
 */
export function openAsk(store: CompassStore, id: string): void {
  store.setState({ revAsk: id, revAskGrade: null, revAskSize: null, revAskReveal: false, revSel: null });
}

/**
 * `confirmAsk` の副作用（HTML:3146-3185）を 1 か所にまとめたもの。
 *
 * 理解度モーダル（`ReviewAskModal`）と、ノートのドリル面（`NoteDrill`）の**両方**がここを通る。
 * 遷移そのものは `lib/logic/reviews.ts` の `nextReviewOf` / `applyReviewCompletion` に任せる
 * （フォーク禁止。docs/notebook/spec.md §11-4）。
 *
 * @returns `showToast` に渡す文言
 */
export function completeReview(
  store: CompassStore,
  review: Review,
  grade: ReviewGrade,
  size: SizeKey,
  ctx: DateContext,
): string {
  const transition = nextReviewOf(review, grade, size, ctx);
  const m = transition.mutations;
  store.setState((s) => ({
    reviews: applyReviewCompletion(s.reviews, transition),
    studyLog: s.studyLog.concat([m.studyLog]),
    order: orderAfterCompletion(s.order, m),
    selId: selIdAfterCompletion(s.selId, m),
  }));

  // ノート由来の復習なら、問題そのものにも「いつ・どう感じたか」を残す。
  // 復習行は完了すると次の行に置き換わるので、ここで書いておかないと
  // 「この問題を何回やったか」が辿れなくなる（docs/notebook/spec.md §9）。
  // 古い「問ごと」の行だけここで記録できる。いまの行はノート 1 冊ぶんなので
  // どの問かを指しておらず、記録はドリル面が 1 問ずつ丸を付けるときに済ませている
  const ref = noteRefOf(review.seriesId);
  if (ref && ref.cardId) recordNoteAttempt(store, ref.noteId, ref.cardId, ctx.today, grade);

  return transition.message;
}

/** `statusOf(r)` の戻り（HTML:3260-3266） */
export interface ReviewStatus {
  label: string;
  c: string;
  bg: string;
}

/**
 * `statusOf(r)`（HTML:3260-3266）— Review 表 列7 と詳細ドロワーの状態行。
 * `TOMORROW` は `this.DAYS[1].iso`（HTML:3252）= `ctx.tomorrow`。
 */
export function statusOf(
  ctx: DateContext,
  r: Pick<Review, 'done' | 'due'>,
): ReviewStatus {
  if (r.done) return { label: '完了', c: 'var(--tx3)', bg: 'transparent' };
  if (r.due < ctx.today) {
    return {
      label: Math.max(1, -daysUntil(ctx, r.due)) + '日遅れ',
      c: 'var(--pink)',
      bg: 'var(--pinkBg)',
    };
  }
  if (r.due === ctx.today) return { label: '今日', c: 'var(--grn)', bg: 'var(--grnBg)' };
  if (r.due === ctx.tomorrow) return { label: '明日', c: 'var(--acc)', bg: 'var(--accBg)' };
  return { label: '今後', c: 'var(--tx2)', bg: 'var(--bg3)' };
}

/**
 * `ttLabel`（HTML:3188 / 3305）— `r.timetablePeriod ? '時間割 N限' : false`。
 * レガシーは `false` を返して `sc-if` で落としていたので、`null` で同じ扱いにする。
 */
export function ttLabelOf(r: Pick<Review, 'timetablePeriod'>): string | null {
  return r.timetablePeriod ? '時間割 ' + r.timetablePeriod + '限' : null;
}
