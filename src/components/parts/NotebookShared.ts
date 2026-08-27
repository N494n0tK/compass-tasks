'use client';

/**
 * Compass — ノート画面サイドバーの共有部品（docs/notebook/ux-refresh.md）
 *
 * `NotebookSidebar` に全部入っていた小さな見た目の決めごとを、
 * `NotebookTree` / `NotebookCalendar` / `NoteRow` から共通に使えるよう出したもの。
 * サイドバーが 1 ファイルだったころは private な定数でよかったが、
 * 探し方ごとにファイルを分けた以上、同じ寸法・同じ字送りをここ 1 か所で持つ。
 *
 * 純粋な定数と関数だけ。React も store も import しない。
 */

import type { CSSProperties } from 'react';

/** 日曜始まりの曜日ヘッダ（v2 の既定） */
export const DOW_HEADS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 小見出し（「教科で絞り込み」など）。字間を空けて、本文と役割を分ける */
export const SECTION_LABEL: CSSProperties = {
  font: '700 10px var(--f-ui)',
  color: 'var(--tx3)',
  letterSpacing: '.12em',
  margin: '0 0 8px',
};

/** カレンダーの前月・次月のような、字だけの小さなボタン */
export const MINI_BTN: CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
};

/**
 * 教科チップ / 探し方の切替に共通の小さなボタン。
 * `font` の一括指定に太さまで含めること（`fontWeight` を別に足すと React が
 * ショートハンドとの混在を警告する）
 */
export function chipStyle(on: boolean, c?: string, bg?: string, bold?: boolean): CSSProperties {
  return {
    font: (bold ? '700' : '600') + ' 11px var(--f-ui)',
    color: on ? 'var(--onAcc)' : c || 'var(--tx2)',
    background: on ? c || 'var(--view)' : bg || 'transparent',
    border: '1px solid ' + (on ? c || 'var(--view)' : 'var(--line2)'),
    borderRadius: 'var(--rad-s)',
    padding: '4px 11px',
    cursor: 'pointer',
  };
}

/** `'YYYY-MM-01'` を n か月ずらす */
export function shiftMonth(monthIso: string, n: number): string {
  const y = parseInt(monthIso.slice(0, 4), 10);
  const m = parseInt(monthIso.slice(5, 7), 10) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return ny + '-' + String(nm + 1).padStart(2, '0') + '-01';
}

/** その月の日数 */
export function daysInMonth(monthIso: string): number {
  const y = parseInt(monthIso.slice(0, 4), 10);
  const m = parseInt(monthIso.slice(5, 7), 10);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
