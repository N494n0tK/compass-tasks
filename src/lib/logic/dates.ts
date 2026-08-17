/**
 * Compass — 日付ヘルパ（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * 出典: HTML:1996-2010（`todayStr` / `_base` / `isoAt` / `fmtMD` / `dowOf` / `DAYS` / `TODAY` /
 * `YESTERDAY` / `DIDX`）、2061-2062（`isoShift` / `daysUntil`）、2504-2511（`dayLabel`）、
 * 2513-2528（`planTimelineDays`）、3205-3206 と 3383-3385（月曜始まりの週）、3391（今月判定）、
 * 3253-3259（Review 表専用の `fmtD`）、3556-3559（時間割の月曜/表示日）。
 * spec §4.12。
 *
 * ## タイムゾーンの扱い（レガシーと同一）
 * - 「今日」の決定だけ **Asia/Tokyo 固定**（`Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo'})`）。
 *   en-CA は `YYYY-MM-DD` を返すのでそのまま日付キーに使える。
 * - それ以降の日付演算は**すべて UTC**（`iso + 'T00:00:00Z'` → `getTime() ± n*86400000`）。
 *   実行環境のローカルタイムゾーンに依存しないため、DST のある地域でも 1 日ズレない。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Dow, ISODate } from '../model/types';

/** `DOW`（HTML:2002） */
export const DOW: readonly Dow[] = ['日', '月', '火', '水', '木', '金', '土'];

const DAY_MS = 86400000;

/** レガシー `this.DAYS[i]` の要素（HTML:2004-2007） */
export interface DayInfo {
  iso: ISODate;
  dow: Dow;
  /** 日にちだけの表示用ラベル（`String(parseInt(iso.slice(8,10),10))` → `'5'`） */
  label: string;
  weekend: boolean;
  idx: number;
}

/**
 * 「今日」を起点にした日付コンテキスト。
 * レガシーではコンストラクタで `this._base` / `this.DAYS` / `this.TODAY` / `this.DIDX` /
 * `this.YESTERDAY` として固定され、日付が変わっても再計算されなかった（HTML:1996-2010）。
 *
 * ここでは**時計が勝手に進めることはしない**（レンダー中に値が変わると描画がちぐはぐになる）が、
 * `createDateContext()` が返す実物は `rollover()` で**明示的に**次の日へ進められる
 * （`LiveDateContext`）。`dateContextFor()` が返すものは純粋なスナップショット。
 */
export interface DateContext {
  /** `this.TODAY`（= `DAYS[0].iso`） */
  today: ISODate;
  /** `this.YESTERDAY`（= `isoAt(-1)`） */
  yesterday: ISODate;
  /** `DAYS[1].iso`。Review 表の `fmtD` / `statusOf` / Add のチップが参照（HTML:3252） */
  tomorrow: ISODate;
  /** `this._base.getTime()`（今日 00:00:00 UTC のミリ秒） */
  base: number;
  /** `this.DAYS` — 今日..+12 の 13 日分 */
  days: readonly DayInfo[];
  /** `this.DIDX` — iso → 0..12。範囲外は `undefined` */
  didx: Readonly<Record<ISODate, number>>;
}

// ─────────────────────────────────────────────────────────────
// プリミティブ（コンテキスト非依存）
// ─────────────────────────────────────────────────────────────

/** `iso + 'T00:00:00Z'` の epoch ms。レガシーのすべての日付演算の起点 */
export function isoToUtcMs(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getTime();
}

/** epoch ms → `'YYYY-MM-DD'`（`toISOString().slice(0,10)`） */
export function utcMsToIso(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 実際の「今日」（日本時間）を `'YYYY-MM-DD'` で返す。HTML:1998。
 * @param now テスト用の注入ポイント。既定は現在時刻。
 */
export function todayISO(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `this.isoShift(iso, n)`（HTML:2061）— iso から n 日ずらした iso */
export function isoShift(iso: string, n: number): ISODate {
  return utcMsToIso(isoToUtcMs(iso) + n * DAY_MS);
}

/** `this.fmtMD(iso)`（HTML:2001）— `'2026-08-05'` → `'8/5'`（ゼロ埋めなし） */
export function fmtMD(iso: string): string {
  return parseInt(iso.slice(5, 7), 10) + '/' + parseInt(iso.slice(8, 10), 10);
}

/** `this.dowOf(iso)`（HTML:2003）— iso → `'日'..'土'` */
export function dowOf(iso: string): Dow {
  return DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
}

/** `iso` が土日か（`DAYS[].weekend` と同じ判定, HTML:2006） */
export function isWeekend(iso: string): boolean {
  const dow = dowOf(iso);
  return dow === '土' || dow === '日';
}

/** `DAYS[]` 1 要素ぶんの組み立て（HTML:2005-2006 / 2525-2526 と同一式） */
function makeDay(iso: ISODate, idx: number): DayInfo {
  const dow = dowOf(iso);
  return {
    iso,
    dow,
    label: String(parseInt(iso.slice(8, 10), 10)),
    weekend: dow === '土' || dow === '日',
    idx,
  };
}

/**
 * `today` を 0 日目として `count` 日ぶんの `DayInfo[]` を作る。
 * レガシーの `this.DAYS`（count=13, HTML:2004）と `planTimelineDays` の戻り（2524-2527）は
 * 同じ式なので、この 1 関数でどちらも賄える。
 */
export function buildDays(today: ISODate, count = 13): DayInfo[] {
  const base = isoToUtcMs(today);
  const out: DayInfo[] = [];
  for (let i = 0; i < count; i++) out.push(makeDay(utcMsToIso(base + i * DAY_MS), i));
  return out;
}

/** `this.DIDX`（HTML:2010）— iso → index */
export function buildDIDX(days: readonly DayInfo[]): Record<ISODate, number> {
  const didx: Record<ISODate, number> = {};
  days.forEach((d, i) => {
    didx[d.iso] = i;
  });
  return didx;
}

// ─────────────────────────────────────────────────────────────
// DateContext
// ─────────────────────────────────────────────────────────────

/** 任意の「今日」から `DateContext` を組み立てる（純関数・テスト用） */
export function dateContextFor(today: ISODate): DateContext {
  const base = isoToUtcMs(today);
  const days = buildDays(today, 13);
  return {
    today: days[0].iso,
    yesterday: utcMsToIso(base - DAY_MS),
    tomorrow: days[1].iso,
    base,
    days,
    didx: buildDIDX(days),
  };
}

/**
 * 実時刻から作った、**日付をまたいだら進められる** `DateContext`。
 * アプリ全体が `import` した1個の参照を共有するので（`components/useStore.ts` の `dateCtx`）、
 * 日付が変わったときに**オブジェクトを差し替えずに中身だけ**入れ替える必要がある。
 */
export interface LiveDateContext extends DateContext {
  /**
   * 実時刻の「今日」が `this.today` と違えば、`today` と派生フィールドを進めて `true` を返す。
   * 同じ日なら何もせず `false`。**オブジェクトの同一性は保つ**ので、
   * すでに `import` / props で配られている参照もそのまま新しい値を見る。
   *
   * @param now テスト用の注入ポイント。既定は現在時刻。
   */
  rollover(now?: Date): boolean;
}

/**
 * 実時刻（Asia/Tokyo）から `DateContext` を作る。レガシー constructor 相当（HTML:1998-2010）。
 * レガシーと違い、`rollover()` を呼べば日付の変化に追従できる（plan.md §4.1）。
 */
export function createDateContext(now: Date = new Date()): LiveDateContext {
  const ctx: LiveDateContext = {
    ...dateContextFor(todayISO(now)),
    rollover(at: Date = new Date()): boolean {
      const next = todayISO(at);
      if (next === ctx.today) return false;
      // 参照を保ったまま中身だけ入れ替える（新しいオブジェクトを返すと、
      // すでに配られている `dateCtx` が古いままになってしまう）
      Object.assign(ctx, dateContextFor(next));
      return true;
    },
  };
  return ctx;
}

/** `this.isoAt(n)`（HTML:2000）— 今日から n 日後（負値可） */
export function isoAt(ctx: DateContext, n: number): ISODate {
  return utcMsToIso(ctx.base + n * DAY_MS);
}

/**
 * `this.daysUntil(iso)`（HTML:2062）— 今日から iso までの日数。
 * `Math.round` なので UTC 固定演算では常に整数。過去日は負。
 */
export function daysUntil(ctx: DateContext, iso: string): number {
  return Math.round((isoToUtcMs(iso) - ctx.base) / DAY_MS);
}

// ─────────────────────────────────────────────────────────────
// ラベル
// ─────────────────────────────────────────────────────────────

/**
 * `dayLabel(iso)`（HTML:2504-2511）— Cockpit / Tests / Add / トースト用。
 *
 * `''` → `'未配分'` / 今日 → `'今日'` / DIDX===1 → `'明日'` /
 * DIDX に無い → `fmtMD + (iso < today ? '(期限切れ)' : '')` / それ以外 → `fmtMD + '(' + dow + ')'`
 *
 * > 注: 判定順はレガシーどおり「未配分 → 今日 → 明日 → DIDX 外 → DIDX 内」。
 * > `i === 1` の比較は `DIDX` の値であって `daysUntil` ではない。
 */
export function dayLabel(ctx: DateContext, iso: string | null | undefined): string {
  if (!iso) return '未配分';
  const i = ctx.didx[iso];
  if (iso === ctx.today) return '今日';
  if (i === 1) return '明日';
  if (i == null) return fmtMD(iso) + (iso < ctx.today ? '(期限切れ)' : '');
  return fmtMD(iso) + '(' + ctx.days[i].dow + ')';
}

/**
 * `fmtD(iso)`（HTML:3253-3259）— **Review 表・復習詳細ドロワー専用の別関数**。
 * `dayLabel` とは違い `'(期限切れ)'` も曜日も付かず、昨日だけ特別扱いする。
 */
export function fmtD(ctx: DateContext, iso: string | null | undefined): string {
  if (!iso) return '–';
  if (iso === ctx.today) return '今日';
  if (iso === ctx.tomorrow) return '明日';
  if (iso === ctx.yesterday) return '昨日';
  return fmtMD(iso);
}

// ─────────────────────────────────────────────────────────────
// 週（月曜始まり）
// ─────────────────────────────────────────────────────────────

/**
 * その日を含む週の**月曜**を返す。
 *
 * レガシーには同じ意味の式が 3 か所ある:
 * - 復習の消化率  `isoShift(T, -((todayDow + 6) % 7))`（HTML:3205-3206）
 * - データ画面の今週 `isoShift(T, -((getUTCDay() + 6) % 7))`（HTML:3384）
 * - Add の時間割    `isoShift(d, dow === 0 ? -6 : 1 - dow)`（HTML:3558）
 *
 * 3 式は全 dow で同値（dow=0 → -6、dow=k(1..6) → 1-k）なのでこの 1 関数に集約する。
 */
export function mondayOf(iso: ISODate): ISODate {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return isoShift(iso, -((dow + 6) % 7));
}

/** 週の起点（月曜）。消化率・データ画面の「今週」で使う別名 */
export const weekStartOf = mondayOf;

/** 週の終端（日曜）= 月曜 + 6（HTML:3385 `dataWeekEnd`） */
export function weekEndOf(iso: ISODate): ISODate {
  return isoShift(mondayOf(iso), 6);
}

/** `{ start: 月, end: 日 }`（データ画面の `dataWeekStart` / `dataWeekEnd`） */
export function weekRangeOf(iso: ISODate): { start: ISODate; end: ISODate } {
  const start = mondayOf(iso);
  return { start, end: isoShift(start, 6) };
}

/** `day` がその週（月〜日）に入るか。データ画面 `inDataRange` の week 分岐（HTML:3392） */
export function isInWeek(day: string, weekStart: ISODate): boolean {
  return day >= weekStart && day <= isoShift(weekStart, 6);
}

/**
 * Add 画面の時間割が表示する日（HTML:3556-3559）。
 * 平日（月〜金）はその日、土日はその週の月曜。`dayOverrides` の読み書きキーでもある。
 */
export function scheduleDateOf(iso: ISODate): ISODate {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return dow >= 1 && dow <= 5 ? iso : mondayOf(iso);
}

// ─────────────────────────────────────────────────────────────
// 月（データ画面「今月」）
// ─────────────────────────────────────────────────────────────

/** `'YYYY-MM'`（HTML:3391 の `slice(0, 7)`） */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `day` が `iso` と同じ月か。データ画面 `inDataRange` の month 分岐（HTML:3391） */
export function isSameMonth(day: string, iso: string): boolean {
  return day.slice(0, 7) === iso.slice(0, 7);
}

/** `'8月'`（HTML:3400 の `dataRangeNote` / 3437 のヒートマップ月ラベル） */
export function monthLabel(iso: string): string {
  return parseInt(iso.slice(5, 7), 10) + '月';
}

/** `'8月5日(水)'`（HTML:4131 `todayHeader`） */
export function longDayLabel(iso: string): string {
  return (
    parseInt(iso.slice(5, 7), 10) + '月' + parseInt(iso.slice(8, 10), 10) + '日(' + dowOf(iso) + ')'
  );
}
