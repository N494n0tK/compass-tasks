'use client';

/**
 * Compass — ノート 1 冊の表示・編集（docs/notebook/spec.md §8）
 *
 * 紙割りは**コーネル式**（spec §8.2）。上から順に:
 *
 *   ┌ マストヘッド ───────────────────────────┐
 *   │ 想起問題（この授業で答えられるようになる問い） │
 *   ├─ キュー欄 ─┬─ 本文 ────────────────────┤
 *   │ 重要語     │ 定義・例題の解説                │
 *   │ （その語が │                               │
 *   │  出てくる  │                               │
 *   │  高さに）  │                               │
 *   ├───────────┴───────────────────────────┤
 *   │ まとめ（授業 1 回を自分の言葉で数行）        │
 *   └────────────────────────────────────────┘
 *
 * コーネル式の 3 つの約束と、この画面での対応:
 *  - **問いを立てるのは自分**  … `card.origin === 'self'` の想起問題を「自作」として先に出す。
 *    AI が補った問いは控えめな版を張る（`NotePrompts` が自作を優先して拾う）。
 *  - **疑問は自分のもの**      … `note.doubt` は自分がノートに書いた疑問だけ。AI に作らせない。
 *  - **左を見て思い出す**      … 確認モード（`nbCheck`）で本文の重要語が付箋で伏せられる。
 *    キュー欄だけを頼りに思い出し、クリックで 1 枚ずつ剥がす。
 *
 * 付箋の開閉は **DOM のクラス付け替えでやる**（`.nb-key.is-hidden` を外すだけ）。
 * state に入れると重要語 1 枚めくるたびに本文の HTML を作り直すことになり、
 * そのたび KaTeX が走る。逆に「全部伏せ直す」はクラスを付け直すだけで済む。
 *
 * 紙面の下敷きは `CompassNotebook/チャートノート v2.dc.html`（Broadsheet DS）のまま。
 * 罫を刷るのはマストヘッド・キュー欄の縦罫・まとめの上罫の 3 か所だけに絞ってある。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { fmtD, fmtMD, longDayLabel } from '../../lib/logic/dates';
import { noteSeriesId } from '../../lib/logic/noteCards';
import { assignCues, blockSearchText } from '../../lib/logic/noteKeywords';
import { timetableSubjects } from '../../lib/logic/timetable';
import { canAddToToday, isAddedToToday } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import {
  NOTE_CARD_MAX,
  NOTE_GRADE_META,
  NOTE_KEYWORD_MAX,
  NOTE_KEY_COLORS,
  NOTE_KEY_COLOR_MEANING,
  NOTE_SUBJECT_OTHER,
  type Note,
  type NoteBlock,
  type NoteCard,
  type NoteKeyColor,
  type NoteKeyword,
  lastAttemptOf,
} from '../../lib/model/notes';
import type { Review } from '../../lib/model/types';
import { NoteMath, NoteMathInline, type NoteMarkOptions } from './NoteMath';
import { commitNote, removeNote } from './NotebookPersistence';
import { addToOrder, mutReview } from './ShellActions';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

const INPUT: CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  padding: '8px 10px',
  color: 'var(--tx1)',
  font: '400 13px var(--f-ui)',
  lineHeight: 1.8,
  outline: 'none',
  resize: 'vertical',
};

const MINI_BTN: CSSProperties = {
  padding: '4px 9px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
};

/** 開閉のアニメーション（v2 の `wrapSt`。grid-template-rows で高さを補間する） */
function wrapStyle(open: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    transition: 'grid-template-rows .45s cubic-bezier(.22,1,.36,1)',
  };
}

const WRAP_INNER: CSSProperties = { overflow: 'hidden', minHeight: 0 };

/** `▸ 解答を見る` / `▾ 解答を隠す`（v2 の `ansPack`） */
export function RevealButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="nb-open" onClick={onClick} aria-expanded={open}>
      <span className={'nb-caret' + (open ? ' is-open' : '')} aria-hidden="true">
        ▸
      </span>
      {open ? '解答を隠す' : '解答を見る'}
    </button>
  );
}

/** セクションの見出し。版（`.nb-badge`）+ 名前 + ひとこと */
function SectionHead({
  badge,
  title,
  hint,
  tone,
}: {
  badge: string;
  title?: string;
  hint: string;
  tone?: 'quiet' | 'warn';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        flexWrap: 'wrap',
        marginBottom: '16px',
      }}
    >
      <span className={'nb-badge' + (tone ? ' nb-badge--' + tone : '')}>{badge}</span>
      {title ? <span className="nb-sec-title">{title}</span> : null}
      <span className="nb-sec-hint">{hint}</span>
    </div>
  );
}

/** 小札 + 本文の 1 行（「方針」「解答」「注意」） */
function SubRow({
  label,
  warn,
  children,
}: {
  label: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="nb-row">
      <span className={'nb-sub' + (warn ? ' nb-sub--warn' : '')}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * 解いた記録の 1 行表示（「3回 · 前回 8/9 ◎」）。
 * ホバーで全部の履歴（日付 + 記号）が出る。
 */
function CardTrail({ card }: { card: Pick<NoteCard, 'attempts'> }) {
  const last = lastAttemptOf(card);
  if (!last) {
    return <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>未着手</span>;
  }
  const meta = NOTE_GRADE_META[last.grade];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '10.5px',
        color: 'var(--tx3)',
      }}
      title={card.attempts
        .map((a) => fmtMD(a.day) + ' ' + NOTE_GRADE_META[a.grade].icon)
        .join(' / ')}
    >
      <span style={{ font: '700 10.5px var(--f-num)' }}>{card.attempts.length + '回'}</span>
      <span>{'前回 ' + fmtMD(last.day)}</span>
      <span style={{ color: meta.token, font: '400 14px/1 var(--f-disp)' }}>{meta.icon}</span>
    </span>
  );
}

export interface NoteViewProps {
  note: Note;
}

export function NoteView({ note }: NoteViewProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;
  const T = ctx.today;
  const edit = S.nbEdit;
  // 編集中は伏せない（伏せた語を書き換えられない）
  const check = S.nbCheck && !edit;
  const subjColor = subjectColorFor(subjColors, note.subject);

  /** ノートを書き換えて保存する（復習の生成・同期も `commitNote` が面倒を見る） */
  const patch = (fn: (draft: Note) => void, removedCardIds?: string[]) => {
    const draft: Note = JSON.parse(JSON.stringify(note));
    fn(draft);
    draft.updatedAt = T;
    commitNote(store, draft, T, { removedCardIds, debounce: !removedCardIds });
  };

  const isOpen = (key: string) => !!S.nbRevealed[key] || edit;
  const toggle = (key: string) =>
    store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [key]: !s.nbRevealed[key] } }));

  /** 「復習」ボタン: このノートの解答をすべて閉じる（v2 の `v.review`） */
  const closeAll = () => {
    store.setState((s) => {
      const next = { ...s.nbRevealed };
      note.cards.forEach((c) => delete next['r:' + note.id + ':' + c.cardId]);
      delete next['e:' + note.id];
      return { nbRevealed: next, nbEdit: false };
    });
  };

  const del = () => {
    if (!window.confirm('このノートと、未完了の復習カードを削除しますか？')) return;
    const removed = removeNote(store, note.id);
    store.showToast(
      '「' + note.unit + '」を削除しました' + (removed ? '(復習カード' + removed + '件も削除)' : ''),
    );
  };

  const overwrite = () =>
    store.setState({ nbImportOpen: true, nbImportTarget: note.id, nbImportText: '' });

  // ── 各カードの復習状態
  const reviewOf = (cardId: string): { pending: Review | null; done: boolean } => {
    const sid = noteSeriesId(note.id, cardId);
    let pending: Review | null = null;
    let done = false;
    S.reviews.forEach((r) => {
      if ((r.seriesId || r.id) !== sid) return;
      if (r.done) done = true;
      else if (!pending || r.due < pending.due) pending = r;
    });
    return { pending, done };
  };

  const addToToday = (r: Review) => {
    mutReview(store, r.id, (x) => ((x.added = true), x));
    addToOrder(store, r.id);
    store.showToast('「' + r.title + '」を今日のToDoに追加しました');
  };

  /** 想起問題 → その解説ブロックへ滑らかに送る（v2 の `goExplain`） */
  const jumpToBlock = (cardId: string) => {
    const el = document.querySelector('[data-block-card="' + cardId + '"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── 重要語。本文だけ伏せ、想起問題やまとめは色を付けるにとどめる
  const markBody = useMemo<NoteMarkOptions | undefined>(
    () => (note.keywords.length ? { keywords: note.keywords, mask: check } : undefined),
    [note.keywords, check],
  );
  const markPlain = useMemo<NoteMarkOptions | undefined>(
    () => (note.keywords.length ? { keywords: note.keywords } : undefined),
    [note.keywords],
  );
  const cues = useMemo(() => assignCues(note.blocks, note.keywords), [note.blocks, note.keywords]);

  // 教科は時間割の名前に揃える。いま付いている名前が一覧に無ければ、それも候補に残す
  // （選び直せないと直せなくなるため）
  const subjectChoices = useMemo(() => {
    const list = timetableSubjects().concat([NOTE_SUBJECT_OTHER]);
    return list.indexOf(note.subject) < 0 && note.subject ? list.concat([note.subject]) : list;
  }, [note.subject]);
  const offTimetable = !!note.subject && timetableSubjects().indexOf(note.subject) < 0
    && note.subject !== NOTE_SUBJECT_OTHER;

  // ── 付箋。DOM のクラスだけで開け閉めする（本文の HTML は作り直さない）
  //
  // ⚠ めくった枚数を `useState` に置くと、1 枚めくるたびに NoteView が再レンダーされ、
  //   `dangerouslySetInnerHTML` が貼り直されて**さっき剥がした付箋が戻る**。
  //   数えるのも表示も ref で行い、確認モード中は React を一切走らせない。
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const countRef = useRef<HTMLSpanElement | null>(null);
  const hintRef = useRef<HTMLSpanElement | null>(null);
  const tally = useRef({ peeled: 0, hidable: 0 });

  const allKeys = useCallback(
    (): HTMLElement[] =>
      bodyRef.current ? Array.from(bodyRef.current.querySelectorAll<HTMLElement>('.nb-key')) : [],
    [],
  );

  /** 操作卓の「3 / 13」と一言を書き換える（再レンダーを起こさない） */
  const paintTally = useCallback(() => {
    const { peeled, hidable } = tally.current;
    if (countRef.current) countRef.current.textContent = peeled + ' / ' + hidable;
    if (hintRef.current) {
      hintRef.current.textContent =
        hidable && peeled >= hidable
          ? '全部めくりました。伏せ直してもう一周できます'
          : 'キュー欄（左）を見て思い出してから、付箋をクリックしてめくる';
    }
  }, []);

  // 確認モードに入る / 本文が変わるたびに数え直し、めくった枚数を 0 に戻す
  useEffect(() => {
    tally.current = { peeled: 0, hidable: check ? allKeys().length : 0 };
    paintTally();
  }, [check, note, allKeys, paintTally]);

  const peelOne = (el: HTMLElement) => {
    if (!el.classList.contains('is-hidden')) return;
    el.classList.remove('is-hidden');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    tally.current.peeled += 1;
    paintTally();
  };

  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!check) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.nb-key.is-hidden');
    if (el) peelOne(el);
  };

  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!check || (e.key !== 'Enter' && e.key !== ' ')) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.nb-key.is-hidden');
    if (!el) return;
    e.preventDefault();
    peelOne(el);
  };

  const peelAll = () => {
    allKeys().forEach(peelOne);
  };

  const hideAll = () => {
    allKeys().forEach((el) => {
      el.classList.add('is-hidden');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '伏せた重要語。開くにはクリック');
    });
    tally.current.peeled = 0;
    paintTally();
  };

  const enterCheck = () => {
    if (check) {
      store.setState({ nbCheck: false });
      return;
    }
    if (!note.keywords.length) {
      store.showToast('このノートには重要語が登録されていません（編集から追加できます）');
      return;
    }
    store.setState({ nbCheck: true, nbEdit: false });
  };

  const doubtLines = note.doubt.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <article style={{ maxWidth: '880px', animation: 'fadeUp .22s ease' }}>
      {/* ── ページ頭。罫を刷るのはここだけ */}
      <header className="nb-masthead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {edit ? (
            <input
              className="fc-acc"
              type="date"
              value={note.date}
              onChange={(e) => patch((d) => void (d.date = e.target.value))}
              style={{ ...INPUT, width: 'auto', font: '500 12px var(--f-num)' }}
            />
          ) : (
            <span className="nb-dateline">
              {note.date ? note.date.slice(0, 4) + '年' + longDayLabel(note.date) : '日付なし'}
            </span>
          )}
          <span style={{ color: 'var(--tx3)' }}>・</span>
          <span
            style={{
              font: '700 10px var(--f-ui)',
              color: subjColor.c,
              background: subjColor.bg,
              borderRadius: 'var(--rad-s)',
              padding: '2px 9px',
            }}
          >
            {note.subject}
          </span>
          {/* 時間割の教科名と食い違っていると、色も予習の突き合わせもズレる */}
          {offTimetable ? (
            <span
              className="nb-badge nb-badge--warn"
              title={'時間割の教科名（' + timetableSubjects().join(' / ') + '）に直すと、色と予習がそろいます'}
            >
              時間割にない教科
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <button
            className="hv-acc-outline"
            onClick={enterCheck}
            style={{
              ...MINI_BTN,
              ...(check ? { borderColor: 'var(--view)', color: 'var(--view)' } : null),
            }}
            title="本文の重要語を伏せて、キュー欄だけで思い出す"
            aria-pressed={check}
          >
            {check ? '✓ 確認モード' : '確認モード'}
          </button>
          <button className="hv-acc-outline" onClick={closeAll} style={MINI_BTN} title="解答をすべて閉じて復習">
            復習
          </button>
          <button
            className="hv-acc-outline"
            onClick={() => store.setState({ nbEdit: !edit, nbCheck: false })}
            style={{
              ...MINI_BTN,
              ...(edit ? { borderColor: 'var(--view)', color: 'var(--view)' } : null),
            }}
          >
            {edit ? '✓ 完了' : '編集'}
          </button>
          <button className="hv-acc-outline" onClick={overwrite} style={MINI_BTN}>
            JSONで上書き
          </button>
          <button className="hv-pink-text" onClick={del} style={MINI_BTN}>
            削除
          </button>
        </div>
        {edit ? (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '10px' }}>
            {subjectChoices.map((s) => {
              const on = note.subject === s;
              return (
                <button
                  key={s}
                  onClick={() => patch((d) => void (d.subject = s))}
                  style={{
                    font: '600 11px var(--f-ui)',
                    color: on ? 'var(--onAcc)' : 'var(--tx2)',
                    background: on ? 'var(--view)' : 'transparent',
                    border: '1px solid ' + (on ? 'var(--view)' : 'var(--line2)'),
                    borderRadius: 'var(--rad-s)',
                    padding: '4px 11px',
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        ) : null}
        {edit ? (
          <input
            className="fc-acc-glow"
            value={note.unit}
            onChange={(e) => patch((d) => void (d.unit = e.target.value))}
            placeholder="単元名"
            style={{ ...INPUT, marginTop: '10px', font: '700 22px var(--f-disp)' }}
          />
        ) : (
          <h1 className="nb-title">{note.unit || '(単元名なし)'}</h1>
        )}
      </header>

      {/* ── 確認モードの操作卓。伏せた枚数と、めくった枚数 */}
      {check ? (
        <div className="nb-checkbar" role="status" aria-live="polite">
          <span className="nb-checkbar__count" ref={countRef} />
          <span className="nb-checkbar__text" ref={hintRef} />
          <span style={{ flex: 1 }} />
          <button className="hv-acc-outline" onClick={peelAll} style={MINI_BTN}>
            全部めくる
          </button>
          <button className="hv-acc-outline" onClick={hideAll} style={MINI_BTN}>
            伏せ直す
          </button>
        </div>
      ) : null}

      {/* ── 想起（コーネル式の上段）。自分で立てた問いを先に */}
      <section style={{ marginTop: '30px' }}>
        <SectionHead
          badge="想起"
          title="想起問題"
          hint="解答を隠したまま思い出してから開く"
        />
        <div style={{ display: 'grid', gap: '20px' }}>
          {note.cards.map((card, i) => {
            const key = 'r:' + note.id + ':' + card.cardId;
            const open = isOpen(key);
            const { pending, done } = reviewOf(card.cardId);
            const hasExplain = note.blocks.some((b) => b.t === 'ex' && b.cardId === card.cardId);
            return (
              <div key={card.cardId} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <span className="nb-no" aria-hidden="true">
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '3px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      className={'nb-origin' + (card.origin === 'self' ? ' nb-origin--self' : '')}
                      title={
                        card.origin === 'self'
                          ? 'ノートに自分で書いた問い'
                          : 'AIが授業から補った問い'
                      }
                    >
                      {card.origin === 'self' ? '自作' : 'AI'}
                    </span>
                    {edit ? (
                      <button
                        className="nb-jump"
                        onClick={() =>
                          patch(
                            (d) =>
                              void (d.cards[i].origin =
                                d.cards[i].origin === 'self' ? 'ai' : 'self'),
                          )
                        }
                      >
                        {card.origin === 'self' ? 'AI作にする' : '自作にする'}
                      </button>
                    ) : null}
                  </div>
                  {edit ? (
                    <textarea
                      className="fc-acc"
                      value={card.q}
                      onChange={(e) => patch((d) => void (d.cards[i].q = e.target.value))}
                      placeholder="問題文(数式は $...$ で LaTeX)"
                      style={{ ...INPUT, minHeight: '52px' }}
                    />
                  ) : (
                    <NoteMath className="nb-body" src={card.q} mark={markPlain} />
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <RevealButton open={open} onClick={() => toggle(key)} />
                    {/* この問題を何回やって、前回どう感じたか（`NoteCard.attempts`）。
                        復習の「次回」は予定、こちらは実績 */}
                    <CardTrail card={card} />
                    <span style={{ flex: 1 }} />
                    {pending ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
                        {'次回 ' + fmtD(ctx, pending.due) + ' · ' + pending.stage}
                      </span>
                    ) : done ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--grn)' }}>定着 🎉</span>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>復習カードなし</span>
                    )}
                    {pending && canAddToToday(pending, T) ? (
                      <button
                        className="hv-acc-outline"
                        onClick={() => addToToday(pending)}
                        style={{ ...MINI_BTN, padding: '3px 8px' }}
                      >
                        ＋ 今日へ
                      </button>
                    ) : pending && isAddedToToday(pending) ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--grn)' }}>✓ 追加済み</span>
                    ) : null}
                  </div>

                  <div style={wrapStyle(open)}>
                    <div style={WRAP_INNER}>
                      <div className="nb-ans">
                        {edit || card.guide ? (
                          <SubRow label="方針">
                            {edit ? (
                              <textarea
                                className="fc-acc"
                                value={card.guide}
                                onChange={(e) =>
                                  patch((d) => void (d.cards[i].guide = e.target.value))
                                }
                                placeholder="方針(どう考えるか)"
                                style={{ ...INPUT, minHeight: '44px' }}
                              />
                            ) : (
                              <NoteMath
                                className="nb-body nb-body--sm"
                                src={card.guide}
                                mark={markPlain}
                              />
                            )}
                          </SubRow>
                        ) : null}
                        <SubRow label="解答">
                          {edit ? (
                            <textarea
                              className="fc-acc"
                              value={card.a}
                              onChange={(e) => patch((d) => void (d.cards[i].a = e.target.value))}
                              placeholder="解答(表示数式は $$...$$)"
                              style={{ ...INPUT, minHeight: '52px' }}
                            />
                          ) : (
                            <NoteMath className="nb-body" src={card.a} mark={markPlain} />
                          )}
                        </SubRow>
                        {edit ? (
                          <input
                            className="fc-acc"
                            value={card.src}
                            onChange={(e) => patch((d) => void (d.cards[i].src = e.target.value))}
                            placeholder="出典(任意)"
                            style={{ ...INPUT, font: '400 11.5px var(--f-ui)' }}
                          />
                        ) : card.src ? (
                          <div style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
                            {'出典: ' + card.src}
                          </div>
                        ) : null}
                        {!edit && hasExplain ? (
                          <div>
                            <button className="nb-jump" onClick={() => jumpToBlock(card.cardId)}>
                              解説へ ↓
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                {edit ? (
                  <button
                    className="hv-pink-text"
                    onClick={() => {
                      if (note.cards.length <= 1) {
                        store.showToast('想起問題は1問以上必要です');
                        return;
                      }
                      if (!window.confirm('この想起問題と、その復習カードを削除しますか？')) return;
                      patch((d) => {
                        d.cards.splice(i, 1);
                        d.blocks = d.blocks.map((b) =>
                          b.t === 'ex' && b.cardId === card.cardId ? { ...b, cardId: null } : b,
                        );
                      }, [card.cardId]);
                    }}
                    style={{ ...MINI_BTN, flex: 'none' }}
                  >
                    削除
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {edit ? (
          <button
            className="hv-acc-outline"
            onClick={() => {
              if (note.cards.length >= NOTE_CARD_MAX) {
                store.showToast('想起問題は' + NOTE_CARD_MAX + '問までです');
                return;
              }
              patch((d) => {
                d.cards.push({
                  cardId: 'c' + Date.now().toString(36) + d.cards.length.toString(36),
                  q: '',
                  a: '',
                  guide: '',
                  src: '',
                  // 編集画面から足す問いは、当然「自分で立てた問い」
                  origin: 'self',
                  attempts: [],
                });
              });
            }}
            style={{ ...MINI_BTN, marginTop: '15px' }}
          >
            ＋ 自分で想起問題を足す
          </button>
        ) : null}
      </section>

      {/* ── 重要語の編集（編集モードだけ。読むときはキュー欄がそれにあたる） */}
      {edit ? <KeywordEditor note={note} onPatch={patch} /> : null}

      {/* ── 本文。左のキュー欄と 1 本の縦罫で仕切る（コーネル式） */}
      {note.blocks.length || edit ? (
        <section style={{ marginTop: '30px' }}>
          <SectionHead
            badge="本文"
            title="ノート"
            hint={
              note.keywords.length
                ? '左のキュー欄には、その場所で出てくる重要語'
                : '定義と、想起問題の解説'
            }
          />
          <div
            ref={bodyRef}
            className={
              'nb-cornell' +
              (note.keywords.length ? '' : ' is-flat') +
              (check ? ' is-check' : '')
            }
            onClick={onBodyClick}
            onKeyDown={onBodyKeyDown}
          >
            {note.blocks.map((block, bi) => (
              <NoteBlockRow
                key={bi}
                note={note}
                block={block}
                index={bi}
                edit={edit}
                onPatch={patch}
                cueIndexes={cues.perBlock[bi] || []}
                mark={markBody}
              />
            ))}
            {cues.orphans.length ? (
              <>
                <div className="nb-cue">
                  <CueList note={note} indexes={cues.orphans} />
                </div>
                <div className="nb-sec-hint" style={{ alignSelf: 'center' }}>
                  本文には出てこない語（キュー欄だけに出す）
                </div>
              </>
            ) : null}
          </div>
          {edit ? (
            <div style={{ display: 'flex', gap: '7px', marginTop: '15px' }}>
              <button
                className="hv-acc-outline"
                onClick={() =>
                  patch((d) => void d.blocks.push({ t: 'def', title: '定義', body: '' }))
                }
                style={MINI_BTN}
              >
                ＋ 定義
              </button>
              <button
                className="hv-acc-outline"
                onClick={() =>
                  patch(
                    (d) =>
                      void d.blocks.push({
                        t: 'ex',
                        cardId: d.cards[0]?.cardId ?? null,
                        guide: '',
                        solution: '',
                        caution: '',
                      }),
                  )
                }
                style={MINI_BTN}
              >
                ＋ 問の解説
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── まとめ（コーネル式の下段）。紙面いっぱいの上罫で本文と切る */}
      {note.summary || edit ? (
        <section className="nb-summary">
          <SectionHead
            badge="まとめ"
            hint="この授業 1 回を、自分の言葉で数行に"
          />
          {edit ? (
            <textarea
              className="fc-acc"
              value={note.summary}
              onChange={(e) => patch((d) => void (d.summary = e.target.value))}
              placeholder="この授業でいちばん大事だったことを 3〜5 行で"
              style={{ ...INPUT, minHeight: '92px' }}
            />
          ) : (
            <NoteMath className="nb-body nb-summary__body" src={note.summary} mark={markPlain} />
          )}
        </section>
      ) : null}

      {/* ── 演習 */}
      {note.exercise.q || edit ? (
        <section style={{ marginTop: '30px' }}>
          <SectionHead badge="演習" hint="その場で 1 問、手を動かして解く" />
          {edit ? (
            <textarea
              className="fc-acc"
              value={note.exercise.q}
              onChange={(e) => patch((d) => void (d.exercise.q = e.target.value))}
              placeholder="演習問題"
              style={{ ...INPUT, minHeight: '52px' }}
            />
          ) : (
            <NoteMath className="nb-body" src={note.exercise.q} mark={markPlain} />
          )}
          <RevealButton
            open={isOpen('e:' + note.id)}
            onClick={() => toggle('e:' + note.id)}
          />
          <div style={wrapStyle(isOpen('e:' + note.id))}>
            <div style={WRAP_INNER}>
              <div className="nb-ans">
                {edit ? (
                  <textarea
                    className="fc-acc"
                    value={note.exercise.a}
                    onChange={(e) => patch((d) => void (d.exercise.a = e.target.value))}
                    placeholder="解答"
                    style={{ ...INPUT, minHeight: '60px' }}
                  />
                ) : (
                  <NoteMath className="nb-body" src={note.exercise.a} mark={markPlain} />
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── 疑問 / 連絡。授業の中身ではなく自分の書き足しなので、版は張らない */}
      {note.doubt || note.notice || edit ? (
        <section
          style={{
            marginTop: '30px',
            paddingBottom: '40px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
            gap: '30px',
          }}
        >
          {note.doubt || edit ? (
            <div>
              <SectionHead badge="疑問" hint="自分がノートに書いた疑問（1行1件）" tone="warn" />
              {edit ? (
                <textarea
                  className="fc-acc"
                  value={note.doubt}
                  onChange={(e) => patch((d) => void (d.doubt = e.target.value))}
                  placeholder={'授業中に引っかかったことを 1 行ずつ\n（ここはAIに書かせない欄）'}
                  style={{ ...INPUT, minHeight: '68px' }}
                />
              ) : (
                <ul className="nb-doubt">
                  {doubtLines.map((line, i) => (
                    <li key={i}>
                      <NoteMath className="nb-body nb-body--sm" src={line} mark={markPlain} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {note.notice || edit ? (
            <div>
              <SectionHead badge="連絡" hint="提出物・テスト範囲など" tone="quiet" />
              {edit ? (
                <textarea
                  className="fc-acc"
                  value={note.notice}
                  onChange={(e) => patch((d) => void (d.notice = e.target.value))}
                  placeholder="提出物・テスト範囲など"
                  style={{ ...INPUT, minHeight: '68px' }}
                />
              ) : (
                <NoteMath className="nb-body nb-body--sm" src={note.notice} />
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// キュー欄（左段）
// ─────────────────────────────────────────────────────────────

/** キュー欄に並ぶ重要語。色は本文の色と同じ（`.nb-key--<color>` を共有する） */
function CueList({ note, indexes }: { note: Note; indexes: readonly number[] }) {
  return (
    <>
      {indexes.map((ki) => {
        const kw = note.keywords[ki];
        if (!kw) return null;
        // 語にもひとことにも $…$ が入りうる（教科によっては記号そのものが重要語）
        return (
          <div key={ki} className="nb-cue-item">
            <NoteMathInline className={'nb-cue-term nb-key--' + kw.color} src={kw.term} />
            {kw.note ? <NoteMathInline className="nb-cue-note" src={kw.note} /> : null}
          </div>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 重要語の編集
// ─────────────────────────────────────────────────────────────

function KeywordEditor({
  note,
  onPatch,
}: {
  note: Note;
  onPatch: (fn: (draft: Note) => void) => void;
}) {
  const haystack = useMemo(() => note.blocks.map(blockSearchText).join('\n'), [note.blocks]);

  const setKw = (i: number, fn: (kw: NoteKeyword) => void) =>
    onPatch((d) => {
      const kw = d.keywords[i];
      if (kw) fn(kw);
    });

  return (
    <section style={{ marginTop: '30px' }}>
      <SectionHead
        badge="重要語"
        hint="本文で色が付き、キュー欄に並び、確認モードで伏せられる"
        tone="quiet"
      />
      <div style={{ display: 'grid', gap: '8px' }}>
        {note.keywords.map((kw, i) => {
          const missing = !!kw.term && !haystack.includes(kw.term);
          return (
            <div
              key={i}
              style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}
            >
              <input
                className="fc-acc"
                value={kw.term}
                onChange={(e) => setKw(i, (k) => void (k.term = e.target.value))}
                placeholder="重要語(本文と1文字も違えない)"
                style={{
                  ...INPUT,
                  flex: '1 1 180px',
                  width: 'auto',
                  font: '700 13px var(--f-ui)',
                  borderColor: missing ? 'var(--pink)' : 'var(--line2)',
                }}
              />
              <select
                className="fc-acc"
                value={kw.color}
                onChange={(e) => setKw(i, (k) => void (k.color = e.target.value as NoteKeyColor))}
                style={{ ...INPUT, width: 'auto', flex: 'none', font: '400 11.5px var(--f-ui)' }}
              >
                {NOTE_KEY_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {NOTE_KEY_COLOR_MEANING[c]}
                  </option>
                ))}
              </select>
              <input
                className="fc-acc"
                value={kw.note}
                onChange={(e) => setKw(i, (k) => void (k.note = e.target.value))}
                placeholder="ひとこと(任意)"
                style={{ ...INPUT, flex: '1 1 140px', width: 'auto', font: '400 11.5px var(--f-ui)' }}
              />
              <button
                className="hv-pink-text"
                onClick={() => onPatch((d) => void d.keywords.splice(i, 1))}
                style={{ ...MINI_BTN, flex: 'none' }}
              >
                削除
              </button>
              {missing ? (
                <div style={{ flexBasis: '100%', font: '400 10.5px var(--f-ui)', color: 'var(--pink)' }}>
                  本文に見当たりません（キュー欄には出ますが、色は付きません）
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        className="hv-acc-outline"
        onClick={() => {
          if (note.keywords.length >= NOTE_KEYWORD_MAX) {
            store.showToast('重要語は' + NOTE_KEYWORD_MAX + '語までです');
            return;
          }
          onPatch((d) => void d.keywords.push({ term: '', color: 'red', note: '' }));
        }}
        style={{ ...MINI_BTN, marginTop: '12px' }}
      >
        ＋ 重要語
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 解説ブロック 1 個（キュー欄 + 本文の 2 セル）
// ─────────────────────────────────────────────────────────────

function NoteBlockRow({
  note,
  block,
  index,
  edit,
  onPatch,
  cueIndexes,
  mark,
}: {
  note: Note;
  block: NoteBlock;
  index: number;
  edit: boolean;
  onPatch: (fn: (draft: Note) => void) => void;
  cueIndexes: readonly number[];
  mark: NoteMarkOptions | undefined;
}) {
  const card: NoteCard | null =
    block.t === 'ex' && block.cardId
      ? note.cards.find((c) => c.cardId === block.cardId) || null
      : null;
  const cardNo = card ? note.cards.indexOf(card) + 1 : null;

  const move = (delta: number) =>
    onPatch((d) => {
      const to = index + delta;
      if (to < 0 || to >= d.blocks.length) return;
      const [b] = d.blocks.splice(index, 1);
      d.blocks.splice(to, 0, b);
    });

  return (
    <>
      {/* 左段。この本文で初めて出てくる重要語だけを置く */}
      <div className="nb-cue">
        <CueList note={note} indexes={cueIndexes} />
      </div>

      {/* 右段（本文） */}
      <div data-block-card={block.t === 'ex' ? (block.cardId ?? undefined) : undefined}>
        {edit ? (
          <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', marginBottom: '5px' }}>
            {block.t === 'ex' ? (
              <select
                className="fc-acc"
                value={block.cardId ?? ''}
                onChange={(e) =>
                  onPatch((d) => {
                    const b = d.blocks[index];
                    if (b.t === 'ex') b.cardId = e.target.value || null;
                  })
                }
                style={{ ...INPUT, width: 'auto', padding: '4px 8px', font: '400 11px var(--f-ui)' }}
              >
                <option value="">対象なし</option>
                {note.cards.map((c, i) => (
                  <option key={c.cardId} value={c.cardId}>
                    {'問' + (i + 1)}
                  </option>
                ))}
              </select>
            ) : null}
            <button className="hv-acc-outline" onClick={() => move(-1)} style={MINI_BTN} aria-label="上へ">
              ↑
            </button>
            <button className="hv-acc-outline" onClick={() => move(1)} style={MINI_BTN} aria-label="下へ">
              ↓
            </button>
            <button
              className="hv-pink-text"
              onClick={() => onPatch((d) => void d.blocks.splice(index, 1))}
              style={MINI_BTN}
            >
              削除
            </button>
          </div>
        ) : null}

        {block.t === 'def' ? (
          <div>
            {edit ? (
              <input
                className="fc-acc"
                value={block.title}
                onChange={(e) =>
                  onPatch((d) => {
                    const b = d.blocks[index];
                    if (b.t === 'def') b.title = e.target.value;
                  })
                }
                placeholder="見出し"
                style={{ ...INPUT, font: '700 15px var(--f-disp)', marginBottom: '6px' }}
              />
            ) : (
              <div style={{ font: '700 16px var(--f-disp)', color: 'var(--tx0)', marginBottom: '5px' }}>
                {block.title || '定義'}
              </div>
            )}
            {edit ? (
              <textarea
                className="fc-acc"
                value={block.body}
                onChange={(e) =>
                  onPatch((d) => {
                    const b = d.blocks[index];
                    if (b.t === 'def') b.body = e.target.value;
                  })
                }
                placeholder="本文(数式は $...$ / $$...$$)"
                style={{ ...INPUT, minHeight: '70px' }}
              />
            ) : (
              <NoteMath className="nb-body" src={block.body} mark={mark} />
            )}
          </div>
        ) : (
          <div className="nb-row">
            <span className="nb-badge">{cardNo ? '問' + cardNo : '問?'}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: '10px' }}>
              {!edit ? (
                <NoteMath
                  className="nb-body nb-body--dim"
                  src={card ? card.q : '(対象の想起問題が設定されていません)'}
                />
              ) : null}
              {(
                [
                  { key: 'guide', label: '方針', hair: false, warn: false },
                  { key: 'solution', label: '解答', hair: true, warn: false },
                  { key: 'caution', label: '注意', hair: false, warn: true },
                ] as const
              ).map((f) => {
                const value = block[f.key];
                if (!edit && !value) return null;
                return (
                  <SubRow key={f.key} label={f.label} warn={f.warn}>
                    {edit ? (
                      <textarea
                        className="fc-acc"
                        value={value}
                        onChange={(e) =>
                          onPatch((d) => {
                            const b = d.blocks[index];
                            if (b.t === 'ex') b[f.key] = e.target.value;
                          })
                        }
                        placeholder={f.label}
                        style={{ ...INPUT, minHeight: '46px' }}
                      />
                    ) : (
                      <NoteMath
                        className={'nb-body' + (f.warn ? ' nb-body--sm' : '') + (f.hair ? ' nb-hair' : '')}
                        src={value}
                        mark={mark}
                      />
                    )}
                  </SubRow>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
