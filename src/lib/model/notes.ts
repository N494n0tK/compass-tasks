/**
 * Compass — 授業ノート（チャートノート統合）の型定義
 *
 * 出典: `CompassNotebook/チャートノート v2|v3.dc.html` の localStorage スキーマ `chartnote-v2`
 * （`seed()` HTML:534-577 / `migrate()` 313-320）を土台に、docs/notebook/spec.md §3 で
 * **カード ID を明示する形**へ拡張したもの。
 *
 * 旧実装との違い:
 *  - 想起問題を指すキーが `qi`（recall の配列インデックス）から `cardId`（安定 ID）に
 *    変わった。旧実装は想起問題を 1 つ削除すると全ブロックの `qi` がずれる潜在バグがあり、
 *    復習カードとのリンクにも耐えられない。
 *    `@1` の貼り付け JSON は互換のため `qi` のまま受け、取り込み時に `cardId` へ解決する
 *    （`lib/logic/noteImport.ts`）。
 *  - `@2` で解説ブロック（`NoteBlock`）そのものを廃止した。本文は `NoteSection` =
 *    **自分のノートの再現**で、AI は各区画への添削として重なる。旧 `blocks` の中身は
 *    取り込み・読み込みのときに `sections` とカードの `guide` へ畳む（同上）。
 *
 * このファイルは純粋な型と定数のみ。React / firebase を import しない。
 */

import type { ISODate, ReviewGrade } from './types';

/**
 * 貼り付け JSON の `schema` フィールドに要求する値（spec §3.2）。
 *
 * `@2` で**本文の意味が反転した**。`@1` は「AI がノートに書いていないことを補足する」
 * `blocks` を持っていたが、`@2` の `sections` は**自分の手書きノートの再現**が本文で、
 * AI はそこへの添削（`ai`）として重なる。取り込みは `@1` も受け続ける
 * （既に貼った JSON を手元に持っている人がいるし、旧プロンプトの出力も救いたい）。
 */
export const NOTE_SCHEMA = 'compass-note@2';

/** 旧スキーマ。取り込み時に `sections` へ読み替える（`lib/logic/noteImport.ts`） */
export const NOTE_SCHEMA_V1 = 'compass-note@1';

/** 受理する `schema` の一覧。先頭が現行版（エラーメッセージでの推奨値） */
export const NOTE_SCHEMAS = [NOTE_SCHEMA, NOTE_SCHEMA_V1] as const;

/**
 * 教科の候補は**時間割から取る**（`logic/timetable.ts` の `timetableSubjects()`）。
 * ここで固定の一覧を持たない ―― 「数学・英語・国語・理科・社会」のような大分類を
 * 持ってしまうと、AI が「社会」と答えて時間割の「歴総 / 地総」と食い違い、
 * 教科の色も予習の突き合わせもズレる（実際に起きた）。
 *
 * 時間割に無い教科でも保存はできる（自由文字列。取り込み時に warning を出すだけ）。
 */
export const NOTE_SUBJECT_OTHER = 'その他';

/**
 * 想起問題の出どころ。
 *
 * コーネル式では**問いを立てるのは自分**なので、ノートに自分で書いた問題を
 * そのまま拾い上げる。AI が補ったものと見分けが付くようにしておき、
 * 紙面では自作の問いを先に並べる（spec §3.6）。
 */
export type NoteCardOrigin = 'self' | 'ai';

/**
 * 想起問題を 1 回解いた記録。
 *
 * 復習の間隔（`Review`）とは別に、**問題そのものの履歴**としてノート側に残す。
 * 復習行は完了すると次の行に置き換わっていくので、「この問題を何回やって、
 * そのときどうだったか」はノートに書いておかないと辿れない。
 */
export interface NoteAttempt {
  /** 解いた日 */
  day: ISODate;
  /** そのときの理解度（`ReviewGrade` と同じ 3 段階） */
  grade: ReviewGrade;
}

/** 理解度の見た目。丸つけの記号そのまま（`ReviewAskModal` / `NoteDrill` と同じ並び） */
export const NOTE_GRADE_META: Readonly<
  Record<ReviewGrade, { icon: string; label: string; token: string }>
> = {
  high: { icon: '◎', label: 'ばっちり', token: 'var(--grn)' },
  mid: { icon: '○', label: 'まあまあ', token: 'var(--tx1)' },
  low: { icon: '△', label: '不安', token: 'var(--pink)' },
};

/** 想起問題 1 問 = 復習カード 1 枚（spec §2） */
export interface NoteCard {
  /** `'c' + base36`。取り込み時に採番し、以後**不変**（復習の `seriesId` に埋め込まれる） */
  cardId: string;
  /** 問題文。`$...$`（行内）/ `$$...$$`（別行）の LaTeX を含みうる */
  q: string;
  /** 解答 */
  a: string;
  /** 方針。空文字可 */
  guide: string;
  /** 出典。空文字可 */
  src: string;
  /** `'self'` = 自分がノートに書いた問い / `'ai'` = AI が補った問い */
  origin: NoteCardOrigin;
  /**
   * 解いた記録。**古い順**（末尾が直近）。
   * 記録するのは理解度を答えた瞬間だけ ―― 解答を開いただけでは増やさない。
   */
  attempts: NoteAttempt[];
}

/** 直近の記録。まだ 1 度も解いていなければ `null` */
export function lastAttemptOf(card: Pick<NoteCard, 'attempts'>): NoteAttempt | null {
  const a = card.attempts;
  return a.length ? a[a.length - 1] : null;
}

/**
 * 「苦手な順」の並び替えキー（小さいほど先）。
 *
 * **不安 → 未着手 → まあまあ → ばっちり** の順にした。
 * 未着手を先頭にしないのは、1 度やって「不安」と答えた問題の方が
 * 「取りこぼしている」ことがはっきりしているから。
 */
export function weaknessRank(card: Pick<NoteCard, 'attempts'>): number {
  const last = lastAttemptOf(card);
  if (!last) return 1;
  return last.grade === 'low' ? 0 : last.grade === 'mid' ? 2 : 3;
}

/**
 * 重要語の色。**3 色に絞る**（まとめノートの 3 色ルール）。
 *
 * 以前は 5 色（red/blue/green/orange/purple）用意していたが、
 * 実際に使うと**5 色は見分けが付かない**（オレンジと赤、紫と青が紙面で溶ける）。
 * 色数を増やすほど「どの色だったか」を思い出す手間が増え、色が意味を運ばなくなる。
 * 旧 5 色のデータは `normalizeKeyColor` / `migrateLegacyKeyColor` でここへ畳む。
 */
export const NOTE_KEY_COLORS = ['red', 'blue', 'green'] as const;

export type NoteKeyColor = (typeof NOTE_KEY_COLORS)[number];

/** 色の意味。キュー欄の凡例と、プロンプトの指示文で共有する */
export const NOTE_KEY_COLOR_MEANING: Record<NoteKeyColor, string> = {
  red: '最重要（用語・定義）',
  blue: '事実（人物・年号・固有名詞）',
  green: 'つながり（因果・対比・例外）',
};

/**
 * 重要語 1 語。コーネル式のキュー欄（左）に出て、本文では色が付く。
 * 確認モードでは本文側が伏せられ、クリックでめくれる。
 */
export interface NoteKeyword {
  /** 本文に現れる語そのもの。**本文と 1 文字も違えない**（一致検索で色を付けるため） */
  term: string;
  color: NoteKeyColor;
  /** キュー欄に添える一言。空文字可 */
  note: string;
}

/** 重要語の上限。キュー欄に収まる量（多すぎると全部が重要でなくなる） */
export const NOTE_KEYWORD_MAX = 24;

/**
 * 自分で撮ったノートの写真 1 枚。**このノートの主役**（spec §8.3）。
 *
 * 画像の実体はここに載せない。Firestore の 1 ドキュメント上限は 1MB で、
 * 写真 1 枚で軽く超える。実体は端末の IndexedDB（`NoteScanStore`）に置き、
 * このメタデータだけをノートのドキュメントに保存する。
 */
export interface NoteScan {
  /** `'s' + base36`。IndexedDB のキー `noteId + ':' + scanId` に使う */
  scanId: string;
  mime: string;
  /** 元画像の寸法。読み込み前でも枠の縦横比を確保して、紙面が飛び跳ねないようにする */
  w: number;
  h: number;
  bytes: number;
  /** 自分で付ける見出し（「p.1 導入」など）。空文字可 */
  caption: string;
}

/** 1 冊のノートに貼れる写真の枚数。1 授業ぶんの見開き数を想定 */
export const NOTE_SCAN_MAX = 12;

/** 1 枚あたりの上限（8MB）。これを超える写真は取り込み時に縮小する */
export const NOTE_SCAN_MAX_BYTES = 8 * 1024 * 1024;

/** 長辺の上限（px）。スマホの写真をそのまま入れると IndexedDB が膨らむので縮める */
export const NOTE_SCAN_MAX_EDGE = 2000;

/**
 * 自分のノートの再現 1 区画と、それへの AI の添削。
 *
 * `@1` の `NoteBlock` から**主役が入れ替わった**。旧構造は AI の補足が本文で、
 * 自分のノートは写真でしか残らなかった。それだと「自分が何を書いたか」を
 * 画面の中で読み返せず、AI の文章を読むだけになる（実際にそうなった）。
 *
 * いまは `text` が主役 ―― 録音とノート写真から GPT が**自分の手書きノートを再現**した
 * 本文で、`ai` はその区画への添削（抜け・誤り・補足）として別色で重なる。
 */
export interface NoteSection {
  /** 自分のノートの見出し（無ければ `''`） */
  heading: string;
  /**
   * 自分のノート本文の再現。KaTeX `$…$` 可、`\n` 区切りの箇条書き行。
   * `''` なら「ノートに無い、AI だけの補足」を表す（添削だけの区画）。
   */
  text: string;
  /** このセクションへの AI の添削・補足（`''` なら無し） */
  ai: string;
}

/**
 * 1 冊のノートの区画数の上限。1 授業ぶんの見開きに収まる量。
 * これを超えるのは AI が段落ごとに切り刻んだときで、内容が増えたわけではない。
 */
export const NOTE_SECTION_MAX = 24;

/** ノート 1 件 = 授業 1 回分 = Firestore の 1 ドキュメント（`users/{uid}/notes/{id}`） */
export interface Note {
  /** `'n' + base36 + rand`。Firestore の doc id（`invalidDocIdReason` で検証済みの形） */
  id: string;
  /** ノートドキュメントのスキーマ版。将来の移行判定用 */
  v: 1;
  /** 授業日 */
  date: ISODate;
  subject: string;
  unit: string;
  /**
   * 自分で撮ったノートの写真。**紙面の主役**（spec §8.3）。
   * 空でも成立する（写真を撮る前に JSON だけ取り込んだノート）。
   */
  scans: NoteScan[];
  cards: NoteCard[];
  /**
   * 本文。**自分の手書きノートの再現**を区画ごとに並べたもの。
   * AI の言い分は各区画の `ai`（添削）に入り、本文とは別色で重なる（spec §3.8）。
   */
  sections: NoteSection[];
  /**
   * コーネル式の下段。**自分が書く欄**（doubt と同じ原則。spec §3.6）。
   * 取り込みでは「ノートに書いたまとめの転記」だけが入り、無ければ空のまま。
   * AI に要約を作らせない ―― ここを自分の言葉で埋めるのが復習の仕上げだから。
   */
  summary: string;
  /** 重要語。本文で色が付き、キュー欄に並び、確認モードで伏せられる */
  keywords: NoteKeyword[];
  /** 仕上げの 1 問。**カードにはしない**（spec §2） */
  exercise: { q: string; a: string };
  /** **自分がノートに書いた疑問だけ**。AI に作らせない（spec §3.6）。1 行 1 件 */
  doubt: string;
  notice: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** `recall` の上限（旧実装の `recallMax` は 3..8 で既定 5。上限だけ引き継ぐ） */
export const NOTE_CARD_MAX = 8;

/** ノート内のカード番号（1 始まり）。復習タイトル `単元 問N` に使う */
export function cardNoOf(note: Pick<Note, 'cards'>, cardId: string): number {
  return note.cards.findIndex((c) => c.cardId === cardId) + 1;
}

