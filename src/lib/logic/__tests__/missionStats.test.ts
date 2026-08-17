import { describe, expect, it } from 'vitest';

import type { Extra, ISODate, Mission } from '../../model/types';
import { dowOf } from '../dates';
import { buildMissionExtra, missionStreak } from '../missionAutogen';
import {
  MISSION_CALENDAR_WEEKS,
  buildMissionCalendar,
  buildMissionStats,
  missionRate,
  type MissionDayState,
} from '../missionStats';

/**
 * 2026-07/08 の曜日:
 *  07-13 月（4週カレンダーの左上）… 08-03 月 / 04 火 / 05 水 / 06 木 / 09 日
 */
const MON = '2026-08-03';
const TUE = '2026-08-04';
const WED = '2026-08-05';
const THU = '2026-08-06';
const SUN = '2026-08-09';
/** `today = WED` のときの 4 週カレンダーの左上 */
const FIRST_MON = '2026-07-13';

/** 曜日番号（`dates.DOW` の添字）。日=0 … 土=6 */
const MON_D = 1;
const WED_D = 3;
const FRI_D = 5;

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: over.id || 'dmx1',
    title: '英単語 DUO 1セクション',
    subj: '英語',
    size: 'S',
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

/** iso → マスの状態（カレンダーを平らにして引く） */
function stateAt(
  m: Mission,
  extras: readonly Extra[],
  today: ISODate,
  iso: ISODate
): MissionDayState | undefined {
  return buildMissionCalendar(m, extras, today)
    .weeks.flat()
    .find((c) => c.iso === iso)?.state;
}

// ─────────────────────────────────────────────────────────────
// 週の並び
// ─────────────────────────────────────────────────────────────

describe('buildMissionCalendar — 週の並び', () => {
  it('4週ぶん・各週7マス。古い週が先頭で、最後の週が今週', () => {
    const cal = buildMissionCalendar(mission(), [], WED);
    expect(cal.weeks).toHaveLength(MISSION_CALENDAR_WEEKS);
    cal.weeks.forEach((week) => expect(week).toHaveLength(7));
    expect(cal.weeks[0][0].iso).toBe(FIRST_MON);
    expect(cal.weeks[3][0].iso).toBe(MON);
    expect(cal.weeks[3][6].iso).toBe(SUN);
    expect(cal.from).toBe(FIRST_MON);
    expect(cal.to).toBe(SUN);
  });

  it('各週は月曜始まり・日曜終わりで、日付が連続している（ヒートマップと同じ流儀）', () => {
    const cal = buildMissionCalendar(mission(), [], WED);
    const flat = cal.weeks.flat();
    expect(flat).toHaveLength(28);
    expect(cal.weeks.map((w) => dowOf(w[0].iso))).toEqual(['月', '月', '月', '月']);
    expect(cal.weeks.map((w) => dowOf(w[6].iso))).toEqual(['日', '日', '日', '日']);
    // 28 マスが 1 日ずつ隙間なく並ぶ
    const ms = flat.map((c) => new Date(c.iso + 'T00:00:00Z').getTime());
    ms.forEach((t, i) => {
      if (i) expect(t - ms[i - 1]).toBe(86400000);
    });
  });

  it('週数は指定できる（最後の週は常に今週）', () => {
    const cal = buildMissionCalendar(mission(), [], WED, 2);
    expect(cal.weeks).toHaveLength(2);
    expect(cal.from).toBe('2026-07-27');
    expect(cal.weeks[1][0].iso).toBe(MON);
  });

  it('週数が 0 や負でも 1 週ぶんは返す（空配列を触らせない）', () => {
    expect(buildMissionCalendar(mission(), [], WED, 0).weeks).toHaveLength(1);
    expect(buildMissionCalendar(mission(), [], WED, -3).weeks).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// マスの状態
// ─────────────────────────────────────────────────────────────

describe('buildMissionCalendar — マスの状態', () => {
  it('完了した日は done', () => {
    const m = mission();
    expect(stateAt(m, [doneOn(m, TUE)], WED, TUE)).toBe('done');
  });

  it('実施日なのに完了していなければ missed', () => {
    const m = mission();
    expect(stateAt(m, [], WED, TUE)).toBe('missed');
  });

  it('未完了の Extra は missed のまま（done だけを見る）', () => {
    const m = mission();
    expect(stateAt(m, [buildMissionExtra(m, TUE)], WED, TUE)).toBe('missed');
  });

  it('dows の外は off', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D], createdAt: FIRST_MON });
    expect(stateAt(m, [], WED, MON)).toBe('missed');
    expect(stateAt(m, [], WED, TUE)).toBe('off');
  });

  it('dows の外でもやってあれば done（曜日をあとから変えても記録を消さない）', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D], createdAt: FIRST_MON });
    expect(stateAt(m, [doneOn(m, TUE)], WED, TUE)).toBe('done');
  });

  it('今日より後は future', () => {
    const m = mission();
    expect(stateAt(m, [], WED, WED)).toBe('missed');
    expect(stateAt(m, [], WED, THU)).toBe('future');
    expect(stateAt(m, [], WED, SUN)).toBe('future');
  });

  it('createdAt より前は before（実施曜日でも「落とした日」にしない）', () => {
    const m = mission({ createdAt: TUE });
    expect(stateAt(m, [], WED, MON)).toBe('before');
    expect(stateAt(m, [], WED, FIRST_MON)).toBe('before');
    expect(stateAt(m, [], WED, TUE)).toBe('missed');
  });

  it('別のミッションの完了履歴は混ざらない', () => {
    const mine = mission({ id: 'dma1' });
    const other = mission({ id: 'dmb2' });
    expect(stateAt(mine, [doneOn(other, TUE)], WED, TUE)).toBe('missed');
  });

  it('ミッション由来でない Extra（単発）は無視する', () => {
    const m = mission();
    const single: Extra = { ...doneOn(m, TUE), id: 'u123' };
    expect(stateAt(m, [single], WED, TUE)).toBe('missed');
  });

  it('ツールチップは「8/4 · 完了」。予定の無い日は日付だけ', () => {
    const m = mission({ createdAt: TUE });
    const flat = buildMissionCalendar(m, [doneOn(m, TUE)], WED).weeks.flat();
    const tipAt = (iso: ISODate) => flat.find((c) => c.iso === iso)?.tip;
    expect(tipAt(TUE)).toBe('8/4 · 完了');
    expect(tipAt(WED)).toBe('8/5 · 未完了');
    expect(tipAt(THU)).toBe('8/6');
    expect(tipAt(MON)).toBe('8/3');
  });
});

// ─────────────────────────────────────────────────────────────
// 達成率
// ─────────────────────────────────────────────────────────────

describe('missionRate', () => {
  it('対象日が 0 なら null（作りたてのミッションは 0% ではない）', () => {
    // 今日できたミッション。今日ぶんは未完了なので母数に入らない
    const m = mission({ createdAt: WED });
    expect(missionRate(m, [], WED)).toBeNull();
  });

  it('今日の未完了は母数に入れない（朝いちばんに達成率が下がらない）', () => {
    const m = mission();
    // 月・火は完了、今日（水）は未完了
    expect(missionRate(m, [doneOn(m, MON), doneOn(m, TUE)], WED)).toBe(100);
  });

  it('今日を完了していればその日も数える', () => {
    const m = mission();
    // 月・火は落とし、今日だけ完了 → 1/3
    expect(missionRate(m, [doneOn(m, WED)], WED)).toBe(33);
    // 3 日とも完了 → 3/3
    expect(missionRate(m, [doneOn(m, MON), doneOn(m, TUE), doneOn(m, WED)], WED)).toBe(100);
  });

  it('落とした日はそのまま母数に残る', () => {
    const m = mission();
    expect(missionRate(m, [doneOn(m, TUE)], WED)).toBe(50);
  });

  it('createdAt より前の日は母数に入らない', () => {
    const m = mission({ createdAt: TUE });
    // 母数は火だけ（月は before・水は今日で未完了）
    expect(missionRate(m, [doneOn(m, TUE)], WED)).toBe(100);
    // 同じ母数 1 日を落とせば 0%。null になるのは母数そのものが無いときだけ
    expect(missionRate(m, [], WED)).toBe(0);
  });

  it('createdAt 当日は母数に入る（境界は「以降」）', () => {
    const m = mission({ createdAt: MON });
    // 母数は月・火。月だけ完了 → 50
    expect(missionRate(m, [doneOn(m, MON)], WED)).toBe(50);
  });

  it('dows の外の日は母数に入らない', () => {
    const m = mission({ dows: [MON_D, WED_D, FRI_D], createdAt: MON });
    // 母数は月だけ（火は off・水は今日で未完了）→ 落としていれば 0%
    expect(missionRate(m, [], WED)).toBe(0);
    expect(missionRate(m, [doneOn(m, MON)], WED)).toBe(100);
  });

  it('4週より前の完了は数えない（窓の外）', () => {
    const m = mission({ createdAt: '2026-06-01' });
    const outside = '2026-07-12'; // FIRST_MON の前日
    expect(stateAt(m, [doneOn(m, outside)], WED, outside)).toBeUndefined();
    // 窓の中は 07-13〜08-04 の 23 日ぶんが母数（今日 08-05 は未完了なので除く）
    expect(missionRate(m, [doneOn(m, outside)], WED)).toBe(0);
  });

  it('四捨五入する（Math.round）', () => {
    const m = mission({ createdAt: MON });
    // 母数 2 日（月・火）のうち 1 日 → 50
    expect(missionRate(m, [doneOn(m, MON)], WED)).toBe(50);
    // 母数 3 日（日曜始まりではないので 07-31 は前の週）… 週をまたいで確認
    const m2 = mission({ createdAt: '2026-08-01' });
    // 08-01(土) 02(日) 03 04 が母数 → 1/4 = 25
    expect(missionRate(m2, [doneOn(m2, MON)], WED)).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────
// 一覧（データ画面が使う形）
// ─────────────────────────────────────────────────────────────

describe('buildMissionStats', () => {
  it('台帳の並び順のまま返し、連続日数と達成率を添える', () => {
    const a = mission({ id: 'dma1', title: '英単語' });
    const b = mission({ id: 'dmb2', title: '計算ドリル' });
    const extras = [doneOn(a, MON), doneOn(a, TUE), doneOn(b, TUE)];
    const rows = buildMissionStats([a, b], extras, WED);

    expect(rows.map((r) => r.mission.id)).toEqual(['dma1', 'dmb2']);
    expect(rows[0].streak).toBe(missionStreak(a, extras, WED));
    expect(rows[0].streak).toBe(2);
    expect(rows[0].rate).toBe(100);
    expect(rows[0].rateLabel).toBe('100%');
    expect(rows[1].rate).toBe(50);
    expect(rows[1].calendar.weeks[3][1].state).toBe('done'); // 火
  });

  it('台帳に無いミッションの完了履歴は出てこない（台帳が基準）', () => {
    const kept = mission({ id: 'dma1' });
    const deleted = mission({ id: 'dmgone' });
    const rows = buildMissionStats([kept], [doneOn(deleted, TUE)], WED);
    expect(rows).toHaveLength(1);
    expect(rows[0].mission.id).toBe('dma1');
    expect(rows[0].calendar.weeks[3][1].state).toBe('missed');
  });

  it('台帳が空なら 0 行（カードごと出さないための判定）', () => {
    expect(buildMissionStats([], [], WED)).toEqual([]);
  });

  it('対象日が 0 のときのラベルは「–」', () => {
    const m = mission({ createdAt: WED });
    const rows = buildMissionStats([m], [], WED);
    expect(rows[0].rate).toBeNull();
    expect(rows[0].rateLabel).toBe('–');
  });

  it('一時停止中（active:false）のミッションも数え続ける', () => {
    const m = mission({ active: false });
    const rows = buildMissionStats([m], [doneOn(m, MON), doneOn(m, TUE)], WED);
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe(100);
  });
});
