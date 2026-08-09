'use client';

/**
 * Compass — 問題抽出ビュー（docs/notebook/spec.md §8）
 *
 * 下敷き: `CompassNotebook/チャートノート v2.dc.html` の `view:'extract'`。
 * 全ノートの想起問題と演習をフラットに並べ、解答は伏せたままドリルとして解く。
 * 出典行をクリックすると元のノートへ飛ぶ。
 *
 * v2 どおり**1 問 1 枚のカードにはしない**。枠を描くと問題どうしの切れ目が
 * 強くなりすぎて、上から順に解いていく紙面にならない。区切りは余白だけ。
 */

import { useMemo } from 'react';
import { longDayLabel } from '../../lib/logic/dates';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import { NoteMath } from './NoteMath';
import { RevealButton } from './NoteView';
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

/** ノート群 → ドリル項目。空の設問は落とす（v2 と同じ） */
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
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
} as const;

export function NoteExtract() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const items = useMemo(() => buildDrillItems(S.notes, S.nbSubjFilter), [S.notes, S.nbSubjFilter]);

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
    <div style={{ maxWidth: '840px', animation: 'fadeUp .22s ease' }}>
      {/* ノート本体と同じ太細 2 本組。ここが紙面の頭だという合図 */}
      <div className="nb-masthead">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, font: '700 24px var(--f-disp)', color: 'var(--tx0)' }}>問題抽出</h1>
          <span className="nb-sec-hint">
            {'全ノートから ' + items.length + ' 問 ─ 解答は隠したまま順に'}
          </span>
          <span style={{ flex: 1 }} />
          <button className="hv-acc-outline" onClick={() => setAll(true)} style={MINI_BTN}>
            すべて開く
          </button>
          <button className="hv-acc-outline" onClick={() => setAll(false)} style={MINI_BTN}>
            すべて閉じる
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p style={{ marginTop: '20px', font: '400 13px var(--f-ui)', color: 'var(--tx3)' }}>
          条件に合う問題がありません。教科の絞り込みを外すか、ノートを取り込んでください。
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: '30px', marginTop: '20px', paddingBottom: '40px' }}>
        {items.map((it, i) => {
          const open = !!S.nbRevealed[it.key];
          const color = subjectColorFor(subjColors, it.note.subject);
          return (
            <div
              key={it.key}
              style={{
                animation: 'fadeUp .22s ease',
                animationDelay: Math.min(i * 0.04, 0.4) + 's',
                animationFillMode: 'backwards',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  marginBottom: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <span className={'nb-badge' + (it.kind === '演習' ? ' nb-badge--quiet' : '')}>
                  {it.kind}
                </span>
                <span
                  style={{
                    font: '700 10px var(--f-ui)',
                    color: color.c,
                    background: color.bg,
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 9px',
                  }}
                >
                  {it.note.subject}
                </span>
                <button className="nb-jump" onClick={() => jump(it.note)}>
                  {(it.note.date ? longDayLabel(it.note.date) + ' ／ ' : '') + it.note.unit}
                </button>
              </div>
              <NoteMath className="nb-body" src={it.q} />
              <RevealButton
                open={open}
                onClick={() =>
                  store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [it.key]: !open } }))
                }
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: open ? '1fr' : '0fr',
                  transition: 'grid-template-rows .45s cubic-bezier(.22,1,.36,1)',
                }}
              >
                <div style={{ overflow: 'hidden', minHeight: 0 }}>
                  <div className="nb-ans">
                    {it.guide ? (
                      <NoteMath className="nb-body nb-body--sm nb-body--dim" src={it.guide} />
                    ) : null}
                    <NoteMath className="nb-body" src={it.a} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
