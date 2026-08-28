import { describe, expect, it } from 'vitest';
import { auditNote, auditNotes } from '../noteAudit';
import type { Note, NoteCard, NoteKeyword } from '../../model/notes';

const KNOWN: ReadonlySet<string> = new Set(['数学', '言語', 'その他']);

function card(over: Partial<NoteCard> = {}): NoteCard {
  return { cardId: 'c1', q: '問', a: '答', guide: '', src: '', origin: 'self', attempts: [], ...over };
}

/** 本文には重要語 6 語がすべて出てくる。この状態が「指摘ゼロ」の基準 */
const BODY = '加法定理 … sin(α+β) の展開\n余弦定理 … a²=b²+c²-2bc cosA\n正弦定理 … a/sinA=2R\n弧度法 … 角を弧長で測る\n単位円 … 半径 1 の円\n周期 … 繰り返しの幅';

function keywords(terms: string[]): NoteKeyword[] {
  return terms.map((term) => ({ term, color: 'red', note: '' }));
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-27',
    subject: '数学',
    unit: '三角関数',
    scans: [],
    cards: [
      card({ cardId: 'c1', origin: 'self' }),
      card({ cardId: 'c2', origin: 'ai' }),
      card({ cardId: 'c3', origin: 'ai' }),
    ],
    sections: [{ heading: '導入', text: '', ai: BODY }],
    summary: '',
    keywords: keywords(['加法定理', '余弦定理', '正弦定理', '弧度法', '単位円', '周期']),
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-27',
    updatedAt: '2026-08-27',
    trashedAt: '',
    ...over,
  };
}

function codes(n: Note): string[] {
  return auditNote(n, KNOWN).findings.map((f) => f.code);
}

describe('auditNote', () => {
  it('約束どおりのノートは指摘ゼロ', () => {
    const r = auditNote(note(), KNOWN);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('本文に無い重要語を見つける（部分一致で色が塗れないので索引として死ぬ）', () => {
    const n = note({ keywords: keywords(['加法定理', '余弦定理', '正弦定理', '弧度法', '単位円', '三角比']) });
    const r = auditNote(n, KNOWN);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.message)).toContain(
      '重要語「三角比」が本文に無い（部分一致で色を塗れない）',
    );
  });

  it('本文の語を言い換えた重要語も落とす（1 文字違えば当たらない）', () => {
    // 本文は「加法定理」。`加法の定理` は部分一致しない
    const n = note({ keywords: keywords(['加法の定理', '余弦定理', '正弦定理', '弧度法', '単位円', '周期']) });
    expect(codes(n)).toContain('keyword_missing');
  });

  it('本文の一部を切り出した重要語は通る（部分一致で当たるため）', () => {
    const n = note({ keywords: keywords(['加法', '余弦定理', '正弦定理', '弧度法', '単位円', '周期']) });
    expect(auditNote(n, KNOWN).ok).toBe(true);
  });

  it('重要語の数と色を見る', () => {
    expect(codes(note({ keywords: keywords(['加法定理']) }))).toContain('keyword_count');
    const bad = note({ keywords: [{ term: '加法定理', color: 'orange' as never, note: '' }] });
    expect(codes(bad)).toContain('keyword_color');
  });

  it('想起問題の数と、解答の欠けを見る', () => {
    expect(codes(note({ cards: [card()] }))).toContain('recall_count');
    const noAnswer = note({
      cards: [card({ cardId: 'c1' }), card({ cardId: 'c2', a: '  ' }), card({ cardId: 'c3' })],
    });
    expect(codes(noAnswer)).toContain('recall_no_a');
  });

  it('self が ai より後ろにあると指摘する（自分の問いが埋もれる）', () => {
    const n = note({
      cards: [
        card({ cardId: 'c1', origin: 'ai' }),
        card({ cardId: 'c2', origin: 'self' }),
        card({ cardId: 'c3', origin: 'ai' }),
      ],
    });
    expect(codes(n)).toContain('recall_order');
  });

  it('区画が空、教科が一覧に無い、を見る', () => {
    expect(codes(note({ sections: [] }))).toContain('sections_empty');
    expect(codes(note({ sections: [{ heading: 'x', text: '  ', ai: '' }] }))).toContain('section_blank');
    expect(codes(note({ subject: '社会' }))).toContain('subject_unknown');
  });

  it('自分のまとめは指摘にしない ―― 誰が書いたかここからは分からないので事実だけ返す', () => {
    const written = auditNote(note({ summary: '今日は加法定理をやった' }), KNOWN);
    expect(written.summary_written).toBe(true);
    expect(written.ok).toBe(true);
    expect(auditNote(note(), KNOWN).summary_written).toBe(false);
  });
});

describe('auditNotes', () => {
  it('指摘の種類ごとに数える', () => {
    const bad = note({ id: 'n2', keywords: keywords(['無い語', '余弦定理', '正弦定理', '弧度法', '単位円', '周期']) });
    const r = auditNotes([note(), bad], KNOWN);
    expect(r.checked).toBe(2);
    expect(r.flagged).toBe(1);
    expect(r.by_code.keyword_missing).toBe(1);
  });

  it('1 冊も無ければ指摘ゼロ', () => {
    expect(auditNotes([], KNOWN)).toMatchObject({ checked: 0, flagged: 0, by_code: {} });
  });
});
