/**
 * 重要語とキュー欄（docs/notebook/spec.md §3.5 / §8.2、受け入れ N-088〜N-093）
 */

import { describe, expect, it } from 'vitest';

import type { NoteKeyword, NoteSection } from '../../model/notes';
import {
  assignCues,
  migrateLegacyKeyColor,
  normalizeKeyColor,
  sectionSearchText,
  splitByKeywords,
} from '../noteKeywords';

function kw(term: string, color: NoteKeyword['color'] = 'red'): NoteKeyword {
  return { term, color, note: '' };
}

/** 自分のノートの区画（本文だけ） */
function sec(heading: string, text: string): NoteSection {
  return { heading, text, ai: '' };
}

describe('normalizeKeyColor', () => {
  it('現行の 3 色はそのまま通す', () => {
    expect(normalizeKeyColor('red')).toBe('red');
    expect(normalizeKeyColor('blue')).toBe('blue');
    expect(normalizeKeyColor('green')).toBe('green');
  });

  it('旧 5 色は 3 色へ畳む（orange→green / purple→blue）', () => {
    expect(normalizeKeyColor('orange')).toBe('green');
    expect(normalizeKeyColor('purple')).toBe('blue');
  });

  it('新スキーマの green は green のまま（読み込みのたびに青へ化けない）', () => {
    expect(normalizeKeyColor('green')).toBe('green');
  });

  it('N-088 知らない色・欠落は red に寄せる（取り込みを止めない）', () => {
    expect(normalizeKeyColor('#ff0000')).toBe('red');
    expect(normalizeKeyColor(undefined)).toBe('red');
    expect(normalizeKeyColor(3)).toBe('red');
  });
});

describe('migrateLegacyKeyColor', () => {
  it('旧 green（年号・数値）は blue（事実）へ送る', () => {
    expect(migrateLegacyKeyColor('green')).toBe('blue');
  });

  it('それ以外は normalizeKeyColor と同じ', () => {
    expect(migrateLegacyKeyColor('orange')).toBe('green');
    expect(migrateLegacyKeyColor('purple')).toBe('blue');
    expect(migrateLegacyKeyColor('red')).toBe('red');
    expect(migrateLegacyKeyColor('gold')).toBe('red');
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
  const sections: NoteSection[] = [
    sec('産業革命', '18世紀のイギリスで産業革命が起きた。'),
    sec('奴隷制', '南部では奴隷制が支えていた。'),
    { heading: '', text: '', ai: 'ミズーリ協定を思い出す' },
  ];

  it('N-091 重要語は「初めて出てくる区画」に付く', () => {
    const { perSection } = assignCues(sections, [kw('産業革命'), kw('奴隷制'), kw('ミズーリ協定')]);
    expect(perSection).toEqual([[0], [1], [2]]);
  });

  it('2 回目以降の出現ではキューに並べない（左段が同じ語で埋まらない）', () => {
    const twice: NoteSection[] = [sec('a', '綿工業'), sec('b', '綿工業')];
    expect(assignCues(twice, [kw('綿工業')]).perSection).toEqual([[0], []]);
  });

  it('N-092 本文に無い語は orphans に落ちる（黙って消さない）', () => {
    const { perSection, orphans } = assignCues(sections, [kw('産業革命'), kw('存在しない語')]);
    expect(perSection).toEqual([[0], [], []]);
    expect(orphans).toEqual([1]);
  });

  it('同じ区画内は登録順に並ぶ', () => {
    const one: NoteSection[] = [sec('h', 'BとA')];
    expect(assignCues(one, [kw('A'), kw('B')]).perSection).toEqual([[0, 1]]);
  });

  it('N-093 見出し・自分の本文・AI の添削のどこに出ても拾う', () => {
    const s: NoteSection = { heading: '見出し語', text: '本文語', ai: '添削語' };
    expect(sectionSearchText(s)).toBe('見出し語\n本文語\n添削語');
    expect(assignCues([s], [kw('添削語')]).perSection).toEqual([[0]]);
    expect(assignCues([s], [kw('見出し語')]).perSection).toEqual([[0]]);
  });
});
