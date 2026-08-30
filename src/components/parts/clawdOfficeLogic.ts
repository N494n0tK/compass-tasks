/**
 * Clawd Office のタイマー表示・入力境界だけを React から切り出す。
 * 実際の残り時間を刻むのは `ClawdWorkWindow` の 1 本だけで、ここは
 * 全画面オフィスと小窓が同じ値を安全に読む／更新するための純粋関数。
 */

export const OFFICE_MIN_SECONDS = 5;
// Clawdチャットの自由入力上限と同じ12時間。既に開始した長時間タイマーを
// Officeに開いただけで短縮しないため、両方の境界を一致させる。
export const OFFICE_MAX_MINUTES = 720;

export function clampOfficeDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return OFFICE_MIN_SECONDS;
  return Math.max(OFFICE_MIN_SECONDS, Math.min(OFFICE_MAX_MINUTES * 60 + 59, Math.round(seconds)));
}

export function durationParts(seconds: number): { minutes: number; seconds: number } {
  const value = clampOfficeDuration(seconds);
  return { minutes: Math.floor(value / 60), seconds: value % 60 };
}

export function durationFromParts(minutes: number, seconds: number): number {
  const m = Math.max(0, Math.min(OFFICE_MAX_MINUTES, Math.trunc(Number.isFinite(minutes) ? minutes : 0)));
  const s = Math.max(0, Math.min(59, Math.trunc(Number.isFinite(seconds) ? seconds : 0)));
  return clampOfficeDuration(m * 60 + s);
}

/** source HTML と同じく、59:59 までは `mm:ss`、以降は `h:mm:ss`。 */
export function formatOfficeTime(seconds: number): string {
  const value = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export type OfficeStatus = 'idle' | 'open' | 'work' | 'pause' | 'close' | 'done';

export function officeStatus(running: boolean, done: boolean, transition: 'open' | 'close' | null): OfficeStatus {
  if (transition === 'open') return 'open';
  if (transition === 'close') return 'close';
  if (done) return 'done';
  return running ? 'work' : 'pause';
}

/**
 * リセット／時間変更の直後は、停止中ではなく source HTML の `idle` に相当する。
 * 一時停止との違いは、残り時間がセッション全体まで戻っているかで判定する。
 */
export function isOfficeIdle(
  running: boolean,
  done: boolean,
  leftSeconds: number,
  totalSeconds: number,
): boolean {
  return !running && !done && leftSeconds >= totalSeconds;
}

/**
 * バックグラウンドタブで setInterval が間引かれても、壁時計上の締切から
 * 残り時間を復元する。ブラウザ時計の補正で残りが増えることは許さない。
 */
export function remainingFromDeadline(
  deadlineMs: number,
  nowMs: number,
  previousSeconds: number,
): number {
  const previous = Math.max(0, Math.floor(Number.isFinite(previousSeconds) ? previousSeconds : 0));
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return previous;
  const calculated = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  return Math.min(previous, calculated);
}

export function clockText(minutes: number): string {
  const value = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
