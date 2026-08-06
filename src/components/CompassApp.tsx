'use client';

/**
 * Compass — アプリのルート（Phase 2B / TASK S0）
 *
 * 移植元:
 *  - HTML:786-788（`.compass-theme` / `.compass-theme-mode` / `.compass-shell`）
 *  - HTML:789-860（スプラッシュ）→ `parts/ShellSplash`
 *  - HTML:863-918（ナビ）→ `parts/ShellNav`
 *  - HTML:921-965（`.compass-main` + トップバー + 検索）→ `parts/ShellTopbar`
 *  - HTML:968-1520（6画面）→ `screens/*`
 *  - HTML:1868-1916（アプリスイッチャー / ツールチップ / トースト）
 *  - HTML:2096-2151（`componentDidMount`: prefs 復元・キーボード・`ready()`）
 *  - HTML:2290-2398（クラウド読込 / 保存）→ `parts/ShellPersistence`
 *
 * spec §2.1 / §2.6 / §2.7 / §4.13 / §4.14、architecture §3・§7、css-notes §1・§4・§7。
 *
 * 画面は `state.view` で **1 つだけマウント**する（`sc-if` と同じ。切替でスクロールは先頭へ戻る, C-45/C-46）。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { generatePrepTasks } from '../lib/logic/prepAutogen';
import { overdueSegs } from '../lib/logic/schedule';
import type { AppState, ViewId } from '../lib/model/types';
import {
  createPersistence,
  createSplashGate,
  type CompassPersistence,
  type SplashGate,
} from '../lib/persistence';
import { ReviewAskModal } from './parts/ReviewAskModal';
import { addToOrder } from './parts/ShellActions';
import { ShellAppSwitcher } from './parts/ShellAppSwitcher';
import { ShellNav } from './parts/ShellNav';
import { OverlayHostContext } from './parts/ShellOverlay';
import { SaveController, runDataPatch } from './parts/ShellPersistence';
import { readLocalData, readPrefsPatch, savePrefs as writePrefs } from './parts/ShellPrefs';
import { makeResizer } from './parts/ShellResizer';
import { ShellSplash } from './parts/ShellSplash';
import { useSubjColors } from './parts/ShellSubjects';
import { STATIC_THEME_TOKENS, THEME_ATTR, buildThemeStyle, normalizeNavOrder } from './parts/ShellTheme';
import { ShellToast, ShellTooltip } from './parts/ShellToast';
import { ShellTopbar } from './parts/ShellTopbar';
import { buildTodayItems } from './parts/ShellTodayItems';
import { TestsEditorDrawer } from './parts/TestsEditorDrawer';
import { TodoFocusOverlay } from './parts/TodoFocusOverlay';
import { NotebookController, setNotebookController } from './parts/NotebookPersistence';
import { AddTask } from './screens/AddTask';
import { Cockpit } from './screens/Cockpit';
import { DataScreen } from './screens/DataScreen';
import { Notebook } from './screens/Notebook';
import { Review } from './screens/Review';
import { Tests } from './screens/Tests';
import { Todo } from './screens/Todo';
import { dateCtx, store, useAppStore } from './useStore';

export interface CompassAppProps {
  /** Firestore の `users/{uid}`。preview では使われない */
  uid: string;
  /** `window.COMPASS_USER_EMAIL` 相当（HTML:2086 / `cloudUser` の初期値） */
  email: string;
  /** `?preview=1` または Firebase 未設定。保存無効のローカル版になる */
  preview?: boolean;
}

/** テンプレート上の画面 DOM 順（Cockpit → Tests → ToDo → Data → Add → Review, spec Q25） */
function renderScreen(view: ViewId) {
  switch (view) {
    case 'cockpit':
      return <Cockpit />;
    case 'tests':
      return <Tests />;
    case 'todo':
      return <Todo />;
    case 'data':
      return <DataScreen />;
    case 'add':
      return <AddTask />;
    case 'review':
      return <Review />;
    // レガシーに無い追加画面（docs/notebook/spec.md §8）
    case 'notebook':
      return <Notebook />;
  }
}

export function CompassApp({ uid, email, preview = false }: CompassAppProps) {
  const { state, plans } = useAppStore();
  const [splashReady, setSplashReady] = useState(false);
  const [themeModeEl, setThemeModeEl] = useState<HTMLDivElement | null>(null);
  const saverRef = useRef<SaveController | null>(null);
  /** 予習の自動生成をマウントごとに 1 回だけにする番人 */
  const prepRanRef = useRef(false);

  const savePrefs = useMemo(() => () => writePrefs(store), []);

  // ── 起動シーケンス（HTML:2096-2151 / spec §1.2-7）
  useEffect(() => {
    setSplashReady(false);
    const persistence: CompassPersistence = createPersistence({ preview, email });
    // `this._splashStart = Date.now()` はここ（gate の生成時刻, HTML:2097）
    const gate: SplashGate = createSplashGate(() => setSplashReady(true));
    const saver = new SaveController(store, persistence, uid, email, gate, dateCtx.today);
    saverRef.current = saver;

    const unsubscribe = store.subscribe(saver.notifyChanged);

    // `cloudUser:(window.COMPASS_USER_EMAIL || '')`（HTML:2086）を props から入れる
    store.setState({ cloudUser: email });

    const initial: Partial<AppState> = readPrefsPatch(store.getState().panelW);
    // HTML:2117-2120 — `Object.assign(initial, this.dataPatch(localData))`（C-32）
    const localPatch = runDataPatch(readLocalData(), {
      plans: store.getPlans(),
      today: dateCtx.today,
    });
    Object.assign(initial, localPatch.state);
    // `this._dataRepaired` はインスタンスフィールドなのでクラウド読込まで残る（HTML:2308）
    if (localPatch.repaired) saver.markRepaired();

    // 授業ノート（docs/notebook/spec.md §6）。`compass-ui-data` とは別系統の保存なので
    // スプラッシュのゲートには参加させない（ノートの遅延で起動を止めない）。
    const notebook = new NotebookController(store, persistence, uid);
    setNotebookController(notebook);

    const ready = () => {
      saver.markReady();
      store.resetUndoBaseline();
      void saver.loadCloudState();
      void notebook.boot();
    };
    if (Object.keys(initial).length || localPatch.plans) {
      store.update({ plans: localPatch.plans, state: initial }, ready);
    } else {
      ready();
    }

    return () => {
      unsubscribe();
      saver.dispose();
      notebook.dispose();
      setNotebookController(null);
      gate.cancel();
      persistence.reset();
      saverRef.current = null;
    };
  }, [uid, email, preview]);

  // ── 予習の自動生成（docs/notebook/spec.md §5 / ワークフロー手順 7）
  //    クラウド読み込みが終わって `cloudStatus` が 'loading' を抜けた**最初の 1 回**だけ走る。
  //    そこまで待たないと、保存済みの `prepGenLog` / `dayOverrides` / 設定が反映されず
  //    同じ日のタスクを二重に積んでしまう。`useRef` でマウントごと 1 回に固定する。
  useEffect(() => {
    if (prepRanRef.current) return;
    if (state.cloudStatus === 'loading') return;
    prepRanRef.current = true;
    const s = store.getState();
    const result = generatePrepTasks({
      today: dateCtx.today,
      dayOverrides: s.dayOverrides,
      settings: s.prepAutoGen,
      genLog: s.prepGenLog,
    });
    if (!result.extras.length && result.genLog === s.prepGenLog) return;
    store.setState((prev) => ({
      extras: prev.extras.concat(result.extras),
      prepGenLog: result.genLog,
    }));
    result.extras.forEach((e) => addToOrder(store, e.id));
    if (result.message) store.showToast(result.message);
  }, [state.cloudStatus]);

  // ── キーボードショートカット（`_key`, HTML:2117-2141 / spec §2.7）
  useEffect(() => {
    const focusSearch = () => {
      store.setState({ searchOpen: true });
      const input = document.getElementById('app-search-input') as HTMLInputElement | null;
      if (input) {
        input.focus();
        if (input.select) input.select();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      const target = e.target as HTMLElement | null;
      const editingText =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === 'z' && !editingText) {
        e.preventDefault();
        store.undoLastAction();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        void saverRef.current?.forceSaveNow();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        focusSearch();
        return;
      }
      // 修飾キーなしのショートカット: 1–7で画面切替 / 「/」で検索 / n・f で追加・集中
      if (!editingText && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (key === '/') {
          e.preventDefault();
          focusSearch();
          return;
        }
        if (key >= '1' && key <= '7') {
          const order = normalizeNavOrder(store.getState().navOrder);
          const view = order[Number(key) - 1];
          if (view) {
            e.preventDefault();
            store.setState({ view }, () => savePrefs());
          }
          return;
        }
        if (key === 'n') {
          e.preventDefault();
          store.setState({ view: 'add' }, () => savePrefs());
          return;
        }
        if (key === 'f') {
          e.preventDefault();
          store.setState({ view: 'todo', focusOpen: true });
          return;
        }
      }
      if (e.key === 'Escape') {
        // レガシーはここで `clearInterval(this._focusTimer)` もするが、タイマーは
        // `focusRunning:false` を見る React 側の effect が止める（store.ts の注記）
        store.setState({
          searchOpen: false,
          redistOpen: false,
          redistPlan: null,
          redistPickMode: false,
          query: '',
          appSwitcherOpen: false,
          revSel: null,
          revAsk: null,
          revAskReveal: false,
          scoreSel: null,
          focusOpen: false,
          focusRunning: false,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [savePrefs]);

  // ── 派生値
  const subjColors = useSubjColors(state, plans);
  const todayItems = useMemo(
    () => buildTodayItems(state, plans, dateCtx.today),
    [state, plans]
  );
  const overdueCount = useMemo(
    () => overdueSegs(state.segs, plans, dateCtx.today).length,
    [state.segs, plans]
  );
  const themeStyle = useMemo(
    () => buildThemeStyle(state.theme, state.view),
    [state.theme, state.view]
  );
  const onNavResize = useMemo(
    () => makeResizer(store, 'nav', 'right', savePrefs),
    [savePrefs]
  );

  const openAppSwitcher = () =>
    store.setState({ appSwitcherOpen: true, searchOpen: false, query: '' });
  const closeAppSwitcher = () => store.setState({ appSwitcherOpen: false });

  return (
    <div className="compass-root">
      <div className="compass-theme" style={STATIC_THEME_TOKENS as CSSProperties}>
        <div
          ref={setThemeModeEl}
          className="compass-theme-mode"
          data-theme={THEME_ATTR[state.theme]}
          style={themeStyle as CSSProperties}
        >
          <OverlayHostContext.Provider value={themeModeEl}>
            <div
              className="compass-shell"
              data-screen-label="Compass"
              data-view={state.view}
              style={{
                display: 'flex',
                height: '100vh',
                background: 'var(--bg0)',
                color: 'var(--tx1)',
                overflow: 'hidden',
              }}
            >
              <ShellSplash ready={splashReady} />
              <ShellNav
                state={state}
                store={store}
                ctx={dateCtx}
                overdueCount={overdueCount}
                savePrefs={savePrefs}
                onOpenAppSwitcher={openAppSwitcher}
                onNavResize={onNavResize}
              />
              <div
                className="compass-main"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
              >
                <ShellTopbar
                  state={state}
                  plans={plans}
                  store={store}
                  ctx={dateCtx}
                  subjColors={subjColors}
                  todayItems={todayItems}
                  overdueCount={overdueCount}
                  onOpenAppSwitcher={openAppSwitcher}
                />
                {renderScreen(state.view)}
              </div>
            </div>
            {/* ↓ オーバーレイ群は `.compass-shell` の「外」・`.compass-theme-mode` の直下（spec §2.1）。
                画面固有のドロワー / モーダルは `<ShellOverlay>` で同じ位置へポータルする。

                レガシーは以下の 3 つも**画面の `sc-if` の外**（テンプレート最上位）に置いていた。
                画面は 1 つしかマウントされないので、ここに 1 個だけ置く（画面側では描かない）:
                - ミニタスク編集ドロワー（HTML:1560-1700）… 「しまう」で折りたたんだ縦タブは
                  他画面でも見える。Review の `reviewToTest` からも開く
                - 理解度モーダル（HTML:1817-1852）… Cockpit / ToDo / 集中モードの `openAsk` から開く（C-293）
                - 集中モード（HTML:1854-1866）… 数字キーで画面を移してもタイマーは動き続ける */}
            {state.editorPlan ? (
              <TestsEditorDrawer
                state={state}
                plans={plans}
                store={store}
                ctx={dateCtx}
                subjColors={subjColors}
              />
            ) : null}
            <ReviewAskModal />
            <TodoFocusOverlay state={state} store={store} todayItems={todayItems} />
            {state.appSwitcherOpen ? (
              <ShellAppSwitcher store={store} onClose={closeAppSwitcher} />
            ) : null}
            {state.tooltip ? <ShellTooltip tooltip={state.tooltip} /> : null}
            {state.toast ? <ShellToast toast={state.toast} /> : null}
          </OverlayHostContext.Provider>
        </div>
      </div>
    </div>
  );
}

export default CompassApp;
