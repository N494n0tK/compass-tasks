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

import { type Note } from '../model/notes';
import type { ISODate, Review, ReviewGrade } from '../model/types';

/**
 * `noteSeriesId` が作る id の形。`invalidDocIdReason` にも通る（`/` も `__` も含まない）。
 *
 * カード ID の部分は**省略できる**。いまの復習は**ノート 1 冊 = 1 行**（`nb-{noteId}`）だが、
 * 2026-08 より前に作られた行は問ごとに分かれていた（`nb-{noteId}-{cardId}`）。
 * 完了済みの古い行は学習履歴として残り続けるので、そちらも同じノートとして読めないと
 * 「この復習はどのノートのものか」を辿れなくなる。
 */
const NOTE_SERIES_RE = /^nb-(n[0-9a-z]+)(?:-(c[0-9a-z]+))?$/;

/** ノート由来の復習に付ける出典（Review 表の「出典」列に出る） */
export const NOTE_REVIEW_SRC = 'ノートから生成';

/** 想起問題 1 問ぶんの見積り（分）。ノート 1 冊ぶんはこれ × 問数 */
export const NOTE_REVIEW_MIN = 5;

/**
 * ノート ID → 系列 ID。**ノート 1 冊で 1 系列**。
 *
 * 2026-08 までは問ごとに 1 系列（`nb-{noteId}-{cardId}`）だった。やめた理由は
 * 本人の言葉そのままで、復習の一覧が「単元名 問1」「単元名 問2」…と同じ行で
 * 埋まってしまい、**その日に何をやるのかが読めなくなった**から。
 * いまは 1 冊 1 行にして、問は**ミニタスク**（`subs` の「問1」…）として中に入れる。
 */
export function noteSeriesId(noteId: string): string {
  return 'nb-' + noteId;
}

export interface NoteRef {
  noteId: string;
  /** 古い「問ごと」の行だけ入る。いまの行は `null`（1 冊で 1 行なので問を指さない） */
  cardId: string | null;
}

/**
 * 系列 ID → ノート・カード。ノート由来でなければ `null`（手動追加の `'u…'` など, N-026）。
 * `dataPatch` M3 が単独行の `seriesId` を自分の id へ書き換えた場合もここで `null` になり、
 * 呼び出し側は従来表示にフォールバックする（spec §12-1）。
 */
export function noteRefOf(seriesId: string | null | undefined): NoteRef | null {
  if (typeof seriesId !== 'string') return null;
  const m = NOTE_SERIES_RE.exec(seriesId);
  return m ? { noteId: m[1], cardId: m[2] || null } : null;
}

/** 復習行がこのノート由来か */
export function isNoteReview(review: Pick<Review, 'seriesId'>, noteId?: string): boolean {
  const ref = noteRefOf(review.seriesId);
  return !!ref && (noteId === undefined || ref.noteId === noteId);
}

/** 復習タイトル。**単元名そのまま**（問番号はミニタスクの側に出る） */
export function noteReviewTitle(note: Pick<Note, 'unit'>): string {
  return note.unit || '(単元名なし)';
}

/**
 * ミニタスクの並び。「問1」…「問N」。
 *
 * ここを問題文にしないのは、今日の ToDo の 1 行に長い問いが並ぶと、
 * **開く前に答えが目に入る**から（想起の練習にならない）。番号だけ出して、
 * 中身はドリル面で 1 問ずつめくる。
 */
export function noteReviewSubs(note: Pick<Note, 'cards'>): string[] {
  return note.cards.map((_, i) => '問' + (i + 1));
}

/** ノート 1 冊ぶんの見積り（分）。問が 0 のときも 1 問ぶんは見ておく */
export function noteReviewMin(note: Pick<Note, 'cards'>): number {
  return NOTE_REVIEW_MIN * Math.max(1, note.cards.length);
}

// ─────────────────────────────────────────────────────────────
// 生成（N-021〜N-029）
// ─────────────────────────────────────────────────────────────

export interface NoteReviewGenResult {
  /** 新規に作られた復習だけ（既存には触れない） */
  created: Review[];
  /** すでに系列がある＝作らなかったノートの数（0 か 1） */
  skipped: number;
}

/**
 * ノートから復習を **1 冊につき 1 件**作る。**同じ `seriesId` の行が 1 件でもあれば作らない**ので、
 * 同じ JSON を何度取り込んでも増えない（N-022）。完了済みの行しか残っていない場合も
 * 「その系列は消化済み」とみなして作らない。
 *
 * 問は消さずに**ミニタスク**（`subs` の「問1」…）として 1 行の中へ入れる。
 * こうすると復習の一覧が単元の並びになり、その日にどの単元をやるのかが読める。
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
  // 問が 1 つも無いノートには作らない（開いても解くものが無い）
  if (!note.cards.length) return { created: [], skipped: 0 };

  const seriesId = noteSeriesId(note.id);
  const known = new Set(existing.map((r) => r.seriesId || r.id));
  if (known.has(seriesId)) return { created: [], skipped: 1 };

  // 古い「問ごと」の行が未完了で残っているノートには作らない。
  // ここで足すと、移行（`collapseNoteReviews`）が走るまでの一瞬だけ二重に並ぶ
  const hasLegacy = existing.some((r) => {
    if (r.done) return false;
    const ref = noteRefOf(r.seriesId);
    return !!ref && ref.noteId === note.id && !!ref.cardId;
  });
  if (hasLegacy) return { created: [], skipped: 1 };

  const subs = noteReviewSubs(note);
  return {
    created: [
      {
        // 手動追加と同型（`id === seriesId`）。以後の世代だけ id が別になる
        id: seriesId,
        seriesId,
        reviewNo: 1,
        title: noteReviewTitle(note),
        subj: note.subject,
        stage: '当日',
        last: today,
        due: today,
        min: noteReviewMin(note),
        src: NOTE_REVIEW_SRC,
        timetablePeriod: null,
        timetableDate: null,
        // 授業当日にそのまま消化できるよう、最初から今日の ToDo に積む
        added: true,
        done: false,
        subs,
        subsDone: subs.map(() => false),
        subSizes: subs.map(() => ''),
      },
    ],
    skipped: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 移行（問ごと → 1 冊 1 行）
// ─────────────────────────────────────────────────────────────

/**
 * 2026-08 より前に作られた「問ごと」の復習を、**1 冊 1 行**へ畳む。
 *
 * 起動時に 1 回通す（`CompassApp`）。**冪等**なので何度通しても増減しない。
 *
 *  - 未完了の `nb-{note}-{card}` を集めて 1 行にする。日付は**いちばん遅れている行**
 *    （`due` が最小）から引き継ぐ ―― 進んでいるほうに合わせると、遅れていた問が
 *    黙って先送りされる
 *  - `reviewNo` / `stage` も同じ行から取る（間隔を勝手に進めない）
 *  - **完了済みの古い行は触らない**。`studyLog` に対応する学習履歴なので残す
 *  - 既に 1 冊 1 行があるノートは、古い未完了行を落とすだけ
 */
export function collapseNoteReviews(
  reviews: readonly Review[],
  notes: readonly Note[],
  _today: ISODate,
): { reviews: Review[]; changed: boolean } {
  const byId = new Map(notes.map((n) => [n.id, n]));
  /** ノート id → 畳む対象の古い行 */
  const legacy = new Map<string, Review[]>();
  reviews.forEach((r) => {
    if (r.done) return;
    const ref = noteRefOf(r.seriesId);
    if (!ref || !ref.cardId) return;
    const list = legacy.get(ref.noteId);
    if (list) list.push(r);
    else legacy.set(ref.noteId, [r]);
  });
  if (!legacy.size) return { reviews: reviews as Review[], changed: false };

  const drop = new Set<string>();
  const born: Review[] = [];
  const haveUnit = new Set(
    reviews
      .map((r) => noteRefOf(r.seriesId))
      .filter((ref): ref is NoteRef => !!ref && !ref.cardId)
      .map((ref) => ref.noteId),
  );

  legacy.forEach((rows, noteId) => {
    rows.forEach((r) => drop.add(r.id));
    if (haveUnit.has(noteId)) return; // もう 1 冊 1 行がある。古いのを落とすだけ
    const note = byId.get(noteId);
    if (!note) return; // ノートが無い（消された）。行も残さない
    // いちばん遅れている行に合わせる
    const head = rows.slice().sort((a, b) => a.due.localeCompare(b.due) || a.reviewNo - b.reviewNo)[0];
    const subs = noteReviewSubs(note);
    born.push({
      ...head,
      id: noteSeriesId(noteId),
      seriesId: noteSeriesId(noteId),
      title: noteReviewTitle(note),
      subj: note.subject,
      min: noteReviewMin(note),
      added: rows.some((r) => r.added),
      subs,
      subsDone: subs.map(() => false),
      subSizes: subs.map(() => ''),
    });
  });

  const kept = reviews.filter((r) => !drop.has(r.id));
  return { reviews: kept.concat(born), changed: true };
}

// ─────────────────────────────────────────────────────────────
// 今日ぶんの束ね（ノート 1 冊 = ToDo 1 枚）
// ─────────────────────────────────────────────────────────────

/** ドリル面に出す 1 問ぶん */
export interface DueCard {
  /** どの復習行のミニタスクか（ノート 1 冊で 1 行なので、全部同じ id） */
  reviewId: string;
  cardId: string;
  /** 何問目か（1 始まり） */
  cardNo: number;
  /** そのミニタスクが済んでいるか（`Review.subsDone`） */
  done: boolean;
}

/** そのノートの今日ぶん */
export interface NoteDue {
  /** ノート 1 冊ぶんの復習行 */
  review: Review;
  /** 中の問（ノートの並び順） */
  cards: DueCard[];
  /** まだ済んでいない問 */
  remaining: number;
}

/**
 * あるノートについて「今日ぶんの復習」を引く。
 *
 * - `due <= today` の未完了行
 * - **今日完了した行も残す**（ToDo の 1 枚が消えず、進捗として見えるように）。
 *   `due < today` の完了行（前回までの履歴）は含めない。`itemOf` の
 *   `r.added && !(r.done && r.due < today)` と同じ考え方。
 *
 * 今日ぶんが無ければ `null`。
 */
export function dueCardsOfNote(
  reviews: readonly Review[],
  note: Pick<Note, 'id' | 'cards'>,
  today: ISODate,
): NoteDue | null {
  const sid = noteSeriesId(note.id);
  const review = reviews.find((r) => {
    if ((r.seriesId || r.id) !== sid) return false;
    if (r.due > today) return false;
    return !(r.done && r.due < today);
  });
  if (!review) return null;
  const doneFlags = review.subsDone || [];
  const cards: DueCard[] = note.cards.map((c, i) => ({
    reviewId: review.id,
    cardId: c.cardId,
    cardNo: i + 1,
    // 行そのものが完了していれば、中の問も全部済み扱い
    done: review.done || !!doneFlags[i],
  }));
  return { review, cards, remaining: cards.filter((c) => !c.done).length };
}

/**
 * そのノートで**今日つけた丸のうち、いちばん低いもの**。1 つも無ければ `null`。
 *
 * ノート 1 冊 = 復習 1 行になったので、行を送るときの理解度をどれか 1 つに決めないといけない。
 * いちばん低いものを採るのは、5 問中 4 問できても 1 問がまるで駄目なら
 * その単元はまだ「ばっちり」ではないから ―― 高いほうに合わせると、
 * 分かっていない問だけが間隔の外へこぼれ落ちる。
 */
export function worstGradeToday(
  notes: readonly Note[],
  noteId: string,
  today: ISODate,
): ReviewGrade | null {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return null;
  // 低い順。`low` が 1 つでもあればそれ
  const order: ReviewGrade[] = ['low', 'mid', 'high'];
  let best = -1;
  note.cards.forEach((c) => {
    c.attempts.forEach((a) => {
      if (a.day !== today) return;
      const rank = order.indexOf(a.grade);
      if (rank >= 0 && (best < 0 || rank < best)) best = rank;
    });
  });
  return best < 0 ? null : order[best];
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
  const sid = noteSeriesId(note.id);
  const title = noteReviewTitle(note);
  const subs = noteReviewSubs(note);
  const min = noteReviewMin(note);
  let changed = false;
  const out = reviews.map((r) => {
    if (r.done) return r;
    if ((r.seriesId || r.id) !== sid) return r;
    // ミニタスクの「済み」は**位置で引き継ぐ**。問が増減しても、
    // 残っている問の進み具合まで巻き戻さない
    const wasDone = r.subsDone || [];
    const subsDone = subs.map((_, i) => !!wasDone[i]);
    const same =
      r.title === title &&
      r.subj === note.subject &&
      r.min === min &&
      (r.subs || []).join('\u0000') === subs.join('\u0000') &&
      (r.subsDone || []).join(',') === subsDone.join(',');
    if (same) return r;
    changed = true;
    return {
      ...r,
      title,
      subj: note.subject,
      min,
      subs,
      subsDone,
      subSizes: subs.map((_, i) => (r.subSizes || [])[i] || ''),
    };
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
 * 問だけ消えたときにここは呼ばない ―― 復習はノート 1 冊で 1 行になったので、
 * 問の増減は `syncNoteReviews` がミニタスクを付け替えるだけで済む。
 * 古い「問ごと」の行が残っている場合もまとめて落とす（`noteRefOf` が両方を読む）。
 */
export function cascadeNoteRemoval(
  reviews: readonly Review[],
  order: readonly string[],
  selId: string | null,
  noteId: string,
): CascadeResult {
  const removedIds: string[] = [];
  const kept = reviews.filter((r) => {
    if (r.done) return true;
    const ref = noteRefOf(r.seriesId);
    if (!ref || ref.noteId !== noteId) return true;
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
