'use client';

/**
 * Compass — 問題抽出ビュー（docs/notebook/spec.md §8 / §9）
 *
 * 下敷き: `CompassNotebook/チャートノート v2.dc.html` の `view:'extract'`。
 * 全ノートの想起問題と演習をフラットに並べ、解答は伏せたままドリルとして解く。
 * 出典行をクリックすると元のノートへ飛ぶ。
 *
 * v2 から足したのは 2 つ:
 *  - **解いたら理解度を付ける**（◎○△）。付けた記録は `NoteCard.attempts` に残る。
 *    ここは予定の外での解き直しなので、**復習の間隔には触らない**
 *    （`recordNoteAttempt` は履歴だけを足す。予定を動かすのは復習画面と ToDo の仕事）。
 *  - その記録を使った**並べ替えと絞り込み**（苦手な順 / 久しぶり順、理解度で絞る）。
 *    並べ替えの実体は `lib/logic/noteExtract.ts`（純関数）。
 *
 * v2 どおり**1 問 1 枚のカードにはしない**。枠を描くと問題どうしの切れ目が
 * 強くなりすぎて、上から順に解いていく紙面にならない。区切りは余白だけ。
 */

import { useMemo } from 'react';
import { fmtMD, longDayLabel } from '../../lib/logic/dates';
import {
  arrangeDrillItems,
  buildDrillItems,
  lastOf,
  tallyDrillItems,
  type DrillItem,
  type ExtractGradeFilter,
} from '../../lib/logic/noteExtract';
import { subjectColorFor } from '../../lib/logic/subjects';
import { NOTE_GRADE_META, type Note } from '../../lib/model/notes';
import type { NoteExtractSort, ReviewGrade } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { recordNoteAttempt } from './NotebookPersistence';
import { RevealButton } from './NoteView';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

export { buildDrillItems };

const MINI_BTN = {
  padding: '4px 9px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
} as const;

const SORTS: readonly { id: NoteExtractSort; label: string; hint: string }[] = [
  { id: 'weak', label: '苦手な順', hint: '直近の理解度が低いものから' },
  { id: 'stale', label: '久しぶり順', hint: '最後に解いた日が古いものから' },
  { id: 'note', label: 'ノート順', hint: '授業の新しい順' },
];

const FILTERS: readonly { id: ExtractGradeFilter; label: string; key: keyof ReturnType<typeof tallyDrillItems> }[] = [
  { id: null, label: 'すべて', key: 'all' },
  { id: 'none', label: '未着手', key: 'none' },
  { id: 'low', label: '△ 不安', key: 'low' },
  { id: 'mid', label: '○ まあまあ', key: 'mid' },
  { id: 'high', label: '◎ ばっちり', key: 'high' },
];

function chip(on: boolean) {
  return {
    font: (on ? '700' : '500') + ' 11px var(--f-ui)',
    color: on ? 'var(--onAcc)' : 'var(--tx2)',
    background: on ? 'var(--view)' : 'transparent',
    border: '1px solid ' + (on ? 'var(--view)' : 'var(--line2)'),
    borderRadius: 'var(--rad-s)',
    padding: '4px 10px',
    cursor: 'pointer',
  } as const;
}

/** 「3回 · 前回 8/9 ◎」。まだなら「未着手」 */
function AttemptTrail({ item }: { item: DrillItem }) {
  const last = lastOf(item);
  if (item.kind === '演習') {
    return <span style={{ font: '400 10.5px var(--f-ui)', color: 'var(--tx3)' }}>記録なし</span>;
  }
  if (!last) {
    return <span style={{ font: '400 10.5px var(--f-ui)', color: 'var(--tx3)' }}>未着手</span>;
  }
  const meta = NOTE_GRADE_META[last.grade];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        font: '400 10.5px var(--f-ui)',
        color: 'var(--tx3)',
      }}
      title={item.attempts.map((a) => fmtMD(a.day) + ' ' + NOTE_GRADE_META[a.grade].icon).join(' / ')}
    >
      <span style={{ font: '700 10.5px var(--f-num)' }}>{item.attempts.length + '回'}</span>
      <span>{'前回 ' + fmtMD(last.day)}</span>
      <span style={{ color: meta.token, font: '400 14px/1 var(--f-disp)' }}>{meta.icon}</span>
    </span>
  );
}

export function NoteExtract() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const T = dateCtx.today;

  const all = useMemo(
    () => buildDrillItems(S.notes, S.nbSubjFilter),
    [S.notes, S.nbSubjFilter],
  );
  const tally = useMemo(() => tallyDrillItems(all), [all]);
  const items = useMemo(
    () => arrangeDrillItems(all, S.nbExtractSort, S.nbExtractGrade),
    [all, S.nbExtractSort, S.nbExtractGrade],
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

  /** 出典をクリック → ノートのタブへ移って、そのノートを開く */
  const jump = (note: Note) =>
    store.setState({ view: 'notebook', nbMode: 'note', nbSelNoteId: note.id, nbEdit: false });

  /**
   * 理解度を記録する。**復習の予定は動かさない** ―― ここは予定の外の解き直しなので、
   * 間隔まで動かすと「ちょっと解いただけ」で次回が飛んでしまう。
   */
  const grade = (it: DrillItem, g: ReviewGrade) => {
    if (!it.cardId) return;
    const meta = NOTE_GRADE_META[g];
    if (recordNoteAttempt(store, it.note.id, it.cardId, T, g)) {
      store.showToast(meta.icon + ' ' + meta.label + ' として記録しました');
      // 記録したら伏せ直す。並べ替えが変わるので、次の 1 問がそのまま上に来る
      store.setState((s) => {
        const next = { ...s.nbRevealed };
        delete next[it.key];
        return { nbRevealed: next };
      });
    }
  };

  const sortHint = SORTS.find((x) => x.id === S.nbExtractSort)?.hint ?? '';

  return (
    <div style={{ maxWidth: '840px', animation: 'fadeUp .22s ease' }}>
      {/* ノート本体と同じ太細 2 本組。ここが紙面の頭だという合図 */}
      <div className="nb-masthead">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, font: '700 24px var(--f-disp)', color: 'var(--tx0)' }}>問題抽出</h1>
          <span className="nb-sec-hint">
            {items.length + ' 問 ─ ' + sortHint}
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

      {/* ── 並べ替えと絞り込み */}
      <div style={{ display: 'grid', gap: '8px', margin: '15px 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
          <span style={{ font: '700 10px var(--f-ui)', color: 'var(--tx3)', letterSpacing: '.12em' }}>
            並べ替え
          </span>
          {SORTS.map((x) => (
            <button
              key={x.id}
              onClick={() => store.setState({ nbExtractSort: x.id })}
              aria-pressed={S.nbExtractSort === x.id}
              style={chip(S.nbExtractSort === x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
          <span style={{ font: '700 10px var(--f-ui)', color: 'var(--tx3)', letterSpacing: '.12em' }}>
            理解度
          </span>
          {FILTERS.map((x) => {
            const on = S.nbExtractGrade === x.id;
            const n = tally[x.key];
            return (
              <button
                key={String(x.id)}
                onClick={() => store.setState({ nbExtractGrade: x.id })}
                aria-pressed={on}
                disabled={n === 0 && x.id !== null}
                style={{ ...chip(on), opacity: n === 0 && x.id !== null ? 0.4 : 1 }}
              >
                {x.label + ' ' + n}
              </button>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <p style={{ font: '400 13px var(--f-ui)', color: 'var(--tx3)' }}>
          条件に合う問題がありません。絞り込みを外すか、ノートを取り込んでください。
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: '30px', paddingBottom: '40px' }}>
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
                <span style={{ flex: 1 }} />
                <AttemptTrail item={it} />
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

              {/* 解答を開いたら丸つけ。演習はカードではないので記録を持たない */}
              {open && it.cardId ? (
                <div style={{ marginTop: '14px' }}>
                  <div
                    style={{
                      font: '700 11px var(--f-ui)',
                      color: 'var(--tx3)',
                      letterSpacing: '.1em',
                      marginBottom: '7px',
                    }}
                  >
                    合っていた？（記録だけ残ります・復習の予定は動きません）
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {(['low', 'mid', 'high'] as const).map((g) => {
                      const meta = NOTE_GRADE_META[g];
                      return (
                        <button
                          key={g}
                          className="nb-maru"
                          onClick={() => grade(it, g)}
                          style={{ color: meta.token }}
                        >
                          <span className="nb-maru__mark">{meta.icon}</span>
                          <span className="nb-maru__label">{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
