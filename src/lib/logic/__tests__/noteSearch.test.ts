/**
 * ノート内検索（ノートのタブの検索欄。`logic/noteSearch.ts`）
 *
 * 見ているのは 2 つ:
 *  - **順番**。キュー欄（左段）の重要語が本文より先に出ること
 *  - **絞り込みと一覧が同じ見方であること**。一覧に出た語を持つノートが
 *    サイドバーから消えていたら、そこから辿れない
 */

import { describe, expect, it } from 'vitest';

import type { Note, NoteCard, NoteKeyword, NoteSection } from '../../model/notes';
import { noteMatchesQuery, searchNotes, snippetAround } from '../noteSearch';

function kw(term: string, note = '', color: NoteKeyword['color'] = 'red'): NoteKeyword {
  return { term, color, note };
}

function sec(heading: string, text: string, ai = ''): NoteSection {
  return { heading, text, ai };
}

function card(q: string, a = '', origin: NoteCard['origin'] = 'self'): NoteCard {
  return { cardId: 'c' + q, q, a, guide: '', src: '', origin, attempts: [] };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-06',
    subject: '数学',
    unit: '数列',
    scans: [],
    cards: [],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-06',
    updatedAt: '2026-08-06',
    ...over,
  };
}

describe('searchNotes', () => {
  it('語が空なら 1 件も返さない（打つ前に一覧を出さない）', () => {
    expect(searchNotes([note({ keywords: [kw('漸化式')] })], '  ')).toEqual([]);
  });

  it('キュー欄の重要語 → 本文 → 想起問題 の順に出す', () => {
    const n = note({
      keywords: [kw('漸化式', '隣の項の関係式')],
      sections: [sec('漸化式とは', '漸化式 = 隣り合う項の関係式')],
      cards: [card('漸化式とは何か?', '隣り合う項の関係式')],
    });
    expect(searchNotes([n], '漸化式').map((h) => h.kind)).toEqual(['cue', 'body', 'card']);
  });

  it('キュー欄のヒットは語の色を持って返る（一覧でも紙面と同じ姿で照合できる）', () => {
    const n = note({ keywords: [kw('望遠鏡和', '途中が消える', 'green')] });
    const [hit] = searchNotes([n], '望遠鏡');
    expect(hit.color).toBe('green');
    expect(hit.term).toBe('望遠鏡和');
    expect(hit.where).toBe('キュー欄');
  });

  it('重要語に添えたひとことだけに当たっても、その語を返す', () => {
    const n = note({ keywords: [kw('別に確認', 'n=1 は例外')] });
    expect(searchNotes([n], '例外').map((h) => h.term)).toEqual(['別に確認']);
  });

  it('本文は節ごとに 1 行（同じ節に 2 回出ても増やさない）', () => {
    const n = note({ sections: [sec('基本 3 型', '漸化式は 3 型\n漸化式に帰着させる')] });
    expect(searchNotes([n], '漸化式')).toHaveLength(1);
  });

  it('AI の添削だけに当たっても本文のヒットとして拾う', () => {
    const n = note({ sections: [sec('等比の和', 'S_n を作る', 'r=1 のときは場合分けが要る')] });
    expect(searchNotes([n], '場合分け').map((h) => h.kind)).toEqual(['body']);
  });

  it('同じ語が別の冊子に出てきたら、どちらも出す（どの授業で出たかを並べる）', () => {
    const a = note({ id: 'n1', unit: '数列', keywords: [kw('帰着')] });
    const b = note({ id: 'n2', unit: '整数', keywords: [kw('帰着')] });
    expect(searchNotes([a, b], '帰着').map((h) => h.noteId)).toEqual(['n1', 'n2']);
  });

  it('大文字小文字は無視する', () => {
    const n = note({ sections: [sec('', 'Sum of series')] });
    expect(searchNotes([n], 'SUM')).toHaveLength(1);
  });

  it('limit を超えたら切る', () => {
    const n = note({ keywords: Array.from({ length: 9 }, (_, i) => kw('語' + i + 'x')) });
    expect(searchNotes([n], 'x', 4)).toHaveLength(4);
  });
});

describe('snippetAround', () => {
  it('当たったところの前後を切り出し、外側を … で示す', () => {
    const long = 'あ'.repeat(40) + '望遠鏡和' + 'い'.repeat(60);
    const s = snippetAround(long, '望遠鏡和');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('望遠鏡和');
  });

  it('数式の $ は落とす（一覧は素の文字列で出すので区切りだけが残ると読みにくい）', () => {
    expect(snippetAround('$n\\ge 2$ のとき', 'とき')).not.toContain('$');
  });

  it('改行は 1 行に潰す', () => {
    expect(snippetAround('一行め\n二行め', '二行')).toBe('一行め 二行め');
  });
});

describe('noteMatchesQuery', () => {
  const n = note({
    unit: '数列',
    keywords: [kw('望遠鏡和', '途中が消える')],
    sections: [sec('階差数列', '辺々加えると途中が消える')],
    cards: [card('一般項は?', '$a_n=a+(n-1)d$')],
    notice: '問題集 p.84 を金曜までに提出',
  });

  it('語が空なら全部通す', () => {
    expect(noteMatchesQuery(n, '')).toBe(true);
  });

  it('ヒット一覧が拾うところは絞り込みも拾う（キュー欄・本文・想起問題）', () => {
    expect(noteMatchesQuery(n, '望遠鏡和')).toBe(true);
    expect(noteMatchesQuery(n, '階差')).toBe(true);
    expect(noteMatchesQuery(n, '一般項')).toBe(true);
  });

  it('連絡・単元名でも残す（一覧に出ないノートが左から消えると辿れない）', () => {
    expect(noteMatchesQuery(n, '金曜')).toBe(true);
    expect(noteMatchesQuery(n, '数列')).toBe(true);
  });

  it('どこにも無ければ落とす', () => {
    expect(noteMatchesQuery(n, 'ベクトル')).toBe(false);
  });
});
