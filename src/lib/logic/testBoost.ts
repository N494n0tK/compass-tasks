/**
 * Compass — テスト前ブーストと成績接続（docs/daily-mission/plan.md §4.2）
 *
 * plan.md が挙げた 2 つ:
 *  - **テスト前ブースト** … 計画（`Plan`）の `due` は既にあるので、テストが近い教科の
 *    復習・弱点問題を今日へ寄せる導線だけを足せばよい
 *  - **成績との接続**   … `scores` は記録されるだけで何にも使われていない。低い教科を
 *    見つけて弱点ドリルへ送るところまで繋げると、記録が行動に還る
 *
 * ## 復習の間隔は変えない（重要な設計判断）
 *
 * plan.md には「点数が低かった科目の**復習間隔を詰める**」とあるが、**採らない**。
 * 間隔反復の規則（`STAGE_DAYS` / `nextReviewOf`, spec §6.2）は仕様の正典で、
 * 成績や予測で規則そのものを曲げると「なぜ今日この復習が来たのか」を説明できなくなる
 * （同じ stage の復習が教科によって別の日に来る、点数を 1 件足しただけで既存の予定が
 * 動く、といったことが起きる）。
 *
 * ここで足すのは**すべて「見せて、1タップで行動に繋げる」層**に閉じる:
 *  - 復習の `due` も `stage` も書き換えない
 *  - 今日へ積むのは既存の「＋今日へ」と**同じ母集団**（`canAddToToday`）だけ
 *  - 保存キーは 1 つも増やさない（全部その場の導出）
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { ISODate, Plan, Plans, Review, Score } from '../model/types';
import { isoShift, isoToUtcMs } from './dates';
import { bulkAddMessage, canAddToToday, type BulkAddResult } from './reviews';

const DAY_MS = 86400000;

/** 日数の差（`daysUntil` の `DateContext` を要らない版。UTC 固定なので常に整数） */
function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((isoToUtcMs(to) - isoToUtcMs(from)) / DAY_MS);
}

// ─────────────────────────────────────────────────────────────
// 1. 近いテスト
// ─────────────────────────────────────────────────────────────

/** 既定の先読み日数（今日から 7 日後まで＝テスト 1 週間前から出る） */
export const TEST_BOOST_HORIZON = 7;

export interface UpcomingTest {
  /** planId（`Plans` のキー。`Plan` 自身は id を持たない） */
  id: string;
  plan: Plan;
  subj: string;
  /** `Plan.name`（`subj + ' ' + タスク名`）から教科の重複を落とした表示名 */
  label: string;
  due: ISODate;
  /** 今日からの残り日数（0 = 今日） */
  daysLeft: number;
}

/**
 * `Plan.name` は `subj + ' ' + タスク名`（HTML:3723）なので、教科チップと並べると
 * 「数学 数学 期末テスト」になる。**先頭の教科名だけ**落として表示に使う。
 * 名前を編集して規約から外れた計画（先頭が教科名でない）はそのまま返す。
 */
export function testLabelOf(plan: Pick<Plan, 'name' | 'subj'>): string {
  const name = plan.name || '';
  const prefix = (plan.subj || '') + ' ';
  if (!plan.subj || !name.startsWith(prefix)) return name;
  return name.slice(prefix.length) || name;
}

/** 残り日数の表示（`dayLabel` と同じ言い回しに揃える） */
export function daysLeftLabel(daysLeft: number): string {
  return daysLeft <= 0 ? '今日' : daysLeft === 1 ? '明日' : 'あと' + daysLeft + '日';
}

/**
 * 今日から `horizon` 日以内に来るテスト計画（`type === 'test'`）を **due 昇順**で。
 *
 * - 境界は**両端とも含む**（`today <= due <= today + horizon`）。「1週間前になったら出す」
 *   なので、ちょうど 7 日後のテストは初日として出したい。当日（`due === today`）も出す
 *   ―― テスト当日の朝に「今日だ」と分かるのは、前日に分かるのと同じくらい役に立つ
 * - 期限切れ（`due < today`）は出さない。終わったテストの前倒しに意味は無い
 * - 予習計画（`type === 'prep'`）は対象外。締切はあるが「本番が来る」種類の締切ではない
 * - 同じ `due` のときは `Object.keys(plans)` の順（`sort` は安定）
 */
export function upcomingTests(
  plans: Plans,
  today: ISODate,
  horizon: number = TEST_BOOST_HORIZON,
): UpcomingTest[] {
  const limit = Math.max(0, Math.floor(horizon) || 0);
  return Object.keys(plans)
    .map((id) => ({ id, plan: plans[id] }))
    .filter(({ plan }) => {
      if (!plan || plan.type !== 'test' || !plan.due) return false;
      const left = daysBetween(today, plan.due);
      return left >= 0 && left <= limit;
    })
    .sort((a, b) => (a.plan.due < b.plan.due ? -1 : a.plan.due > b.plan.due ? 1 : 0))
    .map(({ id, plan }) => ({
      id,
      plan,
      subj: plan.subj,
      label: testLabelOf(plan),
      due: plan.due,
      daysLeft: daysBetween(today, plan.due),
    }));
}

// ─────────────────────────────────────────────────────────────
// 2. その教科の「今日へ前倒しできる復習」
// ─────────────────────────────────────────────────────────────

/**
 * テストの教科で、**今日の ToDo へ積める**復習の id 一覧。
 *
 * 母集団は `canAddToToday`（= 未追加・未完了・`due <= today`）と**完全に同じ**。
 * 一括追加（`bulkAddTargets`）とも同条件なので、「まとめてToDoへ」の教科版になる。
 * `due <= testDue` は `canAddToToday` に含まれる（`today <= testDue` なので常に真）が、
 * *テストまでに来る復習を寄せる* という意図を式に残すために書いてある。
 *
 * > **`due` を動かして前倒しはしない**。それは間隔反復の規則を曲げること（冒頭の設計判断）。
 * > ここでの「前倒し」は「今日の ToDo に積んで先に片づける」という意味に限る。
 */
export function boostReviewIds(
  reviews: readonly Review[],
  subj: string,
  testDue: ISODate,
  today: ISODate,
): string[] {
  return reviews
    .filter((r) => r.subj === subj && canAddToToday(r, today) && r.due <= testDue)
    .map((r) => r.id);
}

/**
 * `ids` の復習を今日の ToDo へ積む（`bulkAddToToday`（HTML:3324-3332）の**id 指定版**）。
 *
 * `bulkAddToToday` は対象を自分で数え直す（＝全教科が入る）ので、教科で絞ったブーストには
 * そのまま使えない。積み方（`added: true` / `order` 末尾へ重複ガード付きで追加 /
 * トースト文言）は 1 文字も変えずに合わせてある。
 *
 * 実在しない id と重複は落とす（トーストの件数と実際に積まれた件数を必ず一致させる）。
 * 0 件のときは `message: null` ＝ **何も起きない**（`bulkAddToToday` と同じ約束）。
 */
export function addReviewsToToday(
  reviews: Review[],
  order: string[],
  ids: readonly string[],
): BulkAddResult {
  const known = new Set(reviews.map((r) => r.id));
  const add = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
  if (!add.length) return { ids: [], reviews, order, message: null };
  return {
    ids: add.slice(),
    reviews: reviews.map((x) => (add.indexOf(x.id) >= 0 ? { ...x, added: true } : x)),
    order: order.concat(add.filter((id) => order.indexOf(id) < 0)),
    message: bulkAddMessage(add.length),
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 成績接続（点数の低い教科）
// ─────────────────────────────────────────────────────────────

/** 既定: 直近 60 日 / 平均 70 点未満 / 1 件から判定 */
export const LOW_SCORE_WINDOW_DAYS = 60;
export const LOW_SCORE_THRESHOLD = 70;
export const LOW_SCORE_MIN_COUNT = 1;

export interface LowScoreSubject {
  subj: string;
  /** 窓に入った点数の件数 */
  count: number;
  /** 平均点（丸めない値。しきい値の判定と並び順はこちらで行う） */
  avg: number;
  /** 表示用 `Math.round(avg)`。`'62'` */
  avgLabel: string;
}

export interface LowScoreOptions {
  /** 何日ぶん遡るか（既定 60）。窓は `today - windowDays <= day <= today` の**両端含む** */
  windowDays?: number;
  /** これ**未満**を「低い」とする（既定 70） */
  threshold?: number;
  /** この件数**未満**の教科は判定しない（既定 1） */
  min?: number;
}

/**
 * 直近の平均点が低い教科を**低い順**に（plan.md §4.2「成績との接続」）。
 *
 * - 窓は `today - windowDays` 〜 `today` の両端含む。**未来日の点数は数えない**
 *   （日付を打ち間違えた 1 件で「直近の平均」が変わるのは直感に反する）
 * - `score` が数値でない行は捨てる（0 点は正当な点数なので `|| 0` では潰さない）
 * - 同じ平均のときは `scores` に最初に現れた教科が先（`sort` は安定 /
 *   `computePie` と同じく**プレーンオブジェクトの挿入順**を保つ）
 * - 「低い教科が無い」は成功なので、返すのは低い教科**だけ**。全教科の平均表は作らない
 */
export function lowScoreSubjects(
  scores: readonly Score[],
  today: ISODate,
  options: LowScoreOptions = {},
): LowScoreSubject[] {
  const windowDays = options.windowDays == null ? LOW_SCORE_WINDOW_DAYS : options.windowDays;
  const threshold = options.threshold == null ? LOW_SCORE_THRESHOLD : options.threshold;
  const minCount = options.min == null ? LOW_SCORE_MIN_COUNT : options.min;
  // 窓の始まり。負の指定は 0 日（＝今日ぶんだけ）に丸める
  const from = isoShift(today, -Math.max(0, Math.floor(windowDays) || 0));

  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  scores.forEach((s) => {
    if (!s || !s.subj) return;
    const day = s.day || '';
    if (day < from || day > today) return;
    const v = Number(s.score);
    if (!Number.isFinite(v)) return;
    sum[s.subj] = (sum[s.subj] || 0) + v;
    count[s.subj] = (count[s.subj] || 0) + 1;
  });

  return Object.keys(sum)
    .map((subj) => ({
      subj,
      count: count[subj],
      avg: sum[subj] / count[subj],
      avgLabel: String(Math.round(sum[subj] / count[subj])),
    }))
    .filter((row) => row.count >= minCount && row.avg < threshold)
    .sort((a, b) => a.avg - b.avg);
}
