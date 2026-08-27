'use client';

/**
 * Compass — ノート画面のサイドバー（docs/notebook/spec.md §8）
 *
 * 下敷き: `CompassNotebook/チャートノート v2.dc.html` の左ペイン。
 * 上から「フォルダ / カレンダー」の探し方 → 一覧 → 教科の絞り込み → ＋ボタン。
 *
 * v2 の「ノート / 問題抽出」の切替はここではなく**左ナビ**にある。
 * この 2 つはナビの 7 番目・8 番目のタブ（`view: 'notebook' | 'extract'`）で、
 * 画面の切替はアプリのナビが持つのが素直だから。
 * サイドバー自体は両方のタブで共通に出る（教科の絞り込みは問題抽出でも効く）。
 *
 * v2 との違いは 2 つだけ:
 *  - ＋ が「新規ノート」ではなく「JSONから取り込む」（Compass のワークフロー手順 3）
 *  - 一番下に「予習の自動生成」の設定が同居する（spec §5）
 *
 * フォルダとカレンダーは**排他**にしてある（v2 と同じ）。両方出すとサイドバーが
 * 縦に伸びて、肝心のノート一覧がスクロールの外へ落ちる。
 *
 * 2026-08 の UX 刷新（docs/notebook/ux-refresh.md）で、探し方ごとの中身は
 * `NotebookTree` / `NotebookCalendar` に分けた。このファイルに残るのは
 * **枠**（探し方の切替・教科の絞り込み・予習の設定・受け取りボタン）だけ。
 */

import { useMemo } from 'react';
import { fmtMD, isoShift } from '../../lib/logic/dates';
import { subjectColorFor } from '../../lib/logic/subjects';
import { timetableSubjects } from '../../lib/logic/timetable';
import type { Note } from '../../lib/model/notes';
import { NoteContextMenu } from './NoteContextMenu';
import { NotebookCalendar } from './NotebookCalendar';
import { NotebookTree } from './NotebookTree';
import { SECTION_LABEL, chipStyle } from './NotebookShared';
import { pullNotionNotes } from './NotionPull';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

export { shiftMonth } from './NotebookShared';

export interface NotebookSidebarProps {
  /** 教科の絞り込みを適用したあとのノート（親から渡す） */
  notes: readonly Note[];
  today: string;
}

export function NotebookSidebar({ notes, today }: NotebookSidebarProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const side = S.nbSide;

  /** 絞り込みチップに出す教科は、ノートが 1 冊でもある教科（v2 は固定 6 科目） */
  const subjects = useMemo(() => {
    const seen: string[] = [];
    S.notes.forEach((n) => {
      const s = n.subject || 'その他';
      if (seen.indexOf(s) < 0) seen.push(s);
    });
    return seen;
  }, [S.notes]);

  /** 一覧からノートを選ぶ。問題抽出のタブにいたらノートのタブへ移る */
  const select = (note: Note) =>
    store.setState({ view: 'notebook', nbSelNoteId: note.id, nbMode: 'note', nbEdit: false });

  /**
   * 行を右クリック → カーソルの脇にメニュー（`NoteContextMenu`）。
   * 座標は**ビューポート基準**（`clientX/Y`）で渡す ―― サイドバーはスクロールするので、
   * `pageX/Y` だと巻き上げたぶんだけメニューが下にずれる。
   */
  const openMenu = (e: React.MouseEvent, n: Note) => {
    e.preventDefault(); // ブラウザ標準のメニューを止める
    e.stopPropagation();
    store.setState({ nbMenu: { noteId: n.id, x: e.clientX, y: e.clientY } });
  };

  const prepSubjects = useMemo(() => timetableSubjects(), []);
  const prep = S.prepAutoGen;

  return (
    <aside
      style={{
        width: '272px',
        flex: '0 0 272px',
        borderRight: '1px solid var(--line2)',
        paddingRight: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        overflow: 'auto',
      }}
    >
      {/* ── 探し方（排他） */}
      <div style={{ display: 'flex', gap: '4px', flex: 'none' }}>
        {(
          [
            { id: 'tree', label: 'フォルダ' },
            { id: 'cal', label: 'カレンダー' },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            // カレンダーから離れるときは日の絞り込みを畳む。フォルダ側にはそれを
            // 外す手立てが無いので、残したままだと「見えない絞り込み」になる
            onClick={() => store.setState({ nbSide: m.id, nbDay: m.id === 'cal' ? S.nbDay : null })}
            aria-pressed={side === m.id}
            style={{
              ...chipStyle(false, undefined, undefined, side === m.id),
              flex: 1,
              ...(side === m.id ? { background: 'var(--bg3)', color: 'var(--tx0)' } : null),
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {side === 'tree' ? (
        <NotebookTree notes={notes} onSelect={select} onContextMenu={openMenu} />
      ) : null}
      {side === 'cal' ? (
        <NotebookCalendar
          notes={notes}
          today={today}
          onSelect={select}
          onContextMenu={openMenu}
        />
      ) : null}

      <div style={{ flex: 1, minHeight: '10px' }} />

      {/* ── 教科で絞り込み（v2 の subjChips） */}
      {subjects.length > 1 ? (
        <div style={{ flex: 'none' }}>
          <div style={SECTION_LABEL}>教科で絞り込み</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {subjects.map((s) => {
              const on = S.nbSubjFilter === s;
              const c = subjectColorFor(subjColors, s);
              return (
                <button
                  key={s}
                  onClick={() => store.setState({ nbSubjFilter: on ? null : s })}
                  aria-pressed={on}
                  style={chipStyle(on, c.c, c.bg)}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── 予習の自動生成（docs/notebook/spec.md §5） */}
      <div style={{ flex: 'none', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ ...SECTION_LABEL, margin: 0, flex: 1 }}>予習の自動生成</div>
          <button
            onClick={() =>
              store.setState((s) => ({
                prepAutoGen: { ...s.prepAutoGen, enabled: !s.prepAutoGen.enabled },
              }))
            }
            aria-pressed={prep.enabled}
            style={chipStyle(prep.enabled, 'var(--grn)')}
          >
            {prep.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div
          style={{
            font: '400 10px var(--f-ui)',
            color: 'var(--tx3)',
            margin: '7px 0 8px',
            lineHeight: 1.7,
          }}
        >
          {'起動時に、翌登校日（' +
            fmtMD(isoShift(today, 1)) +
            ' 以降の平日）の時間割から教科ごとに1件ずつ積みます'}
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {prepSubjects.map((s) => {
            const off = prep.offSubjects.indexOf(s) >= 0;
            return (
              <button
                key={s}
                onClick={() =>
                  store.setState((st) => ({
                    prepAutoGen: {
                      ...st.prepAutoGen,
                      offSubjects: off
                        ? st.prepAutoGen.offSubjects.filter((x) => x !== s)
                        : st.prepAutoGen.offSubjects.concat([s]),
                    },
                  }))
                }
                aria-pressed={!off}
                style={{
                  font: '500 10px var(--f-ui)',
                  color: off ? 'var(--tx3)' : 'var(--tx1)',
                  background: 'transparent',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  textDecoration: off ? 'line-through' : 'none',
                  opacity: prep.enabled ? 1 : 0.45,
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* ノートの正本は Notion（docs/notebook/notion-pull.md）。受け取りが主で、手貼りは控え */}
      <button
        className="hv-acc-outline"
        onClick={() => void pullNotionNotes(store, today)}
        disabled={S.nbNotionBusy}
        style={{
          flex: 'none',
          padding: '11px 14px',
          border: 'none',
          borderRadius: 'var(--rad-s)',
          background: 'var(--grad)',
          color: 'var(--onAcc)',
          font: '700 12.5px var(--f-ui)',
          cursor: S.nbNotionBusy ? 'default' : 'pointer',
          opacity: S.nbNotionBusy ? 0.6 : 1,
        }}
      >
        {S.nbNotionBusy ? 'Notionから受け取り中…' : '⟳ Notionから受け取る'}
      </button>
      <button
        onClick={() =>
          store.setState({ nbImportOpen: true, nbImportTarget: null, nbImportText: '' })
        }
        style={{
          flex: 'none',
          padding: '9px 14px',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--rad-s)',
          background: 'none',
          color: 'var(--tx2)',
          font: '500 11.5px var(--f-ui)',
          cursor: 'pointer',
        }}
      >
        ＋ JSONを手で貼って取り込む
      </button>

      {/* 右クリックのメニュー。自分で `ShellOverlay` に包んでシェルの外へ出るので、
          `overflow:auto` のこの `<aside>` の中に置いても切られない */}
      <NoteContextMenu />
    </aside>
  );
}
