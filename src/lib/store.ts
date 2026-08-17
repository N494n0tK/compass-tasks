/**
 * Compass — 単一状態コンテナ（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * architecture §3「状態設計 — 単一ストア」の実装。レガシーは
 *
 *   - `this.state`   … フラット state（永続 23 キー + UI 一時キーが混在, HTML:2063-2087）
 *   - `this.PLANS`   … 計画マスタ。state ではないインスタンスフィールド（HTML:2011）
 *   - 1段 Undo       … `{plans, state:<undoKeys 14>}` の JSON スナップショット（HTML:2167-2196, 2410-2416）
 *
 * の3つで状態を持つ。ここではそれを **依存追加なしの単一ストア**（useSyncExternalStore 互換）
 * として再現する。React も firebase も import しない（`subscribe` / `getSnapshot` を素で公開し、
 * React 側で `useSyncExternalStore(store.subscribe, store.getSnapshot)` するだけ）。
 *
 * ## レガシーとの対応表
 *
 * | レガシー | ここ |
 * |---|---|
 * | `this.state`（HTML:2063-2087） | `store.getState()` / `createInitialState()` |
 * | `this.PLANS`（HTML:2011） | `store.getPlans()` / `store.setPlans()` |
 * | `setState(update, cb)`（SUP:872-877） | `store.setState(update, cb)` — **同期的に反映** |
 * | `persistentKeys()`（HTML:2159-2161） | `PERSISTENT_KEYS`（model/types.ts） |
 * | `undoKeys()`（HTML:2163-2165） | `UNDO_KEYS`（model/types.ts） |
 * | `undoPayload()`（HTML:2167-2171） | `store.undoPayload()` |
 * | `resetUndoBaseline()`（HTML:2173-2176） | `store.resetUndoBaseline()` |
 * | `undoLastAction()`（HTML:2178-2196） | `store.undoLastAction()` |
 * | `componentDidUpdate()` の Undo 差分検知（HTML:2410-2416） | `store.commit()` |
 * | `exportData()`（HTML:2284-2288） | `store.exportData()` / `store.serialize()` |
 * | `showToast(msg)`（HTML:2481-2485） | `store.showToast(msg)` |
 *
 * ## 移植上の重要点
 *
 * 1. **同期反映**（SUP:872-877 の `this.logic.state = {...prev, ...patch}`）。
 *    `setState` 直後に `getState()` を読むと新値。アプリはこれに依存している。
 * 2. **updater が `null` を返すと内容は無変更**（`{...prev, ...null}`）。ただしレガシーでも
 *    state オブジェクトは作り直されて React に tick が飛ぶので、ここでも**購読者へ通知する**。
 *    `addToOrder`（HTML:2602-2604）がこの挙動に依存している。
 * 3. **Undo チェックポイントはレンダー境界（`componentDidUpdate`）で 1 回**。1つのイベント
 *    ハンドラ内で `setState` を何回呼んでも React はバッチするので Undo は1段分しか進まない。
 *    ここでは `commit()` を microtask に 1 回だけ予約して同じ粒度にする（同期コード内の連続
 *    ミューテーションは 1 チェックポイントに畳まれる）。React 側から描画後に `store.commit()`
 *    を呼んでもよい（冪等）。
 * 4. **キー順**。`exportData()` は `PERSISTENT_KEYS` の配列順に代入する。保存トリガは
 *    `JSON.stringify` の文字列一致なので、キー順が変わると無駄な PUT が飛ぶ（spec §4.14）。
 */

import { DEFAULT_PREP_AUTOGEN } from './logic/prepAutogen';
import {
  PERSISTENT_KEYS,
  UNDO_KEYS,
  type AppState,
  type ExportData,
  type ISODate,
  type PersistentState,
  type Plans,
  type UndoPayload,
  type UndoState,
} from './model/types';

// ─────────────────────────────────────────────────────────────
// 定数（レガシー文言・タイミング）
// ─────────────────────────────────────────────────────────────

/** `showToast` の表示時間（ms）。HTML:2484 */
export const TOAST_MS = 2400;

/** Undo できるものが無いとき（HTML:2179） */
export const TOAST_UNDO_NONE = '戻せる操作はありません';

/** Undo 成功（HTML:2194） */
export const TOAST_UNDO_DONE = '1つ前の操作に戻しました';

/**
 * `undoLastAction()` が Undo スナップショットに**重ねて**強制リセットする UI キー
 * （HTML:2185-2190、22 キー）。選択・ドラッグ・モーダルを畳んでから巻き戻す。
 *
 * > `selId` は `PERSISTENT_KEYS` に含まれるが `UNDO_KEYS` には無い。つまり Undo は
 * > 「選択を外す」という**永続化される変更**を伴う（レガシーどおり）。
 */
export const UNDO_RESET_PATCH = {
  selId: null,
  editorPlan: null,
  revSel: null,
  revAsk: null,
  scoreSel: null,
  redistOpen: false,
  redistPlan: null,
  redistPickMode: false,
  focusOpen: false,
  focusRunning: false,
  dragId: null,
  dragMini: null,
  dragMiniOver: null,
  dragPlanRow: null,
  dragPlanOver: null,
  dragRev: null,
  dragCkItem: null,
  dragCkPlan: null,
  dragTestSeg: null,
  dragTestTarget: null,
  dragGoalPlan: null,
  tooltip: null,
} as const satisfies Partial<AppState>;

// ─────────────────────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────────────────────

/** `setState` に渡せるパッチ。`null` / `undefined` は「内容の変更なし」（SUP:874-875） */
export type StatePatch = Partial<AppState> | null | undefined;

/** `setState(update)` の引数。関数形は `prev` を受けてパッチを返す */
export type StateUpdate = StatePatch | ((prev: AppState) => StatePatch);

/** `setPlans` に渡せる値。`null` / `undefined` は「変更なし」 */
export type PlansPatch = Plans | null | undefined;

/** `setPlans(update)` の引数 */
export type PlansUpdate = PlansPatch | ((prev: Plans) => PlansPatch);

/**
 * `useSyncExternalStore` が受け取る不変スナップショット。
 * ミューテーションのたびに**新しいオブジェクト**になり、間は同一参照が返る。
 */
export interface StoreSnapshot {
  readonly state: AppState;
  readonly plans: Plans;
  /** 0 始まりの通し番号。ミューテーション 1 回につき +1 */
  readonly version: number;
}

/** `undoLastAction()` の戻り。`toast` は実際に表示した文言（テスト・呼び出し側の分岐用） */
export interface UndoResult {
  ok: boolean;
  toast: string;
}

export interface CreateStoreOptions {
  /** `this.TODAY`（HTML:2008）。`scoreDay` / `countdownDate` / `addDay` / `timetableFocusDate` の初期値 */
  today: ISODate;
  /** `window.COMPASS_USER_EMAIL || ''`（HTML:2086）相当。store は window を触らない */
  cloudUser?: string;
  /** 初期 state の上書き（localStorage 復元などのテスト用） */
  state?: Partial<AppState>;
  /** 初期 plans（`this.PLANS`）。浅くコピーして取り込む */
  plans?: Plans;
  /**
   * `commit()`（Undo チェックポイント）を microtask で自動実行するか。既定 `true`。
   * `false` にすると呼び出し側が明示的に `commit()` するまでチェックポイントが進まない。
   */
  autoCommit?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 初期 state（HTML:2063-2087 の逐語移植）
// ─────────────────────────────────────────────────────────────

/**
 * レガシー `this.state` の初期値（HTML:2063-2087）。**キーも順序も 1:1**。
 *
 * `this.TODAY` を参照する 4 キー（`scoreDay` / `countdownDate` / `addDay` / `timetableFocusDate`）は
 * 引数の `today` で埋める。`cloudUser` はレガシーが `window.COMPASS_USER_EMAIL` を読む箇所
 * （HTML:2086）だが、ストアは window に触らないので呼び出し側から渡す。
 */
export function createInitialState(today: ISODate, cloudUser = ''): AppState {
  return {
    theme: 'note',
    themeVersion: 3,
    view: 'cockpit',
    searchOpen: false,
    query: '',
    appSwitcherOpen: false,
    navOrder: ['cockpit', 'tests', 'todo', 'review', 'add', 'data'],
    dragNav: null,
    navDragOver: null,
    planOrder: [],
    dragPlanRow: null,
    dragPlanOver: null,
    wkMax: 240,
    weMax: 360,
    selId: null,
    dragId: null,
    dragCkItem: null,
    dragCkPlan: null,
    dragTestSeg: null,
    dragTestTarget: null,
    dragGoalPlan: null,
    tooltip: null,
    toast: null,
    redistOpen: false,
    redistMode: 'even',
    redistPlan: null,
    redistPickMode: false,
    redistIncludeManual: false,
    redistLateDays: 7,
    editorPlan: null,
    editorCollapsed: false,
    edPlanName: '',
    edPlanSubj: '',
    edPlanDue: '',
    edPlanRange: '',
    edPlanType: 'test',
    edNewTitle: '',
    edNewSize: 'M',
    dragMini: null,
    dragMiniOver: null,
    dragMiniPos: 'before',
    editMiniName: null,
    todoNewSub: '',
    todoNewSize: 'S',
    revSel: null,
    revFilter: null,
    revSort: 'due',
    revAsk: null,
    revAskGrade: null,
    revAskSize: null,
    dragRev: null,
    revEditName: null,
    scoreName: '',
    scoreSubj: '',
    scoreVal: '',
    scoreDay: today,
    scoreSel: null,
    // データ画面の期間切替。集計の見せ方だけを変える表示状態なので保存しない（HTML:2071）
    dataRange: 'all',
    countdowns: [],
    countdownTitle: '',
    countdownDate: today,
    // サイドバー・ドロワーの幅（ドラッグで変更可・localStorage に保存）
    panelW: { nav: 196, search: 308, editor: 410, review: 380, score: 400 },
    studyLog: [],
    scores: [],
    addSubj: '数学',
    addType: 'single',
    addTitle: '',
    addDay: today,
    addDay2: '',
    addMemo: '',
    addSize: 'M',
    addMinis: [],
    addMiniTitle: '',
    addMiniSize: 'S',
    addDetailOpen: false,
    addGenerator: 'manual',
    duoStart: '1',
    duoEnd: '400',
    duoChunk: '10',
    chartStart: '1',
    chartEnd: '4',
    // 空 = 毎日（デイリーミッションの実施曜日の下書き）
    addDows: [],
    // 空 = ただの毎日タスク（プリセット「弱点問題を3問」を押すと 'weak'）
    addMissionKind: '',
    addErr: {},
    addDone: null,
    recentSubjs: [],
    addSlotSel: null,
    addSlotDate: null,
    dayOverrides: {},
    timetableFocusDate: today,
    planQuota: {},
    dragQuota: null,
    focusOpen: false,
    focusRunning: false,
    focusRemaining: 1500,
    focusPreset: 25,
    segs: [],
    extras: [],
    reviews: [],
    order: [],
    cloudStatus: 'loading',
    cloudUser,
    // ── ノート画面と予習の自動生成（docs/notebook/spec.md）。レガシーに無い追加。
    //    `notes` は一時 state（`PERSISTENT_KEYS` に入れない）。実体は Firestore の
    //    `users/{uid}/notes/{noteId}` と localStorage `compass-notes`。
    notes: [],
    notesLoaded: false,
    nbSelNoteId: null,
    nbMode: 'note',
    nbSide: 'tree',
    // 問題抽出は「苦手な順」を既定にする（並べ直さないと結局いつも上から解いてしまう）
    nbExtractSort: 'weak',
    nbExtractGrade: null,
    nbMonth: today.slice(0, 8) + '01',
    nbSubjFilter: null,
    nbEdit: false,
    nbCheck: false,
    nbFind: '',
    // 既定は「自分のノートだけ」。本文は自分の手書きの再現で、AI の添削は
    // スイッチで重ねる（先に AI の文章が目に入ると、自分のノートを読み返さなくなる）
    nbLens: 'mine',
    nbScanIx: 0,
    nbScanZoom: null,
    nbImportOpen: false,
    nbImportText: '',
    nbImportTarget: null,
    nbRevealed: {},
    nbTreeOpen: {},
    nbFullNote: false,
    revAskReveal: false,
    prepAutoGen: { ...DEFAULT_PREP_AUTOGEN },
    prepGenLog: {},
    // デイリーミッション（docs/daily-mission/plan.md §3）。旧データには無いキーなので、
    // ここの既定値がそのまま「まだ 1 件も登録していない」状態になる（`dataPatch` は
    // 保存データに在るキーしか上書きしない）
    missions: [],
    missionGenLog: {},
    // まとめタスクを提案済みのノート id（plan.md §4.1）。日付ではなく noteId 単位で一度きり
    noteSumLog: [],
  };
}

// ─────────────────────────────────────────────────────────────
// 内部ユーティリティ
// ─────────────────────────────────────────────────────────────

/**
 * `target[key] = value` を型安全に行う。`for (const k of KEYS) st[k] = state[k]` を
 * strict TS で書くための定石（K がユニオンでも書き込みが通る）。
 */
function assignKey<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

/** `update({...})` で「そのキーには触らない」を表す番兵 */
const UNTOUCHED = Symbol('compass.store.untouched');

// ─────────────────────────────────────────────────────────────
// ストア本体
// ─────────────────────────────────────────────────────────────

export class CompassStore {
  private stateRef: AppState;
  private plansRef: Plans;
  private snapshotRef: StoreSnapshot;
  private versionRef = 0;

  private readonly listeners = new Set<() => void>();

  /** `this._lastUndoJson`（HTML:2088）。初期値 null = まだベースライン未確定 */
  private lastUndoJson: string | null = null;
  /** `this._undoSnapshot`（HTML:2089） */
  private undoSnapshot: UndoPayload | null = null;
  /** `this._undoApplying`（HTML:2090） */
  private undoApplying = false;

  private readonly autoCommit: boolean;
  private commitScheduled = false;

  /** `this._tt`（HTML:2482） */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CreateStoreOptions) {
    const base = createInitialState(options.today, options.cloudUser ?? '');
    this.stateRef = options.state ? { ...base, ...options.state } : base;
    // レガシー `dataPatch` の `this.PLANS = Object.assign({}, payload.plans)`（HTML:2201）と同じく浅コピー
    this.plansRef = options.plans ? { ...options.plans } : {};
    this.autoCommit = options.autoCommit !== false;
    this.snapshotRef = { state: this.stateRef, plans: this.plansRef, version: 0 };
  }

  // ── 読み取り ────────────────────────────────────────────────

  /** `this.state`。**参照は不変扱い**（書き換えは必ず `setState` 経由） */
  getState = (): AppState => this.stateRef;

  /** `this.PLANS`。**参照は不変扱い**（書き換えは必ず `setPlans` 経由） */
  getPlans = (): Plans => this.plansRef;

  /**
   * `useSyncExternalStore` 用のスナップショット。ミューテーションが無い限り**同一参照**を返す
   * （React の「getSnapshot はキャッシュせよ」要件を満たす）。SSR 用 `getServerSnapshot` にも
   * そのまま渡せる。
   */
  getSnapshot = (): StoreSnapshot => this.snapshotRef;

  /** ミューテーション通し番号（テスト・デバッグ用） */
  getVersion = (): number => this.versionRef;

  /**
   * `useSyncExternalStore` 用の購読。戻り値で解除。
   * リスナーが呼ばれた時点で `getState()` / `getSnapshot()` は**新しい値**を返す。
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ── 書き込み ────────────────────────────────────────────────

  /**
   * `setState(update, cb)`（SUP:872-877）。**同期的に**反映してから購読者へ通知し、最後に `cb`。
   *
   * - `update` が関数のとき `null` を返すと内容は無変更。ただしレガシー同様
   *   state オブジェクトは作り直され、通知は飛ぶ（`addToOrder`, HTML:2602-2604）。
   * - `cb` はレガシーでは**描画後**に呼ばれる。ここでは通知直後（同期）。DOM に触る
   *   コールバック（focus/select）は React 側の effect へ移すこと。
   */
  setState = (update: StateUpdate, cb?: () => void): void => {
    this.update({ state: update }, cb);
  };

  /**
   * `this.PLANS` の差し替え。レガシーは `this.PLANS[pid] = {...}` / `delete this.PLANS[pid]` と
   * **直接 mutate** するが、ここでは常に新しいオブジェクトを渡す（購読者に通知するため）。
   *
   * ```ts
   * store.setPlans(p => ({ ...p, [pid]: { ...p[pid], name } }));   // 追加・更新
   * store.setPlans(p => { const next = { ...p }; delete next[pid]; return next; }); // 削除
   * ```
   */
  setPlans = (update: PlansUpdate, cb?: () => void): void => {
    this.update({ plans: update }, cb);
  };

  /**
   * state と plans を**1回の通知で**まとめて更新する。
   * レガシーの「`PLANS` を直接 mutate してから `setState`」（例: HTML:3359-3372, 3859-3871）は
   * レンダーが 1 回なので、こちらが等価。
   *
   * キーを省略したものは変更しない（`{ state: null }` は「updater が null を返した」と同じ扱い）。
   */
  update = (
    patch: { state?: StateUpdate; plans?: PlansUpdate },
    cb?: () => void,
  ): void => {
    const prevState = this.stateRef;
    const prevPlans = this.plansRef;

    const stateUpdate = 'state' in patch ? patch.state : UNTOUCHED;
    const plansUpdate = 'plans' in patch ? patch.plans : UNTOUCHED;

    let nextState = prevState;
    if (stateUpdate !== UNTOUCHED) {
      const sp = typeof stateUpdate === 'function' ? stateUpdate(prevState) : stateUpdate;
      // SUP:875 — `{ ...prev, ...patch }`。patch が null/undefined でも新しいオブジェクトになる
      nextState = { ...prevState, ...sp };
    }

    let nextPlans = prevPlans;
    if (plansUpdate !== UNTOUCHED) {
      const pp = typeof plansUpdate === 'function' ? plansUpdate(prevPlans) : plansUpdate;
      if (pp != null) nextPlans = pp;
    }

    if (nextState === prevState && nextPlans === prevPlans) {
      // どちらも触っていない（`update({})`）。レガシーに対応する経路が無いので通知しない
      if (cb) cb();
      return;
    }

    this.stateRef = nextState;
    this.plansRef = nextPlans;
    this.versionRef += 1;
    this.snapshotRef = { state: nextState, plans: nextPlans, version: this.versionRef };

    this.scheduleCommit();
    this.emit();
    if (cb) cb();
  };

  /**
   * `showToast(msg)`（HTML:2481-2485）。前のタイマーを潰して 2400ms 後に `toast:null`。
   * トーストは state の一時キーなので、置き場所としてストアが正しい。
   */
  showToast = (msg: string): void => {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.setState({ toast: msg });
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.setState({ toast: null });
    }, TOAST_MS);
  };

  // ── Undo（1段） ─────────────────────────────────────────────

  /** `undoPayload()`（HTML:2167-2171）。`plans` は**参照そのまま**（レガシー同様、直列化専用） */
  undoPayload = (): UndoPayload => {
    const state = {} as UndoState;
    for (const key of UNDO_KEYS) assignKey(state, key, this.stateRef[key]);
    return { plans: this.plansRef, state };
  };

  /** `JSON.stringify(this.undoPayload())`（HTML:2174, 2411） */
  serializeUndo = (): string => JSON.stringify(this.undoPayload());

  /**
   * `componentDidUpdate()` の Undo 差分検知（HTML:2410-2416）。
   *
   * ```js
   * const undoJson = JSON.stringify(this.undoPayload());
   * if (this._lastUndoJson == null) this._lastUndoJson = undoJson;
   * else if (undoJson !== this._lastUndoJson) {
   *   if (!this._undoApplying) this._undoSnapshot = JSON.parse(this._lastUndoJson);
   *   this._lastUndoJson = undoJson;
   * }
   * ```
   *
   * 通常は `update()` が microtask に自動予約する（= 同期コード内の連続ミューテーションが
   * 1 チェックポイントに畳まれる ≒ React のバッチ）。React 側から描画後に呼んでもよい（冪等）。
   */
  commit = (): void => {
    this.commitScheduled = false;
    const undoJson = this.serializeUndo();
    if (this.lastUndoJson == null) {
      this.lastUndoJson = undoJson;
      return;
    }
    if (undoJson === this.lastUndoJson) return;
    if (!this.undoApplying) this.undoSnapshot = JSON.parse(this.lastUndoJson) as UndoPayload;
    this.lastUndoJson = undoJson;
  };

  /** `resetUndoBaseline()`（HTML:2173-2176）。起動時とクラウド読込直後に呼ぶ */
  resetUndoBaseline = (): void => {
    this.lastUndoJson = this.serializeUndo();
    this.undoSnapshot = null;
  };

  /** Undo できる状態か（`!!this._undoSnapshot`） */
  canUndo = (): boolean => this.undoSnapshot !== null;

  /** 現在のスナップショット（デバッグ・テスト用）。JSON 由来のディープコピー */
  getUndoSnapshot = (): UndoPayload | null => this.undoSnapshot;

  /**
   * `undoLastAction()`（HTML:2178-2196）。
   *
   * スナップショットが無ければトーストだけ出して何もしない。適用時は
   * `PLANS` 全体 + `UNDO_KEYS` 14 キーを巻き戻し、選択・ドラッグ・モーダル 22 キーを
   * 強制リセット（`UNDO_RESET_PATCH`）してからトースト。
   *
   * > レガシーはここで `clearInterval(this._focusTimer)` もするが、タイマーは React 側の
   * > 責務なので移していない。`focusRunning:false` / `focusOpen:false` を必ず含むので、
   * > 集中モードのタイマー effect はその変化で自然に止まる。
   */
  undoLastAction = (): UndoResult => {
    const snapshot = this.undoSnapshot;
    if (!snapshot) {
      this.showToast(TOAST_UNDO_NONE);
      return { ok: false, toast: TOAST_UNDO_NONE };
    }
    this.undoApplying = true;
    this.update({
      // HTML:2183 — `Object.assign({}, snapshot.plans || {})`
      plans: { ...(snapshot.plans || {}) },
      // HTML:2184-2190 — スナップショットの state に UI リセットを重ねる
      state: { ...(snapshot.state || {}), ...UNDO_RESET_PATCH },
    });
    // HTML:2191-2195（レガシーは setState のコールバック内 = 描画後。ここは同期で等価）
    this.lastUndoJson = this.serializeUndo();
    this.undoSnapshot = null;
    this.undoApplying = false;
    this.showToast(TOAST_UNDO_DONE);
    return { ok: true, toast: TOAST_UNDO_DONE };
  };

  // ── 保存ペイロード ──────────────────────────────────────────

  /**
   * `exportData()`（HTML:2284-2288）。
   *
   * ```js
   * const st = {};
   * this.persistentKeys().forEach(k => { st[k] = this.state[k]; });
   * return { version: 1, plans: Object.assign({}, this.PLANS), state: st };
   * ```
   *
   * **キー順は `PERSISTENT_KEYS` の配列順で固定**。トップレベルも `version → plans → state`。
   * 保存トリガが `JSON.stringify` の文字列一致なので、順序が変わると無変更でも PUT が飛ぶ
   * （spec §4.14「保存判定の注意」/ architecture §5）。
   */
  exportData = (): ExportData => {
    // 23 キーすべてを直後のループで埋めるので、初期化は空オブジェクトで良い
    const st = {} as PersistentState;
    for (const key of PERSISTENT_KEYS) assignKey(st, key, this.stateRef[key]);
    return { version: 1, plans: { ...this.plansRef }, state: st };
  };

  /**
   * 保存トリガ用の直列化（`JSON.stringify(this.exportData())`, HTML:2331）。
   * persistence 側はこの文字列を `_lastSaveJson` / `_saveQueuedJson` と比較する。
   */
  serialize = (): string => JSON.stringify(this.exportData());

  // ── 後始末 ──────────────────────────────────────────────────

  /**
   * トーストタイマーを止めて購読を全解除する。React のアンマウント用。
   * （レガシー `componentWillUnmount`（HTML:2151-2157）は `_tt` を消し忘れているが、
   * 実害が無く再現価値も無いのでここでは片付ける）
   */
  dispose = (): void => {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.listeners.clear();
  };

  // ── 内部 ────────────────────────────────────────────────────

  private emit(): void {
    // 通知中の unsubscribe / subscribe に耐えるようスナップショットを取ってから回す
    for (const listener of Array.from(this.listeners)) listener();
  }

  private scheduleCommit(): void {
    if (!this.autoCommit || this.commitScheduled) return;
    this.commitScheduled = true;
    queueMicrotask(() => {
      if (this.commitScheduled) this.commit();
    });
  }
}

/** ストア生成。`new CompassStore(...)` と同じ */
export function createStore(options: CreateStoreOptions): CompassStore {
  return new CompassStore(options);
}

/** 呼び出し側が `CompassStore` を名指ししないで済むようにする別名 */
export type Store = CompassStore;
