'use client';

/**
 * Compass — 授業ノートの読み書き（docs/notebook/spec.md §6）
 *
 * `ShellPersistence.SaveController` の兄弟。ただし扱いはかなり違う:
 *
 * | | `compass-ui-data` | ノート |
 * |---|---|---|
 * | 保存先 | `settings/compass-ui-data` 1 ドキュメント | `notes/{noteId}` 1 件 1 ドキュメント |
 * | 保存契機 | state が変わるたび（280ms デバウンス） | 取り込み・編集・削除の明示操作のみ |
 * | 差分 | JSON 文字列一致 | 触ったノートだけ書く |
 * | 一時 state か | 永続 23+2 キー | **一時 state**（`PERSISTENT_KEYS` に入れない） |
 *
 * `state.notes` を一時 state に置くことで、`exportData()` にも Undo にも保存トリガにも
 * 一切関与しない。肥大しがちな LaTeX 本文がメインドキュメントへ入らないのが狙い。
 *
 * 書き込みは楽観更新（state と localStorage を先に更新し、クラウドは後追い）。
 * 失敗してもローカルの値は残し、トーストで知らせる。
 */

import { generateNoteReviews, cascadeNoteRemoval, syncNoteReviews } from '../../lib/logic/noteCards';
import { sanitizeNotes, upsertNote } from '../../lib/logic/noteDocs';
import {
  cascadeNoteSummaryRemoval,
  completeNoteSummaryTasks,
  generateNoteSummaryTasks,
  noteSummaryExtraId,
} from '../../lib/logic/noteSummaryTasks';
import { type Note, type NoteScan } from '../../lib/model/notes';
import type { AppState, ISODate, ReviewGrade } from '../../lib/model/types';
import { cloudErrorMessage, type CompassPersistence, type NoteDoc } from '../../lib/persistence';
import type { CompassStore } from '../../lib/store';
import { deleteNoteScans } from './NoteScanStore';
import { addToOrder } from './ShellActions';

/** ノートのローカルミラー。`compass-ui` / `compass-ui-data` に続く 3 つめのキー */
export const LS_NOTES = 'compass-notes';

/** 編集モードのトレーリングデバウンス（1 文字ごとに Firestore へ書かないため） */
export const NOTE_SAVE_DEBOUNCE_MS = 600;

export const TOAST_NOTES_LOAD_FAIL = 'ノートの読み込みに失敗しました(この端末の内容を表示中)';
export const TOAST_NOTE_SAVE_FAIL_PREFIX = 'ノートの保存に失敗: ';

// ─────────────────────────────────────────────────────────────
// 生データ → Note（本体は `lib/logic/noteDocs.ts`）
// ─────────────────────────────────────────────────────────────

/**
 * 読み替えの本体は純ロジックの `lib/logic/noteDocs.ts` にある。
 * `/api/mcp`（docs/notebook/mcp.md）が**サーバー側から同じ関数で** Firestore の生ドキュメントを
 * 読むため、`'use client'` のこのファイルからは出した。旧来の呼び出し側のために名前だけ残す。
 */
export { sanitizeNotes, sortNoteList, upsertNote } from '../../lib/logic/noteDocs';

// ─────────────────────────────────────────────────────────────
// localStorage（`ShellPrefs` と同じく try/catch で握りつぶす, C-33）
// ─────────────────────────────────────────────────────────────

export function readLocalNotes(): Note[] {
  try {
    return sanitizeNotes(JSON.parse(localStorage.getItem(LS_NOTES) || 'null'));
  } catch {
    return [];
  }
}

/**
 * ローカルミラーへ書く。**生きているノートと捨てたノートを 1 つのキーに畳む**。
 *
 * ゴミ箱を別のキーにしないのは、Firestore 側が `trashedAt` の印だけで
 * 同じコレクションに置いているから ―― 保存先の形が 2 つあると、
 * 「クラウドでは捨ててあるのに、この端末では生きている」が起きたときに
 * どちらを正とするかの規則が 2 つ要る。
 */
export function writeLocalNotes(notes: readonly Note[], trash: readonly Note[] = []): void {
  try {
    localStorage.setItem(LS_NOTES, JSON.stringify(notes.concat(trash)));
  } catch {
    /* C-33 */
  }
}

/**
 * 読み込んだノートを「生きている / ゴミ箱」に分ける。
 *
 * **`state.notes` にゴミ箱のノートを混ぜない**のがこの関数の存在理由。混ぜてしまうと、
 * 一覧・検索・復習の生成・問題抽出・今日のToDo のすべてに「捨てたものを除く」条件を
 * 書き足すことになり、必ずどこかで漏れる。入口で 1 回分けるほうが確実に安い。
 */
export function splitTrashed(notes: readonly Note[]): { live: Note[]; trash: Note[] } {
  const live: Note[] = [];
  const trash: Note[] = [];
  notes.forEach((n) => (n.trashedAt ? trash : live).push(n));
  return { live, trash };
}

/** `splitTrashed` を `store.setState` へそのまま渡せる形にしたもの */
function splitAsPatch(notes: readonly Note[]): { notes: Note[]; notesTrash: Note[] } {
  const { live, trash } = splitTrashed(notes);
  return { notes: live, notesTrash: trash };
}

// ─────────────────────────────────────────────────────────────
// コントローラ
// ─────────────────────────────────────────────────────────────

export class NotebookController {
  private disposed = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Note | null = null;

  constructor(
    private readonly store: CompassStore,
    private readonly persistence: CompassPersistence,
    private readonly uid: string,
  ) {}

  /**
   * 起動時。まずローカルミラーで即描画し、そのあとクラウドの内容で置き換える。
   * スプラッシュのゲート（`SplashGate`）には**参加しない**（ノートの遅延で起動を止めない）。
   *
   * ⚠ **クラウドが 0 件でもローカルを消さない**。
   *  - preview / Firebase 未設定では `loadNotes()` が常に `[]` を返すスタブなので、
   *    素直に置き換えるとリロードのたびにノートが消える。
   *  - 実 Firebase でも「まだ 1 度も同期できていない端末」は同じ状況になりうる。
   * 端末側に内容があるときはそれを正とし、クラウドへ追いつかせる。
   */
  async boot(): Promise<void> {
    const local = readLocalNotes();
    if (local.length) this.store.setState(splitAsPatch(local));

    // 保存無効の実装（preview / Firebase 未設定）ではローカルが唯一の正
    if (this.persistence.kind === 'local') {
      this.store.setState({ ...splitAsPatch(local), notesLoaded: true });
      return;
    }

    try {
      const rows = await this.persistence.loadNotes(this.uid);
      if (this.disposed) return;
      const cloud = sanitizeNotes(rows);
      if (!cloud.length && local.length) {
        // クラウドが空 = 未同期。ローカルを残したうえで押し上げる
        this.store.setState({ ...splitAsPatch(local), notesLoaded: true });
        local.forEach((n) => void this.push(n));
        return;
      }
      this.store.setState({ ...splitAsPatch(cloud), notesLoaded: true });
      const split = splitTrashed(cloud);
      writeLocalNotes(split.live, split.trash);
    } catch (e) {
      if (this.disposed) return;
      console.warn('[notebook] ノートの読み込みに失敗', e);
      this.store.setState({ notesLoaded: true });
      // ローカルに何も無いときだけ知らせる（見えている内容が古いわけではないので）
      if (!local.length) this.store.showToast(TOAST_NOTES_LOAD_FAIL);
    }
  }

  /** 楽観更新 → localStorage → クラウド。編集中の連打は `debounced` で間引く */
  save(note: Note): void {
    /**
     * 同じノートの**遅れて出ていく控え**（`saveDebounced` の `pending`）を打ち消す。
     *
     * これが無いと、まとめを書いた 600ms 以内にそのノートをゴミ箱へ入れたとき、
     * あとからタイマーが `trashedAt:''` の古い姿を Firestore へ送り、
     * **次の起動でノートが生き返る**。いま渡された姿のほうが必ず新しい。
     */
    if (this.pending && this.pending.id === note.id) {
      this.pending = null;
      if (this.saveTimer !== null) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
    this.applyLocal(note);
    void this.push(note);
  }

  /** 編集モード用。最後の 1 回だけクラウドへ送る */
  saveDebounced(note: Note): void {
    this.applyLocal(note);
    this.pending = note;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const queued = this.pending;
      this.pending = null;
      if (queued) void this.push(queued);
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  /**
   * ノートを**本当に**消す（ゴミ箱からの完全削除、または 30 日経過ぶんの掃除）。
   * 復習のカスケードは `removeNote()` 側で済ませてから呼ぶ。
   *
   * 本人の操作としての「削除」はここではなく、`trashedAt` を立てて `save()` する道を通る
   * （ゴミ箱に 30 日残す。docs/notebook/ux-refresh.md §7）。
   */
  remove(noteId: string): void {
    /**
     * 写真の実体（IndexedDB）も**ここで**落とす。
     *
     * メタデータだけ消しても端末の容量は返らないので、消し忘れると
     * 「31 日前に捨てたノートの写真」が孤児として溜まり続ける。捨てた時点では
     * 消さない ―― 30 日は戻せる約束で、写真の無いノートが戻っても意味がない。
     * 本当に消えるのはこのメソッドだけなので、副作用もここに置く
     * （呼び出し側に配るとどれか 1 つが必ず漏れる）。
     */
    let scans: readonly NoteScan[] = [];
    this.store.setState((s) => {
      const gone = s.notes.find((n) => n.id === noteId) || s.notesTrash.find((n) => n.id === noteId);
      if (gone) scans = gone.scans;
      const notes = s.notes.filter((n) => n.id !== noteId);
      const notesTrash = s.notesTrash.filter((n) => n.id !== noteId);
      writeLocalNotes(notes, notesTrash);
      return {
        notes,
        notesTrash,
        nbSelNoteId: s.nbSelNoteId === noteId ? null : s.nbSelNoteId,
        nbEdit: false,
      };
    });
    if (scans.length) void deleteNoteScans(noteId, scans);
    void this.persistence.deleteNote(this.uid, noteId).catch((e) => {
      if (this.disposed) return;
      this.store.showToast(TOAST_NOTE_SAVE_FAIL_PREFIX + cloudErrorMessage(e));
    });
  }

  /** 保留中の書き込みを吐き出してから止める */
  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.pending) void this.push(this.pending);
    }
    this.pending = null;
    this.disposed = true;
  }

  /**
   * 楽観更新。`trashedAt` の有無で**どちらの棚に置くかまで決める**。
   *
   * 捨てる・戻すも「ノートを 1 件保存する」で表せるようにしてある ―― 専用の経路を
   * 増やすと、Firestore への書き込みが 2 系統になってどちらかが漏れる。
   */
  private applyLocal(note: Note): void {
    this.store.setState((s) => {
      const trashed = !!note.trashedAt;
      const notes = trashed
        ? s.notes.filter((n) => n.id !== note.id)
        : upsertNote(s.notes, note);
      const notesTrash = trashed
        ? upsertNote(s.notesTrash, note)
        : s.notesTrash.filter((n) => n.id !== note.id);
      writeLocalNotes(notes, notesTrash);
      return { notes, notesTrash };
    });
  }

  private async push(note: Note): Promise<void> {
    try {
      await this.persistence.saveNote(this.uid, note as unknown as NoteDoc);
    } catch (e) {
      if (this.disposed) return;
      console.warn('[notebook] ノートの保存に失敗', e);
      this.store.showToast(TOAST_NOTE_SAVE_FAIL_PREFIX + cloudErrorMessage(e));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// モジュールシングルトン（`useStore.ts` の `store` と同じ流儀）
// ─────────────────────────────────────────────────────────────

let currentController: NotebookController | null = null;

/** `CompassApp` の起動 effect から設定する。cleanup では `null` を渡す */
export function setNotebookController(controller: NotebookController | null): void {
  currentController = controller;
}

/** 画面・モーダルから使う。未マウント時は `null`（preview の初回レンダーなど） */
export function notebookController(): NotebookController | null {
  return currentController;
}

// ─────────────────────────────────────────────────────────────
// ノートと復習をまとめて更新する高水準の操作
// ─────────────────────────────────────────────────────────────

export interface CommitNoteOptions {
  /** 上書き取り込みで消えたカード。その系列の未完了復習を掃除する */
  removedCardIds?: readonly string[];
  /** クラウドへの送信をデバウンスする（編集モード） */
  debounce?: boolean;
}

export interface CommitNoteResult {
  /** 新しく作られた復習カードの件数 */
  created: number;
  /** 削除された未完了復習の件数 */
  removed: number;
}

/**
 * ノートを保存し、復習カードを整合させる。取り込みモーダルとノート編集の両方から使う。
 *
 * 1. 消えたカードの未完了復習を落とす（`cascadeNoteRemoval`）
 * 2. 残ったカードの未完了復習のタイトル・教科を追従（`syncNoteReviews`）
 * 3. 系列が無いカードに復習を作る（`generateNoteReviews`。**冪等**）
 * 4. ノートを保存（楽観更新 → localStorage → Firestore）
 * 5. まとめタスクを追従（`syncNoteSummaryTask`。書けたら完了・まだ空なら提案）
 */
export function commitNote(
  store: CompassStore,
  note: Note,
  today: ISODate,
  options: CommitNoteOptions = {},
): CommitNoteResult {
  const { removedCardIds, debounce } = options;
  let created = 0;
  let removed = 0;

  store.setState((s) => {
    let reviews = s.reviews;
    let order = s.order;
    let selId = s.selId;

    // 問だけ消えたときに復習を落とすのはやめた。復習はノート 1 冊で 1 行になったので、
    // 問の増減は下の `syncNoteReviews` がミニタスクを付け替えるだけで足りる
    // （`removedCardIds` は取り込み側の差分表示にはまだ使われている）
    void removedCardIds;

    reviews = syncNoteReviews(note, reviews);
    const gen = generateNoteReviews(note, reviews, today);
    created = gen.created.length;
    if (created) reviews = reviews.concat(gen.created);

    return { reviews, order, selId };
  });

  const ctrl = notebookController();
  if (ctrl) {
    if (debounce) ctrl.saveDebounced(note);
    else ctrl.save(note);
  }

  // 保存のあと（＝ `state.notes` にこのノートが入ったあと）にまとめタスクを合わせる
  syncNoteSummaryTask(store, note, today);

  return { created, removed };
}

/**
 * まとめタスク（docs/daily-mission/plan.md §4.1）をノートの今の姿に合わせる。
 * **まとめの編集も取り込みも `commitNote` を通る**ので、フックはここ 1 か所で足りる。
 *
 *  - まとめが書けている … その提案タスクを完了にする（ToDo でチェックを付け直させない）
 *  - まだ空 … 今日ぶんの提案を積む（起動時とまったく同じ生成関数を通す）
 *
 * 取り込みは夕方が多いので、その場で積むのが効く ―― 書ける気分のうちに今日の
 * ToDo へ載せたい。翌朝の起動まで待たせると、その日の記憶が薄れている。
 */
function syncNoteSummaryTask(store: CompassStore, note: Note, today: ISODate): void {
  if (note.summary.trim()) {
    store.setState((s) => {
      const extras = completeNoteSummaryTasks(s.extras, note);
      return extras === s.extras ? null : { extras };
    });
    return;
  }
  /**
   * まとめが**空に戻された**とき、済みの印も戻す。
   *
   * 書いた時点で `completeNoteSummaryTasks` が「まとめを書く」を完了にするが、
   * そのあと消して空にすると、`noteSumLog` に載っているぶん新しい提案も積まれず、
   * **「まとめは空なのに ToDo は完了」**という嘘が残る。逆関数が無いので、
   * ここで済みの印だけ外して「まだ書けていない」に戻す。
   */
  store.setState((s) => {
    const id = noteSummaryExtraId(note.id);
    let touched = false;
    const extras = s.extras.map((e) => {
      if (e.id !== id || !e.done) return e;
      touched = true;
      return { ...e, done: false };
    });
    return touched ? { extras } : null;
  });

  const s = store.getState();
  // コントローラ未設定（preview の初回など）でも取りこぼさないよう、
  // このノートを入れた一覧で判定する。`upsertNote` は保存済みなら差し替えるだけ
  const gen = generateNoteSummaryTasks({
    today,
    notes: upsertNote(s.notes, note),
    log: s.noteSumLog,
    notesLoaded: s.notesLoaded,
  });
  if (!gen.extras.length && gen.log === s.noteSumLog) return;
  store.setState((prev) => {
    // id が `nbsum-{noteId}` で決まるので、既にあるなら積み直さない（`runAutoGen` と同じ理由）
    const have = new Set(prev.extras.map((x) => x.id));
    return {
      extras: prev.extras.concat(gen.extras.filter((e) => !have.has(e.id))),
      noteSumLog: gen.log,
    };
  });
  gen.extras.forEach((e) => addToOrder(store, e.id));
}

/**
 * ノート操作（捨てる / 戻す / 改名 / その取り消し）の結果を state とクラウドへ流す。
 *
 * **`store.resetUndoBaseline()` を挟むのがこの関数の存在理由。**
 *
 * ノート操作は `reviews` / `extras` / `order` を書き換えるが、この 3 つは `UNDO_KEYS` に
 * 入っているので、放っておくと**アプリ本体の 1 段 Undo にも同じ操作が記録される**。
 * ところが `notes` は一時 state で `UNDO_KEYS` に無い。その結果:
 *
 *   1. ノートを捨てる（復習も消す）
 *   2. ⌘Z … ノート用の取り消しが効いて全部戻る（`nbUndo` は空になる）
 *   3. もう一度 ⌘Z … ノート用の履歴が尽きたので本体の Undo へ落ち、
 *      **`reviews` だけが「捨てた直後」へ巻き戻る**。ノートは生きたままなので、
 *      生きているノートの復習だけが消え、もうどこからも戻せない
 *
 * という 3 手で間隔が永久に失われる。ベースラインを操作のたびに引き直せば、
 * ノート操作は本体の Undo に二重帳簿されなくなる。
 *
 * 代償として、**ノートを触ると直前の（ノート以外の）操作の Undo が 1 段消える**。
 * 上の消失と引き換えなら安い ―― あちらは戻す手立てが無く、こちらは戻せないだけ。
 */
export function applyNoteOutcome(
  store: CompassStore,
  out: { next: Partial<AppState>; note: Note | null; changed: boolean },
  extra?: Partial<AppState>,
): boolean {
  if (!out.changed) {
    if (extra) store.setState(extra);
    return false;
  }
  store.setState({ ...out.next, ...extra });
  store.resetUndoBaseline();
  if (out.note) notebookController()?.save(out.note);
  return true;
}

/**
 * 想起問題を 1 回解いた記録をノートに書き足す（`NoteCard.attempts`）。
 *
 * **復習には触らない。** 間隔の計算は `ReviewShared.completeReview` の仕事で、
 * ここは「この問題を、いつ、どう感じたか」だけを残す。だから問題抽出のような
 * 予定外の解き直しからも同じように呼べる（予定を乱さずに履歴だけ増える）。
 *
 * @returns 記録できたら `true`（ノート／カードが見つからなければ `false`）
 */
export function recordNoteAttempt(
  store: CompassStore,
  noteId: string,
  cardId: string,
  day: ISODate,
  grade: ReviewGrade,
): boolean {
  const note = store.getState().notes.find((n) => n.id === noteId);
  if (!note || !note.cards.some((c) => c.cardId === cardId)) return false;

  const next: Note = {
    ...note,
    cards: note.cards.map((c) =>
      c.cardId === cardId ? { ...c, attempts: c.attempts.concat([{ day, grade }]) } : c,
    ),
    updatedAt: day,
  };
  store.setState((s) => ({ notes: upsertNote(s.notes, next) }));
  notebookController()?.save(next);
  return true;
}

/**
 * ノートを消し、そのノート由来の**未完了**復習とまとめタスクも片付ける
 * （完了済みはどちらも学習履歴なので残す）。
 *
 * @returns 削除した復習の件数（トーストの文言に使う。まとめタスクは数に入れない）
 */
export function removeNote(store: CompassStore, noteId: string): number {
  let removed = 0;
  store.setState((s) => {
    const cascade = cascadeNoteRemoval(s.reviews, s.order, s.selId, noteId);
    removed = cascade.removedIds.length;
    // まとめタスクも同じ流儀で片付ける（`order` / `selId` は復習の結果に重ねる）
    const sum = cascadeNoteSummaryRemoval(s.extras, cascade.order, cascade.selId, noteId);
    if (!removed && !sum.removedIds.length) return null;
    return {
      reviews: cascade.reviews,
      extras: sum.extras,
      order: sum.order,
      selId: sum.selId,
    };
  });
  notebookController()?.remove(noteId);
  return removed;
}
