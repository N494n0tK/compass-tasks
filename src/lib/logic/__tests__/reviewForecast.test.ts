import { describe, expect, it } from 'vitest';

import type { Review } from '../../model/types';
import {
  FORECAST_DAYS,
  FORECAST_HEAVY_MIN,
  buildReviewForecast,
  forecastDates,
  matchesForecastDay,
} from '../reviewForecast';

/** 基準日 2026-08-05（水）。7 日窓は 08-05(水)..08-11(火)、窓の外の初日は 08-12 */
const T = '2026-08-05';
/** 窓の最終日 */
const LAST = '2026-08-11';
/** 窓のすぐ外 */
const OUT = '2026-08-12';

function mkReview(over: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    seriesId: 'r1',
    reviewNo: 1,
    title: '英単語 Unit3',
    subj: '英語',
    stage: '翌日',
    last: '2026-08-04',
    due: T,
    min: 10,
    src: '手動追加',
    timetablePeriod: null,
    timetableDate: null,
    added: false,
    done: false,
    ...over,
  };
}

/** iso → その日の予報 */
function dayAt(fc: ReturnType<typeof buildReviewForecast>, iso: string) {
  return fc.days.find((d) => d.iso === iso);
}

describe('forecastDates', () => {
  it('今日から 7 日ぶん（先頭が今日・末尾が +6）', () => {
    const days = forecastDates(T);
    expect(days.length).toBe(FORECAST_DAYS);
    expect(days[0]).toBe(T);
    expect(days[6]).toBe(LAST);
  });

  it('日数は 1 未満・非数でも最低 1 日にする', () => {
    expect(forecastDates(T, 0)).toEqual([T]);
    expect(forecastDates(T, -3)).toEqual([T]);
    expect(forecastDates(T, Number.NaN)).toEqual([T]);
  });
});

describe('matchesForecastDay', () => {
  it('今日の枠だけ期限切れを飲み込む（due <= today）', () => {
    const late = mkReview({ due: '2026-07-30' });
    expect(matchesForecastDay(late, T, T)).toBe(true);
    // 他の日の枠には入らない
    expect(matchesForecastDay(late, '2026-08-06', T)).toBe(false);
  });

  it('今日以外はその日ちょうどの due だけ', () => {
    const r = mkReview({ due: '2026-08-06' });
    expect(matchesForecastDay(r, '2026-08-06', T)).toBe(true);
    expect(matchesForecastDay(r, T, T)).toBe(false);
    expect(matchesForecastDay(r, '2026-08-07', T)).toBe(false);
  });

  it('完了した復習はどの枠にも入らない', () => {
    expect(matchesForecastDay(mkReview({ done: true }), T, T)).toBe(false);
    expect(
      matchesForecastDay(mkReview({ done: true, due: '2026-08-06' }), '2026-08-06', T),
    ).toBe(false);
  });
});

describe('buildReviewForecast', () => {
  it('期限切れは今日の枠に合算し、内訳を overdueCount に残す', () => {
    const fc = buildReviewForecast(
      [
        mkReview({ id: 'a', due: '2026-07-20', min: 20 }),
        mkReview({ id: 'b', due: '2026-08-04', min: 5 }),
        mkReview({ id: 'c', due: T, min: 10 }),
      ],
      T,
    );
    const today = dayAt(fc, T);
    expect(today?.count).toBe(3);
    expect(today?.min).toBe(35);
    expect(today?.overdueCount).toBe(2);
    // 期限切れが他の日に二重計上されていない
    expect(fc.totalCount).toBe(3);
    expect(fc.totalMin).toBe(35);
  });

  it('窓の境界: 最終日(+6)は入り、その翌日(+7)は入らない', () => {
    const fc = buildReviewForecast(
      [mkReview({ id: 'in', due: LAST, min: 30 }), mkReview({ id: 'out', due: OUT, min: 30 })],
      T,
    );
    expect(dayAt(fc, LAST)?.count).toBe(1);
    expect(fc.days.some((d) => d.iso === OUT)).toBe(false);
    expect(fc.totalCount).toBe(1);
    expect(fc.totalMin).toBe(30);
  });

  it('完了した復習は数えない（未完了だけ・added は問わない）', () => {
    const fc = buildReviewForecast(
      [
        mkReview({ id: 'done', due: T, min: 30, done: true }),
        mkReview({ id: 'added', due: T, min: 10, added: true }),
      ],
      T,
    );
    expect(dayAt(fc, T)?.count).toBe(1);
    expect(dayAt(fc, T)?.min).toBe(10);
  });

  it('分数はその日ごとに合算し、最大の日を peak として返す', () => {
    const fc = buildReviewForecast(
      [
        mkReview({ id: 'a', due: '2026-08-06', min: 20 }),
        mkReview({ id: 'b', due: '2026-08-06', min: 25 }),
        mkReview({ id: 'c', due: '2026-08-08', min: 30 }),
      ],
      T,
    );
    expect(dayAt(fc, '2026-08-06')?.min).toBe(45);
    expect(dayAt(fc, '2026-08-08')?.min).toBe(30);
    expect(fc.peakMin).toBe(45);
    expect(fc.peakIso).toBe('2026-08-06');
    expect(fc.totalMin).toBe(75);
  });

  it('同じ分数の日が並んだら早い方を peak にする', () => {
    const fc = buildReviewForecast(
      [
        mkReview({ id: 'a', due: '2026-08-06', min: 30 }),
        mkReview({ id: 'b', due: '2026-08-09', min: 30 }),
      ],
      T,
    );
    expect(fc.peakIso).toBe('2026-08-06');
  });

  it('1 件も無ければ全日 0 件・peak は null', () => {
    const fc = buildReviewForecast([], T);
    expect(fc.days.length).toBe(FORECAST_DAYS);
    expect(fc.days.every((d) => d.count === 0 && d.min === 0 && !d.heavy)).toBe(true);
    expect(fc.peakMin).toBe(0);
    expect(fc.peakIso).toBe(null);
  });

  it('heavy はしきい値ちょうどで立つ', () => {
    const fc = buildReviewForecast(
      [
        mkReview({ id: 'a', due: '2026-08-06', min: FORECAST_HEAVY_MIN }),
        mkReview({ id: 'b', due: '2026-08-07', min: FORECAST_HEAVY_MIN - 1 }),
      ],
      T,
    );
    expect(dayAt(fc, '2026-08-06')?.heavy).toBe(true);
    expect(dayAt(fc, '2026-08-07')?.heavy).toBe(false);
  });

  it('曜日と週末フラグ・offset が付く', () => {
    const fc = buildReviewForecast([], T);
    expect(fc.days.map((d) => d.dow)).toEqual(['水', '木', '金', '土', '日', '月', '火']);
    expect(fc.days.map((d) => d.weekend)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(fc.days.map((d) => d.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('min が壊れていても NaN にしない（0 として数える）', () => {
    const broken = mkReview({ id: 'x', due: T, min: Number.NaN });
    const fc = buildReviewForecast([broken, mkReview({ id: 'y', due: T, min: 10 })], T);
    expect(dayAt(fc, T)?.min).toBe(10);
    expect(dayAt(fc, T)?.count).toBe(2);
  });

  it('日数を変えると窓の長さが変わる', () => {
    const fc = buildReviewForecast([mkReview({ due: '2026-08-07' })], T, 3);
    expect(fc.days.map((d) => d.iso)).toEqual([T, '2026-08-06', '2026-08-07']);
    expect(fc.totalCount).toBe(1);
  });

  it('予報の件数と「その日だけの絞り込み」の行数は必ず一致する', () => {
    const reviews = [
      mkReview({ id: 'a', due: '2026-07-01' }),
      mkReview({ id: 'b', due: T }),
      mkReview({ id: 'c', due: '2026-08-06' }),
      mkReview({ id: 'd', due: '2026-08-06', done: true }),
      mkReview({ id: 'e', due: OUT }),
    ];
    const fc = buildReviewForecast(reviews, T);
    fc.days.forEach((d) => {
      expect(reviews.filter((r) => matchesForecastDay(r, d.iso, T)).length).toBe(d.count);
    });
  });
});
