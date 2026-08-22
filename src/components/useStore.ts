'use client';

/**
 * Compass — React ↔ `lib/store` の接続層（Phase 2B / TASK S0）
 *
 * `useSyncExternalStore` の薄いラッパ。レガシーの `this.state` / `this.PLANS` は
 * `src/lib/store.ts` の単一ストアに移してあるので、ここはそれを React に流し込むだけ。
 *
 * - `store`      … アプリ全体で 1 つのインスタンス（レガシーのコンポーネント 1 個に対応）
 * - `dateCtx`    … `this.TODAY` / `this.DAYS` / `this.DIDX`（HTML:1996-2010）。
 *                  モジュールロード時に作り、**日付が変わったら `dateCtx.rollover()` で
 *                  中身だけ進める**（オブジェクトの同一性は保つので、この参照を import して
 *                  いる側は何もしなくてよい）。進める判断は `CompassApp` が持つ。
 * - `useAppStore()`    … `{state, plans, version}` のスナップショット
 * - `useAppSelector(f)` … 部分購読（スナップショット同一性でメモ化）
 *
 * React 以外（firebase / DOM）は import しない。
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { createDateContext, type LiveDateContext } from '../lib/logic/dates';
import type { AppState, Plans } from '../lib/model/types';
import { createStore, type CompassStore, type StoreSnapshot } from '../lib/store';

/**
 * `this._base` / `this.TODAY` / `this.DAYS` / `this.DIDX`（HTML:1996-2010）。
 * **参照は不変・中身は `rollover()` で進む**。コンポーネント本体で毎レンダー読むぶんには
 * 常に最新だが、`useMemo` に閉じ込めるときは `dateCtx.today` を依存配列に入れること。
 */
export const dateCtx: LiveDateContext = createDateContext();

/** アプリ唯一のストア。`CompassApp` 以外からも import してよい（レガシーの `this` に相当） */
export const store: CompassStore = createStore({ today: dateCtx.today });

/** `store.getSnapshot()` を購読する。state か plans が変わるたびに再レンダーされる */
export function useAppStore(): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** `state` だけが欲しいとき */
export function useAppState(): AppState {
  return useAppStore().state;
}

/** `plans`（旧 `this.PLANS`）だけが欲しいとき */
export function useAppPlans(): Plans {
  return useAppStore().plans;
}

/**
 * 部分購読。`select` はスナップショットが変わったときだけ再評価される
 * （`getSnapshot` は同じ入力に対して同じ参照を返す必要があるため、結果をキャッシュする）。
 *
 * `select` が毎回新しいオブジェクトを作る場合でも無限ループにはならないが、
 * スナップショットが変わるたびに再レンダーされる点はスナップショット購読と同じ。
 */
export function useAppSelector<T>(select: (snapshot: StoreSnapshot) => T): T {
  const cache = useRef<{ snap: StoreSnapshot; sel: (s: StoreSnapshot) => T; value: T } | null>(null);
  const getSelection = useCallback(() => {
    const snap = store.getSnapshot();
    const hit = cache.current;
    if (hit && hit.snap === snap && hit.sel === select) return hit.value;
    const value = select(snap);
    cache.current = { snap, sel: select, value };
    return value;
  }, [select]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
