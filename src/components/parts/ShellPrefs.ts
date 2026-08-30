'use client';

/**
 * Compass — localStorage（Phase 2B / TASK S0）
 *
 * 出典: HTML:2100-2116（`componentDidMount` の復元）、2446-2448（`savePrefs`）、
 * 2331 / 2352 / 2404（`compass-ui-data` の書き込み）。spec §4.13 / C-29〜C-33 / C-493。
 *
 * キーは 2 つだけ（`sessionStorage` / `indexedDB` は使わない）。
 * 読み書きはすべて try/catch で握りつぶす（C-33）。
 */

import type { AppState, PanelW, Theme, UiPrefs } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';

/** `savePrefs()` の保存先（HTML:2447） */
export const LS_UI = 'compass-ui';
/** `exportData()` の JSON をそのまま置く（`{data:…}` でラップしない, HTML:2331） */
export const LS_UI_DATA = 'compass-ui-data';

/** `savePrefs()`（HTML:2446-2448）。`themeVersion` は常に 3 を書く */
export function savePrefs(store: CompassStore): void {
  try {
    const s = store.getState();
    const prefs: UiPrefs = {
      theme: s.theme,
      themeVersion: 3,
      panelW: s.panelW,
      glassTimeMinutes: s.glassTimeMinutes,
      glassFollowCurrentTime: s.glassFollowCurrentTime,
    };
    localStorage.setItem(LS_UI, JSON.stringify(prefs));
  } catch {
    /* C-33 */
  }
}

/**
 * `localStorage['compass-ui']` からの復元（HTML:2102-2116 / C-29〜C-31）。
 * 採用条件を満たさない値は**触らない**（呼び出し側が初期値のまま使う）。
 */
export function readPrefsPatch(defaults: PanelW): Partial<AppState> {
  const initial: Partial<AppState> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(LS_UI) || '{}') as Partial<UiPrefs>;
    if (
      saved.theme === 'light' ||
      saved.theme === 'dark' ||
      saved.theme === 'note' ||
      saved.theme === 'glass'
    ) {
      // v0.6.9までの dark はノートテーマだったため、一度だけ note へ移行する。
      initial.theme = (saved.theme === 'dark' && saved.themeVersion !== 3
        ? 'note'
        : saved.theme) as Theme;
      initial.themeVersion = 3;
    }
    if (
      typeof saved.glassTimeMinutes === 'number' &&
      Number.isFinite(saved.glassTimeMinutes) &&
      saved.glassTimeMinutes >= 0 &&
      saved.glassTimeMinutes <= 1439
    ) {
      initial.glassTimeMinutes = Math.round(saved.glassTimeMinutes);
    }
    if (typeof saved.glassFollowCurrentTime === 'boolean') {
      initial.glassFollowCurrentTime = saved.glassFollowCurrentTime;
    }
    if (saved.panelW) {
      const pw: PanelW = { ...defaults };
      (Object.keys(pw) as (keyof PanelW)[]).forEach((k) => {
        const v = saved.panelW?.[k];
        const max = k === 'editor' ? 520 : 2000;
        if (typeof v === 'number' && v >= 120 && v <= max) pw[k] = v;
      });
      initial.panelW = pw;
    }
  } catch {
    /* C-33 */
  }
  return initial;
}

/** `JSON.parse(localStorage.getItem('compass-ui-data') || 'null')`（HTML:2117-2120） */
export function readLocalData(): unknown {
  try {
    return JSON.parse(localStorage.getItem(LS_UI_DATA) || 'null');
  } catch {
    return null;
  }
}

/** `localStorage.setItem('compass-ui-data', json)`（HTML:2331 / 2352 / 2404）。デバウンスしない（C-489） */
export function writeLocalData(json: string): void {
  try {
    localStorage.setItem(LS_UI_DATA, json);
  } catch {
    /* C-33 */
  }
}
