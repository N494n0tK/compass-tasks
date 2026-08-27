import { describe, expect, it } from 'vitest';
import {
  arrangeDrillItems,
  buildDrillItems,
  filterByGrade,
  sortDrillItems,
  tallyDrillItems,
} from '../noteExtract';
import { weaknessRank, type Note, type NoteAttempt, type NoteCard } from '../../model/notes';

function card(over: Partial<NoteCard> = {}): NoteCard {
  return { cardId: 'c0', q: 'Q', a: 'A', guide: '', src: '', origin: 'ai', attempts: [], ...over };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-09',
    subject: '数学',
    unit: '数列',
    scans: [],
    cards: [card()],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-09',
    updatedAt: '2026-08-09',
    trashedAt: '',
    ...over,
  };
}

const at = (day: string, grade: NoteAttempt['grade']): NoteAttempt => ({ day, grade });

describe('weaknessRank', () => {
  it('不安 → 未着手 → まあまあ → ばっちり の順になる', () => {
    expect(weaknessRank({ attempts: [at('2026-08-01', 'low')] })).toBe(0);
    expect(weaknessRank({ attempts: [] })).toBe(1);
    expect(weaknessRank({ attempts: [at('2026-08-01', 'mid')] })).toBe(2);
    expect(weaknessRank({ attempts: [at('2026-08-01', 'high')] })).toBe(3);
  });

  it('見るのは直近の 1 件だけ（過去に不安でも、最後がばっちりなら後ろ）', () => {
    expect(
      weaknessRank({ attempts: [at('2026-08-01', 'low'), at('2026-08-05', 'high')] }),
    ).toBe(3);
  });
});

describe('buildDrillItems', () => {
  it('空の設問は落とし、演習は cardId を持たない', () => {
    const items = buildDrillItems(
      [
        note({
          cards: [card({ cardId: 'c0' }), card({ cardId: 'c1', q: '  ' })],
          exercise: { q: '演習問題', a: '答え' },
        }),
      ],
      null,
    );
    expect(items.map((i) => i.kind)).toEqual(['想起', '演習']);
    expect(items[0].cardId).toBe('c0');
    expect(items[1].cardId).toBeNull();
  });

  it('教科で絞れる', () => {
    const notes = [note({ id: 'n1', subject: '数学' }), note({ id: 'n2', subject: '英語' })];
    expect(buildDrillItems(notes, '英語').map((i) => i.note.id)).toEqual(['n2']);
  });
});

describe('sortDrillItems', () => {
  const notes = [
    note({
      id: 'n1',
      cards: [
        card({ cardId: 'hi', q: 'ばっちり', attempts: [at('2026-08-08', 'high')] }),
        card({ cardId: 'lo', q: '不安', attempts: [at('2026-08-07', 'low')] }),
        card({ cardId: 'new', q: '未着手' }),
        card({ cardId: 'mid', q: 'まあまあ', attempts: [at('2026-08-01', 'mid')] }),
      ],
    }),
  ];
  const items = buildDrillItems(notes, null);

  it('weak: 不安 → 未着手 → まあまあ → ばっちり', () => {
    expect(sortDrillItems(items, 'weak').map((i) => i.cardId)).toEqual(['lo', 'new', 'mid', 'hi']);
  });

  it('stale: 未着手が先頭、あとは最後に解いた日が古い順', () => {
    expect(sortDrillItems(items, 'stale').map((i) => i.cardId)).toEqual(['new', 'mid', 'lo', 'hi']);
  });

  it('note: 元の並びのまま', () => {
    expect(sortDrillItems(items, 'note').map((i) => i.cardId)).toEqual(items.map((i) => i.cardId));
  });

  it('同じ理解度なら久しく解いていない方が先', () => {
    const two = buildDrillItems(
      [
        note({
          cards: [
            card({ cardId: 'recent', attempts: [at('2026-08-09', 'low')] }),
            card({ cardId: 'old', attempts: [at('2026-08-02', 'low')] }),
          ],
        }),
      ],
      null,
    );
    expect(sortDrillItems(two, 'weak').map((i) => i.cardId)).toEqual(['old', 'recent']);
  });

  it('元の配列を壊さない', () => {
    const before = items.map((i) => i.cardId);
    sortDrillItems(items, 'weak');
    expect(items.map((i) => i.cardId)).toEqual(before);
  });
});

describe('filterByGrade / tallyDrillItems', () => {
  const items = buildDrillItems(
    [
      note({
        cards: [
          card({ cardId: 'a', attempts: [at('2026-08-08', 'high')] }),
          card({ cardId: 'b', attempts: [at('2026-08-07', 'low')] }),
          card({ cardId: 'c' }),
        ],
        exercise: { q: '演習', a: '' },
      }),
    ],
    null,
  );

  it('null は素通し', () => {
    expect(filterByGrade(items, null)).toHaveLength(4);
  });

  it("'none' は未着手だけ（演習も未着手扱い）", () => {
    expect(filterByGrade(items, 'none').map((i) => i.cardId)).toEqual(['c', null]);
  });

  it('理解度で絞れる', () => {
    expect(filterByGrade(items, 'low').map((i) => i.cardId)).toEqual(['b']);
    expect(filterByGrade(items, 'mid')).toHaveLength(0);
  });

  it('内訳を数える', () => {
    expect(tallyDrillItems(items)).toEqual({ all: 4, none: 2, low: 1, mid: 0, high: 1 });
  });
});

describe('演習の扱い', () => {
  const items = buildDrillItems(
    [
      note({
        cards: [card({ cardId: 'hi', attempts: [at('2026-08-08', 'high')] })],
        exercise: { q: '演習', a: '' },
      }),
    ],
    null,
  );

  it('記録で並べるときは、ばっちりの想起問題より後ろに回る', () => {
    expect(sortDrillItems(items, 'weak').map((i) => i.kind)).toEqual(['想起', '演習']);
    expect(sortDrillItems(items, 'stale').map((i) => i.kind)).toEqual(['想起', '演習']);
  });
});

describe('arrangeDrillItems', () => {
  it('絞り込んでから並べ替える', () => {
    const items = buildDrillItems(
      [
        note({
          cards: [
            card({ cardId: 'a', attempts: [at('2026-08-08', 'low')] }),
            card({ cardId: 'b', attempts: [at('2026-08-02', 'low')] }),
            card({ cardId: 'c', attempts: [at('2026-08-01', 'high')] }),
          ],
        }),
      ],
      null,
    );
    expect(arrangeDrillItems(items, 'weak', 'low').map((i) => i.cardId)).toEqual(['b', 'a']);
  });
});
