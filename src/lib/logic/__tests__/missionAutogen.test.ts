import { describe, expect, it } from 'vitest';

import type { Extra, ISODate, Mission, MissionGenLog, SizeKey } from '../../model/types';
import {
  MISSION_ALL_SUBJ,
  MISSION_SRC,
  WEAK_MISSION_PRESET,
  buildMissionExtra,
  generateMissionTasks,
  isMissionDay,
  isWeakMission,
  missionExtraId,
  missionRefOf,
  missionStreak,
  missionStreaks,
  missionSubjFilter,
  newMissionId,
  pruneMissionGenLog,
} from '../missionAutogen';

/**
 * 2026-08 の曜日:
 *  03 月 / 04 火 / 05 水 / 06 木 / 07 金 / 08 土 / 09 日 / 10 月
 */
const MON = '2026-08-03';
const TUE = '2026-08-04';
const WED = '2026-08-05';
const THU = '2026-08-06';
const FRI = '2026-08-07';
const SAT = '2026-08-08';

/** 曜日番号（`dates.DOW` の添字）。日=0 … 土=6 */
const SUN_D = 0;
const MON_D = 1;
const WED_D = 3;
const FRI_D = 5;

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: over.id || 'dmx1',
    title: '英単語 DUO 1セクション',
    subj: '英語',
    size: 'S' as SizeKey,
    dows: [],
    active: true,
    createdAt: MON,
    ...over,
  };
}

/** その日ぶんを消化した状態の Extra */
function doneOn(m: Mission, day: ISODate): Extra {
  return { ...buildMissionExtra(m, day), done: true };
}

// ─────────────────────────────────────────────────────────────
// id の文字列規約
// ─────────────────────────────────────────────────────────────

describe('id の文字列規約（dm-{missionId}-{YYYYMMDD}）', () => {
  it('ミッションと日付から組み立て、同じ形で読み戻せる', () => {
    const id = missionExtraId('dmx3k2', '2026-08-17');
    expect(id).toBe('dm-dmx3k2-20260817');
    expect(missionRefOf(id)).toEqual({ missionId: 'dmx3k2', day: '2026-08-17' });
  });

  it('ミッション由来でない id は null（単発タスクや復習と混ざらない）', () => {
    expect(missionRefOf('umf3k21')).toBeNull();
    expect(missionRefOf('nb-nabc-c0')).toBeNull();
    expect(missionRefOf('dm-dmx1-2026-08-17')).toBeNull();
    expect(missionRefOf('')).toBeNull();
    expect(missionRefOf(null)).toBeNull();
  });

  it('newMissionId は dm で始まり、読み戻せる id を作る', () => {
    const id = newMissionId();
    expect(id.slice(0, 2)).toBe('dm');
    expect(missionRefOf(missionExtraId(id, THU))).toEqual({ missionId: id, day: THU });
  });
});

// ─────────────────────────────────────────────────────────────
// 実施日の判定
// ─────────────────────────────────────────────────────────────

describe('isMissionDay', () => {
  it('dows が空なら毎日', () => {
    const m = mission({ dows: [] });
    expect(isMissionDay(m, MON)).toBe(true);
    expect(isMissionDay(m, SAT)).toBe(true);
  });

  it('dows に入っている曜日だけ', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D] });
    expect(isMissionDay(m, MON)).toBe(true);
    expect(isMissionDay(m, TUE)).toBe(false);
    expect(isMissionDay(m, WED)).toBe(true);
    expect(isMissionDay(m, FRI)).toBe(true);
    expect(isMissionDay(m, SAT)).toBe(false);
  });

  it('日曜は 0 で指定する', () => {
    expect(isMissionDay(mission({ dows: [SUN_D] }), '2026-08-09')).toBe(true);
    expect(isMissionDay(mission({ dows: [SUN_D] }), SAT)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 生成
// ─────────────────────────────────────────────────────────────

describe('generateMissionTasks — 生成', () => {
  it('今日ぶんの Extra を 1 件作り、ログに記録する', () => {
    const m = mission();
    const res = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    expect(res.extras).toHaveLength(1);
    const [e] = res.extras;
    expect(e.id).toBe('dm-dmx1-20260806');
    expect(e.title).toBe('英単語 DUO 1セクション');
    expect(e.subj).toBe('英語');
    expect(e.day).toBe(THU);
    expect(e.size).toBe('S');
    expect(e.min).toBe(10);
    expect(e.done).toBe(false);
    expect(e.src).toBe(MISSION_SRC);
    expect(e.timetablePeriod).toBeNull();
    expect(e.timetableDate).toBeNull();
    expect(res.genLog[THU]).toEqual(['dmx1']);
    expect(res.message).toBe('1件のデイリーミッションを追加しました');
  });

  it('サイズから分数が決まる（XS=5 / S=10 / M=20 / L=30）', () => {
    const sizes: SizeKey[] = ['XS', 'S', 'M', 'L'];
    const res = generateMissionTasks({
      today: THU,
      missions: sizes.map((size, i) => mission({ id: 'dm' + i, size })),
      genLog: {},
    });
    expect(res.extras.map((e) => e.min)).toEqual([5, 10, 20, 30]);
  });

  it('登録が 0 件なら何も作らない', () => {
    const res = generateMissionTasks({ today: THU, missions: [], genLog: {} });
    expect(res.extras).toEqual([]);
    expect(res.message).toBeNull();
  });
});

describe('generateMissionTasks — 曜日と一時停止', () => {
  it('今日が dows に無ければ作らない', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D] });
    expect(generateMissionTasks({ today: THU, missions: [m], genLog: {} }).extras).toEqual([]);
    expect(
      generateMissionTasks({ today: FRI, missions: [m], genLog: {} }).extras
    ).toHaveLength(1);
  });

  it('実施日でない日はログにも載らない（その曜日が来たら作られる）', () => {
    const m = mission({ dows: [FRI_D] });
    const off = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    expect(off.genLog[THU]).toBeUndefined();
    const on = generateMissionTasks({ today: FRI, missions: [m], genLog: off.genLog });
    expect(on.extras).toHaveLength(1);
  });

  it('active:false は作らない（台帳には残る）', () => {
    const m = mission({ active: false });
    const res = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    expect(res.extras).toEqual([]);
    expect(res.genLog[THU]).toBeUndefined();
  });
});

describe('generateMissionTasks — 重複防止（ログのみで判定）', () => {
  it('同じ日に 2 度走らせても増えない（リロードで重複しない）', () => {
    const m = mission();
    const first = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    const second = generateMissionTasks({ today: THU, missions: [m], genLog: first.genLog });
    expect(second.extras).toEqual([]);
    expect(second.message).toBeNull();
    expect(second.genLog).toEqual(first.genLog);
  });

  it('生成後にユーザーが消しても同じ日には作り直さない（extras は見ない）', () => {
    const m = mission();
    const first = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    // extras を全部捨てた状態（= ユーザーが今日のミッションを削除した）で再実行
    expect(generateMissionTasks({ today: THU, missions: [m], genLog: first.genLog }).extras).toEqual(
      []
    );
  });

  it('日が変われば作られる', () => {
    const m = mission();
    const first = generateMissionTasks({ today: THU, missions: [m], genLog: {} });
    const next = generateMissionTasks({ today: FRI, missions: [m], genLog: first.genLog });
    expect(next.extras).toHaveLength(1);
    expect(next.extras[0].id).toBe('dm-dmx1-20260807');
    expect(next.genLog[THU]).toEqual(['dmx1']);
    expect(next.genLog[FRI]).toEqual(['dmx1']);
  });

  it('一部だけ記録済みなら残りだけ作る', () => {
    const a = mission({ id: 'dma', title: 'A' });
    const b = mission({ id: 'dmb', title: 'B' });
    const res = generateMissionTasks({
      today: THU,
      missions: [a, b],
      genLog: { [THU]: ['dma'] },
    });
    expect(res.extras.map((e) => e.title)).toEqual(['B']);
    expect(res.genLog[THU]).toEqual(['dma', 'dmb']);
  });
});

// ─────────────────────────────────────────────────────────────
// 弱点ドリル（plan.md §4.1）
// ─────────────────────────────────────────────────────────────

describe('弱点ドリルのミッション', () => {
  /** プリセットどおりに登録した台帳 1 件（AddTask の「弱点問題を3問」と同じ形） */
  const weak = mission({
    id: 'dmw1',
    title: WEAK_MISSION_PRESET.title,
    subj: MISSION_ALL_SUBJ,
    size: WEAK_MISSION_PRESET.size,
    kind: WEAK_MISSION_PRESET.kind,
  });

  it('kind は台帳だけが持つ。生成 Extra は普通のタスクのまま', () => {
    const res = generateMissionTasks({ today: THU, missions: [weak], genLog: {} });
    expect(res.extras).toHaveLength(1);
    const [e] = res.extras;
    // Extra には kind を持たせない（台帳を id から引き直す＝`missionRefOf` の規約どおり）
    expect('kind' in e).toBe(false);
    expect(e.id).toBe('dm-dmw1-20260806');
    expect(e.title).toBe('弱点問題を3問');
    expect(e.subj).toBe(MISSION_ALL_SUBJ);
    expect(e.min).toBe(10);
    expect(missionRefOf(e.id)?.missionId).toBe('dmw1');
  });

  it('kind の無い既存ミッションは普通の毎日タスクのまま', () => {
    expect(isWeakMission(weak)).toBe(true);
    expect(isWeakMission(mission())).toBe(false);
    expect(isWeakMission(null)).toBe(false);
  });

  it('全教科なら絞り込まない。教科を書いていればその教科だけ', () => {
    expect(missionSubjFilter(weak)).toBeNull();
    expect(missionSubjFilter({ subj: '' })).toBeNull();
    expect(missionSubjFilter({ subj: ' 数学 ' })).toBe('数学');
  });
});

describe('pruneMissionGenLog', () => {
  it('14 日より古いキーが落ちる', () => {
    const genLog: MissionGenLog = {
      '2026-07-22': ['dmx1'], // 15 日前 → 落ちる
      '2026-07-23': ['dmx1'], // 14 日前 → 残る
      [THU]: ['dmx1'],
    };
    expect(Object.keys(pruneMissionGenLog(genLog, THU)).sort()).toEqual(['2026-07-23', THU]);
  });

  it('変化が無ければ同じ参照を返す', () => {
    const genLog: MissionGenLog = { [THU]: ['dmx1'] };
    expect(pruneMissionGenLog(genLog, THU)).toBe(genLog);
  });

  it('生成が 0 件でも prune 済みのログを返す', () => {
    const m = mission();
    const res = generateMissionTasks({
      today: THU,
      missions: [m],
      genLog: { '2020-01-01': ['old'], [THU]: ['dmx1'] },
    });
    expect(res.extras).toEqual([]);
    expect(Object.keys(res.genLog)).toEqual([THU]);
  });
});

// ─────────────────────────────────────────────────────────────
// 連続日数
// ─────────────────────────────────────────────────────────────

describe('missionStreak', () => {
  it('今日まで続いていれば今日ぶんも数える', () => {
    const m = mission();
    const extras = [doneOn(m, TUE), doneOn(m, WED), doneOn(m, THU)];
    expect(missionStreak(m, extras, THU)).toBe(3);
  });

  it('今日ぶんが未完了でも昨日まで続いていれば途切れない', () => {
    const m = mission();
    const extras = [doneOn(m, TUE), doneOn(m, WED), buildMissionExtra(m, THU)];
    expect(missionStreak(m, extras, THU)).toBe(2);
  });

  it('今日も昨日も未完了なら 0', () => {
    const m = mission();
    const extras = [doneOn(m, MON), doneOn(m, TUE), buildMissionExtra(m, THU)];
    expect(missionStreak(m, extras, THU)).toBe(0);
  });

  it('記録が 1 件も無ければ 0', () => {
    const m = mission();
    expect(missionStreak(m, [], THU)).toBe(0);
    expect(missionStreak(m, [buildMissionExtra(m, THU)], THU)).toBe(0);
  });

  it('未完了の日を挟むと途切れる', () => {
    const m = mission();
    // 月 ○ / 火 ×（やらなかった）/ 水 ○ / 木 ○
    const extras = [doneOn(m, MON), doneOn(m, WED), doneOn(m, THU)];
    expect(missionStreak(m, extras, THU)).toBe(2);
  });

  it('月水金のミッションは火木土日を挟んでも連続とみなす', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D] });
    const extras = [doneOn(m, MON), doneOn(m, WED), doneOn(m, FRI)];
    expect(missionStreak(m, extras, FRI)).toBe(3);
    // 土曜（非実施日）から見ても、金曜までの連続はそのまま
    expect(missionStreak(m, extras, SAT)).toBe(3);
  });

  it('実施日を 1 回飛ばすとそこで切れる', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D] });
    // 月 ○ / 水 ×（実施日なのにやらなかった）/ 金 ○
    const extras = [doneOn(m, MON), doneOn(m, FRI)];
    expect(missionStreak(m, extras, FRI)).toBe(1);
  });

  it('ほかのミッションや単発タスクの完了は混ざらない', () => {
    const a = mission({ id: 'dma' });
    const b = mission({ id: 'dmb' });
    const single: Extra = {
      id: 'umf3k21',
      title: '単発',
      subj: '数学',
      size: 'S',
      min: 10,
      day: THU,
      done: true,
      src: '単発タスク',
      timetablePeriod: null,
      timetableDate: null,
    };
    const extras = [doneOn(a, WED), doneOn(a, THU), doneOn(b, THU), single];
    expect(missionStreak(a, extras, THU)).toBe(2);
    expect(missionStreak(b, extras, THU)).toBe(1);
  });

  it('missionStreaks はまとめて引ける（未登録は 0）', () => {
    const a = mission({ id: 'dma' });
    const b = mission({ id: 'dmb' });
    const extras = [doneOn(a, WED), doneOn(a, THU)];
    expect(missionStreaks([a, b], extras, THU)).toEqual({ dma: 2, dmb: 0 });
  });
});
