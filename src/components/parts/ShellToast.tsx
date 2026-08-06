'use client';

/**
 * Compass — トーストとツールチップ（Phase 2B / TASK S0）
 *
 * 出典: HTML:1905-1911（ツールチップ）、1913-1916（トースト）、4214-4217（`tooltipX` ほか）。
 * spec §2.9-8/9 / C-140〜C-142。表示時間 2400ms とタイマー再設定は `lib/store.ts` の
 * `showToast()` が持つ。
 */

import type { Tooltip } from '../../lib/model/types';

export function ShellToast({ toast }: { toast: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '26px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 130,
        background: 'var(--bg3)',
        border: '1px solid var(--acc)',
        borderRadius: '99px',
        padding: '10px 20px',
        font: "700 12.5px 'Noto Sans JP'",
        color: 'var(--tx0)',
        boxShadow: 'var(--gAcc)',
        animation: 'toastIn .2s ease',
      }}
    >
      {toast}
    </div>
  );
}

export function ShellTooltip({ tooltip }: { tooltip: Tooltip }) {
  return (
    <div
      style={{
        position: 'fixed',
        // `tooltipX: S.tooltip ? S.tooltip.x + 'px' : '0px'`（HTML:4214-4215）
        left: tooltip.x + 'px',
        top: tooltip.y + 'px',
        transform: 'translate(-50%,-110%)',
        zIndex: 60,
        background: 'var(--bg3)',
        border: '1px solid var(--line2)',
        borderRadius: '9px',
        padding: '8px 11px',
        pointerEvents: 'none',
        boxShadow: '0 8px 28px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ font: "700 12px 'Noto Sans JP'", color: 'var(--tx0)' }}>{tooltip.title}</div>
      <div style={{ fontSize: '10.5px', color: 'var(--tx2)', marginTop: '2px' }}>
        {tooltip.sub}
      </div>
    </div>
  );
}
