'use client';

/**
 * Compass — ノートのドリル面（docs/notebook/spec.md §8 / ワークフロー手順 5）
 *
 * 「今日のToDo」のノート復習カード →「ノートで復習」→ ここ。
 * **その授業のノートの、今日ぶんの問題だけ**が並ぶ。解答は伏せてあり、
 * 「解答を見る」で方針・解答・（あれば）解説が開き、その場で理解度を付けて次の間隔へ送る。
 *
 * 紙面はノート本体（`NoteView`）と同じ `CompassNotebook/チャートノート v2.dc.html` 由来。
 * 違うのは「1 問 1 枚」であることだけ ―― ここは読む面ではなく**解く面**なので、
 * いま解いている問題がどこまでかが分かるように、問ごとに区切りの罫を 1 本引く。
 *
 * ノートの全貌（解説・演習・疑問/連絡）は既定で畳んであり、
 * 「ノート全体を見る」で下に展開する（見たくなったら見られる、が要件）。
 *
 * 間隔の計算は `ReviewShared.completeReview` 経由で `lib/logic/reviews.ts` に一本化してある
 * （理解度モーダルと同じ道。フォークしない）。
 */

import { fmtD, fmtMD } from '../../lib/logic/dates';
import { dueCardsOfNote, worstGradeToday, type DueCard } from '../../lib/logic/noteCards';
import { sizeOfMin } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import { NOTE_GRADES, NOTE_GRADE_META, type Note } from '../../lib/model/notes';
import type { ReviewGrade } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { NoteView, RevealButton } from './NoteView';
import { recordNoteAttempt } from './NotebookPersistence';
import { completeReview } from './ReviewShared';
import { mutReview } from './ShellActions';
import { closeNoteDrill } from './ShellActions';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/**
 * 理解度 3 択。記号・文言・色は `NOTE_GRADE_META`（model/notes.ts）が持つ
 * ―― ノート面（`NoteView`）と同じものを見せるため、ここでは並べ替えるだけ。
 * ◎○△ は答案に付ける丸つけの記号そのものなので、記号を大きく見せる。
 */
const GRADES = NOTE_GRADES.map((id) => ({ id, ...NOTE_GRADE_META[id] }));

const MINI_BTN = {
  padding: '5px 11px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11.5px var(--f-ui)',
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

  const due = dueCardsOfNote(S.reviews, note, T);
  const cards = due ? due.cards : [];
  const remaining = due ? due.remaining : 0;
  const color = subjectColorFor(subjColors, note.subject);

  /**
   * 1 問に丸を付ける。
   *
   * 復習は**ノート 1 冊で 1 行**になったので、1 問ごとに間隔を進めるわけにはいかない。
   * ここでやるのは 2 つ:
   *  1. 問そのものの履歴（`NoteCard.attempts`）に「いつ・どう感じたか」を残す
   *  2. その問のミニタスク（`subs` の「問N」）を済みにする
   *
   * **最後の 1 問が済んだところで**、行そのものを完了させて次の間隔へ送る。
   * そのときの理解度は**今日つけた中でいちばん低いもの**にする ―― 5 問中 4 問できても
   * 1 問がまるで駄目なら、その単元はまだ「ばっちり」ではないので。
   */
  const grade = (dc: DueCard, g: ReviewGrade) => {
    if (!due) return;
    recordNoteAttempt(store, note.id, dc.cardId, T, g);
    const flags = (due.review.subsDone || []).slice();
    while (flags.length < cards.length) flags.push(false);
    flags[dc.cardNo - 1] = true;
    mutReview(store, due.review.id, (r) => ((r.subsDone = flags), r));

    if (flags.slice(0, cards.length).some((d) => !d)) return; // まだ残っている

    // 全部済んだ。今日つけた丸の中でいちばん低いものでこの行を送る
    const worst = worstGradeToday(store.getState().notes, note.id, T) || g;
    const row = store.getState().reviews.find((r) => r.id === due.review.id);
    if (!row) return;
    store.showToast(completeReview(store, row, worst, sizeOfMin(row.min), ctx));
  };

  const backToTodo = () => closeNoteDrill(store);

  return (
    <div className="nb-paper" style={{ animation: 'fadeUp .22s ease' }}>
      {/* ── ページ頭。ノート本体と同じ太細 2 本組 */}
      <div className="nb-masthead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button className="hv-acc-outline" onClick={backToTodo} style={MINI_BTN}>
            ← 今日のToDo
          </button>
          <span
            style={{
              font: '700 10px var(--f-ui)',
              color: color.c,
              background: color.bg,
              borderRadius: 'var(--rad-s)',
              padding: '2px 9px',
            }}
          >
            {note.subject}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ font: '700 15px var(--f-num)', color: 'var(--view)' }}>
            {cards.length - remaining + ' / ' + cards.length + ' 問'}
          </span>
          <button
            className="hv-acc-outline"
            onClick={() => store.setState({ view: 'notebook', nbMode: 'note' })}
            style={MINI_BTN}
          >
            ノートを開く
          </button>
        </div>
        <h1 className="nb-title">{note.unit}</h1>
      </div>

      {cards.length === 0 ? (
        <div style={{ marginTop: '30px' }}>
          <div style={{ font: '700 15px var(--f-disp)', color: 'var(--tx1)' }}>
            このノートの今日ぶんの復習はありません
          </div>
          <div style={{ font: '400 12.5px var(--f-ui)', color: 'var(--tx3)', marginTop: '7px' }}>
            次回は「ノートを開く」から各問の予定を確認できます。
          </div>
        </div>
      ) : null}

      {/* ── 今日ぶんの問題。問ごとに 1 本だけ区切りを引く */}
      <div style={{ display: 'grid', marginTop: '20px' }}>
        {cards.map((dc, i) => {
          const card = note.cards.find((c) => c.cardId === dc.cardId) || null;
          const key = 'd:' + note.id + ':' + dc.cardId;
          const open = !!S.nbRevealed[key];
          const done = dc.done;
          return (
            <div
              key={dc.cardId}
              style={{
                padding: '20px 0',
                borderBottom: '1px solid var(--line)',
                opacity: done ? 0.6 : 1,
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}
              >
                <span className="nb-no" style={{ marginTop: 0 }} aria-hidden="true">
                  {dc.cardNo}
                </span>
                <span style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
                  {due ? due.review.stage + 'の復習 · 第' + due.review.reviewNo + '回' : ''}
                </span>
                {/* これまでの実績。◎○△ を付けるとここに積まれる */}
                {card && card.attempts.length ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      font: '400 11px var(--f-ui)',
                      color: 'var(--tx3)',
                    }}
                    title={card.attempts
                      .map((a) => fmtMD(a.day) + ' ' + NOTE_GRADE_META[a.grade].icon)
                      .join(' / ')}
                  >
                    <span style={{ font: '700 11px var(--f-num)' }}>
                      {'これまで' + card.attempts.length + '回'}
                    </span>
                    {card.attempts.slice(-4).map((a, ai) => (
                      <span
                        key={ai}
                        style={{ color: NOTE_GRADE_META[a.grade].token, font: '400 13px/1 var(--f-disp)' }}
                      >
                        {NOTE_GRADE_META[a.grade].icon}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                {done ? (
                  <>
                    <span style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
                      {'次回 ' + nextDueLabel(S.reviews, due)}
                    </span>
                    <span
                      className="nb-maru__mark"
                      style={{ color: 'var(--grn)' }}
                      aria-label="答え合わせ済み"
                    >
                      ○
                    </span>
                  </>
                ) : null}
              </div>

              {card ? (
                <NoteMath className="nb-body" src={card.q} />
              ) : (
                <div style={{ font: '400 14px var(--f-ui)', color: 'var(--tx3)' }}>
                  {'（この問題はノートから削除されています）'}
                </div>
              )}

              {!done ? (
                <>
                  <RevealButton
                    open={open}
                    onClick={() =>
                      store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [key]: !open } }))
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
                        {card && card.guide ? (
                          <div className="nb-row">
                            <span className="nb-sub">方針</span>
                            <NoteMath
                              className="nb-body nb-body--sm"
                              style={{ flex: 1, minWidth: 0 }}
                              src={card.guide}
                            />
                          </div>
                        ) : null}
                        {card ? (
                          <div className="nb-row">
                            <span className="nb-sub">解答</span>
                            <NoteMath
                              className="nb-body"
                              style={{ flex: 1, minWidth: 0 }}
                              src={card.a}
                            />
                          </div>
                        ) : null}
                        {/* 旧・解説ブロックの「解説 / 注意」はスキーマ @2 で無くなり、
                            取り込み時にカードの `guide` へ畳まれた（model/notes.ts）。
                            ドリル面が見るのはカード 1 枚だけで完結する */}
                      </div>
                    </div>
                  </div>

                  {open ? (
                    <>
                      <div
                        style={{
                          font: '700 12.5px var(--f-ui)',
                          color: 'var(--tx2)',
                          margin: '20px 0 8px',
                        }}
                      >
                        合っていた？
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                        {GRADES.map((g) => (
                          <button
                            key={g.id}
                            className="nb-maru"
                            onClick={() => grade(dc, g.id)}
                            style={{ color: g.token }}
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
      </div>

      {cards.length && !remaining ? (
        <div style={{ marginTop: '30px', textAlign: 'center' }}>
          <div style={{ font: '700 15px var(--f-disp)', color: 'var(--grn)' }}>
            今日ぶんの復習は完了です 🎉
          </div>
          <button
            onClick={backToTodo}
            style={{
              marginTop: '12px',
              padding: '9px 20px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: '700 12px var(--f-ui)',
              cursor: 'pointer',
            }}
          >
            今日のToDoへ戻る
          </button>
        </div>
      ) : null}

      {/* ── ノートの全貌（見たくなったら開く） */}
      <div style={{ margin: '30px 0 40px' }}>
        <button
          className="hv-acc-outline"
          onClick={() => store.setState({ nbFullNote: !S.nbFullNote })}
          style={{ ...MINI_BTN, width: '100%', padding: '10px' }}
        >
          {S.nbFullNote ? '▾ ノート全体を閉じる' : '▸ ノート全体を見る（定義・解説・演習・疑問）'}
        </button>
        {S.nbFullNote ? (
          <div style={{ marginTop: '20px' }}>
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
  due: { review: { seriesId: string; id: string } } | null,
): string {
  if (!due) return '定着 🎉';
  const sid = due.review.seriesId || due.review.id;
  const next = reviews.find((r) => (r.seriesId || r.id) === sid && !r.done);
  return next ? fmtD(dateCtx, next.due) : '定着 🎉';
}
