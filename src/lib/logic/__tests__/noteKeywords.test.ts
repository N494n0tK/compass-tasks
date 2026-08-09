/**
 * 重要語とキュー欄（docs/notebook/spec.md §3.5 / §8.2、受け入れ N-088〜N-093）
 */

import { describe, expect, it } from 'vitest';

import type { NoteBlock, NoteKeyword } from '../../model/notes';
import { assignCues, blockSearchText, normalizeKeyColor, splitByKeywords } from '../noteKeywords';

function kw(term: string, color: NoteKeyword['color'] = 'red'): NoteKeyword {
  return { term, color, note: '' };
}

function def(title: string, body: string): NoteBlock {
  return { t: 'def', title, body };
}

describe('normalizeKeyColor', () => {
  it('5 色はそのまま通す', () => {
    expect(normalizeKeyColor('blue')).toBe('blue');
    expect(normalizeKeyColor('purple')).toBe('purple');
  });

  it('N-088 知らない色・欠落は red に寄せる（取り込みを止めない）', () => {
    expect(normalizeKeyColor('#ff0000')).toBe('red');
    expect(normalizeKeyColor(undefined)).toBe('red');
    expect(normalizeKeyColor(3)).toBe('red');
  });
});

describe('splitByKeywords', () => {
  it('N-089 重要語のところで切れる', () => {
    const out = splitByKeywords('18世紀の産業革命が始まった', [kw('産業革命')]);
    expect(out).toEqual([
      { text: '18世紀の', keywordIndex: null },
      { text: '産業革命', keywordIndex: 0 },
      { text: 'が始まった', keywordIndex: null },
    ]);
  });

  it('N-090 長い語が先に当たる（「革命」に「産業革命」を食わせない）', () => {
    const out = splitByKeywords('産業革命と名誉革命', [kw('革命'), kw('産業革命')]);
    expect(out).toEqual([
      { text: '産業革命', keywordIndex: 1 },
      { text: 'と名誉', keywordIndex: null },
      { text: '革命', keywordIndex: 0 },
    ]);
  });

  it('同じ語が何度出ても、そのつど切れる', () => {
    const out = splitByKeywords('綿工業。綿工業。', [kw('綿工業')]);
    expect(out.filter((p) => p.keywordIndex === 0)).toHaveLength(2);
  });

  it('空文字の term は無視する（編集中の空行で全文が切り刻まれない）', () => {
    const out = splitByKeywords('あいうえお', [kw('')]);
    expect(out).toEqual([{ text: 'あいうえお', keywordIndex: null }]);
  });

  it('重要語が 0 語なら素通し', () => {
    expect(splitByKeywords('本文', [])).toEqual([{ text: '本文', keywordIndex: null }]);
    expect(splitByKeywords('', [kw('a')])).toEqual([]);
  });
});

describe('assignCues', () => {
  const blocks: NoteBlock[] = [
    def('産業革命', '18世紀のイギリスで産業革命が起きた。'),
    def('奴隷制', '南部では奴隷制が支えていた。'),
    { t: 'ex', cardId: 'c0', guide: '', solution: 'ミズーリ協定を思い出す', caution: '' },
  ];

  it('N-091 重要語は「初めて出てくるブロック」に付く', () => {
    const { perBlock } = assignCues(blocks, [kw('産業革命'), kw('奴隷制'), kw('ミズーリ協定')]);
    expect(perBlock).toEqual([[0], [1], [2]]);
  });

  it('2 回目以降の出現ではキューに並べない（左段が同じ語で埋まらない）', () => {
    const twice: NoteBlock[] = [def('a', '綿工業'), def('b', '綿工業')];
    expect(assignCues(twice, [kw('綿工業')]).perBlock).toEqual([[0], []]);
  });

  it('N-092 本文に無い語は orphans に落ちる（黙って消さない）', () => {
    const { perBlock, orphans } = assignCues(blocks, [kw('産業革命'), kw('存在しない語')]);
    expect(perBlock).toEqual([[0], [], []]);
    expect(orphans).toEqual([1]);
  });

  it('同じブロック内は登録順に並ぶ', () => {
    const one: NoteBlock[] = [def('h', 'BとA')];
    expect(assignCues(one, [kw('A'), kw('B')]).perBlock).toEqual([[0, 1]]);
  });

  it('N-093 ex ブロックは方針・解答・注意のどこに出ても拾う', () => {
    const ex: NoteBlock[] = [{ t: 'ex', cardId: null, guide: '', solution: '', caution: '要注意語' }];
    expect(blockSearchText(ex[0])).toContain('要注意語');
    expect(assignCues(ex, [kw('要注意語')]).perBlock).toEqual([[0]]);
  });
});
