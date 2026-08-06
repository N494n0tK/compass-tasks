/**
 * Compass — 永続モデルの型定義（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * 出典:
 *  - spec §4.1-§4.17（データモデルと永続化）
 *  - legacy HTML:2063-2087（state 初期値）、2159-2161（persistentKeys）、2163-2165（undoKeys）、
 *    2167-2171（undoPayload）、2284-2288（exportData）
 *
 * このファイルは純粋な型 + 2つのキー配列のみ。React / firebase を import しない。
 */

// ─────────────────────────────────────────────────────────────
// プリミティブ・エイリアス
// ─────────────────────────────────────────────────────────────

/** `'YYYY-MM-DD'`。時刻・タイムスタンプはデータに一切保存しない（spec §4.12） */
export type ISODate = string;

/** 未配分の seg / extra は `day: ''`（`dayLabel('')` → `'未配分'`） */
export type ISODateOrEmpty = ISODate | '';

/** 曜日ラベル（`DOW = ['日','月','火','水','木','金','土']`, HTML:2002） */
export type Dow = '日' | '月' | '火' | '水' | '木' | '金' | '土';

/**
 * `state.theme` の**保存値**。既存 Firestore データ互換のため 'dark' を残す
 * （architecture §4: `data-theme` 属性の値だけ note|neon|light に正規化する）。
 */
export type Theme = 'light' | 'dark' | 'note';

/** `data-theme` 属性に流し込む正規化済みスキン名（architecture §4 / spec §3.2 Q19） */
export type ThemeSkin = 'note' | 'neon' | 'light';

/** 画面 ID（spec §2.6, HTML:2624-2631 相当） */
export type ViewId = 'cockpit' | 'tests' | 'todo' | 'review' | 'add' | 'data';

/** タスクサイズ。`SIZE_MIN = { XS:5, S:10, M:20, L:30 }`（HTML:2037） */
export type SizeKey = 'XS' | 'S' | 'M' | 'L';

/** `subSizes[]` は既存分を `''` で埋めて長さを揃える（HTML:3026-3030 / spec §4.4） */
export type SubSize = '' | SizeKey;

/** Add 画面のタスク種別 */
export type AddType = 'single' | 'review' | 'prep' | 'test';

/** 計画の種別。`type: S.addType === 'test' ? 'test' : 'prep'`（HTML:3723） */
export type PlanType = 'test' | 'prep';

/** 時限。1..7（`period = idx + 1`, HTML:3593）。JSON の `dayOverrides` ではキーが文字列になる */
export type Period = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ─────────────────────────────────────────────────────────────
// 永続エンティティ（spec §4.4-§4.11）
// ─────────────────────────────────────────────────────────────

/**
 * 計画マスタ。`this.PLANS[planId]`（HTML:2011 で `{}` 初期化）。
 * **`id` フィールドを持たない**（Record のキーが id）。state ではなくインスタンスフィールドで、
 * `exportData()` が `plans` として別枠で保存する（spec §4.1 / §4.2）。
 */
export interface Plan {
  /** `subj + ' ' + t`（教科 + 半角空白 + タスク名, HTML:3723）/ `rSel.title || 'テスト'`（3360） */
  name: string;
  type: PlanType;
  /** GOAL 日 / 期限日 */
  due: ISODate;
  subj: string;
  /** `memo || '範囲は未設定'` */
  range: string;
  timetablePeriod: number | null;
  timetableDate: ISODate | null;
}

/** `exportData().plans` — planId → Plan */
export type Plans = Record<string, Plan>;

/** サブタスク（細分化）を持ちうるタスクの共通部分（HTML:3026-3030 / spec §4.4） */
export interface SubTaskFields {
  subs?: string[];
  subsDone?: boolean[];
  subSizes?: SubSize[];
}

/**
 * 計画ミニタスク（`state.segs`）。
 * id は 計画作成時 `uid + '-' + i`（HTML:3731）/ 単発追加 `'u'+base36+rand999`（2439, 3121）/
 * `reviewToTest` は `'s'+…`（3353）。
 */
export interface Seg extends SubTaskFields {
  id: string;
  /** planId（`PLANS` のキー）。孤児 seg の掃除はレガシーに存在しない（spec §4.15 末尾） */
  plan: string;
  title: string;
  size: SizeKey;
  /** `SIZE_MIN[size]` */
  min: number;
  /** `''` = 未配分 */
  day: ISODateOrEmpty;
  done: boolean;
  /**
   * **`true` にしかならない**。設定箇所はタイムライン D&D（HTML:2862）と
   * 編集ドロワーの日付 input（3969）のみで、false に戻す UI 経路は存在しない（spec §4.4）。
   */
  manualDay?: true;
}

/** 単発タスク（`state.extras`）。生成は `submitAdd` の `addType==='single'` 分岐のみ（HTML:3711-3713） */
export interface Extra extends SubTaskFields {
  id: string;
  title: string;
  subj: string;
  size: SizeKey;
  min: number;
  day: ISODateOrEmpty;
  done: boolean;
  /** `'単発タスク' + (memo ? ' · ' + memo : '')` */
  src: string;
  timetablePeriod: number | null;
  timetableDate: ISODate | null;
}

/** 間隔反復のステージ（HTML:3129-3131） */
export type ReviewStage = '翌日' | '3日後' | '1週間後' | '2週間後' | '定着 🎉';

/**
 * 実データには `stageDays` に無い未知の stage 文字列（データ破損 / 将来の legacy）が
 * 入りうる（spec §6.2 規則3）。補完はランタイム側で行うので型は緩める。
 */
export type ReviewStageValue = ReviewStage | (string & {});

/** 復習（`state.reviews`）。spec §6.1 */
export interface Review {
  /** **Firestore の doc id になる**（spec §4.5） */
  id: string;
  /** 系列ルート ID。手動追加時は自分の `id`、次回生成時は `askR.seriesId || askR.id` */
  seriesId: string;
  /** 1 始まり。stage が据え置き/巻き戻しでも必ず +1 される */
  reviewNo: number;
  title: string;
  subj: string;
  stage: ReviewStageValue;
  /** 前回学習日。両生成経路とも `T`（今日） */
  last: ISODate;
  /** 次回復習日 */
  due: ISODate;
  min: number;
  /** `'手動追加'` / `'時間割から追加'`（+ `' · ' + memo`）/ `fmtMD(T) + 'に学習'` */
  src: string;
  timetablePeriod: number | null;
  timetableDate: ISODate | null;
  /** 今日の ToDo に積んであるか */
  added: boolean;
  done: boolean;
  /** `confirmAsk` 完了時に `T`。**表示には一切使われない**（spec §6.1） */
  completedAt?: ISODate;
  /**
   * `dataPatch` M3 の**一時フィールド**（HTML:2223-2251）。
   * 並べ替えの安定化にだけ使い、処理の最後に delete するので**永続化されない**。
   */
  _legacyIndex?: number;
}

/**
 * `studyLog` — **id を持たない**。削除・編集 UI も上限も重複排除もない（spec §4.6）。
 * 書き込みは `confirmAsk`（HTML:3178）と `deletePlan` の完了 seg 移送（3880, 3900）の2箇所のみ。
 */
export interface StudyLogEntry {
  day: ISODate;
  subj: string;
  min: number;
}

/** `scores` — `score` は 0–100 にクランプ済み（HTML:3496-3503 / spec §4.7） */
export interface Score {
  id: string;
  name: string;
  subj: string;
  day: ISODate;
  score: number;
}

/** `countdowns` — 計画（PLANS）とは完全に独立（spec §4.8） */
export interface Countdown {
  id: string;
  title: string;
  /** `/^\d{4}-\d{2}-\d{2}$/` で検証済み（HTML:4092） */
  date: ISODate;
}

/**
 * 時間割の1コマ上書き。実際に書き込まれる patch は
 * `{ subj: next, held: next.trim() ? true : held }` のみ（spec §4.9）。
 */
export interface SlotOverride {
  subj?: string;
  held?: boolean;
}

/** 1日ぶんの上書き。キーは時限（JSON 上は `'1'`..`'7'` の文字列） */
export type DayOverride = Record<string, SlotOverride>;

/**
 * `dayOverrides` — `{ [iso]: { [period]: {subj?, held?} } }`。
 * (v0.9 修正) 読み書きとも `addScheduleDate` に統一済み。旧実装が土日キーで書いた
 * エントリは残るがどこからも読まれない（マイグレーションは行わない）。
 */
export type DayOverrides = Record<ISODate, DayOverride>;

/** `planQuota` — `{ [planId]: number }`（`todoPlanSegs` 内の 0 始まりインデックス。表示専用） */
export type PlanQuota = Record<string, number>;

/** サイドバー・ドロワーの幅（localStorage `'compass-ui'` にも保存, spec §2.8 / §4.13） */
export interface PanelW {
  nav: number;
  search: number;
  editor: number;
  review: number;
  score: number;
}

// ─────────────────────────────────────────────────────────────
// 永続 state（23キー） — spec §4.3 / HTML:2159-2161
// ─────────────────────────────────────────────────────────────

/**
 * `persistentKeys()` が列挙する 23 キーだけを持つ state の部分形。
 * **プロパティの宣言順は `PERSISTENT_KEYS` と同一**（`exportData()` が配列順に代入するため、
 * JSON.stringify のキー順＝保存トリガの文字列一致に効く。spec §4.14「保存判定の注意」）。
 */
export interface PersistentState {
  theme: Theme;
  /** 常に 3 に強制（HTML:2064 初期値 / dataPatch M1 HTML:2208-2209） */
  themeVersion: number;
  view: ViewId;
  navOrder: ViewId[];
  /** plan id の並び（Tests 行 D&D） */
  planOrder: string[];
  /** 平日の上限（分）。±30、60–720 */
  wkMax: number;
  /** 休日の上限（分）。±30、60–720 */
  weMax: number;
  /** ToDo 選択中の task id */
  selId: string | null;
  panelW: PanelW;
  studyLog: StudyLogEntry[];
  scores: Score[];
  countdowns: Countdown[];
  addSubj: string;
  addType: AddType;
  addSize: SizeKey;
  /** 最大4件。`submitAdd` 成功時に先頭追加 */
  recentSubjs: string[];
  dayOverrides: DayOverrides;
  timetableFocusDate: ISODate;
  planQuota: PlanQuota;
  segs: Seg[];
  extras: Extra[];
  reviews: Review[];
  /** seg / extra / review の id が混在。日付をまたいでも一切クリアされない（spec §4.11） */
  order: string[];
}

/**
 * `persistentKeys()`（HTML:2159-2161）— 23キー。**この配列順が保存 JSON のキー順になる**ので
 * 並べ替え厳禁（spec §4.14 / architecture §5）。
 */
export const PERSISTENT_KEYS = [
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
] as const satisfies readonly (keyof PersistentState)[];

export type PersistentKey = (typeof PERSISTENT_KEYS)[number];

/** `undoKeys()`（HTML:2163-2165）— 14キー */
export const UNDO_KEYS = [
  'navOrder',
  'planOrder',
  'wkMax',
  'weMax',
  'studyLog',
  'scores',
  'countdowns',
  'dayOverrides',
  'timetableFocusDate',
  'planQuota',
  'segs',
  'extras',
  'reviews',
  'order',
] as const satisfies readonly (keyof PersistentState)[];

export type UndoKey = (typeof UNDO_KEYS)[number];

/** `undoPayload().state` の形 */
export type UndoState = Pick<PersistentState, UndoKey>;

// ─────────────────────────────────────────────────────────────
// 保存ペイロード（spec §4.2 / §4.14 / §4.16）
// ─────────────────────────────────────────────────────────────

/**
 * `exportData()` の戻り。PUT ボディは `JSON.stringify({ data: exportData() })`（毎回フル置換）。
 * `version` は 1 固定で読み込み側は一切参照しない（デッドフィールド）。
 */
export interface ExportData {
  version: 1;
  plans: Plans;
  state: PersistentState;
}

/** `undoPayload()`（HTML:2167-2171）。**PLANS 全体**がスナップショット対象 */
export interface UndoPayload {
  plans: Plans;
  state: UndoState;
}

/** `dataPatch(raw)` が受ける形（`{data:{…}}` ラッパーも素の `{version,plans,state}` も可, spec §4.15） */
export type RawSavedData =
  | ExportData
  | { data?: unknown; [k: string]: unknown }
  | null
  | undefined;

/** localStorage `'compass-ui'`（`savePrefs()`, HTML:2446-2448 / spec §4.13） */
export interface UiPrefs {
  theme: Theme;
  themeVersion: number;
  panelW: PanelW;
}

// ─────────────────────────────────────────────────────────────
// 一時 state（保存されない） — HTML:2063-2091 / spec §4.3 末尾
// ─────────────────────────────────────────────────────────────

/**
 * `cloudStatus`。architecture §5 により 401/403 の `'login'`（到達不能, spec Q39）は移植しない。
 */
export type CloudStatus = 'loading' | 'saving' | 'saved' | 'local';

/** 今日の ToDo に並ぶ項目の種別（`itemOf(id)`, HTML:2875-2885） */
export type TaskKind = 'seg' | 'extra' | 'rev';

/** ドラッグ中の「今日のタスク」カード */
export interface DragCkItem {
  id: string;
  kind: TaskKind;
}

/** Tests タイムラインのツールチップ（HTML:2745） */
export interface Tooltip {
  x: number;
  y: number;
  title: string;
  sub: string;
}

/** 再配分モード（`redistModeChips`, HTML:3811-3815） */
export type RedistMode = 'even' | 'evenUnlimited' | 'early' | 'late';

/** 理解度（`askGrades`, HTML:3140-3143） */
export type ReviewGrade = 'high' | 'mid' | 'low';

/** Review 表の並び順（`revSortChips`, HTML:3291） */
export type RevSort = 'due' | 'subj';

/** データ画面の期間切替（保存しない, HTML:2071 `dataRange:'all'`） */
export type DataRange = 'all' | 'week' | 'month';

/** Add 画面の自動細分化モード（`addGeneratorChips`, HTML:3656-3659） */
export type AddGenerator = 'manual' | 'duo' | 'chart';

/** Add 画面のミニタスク下書き（HTML:3653） */
export interface AddMini {
  title: string;
  size: SizeKey;
  min: number;
}

/** Add 画面のバリデーションエラー（HTML:3699-3703） */
export interface AddErr {
  title?: string | null;
  subj?: string | null;
  day?: string | null;
}

/** Add 完了バナー（HTML:3716 / 3719 / 3742 ほか、読み出しは 4419-4421） */
export interface AddDone {
  label: string;
  view: ViewId;
  go: string;
}

/** ミニタスク D&D の挿入位置 */
export type DragMiniPos = 'before' | 'after';

/**
 * 保存対象外の state（HTML:2063-2087）。architecture §3 により**レガシーと同名キー・同型**で
 * 単一ストアに同居させる（23キーに含まれないので自然に永続化されない）。
 */
export interface EphemeralState {
  searchOpen: boolean;
  query: string;
  appSwitcherOpen: boolean;
  dragNav: ViewId | null;
  navDragOver: ViewId | null;
  dragPlanRow: string | null;
  dragPlanOver: string | null;
  dragId: string | null;
  dragCkItem: DragCkItem | null;
  dragCkPlan: string | null;
  dragTestSeg: string | null;
  /** `pid + ':' + iso`（HTML:2831） */
  dragTestTarget: string | null;
  dragGoalPlan: string | null;
  tooltip: Tooltip | null;
  toast: string | null;
  redistOpen: boolean;
  redistMode: RedistMode;
  /** plan id、または全計画一括の `'all'` */
  redistPlan: string | null;
  redistPickMode: boolean;
  redistIncludeManual: boolean;
  redistLateDays: number;
  editorPlan: string | null;
  editorCollapsed: boolean;
  edPlanName: string;
  edPlanSubj: string;
  edPlanDue: string;
  edPlanRange: string;
  edPlanType: PlanType;
  edNewTitle: string;
  edNewSize: SizeKey;
  dragMini: string | null;
  dragMiniOver: string | null;
  dragMiniPos: DragMiniPos;
  editMiniName: string | null;
  todoNewSub: string;
  todoNewSize: SizeKey;
  revSel: string | null;
  revFilter: string | null;
  revSort: RevSort;
  revAsk: string | null;
  revAskGrade: ReviewGrade | null;
  revAskSize: SizeKey | null;
  dragRev: string | null;
  revEditName: string | null;
  scoreName: string;
  scoreSubj: string;
  scoreVal: string;
  scoreDay: ISODate;
  scoreSel: string | null;
  dataRange: DataRange;
  countdownTitle: string;
  countdownDate: ISODate;
  addTitle: string;
  addDay: ISODate;
  addDay2: ISODateOrEmpty;
  addMemo: string;
  addMinis: AddMini[];
  addMiniTitle: string;
  addMiniSize: SizeKey;
  addDetailOpen: boolean;
  addGenerator: AddGenerator;
  duoStart: string;
  duoEnd: string;
  duoChunk: string;
  chartStart: string;
  chartEnd: string;
  addErr: AddErr;
  addDone: AddDone | null;
  addSlotSel: number | null;
  addSlotDate: ISODate | null;
  dragQuota: string | null;
  focusOpen: boolean;
  focusRunning: boolean;
  /** 秒。初期 1500（25分） */
  focusRemaining: number;
  /** 分 */
  focusPreset: number;
  cloudStatus: CloudStatus;
  cloudUser: string;
}

/** ストアが持つ state の全体（architecture §3） */
export type AppState = PersistentState & EphemeralState;
