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
} from '../../lib/logic/noteSummaryTasks';
import { type Note } from '../../lib/model/notes';
import type { ISODate, ReviewGrade } from '../../lib/model/types';
import { cloudErrorMessage, type CompassPersistence, type NoteDoc } from '../../lib/persistence';
import type { CompassStore } from '../../lib/store';
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

export function writeLocalNotes(notes: readonly Note[]): void {
  try {
    localStorage.setItem(LS_NOTES, JSON.stringify(notes));
  } catch {
    /* C-33 */
  }
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
    if (local.length) this.store.setState({ notes: local });

    // 保存無効の実装（preview / Firebase 未設定）ではローカルが唯一の正
    if (this.persistence.kind === 'local') {
      this.store.setState({ notes: local, notesLoaded: true });
      return;
    }

    try {
      const rows = await this.persistence.loadNotes(this.uid);
      if (this.disposed) return;
      const cloud = sanitizeNotes(rows);
      if (!cloud.length && local.length) {
        // クラウドが空 = 未同期。ローカルを残したうえで押し上げる
        this.store.setState({ notes: local, notesLoaded: true });
        local.forEach((n) => void this.push(n));
        return;
      }
      this.store.setState({ notes: cloud, notesLoaded: true });
      writeLocalNotes(cloud);
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

  /** ノートを消す。復習のカスケードは `removeNote()` 側で済ませてから呼ぶ */
  remove(noteId: string): void {
    this.store.setState((s) => {
      const notes = s.notes.filter((n) => n.id !== noteId);
      writeLocalNotes(notes);
      return {
        notes,
        nbSelNoteId: s.nbSelNoteId === noteId ? null : s.nbSelNoteId,
        nbEdit: false,
      };
    });
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

  private applyLocal(note: Note): void {
    this.store.setState((s) => {
      const notes = upsertNote(s.notes, note);
      writeLocalNotes(notes);
      return { notes };
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

    if (removedCardIds && removedCardIds.length) {
      const cascade = cascadeNoteRemoval(reviews, order, selId, note.id, removedCardIds);
      reviews = cascade.reviews;
      order = cascade.order;
      selId = cascade.selId;
      removed = cascade.removedIds.length;
    }

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
