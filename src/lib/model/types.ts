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

import type { Note } from './notes';

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

/**
 * 画面 ID（spec §2.6, HTML:2624-2631 相当）。
 * `'notebook'`（ノート）と `'extract'`（問題抽出）はレガシーに無い追加画面で、
 * ナビの 7 番目・8 番目に並ぶ（docs/notebook/spec.md §8）。
 */
export type ViewId =
  | 'cockpit'
  | 'tests'
  | 'todo'
  | 'review'
  | 'add'
  | 'data'
  | 'notebook'
  | 'extract';

/** タスクサイズ。`SIZE_MIN = { XS:5, S:10, M:20, L:30 }`（HTML:2037） */
export type SizeKey = 'XS' | 'S' | 'M' | 'L';

/** `subSizes[]` は既存分を `''` で埋めて長さを揃える（HTML:3026-3030 / spec §4.4） */
export type SubSize = '' | SizeKey;

/**
 * Add 画面のタスク種別。
 * `'mission'`（毎日）だけレガシーに無い追加で、**その場でタスクを作らず台帳（`missions`）に足す**
 * （docs/daily-mission/plan.md §3.4）。
 */
export type AddType = 'single' | 'review' | 'prep' | 'test' | 'mission';

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

/**
 * 間隔反復のステージ（HTML:3129-3131）。
 * `'当日'` だけレガシーに無い追加で、**ノート取り込みで作られる初回の復習**が名乗る
 * （授業当日に 1 回やる。docs/notebook/spec.md §4.1）。既存の 5 段はそのまま。
 */
export type ReviewStage = '当日' | '翌日' | '3日後' | '1週間後' | '2週間後' | '定着 🎉';

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

/**
 * 集中モードの**実測**1 セッションぶん（docs/daily-mission/plan.md §4.3）。**レガシーに無い追加**。
 *
 * 形は `StudyLogEntry` と同じ 3 フィールドだが、**別のキーに分けて持つ**のが肝。
 * 完了した Extra / Seg の**見積り**分数はすでに `buildStudyEntries` が学習時間に載せているので、
 * 実測を `studyLog` 側へ足すと同じ勉強が二重に数えられる。「見積り（学習時間）」と
 * 「実測（集中した時間）」は別の指標として並べる。
 *
 * 開始時刻のようなタイムスタンプは持たない（日付と分だけ）。保存は毎回フル置換なので、
 * 増える一方の配列に秒精度の情報まで積む理由がない。
 */
export interface FocusLogEntry {
  day: ISODate;
  subj: string;
  /** 実際にタイマーが走った分（切り捨て）。1 分に満たないセッションは記録しない */
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

/**
 * 予習の自動生成の設定（docs/notebook/spec.md §5）。**レガシーに無い追加**。
 * 既定は `{ enabled: true, offSubjects: [] }`。
 */
export interface PrepAutoGenSettings {
  enabled: boolean;
  /** 自動生成しない教科名（時間割上の表記） */
  offSubjects: string[];
}

/**
 * 予習の自動生成の重複防止ログ。**対象日**（翌登校日）→ その日ぶんに生成済みのコマ（1..7）。
 * extras との突き合わせにしないのは、ユーザーが消したタスクを翌起動で復活させないため。
 */
export type PrepGenLog = Record<ISODate, number[]>;

/**
 * Notion 取り込みログの 1 件（docs/notebook/notion-pull.md）。**レガシーに無い追加**。
 *
 * `noteId` はそのコードブロックから作った / 上書きしたノートの id。
 * 検証エラーで取り込めなかったブロックは `''` で記録し、**同じ内容で再挑戦しない**
 * （Notion 側で直せば `edited` が変わるので、そのとき拾い直す）。
 */
export interface NotionPullEntry {
  noteId: string;
  /** そのブロックの Notion `last_edited_time`（ISO 8601）。一致すれば取り込み済み */
  edited: string;
}

/**
 * Notion 取り込みの冪等化ログ。**Notion のコードブロック id → 取り込み結果**。
 *
 * ノート本文の正本は Notion 側（「Compass取り込みJSON」ページ）にあり、
 * Compass は受け取るだけ。同じブロックを毎回上書き取り込みし直さないための記録で、
 * `prepGenLog` と同じく「ユーザーが消したノートを勝手に復活させない」役も担う。
 */
export type NotionPullLog = Record<string, NotionPullEntry>;

/**
 * ミッションの中身が既存機能に繋がっている場合の印（docs/daily-mission/plan.md §4.1）。
 *
 *  - `'weak'` … 弱点ドリル。ToDo カードから**問題抽出の「苦手な順」へ直行**できる
 *
 * 省略時はただの毎日タスク（タイトルどおりのことを自分でやる）。**任意フィールドなので
 * 既存の台帳データはそのまま読める**。
 */
export type MissionKind = 'weak';

/**
 * デイリーミッションの台帳 1 件（docs/daily-mission/plan.md §3.2）。**レガシーに無い追加**。
 *
 * 「毎日やること」そのものはタスクではなく**台帳**として持ち、今日ぶんの実体は
 * `Extra` を自動生成して積む（予習の自動生成と同型）。こうすると ToDo 表示・完了トグル・
 * 集中モード・学習時間の集計がすべて無改修で動く。
 */
export interface Mission {
  /** `'dm' + base36`。生成した `Extra` の id に埋め込む（`dm-{missionId}-{YYYYMMDD}`） */
  id: string;
  title: string;
  /** 時間割の教科名（色分け・集計に乗る）。弱点ドリルは全教科なので `'全教科'` が入る */
  subj: string;
  size: SizeKey;
  /** 実施曜日 0(日)–6(土)。**空配列 = 毎日** */
  dows: number[];
  /** 一時停止フラグ（テスト期間中だけ止める等）。false でも台帳からは消えない */
  active: boolean;
  createdAt: ISODate;
  /** 既存機能への接続（`'weak'` = 弱点ドリル）。無ければただの毎日タスク */
  kind?: MissionKind;
}

/**
 * デイリーミッションの重複防止ログ。**日付 → その日ぶんを生成済みの missionId**。
 * `prepGenLog` と同じく extras との突き合わせにしないのは、ユーザーが消したミッションを
 * 次の起動で復活させないため。
 */
export type MissionGenLog = Record<ISODate, string[]>;

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
  // ↓ ここから先はレガシーに無い追加キー。**必ず末尾に足すこと**（並べ替え厳禁）
  /** 予習の自動生成の設定（docs/notebook/spec.md §5） */
  prepAutoGen: PrepAutoGenSettings;
  /** 予習の自動生成の重複防止ログ */
  prepGenLog: PrepGenLog;
  /** デイリーミッションの台帳（docs/daily-mission/plan.md §3.2） */
  missions: Mission[];
  /** デイリーミッションの重複防止ログ */
  missionGenLog: MissionGenLog;
  /**
   * 「まとめを書く」を提案済みのノート id（docs/daily-mission/plan.md §4.1）。
   *
   * `prepGenLog` / `missionGenLog` が **日付 → その日ぶん**なのに対し、こちらは
   * **noteId 単位で一度きり**。まとめは「その授業を 1 回自分の言葉にする」作業で
   * 毎日くり返すものではないので、消した／無視したノートを翌朝また積むのは
   * 相棒としてしつこいだけになる（粒度を変えている理由）。
   */
  noteSumLog: string[];
  /**
   * 集中モードの実測（docs/daily-mission/plan.md §4.3）。
   * **`studyLog` には合流させない**（完了タスクの見積りと二重計上になる。`FocusLogEntry` 参照）。
   */
  focusLog: FocusLogEntry[];
  /** Notion 取り込みの冪等化ログ（docs/notebook/notion-pull.md）。ブロック id → 取り込み結果 */
  notionPullLog: NotionPullLog;
}

/**
 * `persistentKeys()`（HTML:2159-2161）— レガシーの 23キー + 追加分。
 * **この配列順が保存 JSON のキー順になる**ので並べ替え厳禁（spec §4.14 / architecture §5）。
 * 新しい永続キーは**必ず末尾に追記**する（既存キーの間に差し込むと、内容が同じでも
 * `JSON.stringify` の文字列が変わって無駄な PUT が飛ぶ）。
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
  // ── ここから追加分（末尾追記のみ）
  'prepAutoGen',
  'prepGenLog',
  'missions',
  'missionGenLog',
  'noteSumLog',
  'focusLog',
  'notionPullLog',
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
  // 予習の自動生成ログ。`extras` と一緒に巻き戻さないと、Undo で消えた予習が
  // 「生成済み」のまま二度と作られなくなる（docs/notebook/spec.md §5）
  'prepGenLog',
  // デイリーミッションも同じ理由。台帳（`missions`）も入れるのは、ミッションを足した操作を
  // Undo したときに台帳だけ残って翌起動でまた生成される、を防ぐため
  'missions',
  'missionGenLog',
  // まとめタスクの提案済みログも同じ。Undo で消えた提案が「提案済み」のまま
  // 二度と出てこなくなるのを防ぐ
  'noteSumLog',
  // 集中モードの実測。**`studyLog` の前例に合わせて入れる**。
  // `studyLog` が UNDO_KEYS に居る理由は「勉強の記録には削除・編集 UI が無く（spec §4.6）、
  // 1段 Undo が唯一の取り消し手段だから」で、`focusLog` も同じ性質を持つ ――
  // タイマーを回しっぱなしで席を立った、対象を選び違えたまま集中した、といった誤記録を
  // 直後の Undo で捨てられるようにしておく。
  // なお `focusLog` は他のキーと突き合わせて読まない独立した記録なので、
  // `prepGenLog` 系のような「巻き戻さないと整合が壊れる」理由ではない。
  'focusLog',
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

/**
 * ノート画面（`view: 'notebook'`）の中の切替。
 * `note` = ノートを読む面 / `drill` = **その授業の今日ぶんの問題だけを解く面**
 * （今日の ToDo から飛んでくる）。
 *
 * 問題抽出は独立した画面（`view: 'extract'`）なので、ここには含めない。
 * `'extract'` は旧保存値との互換のためだけに型に残してある。
 */
export type NotebookMode = 'note' | 'extract' | 'drill';

/**
 * ノート画面サイドバーの探し方（チャートノート v2 の `side`）。
 * `tree` = 教科フォルダ / `cal` = 月カレンダー。**同時には出さない**
 * （両方出すとサイドバーが縦に伸びて、ノート一覧がスクロールの外へ落ちる）
 */
export type NotebookSide = 'tree' | 'cal';

/**
 * ノートの紙面をどこまで出すか（`NoteView` のレンズ, spec §8.3）。
 *
 *  - `recall` … **想起問題だけ**。本文も写真もまとめも畳んで、問いと解答だけにする。
 *               「思い出せるか」を試す 1 周目のための面
 *  - `mine`   … 自分のノートだけ。AI の添削・解答・演習を畳む
 *  - `ai`     … 自分のノートに AI の添削を重ねる（全部出す）
 *
 * 左から順に「出す量が増える」並びにしてあるので、スイッチもこの順で置く。
 */
export type NoteLens = 'recall' | 'mine' | 'ai';

/**
 * 問題抽出の並び順。
 *
 *  - `note`     … ノート順（授業日の新しい順 → ノート内の並び）
 *  - `weak`     … 苦手な順（直近の理解度が低い順。同点なら久しく解いていない方が先）
 *  - `stale`    … 久しぶり順（最後に解いた日が古い順。未着手が先頭）
 */
export type NoteExtractSort = 'note' | 'weak' | 'stale';

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
  /**
   * 7日予報の帯で選んだ日（`null` = 絞り込みなし）。docs/daily-mission/plan.md §4.2。
   *
   * 教科の絞り込み（`revFilter`）と **AND** で効く。判定は集計と同じ `matchesForecastDay`
   * ―― 今日を選んだときだけ期限切れも含む（帯の件数と表の行数を必ず一致させるため）。
   * 予報そのものが導出値なので、この選択も保存しない（開き直せば全部の表に戻る）。
   */
  revDueFilter: ISODate | null;
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
  /**
   * デイリーミッションの実施曜日の下書き（0(日)–6(土)）。**空 = 毎日**。
   * 保存するのは登録後の `Mission.dows` だけなので、下書きは一時 state に置く。
   */
  addDows: number[];
  /**
   * デイリーミッションの種類の下書き（`''` = ただの毎日タスク）。
   * プリセット「弱点問題を3問」を押すと `'weak'` になる。`addDows` と同じく下書きなので一時 state。
   */
  addMissionKind: MissionKind | '';
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
  // ── ノート画面（docs/notebook/spec.md §8）。レガシーに無い追加。
  //    `notes` を**一時 state に置く**のが肝: `PERSISTENT_KEYS` に入らないので
  //    `compass-ui-data` が肥大せず、保存トリガ・Undo にも巻き込まれない。
  //    実体は `users/{uid}/notes/{noteId}` と localStorage `compass-notes`。
  /** 読み込み済みのノート（新しい授業日が先） */
  notes: Note[];
  /** クラウド or ローカルからの初回読み込みが終わったか */
  notesLoaded: boolean;
  /** 表示中のノート */
  nbSelNoteId: string | null;
  /** ノートビュー / 問題抽出ビュー */
  nbMode: NotebookMode;
  /** サイドバーの探し方（教科フォルダ / カレンダー） */
  nbSide: NotebookSide;
  /** 問題抽出の並び順 */
  nbExtractSort: NoteExtractSort;
  /** 問題抽出の理解度による絞り込み（`null` = 全部 / `'none'` = まだ解いていない） */
  nbExtractGrade: ReviewGrade | 'none' | null;
  /** カレンダーが表示している月（その月の 1 日の iso） */
  nbMonth: ISODate;
  /** 教科の絞り込み（`null` = 全部） */
  nbSubjFilter: string | null;
  /** ノートの編集モード */
  nbEdit: boolean;
  /**
   * 確認モード。本文の重要語が付箋で伏せられ、クリックで剥がせる。
   *
   * 剥がした / 剥がしていないの状態は**ここに持たない**。DOM のクラスで持つので
   * （`NoteView` の `peel`）、伏せ直しはこのフラグを 1 往復させるだけで済む。
   */
  nbCheck: boolean;
  /**
   * ノート内検索で「いま強調している語」（`''` = 強調なし）。
   *
   * 上の検索欄はノートのタブにいるあいだ**ノートの中身**をさがす（`logic/noteSearch.ts`）。
   * 一覧から 1 件選ぶとポップオーバーは閉じるので、閉じたあとも紙面のどこに
   * その語があるか分かるように、選んだ語をここに残して蛍光ペンを敷いたままにする。
   */
  nbFind: string;
  /**
   * 紙面をどこまで出すか（spec §8.3）。
   *
   * `'mine'`（自分のノートだけ）は、このアプリのノートの立場そのもの
   * ―― 読み返す主体は自分のノートで、AI の文章はその上に載っているだけ ――
   * を 1 つのスイッチにしたもの。`'recall'` はさらに絞って、想起問題だけにする。
   */
  nbLens: NoteLens;
  /** 開いているノートの写真の枚数目（0 始まり） */
  nbScanIx: number;
  /** 拡大表示している写真の `scanId`（`null` = 拡大していない） */
  nbScanZoom: string | null;
  nbImportOpen: boolean;
  nbImportText: string;
  /** 上書き取り込みの対象ノート id（`null` = 新規） */
  nbImportTarget: string | null;
  /** Notion からの受け取りが進行中か（ボタンの連打・起動時との重複を防ぐ） */
  nbNotionBusy: boolean;
  /** 解答の開閉。キーは `'r:'+noteId+':'+cardId` / `'e:'+noteId` / `'x:'+…`（v3 の `open` と同じ流儀） */
  nbRevealed: Record<string, boolean>;
  /** サイドバーの教科アコーディオン */
  nbTreeOpen: Record<string, boolean>;
  /** ドリル中に「ノートの全体（解説・演習・疑問）」を開いているか */
  nbFullNote: boolean;
  /** 理解度モーダルでカードの解答を表示しているか */
  revAskReveal: boolean;
}

/** ストアが持つ state の全体（architecture §3） */
export type AppState = PersistentState & EphemeralState;
