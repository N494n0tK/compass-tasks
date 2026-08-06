'use client';

/**
 * Compass — パネル幅のドラッグ変更（Phase 2B / TASK S0）
 *
 * 出典: HTML:2461-2480（`resizer(key, dir)`）。spec §2.8 / C-54・C-55。
 *
 * `dir='left'` はドロワーの左端をつかむ（右パネル用）、`'right'` は右端（左パネル用）。
 * ナビ以外（editor / review / score）のハンドルも同じ関数を使うので、
 * ドロワーを実装する画面タスクからも呼べるよう export している。
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { PanelW } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';

export type ResizeDir = 'left' | 'right';

/** `lim` の算出（HTML:2465）。`window` を読むのでドラッグ開始時に評価する */
function limitsOf(key: keyof PanelW): [number, number] {
  if (key === 'nav') return [150, 340];
  if (key === 'editor') {
    return [320, Math.min(520, Math.max(360, Math.round(window.innerWidth * 0.62)))];
  }
  return [260, Math.max(320, Math.round(window.innerWidth * 0.92))];
}

/**
 * `this.resizer(key, dir)`（HTML:2461-2480）。
 * mousemove で `panelW[key]` を更新し、mouseup で `savePrefs()`（ドラッグ中は保存しない）。
 */
export function makeResizer(
  store: CompassStore,
  key: keyof PanelW,
  dir: ResizeDir,
  savePrefs: () => void
): (e: ReactMouseEvent) => void {
  return (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = store.getState().panelW[key];
    const lim = limitsOf(key);
    const move = (ev: MouseEvent) => {
      const d = dir === 'left' ? startX - ev.clientX : ev.clientX - startX;
      const w = Math.max(lim[0], Math.min(lim[1], startW + d));
      store.setState((s) => {
        const pw: PanelW = { ...s.panelW };
        pw[key] = w;
        return { panelW: pw };
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      savePrefs();
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
}
