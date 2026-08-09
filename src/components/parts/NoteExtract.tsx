'use client';

/**
 * Compass — 問題抽出ビュー（docs/notebook/spec.md §8）
 *
 * 移植元: `CompassNotebook/チャートノート v3.dc.html` の `view:'extract'`。
 * 全ノートの想起問題と演習をフラットに並べ、解答は伏せたままドリルとして解く。
 * 出典行をクリックすると元のノートへ飛ぶ。
 */

import { useMemo } from 'react';
import { longDayLabel } from '../../lib/logic/dates';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import { NoteMath } from './NoteMath';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

interface DrillItem {
  key: string;
  kind: '想起' | '演習';
  note: Note;
  q: string;
  a: string;
  guide: string;
}

/** ノート群 → ドリル項目。空の設問は落とす（v3 と同じ） */
export function buildDrillItems(notes: readonly Note[], subjFilter: string | null): DrillItem[] {
  const out: DrillItem[] = [];
  notes.forEach((note) => {
    if (subjFilter && note.subject !== subjFilter) return;
    note.cards.forEach((card) => {
      if (!card.q.trim()) return;
      out.push({
        key: 'x:r:' + note.id + ':' + card.cardId,
        kind: '想起',
        note,
        q: card.q,
        a: card.a,
        guide: card.guide,
      });
    });
    if (note.exercise.q.trim()) {
      out.push({
        key: 'x:e:' + note.id,
        kind: '演習',
        note,
        q: note.exercise.q,
        a: note.exercise.a,
        guide: '',
      });
    }
  });
  return out;
}

const MINI_BTN = {
  padding: '4px 9px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: "500 11px var(--f-ui)",
  cursor: 'pointer',
} as const;

export function NoteExtract() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const items = useMemo(
    () => buildDrillItems(S.notes, S.nbSubjFilter),
    [S.notes, S.nbSubjFilter],
  );

  const setAll = (open: boolean) =>
    store.setState((s) => {
      const next = { ...s.nbRevealed };
      items.forEach((it) => {
        if (open) next[it.key] = true;
        else delete next[it.key];
      });
      return { nbRevealed: next };
    });

  const jump = (note: Note) =>
    store.setState({ nbMode: 'note', nbSelNoteId: note.id, nbEdit: false });

  return (
    <div style={{ animation: 'fadeUp .22s ease', display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
        <div style={{ font: "700 15px var(--f-ui)", color: 'var(--tx0)' }}>問題抽出</div>
        <div style={{ fontSize: '11.5px', color: 'var(--tx3)' }}>
          {'全ノートから ' + items.length + ' 問'}
        </div>
        <span style={{ flex: 1 }} />
        <button className="hv-acc-outline" onClick={() => setAll(true)} style={MINI_BTN}>
          すべて開く
        </button>
        <button className="hv-acc-outline" onClick={() => setAll(false)} style={MINI_BTN}>
          すべて閉じる
        </button>
      </div>

      {items.length === 0 ? (
        <div
          className="empty-note"
          style={{
            border: '1px dashed var(--line2)',
            borderRadius: 'var(--rad)',
            padding: '28px',
            textAlign: 'center',
            color: 'var(--tx3)',
            fontSize: '12.5px',
          }}
        >
          条件に合う問題がありません。ノートを取り込むとここに並びます。
        </div>
      ) : null}

      {items.map((it, i) => {
        const open = !!S.nbRevealed[it.key];
        const color = subjectColorFor(subjColors, it.note.subject);
        return (
          <div
            key={it.key}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad)',
              background: 'var(--bg1)',
              padding: '13px 15px',
              animation: 'fadeUp .22s ease',
              animationDelay: Math.min(i * 0.04, 0.4) + 's',
              animationFillMode: 'backwards',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}
            >
              <span
                style={{
                  font: "700 10px var(--f-ui)",
                  color: it.kind === '想起' ? 'var(--view)' : 'var(--org)',
                  background: it.kind === '想起' ? 'var(--viewBg)' : 'var(--orgBg)',
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 9px',
                }}
              >
                {it.kind}
              </span>
              <span
                style={{
                  font: "700 10px var(--f-ui)",
                  color: color.c,
                  background: color.bg,
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 9px',
                }}
              >
                {it.note.subject}
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => jump(it.note)}
                className="hv-acc-outline"
                style={{
                  fontSize: '10.5px',
                  color: 'var(--tx3)',
                  cursor: 'pointer',
                  borderBottom: '1px dashed var(--line2)',
                }}
              >
                {(it.note.date ? longDayLabel(it.note.date) + ' ／ ' : '') + it.note.unit}
              </span>
            </div>
            <NoteMath src={it.q} style={{ color: 'var(--tx0)', fontSize: '14px' }} />
            <div
              onClick={() =>
                store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [it.key]: !open } }))
              }
              style={{
                font: "600 11px var(--f-ui)",
                color: 'var(--view)',
                cursor: 'pointer',
                marginTop: '9px',
                userSelect: 'none',
              }}
            >
              {open ? '▾ 解答を隠す' : '▸ 解答を見る'}
            </div>
            {open ? (
              <div
                style={{
                  paddingTop: '10px',
                  marginTop: '10px',
                  borderTop: '1px dashed var(--line)',
                  display: 'grid',
                  gap: '7px',
                }}
              >
                {it.guide ? (
                  <NoteMath src={it.guide} style={{ color: 'var(--tx2)', fontSize: '12.5px' }} />
                ) : null}
                <NoteMath src={it.a} style={{ color: 'var(--tx1)', fontSize: '13.5px' }} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
