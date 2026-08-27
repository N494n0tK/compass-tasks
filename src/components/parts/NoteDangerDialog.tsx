'use client';

/**
 * Compass — ノートを消す / 名前を変えるときの確認（docs/notebook/ux-refresh.md §6）
 *
 * 要望の原文（2026-08-27）:
 * 「名称を変更したり、削除したりしたときには復習の方も消すか聞いて、消すならそっちも消して！」
 *
 * ノートと復習は**別の持ち物**なので、片方を触ったときにもう片方をどうするかは
 * 本人にしか決められない。ノートを捨てても「その問題をもう一度やる」予定まで
 * 捨てたいとは限らないし、逆に本文の無い復習だけ残っても解けない。だから毎回聞く。
 * `window.confirm` は使わない ―― 「はい / いいえ」しか置けず、この問いを載せられない。
 *
 * `state.nbAsk`（`NoteAsk`）が入っているときだけ出る。開く側（#5 の右クリックメニュー /
 * `NoteView` の削除ボタン）は**その場で壊さず**、巻き込まれる件数を数えて `nbAsk` を
 * 立てるだけ。実際の破壊はこのダイアログの「はい」だけが起こす（ux-refresh.md §4）。
 *
 * DOM 位置は `.compass-theme-mode` 直下（`ShellOverlay`）。`.compass-shell` は
 * `overflow:hidden` + `isolation:isolate` なので、中に置くと `position:fixed` が
 * シェルのスタッキングコンテキストに閉じ込められる（spec §2.1）。
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
// ノートを壊す操作は全部ここ 1 本を通す（ux-refresh.md §4）
import { renameNote, trashNote } from '../../lib/logic/noteTrash';
import type { NoteAsk } from '../../lib/model/types';
import { notebookController } from './NotebookPersistence';
import { ShellOverlay } from './ShellOverlay';
import { dateCtx, store, useAppStore } from '../useStore';

/** Tab を閉じ込めるために数える相手。`disabled` な決定ボタンは輪から外す */
const FOCUSABLE =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

// ─────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────

/**
 * `CompassApp` に **1 個だけ**置く（`ReviewAskModal` と同じ扱い）。
 * 開く経路は複数あるが、画面に出るダイアログは常に 1 枚だから。
 */
export function NoteDangerDialog() {
  const { state: S } = useAppStore();
  const ask = S.nbAsk;
  if (!ask) return null;
  return (
    <ShellOverlay>
      {/*
        `key` を付けて**問いが変わるたびに作り直す**。中身（入力欄の下書き・チェックの
        オン/オフ）は 1 回の問いにだけ意味がある一時値なので、`useState` の初期値を
        そのまま信じられる形にしておくのがいちばん事故が少ない。
      */}
      <NoteDangerPanel key={ask.kind + ':' + ask.noteId} ask={ask} />
    </ShellOverlay>
  );
}

// ─────────────────────────────────────────────────────────────
// 中身
// ─────────────────────────────────────────────────────────────

function NoteDangerPanel({ ask }: { ask: NoteAsk }) {
  const trash = ask.kind === 'trash';
  const titleId = useId();
  const descId = useId();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  /**
   * 「復習の方も一緒に処理するか」。**既定はオン**。
   *  - 削除: ノートが無い復習は問題文が出せず、解けないカードが今日の ToDo に残り続ける。
   *  - 改名: 復習カードの名前はノートの単元名から作られている（`noteCards.noteReviewTitle`）。
   *    直したのに古い名前のカードが並ぶほうが、ふつうは驚く。
   * どちらも「揃っている」が普通の期待なので、外すのを本人の一手にする。
   */
  const [also, setAlso] = useState(true);
  const [unit, setUnit] = useState(() => (ask.nextUnit ?? ask.unit).trim());

  // 削除も改名も、復習とまとめの両方が巻き込まれる。まとめタスクの題名も
  // 単元名を埋め込んでいる（`noteSummaryTitle` の `「◯◯」のまとめを書く`）ので、
  // 名前を合わせるときは復習だけでなくそちらも直る
  const hitCount = trash ? ask.reviewCount + ask.summaryCount : ask.reviewCount + ask.summaryCount;
  const asks = hitCount > 0;

  const nextUnit = unit.trim();
  const canRename = nextUnit.length > 0;

  const close = () => {
    // `nbMenu` / `nbRenameId` も畳む。ここへ来る経路（右クリックメニュー・一覧のその場改名）
    // が開いたままだと、ダイアログを閉じた先に宙ぶらりんの UI が残る
    store.setState({ nbAsk: null, nbMenu: null, nbRenameId: null });
  };

  // ── 開いたら中へフォーカスを移す
  useEffect(() => {
    if (trash) {
      // 破壊しないボタン（キャンセル）側に置く。Enter の連打で消えてしまわないように
      cancelRef.current?.focus();
      return;
    }
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select(); // 全選択。付け足すより丸ごと打ち直すほうが多い
  }, [trash]);

  // ── Esc で閉じる
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
    };
    // パネルの中に閉じ込めず window で拾う。フォーカスがどこにあっても Esc は効くべきなので。
    // `CompassApp` の Escape も同時に走るが、あちらが畳むのは別のオーバーレイだけで衝突しない
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tab がダイアログの外へ抜けないように端で折り返す */
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = panelRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (cur === first || !cur || !root.contains(cur)) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (cur === last || !cur || !root.contains(cur)) {
      e.preventDefault();
      first.focus();
    }
  };

  // ── 実行
  const confirm = () => (trash ? runTrash(ask, also) : runRename(ask, nextUnit, also));

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // 日本語の変換確定の Enter で決定してしまわない（IME が開いているあいだは無視）
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canRename) confirm();
  };

  return (
    <div className="nbdlg-back" onClick={close}>
      <div
        ref={panelRef}
        className="nbdlg-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <div className="nbdlg-head">
          <div className="nbdlg-title" id={titleId}>
            {trash ? (
              <>
                「<span className="nbdlg-unit">{ask.unit}</span>」をゴミ箱に入れますか？
              </>
            ) : (
              <>
                「<span className="nbdlg-unit">{ask.unit}</span>」の単元名を変える
              </>
            )}
          </div>
          <div className="nbdlg-sub" id={descId}>
            {trash
              ? '30日はゴミ箱に残るので元に戻せます。⌘Z でも直前の1手を取り消せます。'
              : 'ノートの単元名を書き換えます。写真・本文・想起問題はそのままです。'}
          </div>
        </div>

        {/* ── 改名の入力欄 */}
        {trash ? null : (
          <input
            ref={inputRef}
            className="nbdlg-input"
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            onKeyDown={onInputKeyDown}
            aria-label="新しい単元名"
            placeholder="単元名"
            spellCheck={false}
          />
        )}

        {/* ── 復習の方をどうするか。0 件なら問い自体を出さない（聞くことが無い） */}
        {asks ? (
          <label className={checkClass(trash, also)}>
            <input
              type="checkbox"
              checked={also}
              onChange={(e) => setAlso(e.target.checked)}
            />
            <span className="nbdlg-check__body">
              <span className="nbdlg-check__label">
                {trash ? trashCheckLabel(ask) : renameCheckLabel(ask)}
              </span>
              <span className="nbdlg-check__why">
                {trash
                  ? also
                    ? 'ノートと一緒に片付けます。⌘Z で復習ごと戻せます'
                    : 'ノートだけ捨てて、復習の予定は残します'
                  : also
                    ? '未完了のカードだけ。完了済みは学習の記録なので触りません'
                    : '復習カードは古い名前のまま残ります'}
              </span>
            </span>
          </label>
        ) : null}

        {/* 選んだ結果どうなるかを 1 行で見せる。改名は名前の形が想像しづらいので実例を出す */}
        {!trash && asks ? (
          <div className="nbdlg-note">
            {also ? (
              <>
                復習カードは <code>{(canRename ? nextUnit : ask.unit) + ' 問1'}</code> のような名前になります。
              </>
            ) : (
              // ここが「合わせない」を選んだときの限界。詳細は下の `runRename` の注記
              <>合わせないままにすると、次にこのノートを保存したときに新しい名前へ揃います。</>
            )}
          </div>
        ) : null}
        {trash && !asks ? (
          <div className="nbdlg-note">このノートに紐づく未完了の復習・まとめはありません。</div>
        ) : null}

        <div className="nbdlg-acts">
          <button ref={cancelRef} className="nbdlg-btn" onClick={close}>
            キャンセル
          </button>
          {trash ? (
            <button className="nbdlg-btn nbdlg-btn--danger" onClick={confirm}>
              ゴミ箱に入れる
            </button>
          ) : (
            <button className="nbdlg-btn nbdlg-btn--go" onClick={confirm} disabled={!canRename}>
              名前を変える
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 文言
// ─────────────────────────────────────────────────────────────

function checkClass(trash: boolean, on: boolean): string {
  // 改名は壊す操作ではないので、ON の差し色は --pink（いま/危険）ではなく画面の --view
  const base = trash ? 'nbdlg-check' : 'nbdlg-check nbdlg-check--calm';
  return on ? base + ' is-on' : base;
}

/**
 * 削除の問いは復習とまとめを **1 つのチェックにまとめる**。
 * どちらも「このノートから生えた予定」で、片方だけ残したい場面が思いつかないから。
 * 文言では両方に触れて、何件消えるかを先に見せる。
 */
function trashCheckLabel(ask: NoteAsk): string {
  const bits: string[] = [];
  if (ask.reviewCount) bits.push('未完了の復習 ' + ask.reviewCount + '件');
  if (ask.summaryCount) bits.push('まとめタスク ' + ask.summaryCount + '件');
  return bits.join(' と ') + ' も一緒に消す';
}

/**
 * 改名のチェックの文言。
 *
 * ここで聞くのは**「消すか」ではなく「名前も合わせるか」**。要望の原文は削除と改名を
 * ひとまとめに「復習の方も消すか聞いて」と言っているが、改名で復習を消すと、
 * そのカードが積み上げてきた間隔（何回できて、次はいつか）まで消える。
 * 名前を直したかっただけで予定が巻き戻るなら、名前は直せないのと同じになる。
 */
function renameCheckLabel(ask: NoteAsk): string {
  const bits: string[] = [];
  if (ask.reviewCount) bits.push('復習カード ' + ask.reviewCount + '件');
  if (ask.summaryCount) bits.push('まとめタスク ' + ask.summaryCount + '件');
  return bits.join(' と ') + ' の名前も合わせて直す';
}

// ─────────────────────────────────────────────────────────────
// 実行（破壊は `lib/logic/noteTrash.ts` を唯一の入口にする）
// ─────────────────────────────────────────────────────────────

/**
 * ゴミ箱へ入れる。
 *
 * 自前で `notes` を書き換えない（ux-refresh.md §4）。`trashedAt` の印・30 日の掃除・
 * `nbUndo` への積み方が 1 か所に無いと、必ずどこかで取りこぼす。
 *
 * `trashNote` は**純関数**で、state を触らずに次の姿を返す。ここでやるのは
 * それを `setState` へ流し、`trashedAt` の付いたノートを Firestore へ書き戻すことだけ
 * ―― `remove()` は呼ばない。消すのは 30 日を過ぎたぶんの掃除のときだけで、
 * ゴミ箱にいるあいだは「印の立ったふつうのノート」として保存されている。
 *
 * ⚠ 写真の実体（IndexedDB）も**まだ消さない**。30 日のあいだ戻せる約束なので、
 * `deleteNoteScans` は完全削除の側で呼ぶ。
 */
function runTrash(ask: NoteAsk, dropReviews: boolean): void {
  const out = trashNote(store.getState(), {
    noteId: ask.noteId,
    alsoReviews: dropReviews,
    today: dateCtx.today,
  });
  if (!out.changed) {
    store.setState({ nbAsk: null, nbMenu: null, nbRenameId: null });
    return;
  }
  store.setState({ ...out.next, nbAsk: null, nbMenu: null, nbRenameId: null, nbEdit: false });
  if (out.note) notebookController()?.save(out.note);

  // 文言に使うのは**実際に消えた数**（`out`）。聞いたときの数（`ask`）は
  // メニューを開いた時点のもので、その間に復習を 1 枚終えていればもうずれている
  const bits: string[] = [];
  if (out.removedReviews) bits.push('復習' + out.removedReviews + '件');
  if (out.removedSummaries) bits.push('まとめ' + out.removedSummaries + '件');
  const tail = bits.length ? '(' + bits.join('・') + 'も削除)' : '';
  store.showToast('「' + ask.unit + '」をゴミ箱に入れました' + tail + ' · ⌘Zで戻せます');
}

/**
 * 単元名を書き換える。
 *
 * `commitNote` は通さず `renameNote`（`lib/logic/noteTrash.ts`）に寄せる。
 * `commitNote` は 3 手目に `generateNoteReviews` を回すので、「復習ごと捨てて →
 * リロード → ゴミ箱から戻した（復習は控えが無いので戻らない）」ノートを改名すると、
 * 全カードぶんの復習が `due:今日` で生え直し、間隔がこっそり巻き戻る。
 *
 * @param syncTitles 復習カードとまとめタスクの名前も合わせて直すか。
 *   false なら題名は元のまま残る。どちらを選んでも**間隔は動かない**
 *   ―― 名前を変えたかっただけの操作で予定を壊さない。
 */
function runRename(ask: NoteAsk, nextUnit: string, syncTitles: boolean): void {
  if (!nextUnit) return;

  const out = renameNote(store.getState(), {
    noteId: ask.noteId,
    unit: nextUnit,
    syncTitles,
    today: dateCtx.today,
  });
  // 見つからない / 元と同じ / 空白だけ ―― どれも `changed:false` で返る。
  // 空振りの保存で `updatedAt` だけ動くのを避ける
  if (!out.changed || !out.note) {
    store.setState({ nbAsk: null, nbMenu: null, nbRenameId: null });
    return;
  }
  store.setState({ ...out.next, nbAsk: null, nbMenu: null, nbRenameId: null });
  notebookController()?.save(out.note);

  const tail = ask.reviewCount
    ? syncTitles
      ? '(復習' + ask.reviewCount + '件の名前も変更)'
      : '(復習の名前はそのまま)'
    : '';
  store.showToast('「' + nextUnit + '」に変更しました' + tail + ' · ⌘Zで戻せます');
}
