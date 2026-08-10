import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NOTE_SCHEMA, NOTE_SCHEMA_V1, type Note } from '../../model/notes';
import {
  diffCards,
  extractJsonObject,
  importSummary,
  parseNoteJson,
  repairJsonEscapes,
} from '../noteImport';

/** 基準日。vitest は TZ=Asia/Tokyo 固定（vitest.config.ts） */
const T = '2026-08-06';

/** 決定的な ID 生成（既定は Date.now + 乱数） */
const IDS = {
  newNoteId: () => 'nTEST',
  newCardId: (i: number) => 'c' + i,
};

/** docs/notebook/fixtures の場所（`fixture()` と一覧テストで共有する） */
const FIXTURE_DIR = new URL('../../../../docs/notebook/fixtures/', import.meta.url);

/** docs/notebook/fixtures/*.json を**そのまま**読む（コピーを置かないので仕様と必ず一致する） */
function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), 'utf8');
}

/**
 * フィクスチャの中身。
 * 件数や本文を**テストに焼き付けない**ため、期待値はここから取る
 * （フィクスチャは仕様の見本なので、内容が育っても取り込みの規則は変わらない）。
 */
interface FixtureShape {
  date: string;
  subject: string;
  unit: string;
  recall: { q: string; a: string; guide?: string }[];
  sections?: { heading?: string; text?: string; ai?: string }[];
  exercise?: { q: string; a: string };
}

function fixtureJson(name: string): FixtureShape {
  return JSON.parse(fixture(name)) as FixtureShape;
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

/** 旧スキーマ（`blocks` + 5 色）のペイロード。移行の確認に使う */
function legacy(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: NOTE_SCHEMA_V1,
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
    const src = fixtureJson('note-math-valid.json');
    const res = parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS });
    const note = ok(res);
    expect(note.cards).toHaveLength(src.recall.length);
    expect(note.subject).toBe(src.subject);
    expect(note.unit).toBe(src.unit);
    expect(note.date).toBe(src.date);
    expect(note.v).toBe(1);
    expect(note.createdAt).toBe(T);
    expect(note.updatedAt).toBe(T);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-001 LaTeX が壊れずに保持される', () => {
    const src = fixtureJson('note-math-valid.json');
    const note = ok(parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS }));
    // 前提: フィクスチャに LaTeX が入っている（無くなったら気付けるように確かめる）
    expect(src.recall.some((r) => r.a.includes('\\'))).toBe(true);
    expect(note.cards.map((c) => c.q)).toEqual(src.recall.map((r) => r.q));
    expect(note.cards.map((c) => c.a)).toEqual(src.recall.map((r) => r.a));
    expect(note.exercise.a).toBe(src.exercise?.a);
  });

  it('N-001 本文（sections）がそのままの並びで入る', () => {
    const src = fixtureJson('note-math-valid.json');
    const note = ok(parseNoteJson(fixture('note-math-valid.json'), { today: T, ...IDS }));
    expect(note.sections.map((s) => s.heading)).toEqual((src.sections ?? []).map((s) => s.heading));
    // 自分のノート本文が主役。AI の添削は別欄に分かれている
    expect(note.sections.some((s) => !!s.text)).toBe(true);
    expect(note.sections.some((s) => !!s.ai)).toBe(true);
  });

  it('N-012 英語フィクスチャも取り込める（recall の件数はそのまま）', () => {
    const src = fixtureJson('note-english-valid.json');
    const note = ok(parseNoteJson(fixture('note-english-valid.json'), { today: T, ...IDS }));
    expect(note.cards).toHaveLength(src.recall.length);
    expect(note.cards.map((c) => c.cardId)).toEqual(src.recall.map((_, i) => 'c' + i));
  });

  it('N-013 exercise / doubt / notice を省略しても既定値で通る', () => {
    const note = ok(parseNoteJson(minimal(), { today: T, ...IDS }));
    expect(note.exercise).toEqual({ q: '', a: '' });
    expect(note.doubt).toBe('');
    expect(note.notice).toBe('');
    expect(note.sections).toEqual([]);
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

describe('parseNoteJson — 生成AIの出力ゆらぎを吸収する（N-081〜N-086）', () => {
  it('N-081 コードブロックで囲まれていても取り込める', () => {
    const res = parseNoteJson('```json\n' + minimal() + '\n```', { today: T, ...IDS });
    expect(ok(res).unit).toBe('三角比');
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['$']);
  });

  it('N-081 言語指定なしのコードブロックも剥がせる', () => {
    expect(parseNoteJson('```\n' + minimal() + '\n```', { today: T, ...IDS }).ok).toBe(true);
  });

  it('N-082 前置き・後書きが付いていても取り込める', () => {
    const text = '承知しました。以下がJSONです。\n\n' + minimal() + '\n\n必要なら修正します。';
    const res = parseNoteJson(text, { today: T, ...IDS });
    expect(ok(res).unit).toBe('三角比');
    expect(res.ok && res.warnings[0].message).toContain('取り除いてから読み込みました');
  });

  it('N-082 素のJSONなら warning は出ない', () => {
    const res = parseNoteJson(minimal(), { today: T, ...IDS });
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-083 schema 行が無ければ warning で通す（AIがよく忘れる）', () => {
    const res = parseNoteJson(minimal({ schema: undefined }), { today: T, ...IDS });
    expect(ok(res).unit).toBe('三角比');
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['schema']);
  });

  it('N-083 別アプリの schema はエラーのまま（N-002 を弱めない）', () => {
    expect(paths(parseNoteJson(minimal({ schema: 'chartnote-v2' }), { today: T, ...IDS }))).toEqual(
      ['schema'],
    );
  });

  it('N-084 schema の前後に空白があっても通る', () => {
    expect(parseNoteJson(minimal({ schema: '  compass-note@1 ' }), { today: T, ...IDS }).ok).toBe(
      true,
    );
  });

  it('N-085 date が空文字なら黙って今日にする（資料から読めなかった合図）', () => {
    const res = parseNoteJson(minimal({ date: '' }), { today: T, ...IDS });
    expect(ok(res).date).toBe(T);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-086 qi が文字列でも数値として解決する（旧 ex はそのカードの guide へ）', () => {
    const res = parseNoteJson(
      legacy({ blocks: [{ t: 'ex', qi: '0', guide: '', solution: 'x', caution: '' }] }),
      { today: T, ...IDS },
    );
    expect(ok(res).cards[0].guide).toBe('解説: x');
    expect(ok(res).sections).toEqual([]);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-087 LaTeXのバックスラッシュが1個でも自動で補って読み込む', () => {
    // 実際に起きたケース: $36^\circ30'$ の \circ が 1 個で JSON.parse が全体を拒否した
    const broken = minimal({
      sections: [{ heading: 'ミズーリ協定', text: 'PLACEHOLDER', ai: '' }],
    }).replace('"PLACEHOLDER"', '"北緯$36^\\circ30\'$を基準とする"');
    // 前提: 素の JSON.parse は失敗する
    expect(() => JSON.parse(broken)).toThrow();

    const res = parseNoteJson(broken, { today: T, ...IDS });
    const note = ok(res);
    expect(note.sections[0].text).toBe("北緯$36^\\circ30'$を基準とする");
    expect(res.ok && res.warnings.map((w) => w.message)).toContain(
      'LaTeXのバックスラッシュ（\\circ など）が1個だったので補って読み込みました',
    );
  });

  it('N-087 正しくエスケープされていれば触らない（warning も出ない）', () => {
    const good = minimal({
      recall: [{ q: 'x', a: '$S_n=\\dfrac{a}{b}$' }],
    });
    const res = parseNoteJson(good, { today: T, ...IDS });
    expect(ok(res).cards[0].a).toBe('$S_n=\\dfrac{a}{b}$');
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-087 直しても JSON にならないものは従来どおりエラー', () => {
    // 全角の引用符は救えない
    const res = parseNoteJson('{ “schema”: “compass-note@1” }', { today: T, ...IDS });
    expect(paths(res)).toEqual(['$']);
    expect(res.ok === false && res.errors[0].message).toContain('JSONとして読み取れません');
  });

  it('repairJsonEscapes は文字列の外や有効なエスケープに触らない', () => {
    expect(repairJsonEscapes('{"a":"\\n\\t\\"\\\\"}')).toBe('{"a":"\\n\\t\\"\\\\"}');
    expect(repairJsonEscapes('{"a":"\\u00b0"}')).toBe('{"a":"\\u00b0"}');
    expect(repairJsonEscapes('{"a":"\\circ"}')).toBe('{"a":"\\\\circ"}');
    // 桁の足りない \u も救う
    expect(repairJsonEscapes('{"a":"\\u12"}')).toBe('{"a":"\\\\u12"}');
  });

  it('extractJsonObject は単体でも同じ結果', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ text: '{"a":1}', trimmed: true });
    expect(extractJsonObject('{"a":1}')).toEqual({ text: '{"a":1}', trimmed: false });
    expect(extractJsonObject('前置き {"a":1} 後書き')).toEqual({ text: '{"a":1}', trimmed: true });
  });
});

describe('parseNoteJson — エラー（N-002〜N-008 / N-016）', () => {
  it('N-002 schema が違うと失敗し note を返さない', () => {
    const res = parseNoteJson(fixture('note-invalid-schema.json'), { today: T, ...IDS });
    expect(res.ok).toBe(false);
    expect(paths(res)).toContain('schema');
    expect(res).not.toHaveProperty('note');
  });

  it('N-002 schema 欠落は失敗にしない（N-083 で warning に緩めた）が、中身の不備は拾う', () => {
    const res = parseNoteJson(JSON.stringify({ subject: '数学' }), { today: T, ...IDS });
    expect(paths(res)).toEqual(['unit', 'recall']);
    expect(paths(res)).not.toContain('schema');
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

  it('N-010 qi が範囲外なら warning になり、行き場のない解説は AI 区画として残る', () => {
    const res = parseNoteJson(
      legacy({ blocks: [{ t: 'ex', qi: 7, guide: '', solution: 'x', caution: '' }] }),
      { today: T, ...IDS },
    );
    const note = ok(res);
    // 捨てずに本文へ。text が空 = ノートに無い AI だけの補足
    expect(note.sections[0]).toEqual({ heading: '解説', text: '', ai: '解説: x' });
    expect(note.cards[0].guide).toBe('');
    expect(res.ok && res.warnings[0].path).toBe('blocks[0].qi');
  });

  it('N-010 qi:null は warning なしで AI 区画になる', () => {
    const res = parseNoteJson(
      legacy({ blocks: [{ t: 'ex', qi: null, guide: '', solution: 'x', caution: '' }] }),
      { today: T, ...IDS },
    );
    expect(ok(res).sections[0]).toMatchObject({ heading: '解説', text: '' });
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-011 未知のブロック種別は捨てて warning', () => {
    const res = parseNoteJson(legacy({ blocks: [{ t: 'memo', body: 'x' }] }), {
      today: T,
      ...IDS,
    });
    expect(ok(res).sections).toEqual([]);
    expect(res.ok && res.warnings[0].message).toContain('未知のブロック種別');
  });

  it('blocks が配列でないと warning で空になる', () => {
    const res = parseNoteJson(legacy({ blocks: { t: 'def' } }), { today: T, ...IDS });
    expect(ok(res).sections).toEqual([]);
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

  /** フィクスチャの件数を焼き付けないための別名 */
  const baseIds = base.cards.map((c) => c.cardId);

  it('N-018 既存カードの cardId がインデックス一致で維持される', () => {
    const res = parseNoteJson(fixture('note-math-valid.json'), {
      today: T,
      existing: base,
      newNoteId: IDS.newNoteId,
      newCardId: () => 'cNEW',
    });
    const note = ok(res);
    expect(note.cards.map((c) => c.cardId)).toEqual(baseIds);
    expect(res.ok && res.diff).toEqual({
      keptCardIds: baseIds,
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
      keptCardIds: [baseIds[0]],
      addedCardIds: [],
      removedCardIds: baseIds.slice(1),
    });
  });

  it('N-020 カードが増えると addedCardIds に出る', () => {
    const n = baseIds.length;
    const recall = Array.from({ length: n + 2 }, (_, i) => ({ q: 'q' + i, a: 'a' + i }));
    const res = parseNoteJson(minimal({ recall }), {
      today: T,
      existing: base,
      newNoteId: IDS.newNoteId,
      newCardId: (i) => 'cNEW' + i,
    });
    expect(res.ok && res.diff).toEqual({
      keptCardIds: baseIds,
      addedCardIds: ['cNEW' + n, 'cNEW' + (n + 1)],
      removedCardIds: [],
    });
  });

  it('diffCards は単独でも同じ結果を返す', () => {
    const after: Note = { ...base, cards: [base.cards[0], { ...base.cards[1], cardId: 'cZ' }] };
    expect(diffCards(base, after)).toEqual({
      keptCardIds: [baseIds[0]],
      addedCardIds: ['cZ'],
      removedCardIds: baseIds.slice(1),
    });
  });
});

describe('importSummary', () => {
  it('取り込みプレビューの文言', () => {
    const note = ok(parseNoteJson(minimal(), { today: T, ...IDS }));
    expect(importSummary(note, 3)).toBe('数学 三角比 · カード1枚 · 復習3件を作成');
  });
});

// ─────────────────────────────────────────────────────────────
// コーネル式で足したもの（spec §3.5 / §3.6、受け入れ N-094〜N-100）
// ─────────────────────────────────────────────────────────────

describe('parseNoteJson — 想起問題の出どころ（N-094 / N-095）', () => {
  it('N-094 origin:"self" は自作として保つ', () => {
    const note = ok(
      parseNoteJson(
        minimal({
          recall: [
            { q: '自分で立てた問い', a: 'A', origin: 'self' },
            { q: 'AIが補った問い', a: 'A', origin: 'ai' },
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.cards.map((c) => c.origin)).toEqual(['self', 'ai']);
  });

  it('N-095 origin が無い / 変な値のときは AI 作として読む（取り込みは止めない）', () => {
    const note = ok(
      parseNoteJson(
        minimal({ recall: [{ q: 'Q', a: 'A' }, { q: 'Q2', a: 'A2', origin: '自分' }] }),
        { today: T, ...IDS },
      ),
    );
    expect(note.cards.map((c) => c.origin)).toEqual(['ai', 'ai']);
  });
});

describe('parseNoteJson — 重要語（N-096〜N-099）', () => {
  it('N-096 term / color / note をそのまま取り込む', () => {
    const note = ok(
      parseNoteJson(
        minimal({
          keywords: [
            { term: '産業革命', color: 'red', note: '18C英' },
            { term: 'ワット', color: 'blue', note: '' },
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.keywords).toEqual([
      { term: '産業革命', color: 'red', note: '18C英' },
      { term: 'ワット', color: 'blue', note: '' },
    ]);
  });

  it('N-097 ただの文字列の配列でも読める（AI がよくやる形）', () => {
    const note = ok(
      parseNoteJson(minimal({ keywords: ['産業革命', '囲い込み'] }), { today: T, ...IDS }),
    );
    expect(note.keywords.map((k) => k.term)).toEqual(['産業革命', '囲い込み']);
    expect(note.keywords.every((k) => k.color === 'red')).toBe(true);
  });

  it('N-098 空文字・重複・知らない色は落として整える', () => {
    const note = ok(
      parseNoteJson(
        minimal({
          keywords: [
            { term: ' 産業革命 ', color: 'gold' },
            { term: '産業革命', color: 'blue' },
            { term: '   ' },
            42,
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.keywords).toEqual([{ term: '産業革命', color: 'red', note: '' }]);
  });

  it('N-099 keywords が無いノートも通る（旧プロンプトの出力）', () => {
    const note = ok(parseNoteJson(minimal(), { today: T, ...IDS }));
    expect(note.keywords).toEqual([]);
    expect(note.summary).toBe('');
  });

  it('keywords が配列でなければ警告して空にする', () => {
    const res = parseNoteJson(minimal({ keywords: '産業革命' }), { today: T, ...IDS });
    expect(ok(res).keywords).toEqual([]);
    expect(res.ok && res.warnings.map((w) => w.path)).toContain('keywords');
  });

  it('24 語を超えたら先頭から採用し、警告する', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'k' + i);
    const res = parseNoteJson(minimal({ keywords: many }), { today: T, ...IDS });
    expect(ok(res).keywords).toHaveLength(24);
    expect(res.ok && res.warnings.map((w) => w.path)).toContain('keywords');
  });
});

describe('parseNoteJson — まとめと疑問（N-100）', () => {
  it('N-100 summary は前後の空白だけ落として保つ。doubt は書かれたまま', () => {
    const note = ok(
      parseNoteJson(
        minimal({ summary: '  この授業では漸化式を扱った。\n3型に帰着させる。  ', doubt: '?が2つ\nもう1件' }),
        { today: T, ...IDS },
      ),
    );
    expect(note.summary).toBe('この授業では漸化式を扱った。\n3型に帰着させる。');
    expect(note.doubt).toBe('?が2つ\nもう1件');
  });

  it('doubt が空でもエラーにしない（自分が書いていなければ空のまま）', () => {
    expect(ok(parseNoteJson(minimal({ doubt: '' }), { today: T, ...IDS })).doubt).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// 本文＝自分のノートの再現（compass-note@2）
// ─────────────────────────────────────────────────────────────

describe('parseNoteJson — sections', () => {
  it('heading / text / ai をそのまま取り込む', () => {
    const note = ok(
      parseNoteJson(
        minimal({
          sections: [
            { heading: '正弦定理', text: '$\\dfrac{a}{\\sin A}=2R$\n外接円の半径 $R$', ai: '' },
            { heading: '', text: '余弦定理も同じ図から出る', ai: '「同じ図」= 外接円の図' },
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.sections).toEqual([
      { heading: '正弦定理', text: '$\\dfrac{a}{\\sin A}=2R$\n外接円の半径 $R$', ai: '' },
      { heading: '', text: '余弦定理も同じ図から出る', ai: '「同じ図」= 外接円の図' },
    ]);
  });

  it('text が空の区画は「ノートに無い AI だけの補足」として通す', () => {
    const note = ok(
      parseNoteJson(minimal({ sections: [{ heading: '補足', ai: '授業で口頭説明あり' }] }), {
        today: T,
        ...IDS,
      }),
    );
    expect(note.sections).toEqual([{ heading: '補足', text: '', ai: '授業で口頭説明あり' }]);
  });

  it('欠落したキーは空文字になる', () => {
    const note = ok(parseNoteJson(minimal({ sections: [{ text: '本文だけ' }] }), { today: T, ...IDS }));
    expect(note.sections).toEqual([{ heading: '', text: '本文だけ', ai: '' }]);
  });

  it('text も ai も空の区画は捨てる（見出しだけの空行を紙面に作らない）', () => {
    const note = ok(
      parseNoteJson(
        minimal({ sections: [{ heading: '見出しだけ', text: '  ', ai: '' }, { text: '中身' }] }),
        { today: T, ...IDS },
      ),
    );
    expect(note.sections).toEqual([{ heading: '', text: '中身', ai: '' }]);
  });

  it('sections が配列でなければエラー（本文が黙って消えるのを防ぐ）', () => {
    const res = parseNoteJson(minimal({ sections: '本文' }), { today: T, ...IDS });
    expect(paths(res)).toEqual(['sections']);
  });

  it('sections が無くても通る（キーごと落とすのは AI がよくやる）', () => {
    const res = parseNoteJson(minimal({ sections: undefined }), { today: T, ...IDS });
    expect(ok(res).sections).toEqual([]);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('要素がオブジェクトでなければ warning で飛ばす', () => {
    const res = parseNoteJson(minimal({ sections: ['本文', { text: 'ok' }] }), { today: T, ...IDS });
    expect(ok(res).sections).toHaveLength(1);
    expect(res.ok && res.warnings.map((w) => w.path)).toEqual(['sections[0]']);
  });

  it('24 区画を超えたら先頭から採用し、警告する', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ heading: 'h' + i, text: 't' + i, ai: '' }));
    const res = parseNoteJson(minimal({ sections: many }), { today: T, ...IDS });
    expect(ok(res).sections).toHaveLength(24);
    expect(res.ok && res.warnings.map((w) => w.path)).toContain('sections');
  });
});

// ─────────────────────────────────────────────────────────────
// 旧スキーマ（compass-note@1）の読み替え
// ─────────────────────────────────────────────────────────────

describe('parseNoteJson — compass-note@1 の移行', () => {
  it('@1 の schema はそのまま受理する（手元の JSON を捨てない）', () => {
    const res = parseNoteJson(legacy(), { today: T, ...IDS });
    expect(res.ok).toBe(true);
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('def ブロックは「AI だけの補足」区画になる（自分のノート本文にしない）', () => {
    const note = ok(
      parseNoteJson(
        legacy({ blocks: [{ t: 'def', title: '正弦定理', body: '外接円の半径と結ぶ' }] }),
        { today: T, ...IDS },
      ),
    );
    expect(note.sections).toEqual([
      { heading: '正弦定理', text: '', ai: '外接円の半径と結ぶ' },
    ]);
  });

  it('ex ブロックは対応するカードの guide へ畳む（問題から離さない）', () => {
    const note = ok(
      parseNoteJson(
        legacy({
          recall: [{ q: 'Q', a: 'A', guide: '外接円を描く' }],
          blocks: [
            { t: 'ex', qi: 0, guide: '外接円を描く', solution: '$2R$ が出る', caution: '直径と半径' },
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    // 同じ方針は 2 回書かない。解答・注意には見出しを付けて続ける
    expect(note.cards[0].guide).toBe('外接円を描く\n解説: $2R$ が出る\n注意: 直径と半径');
    expect(note.sections).toEqual([]);
  });

  it('中身が空の ex ブロックは何も足さない', () => {
    const note = ok(
      parseNoteJson(legacy({ blocks: [{ t: 'ex', qi: 0, guide: '', solution: '', caution: '' }] }), {
        today: T,
        ...IDS,
      }),
    );
    expect(note.cards[0].guide).toBe('');
    expect(note.sections).toEqual([]);
  });

  it('旧 5 色は 3 色へ畳む（green は年号なので blue）', () => {
    const note = ok(
      parseNoteJson(
        legacy({
          keywords: [
            { term: '正弦定理', color: 'red' },
            { term: 'ワット', color: 'purple' },
            { term: '1789年', color: 'green' },
            { term: '因果', color: 'orange' },
          ],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.keywords.map((k) => k.color)).toEqual(['red', 'blue', 'blue', 'green']);
  });

  it('@2 の green は green のまま（旧 green の読み替えを新データに当てない）', () => {
    const note = ok(
      parseNoteJson(minimal({ keywords: [{ term: '因果', color: 'green' }] }), { today: T, ...IDS }),
    );
    expect(note.keywords[0].color).toBe('green');
  });

  it('schema を書き忘れた旧プロンプトの出力（blocks あり）も旧扱いで読む', () => {
    const note = ok(
      parseNoteJson(
        JSON.stringify({
          date: '2026-08-06',
          subject: '数学',
          unit: '三角比',
          recall: [{ q: 'Q', a: 'A' }],
          blocks: [{ t: 'def', title: 'T', body: 'B' }],
          keywords: [{ term: '1789年', color: 'green' }],
        }),
        { today: T, ...IDS },
      ),
    );
    expect(note.sections).toEqual([{ heading: 'T', text: '', ai: 'B' }]);
    expect(note.keywords[0].color).toBe('blue');
  });
});

describe('docs/notebook/fixtures/*.json', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

  it('フィクスチャが 1 つ以上ある（置き場所を間違えたら気付く）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // `note-invalid-*.json` は**わざと壊してある**サンプル。それ以外は必ず取り込めること。
  // @1 / @2 のどちらで書かれていても通る（パーサが両方受理する）。
  files.forEach((name) => {
    const invalid = name.includes('invalid');
    it(name + (invalid ? ' はエラーになる' : ' は取り込める'), () => {
      const res = parseNoteJson(fixture(name), { today: T, ...IDS });
      if (invalid) {
        expect(res.ok).toBe(false);
      } else if (!res.ok) {
        throw new Error(name + ' が取り込めない: ' + JSON.stringify(res.errors));
      }
    });
  });
});

describe('parseNoteJson — 教科は時間割の名前に揃える（N-111 / N-112）', () => {
  const KNOWN = ['言語', '英コ', '数学', '歴総', '地総', 'その他'];

  it('N-111 一覧にある教科なら警告を出さない', () => {
    const res = parseNoteJson(minimal({ subject: '歴総' }), {
      today: T,
      knownSubjects: KNOWN,
      ...IDS,
    });
    expect(ok(res).subject).toBe('歴総');
    expect(res.ok && res.warnings).toEqual([]);
  });

  it('N-112 「社会」のような大分類は保存はするが警告する（候補を並べる）', () => {
    const res = parseNoteJson(minimal({ subject: '社会' }), {
      today: T,
      knownSubjects: KNOWN,
      ...IDS,
    });
    // 取り込み自体は通す。時間割に無い授業のノートも取れるべきなので
    expect(ok(res).subject).toBe('社会');
    const w = res.ok ? res.warnings.filter((x) => x.path === 'subject') : [];
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('歴総');
  });

  it('knownSubjects を渡さなければ何も言わない（純ロジックとして時間割を知らない）', () => {
    const res = parseNoteJson(minimal({ subject: '社会' }), { today: T, ...IDS });
    expect(res.ok && res.warnings).toEqual([]);
  });
});
