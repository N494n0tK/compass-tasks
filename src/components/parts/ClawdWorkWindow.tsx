'use client';

/**
 * Compass — Clawd と一緒に作業する浮き窓
 *
 * 要望の原文（2026-08-28）:
 * 「Clawd くんと作業っていうのをできるようにして！ Clawd タブで、下のチャットでその選択肢を
 *   追加して！ で、その後に時間を決めて、そして作業開始！ フロートウィンドウ形式で、
 *   触るとパソコンをうつ Clawd くんがそのウィンドウにいるような感じで！
 *   タイマーはスタートストップができるように！
 *   タイマーが終わったら Clawd がお祝いアニメーションに変わってお祝いしてくれる感じで」
 *
 * ## 畳んだ集中モードとの違い
 *
 * ここに置き換わる前は「集中モード」があった。あれは**今日のタスク 1 件に張り付く
 * 全画面の面**で、教科ごとの実測（`focusLog`）を残すのが目的だった。
 * 対象を選ばないと記録が「名前の無い一切れ」になるので、タスクが無いと成立しない。
 *
 * こちらは対象を決めずに「とりあえず一緒に机に向かう」ための小さな窓。だから
 *  - **全画面を覆わない**。裏の画面は見えているし、触れる（掴んで動かせる）
 *  - **記録を残さない**。教科が無い以上 `buildFocusEntry` は `null` を返すし、
 *    無理に「その他」で記録すると円グラフに意味のない一切れが増える
 * 目的が違うので、state（`clawdWork`）もタイマーも別に持つ。
 *
 * ## 窓はどこに出しても消えない
 *
 * `CompassApp` に 1 個だけ置いてある（`ShellOverlay` 経由でシェルの外へ出る）ので、
 * ナビで別の画面へ移っても回り続ける。**それがこの窓の存在理由** ―― ノートを読みながら、
 * ToDo を片づけながら、となりで Clawd が打っている、という形にしたい。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clawdWorkDoneDuration } from '../../lib/logic/clawdTalk';
import { Clawd } from './Clawd';
import { ClawdOffice } from './ClawdOffice';
import { remainingFromDeadline } from './clawdOfficeLogic';
import { ShellOverlay } from './ShellOverlay';
import { useDialogFocus } from './useDialogFocus';
import {
  reduceClawdWorkPhase,
  WORK_INTRO_MS,
  WORK_PACK_MS,
  type ClawdWorkMotionEvent,
  type ClawdWorkPhase,
} from './clawdWorkMotion';
import { store, useAppStore } from '../useStore';

/** 初回描画までの位置決めだけに使う予備値。以降は DOM の実寸で丸める。 */
const FALLBACK_SIZE = { width: 236, height: 214 };
const WINDOW_GUTTER = 8;
const WORK_ART_SIZE = 92;
const WORK_INTRO_GIF = '/clawd/clawd-type-work-intro.gif';
const WORK_TYPING_GIF = '/clawd/clawd-type-work-loop.gif';
const WORK_PACK_GIF = '/clawd/clawd-type-work-pack.gif';
const WORK_STILL = '/clawd/clawd-type.png';

function workTotalSeconds(work: { min: number; totalSec?: number }): number {
  return Math.max(5, Math.round(work.totalSec ?? work.min * 60));
}

interface WindowSize {
  width: number;
  height: number;
}

/** 作業時間の一時ボタンは窓を開くと消えるため、戻り先は常設の開始ボタンを預かる。 */
let workReturnFocus: HTMLElement | null = null;

/** `mm:ss` */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** モバイル下部ナビが実際に占める高さ。safe area を含めて DOM から読む。 */
function mobileNavInset(): number {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 820px)').matches) return 0;
  const nav = document.querySelector<HTMLElement>('.compass-nav');
  if (!nav) return 64;
  return Math.max(0, window.innerHeight - nav.getBoundingClientRect().top);
}

/** 窓が画面の外・モバイル下部ナビの下へ出ないように、実寸で丸める */
function clampPos(x: number, y: number, size: WindowSize = FALLBACK_SIZE): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(WINDOW_GUTTER, window.innerWidth - size.width - WINDOW_GUTTER);
  const maxY = Math.max(
    WINDOW_GUTTER,
    window.innerHeight - mobileNavInset() - size.height - WINDOW_GUTTER,
  );
  return {
    x: Math.min(maxX, Math.max(WINDOW_GUTTER, x)),
    y: Math.min(maxY, Math.max(WINDOW_GUTTER, y)),
  };
}

/**
 * 作業を始める（チャットの長さの札から呼ぶ）。
 * 窓は右下に出す ―― 左下は片づけの祝い（`ClawdCheer`）の席なので重ねない。
 */
export function startClawdWork(min: number, returnFocus?: HTMLElement | null): void {
  workReturnFocus = returnFocus ?? null;
  const x = typeof window === 'undefined' ? 24 : window.innerWidth - FALLBACK_SIZE.width - 24;
  const y = typeof window === 'undefined' ? 24 : window.innerHeight - FALLBACK_SIZE.height - 24;
  const at = clampPos(x, y);
  const totalSec = min * 60;
  store.setState({
    clawdWork: { min, totalSec, deadlineAt: Date.now() + totalSec * 1000, leftSec: totalSec, running: true, done: false, x: at.x, y: at.y },
  });
}

export function ClawdWorkWindow() {
  const { state: S } = useAppStore();
  const w = S.clawdWork;
  const running = !!w && w.running;
  const open = !!w;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sizeRef = useRef<WindowSize>(FALLBACK_SIZE);
  const wasRunningRef = useRef(false);
  /** 1 回の開始/停止より前に作った timeout を無効にする世代番号 */
  const motionEpochRef = useRef(0);
  const [workPhase, setWorkPhase] = useState<ClawdWorkPhase>('intro');
  /** 小窓は mounted のまま。全画面中は見た目だけ退避して tick を保持する。 */
  const [officeOpen, setOfficeOpen] = useState(false);
  // SSRと最初のclient renderは同じfalseにし、mount後に実環境へ合わせる。
  const [reducedMotion, setReducedMotion] = useState(false);
  if (w && workReturnFocus) returnFocusRef.current = workReturnFocus;
  const close = useCallback(() => {
    motionEpochRef.current += 1;
    setOfficeOpen(false);
    store.setState({ clawdWork: null });
  }, []);

  useEffect(() => {
    if (!w) setOfficeOpen(false);
  }, [w]);

  /** 状態を進めると同時に、古い intro/pack timeout を無効にする。 */
  const moveMotion = useCallback((event: ClawdWorkMotionEvent) => {
    motionEpochRef.current += 1;
    setWorkPhase((phase) => reduceClawdWorkPhase(phase, event));
  }, []);

  // Keep the work window's dedicated animation respectful of the user's
  // motion preference even though its intro/loop images are plain GIFs.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  // The window normally stays mounted with the shell, but invalidate any
  // callback that may already be queued if its owner is ever unmounted.
  useEffect(() => () => {
    motionEpochRef.current += 1;
  }, []);

  // running の立ち上がりは初回開始・再開のどちらでも PC を開く導入から始める。
  // 停止時は片づけの one-shot を再生し、閉じ終わったら packed に留める。
  // done/close は世代を進めて、直前の timeout が後から戻してこないようにする。
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    const currentRunning = running && !w?.done;
    wasRunningRef.current = currentRunning;

    if (!open || w?.done) {
      motionEpochRef.current += 1;
      return;
    }
    if (currentRunning && !wasRunning) {
      moveMotion('start');
    } else if (!currentRunning && wasRunning) {
      moveMotion('pause');
    }
  }, [open, running, w?.done, moveMotion]);

  // The intro asset has twelve 120 ms frames. Once it has shown exactly once,
  // replace it with the dedicated typing cycle. The epoch and store check make
  // a callback that races with pause/resume harmless.
  useEffect(() => {
    if (!open || w?.done || !running || reducedMotion || workPhase !== 'intro') return;
    const epoch = motionEpochRef.current;
    const timer = window.setTimeout(() => {
      const current = store.getState().clawdWork;
      if (
        motionEpochRef.current !== epoch ||
        !current ||
        current.done ||
        !current.running
      ) {
        return;
      }
      moveMotion('intro-finished');
    }, WORK_INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [open, running, w?.done, reducedMotion, workPhase, moveMotion]);

  // A pause gets its own asset instead of leaving the typing loop visible.
  // Once it finishes, the final source frame is the same packed pose as the
  // still asset, so the window remains visually closed while stopped.
  useEffect(() => {
    if (!open || w?.done || running || reducedMotion || workPhase !== 'pack') return;
    const epoch = motionEpochRef.current;
    const timer = window.setTimeout(() => {
      const current = store.getState().clawdWork;
      if (
        motionEpochRef.current !== epoch ||
        !current ||
        current.done ||
        current.running
      ) {
        return;
      }
      moveMotion('pack-finished');
    }, WORK_PACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, running, w?.done, reducedMotion, workPhase, moveMotion]);

  // Reduced-motion users should never be left on an animated intermediate
  // state. A paused window can become packed immediately when the preference
  // changes while its pack GIF is playing.
  useEffect(() => {
    if (!open || w?.done || running || !reducedMotion || workPhase !== 'pack') return;
    moveMotion('pack-finished');
  }, [open, running, w?.done, reducedMotion, workPhase, moveMotion]);
  // 背景を操作できる小窓なので Tab は閉じ込めない。Esc と初期・復帰フォーカスだけ
  // モーダルと同じ約束にして、キーボードからも消せるようにする。
  const onPanelKeyDown = useDialogFocus({
    // 全画面 Office が Esc を受け取る間は小窓の listener を外す。
    // これで Esc は「タイマーを終了」ではなく「小窓へ縮小」になる。
    open: !!w && !officeOpen,
    panelRef,
    initialFocusRef: closeButtonRef,
    restoreFocusRef: returnFocusRef,
    onClose: close,
    trapFocus: false,
  });

  /**
   * 実時刻の締切から残り秒を計算する。バックグラウンドタブでは
   * `setInterval` が間引かれるため、呼ばれた回数を1秒として扱ってはいけない。
   * visibilitychange でも即時に同期し、別タブから戻った瞬間に表示を追いつかせる。
   */
  const deadlineRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const current = store.getState().clawdWork;
    if (!current) return;
    const deadline = Number.isFinite(current.deadlineAt)
      ? (current.deadlineAt as number)
      : Date.now() + Math.max(0, current.leftSec) * 1000;
    deadlineRef.current = deadline;

    const tick = () => {
      store.setState((st) => {
        const cur = st.clawdWork;
        if (!cur || !cur.running) return null;
        const nextLeft = remainingFromDeadline(deadlineRef.current ?? deadline, Date.now(), cur.leftSec);
        if (nextLeft <= 0) {
          // 0 に着いた。**窓は閉じない** ―― ここからがお祝いの見せ場なので、
          // 本人が閉じるまで Clawd が祝い続ける
          return { clawdWork: { ...cur, deadlineAt: undefined, leftSec: 0, running: false, done: true } };
        }
        if (nextLeft === cur.leftSec) return null;
        return { clawdWork: { ...cur, leftSec: nextLeft } };
      });
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      deadlineRef.current = null;
    };
  }, [running]);

  // ── 掴んで動かす。`pointer` イベント 1 本でマウスも指も拾う
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const cur = store.getState().clawdWork;
    if (!cur) return;
    // Grip の中には全画面／閉じるボタンがある。実ポインター操作で
    // 親が capture すると、子ボタンの click を奪うブラウザがあるため、
    // インタラクティブな子要素からはドラッグを開始しない。
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) return;
    drag.current = { dx: e.clientX - cur.x, dy: e.clientY - cur.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const at = clampPos(e.clientX - d.dx, e.clientY - d.dy, sizeRef.current);
    store.setState((st) => (st.clawdWork ? { clawdWork: { ...st.clawdWork, ...at } } : null));
  };
  const endDrag = () => {
    drag.current = null;
  };

  /** DOM 実寸・viewport・下部ナビの変化後に、位置だけを必要なときに直す。 */
  const measureAndClamp = useCallback(() => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      sizeRef.current = { width: rect.width, height: rect.height };
    }
    store.setState((st) => {
      const cur = st.clawdWork;
      if (!cur) return null;
      const at = clampPos(cur.x, cur.y, sizeRef.current);
      return at.x === cur.x && at.y === cur.y ? null : { clawdWork: { ...cur, ...at } };
    });
  }, []);

  // 画面・visual viewport・終了時の内容高が変わっても、窓を中へ戻す。
  useEffect(() => {
    if (!w) return;
    measureAndClamp();
    const panel = panelRef.current;
    const observer = panel ? new ResizeObserver(measureAndClamp) : null;
    if (panel) observer?.observe(panel);
    window.addEventListener('resize', measureAndClamp);
    window.visualViewport?.addEventListener('resize', measureAndClamp);
    window.visualViewport?.addEventListener('scroll', measureAndClamp);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureAndClamp);
      window.visualViewport?.removeEventListener('resize', measureAndClamp);
      window.visualViewport?.removeEventListener('scroll', measureAndClamp);
    };
  }, [measureAndClamp, w?.done]);

  if (!w) return null;

  const toggle = () =>
    store.setState((st) => {
      const cur = st.clawdWork;
      if (!cur) return null;
      // 終わったあとにもう一度押したら、同じ長さで引き直す
      if (cur.done) {
        const totalSec = workTotalSeconds(cur);
        return { clawdWork: { ...cur, totalSec, deadlineAt: Date.now() + totalSec * 1000, leftSec: totalSec, running: true, done: false } };
      }
      const nextRunning = !cur.running;
      return {
        clawdWork: {
          ...cur,
          deadlineAt: nextRunning ? Date.now() + Math.max(0, cur.leftSec) * 1000 : undefined,
          running: nextRunning,
        },
      };
    });

  /** 残りの割合（0–1）。細い罫で出す ―― 数字と二重に言わせない */
  const ratio = Math.max(0, Math.min(1, w.leftSec / workTotalSeconds(w)));

  return (
    <>
      <ShellOverlay>
        <div
        ref={panelRef}
        className={'cw' + (w.done ? ' is-done' : '') + (officeOpen ? ' is-office-open' : '')}
        style={{ left: w.x + 'px', top: w.y + 'px' }}
        role="dialog"
        aria-modal="false"
        aria-label={'Clawdと作業（' + clock(workTotalSeconds(w)) + '）'}
        aria-hidden={officeOpen || undefined}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        {/* 掴むところ。窓の上辺ぜんぶを掴めるようにする（つまみを探させない） */}
        <div
          className="cw__grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="cw__title">{w.done ? 'おつかれさま' : 'Clawdと作業'}</span>
          <button type="button" className="cw__office" onClick={() => setOfficeOpen(true)} aria-label="Clawd Officeを全画面で開く">
            全画面
          </button>
          <button ref={closeButtonRef} type="button" className="cw__x" onClick={close} aria-label="閉じる">
            ✕
          </button>
        </div>

        {/* 終わったらお祝いに変わる。走っているあいだは端末に向かって打っている姿 */}
        <div className="cw__stage">
          {w.done ? (
            // 閉じるまでお祝いを動かし続ける。作業中の type GIF だけは
            // intro → typing に分け、GIF全体の再生に戻らないようにする。
            <Clawd key="cheer" kind="cheer" size={WORK_ART_SIZE} loop />
          ) : (
            <span
              className="clawd"
              style={{ width: WORK_ART_SIZE + 'px', height: WORK_ART_SIZE + 'px' }}
              aria-hidden="true"
            >
              <img
                key={reducedMotion ? 'still' : workPhase}
                className="clawd__img"
                src={
                  reducedMotion
                    ? WORK_STILL
                    : workPhase === 'intro'
                      ? WORK_INTRO_GIF
                      : workPhase === 'typing'
                        ? WORK_TYPING_GIF
                        : workPhase === 'pack'
                          ? WORK_PACK_GIF
                          : WORK_STILL
                }
                alt=""
                width={WORK_ART_SIZE}
                height={WORK_ART_SIZE}
                draggable={false}
                decoding="async"
              />
            </span>
          )}
        </div>

        <div className="cw__time" aria-live="off">
          {clock(w.leftSec)}
        </div>
        <div className="cw__bar" aria-hidden="true">
          <span style={{ transform: 'scaleX(' + ratio + ')' }} />
        </div>

        <div className="cw__row">
          <button type="button" className="cw__go" onClick={toggle}>
            {w.done ? 'もう一度' : w.running ? '一時停止' : '再開'}
          </button>
          <button type="button" className="cw__quit" onClick={close}>
            やめる
          </button>
        </div>

        {/* 終わったことは読み上げにも 1 度だけ流す（数字は毎秒読ませない） */}
        {w.done ? (
          <div className="cw__done" role="status">
            {clawdWorkDoneDuration(workTotalSeconds(w), w.min)}
          </div>
        ) : null}
        </div>
      </ShellOverlay>
      <ClawdOffice open={officeOpen} onClose={() => setOfficeOpen(false)} />
    </>
  );
}
