/**
 * Compass — ノートのカード ↔ 復習の連携
 *
 * 仕様: docs/notebook/spec.md §4、受け入れ N-021〜N-034。
 *
 * ## 設計の要（絶対に崩さない不変条件）
 *
 * `Review` 型にフィールドを足さない。`nextReviewOf`（`logic/reviews.ts`）が次回の復習を作るとき
 * 引き継ぐのは **`seriesId` / `title` / `subj` / `timetablePeriod` / `timetableDate`** だけで、
 * 独自フィールドは 1 段階目の遷移で消える。そこで
 *
 * ```
 * seriesId === 'nb-' + noteId + '-' + cardId
 * ```
 *
 * という**命名規約**にリンクを載せる。`seriesId` は
 * `seriesId: review.seriesId || review.id` として無条件に継承されるため、
 * 定着まで進んでもノート・カードを引き直せる（N-027 がこの不変条件を固定する）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import { cardNoOf, type Note } from '../model/notes';
import type { ISODate, Review } from '../model/types';

/** `noteSeriesId` が作る id の形。`invalidDocIdReason` にも通る（`/` も `__` も含まない） */
const NOTE_SERIES_RE = /^nb-(n[0-9a-z]+)-(c[0-9a-z]+)$/;

/** ノート由来の復習に付ける出典（Review 表の「出典」列に出る） */
export const NOTE_REVIEW_SRC = 'ノートから生成';

/** 1 カードの復習の初期サイズ。想起問題 1 問なので XS 相当 */
export const NOTE_REVIEW_MIN = 5;

/** ノート ID + カード ID → 系列 ID */
export function noteSeriesId(noteId: string, cardId: string): string {
  return 'nb-' + noteId + '-' + cardId;
}

export interface NoteRef {
  noteId: string;
  cardId: string;
}

/**
 * 系列 ID → ノート・カード。ノート由来でなければ `null`（手動追加の `'u…'` など, N-026）。
 * `dataPatch` M3 が単独行の `seriesId` を自分の id へ書き換えた場合もここで `null` になり、
 * 呼び出し側は従来表示にフォールバックする（spec §12-1）。
 */
export function noteRefOf(seriesId: string | null | undefined): NoteRef | null {
  if (typeof seriesId !== 'string') return null;
  const m = NOTE_SERIES_RE.exec(seriesId);
  return m ? { noteId: m[1], cardId: m[2] } : null;
}

/** 復習行がこのノート由来か */
export function isNoteReview(review: Pick<Review, 'seriesId'>, noteId?: string): boolean {
  const ref = noteRefOf(review.seriesId);
  return !!ref && (noteId === undefined || ref.noteId === noteId);
}

/** 復習タイトル。カードごとに一意にして `dataPatch` M3 の意味キー結合と衝突させない（spec §12-1） */
export function noteReviewTitle(note: Note, cardId: string): string {
  return note.unit + ' 問' + cardNoOf(note, cardId);
}

// ─────────────────────────────────────────────────────────────
// 生成（N-021〜N-029）
// ─────────────────────────────────────────────────────────────

export interface NoteReviewGenResult {
  /** 新規に作られた復習だけ（既存には触れない） */
  created: Review[];
  /** すでに系列がある＝作らなかったカードの数 */
  skipped: number;
}

/**
 * ノートのカードから復習を作る。**同じ `seriesId` の行が 1 件でもあれば作らない**ので、
 * 同じ JSON を何度取り込んでも増えない（N-022）。完了済みの行しか残っていない場合も
 * 「その系列は消化済み」とみなして作らない。
 *
 * 初回は **`stage:'当日'` / `due:今日` / `added:true`**。授業が終わってノートを貼ったら、
 * その日のうちに「今日のToDo」へ出て復習できる（ワークフロー手順 4）。
 * 以後は `nextReviewOf` が 翌日 → 3日後 → 1週間後 → 2週間後 → 定着 と送る。
 *
 * @param note     取り込み直後 / 編集直後のノート
 * @param existing `state.reviews`
 * @param today    今日（`due` も今日）
 */
export function generateNoteReviews(
  note: Note,
  existing: readonly Review[],
  today: ISODate,
): NoteReviewGenResult {
  const known = new Set(existing.map((r) => r.seriesId || r.id));
  const created: Review[] = [];
  let skipped = 0;

  note.cards.forEach((card) => {
    const seriesId = noteSeriesId(note.id, card.cardId);
    if (known.has(seriesId)) {
      skipped += 1;
      return;
    }
    created.push({
      // 手動追加と同型（`id === seriesId`）。以後の世代だけ id が別になる
      id: seriesId,
      seriesId,
      reviewNo: 1,
      title: noteReviewTitle(note, card.cardId),
      subj: note.subject,
      stage: '当日',
      last: today,
      due: today,
      min: NOTE_REVIEW_MIN,
      src: NOTE_REVIEW_SRC,
      timetablePeriod: null,
      timetableDate: null,
      // 授業当日にそのまま消化できるよう、最初から今日の ToDo に積む
      added: true,
      done: false,
    });
  });

  return { created, skipped };
}

// ─────────────────────────────────────────────────────────────
// 今日ぶんの束ね（ノート 1 冊 = ToDo 1 枚）
// ─────────────────────────────────────────────────────────────

/** 今日やるカード 1 問ぶん */
export interface DueCard {
  reviewId: string;
  cardId: string;
  /** 何問目か（1 始まり）。カードがノートから消えていると `null` */
  cardNo: number | null;
  review: Review;
}

/**
 * あるノートについて「今日ぶんの復習カード」を集める。
 *
 * - `due <= today` の未完了行
 * - **今日完了した行も残す**（ToDo の 1 枚が消えず、進捗として見えるように）。
 *   `due < today` の完了行（前回までの履歴）は含めない。`itemOf` の
 *   `r.added && !(r.done && r.due < today)` と同じ考え方。
 */
export function dueCardsOfNote(
  reviews: readonly Review[],
  note: Pick<Note, 'id' | 'cards'>,
  today: ISODate,
): DueCard[] {
  const order = new Map(note.cards.map((c, i) => [c.cardId, i]));
  const out: DueCard[] = [];
  reviews.forEach((r) => {
    const ref = noteRefOf(r.seriesId);
    if (!ref || ref.noteId !== note.id) return;
    if (r.due > today) return;
    if (r.done && r.due < today) return;
    const idx = order.get(ref.cardId);
    out.push({
      reviewId: r.id,
      cardId: ref.cardId,
      cardNo: idx === undefined ? null : idx + 1,
      review: r,
    });
  });
  // ノート内の問番号どおりに並べる（ノートから消えたカードは末尾）
  return out.sort((a, b) => (a.cardNo ?? 99) - (b.cardNo ?? 99));
}

/** トースト文言。0 件のときは `null`（何も出さない） */
export function generateMessage(result: NoteReviewGenResult): string | null {
  if (!result.created.length) return null;
  return '復習カードを' + result.created.length + '件作成しました';
}

// ─────────────────────────────────────────────────────────────
// 同期（N-034）
// ─────────────────────────────────────────────────────────────

/**
 * 単元名・教科を編集したときに、**未完了の**ノート由来復習だけタイトルと教科を追従させる。
 * 完了済みの行は学習履歴なので触らない。
 */
export function syncNoteReviews(note: Note, reviews: readonly Review[]): Review[] {
  const byCard = new Map(note.cards.map((c) => [c.cardId, c.cardId]));
  let changed = false;
  const out = reviews.map((r) => {
    if (r.done) return r;
    const ref = noteRefOf(r.seriesId);
    if (!ref || ref.noteId !== note.id || !byCard.has(ref.cardId)) return r;
    const title = noteReviewTitle(note, ref.cardId);
    if (r.title === title && r.subj === note.subject) return r;
    changed = true;
    return { ...r, title, subj: note.subject };
  });
  return changed ? out : (reviews as Review[]);
}

// ─────────────────────────────────────────────────────────────
// カスケード削除（N-030〜N-033）
// ─────────────────────────────────────────────────────────────

export interface CascadeResult {
  reviews: Review[];
  order: string[];
  selId: string | null;
  /** 実際に削除した復習の id */
  removedIds: string[];
}

/**
 * ノート（またはその一部のカード）を消したときの復習の後片付け。
 * `dataPatch` M4（HTML:2253-2262）と同じ形で `reviews` / `order` / `selId` を整える。
 *
 * **未完了の行だけ**削除する。完了済みは `studyLog` に記録済みの学習履歴なので残す（N-030）。
 *
 * @param cardIds 指定するとそのカードの系列だけ。省略でノート全体
 */
export function cascadeNoteRemoval(
  reviews: readonly Review[],
  order: readonly string[],
  selId: string | null,
  noteId: string,
  cardIds?: readonly string[],
): CascadeResult {
  const target = cardIds ? new Set(cardIds) : null;
  const removedIds: string[] = [];
  const kept = reviews.filter((r) => {
    if (r.done) return true;
    const ref = noteRefOf(r.seriesId);
    if (!ref || ref.noteId !== noteId) return true;
    if (target && !target.has(ref.cardId)) return true;
    removedIds.push(r.id);
    return false;
  });
  if (!removedIds.length) {
    return { reviews: reviews as Review[], order: order as string[], selId, removedIds };
  }
  const gone = new Set(removedIds);
  return {
    reviews: kept,
    order: order.filter((id) => !gone.has(id)),
    selId: selId && gone.has(selId) ? null : selId,
    removedIds,
  };
}
