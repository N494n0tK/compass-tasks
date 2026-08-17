import { describe, expect, it } from 'vitest';

import type { Plan, Plans, Review, Score } from '../../model/types';
import { canAddToToday } from '../reviews';
import {
  LOW_SCORE_THRESHOLD,
  addReviewsToToday,
  boostReviewIds,
  daysLeftLabel,
  lowScoreSubjects,
  testLabelOf,
  upcomingTests,
} from '../testBoost';

/** 基準日 2026-08-05（水）。+7 = 08-12（境界）、+8 = 08-13（窓の外） */
const T = '2026-08-05';

function mkPlan(over: Partial<Plan> = {}): Plan {
  return {
    name: '数学 期末テスト',
    type: 'test',
    due: '2026-08-10',
    subj: '数学',
    range: '範囲は未設定',
    timetablePeriod: null,
    timetableDate: null,
    ...over,
  };
}

function mkReview(over: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    seriesId: 'r1',
    reviewNo: 1,
    title: '二次関数',
    subj: '数学',
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

function mkScore(over: Partial<Score> = {}): Score {
  return { id: 's1', name: '小テスト', subj: '数学', day: T, score: 60, ...over };
}

describe('upcomingTests', () => {
  it('今日 / 7日後の両端を含み、8日後と昨日は含まない', () => {
    const plans: Plans = {
      today: mkPlan({ due: T, name: '数学 今日' }),
      edge: mkPlan({ due: '2026-08-12', name: '数学 7日後' }),
      out: mkPlan({ due: '2026-08-13', name: '数学 8日後' }),
      past: mkPlan({ due: '2026-08-04', name: '数学 昨日' }),
    };
    expect(upcomingTests(plans, T).map((t) => t.id)).toEqual(['today', 'edge']);
  });

  it('予習計画は対象外', () => {
    const plans: Plans = {
      t1: mkPlan({ due: '2026-08-07' }),
      p1: mkPlan({ due: '2026-08-06', type: 'prep', name: '英語 予習' }),
    };
    expect(upcomingTests(plans, T).map((t) => t.id)).toEqual(['t1']);
  });

  it('due 昇順・同 due は Plans のキー順', () => {
    const plans: Plans = {
      c: mkPlan({ due: '2026-08-09' }),
      a: mkPlan({ due: '2026-08-06' }),
      b: mkPlan({ due: '2026-08-06' }),
    };
    expect(upcomingTests(plans, T).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('残り日数と表示名（教科の重複を落とす）を付ける', () => {
    const plans: Plans = { p: mkPlan({ due: '2026-08-08', subj: '数学', name: '数学 期末テスト' }) };
    const [t] = upcomingTests(plans, T);
    expect(t.daysLeft).toBe(3);
    expect(t.subj).toBe('数学');
    expect(t.label).toBe('期末テスト');
    expect(t.due).toBe('2026-08-08');
    expect(t.plan.name).toBe('数学 期末テスト');
  });

  it('horizon を変えると窓が変わる（0 なら今日のテストだけ）', () => {
    const plans: Plans = {
      today: mkPlan({ due: T }),
      tomorrow: mkPlan({ due: '2026-08-06' }),
    };
    expect(upcomingTests(plans, T, 0).map((t) => t.id)).toEqual(['today']);
    expect(upcomingTests(plans, T, 1).map((t) => t.id)).toEqual(['today', 'tomorrow']);
  });

  it('due の無い壊れた計画は落とす', () => {
    const plans: Plans = { broken: mkPlan({ due: '' }) };
    expect(upcomingTests(plans, T)).toEqual([]);
  });
});

describe('testLabelOf', () => {
  it('先頭の「教科 」だけ落とす', () => {
    expect(testLabelOf({ name: '数学 期末テスト', subj: '数学' })).toBe('期末テスト');
  });

  it('規約から外れた名前はそのまま', () => {
    expect(testLabelOf({ name: '期末テスト', subj: '数学' })).toBe('期末テスト');
    expect(testLabelOf({ name: '数学', subj: '数学' })).toBe('数学');
    // 落とすと空になる場合は落とさない
    expect(testLabelOf({ name: '数学 ', subj: '数学' })).toBe('数学 ');
  });
});

describe('daysLeftLabel', () => {
  it('0=今日 / 1=明日 / それ以外は「あとN日」', () => {
    expect(daysLeftLabel(0)).toBe('今日');
    expect(daysLeftLabel(1)).toBe('明日');
    expect(daysLeftLabel(5)).toBe('あと5日');
  });
});

describe('boostReviewIds', () => {
  const testDue = '2026-08-10';

  it('教科が一致し、canAddToToday が真のものだけ', () => {
    const reviews = [
      mkReview({ id: 'ok-today' }),
      mkReview({ id: 'ok-late', due: '2026-08-01' }),
      mkReview({ id: 'other-subj', subj: '英語' }),
      mkReview({ id: 'added', added: true }),
      mkReview({ id: 'done', done: true }),
    ];
    expect(boostReviewIds(reviews, '数学', testDue, T)).toEqual(['ok-today', 'ok-late']);
  });

  it('due の境界: 今日は入り、明日以降は入らない（canAddToToday と同じ母集団）', () => {
    const reviews = [
      mkReview({ id: 'today', due: T }),
      mkReview({ id: 'tomorrow', due: '2026-08-06' }),
      mkReview({ id: 'on-test-day', due: testDue }),
    ];
    expect(boostReviewIds(reviews, '数学', testDue, T)).toEqual(['today']);
    // 「テストまでに来る復習」でも、今日まだ来ていない回は前倒ししない（due を動かさないため）
    reviews.forEach((r) => {
      expect(boostReviewIds(reviews, '数学', testDue, T).includes(r.id)).toBe(
        canAddToToday(r, T) && r.due <= testDue,
      );
    });
  });

  it('該当が無ければ空配列', () => {
    expect(boostReviewIds([mkReview({ subj: '英語' })], '数学', testDue, T)).toEqual([]);
  });
});

describe('addReviewsToToday', () => {
  it('added を立てて order の末尾へ積む（重複ガード付き）', () => {
    const reviews = [mkReview({ id: 'a' }), mkReview({ id: 'b' }), mkReview({ id: 'c' })];
    const res = addReviewsToToday(reviews, ['x', 'b'], ['a', 'b']);
    expect(res.ids).toEqual(['a', 'b']);
    expect(res.order).toEqual(['x', 'b', 'a']);
    expect(res.reviews.filter((r) => r.added).map((r) => r.id)).toEqual(['a', 'b']);
    expect(res.message).toBe('2件の復習を今日のToDoに追加しました');
    // 元の配列は変えない
    expect(reviews.every((r) => !r.added)).toBe(true);
  });

  it('0 件なら何も起きない（message は null）', () => {
    const reviews = [mkReview({ id: 'a' })];
    const res = addReviewsToToday(reviews, ['a'], []);
    expect(res.message).toBe(null);
    expect(res.reviews).toBe(reviews);
    expect(res.ids).toEqual([]);
  });

  it('実在しない id と重複は落とす', () => {
    const reviews = [mkReview({ id: 'a' })];
    const res = addReviewsToToday(reviews, [], ['a', 'a', 'zzz']);
    expect(res.ids).toEqual(['a']);
    expect(res.order).toEqual(['a']);
    expect(res.message).toBe('1件の復習を今日のToDoに追加しました');
  });
});

describe('lowScoreSubjects', () => {
  it('しきい値未満の教科だけを平均の低い順で返す', () => {
    const scores = [
      mkScore({ id: '1', subj: '数学', score: 50 }),
      mkScore({ id: '2', subj: '英語', score: 65 }),
      mkScore({ id: '3', subj: '国語', score: 90 }),
    ];
    const rows = lowScoreSubjects(scores, T);
    expect(rows.map((r) => r.subj)).toEqual(['数学', '英語']);
    expect(rows[0].avg).toBe(50);
    expect(rows[0].avgLabel).toBe('50');
  });

  it('しきい値ちょうどは「低い」に入れない', () => {
    const rows = lowScoreSubjects([mkScore({ score: LOW_SCORE_THRESHOLD })], T);
    expect(rows).toEqual([]);
  });

  it('窓の境界: ちょうど 60 日前は入り、61 日前は入らない', () => {
    const inWindow = mkScore({ id: 'in', subj: '数学', day: '2026-06-06', score: 10 });
    const outWindow = mkScore({ id: 'out', subj: '英語', day: '2026-06-05', score: 10 });
    const rows = lowScoreSubjects([inWindow, outWindow], T);
    expect(rows.map((r) => r.subj)).toEqual(['数学']);
  });

  it('未来日の点数は数えない', () => {
    const rows = lowScoreSubjects([mkScore({ day: '2026-08-06', score: 10 })], T);
    expect(rows).toEqual([]);
  });

  it('平均は窓に入った件数だけで割る', () => {
    const rows = lowScoreSubjects(
      [
        mkScore({ id: '1', subj: '数学', day: T, score: 40 }),
        mkScore({ id: '2', subj: '数学', day: '2026-08-01', score: 60 }),
        mkScore({ id: '3', subj: '数学', day: '2026-01-01', score: 100 }),
      ],
      T,
    );
    expect(rows[0].count).toBe(2);
    expect(rows[0].avg).toBe(50);
  });

  it('件数が min 未満の教科は判定しない', () => {
    const scores = [
      mkScore({ id: '1', subj: '数学', score: 40 }),
      mkScore({ id: '2', subj: '英語', score: 30 }),
      mkScore({ id: '3', subj: '英語', score: 30 }),
    ];
    expect(lowScoreSubjects(scores, T, { min: 2 }).map((r) => r.subj)).toEqual(['英語']);
    expect(lowScoreSubjects(scores, T, { min: 1 }).map((r) => r.subj)).toEqual(['英語', '数学']);
  });

  it('同じ平均なら scores に先に現れた教科が先', () => {
    const scores = [
      mkScore({ id: '1', subj: '英語', score: 40 }),
      mkScore({ id: '2', subj: '数学', score: 40 }),
    ];
    expect(lowScoreSubjects(scores, T).map((r) => r.subj)).toEqual(['英語', '数学']);
  });

  it('windowDays / threshold を差し替えられる', () => {
    const scores = [
      mkScore({ id: '1', subj: '数学', day: '2026-08-01', score: 75 }),
      mkScore({ id: '2', subj: '英語', day: '2026-07-01', score: 10 }),
    ];
    expect(lowScoreSubjects(scores, T, { threshold: 80 }).map((r) => r.subj)).toEqual([
      '英語',
      '数学',
    ]);
    expect(lowScoreSubjects(scores, T, { threshold: 80, windowDays: 7 }).map((r) => r.subj)).toEqual(
      ['数学'],
    );
  });

  it('0 点は潰さず、非数の点数は捨てる', () => {
    const rows = lowScoreSubjects(
      [
        mkScore({ id: '1', subj: '数学', score: 0 }),
        mkScore({ id: '2', subj: '英語', score: Number.NaN }),
      ],
      T,
    );
    expect(rows.map((r) => r.subj)).toEqual(['数学']);
    expect(rows[0].avg).toBe(0);
  });

  it('記録が無ければ空配列', () => {
    expect(lowScoreSubjects([], T)).toEqual([]);
  });
});
