/**
 * Compass — 授業ノート（チャートノート統合）の型定義
 *
 * 出典: `CompassNotebook/チャートノート v2|v3.dc.html` の localStorage スキーマ `chartnote-v2`
 * （`seed()` HTML:534-577 / `migrate()` 313-320）を土台に、docs/notebook/spec.md §3 で
 * **カード ID を明示する形**へ拡張したもの。
 *
 * 旧実装との違いは 1 点だけ:
 *  - 解説ブロックが想起問題を指すキーが `qi`（recall の配列インデックス）から
 *    `cardId`（安定 ID）に変わった。旧実装は想起問題を 1 つ削除すると全ブロックの `qi` が
 *    ずれる潜在バグがあり、復習カードとのリンクにも耐えられない。
 *    貼り付け JSON は互換のため `qi` のまま受け、取り込み時に `cardId` へ解決する
 *    （`lib/logic/noteImport.ts`）。
 *
 * このファイルは純粋な型と定数のみ。React / firebase を import しない。
 */

import type { ISODate, ReviewGrade } from './types';

/** 貼り付け JSON の `schema` フィールドに要求する値（spec §3.2） */
export const NOTE_SCHEMA = 'compass-note@1';

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
 * 重要語の色。**5 色しか用意しない**のは、色に意味を持たせるため
 * （spec §3.5 の対応表。プロンプトも同じ割り当てを指示する）。
 */
export const NOTE_KEY_COLORS = ['red', 'blue', 'green', 'orange', 'purple'] as const;

export type NoteKeyColor = (typeof NOTE_KEY_COLORS)[number];

/** 色の意味。キュー欄の凡例と、プロンプトの指示文で共有する */
export const NOTE_KEY_COLOR_MEANING: Record<NoteKeyColor, string> = {
  red: '用語・定義',
  blue: '人物・固有名詞',
  green: '年号・数値',
  orange: '因果・変化',
  purple: '対比・例外',
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

/** 解説欄の要素。`def` = 定義カード、`ex` = 想起問題に紐づく解説 */
export type NoteBlock =
  | { t: 'def'; title: string; body: string }
  | {
      t: 'ex';
      /** 対応する想起問題の `cardId`。未対応は `null`（旧 `qi: null` 相当） */
      cardId: string | null;
      guide: string;
      solution: string;
      caution: string;
    };

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
   * AI の補足。**ノートに書いてあることの写しではなく、書いていないこと**
   * （録音・スライドから分かった要点）と、想起問題の解答・解説だけを入れる（spec §3.8）。
   */
  blocks: NoteBlock[];
  /**
   * コーネル式の下段。授業 1 回を数行でまとめたもの。
   * 想起問題（上）とキュー欄（左）に対する「自分の言葉での要約」にあたる。
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

/** `cardId` から解説ブロックを引く（旧 `blocks.findIndex(b => b.t==='ex' && b.qi === i)` 相当） */
export function exBlockOf(
  note: Pick<Note, 'blocks'>,
  cardId: string,
): Extract<NoteBlock, { t: 'ex' }> | null {
  for (const b of note.blocks) {
    if (b.t === 'ex' && b.cardId === cardId) return b;
  }
  return null;
}
