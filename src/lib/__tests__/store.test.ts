import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PERSISTENT_KEYS,
  UNDO_KEYS,
  type AppState,
  type Plan,
  type Plans,
  type Seg,
} from '../model/types';
import {
  createInitialState,
  createStore,
  TOAST_MS,
  TOAST_UNDO_DONE,
  TOAST_UNDO_NONE,
  UNDO_RESET_PATCH,
  type CompassStore,
  type CreateStoreOptions,
} from '../store';

/** 基準日は dates.test.ts と揃える */
const T = '2026-08-05';

const opened: CompassStore[] = [];

/** 生成したストアは必ず片付ける（showToast の 2400ms タイマーを残さない） */
function newStore(options?: Partial<CreateStoreOptions>): CompassStore {
  const store = createStore({ today: T, ...options });
  opened.push(store);
  return store;
}

afterEach(() => {
  while (opened.length) opened.pop()?.dispose();
});

function seg(id: string, patch: Partial<Seg> = {}): Seg {
  return {
    id,
    plan: 'p1',
    title: id,
    size: 'M',
    min: 20,
    day: T,
    done: false,
    ...patch,
  };
}

function plan(patch: Partial<Plan> = {}): Plan {
  return {
    name: '数学 テスト対策',
    type: 'test',
    due: '2026-08-12',
    subj: '数学',
    range: '範囲は未設定',
    timetablePeriod: null,
    timetableDate: null,
    ...patch,
  };
}

// ─────────────────────────────────────────────────────────────
// 初期 state（HTML:2063-2087）
// ─────────────────────────────────────────────────────────────

describe('createInitialState', () => {
  it('reproduces the legacy defaults', () => {
    const s = createInitialState(T);
    expect(s.theme).toBe('note');
    expect(s.themeVersion).toBe(3);
    expect(s.view).toBe('cockpit');
    expect(s.navOrder).toEqual(['cockpit', 'tests', 'todo', 'review', 'add', 'data']);
    expect(s.wkMax).toBe(240);
    expect(s.weMax).toBe(360);
    expect(s.panelW).toEqual({ nav: 196, search: 308, editor: 410, review: 380, score: 400 });
    expect(s.addSubj).toBe('数学');
    expect(s.addType).toBe('single');
    expect(s.addSize).toBe('M');
    expect(s.redistLateDays).toBe(7);
    expect(s.focusRemaining).toBe(1500);
    expect(s.focusPreset).toBe(25);
    expect(s.duoEnd).toBe('400');
    expect(s.chartEnd).toBe('4');
    expect(s.dataRange).toBe('all');
    expect(s.cloudStatus).toBe('loading');
    expect(s.cloudUser).toBe('');
  });

  it('fills the four TODAY-derived keys', () => {
    const s = createInitialState(T);
    expect(s.scoreDay).toBe(T);
    expect(s.countdownDate).toBe(T);
    expect(s.addDay).toBe(T);
    expect(s.timetableFocusDate).toBe(T);
  });

  it('takes cloudUser from the caller (the store never touches window)', () => {
    expect(createInitialState(T, 'a@example.com').cloudUser).toBe('a@example.com');
  });

  it('defines every persistent key', () => {
    const s = createInitialState(T) as unknown as Record<string, unknown>;
    for (const key of PERSISTENT_KEYS) expect(key in s).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// setState — 同期反映（SUP:872-877）
// ─────────────────────────────────────────────────────────────

describe('setState', () => {
  it('applies synchronously (read-after-write)', () => {
    const store = newStore();
    store.setState({ query: 'abc' });
    expect(store.getState().query).toBe('abc');
    store.setState({ view: 'todo' });
    expect(store.getState().view).toBe('todo');
  });

  it('passes the freshly written state to the next updater', () => {
    const store = newStore();
    store.setState({ order: ['a'] });
    store.setState((s) => ({ order: s.order.concat(['b']) }));
    expect(store.getState().order).toEqual(['a', 'b']);
  });

  it('keeps untouched field references identical', () => {
    const store = newStore();
    const segsBefore = store.getState().segs;
    store.setState({ query: 'x' });
    expect(store.getState().segs).toBe(segsBefore);
    expect(store.getState()).not.toBe(segsBefore);
  });

  it('treats a null updater as "no content change" but still ticks (addToOrder, HTML:2602-2604)', () => {
    const store = newStore();
    const addToOrder = (id: string) =>
      store.setState((s) => (s.order.indexOf(id) >= 0 ? null : { order: s.order.concat([id]) }));

    addToOrder('u1');
    const stateAfterFirst = store.getState();
    const orderAfterFirst = stateAfterFirst.order;
    const listener = vi.fn();
    store.subscribe(listener);

    addToOrder('u1'); // 重複 → updater が null

    expect(store.getState().order).toEqual(['u1']);
    expect(store.getState().order).toBe(orderAfterFirst); // 中身も参照も無変更
    expect(store.getState()).not.toBe(stateAfterFirst); // state オブジェクトは作り直される
    expect(listener).toHaveBeenCalledTimes(1); // レガシーもここで再レンダーする
  });

  it('runs the callback after the state is visible', () => {
    const store = newStore();
    let seen = '';
    store.setState({ query: 'done' }, () => {
      seen = store.getState().query;
    });
    expect(seen).toBe('done');
  });
});

// ─────────────────────────────────────────────────────────────
// plans（旧 this.PLANS, HTML:2011）
// ─────────────────────────────────────────────────────────────

describe('setPlans / update', () => {
  it('adds and deletes plans without touching the state object', () => {
    const store = newStore();
    const stateBefore = store.getState();

    store.setPlans((p) => ({ ...p, p1: plan() }));
    expect(store.getPlans().p1.name).toBe('数学 テスト対策');
    expect(store.getState()).toBe(stateBefore); // plans だけの更新は state を作り直さない

    store.setPlans((p) => {
      const next = { ...p };
      delete next.p1;
      return next;
    });
    expect(store.getPlans()).toEqual({});
  });

  it('treats a null plans updater as no-op', () => {
    const store = newStore({ plans: { p1: plan() } });
    const before = store.getPlans();
    store.setPlans(() => null);
    expect(store.getPlans()).toBe(before);
  });

  it('copies the plans passed to the constructor (legacy Object.assign({}, payload.plans))', () => {
    const source: Plans = { p1: plan() };
    const store = newStore({ plans: source });
    expect(store.getPlans()).not.toBe(source);
    expect(store.getPlans()).toEqual(source);
  });

  it('updates state and plans in a single notification', () => {
    const store = newStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ state: { segs: [seg('s1')] }, plans: { p1: plan() } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().segs).toHaveLength(1);
    expect(store.getPlans().p1).toBeTruthy();
  });

  it('does nothing when neither key is given', () => {
    const store = newStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({});
    expect(listener).not.toHaveBeenCalled();
    expect(store.getVersion()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// subscribe / getSnapshot（useSyncExternalStore 互換）
// ─────────────────────────────────────────────────────────────

describe('subscribe', () => {
  it('notifies on every mutation, with the new value already readable', () => {
    const store = newStore();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().query));

    store.setState({ query: 'a' });
    store.setState({ query: 'b' });
    store.setPlans({ p1: plan() });

    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('stops notifying after unsubscribe', () => {
    const store = newStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ query: 'a' });
    unsubscribe();
    store.setState({ query: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple listeners and unsubscribing during a notification', () => {
    const store = newStore();
    const second = vi.fn();
    const unsubSecond = store.subscribe(second);
    const unsubFirst = store.subscribe(() => {
      unsubSecond();
    });
    store.setState({ query: 'a' });
    expect(second).toHaveBeenCalledTimes(1); // 通知中の解除でも今回分は届く
    store.setState({ query: 'b' });
    expect(second).toHaveBeenCalledTimes(1);
    unsubFirst();
  });
});

describe('getSnapshot', () => {
  it('is referentially stable between mutations (React caching requirement)', () => {
    const store = newStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    store.setState({ query: 'x' });
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(store.getSnapshot()).toBe(second);
  });

  it('exposes state / plans / version consistently', () => {
    const store = newStore();
    expect(store.getSnapshot().version).toBe(0);
    store.setState({ query: 'x' });
    store.setPlans({ p1: plan() });
    const snap = store.getSnapshot();
    expect(snap.state).toBe(store.getState());
    expect(snap.plans).toBe(store.getPlans());
    expect(snap.version).toBe(2);
    expect(store.getVersion()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// exportData / serialize（HTML:2284-2288, spec §4.2 / §4.14）
// ─────────────────────────────────────────────────────────────

describe('exportData', () => {
  it('emits version / plans / state in that order', () => {
    const store = newStore();
    expect(Object.keys(store.exportData())).toEqual(['version', 'plans', 'state']);
    expect(store.exportData().version).toBe(1);
  });

  it('emits every state key in PERSISTENT_KEYS order', () => {
    const store = newStore();
    expect(Object.keys(store.exportData().state)).toEqual([...PERSISTENT_KEYS]);
  });

  /**
   * レガシーの 23 キーは**先頭 23 個のまま**でなければならない。
   * 途中に差し込むと保存トリガの JSON 文字列が変わって無駄な PUT が飛ぶ（spec §4.14）。
   * 追加キーは必ず末尾に足すこと（docs/notebook/spec.md §11-2）。
   */
  it('keeps the legacy 23 keys as an untouched prefix (additions are append-only)', () => {
    expect(PERSISTENT_KEYS.slice(0, 23)).toEqual([
      'theme',
      'themeVersion',
      'view',
      'navOrder',
      'planOrder',
      'wkMax',
      'weMax',
      'selId',
      'panelW',
      'studyLog',
      'scores',
      'countdowns',
      'addSubj',
      'addType',
      'addSize',
      'recentSubjs',
      'dayOverrides',
      'timetableFocusDate',
      'planQuota',
      'segs',
      'extras',
      'reviews',
      'order',
    ]);
    expect(PERSISTENT_KEYS.slice(23)).toEqual([
      'prepAutoGen',
      'prepGenLog',
      'missions',
      'missionGenLog',
    ]);
  });

  it('keeps the key order stable regardless of how the state was built', () => {
    // 逆順に組み立てた state を流し込んでも、直列化のキー順は PERSISTENT_KEYS のまま
    const scrambled: Partial<AppState> = {};
    for (const key of [...PERSISTENT_KEYS].reverse()) {
      const source = createInitialState(T) as unknown as Record<string, unknown>;
      (scrambled as Record<string, unknown>)[key] = source[key];
    }
    const scrambledStore = newStore({ state: scrambled });
    const plainStore = newStore();

    expect(Object.keys(scrambledStore.exportData().state)).toEqual([...PERSISTENT_KEYS]);
    expect(scrambledStore.serialize()).toBe(plainStore.serialize());
  });

  it('keeps the key order stable after mutations', () => {
    const store = newStore();
    store.setState({ theme: 'light', segs: [seg('s1')], order: ['s1'] });
    store.setPlans({ p1: plan() });
    store.setState({ query: 'ignored', selId: 's1' });
    expect(Object.keys(store.exportData().state)).toEqual([...PERSISTENT_KEYS]);
  });

  it('excludes every ephemeral key', () => {
    const store = newStore();
    store.setState({ query: 'q', toast: 'hello', dragId: 'x', cloudStatus: 'saving' });
    const exported = store.exportData().state as unknown as Record<string, unknown>;
    expect('query' in exported).toBe(false);
    expect('toast' in exported).toBe(false);
    expect('dragId' in exported).toBe(false);
    expect('cloudStatus' in exported).toBe(false);
  });

  it('shallow-copies plans (HTML:2287 Object.assign({}, this.PLANS))', () => {
    const store = newStore({ plans: { p1: plan() } });
    const exported = store.exportData();
    expect(exported.plans).not.toBe(store.getPlans());
    expect(exported.plans).toEqual(store.getPlans());
    expect(exported.plans.p1).toBe(store.getPlans().p1);
  });

  it('serialize() === JSON.stringify(exportData())', () => {
    const store = newStore({ plans: { p1: plan() } });
    store.setState({ segs: [seg('s1')], order: ['s1'] });
    expect(store.serialize()).toBe(JSON.stringify(store.exportData()));
  });

  it('produces an identical string for ephemeral-only changes (save trigger parity)', () => {
    const store = newStore();
    const before = store.serialize();
    store.setState({ query: 'typing…', dragId: 'u1', toast: 'x' });
    expect(store.serialize()).toBe(before);
    store.setState({ wkMax: 270 });
    expect(store.serialize()).not.toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// Undo（HTML:2167-2196, 2410-2416）
// ─────────────────────────────────────────────────────────────

describe('undo', () => {
  it('undoPayload contains plans + the undo keys in order', () => {
    const store = newStore({ plans: { p1: plan() } });
    const payload = store.undoPayload();
    expect(Object.keys(payload)).toEqual(['plans', 'state']);
    expect(Object.keys(payload.state)).toEqual([...UNDO_KEYS]);
    // レガシーの 14 キー + 自動生成の台帳・ログ（extras と一緒に巻き戻す必要がある）
    expect(UNDO_KEYS).toHaveLength(17);
    expect(UNDO_KEYS.slice(14)).toEqual([
      'prepGenLog',
      'missions',
      'missionGenLog',
    ]);
    expect(payload.plans).toBe(store.getPlans()); // レガシー同様、直列化専用の参照渡し
  });

  it('has nothing to undo before any checkpoint', () => {
    const store = newStore({ autoCommit: false });
    expect(store.canUndo()).toBe(false);
    const result = store.undoLastAction();
    expect(result).toEqual({ ok: false, toast: TOAST_UNDO_NONE });
    expect(store.getState().toast).toBe(TOAST_UNDO_NONE);
  });

  it('does not treat the very first commit as an undoable change (baseline)', () => {
    const store = newStore({ autoCommit: false });
    store.setState({ segs: [seg('s1')] });
    store.commit(); // _lastUndoJson == null → ベースラインを埋めるだけ（HTML:2412）
    expect(store.canUndo()).toBe(false);
  });

  it('snapshots the previous committed state and restores it', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    store.setState({ segs: [seg('s1')], order: ['s1'] });
    store.commit();
    expect(store.canUndo()).toBe(true);

    const result = store.undoLastAction();
    expect(result).toEqual({ ok: true, toast: TOAST_UNDO_DONE });
    expect(store.getState().segs).toEqual([]);
    expect(store.getState().order).toEqual([]);
    expect(store.getState().toast).toBe(TOAST_UNDO_DONE);
  });

  it('restores PLANS as well (HTML:2183)', () => {
    const store = newStore({ autoCommit: false, plans: { p1: plan() } });
    store.resetUndoBaseline();

    store.update({ plans: { p1: plan(), p2: plan({ name: '英語 単語' }) }, state: { planOrder: ['p1', 'p2'] } });
    store.commit();

    store.undoLastAction();
    expect(Object.keys(store.getPlans())).toEqual(['p1']);
    expect(store.getState().planOrder).toEqual([]);
  });

  it('coalesces every mutation of one synchronous batch into a single checkpoint', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    // 1つのハンドラ相当（レガシーは React のバッチで componentDidUpdate が1回）
    store.setState({ segs: [seg('s1')] });
    store.setState((s) => ({ order: s.order.concat(['s1']) }));
    store.setState({ selId: 's1' });
    store.commit();

    store.undoLastAction();
    expect(store.getState().segs).toEqual([]);
    expect(store.getState().order).toEqual([]);
  });

  it('walks back only one step (the checkpoint before the last one)', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    store.setState({ segs: [seg('s1')] });
    store.commit();
    store.setState((s) => ({ segs: s.segs.concat([seg('s2')]) }));
    store.commit();

    store.undoLastAction();
    expect(store.getState().segs.map((x) => x.id)).toEqual(['s1']);
  });

  it('ignores changes that touch no undo key', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    store.setState({ query: 'x', view: 'todo', theme: 'light', selId: 'u1' });
    store.commit();

    expect(store.canUndo()).toBe(false);
  });

  it('restores deep copies, not references into the live state', () => {
    const store = newStore({ autoCommit: false });
    store.setState({ segs: [seg('s1')] });
    store.resetUndoBaseline();
    const segsAtBaseline = store.getState().segs;

    store.setState({ segs: [seg('s1'), seg('s2')] });
    store.commit();
    store.undoLastAction();

    const restored = store.getState().segs;
    expect(restored).toEqual(segsAtBaseline);
    expect(restored).not.toBe(segsAtBaseline); // JSON.parse 由来のコピー（HTML:2414）
    expect(restored[0]).not.toBe(segsAtBaseline[0]);
  });

  it('applies the 22 UI reset keys on top of the snapshot (HTML:2185-2190)', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    store.setState({
      segs: [seg('s1')],
      selId: 's1',
      editorPlan: 'p1',
      revSel: 'r1',
      redistOpen: true,
      focusRunning: true,
      dragId: 's1',
      tooltip: { x: 1, y: 2, title: 't', sub: 's' },
    });
    store.commit();
    store.undoLastAction();

    const after = store.getState() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(UNDO_RESET_PATCH)) {
      expect(after[key]).toBe(value);
    }
    expect(Object.keys(UNDO_RESET_PATCH)).toHaveLength(22);
  });

  it('does not restore persistent keys outside UNDO_KEYS', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();

    store.setState({ theme: 'light', view: 'data', segs: [seg('s1')] });
    store.commit();
    store.undoLastAction();

    expect(store.getState().theme).toBe('light'); // theme / view は undoKeys に無い
    expect(store.getState().view).toBe('data');
    expect(store.getState().segs).toEqual([]);
  });

  it('cannot be undone twice (no redo)', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();
    store.setState({ segs: [seg('s1')] });
    store.commit();

    expect(store.undoLastAction().ok).toBe(true);
    store.commit(); // undo 自身の変化はチェックポイントにならない（_undoApplying, HTML:2415）
    expect(store.canUndo()).toBe(false);
    expect(store.undoLastAction()).toEqual({ ok: false, toast: TOAST_UNDO_NONE });
    expect(store.getState().segs).toEqual([]); // 巻き戻り済みのまま
  });

  it('resetUndoBaseline drops the pending snapshot (HTML:2173-2176)', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();
    store.setState({ segs: [seg('s1')] });
    store.commit();
    expect(store.canUndo()).toBe(true);

    store.resetUndoBaseline();
    expect(store.canUndo()).toBe(false);
    expect(store.getUndoSnapshot()).toBeNull();
  });

  it('commit() is idempotent', () => {
    const store = newStore({ autoCommit: false });
    store.resetUndoBaseline();
    store.setState({ wkMax: 270 });
    store.commit();
    const snapshot = store.getUndoSnapshot();
    store.commit();
    store.commit();
    expect(store.getUndoSnapshot()).toBe(snapshot);
  });

  it('auto-commits on a microtask so plain (non-React) callers still get undo', async () => {
    const store = newStore();
    store.resetUndoBaseline();

    store.setState({ segs: [seg('s1')] });
    store.setState((s) => ({ order: s.order.concat(['s1']) }));
    expect(store.canUndo()).toBe(false); // 同期コード中はまだ確定しない

    await Promise.resolve();

    expect(store.canUndo()).toBe(true);
    store.undoLastAction();
    expect(store.getState().segs).toEqual([]);
    expect(store.getState().order).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// showToast（HTML:2481-2485）
// ─────────────────────────────────────────────────────────────

describe('showToast', () => {
  it('sets the message and clears it after 2400ms', () => {
    vi.useFakeTimers();
    try {
      const store = newStore({ autoCommit: false });
      store.showToast('保存しました');
      expect(store.getState().toast).toBe('保存しました');

      vi.advanceTimersByTime(TOAST_MS - 1);
      expect(store.getState().toast).toBe('保存しました');

      vi.advanceTimersByTime(1);
      expect(store.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts the timer for a second toast', () => {
    vi.useFakeTimers();
    try {
      const store = newStore({ autoCommit: false });
      store.showToast('one');
      vi.advanceTimersByTime(2000);
      store.showToast('two');
      vi.advanceTimersByTime(2000);
      expect(store.getState().toast).toBe('two'); // 前のタイマーは潰されている
      vi.advanceTimersByTime(400);
      expect(store.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
