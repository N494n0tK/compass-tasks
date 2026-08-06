import { describe, expect, it } from 'vitest';

import { dateContextFor } from '../dates';
import {
  MAX_LOAD_MAX,
  MAX_LOAD_MIN,
  MAX_LOAD_STEP,
  MAX_TIMELINE_DAYS,
  activePlanIds,
  applyRedist,
  computeInitialPlacement,
  computePreview,
  decMaxLoad,
  incMaxLoad,
  loadBarPct,
  loadsMap,
  maxLoadLabel,
  maxOf,
  orderedPlanIds,
  overdueSegs,
  planOverdueCount,
  planTimelineDays,
  redistLoadBarPct,
  redistTargetSegs,
  redistToast,
  resolvePlanStart,
  scheduleItems,
  toH,
  todayLoadPct,
  type LoadLimits,
  type RedistStateSlice,
} from '../schedule';
import type { Extra, Plans, Review, Seg } from '../../model/types';

/**
 * 期待値はすべて **レガシー `Compass App.dc.html` の関数を verbatim で切り出して実行した結果**
 * （`scheduleItems` HTML:1938-1991 / `planTimelineDays`〜`computePreview` HTML:2513-2601）。
 *
 * 基準日 2026-08-05（水）。先頭 7 日は
 * `水 木 金 [土 日] 月 火` = `08-05 … 08-11` で、土日を 2 日含む混在容量になる。
 */
const T = '2026-08-05';
const ctx = dateContextFor(T);

/** 平日 240 分 / 休日 360 分（レガシー初期値, HTML:2066） */
const LIMITS: LoadLimits = { wkMax: 240, weMax: 360 };

/** 空の 7 日窓（wkMax=240 / weMax=360）。index 3,4 が土日 */
const WEEK = [240, 240, 240, 360, 360, 240, 240];
const SIX = [{ min: 20 }, { min: 20 }, { min: 20 }, { min: 30 }, { min: 10 }, { min: 5 }];
const FIVE = [{ min: 20 }, { min: 20 }, { min: 20 }, { min: 20 }, { min: 20 }];

// ═══════════════════════════════════════════════════════════════
// scheduleItems — 3 モードの期待値表
// ═══════════════════════════════════════════════════════════════

describe('scheduleItems — 7日窓 × 混在容量（空きの週）', () => {
  it('even: 空き容量に比例して散らす（1件目は初日、最後は最終日側）', () => {
    expect(scheduleItems(SIX, WEEK, 'even')).toEqual([0, 1, 3, 4, 6, 6]);
  });

  it('early: 入る日から前詰め（同じ日に何件でも積む）', () => {
    expect(scheduleItems(SIX, WEEK, 'early')).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('flow: 上限を無視して期間全体へ等間隔（空きが全部 1 の重みになる）', () => {
    expect(scheduleItems(SIX, WEEK, 'flow')).toEqual([0, 1, 3, 4, 6, 6]);
  });

  it('spread 省略・未知の値はどちらも even 扱い', () => {
    expect(scheduleItems(SIX, WEEK)).toEqual([0, 1, 3, 4, 6, 6]);
    expect(scheduleItems(SIX, WEEK, 'zzz')).toEqual([0, 1, 3, 4, 6, 6]);
  });
});

describe('scheduleItems — 既存の予定で歯抜けになった容量', () => {
  // 0 / 60 / 240 / 30 / 360 / 100 / 240（初日は満杯、土曜は 30 分しか空きが無い）
  const BUSY = [0, 60, 240, 30, 360, 100, 240];

  it('even: 容量が足りない日は後ろへずらして置く', () => {
    expect(scheduleItems(FIVE, BUSY, 'even')).toEqual([1, 2, 4, 5, 6]);
  });

  it('early: 入る最初の日へ詰める', () => {
    expect(scheduleItems(FIVE, BUSY, 'early')).toEqual([1, 1, 1, 2, 2]);
  });

  it('flow: 容量を見ないので歯抜けでも等間隔のまま', () => {
    expect(scheduleItems(FIVE, BUSY, 'flow')).toEqual([0, 1, 3, 5, 6]);
  });
});

describe('scheduleItems — 件数が多いとき', () => {
  const TWELVE = Array.from({ length: 12 }, () => ({ min: 30 }));

  it('even は容量比で分散、early は前詰め、flow は等間隔', () => {
    expect(scheduleItems(TWELVE, WEEK, 'even')).toEqual([0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6]);
    expect(scheduleItems(TWELVE, WEEK, 'early')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(scheduleItems(TWELVE, WEEK, 'flow')).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 6]);
  });

  it('週の総容量(1920分)を超える分は even/early とも -1、flow は全件置ける', () => {
    const OVER = Array.from({ length: 20 }, () => ({ min: 120 }));
    const packed = [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, -1, -1, -1, -1];
    expect(scheduleItems(OVER, WEEK, 'even')).toEqual(packed);
    expect(scheduleItems(OVER, WEEK, 'early')).toEqual(packed);
    expect(scheduleItems(OVER, WEEK, 'flow')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
    ]);
  });
});

describe('scheduleItems — レガシーの癖', () => {
  it('min が 0 / undefined / null / 要素自体が無くても「最低 1 分」として扱う', () => {
    // 1分ずつの日が 7 日 → 先頭 6 件は 1 日ずつ埋まり、7 件目（"5"分）はどこにも入らない
    const WEIRD = [
      { min: 0 },
      {},
      { min: undefined },
      { min: null },
      null,
      undefined,
      { min: '5' } as unknown as { min: number },
    ];
    const room = [1, 1, 1, 1, 1, 1, 1];
    expect(scheduleItems(WEIRD, room, 'even')).toEqual([0, 1, 2, 3, 4, 5, -1]);
    expect(scheduleItems(WEIRD, room, 'early')).toEqual([0, 1, 2, 3, 4, 5, -1]);
  });

  it('room の非数値・負値は 0 に丸められる', () => {
    // '20' は 20 として通り、-5 / NaN / undefined は 0 になる
    const room = ['20', -5, NaN, undefined, 40] as unknown as number[];
    expect(scheduleItems([{ min: 10 }, { min: 10 }], room, 'even')).toEqual([0, 4]);
  });

  it('items か room が空なら即 return（out は items と同じ長さ）', () => {
    expect(scheduleItems([], WEEK, 'even')).toEqual([]);
    expect(scheduleItems(SIX, [], 'even')).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it('全部の容量が 0 のとき even/early は全件 -1、flow だけは置ける（weight が全部 1）', () => {
    expect(scheduleItems(FIVE, [0, 0, 0], 'even')).toEqual([-1, -1, -1, -1, -1]);
    expect(scheduleItems(FIVE, [0, 0, 0], 'early')).toEqual([-1, -1, -1, -1, -1]);
    expect(scheduleItems(FIVE, [0, 0, 0], 'flow')).toEqual([0, 0, 1, 2, 2]);
  });

  it('「1件目は必ず初日」は ratio の話。初日が満杯なら even は後ろへずれる（flow はずれない）', () => {
    expect(scheduleItems(FIVE, [0, 240, 240, 240], 'even')).toEqual([1, 1, 2, 3, 3]);
    expect(scheduleItems(FIVE, [0, 240, 240, 240], 'flow')).toEqual([0, 1, 2, 3, 3]);
  });

  it('1件だけなら span=0 → ratio=0 → 必ず初日', () => {
    expect(scheduleItems([{ min: 20 }], WEEK, 'even')).toEqual([0]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 上限（wkMax / weMax）と maxOf
// ═══════════════════════════════════════════════════════════════

describe('maxOf / wkMax / weMax', () => {
  it('週末は weMax、平日は wkMax', () => {
    const days = planTimelineDays({}, [], ctx);
    expect(maxOf(days[0], LIMITS)).toBe(240); // 08-05 水
    expect(maxOf(days[3], LIMITS)).toBe(360); // 08-08 土
    expect(maxOf(days[4], LIMITS)).toBe(360); // 08-09 日
    expect(maxOf(days[5], LIMITS)).toBe(240); // 08-10 月
  });

  it('± ボタンは 30 分刻み・上限 720 / 下限 60', () => {
    expect([MAX_LOAD_STEP, MAX_LOAD_MIN, MAX_LOAD_MAX]).toEqual([30, 60, 720]);
    expect(incMaxLoad(240)).toBe(270);
    expect(decMaxLoad(240)).toBe(210);
    expect(incMaxLoad(700)).toBe(720);
    expect(incMaxLoad(720)).toBe(720);
    expect(decMaxLoad(60)).toBe(60);
    expect(decMaxLoad(80)).toBe(60);
  });

  it('wkMaxH / weMaxH は時間表記', () => {
    expect(maxLoadLabel(240)).toBe('4h');
    expect(maxLoadLabel(360)).toBe('6h');
    expect(maxLoadLabel(270)).toBe('4.5h');
  });
});

// ═══════════════════════════════════════════════════════════════
// planTimelineDays / loadsMap
// ═══════════════════════════════════════════════════════════════

describe('planTimelineDays', () => {
  it('最低 13 日、GOAL / seg の日付で伸び、過去日と不正値は無視、731 日で打ち切り', () => {
    expect(planTimelineDays({}, [], ctx)).toHaveLength(13);
    expect(planTimelineDays({}, [{ day: '2026-09-01' } as Seg], ctx)).toHaveLength(28);
    expect(planTimelineDays({ z: { due: '2026-08-20' } } as unknown as Plans, [], ctx)).toHaveLength(
      16,
    );
    // 今日より前の日付は伸ばさない
    expect(
      planTimelineDays({ z: { due: '2020-01-01' } } as unknown as Plans, [{ day: '2020-01-01' } as Seg], ctx),
    ).toHaveLength(13);
    // 正規表現に合わない値・null は無視
    expect(
      planTimelineDays({ z: { due: 'not-a-date' } } as unknown as Plans, [
        { day: null } as unknown as Seg,
        {} as Seg,
      ], ctx),
    ).toHaveLength(13);
    // 今日ちょうどの GOAL では伸びない
    expect(planTimelineDays({ z: { due: T } } as unknown as Plans, [], ctx)).toHaveLength(13);
    // 2 年以上先は 731 日で頭打ち
    expect(planTimelineDays({ z: { due: '2030-01-01' } } as unknown as Plans, [], ctx)).toHaveLength(
      MAX_TIMELINE_DAYS,
    );
  });

  it('要素の形は DAYS と同じ（iso / dow / label / weekend / idx）', () => {
    const days = planTimelineDays({}, [], ctx);
    expect(days[0]).toEqual({ iso: '2026-08-05', dow: '水', label: '5', weekend: false, idx: 0 });
    expect(days[3]).toEqual({ iso: '2026-08-08', dow: '土', label: '8', weekend: true, idx: 3 });
  });
});

// ── 再配分・負荷のフィクスチャ ────────────────────────────────
const plans: Plans = {
  p1: { name: '数学 中間', type: 'test', due: '2026-08-12', subj: '数学', range: 'x', timetablePeriod: null, timetableDate: null },
  p2: { name: '英語 予習', type: 'prep', due: '2026-08-10', subj: '英語', range: 'y', timetablePeriod: null, timetableDate: null },
  // 期限切れの計画。再配分の対象にならない（plan.due > TODAY を満たさない）
  p3: { name: '済んだ計画', type: 'test', due: '2026-08-04', subj: '理科', range: 'z', timetablePeriod: null, timetableDate: null },
};

const segs: Seg[] = [
  { id: 'a1', plan: 'p1', title: 'A1', size: 'M', min: 20, day: '2026-08-04', done: false },
  { id: 'a2', plan: 'p1', title: 'A2', size: 'M', min: 20, day: '2026-08-06', done: false, manualDay: true },
  { id: 'a3', plan: 'p1', title: 'A3', size: 'L', min: 30, day: '', done: false },
  { id: 'a4', plan: 'p1', title: 'A4', size: 'S', min: 10, day: '2026-08-07', done: true },
  { id: 'b1', plan: 'p2', title: 'B1', size: 'M', min: 20, day: '2026-08-05', done: false },
  { id: 'b2', plan: 'p2', title: 'B2', size: 'M', min: 20, day: '2026-08-09', done: false },
  { id: 'b3', plan: 'p2', title: 'B3', size: 'L', min: 30, day: '2026-08-06', done: false },
  { id: 'c1', plan: 'p3', title: 'C1', size: 'M', min: 20, day: '2026-08-03', done: false },
];

const extras: Extra[] = [
  { id: 'x1', title: 'X1', subj: '国語', size: 'L', min: 30, day: '2026-08-05', done: false, src: '単発タスク', timetablePeriod: null, timetableDate: null },
  // 未配分の単発タスクは「今日」に寄せて数える
  { id: 'x2', title: 'X2', subj: '国語', size: 'S', min: 10, day: '', done: false, src: '単発タスク', timetablePeriod: null, timetableDate: null },
];

const reviews: Review[] = [
  { id: 'r1', seriesId: 'r1', reviewNo: 1, title: 'R1', subj: '社会', stage: '翌日', last: T, due: T, min: 20, src: '手動追加', timetablePeriod: null, timetableDate: null, added: true, done: false },
  // added でない復習は負荷に入らない
  { id: 'r2', seriesId: 'r2', reviewNo: 1, title: 'R2', subj: '社会', stage: '翌日', last: T, due: T, min: 15, src: '手動追加', timetablePeriod: null, timetableDate: null, added: false, done: false },
];

const baseState: RedistStateSlice = {
  segs,
  extras,
  reviews,
  planOrder: ['p1', 'p2', 'p3'],
  wkMax: 240,
  weMax: 360,
  redistMode: 'even',
  redistPlan: 'all',
  redistIncludeManual: false,
  redistLateDays: 7,
};

const state = (over: Partial<RedistStateSlice> = {}): RedistStateSlice => ({ ...baseState, ...over });

/** 先頭 7 日の負荷を [iso, 分] で取り出す */
const loads7 = (loads: Record<string, number>): [string, number][] =>
  planTimelineDays({}, [], ctx)
    .slice(0, 7)
    .map((d) => [d.iso, loads[d.iso]]);

describe('loadsMap', () => {
  it('seg は配置日、extra は day || 今日、added な review は必ず今日に足す', () => {
    const days = planTimelineDays(plans, segs, ctx);
    const L = loadsMap(days, { segs, extras, reviews }, T);
    expect(days).toHaveLength(13);
    expect(loads7(L)).toEqual([
      // b1(20) + x1(30) + x2(未配分→今日, 10) + r1(added, 20)
      ['2026-08-05', 80],
      // a2(20) + b3(30)
      ['2026-08-06', 50],
      // a4 は完了なので 0
      ['2026-08-07', 0],
      ['2026-08-08', 0],
      ['2026-08-09', 20],
      ['2026-08-10', 0],
      ['2026-08-11', 0],
    ]);
  });

  it('枠外の日（過去日 / 未配分の seg）は無視される', () => {
    const days = planTimelineDays(plans, segs, ctx);
    const L = loadsMap(days, { segs, extras, reviews }, T);
    expect(L['2026-08-04']).toBeUndefined(); // a1 の 20 分はどこにも計上されない
    expect(L['']).toBeUndefined(); // a3（未配分の seg）も同様
  });
});

// ═══════════════════════════════════════════════════════════════
// 未完了カウント（v0.9 の manualDay 揃え）
// ═══════════════════════════════════════════════════════════════

describe('overdueSegs / redistTargetSegs / planOverdueCount', () => {
  it('overdue は「未完了 ∧ day < 今日 ∧ 計画が未来」。未配分（day="")も < 今日として数える', () => {
    expect(overdueSegs(segs, plans, T).map((s) => s.id)).toEqual(['a1', 'a3']);
  });

  it('(v0.9) overdue は manualDay も数える／再配分対象は既定で除外する', () => {
    const fixed: Seg[] = [
      { id: 'm1', plan: 'p1', title: 'M1', size: 'M', min: 20, day: '2026-08-01', done: false, manualDay: true },
    ];
    // ⚠ バッジ側は手動固定でも数える（旧実装は数えていなかった）
    expect(overdueSegs(fixed, plans, T).map((s) => s.id)).toEqual(['m1']);
    // 実際に動かす対象からは外れる（「手動配置も対象」が OFF のとき）
    expect(redistTargetSegs(fixed, plans, T, false)).toEqual([]);
    expect(redistTargetSegs(fixed, plans, T, true).map((s) => s.id)).toEqual(['m1']);
  });

  it('redistTargets は includeManual でだけ manualDay を含める', () => {
    expect(redistTargetSegs(segs, plans, T, false).map((s) => s.id)).toEqual([
      'a1',
      'a3',
      'b1',
      'b2',
      'b3',
    ]);
    expect(redistTargetSegs(segs, plans, T, true).map((s) => s.id)).toEqual([
      'a1',
      'a2',
      'a3',
      'b1',
      'b2',
      'b3',
    ]);
  });

  it('計画行の ⚠ バッジは自分の seg だけを見る（計画の期限は見ない）', () => {
    expect(planOverdueCount(segs.filter((s) => s.plan === 'p1'), T)).toBe(2); // a1, a3
    expect(planOverdueCount(segs.filter((s) => s.plan === 'p2'), T)).toBe(0);
    // 期限切れ計画でも遅れは数える（overdueSegs との母集団の違い）
    expect(planOverdueCount(segs.filter((s) => s.plan === 'p3'), T)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// computePreview
// ═══════════════════════════════════════════════════════════════

/** moves を [segId, 移動先] に落とす */
const mv = (p: { moves: { seg: Seg; toIso: string }[] }): [string, string][] =>
  p.moves.map((m) => [m.seg.id, m.toIso]);

describe('computePreview', () => {
  it('even / all: due 昇順（p2 → p1）に処理し、先の計画の配置が後の room を減らす', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'all', false);
    expect(pv.targets.map((s) => s.id)).toEqual(['a1', 'a3', 'b1', 'b2', 'b3']);
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-05'],
      ['b2', '2026-08-07'],
      ['b3', '2026-08-09'],
      ['a1', '2026-08-05'],
      ['a3', '2026-08-11'],
    ]);
    expect(pv.unplaced).toEqual([]);
    expect(pv.moves.every((m) => m.warn === false)).toBe(true);
    expect(loads7(pv.loads)).toEqual([
      ['2026-08-05', 100],
      ['2026-08-06', 20],
      ['2026-08-07', 20],
      ['2026-08-08', 0],
      ['2026-08-09', 30],
      ['2026-08-10', 0],
      ['2026-08-11', 30],
    ]);
    expect(pv.mode).toBe('even');
    expect(pv.plan).toBe('all');
    expect(pv.includeManual).toBe(false);
    expect(pv.ignoreLimit).toBe(false);
    expect(pv.lateDays).toBe(7);
    expect(pv.lockedOverDays).toEqual([]);
    expect(pv.days).toHaveLength(13);
  });

  it('「手動配置も対象」ON で manualDay の a2 も動く', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'all', true);
    expect(pv.targets.map((s) => s.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-05'],
      ['b2', '2026-08-07'],
      ['b3', '2026-08-09'],
      ['a1', '2026-08-05'],
      ['a2', '2026-08-08'],
      ['a3', '2026-08-11'],
    ]);
    // a2 が 08-06 から外れた分、08-06 の負荷は 0 になる
    expect(loads7(pv.loads)).toEqual([
      ['2026-08-05', 100],
      ['2026-08-06', 0],
      ['2026-08-07', 20],
      ['2026-08-08', 20],
      ['2026-08-09', 30],
      ['2026-08-10', 0],
      ['2026-08-11', 30],
    ]);
  });

  it('early: 空きがある早い日へ前詰め（全部今日に寄る）', () => {
    const pv = computePreview(plans, state(), ctx, 'early', 'all', false);
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-05'],
      ['b2', '2026-08-05'],
      ['b3', '2026-08-05'],
      ['a1', '2026-08-05'],
      ['a3', '2026-08-05'],
    ]);
    expect(pv.loads['2026-08-05']).toBe(180);
  });

  it('evenUnlimited: ignoreLimit で spread=flow。上限超過は warn で示す', () => {
    const pv = computePreview(plans, state(), ctx, 'evenUnlimited', 'all', false);
    expect(pv.ignoreLimit).toBe(true);
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-05'],
      ['b2', '2026-08-07'],
      ['b3', '2026-08-09'],
      ['a1', '2026-08-05'],
      ['a3', '2026-08-11'],
    ]);

    // 上限 60 分だと同じ配置のまま超過し、超えた move にだけ warn:true が立つ
    const tight = computePreview(
      plans,
      state({ wkMax: 60, weMax: 60 }),
      ctx,
      'evenUnlimited',
      'all',
      false,
    );
    expect(tight.moves.map((m) => [m.seg.id, m.toIso, m.warn])).toEqual([
      ['b1', '2026-08-05', true],
      ['b2', '2026-08-07', false],
      ['b3', '2026-08-09', false],
      ['a1', '2026-08-05', true],
      ['a3', '2026-08-11', false],
    ]);
    expect(tight.unplaced).toEqual([]);
  });

  it('late: 期限前 N 日ぶんの候補日だけを使う', () => {
    const pv = computePreview(plans, state({ redistLateDays: 3 }), ctx, 'late', 'all', false);
    expect(pv.lateDays).toBe(3);
    // p2（期限 08-10）の候補は 08-07 / 08-08 / 08-09 の 3 日だけ
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-07'],
      ['b2', '2026-08-08'],
      ['b3', '2026-08-09'],
      ['a1', '2026-08-09'],
      ['a3', '2026-08-11'],
    ]);
  });

  it('lateDays は 1..90 にクランプし、数値にならなければ 7', () => {
    expect(computePreview(plans, state({ redistLateDays: 999 }), ctx, 'late', 'all', false).lateDays).toBe(90);
    expect(computePreview(plans, state({ redistLateDays: 0 }), ctx, 'late', 'all', false).lateDays).toBe(7);
    expect(computePreview(plans, state({ redistLateDays: 'abc' }), ctx, 'late', 'all', false).lateDays).toBe(7);
    expect(computePreview(plans, state({ redistLateDays: '12' }), ctx, 'late', 'all', false).lateDays).toBe(12);
    expect(computePreview(plans, state({ redistLateDays: -3 }), ctx, 'late', 'all', false).lateDays).toBe(1);
  });

  it('単一計画を指定するとその計画の seg だけが対象', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'p2', false);
    expect(pv.plan).toBe('p2');
    expect(pv.targets.map((s) => s.id)).toEqual(['b1', 'b2', 'b3']);
    expect(mv(pv)).toEqual([
      ['b1', '2026-08-05'],
      ['b2', '2026-08-07'],
      ['b3', '2026-08-09'],
    ]);
  });

  it('引数省略時は state の redistMode / redistPlan / redistIncludeManual を使う', () => {
    const pv = computePreview(
      plans,
      state({ redistMode: 'early', redistPlan: 'p1', redistIncludeManual: true }),
      ctx,
    );
    expect([pv.mode, pv.plan, pv.includeManual]).toEqual(['early', 'p1', true]);
    expect(mv(pv)).toEqual([
      ['a1', '2026-08-05'],
      ['a2', '2026-08-05'],
      ['a3', '2026-08-05'],
    ]);
  });

  it('上限に入りきらない分は unplaced（GOAL 当日は候補から外れる）', () => {
    const tightPlans: Plans = {
      t1: { name: 'T1', type: 'test', due: '2026-08-06', subj: '数学', range: '', timetablePeriod: null, timetableDate: null },
    };
    const tightSegs: Seg[] = Array.from({ length: 5 }, (_v, i) => ({
      id: 'u' + i, plan: 't1', title: 'U' + i, size: 'M', min: 20, day: '', done: false,
    }));
    const st = state({ segs: tightSegs, extras: [], reviews: [], planOrder: ['t1'], wkMax: 60, weMax: 60 });

    const pv = computePreview(tightPlans, st, ctx, 'even', 'all', false);
    // 候補日は今日 1 日だけ（GOAL の 08-06 は除外）、上限 60 分 → 3 件で満杯
    expect(mv(pv)).toEqual([
      ['u0', '2026-08-05'],
      ['u1', '2026-08-05'],
      ['u2', '2026-08-05'],
    ]);
    expect(pv.unplaced.map((u) => [u.seg.id, u.reason])).toEqual([
      ['u3', '上限内に入る日がありません'],
      ['u4', '上限内に入る日がありません'],
    ]);

    // 上限無視なら全件入る（超過分は warn）
    const flow = computePreview(tightPlans, st, ctx, 'evenUnlimited', 'all', false);
    expect(flow.unplaced).toEqual([]);
    expect(flow.moves.map((m) => m.warn)).toEqual([false, false, false, true, true]);
  });

  it('対象外の予定だけで上限を超える日は lockedOverDays に出る', () => {
    const pv = computePreview(
      plans,
      state({
        segs: [{ id: 'z1', plan: 'p1', title: 'Z1', size: 'M', min: 20, day: '', done: false }],
        extras: [
          { id: 'xx', title: 'XX', subj: '国語', size: 'L', min: 300, day: T, done: false, src: '', timetablePeriod: null, timetableDate: null },
        ],
        reviews: [],
      }),
      ctx,
      'even',
      'all',
      false,
    );
    expect(pv.lockedOverDays).toEqual([{ iso: '2026-08-05', load: 300, max: 240 }]);
    // 今日は埋まっているので翌日へ送られる
    expect(mv(pv)).toEqual([['z1', '2026-08-06']]);
  });

  it('完了 seg・期限切れ計画の seg・存在しない計画の seg は対象外', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'all', true);
    const ids = pv.targets.map((s) => s.id);
    expect(ids).not.toContain('a4'); // done
    expect(ids).not.toContain('c1'); // plan.due <= TODAY
    const orphan = computePreview(
      plans,
      state({ segs: [{ id: 'o1', plan: 'nope', title: 'O', size: 'M', min: 20, day: '', done: false }] }),
      ctx,
      'even',
      'all',
      false,
    );
    expect(orphan.targets).toEqual([]);
    expect(orphan.moves).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// applyRedist
// ═══════════════════════════════════════════════════════════════

describe('applyRedist', () => {
  it('day だけを書き換え、manualDay は付けない。今日になったものを order へ', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'all', false);
    const res = applyRedist(segs, pv, T);
    expect(res.applied).toBe(true);
    expect(res.segs.map((s) => [s.id, s.day])).toEqual([
      ['a1', '2026-08-05'],
      ['a2', '2026-08-06'], // 対象外なので据え置き
      ['a3', '2026-08-11'],
      ['a4', '2026-08-07'], // 完了なので据え置き
      ['b1', '2026-08-05'],
      ['b2', '2026-08-07'],
      ['b3', '2026-08-09'],
      ['c1', '2026-08-03'],
    ]);
    // 動かした seg に manualDay は付かない（次の再配分でも動かせる）
    expect(res.segs.filter((s) => s.manualDay).map((s) => s.id)).toEqual(['a2']);
    // move 順に「今日へ移った seg」を返す
    expect(res.orderAdditions).toEqual(['b1', 'a1']);
    expect(res.toast).toBe('全体を上限内で再配分しました(5件)');
    // 入力の segs は破壊しない
    expect(segs.find((s) => s.id === 'a1')?.day).toBe('2026-08-04');
  });

  it('moves が 0 件なら applied:false で専用トースト', () => {
    const empty = computePreview(plans, state({ segs: [] }), ctx, 'even', 'all', false);
    const res = applyRedist([], empty, T);
    expect(res.applied).toBe(false);
    expect(res.segs).toEqual([]);
    expect(res.orderAdditions).toEqual([]);
    expect(res.toast).toBe('再配分できる未完了タスクはありません');
  });

  it('トースト文言（対象・上限・未配置件数）', () => {
    const pv = computePreview(plans, state(), ctx, 'even', 'all', false);
    expect(redistToast(pv)).toBe('全体を上限内で再配分しました(5件)');
    expect(redistToast({ ...pv, plan: 'p1' })).toBe('この計画を上限内で再配分しました(5件)');
    expect(redistToast({ ...pv, ignoreLimit: true })).toBe(
      '全体を上限を無視して均等に再配分しました(5件)',
    );
    expect(
      redistToast({ ...pv, unplaced: [{ seg: segs[0], reason: '上限内に入る日がありません' }] }),
    ).toBe('全体を上限内で再配分しました(5件・未配置1件)');
  });
});

// ═══════════════════════════════════════════════════════════════
// 初期配置（計画作成）
// ═══════════════════════════════════════════════════════════════

describe('computeInitialPlacement', () => {
  const newPlans: Plans = {
    n1: { name: 'N', type: 'test', due: '2026-08-12', subj: '数学', range: '', timetablePeriod: null, timetableDate: null },
  };

  it('空の状態: 今日〜GOAL 前日へ even で散らす（GOAL 当日は候補外）', () => {
    const minis = [
      { title: 'm1', size: 'M', min: 20 },
      { title: 'm2', size: 'M', min: 20 },
      { title: 'm3', size: 'L', min: 30 },
      { title: 'm4', size: 'S', min: 10 },
    ] as const;
    const res = computeInitialPlacement({
      plans: newPlans, segs: [], extras: [], reviews: [], limits: LIMITS, ctx,
      start: T, due: '2026-08-12', list: [...minis], minisCount: minis.length,
    });
    expect(res.days.map((d) => d.iso)).toEqual([
      '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
      '2026-08-09', '2026-08-10', '2026-08-11',
    ]);
    expect(res.slots).toEqual([0, 2, 4, 6]);
    expect(res.dayOf).toEqual(['2026-08-05', '2026-08-07', '2026-08-09', '2026-08-11']);
  });

  it('既存の負荷ぶんだけ room が減り、start より前の日は候補にならない', () => {
    const busyPlans: Plans = {
      ...plans,
      n2: { name: 'N2', type: 'prep', due: '2026-08-11', subj: '数学', range: '', timetablePeriod: null, timetableDate: null },
    };
    const res = computeInitialPlacement({
      plans: busyPlans, segs, extras, reviews, limits: LIMITS, ctx,
      start: '2026-08-06', due: '2026-08-11',
      list: [
        { title: 'm1', size: 'M', min: 20 },
        { title: 'm2', size: 'M', min: 20 },
        { title: 'm3', size: 'M', min: 20 },
      ],
      minisCount: 3,
    });
    expect(res.days.map((d) => d.iso)).toEqual([
      '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
    ]);
    expect(res.dayOf).toEqual(['2026-08-06', '2026-08-08', '2026-08-10']);
  });

  it('spec Q11: ミニタスク 0 件の計画のダミー「内容を細分化する」は必ず未配分', () => {
    const res = computeInitialPlacement({
      plans: newPlans, segs: [], extras: [], reviews: [], limits: LIMITS, ctx,
      start: T, due: '2026-08-12',
      // レガシーは list にダミー 1 件を入れるが minis.length は 0 のまま
      list: [{ title: '内容を細分化する', size: 'M', min: 20 }],
      minisCount: 0,
    });
    expect(res.slots).toEqual([]); // scheduleItems を呼ばない
    expect(res.dayOf).toEqual(['']); // → 未配分
    // 候補日自体はちゃんと出ている（呼び忘れであることの裏取り）
    expect(res.days).toHaveLength(7);
  });

  it('start の決定は「GOAL 以下 かつ 今日以降」のときだけ addDay2 を採用', () => {
    expect(resolvePlanStart('2026-08-08', '2026-08-12', T)).toBe('2026-08-08');
    expect(resolvePlanStart('', '2026-08-12', T)).toBe(T);
    expect(resolvePlanStart(null, '2026-08-12', T)).toBe(T);
    expect(resolvePlanStart('2026-08-20', '2026-08-12', T)).toBe(T); // GOAL より後
    expect(resolvePlanStart('2026-08-01', '2026-08-12', T)).toBe(T); // 今日より前
    expect(resolvePlanStart('2026-08-12', '2026-08-12', T)).toBe('2026-08-12'); // GOAL 当日は可
  });
});

// ═══════════════════════════════════════════════════════════════
// 負荷の表示値
// ═══════════════════════════════════════════════════════════════

describe('負荷の表示値', () => {
  it('toH は 6 分刻みで丸めた時間表記', () => {
    expect(toH(0)).toBe('0h');
    expect(toH(30)).toBe('0.5h');
    expect(toH(80)).toBe('1.3h');
    expect(toH(240)).toBe('4h');
  });

  it('タイムラインのバーは 100% 上限、再配分プレビューのバーは最低 4%', () => {
    expect(loadBarPct(120, 240)).toBe('50%');
    expect(loadBarPct(300, 240)).toBe('100%');
    expect(loadBarPct(0, 240)).toBe('0%');
    expect(redistLoadBarPct(0, 240)).toBe('4%');
    expect(redistLoadBarPct(5, 240)).toBe('4%');
    expect(redistLoadBarPct(120, 240)).toBe('50%');
    expect(redistLoadBarPct(300, 240)).toBe('100%');
  });

  it('spec Q5: todayLoadPct は doneMin を無視する（三項演算の両枝が totalMin）', () => {
    // 完了ぶんが何分あっても totalMin / wkMax のまま
    expect(todayLoadPct(120, 0, 240)).toBe('50%');
    expect(todayLoadPct(120, 120, 240)).toBe('50%');
    expect(todayLoadPct(120, 60, 240)).toBe('50%');
    // 100% で頭打ち
    expect(todayLoadPct(600, 0, 240)).toBe('100%');
    expect(todayLoadPct(0, 0, 240)).toBe('0%');
    // 四捨五入
    expect(todayLoadPct(100, 0, 240)).toBe('42%');
  });
});

// ═══════════════════════════════════════════════════════════════
// activePlanIds / orderedPlanIds（HTML:2729-2735）
// ═══════════════════════════════════════════════════════════════

describe('activePlanIds / orderedPlanIds', () => {
  const P: Plans = {
    a: { name: 'A', type: 'test', due: '2026-08-12', subj: '数学', range: '', timetablePeriod: null, timetableDate: null },
    b: { name: 'B', type: 'prep', due: '2026-08-01', subj: '英語', range: '', timetablePeriod: null, timetableDate: null },
    c: { name: 'C', type: 'test', due: '2026-08-01', subj: '理科', range: '', timetablePeriod: null, timetableDate: null },
    d: { name: 'D', type: 'test', due: '2026-08-01', subj: '社会', range: '', timetablePeriod: null, timetableDate: null },
  };
  const sg = (id: string, plan: string, done: boolean): Seg => ({
    id, plan, title: id, size: 'M', min: 20, day: '2026-08-01', done,
  });
  // b: 期限切れ + 全完了 → 落ちる / c: 期限切れだが未完了あり → 残る / d: 期限切れだがミニ0件 → 残る
  const SEGS: Seg[] = [sg('a1', 'a', false), sg('b1', 'b', true), sg('c1', 'c', true), sg('c2', 'c', false)];

  it('期限切れかつ全ミニタスク完了の計画だけを落とす', () => {
    expect(activePlanIds(SEGS, P, T)).toEqual(['a', 'c', 'd']);
  });

  it('ミニタスク 0 件の期限切れ計画は残る', () => {
    expect(activePlanIds(SEGS, P, T)).toContain('d');
  });

  it('planOrder の順を先頭に、未収録は Object.keys 順で後ろへ', () => {
    expect(orderedPlanIds({ segs: SEGS, planOrder: ['d', 'c'] }, P, T)).toEqual(['d', 'c', 'a']);
  });

  it('planOrder の未知 ID と落ちた計画は捨てる', () => {
    expect(orderedPlanIds({ segs: SEGS, planOrder: ['zzz', 'b', 'c'] }, P, T)).toEqual(['c', 'a', 'd']);
  });

  it('planOrder が配列でなければ Object.keys 順', () => {
    const bad = { segs: SEGS, planOrder: null as unknown as string[] };
    expect(orderedPlanIds(bad, P, T)).toEqual(['a', 'c', 'd']);
  });
});
