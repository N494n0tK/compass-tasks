/**
 * Compass — データ画面の集計（レガシー `Compass App.dc.html` v0.9 の 1:1 移植）
 *
 * 出典:
 *  - HTML:3376-3382（`studyEntries` の組み立て）
 *  - HTML:3383-3401（週の起点 / `inDataRange` / 期間チップ / 期間ラベル）
 *  - HTML:3402-3413（`pieTotals` → `pieArcs` / `pieLegend`）
 *  - HTML:3414-3419（`dayMin` と学習ストリーク）
 *  - HTML:3420-3448（ヒートマップの定数・色・セル・月ラベル・曜日ラベル・凡例）
 *  - HTML:4308-4314（`pieTotalH` / `streakLabel` / `streakC` / `streakBd` / `heatVB`）
 *  - HTML:2913（`toH`）、3205-3211 と 4340-4343（復習の週次消化率）
 *  - spec §8.1 / §8.6 / §6.4「消化率の計算」/ パリティ C-312・C-313・C-538〜C-563
 *
 * 表示（SVG やクラス名）は components 側。ここは**数値と文字列の導出だけ**を持つ。
 * 教科の色は持たない（`subjects.ts` の表を呼び出し側で join する。循環 import を避けるため）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type {
  DataRange,
  Extra,
  ISODate,
  ISODateOrEmpty,
  Plans,
  Review,
  Seg,
  StudyLogEntry,
} from '../model/types';
import { fmtMD, isInWeek, isSameMonth, isoShift, mondayOf, monthLabel } from './dates';

// ─────────────────────────────────────────────────────────────
// 共通フォーマッタ
// ─────────────────────────────────────────────────────────────

/**
 * `toH(m)`（HTML:2913）— 分 → `'1.5h'`。**小数第1位まで**（`Math.round(m/6)/10`）。
 * レガシーでは `renderVals` 内のローカル関数で、ToDo サマリ・円グラフの両方が使う。
 */
export function toH(m: number): string {
  return Math.round(m / 6) / 10 + 'h';
}

// ─────────────────────────────────────────────────────────────
// 集計元（studyEntries）
// ─────────────────────────────────────────────────────────────

/** `studyEntries` の 1 要素（HTML:3379-3382） */
export interface StudyEntry {
  /** 日付を持たない完了タスクは `''`（`day || ''` で正規化される） */
  day: ISODateOrEmpty;
  subj: string;
  min: number;
}

/** `buildStudyEntries` が読む state の部分形 */
export interface StudyEntriesInput {
  studyLog: readonly StudyLogEntry[];
  segs: readonly Seg[];
  extras: readonly Extra[];
}

/**
 * 集計元を 1 本のリストにまとめる（HTML:3379-3382 / spec §8.1）。
 *
 * ```js
 * S.studyLog.forEach(e => studyEntries.push({ day: e.day || '', subj: e.subj, min: e.min }));
 * S.segs.forEach(s => { if (s.done && P[s.plan]) studyEntries.push({ day: s.day || '', subj: P[s.plan].subj, min: s.min }); });
 * S.extras.forEach(x => { if (x.done) studyEntries.push({ day: x.day || '', subj: x.subj, min: x.min }); });
 * ```
 *
 * 要点（順序も含めて 1:1）:
 * - **完了した復習（`completedAt`）は足さない**。`confirmAsk` が同じ分数を `studyLog` に
 *   書き込むので、足すと二重計上になる（v0.9 で明文化, spec §8.1 要点1）。
 * - **孤児 seg のガード**: `P[s.plan]` が無い seg は (v0.9 修正) スキップする（旧実装は
 *   `P[s.plan].subj` で TypeError になりえた, spec Q36）。
 * - `segs` / `extras` は「今 `done` であるもの」をライブに数える。チェックを外すと即座に消える。
 * - 並び順は studyLog → 完了 seg → 完了 extra。同分数のときの円グラフの並びと
 *   `studyLog` 限定教科の色採番順（spec Q35）がこの順序に依存する。
 */
export function buildStudyEntries(state: StudyEntriesInput, plans: Plans): StudyEntry[] {
  const out: StudyEntry[] = [];
  state.studyLog.forEach((e) => {
    out.push({ day: e.day || '', subj: e.subj, min: e.min });
  });
  state.segs.forEach((s) => {
    const p = plans[s.plan];
    if (s.done && p) out.push({ day: s.day || '', subj: p.subj, min: s.min });
  });
  state.extras.forEach((x) => {
    if (x.done) out.push({ day: x.day || '', subj: x.subj, min: x.min });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────
// 期間フィルタ（今週 / 今月 / 全期間）
// ─────────────────────────────────────────────────────────────

/** 期間チップの定義（HTML:3396、左から 今週 / 今月 / 全期間） */
export const DATA_RANGE_CHIPS: readonly { id: DataRange; label: string }[] = [
  { id: 'week', label: '今週' },
  { id: 'month', label: '今月' },
  { id: 'all', label: '全期間' },
];

/**
 * `const dataRange = (S.dataRange === 'week' || S.dataRange === 'month') ? S.dataRange : 'all'`
 * （HTML:3386）。未知の値・欠損はすべて `'all'` に丸める。
 */
export function normalizeDataRange(value: unknown): DataRange {
  return value === 'week' || value === 'month' ? value : 'all';
}

/**
 * `inDataRange(day)`（HTML:3388-3393）を作る。
 *
 * - `'all'` … 常に true（**日付を持たないエントリも数える**）
 * - `day` が空 … `'all'` 以外では常に false（未配分のまま完了した単発タスク等）
 * - `'month'` … `day.slice(0,7) === T.slice(0,7)`（暦月。直近30日ではない）
 * - `'week'` … `dataWeekStart <= day <= dataWeekEnd`（**月曜〜日曜**の 7 日枠）
 *
 * 週の起点は復習の消化率と同じ `-(getUTCDay()+6)%7` 式（`dates.mondayOf`）。
 * ただし消化率は「月曜〜**今日**」、こちらは「月曜〜**日曜**」（spec §8.6.2）。
 */
export function makeDataRangeFilter(
  range: DataRange,
  today: ISODate
): (day: string | null | undefined) => boolean {
  const weekStart = mondayOf(today);
  return (day) => {
    if (range === 'all') return true;
    if (!day) return false;
    if (range === 'month') return isSameMonth(day, today);
    return isInWeek(day, weekStart);
  };
}

/**
 * `dataRangeNote`（HTML:3400-3401）— 期間チップの右に出る小さなラベル。
 * 今週 `'8/3 〜 8/9'` / 今月 `'8月'` / 全期間 `'すべての記録'`。
 */
export function dataRangeNote(range: DataRange, today: ISODate): string {
  if (range === 'week') {
    const start = mondayOf(today);
    return fmtMD(start) + ' 〜 ' + fmtMD(isoShift(start, 6));
  }
  if (range === 'month') return monthLabel(today);
  return 'すべての記録';
}

// ─────────────────────────────────────────────────────────────
// 円グラフ（教科別 勉強時間）
// ─────────────────────────────────────────────────────────────

/**
 * 円弧 + 凡例の 1 行（レガシーは `pieArcs` と `pieLegend` の 2 本の並行配列だが、
 * 同じ順序・同じ要素数なので 1 本にまとめた。色 `c` / `bg` は `subjects.ts` の表から join する）。
 */
export interface PieSlice {
  name: string;
  min: number;
  /** 生のパーセント（0..100、丸めなし）。`dash` / `off` / `pctLabel` の元 */
  pct: number;
  /** `stroke-dasharray`。`pct.toFixed(2) + ' ' + (100 - pct).toFixed(2)` */
  dash: string;
  /** `stroke-dashoffset`。`(25 - 累積pct).toFixed(2)`（基準 25 = 12時方向スタート） */
  off: string;
  /** 凡例の時間表示 `toH(min)` */
  h: string;
  /** 凡例のパーセント表示 `Math.round(pct) + '%'` */
  pctLabel: string;
}

export interface PieResult {
  /** 教科 → 分。**キーの挿入順**は `studyEntries` の出現順（同値ソートの安定性に効く） */
  totals: Record<string, number>;
  /** 合計分数 */
  total: number;
  /** 中央に出る `toH(total)`（0 件なら `'0h'`） */
  totalH: string;
  /** 分数の**降順**。同値は `totals` の挿入順（`Array.prototype.sort` は安定） */
  slices: PieSlice[];
}

/**
 * `pieTotals` → `pieArcs` / `pieLegend`（HTML:3402-3413 / spec §8.1）。
 *
 * ```js
 * const pieTotal = Object.keys(pieTotals).reduce((a, k) => a + pieTotals[k], 0);
 * Object.keys(pieTotals).sort((a, b) => pieTotals[b] - pieTotals[a]).forEach(name => {
 *   const min = pieTotals[name], pct = pieTotal ? min / pieTotal * 100 : 0;
 *   pieArcs.push({ dash: pct.toFixed(2) + ' ' + (100 - pct).toFixed(2), off: (25 - pieCum).toFixed(2) });
 *   pieLegend.push({ name, h: toH(min), pct: Math.round(pct) + '%' });
 *   pieCum += pct;
 * });
 * ```
 *
 * - 集計は**プレーンオブジェクト**で行う（`Map` に替えると整数風キーの並び順が変わる）。
 * - `pieTotal === 0` のとき `pct` は 0（0除算しない）。
 * - `pieCum` は**丸める前の pct** を累積する（`off` の 0.01 単位のズレまで一致させるため）。
 */
export function computePie(
  entries: readonly StudyEntry[],
  inRange: (day: string) => boolean
): PieResult {
  const totals: Record<string, number> = {};
  entries.forEach((e) => {
    if (inRange(e.day)) totals[e.subj] = (totals[e.subj] || 0) + e.min;
  });
  const keys = Object.keys(totals);
  const total = keys.reduce((a, k) => a + totals[k], 0);
  const slices: PieSlice[] = [];
  let cum = 0;
  keys
    .slice()
    .sort((a, b) => totals[b] - totals[a])
    .forEach((name) => {
      const min = totals[name];
      const pct = total ? (min / total) * 100 : 0;
      slices.push({
        name,
        min,
        pct,
        dash: pct.toFixed(2) + ' ' + (100 - pct).toFixed(2),
        off: (25 - cum).toFixed(2),
        h: toH(min),
        pctLabel: Math.round(pct) + '%',
      });
      cum += pct;
    });
  return { totals, total, totalH: toH(total), slices };
}

/**
 * 全期間の円グラフに出る教科名を並び順どおりに返す。
 * **`studyLog` 限定教科の色採番順**（spec Q35 / `subjects.ts` の `studySubjects`）がこれ。
 */
export function allTimeSubjectOrder(entries: readonly StudyEntry[]): string[] {
  return computePie(entries, () => true).slices.map((s) => s.name);
}

// ─────────────────────────────────────────────────────────────
// 学習ストリーク
// ─────────────────────────────────────────────────────────────

/**
 * `dayMin`（HTML:3415-3416）— 日付 → その日の合計分。
 * **期間フィルタは掛からない**（ストリーク・ヒートマップは常に全期間, spec §8.6 / C-543）。
 * 空日付のエントリは除外。`min` は `Number(e.min) || 0` で防御する（レガシーどおり）。
 */
export function computeDayMinutes(entries: readonly StudyEntry[]): Record<ISODate, number> {
  const dayMin: Record<ISODate, number> = {};
  entries.forEach((e) => {
    if (e.day) dayMin[e.day] = (dayMin[e.day] || 0) + (Number(e.min) || 0);
  });
  return dayMin;
}

/** ループ上限（HTML:3419、無限ループ防止） */
export const STREAK_MAX_DAYS = 3650;

/**
 * 学習ストリーク（HTML:3417-3419 / spec §8.6.3 / C-548）。
 *
 * ```js
 * let streakDays = 0, streakCursor = dayMin[T] > 0 ? T : this.isoShift(T, -1);
 * while (streakDays < 3650 && dayMin[streakCursor] > 0) { streakDays++; streakCursor = this.isoShift(streakCursor, -1); }
 * ```
 *
 * - 数えるのは「その日に **1 分以上**やったか」だけ（教科・種別は無関係）。
 * - **今日がまだ 0 分でも昨日までの連続は途切れない**（起点が `今日 or 昨日`）。
 * - 起点の日が 0 分なら 0 日（＝今日も昨日も 0 分なら記録なし扱い）。
 */
export function computeStreak(dayMin: Readonly<Record<ISODate, number>>, today: ISODate): number {
  let days = 0;
  let cursor = dayMin[today] > 0 ? today : isoShift(today, -1);
  while (days < STREAK_MAX_DAYS && dayMin[cursor] > 0) {
    days++;
    cursor = isoShift(cursor, -1);
  }
  return days;
}

/** ストリークピルの表示値（HTML:4310-4312 / C-547） */
export interface StreakView {
  days: number;
  label: string;
  /** 文字色 */
  color: string;
  /** 枠線色 */
  border: string;
}

/** `streakLabel` / `streakC` / `streakBd`（HTML:4310-4312） */
export function streakView(days: number): StreakView {
  return {
    days,
    label: days > 0 ? '🔥 連続' + days + '日' : 'まだ連続記録はありません',
    color: days > 0 ? 'var(--org)' : 'var(--tx3)',
    border: days > 0 ? 'color-mix(in srgb, var(--org) 40%, var(--line))' : 'var(--line)',
  };
}

// ─────────────────────────────────────────────────────────────
// 日別ヒートマップ
// ─────────────────────────────────────────────────────────────

/** HTML:3420 の定数（`HEAT_WEEKS` ほか） */
export const HEAT = {
  WEEKS: 15,
  CELL: 12,
  PITCH: 15,
  PAD: 18,
  TOP: 12,
} as const;

/**
 * 濃さのバケット（**絶対値**。ユーザーごとの相対値ではない, spec §8.6.4 / C-550）。
 * `future`（未来日） / `none`（0分） / `low`（1-29） / `mid`（30-59） / `high`（60-119） / `max`（120+）
 */
export type HeatLevel = 'future' | 'none' | 'low' | 'mid' | 'high' | 'max';

/** `heatFill` の分岐だけを取り出したもの（HTML:3421-3428） */
export function heatLevel(min: number, future: boolean): HeatLevel {
  if (future) return 'future';
  if (!min) return 'none';
  if (min < 30) return 'low';
  if (min < 60) return 'mid';
  if (min < 120) return 'high';
  return 'max';
}

/** レベル → `fill` 文字列（HTML:3421-3428。3テーマとも `color-mix` で成立する） */
export const HEAT_FILL: Readonly<Record<HeatLevel, string>> = {
  future: 'color-mix(in srgb, var(--tx3) 6%, transparent)',
  none: 'color-mix(in srgb, var(--tx3) 14%, transparent)',
  low: 'color-mix(in srgb, var(--acc) 22%, var(--bg2))',
  mid: 'color-mix(in srgb, var(--acc) 45%, var(--bg2))',
  high: 'color-mix(in srgb, var(--acc) 70%, var(--bg2))',
  max: 'var(--acc)',
};

/** `heatFill(m, future)`（HTML:3421-3428） */
export function heatFill(min: number, future: boolean): string {
  return HEAT_FILL[heatLevel(min, future)];
}

/** 1 マス（HTML:3436-3441） */
export interface HeatCell {
  x: number;
  y: number;
  iso: ISODate;
  min: number;
  future: boolean;
  fill: string;
  /** `<title>` の文言。`'8/5 · 45分'` / 未来日は `'8/5'` だけ */
  tip: string;
}

/** 月ラベル（HTML:3434） */
export interface HeatMonth {
  x: number;
  /** `'8月'` */
  label: string;
}

/** 行ラベル 月/水/金（HTML:3444-3445） */
export interface HeatDow {
  y: number;
  label: string;
}

export interface Heatmap {
  /** 15列×7行 = 105 マス。列 = 週（左が最古・右端が今週）、行 = 月曜が上・日曜が下 */
  cells: HeatCell[];
  months: HeatMonth[];
  dows: HeatDow[];
  /** 凡例 5 段（0/20/45/90/150 分の色） */
  legend: string[];
  /** `'0 0 240 114'` */
  viewBox: string;
}

/** 凡例に使う分数（HTML:3448） */
export const HEAT_LEGEND_MINUTES: readonly number[] = [0, 20, 45, 90, 150];

/**
 * ヒートマップ（HTML:3429-3448, 4314 / spec §8.6.4 / C-550〜C-552）。
 *
 * - 列の月曜は `isoShift(dataWeekStart, (w - 14) * 7)` ＝ **右端の列が今週**。
 * - 月ラベルはその列の月曜が 1〜7 日のときだけ（ラベル同士が必ず 4 列以上離れる）。
 * - `viewBox` = `'0 0 ' + (PAD + WEEKS*PITCH - (PITCH - CELL)) + ' ' + (TOP + 7*PITCH - (PITCH - CELL))`。
 * - 行ラベルの y は `TOP + i*PITCH + CELL - 3`（月=21 / 水=51 / 金=81）。
 *
 * > レガシーの `svgText = (s) => [s]`（配列で渡して `<span>` 包みを避ける回避策）は
 * > support.js のテンプレート事情なので移植しない（React は素のテキストノードを出す）。
 */
export function buildHeatmap(
  dayMin: Readonly<Record<ISODate, number>>,
  today: ISODate
): Heatmap {
  const weekStart = mondayOf(today);
  const cells: HeatCell[] = [];
  const months: HeatMonth[] = [];
  for (let w = 0; w < HEAT.WEEKS; w++) {
    const colX = HEAT.PAD + w * HEAT.PITCH;
    const colMon = isoShift(weekStart, (w - (HEAT.WEEKS - 1)) * 7);
    if (parseInt(colMon.slice(8, 10), 10) <= 7) months.push({ x: colX, label: monthLabel(colMon) });
    for (let d = 0; d < 7; d++) {
      const iso = isoShift(colMon, d);
      const future = iso > today;
      const min = dayMin[iso] || 0;
      cells.push({
        x: colX,
        y: HEAT.TOP + d * HEAT.PITCH,
        iso,
        min,
        future,
        fill: heatFill(min, future),
        tip: future ? fmtMD(iso) : fmtMD(iso) + ' · ' + min + '分',
      });
    }
  }
  const dows: HeatDow[] = [
    { i: 0, label: '月' },
    { i: 2, label: '水' },
    { i: 4, label: '金' },
  ].map((r) => ({ y: HEAT.TOP + r.i * HEAT.PITCH + HEAT.CELL - 3, label: r.label }));
  return {
    cells,
    months,
    dows,
    legend: HEAT_LEGEND_MINUTES.map((m) => heatFill(m, false)),
    viewBox:
      '0 0 ' +
      (HEAT.PAD + HEAT.WEEKS * HEAT.PITCH - (HEAT.PITCH - HEAT.CELL)) +
      ' ' +
      (HEAT.TOP + 7 * HEAT.PITCH - (HEAT.PITCH - HEAT.CELL)),
  };
}

// ─────────────────────────────────────────────────────────────
// 復習の週次消化率
// ─────────────────────────────────────────────────────────────

/** 消化率の表示値（HTML:4340-4343 / spec §6.4 / C-312・C-313） */
export interface WeekRate {
  /** 対象（分母）が 1 件以上あるか。`weekRateAvailable` */
  available: boolean;
  /** 分子: 対象のうち `done === true` の件数 */
  done: number;
  /** 分母: 今週の月曜〜今日に `due` がある復習の全件 */
  total: number;
  /** `Math.round(done / total * 100)`。対象0件なら null */
  rate: number | null;
  /** `weekRateLabel` — `'67'` / 対象0件なら `'–'`（U+2013） */
  label: string;
  /** `weekRateSuffix` — `'%'` / 対象0件なら `''` */
  suffix: string;
  /** `weekRateMeta` — `'2/3件'` / 対象0件なら `'今週は対象なし'` */
  meta: string;
}

/**
 * 復習の週次消化率（HTML:3206-3211, 4340-4343 / spec §6.4）。
 * Review 画面のカード3（HTML:1510）と Cockpit のフッター（1011）の 2 箇所に出る。
 *
 * ```js
 * const weekStart = this.isoShift(T, -((todayDow + 6) % 7));      // その週の月曜
 * const weekReviews = S.reviews.filter(r => r.due >= weekStart && r.due <= T);
 * const weekDone = weekReviews.filter(r => r.done).length;
 * ```
 *
 * - 分母は **`due` が「今週の月曜〜今日」に入る復習の全件**。完了/未完了・`added` は問わない。
 *   **未来分（明日以降）は含めない**（データ画面の「今週」が日曜までなのと違う）。
 * - 分子は `done === true` の件数。`completedAt` は判定に使わない。
 * - `weekRateAvailable` はテンプレート未参照だが、3つの表示値の分岐に使うので保持する。
 */
export function computeWeekRate(
  reviews: readonly Pick<Review, 'due' | 'done'>[],
  today: ISODate
): WeekRate {
  const weekStart = mondayOf(today);
  const target = reviews.filter((r) => r.due >= weekStart && r.due <= today);
  const done = target.filter((r) => r.done).length;
  const total = target.length;
  const available = total > 0;
  const rate = available ? Math.round((done / total) * 100) : null;
  return {
    available,
    done,
    total,
    rate,
    label: available ? String(rate) : '–',
    suffix: available ? '%' : '',
    meta: available ? done + '/' + total + '件' : '今週は対象なし',
  };
}

// ─────────────────────────────────────────────────────────────
// データ画面ぶんの一括集計
// ─────────────────────────────────────────────────────────────

export interface DataScreenInput extends StudyEntriesInput {
  /** `state.dataRange`（非永続。未知の値は `'all'` に丸める） */
  dataRange?: unknown;
}

export interface DataScreenResult {
  entries: StudyEntry[];
  range: DataRange;
  /** その週の月曜（ヒートマップの右端列でもある） */
  weekStart: ISODate;
  /** その週の日曜 */
  weekEnd: ISODate;
  /** `dataRangeNote` */
  rangeNote: string;
  /** 期間フィルタ（円グラフ・凡例にだけ掛かる） */
  inRange: (day: string | null | undefined) => boolean;
  pie: PieResult;
  /** 日付 → 合計分（全期間） */
  dayMinutes: Record<ISODate, number>;
  streak: StreakView;
  heatmap: Heatmap;
  /** `subjects.ts` の `subjectAppearanceOrder({ studySubjects })` にそのまま渡す */
  allTimeSubjects: string[];
}

/**
 * データ画面 1 回ぶんの集計をまとめて行う（HTML:3376-3448 の順序どおり）。
 * 期間フィルタが掛かるのは**円グラフと凡例だけ**で、ストリーク・ヒートマップ・
 * エクスポートは常に全期間（spec §8.6 / C-543）。
 */
export function aggregateData(
  input: DataScreenInput,
  plans: Plans,
  today: ISODate
): DataScreenResult {
  const entries = buildStudyEntries(input, plans);
  const range = normalizeDataRange(input.dataRange);
  const weekStart = mondayOf(today);
  const inRange = makeDataRangeFilter(range, today);
  const pie = computePie(entries, inRange);
  const dayMinutes = computeDayMinutes(entries);
  return {
    entries,
    range,
    weekStart,
    weekEnd: isoShift(weekStart, 6),
    rangeNote: dataRangeNote(range, today),
    inRange,
    pie,
    dayMinutes,
    streak: streakView(computeStreak(dayMinutes, today)),
    heatmap: buildHeatmap(dayMinutes, today),
    allTimeSubjects: range === 'all' ? pie.slices.map((s) => s.name) : allTimeSubjectOrder(entries),
  };
}
