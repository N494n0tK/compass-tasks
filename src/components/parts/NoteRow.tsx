'use client';

/**
 * Compass — ノート一覧の 1 行（docs/notebook/ux-refresh.md §3）
 *
 * 教科フォルダ・カレンダー・ゴミ箱・検索結果、どこから並べても同じ行が出る。
 * `NotebookSidebar` の中の無名コンポーネントだったものを、
 * 「一覧を見ただけでは何の教科か分からない」を直すために独立させた。
 */

import { dowOf, fmtMD } from '../../lib/logic/dates';
import type { Note } from '../../lib/model/notes';

export interface NoteRowProps {
  note: Note;
  /** いま開いているノートか */
  on: boolean;
  onClick: (n: Note) => void;
  /** 右クリック（`NoteContextMenu` を開く） */
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
  /**
   * 教科名を行に出すか。教科フォルダの中では見出しに教科が出ているので不要、
   * カレンダー・検索結果のように教科が混ざる並びでは要る。
   */
  showSubject?: boolean;
}

export function NoteRow({ note, on, onClick, onContextMenu, showSubject }: NoteRowProps) {
  return (
    <div
      onClick={() => onClick(note)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, note) : undefined}
      className="hv-bg3"
      style={{
        padding: '6px 8px 6px 27px',
        borderRadius: 'var(--rad-s)',
        cursor: 'pointer',
        background: on ? 'var(--viewBg)' : 'transparent',
        boxShadow: on ? 'inset 2px 0 0 var(--view)' : 'none',
      }}
    >
      <div
        style={{
          font: '600 12px var(--f-ui)',
          color: on ? 'var(--tx0)' : 'var(--tx1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {note.unit || '(単元名なし)'}
      </div>
      <div style={{ font: '400 10px var(--f-num)', color: 'var(--tx3)', letterSpacing: '.04em' }}>
        {(showSubject && note.subject ? note.subject + ' · ' : '') +
          (note.date
            ? fmtMD(note.date) + '(' + dowOf(note.date) + ') · カード' + note.cards.length
            : 'カード' + note.cards.length)}
      </div>
    </div>
  );
}
