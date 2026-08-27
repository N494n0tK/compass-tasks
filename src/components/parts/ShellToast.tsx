'use client';

/**
 * Compass — トーストとツールチップ（Phase 2B / TASK S0）
 *
 * 出典: HTML:1905-1911（ツールチップ）、1913-1916（トースト）、4214-4217（`tooltipX` ほか）。
 * spec §2.9-8/9 / C-140〜C-142。表示時間 2400ms とタイマー再設定は `lib/store.ts` の
 * `showToast()` が持つ。
 *
 * ── 出入りの動き（ux-refresh.md §10, app/motion.css）─────────────────
 * 位置決め（画面下・中央）は外枠の `.mo-toast` が持ち、動くのは中の紙だけ。
 * 中央寄せの `translateX(-50%)` と animation の transform を同じ要素に載せると、
 * 出るたびに紙が左へ跳ねるから。
 */

import { useEffect, useState } from 'react';
import type { Tooltip } from '../../lib/model/types';

/** 引っ込む動き（`motion.css` の `--mo-fast`）を見せてから外すまでの ms */
const TOAST_OUT_MS = 160;

export function ShellToast({ toast }: { toast: string | null }) {
  /**
   * 引っ込むところまで見せるために、文言は**このコンポーネントが持ち直す**。
   * `toast` が消えても文字が残っていないと、退場の 0.16 秒に出す中身が無い。
   *
   * ただし今の呼び出し側（`CompassApp`）は `state.toast ? <ShellToast/> : null` なので、
   * 消える瞬間にこの部品ごと外れて退場は素通りする。**親が条件を外して
   * `<ShellToast toast={state.toast} />` と常に置けば、出口もそのまま効く**
   * （そのために props は `string | null` を受ける）。
   */
  const [shown, setShown] = useState<string | null>(toast);
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (toast) {
      // 続けて別の知らせが来たとき、文言だけ差し替わって動きが鳴らないのを防ぐ。
      // 下の key が変わることで DOM ごと作り直され、入場がもう一度鳴る
      setShown(toast);
      setOut(false);
      return;
    }
    setOut(true);
    // 外すのは animationend ではなく時間で。動きを止めている人は animation が
    // 鳴らないので、animationend を待つと知らせが消えないまま残ってしまう
    const t = setTimeout(() => setShown(null), TOAST_OUT_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!shown) return null;

  return (
    // 読み上げの器は出入りで作り直さない（作り直すと「増えた」と見なされず読まれない）。
    // 指を通すのは、画面下の中央に 2.4 秒も押せない板を置かないため
    <div className="mo-toast" role="status" aria-live="polite">
      <div
        key={shown}
        className={'mo-toast__card' + (out ? ' is-out' : '')}
        style={{
          background: 'var(--bg3)',
          border: '1px solid var(--acc)',
          borderRadius: 'var(--rad-s)',
          padding: '10px 20px',
          font: "700 12.5px var(--f-ui)",
          color: 'var(--tx0)',
          boxShadow: 'var(--gAcc)',
        }}
      >
        {shown}
      </div>
    </div>
  );
}

export function ShellTooltip({ tooltip }: { tooltip: Tooltip }) {
  return (
    <div
      // 出るときだけ薄く立ち上げる。位置は inline の transform が決めているので、
      // transform を動かす `.mo-in` ではなく透明度だけの `.mo-fade` を使う（motion.css の決まり 3）
      className="mo-fade"
      style={{
        position: 'fixed',
        // `tooltipX: S.tooltip ? S.tooltip.x + 'px' : '0px'`（HTML:4214-4215）
        left: tooltip.x + 'px',
        top: tooltip.y + 'px',
        transform: 'translate(-50%,-110%)',
        zIndex: 60,
        background: 'var(--bg3)',
        border: '1px solid var(--line2)',
        borderRadius: 'var(--rad-s)',
        padding: '8px 11px',
        pointerEvents: 'none',
        boxShadow: '0 8px 28px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ font: "700 12px var(--f-ui)", color: 'var(--tx0)' }}>{tooltip.title}</div>
      <div style={{ fontSize: '10.5px', color: 'var(--tx2)', marginTop: '2px' }}>
        {tooltip.sub}
      </div>
    </div>
  );
}
