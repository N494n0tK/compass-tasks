import { describe, expect, it } from 'vitest';
import {
  OFFICE_MAX_MINUTES,
  clockText,
  durationFromParts,
  durationParts,
  formatOfficeTime,
  isOfficeIdle,
  officeStatus,
  remainingFromDeadline,
} from '../clawdOfficeLogic';

describe('Clawd Office timer logic', () => {
  it('keeps a custom minute/second duration within the accepted source bounds', () => {
    expect(durationFromParts(25, 35)).toBe(1535);
    expect(durationFromParts(-10, -4)).toBe(5);
    expect(durationFromParts(OFFICE_MAX_MINUTES + 9, 88)).toBe(OFFICE_MAX_MINUTES * 60 + 59);
    expect(durationParts(1535)).toEqual({ minutes: 25, seconds: 35 });
  });

  it('formats the timer like the supplied office reference', () => {
    expect(formatOfficeTime(5)).toBe('00:05');
    expect(formatOfficeTime(25 * 60)).toBe('25:00');
    expect(formatOfficeTime(3601)).toBe('1:00:01');
  });

  it('derives display status without ever owning a second countdown', () => {
    expect(officeStatus(true, false, 'open')).toBe('open');
    expect(officeStatus(true, false, null)).toBe('work');
    expect(officeStatus(false, false, 'close')).toBe('close');
    expect(officeStatus(false, true, 'close')).toBe('close');
    expect(officeStatus(false, true, null)).toBe('done');
    expect(isOfficeIdle(false, false, 1500, 1500)).toBe(true);
    expect(isOfficeIdle(false, false, 1499, 1500)).toBe(false);
    expect(isOfficeIdle(true, false, 1500, 1500)).toBe(false);
  });

  it('wraps the scene clock at midnight', () => {
    expect(clockText(1170)).toBe('19:30');
    expect(clockText(1440)).toBe('00:00');
    expect(clockText(-1)).toBe('23:59');
  });

  it('recovers elapsed time from a deadline after background timer throttling', () => {
    const deadline = 100_000;
    expect(remainingFromDeadline(deadline, 96_100, 10)).toBe(4);
    expect(remainingFromDeadline(deadline, 100_001, 4)).toBe(0);
    // A wall-clock correction must never make the countdown increase.
    expect(remainingFromDeadline(deadline, 95_000, 4)).toBe(4);
    expect(remainingFromDeadline(Number.NaN, 95_000, 4)).toBe(4);
  });
});
