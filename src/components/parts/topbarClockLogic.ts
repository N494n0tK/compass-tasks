/**
 * トップバー時計の表示と、ローカル日付の境界計算。
 *
 * `Date#setHours(24, 0, 0, 0)` を使うことで、実行端末の local timezone と
 * DST の切り替えを Date に計算させる。UTC の固定オフセットで計算しないことが
 * このカウントダウンの要点。
 */

const pad2 = (value: number): string => String(Math.max(0, value)).padStart(2, '0');

export function formatLocalClock(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad2).join(':');
}

export function nextLocalMidnight(date: Date): Date {
  const next = new Date(date.getTime());
  next.setHours(24, 0, 0, 0);
  return next;
}

export function millisecondsUntilLocalMidnight(date: Date): number {
  return Math.max(0, nextLocalMidnight(date).getTime() - date.getTime());
}

/**
 * 秒の境界で 00:00:01 が一瞬 00:00:00 にならないよう、残り秒は切り上げる。
 */
export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(pad2).join(':');
}

export interface TopbarClockSnapshot {
  now: Date;
  current: string;
  untilMidnightMs: number;
  untilMidnight: string;
}

export function readTopbarClock(now = new Date()): TopbarClockSnapshot {
  const untilMidnightMs = millisecondsUntilLocalMidnight(now);
  return {
    now,
    current: formatLocalClock(now),
    untilMidnightMs,
    untilMidnight: formatCountdown(untilMidnightMs),
  };
}
