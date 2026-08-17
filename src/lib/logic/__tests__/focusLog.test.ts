import { describe, expect, it } from 'vitest';

import type { FocusLogEntry } from '../../model/types';
import { FOCUS_MIN_MINUTES, buildFocusEntry, focusMinutesOf, focusTotals } from '../focusLog';

/** 2026-08-03(月) 〜 08-09(日) が「今週」。08-05 は水曜 */
const MON = '2026-08-03';
const WED = '2026-08-05';
const SUN = '2026-08-09';

// ─────────────────────────────────────────────────────────────
// 経過分
// ─────────────────────────────────────────────────────────────

describe('focusMinutesOf', () => {
  it('秒を分へ切り捨てる', () => {
    expect(focusMinutesOf(0)).toBe(0);
    expect(focusMinutesOf(59)).toBe(0);
    expect(focusMinutesOf(60)).toBe(1);
    expect(focusMinutesOf(119)).toBe(1);
    expect(focusMinutesOf(1500)).toBe(25);
  });

  it('プリセットを最後まで走らせるとプリセットぶんちょうど（15/25/45分）', () => {
    [15, 25, 45].forEach((min) => expect(focusMinutesOf(min * 60)).toBe(min));
  });

  it('負値・NaN は 0（タイマーの刻みが壊れても記録は増やさない）', () => {
    expect(focusMinutesOf(-10)).toBe(0);
    expect(focusMinutesOf(Number.NaN)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 記録可否
// ─────────────────────────────────────────────────────────────

describe('buildFocusEntry', () => {
  it('1分以上なら記録する', () => {
    expect(buildFocusEntry(WED, '数学', 60)).toEqual({ day: WED, subj: '数学', min: 1 });
    expect(buildFocusEntry(WED, '数学', 1500)).toEqual({ day: WED, subj: '数学', min: 25 });
  });

  it('1分に満たないセッションは記録しない（開いてすぐ閉じた・押し間違え）', () => {
    expect(buildFocusEntry(WED, '数学', 0)).toBeNull();
    expect(buildFocusEntry(WED, '数学', 59)).toBeNull();
    expect(FOCUS_MIN_MINUTES).toBe(1);
  });

  it('集中対象が無い（教科が決まらない）なら記録しない', () => {
    expect(buildFocusEntry(WED, '', 1500)).toBeNull();
    expect(buildFocusEntry(WED, '   ', 1500)).toBeNull();
  });

  it('教科は前後の空白を落として持つ', () => {
    expect(buildFocusEntry(WED, ' 英語 ', 600)?.subj).toBe('英語');
  });

  it('日付は渡されたものをそのまま持つ（タイムスタンプは持たない）', () => {
    const entry = buildFocusEntry(MON, '数学', 900);
    expect(entry).toEqual({ day: MON, subj: '数学', min: 15 });
    expect(Object.keys(entry as FocusLogEntry)).toEqual(['day', 'subj', 'min']);
  });

  it('一時停止をはさんだ 2 区間は足し算で合う（1 区間 = 1 件）', () => {
    // 25分プリセットを 10 分で止めて、再開して 15 分走らせた場合
    const a = buildFocusEntry(WED, '数学', 600);
    const b = buildFocusEntry(WED, '数学', 900);
    expect((a?.min || 0) + (b?.min || 0)).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────
// 合計
// ─────────────────────────────────────────────────────────────

describe('focusTotals', () => {
  const log: FocusLogEntry[] = [
    { day: '2026-07-31', subj: '数学', min: 45 }, // 先週
    { day: MON, subj: '数学', min: 25 },
    { day: WED, subj: '英語', min: 15 },
    { day: SUN, subj: '英語', min: 10 }, // 今週の日曜（データ画面の「今週」は月〜日）
  ];

  it('今週は月曜〜日曜の枠で数える', () => {
    expect(focusTotals(log, WED).week).toBe(50);
  });

  it('全期間は全部足す', () => {
    expect(focusTotals(log, WED).all).toBe(95);
  });

  it('件数はセッション数（記録の件数）', () => {
    expect(focusTotals(log, WED).count).toBe(4);
  });

  it('空なら 0', () => {
    expect(focusTotals([], WED)).toEqual({ week: 0, all: 0, count: 0 });
  });

  it('週が変われば今週の合計も変わる', () => {
    expect(focusTotals(log, '2026-07-31').week).toBe(45);
  });

  it('壊れた min は 0 として扱う（保存データを信用しない）', () => {
    const broken = [
      { day: WED, subj: '数学', min: 'x' },
      { day: WED, subj: '数学', min: 20 },
    ] as unknown as FocusLogEntry[];
    expect(focusTotals(broken, WED)).toEqual({ week: 20, all: 20, count: 2 });
  });

  it('日付の無い記録は今週に数えないが全期間には入る', () => {
    const noDay = [{ day: '', subj: '数学', min: 30 }] as unknown as FocusLogEntry[];
    expect(focusTotals(noDay, WED)).toEqual({ week: 0, all: 30, count: 1 });
  });
});
