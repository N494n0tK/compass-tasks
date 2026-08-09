/**
 * Compass — 重要語とキュー欄（コーネル式ノートの左段）
 *
 * 仕様: docs/notebook/spec.md §3.5 / §8.2。受け入れ N-088〜N-097。
 *
 * コーネル式ノートは紙を 3 つに割る。上（このアプリでは想起問題）、
 * 右の広い本文、左の細いキュー欄、そして下のまとめ。キュー欄には
 * 「本文のその高さで出てくる語」を書いておき、本文を隠して左だけを見て
 * 思い出す ―― という使い方をする。
 *
 * ここでやるのは 2 つだけ:
 *  1. 重要語が**本文のどのブロックで初めて出てくるか**を求める（`assignCues`）。
 *     キュー欄はその行に置かれるので、「出てくるタイミングで見せる」が成立する。
 *  2. 本文の文字列を「素の部分」と「重要語の部分」に切り分ける（`splitByKeywords`）。
 *     描画（`NoteMath`）はこの切れ目に色を塗り、確認モードでは伏せる。
 *
 * 語の一致は**単純な部分文字列一致**。日本語には語境界が無いので、
 * 「革命」と「産業革命」が両方登録されていると短い方が先に食ってしまう。
 * それを避けるため、常に**長い語から**当てる（`byLengthDesc`）。
 *
 * 純ロジック。React / firebase / DOM を import しない。
 */

import {
  NOTE_KEY_COLORS,
  type NoteBlock,
  type NoteKeyColor,
  type NoteKeyword,
} from '../model/notes';

/** 未知の色は `red`（既定色）に寄せる。取り込みと sanitize の両方から使う */
export function normalizeKeyColor(v: unknown): NoteKeyColor {
  return typeof v === 'string' && (NOTE_KEY_COLORS as readonly string[]).includes(v)
    ? (v as NoteKeyColor)
    : 'red';
}

/**
 * ブロック 1 個の「検索対象になる文字列」。
 * 見出し・本文・方針・解答・注意を全部つないだもの（重要語はどこに出てもよい）。
 */
export function blockSearchText(block: NoteBlock): string {
  return block.t === 'def'
    ? block.title + '\n' + block.body
    : block.guide + '\n' + block.solution + '\n' + block.caution;
}

/** 長い語が先。同じ長さなら元の並び順を保つ（安定ソート前提） */
function byLengthDesc(keywords: readonly NoteKeyword[]): { kw: NoteKeyword; index: number }[] {
  return keywords
    .map((kw, index) => ({ kw, index }))
    .filter((e) => !!e.kw.term)
    .sort((a, b) => b.kw.term.length - a.kw.term.length);
}

export interface CueAssignment {
  /** `blocks` と同じ長さ。各ブロックのキュー欄に出す重要語のインデックス */
  perBlock: number[][];
  /** どのブロックにも出てこなかった重要語。キュー欄の先頭にまとめて出す */
  orphans: number[];
}

/**
 * 重要語を「初めて出てくるブロック」に割り当てる。
 *
 * 1 語は 1 か所にしか出さない。2 回目以降の出現でもキュー欄に並べると
 * 左段が同じ語で埋まって、キューとして機能しなくなるため。
 */
export function assignCues(
  blocks: readonly NoteBlock[],
  keywords: readonly NoteKeyword[],
): CueAssignment {
  const perBlock: number[][] = blocks.map(() => []);
  const orphans: number[] = [];
  keywords.forEach((kw, i) => {
    if (!kw.term) return;
    const at = blocks.findIndex((b) => blockSearchText(b).includes(kw.term));
    if (at < 0) orphans.push(i);
    else perBlock[at].push(i);
  });
  // 各ブロック内は登録順（= プロンプトが出した順 = だいたい本文に出てくる順）
  perBlock.forEach((list) => list.sort((a, b) => a - b));
  return { perBlock, orphans };
}

/** `splitByKeywords` の 1 片。`keywordIndex` が `null` なら素のテキスト */
export interface KeywordPiece {
  text: string;
  keywordIndex: number | null;
}

/**
 * 文字列を重要語で切り分ける。
 *
 * ```ts
 * splitByKeywords('18世紀の産業革命', [{term:'産業革命',…}])
 * // → [{text:'18世紀の', keywordIndex:null}, {text:'産業革命', keywordIndex:0}]
 * ```
 *
 * 重なりは起きない（当たった語のぶんだけ読み進める）。長い語が優先される。
 */
export function splitByKeywords(
  text: string,
  keywords: readonly NoteKeyword[],
): KeywordPiece[] {
  const sorted = byLengthDesc(keywords);
  if (!text || !sorted.length) return text ? [{ text, keywordIndex: null }] : [];

  const pieces: KeywordPiece[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    let matched: { term: string; index: number } | null = null;
    for (const e of sorted) {
      if (text.startsWith(e.kw.term, i)) {
        matched = { term: e.kw.term, index: e.index };
        break;
      }
    }
    if (!matched) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain) {
      pieces.push({ text: plain, keywordIndex: null });
      plain = '';
    }
    pieces.push({ text: matched.term, keywordIndex: matched.index });
    i += matched.term.length;
  }
  if (plain) pieces.push({ text: plain, keywordIndex: null });
  return pieces;
}
