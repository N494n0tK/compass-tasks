'use client';

/**
 * Compass — ノート画面のサイドバー（docs/notebook/spec.md §8）
 *
 * 下敷き: `CompassNotebook/チャートノート v2.dc.html` の左ペイン。
 * 上から「ノート / 問題抽出」の切替 →「フォルダ / カレンダー」の探し方 →
 * 一覧 → 教科の絞り込み → ＋ボタン、という並びをそのまま引き継いでいる。
 *
 * v2 との違いは 2 つだけ:
 *  - ＋ が「新規ノート」ではなく「JSONから取り込む」（Compass のワークフロー手順 3）
 *  - 一番下に「予習の自動生成」の設定が同居する（spec §5）
 *
 * フォルダとカレンダーは**排他**にしてある（v2 と同じ）。両方出すとサイドバーが
 * 縦に伸びて、肝心のノート一覧がスクロールの外へ落ちる。
 */

import { useMemo } from 'react';
import { dowOf, fmtMD, isoShift, monthLabel } from '../../lib/logic/dates';
import { subjectColorFor } from '../../lib/logic/subjects';
import { timetableSubjects } from '../../lib/logic/timetable';
import type { Note } from '../../lib/model/notes';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

/** 日曜始まりの曜日ヘッダ（v2 の既定） */
const DOW_HEADS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const SECTION_LABEL = {
  font: '700 10px var(--f-ui)',
  color: 'var(--tx3)',
  letterSpacing: '.12em',
  margin: '0 0 8px',
} as const;

const MINI_BTN = {
  padding: '4px 8px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
} as const;

/**
 * 教科チップ / 探し方の切替に共通の小さなボタン。
 * `font` の一括指定に太さまで含めること（`fontWeight` を別に足すと React が
 * ショートハンドとの混在を警告する）
 */
function chipStyle(on: boolean, c?: string, bg?: string, bold?: boolean) {
  return {
    font: (bold ? '700' : '600') + ' 11px var(--f-ui)',
    color: on ? 'var(--onAcc)' : c || 'var(--tx2)',
    background: on ? c || 'var(--view)' : bg || 'transparent',
    border: '1px solid ' + (on ? c || 'var(--view)' : 'var(--line2)'),
    borderRadius: 'var(--rad-s)',
    padding: '4px 11px',
    cursor: 'pointer',
  } as const;
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
function daysInMonth(monthIso: string): number {
  const y = parseInt(monthIso.slice(0, 4), 10);
  const m = parseInt(monthIso.slice(5, 7), 10);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface NotebookSidebarProps {
  /** 教科の絞り込みを適用したあとのノート（親から渡す） */
  notes: readonly Note[];
  today: string;
}

export function NotebookSidebar({ notes, today }: NotebookSidebarProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const side = S.nbSide;

  // ── 教科ツリー
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

  /** 絞り込みチップに出す教科は、ノートが 1 冊でもある教科（v2 は固定 6 科目） */
  const subjects = useMemo(() => {
    const seen: string[] = [];
    S.notes.forEach((n) => {
      const s = n.subject || 'その他';
      if (seen.indexOf(s) < 0) seen.push(s);
    });
    return seen;
  }, [S.notes]);

  // ── カレンダー
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

  const select = (note: Note) =>
    store.setState({ nbSelNoteId: note.id, nbMode: 'note', nbEdit: false });

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
      {/* ── ノート / 問題抽出。v2 の segmented control（1 本の枠を 2 つに割る） */}
      <div
        style={{
          display: 'flex',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--rad-s)',
          overflow: 'hidden',
          flex: 'none',
        }}
      >
        {(
          [
            { id: 'note', label: 'ノート' },
            { id: 'extract', label: '問題抽出' },
          ] as const
        ).map((m) => {
          const on = S.nbMode === m.id || (m.id === 'note' && S.nbMode === 'drill');
          return (
            <button
              key={m.id}
              onClick={() => store.setState({ nbMode: m.id })}
              aria-pressed={on}
              style={{
                flex: 1,
                textAlign: 'center',
                font: '700 12px var(--f-disp)',
                color: on ? 'var(--onAcc)' : 'var(--tx2)',
                background: on ? 'var(--view)' : 'transparent',
                border: 0,
                padding: '8px 0',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

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
            onClick={() => store.setState({ nbSide: m.id })}
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

      {/* ── 教科フォルダ */}
      {side === 'tree' ? (
        <div style={{ flex: 'none' }}>
          {groups.length === 0 ? (
            <div style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
              まだノートがありません
            </div>
          ) : null}
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
                        <NoteRow key={n.id} note={n} on={n.id === S.nbSelNoteId} onClick={select} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── カレンダー */}
      {side === 'cal' ? (
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
                  onClick={() => (hits.length ? select(hits[0]) : undefined)}
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
            {monthLabel(month) + 'のノート · ' + notes.filter((n) => n.date.slice(0, 7) === month.slice(0, 7)).length + '件'}
          </div>
          <div style={{ display: 'grid', gap: '1px' }}>
            {notes
              .filter((n) => n.date.slice(0, 7) === month.slice(0, 7))
              .map((n) => (
                <NoteRow key={n.id} note={n} on={n.id === S.nbSelNoteId} onClick={select} />
              ))}
          </div>
        </div>
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

      <button
        onClick={() =>
          store.setState({ nbImportOpen: true, nbImportTarget: null, nbImportText: '' })
        }
        style={{
          flex: 'none',
          padding: '11px 14px',
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
    </aside>
  );
}

/** 一覧の 1 行。フォルダ／カレンダーの両方から使う */
function NoteRow({
  note,
  on,
  onClick,
}: {
  note: Note;
  on: boolean;
  onClick: (n: Note) => void;
}) {
  return (
    <div
      onClick={() => onClick(note)}
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
        {note.date
          ? fmtMD(note.date) + '(' + dowOf(note.date) + ') · カード' + note.cards.length
          : 'カード' + note.cards.length}
      </div>
    </div>
  );
}
