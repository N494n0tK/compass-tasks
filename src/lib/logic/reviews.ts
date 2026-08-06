/**
 * Compass — 復習（間隔反復）ロジック（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * 出典:
 *  - HTML:3129-3137（`stageNext` / `stageDays` / `legacyReviewNo` / `reviewNoOf` / `sizeOfMin`）
 *  - HTML:3145（`askSizeCur`）、3146-3185（`confirmAsk` — 間隔反復の本体）
 *  - HTML:3321-3332（`revBulkTargets` / `revBulkAdd`、v0.9 追加）
 *  - HTML:3337-3349（`shiftDue`、v0.9 の相対シフト版）
 *  - HTML:2502（`mutReview`）、2602-2604（`addToOrder` の重複ガード）
 *  - spec §6.1 / §6.2 / §6.4「一括ToDo追加」/ §6.5「次回復習日を変更」
 *
 * v0.9 の修正（A3 / Q8, Q9）は**修正後の挙動**を移植する:
 *  - `'定着 🎉'`（および `stageDays` に無い未知の stage）は high だけでなく **mid でも系列終了**
 *  - `shiftDue` は 13 日カレンダー（DIDX）を経由せず **due 自身を起点に ±1 日**、下限は
 *    `min(due, today)`。動かないときは mutate せずトーストだけ差し替える
 *
 * 純ロジック。React / firebase を import しない。
 */

import type {
  ISODate,
  Review,
  ReviewGrade,
  ReviewStage,
  ReviewStageValue,
  SizeKey,
  StudyLogEntry,
} from '../model/types';
import { type DateContext, dateContextFor, dayLabel, fmtMD, isoShift } from './dates';

// ─────────────────────────────────────────────────────────────
// 定数（HTML:3130-3132）
// ─────────────────────────────────────────────────────────────

/**
 * 索引は必ず `| undefined` になる型。レガシーの素のオブジェクト参照
 * （`stageDays[ns]` が未知 stage で `undefined` になり、`!stageDays[ns]` が系列終了の判定に
 * なっている）を型の上でもそのまま再現するために使う。
 */
type StageTable<V> = { readonly [stage: string]: V | undefined };

/** `stageNext`（HTML:3130）— 「ばっちり」で進む次の stage。`'定着 🎉'` の次は無い */
export const STAGE_NEXT: StageTable<ReviewStage> = {
  翌日: '3日後',
  '3日後': '1週間後',
  '1週間後': '2週間後',
  '2週間後': '定着 🎉',
};

/**
 * `stageDays`（HTML:3131）— stage → 今日からのオフセット日数。
 * **`'定着 🎉'` はキーを持たない**（= これが「系列終了」のシグナルそのもの）。
 */
export const STAGE_DAYS: StageTable<number> = {
  翌日: 1,
  '3日後': 3,
  '1週間後': 7,
  '2週間後': 14,
};

/** `legacyReviewNo`（HTML:3132）— `reviewNo` 未保存の旧データを stage から補完する表 */
export const LEGACY_REVIEW_NO: StageTable<number> = {
  翌日: 1,
  '3日後': 2,
  '1週間後': 3,
  '2週間後': 4,
  '定着 🎉': 5,
};

/**
 * `this.SIZE_MIN`（HTML:2037）のローカルコピー。
 * `confirmAsk` が `nmin = this.SIZE_MIN[askSizeCur]` を引くためだけに使う。
 */
const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/** `due` が `'YYYY-MM-DD'` 形式か（HTML:3342 の正規表現） */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 理解度未選択で「✓ 復習を完了する」を押したときのトースト（HTML:3148）。判定は呼び出し側 */
export const GRADE_REQUIRED_MESSAGE = '理解度を選んでください';

/** `shiftDue` が下限に張り付いて日付が動かないときのトースト（HTML:3346） */
export const SHIFT_DUE_BLOCKED_MESSAGE = '次回復習日はこれ以上前にできません';

// ─────────────────────────────────────────────────────────────
// 小さな導出関数
// ─────────────────────────────────────────────────────────────

/** `reviewNoOf` が読む最小限の形。実データには `reviewNo` が文字列/欠損の行が混ざりうる */
export interface ReviewNoSource {
  reviewNo?: number | string | null;
  stage?: ReviewStageValue | null;
}

/**
 * `reviewNoOf(review)`（HTML:3133-3136）— 表示・採番に使う「第N回」。
 *
 * ```js
 * const savedNo = Math.floor(Number(review && review.reviewNo));
 * return savedNo >= 1 ? savedNo : (review && legacyReviewNo[review.stage]) || 1;
 * ```
 * `review` が falsy のときレガシーは `Number(null|undefined)` 経由で必ず 1 を返すので、
 * ここでも早期に 1 を返す（等価）。保存値が 0 / 負 / 非数 / 小数のときも同じ結果になる。
 */
export function reviewNoOf(review: ReviewNoSource | null | undefined): number {
  if (!review) return 1;
  const savedNo = Math.floor(Number(review.reviewNo));
  if (savedNo >= 1) return savedNo;
  return (review.stage != null ? LEGACY_REVIEW_NO[review.stage] : undefined) || 1;
}

/** `sizeOfMin(min)`（HTML:3137）— 分数 → サイズキー。`NaN` は全比較 false で `'L'` になる */
export function sizeOfMin(min: number): SizeKey {
  return min <= 5 ? 'XS' : min <= 10 ? 'S' : min <= 20 ? 'M' : 'L';
}

/**
 * `askSizeCur`（HTML:3145）— 理解度モーダルの「次回復習の予想時間」の現在値。
 * `S.revAskSize || (askR ? sizeOfMin(askR.min) : 'S')`
 */
export function askSizeOf(
  picked: SizeKey | null | undefined,
  review: Pick<Review, 'min'> | null | undefined,
): SizeKey {
  return picked || (review ? sizeOfMin(review.min) : 'S');
}

// ─────────────────────────────────────────────────────────────
// 「今日」の受け渡し
// ─────────────────────────────────────────────────────────────

/**
 * `today` は iso 文字列でも `DateContext` でも渡せる。
 * トーストが `dayLabel` を使うため内部で `DateContext` が要るが、呼び出し側が既に持っていれば
 * 使い回せるようにしている（生成し直しても `dateContextFor(T)` は同じ内容になる）。
 */
export type TodayArg = ISODate | DateContext;

function contextOf(today: TodayArg): DateContext {
  return typeof today === 'string' ? dateContextFor(today) : today;
}

// ─────────────────────────────────────────────────────────────
// confirmAsk — 理解度確定 → 次回復習（HTML:3146-3185 / spec §6.2）
// ─────────────────────────────────────────────────────────────

/**
 * `confirmAsk` の `setState` が起こす**次回復習以外**の変化。
 * `reviews` 配列の作り替えは {@link applyReviewCompletion} が担う。
 */
export interface ReviewCompletionMutations {
  /** 完了した復習の id（`askR.id`） */
  reviewId: string;
  /** 系列 id（`askR.seriesId || askR.id`）。掃除の対象範囲 */
  seriesId: string;
  /** 掃除の閾値。同系列で `reviewNo > currentNo` の行を削除する（`reviewNoOf(askR)`） */
  currentNo: number;
  /**
   * `askR.due < T`（遅れて消化した）。true のとき
   * 完了行の `added` を false に落とし、`order` から外し、`selId` が一致すれば null にする。
   */
  removeFromTodo: boolean;
  /** 完了行に書き込む `completedAt`（= 今日） */
  completedAt: ISODate;
  /**
   * `studyLog` に 1 件追加する内容。
   * **分数は `askR.min`（完了した回の分数）**。モーダルで選び直したサイズ（`nmin`）ではない。
   */
  studyLog: StudyLogEntry;
}

/** {@link nextReviewOf} の戻り */
export interface ReviewTransition {
  /** 次回の復習。`null` = 系列終了（定着） */
  next: Review | null;
  /** `showToast(msg)` に渡す文言（HTML:3159 / 3164-3166） */
  message: string;
  mutations: ReviewCompletionMutations;
}

export interface NextReviewOptions {
  /**
   * 次回復習の id 生成。既定はレガシーと同じ
   * `'u' + Date.now().toString(36) + Math.floor(Math.random()*999)`（HTML:3162）。
   * テストや決定的な再現のために差し替えられる。
   */
  newId?: () => string;
}

/** レガシーの uid 生成（HTML:2439 / 3162 と同一式） */
function defaultNewId(): string {
  return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 999);
}

/**
 * `confirmAsk` の遷移部分（HTML:3149-3169）を純関数にしたもの。
 *
 * 規則（spec §6.2）:
 *  1. **オフセットの起点は常に今日**（`isoShift(T, stageDays[ns])`）。遅れて消化しても
 *     次回が過去に戻らず、遅延が累積しない。
 *  2. `high` → `stageNext[stage]` / `mid` → 同じ stage を維持 / `low` → `'翌日'` に巻き戻し。
 *  3. 次の間隔が `stageDays` に無い（`'定着 🎉'` や未知 stage）なら **high / mid とも系列終了**
 *     （v0.9 A3）。`low` だけは stage に関係なく必ず翌日から組み直す。
 *  4. `reviewNo` は据え置き/巻き戻しでも必ず +1。`seriesId` は初回 id を引き継ぐ。
 *  5. `title` / `subj` / `timetablePeriod` / `timetableDate` を継承し、`min` はモーダルで
 *     選んだサイズで上書き。`last` は今日、`src` は `'8/5に学習'`。
 *
 * @param review 完了した復習（`askR`）
 * @param grade  理解度。未選択の場合は呼び出し側で {@link GRADE_REQUIRED_MESSAGE} を出して中断する
 * @param size   モーダルで選ばれているサイズ（`askSizeCur`）。`min` は `SIZE_MIN[size]`
 * @param today  今日（iso または `DateContext`）
 */
export function nextReviewOf(
  review: Review,
  grade: ReviewGrade,
  size: SizeKey,
  today: TodayArg,
  options: NextReviewOptions = {},
): ReviewTransition {
  const ctx = contextOf(today);
  const T = ctx.today;
  const newId = options.newId || defaultNewId;

  const nmin = SIZE_MIN[size];
  const removeFromTodo = review.due < T;
  // ns: high は次の stage、mid は据え置き、low は '翌日'。未知 stage の high は undefined になる
  const ns: ReviewStageValue | undefined =
    grade === 'high' ? STAGE_NEXT[review.stage] : grade === 'mid' ? review.stage : '翌日';
  const nsDays = ns == null ? undefined : STAGE_DAYS[ns];

  let next: Review | null = null;
  let message: string;
  if (grade !== 'low' && !nsDays) {
    // 次の間隔が無い → シリーズ終了（v0.9: high だけでなく mid も同じ扱い）
    message = '定着！「' + review.title + '」の復習は完了です 🎉';
  } else {
    // `|| 1` はレガシーどおり。low は必ず '翌日'(=1) なので実際には到達しない保険
    const due = isoShift(T, nsDays || 1);
    next = {
      id: newId(),
      seriesId: review.seriesId || review.id,
      reviewNo: reviewNoOf(review) + 1,
      title: review.title,
      subj: review.subj,
      stage: ns ?? '翌日',
      last: T,
      due,
      min: nmin,
      src: fmtMD(T) + 'に学習',
      timetablePeriod: review.timetablePeriod,
      timetableDate: review.timetableDate,
      added: false,
      done: false,
    };
    message =
      grade === 'low'
        ? '明日、追加の復習を入れました(' + dayLabel(ctx, due) + ' · ' + size + ')'
        : '次は' + ns + 'に復習します(' + dayLabel(ctx, due) + ' · ' + size + ')';
  }

  return {
    next,
    message,
    mutations: {
      reviewId: review.id,
      seriesId: review.seriesId || review.id,
      currentNo: reviewNoOf(review),
      removeFromTodo,
      completedAt: T,
      studyLog: { day: T, subj: review.subj, min: review.min },
    },
  };
}

/**
 * `confirmAsk` の `reviews` 差し替え（HTML:3172-3175）。
 *
 * ```js
 * s.reviews
 *   .filter(r => (r.seriesId || r.id) !== seriesId || (Number(r.reviewNo) || 1) <= currentNo)
 *   .map(r => r.id === askR.id ? {...r, done:true, completedAt:T, added: removeFromTodo ? false : r.added} : r)
 *   .concat(nextReview ? [nextReview] : [])
 * ```
 * 同一系列の `reviewNo > currentNo` を**全部削除してから**次の1回だけを末尾に追加するので、
 * 同じ系列に未来回が複数並ぶことは起きない。
 *
 * > 掃除の比較だけは `reviewNoOf` ではなく **`Number(r.reviewNo) || 1`** を使う
 * > （`reviewNo` 未保存の旧行は stage に関わらず 1 とみなされる）。レガシーのまま移植。
 */
export function applyReviewCompletion(
  reviews: readonly Review[],
  transition: ReviewTransition,
): Review[] {
  const m = transition.mutations;
  const out = reviews
    .filter(
      (r) => (r.seriesId || r.id) !== m.seriesId || (Number(r.reviewNo) || 1) <= m.currentNo,
    )
    .map((r) =>
      r.id === m.reviewId
        ? {
            ...r,
            done: true,
            completedAt: m.completedAt,
            added: m.removeFromTodo ? false : r.added,
          }
        : r,
    );
  return transition.next ? out.concat([transition.next]) : out;
}

/** `order: removeFromTodo ? s.order.filter(id => id !== askR.id) : s.order`（HTML:3179） */
export function orderAfterCompletion(order: string[], m: ReviewCompletionMutations): string[] {
  return m.removeFromTodo ? order.filter((id) => id !== m.reviewId) : order;
}

/** `selId: removeFromTodo && s.selId === askR.id ? null : s.selId`（HTML:3180） */
export function selIdAfterCompletion(
  selId: string | null,
  m: ReviewCompletionMutations,
): string | null {
  return m.removeFromTodo && selId === m.reviewId ? null : selId;
}

// ─────────────────────────────────────────────────────────────
// 行アクションの述語（HTML:3196-3198 / 3313-3315）
// ─────────────────────────────────────────────────────────────

/** 述語が見る最小限の形 */
export type ReviewFlags = Pick<Review, 'added' | 'done' | 'due'>;

/**
 * `canAdd`（HTML:3196 / 3313）— 「＋ 今日へ」を出す条件。
 * **一括追加（`revBulkTargets`）と完全に同条件**（遅れている復習も含む）。
 */
export function canAddToToday(review: ReviewFlags, today: ISODate): boolean {
  return !review.added && !review.done && review.due <= today;
}

/** `isAdded`（HTML:3197 / 3314）— 「✓ 追加済み」 */
export function isAddedToToday(review: Pick<Review, 'added' | 'done'>): boolean {
  return review.added && !review.done;
}

/** `canDone`（HTML:3198 / 3315）— 「完了」ボタン（= 理解度モーダルを開ける） */
export function canComplete(review: ReviewFlags, today: ISODate): boolean {
  return !review.done && review.due <= today;
}

// ─────────────────────────────────────────────────────────────
// 一括ToDo追加（v0.9 追加。HTML:3321-3332 / spec §6.4）
// ─────────────────────────────────────────────────────────────

/**
 * `revBulkTargets`（HTML:3323）= `S.reviews.filter(r => !r.added && !r.done && r.due <= T)`。
 * **`revFilter`（教科絞り込み）も `revSort` も見ない**ので、絞り込みで隠れている行も対象に入る。
 */
export function bulkAddTargets(reviews: readonly Review[], today: ISODate): Review[] {
  return reviews.filter((r) => canAddToToday(r, today));
}

/** トースト文言（HTML:3331） */
export function bulkAddMessage(count: number): string {
  return count + '件の復習を今日のToDoに追加しました';
}

export interface BulkAddResult {
  /** 追加した復習の id（`S.reviews` の配列順） */
  ids: string[];
  reviews: Review[];
  order: string[];
  /** `null` = 対象0件で**何も起きない**（setState もトーストも無し。HTML:3326） */
  message: string | null;
}

/**
 * `revBulkAdd`（HTML:3324-3332）— 今日までに来ている未追加・未完了の復習をまとめて ToDo へ。
 * `order` への積み方は `addToOrder` と同じ重複ガード（`indexOf(id) < 0`）で、`reviews` の
 * 配列順に末尾へ積む。setState もトーストも 1 回だけ。
 */
export function bulkAddToToday(reviews: Review[], order: string[], today: ISODate): BulkAddResult {
  const ids = bulkAddTargets(reviews, today).map((r) => r.id);
  if (!ids.length) return { ids, reviews, order, message: null };
  return {
    ids,
    reviews: reviews.map((x) => (ids.indexOf(x.id) >= 0 ? { ...x, added: true } : x)),
    order: order.concat(ids.filter((id) => order.indexOf(id) < 0)),
    message: bulkAddMessage(ids.length),
  };
}

// ─────────────────────────────────────────────────────────────
// 次回復習日の ±1 日（v0.9。HTML:3337-3349 / spec §6.5）
// ─────────────────────────────────────────────────────────────

export interface ShiftDueResult {
  /** false = 下限に張り付いて動かない。`mutReview` せず {@link SHIFT_DUE_BLOCKED_MESSAGE} を出す */
  moved: boolean;
  /** 適用後の due（`moved === false` のときは元の due と同値） */
  due: ISODate;
  message: string;
}

/**
 * `shiftDue(delta)`（HTML:3340-3349）— **due 自身を起点にした相対シフト**。
 *
 * ```js
 * const base = /^\d{4}-\d{2}-\d{2}$/.test(rSel.due || '') ? rSel.due : T;
 * const floor = base < T ? base : T;          // 下限は今日。すでに期限切れならその日が下限
 * const shifted = this.isoShift(base, delta);
 * const iso = shifted < floor ? floor : shifted;
 * if (iso === rSel.due) { showToast('次回復習日はこれ以上前にできません'); return; }
 * ```
 * - 13 日カレンダー（DIDX）は経由しない → 期限切れ / 13 日以上先の due も 1 日ずつ動く（v0.9 Q9）
 * - 5 日遅れの due に「＋1日」→ 4 日遅れ。20 日先に「＋1日」→ 21 日先
 * - 今日の復習に「−1日」/ 期限切れの復習に「−1日」は動かないので `moved:false`
 * - `due` が `YYYY-MM-DD` でない（欠損・破損）ときの起点は今日
 */
export function shiftDue(
  due: string | null | undefined,
  delta: number,
  today: TodayArg,
): ShiftDueResult {
  const ctx = contextOf(today);
  const T = ctx.today;
  const base = ISO_RE.test(due || '') ? (due as ISODate) : T;
  const floor = base < T ? base : T;
  const shifted = isoShift(base, delta);
  const iso = shifted < floor ? floor : shifted;
  if (iso === due) return { moved: false, due: iso, message: SHIFT_DUE_BLOCKED_MESSAGE };
  return { moved: true, due: iso, message: '次回復習日を ' + dayLabel(ctx, iso) + ' に変更しました' };
}
