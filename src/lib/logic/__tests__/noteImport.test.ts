import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NOTE_SCHEMA, type Note } from '../../model/notes';
import { diffCards, importSummary, parseNoteJson } from '../noteImport';

/** 基準日。vitest は TZ=Asia/Tokyo 固定（vitest.config.ts） */
const T = '2026-08-06';

/** 決定的な ID 生成（既定は Date.now + 乱数） */
const IDS = {
  newNoteId: () => 'nTEST',
  newCardId: (i: number) => 'c' + i,
};

/** docs/notebook/fixtures/*.json を**そのまま**読む（コピーを置かないので仕様と必ず一致する） */
function fixture(name: string): string {
  return readFileSync(new URL('../../../../docs/notebook/fixtures/' + name, import.meta.url), 'utf8');
}

/** 最小の有効ペイロード。個別テストで壊して使う */
function minimal(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: NOTE_SCHEMA,
    date: '2026-08-06',
    subject: '数学',
    unit: '三角比',
    recall: [{ q: '正弦定理を書け', a: '$\\dfrac{a}{\\sin A}=2R$' }],
    ...over,
  });
}

function ok(res: ReturnType<typeof parseNoteJson>): Note {
  if (!res.ok) throw new Error('期待に反して失敗: ' + JSON.stringify(res.errors));
  return res.note;
}

function paths(res: ReturnType<typeof parseNoteJson>): string[] {
  if (res.ok) throw new Error('期待に反して成功した');
  return res.errors.map((e) => e.path);
}

describe('parseNoteJson — 正常系（N-001 / N-012 / N-013 / N-014 / N-015）', () => {
  it('N-001 フィクスチャを取り込むと recall と同じ枚数のカードになる', () => {
    const res = parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS });
    const note = ok(res);
    expect(note.cards).toHaveLength(4);
    expect(note.subject).toBe('数学');
    expect(note.unit).toBe('数列 ─ 漸化式と一般項');
    expect(note.date).toBe('2026-08-06');
    expect(note.v).toBe(1);
    expect(note.createdAt).toBe(T);
    expect(note.updatedAt).toBe(T);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-001 LaTeX が壊れずに保持される', () => {
    const note = ok(parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS }));
    expect(note.cards[2].q).toContain('\\{a_n\\}');
    expect(note.cards[3].a).toBe('$S_n=\\dfrac{a(r^n-1)}{r-1}$');
    expect(note.exercise.a).toContain('$$');
  });

  it('N-012 blocks の qi が対応する cardId に解決される', () => {
    const note = ok(parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS }));
    const ex = note.blocks.filter((b) => b.t === 'ex');
    expect(ex).toHaveLength(4);
    expect(ex.map((b) => (b.t === 'ex' ? b.cardId : null))).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(note.blocks[0]).toEqual({
      t: 'def',
      title: '漸化式',
      body: expect.stringContaining('隣り合う項'),
    });
  });

  it('N-012 英語フィクスチャは qi が飛んでいても正しく解決される', () => {
    const note = ok(parseNoteJson(fixture('note-english-valid.json'), { today: T, ...IDS }));
    expect(note.cards).toHaveLength(3);
    const ex = note.blocks.filter((b) => b.t === 'ex');
    expect(ex.map((b) => (b.t === 'ex' ? b.cardId : null))).toEqual(['c0', 'c2']);
  });

  it('N-013 exercise / doubt / notice を省略しても既定値で通る', () => {
    const note = ok(parseNoteJson(minimal(), { today: T, ...IDS }));
    expect(note.exercise).toEqual({ q: '', a: '' });
    expect(note.doubt).toBe('');
    expect(note.notice).toBe('');
    expect(note.blocks).toEqual([]);
  });

  it('N-013 guide / src の欠落は空文字になる', () => {
    const note = ok(parseNoteJson(minimal(), { today: T, ...IDS }));
    expect(note.cards[0].guide).toBe('');
    expect(note.cards[0].src).toBe('');
  });

  it('N-014 未知のトップレベルキーは無視される', () => {
    const res = parseNoteJson(minimal({ generatedBy: 'gpt', extra: [1, 2] }), { today: T, ...IDS });
    expect(res.ok).toBe(true);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-015 cardId はノート内で一意', () => {
    const note = ok(
      parseNoteJson(
        minimal({
          recall: [
            { q: 'a', a: '1' },
            { q: 'b', a: '2' },
            { q: 'c', a: '3' },
          ],
        }),
        // わざと衝突する生成器を渡しても一意化される
        { today: T, newNoteId: IDS.newNoteId, newCardId: () => 'cX' },
      ),
    );
    const ids = note.cards.map((c) => c.cardId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('cX');
  });

  it('recall はちょうど8件まで通る（N-006 の境界）', () => {
    const recall = Array.from({ length: 8 }, (_, i) => ({ q: 'q' + i, a: 'a' + i }));
    expect(parseNoteJson(minimal({ recall }), { today: T, ...IDS }).ok).toBe(true);
  });
});

describe('parseNoteJson — エラー（N-002〜N-008 / N-016）', () => {
  it('N-002 schema が違うと失敗し note を返さない', () => {
    const res = parseNoteJson(fixture('note-invalid-schema.json'), { today: T, ...IDS });
    expect(res.ok).toBe(false);
    expect(paths(res)).toContain('schema');
    expect(res).not.toHaveProperty('note');
  });

  it('N-002 schema 欠落も失敗', () => {
    const res = parseNoteJson(JSON.stringify({ subject: '数学' }), { today: T, ...IDS });
    expect(paths(res)).toContain('schema');
  });

  it('N-003 JSON として壊れていると $ のエラー1件', () => {
    const res = parseNoteJson('{ "schema": ', { today: T, ...IDS });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors).toHaveLength(1);
    expect(paths(res)).toEqual(['$']);
    expect(res.ok === false && res.errors[0].message).toContain('JSONとして読み取れません');
  });

  it('N-004 トップレベルが配列だとエラー', () => {
    const res = parseNoteJson('[]', { today: T, ...IDS });
    expect(paths(res)).toEqual(['$']);
    expect(res.ok === false && res.errors[0].message).toContain('オブジェクト');
  });

  it('N-005 recall が 0 件 / 非配列だとエラー', () => {
    expect(paths(parseNoteJson(minimal({ recall: [] }), { today: T, ...IDS }))).toContain('recall');
    expect(paths(parseNoteJson(minimal({ recall: 'x' }), { today: T, ...IDS }))).toContain('recall');
    expect(paths(parseNoteJson(minimal({ recall: undefined }), { today: T, ...IDS }))).toContain(
      'recall',
    );
  });

  it('N-006 recall が 9 件だとエラー', () => {
    const recall = Array.from({ length: 9 }, (_, i) => ({ q: 'q' + i, a: 'a' + i }));
    const res = parseNoteJson(minimal({ recall }), { today: T, ...IDS });
    expect(paths(res)).toEqual(['recall']);
    expect(res.ok === false && res.errors[0].message).toContain('9件');
  });

  it('N-007 空の q / a は添字つき path でエラーになる', () => {
    const res = parseNoteJson(fixture('note-invalid-empty-recall.json'), { today: T, ...IDS });
    expect(paths(res)).toEqual(
      expect.arrayContaining(['unit', 'recall[0].a', 'recall[1].q']),
    );
  });

  it('N-008 subject / unit が空だとエラー', () => {
    const res = parseNoteJson(minimal({ subject: '   ', unit: '' }), { today: T, ...IDS });
    expect(paths(res)).toEqual(expect.arrayContaining(['subject', 'unit']));
  });

  it('N-016 エラーは全件まとめて返る（最初の1件で打ち切らない）', () => {
    const res = parseNoteJson(
      JSON.stringify({
        schema: 'wrong',
        subject: '',
        unit: '',
        recall: [{ q: '', a: '' }],
      }),
      { today: T, ...IDS },
    );
    expect(paths(res)).toEqual(['schema', 'subject', 'unit', 'recall[0].q', 'recall[0].a']);
  });

  it('recall の要素がオブジェクトでないとエラー', () => {
    const res = parseNoteJson(minimal({ recall: ['q?'] }), { today: T, ...IDS });
    expect(paths(res)).toEqual(['recall[0]']);
  });
});

describe('parseNoteJson — warning（N-009 / N-010 / N-011）', () => {
  it('N-009 date が不正形式なら warning になり today が入る', () => {
    const res = parseNoteJson(minimal({ date: '2026/08/06' }), { today: T, ...IDS });
    const note = ok(res);
    expect(note.date).toBe(T);
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['date']);
  });

  it('N-009 date 欠落は warning を出さずに today', () => {
    const res = parseNoteJson(minimal({ date: undefined }), { today: T, ...IDS });
    expect(ok(res).date).toBe(T);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-010 qi が範囲外なら warning になり cardId は null', () => {
    const res = parseNoteJson(
      minimal({ blocks: [{ t: 'ex', qi: 7, guide: '', solution: 'x', caution: '' }] }),
      { today: T, ...IDS },
    );
    const note = ok(res);
    expect(note.blocks[0]).toMatchObject({ t: 'ex', cardId: null, solution: 'x' });
    expect(res.ok && res.warnings[0].path).toBe('blocks[0].qi');
  });

  it('N-010 qi:null は warning なしで未対応ブロックになる', () => {
    const res = parseNoteJson(
      minimal({ blocks: [{ t: 'ex', qi: null, guide: '', solution: 'x', caution: '' }] }),
      { today: T, ...IDS },
    );
    expect(ok(res).blocks[0]).toMatchObject({ cardId: null });
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-011 未知のブロック種別は捨てて warning', () => {
    const res = parseNoteJson(minimal({ blocks: [{ t: 'memo', body: 'x' }] }), {
      today: T,
      ...IDS,
    });
    expect(ok(res).blocks).toEqual([]);
    expect(res.ok && res.warnings[0].message).toContain('未知のブロック種別');
  });

  it('blocks が配列でないと warning で空になる', () => {
    const res = parseNoteJson(minimal({ blocks: { t: 'def' } }), { today: T, ...IDS });
    expect(ok(res).blocks).toEqual([]);
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['blocks']);
  });

  it('exercise が読めないと warning で空になる', () => {
    const res = parseNoteJson(minimal({ exercise: 'x' }), { today: T, ...IDS });
    expect(ok(res).exercise).toEqual({ q: '', a: '' });
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['exercise']);
  });
});

describe('parseNoteJson — 上書き取り込み（N-017〜N-020）', () => {
  const base = ok(parseNoteJson(fixture('note-math-valid.json'), { today: '2026-08-01', ...IDS }));

  it('N-017 id と createdAt が維持され updatedAt だけ進む', () => {
    const res = parseNoteJson(fixture('note-math-valid.json'), {
      today: T,
      existing: base,
      newNoteId: () => 'nOTHER',
      newCardId: IDS.newCardId,
    });
    const note = ok(res);
    expect(note.id).toBe('nTEST');
    expect(note.createdAt).toBe('2026-08-01');
    expect(note.updatedAt).toBe(T);
  });

  it('N-018 既存カードの cardId がインデックス一致で維持される', () => {
    const res = parseNoteJson(fixture('note-math-valid.json'), {
      today: T,
      existing: base,
      newNoteId: IDS.newNoteId,
      newCardId: () => 'cNEW',
    });
    const note = ok(res);
    expect(note.cards.map((c) => c.cardId)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(res.ok && res.diff).toEqual({
      keptCardIds: ['c0', 'c1', 'c2', 'c3'],
      addedCardIds: [],
      removedCardIds: [],
    });
  });

  it('N-019 カードが減ると removedCardIds に出る', () => {
    const res = parseNoteJson(
      minimal({ recall: [{ q: 'a', a: '1' }] }),
      { today: T, existing: base, ...IDS },
    );
    expect(res.ok && res.diff).toEqual({
      keptCardIds: ['c0'],
      addedCardIds: [],
      removedCardIds: ['c1', 'c2', 'c3'],
    });
  });

  it('N-020 カードが増えると addedCardIds に出る', () => {
    const recall = Array.from({ length: 6 }, (_, i) => ({ q: 'q' + i, a: 'a' + i }));
    const res = parseNoteJson(minimal({ recall }), {
      today: T,
      existing: base,
      newNoteId: IDS.newNoteId,
      newCardId: (i) => 'cNEW' + i,
    });
    expect(res.ok && res.diff).toEqual({
      keptCardIds: ['c0', 'c1', 'c2', 'c3'],
      addedCardIds: ['cNEW4', 'cNEW5'],
      removedCardIds: [],
    });
  });

  it('diffCards は単独でも同じ結果を返す', () => {
    const after: Note = { ...base, cards: [base.cards[0], { ...base.cards[1], cardId: 'cZ' }] };
    expect(diffCards(base, after)).toEqual({
      keptCardIds: ['c0'],
      addedCardIds: ['cZ'],
      removedCardIds: ['c1', 'c2', 'c3'],
    });
  });
});

describe('importSummary', () => {
  it('取り込みプレビューの文言', () => {
    const note = ok(parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS }));
    expect(importSummary(note, 4)).toBe('数学 数列 ─ 漸化式と一般項 · カード4枚 · 復習4件を作成');
  });
});
