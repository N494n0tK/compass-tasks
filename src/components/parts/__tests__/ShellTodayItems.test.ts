import { describe, expect, it } from 'vitest';

import { generateNoteReviews } from '../../../lib/logic/noteCards';
import type { Note } from '../../../lib/model/notes';
import type { Extra, Plans, Review } from '../../../lib/model/types';
import { buildTodayItems, todayTotals, type TodayItemsInput } from '../ShellTodayItems';

/**
 * ノート由来の復習を「1 冊 1 枚」に束ねる挙動（docs/notebook/spec.md §4.2 / N-071〜N-076）。
 * それ以外の項目（seg / extra / 手動の復習）はレガシーどおり 1 件 1 枚のままであることも見る。
 */

const T = '2026-08-06';
const PLANS: Plans = {};

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'nabc',
    v: 1,
    date: T,
    subject: '数学',
    unit: '数列 ─ 漸化式と一般項',
    scans: [],
    cards: [
      { cardId: 'c0', q: 'Q1', a: 'A1', guide: '', src: '', origin: 'ai', attempts: [] },
      { cardId: 'c1', q: 'Q2', a: 'A2', guide: '', src: '', origin: 'ai', attempts: [] },
      { cardId: 'c2', q: 'Q3', a: 'A3', guide: '', src: '', origin: 'ai', attempts: [] },
    ],
    blocks: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function manualReview(over: Partial<Review> = {}): Review {
  const id = over.id || 'umanual';
  return {
    id,
    seriesId: id,
    reviewNo: 1,
    title: '英単語 Unit3',
    subj: '英語',
    stage: '翌日',
    last: T,
    due: T,
    min: 10,
    src: '手動追加',
    timetablePeriod: null,
    timetableDate: null,
    added: true,
    done: false,
    ...over,
  };
}

function extra(over: Partial<Extra> = {}): Extra {
  return {
    id: 'ux',
    title: '数学の予習',
    subj: '数学',
    size: 'S',
    min: 10,
    day: T,
    done: false,
    src: '予習 · 8/7 1限(自動)',
    timetablePeriod: 1,
    timetableDate: '2026-08-07',
    ...over,
  };
}

function input(over: Partial<TodayItemsInput> = {}): TodayItemsInput {
  return { segs: [], extras: [], reviews: [], order: [], ...over };
}

describe('buildTodayItems — ノート復習の束ね', () => {
  const reviews = generateNoteReviews(note(), [], T).created;

  it('N-071 想起問題3問でも今日のToDoには1枚だけ出る', () => {
    const items = buildTodayItems(input({ reviews, notes: [note()] }), PLANS, T);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('rev');
    expect(items[0].noteGroup).toHaveLength(3);
  });

  it('N-072 タイトルはノートの単元名', () => {
    const [it] = buildTodayItems(input({ reviews, notes: [note()] }), PLANS, T);
    expect(it.title).toBe('数列 ─ 漸化式と一般項');
    expect(it.src).toBe('ノートの復習 · 3/3問');
    expect(it.noteId).toBe('nabc');
  });

  it('N-072 分数は束ねた合計', () => {
    const [it] = buildTodayItems(input({ reviews, notes: [note()] }), PLANS, T);
    expect(it.min).toBe(15);
    expect(todayTotals([it]).totalMin).toBe(15);
  });

  it('N-073 全問終わって初めて完了になる', () => {
    const half = [{ ...reviews[0], done: true }, reviews[1], reviews[2]];
    const [partial] = buildTodayItems(input({ reviews: half, notes: [note()] }), PLANS, T);
    expect(partial.done).toBe(false);
    expect(partial.src).toBe('ノートの復習 · 2/3問');

    const all = half.map((r) => ({ ...r, done: true }));
    const [full] = buildTodayItems(input({ reviews: all, notes: [note()] }), PLANS, T);
    expect(full.done).toBe(true);
    expect(full.src).toBe('ノートの復習 · 3問 完了');
  });

  it('N-074 ノートが違えば別の枚数になる', () => {
    const other = generateNoteReviews(note({ id: 'nzzz', unit: '仮定法' }), [], T).created;
    const items = buildTodayItems(
      input({ reviews: reviews.concat(other), notes: [note(), note({ id: 'nzzz', unit: '仮定法' })] }),
      PLANS,
      T,
    );
    expect(items.map((i) => i.title)).toEqual(['数列 ─ 漸化式と一般項', '仮定法']);
  });

  it('N-075 手動の復習・単発タスクは束ねない（レガシーどおり1件1枚）', () => {
    const items = buildTodayItems(
      input({ reviews: reviews.concat([manualReview()]), extras: [extra()], notes: [note()] }),
      PLANS,
      T,
    );
    // 追記順は order → segs → extras → reviews（レガシー C-517。ここは変えていない）
    expect(items.map((i) => i.title)).toEqual([
      '数学の予習',
      '数列 ─ 漸化式と一般項',
      '英単語 Unit3',
    ]);
    expect(items[0].noteId).toBeUndefined();
    expect(items[2].noteId).toBeUndefined();
  });

  it('N-076 ノートが読み込めていないときは束ねない（1問1枚のまま）', () => {
    const items = buildTodayItems(input({ reviews }), PLANS, T);
    expect(items).toHaveLength(3);
    expect(items[0].noteId).toBeUndefined();
    expect(items[0].title).toBe('数列 ─ 漸化式と一般項 問1');
  });

  it('N-076 ノートが削除済みでも落ちない', () => {
    const items = buildTodayItems(input({ reviews, notes: [note({ id: 'nother' })] }), PLANS, T);
    expect(items).toHaveLength(3);
  });

  it('order に入っている並び順を尊重する', () => {
    const items = buildTodayItems(
      input({
        reviews: [manualReview()].concat(reviews),
        order: ['umanual', reviews[0].id],
        notes: [note()],
      }),
      PLANS,
      T,
    );
    expect(items.map((i) => i.title)).toEqual(['英単語 Unit3', '数列 ─ 漸化式と一般項']);
  });
});
