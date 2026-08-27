'use client';

/**
 * Compass — サイドバーの月カレンダー（docs/notebook/ux-refresh.md §4）
 *
 * `NotebookSidebar` の中にあったカレンダーを独立させたもの。
 * 月を送り、ノートのある日に点を打ち、下にその月のノートを日付順で並べる。
 */

import { useMemo } from 'react';
import { monthLabel } from '../../lib/logic/dates';
import type { Note } from '../../lib/model/notes';
import { DOW_HEADS, MINI_BTN, SECTION_LABEL, daysInMonth, shiftMonth } from './NotebookShared';
import { NoteRow } from './NoteRow';
import { store, useAppStore } from '../useStore';

export interface NotebookCalendarProps {
  /** 絞り込み後のノート（親から渡す） */
  notes: readonly Note[];
  today: string;
  onSelect: (n: Note) => void;
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
}

export function NotebookCalendar({ notes, today, onSelect, onContextMenu }: NotebookCalendarProps) {
  const { state: S } = useAppStore();
  const month = S.nbMonth || today.slice(0, 8) + '01';
  const offset = new Date(month + 'T00:00:00Z').getUTCDay();
  const dim = daysInMonth(month);
  const rows = Math.ceil((offset + dim) / 7);

  const byDate = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((n) => {
      const list = map.get(n.date);
      if (list) list.push(n);
      else map.set(n.date, [n]);
    });
    return map;
  }, [notes]);

  const inMonth = notes.filter((n) => n.date.slice(0, 7) === month.slice(0, 7));

  return (
    <div style={{ flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
        <button
          className="hv-acc-outline"
          onClick={() => store.setState({ nbMonth: shiftMonth(month, -1) })}
          style={MINI_BTN}
          aria-label="前の月"
        >
          ‹
        </button>
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            font: '700 13px var(--f-num)',
            color: 'var(--tx1)',
          }}
        >
          {month.slice(0, 4) + '年' + monthLabel(month)}
        </div>
        <button
          className="hv-acc-outline"
          onClick={() => store.setState({ nbMonth: shiftMonth(month, 1) })}
          style={MINI_BTN}
          aria-label="次の月"
        >
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px' }}>
        {DOW_HEADS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              font: '400 9.5px var(--f-ui)',
              color: 'var(--tx3)',
              padding: '2px 0',
            }}
          >
            {d}
          </div>
        ))}
        {Array.from({ length: rows * 7 }, (_, i) => {
          const dayNo = i - offset + 1;
          if (dayNo < 1 || dayNo > dim) return <div key={i} />;
          const iso = month.slice(0, 8) + String(dayNo).padStart(2, '0');
          const hits = byDate.get(iso) || [];
          const isToday = iso === today;
          const selected = hits.some((n) => n.id === S.nbSelNoteId);
          return (
            <div
              key={i}
              onClick={() => (hits.length ? onSelect(hits[0]) : undefined)}
              title={hits.length ? hits.map((n) => n.unit).join(' / ') : undefined}
              style={{
                textAlign: 'center',
                font: '500 11.5px var(--f-num)',
                padding: '5px 0 7px',
                borderRadius: 'var(--rad-s)',
                position: 'relative',
                cursor: hits.length ? 'pointer' : 'default',
                color: selected ? 'var(--onAcc)' : hits.length ? 'var(--tx0)' : 'var(--tx3)',
                background: selected ? 'var(--view)' : 'transparent',
                boxShadow: isToday && !selected ? 'inset 0 0 0 1px var(--view)' : 'none',
              }}
            >
              {dayNo}
              {hits.length && !selected ? (
                <span
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: '2px',
                    transform: 'translateX(-50%)',
                    width: '4px',
                    height: '4px',
                    background: 'var(--view)',
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {/* v2 と同じく、選んだ月にあるノートを日付順に下へ出す */}
      <div style={{ ...SECTION_LABEL, margin: '15px 0 6px' }}>
        {monthLabel(month) + 'のノート · ' + inMonth.length + '件'}
      </div>
      <div style={{ display: 'grid', gap: '1px' }}>
        {inMonth.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            on={n.id === S.nbSelNoteId}
            onClick={onSelect}
            onContextMenu={onContextMenu}
            showSubject
          />
        ))}
      </div>
    </div>
  );
}
