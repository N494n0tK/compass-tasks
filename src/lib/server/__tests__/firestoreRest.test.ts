import { describe, expect, it } from 'vitest';
import {
  fieldPath,
  fromFirestoreFields,
  fromFirestoreValue,
  toFirestoreFields,
  toFirestoreValue,
} from '../firestoreRest';

/** ノート 1 冊ぶんに出てくる形を代表させたもの */
const NOTE_SHAPED = {
  id: 'n1',
  v: 1,
  date: '2026-08-20',
  scans: [] as unknown[],
  cards: [
    {
      cardId: 'c1',
      q: '$S_n$ とは',
      origin: 'self',
      attempts: [{ day: '2026-08-21', grade: 'low' }],
    },
  ],
  exercise: { q: '', a: '' },
  summary: '',
  ratio: 0.5,
  done: false,
  missing: null,
};

describe('値の変換', () => {
  it('ノートの形が往復しても変わらない', () => {
    expect(fromFirestoreFields(toFirestoreFields(NOTE_SHAPED))).toEqual(NOTE_SHAPED);
  });

  it('整数は integerValue、小数は doubleValue へ', () => {
    expect(toFirestoreValue(7)).toEqual({ integerValue: '7' });
    expect(toFirestoreValue(0.5)).toEqual({ doubleValue: 0.5 });
    expect(fromFirestoreValue({ integerValue: '7' })).toBe(7);
  });

  it('null と undefined は nullValue / 欠落として扱う', () => {
    expect(toFirestoreValue(null)).toEqual({ nullValue: null });
    expect(toFirestoreFields({ a: undefined, b: 1 })).toEqual({ b: { integerValue: '1' } });
  });

  it('読む側は timestamp / reference も文字列に落とす', () => {
    expect(fromFirestoreValue({ timestampValue: '2026-08-20T00:00:00Z' })).toBe('2026-08-20T00:00:00Z');
    expect(fromFirestoreValue({ referenceValue: 'projects/p/databases/(default)/documents/a/b' })).toBe(
      'projects/p/databases/(default)/documents/a/b',
    );
  });

  it('知らない形は null（読み込みを止めない）', () => {
    expect(fromFirestoreValue({ weirdValue: 1 })).toBeNull();
    expect(fromFirestoreValue('bare string')).toBeNull();
  });
});

describe('fieldPath', () => {
  it('ふつうのキーはそのまま、記号入りはバッククォートで包む', () => {
    expect(fieldPath('createdAt')).toBe('createdAt');
    expect(fieldPath('a.b')).toBe('`a.b`');
    expect(fieldPath('1st')).toBe('`1st`');
  });
});
