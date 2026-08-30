import { describe, expect, it } from 'vitest';

import type { DayOverrides, PrepAutoGenSettings, PrepGenLog } from '../../model/types';
import {
  DEFAULT_PREP_AUTOGEN,
  generatePrepTasks,
  nextSchoolDay,
  prunePrepGenLog,
} from '../prepAutogen';
import { TIMETABLE, timetablePeriodsFor, timetableSubjects } from '../timetable';

/**
 * 2026-08 の曜日:
 *  03 月 / 04 火 / 05 水 / 06 木 / 07 金 / 08 土 / 09 日 / 10 月
 */
const MON = '2026-08-03';
const WED = '2026-08-05';
const THU = '2026-08-06';
const FRI = '2026-08-07';
const SAT = '2026-08-08';
const SUN = '2026-08-09';
const NEXT_MON = '2026-08-10';

const ON: PrepAutoGenSettings = { enabled: true, offSubjects: [] };

function run(over: {
  today: string;
  dayOverrides?: DayOverrides;
  settings?: PrepAutoGenSettings;
  genLog?: PrepGenLog;
}) {
  return generatePrepTasks({
    today: over.today,
    dayOverrides: over.dayOverrides || {},
    settings: over.settings || ON,
    genLog: over.genLog || {},
    newId: (i) => 'p' + i,
  });
}

describe('nextSchoolDay（N-041〜N-043）', () => {
  it('N-041 木曜 → 金曜', () => {
    expect(nextSchoolDay(THU)).toBe(FRI);
  });
  it('N-042 金曜 → 翌月曜', () => {
    expect(nextSchoolDay(FRI)).toBe(NEXT_MON);
  });
  it('N-043 土曜・日曜 → 翌月曜', () => {
    expect(nextSchoolDay(SAT)).toBe(NEXT_MON);
    expect(nextSchoolDay(SUN)).toBe(NEXT_MON);
  });
  it('週の途中は素直に翌日', () => {
    expect(nextSchoolDay(MON)).toBe('2026-08-04');
    expect(nextSchoolDay(WED)).toBe(THU);
  });
});

describe('generatePrepTasks — 基本（N-046 / N-052 / N-053）', () => {
  it('金曜の時間割から、教科ごとに1件ずつ作る', () => {
    // 金: 現国 / 体育 / 地総 / 英コ / 数学 / LHR / (空き)
    const res = run({ today: THU });
    expect(res.targetDate).toBe(FRI);
    expect(res.extras.map((e) => e.subj)).toEqual([
      '現国',
      '体育',
      '地総',
      '英コ',
      '数学',
      'LHR',
    ]);
    expect(res.message).toBe('6件の予習タスクを追加しました(対象: 8/7)');
  });

  it('N-046 同じ教科が2コマある日は1件だけ（最初のコマを持つ）', () => {
    // 水: 数学 / 数学 / 体育 / 言語 / 英コ / 現国 / (空き)
    const res = run({ today: '2026-08-04' }); // 火 → 対象は水
    expect(res.targetDate).toBe(WED);
    const math = res.extras.filter((e) => e.subj === '数学');
    expect(math).toHaveLength(1);
    expect(math[0].timetablePeriod).toBe(1);
    // 芸術が2コマある火曜も同様
    const tue = run({ today: MON });
    expect(tue.extras.filter((e) => e.subj === '芸術')).toHaveLength(1);
  });

  it('N-052 day は今日、timetableDate は対象日', () => {
    const [e] = run({ today: THU }).extras;
    expect(e.day).toBe(THU);
    expect(e.timetableDate).toBe(FRI);
    expect(e.title).toBe('現国の予習');
    expect(e.size).toBe('S');
    expect(e.min).toBe(10);
    expect(e.done).toBe(false);
    expect(e.src).toBe('予習 · 8/7 1限(自動)');
    expect(e.id).toBe('p0');
  });

  it('N-053 空きコマからは生成されない', () => {
    // 金は 7 限が null なので 6 件（7 件ではない）
    expect(run({ today: THU }).extras).toHaveLength(6);
    // 火は 7 コマ埋まっているが芸術が重複するので 6 件
    expect(run({ today: MON }).extras).toHaveLength(6);
  });
});

describe('generatePrepTasks — 上書き（N-044 / N-045）', () => {
  it('N-044 held:false のコマは生成されない', () => {
    const res = run({ today: THU, dayOverrides: { [FRI]: { '2': { held: false } } } });
    expect(res.extras.map((e) => e.subj)).not.toContain('体育');
    expect(res.extras).toHaveLength(5);
  });

  it('N-045 subj の上書きが効く', () => {
    const res = run({ today: THU, dayOverrides: { [FRI]: { '1': { subj: '古典' } } } });
    expect(res.extras[0].subj).toBe('古典');
    expect(res.extras[0].title).toBe('古典の予習');
    expect(res.extras.map((e) => e.subj)).not.toContain('現国');
  });

  it('上書きの前後の空白は落ちる。空文字の上書きは元の教科のまま', () => {
    const res = run({ today: THU, dayOverrides: { [FRI]: { '1': { subj: '  古典  ' } } } });
    expect(res.extras[0].subj).toBe('古典');
    const blank = run({ today: THU, dayOverrides: { [FRI]: { '1': { subj: '   ' } } } });
    expect(blank.extras[0].subj).toBe('現国');
  });

  it('関係ない日の上書きは影響しない', () => {
    const res = run({ today: THU, dayOverrides: { [NEXT_MON]: { '1': { held: false } } } });
    expect(res.extras).toHaveLength(6);
  });
});

describe('generatePrepTasks — 設定と重複防止（N-047〜N-051）', () => {
  it('N-047 offSubjects の教科は生成されない', () => {
    const res = run({
      today: THU,
      settings: { enabled: true, offSubjects: ['体育', 'LHR'] },
    });
    expect(res.extras.map((e) => e.subj)).toEqual(['現国', '地総', '英コ', '数学']);
  });

  it('N-048 genLog に載っているコマは再生成されない（リロードで重複しない）', () => {
    const first = run({ today: THU });
    expect(first.genLog[FRI]).toEqual([1, 2, 3, 4, 5, 6]);
    const second = run({ today: THU, genLog: first.genLog });
    expect(second.extras).toHaveLength(0);
    expect(second.message).toBeNull();
    expect(second.genLog).toEqual(first.genLog);
  });

  it('N-049 生成後にユーザーが消しても同じ日には作り直さない', () => {
    const first = run({ today: THU });
    // extras を全部捨てた状態（= ユーザーが削除した）で再実行
    const second = run({ today: THU, genLog: first.genLog });
    expect(second.extras).toEqual([]);
  });

  it('N-048 一部のコマだけ記録済みなら残りだけ作る', () => {
    const res = run({ today: THU, genLog: { [FRI]: [1, 2] } });
    expect(res.extras.map((e) => e.subj)).toEqual(['地総', '英コ', '数学', 'LHR']);
    expect(res.genLog[FRI]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('N-050 enabled:false なら何もしない（genLog も触らない）', () => {
    const genLog: PrepGenLog = { '2020-01-01': [1] };
    const res = run({ today: THU, settings: { enabled: false, offSubjects: [] }, genLog });
    expect(res.extras).toEqual([]);
    expect(res.message).toBeNull();
    expect(res.genLog).toBe(genLog);
  });

  it('N-051 14 日より古い genLog のキーが落ちる', () => {
    const genLog: PrepGenLog = {
      '2026-07-22': [1], // 15 日前 → 落ちる
      '2026-07-23': [1], // 14 日前 → 残る
      [FRI]: [1],
    };
    const res = run({ today: THU, genLog });
    expect(Object.keys(res.genLog).sort()).toEqual(['2026-07-23', FRI]);
  });

  it('prunePrepGenLog は変化が無ければ同じ参照を返す', () => {
    const genLog: PrepGenLog = { [FRI]: [1] };
    expect(prunePrepGenLog(genLog, THU)).toBe(genLog);
  });

  it('生成が 0 件でも prune 済みの genLog を返す', () => {
    const genLog: PrepGenLog = { '2020-01-01': [1], [FRI]: [1, 2, 3, 4, 5, 6] };
    const res = run({ today: THU, genLog });
    expect(res.extras).toEqual([]);
    expect(Object.keys(res.genLog)).toEqual([FRI]);
  });
});

describe('既定値と時間割ヘルパ', () => {
  it('既定は有効・除外なし', () => {
    expect(DEFAULT_PREP_AUTOGEN).toEqual({ enabled: true, offSubjects: [] });
  });

  it('timetableSubjects は重複なしで教科を集める', () => {
    const subjects = timetableSubjects();
    expect(subjects).toContain('数学');
    expect(subjects).toContain('LHR');
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(subjects).not.toContain(null);
  });

  it('ノートの日付と教科から時限を逆引きし、連続授業もすべて返す', () => {
    expect(timetablePeriodsFor('2026-09-02', '数学')).toEqual([1, 2]);
    expect(timetablePeriodsFor('2026-09-02', '現国')).toEqual([6]);
  });

  it('日別の時間割変更と休講を時限の逆引きにも反映する', () => {
    expect(
      timetablePeriodsFor('2026-09-02', '数学', {
        '2026-09-02': { '1': { held: false }, '3': { subj: '数学', held: true } },
      }),
    ).toEqual([2, 3]);
  });

  it('TIMETABLE はレガシーの値のまま（月〜金 × 7 コマ）', () => {
    expect(Object.keys(TIMETABLE)).toEqual(['月', '火', '水', '木', '金']);
    expect(TIMETABLE['月']).toEqual(['言語', '英コ', '体育', '数学', '歴総', '論表', null]);
    expect(TIMETABLE['金']).toEqual(['現国', '体育', '地総', '英コ', '数学', 'LHR', null]);
  });

  it('空の時間割を渡すと何も生成しない', () => {
    const res = generatePrepTasks({
      today: THU,
      dayOverrides: {},
      settings: ON,
      genLog: {},
      timetable: {},
    });
    expect(res.extras).toEqual([]);
    expect(res.message).toBeNull();
  });
});
