'use client';

/**
 * Compass — サイドバーの教科フォルダ（docs/notebook/ux-refresh.md §1・§2）
 *
 * `NotebookSidebar` の中にあった教科ツリーを独立させたもの。
 * 教科ごとにノートを畳んで並べ、見出しをクリックすると開閉する。
 */

import { useMemo } from 'react';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import { NoteRow } from './NoteRow';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

export interface NotebookTreeProps {
  /** 絞り込み後のノート（親から渡す） */
  notes: readonly Note[];
  /** 一覧から 1 冊選んだとき */
  onSelect: (n: Note) => void;
  /** 行を右クリックしたとき（`NoteContextMenu`） */
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
}

export function NotebookTree({ notes, onSelect, onContextMenu }: NotebookTreeProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);

  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((n) => {
      const key = n.subject || 'その他';
      const list = map.get(key);
      if (list) list.push(n);
      else map.set(key, [n]);
    });
    return Array.from(map.entries());
  }, [notes]);

  if (!groups.length) {
    return (
      <div style={{ flex: 'none' }}>
        <div style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
          まだノートがありません
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 'none' }}>
      <div style={{ display: 'grid', gap: '3px' }}>
        {groups.map(([subject, list]) => {
          const open = S.nbTreeOpen[subject] !== false; // 既定で開く
          const color = subjectColorFor(subjColors, subject);
          return (
            <div key={subject}>
              <div
                onClick={() =>
                  store.setState((s) => ({
                    nbTreeOpen: { ...s.nbTreeOpen, [subject]: !open },
                  }))
                }
                className="hv-bg3"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 8px',
                  borderRadius: 'var(--rad-s)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span
                  className={'nb-caret' + (open ? ' is-open' : '')}
                  style={{ color: 'var(--tx3)' }}
                >
                  ▸
                </span>
                <span style={{ font: '700 13px var(--f-disp)', color: color.c }}>{subject}</span>
                <span style={{ flex: 1 }} />
                <span style={{ font: '500 10.5px var(--f-num)', color: 'var(--tx3)' }}>
                  {list.length + '件'}
                </span>
              </div>
              {open ? (
                <div style={{ display: 'grid', gap: '1px' }}>
                  {list.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      on={n.id === S.nbSelNoteId}
                      onClick={onSelect}
                      onContextMenu={onContextMenu}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
