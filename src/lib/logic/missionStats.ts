/**
 * Compass — デイリーミッションの継続を数える（データ画面のカレンダー）
 *
 * 仕様: docs/daily-mission/plan.md §4.3「ミッション継続の可視化」（段階導入 §3.6 の v3）。
 *
 * 連続日数（🔥）は「今どれだけ続いているか」しか言わない。途切れた回数も、そもそも
 * 週に何日やっているのかも見えないので、**続いていない事実**が記録に残らない。ここは
 * その 1 段深いところ ―― 直近 4 週を 28 マスで出して、抜けた日を抜けたまま見せる。
 *
 * ## 保存しない
 *
 * 達成率もカレンダーも state には持たない。完了した生成 Extra（id が `dm-{missionId}-{YYYYMMDD}`）
 * から毎回引き直す（`missionAutogen` の連続日数と同じ方針）。保存しないので、あとから
 * 台帳の曜日を変えても過去の見え方が壊れない。
 *
 * ## 台帳が基準
 *
 * 数えるのは**台帳（`state.missions`）に居るミッションだけ**。ミッションを消しても完了
 * Extra は履歴として残る設計なので、id だけを頼りに集計すると「もうやめた習慣」の
 * カレンダーが永久に居座る。台帳から消えたら画面からも消えるのが素直。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Extra, ISODate, Mission } from '../model/types';
import { fmtMD, isoShift, mondayOf } from './dates';
import { isMissionDay, missionDoneDays, missionStreakFrom } from './missionAutogen';

/** 出す週数。4 週 = 28 マスで「今月ぶんの習慣」がちょうど一目に入る */
export const MISSION_CALENDAR_WEEKS = 4;

/**
 * 1 マスの状態。
 *
 * - `done`   … その日ぶんを完了した
 * - `missed` … 実施日なのに完了していない（**これが見えることに価値がある**）
 * - `off`    … `dows` の外（やらなくてよい日）
 * - `future` … 今日より後
 * - `before` … ミッションを作る前（`mission.createdAt` より前）
 */
export type MissionDayState = 'done' | 'missed' | 'off' | 'future' | 'before';

/** ツールチップの文言。`buildHeatmap` の `tip` と同じく、表示文字列もロジック側で作る */
export const MISSION_DAY_LABEL: Readonly<Record<MissionDayState, string>> = {
  done: '完了',
  missed: '未完了',
  off: '対象外',
  future: '',
  before: '',
};

export interface MissionCalendarCell {
  iso: ISODate;
  state: MissionDayState;
  /** `'8/5 · 完了'`。予定の無い日（future / before）は `'8/5'` だけ */
  tip: string;
}

export interface MissionCalendar {
  /**
   * **古い週が先頭**。各週は月曜→日曜の 7 マス（`buildHeatmap` と同じ月曜始まり・
   * 最後が今週）。ヒートマップは列＝週だが、こちらは 7 マス幅に畳みたいので行＝週にしてある。
   */
  weeks: MissionCalendarCell[][];
  /** 左上のマス（いちばん古い月曜） */
  from: ISODate;
  /** 右下のマス（今週の日曜） */
  to: ISODate;
}

/**
 * 1 マスの状態を決める。判定順がそのまま優先順位:
 *
 * 1. 今日より後は、やりようがないので `future`
 * 2. 作る前も同じく `before`（曜日が合っていても「やらなかった日」ではない）
 * 3. 完了は完了（曜日をあとから変えても、やった記録は消さない ―― 連続日数と同じ扱い）
 * 4. `dows` の外なら `off`
 * 5. 残りが `missed`
 */
function cellStateOf(
  mission: Pick<Mission, 'dows' | 'createdAt'>,
  doneDays: Set<ISODate> | undefined,
  iso: ISODate,
  today: ISODate
): MissionDayState {
  if (iso > today) return 'future';
  // `createdAt` が空の古いデータは「ずっと前からある」扱いになる（`iso < ''` は常に false）
  if (iso < mission.createdAt) return 'before';
  if (doneDays && doneDays.has(iso)) return 'done';
  if (!isMissionDay(mission, iso)) return 'off';
  return 'missed';
}

/** `doneDays` を外から渡す版（一覧で索引を使い回すため） */
function calendarFrom(
  mission: Pick<Mission, 'dows' | 'createdAt'>,
  doneDays: Set<ISODate> | undefined,
  today: ISODate,
  weeks: number
): MissionCalendar {
  const count = Math.max(1, Math.floor(weeks) || 0);
  const weekStart = mondayOf(today);
  const out: MissionCalendarCell[][] = [];
  for (let w = 0; w < count; w += 1) {
    // 最後の行が今週になるように遡る（`buildHeatmap` の `(w - (WEEKS - 1)) * 7` と同じ式）
    const mon = isoShift(weekStart, (w - (count - 1)) * 7);
    const row: MissionCalendarCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const iso = isoShift(mon, d);
      const state = cellStateOf(mission, doneDays, iso, today);
      const label = MISSION_DAY_LABEL[state];
      row.push({ iso, state, tip: label ? fmtMD(iso) + ' · ' + label : fmtMD(iso) });
    }
    out.push(row);
  }
  return { weeks: out, from: out[0][0].iso, to: out[count - 1][6].iso };
}

/**
 * 達成率（0-100）をカレンダーのマスから数える。
 *
 * - 母数は「実施対象日」= `missed` のマス + `done` のマス。
 *   `off` / `future` / `before` は最初から対象外なので入らない。
 * - **今日の `missed` は母数に入れない**。まだやれる日を「落とした日」として数えると、
 *   朝いちばんに開いたときの達成率が毎日下がる（`computeStreak` が今日の未達で
 *   途切れないのと同じ気づかい）。
 * - `dows` の外にやった日（曜日をあとから変えた等）は `done` として母数にも分子にも入る。
 *   やった事実を消さない方を優先する。
 * - 対象が 0 日なら `null`（作りたてのミッションは「–」と出す。0% ではない）。
 */
function rateFrom(calendar: MissionCalendar, today: ISODate): number | null {
  let done = 0;
  let total = 0;
  calendar.weeks.forEach((week) => {
    week.forEach((cell) => {
      if (cell.state === 'done') {
        done += 1;
        total += 1;
      } else if (cell.state === 'missed' && cell.iso !== today) {
        total += 1;
      }
    });
  });
  return total ? Math.round((done / total) * 100) : null;
}

/** 1 つのミッションの直近 N 週のカレンダー */
export function buildMissionCalendar(
  mission: Pick<Mission, 'id' | 'dows' | 'createdAt'>,
  extras: readonly Extra[],
  today: ISODate,
  weeks: number = MISSION_CALENDAR_WEEKS
): MissionCalendar {
  return calendarFrom(mission, missionDoneDays(extras).get(mission.id), today, weeks);
}

/** 1 つのミッションの直近 N 週の達成率（0-100、対象 0 日なら `null`） */
export function missionRate(
  mission: Pick<Mission, 'id' | 'dows' | 'createdAt'>,
  extras: readonly Extra[],
  today: ISODate,
  weeks: number = MISSION_CALENDAR_WEEKS
): number | null {
  return rateFrom(buildMissionCalendar(mission, extras, today, weeks), today);
}

/** データ画面の 1 行ぶん */
export interface MissionStatRow {
  mission: Mission;
  /** `missionStreak` と同じ値 */
  streak: number;
  /** `missionRate` と同じ値。対象 0 日なら `null` */
  rate: number | null;
  /** 表示用ラベル。`'80%'` / 対象 0 日なら `'–'`（U+2013、`computeWeekRate` と同じ記号） */
  rateLabel: string;
  calendar: MissionCalendar;
}

/**
 * 台帳の並び順のまま 1 行ずつ組み立てる（**台帳に無い `dm-` 完了履歴は出てこない**）。
 * 完了日の索引は 1 回だけ作って全ミッションで使い回す（extras の走査は 1 周で済む）。
 */
export function buildMissionStats(
  missions: readonly Mission[],
  extras: readonly Extra[],
  today: ISODate,
  weeks: number = MISSION_CALENDAR_WEEKS
): MissionStatRow[] {
  const doneDays = missionDoneDays(extras);
  return missions.map((mission) => {
    const days = doneDays.get(mission.id);
    const calendar = calendarFrom(mission, days, today, weeks);
    const rate = rateFrom(calendar, today);
    return {
      mission,
      streak: missionStreakFrom(mission, days, today),
      rate,
      rateLabel: rate == null ? '–' : rate + '%',
      calendar,
    };
  });
}
