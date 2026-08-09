import { describe, expect, it } from 'vitest';

import type { Note, NoteCard } from '../../model/notes';
import type { Review } from '../../model/types';
import { nextReviewOf } from '../reviews';
import {
  NOTE_REVIEW_SRC,
  cascadeNoteRemoval,
  dueCardsOfNote,
  generateMessage,
  generateNoteReviews,
  isNoteReview,
  noteRefOf,
  noteReviewTitle,
  noteSeriesId,
  syncNoteReviews,
} from '../noteCards';

const T = '2026-08-06';
const TOMORROW = '2026-08-07';

function card(over: Partial<NoteCard> = {}): NoteCard {
  return { cardId: 'c0', q: 'Q', a: 'A', guide: '', src: '', origin: 'ai', attempts: [], ...over };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'nabc',
    v: 1,
    date: T,
    subject: '数学',
    unit: '数列',
    cards: [card({ cardId: 'c0' }), card({ cardId: 'c1' }), card({ cardId: 'c2' })],
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

function review(over: Partial<Review> = {}): Review {
  const id = over.id || 'r1';
  return {
    id,
    seriesId: id,
    reviewNo: 1,
    title: '手動の復習',
    subj: '英語',
    stage: '翌日',
    last: T,
    due: TOMORROW,
    min: 10,
    src: '手動追加',
    timetablePeriod: null,
    timetableDate: null,
    added: false,
    done: false,
    ...over,
  };
}

describe('noteSeriesId / noteRefOf（N-024〜N-026）', () => {
  it('N-024 系列 ID は nb-<noteId>-<cardId>', () => {
    expect(noteSeriesId('nabc', 'c0')).toBe('nb-nabc-c0');
  });

  it('N-025 往復できる', () => {
    expect(noteRefOf(noteSeriesId('nabc', 'c12'))).toEqual({ noteId: 'nabc', cardId: 'c12' });
  });

  it('N-026 手動追加の id には反応しない', () => {
    expect(noteRefOf('umf3k212')).toBeNull();
    expect(noteRefOf('')).toBeNull();
    expect(noteRefOf(null)).toBeNull();
    expect(noteRefOf(undefined)).toBeNull();
    // 形が似ていても prefix が違えば null
    expect(noteRefOf('nb-xabc-c0')).toBeNull();
    expect(noteRefOf('nb-nabc-x0')).toBeNull();
  });

  it('系列 ID は Firestore の doc id 制約を踏まない', () => {
    const id = noteSeriesId('nabc', 'c0');
    expect(id).not.toContain('/');
    expect(id.startsWith('__') && id.endsWith('__')).toBe(false);
  });

  it('isNoteReview はノート指定つきで判定できる', () => {
    const r = review({ id: noteSeriesId('nabc', 'c0'), seriesId: noteSeriesId('nabc', 'c0') });
    expect(isNoteReview(r)).toBe(true);
    expect(isNoteReview(r, 'nabc')).toBe(true);
    expect(isNoteReview(r, 'nzzz')).toBe(false);
    expect(isNoteReview(review())).toBe(false);
  });
});

describe('generateNoteReviews（N-021〜N-023 / N-028 / N-029）', () => {
  it('N-021 カード数と同じ件数を作る', () => {
    const res = generateNoteReviews(note(), [], T);
    expect(res.created).toHaveLength(3);
    expect(res.skipped).toBe(0);
  });

  it('N-022 同じノートを2回取り込んでも増えない（冪等）', () => {
    const first = generateNoteReviews(note(), [], T);
    const second = generateNoteReviews(note(), first.created, T);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(3);
    expect(generateMessage(second)).toBeNull();
  });

  it('N-022 完了済みの系列も「消化済み」として作り直さない', () => {
    const done = generateNoteReviews(note(), [], T).created.map((r) => ({ ...r, done: true }));
    expect(generateNoteReviews(note(), done, T).created).toHaveLength(0);
  });

  it('N-023 stage は当日、due は今日、最初から今日のToDoに積まれる', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    expect(r.stage).toBe('当日');
    expect(r.last).toBe(T);
    expect(r.due).toBe(T);
    expect(r.added).toBe(true);
    expect(r.reviewNo).toBe(1);
    expect(r.min).toBe(5);
    expect(r.src).toBe(NOTE_REVIEW_SRC);
    expect(r.done).toBe(false);
    expect(r.timetablePeriod).toBeNull();
    expect(r.timetableDate).toBeNull();
  });

  it('N-023 当日を消化すると翌日へ送られる（理解度によらず）', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    (['high', 'mid', 'low'] as const).forEach((g) => {
      const next = nextReviewOf(r, g, 'XS', T, { newId: () => 'g' }).next;
      expect(next?.stage).toBe('翌日');
      expect(next?.due).toBe(TOMORROW);
    });
  });

  it('N-024 初回は id === seriesId', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    rs.forEach((r) => expect(r.id).toBe(r.seriesId));
    expect(rs.map((r) => r.id)).toEqual(['nb-nabc-c0', 'nb-nabc-c1', 'nb-nabc-c2']);
  });

  it('N-028 タイトルは「単元 問N」（1 始まり）', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    expect(rs.map((r) => r.title)).toEqual(['数列 問1', '数列 問2', '数列 問3']);
    expect(noteReviewTitle(note(), 'c2')).toBe('数列 問3');
    expect(rs.every((r) => r.subj === '数学')).toBe(true);
  });

  it('N-029 一部だけ欠けていれば欠けた分だけ作る', () => {
    const all = generateNoteReviews(note(), [], T).created;
    const partial = [all[0], all[2]];
    const res = generateNoteReviews(note(), partial, T);
    expect(res.created.map((r) => r.seriesId)).toEqual(['nb-nabc-c1']);
    expect(res.skipped).toBe(2);
  });

  it('他ノート・手動追加の復習には影響されない', () => {
    const others = [review(), ...generateNoteReviews(note({ id: 'nzzz' }), [], T).created];
    expect(generateNoteReviews(note(), others, T).created).toHaveLength(3);
  });

  it('トースト文言', () => {
    expect(generateMessage(generateNoteReviews(note(), [], T))).toBe('復習カードを3件作成しました');
  });
});

describe('N-027 リンクの不変条件（nextReviewOf を通しても解決する）', () => {
  it('段階を進めても seriesId からノート・カードを引ける', () => {
    const [first] = generateNoteReviews(note(), [], T).created;
    let cur = first;
    // 当日 → 翌日 → 3日後 → 1週間後 → 2週間後（次は「定着」で系列終了）
    for (let i = 0; i < 4; i += 1) {
      const t = nextReviewOf(cur, 'high', 'S', T, { newId: () => 'gen' + i });
      expect(t.next).not.toBeNull();
      cur = t.next as Review;
      expect(cur.id).not.toBe(cur.seriesId); // 2 回目以降は id が別になる
      expect(noteRefOf(cur.seriesId)).toEqual({ noteId: 'nabc', cardId: 'c0' });
    }
    // 「定着」で系列終了しても、それまでの行のリンクは生きている
    expect(nextReviewOf(cur, 'high', 'S', T).next).toBeNull();
  });

  it('理解度「不安」で巻き戻してもリンクは切れない', () => {
    const [first] = generateNoteReviews(note(), [], T).created;
    const next = nextReviewOf(first, 'low', 'XS', T, { newId: () => 'g' }).next as Review;
    expect(next.stage).toBe('翌日');
    expect(noteRefOf(next.seriesId)).toEqual({ noteId: 'nabc', cardId: 'c0' });
  });
});

describe('syncNoteReviews（N-034）', () => {
  it('未完了行のタイトル・教科だけ追従する', () => {
    const generated = generateNoteReviews(note(), [], T).created;
    const reviews = [
      { ...generated[0], done: true },
      generated[1],
      review(), // 無関係の手動復習
    ];
    const renamed = note({ unit: '数列と漸化式', subject: '数学Ⅱ' });
    const out = syncNoteReviews(renamed, reviews);
    expect(out[0].title).toBe('数列 問1'); // 完了行は据え置き
    expect(out[0].subj).toBe('数学');
    expect(out[1].title).toBe('数列と漸化式 問2');
    expect(out[1].subj).toBe('数学Ⅱ');
    expect(out[2]).toBe(reviews[2]); // 手動復習は参照ごと不変
  });

  it('変化が無ければ同じ配列参照を返す', () => {
    const reviews = generateNoteReviews(note(), [], T).created;
    expect(syncNoteReviews(note(), reviews)).toBe(reviews);
  });
});

describe('dueCardsOfNote（今日ぶんの束ね / N-035〜N-038）', () => {
  it('N-035 期限が来ている未完了カードを問番号順に集める', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const shuffled = [rs[2], rs[0], rs[1]];
    expect(dueCardsOfNote(shuffled, note(), T).map((d) => d.cardNo)).toEqual([1, 2, 3]);
  });

  it('N-036 今日完了した行は残る（ToDo の1枚が消えないように）', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const withDone = [{ ...rs[0], done: true }, rs[1], rs[2]];
    const due = dueCardsOfNote(withDone, note(), T);
    expect(due).toHaveLength(3);
    expect(due[0].review.done).toBe(true);
  });

  it('N-036 前回までの完了履歴（due < 今日）は含めない', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const history = { ...rs[0], done: true, due: '2026-08-01' };
    expect(dueCardsOfNote([history, rs[1]], note(), T).map((d) => d.cardNo)).toEqual([2]);
  });

  it('N-037 まだ先の予定（due > 今日）は含めない', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const future = { ...rs[1], due: '2026-08-20' };
    expect(dueCardsOfNote([rs[0], future, rs[2]], note(), T).map((d) => d.cardNo)).toEqual([1, 3]);
  });

  it('N-037 遅れている（due < 今日）未完了は含める', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const late = { ...rs[0], due: '2026-08-01' };
    expect(dueCardsOfNote([late], note(), T)).toHaveLength(1);
  });

  it('N-038 他ノート・手動追加の復習は混ざらない', () => {
    const mine = generateNoteReviews(note(), [], T).created;
    const other = generateNoteReviews(note({ id: 'nzzz' }), [], T).created;
    expect(dueCardsOfNote(mine.concat(other, [review()]), note(), T)).toHaveLength(3);
  });

  it('ノートから消えたカードの行は末尾に回る', () => {
    const rs = generateNoteReviews(note(), [], T).created;
    const shrunk = note({ cards: [card({ cardId: 'c1' })] });
    const due = dueCardsOfNote(rs, shrunk, T);
    expect(due.map((d) => d.cardId)).toEqual(['c1', 'c0', 'c2']);
    expect(due[1].cardNo).toBeNull();
  });
});

describe('cascadeNoteRemoval（N-030〜N-033）', () => {
  const generated = generateNoteReviews(note(), [], T).created;
  const reviews: Review[] = [
    { ...generated[0], done: true, completedAt: T },
    { ...generated[1], added: true },
    generated[2],
    review({ id: 'manual' }),
  ];
  const order = ['nb-nabc-c1', 'nb-nabc-c2', 'manual'];

  it('N-030 未完了だけ消え、完了済みは残る', () => {
    const res = cascadeNoteRemoval(reviews, order, null, 'nabc');
    expect(res.reviews.map((r) => r.id)).toEqual(['nb-nabc-c0', 'manual']);
    expect(res.removedIds).toEqual(['nb-nabc-c1', 'nb-nabc-c2']);
  });

  it('N-031 order からも外れる', () => {
    expect(cascadeNoteRemoval(reviews, order, null, 'nabc').order).toEqual(['manual']);
  });

  it('N-032 selId が対象なら null になる', () => {
    expect(cascadeNoteRemoval(reviews, order, 'nb-nabc-c1', 'nabc').selId).toBeNull();
    expect(cascadeNoteRemoval(reviews, order, 'manual', 'nabc').selId).toBe('manual');
  });

  it('N-033 カードを指定するとその系列だけ消える', () => {
    const res = cascadeNoteRemoval(reviews, order, null, 'nabc', ['c2']);
    expect(res.removedIds).toEqual(['nb-nabc-c2']);
    expect(res.order).toEqual(['nb-nabc-c1', 'manual']);
  });

  it('対象が無いときは参照ごと不変', () => {
    const res = cascadeNoteRemoval(reviews, order, 'manual', 'nzzz');
    expect(res.reviews).toBe(reviews);
    expect(res.order).toBe(order);
    expect(res.removedIds).toEqual([]);
  });
});
