'use client';

/**
 * Compass — ノートのドリル面（docs/notebook/spec.md §8 / ワークフロー手順 5）
 *
 * 「今日のToDo」のノート復習カード →「ノートで復習」→ ここ。
 * **その授業のノートの、今日ぶんの問題だけ**が並ぶ。解答は伏せてあり、
 * 「答えを見る」で方針・解答・（あれば）解説が開き、その場で理解度を付けて次の間隔へ送る。
 *
 * ノートの全貌（解説・演習・疑問/連絡）は既定で畳んであり、
 * 「ノート全体を見る」で下に展開する（見たくなったら見られる、が要件）。
 *
 * 間隔の計算は `ReviewShared.completeReview` 経由で `lib/logic/reviews.ts` に一本化してある
 * （理解度モーダルと同じ道。フォークしない）。
 */

import { fmtD } from '../../lib/logic/dates';
import { dueCardsOfNote, type DueCard } from '../../lib/logic/noteCards';
import { sizeOfMin } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import { exBlockOf, type Note } from '../../lib/model/notes';
import type { ReviewGrade } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { NoteView } from './NoteView';
import { completeReview } from './ReviewShared';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/** 理解度 3 択。`ReviewAskModal` の `ASK_GRADES` と同じ並び・同じ色 */
const GRADES: readonly { id: ReviewGrade; icon: string; label: string; c: string; bg: string }[] = [
  { id: 'high', icon: '◎', label: 'ばっちり', c: 'var(--grn)', bg: 'var(--grnBg)' },
  { id: 'mid', icon: '○', label: 'まあまあ', c: 'var(--acc)', bg: 'var(--accBg)' },
  { id: 'low', icon: '△', label: '不安…', c: 'var(--pink)', bg: 'var(--pinkBg)' },
];

const MINI_BTN = {
  padding: '5px 11px',
  border: '1px solid var(--line2)',
  borderRadius: '8px',
  background: 'none',
  color: 'var(--tx2)',
  font: "500 11.5px 'Noto Sans JP'",
  cursor: 'pointer',
} as const;

export interface NoteDrillProps {
  note: Note;
}

export function NoteDrill({ note }: NoteDrillProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;
  const T = ctx.today;

  const cards = dueCardsOfNote(S.reviews, note, T);
  const remaining = cards.filter((c) => !c.review.done);
  const color = subjectColorFor(subjColors, note.subject);

  const grade = (dc: DueCard, g: ReviewGrade) => {
    const message = completeReview(store, dc.review, g, sizeOfMin(dc.review.min), ctx);
    store.showToast(message);
  };

  const backToTodo = () => store.setState({ view: 'todo', nbMode: 'note' });

  return (
    <div style={{ animation: 'fadeUp .22s ease', display: 'grid', gap: '14px' }}>
      {/* ── ヘッダ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--line)',
          paddingBottom: '12px',
        }}
      >
        <button className="hv-acc-outline" onClick={backToTodo} style={MINI_BTN}>
          ← 今日のToDo
        </button>
        <span
          style={{
            font: "700 10px 'Noto Sans JP'",
            color: color.c,
            background: color.bg,
            borderRadius: '99px',
            padding: '2px 9px',
          }}
        >
          {note.subject}
        </span>
        <div className="nb-hand" style={{ font: "700 17px 'Noto Sans JP'", color: 'var(--tx0)' }}>
          {note.unit}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ font: "700 12px 'Space Grotesk'", color: 'var(--view)' }}>
          {cards.length - remaining.length + ' / ' + cards.length + ' 問'}
        </span>
        <button
          className="hv-acc-outline"
          onClick={() => store.setState({ nbMode: 'note' })}
          style={MINI_BTN}
        >
          ノートを開く
        </button>
      </div>

      {cards.length === 0 ? (
        <div
          className="empty-note"
          style={{
            border: '1px dashed var(--line2)',
            borderRadius: 'var(--rad)',
            padding: '34px 24px',
            textAlign: 'center',
            color: 'var(--tx3)',
          }}
        >
          <div style={{ font: "700 14px 'Noto Sans JP'", color: 'var(--tx1)' }}>
            このノートの今日ぶんの復習はありません
          </div>
          <div style={{ fontSize: '12px', marginTop: '7px' }}>
            次回は「ノートを開く」から各問の予定を確認できます。
          </div>
        </div>
      ) : null}

      {/* ── 今日ぶんの問題 */}
      {cards.map((dc, i) => {
        const card = note.cards.find((c) => c.cardId === dc.cardId) || null;
        const key = 'd:' + note.id + ':' + dc.cardId;
        const open = !!S.nbRevealed[key];
        const ex = card ? exBlockOf(note, card.cardId) : null;
        const done = dc.review.done;
        return (
          <div
            key={dc.reviewId}
            style={{
              border: '1px solid ' + (done ? 'var(--line)' : 'var(--line2)'),
              borderLeft: '3px solid ' + (done ? 'var(--grn)' : 'var(--view)'),
              borderRadius: 'var(--rad)',
              background: 'var(--nb-card, var(--bg1))',
              padding: '14px 16px',
              opacity: done ? 0.62 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px' }}>
              <span style={{ font: "700 12px 'Space Grotesk'", color: 'var(--view)' }}>
                {dc.cardNo ? '問' + dc.cardNo : '問' + (i + 1)}
              </span>
              <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
                {dc.review.stage + 'の復習 · 第' + dc.review.reviewNo + '回'}
              </span>
              <span style={{ flex: 1 }} />
              {done ? (
                <span style={{ font: "700 11px 'Noto Sans JP'", color: 'var(--grn)' }}>
                  {'✓ 次回 ' + nextDueLabel(S.reviews, dc)}
                </span>
              ) : null}
            </div>

            {card ? (
              <NoteMath src={card.q} style={{ color: 'var(--tx0)', fontSize: '15px' }} />
            ) : (
              <div style={{ color: 'var(--tx3)', fontSize: '13px' }}>
                {dc.review.title + '（この問題はノートから削除されています）'}
              </div>
            )}

            {!done ? (
              <>
                {!open ? (
                  <button
                    onClick={() =>
                      store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [key]: true } }))
                    }
                    style={{
                      marginTop: '11px',
                      padding: '7px 16px',
                      border: '1px solid var(--line2)',
                      borderRadius: '9px',
                      background: 'var(--bg2)',
                      color: 'var(--view)',
                      font: "700 12px 'Noto Sans JP'",
                      cursor: 'pointer',
                    }}
                  >
                    答えを見る
                  </button>
                ) : (
                  <>
                    <div
                      style={{
                        borderTop: '1px dashed var(--line)',
                        marginTop: '11px',
                        paddingTop: '11px',
                        display: 'grid',
                        gap: '8px',
                      }}
                    >
                      {card && card.guide ? (
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>方針</div>
                          <NoteMath src={card.guide} style={{ color: 'var(--tx2)', fontSize: '13px' }} />
                        </div>
                      ) : null}
                      {card ? (
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>解答</div>
                          <NoteMath src={card.a} style={{ color: 'var(--tx1)', fontSize: '14px' }} />
                        </div>
                      ) : null}
                      {ex && (ex.solution || ex.caution) ? (
                        <div
                          style={{
                            background: 'var(--bg2)',
                            border: '1px solid var(--line)',
                            borderRadius: '9px',
                            padding: '9px 11px',
                            display: 'grid',
                            gap: '6px',
                          }}
                        >
                          <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>解説</div>
                          {ex.solution ? (
                            <NoteMath src={ex.solution} style={{ color: 'var(--tx1)', fontSize: '13px' }} />
                          ) : null}
                          {ex.caution ? (
                            <NoteMath src={ex.caution} style={{ color: 'var(--pink)', fontSize: '12.5px' }} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--tx3)', margin: '12px 0 6px' }}>
                      理解度は？（選ぶと次の間隔へ送られます）
                    </div>
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}
                    >
                      {GRADES.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => grade(dc, g.id)}
                          style={{
                            border: '1px solid ' + g.c,
                            borderRadius: '10px',
                            background: g.bg,
                            color: g.c,
                            padding: '9px 6px',
                            font: "700 12px 'Noto Sans JP'",
                            cursor: 'pointer',
                          }}
                        >
                          {g.icon + ' ' + g.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        );
      })}

      {cards.length && !remaining.length ? (
        <div
          style={{
            border: '1px solid var(--grn)',
            background: 'var(--grnBg)',
            borderRadius: 'var(--rad)',
            padding: '16px',
            textAlign: 'center',
          }}
        >
          <div style={{ font: "700 14px 'Noto Sans JP'", color: 'var(--grn)' }}>
            今日ぶんの復習は完了です 🎉
          </div>
          <button
            onClick={backToTodo}
            style={{
              marginTop: '11px',
              padding: '8px 18px',
              border: 'none',
              borderRadius: '9px',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: "700 12px 'Noto Sans JP'",
              cursor: 'pointer',
            }}
          >
            今日のToDoへ戻る
          </button>
        </div>
      ) : null}

      {/* ── ノートの全貌（見たくなったら開く） */}
      <div>
        <button
          className="hv-acc-outline"
          onClick={() => store.setState({ nbFullNote: !S.nbFullNote })}
          style={{ ...MINI_BTN, width: '100%', padding: '10px' }}
        >
          {S.nbFullNote ? '▾ ノート全体を閉じる' : '▸ ノート全体を見る（定義・解説・演習・疑問）'}
        </button>
        {S.nbFullNote ? (
          <div style={{ marginTop: '12px' }}>
            <NoteView note={note} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 完了した問の「次回」ラベル。同じ系列で新しく作られた未完了行を探す */
function nextDueLabel(
  reviews: readonly { seriesId: string; id: string; done: boolean; due: string }[],
  dc: DueCard,
): string {
  const sid = dc.review.seriesId || dc.review.id;
  const next = reviews.find((r) => (r.seriesId || r.id) === sid && !r.done);
  return next ? fmtD(dateCtx, next.due) : '定着 🎉';
}
