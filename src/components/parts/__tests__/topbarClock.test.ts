import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatLocalClock,
  millisecondsUntilLocalMidnight,
  nextLocalMidnight,
  readTopbarClock,
} from '../topbarClockLogic';

describe('topbarClock', () => {
  it('formats local time with stable two-digit fields', () => {
    const date = new Date(2026, 7, 29, 3, 4, 5, 678);
    expect(formatLocalClock(date)).toBe('03:04:05');
  });

  it('calculates the next local midnight from the runtime timezone', () => {
    const date = new Date(2026, 7, 29, 23, 59, 59, 500);
    const next = nextLocalMidnight(date);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(30);
    expect(next.getHours()).toBe(0);
    expect(millisecondsUntilLocalMidnight(date)).toBe(500);
  });

  it('rounds countdown seconds up at the boundary', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(1)).toBe('00:00:01');
    expect(formatCountdown(3_600_001)).toBe('01:00:01');
    expect(formatCountdown(86_399_999)).toBe('24:00:00');
  });

  it('returns a coherent snapshot for the rendered clock', () => {
    const date = new Date(2026, 7, 29, 12, 34, 56, 250);
    const snapshot = readTopbarClock(date);
    expect(snapshot.now).toBe(date);
    expect(snapshot.current).toBe('12:34:56');
    expect(snapshot.untilMidnight).toBe('11:25:04');
  });
});
