import { describe, expect, it } from 'vitest';

import type { Extra, Plans, Review, Seg, StudyLogEntry } from '../../model/types';
import {
  DATA_RANGE_CHIPS,
  HEAT,
  aggregateData,
  allTimeSubjectOrder,
  buildHeatmap,
  buildStudyEntries,
  computeDayMinutes,
  computePie,
  computeStreak,
  computeWeekRate,
  dataRangeNote,
  heatFill,
  heatLevel,
  makeDataRangeFilter,
  normalizeDataRange,
  streakView,
  toH,
} from '../aggregate';

/**
 * 期待値はすべて **レガシー `Compass App.dc.html` の該当式をそのまま実行した出力**
 * （HTML:3376-3448 / 3206-3211 / 4308-4314）。手計算ではない。
 *
 * 基準日 `T = 2026-08-05`（水）。週（月曜始まり）は 08-03〜08-09。
 */
const T = '2026-08-05';

// ─────────────────────────────────────────────────────────────
// フィクスチャ
// ─────────────────────────────────────────────────────────────

const plan = (subj: string): Plans[string] => ({
  name: subj + ' テスト',
  type: 'test',
  due: '2026-08-20',
  subj,
  range: '範囲は未設定',
  timetablePeriod: null,
  timetableDate: null,
});

const seg = (id: string, planId: string, done: boolean, day: string, min: number): Seg => ({
  id,
  plan: planId,
  title: id,
  size: 'M',
  min,
  day,
  done,
});

const extra = (id: string, subj: string, done: boolean, day: string, min: number): Extra => ({
  id,
  title: id,
  subj,
  size: 'M',
  min,
  day,
  done,
  src: '単発タスク',
  timetablePeriod: null,
  timetableDate: null,
});

const review = (id: string, due: string, done: boolean): Review => ({
  id,
  seriesId: id,
  reviewNo: 1,
  title: id,
  subj: '数学',
  stage: '翌日',
  last: '2026-08-01',
  due,
  min: 10,
  src: '手動追加',
  timetablePeriod: null,
  timetableDate: null,
  added: false,
  done,
});

/** 計画マスタ。`ghost` は**存在しない**（孤児 seg のガード検証用） */
const PLANS: Plans = { p1: plan('数学'), p2: plan('英語') };

const studyLog: StudyLogEntry[] = [
  { day: '2026-08-05', subj: '数学', min: 20 },
  { day: '2026-08-04', subj: '読書', min: 15 }, // studyLog にしか出ない教科
  { day: '2026-07-28', subj: '数学', min: 120 },
  { day: '', subj: '古文', min: 5 }, // 日付なし → 今週/今月では数えない
  { day: '2026-08-01', subj: '物理', min: 60 }, // 今月だが今週より前
];

const segs: Seg[] = [
  seg('s1', 'p1', true, '2026-08-05', 30),
  seg('s2', 'p1', false, '2026-08-04', 20), // 未完了 → 集計外
  seg('s3', 'ghost', true, '2026-08-05', 999), // 孤児 → (v0.9) スキップ
  seg('s4', 'p2', true, '', 10), // 未配分のまま完了
];

const extras: Extra[] = [
  extra('x1', '古文', true, '2026-08-03', 45),
  extra('x2', '古文', false, '2026-08-05', 60), // 未完了 → 集計外
  extra('x3', 'プログラミング', true, '2026-07-30', 20),
];

const STATE = { studyLog, segs, extras };

const entries = buildStudyEntries(STATE, PLANS);

// ─────────────────────────────────────────────────────────────

describe('toH', () => {
  it('rounds to one decimal (Math.round(m/6)/10)', () => {
    expect(toH(0)).toBe('0h');
    expect(toH(20)).toBe('0.3h');
    expect(toH(60)).toBe('1h'); // 小数点以下が消える
    expect(toH(170)).toBe('2.8h');
    expect(toH(325)).toBe('5.4h');
  });
});

describe('buildStudyEntries', () => {
  it('merges studyLog + done segs + done extras in legacy order', () => {
    expect(entries).toEqual([
      { day: '2026-08-05', subj: '数学', min: 20 },
      { day: '2026-08-04', subj: '読書', min: 15 },
      { day: '2026-07-28', subj: '数学', min: 120 },
      { day: '', subj: '古文', min: 5 },
      { day: '2026-08-01', subj: '物理', min: 60 },
      { day: '2026-08-05', subj: '数学', min: 30 }, // seg s1（教科は PLANS 由来）
      { day: '', subj: '英語', min: 10 }, // seg s4（day:'' に正規化）
      { day: '2026-08-03', subj: '古文', min: 45 }, // extra x1
      { day: '2026-07-30', subj: 'プログラミング', min: 20 }, // extra x3
    ]);
  });

  it('skips orphan segs (P[s.plan] undefined) instead of throwing — v0.9 fix', () => {
    expect(entries.some((e) => e.min === 999)).toBe(false);
  });

  it('never counts completed reviews (they are already in studyLog)', () => {
    // 復習は completedAt を持っていても studyEntries に一切入らない
    expect(entries).toHaveLength(9);
  });

  it('returns an empty list for empty data', () => {
    expect(buildStudyEntries({ studyLog: [], segs: [], extras: [] }, {})).toEqual([]);
  });
});

describe('normalizeDataRange', () => {
  it("keeps 'week' / 'month' and rounds everything else to 'all'", () => {
    expect(normalizeDataRange('week')).toBe('week');
    expect(normalizeDataRange('month')).toBe('month');
    expect(normalizeDataRange('all')).toBe('all');
    expect(normalizeDataRange('year')).toBe('all');
    expect(normalizeDataRange(undefined)).toBe('all');
    expect(normalizeDataRange(null)).toBe('all');
  });

  it('lists the chips left-to-right as 今週 / 今月 / 全期間', () => {
    expect(DATA_RANGE_CHIPS.map((c) => c.id)).toEqual(['week', 'month', 'all']);
    expect(DATA_RANGE_CHIPS.map((c) => c.label)).toEqual(['今週', '今月', '全期間']);
  });
});

describe('makeDataRangeFilter', () => {
  it("'all' accepts everything including undated entries", () => {
    const f = makeDataRangeFilter('all', T);
    expect(f('')).toBe(true);
    expect(f('2020-01-01')).toBe(true);
  });

  it("'week' is Monday..Sunday and drops undated entries", () => {
    const f = makeDataRangeFilter('week', T);
    expect(f('2026-08-02')).toBe(false); // 前の週の日曜
    expect(f('2026-08-03')).toBe(true); // 月曜
    expect(f('2026-08-09')).toBe(true); // 日曜
    expect(f('2026-08-10')).toBe(false);
    expect(f('')).toBe(false);
  });

  it("'month' is the calendar month (not the last 30 days)", () => {
    const f = makeDataRangeFilter('month', T);
    expect(f('2026-08-01')).toBe(true);
    expect(f('2026-08-31')).toBe(true);
    expect(f('2026-07-31')).toBe(false);
    expect(f('')).toBe(false);
  });

  it('treats Sunday as the end of the week that started the previous Monday', () => {
    const f = makeDataRangeFilter('week', '2026-08-09'); // 日曜
    expect(f('2026-08-03')).toBe(true);
    expect(f('2026-08-10')).toBe(false);
  });
});

describe('dataRangeNote', () => {
  it('matches the legacy strings', () => {
    expect(dataRangeNote('week', T)).toBe('8/3 〜 8/9');
    expect(dataRangeNote('month', T)).toBe('8月');
    expect(dataRangeNote('all', T)).toBe('すべての記録');
  });
});

describe('computePie — 全期間', () => {
  const pie = computePie(entries, makeDataRangeFilter('all', T));

  it('sums every entry, undated included', () => {
    expect(pie.totals).toEqual({
      数学: 170,
      読書: 15,
      古文: 50,
      物理: 60,
      英語: 10,
      プログラミング: 20,
    });
    expect(pie.total).toBe(325);
    expect(pie.totalH).toBe('5.4h');
  });

  it('keeps studyEntries insertion order in totals (ties depend on it)', () => {
    expect(Object.keys(pie.totals)).toEqual(['数学', '読書', '古文', '物理', '英語', 'プログラミング']);
  });

  it('sorts slices by minutes descending', () => {
    expect(pie.slices.map((s) => s.name)).toEqual([
      '数学',
      '物理',
      '古文',
      'プログラミング',
      '読書',
      '英語',
    ]);
  });

  it('produces the legacy dasharray / dashoffset strings', () => {
    expect(pie.slices.map((s) => ({ dash: s.dash, off: s.off }))).toEqual([
      { dash: '52.31 47.69', off: '25.00' },
      { dash: '18.46 81.54', off: '-27.31' },
      { dash: '15.38 84.62', off: '-45.77' },
      { dash: '6.15 93.85', off: '-61.15' },
      { dash: '4.62 95.38', off: '-67.31' },
      { dash: '3.08 96.92', off: '-71.92' },
    ]);
  });

  it('produces the legacy legend labels', () => {
    expect(pie.slices.map((s) => ({ name: s.name, h: s.h, pct: s.pctLabel }))).toEqual([
      { name: '数学', h: '2.8h', pct: '52%' },
      { name: '物理', h: '1h', pct: '18%' },
      { name: '古文', h: '0.8h', pct: '15%' },
      { name: 'プログラミング', h: '0.3h', pct: '6%' },
      { name: '読書', h: '0.3h', pct: '5%' },
      { name: '英語', h: '0.2h', pct: '3%' },
    ]);
  });
});

describe('computePie — 今週 / 今月', () => {
  it('週: 月曜〜日曜だけを数え、未配分は落とす', () => {
    const pie = computePie(entries, makeDataRangeFilter('week', T));
    expect(pie.totals).toEqual({ 数学: 50, 読書: 15, 古文: 45 });
    expect(pie.total).toBe(110);
    expect(pie.totalH).toBe('1.8h');
    expect(pie.slices.map((s) => [s.name, s.dash, s.off, s.h, s.pctLabel])).toEqual([
      ['数学', '45.45 54.55', '25.00', '0.8h', '45%'],
      ['古文', '40.91 59.09', '-20.45', '0.8h', '41%'],
      ['読書', '13.64 86.36', '-61.36', '0.3h', '14%'],
    ]);
  });

  it('月: 暦月ぶん（今週より前の 08-01 も入る）', () => {
    const pie = computePie(entries, makeDataRangeFilter('month', T));
    expect(pie.totals).toEqual({ 数学: 50, 読書: 15, 物理: 60, 古文: 45 });
    expect(pie.total).toBe(170);
    expect(pie.slices.map((s) => s.name)).toEqual(['物理', '数学', '古文', '読書']);
    expect(pie.slices.map((s) => s.pctLabel)).toEqual(['35%', '29%', '26%', '9%']);
  });
});

describe('computePie — 空データ', () => {
  const pie = computePie([], () => true);

  it('has no slices and a 0h center label', () => {
    expect(pie.slices).toEqual([]);
    expect(pie.total).toBe(0);
    expect(pie.totalH).toBe('0h');
    expect(pie.totals).toEqual({});
  });

  it('never divides by zero when every entry is 0 min', () => {
    const zero = computePie([{ day: T, subj: '数学', min: 0 }], () => true);
    expect(zero.total).toBe(0);
    expect(zero.slices).toEqual([
      { name: '数学', min: 0, pct: 0, dash: '0.00 100.00', off: '25.00', h: '0h', pctLabel: '0%' },
    ]);
  });
});

describe('allTimeSubjectOrder', () => {
  it('is the 全期間 pie order (= the legacy color assignment order for studyLog-only subjects)', () => {
    expect(allTimeSubjectOrder(entries)).toEqual([
      '数学',
      '物理',
      '古文',
      'プログラミング',
      '読書',
      '英語',
    ]);
  });

  it('is empty for empty data', () => {
    expect(allTimeSubjectOrder([])).toEqual([]);
  });
});

describe('computeDayMinutes', () => {
  it('sums per day and ignores undated entries (no period filter)', () => {
    expect(computeDayMinutes(entries)).toEqual({
      '2026-08-05': 50,
      '2026-08-04': 15,
      '2026-07-28': 120,
      '2026-08-01': 60,
      '2026-08-03': 45,
      '2026-07-30': 20,
    });
  });

  it('is empty for empty data', () => {
    expect(computeDayMinutes([])).toEqual({});
  });
});

describe('computeStreak', () => {
  const dayMin = computeDayMinutes(entries);

  it('counts back from today while every day has >= 1 min', () => {
    // 08-05(50) → 08-04(15) → 08-03(45) → 08-02 は記録なしで停止
    expect(computeStreak(dayMin, T)).toBe(3);
  });

  it('starts from yesterday when today is still 0 min', () => {
    const noToday = { ...dayMin };
    delete noToday[T];
    expect(computeStreak(noToday, T)).toBe(2);
  });

  it('is 0 when neither today nor yesterday has a record', () => {
    expect(computeStreak({ '2026-08-03': 45 }, T)).toBe(0);
    expect(computeStreak({}, T)).toBe(0);
  });

  it('counts today alone as 1', () => {
    expect(computeStreak({ [T]: 1 }, T)).toBe(1);
  });

  it('stops at the 3650-day guard', () => {
    const dense: Record<string, number> = {};
    let cursor = new Date(T + 'T00:00:00Z').getTime();
    for (let i = 0; i < 3700; i++) {
      dense[new Date(cursor).toISOString().slice(0, 10)] = 10;
      cursor -= 86400000;
    }
    expect(computeStreak(dense, T)).toBe(3650);
  });
});

describe('streakView', () => {
  it('renders the fire label when the streak is alive', () => {
    expect(streakView(3)).toEqual({
      days: 3,
      label: '🔥 連続3日',
      color: 'var(--org)',
      border: 'color-mix(in srgb, var(--org) 40%, var(--line))',
    });
  });

  it('renders the empty state at 0 days', () => {
    expect(streakView(0)).toEqual({
      days: 0,
      label: 'まだ連続記録はありません',
      color: 'var(--tx3)',
      border: 'var(--line)',
    });
  });
});

describe('heatLevel / heatFill', () => {
  it('buckets on absolute minutes (0 / 1-29 / 30-59 / 60-119 / 120+)', () => {
    expect(heatLevel(0, false)).toBe('none');
    expect(heatLevel(1, false)).toBe('low');
    expect(heatLevel(29, false)).toBe('low');
    expect(heatLevel(30, false)).toBe('mid');
    expect(heatLevel(59, false)).toBe('mid');
    expect(heatLevel(60, false)).toBe('high');
    expect(heatLevel(119, false)).toBe('high');
    expect(heatLevel(120, false)).toBe('max');
    expect(heatLevel(9999, false)).toBe('max');
  });

  it('lets the future flag win over the minutes', () => {
    expect(heatLevel(120, true)).toBe('future');
    expect(heatFill(120, true)).toBe('color-mix(in srgb, var(--tx3) 6%, transparent)');
  });

  it('matches the legacy color strings', () => {
    expect(heatFill(0, false)).toBe('color-mix(in srgb, var(--tx3) 14%, transparent)');
    expect(heatFill(20, false)).toBe('color-mix(in srgb, var(--acc) 22%, var(--bg2))');
    expect(heatFill(45, false)).toBe('color-mix(in srgb, var(--acc) 45%, var(--bg2))');
    expect(heatFill(90, false)).toBe('color-mix(in srgb, var(--acc) 70%, var(--bg2))');
    expect(heatFill(150, false)).toBe('var(--acc)');
  });
});

describe('buildHeatmap', () => {
  const heat = buildHeatmap(computeDayMinutes(entries), T);

  it('has 15 columns × 7 rows and the legacy viewBox', () => {
    expect(heat.cells).toHaveLength(HEAT.WEEKS * 7);
    expect(heat.cells).toHaveLength(105);
    expect(heat.viewBox).toBe('0 0 240 114');
  });

  it('puts the oldest week on the left and this week on the right', () => {
    expect(heat.cells[0].iso).toBe('2026-04-27'); // 14 週前の月曜
    expect(heat.cells[0].x).toBe(HEAT.PAD);
    expect(heat.cells[104].iso).toBe('2026-08-09'); // 今週の日曜
    expect(heat.cells[98].iso).toBe('2026-08-03'); // 今週の月曜
    expect(heat.cells[98].x).toBe(228);
  });

  it('lays rows out Monday(top) → Sunday(bottom) at a 15px pitch', () => {
    expect(heat.cells.slice(98, 105).map((c) => c.y)).toEqual([12, 27, 42, 57, 72, 87, 102]);
  });

  it('fills and labels the cells like the legacy', () => {
    expect(heat.cells.slice(98, 105).map((c) => [c.iso, c.min, c.future, c.tip])).toEqual([
      ['2026-08-03', 45, false, '8/3 · 45分'],
      ['2026-08-04', 15, false, '8/4 · 15分'],
      ['2026-08-05', 50, false, '8/5 · 50分'],
      ['2026-08-06', 0, true, '8/6'],
      ['2026-08-07', 0, true, '8/7'],
      ['2026-08-08', 0, true, '8/8'],
      ['2026-08-09', 0, true, '8/9'],
    ]);
    expect(heat.cells[98].fill).toBe('color-mix(in srgb, var(--acc) 45%, var(--bg2))');
    expect(heat.cells[101].fill).toBe('color-mix(in srgb, var(--tx3) 6%, transparent)');
  });

  it('shows every non-zero day exactly once', () => {
    expect(heat.cells.filter((c) => c.min > 0).map((c) => [c.iso, c.min])).toEqual([
      ['2026-07-28', 120],
      ['2026-07-30', 20],
      ['2026-08-01', 60],
      ['2026-08-03', 45],
      ['2026-08-04', 15],
      ['2026-08-05', 50],
    ]);
  });

  it('labels only the columns whose Monday falls on day 1-7', () => {
    expect(heat.months).toEqual([
      { x: 33, label: '5月' },
      { x: 93, label: '6月' },
      { x: 168, label: '7月' },
      { x: 228, label: '8月' },
    ]);
  });

  it('labels only Mon / Wed / Fri rows', () => {
    expect(heat.dows).toEqual([
      { y: 21, label: '月' },
      { y: 51, label: '水' },
      { y: 81, label: '金' },
    ]);
  });

  it('has a 5-step legend (0 / 20 / 45 / 90 / 150 min)', () => {
    expect(heat.legend).toEqual([
      'color-mix(in srgb, var(--tx3) 14%, transparent)',
      'color-mix(in srgb, var(--acc) 22%, var(--bg2))',
      'color-mix(in srgb, var(--acc) 45%, var(--bg2))',
      'color-mix(in srgb, var(--acc) 70%, var(--bg2))',
      'var(--acc)',
    ]);
  });

  it('still draws all 105 cells with empty data', () => {
    const empty = buildHeatmap({}, T);
    expect(empty.cells).toHaveLength(105);
    expect(empty.cells.filter((c) => c.min > 0)).toHaveLength(0);
    expect(empty.cells.filter((c) => c.future)).toHaveLength(4); // 08-06..08-09
    expect(empty.months).toHaveLength(4);
  });
});

describe('computeWeekRate（復習の週次消化率）', () => {
  const reviews: Review[] = [
    review('r1', '2026-08-03', true), // 月曜・完了
    review('r2', '2026-08-04', false), // 火曜・未完了
    review('r3', '2026-08-05', true), // 今日・完了
    review('r4', '2026-08-06', true), // 明日 → 母数に入らない
    review('r5', '2026-08-02', true), // 前の週の日曜 → 母数に入らない
  ];

  it('counts reviews whose due is between this Monday and today', () => {
    expect(computeWeekRate(reviews, T)).toEqual({
      available: true,
      done: 2,
      total: 3,
      rate: 67,
      label: '67',
      suffix: '%',
      meta: '2/3件',
    });
  });

  it('falls back to the empty state when nothing is due yet this week', () => {
    expect(computeWeekRate([review('r4', '2026-08-06', true)], T)).toEqual({
      available: false,
      done: 0,
      total: 0,
      rate: null,
      label: '–',
      suffix: '',
      meta: '今週は対象なし',
    });
    expect(computeWeekRate([], T).meta).toBe('今週は対象なし');
  });

  it('reports 100% / 0% at the extremes', () => {
    expect(computeWeekRate([review('a', T, true)], T).label).toBe('100');
    expect(computeWeekRate([review('a', T, false)], T).label).toBe('0');
  });

  it('uses the Monday-start week (Sunday belongs to the previous Monday)', () => {
    const sunday = '2026-08-09';
    // 日曜から見ると 08-03 も同じ週
    expect(computeWeekRate(reviews, sunday).total).toBe(4); // r1,r2,r3,r4
    expect(computeWeekRate(reviews, sunday).done).toBe(3);
  });
});

describe('aggregateData', () => {
  it('wires everything together for the default 全期間 view', () => {
    const d = aggregateData({ ...STATE, dataRange: undefined }, PLANS, T);
    expect(d.range).toBe('all');
    expect(d.weekStart).toBe('2026-08-03');
    expect(d.weekEnd).toBe('2026-08-09');
    expect(d.rangeNote).toBe('すべての記録');
    expect(d.entries).toHaveLength(9);
    expect(d.pie.totalH).toBe('5.4h');
    expect(d.streak.days).toBe(3);
    expect(d.streak.label).toBe('🔥 連続3日');
    expect(d.heatmap.cells).toHaveLength(105);
    expect(d.allTimeSubjects).toEqual(['数学', '物理', '古文', 'プログラミング', '読書', '英語']);
  });

  it('applies the period filter to the pie only — streak and heatmap stay all-time', () => {
    const all = aggregateData({ ...STATE, dataRange: 'all' }, PLANS, T);
    const week = aggregateData({ ...STATE, dataRange: 'week' }, PLANS, T);
    expect(week.pie.total).toBe(110);
    expect(all.pie.total).toBe(325);
    expect(week.rangeNote).toBe('8/3 〜 8/9');
    // 期間に依存しないもの
    expect(week.dayMinutes).toEqual(all.dayMinutes);
    expect(week.streak).toEqual(all.streak);
    expect(week.heatmap).toEqual(all.heatmap);
    expect(week.allTimeSubjects).toEqual(all.allTimeSubjects);
  });

  it('survives completely empty data', () => {
    const d = aggregateData({ studyLog: [], segs: [], extras: [] }, {}, T);
    expect(d.entries).toEqual([]);
    expect(d.pie.slices).toEqual([]);
    expect(d.pie.totalH).toBe('0h');
    expect(d.streak).toEqual({
      days: 0,
      label: 'まだ連続記録はありません',
      color: 'var(--tx3)',
      border: 'var(--line)',
    });
    expect(d.heatmap.cells).toHaveLength(105);
    expect(d.allTimeSubjects).toEqual([]);
  });
});
