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
import type { Note } from '../../lib/model/notes';
import type { ISODate } from '../../lib/model/types';
import { cloudErrorMessage, type CompassPersistence, type NoteDoc } from '../../lib/persistence';
import type { CompassStore } from '../../lib/store';

/** ノートのローカルミラー。`compass-ui` / `compass-ui-data` に続く 3 つめのキー */
export const LS_NOTES = 'compass-notes';

/** 編集モードのトレーリングデバウンス（1 文字ごとに Firestore へ書かないため） */
export const NOTE_SAVE_DEBOUNCE_MS = 600;

export const TOAST_NOTES_LOAD_FAIL = 'ノートの読み込みに失敗しました(この端末の内容を表示中)';
export const TOAST_NOTE_SAVE_FAIL_PREFIX = 'ノートの保存に失敗: ';

// ─────────────────────────────────────────────────────────────
// 生データ → Note
// ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * localStorage / Firestore から来た生データを `Note` として読む。
 * 壊れた行は**黙って捨てる**（`dataPatch` と同じ方針。起動を止めない）。
 */
export function sanitizeNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const out: Note[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const n = item as Record<string, unknown>;
    if (!str(n.id) || !Array.isArray(n.cards)) return;
    const cards = (n.cards as Record<string, unknown>[])
      .filter((c) => c && typeof c === 'object' && str(c.cardId))
      .map((c) => ({
        cardId: str(c.cardId),
        q: str(c.q),
        a: str(c.a),
        guide: str(c.guide),
        src: str(c.src),
      }));
    const blocks = (Array.isArray(n.blocks) ? (n.blocks as Record<string, unknown>[]) : [])
      .filter((b) => b && typeof b === 'object' && (b.t === 'def' || b.t === 'ex'))
      .map((b) =>
        b.t === 'def'
          ? { t: 'def' as const, title: str(b.title), body: str(b.body) }
          : {
              t: 'ex' as const,
              cardId: typeof b.cardId === 'string' ? b.cardId : null,
              guide: str(b.guide),
              solution: str(b.solution),
              caution: str(b.caution),
            },
      );
    const ex = n.exercise && typeof n.exercise === 'object' ? (n.exercise as Record<string, unknown>) : {};
    out.push({
      id: str(n.id),
      v: 1,
      date: str(n.date),
      subject: str(n.subject),
      unit: str(n.unit),
      cards,
      blocks,
      exercise: { q: str(ex.q), a: str(ex.a) },
      doubt: str(n.doubt),
      notice: str(n.notice),
      createdAt: str(n.createdAt) || str(n.date),
      updatedAt: str(n.updatedAt) || str(n.date),
    });
  });
  return sortNoteList(out);
}

/** 新しい授業日が先。同日は id 昇順（`persistence.sortNotes` と同じ規則） */
export function sortNoteList(notes: readonly Note[]): Note[] {
  return notes.slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** 同じ id があれば差し替え、無ければ足してから並べ直す */
export function upsertNote(notes: readonly Note[], note: Note): Note[] {
  const exists = notes.some((n) => n.id === note.id);
  return sortNoteList(exists ? notes.map((n) => (n.id === note.id ? note : n)) : notes.concat([note]));
}

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
   */
  async boot(): Promise<void> {
    const local = readLocalNotes();
    if (local.length) this.store.setState({ notes: local });
    try {
      const rows = await this.persistence.loadNotes(this.uid);
      if (this.disposed) return;
      const notes = sanitizeNotes(rows);
      this.store.setState({ notes, notesLoaded: true });
      writeLocalNotes(notes);
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

  return { created, removed };
}

/** ノートを消し、そのノート由来の**未完了**復習も片付ける（完了済みは履歴として残す） */
export function removeNote(store: CompassStore, noteId: string): number {
  let removed = 0;
  store.setState((s) => {
    const cascade = cascadeNoteRemoval(s.reviews, s.order, s.selId, noteId);
    removed = cascade.removedIds.length;
    if (!removed) return null;
    return { reviews: cascade.reviews, order: cascade.order, selId: cascade.selId };
  });
  notebookController()?.remove(noteId);
  return removed;
}
