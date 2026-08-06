/**
 * Compass — 読み込み時の補完・マイグレーション（レガシー `dataPatch(raw)` の 1:1 移植）
 *
 * 移植元: `Compass App.dc.html` L2198-2282。spec §4.15 / C-494〜C-502。
 *
 * レガシーはこのメソッドの中で **`this.PLANS` を直接差し替え**（L2201-2203）、
 * **`this._dataRepaired` を立てる**（L2267 / L2275）という 2 つの副作用を持っていた。
 * 移植版は副作用を持たず、両方を戻り値（`plans` / `repaired`）で返す:
 *
 * - `state`   … `persistentKeys` のうち `src[k] !== undefined` のキーだけの patch（C-496）
 * - `plans`   … `payload.plans` がオブジェクト（配列でない）のときだけ入る。
 *               無ければ `undefined` = 呼び出し側の既存 PLANS をそのまま残す（C-495）
 * - `repaired` … M4 / M5 が走ったか。true ならクラウド読込直後に即 `saveNow()`（C-502）
 *
 * **M2 が参照する PLANS は「差し替え後」の値**（レガシーは L2201 で `this.PLANS` を
 * 書き換えてから L2212 で `this.PLANS[seg.plan]` を読む）。ここでは `plans ?? current.plans`。
 *
 * 型検査は一切しない（レガシーどおり）。保存データの中身は信用せず、そのまま patch に流す。
 */

import { isoShift } from './logic/dates';
import {
  PERSISTENT_KEYS,
  type AppState,
  type ISODate,
  type Plans,
  type Review,
  type Seg,
} from './model/types';

/** `dataPatch(raw)` の戻り（`parts/ShellPersistence.DataPatchResult` と同形） */
export interface DataPatchResult {
  /** `persistentKeys` のうち保存データに存在したキーだけの patch */
  state: Partial<AppState>;
  /** `payload.plans` があったときだけ。無ければ既存 PLANS を維持（C-495） */
  plans?: Plans;
  /** `this._dataRepaired`（M4 / M5 が走った）。true なら即時保存（C-502） */
  repaired: boolean;
}

/** `plan.due` の形式検査（HTML:2214） */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `legacyReviewNo`（HTML:2222）。`reviewNo` を持たない v0.6.1 以前のデータで
 * `stage` から第何回かを推定する表。
 */
const LEGACY_REVIEW_NO: Record<string, number> = {
  翌日: 1,
  '3日後': 2,
  '1週間後': 3,
  '2週間後': 4,
  '定着 🎉': 5,
};

/** M3 の一時フィールド付き復習（`_legacyIndex` は処理の最後に delete する） */
type StampedReview = Review & { _legacyIndex: number };

/** `patch[k] = src[k]` を strict TS で書くための逃げ道（レガシーに型検査は無い） */
function assignRaw(patch: Partial<AppState>, key: string, value: unknown): void {
  (patch as Record<string, unknown>)[key] = value;
}

/**
 * `dataPatch(raw)`（HTML:2198-2282）。
 *
 * @param raw     `{data:{…}}` ラッパーも素の `{version,plans,state}` も受ける（C-494）
 * @param current `plans` = 現在の `this.PLANS`、`today` = `this.TODAY`（M5 の比較に使う）
 */
export function dataPatch(
  raw: unknown,
  current: { plans: Plans; today: ISODate }
): DataPatchResult {
  // HTML:2199 — `const payload = raw && raw.data ? raw.data : raw;`
  const wrapper = raw as { data?: unknown } | null | undefined;
  const payload = (wrapper && wrapper.data ? wrapper.data : raw) as Record<string, unknown> | null;
  // HTML:2200 — `if (!payload || typeof payload !== 'object') return {};`
  if (!payload || typeof payload !== 'object') return { state: {}, repaired: false };

  // HTML:2201-2203 — plans がオブジェクト（配列でない）のときだけ差し替え（C-495）
  let plans: Plans | undefined;
  const rawPlans = payload.plans;
  if (rawPlans && typeof rawPlans === 'object' && !Array.isArray(rawPlans)) {
    plans = { ...(rawPlans as Plans) };
  }
  /** M2 が読む PLANS。差し替えたなら新しい方（レガシーの `this.PLANS`） */
  const P: Plans = plans ?? current.plans;

  // HTML:2204 — `payload.state` がオブジェクトでなければ空扱い
  const rawState = payload.state;
  const src = (rawState && typeof rawState === 'object' ? rawState : {}) as Record<string, unknown>;

  // HTML:2205-2207 — 23キーのうち `undefined` でないものだけ（未知のキーは無視, C-496）
  const patch: Partial<AppState> = {};
  for (const k of PERSISTENT_KEYS) {
    if (src[k] !== undefined) assignRaw(patch, k, src[k]);
  }

  let repaired = false;

  // ── M1. テーマ移行（HTML:2208-2209）
  if (patch.theme === 'dark' && patch.themeVersion !== 3) patch.theme = 'note';
  patch.themeVersion = 3;

  // ── M2. GOAL 当日以降の seg を前日へ（HTML:2210-2219 / C-497）
  //    `day:''`（未配分）と孤児 seg は触らない。`_dataRepaired` は立てない。
  if (Array.isArray(patch.segs)) {
    patch.segs = (patch.segs as Seg[]).map((seg) => {
      const plan = P[seg.plan];
      if (!plan || !seg.day || !ISO_RE.test(plan.due || '') || seg.day < plan.due) return seg;
      return { ...seg, day: isoShift(plan.due, -1) };
    });
  }

  // ── M3〜M5（HTML:2220-2280）
  if (Array.isArray(patch.reviews)) {
    // M3-1. 一時 `_legacyIndex` を付けて複製（HTML:2223）
    const reviews: StampedReview[] = (patch.reviews as Review[]).map((review, index) => ({
      ...review,
      _legacyIndex: index,
    }));

    // M3-2. 系列キーを決める（HTML:2224-2231 / C-499）
    const seriesCounts: Record<string, number> = {};
    reviews.forEach((review) => {
      if (review.seriesId) seriesCounts[review.seriesId] = (seriesCounts[review.seriesId] || 0) + 1;
    });
    const groups: Record<string, StampedReview[]> = {};
    reviews.forEach((review) => {
      const semanticKey = [
        review.subj || '',
        review.title || '',
        review.timetableDate || '',
        review.timetablePeriod || '',
      ].join('\u0001');
      const key =
        review.seriesId && seriesCounts[review.seriesId] > 1
          ? 'series:' + review.seriesId
          : 'legacy:' + semanticKey;
      (groups[key] = groups[key] || []).push(review);
    });

    // M3-3〜6. 系列内で並べ替えて `reviewNo` / `seriesId` を補完（HTML:2232-2250）
    Object.keys(groups).forEach((key) => {
      const group = groups[key].sort((a, b) => {
        const ad = a.last || a.due || '';
        const bd = b.last || b.due || '';
        if (ad !== bd) return ad < bd ? -1 : 1;
        if ((a.due || '') !== (b.due || '')) return (a.due || '') < (b.due || '') ? -1 : 1;
        if (!!a.done !== !!b.done) return a.done ? -1 : 1;
        return a._legacyIndex - b._legacyIndex;
      });
      const isLinkedSeries = key.indexOf('series:') === 0;
      const firstSavedNo = Math.floor(Number(group[0] && group[0].reviewNo));
      const startNo =
        firstSavedNo >= 1 ? firstSavedNo : LEGACY_REVIEW_NO[String(group[0] && group[0].stage)] || 1;
      const rootId = isLinkedSeries ? group[0].seriesId : group[0].id;
      group.forEach((review, index) => {
        const savedNo = Math.floor(Number(review.reviewNo));
        review.reviewNo = isLinkedSeries && savedNo >= 1 ? savedNo : startNo + index;
        review.seriesId = rootId;
      });
    });

    // M3-7. 元の配列順へ戻して `_legacyIndex` を落とす（HTML:2251-2254 / C-498）
    patch.reviews = reviews
      .sort((a, b) => a._legacyIndex - b._legacyIndex)
      .map((review) => {
        delete (review as Partial<StampedReview>)._legacyIndex;
        return review as Review;
      });

    // ── M4. 未完了より先の回を削除（HTML:2255-2271 / C-500）
    const sequenceGroups: Record<string, Review[]> = {};
    patch.reviews.forEach((review) => {
      const key = review.seriesId || review.id;
      (sequenceGroups[key] = sequenceGroups[key] || []).push(review);
    });
    const invalidReviewIds: string[] = [];
    Object.keys(sequenceGroups).forEach((key) => {
      const group = sequenceGroups[key]
        .slice()
        .sort((a, b) => (Number(a.reviewNo) || 1) - (Number(b.reviewNo) || 1));
      const pending = group.find((review) => !review.done);
      if (!pending) return;
      const pendingNo = Number(pending.reviewNo) || 1;
      group.forEach((review) => {
        if ((Number(review.reviewNo) || 1) > pendingNo) invalidReviewIds.push(review.id);
      });
    });
    if (invalidReviewIds.length) {
      repaired = true;
      patch.reviews = patch.reviews.filter((review) => invalidReviewIds.indexOf(review.id) < 0);
      if (Array.isArray(patch.order)) {
        patch.order = patch.order.filter((id) => invalidReviewIds.indexOf(id) < 0);
      }
      if (invalidReviewIds.indexOf(patch.selId as string) >= 0) patch.selId = null;
    }

    // ── M5. 期限切れ完了済み復習を今日の ToDo から外す（HTML:2272-2280 / C-501）
    const removeFromTodoIds = patch.reviews
      .filter((review) => review.done && review.added && review.due < current.today)
      .map((review) => review.id);
    if (removeFromTodoIds.length) {
      repaired = true;
      patch.reviews = patch.reviews.map((review) =>
        removeFromTodoIds.indexOf(review.id) >= 0 ? { ...review, added: false } : review
      );
      if (Array.isArray(patch.order)) {
        patch.order = patch.order.filter((id) => removeFromTodoIds.indexOf(id) < 0);
      }
      if (removeFromTodoIds.indexOf(patch.selId as string) >= 0) patch.selId = null;
    }
  }

  return { state: patch, plans, repaired };
}
