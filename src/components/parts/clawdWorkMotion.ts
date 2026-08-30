/**
 * Clawd 作業窓の絵の状態。
 *
 * `pack` と `intro` は一度だけ再生する GIF、`typing` はループ GIF、
 * `packed` は PC をしまった静止画を表す。タイマーの状態とは分けておき、
 * タイマーを止めても「しまい終わるまで」の短い遷移を表現できるようにする。
 */
export type ClawdWorkPhase = 'intro' | 'typing' | 'pack' | 'packed';

/** 元の clawd-type.gif の実フレーム数・間隔（GIF の duration と一致） */
export const WORK_FRAME_MS = 120;
export const WORK_INTRO_FRAMES = 12;
export const WORK_TYPING_FRAMES = 16;
export const WORK_PACK_FRAMES = 8;
export const WORK_INTRO_MS = WORK_INTRO_FRAMES * WORK_FRAME_MS;
export const WORK_PACK_MS = WORK_PACK_FRAMES * WORK_FRAME_MS;

export type ClawdWorkMotionEvent =
  | 'start'
  | 'intro-finished'
  | 'pause'
  | 'pack-finished';

/**
 * 状態遷移を一箇所に集める。すでに済んだイベントを受け取っても状態を
 * 巻き戻さないので、UI 側の timeout が競合しても安全に無視できる。
 */
export function reduceClawdWorkPhase(
  phase: ClawdWorkPhase,
  event: ClawdWorkMotionEvent,
): ClawdWorkPhase {
  switch (event) {
    case 'start':
      return 'intro';
    case 'intro-finished':
      return phase === 'intro' ? 'typing' : phase;
    case 'pause':
      return phase === 'typing' || phase === 'intro' ? 'pack' : phase;
    case 'pack-finished':
      return phase === 'pack' ? 'packed' : phase;
  }
}
