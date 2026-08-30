import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPrefsPatch, savePrefs } from '../ShellPrefs';
import { createStore } from '../../../lib/store';

const TODAY = '2026-08-05';

function installStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

describe('Glass theme preferences', () => {
  it('round-trips optional Glass settings through localStorage', () => {
    const store = createStore({ today: TODAY });
    store.setState({ glassTimeMinutes: 315, glassFollowCurrentTime: false });
    savePrefs(store);

    expect(readPrefsPatch(store.getState().panelW)).toMatchObject({
      glassTimeMinutes: 315,
      glassFollowCurrentTime: false,
    });
    store.dispose();
  });

  it('accepts legacy note and new glass themes without migration', () => {
    localStorage.setItem(
      'compass-ui',
      JSON.stringify({
        theme: 'glass',
        themeVersion: 3,
        panelW: { nav: 196, search: 308, editor: 410, review: 380, score: 400 },
      })
    );
    expect(readPrefsPatch({ nav: 196, search: 308, editor: 410, review: 380, score: 400 }).theme).toBe(
      'glass'
    );
  });

  it('ignores invalid optional values instead of poisoning initial state', () => {
    localStorage.setItem(
      'compass-ui',
      JSON.stringify({
        theme: 'note',
        themeVersion: 3,
        glassTimeMinutes: 9999,
        glassFollowCurrentTime: 'yes',
      })
    );
    const patch = readPrefsPatch({ nav: 196, search: 308, editor: 410, review: 380, score: 400 });
    expect(patch.glassTimeMinutes).toBeUndefined();
    expect(patch.glassFollowCurrentTime).toBeUndefined();
  });
});
