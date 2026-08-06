import { describe, expect, it } from 'vitest';

import type { Extra, Plan, Plans, Review, Score, Seg, StudyLogEntry } from '../../model/types';
import { allTimeSubjectOrder, buildStudyEntries } from '../aggregate';
import {
  BUILTIN_SUBJ_COLORS,
  SUBJ_PALETTE,
  assignSubjectColors,
  createSubjectColors,
  orderedSubjectNames,
  subjectAppearanceOrder,
  subjectColorFor,
  withSubjectColors,
} from '../subjects';

/**
 * 期待値の根拠は レガシー `Compass App.dc.html` の
 * `SUBJ`（2014-2035）/ `_palette`（2052）/ `subjOf`（2053-2059）/ `TIMETABLE` 登録（2060）/
 * `renderVals` 冒頭の `knownSubjects`（2610-2618）/ 円グラフのループ（3402-3413）。
 */

/** レガシー `this.TIMETABLE`（HTML:2044-2050）— 先行登録が「1件も増やさない」ことの検証用 */
const TIMETABLE: Record<string, (string | null)[]> = {
  月: ['言語', '英コ', '体育', '数学', '歴総', '論表', null],
  火: ['化基', '英コ', '芸術', '芸術', '生基', '地総', '数学'],
  水: ['数学', '数学', '体育', '言語', '英コ', '現国', null],
  木: ['生基', '歴総', '化基', '論表', '数学', '言語', '保健'],
  金: ['現国', '体育', '地総', '英コ', '数学', 'LHR', null],
};

const VIO = { c: 'var(--vio)', bg: 'var(--vioBg)' };
const BLUE = { c: 'var(--blue)', bg: 'var(--blueBg)' };
const ACC = { c: 'var(--acc)', bg: 'var(--accBg)' };
const PINK = { c: 'var(--pink)', bg: 'var(--pinkBg)' };
const GRN = { c: 'var(--grn)', bg: 'var(--grnBg)' };
const ORG = { c: 'var(--org)', bg: 'var(--orgBg)' };

// ─────────────────────────────────────────────────────────────
// フィクスチャ・ビルダ
// ─────────────────────────────────────────────────────────────

const mkPlan = (subj: string): Plan => ({
  name: subj + ' 期末',
  type: 'test',
  due: '2026-08-20',
  subj,
  range: '範囲は未設定',
  timetablePeriod: null,
  timetableDate: null,
});

/** `Seg` は `subj` フィールドを持たない（＝先行登録で空振りする） */
const mkSeg = (id: string): Seg => ({
  id,
  plan: 'p1',
  title: id,
  size: 'M',
  min: 20,
  day: '',
  done: false,
});

const mkExtra = (id: string, subj: string): Extra => ({
  id,
  title: id,
  subj,
  size: 'M',
  min: 20,
  day: '2026-07-30',
  done: true,
  src: '単発タスク',
  timetablePeriod: null,
  timetableDate: null,
});

const mkReview = (id: string, subj: string): Review => ({
  id,
  seriesId: id,
  reviewNo: 1,
  title: id,
  subj,
  stage: '翌日',
  last: '2026-08-04',
  due: '2026-08-05',
  min: 10,
  src: '手動追加',
  timetablePeriod: null,
  timetableDate: null,
  added: false,
  done: false,
});

const mkScore = (id: string, subj: string): Score => ({
  id,
  name: id,
  subj,
  day: '2026-07-10',
  score: 80,
});

// ─────────────────────────────────────────────────────────────

describe('BUILTIN_SUBJ_COLORS', () => {
  it('has the 21 legacy subjects in declaration order', () => {
    expect(Object.keys(BUILTIN_SUBJ_COLORS)).toEqual([
      '古文',
      '現国',
      '言語',
      '数学',
      '歴史',
      '地理',
      '化学',
      '生物',
      '英コミ',
      '論表',
      'LHR',
      '物理',
      '体育',
      '保健',
      '芸術',
      '英語',
      '英コ',
      '歴総',
      '地総',
      '化基',
      '生基',
    ]);
    expect(Object.keys(BUILTIN_SUBJ_COLORS)).toHaveLength(21);
  });

  it('builds the color-mix strings exactly like sj(token, mix)', () => {
    expect(BUILTIN_SUBJ_COLORS['古文']).toEqual({
      c: 'var(--sj-terra)',
      bg: 'color-mix(in srgb,var(--sj-terra) 16%,var(--bg2))',
    });
    expect(BUILTIN_SUBJ_COLORS['地理']).toEqual({
      c: 'var(--sj-forest)',
      bg: 'color-mix(in srgb,var(--sj-forest) 20%,var(--bg2))',
    });
    // 別名は同じ色（英語 / 英コ / 英コミ）
    expect(BUILTIN_SUBJ_COLORS['英語']).toEqual(BUILTIN_SUBJ_COLORS['英コミ']);
    expect(BUILTIN_SUBJ_COLORS['英コ']).toEqual(BUILTIN_SUBJ_COLORS['英コミ']);
  });

  it('already contains every TIMETABLE subject (the constructor pass adds nothing)', () => {
    const names = Object.keys(TIMETABLE).flatMap((dow) =>
      TIMETABLE[dow].filter((n): n is string => !!n)
    );
    expect(assignSubjectColors(createSubjectColors(), names)).toEqual({});
  });
});

describe('SUBJ_PALETTE', () => {
  it('is vio → blue → acc → pink → grn → org', () => {
    expect(SUBJ_PALETTE).toEqual([VIO, BLUE, ACC, PINK, GRN, ORG]);
  });
});

describe('createSubjectColors', () => {
  it('returns a fresh copy of the builtin table', () => {
    const a = createSubjectColors();
    const b = createSubjectColors();
    expect(a).toEqual(BUILTIN_SUBJ_COLORS);
    a['新教科'] = VIO;
    expect(b['新教科']).toBeUndefined();
    expect(BUILTIN_SUBJ_COLORS['新教科']).toBeUndefined();
  });
});

describe('assignSubjectColors', () => {
  const base = createSubjectColors();

  it('starts the rotation at 21 % 6 = 3 (pink)', () => {
    expect(assignSubjectColors(base, ['英会話'])).toEqual({ 英会話: PINK });
  });

  it('advances the rotation once per newly assigned subject and wraps at 6', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(assignSubjectColors(base, names)).toEqual({
      a: PINK, // 21 % 6
      b: GRN, // 22 % 6
      c: ORG, // 23 % 6
      d: VIO, // 24 % 6
      e: BLUE, // 25 % 6
      f: ACC, // 26 % 6
      g: PINK, // 27 % 6
    });
  });

  it('never touches the input table', () => {
    const snapshot = { ...base };
    assignSubjectColors(base, ['英会話']);
    expect(base).toEqual(snapshot);
  });

  it('is stable for already-assigned subjects', () => {
    const once = withSubjectColors(base, ['英会話', '書道']);
    expect(assignSubjectColors(once, ['英会話', '書道'])).toEqual({});
    // 既存教科をまたいでも、新規だけが次の色を取る
    expect(assignSubjectColors(once, ['英会話', '珠算'])).toEqual({ 珠算: ORG }); // 23 % 6
  });

  it('assigns builtin subjects nothing', () => {
    expect(assignSubjectColors(base, ['数学', '古文', 'LHR'])).toEqual({});
  });

  it('assigns a duplicated name only once', () => {
    expect(assignSubjectColors(base, ['英会話', '英会話', '書道'])).toEqual({
      英会話: PINK,
      書道: GRN,
    });
  });

  it('registers a falsy name too (legacy subjOf("") really creates SUBJ[""])', () => {
    expect(assignSubjectColors(base, ['', '英会話'])).toEqual({ '': PINK, 英会話: GRN });
  });

  it('returns an empty object for an empty name list', () => {
    expect(assignSubjectColors(base, [])).toEqual({});
    expect(assignSubjectColors({}, [])).toEqual({});
  });

  it('rotates from 0 when the table is empty', () => {
    expect(assignSubjectColors({}, ['a', 'b'])).toEqual({ a: VIO, b: BLUE });
  });
});

describe('withSubjectColors', () => {
  it('appends new subjects after the existing ones (Object.keys(SUBJ) order)', () => {
    const merged = withSubjectColors(createSubjectColors(), ['英会話', '数学', '書道']);
    expect(Object.keys(merged)).toHaveLength(23);
    expect(Object.keys(merged).slice(21)).toEqual(['英会話', '書道']);
    expect(merged['英会話']).toEqual(PINK);
    expect(merged['書道']).toEqual(GRN);
    expect(merged['数学']).toEqual(BUILTIN_SUBJ_COLORS['数学']);
  });

  it('returns a copy even when nothing is added', () => {
    const base = createSubjectColors();
    const same = withSubjectColors(base, ['数学']);
    expect(same).toEqual(base);
    expect(same).not.toBe(base);
  });
});

describe('subjectColorFor', () => {
  it('reads the table without mutating it', () => {
    const base = createSubjectColors();
    expect(subjectColorFor(base, '数学')).toEqual(BUILTIN_SUBJ_COLORS['数学']);
    expect(subjectColorFor(base, '未登録')).toEqual(PINK); // 21 % 6
    expect(Object.keys(base)).toHaveLength(21); // 増えていない
  });
});

describe('subjectAppearanceOrder', () => {
  // 挿入順が p2 → p1 なので「planOrder ではなく Object.keys(PLANS) 順」が効く
  const plans: Plans = { p2: mkPlan('英語'), p1: mkPlan('数学') };
  const segs: Seg[] = [mkSeg('s1')];
  const extras: Extra[] = [mkExtra('x1', '古文')];
  const reviews: Review[] = [mkReview('r1', '簿記')];
  const scores: Score[] = [mkScore('sc1', '化学')];

  it('follows PLANS insertion order, then segs/extras/reviews/scores, then addSubj/scoreSubj', () => {
    expect(
      subjectAppearanceOrder({
        plans,
        segs,
        extras,
        reviews,
        scores,
        addSubj: '情報',
        scoreSubj: '地学',
      })
    ).toEqual(['英語', '数学', '古文', '簿記', '化学', '情報', '地学']);
  });

  it('gets nothing out of segs (Seg has no subj field — legacy pushes undefined)', () => {
    expect(subjectAppearanceOrder({ plans: {}, segs, extras: [], reviews: [], scores: [] })).toEqual(
      []
    );
  });

  it('drops falsy subjects and duplicates (first occurrence wins)', () => {
    expect(
      subjectAppearanceOrder({
        plans: {},
        segs: [],
        extras: [mkExtra('x1', '古文'), mkExtra('x2', ''), mkExtra('x3', '古文')],
        reviews: [mkReview('r1', '古文')],
        scores: [],
        addSubj: '',
        scoreSubj: undefined,
      })
    ).toEqual(['古文']);
  });

  it('appends studyLog-only subjects last, in pie order', () => {
    expect(
      subjectAppearanceOrder({
        plans,
        segs: [],
        extras: [],
        reviews: [],
        scores: [],
        studySubjects: ['読書', '数学', '写経'],
      })
    ).toEqual(['英語', '数学', '読書', '写経']);
  });

  it('returns an empty list for empty data', () => {
    expect(
      subjectAppearanceOrder({ plans: {}, segs: [], extras: [], reviews: [], scores: [] })
    ).toEqual([]);
  });
});

describe('legacy parity — the whole appearance order → palette assignment', () => {
  /**
   * spec Q35 の再現。`プログラミング` は `extras` にいるので `renderVals` 冒頭で先に採番され、
   * `読書` は `studyLog` にしかいないので円グラフのループ（全期間の分数降順）で後から採番される。
   */
  const plans: Plans = { p1: mkPlan('数学') };
  const studyLog: StudyLogEntry[] = [
    { day: '2026-08-04', subj: '読書', min: 15 },
    { day: '2026-08-05', subj: '数学', min: 20 },
  ];
  const extras: Extra[] = [mkExtra('x3', 'プログラミング')];
  const entries = buildStudyEntries({ studyLog, segs: [], extras }, plans);

  it('assigns pink to the extras-only subject and grn to the studyLog-only subject', () => {
    const order = subjectAppearanceOrder({
      plans,
      segs: [],
      extras,
      reviews: [],
      scores: [],
      studySubjects: allTimeSubjectOrder(entries),
    });
    expect(order).toEqual(['数学', 'プログラミング', '読書']);
    expect(assignSubjectColors(createSubjectColors(), order)).toEqual({
      プログラミング: PINK, // 21 % 6
      読書: GRN, // 22 % 6
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// orderedSubjectNames（HTML:3538-3541 / C-435）
// ═══════════════════════════════════════════════════════════════

describe('orderedSubjectNames', () => {
  const NAMES = ['数学', '英語', '国語', '理科'];

  it('recentSubjs の順を先頭に、残りは元の順で後ろへ', () => {
    expect(orderedSubjectNames(NAMES, ['理科', '英語'])).toEqual([
      '理科',
      '英語',
      '数学',
      '国語',
    ]);
  });

  it('SUBJ に無い recentSubjs は無視する', () => {
    expect(orderedSubjectNames(NAMES, ['未登録', '国語'])).toEqual([
      '国語',
      '数学',
      '英語',
      '理科',
    ]);
  });

  it('recentSubjs が空なら元の順のまま', () => {
    expect(orderedSubjectNames(NAMES, [])).toEqual(NAMES);
  });
});
