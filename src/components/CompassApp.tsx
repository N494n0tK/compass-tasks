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
import { todayISO } from '../lib/logic/dates';
import { generateMissionTasks } from '../lib/logic/missionAutogen';
import { collapseNoteReviews } from '../lib/logic/noteCards';
import { generateNoteSummaryTasks } from '../lib/logic/noteSummaryTasks';
import { generatePrepTasks } from '../lib/logic/prepAutogen';
import { overdueSegs } from '../lib/logic/schedule';
import type { AppState, ISODate, ViewId } from '../lib/model/types';
import {
  createPersistence,
  createSplashGate,
  type CompassPersistence,
  type SplashGate,
} from '../lib/persistence';
import type { CompassStore } from '../lib/store';
import { folderUp } from '../lib/logic/noteFolder';
import {
  applyNoteUndo,
  noteLabel,
  purgeTrash,
  restoreNote,
  undoMessage,
} from '../lib/logic/noteTrash';
import { ClawdCheer } from './parts/ClawdCheer';
import { ClawdWorkWindow } from './parts/ClawdWorkWindow';
import { NoteDangerDialog } from './parts/NoteDangerDialog';
import { NoteTrashPanel } from './parts/NoteTrashPanel';
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
import {
  STATIC_THEME_TOKENS,
  THEME_ATTR,
  buildThemeStyle,
  normalizeNavOrder,
  useLocalMinuteOfDay,
} from './parts/ShellTheme';
import { ShellToast, ShellTooltip } from './parts/ShellToast';
import { ShellTopbar } from './parts/ShellTopbar';
import { buildTodayItems } from './parts/ShellTodayItems';
import { TestsEditorDrawer } from './parts/TestsEditorDrawer';
import {
  NotebookController,
  applyNoteOutcome,
  setNotebookController,
} from './parts/NotebookPersistence';
import { pullNotionNotes } from './parts/NotionPull';
import { AddTask } from './screens/AddTask';
import { ClawdChat } from './screens/ClawdChat';
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
function renderScreen(state: AppState) {
  switch (state.view) {
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
    // レガシーに無い追加画面（docs/notebook/spec.md §8）。
    // どちらも `Notebook` が受けて、中で `view` を見て紙面を切り替える
    case 'notebook':
    case 'extract':
      return <Notebook />;
    // 隠しタブ（トップバーの ✳ で見つける）。ここだけ予定を扱わない
    case 'clawd':
      return <ClawdChat />;
  }
}

/** 日付が変わったのを検知したときのトースト（plan.md §4.1） */
export const TOAST_DATE_ROLLOVER = '日付が変わったので今日を更新しました';

/**
 * 日付の変化を見に行く間隔（ms）。タブを開きっぱなしで放置されているときの保険で、
 * 主な検知経路は `visibilitychange` / `focus`（戻ってきた瞬間に切り替わってほしい）。
 */
export const ROLLOVER_CHECK_MS = 60_000;

/**
 * 予習（docs/notebook/spec.md §5）・デイリーミッション（docs/daily-mission/plan.md §3.3）・
 * まとめタスク（同 §4.1）の自動生成を **1 回の `setState`** で反映する。
 * **起動時と日付ロールオーバー時が同じここを通る**
 * （経路が分かれると、片方だけ直したときにもう片方が壊れる）。
 *
 * 3 種類をまとめるのが肝。ログはそれぞれの結果から書くので（`prepGenLog` は予習の、
 * `missionGenLog` はミッションの、`noteSumLog` はまとめの戻り）互いを消さない。
 *
 * **何度呼んでも増えない**（3 種ともログだけで重複を判定する）。ノートの読み込みが
 * 遅れて 2 回目を通すことがあるので、この冪等性に頼っている。
 *
 * @returns トースト文言。何も生成されなければ `null`（トーストを出すかは呼び出し側の判断）
 */
function runAutoGen(store: CompassStore, today: ISODate): string | null {
  const s = store.getState();
  const prep = generatePrepTasks({
    today,
    dayOverrides: s.dayOverrides,
    settings: s.prepAutoGen,
    genLog: s.prepGenLog,
  });
  const mission = generateMissionTasks({
    today,
    missions: s.missions,
    genLog: s.missionGenLog,
  });
  // ノートは別系統で遅れて読み込まれるので、未読込のときは何もしない（`notesLoaded` を渡す）。
  // 空の一覧で走らせると提案済みログを掃除してしまい、読み込み後に蒸し返す
  const summary = generateNoteSummaryTasks({
    today,
    notes: s.notes,
    log: s.noteSumLog,
    notesLoaded: s.notesLoaded,
  });
  const born = prep.extras.concat(mission.extras, summary.extras);
  const logsChanged =
    prep.genLog !== s.prepGenLog ||
    mission.genLog !== s.missionGenLog ||
    summary.log !== s.noteSumLog;
  if (!born.length && !logsChanged) return null;
  store.setState((prev) => {
    // 自動生成の id は規約で決まる（`dm-…` / `nbsum-…`）ので、ログと実体が食い違うと
    // **同じ id のカードが 2 枚**並びうる。積むかどうかはログで決めたまま、
    // 既にある id だけは弾く（重複の実害だけを消し、消したタスクは復活させない）
    const have = new Set(prev.extras.map((x) => x.id));
    return {
      extras: prev.extras.concat(born.filter((e) => !have.has(e.id))),
      prepGenLog: prep.genLog,
      missionGenLog: mission.genLog,
      noteSumLog: summary.log,
    };
  });
  born.forEach((e) => addToOrder(store, e.id));
  // トーストは 1 本しか出せない（後勝ちで潰れる）ので、複数できたときは 1 文にまとめる
  const messages = [prep.message, mission.message, summary.message].filter(
    (m): m is string => !!m
  );
  return messages.length ? messages.join(' / ') : null;
}

export function CompassApp({ uid, email, preview = false }: CompassAppProps) {
  const { state, plans } = useAppStore();
  const [splashReady, setSplashReady] = useState(false);
  const [themeModeEl, setThemeModeEl] = useState<HTMLDivElement | null>(null);
  const saverRef = useRef<SaveController | null>(null);
  /** 起動時の自動生成（予習・デイリーミッション）をマウントごとに 1 回だけにする番人 */
  const autoGenRanRef = useRef(false);
  /** ノート読み込み後の追い生成（まとめタスク）をマウントごとに 1 回だけにする番人 */
  const noteGenRanRef = useRef(false);

  /** 起動時の Notion 受け取りをマウントごとに 1 回だけにする番人 */
  const notionPullRanRef = useRef(false);

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
      // ゴミ箱の掃除は**読み込みが終わってから**（docs/notebook/ux-refresh.md §7）。
      // 先に走らせると `notesTrash` がまだ空で、30 日を過ぎたノートが
      // いつまでも残る。ここが Firestore から本当に消す唯一の場所。
      void notebook.boot().then(() => {
        /**
         * 2026-08 より前に作られた「問ごと」の復習を、ノート 1 冊 1 行へ畳む。
         * **ノートが読み込めたあとで 1 回だけ**（畳んだ行の単元名と問数はノートから引く）。
         * 冪等なので、既に畳んであるデータで走らせても何も起きない。
         */
        const col = collapseNoteReviews(
          store.getState().reviews,
          store.getState().notes,
          dateCtx.today,
        );
        if (col.changed) store.setState({ reviews: col.reviews });

        const p = purgeTrash(store.getState(), dateCtx.today);
        if (!p.removedIds.length) return;
        store.setState({ notesTrash: p.notesTrash, nbUndo: p.nbUndo });
        p.removedIds.forEach((id) => notebook.remove(id));
      });
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

  // ── 起動時の自動生成（予習: docs/notebook/spec.md §5 / ミッション: docs/daily-mission/plan.md §3.3）
  //    クラウド読み込みが終わって `cloudStatus` が 'loading' を抜けた**最初の 1 回**だけ走る。
  //    そこまで待たないと、保存済みのログ・台帳・設定が反映されず同じ日のタスクを二重に積んでしまう。
  //    `useRef` でマウントごと 1 回に固定する。生成の中身は `runAutoGen`（ロールオーバーと共通）。
  useEffect(() => {
    if (autoGenRanRef.current) return;
    if (state.cloudStatus === 'loading') return;
    autoGenRanRef.current = true;
    // モジュール読込 → クラウド読込完了の間に日付が変わっている可能性がある（夜更かし + 遅い回線）。
    // 古い「今日」で 1 日ぶん生成してしまわないよう、生成の直前に一度だけ合わせる。
    // ここは起動の一部なのでトーストは出さない（更新される前の画面をユーザーは見ていない）。
    dateCtx.rollover();
    const message = runAutoGen(store, dateCtx.today);
    if (message) store.showToast(message);
  }, [state.cloudStatus]);

  // ── ノート読み込み後の追い生成（まとめタスク: docs/daily-mission/plan.md §4.1）
  //    ノートは `compass-ui-data` とは**別系統**（`NotebookController`）で読み込まれ、
  //    スプラッシュのゲートにも参加しないので、上の 1 回目に間に合わないことが多い。
  //    まとめタスクだけは `state.notes` を見ないと作れないので、読み込み完了で一度だけ通し直す。
  //    予習・ミッションはログで守られていて二度通しても増えない（`runAutoGen` は冪等）。
  useEffect(() => {
    if (!autoGenRanRef.current || noteGenRanRef.current) return;
    if (!state.notesLoaded) return;
    noteGenRanRef.current = true;
    const message = runAutoGen(store, dateCtx.today);
    if (message) store.showToast(message);
    // `cloudStatus` を依存に入れるのは、ノートの方が先に読み終わったときの順番のため。
    // その場合この effect は 1 回目に空振りし、クラウド読込が終わった描画でもう一度走る
  }, [state.notesLoaded, state.cloudStatus]);

  // ── 起動時の Notion 受け取り（docs/notebook/notion-pull.md）。ノートの正本は Notion で、
  //    平日 17 時のエージェントが置いた JSON をここで拾う。**両方の読み込みが終わってから**
  //    ―― `notionPullLog`（compass-ui-data）と `notes` が揃わないと、取り込み済みの判定も
  //    上書き先の解決もできず、端末をまたいだ重複ノートを作ってしまう。
  //    preview では走らせない（QA 用の紙面に実データを混ぜない。ボタンからは実行できる）。
  useEffect(() => {
    if (notionPullRanRef.current || preview) return;
    if (!state.notesLoaded || state.cloudStatus === 'loading') return;
    notionPullRanRef.current = true;
    void pullNotionNotes(store, dateCtx.today, { auto: true });
  }, [state.notesLoaded, state.cloudStatus, preview]);

  // ── 日付ロールオーバー（docs/daily-mission/plan.md §4.1）
  //    タブを開きっぱなしで日付が変わると、`dateCtx` が古いままなので ToDo も自動生成も
  //    昨日で止まる。可視化・フォーカス・60 秒ごとの見張りで検知して「今日」を進める。
  useEffect(() => {
    const maybeRollover = () => {
      if (todayISO() === dateCtx.today) return;
      // 起動時の自動生成がまだなら見送る。クラウド読込前に生成すると保存済みのログを
      // 知らないまま積むことになり、同じ日のタスクが二重になる（上の effect と同じ理由）。
      if (!autoGenRanRef.current) return;
      // Clawd と作業中は進めない。進めると目の前の「今日のリスト」が予告なく差し替わる。
      // 閉じたあとの次のチェック（60 秒以内）で進むので取りこぼさない。
      if (store.getState().clawdWork) return;

      dateCtx.rollover();
      const message = runAutoGen(store, dateCtx.today);
      // 生成が 0 件でも「今日」が変わったことを画面に反映しなければならない。
      // `setState(null)` は内容を変えずに購読者へ通知する（store.ts の移植上の重要点 2）
      store.setState(null);
      store.showToast(TOAST_DATE_ROLLOVER + (message ? ' / ' + message : ''));
    };
    const onVisibility = () => {
      if (!document.hidden) maybeRollover();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', maybeRollover);
    const timer = setInterval(maybeRollover, ROLLOVER_CHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', maybeRollover);
      clearInterval(timer);
    };
  }, []);

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
        /**
         * ⌘Z は 2 系統ある（docs/notebook/ux-refresh.md §7）。
         *
         * ノート（`notes`）は一時 state なのでアプリ本体の 1 段 Undo（`UNDO_KEYS`）に
         * 乗っておらず、捨てた・改名したノートはそちらでは戻らない。そこで
         * **ノートの画面にいて、ノート操作の履歴があるときだけ**そちらを優先する。
         * 履歴が尽きたら本体の Undo に落ちる ―― 「戻せる操作はありません」を
         * ノート画面でだけ別の言葉で言い分ける必要はない。
         */
        const s = store.getState();
        if ((s.view === 'notebook' || s.view === 'extract') && s.nbUndo.length) {
          const out = applyNoteUndo(s);
          applyNoteOutcome(store, out);
          store.showToast(undoMessage(out));
          return;
        }
        store.undoLastAction();
        return;
      }
      // ⌘↑ = 1 つ上のフォルダへ（Finder と同じ）。潜っているときだけ効く。
      // サイドバーはノート／問題抽出のどちらのタブでも共通に出ているので両方で拾う
      if ((e.metaKey || e.ctrlKey) && key === 'arrowup' && !editingText) {
        const s = store.getState();
        if ((s.view === 'notebook' || s.view === 'extract') && s.nbFolder) {
          e.preventDefault();
          store.setState({ nbFolder: folderUp(s.nbFolder) });
          return;
        }
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
      // 修飾キーなしのショートカット: 1–8で画面切替 / 「/」で検索 / n・f で追加・集中
      if (!editingText && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (key === '/') {
          e.preventDefault();
          focusSearch();
          return;
        }
        // 1–9 で画面切替（ノート・問題抽出で 8 つ、Clawd を見つけると 9 つめ）
        if (key >= '1' && key <= '9') {
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
      }
      if (e.key === 'Escape') {
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
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [savePrefs]);

  // ── 派生値
  const subjColors = useSubjColors(state, plans);
  // `dateCtx.today` はロールオーバーで書き換わるので依存に入れる（入れないと、
  // 生成が 0 件で `state.segs` も変わらないロールオーバーで古い日付のまま固まる）
  const todayItems = useMemo(
    () => buildTodayItems(state, plans, dateCtx.today),
    [state, plans, dateCtx.today]
  );
  const overdueCount = useMemo(
    () => overdueSegs(state.segs, plans, dateCtx.today).length,
    [state.segs, plans, dateCtx.today]
  );
  const glassClockEnabled = state.theme === 'glass' && !!state.glassFollowCurrentTime;
  const glassSystemMinutes = useLocalMinuteOfDay(glassClockEnabled);
  const activeGlassMinutes = state.glassFollowCurrentTime
    ? glassSystemMinutes
    : state.glassTimeMinutes ?? 12 * 60;
  const themeStyle = useMemo(
    () => buildThemeStyle(state.theme, state.view, activeGlassMinutes),
    [state.theme, state.view, activeGlassMinutes]
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
                {renderScreen(state)}
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
            {/* ノートの削除・改名の確認と、ゴミ箱（docs/notebook/ux-refresh.md §6・§7）。
                理解度モーダルと同じ扱いで**ここに 1 個だけ**置く ―― 開く側は
                サイドバーの右クリックメニューにも紙面の削除ボタンにもあり、
                画面ごとに置くと同じものが 2 つ生えるため。どちらも自分で
                `nbAsk` / `nbTrashOpen` を見て、閉じているときは何も描かない */}
            {/* 片づけたときの祝い（左下）。知らせのトーストとは席を分ける */}
            <ClawdCheer />
            {/* 一緒に作業する浮き窓。**画面を移っても回り続ける**ので、
                画面側ではなくここに 1 個だけ置く */}
            <ClawdWorkWindow />
            <NoteDangerDialog />
            <NoteTrashPanel
              today={dateCtx.today}
              onRestore={(noteId) => {
                const out = restoreNote(store.getState(), { noteId });
                // `trashedAt` を空にしたノートを書き戻す（消さない）
                if (!applyNoteOutcome(store, out) || !out.note) return;
                // 復習まで戻せたかは控えの有無で決まる（`nbUndo` は一時 state なので、
                // リロードを挟むと控えが無く、ノートだけが戻る）。黙って違えないよう言い分ける
                store.showToast(
                  '「' + noteLabel(out.note) + '」を元に戻しました' +
                    (out.restoredReviews ? '(復習' + out.restoredReviews + '件も復帰)' : ''),
                );
              }}
            />
            {state.appSwitcherOpen ? (
              <ShellAppSwitcher store={store} onClose={closeAppSwitcher} />
            ) : null}
            {state.tooltip ? <ShellTooltip tooltip={state.tooltip} /> : null}
            {/* **条件を付けない。** `state.toast ? … : null` にすると、消える瞬間に
                部品ごと外れて引っ込む動きが素通りする（`ShellToast` は文言を持ち直して
                退場を鳴らす作りで、props が `string | null` なのはそのため） */}
            <ShellToast toast={state.toast} />
          </OverlayHostContext.Provider>
        </div>
      </div>
    </div>
  );
}

export default CompassApp;
