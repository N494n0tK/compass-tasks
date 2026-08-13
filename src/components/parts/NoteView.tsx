'use client';

/**
 * Compass — ノート 1 冊の表示・編集（docs/notebook/spec.md §8）
 *
 * **主役は「自分の手書きノートを GPT が書き起こした本文」**（`Note.sections`）。
 * 写真は本文の原本にすぎないので下へ畳んだ。読む順は上から:
 *
 *   ┌ マストヘッド ── 日付 / 教科 / 単元 ＋ レンズ（自分のノートだけ⇄AIの添削も）┐
 *   │ 想起問題                       ← 自作が先、AI が補った問いが後          │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  キュー欄 │ コーネル本文 ← 自分の手書きの再現。節ごとに AI の添削が挟まる │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ 演習（AI） / 疑問・連絡 / 元のノート（写真・畳んである）                │
 *   │ まとめ ← **自分が書く欄**なので紙面のいちばん下、手書き書体で           │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * 3 つの約束:
 *  - **書体が著者を示す**。自分の言葉は `--f-hand`（Klee One）、AI は `--f-ui`。
 *    読む前に「これは誰が書いたか」が分かる。添削はさらに紫インクで重ねる。
 *  - **影が層を示す**。写真には影、AI の面には影を落とさない。
 *  - **レンズ**（`nbLens`）で紙面をどこまで出すかを決める。出す量の少ない順に
 *    `想起問題だけ` / `自分のノートだけ` / `AIの添削も` の 3 段。
 *    `自分のノートだけ` は AI 由来をまるごと畳む ―― 自分で書いたものを読み返すのが
 *    いちばん復習になる、という立場を操作にしたもの（**まとめは自分の言葉なので畳まない**）。
 *    `想起問題だけ` はさらに絞って**問いと解答しか出さない**。紙面を読めば思い出せて
 *    しまうので、「思い出せるか」を試す 1 周目は本文ごと伏せる、という面。
 *
 * 確認モード（`nbCheck`）は本文とキュー欄の重要語に対して働く。付箋の開閉は
 * **DOM のクラス付け替えでやる**（`.nb-key.is-hidden` を外すだけ）。state に入れると
 * 1 枚めくるたびに本文の HTML を作り直すことになり、剥がした付箋が戻ってしまう。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { fmtD, fmtMD, longDayLabel } from '../../lib/logic/dates';
import { parseNoteBody } from '../../lib/logic/noteBody';
import { noteSeriesId } from '../../lib/logic/noteCards';
import { assignCues, sectionSearchText } from '../../lib/logic/noteKeywords';
import { timetableSubjects } from '../../lib/logic/timetable';
import { canAddToToday, isAddedToToday, sizeOfMin } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import {
  NOTE_CARD_MAX,
  NOTE_GRADES,
  NOTE_GRADE_META,
  NOTE_KEYWORD_MAX,
  NOTE_KEY_COLORS,
  NOTE_KEY_COLOR_MEANING,
  NOTE_SECTION_MAX,
  NOTE_SUBJECT_OTHER,
  type Note,
  type NoteCard,
  type NoteKeyColor,
  type NoteKeyword,
  type NoteSection,
  lastAttemptOf,
} from '../../lib/model/notes';
import type { Review, ReviewGrade } from '../../lib/model/types';
import { NoteMath, NoteMathInline, type NoteMarkOptions } from './NoteMath';
import { NoteScanStrip } from './NoteScanStrip';
import { deleteNoteScans } from './NoteScanStore';
import { commitNote, recordNoteAttempt, removeNote } from './NotebookPersistence';
import { completeReview } from './ReviewShared';
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

/**
 * 丸つけの 3 択。記号・文言・色は `NOTE_GRADE_META` から取る（`NoteDrill` と同じ見た目）。
 *
 * 添える一言は**押すと何が起きるか**。復習カードがあるときは間隔の動き
 * （「次の間隔へ」など）、無いときは「記録だけ」。予定が動かないのに
 * 「次の間隔へ」と書いてあると、押した人が嘘をつかれたことになる。
 */
function GradeRow({
  pending,
  onGrade,
}: {
  pending: Review | null;
  onGrade: (g: ReviewGrade) => void;
}) {
  return (
    <div className="nb-grade">
      <div className="nb-grade__ask">思い出せた？</div>
      <div className="nb-grade__row">
        {NOTE_GRADES.map((id) => {
          const meta = NOTE_GRADE_META[id];
          return (
            <button
              key={id}
              className="nb-maru"
              onClick={() => onGrade(id)}
              style={{ color: meta.token }}
            >
              <span className="nb-maru__mark">{meta.icon}</span>
              <span className="nb-maru__label">{meta.label}</span>
              <span className="nb-maru__hint">{pending ? meta.hint : '記録だけ'}</span>
            </button>
          );
        })}
      </div>
    </div>
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
  // 編集中に畳んだ欄は直せないので、編集中はレンズを無視して全部出す
  const lens = edit ? 'ai' : S.nbLens;
  const onlyMine = lens === 'mine';
  // 想起問題だけの面には本文もキュー欄も無いので、伏せる相手がいない。
  // 編集中も伏せない（伏せた語を書き換えられない）
  const check = S.nbCheck && !edit && lens !== 'recall';
  // 想起問題だけの面では、紙面の残り（本文・演習・疑問・写真・まとめ）を出さない
  const paper = lens !== 'recall';
  const selfCount = note.cards.filter((c) => c.origin === 'self').length;
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
    // 写真の実体（IndexedDB）も落とす。メタデータだけ消しても容量が返らない
    void deleteNoteScans(note.id, note.scans);
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

  /**
   * 想起問題に丸をつける（`NoteDrill` / 理解度モーダルと同じ道）。
   *
   * ノートを読み返していて思い出せたかどうかは、その場が**いちばん正確**なので、
   * ドリル面まで行かなくてもここで答えられるようにした。
   *
   * - 復習カードがあるとき … `completeReview` に通す。間隔の遷移・学習ログ・
   *   ノートへの記録までまとめて面倒を見てくれる（遷移をフォークしない。spec §11-4）
   * - 無い / もう定着したとき … 動かす予定が無いので**記録だけ**残す。
   *   「この問題を何回やって、どう感じたか」は予定とは別に価値がある（spec §9）
   *
   * どちらでも答えたら解答を畳む ―― 次に開いたとき、また思い出すところから始まるように。
   */
  const gradeCard = (card: NoteCard, pending: Review | null, g: ReviewGrade) => {
    if (pending) {
      store.showToast(completeReview(store, pending, g, sizeOfMin(pending.min), ctx));
    } else {
      recordNoteAttempt(store, note.id, card.cardId, T, g);
      store.showToast(
        '「' + NOTE_GRADE_META[g].label + '」で記録しました（復習の予定は動きません）',
      );
    }
    store.setState((s) => {
      const next = { ...s.nbRevealed };
      delete next['r:' + note.id + ':' + card.cardId];
      return { nbRevealed: next };
    });
  };

  // ── 重要語。コーネル本文とキュー欄だけ伏せ、想起問題やまとめは色を付けるにとどめる
  //    （伏せる範囲を `.nb-cornell` の中に閉じるのは、めくった枚数を数える
  //      `bodyRef` の走査範囲と一致させるため）
  const markBody = useMemo<NoteMarkOptions | undefined>(
    () => (note.keywords.length ? { keywords: note.keywords, mask: check } : undefined),
    [note.keywords, check],
  );
  const markPlain = useMemo<NoteMarkOptions | undefined>(
    () => (note.keywords.length ? { keywords: note.keywords } : undefined),
    [note.keywords],
  );

  // ── 紙面に出す節。レンズが「自分のノートだけ」のとき:
  //   - `text` が空の節（= ノートに無い、AI だけの補足）は丸ごと出さない
  //   - 残る節も `ai` を空にして、添削だけ降ろす
  // 節を間引いたあとで `assignCues` を掛け直すのが肝心で、そうしないと
  // 「畳んだ AI の中にしか出てこない語」がキュー欄に残ってしまう。
  const shownSections = useMemo(() => {
    const out: { section: NoteSection; index: number }[] = [];
    note.sections.forEach((s, index) => {
      if (onlyMine && !s.text) return;
      out.push({ section: onlyMine ? { ...s, ai: '' } : s, index });
    });
    return out;
  }, [note.sections, onlyMine]);

  const cues = useMemo(
    () => assignCues(shownSections.map((v) => v.section), note.keywords),
    [shownSections, note.keywords],
  );

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
            className={'nb-btn' + (edit ? ' is-on' : '')}
            onClick={() => store.setState({ nbEdit: !edit, nbCheck: false })}
          >
            {edit ? '✓ 完了' : '編集'}
          </button>
          <button className="nb-btn" onClick={overwrite}>
            JSONで上書き
          </button>
          <button className="nb-btn nb-btn--danger" onClick={del}>
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

        {/* ── 読み方の列。上の列（編集・削除）は「扱い方」なので分けてある */}
        <div className="nb-readbar">
          {/* この画面の立場を 1 つの操作にしたスイッチ（spec §8.3）。
              左から順に「出す量が増える」並び */}
          <div className="nb-lens" role="group" aria-label="表示する範囲">
            <button
              className={'nb-lens__opt' + (lens === 'recall' ? ' is-on' : '')}
              onClick={() => store.setState({ nbLens: 'recall', nbCheck: false })}
              aria-pressed={lens === 'recall'}
              title="本文・写真・まとめを畳んで、想起問題だけにする"
            >
              想起問題だけ
            </button>
            <button
              className={'nb-lens__opt' + (lens === 'mine' ? ' is-on' : '')}
              onClick={() => store.setState({ nbLens: 'mine', nbCheck: false })}
              aria-pressed={lens === 'mine'}
              title="AIの添削・解答・演習を畳んで、自分のノートの再現だけにする"
            >
              自分のノートだけ
            </button>
            <button
              className={'nb-lens__opt' + (lens === 'ai' ? ' is-on' : '')}
              onClick={() => store.setState({ nbLens: 'ai' })}
              aria-pressed={lens === 'ai'}
              title="各節に AI の添削を重ねて見る"
            >
              AIの添削も
            </button>
          </div>
          <span style={{ flex: 1 }} />
          {/* 想起問題だけの面には本文もキュー欄も無い ＝ 伏せる相手がいないので出さない */}
          {paper ? (
            <button
              className={'nb-btn' + (check ? ' is-on' : '')}
              onClick={enterCheck}
              title="本文とキュー欄の重要語を伏せて、思い出してから 1 語ずつめくる"
              aria-pressed={check}
            >
              {check ? '✓ 確認モード' : '確認モード'}
            </button>
          ) : null}
          <button className="nb-btn" onClick={closeAll} title="解答をすべて閉じて復習">
            解答を閉じる
          </button>
        </div>
      </header>

      {/* ── ここから下が紙面。レンズを切り替えると区画がまるごと入れ替わるので、
             `key={lens}` で mount し直して `.nb-sheet` の出現アニメーションを掛ける
             ―― 押したスイッチの下だけが刷り直される、という見立て。
             マストヘッドと読み方の列は動かさない（そこは紙ではなく操作卓なので） */}
      <div key={lens} className="nb-sheet">
        {/* ── 確認モードの操作卓。伏せた枚数と、めくった枚数 */}
        {check ? (
          <div className="nb-checkbar" role="status" aria-live="polite">
            <span className="nb-checkbar__count" ref={countRef} />
            <span className="nb-checkbar__text" ref={hintRef} />
            <span style={{ flex: 1 }} />
            <button className="nb-btn" onClick={peelAll}>
              全部めくる
            </button>
            <button className="nb-btn" onClick={hideAll}>
              伏せ直す
            </button>
          </div>
        ) : null}

        {/* ── 想起問題。自分で立てた問いが先、AI が補った問いが後 */}
        <section style={{ marginTop: '34px' }}>
          <SectionHead
            badge="想起"
            title="想起問題"
            hint={
              !paper
                ? '本文を伏せた面。思い出せなかった問いだけ、レンズを戻して本文を読み直す'
                : selfCount
                  ? '自分で立てた問いが' + selfCount + '問。解答を隠したまま思い出してから開く'
                  : '解答を隠したまま思い出してから開く'
            }
          />
          <div style={{ display: 'grid', gap: '20px' }}>
            {note.cards.map((card, i) => {
              const key = 'r:' + note.id + ':' + card.cardId;
              const open = isOpen(key);
              const { pending, done } = reviewOf(card.cardId);
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
                        className={'nb-by' + (card.origin === 'self' ? ' nb-by--mine' : '')}
                        title={
                          card.origin === 'self'
                            ? 'ノートに自分で書いた問い'
                            : 'AIが授業から補った問い'
                        }
                      >
                        {card.origin === 'self' ? 'MINE' : 'AI'}
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
                      <NoteMath
                        className={card.origin === 'self' ? 'nb-mine' : 'nb-body'}
                        src={card.q}
                        mark={markPlain}
                      />
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
                          className="nb-btn"
                          onClick={() => addToToday(pending)}
                          style={{ padding: '3px 8px' }}
                        >
                          ＋ 今日へ
                        </button>
                      ) : pending && isAddedToToday(pending) ? (
                        <span style={{ fontSize: '10.5px', color: 'var(--grn)' }}>✓ 追加済み</span>
                      ) : null}
                    </div>

                    <div style={wrapStyle(open)}>
                      <div style={WRAP_INNER}>
                        {/* 解答は閉じていても DOM に残っている（高さだけ 0fr に畳む）ので、
                            開いた瞬間を捉えるには `is-open` の付け外しが要る
                            ―― クラスが付いた時点で `.nb-ans.is-open` の出現アニメーションが走る */}
                        <div className={'nb-ans' + (open ? ' is-open' : '')}>
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
                          {/* 丸つけ。解答を見たあとにしか出さない（`.nb-ans` の中に置く）
                              ―― 思い出す前に理解度を聞いても答えようがない */}
                          {!edit ? (
                            <GradeRow
                              pending={pending}
                              onGrade={(g) => gradeCard(card, pending, g)}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  {edit ? (
                    <button
                      className="nb-btn nb-btn--danger"
                      onClick={() => {
                        if (note.cards.length <= 1) {
                          store.showToast('想起問題は1問以上必要です');
                          return;
                        }
                        if (!window.confirm('この想起問題と、その復習カードを削除しますか？')) return;
                        patch((d) => void d.cards.splice(i, 1), [card.cardId]);
                      }}
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
              className="nb-btn"
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
                      style={{ marginTop: '15px' }}
            >
              ＋ 自分で想起問題を足す
            </button>
          ) : null}
        </section>

        {/* ── 重要語の編集（編集モードだけ。読むときはキュー欄がそれにあたる） */}
        {edit ? <KeywordEditor note={note} onPatch={patch} /> : null}

        {/* ── コーネル本文。**この紙面の主役**。
               右段 = 自分の手書きノートの再現（Klee One）、左段 = キュー欄、
               各節の直下に AI の添削が紫インクで挟まる（レンズが「AIの添削も」のとき） */}
        {paper && (note.sections.length || edit) ? (
          <section style={{ marginTop: '34px' }}>
            <SectionHead
              badge="本文"
              title="自分のノート"
              hint={
                onlyMine
                  ? '授業で自分が書いたノートの再現。左のキュー欄はその高さで出てくる重要語'
                  : '自分が書いたノートの再現に、AI の添削（紫）を重ねている'
              }
            />
            {note.keywords.length ? <KeyLegend /> : null}
            <div
              ref={bodyRef}
              className={'nb-cornell' + (note.keywords.length ? '' : ' is-flat')}
              onClick={onBodyClick}
              onKeyDown={onBodyKeyDown}
            >
              {shownSections.map((v, row) => (
                <NoteSectionRow
                  key={v.index}
                  note={note}
                  section={v.section}
                  index={v.index}
                  edit={edit}
                  onPatch={patch}
                  cueIndexes={cues.perSection[row] || []}
                  mark={markBody}
                  mask={check}
                />
              ))}
              {/* 本文のどこにも出てこない語。「自分のノートだけ」のときは出さない
                  ―― 畳んだ AI 側にしか無い語を、キュー欄からこぼすことになるため */}
              {cues.orphans.length && !onlyMine ? (
                <>
                  <div className="nb-cue">
                    <CueList note={note} indexes={cues.orphans} mask={check} />
                  </div>
                  <div className="nb-sec-hint" style={{ alignSelf: 'center' }}>
                    本文には出てこない語（キュー欄だけに出す）
                  </div>
                </>
              ) : null}
            </div>
            {edit ? (
              <button
                className="nb-btn"
                style={{ marginTop: '15px' }}
                onClick={() => {
                  if (note.sections.length >= NOTE_SECTION_MAX) {
                    store.showToast('本文の区画は' + NOTE_SECTION_MAX + 'までです');
                    return;
                  }
                  patch((d) => void d.sections.push({ heading: '', text: '', ai: '' }));
                }}
              >
                ＋ 節を足す
              </button>
            ) : null}
          </section>
        ) : null}

        {/* ── 演習 */}
        {(note.exercise.q || edit) && lens === 'ai' ? (
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
                <div className={'nb-ans' + (isOpen('e:' + note.id) ? ' is-open' : '')}>
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
        {paper && (note.doubt || note.notice || edit) ? (
          <section
            style={{
              marginTop: '30px',
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
                        <NoteMath className="nb-mine" src={line} mark={markPlain} />
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

        {/* ── 元のノート（写真）。本文が主役になったので原本は畳む。
               `<details>` にしてあるので、閉じている間は 1 行の見出しだけ */}
        {paper ? (
          <details className="nb-scanfold">
            <summary className="nb-scanfold__summary">
              <span className="nb-scanfold__caret" aria-hidden="true">
                ▸
              </span>
              元のノート（写真）
              <span className="nb-scanfold__count">
                {note.scans.length ? note.scans.length + '枚' : '未登録'}
              </span>
            </summary>
            <NoteScanStrip
              note={note}
              edit={edit}
              index={S.nbScanIx}
              onIndex={(i) => store.setState({ nbScanIx: i })}
              zoom={S.nbScanZoom}
              onZoom={(id) => store.setState({ nbScanZoom: id })}
              onPatch={patch}
            />
          </details>
        ) : null}

        {/* ── まとめ。**自分が書く欄**なので紙面のいちばん下に置き、手書き書体で組む。
               AI 由来ではないので「自分のノートだけ」レンズでも畳まない。
               「想起問題だけ」では畳む ―― まとめを読めば答えが割れてしまうため */}
        {paper ? (
          <section className="nb-summary">
            <SectionHead badge="まとめ" hint="この授業 1 回を、自分の言葉で数行に" />
            {edit ? (
              <textarea
                className="fc-acc"
                value={note.summary}
                onChange={(e) => patch((d) => void (d.summary = e.target.value))}
                placeholder="この授業でいちばん大事だったことを 3 行以内で"
                style={{ ...INPUT, minHeight: '92px', font: '400 15.5px var(--f-hand)' }}
              />
            ) : note.summary ? (
              <NoteMath className="nb-mine nb-summary__body" src={note.summary} mark={markPlain} />
            ) : (
              <p className="nb-summary__empty">
                自分の言葉で、3 行以内のまとめを書く場所です（「編集」から書けます）
              </p>
            )}
          </section>
        ) : null}
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// キュー欄（左段）と色の凡例
// ─────────────────────────────────────────────────────────────

/**
 * キュー欄に並ぶ重要語。色は本文の色と同じ（`.nb-key--<color>` を共有する）。
 *
 * `mask`（確認モード）のとき、語そのものを本文と同じ付箋にする。キュー欄に
 * 答えが見えていたら「キューだけを見て思い出す」が成立しないため。
 * **付箋のクラスは初期描画で当てるだけ**で、剥がすのは本文と同じ
 * イベントデリゲーション（`.nb-cornell` の onClick → classList から外す）。
 * ここで useState を持つと、1 枚めくるたびに本文まで作り直されてしまう。
 *
 * ひとこと（`kw.note`）は伏せない ―― 語を隠したあと、思い出すための
 * 手がかりとして残るのがコーネル式のキュー欄の役目だから。
 */
function CueList({
  note,
  indexes,
  mask,
}: {
  note: Note;
  indexes: readonly number[];
  mask: boolean;
}) {
  return (
    <>
      {indexes.map((ki) => {
        const kw = note.keywords[ki];
        if (!kw) return null;
        // 語にもひとことにも $…$ が入りうる（教科によっては記号そのものが重要語）
        return (
          <div key={ki} className="nb-cue-item">
            <span
              className={
                'nb-cue-term nb-key nb-key--' + kw.color + (mask ? ' is-hidden' : '')
              }
              data-nb-key={ki}
              role={mask ? 'button' : undefined}
              tabIndex={mask ? 0 : undefined}
              aria-label={mask ? '伏せた重要語。開くにはクリック' : undefined}
            >
              <NoteMathInline src={kw.term} />
            </span>
            {kw.note ? <NoteMathInline className="nb-cue-note" src={kw.note} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** 3 色の意味。色に意味を持たせている以上、紙面の中で 1 度だけ言っておく */
function KeyLegend() {
  return (
    <div className="nb-keylegend" aria-label="重要語の色の意味">
      {NOTE_KEY_COLORS.map((c) => (
        <span key={c} className={'nb-keylegend__item nb-key--' + c}>
          <span className="nb-keylegend__swatch" aria-hidden="true" />
          {NOTE_KEY_COLOR_MEANING[c]}
        </span>
      ))}
    </div>
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
  const haystack = useMemo(
    () => note.sections.map(sectionSearchText).join('\n'),
    [note.sections],
  );

  const setKw = (i: number, fn: (kw: NoteKeyword) => void) =>
    onPatch((d) => {
      const kw = d.keywords[i];
      if (kw) fn(kw);
    });

  return (
    <section style={{ marginTop: '30px' }}>
      <SectionHead
        badge="重要語"
        hint="3色（最重要 / 事実 / つながり）。本文で色が付き、キュー欄に並び、確認モードで伏せられる"
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
                className="nb-btn nb-btn--danger"
                onClick={() => onPatch((d) => void d.keywords.splice(i, 1))}
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
        className="nb-btn"
        onClick={() => {
          if (note.keywords.length >= NOTE_KEYWORD_MAX) {
            store.showToast('重要語は' + NOTE_KEYWORD_MAX + '語までです');
            return;
          }
          onPatch((d) => void d.keywords.push({ term: '', color: 'red', note: '' }));
        }}
        style={{ marginTop: '12px' }}
      >
        ＋ 重要語
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// コーネル本文の 1 節（キュー欄 + 本文の 2 セル）
// ─────────────────────────────────────────────────────────────

/**
 * 本文（`sections[].text`）を紙面に落とす。割り方は `logic/noteBody.ts` が決め、
 * ここは**どう見せるか**だけを持つ（spec §3.10）:
 *
 *   行   … 箇条書き。ぶら下げ（`depth`）は字下げで、行頭の記号は打ち直さない
 *   表   … 対応・分類の升目。手書き書体のまま細い罫で組む
 *   余白 … 空行 1 つぶん。**ここが「詰まったノート」への答え**
 *
 * 重要語（`mark`）は表の升目にも塗る ―― `.nb-key` を DOM から数える確認モードは、
 * 升目の中の語もそのまま拾う。
 */
function NoteBody({
  text,
  mark,
}: {
  text: string;
  mark: NoteMarkOptions | undefined;
}) {
  const blocks = useMemo(() => parseNoteBody(text), [text]);
  if (!blocks.length) return null;

  return (
    <>
      {blocks.map((b, bi) => {
        if (b.kind === 'gap') return <div key={bi} className="nb-gap" aria-hidden="true" />;

        if (b.kind === 'raw')
          return (
            <NoteMath key={bi} className="nb-mine nb-cornell__text" src={b.text} mark={mark} />
          );

        if (b.kind === 'table')
          return (
            <div key={bi} className="nb-tablewrap">
              <table className="nb-table">
                {b.head ? (
                  <thead>
                    <tr>
                      {b.head.map((c, ci) => (
                        <th key={ci}>
                          <NoteMathInline src={c} mark={mark} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={ci}>
                          <NoteMathInline src={c} mark={mark} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );

        return (
          <ul key={bi} className="nb-cornell__list">
            {b.lines.map((line, li) => (
              <li
                key={li}
                data-depth={line.depth || undefined}
                className={line.bullet ? undefined : 'is-plain'}
              >
                <NoteMath className="nb-mine nb-cornell__text" src={line.text} mark={mark} />
              </li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

/**
 * 1 節 = キュー欄（左）＋ 本文（右）。
 *
 * 右段の中身は 3 つで、**誰が書いたかが書体と色で分かれている**:
 *   heading … 自分のノートの見出し（Klee One）
 *   text    … 自分のノート本文の再現（Klee One・地の墨）。`\n` 区切りは箇条書き
 *   ai      … この節への AI の添削（BIZ UDPGothic・紫インク・「AI」チップ）
 *
 * `text` が空の節は「ノートに無い、AI だけの補足」。呼び出し側（NoteView）が
 * レンズに応じて間引くので、ここでは素直に ai だけを描く。
 */
function NoteSectionRow({
  note,
  section,
  index,
  edit,
  onPatch,
  cueIndexes,
  mark,
  mask,
}: {
  note: Note;
  section: NoteSection;
  index: number;
  edit: boolean;
  onPatch: (fn: (draft: Note) => void) => void;
  cueIndexes: readonly number[];
  mark: NoteMarkOptions | undefined;
  mask: boolean;
}) {
  const move = (delta: number) =>
    onPatch((d) => {
      const to = index + delta;
      if (to < 0 || to >= d.sections.length) return;
      const [s] = d.sections.splice(index, 1);
      d.sections.splice(to, 0, s);
    });

  const setField = (key: keyof NoteSection, value: string) =>
    onPatch((d) => {
      const s = d.sections[index];
      if (s) s[key] = value;
    });

  return (
    <>
      {/* 左段。この節で初めて出てくる重要語だけを置く */}
      <div className="nb-cue">
        <CueList note={note} indexes={cueIndexes} mask={mask} />
      </div>

      {/* 右段（本文） */}
      <div>
        {edit ? (
          <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', marginBottom: '5px' }}>
            <button className="nb-btn" onClick={() => move(-1)} aria-label="上へ">
              ↑
            </button>
            <button className="nb-btn" onClick={() => move(1)} aria-label="下へ">
              ↓
            </button>
            <button
              className="nb-btn nb-btn--danger"
              onClick={() => onPatch((d) => void d.sections.splice(index, 1))}
            >
              削除
            </button>
          </div>
        ) : null}

        {edit ? (
          <input
            className="fc-acc"
            value={section.heading}
            onChange={(e) => setField('heading', e.target.value)}
            placeholder="見出し（ノートに書いてあれば）"
            style={{ ...INPUT, font: '700 16px var(--f-hand)', marginBottom: '6px' }}
          />
        ) : section.heading ? (
          <h3 className="nb-cornell__heading">{section.heading}</h3>
        ) : null}

        {edit ? (
          <textarea
            className="fc-acc"
            value={section.text}
            onChange={(e) => setField('text', e.target.value)}
            placeholder={
              '自分のノートの本文（1 行 1 項目 / 数式は $...$）\n' +
              '行頭の空白 2 つでぶら下げ、空行で余白、| a | b | で表\n' +
              '空にすると「AI だけの補足」の節になります'
            }
            style={{ ...INPUT, minHeight: '112px', font: '400 14px var(--f-hand)', lineHeight: 2 }}
          />
        ) : (
          <NoteBody text={section.text} mark={mark} />
        )}

        {/* AI の添削。赤ペンで挟まれた別人の筆 ―― 書体（活字）と色（紫）で切る */}
        {edit ? (
          <div className="nb-aiedit">
            <span className="nb-aiedit__chip">AI</span>
            <textarea
              className="fc-acc"
              value={section.ai}
              onChange={(e) => setField('ai', e.target.value)}
              placeholder="この節への AI の添削・補足（空なら添削なし）"
              style={{ ...INPUT, minHeight: '56px', flex: 1 }}
            />
          </div>
        ) : section.ai ? (
          <aside className="nb-aiedit">
            <span className="nb-aiedit__chip" title="AI が足した添削・補足">
              AI
            </span>
            <NoteMath className="nb-aiedit__body" src={section.ai} mark={mark} />
          </aside>
        ) : null}
      </div>
    </>
  );
}
