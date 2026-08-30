import { describe, expect, it } from 'vitest';

import { dataPatch } from '../dataPatch';
import type { Plan, Plans, Review, Seg } from '../model/types';

/** 基準日は他のテストと揃える */
const T = '2026-08-05';

const plan = (over: Partial<Plan> = {}): Plan => ({
  name: '数学 テスト',
  type: 'test',
  due: '2026-08-20',
  subj: '数学',
  range: '範囲は未設定',
  timetablePeriod: null,
  timetableDate: null,
  ...over,
});

const seg = (over: Partial<Seg> = {}): Seg => ({
  id: 's1',
  plan: 'p1',
  title: 'ミニ',
  size: 'M',
  min: 20,
  day: '2026-08-10',
  done: false,
  ...over,
});

const review = (over: Partial<Review> = {}): Review => ({
  id: 'r1',
  seriesId: 'r1',
  reviewNo: 1,
  title: '英単語',
  subj: '英語',
  stage: '翌日',
  last: '2026-08-01',
  due: '2026-08-02',
  min: 10,
  src: '手動追加',
  timetablePeriod: null,
  timetableDate: null,
  added: false,
  done: false,
  ...over,
});

const run = (raw: unknown, plans: Plans = {}) => dataPatch(raw, { plans, today: T });

describe('dataPatch — 入口（C-494〜C-496）', () => {
  it('null / 非オブジェクトは空 patch', () => {
    expect(run(null)).toEqual({ state: {}, repaired: false });
    expect(run(undefined)).toEqual({ state: {}, repaired: false });
    expect(run('nope')).toEqual({ state: {}, repaired: false });
    expect(run(42)).toEqual({ state: {}, repaired: false });
  });

  it('{data:{…}} ラッパーも素の {version,plans,state} も受ける（C-494）', () => {
    const inner = { version: 1, plans: {}, state: { wkMax: 300 } };
    expect(run({ data: inner }).state.wkMax).toBe(300);
    expect(run(inner).state.wkMax).toBe(300);
  });

  it('plans はオブジェクトのときだけ差し替え、配列・欠落なら undefined（C-495）', () => {
    expect(run({ plans: { p1: plan() }, state: {} }).plans).toEqual({ p1: plan() });
    expect(run({ plans: [], state: {} }).plans).toBeUndefined();
    expect(run({ state: {} }).plans).toBeUndefined();
  });

  it('persistentKeys 以外は落とし、undefined のキーは入れない（C-496）', () => {
    const patch = run({ state: { wkMax: 300, bogus: 1, selId: undefined } }).state;
    expect(patch.wkMax).toBe(300);
    expect('bogus' in patch).toBe(false);
    expect('selId' in patch).toBe(false);
  });
});

describe('dataPatch — M1 テーマ移行', () => {
  it('dark かつ themeVersion !== 3 は note へ', () => {
    expect(run({ state: { theme: 'dark' } }).state.theme).toBe('note');
    expect(run({ state: { theme: 'dark', themeVersion: 2 } }).state.theme).toBe('note');
  });

  it('themeVersion 3 の dark はそのまま', () => {
    expect(run({ state: { theme: 'dark', themeVersion: 3 } }).state.theme).toBe('dark');
  });

  it('themeVersion は常に 3 になる（state が空でも）', () => {
    expect(run({ state: {} }).state.themeVersion).toBe(3);
    expect(run({}).state.themeVersion).toBe(3);
  });

  it('Glass の時刻設定を旧データへ追加せず、そのまま patch する', () => {
    const out = run({
      state: {
        theme: 'glass',
        glassTimeMinutes: 315,
        glassFollowCurrentTime: false,
      },
    });
    expect(out.state.theme).toBe('glass');
    expect(out.state.glassTimeMinutes).toBe(315);
    expect(out.state.glassFollowCurrentTime).toBe(false);
  });

  it('旧データに Glass 設定がなければ新しいキーを捏造しない', () => {
    const out = run({ state: { theme: 'note' } });
    expect('glassTimeMinutes' in out.state).toBe(false);
    expect('glassFollowCurrentTime' in out.state).toBe(false);
  });

  it('不正な Glass 設定は patch から落として初期値を保つ', () => {
    const out = run({
      state: {
        glassTimeMinutes: 2000,
        glassFollowCurrentTime: 'yes',
      },
    });
    expect('glassTimeMinutes' in out.state).toBe(false);
    expect('glassFollowCurrentTime' in out.state).toBe(false);
  });
});

describe('dataPatch — M2 GOAL 当日以降の seg を前日へ（C-497）', () => {
  const plans: Plans = { p1: plan({ due: '2026-08-20' }) };

  it('GOAL 当日の seg は前日へ戻す', () => {
    const out = run({ state: { segs: [seg({ day: '2026-08-20' })] } }, plans);
    expect(out.state.segs?.[0].day).toBe('2026-08-19');
    expect(out.repaired).toBe(false);
  });

  it('GOAL より後の seg も前日へ戻す', () => {
    const out = run({ state: { segs: [seg({ day: '2026-08-25' })] } }, plans);
    expect(out.state.segs?.[0].day).toBe('2026-08-19');
  });

  it('GOAL より前 / 未配分 / 孤児 seg は触らない', () => {
    const segs = [
      seg({ id: 'a', day: '2026-08-19' }),
      seg({ id: 'b', day: '' }),
      seg({ id: 'c', plan: 'missing', day: '2026-09-01' }),
    ];
    const out = run({ state: { segs } }, plans);
    expect(out.state.segs?.map((s) => s.day)).toEqual(['2026-08-19', '', '2026-09-01']);
  });

  it('due が YYYY-MM-DD 形式でない計画は触らない', () => {
    const bad: Plans = { p1: plan({ due: '' }) };
    const out = run({ state: { segs: [seg({ day: '2026-08-25' })] } }, bad);
    expect(out.state.segs?.[0].day).toBe('2026-08-25');
  });

  it('payload.plans の差し替え後の PLANS を見る（HTML:2201 → 2212 の順）', () => {
    const out = run(
      { plans: { p1: plan({ due: '2026-08-10' }) }, state: { segs: [seg({ day: '2026-08-12' })] } },
      { p1: plan({ due: '2026-09-30' }) }
    );
    expect(out.state.segs?.[0].day).toBe('2026-08-09');
  });
});

describe('dataPatch — M3 reviewNo / seriesId 補完（C-498 / C-499）', () => {
  it('reviewNo の無い旧データは stage から起点を決めて連番を振る', () => {
    const raw = {
      state: {
        reviews: [
          review({ id: 'a', seriesId: '', reviewNo: 0, stage: '翌日', last: '2026-08-01', done: true }),
          review({ id: 'b', seriesId: '', reviewNo: 0, stage: '3日後', last: '2026-08-02', done: true }),
          review({ id: 'c', seriesId: '', reviewNo: 0, stage: '1週間後', last: '2026-08-05' }),
        ],
      },
    };
    const out = run(raw);
    expect(out.state.reviews?.map((r) => r.reviewNo)).toEqual([1, 2, 3]);
    // 系列ルートは並べ替え後の先頭 id
    expect(out.state.reviews?.map((r) => r.seriesId)).toEqual(['a', 'a', 'a']);
  });

  it('stage 表から起点を引く（reviewNo が無く stage が 1週間後 なら 3 始まり）', () => {
    const out = run({
      state: { reviews: [review({ id: 'x', seriesId: '', reviewNo: 0, stage: '1週間後' })] },
    });
    expect(out.state.reviews?.[0].reviewNo).toBe(3);
  });

  it('_legacyIndex は残さず、元の配列順も保つ', () => {
    const out = run({
      state: {
        reviews: [
          review({ id: 'b', seriesId: '', reviewNo: 0, last: '2026-08-09', done: true }),
          review({ id: 'a', seriesId: '', reviewNo: 0, last: '2026-08-01', done: true }),
        ],
      },
    });
    expect(out.state.reviews?.map((r) => r.id)).toEqual(['b', 'a']);
    expect(out.state.reviews?.every((r) => !('_legacyIndex' in r))).toBe(true);
  });

  it('seriesId が 2 件以上ある系列は保存済み reviewNo を尊重する', () => {
    const out = run({
      state: {
        reviews: [
          review({ id: 'a', seriesId: 's', reviewNo: 4, last: '2026-08-01', done: true }),
          review({ id: 'b', seriesId: 's', reviewNo: 5, last: '2026-08-02' }),
        ],
      },
    });
    expect(out.state.reviews?.map((r) => r.reviewNo)).toEqual([4, 5]);
  });
});

describe('dataPatch — M4 未完了より先の回を削除（C-500）', () => {
  it('pending より後の回を reviews / order / selId から外し repaired を立てる', () => {
    const out = run({
      state: {
        reviews: [
          review({ id: 'a', seriesId: 's', reviewNo: 1, last: '2026-08-01', done: false }),
          review({ id: 'b', seriesId: 's', reviewNo: 2, last: '2026-08-02', done: false }),
        ],
        order: ['a', 'b'],
        selId: 'b',
      },
    });
    expect(out.state.reviews?.map((r) => r.id)).toEqual(['a']);
    expect(out.state.order).toEqual(['a']);
    expect(out.state.selId).toBeNull();
    expect(out.repaired).toBe(true);
  });

  it('全部完了している系列は削らない', () => {
    const out = run({
      state: {
        reviews: [
          review({ id: 'a', seriesId: 's', reviewNo: 1, last: '2026-08-01', done: true }),
          review({ id: 'b', seriesId: 's', reviewNo: 2, last: '2026-08-02', done: true }),
        ],
      },
    });
    expect(out.state.reviews?.length).toBe(2);
    expect(out.repaired).toBe(false);
  });
});

describe('dataPatch — M5 期限切れ完了済みを ToDo から外す（C-501）', () => {
  it('done && added && due < TODAY を added:false にして order / selId から外す', () => {
    const out = run({
      state: {
        reviews: [review({ id: 'a', done: true, added: true, due: '2026-08-01' })],
        order: ['a', 'zzz'],
        selId: 'a',
      },
    });
    expect(out.state.reviews?.[0].added).toBe(false);
    // 履歴としては残る
    expect(out.state.reviews?.length).toBe(1);
    expect(out.state.order).toEqual(['zzz']);
    expect(out.state.selId).toBeNull();
    expect(out.repaired).toBe(true);
  });

  it('期限が今日以降なら触らない', () => {
    const out = run({
      state: { reviews: [review({ id: 'a', done: true, added: true, due: T })] },
    });
    expect(out.state.reviews?.[0].added).toBe(true);
    expect(out.repaired).toBe(false);
  });
});

describe('dataPatch — 入力を破壊しない', () => {
  it('元の segs / reviews 配列と要素を書き換えない', () => {
    const segs = [seg({ day: '2026-08-25' })];
    const reviews = [review({ id: 'a', seriesId: '', reviewNo: 0 })];
    const raw = { plans: { p1: plan() }, state: { segs, reviews } };
    const snapshot = JSON.stringify(raw);
    run(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});
