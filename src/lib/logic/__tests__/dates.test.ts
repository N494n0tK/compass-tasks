import { describe, expect, it } from 'vitest';

import {
  buildDIDX,
  buildDays,
  createDateContext,
  dateContextFor,
  dayLabel,
  daysUntil,
  dowOf,
  fmtD,
  fmtMD,
  type DateContext,
  isSameMonth,
  isWeekend,
  isoAt,
  isoShift,
  longDayLabel,
  mondayOf,
  monthLabel,
  monthOf,
  scheduleDateOf,
  todayISO,
  weekEndOf,
  weekRangeOf,
  weekStartOf,
} from '../dates';

/**
 * 基準日 2026-08-05（水）。DAYS は 08-05..08-17 の 13 日分。
 * 2026 年は閏年ではない / 2024・2000 年は閏年、という組み合わせで境界を踏む。
 */
const T = '2026-08-05';
const ctx = dateContextFor(T);

describe('isoShift', () => {
  it('shifts by 0 / ±1 day', () => {
    expect(isoShift(T, 0)).toBe('2026-08-05');
    expect(isoShift(T, 1)).toBe('2026-08-06');
    expect(isoShift(T, -1)).toBe('2026-08-04');
  });

  it('crosses month boundaries in both directions', () => {
    expect(isoShift('2026-01-31', 1)).toBe('2026-02-01');
    expect(isoShift('2026-02-01', -1)).toBe('2026-01-31');
    expect(isoShift('2026-04-30', 1)).toBe('2026-05-01');
    expect(isoShift('2026-05-01', -1)).toBe('2026-04-30');
    // 31日 + 31日 は「翌月同日」ではない（2026-02 は 28 日まで）
    expect(isoShift('2026-01-31', 31)).toBe('2026-03-03');
  });

  it('crosses year boundaries in both directions', () => {
    expect(isoShift('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoShift('2027-01-01', -1)).toBe('2026-12-31');
    expect(isoShift('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoShift('2026-12-31', 366)).toBe('2028-01-01');
    expect(isoShift('2026-08-05', -366)).toBe('2025-08-04');
  });

  it('handles leap / non-leap February', () => {
    expect(isoShift('2026-02-28', 1)).toBe('2026-03-01'); // 平年
    expect(isoShift('2024-02-28', 1)).toBe('2024-02-29'); // 閏年
    expect(isoShift('2024-02-29', 1)).toBe('2024-03-01');
    expect(isoShift('2024-03-01', -1)).toBe('2024-02-29');
    expect(isoShift('2023-03-01', -1)).toBe('2023-02-28');
    expect(isoShift('2000-02-28', 1)).toBe('2000-02-29'); // 400 で割り切れる年は閏年
    expect(isoShift('1900-02-28', 1)).toBe('1900-03-01'); // 100 で割り切れる年は平年
  });

  it('is not affected by the host timezone (UTC arithmetic)', () => {
    // DST の切り替わり週でも 1 日は必ず 86400000ms（ローカル演算なら 23h/25h でズレる）
    expect(isoShift('2026-03-08', 1)).toBe('2026-03-09'); // US DST 開始
    expect(isoShift('2026-11-01', 1)).toBe('2026-11-02'); // US DST 終了
    expect(isoShift('2026-03-29', 1)).toBe('2026-03-30'); // EU DST 開始
  });
});

describe('todayISO', () => {
  it('uses Asia/Tokyo (UTC+9) to decide "today"', () => {
    // 15:00Z = 翌日 00:00 JST
    expect(todayISO(new Date('2026-08-05T14:30:00Z'))).toBe('2026-08-05');
    expect(todayISO(new Date('2026-08-05T15:30:00Z'))).toBe('2026-08-06');
  });

  it('returns a zero-padded YYYY-MM-DD', () => {
    expect(todayISO(new Date('2026-01-02T03:00:00Z'))).toBe('2026-01-02');
    expect(todayISO(new Date('2026-12-31T14:59:59Z'))).toBe('2026-12-31');
    expect(todayISO(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
});

describe('fmtMD / dowOf / isWeekend', () => {
  it('formats month/day without zero padding', () => {
    expect(fmtMD('2026-08-05')).toBe('8/5');
    expect(fmtMD('2026-12-31')).toBe('12/31');
    expect(fmtMD('2026-01-01')).toBe('1/1');
    expect(fmtMD('2026-10-09')).toBe('10/9');
  });

  it('maps iso to the Japanese weekday', () => {
    expect(dowOf('2026-08-03')).toBe('月');
    expect(dowOf('2026-08-04')).toBe('火');
    expect(dowOf('2026-08-05')).toBe('水');
    expect(dowOf('2026-08-06')).toBe('木');
    expect(dowOf('2026-08-07')).toBe('金');
    expect(dowOf('2026-08-08')).toBe('土');
    expect(dowOf('2026-08-09')).toBe('日');
  });

  it('treats 土/日 as weekend', () => {
    expect(isWeekend('2026-08-07')).toBe(false);
    expect(isWeekend('2026-08-08')).toBe(true);
    expect(isWeekend('2026-08-09')).toBe(true);
    expect(isWeekend('2026-08-10')).toBe(false);
  });
});

describe('buildDays / buildDIDX / DateContext', () => {
  it('builds 13 days starting today', () => {
    expect(ctx.days).toHaveLength(13);
    expect(ctx.days[0].iso).toBe('2026-08-05');
    expect(ctx.days[12].iso).toBe('2026-08-17');
    expect(ctx.today).toBe('2026-08-05');
    expect(ctx.tomorrow).toBe('2026-08-06');
    expect(ctx.yesterday).toBe('2026-08-04');
  });

  it('fills DayInfo exactly like the legacy DAYS entries', () => {
    expect(ctx.days[0]).toEqual({
      iso: '2026-08-05',
      dow: '水',
      label: '5',
      weekend: false,
      idx: 0,
    });
    // label はゼロ埋めしない（'08' ではなく '8'）
    expect(buildDays('2026-09-08', 1)[0].label).toBe('8');
    expect(ctx.days[3]).toEqual({
      iso: '2026-08-08',
      dow: '土',
      label: '8',
      weekend: true,
      idx: 3,
    });
    expect(ctx.days[4].weekend).toBe(true); // 日
  });

  it('spans month boundaries when today is at the end of a month', () => {
    const days = buildDays('2026-12-27', 13);
    expect(days[0].iso).toBe('2026-12-27');
    expect(days[5].iso).toBe('2027-01-01');
    expect(days[12].iso).toBe('2027-01-08');
    expect(days[12].idx).toBe(12);
  });

  it('supports the longer planTimelineDays window with the same shape', () => {
    const days = buildDays(T, 731);
    expect(days).toHaveLength(731);
    expect(days[730].iso).toBe(isoShift(T, 730));
  });

  it('maps iso -> index and returns undefined outside the window', () => {
    const didx = buildDIDX(ctx.days);
    expect(didx['2026-08-05']).toBe(0);
    expect(didx['2026-08-06']).toBe(1);
    expect(didx['2026-08-17']).toBe(12);
    expect(didx['2026-08-18']).toBeUndefined();
    expect(didx['2026-08-04']).toBeUndefined();
  });

  it('isoAt / daysUntil are anchored at today', () => {
    expect(isoAt(ctx, 0)).toBe('2026-08-05');
    expect(isoAt(ctx, 12)).toBe('2026-08-17');
    expect(isoAt(ctx, -1)).toBe('2026-08-04');
    expect(daysUntil(ctx, '2026-08-05')).toBe(0);
    expect(daysUntil(ctx, '2026-08-12')).toBe(7);
    expect(daysUntil(ctx, '2026-08-01')).toBe(-4);
    expect(daysUntil(ctx, '2027-08-05')).toBe(365);
  });
});

describe('createDateContext / rollover', () => {
  /** 2026-08-05(水) 12:00 JST = 03:00Z */
  const NOON = new Date('2026-08-05T03:00:00Z');

  it('starts at the real "today" (Asia/Tokyo)', () => {
    const live = createDateContext(NOON);
    expect(live.today).toBe('2026-08-05');
    expect(live.days).toHaveLength(13);
  });

  it('returns false and touches nothing while the date is unchanged', () => {
    const live = createDateContext(NOON);
    const days = live.days;
    // 23:59:59 JST（= 14:59:59Z）はまだ同じ日
    expect(live.rollover(new Date('2026-08-05T14:59:59Z'))).toBe(false);
    expect(live.today).toBe('2026-08-05');
    expect(live.days).toBe(days); // 派生フィールドも作り直さない
  });

  it('advances every derived field when the date changes', () => {
    const live = createDateContext(NOON);
    // 00:00 JST（= 15:00Z）で翌日
    expect(live.rollover(new Date('2026-08-05T15:00:00Z'))).toBe(true);
    expect(live.today).toBe('2026-08-06');
    expect(live.yesterday).toBe('2026-08-05');
    expect(live.tomorrow).toBe('2026-08-07');
    expect(live.base).toBe(Date.parse('2026-08-06T00:00:00Z'));
    expect(live.days[0].iso).toBe('2026-08-06');
    expect(live.days[0].dow).toBe('木');
    expect(live.days[12].iso).toBe('2026-08-18');
    expect(live.didx['2026-08-06']).toBe(0);
    expect(live.didx['2026-08-05']).toBeUndefined(); // 昨日は窓から外れる
  });

  it('keeps object identity so already-shared references see the new day', () => {
    const live = createDateContext(NOON);
    // アプリ側は `DateContext` として配って回る（props / import 済みの参照）
    const shared: DateContext = live;
    expect(dayLabel(shared, '2026-08-05')).toBe('今日');
    expect(live.rollover(new Date('2026-08-05T15:00:00Z'))).toBe(true);
    expect(shared).toBe(live);
    expect(shared.today).toBe('2026-08-06');
    expect(dayLabel(shared, '2026-08-05')).toBe('8/5(期限切れ)');
    expect(dayLabel(shared, '2026-08-06')).toBe('今日');
    expect(daysUntil(shared, '2026-08-13')).toBe(7);
  });

  it('jumps more than one day at a time (tab left open over a weekend)', () => {
    const live = createDateContext(NOON);
    expect(live.rollover(new Date('2026-08-09T03:00:00Z'))).toBe(true);
    expect(live.today).toBe('2026-08-09');
    expect(live.rollover(new Date('2026-08-09T03:00:01Z'))).toBe(false);
  });
});

describe('dayLabel', () => {
  it('returns 未配分 for empty / nullish days', () => {
    expect(dayLabel(ctx, '')).toBe('未配分');
    expect(dayLabel(ctx, null)).toBe('未配分');
    expect(dayLabel(ctx, undefined)).toBe('未配分');
  });

  it('returns 今日 / 明日 for the first two DIDX entries', () => {
    expect(dayLabel(ctx, '2026-08-05')).toBe('今日');
    expect(dayLabel(ctx, '2026-08-06')).toBe('明日');
  });

  it('returns M/D(曜) inside the 13-day window', () => {
    expect(dayLabel(ctx, '2026-08-07')).toBe('8/7(金)');
    expect(dayLabel(ctx, '2026-08-08')).toBe('8/8(土)');
    expect(dayLabel(ctx, '2026-08-09')).toBe('8/9(日)');
    expect(dayLabel(ctx, '2026-08-17')).toBe('8/17(月)');
  });

  it('returns bare M/D past the window and 期限切れ before today', () => {
    expect(dayLabel(ctx, '2026-08-18')).toBe('8/18');
    expect(dayLabel(ctx, '2026-12-31')).toBe('12/31');
    expect(dayLabel(ctx, '2026-08-04')).toBe('8/4(期限切れ)');
    expect(dayLabel(ctx, '2025-12-31')).toBe('12/31(期限切れ)');
  });

  it('crosses the month boundary inside the window', () => {
    const c = dateContextFor('2026-08-25');
    expect(dayLabel(c, '2026-08-25')).toBe('今日');
    expect(dayLabel(c, '2026-08-26')).toBe('明日');
    expect(dayLabel(c, '2026-09-01')).toBe('9/1(火)');
    expect(dayLabel(c, '2026-09-06')).toBe('9/6(日)'); // idx 12（窓の末尾）
    expect(dayLabel(c, '2026-09-07')).toBe('9/7'); // 窓の外
  });
});

describe('fmtD (Review 表専用)', () => {
  it('has its own set of labels', () => {
    expect(fmtD(ctx, '')).toBe('–');
    expect(fmtD(ctx, null)).toBe('–');
    expect(fmtD(ctx, '2026-08-05')).toBe('今日');
    expect(fmtD(ctx, '2026-08-06')).toBe('明日');
    expect(fmtD(ctx, '2026-08-04')).toBe('昨日');
    // dayLabel と違い曜日も (期限切れ) も付かない
    expect(fmtD(ctx, '2026-08-07')).toBe('8/7');
    expect(fmtD(ctx, '2026-08-03')).toBe('8/3');
  });
});

describe('mondayOf / week helpers', () => {
  it('returns the Monday of the week for every weekday', () => {
    // 2026-08-03(月) 〜 2026-08-09(日) はすべて 2026-08-03 に落ちる
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // 月
    expect(mondayOf('2026-08-04')).toBe('2026-08-03'); // 火
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // 水
    expect(mondayOf('2026-08-06')).toBe('2026-08-03'); // 木
    expect(mondayOf('2026-08-07')).toBe('2026-08-03'); // 金
    expect(mondayOf('2026-08-08')).toBe('2026-08-03'); // 土
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // 日 ← 翌週ではなく同じ週の月曜
    expect(mondayOf('2026-08-10')).toBe('2026-08-10'); // 次の月曜
  });

  it('matches the legacy 3 spellings of the same formula', () => {
    for (let i = 0; i < 400; i++) {
      const iso = isoShift('2025-11-20', i);
      const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
      // 消化率 / データ画面: -((dow + 6) % 7)
      const a = isoShift(iso, -((dow + 6) % 7));
      // Add の時間割: dow === 0 ? -6 : 1 - dow
      const b = isoShift(iso, dow === 0 ? -6 : 1 - dow);
      expect(mondayOf(iso)).toBe(a);
      expect(mondayOf(iso)).toBe(b);
    }
  });

  it('crosses month and year boundaries', () => {
    expect(mondayOf('2026-03-01')).toBe('2026-02-23'); // 日 → 前月の月曜
    expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // 木 → 前年の月曜
    expect(mondayOf('2027-01-03')).toBe('2026-12-28'); // 日 → 前年の月曜
  });

  it('weekStartOf is the same function as mondayOf', () => {
    expect(weekStartOf).toBe(mondayOf);
  });

  it('weekEndOf / weekRangeOf give Monday..Sunday', () => {
    expect(weekEndOf('2026-08-05')).toBe('2026-08-09');
    expect(weekEndOf('2026-08-09')).toBe('2026-08-09');
    expect(weekRangeOf('2026-08-05')).toEqual({ start: '2026-08-03', end: '2026-08-09' });
    expect(weekRangeOf('2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });
});

describe('scheduleDateOf (Add 画面の時間割)', () => {
  it('keeps weekdays and snaps 土/日 to that week Monday', () => {
    expect(scheduleDateOf('2026-08-03')).toBe('2026-08-03'); // 月
    expect(scheduleDateOf('2026-08-07')).toBe('2026-08-07'); // 金
    expect(scheduleDateOf('2026-08-08')).toBe('2026-08-03'); // 土 → 月
    expect(scheduleDateOf('2026-08-09')).toBe('2026-08-03'); // 日 → 月（翌日ではない）
  });
});

describe('month helpers', () => {
  it('monthOf / isSameMonth compare the YYYY-MM prefix', () => {
    expect(monthOf('2026-08-05')).toBe('2026-08');
    expect(isSameMonth('2026-08-01', T)).toBe(true);
    expect(isSameMonth('2026-08-31', T)).toBe(true);
    expect(isSameMonth('2026-07-31', T)).toBe(false);
    expect(isSameMonth('2026-09-01', T)).toBe(false);
    expect(isSameMonth('2025-08-05', T)).toBe(false); // 年が違えば別月
  });

  it('monthLabel / longDayLabel format without zero padding', () => {
    expect(monthLabel('2026-08-05')).toBe('8月');
    expect(monthLabel('2026-12-01')).toBe('12月');
    expect(longDayLabel('2026-08-05')).toBe('8月5日(水)');
    expect(longDayLabel('2026-01-01')).toBe('1月1日(木)');
  });
});
