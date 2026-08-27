import { describe, expect, it } from 'vitest';
import {
  applyAttempts,
  decideImport,
  findNoteByTriple,
  importKeyOf,
  normalizeGrade,
  noteBrief,
  noteFull,
  payloadHashOf,
  stableStringify,
  understandingStats,
  weakCards,
  type ImportRecord,
} from '../noteSync';
import type { Note, NoteCard } from '../../model/notes';

function card(cardId: string, over: Partial<NoteCard> = {}): NoteCard {
  return { cardId, q: 'Q' + cardId, a: 'A', guide: '', src: '', origin: 'ai', attempts: [], ...over };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-20',
    subject: '数学',
    unit: '順列',
    scans: [],
    cards: [card('c1'), card('c2')],
    sections: [{ heading: '導入', text: '', ai: '順列は並べ方' }],
    summary: '',
    keywords: [{ term: '順列', color: 'red', note: '' }],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-20',
    updatedAt: '2026-08-20',
    trashedAt: '',
    ...over,
  };
}

const RECORD: ImportRecord = {
  key: 'ik-abc',
  payloadHash: 'hash-a',
  noteId: 'n1',
  status: 'created',
  revision: 1,
  mode: 'commit',
  at: '2026-08-20T08:00:00.000Z',
  source: 'notion-mcp',
  date: '2026-08-20',
  subject: '数学',
  unit: '順列',
};

describe('stableStringify / payloadHashOf', () => {
  it('キーの並びが違っても同じ文字列・同じハッシュになる', async () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(await payloadHashOf({ b: 1, a: 2 })).toBe(await payloadHashOf({ a: 2, b: 1 }));
  });

  it('中身が変われば別のハッシュになる', async () => {
    expect(await payloadHashOf({ a: 1 })).not.toBe(await payloadHashOf({ a: 2 }));
  });
});

describe('importKeyOf', () => {
  it('3 つ組が同じなら同じキー、違えば別のキー', async () => {
    const a = await importKeyOf('2026-08-20', '数学', '順列');
    expect(a).toBe(await importKeyOf('2026-08-20', '数学', '順列'));
    expect(a).not.toBe(await importKeyOf('2026-08-20', '数学', '階乗'));
    expect(a).not.toBe(await importKeyOf('2026-08-21', '数学', '順列'));
  });

  it('Firestore のドキュメント ID として使える形（"/" も ".." も含まない）', async () => {
    const key = await importKeyOf('2026-08-20', '数学', 'a/b/../__c__');
    expect(key).toMatch(/^ik-[0-9a-f]{64}$/);
  });
});

describe('decideImport', () => {
  it('台帳が無ければ dry_run は validated、commit は created', () => {
    expect(decideImport({ mode: 'dry_run', record: null, payloadHash: 'h' })).toMatchObject({
      status: 'validated',
      write: false,
    });
    expect(decideImport({ mode: 'commit', record: null, payloadHash: 'h' })).toMatchObject({
      status: 'created',
      write: true,
    });
  });

  it('同じ hash の再送は commit でも duplicate（書かない）', () => {
    expect(decideImport({ mode: 'commit', record: RECORD, payloadHash: 'hash-a' })).toMatchObject({
      status: 'duplicate',
      write: false,
    });
  });

  it('同じキー・違う hash は conflict（overwrite を明示するまで書かない）', () => {
    expect(decideImport({ mode: 'commit', record: RECORD, payloadHash: 'hash-b' })).toMatchObject({
      status: 'conflict',
      write: false,
    });
    expect(
      decideImport({ mode: 'commit', record: RECORD, payloadHash: 'hash-b', overwrite: true }),
    ).toMatchObject({ status: 'updated', write: true });
    expect(
      decideImport({ mode: 'dry_run', record: RECORD, payloadHash: 'hash-b', overwrite: true }),
    ).toMatchObject({ status: 'validated', write: false });
  });

  it('台帳が無くても 3 つ組で既存が見つかれば commit は updated', () => {
    expect(
      decideImport({ mode: 'commit', record: null, payloadHash: 'h', existingNoteId: 'n1' }),
    ).toMatchObject({ status: 'updated', write: true });
  });

  it('前回が rejected なら同じ hash でも作り直せる', () => {
    const rejected = { ...RECORD, status: 'rejected' as const };
    expect(decideImport({ mode: 'commit', record: rejected, payloadHash: 'hash-a' })).toMatchObject({
      status: 'updated',
      write: true,
    });
  });
});

describe('findNoteByTriple', () => {
  it('授業日・教科・単元が全部一致したときだけ返す', () => {
    const notes = [note(), note({ id: 'n2', unit: '階乗' })];
    expect(findNoteByTriple(notes, '2026-08-20', '数学', '階乗')?.id).toBe('n2');
    expect(findNoteByTriple(notes, '2026-08-20', '英コ', '階乗')).toBeNull();
  });
});

describe('normalizeGrade', () => {
  it('表記ゆれを 3 段階へ寄せる', () => {
    expect(normalizeGrade('high')).toBe('high');
    expect(normalizeGrade('◎')).toBe('high');
    expect(normalizeGrade('まあまあ')).toBe('mid');
    expect(normalizeGrade('△')).toBe('low');
    expect(normalizeGrade(1)).toBe('low');
    expect(normalizeGrade('ばつ')).toBeNull();
    expect(normalizeGrade(undefined)).toBeNull();
  });
});

describe('applyAttempts', () => {
  it('理解度を書き足し、updatedAt をその日にする', () => {
    const r = applyAttempts(note(), [{ cardId: 'c1', grade: 'low' }], '2026-08-21');
    expect(r.changed).toBe(true);
    expect(r.note.cards[0].attempts).toEqual([{ day: '2026-08-21', grade: 'low' }]);
    expect(r.note.cards[1].attempts).toEqual([]);
    expect(r.note.updatedAt).toBe('2026-08-21');
  });

  it('同じ日の同じ問題は 1 件に畳み、後から来た方が勝つ', () => {
    const first = applyAttempts(note(), [{ cardId: 'c1', grade: 'low' }], '2026-08-21');
    const second = applyAttempts(first.note, [{ cardId: 'c1', grade: 'high' }], '2026-08-21');
    expect(second.note.cards[0].attempts).toEqual([{ day: '2026-08-21', grade: 'high' }]);
  });

  it('別の日なら履歴が積み上がり、古い順に並ぶ', () => {
    const a = applyAttempts(note(), [{ cardId: 'c1', grade: 'low' }], '2026-08-22');
    const b = applyAttempts(a.note, [{ cardId: 'c1', grade: 'mid' }], '2026-08-21');
    expect(b.note.cards[0].attempts.map((x) => x.day)).toEqual(['2026-08-21', '2026-08-22']);
  });

  it('知らない cardId は unknownCardIds に落ち、ノートは変わらない', () => {
    const before = note();
    const r = applyAttempts(before, [{ cardId: 'zzz', grade: 'high' }], '2026-08-21');
    expect(r.changed).toBe(false);
    expect(r.unknownCardIds).toEqual(['zzz']);
    expect(r.note).toBe(before);
  });

  it('本人領域（summary / doubt / scans）に触れない', () => {
    const before = note({ summary: '自分のまとめ', doubt: 'なぜ？' });
    const r = applyAttempts(before, [{ cardId: 'c1', grade: 'high' }], '2026-08-21');
    expect(r.note.summary).toBe('自分のまとめ');
    expect(r.note.doubt).toBe('なぜ？');
    expect(r.note.scans).toBe(before.scans);
  });
});

describe('weakCards', () => {
  it('不安 → 未着手 → まあまあ の順に並び、ばっちりは出ない', () => {
    const n = note({
      cards: [
        card('c1', { attempts: [{ day: '2026-08-20', grade: 'high' }] }),
        card('c2', { attempts: [{ day: '2026-08-20', grade: 'mid' }] }),
        card('c3'),
        card('c4', { attempts: [{ day: '2026-08-20', grade: 'low' }] }),
      ],
    });
    expect(weakCards([n]).map((c) => c.card_id)).toEqual(['c4', 'c3', 'c2']);
  });

  it('include_untried:false で未着手を外す', () => {
    const n = note({ cards: [card('c1'), card('c2', { attempts: [{ day: '2026-08-20', grade: 'low' }] })] });
    expect(weakCards([n], { includeUntried: false }).map((c) => c.card_id)).toEqual(['c2']);
  });

  it('教科で絞れる', () => {
    const a = note({ id: 'n1', subject: '数学' });
    const b = note({ id: 'n2', subject: '英コ' });
    expect(weakCards([a, b], { subject: '英コ' }).every((c) => c.subject === '英コ')).toBe(true);
  });
});

describe('understandingStats', () => {
  it('教科ごとに最新の理解度だけを数える', () => {
    const n = note({
      cards: [
        card('c1', {
          attempts: [
            { day: '2026-08-19', grade: 'low' },
            { day: '2026-08-20', grade: 'high' },
          ],
        }),
        card('c2', { attempts: [{ day: '2026-08-20', grade: 'low' }] }),
        card('c3'),
      ],
    });
    expect(understandingStats([n])).toEqual([
      { subject: '数学', notes: 1, cards: 3, tried: 2, high: 1, mid: 0, low: 1, untried: 1 },
    ]);
  });

  it('期間の外は数えない', () => {
    const n = note();
    expect(understandingStats([n], { from: '2026-08-21' })).toEqual([]);
    expect(understandingStats([n], { to: '2026-08-19' })).toEqual([]);
  });
});

describe('noteBrief / noteFull', () => {
  it('一覧には本文を入れない', () => {
    const brief = noteBrief(note());
    expect(brief).toMatchObject({ note_id: 'n1', cards: 2, graded_cards: 0, weak_cards: 0 });
    expect(brief).not.toHaveProperty('sections');
  });

  it('全文には本人領域が「読めるが書けない」と添えてある', () => {
    const full = noteFull(note({ summary: 'まとめ' })) as Record<string, unknown>;
    expect(full.summary).toBe('まとめ');
    expect(full.readonly_fields).toEqual(['summary', 'doubt', 'scans']);
  });
});
