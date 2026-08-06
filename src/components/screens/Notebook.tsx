'use client';

/**
 * Compass — ノート画面（docs/notebook/spec.md §8）
 *
 * レガシー Compass に無い 7 つめの画面。`CompassNotebook/チャートノート v3.dc.html` の
 * 2 ペイン構成（サイドバー + 本文）を Compass の画面規約に載せ替えたもの。
 *
 * ワークフローとの対応:
 *  - 手順 3「JSONを貼る」 … サイドバーの「＋ JSONから取り込む」→ `NoteImportModal`
 *  - 手順 4「カード単位で復習タスクが自動生成」 … 取り込み時に `commitNote` が行う
 *  - 手順 5「想起問題に答える」 … 復習画面 / 今日のToDo →理解度モーダル（`ReviewAskModal`）
 *
 * 画面固有のモーダルは `ShellOverlay` 経由（spec §2.1）。
 */

import { useMemo } from 'react';
import type { Note } from '../../lib/model/notes';
import { NoteExtract } from '../parts/NoteExtract';
import { NoteImportModal } from '../parts/NoteImportModal';
import { NoteView } from '../parts/NoteView';
import { NotebookSidebar } from '../parts/NotebookSidebar';
import { makeSearchMatcher } from '../parts/ShellSearch';
import { dateCtx, store, useAppStore } from '../useStore';

export function Notebook() {
  const { state: S } = useAppStore();
  const T = dateCtx.today;
  // 検索中は裏の画面も絞り込む（HTML:2621-2630 / spec §2.5）
  const { filtering, hit } = makeSearchMatcher(S);

  const visible: Note[] = useMemo(() => {
    let list = S.notes;
    if (S.nbSubjFilter) list = list.filter((n) => n.subject === S.nbSubjFilter);
    if (filtering) {
      list = list.filter(
        (n) => hit(n.unit) || hit(n.subject) || n.cards.some((c) => hit(c.q) || hit(c.a)),
      );
    }
    return list;
  }, [S.notes, S.nbSubjFilter, filtering, hit]);

  const selected: Note | null =
    visible.find((n) => n.id === S.nbSelNoteId) ||
    S.notes.find((n) => n.id === S.nbSelNoteId) ||
    visible[0] ||
    null;

  return (
    <div
      data-screen-label="Notebook"
      style={{
        flex: 1,
        overflow: 'hidden',
        padding: '18px 20px',
        display: 'flex',
        gap: '18px',
        animation: 'fadeUp .22s ease',
      }}
    >
      <NotebookSidebar notes={visible} today={T} />

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: '2px' }}>
        {S.nbMode === 'extract' ? (
          <NoteExtract />
        ) : selected ? (
          <NoteView key={selected.id} note={selected} />
        ) : (
          <div
            className="empty-note"
            style={{
              border: '1px dashed var(--line2)',
              borderRadius: 'var(--rad)',
              padding: '40px 28px',
              textAlign: 'center',
              color: 'var(--tx3)',
            }}
          >
            <div style={{ font: "700 14px 'Noto Sans JP'", color: 'var(--tx1)' }}>
              {S.notesLoaded ? 'ノートがまだありません' : 'ノートを読み込んでいます…'}
            </div>
            <div style={{ fontSize: '12px', marginTop: '8px', lineHeight: 1.9 }}>
              授業を録音してノートを撮影 → 外部AIでプロンプトA・Bを通す → 出てきたJSONを貼るだけ。
              <br />
              想起問題1問ごとに復習カードが作られ、翌日から「今日の復習」に出ます。
            </div>
            <button
              onClick={() =>
                store.setState({ nbImportOpen: true, nbImportTarget: null, nbImportText: '' })
              }
              style={{
                marginTop: '16px',
                padding: '10px 20px',
                border: 'none',
                borderRadius: '10px',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 12.5px 'Noto Sans JP'",
                cursor: 'pointer',
              }}
            >
              ＋ JSONから取り込む
            </button>
          </div>
        )}
      </div>

      <NoteImportModal />
    </div>
  );
}
