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

import { useCallback, useEffect, useRef } from 'react';
import { clawdWorkDone } from '../../lib/logic/clawdTalk';
import { Clawd } from './Clawd';
import { ShellOverlay } from './ShellOverlay';
import { store, useAppStore } from '../useStore';

/** 窓の見かけの幅（px）。位置を画面内へ丸めるのに使う */
const W = 236;
/** 同じく高さの目安 */
const H = 214;

/** `mm:ss` */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** 窓が画面の外へ出ないように丸める */
function clampPos(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(8, window.innerWidth - W - 8);
  const maxY = Math.max(8, window.innerHeight - H - 8);
  return { x: Math.min(maxX, Math.max(8, x)), y: Math.min(maxY, Math.max(8, y)) };
}

/**
 * 作業を始める（チャットの長さの札から呼ぶ）。
 * 窓は右下に出す ―― 左下は片づけの祝い（`ClawdCheer`）の席なので重ねない。
 */
export function startClawdWork(min: number): void {
  const x = typeof window === 'undefined' ? 24 : window.innerWidth - W - 24;
  const y = typeof window === 'undefined' ? 24 : window.innerHeight - H - 24;
  const at = clampPos(x, y);
  store.setState({
    clawdWork: { min, leftSec: min * 60, running: true, done: false, x: at.x, y: at.y },
  });
}

export function ClawdWorkWindow() {
  const { state: S } = useAppStore();
  const w = S.clawdWork;
  const running = !!w && w.running;

  /**
   * 1 秒ごとに減らす。`running` を購読する effect にしてあるので、
   * 止めた／閉じた／0 に着いた のどれでも cleanup が必ず走る。
   * `setInterval` をコンポーネントのインスタンスに持たせないのは、
   * 止め忘れた 1 本が裏で回り続けるのがいちばん見つけにくい壊れ方だから。
   */
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      store.setState((st) => {
        const cur = st.clawdWork;
        if (!cur || !cur.running) return null;
        if (cur.leftSec <= 1) {
          // 0 に着いた。**窓は閉じない** ―― ここからがお祝いの見せ場なので、
          // 本人が閉じるまで Clawd が祝い続ける
          return { clawdWork: { ...cur, leftSec: 0, running: false, done: true } };
        }
        return { clawdWork: { ...cur, leftSec: cur.leftSec - 1 } };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  // ── 掴んで動かす。`pointer` イベント 1 本でマウスも指も拾う
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const cur = store.getState().clawdWork;
    if (!cur) return;
    drag.current = { dx: e.clientX - cur.x, dy: e.clientY - cur.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const at = clampPos(e.clientX - d.dx, e.clientY - d.dy);
    store.setState((st) => (st.clawdWork ? { clawdWork: { ...st.clawdWork, ...at } } : null));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // 画面の大きさが変わったら、窓を中へ戻す（外に置き去りにしない）
  useEffect(() => {
    const onResize = () =>
      store.setState((st) =>
        st.clawdWork ? { clawdWork: { ...st.clawdWork, ...clampPos(st.clawdWork.x, st.clawdWork.y) } } : null,
      );
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const close = useCallback(() => store.setState({ clawdWork: null }), []);

  if (!w) return null;

  const toggle = () =>
    store.setState((st) => {
      const cur = st.clawdWork;
      if (!cur) return null;
      // 終わったあとにもう一度押したら、同じ長さで引き直す
      if (cur.done) return { clawdWork: { ...cur, leftSec: cur.min * 60, running: true, done: false } };
      return { clawdWork: { ...cur, running: !cur.running } };
    });

  /** 残りの割合（0–1）。細い罫で出す ―― 数字と二重に言わせない */
  const ratio = w.min > 0 ? Math.max(0, Math.min(1, w.leftSec / (w.min * 60))) : 0;

  return (
    <ShellOverlay>
      <div
        className={'cw' + (w.done ? ' is-done' : '')}
        style={{ left: w.x + 'px', top: w.y + 'px' }}
        role="dialog"
        aria-label={'Clawdと作業（' + w.min + '分）'}
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
          <button type="button" className="cw__x" onClick={close} aria-label="閉じる">
            ✕
          </button>
        </div>

        {/* 終わったらお祝いに変わる。走っているあいだは端末に向かって打っている姿 */}
        <div className="cw__stage">
          {/* 走っているあいだは静止画で、**触ると打ちはじめる**（要望の「触ると
              パソコンをうつ Clawd くん」）。鳴り終わったらお祝いに差し替えて、
              閉じるまで動かし続ける ―― ここは「いま祝っている」瞬間そのものなので、
              1 周で止まると祝われた気がしない */}
          <Clawd
            key={w.done ? 'cheer' : 'type'}
            kind={w.done ? 'cheer' : 'type'}
            size={92}
            loop={w.done}
          />
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
            {clawdWorkDone(w.min, w.min)}
          </div>
        ) : null}
      </div>
    </ShellOverlay>
  );
}
