/**
 * Compass — 配置エンジン・負荷計算・再配分（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * 出典:
 *  - HTML:1922-1937（`scheduleItems` の設計コメント）/ 1938-1988（`scheduleItems` 本体、クラス外の
 *    トップレベル関数）
 *  - HTML:2513-2528（`planTimelineDays`）、2530-2537（`loadsMap`）、2538（`maxOf`）
 *  - HTML:2540-2601（`computePreview`）
 *  - HTML:2688-2690（`overdue` / `redistTargets`。v0.9 で `overdue` から `!s.manualDay` を除去）
 *  - HTML:2755 / 2793（計画行バッジ `od` / `odCount`）
 *  - HTML:4189-4196（`applyRedist`）、4207-4211（`wkMaxH`/`wkPlus`/`wkMinus`/`wePlus`/`weMinus`）
 *  - HTML:4221（`todayLoadPct` — spec Q5 の無意味な三項演算）
 *  - HTML:3722-3739（計画作成時の初期配置。spec Q11 のミニ0件挙動）
 *  - spec §7.1 / §7.2 / §7.3 / §7.8、§5.3、§11-Q5・Q11・Q12・Q14・Q15
 *
 * 純ロジック。React / firebase を import しない。
 *
 * ## 移植方針
 * 「初期配置も再配分も必ず `scheduleItems` を通す」というレガシーの構造をそのまま保つ。
 * 数式・分岐・丸め・文言・**バグ**（Q5 の三項演算, Q11 の未配分, Q15 の再計算）まで 1:1。
 */

import type { DateContext, DayInfo } from './dates';
import { buildDays, isoAt } from './dates';
import type {
  AppState,
  Extra,
  ISODate,
  ISODateOrEmpty,
  Plans,
  RedistMode,
  Review,
  Seg,
  SizeKey,
} from '../model/types';

const DAY_MS = 86400000;

/** `planTimelineDays` の日付検証（HTML:2516） */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════
// 1. 配置エンジン `scheduleItems`（HTML:1938-1988 / spec §7.1）
// ═══════════════════════════════════════════════════════════════

/**
 * 配置モード。
 * - `'even'`  … 空き容量に比例して散らす（既定）
 * - `'early'` … 入る日から前詰め
 * - `'flow'`  … 上限を無視して期間全体へ等間隔
 */
export type Spread = 'even' | 'early' | 'flow';

/** `scheduleItems` が読むのは `min` だけ（HTML:1944） */
export interface Placeable {
  min?: number | null;
}

/**
 * 配置エンジン — **このアプリの心臓部**（HTML:1938-1988）。
 *
 * @param items 配置するタスクを**表示順**で渡す
 * @param room  候補日ごとの「まだ入れられる分数」。`items` ではなく候補日と同じ長さ
 * @param spread 既定 `'even'`
 * @returns `items` と同じ長さ。各要素は候補日 index、置けなければ `-1`
 *
 * ### 1:1 で残した癖
 * - `need`: `Math.max(1, Number(it && it.min) || 1)` → **min が 0 / undefined / NaN でも最低 1 分**
 * - `even`/`flow` は `ratio` の分母が `centers[n-1] - centers[0]` なので **1件目は必ず初日**
 *   （`span > 0` でも `ratio = 0`）、最後は最終日側に寄る
 * - 置けずに `continue` したとき `even` の走査カーソル `day` は**進めない**（`early` の `cursor` も同様）
 * - `flow` は `left` を減らさないので同じ日にいくつでも積める
 */
export function scheduleItems(
  items: readonly (Placeable | null | undefined)[],
  room: readonly number[],
  spread: Spread | string = 'even',
): number[] {
  const dayCount = room.length;
  const itemCount = items.length;
  const out: number[] = new Array(itemCount).fill(-1);
  if (!dayCount || !itemCount) return out;

  const left = room.map((v) => Math.max(0, Number(v) || 0));
  // `Number(it && it.min) || 1` と同値（it が falsy なら NaN/0 → 1 に落ちる）
  const need = items.map((it) => Math.max(1, Number(it ? it.min : it) || 1));
  const unlimited = spread === 'flow';

  // 前詰め: 入る最初の日へ順に置く（HTML:1948-1957）
  if (spread === 'early') {
    let cursor = 0;
    for (let i = 0; i < itemCount; i++) {
      let d = cursor;
      while (d < dayCount && left[d] < need[i]) d++;
      if (d >= dayCount) continue;
      out[i] = d;
      left[d] -= need[i];
      cursor = d; // 同じ日に複数入るよう cursor は d に戻す
    }
    return out;
  }

  // 均等: 期間を「各日の空き容量」の比で区間に割り、作業の進捗がどの区間に落ちるかで日を決める
  // （HTML:1959-1987）。重みが空き容量なので平日/休日の上限差も既存の予定も自動的に効く。
  const weight = unlimited ? left.map(() => 1) : left.slice();
  const totalWeight = weight.reduce((a, w) => a + w, 0);
  if (totalWeight <= 0) return out;

  // cumBefore[d] = d 日目より前の容量の合計（cumBefore[0] = 0）
  const cumBefore: number[] = [0];
  for (let d = 0; d < dayCount; d++) cumBefore.push(cumBefore[d] + weight[d]);

  // 各タスクの「重心」= それまでの作業量 + 自分の半分
  const centers: number[] = [];
  let run = 0;
  for (let i = 0; i < itemCount; i++) {
    centers.push(run + need[i] / 2);
    run += need[i];
  }
  const first = centers[0];
  const span = centers[itemCount - 1] - first;

  let day = 0;
  for (let i = 0; i < itemCount; i++) {
    const ratio = span > 0 ? (centers[i] - first) / span : 0;
    const mark = ratio * totalWeight; // 進捗を容量軸に写した位置
    while (day < dayCount - 1 && cumBefore[day + 1] <= mark + 1e-6) day++;
    let d = day;
    if (!unlimited) {
      while (d < dayCount && left[d] < need[i]) d++;
    }
    if (d >= dayCount) continue; // 上限内に置ける日がない（day は据え置き）
    out[i] = d;
    if (!unlimited) left[d] -= need[i];
    day = d;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 2. 最大負荷（wkMax / weMax）と `maxOf`（HTML:2538, 4207-4211 / spec §7.2）
// ═══════════════════════════════════════════════════════════════

/** `state.wkMax` / `state.weMax` だけを取り出した形 */
export interface LoadLimits {
  /** 平日の上限（分）。初期値 240（HTML:2066） */
  wkMax: number;
  /** 休日の上限（分）。初期値 360（HTML:2066） */
  weMax: number;
}

/** `wkPlus`/`wkMinus` の刻み幅（分, HTML:4208-4211） */
export const MAX_LOAD_STEP = 30;
/** `wkMinus`/`weMinus` の下限（分） */
export const MAX_LOAD_MIN = 60;
/** `wkPlus`/`wePlus` の上限（分） */
export const MAX_LOAD_MAX = 720;

/** `maxOf(d)`（HTML:2538）— 週末なら `weMax`、平日なら `wkMax` */
export function maxOf(d: Pick<DayInfo, 'weekend'>, limits: LoadLimits): number {
  return d.weekend ? limits.weMax : limits.wkMax;
}

/**
 * `wkPlus` / `wePlus`（HTML:4208, 4210）= `Math.min(720, v + 30)`。
 * > 上側しかクランプしない（60 未満の値から増やすと 60 未満のままになりうる）のはレガシー通り。
 */
export function incMaxLoad(v: number): number {
  return Math.min(MAX_LOAD_MAX, v + MAX_LOAD_STEP);
}

/** `wkMinus` / `weMinus`（HTML:4209, 4211）= `Math.max(60, v - 30)` */
export function decMaxLoad(v: number): number {
  return Math.max(MAX_LOAD_MIN, v - MAX_LOAD_STEP);
}

/** `wkMaxH` / `weMaxH`（HTML:4207）= `(min / 60) + 'h'`。240 → `'4h'`、270 → `'4.5h'` */
export function maxLoadLabel(min: number): string {
  return min / 60 + 'h';
}

// ═══════════════════════════════════════════════════════════════
// 3. 日付軸と負荷（HTML:2513-2537 / spec §7.2）
// ═══════════════════════════════════════════════════════════════

/** `planTimelineDays` が返す日数の上限（HTML:2527「最大2年分」） */
export const MAX_TIMELINE_DAYS = 731;

/**
 * `planTimelineDays(plans, segs)`（HTML:2513-2528）。
 *
 * 今日から最低 13 日、全 plan の `due` と全 seg の `day` のうち**今日以降の最遠日**まで伸ばす。
 * `iso >= TODAY` を満たさない過去日は無視されるので、期限切れ計画では長さが伸びない。
 * 最大 `MAX_TIMELINE_DAYS`（731）で打ち切る。
 */
export function planTimelineDays(
  plans: Plans | null | undefined,
  segs: readonly Seg[] | null | undefined,
  ctx: DateContext,
): DayInfo[] {
  let lastIso = isoAt(ctx, 12);
  const include = (iso: string | null | undefined): void => {
    if (ISO_RE.test(iso || '') && (iso as string) >= ctx.today && (iso as string) > lastIso) {
      lastIso = iso as string;
    }
  };
  const P = plans || {};
  Object.keys(P).forEach((id) => include(P[id] && P[id].due));
  (segs || []).forEach((seg) => include(seg && seg.day));
  const lastTime = new Date(lastIso + 'T00:00:00Z').getTime();
  const lastIndex = Math.max(12, Math.floor((lastTime - ctx.base) / DAY_MS));
  const count = Math.min(MAX_TIMELINE_DAYS, lastIndex + 1);
  // HTML:2528 の `Array.from({length:count}, (v,i) => ({iso, dow, label, weekend, idx}))` と同式
  return buildDays(ctx.today, count);
}

/** `loadsMap` が読む state の部分（HTML:2531-2535） */
export interface LoadSources {
  segs: readonly Seg[];
  extras: readonly Extra[];
  reviews: readonly Review[];
}

/**
 * `loadsMap(days)`（HTML:2530-2537）— 日ごとの負荷（分）。
 *
 * ```
 * segs   : !done && L[day] != null      → L[day] += min      // 未配分('')・枠外は無視
 * extras : !done, d = day || TODAY      → L[d]   += min      // 未配分は今日に寄せる
 * reviews: added && !done               → L[TODAY] += min    // ★ 常に今日。ガード無し
 * ```
 *
 * > レガシーは reviews の行だけ `L[TODAY] != null` を確認していない（HTML:2535）。
 * > `days` が今日を含まない配列だと `NaN` になるが、実際の呼び出しは必ず
 * > `planTimelineDays`（days[0] === TODAY）なので到達しない。**その挙動ごと移植**。
 */
export function loadsMap(
  days: readonly DayInfo[],
  src: LoadSources,
  today: ISODate,
): Record<ISODate, number> {
  const L: Record<string, number> = {};
  days.forEach((d) => {
    L[d.iso] = 0;
  });
  src.segs.forEach((s) => {
    if (!s.done && L[s.day] != null) L[s.day] += s.min;
  });
  src.extras.forEach((x) => {
    const d = x.day || today;
    if (!x.done && L[d] != null) L[d] += x.min;
  });
  src.reviews.forEach((r) => {
    if (r.added && !r.done) L[today] += r.min;
  });
  return L;
}

/** `toH(m)`（HTML:2913 / 2724 / 3805 ほか）= `(Math.round(m / 6) / 10) + 'h'` */
export function toH(m: number): string {
  return Math.round(m / 6) / 10 + 'h';
}

/**
 * Tests タイムラインの日別負荷バーの高さ（HTML:2718）。
 * `mx === 0` は起こらない（`maxOf` は 60 以上）。
 */
export function loadBarPct(load: number, max: number): string {
  return Math.min(100, Math.round((load / max) * 100)) + '%';
}

/** 再配分モーダルの負荷プレビューのバー（HTML:3803）— **最低 4%** で必ず見えるようにする */
export function redistLoadBarPct(load: number, max: number): string {
  return Math.max(4, Math.min(100, Math.round((load / max) * 100))) + '%';
}

/**
 * Cockpit の「負荷 {todayLoadH} / 平日Max {wkMaxH}」バー（HTML:4221）。
 *
 * ```js
 * Math.min(100, Math.round((totalMin - doneMin === 0 ? totalMin : totalMin) / S.wkMax * 100)) + '%'
 * ```
 * **三項演算は両枝とも `totalMin`** で `doneMin` は結果に影響しない（spec Q5）。
 * おそらく「完了分を引く」意図の未完成コードだが、**バグごと 1:1 で再現する**。
 * 引数 `doneMin` は式の形を残すためだけに受け取る。
 * また **ラベルも割る値も常に平日 `wkMax`** 固定で `weMax` に切り替わらない（spec Q6）。
 */
export function todayLoadPct(totalMin: number, doneMin: number, wkMax: number): string {
  return (
    Math.min(100, Math.round(((totalMin - doneMin === 0 ? totalMin : totalMin) / wkMax) * 100)) + '%'
  );
}

// ═══════════════════════════════════════════════════════════════
// 4. 再配分の対象（HTML:2688-2690, 2755 / spec §7.8 末尾・§11-Q12）
// ═══════════════════════════════════════════════════════════════

/**
 * `overdue`（HTML:2689）— トップバー / ナビの「⚠ N件」。
 *
 * **(v0.9 修正)** 旧実装の `!s.manualDay` を外し、計画行バッジ `odCount` と数え方を揃えた
 * （手動配置でも遅れていることに変わりはない）。spec Q12 は解消済。
 */
export function overdueSegs(
  segs: readonly Seg[],
  plans: Plans,
  today: ISODate,
): Seg[] {
  return segs.filter((s) => !s.done && s.day < today && plans[s.plan] && plans[s.plan].due > today);
}

/**
 * `redistTargets`（HTML:2690）— 「未完了 {n}件」および実際に動かす候補。
 *
 * **`manualDay` は「手動配置も対象」トグル（`redistIncludeManual`）が ON のときだけ含む。**
 * したがって `overdueSegs().length`（⚠件数）より少なくなることがあるが、これは意図した仕様
 * （spec §7.8 の注記）。
 */
export function redistTargetSegs(
  segs: readonly Seg[],
  plans: Plans,
  today: ISODate,
  includeManual: boolean,
): Seg[] {
  return segs.filter(
    (s) =>
      !s.done &&
      (!s.manualDay || includeManual) &&
      plans[s.plan] &&
      plans[s.plan].due > today,
  );
}

/**
 * 計画行の `⚠{n}` バッジ（`od`, HTML:2755）— **その計画の seg だけ**を見る。
 * `plan.due > TODAY` の条件が無いので、`overdueSegs` と母集団は完全一致しない
 * （期限切れ計画の遅れも数える）。v0.9 で揃えたのは `manualDay` の扱いのみ。
 */
export function planOverdueCount(planSegs: readonly Seg[], today: ISODate): number {
  return planSegs.filter((s) => !s.done && s.day < today).length;
}

// ═══════════════════════════════════════════════════════════════
// 4b. 表示対象の計画とその並び（HTML:2729-2735）
// ═══════════════════════════════════════════════════════════════

/**
 * `activePlanIds`（HTML:2730-2733）— 期限切れ **かつ** ミニタスクが 1 件以上あって
 * その全部が完了している計画を落とす。ミニタスク 0 件の計画は期限切れでも残る。
 *
 * Tests / Cockpit / ToDo / Data がすべて同じ集合を使う（ずれると計画の表示が食い違う）。
 */
export function activePlanIds(
  segs: readonly Seg[],
  plans: Plans,
  today: ISODate,
): string[] {
  return Object.keys(plans).filter((pid) => {
    const planSegs = segs.filter((s) => s.plan === pid);
    return !(plans[pid].due < today && planSegs.length > 0 && planSegs.every((s) => s.done));
  });
}

/**
 * `planIds`（HTML:2734-2735）— `planOrder` に載っている順を先頭に、
 * 残りを `Object.keys(PLANS)` の順で後ろへ。`planOrder` の未知 ID は捨てる。
 */
export function orderedPlanIds(
  state: Pick<AppState, 'segs' | 'planOrder'>,
  plans: Plans,
  today: ISODate,
): string[] {
  const active = activePlanIds(state.segs, plans, today);
  const savedPlanOrder = Array.isArray(state.planOrder)
    ? state.planOrder.filter((pid) => active.indexOf(pid) >= 0)
    : [];
  return savedPlanOrder.concat(active.filter((pid) => savedPlanOrder.indexOf(pid) < 0));
}

// ═══════════════════════════════════════════════════════════════
// 5. 再配分プレビュー `computePreview`（HTML:2540-2601 / spec §7.8）
// ═══════════════════════════════════════════════════════════════

/** `unplaced[].reason`（HTML:2582, 2591） */
export type UnplacedReason = 'GOAL前に作業日がありません' | '上限内に入る日がありません';

/** `moves[]` の1件（HTML:2596） */
export interface RedistMove {
  seg: Seg;
  toIso: ISODate;
  /** 置いた結果その日が上限超過になったか（`evenUnlimited` で立つ） */
  warn: boolean;
}

/** `unplaced[]` の1件（HTML:2582, 2591） */
export interface RedistUnplaced {
  seg: Seg;
  reason: UnplacedReason;
}

/** `lockedOverDays[]` の1件（HTML:2561-2563） */
export interface LockedOverDay {
  iso: ISODate;
  load: number;
  max: number;
}

/** `computePreview` の戻り（HTML:2600） */
export interface RedistPreview {
  moves: RedistMove[];
  unplaced: RedistUnplaced[];
  /** 適用後の日別負荷（対象を差し引いてから moves を足し込んだもの） */
  loads: Record<ISODate, number>;
  days: DayInfo[];
  mode: RedistMode;
  /** `'all'` / planId / `null` */
  plan: string | null;
  includeManual: boolean;
  ignoreLimit: boolean;
  lateDays: number;
  lockedOverDays: LockedOverDay[];
  targets: Seg[];
}

/** `computePreview` が読む state の部分 */
export interface RedistStateSlice extends LoadSources, LoadLimits {
  planOrder: readonly string[];
  redistMode?: RedistMode | null;
  redistPlan?: string | null;
  redistIncludeManual?: boolean;
  /** 入力欄由来なので文字列も来うる（レガシーは `parseInt(…, 10) || 7`） */
  redistLateDays?: number | string | null;
}

/** `parseInt(v, 10) || fallback`（HTML:2546） */
function parseIntOr(v: number | string | null | undefined, fallback: number): number {
  const n = parseInt(String(v), 10);
  return n || fallback;
}

/**
 * `computePreview(mode, planId, includeManual)`（HTML:2540-2601）。
 *
 * 引数の 3 つはレガシーと同じフォールバック規則:
 * - `mode  || state.redistMode || 'even'`
 * - `planId || state.redistPlan || null`
 * - `includeManual === undefined ? !!state.redistIncludeManual : !!includeManual`
 *
 * ### アルゴリズム
 * 1. `days = planTimelineDays` / `loads = loadsMap`
 * 2. `targets` = 未完了 ∧（手動固定でない ∨ トグルON）∧ 計画が存在 ∧ `plan.due > TODAY` ∧ スコープ内
 * 3. `targets` の分を `loads` から差し引く（動かす前提なので一旦空ける）
 * 4. 差し引いても上限超過の日 = `lockedOverDays`（対象外の予定だけで超えている日）
 * 5. 計画を **`due` 昇順 → 同 due なら `planOrder` の index 順**で処理。
 *    **先に処理した計画の配置が後続計画の `room` を減らす**
 * 6. 各計画: 候補日は `days[0 .. dueIndex)`（**GOAL当日は必ず除外**）、`late` なら末尾 N 日だけ。
 *    `room = max(0, maxOf(day) - loads[day])`、`spread` を選んで `scheduleItems` に丸投げ
 */
export function computePreview(
  plans: Plans,
  state: RedistStateSlice,
  ctx: DateContext,
  mode?: RedistMode | null,
  planId?: string | null,
  includeManual?: boolean,
): RedistPreview {
  const P = plans;
  const T = ctx.today;
  const redistMode: RedistMode = mode || state.redistMode || 'even';
  const redistPlan: string | null = planId || state.redistPlan || null;
  const redistIncludeManual =
    includeManual === undefined ? !!state.redistIncludeManual : !!includeManual;
  const ignoreLimit = redistMode === 'evenUnlimited';
  const redistLateDays = Math.max(1, Math.min(90, parseIntOr(state.redistLateDays, 7)));
  const days = planTimelineDays(P, state.segs, ctx);
  const loads = loadsMap(days, state, T);
  const dayIndex: Record<string, number> = {};
  days.forEach((day, index) => {
    dayIndex[day.iso] = index;
  });

  // 完了・期限切れは動かさない。手動固定は明示スイッチON時だけ対象に含める。
  // GOAL当日は候補日から必ず外す。
  const targets = state.segs.filter((seg) => {
    const plan = P[seg.plan];
    const inScope = redistPlan === 'all' || seg.plan === redistPlan;
    return !seg.done && (!seg.manualDay || redistIncludeManual) && !!plan && plan.due > T && inScope;
  });
  targets.forEach((seg) => {
    if (loads[seg.day] != null) loads[seg.day] = Math.max(0, loads[seg.day] - seg.min);
  });

  // 対象外（手動固定・別計画・単発など）だけで既に上限を超える日は、
  // 再配分後も超過が残るためUIで理由を明示する。
  const lockedOverDays: LockedOverDay[] = days
    .filter((day) => loads[day.iso] > maxOf(day, state))
    .map((day) => ({ iso: day.iso, load: loads[day.iso], max: maxOf(day, state) }));

  const byPlan: Record<string, Seg[]> = {};
  targets.forEach((seg) => {
    (byPlan[seg.plan] = byPlan[seg.plan] || []).push(seg);
  });
  const sourceOrder = new Map(state.segs.map((seg, index) => [seg.id, index]));
  const planOrder = state.planOrder || [];
  const orderedPlans = Object.keys(byPlan).sort((a, b) => {
    if (P[a].due !== P[b].due) return P[a].due < P[b].due ? -1 : 1;
    return planOrder.indexOf(a) - planOrder.indexOf(b);
  });
  const moves: RedistMove[] = [];
  const unplaced: RedistUnplaced[] = [];

  orderedPlans.forEach((pid) => {
    const plan = P[pid];
    const dueIndex = dayIndex[plan.due] == null ? days.length : dayIndex[plan.due];
    const allCandidates = days.slice(0, Math.max(0, dueIndex));
    const candidates =
      redistMode === 'late'
        ? allCandidates.slice(Math.max(0, allCandidates.length - redistLateDays))
        : allCandidates;
    const planSegs = byPlan[pid]
      .slice()
      .sort((a, b) => (sourceOrder.get(a.id) as number) - (sourceOrder.get(b.id) as number));
    if (!candidates.length) {
      planSegs.forEach((seg) => unplaced.push({ seg, reason: 'GOAL前に作業日がありません' }));
      return;
    }

    // 候補日ごとの空き容量を出して、配置エンジンに丸ごと任せる
    const room = candidates.map((day) => Math.max(0, maxOf(day, state) - loads[day.iso]));
    const spread: Spread = ignoreLimit ? 'flow' : redistMode === 'early' ? 'early' : 'even';
    const slots = scheduleItems(planSegs, room, spread);
    planSegs.forEach((seg, segIndex) => {
      const slot = slots[segIndex];
      if (slot < 0) {
        unplaced.push({
          seg,
          reason: ignoreLimit ? 'GOAL前に作業日がありません' : '上限内に入る日がありません',
        });
        return;
      }
      const day = candidates[slot];
      loads[day.iso] += seg.min;
      moves.push({ seg, toIso: day.iso, warn: loads[day.iso] > maxOf(day, state) });
    });
  });

  return {
    moves,
    unplaced,
    loads,
    days,
    mode: redistMode,
    plan: redistPlan,
    includeManual: redistIncludeManual,
    ignoreLimit,
    lateDays: redistLateDays,
    lockedOverDays,
    targets,
  };
}

// ═══════════════════════════════════════════════════════════════
// 6. 再配分の適用 `applyRedist`（HTML:4189-4196 / spec §7.8）
// ═══════════════════════════════════════════════════════════════

/** `applyRedist` の純粋部分の戻り */
export interface RedistApplyResult {
  /** `moves.length > 0` だったか。false のとき `segs` は入力そのまま */
  applied: boolean;
  /** 書き換え後の `state.segs`（`day` だけ差し替え。**`manualDay` は付けない**） */
  segs: Seg[];
  /** `toIso === TODAY` になった seg の id。呼び出し側が `addToOrder` する（move 順） */
  orderAdditions: string[];
  /** `showToast` に渡す文言 */
  toast: string;
}

/**
 * `applyRedist`（HTML:4189-4196）の純粋部分。
 *
 * > **Q15 の注意**: レガシーはモーダル表示中の `pv` ではなく**押下時に `computePreview` を
 * > 再実行**した結果を適用する（表示中に `wkMax` を変えるとプレビューと違う結果になる）。
 * > その再実行は呼び出し側（コンポーネント）の責務。ここは「渡された preview を適用する」だけ。
 *
 * 適用は `day` の書き換えのみで **`manualDay` は付けない**ため、次の再配分でも動かせる。
 */
export function applyRedist(
  segs: readonly Seg[],
  pv: RedistPreview,
  today: ISODate,
): RedistApplyResult {
  if (!pv.moves.length) {
    return {
      applied: false,
      segs: segs.slice(),
      orderAdditions: [],
      toast: '再配分できる未完了タスクはありません',
    };
  }
  const nextSegs = segs.map((x) => {
    const mv = pv.moves.find((m) => m.seg.id === x.id);
    return mv ? Object.assign({}, x, { day: mv.toIso }) : x;
  });
  const orderAdditions: string[] = [];
  pv.moves.forEach((m) => {
    if (m.toIso === today) orderAdditions.push(m.seg.id);
  });
  return { applied: true, segs: nextSegs, orderAdditions, toast: redistToast(pv) };
}

/**
 * 再配分完了トースト（HTML:4195）。
 * `'全体を' | 'この計画を'` + `'上限を無視して均等に' | '上限内で'` + `'再配分しました(N件[・未配置M件])'`
 */
export function redistToast(pv: RedistPreview): string {
  return (
    (pv.plan === 'all' ? '全体を' : 'この計画を') +
    (pv.ignoreLimit ? '上限を無視して均等に' : '上限内で') +
    '再配分しました(' +
    pv.moves.length +
    '件' +
    (pv.unplaced.length ? '・未配置' + pv.unplaced.length + '件' : '') +
    ')'
  );
}

// ═══════════════════════════════════════════════════════════════
// 7. 計画作成時の初期配置（HTML:3722-3739 / spec §7.3・§11-Q11）
// ═══════════════════════════════════════════════════════════════

/** `submitAdd` の `list` 要素（= `addMinis` の1件、またはダミー1件） */
export interface MiniDraft {
  title: string;
  size: SizeKey;
  min: number;
}

/** `computeInitialPlacement` の入力 */
export interface InitialPlacementInput {
  /** **新しい計画を含んだ** PLANS（レガシーは `PLANS[uid] = {...}` の代入後に呼ぶ, HTML:3723-3726） */
  plans: Plans;
  segs: readonly Seg[];
  extras: readonly Extra[];
  reviews: readonly Review[];
  limits: LoadLimits;
  ctx: DateContext;
  /** 計画開始日（`resolvePlanStart` の結果） */
  start: ISODate;
  /** GOAL 日。候補日は `iso < due` なので**当日は除外** */
  due: ISODate;
  /** 配置するミニタスク（0件なら呼び出し側がダミー1件を入れる） */
  list: readonly MiniDraft[];
  /**
   * **`addMinis` の件数**（`list` の件数ではない）。
   * spec Q11: レガシーは `minis.length ? scheduleItems(...) : []` なので、ユーザーがミニタスクを
   * 1つも入れなかった計画のダミー「内容を細分化する」は**必ず未配分**になる。
   */
  minisCount: number;
}

/** `computeInitialPlacement` の戻り */
export interface InitialPlacementResult {
  /** 候補日（`start <= iso < due`） */
  days: DayInfo[];
  /** `scheduleItems` の戻り。**`minisCount === 0` なら空配列**（Q11） */
  slots: number[];
  /** `list` と同じ長さの配置日。置けなければ `''`（未配分） */
  dayOf: ISODateOrEmpty[];
}

/**
 * 計画作成時の初期配置（HTML:3724-3739）。
 * 再配分と**同じ `scheduleItems`** を使い、`even` 固定・GOAL当日は含めない。
 *
 * ```js
 * scheduleDays  = planTimelineDays(PLANS, segs).filter(d => d.iso >= start && d.iso < due)
 * scheduleLoads = loadsMap(planTimelineDays(PLANS, segs))   // ★ filter 前の全日で計算
 * scheduleRoom  = scheduleDays.map(d => Math.max(0, maxOf(d) - (scheduleLoads[d.iso] || 0)))
 * scheduleSlots = minis.length ? scheduleItems(list, scheduleRoom, 'even') : []
 * day           = (slot == null || slot < 0) ? '' : scheduleDays[slot].iso
 * ```
 * **初期配置は `manualDay` を付けない**ので直後の再配分の対象になる（spec §7.3 帰結）。
 */
export function computeInitialPlacement(input: InitialPlacementInput): InitialPlacementResult {
  const { plans, segs, ctx, limits, start, due, list, minisCount } = input;
  const timeline = planTimelineDays(plans, segs, ctx);
  const scheduleDays = timeline.filter((day) => day.iso >= start && day.iso < due);
  const scheduleLoads = loadsMap(
    planTimelineDays(plans, segs, ctx),
    { segs, extras: input.extras, reviews: input.reviews },
    ctx.today,
  );
  const scheduleRoom = scheduleDays.map((day) =>
    Math.max(0, maxOf(day, limits) - (scheduleLoads[day.iso] || 0)),
  );
  const slots = minisCount ? scheduleItems(list, scheduleRoom, 'even') : [];
  const dayOf: ISODateOrEmpty[] = list.map((_m, i) => {
    const slot = slots[i];
    if (slot == null || slot < 0) return '';
    return scheduleDays[slot].iso;
  });
  return { days: scheduleDays, slots, dayOf };
}

/**
 * `start` の決定（HTML:3722）。
 * `addDay2`（開始予定日）が「GOAL 以下 **かつ** 今日以降」のときだけ採用し、そうでなければ今日。
 */
export function resolvePlanStart(
  addDay2: ISODateOrEmpty | null | undefined,
  due: ISODate,
  today: ISODate,
): ISODate {
  return addDay2 && addDay2 <= due && addDay2 >= today ? addDay2 : today;
}
