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

/**
 * 理解度 3 択。`ReviewAskModal` の `ASK_GRADES` と同じ並び・同じ色。
 * ◎○△ は丸つけの記号そのものなので、ここでは赤ペンで大きく書いた体で見せる
 * （色は意味を運ぶので、記号の形だけを手書きに寄せて色分けは残す）。
 */
const GRADES: readonly {
  id: ReviewGrade;
  icon: string;
  label: string;
  hint: string;
  c: string;
}[] = [
  { id: 'high', icon: '◎', label: 'ばっちり', hint: '次の間隔へ', c: 'var(--grn)' },
  { id: 'mid', icon: '○', label: 'まあまあ', hint: '同じ間隔でもう一度', c: 'var(--tx1)' },
  { id: 'low', icon: '△', label: '不安…', hint: '明日もう一度', c: 'var(--nb-red)' },
];

const MINI_BTN = {
  padding: '5px 11px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: "500 11.5px var(--f-ui)",
  cursor: 'pointer',
} as const;

/** 「方針」「解答」などの細字。NoteView と同じ調子で */
const FIELD_LABEL = {
  font: "600 11px var(--f-hand)",
  color: 'var(--tx3)',
  letterSpacing: '.1em',
  marginBottom: '2px',
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
            font: "700 10px var(--f-ui)",
            color: color.c,
            background: color.bg,
            borderRadius: 'var(--rad-s)',
            padding: '2px 9px',
          }}
        >
          {note.subject}
        </span>
        <div style={{ font: "600 19px var(--f-hand)", color: 'var(--tx0)' }}>{note.unit}</div>
        <span style={{ flex: 1 }} />
        <span style={{ font: "700 15px var(--f-num)", color: 'var(--view)' }}>
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
          <div style={{ font: "700 14px var(--f-ui)", color: 'var(--tx1)' }}>
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
          /* 1 問 1 枚。答え合わせが済んだ問には赤ペンで丸がつく */
          <div
            key={dc.reviewId}
            style={{
              position: 'relative',
              // 赤シートは紙の右端まで滑って消える。そのために枠でクリップする
              overflow: 'hidden',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--rad-s)',
              background: 'var(--nb-paper)',
              padding: '14px 18px 16px',
              opacity: done ? 0.66 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '6px' }}>
              <span style={{ font: "600 14px var(--f-hand)", color: 'var(--nb-red)' }}>
                {dc.cardNo ? '問' + dc.cardNo : '問' + (i + 1)}
              </span>
              <span style={{ font: "400 11px var(--f-hand)", color: 'var(--tx3)' }}>
                {dc.review.stage + 'の復習 · 第' + dc.review.reviewNo + '回'}
              </span>
              <span style={{ flex: 1 }} />
              {done ? (
                <>
                  <span style={{ font: "400 11px var(--f-hand)", color: 'var(--tx3)' }}>
                    {'次回 ' + nextDueLabel(S.reviews, dc)}
                  </span>
                  <span
                    className="nb-maru__mark"
                    style={{ color: 'var(--nb-red)' }}
                    aria-label="答え合わせ済み"
                  >
                    ○
                  </span>
                </>
              ) : null}
            </div>

            {card ? (
              <NoteMath className="nb-write" src={card.q} />
            ) : (
              <div style={{ font: "400 14px var(--f-hand)", color: 'var(--tx3)' }}>
                {dc.review.title + '（この問題はノートから削除されています）'}
              </div>
            )}

            {!done ? (
              <>
                {/* 解答はもう書いてある。その上に赤シートがかぶっているだけ。
                    押すとシートがずれて、赤ペンの解答が出てくる。
                    先に高さが決まっているので、開いてもレイアウトが飛ばない */}
                <div className="nb-shield-wrap" style={{ marginTop: '14px' }}>
                  <div
                    aria-hidden={!open}
                    style={{ display: 'grid', gap: '10px', paddingLeft: '2px' }}
                  >
                    {card && card.guide ? (
                      <div>
                        <div style={FIELD_LABEL}>方針</div>
                        <NoteMath className="nb-write nb-write--sm" src={card.guide} />
                      </div>
                    ) : null}
                    {card ? (
                      <div>
                        <div style={FIELD_LABEL}>解答</div>
                        <NoteMath className="nb-write nb-write--red" src={card.a} />
                      </div>
                    ) : null}
                    {ex && (ex.solution || ex.caution) ? (
                      <div style={{ borderLeft: '2px solid var(--nb-rule)', paddingLeft: '12px' }}>
                        <div style={FIELD_LABEL}>解説</div>
                        {ex.solution ? (
                          <NoteMath className="nb-write nb-write--sm" src={ex.solution} />
                        ) : null}
                        {ex.caution ? (
                          <NoteMath
                            className="nb-write nb-write--sm nb-write--red"
                            src={'※ ' + ex.caution}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    className={'nb-shield' + (open ? ' is-off' : '')}
                    onClick={() =>
                      store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [key]: true } }))
                    }
                    aria-label="赤シートをずらして解答を見る"
                  >
                    赤シートをずらす →
                  </button>
                </div>

                {open ? (
                  <>
                    <div
                      style={{
                        font: "600 12px var(--f-hand)",
                        color: 'var(--tx2)',
                        margin: '16px 0 7px',
                      }}
                    >
                      合っていた？
                    </div>
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}
                    >
                      {GRADES.map((g) => (
                        <button
                          key={g.id}
                          className="nb-maru"
                          onClick={() => grade(dc, g.id)}
                          style={{ color: g.c }}
                        >
                          <span className="nb-maru__mark">{g.icon}</span>
                          <span className="nb-maru__label">{g.label}</span>
                          <span className="nb-maru__hint">{g.hint}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
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
          <div style={{ font: "700 14px var(--f-ui)", color: 'var(--grn)' }}>
            今日ぶんの復習は完了です 🎉
          </div>
          <button
            onClick={backToTodo}
            style={{
              marginTop: '11px',
              padding: '8px 18px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: "700 12px var(--f-ui)",
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
