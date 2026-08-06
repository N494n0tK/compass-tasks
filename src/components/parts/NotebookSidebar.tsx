'use client';

/**
 * Compass — ノート画面のサイドバー（docs/notebook/spec.md §8）
 *
 * 移植元: `CompassNotebook/チャートノート v3.dc.html` の左ペイン
 * （教科ツリー / 月カレンダー）。ここに Compass 側の追加として
 * 「JSON取り込み」ボタンと「予習の自動生成」設定を同居させる。
 */

import { useMemo } from 'react';
import { dowOf, fmtMD, isoShift, monthLabel } from '../../lib/logic/dates';
import { subjectColorFor } from '../../lib/logic/subjects';
import { timetableSubjects } from '../../lib/logic/timetable';
import type { Note } from '../../lib/model/notes';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

/** 日曜始まりの曜日ヘッダ（v3 の既定） */
const DOW_HEADS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const SECTION_LABEL = {
  font: "700 10px 'Noto Sans JP'",
  color: 'var(--tx3)',
  letterSpacing: '.08em',
  margin: '0 0 8px',
} as const;

const MINI_BTN = {
  padding: '4px 8px',
  border: '1px solid var(--line2)',
  borderRadius: '7px',
  background: 'none',
  color: 'var(--tx2)',
  font: "500 11px 'Noto Sans JP'",
  cursor: 'pointer',
} as const;

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

  // ── 教科ツリー
  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    S.notes.forEach((n) => {
      const key = n.subject || 'その他';
      const list = map.get(key);
      if (list) list.push(n);
      else map.set(key, [n]);
    });
    return Array.from(map.entries());
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
        width: '260px',
        flex: '0 0 260px',
        borderRight: '1px dashed var(--line2)',
        paddingRight: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        overflow: 'auto',
      }}
    >
      <button
        onClick={() =>
          store.setState({ nbImportOpen: true, nbImportTarget: null, nbImportText: '' })
        }
        style={{
          padding: '10px 14px',
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

      <div style={{ display: 'flex', gap: '6px' }}>
        {(
          [
            { id: 'note', label: 'ノート' },
            { id: 'extract', label: '問題抽出' },
          ] as const
        ).map((m) => {
          const on = S.nbMode === m.id;
          return (
            <span
              key={m.id}
              onClick={() => store.setState({ nbMode: m.id })}
              style={{
                flex: 1,
                textAlign: 'center',
                font: "600 11.5px 'Noto Sans JP'",
                color: on ? 'var(--onAcc)' : 'var(--tx2)',
                background: on ? 'var(--view)' : 'var(--bg2)',
                border: '1px solid ' + (on ? 'var(--view)' : 'var(--line2)'),
                borderRadius: '8px',
                padding: '6px 0',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </span>
          );
        })}
      </div>

      {/* ── カレンダー */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <button
            className="hv-acc-outline"
            onClick={() => store.setState({ nbMonth: shiftMonth(month, -1) })}
            style={MINI_BTN}
          >
            ‹
          </button>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              font: "700 12px 'Space Grotesk'",
              color: 'var(--tx1)',
            }}
          >
            {month.slice(0, 4) + '年' + monthLabel(month)}
          </div>
          <button
            className="hv-acc-outline"
            onClick={() => store.setState({ nbMonth: shiftMonth(month, 1) })}
            style={MINI_BTN}
          >
            ›
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px' }}>
          {DOW_HEADS.map((d) => (
            <div
              key={d}
              style={{ textAlign: 'center', fontSize: '9.5px', color: 'var(--tx3)', padding: '2px 0' }}
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
                  fontSize: '11px',
                  padding: '4px 0 6px',
                  borderRadius: '6px',
                  position: 'relative',
                  cursor: hits.length ? 'pointer' : 'default',
                  color: selected ? 'var(--onAcc)' : hits.length ? 'var(--tx0)' : 'var(--tx3)',
                  background: selected ? 'var(--view)' : 'transparent',
                  border: '1px solid ' + (isToday && !selected ? 'var(--view)' : 'transparent'),
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
                      borderRadius: '50%',
                      background: 'var(--view)',
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 教科ツリー */}
      <div>
        <div style={SECTION_LABEL}>フォルダ</div>
        {groups.length === 0 ? (
          <div style={{ fontSize: '11.5px', color: 'var(--tx3)' }}>まだノートがありません</div>
        ) : null}
        <div style={{ display: 'grid', gap: '4px' }}>
          {groups.map(([subject, list]) => {
            const open = S.nbTreeOpen[subject] !== false; // 既定で開く
            const color = subjectColorFor(subjColors, subject);
            const filtered = S.nbSubjFilter === subject;
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
                    padding: '5px 7px',
                    borderRadius: '7px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '9px', color: 'var(--tx3)' }}>{open ? '▾' : '▸'}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      store.setState({ nbSubjFilter: filtered ? null : subject });
                    }}
                    style={{
                      font: "700 10.5px 'Noto Sans JP'",
                      color: filtered ? 'var(--onAcc)' : color.c,
                      background: filtered ? color.c : color.bg,
                      borderRadius: '99px',
                      padding: '2px 9px',
                    }}
                  >
                    {subject}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ font: "500 10px 'Space Grotesk'", color: 'var(--tx3)' }}>
                    {list.length + '件'}
                  </span>
                </div>
                {open ? (
                  <div style={{ display: 'grid', gap: '2px', paddingLeft: '16px' }}>
                    {list.map((n) => {
                      const on = n.id === S.nbSelNoteId;
                      return (
                        <div
                          key={n.id}
                          onClick={() => select(n)}
                          className="hv-bg3"
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            background: on ? 'var(--viewBg)' : 'transparent',
                            borderLeft: '2px solid ' + (on ? 'var(--view)' : 'transparent'),
                          }}
                        >
                          <div
                            style={{
                              font: "500 11.5px 'Noto Sans JP'",
                              color: on ? 'var(--tx0)' : 'var(--tx1)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {n.unit || '(単元名なし)'}
                          </div>
                          <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                            {n.date
                              ? fmtMD(n.date) + '(' + dowOf(n.date) + ') · カード' + n.cards.length
                              : 'カード' + n.cards.length}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 予習の自動生成（docs/notebook/spec.md §5） */}
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--rad)',
          background: 'var(--bg2)',
          padding: '11px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ ...SECTION_LABEL, margin: 0, flex: 1 }}>予習の自動生成</div>
          <span
            onClick={() =>
              store.setState((s) => ({
                prepAutoGen: { ...s.prepAutoGen, enabled: !s.prepAutoGen.enabled },
              }))
            }
            style={{
              font: "700 10px 'Noto Sans JP'",
              color: prep.enabled ? 'var(--onAcc)' : 'var(--tx2)',
              background: prep.enabled ? 'var(--grn)' : 'var(--bg3)',
              border: '1px solid ' + (prep.enabled ? 'var(--grn)' : 'var(--line2)'),
              borderRadius: '99px',
              padding: '2px 10px',
              cursor: 'pointer',
            }}
          >
            {prep.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--tx3)', margin: '6px 0 8px', lineHeight: 1.6 }}>
          {'起動時に、翌登校日（' +
            fmtMD(isoShift(today, 1)) +
            ' 以降の平日）の時間割から教科ごとに1件ずつ積みます'}
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {prepSubjects.map((s) => {
            const off = prep.offSubjects.indexOf(s) >= 0;
            return (
              <span
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
                style={{
                  font: "500 10px 'Noto Sans JP'",
                  color: off ? 'var(--tx3)' : 'var(--tx1)',
                  background: off ? 'transparent' : 'var(--bg3)',
                  border: '1px solid var(--line2)',
                  borderRadius: '99px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  textDecoration: off ? 'line-through' : 'none',
                  opacity: prep.enabled ? 1 : 0.45,
                }}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
