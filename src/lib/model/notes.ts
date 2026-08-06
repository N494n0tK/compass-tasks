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

import type { ISODate } from './types';

/** 貼り付け JSON の `schema` フィールドに要求する値（spec §3.2） */
export const NOTE_SCHEMA = 'compass-note@1';

/** プロンプト B が選ぶ教科の候補。**制約ではない**（自由文字列も通す, spec §12-5） */
export const NOTE_SUBJECTS = ['数学', '英語', '国語', '理科', '社会', 'その他'] as const;

export type NoteSubjectSuggestion = (typeof NOTE_SUBJECTS)[number];

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
}

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
  cards: NoteCard[];
  blocks: NoteBlock[];
  /** 仕上げの 1 問。**カードにはしない**（spec §2） */
  exercise: { q: string; a: string };
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
