/**
 * Compass — 集中モードの実測記録
 *
 * 仕様: docs/daily-mission/plan.md §4.3「集中モードの実測記録」。
 *
 * タイマー（15/25/45分）は回せるのに、実際に集中した時間はどこにも残っていなかった。
 * データ画面に出ている学習時間は**完了タスクの見積り分数**（`SIZE_MIN`）の合計なので、
 * 「25分のタイマーを2本回した」も「S サイズを1個チェックした」も同じ 10 分に見えてしまう。
 *
 * ## 二重計上を避けるための線引き（重要）
 *
 * 実測は **`studyLog` にも `buildStudyEntries` にも合流させない**。完了した Extra / Seg の
 * 見積り分数はすでに学習時間へ載っているので、同じ勉強の実測をそこへ足すと 1 回の勉強が
 * 2 回数えられる。`focusLog` は「見積り」とは独立した **実測の物差し** として持ち、
 * データ画面でも別の枠に出す。
 *
 * ## セッションの数え方
 *
 * 1 セッション = **タイマーが走っていた 1 区間**。一時停止をはさめばそこで 1 件区切られ、
 * 再開すると次の区間が始まる（合計は足し算で合う）。区間の長さは「タイマーが刻んだ回数」
 * で数える ―― 残り秒の引き算にすると、走行中にプリセットを押し替えたときに実測が跳ねる。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { FocusLogEntry, ISODate } from '../model/types';
import { isInWeek, mondayOf } from './dates';

/**
 * 記録する最小の長さ（分）。1 分に満たない区間は捨てる。
 * 開いてすぐ閉じた・押し間違えて数秒だけ走った、が 0 分の記録として溜まらないように。
 */
export const FOCUS_MIN_MINUTES = 1;

/**
 * タイマーが走った秒数 → 記録する分（**切り捨て**）。
 * 切り上げないのは、実測が見積りより甘くなる方向へ膨らむのを避けるため。
 */
export function focusMinutesOf(ranSeconds: number): number {
  if (!(ranSeconds > 0)) return 0;
  return Math.floor(ranSeconds / 60);
}

/**
 * セッション 1 回ぶんの記録を作る。**記録しない場合は `null`**。
 *
 * - `subj` が空 … 集中対象が無いまま開いた（今日のタスクが 0 件）。どの教科の実測とも
 *   言えないので捨てる。教科の分からない記録は円グラフでも名前の無い一切れになる。
 * - 1 分未満 … `FOCUS_MIN_MINUTES` の説明どおり。
 */
export function buildFocusEntry(
  day: ISODate,
  subj: string,
  ranSeconds: number
): FocusLogEntry | null {
  const name = (subj || '').trim();
  const min = focusMinutesOf(ranSeconds);
  if (!name || min < FOCUS_MIN_MINUTES) return null;
  return { day, subj: name, min };
}

/** データ画面に出す合計（分） */
export interface FocusTotals {
  /** 今週（**月曜〜日曜**。データ画面の「今週」と同じ枠, `makeDataRangeFilter`） */
  week: number;
  /** 全期間 */
  all: number;
  /** 記録の件数（全期間）。「まだ 1 件も無い」の判定に使う */
  count: number;
}

/**
 * 実測の合計。`min` は保存データを信用せず `Number(...) || 0` で防御する
 * （`computeDayMinutes` と同じ流儀）。
 */
export function focusTotals(
  log: readonly FocusLogEntry[],
  today: ISODate
): FocusTotals {
  const weekStart = mondayOf(today);
  let week = 0;
  let all = 0;
  log.forEach((e) => {
    const min = Number(e.min) || 0;
    all += min;
    if (e.day && isInWeek(e.day, weekStart)) week += min;
  });
  return { week, all, count: log.length };
}
