/**
 * Compass — 復習の7日予報（docs/daily-mission/plan.md §4.2）
 *
 * 復習は `loadsMap` の仕様上**今日の負荷にしか乗らない**（`reviews: added && !done → L[TODAY]`）。
 * 一方 `due` は全件が持っているので、「このままだと木曜に 45 分たまる」は**今すぐ計算できる**。
 * ここはその 1 枚だけを担当する。
 *
 * ## 復習エンジンには触らない
 *
 * `STAGE_DAYS` の間隔も `nextReviewOf` の規則も**一切変えない**。間隔反復の規則は仕様の正典
 * （spec §6.2）でテストも厚く、予報のために規則を曲げると「なぜこの日に来たのか」が
 * 説明できなくなる。予報は**先に見せて前倒しを促すだけ**の派生値で、保存もしない。
 *
 * ## 期限切れは今日の枠へ合算する
 *
 * `loadsMap` が復習を常に今日に数えるのと同じ思想。遅れている復習は「過去のどこか」ではなく
 * **今日やるぶん**として見えていないと、予報の今日の棒が実態より軽く出てしまう。
 * `bulkAddTargets`（`due <= T`）や `canAddToToday` の母集団とも揃う。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Dow, ISODate, Review } from '../model/types';
import { dowOf, isoShift } from './dates';

/** 既定の予報日数（今日を含む 7 日） */
export const FORECAST_DAYS = 7;

/**
 * 「重い日」の既定しきい値（分）。plan.md §4.2 の「木曜に復習が40分たまる」から取った。
 * 表示側はこれを無視して自前で判定してもよい（`ReviewForecastDay.min` が素の材料）。
 */
export const FORECAST_HEAVY_MIN = 40;

/** 予報 1 日ぶん */
export interface ReviewForecastDay {
  iso: ISODate;
  dow: Dow;
  /** 今日から何日後か（0 = 今日）。表示側が「今日」「明日」を出し分けるのに使う */
  offset: number;
  weekend: boolean;
  /** その日にやることになる未完了の復習の件数 */
  count: number;
  /** 同じく合計分数。「重い」判定の材料はこれ */
  min: number;
  /**
   * そのうち**期限切れ**（`due < today`）の件数。今日の枠だけ 0 より大きくなりうる。
   * 「今日が重いのは遅れのせい」を言えるようにするため内訳を残す。
   */
  overdueCount: number;
  /** `min >= FORECAST_HEAVY_MIN` */
  heavy: boolean;
}

export interface ReviewForecast {
  /** 今日から `days` 日ぶん（先頭が今日） */
  days: ReviewForecastDay[];
  /** 窓内の合計件数 */
  totalCount: number;
  /** 窓内の合計分数 */
  totalMin: number;
  /** いちばん重い日の分数（全部 0 なら 0） */
  peakMin: number;
  /** いちばん重い日（同値なら**早い方**。`peakMin === 0` なら null） */
  peakIso: ISODate | null;
}

/**
 * その復習が予報の `iso` の枠に入るか。
 *
 * - 完了した復習は入らない（予報は「これからやる量」）
 * - **今日の枠だけ `due <= today`**（期限切れを合算）。他の日は `due === iso` ちょうど
 *
 * 予報の棒の件数と、画面側で「その日ぶんだけ」に絞ったときの行数を**必ず一致させる**ため、
 * 集計も絞り込みもこの 1 つの述語を通す。
 *
 * > `due` が空文字や壊れた値の行は `'' <= today` が真なので今日の枠に落ちる。
 * > 予定の立っていない復習が今日として見えるのは、放置されるよりは望ましいのでそのままにする。
 */
export function matchesForecastDay(
  review: Pick<Review, 'due' | 'done'>,
  iso: ISODate,
  today: ISODate,
): boolean {
  if (review.done) return false;
  return iso === today ? review.due <= today : review.due === iso;
}

/** 予報の対象日（今日から `days` 日ぶん） */
export function forecastDates(today: ISODate, days: number = FORECAST_DAYS): ISODate[] {
  const count = Math.max(1, Math.floor(days) || 0);
  const out: ISODate[] = [];
  for (let i = 0; i < count; i += 1) out.push(isoShift(today, i));
  return out;
}

/**
 * 今日から `days` 日ぶんの復習予報（plan.md §4.2「復習負荷の7日予報」）。
 *
 * - 数えるのは**未完了だけ**（`added` は問わない ―― 今日の ToDo に積んであってもやる量は同じ）
 * - 期限切れ（`due < today`）は**今日の枠に合算**する
 * - 窓より先（`today + days` 以降）の `due` は含めない。7 日先まで見せるための道具なので、
 *   その外を足すと「今週どうするか」の判断材料にならない
 * - `min` は `Number(r.min) || 0`（`computeDayMinutes` と同じ防御。壊れた 1 件で棒全体が
 *   NaN になると予報そのものが読めなくなる）
 */
export function buildReviewForecast(
  reviews: readonly Review[],
  today: ISODate,
  days: number = FORECAST_DAYS,
): ReviewForecast {
  let totalCount = 0;
  let totalMin = 0;
  let peakMin = 0;
  let peakIso: ISODate | null = null;

  const list = forecastDates(today, days).map((iso, offset) => {
    let count = 0;
    let min = 0;
    let overdueCount = 0;
    reviews.forEach((r) => {
      if (!matchesForecastDay(r, iso, today)) return;
      count += 1;
      min += Number(r.min) || 0;
      if (r.due < today) overdueCount += 1;
    });
    totalCount += count;
    totalMin += min;
    // 同値のときは早い日を残す（`>` なので後の日では更新されない）
    if (min > peakMin) {
      peakMin = min;
      peakIso = iso;
    }
    const dow = dowOf(iso);
    return {
      iso,
      dow,
      offset,
      weekend: dow === '土' || dow === '日',
      count,
      min,
      overdueCount,
      heavy: min >= FORECAST_HEAVY_MIN,
    };
  });

  return { days: list, totalCount, totalMin, peakMin, peakIso };
}
