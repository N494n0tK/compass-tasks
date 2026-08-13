'use client';

/**
 * Compass — ノート画面（docs/notebook/spec.md §8）
 *
 * レガシー Compass に無い 7・8 つめの画面（ノート / 問題抽出）。
 * `CompassNotebook/チャートノート v2.dc.html` の 2 ペイン構成（サイドバー + 本文）を
 * Compass の画面規約に載せ替えたもの。
 *
 * ナビの 2 タブはどちらもこのコンポーネントが受け、`view` で紙面を切り替える:
 *  - `'notebook'` … ノートを読む面（`nbMode==='drill'` のときだけドリル面）
 *  - `'extract'`  … 全ノート横断の問題抽出
 * サイドバー（教科ツリー / カレンダー / 教科の絞り込み）は両方で共通。
 * 問題抽出の絞り込みチップもここのサイドバーを使う。
 *
 * ワークフローとの対応:
 *  - 手順 3「JSONを貼る」 … サイドバーの「＋ JSONから取り込む」→ `NoteImportModal`
 *  - 手順 4「カード単位で復習タスクが自動生成」 … 取り込み時に `commitNote` が行う
 *  - 手順 5「想起問題に答える」 … 復習画面 / 今日のToDo →理解度モーダル（`ReviewAskModal`）
 *
 * 画面固有のモーダルは `ShellOverlay` 経由（spec §2.1）。
 */

import { useMemo } from 'react';
import { noteMatchesQuery } from '../../lib/logic/noteSearch';
import type { Note } from '../../lib/model/notes';
import { NoteDrill } from '../parts/NoteDrill';
import { NoteExtract } from '../parts/NoteExtract';
import { NoteImportModal } from '../parts/NoteImportModal';
import { NoteView } from '../parts/NoteView';
import { NotebookSidebar } from '../parts/NotebookSidebar';
import { makeSearchMatcher } from '../parts/ShellSearch';
import { dateCtx, store, useAppStore } from '../useStore';

export function Notebook() {
  const { state: S } = useAppStore();
  const T = dateCtx.today;
  // 検索中は裏の画面も絞り込む（HTML:2621-2630 / spec §2.5）。
  // ただしノートの画面での検索語は**ノートの中身**を指すので、絞り込みも
  // ヒット一覧と同じ見方（`noteMatchesQuery`）に合わせる ―― 一覧に出た語を
  // 持つノートが左のツリーから消えていたら、そこから辿れない
  const { q, filtering } = makeSearchMatcher(S);

  const visible: Note[] = useMemo(() => {
    let list = S.notes;
    if (S.nbSubjFilter) list = list.filter((n) => n.subject === S.nbSubjFilter);
    if (filtering) list = list.filter((n) => noteMatchesQuery(n, q));
    return list;
  }, [S.notes, S.nbSubjFilter, filtering, q]);

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
        padding: '20px 24px',
        display: 'flex',
        gap: '24px',
        animation: 'fadeUp .22s ease',
      }}
    >
      <NotebookSidebar notes={visible} today={T} />

      {/* 紙面。狭い画面では入れ子のスクロールをやめる（globals.css [E] の media） */}
      <div className="nb-main" style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: '2px' }}>
        {S.view === 'extract' ? (
          <NoteExtract />
        ) : S.nbMode === 'drill' && selected ? (
          <NoteDrill key={selected.id} note={selected} />
        ) : selected ? (
          <NoteView key={selected.id} note={selected} />
        ) : (
          /* v2 と同じく箱で囲わない。紙面が始まる前の白場として置く */
          <div
            className="empty-note"
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              textAlign: 'center',
              padding: '30px',
              animation: 'fadeUp .22s ease',
            }}
          >
            <div style={{ font: '700 21px var(--f-disp)', color: 'var(--tx0)' }}>
              {S.notesLoaded ? 'ノートがまだありません' : 'ノートを読み込んでいます…'}
            </div>
            <div
              style={{
                font: '400 12.5px var(--f-ui)',
                color: 'var(--tx3)',
                lineHeight: 1.95,
                maxWidth: '440px',
              }}
            >
              読み返すのは<strong style={{ color: 'var(--tx1)' }}>自分が書いたノートそのもの</strong>。
              AIがするのは、その各段への添削と想起問題を足すことだけです。
              <br />
              授業を録音 → ノートを撮る → AIにプロンプトと一緒に渡す → 返ってきたJSONを貼る。
              <br />
              想起問題ごとに復習カードが作られ、その日のうちに「今日のToDo」へ1枚積まれます。
            </div>
            <button
              onClick={() =>
                store.setState({ nbImportOpen: true, nbImportTarget: null, nbImportText: '' })
              }
              style={{
                marginTop: '5px',
                padding: '10px 20px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: '700 12.5px var(--f-ui)',
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
