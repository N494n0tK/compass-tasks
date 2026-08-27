'use client';

/**
 * Compass — まとめ欄（その場書き）（docs/notebook/ux-refresh.md §9）
 *
 * まとめ（`Note.summary`）は**復習の仕上げ**（spec §3.6）。AI は常に空で返し、
 * 本人が自分の言葉で言い直すために空けてある欄で、書けた瞬間に今日のToDo の
 * 「まとめを書く」も片づく（`commitNote` → `syncNoteSummaryTask`）。
 *
 * それなのに、これまで書くには紙面の上の「編集」で編集モード（`nbEdit`）に入る必要があった。
 * 入れば紙面が全部入力欄に変わる ―― 読み返しの流れが切れるうえ、
 * 空欄の案内も「（「編集」から書けます）」と、遠回りを説明するだけのものになっていた。
 * ここを**読んでいる紙面のまま、その場で書ける**ようにする。
 *
 * ## 設計
 *
 * | 論点 | 答え |
 * |---|---|
 * | 開き方 | 本文（空なら案内）をクリック / Enter・Space。`nbEdit` には入らない |
 * | 見た目 | 読むときと書くときで**同じ字・同じ行間**（`--f-hand` 15.5px/2.05） |
 * | 枠 | 生やさない。左の余白に細い罫（`--view`）を 1 本立てるだけ |
 * | 保存 | `commitNote(..., { debounce: true })`。打鍵が止まって 700ms 後 + 確定時 |
 * | 確定 | ⌘Enter / 外側クリック（＝ blur）。Esc は書き始めの内容へ戻す |
 * | 手応え | 「保存しました」を 1.8 秒 + 左罫のごく短い変化。**トーストは出さない** |
 *
 * **紙面を飛び跳ねさせない**のがこの部品の一番の制約。読むときも書くときも
 * 高さの下限を 3 行ぶんに揃え（`.nbsum__field`）、入力欄は枠も地色も持たず、
 * 字数・キー操作の案内は紙面のいちばん下の余白（`.nb-summary` の padding-bottom）へ
 * **絶対配置で逃がす**。だからクリックしても行がずれない。
 *
 * レンズが「想起問題だけ」（`nbLens === 'recall'`）の面ではまとめを出さない。
 * その判断は紙面全体の都合なので親（`NoteView` の `paper`）が持ち、ここは `show` で受ける。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Note } from '../../lib/model/notes';
import type { ISODate } from '../../lib/model/types';
import { NoteMath, type NoteMarkOptions } from './NoteMath';
import { commitNote } from './NotebookPersistence';
import { store } from '../useStore';

/**
 * 打鍵が止まってから保存するまで。
 *
 * `NoteView` の `patch()` は 1 打鍵ごとに `commitNote` を呼んでいる（クラウドへの
 * 書き込みだけが `NOTE_SAVE_DEBOUNCE_MS` で間引かれる）。ここはその手前にもう 1 段置いて、
 * **打鍵ごとに `commitNote` そのものを呼ばない** ―― `commitNote` は復習の同期・生成と
 * まとめタスクの追従まで回すので、まとめのような長文を書いている間ずっと走らせると、
 * 復習が数百件ある日に 1 文字ごとの引っかかりになる。
 */
const SUMMARY_IDLE_MS = 700;

/** 「保存しました」を出しておく長さ。読み取れて、視界の隅に居座らない程度 */
const SUMMARY_SAVED_MS = 1800;

/** 自分の言葉のまとめは 3 行以内（spec §3.6 / 取り込みプロンプトの案内と同じ目安） */
const SUMMARY_LINES = 3;

export interface NoteSummaryEditorProps {
  /** いま開いているノート。保存先はこのノートの `summary` だけ */
  note: Note;
  /** 保存日（`updatedAt` と復習の生成日。`NoteView` の `T` をそのまま渡す） */
  today: ISODate;
  /** 重要語の塗り。`NoteView` の `markPlain` をそのまま渡す（無くてよい） */
  mark?: NoteMarkOptions;
  /**
   * 編集モード（`nbEdit`）。true の間は入力欄を開いたままにし、
   * 紙面の他の欄と同じ「枠のある入力欄」の体裁にする（編集モードだけ見た目が
   * 揃わないと、どこが直せるのか分からなくなる）。
   */
  edit?: boolean;
  /**
   * まとめを出す面か。既定 true。
   * レンズが「想起問題だけ」のときに親が false を渡す ―― まとめを読めば答えが割れるため。
   */
  show?: boolean;
}

export function NoteSummaryEditor({ note, today, mark, edit, show = true }: NoteSummaryEditorProps) {
  /** その場書きで開いているか（編集モードによる常時オープンとは別に持つ） */
  const [open, setOpen] = useState(false);
  /** 入力欄の中身。**開いている間だけが正**で、閉じている間の表示は `note.summary` を直に読む */
  const [draft, setDraft] = useState(note.summary);
  /** 「保存しました」を出している最中か */
  const [saved, setSaved] = useState(false);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const readRef = useRef<HTMLDivElement | null>(null);

  /**
   * 最新の値を、タイマー・後片付けのような**レンダーの外**から読むための控え。
   * レンダー中に代入するのは「常に最新の props を指す ref」の定石どおり。
   */
  const noteRef = useRef(note);
  noteRef.current = note;

  const draftRef = useRef(draft);
  /** 最後に `commitNote` へ渡した本文。**二重保存の番人**（同じ文字列なら書かない） */
  const savedTextRef = useRef(note.summary);
  /** 書き始めたときの本文。Esc の戻し先 */
  const baseRef = useRef(note.summary);
  /** いま書いているノートの id。途中でノートが差し替わっても取り違えないための錨 */
  const editIdRef = useRef('');
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 日本語入力の変換中か。未確定の文字で保存を走らせない */
  const imeRef = useRef(false);
  /** 入力欄が出ているか（前回レンダーの値）。出入りの検出用 */
  const liveRef = useRef(false);
  /** 閉じたあとに読み札へフォーカスを戻すか（キーボードで閉じたときだけ） */
  const refocusRef = useRef(false);

  /** 編集モードは常時オープン。その場書きと合わせて「入力欄が出ているか」を 1 つの値にする */
  const live = open || !!edit;

  /**
   * まとめを保存する。**同じ本文なら何もしない**ので、
   * 打鍵の間合い・⌘Enter・外側クリック・後片付けから何度呼んでも書き込みは 1 回。
   *
   * 保存先は props の `note` ではなく**ストアから引き直したそのときの実体**にする。
   * 書いている最中に取り込み（上書き）が走ることがあり、props は 1 レンダー古いことがあるため。
   * 中身は `summary` だけ差し替える浅いコピーで足りる（`NoteView` の `patch()` が
   * 深いコピーを取っているのは、あちらが節やカードの中を直接いじるから）。
   */
  const commit = useCallback(
    (text: string, quiet?: boolean) => {
      if (idleRef.current !== null) {
        clearTimeout(idleRef.current);
        idleRef.current = null;
      }
      if (text === savedTextRef.current) return;
      const target = store.getState().notes.find((n) => n.id === editIdRef.current);
      if (!target) return;
      savedTextRef.current = text;
      // `debounce: true` … クラウドへの書き込みは `NotebookController` が最後の 1 回にまとめる。
      // state と localStorage へは即座に入るので、ここで落ちても書いたものは残る。
      commitNote(store, { ...target, summary: text, updatedAt: today }, today, { debounce: true });
      if (quiet) return;
      setSaved(true);
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), SUMMARY_SAVED_MS);
    },
    [today],
  );

  /** 書き残しを吐き出す。後片付け（ノート切り替え・画面離脱）から呼ぶ最新版を ref に置く */
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => commit(draftRef.current);
  });

  /** 入力欄を開くときの下ごしらえ。Esc の戻し先と二重保存の番人をこのノートで揃える */
  const begin = useCallback(() => {
    const text = noteRef.current.summary;
    baseRef.current = text;
    savedTextRef.current = text;
    draftRef.current = text;
    editIdRef.current = noteRef.current.id;
    setDraft(text);
  }, []);

  // ── 入力欄の出入り。開いたら下ごしらえ、閉じたら書き残しを吐く。
  //    編集モード（`edit`）で開いた場合もここを通るので、経路が 2 本に割れない
  useEffect(() => {
    if (live === liveRef.current) return;
    liveRef.current = live;
    if (live) begin();
    else flushRef.current();
  }, [live, begin]);

  // ── 書いている最中にノートが差し替わったとき（サイドバーで別のノートを開く等）。
  //    書きかけは**元のノートへ**落としてから閉じる。ここを忘れると、
  //    直前まで書いていた数行が黙って消える
  useEffect(() => {
    if (!editIdRef.current || editIdRef.current === note.id) return;
    flushRef.current();
    editIdRef.current = '';
    setOpen(false);
    // 編集モードは親の都合で続いているので、新しいノートで開き直す
    if (edit) begin();
  }, [note.id, edit, begin]);

  // ── 画面を離れるときの後片付け。デバウンス待ちの本文をここで確実に吐く
  useEffect(
    () => () => {
      flushRef.current();
      if (idleRef.current !== null) clearTimeout(idleRef.current);
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  // ── 開いたら入力欄へ。カーソルは末尾（書き足しが大半なので、選択状態にはしない）
  useEffect(() => {
    if (!open) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [open]);

  // ── キーボードで閉じたときは読み札へフォーカスを返す（Tab の位置を紙面の外へ飛ばさない）
  useEffect(() => {
    if (open || !refocusRef.current) return;
    refocusRef.current = false;
    readRef.current?.focus();
  }, [open]);

  const onType = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    if (imeRef.current) return; // 変換中は待つ（確定した文字だけを保存する）
    if (idleRef.current !== null) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      idleRef.current = null;
      commit(draftRef.current);
    }, SUMMARY_IDLE_MS);
  };

  /** 確定して閉じる（⌘Enter / 外側クリック） */
  const close = (refocus: boolean) => {
    commit(draftRef.current);
    refocusRef.current = refocus;
    setOpen(false);
  };

  /**
   * 書くのをやめる（Esc）。書き始めの内容へ戻す。
   * 間合いの自動保存が既に走っていることがあるので、**戻したものも保存し直す** ――
   * さもないと画面だけ元に戻って、保存されているのは途中の文になる。
   * 「取り消し」なので「保存しました」は出さない（`quiet`）。
   */
  const cancel = () => {
    const base = baseRef.current;
    draftRef.current = base;
    setDraft(base);
    commit(base, true);
    refocusRef.current = true;
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // 紙面の外（検索・ドロワー）まで Esc を伝えない
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close(true);
    }
  };

  if (!show) return null;

  const body = note.summary;
  const text = (live ? draft : body).trim();
  // 改行は字に数えない（「3 行で 90 字」のような目安として読めるように）
  const chars = text.replace(/\n/g, '').length;
  const lines = text ? text.split('\n').length : 0;

  return (
    <section
      className={
        'nb-summary nbsum' +
        (live ? ' is-live' : '') +
        (edit ? ' is-form' : '') +
        (saved ? ' is-saved' : '')
      }
    >
      {/* 見出し。`NoteView` の `SectionHead` と同じ形（あちらは非公開なので同じ札を張り直す） */}
      <div className="nbsum__head">
        <span className="nb-badge">まとめ</span>
        <span className="nb-sec-hint">この授業 1 回を、自分の言葉で数行に</span>
      </div>

      {live ? (
        /* 入力欄。高さは中身に合わせて伸びる ―― textarea と同じ字で組んだ影（::after）を
           同じマス目に重ねる CSS の手で、スクロールバーも縦の飛び跳ねも出さない */
        <div className="nbsum__field nbsum__grow" data-value={draft}>
          <textarea
            ref={taRef}
            className="nbsum__input"
            value={draft}
            onChange={(e) => onType(e.target.value)}
            onCompositionStart={() => (imeRef.current = true)}
            onCompositionEnd={(e) => {
              imeRef.current = false;
              onType(e.currentTarget.value);
            }}
            onKeyDown={onKey}
            onBlur={() => close(false)}
            placeholder={'この授業でいちばん大事だったことを ' + SUMMARY_LINES + ' 行以内で'}
            aria-label="まとめ（自分の言葉で）"
            rows={1}
            spellCheck={false}
          />
        </div>
      ) : (
        /* 読むとき。ここ全体が「書く」のつまみ（`NoteRow` と同じく role="button" + Enter/Space） */
        <div
          ref={readRef}
          className="nbsum__field nbsum__read"
          role="button"
          tabIndex={0}
          onClick={() => {
            begin();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault(); // Space で紙面が下へずれるのを止める
            begin();
            setOpen(true);
          }}
        >
          {body ? (
            <NoteMath className="nb-mine nb-summary__body nbsum__body" src={body} mark={mark} />
          ) : (
            <div className="nbsum__empty">
              <p className="nb-summary__empty">
                クリックして、この 1 回を自分の言葉で {SUMMARY_LINES} 行以内に。
              </p>
              <p className="nbsum__why">
                自分で言い直すところまでが復習の仕上げ ―― 書けたら、今日のToDoの
                「まとめを書く」も片づきます。
              </p>
            </div>
          )}
          {/* 触れている間だけ出す小札。読み上げには載せない（本文が読み札の名前なので） */}
          <span className="nbsum__cue" aria-hidden="true">
            クリック / Enter で書く
          </span>
        </div>
      )}

      {/*
        字数・行数と操作の案内。**紙面の高さを増やさない**ように、
        `.nb-summary` がもともと持っている下の余白へ絶対配置で逃がしてある。
        行数は採点ではなく目安 ―― 3 行を超えたら色を落ち着かせるだけで、止めはしない。
      */}
      {live ? (
        <div className="nbsum__foot">
          <span className={'nbsum__count' + (lines > SUMMARY_LINES ? ' is-long' : '')} aria-hidden="true">
            {chars ? chars + '字 · ' + lines + '行' : SUMMARY_LINES + '行以内が目安'}
          </span>
          <span className="nbsum__keys" aria-hidden="true">
            ⌘Enter で確定 · Esc で取り消し
          </span>
          {/* 保存の合図。トーストは出さない（打鍵のたびに画面下が光ると集中が切れる） */}
          <span className="nbsum__slot" role="status" aria-live="polite">
            {saved ? <span className="nbsum__saved">保存しました</span> : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}
