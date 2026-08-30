import { describe, expect, it } from 'vitest';

import {
  buildThemeStyle,
  formatGlassTime,
  glassTimePalette,
  localMinuteOfDay,
} from '../ShellTheme';

describe('Glass time palette', () => {
  it('interpolates between day phases and keeps the loop continuous', () => {
    const night = glassTimePalette(0);
    const dawn = glassTimePalette(420);
    const day = glassTimePalette(720);
    const sunset = glassTimePalette(1140);
    const nextNight = glassTimePalette(1440);

    expect(night.base).toBe(nextNight.base);
    expect(night.dawn).toBe(nextNight.dawn);
    expect(dawn.base).not.toBe(night.base);
    expect(day.base).not.toBe(dawn.base);
    expect(sunset.base).not.toBe(day.base);
    expect(night.dawn).toMatch(/^rgba\(/);
  });

  it('normalizes malformed and out-of-range manual values', () => {
    expect(glassTimePalette(Number.NaN)).toEqual(glassTimePalette(720));
    expect(glassTimePalette(-1440)).toEqual(glassTimePalette(0));
    expect(glassTimePalette(2880)).toEqual(glassTimePalette(0));
    expect(formatGlassTime(-1)).toBe('23:59');
    expect(formatGlassTime(1439)).toBe('23:59');
  });

  it('formats local time without storing a date or timezone offset', () => {
    expect(localMinuteOfDay(new Date(2026, 7, 29, 8, 15, 30))).toBe(8 * 60 + 15);
    expect(formatGlassTime(8 * 60 + 15)).toBe('08:15');
  });

  it('injects only Glass-specific variables for the Glass theme', () => {
    const glass = buildThemeStyle('glass', 'cockpit', 420);
    const dark = buildThemeStyle('dark', 'cockpit', 420);

    expect(glass['--glass-time-base']).toBe(glassTimePalette(420).base);
    expect(glass['--glass-time-dawn']).toBe(glassTimePalette(420).dawn);
    expect(dark['--glass-time-base']).toBeUndefined();
  });
});
