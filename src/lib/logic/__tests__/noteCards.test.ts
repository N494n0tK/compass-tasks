import { describe, expect, it } from 'vitest';

import type { Note, NoteCard } from '../../model/notes';
import type { Review } from '../../model/types';
import { nextReviewOf } from '../reviews';
import {
  NOTE_REVIEW_SRC,
  cascadeNoteRemoval,
  collapseNoteReviews,
  dueCardsOfNote,
  generateMessage,
  generateNoteReviews,
  isNoteReview,
  noteRefOf,
  noteSeriesId,
  syncNoteReviews,
  worstGradeToday,
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
    scans: [],
    cards: [card({ cardId: 'c0' }), card({ cardId: 'c1' }), card({ cardId: 'c2' })],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: T,
    updatedAt: T,
    trashedAt: '',
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

describe('noteSeriesId / noteRefOf（1 冊 1 系列）', () => {
  it('系列 ID は nb-<noteId>（問は指さない）', () => {
    expect(noteSeriesId('nabc')).toBe('nb-nabc');
  });

  it('往復できる', () => {
    expect(noteRefOf(noteSeriesId('nabc'))).toEqual({ noteId: 'nabc', cardId: null });
  });

  it('古い「問ごと」の系列も同じノートとして読める（完了済みの履歴が残っているため）', () => {
    expect(noteRefOf('nb-nabc-c1')).toEqual({ noteId: 'nabc', cardId: 'c1' });
  });

  it('手動追加の id には反応しない', () => {
    expect(noteRefOf('u17')).toBeNull();
    expect(noteRefOf(null)).toBeNull();
    expect(noteRefOf('nb-')).toBeNull();
  });

  it('系列 ID は Firestore の doc id 制約を踏まない', () => {
    const sid = noteSeriesId('nabc');
    expect(sid.includes('/')).toBe(false);
    expect(sid.includes('__')).toBe(false);
  });

  it('isNoteReview はノート指定つきで判定できる', () => {
    const r = review({ id: 'x', seriesId: noteSeriesId('nabc') });
    expect(isNoteReview(r)).toBe(true);
    expect(isNoteReview(r, 'nabc')).toBe(true);
    expect(isNoteReview(r, 'nzzz')).toBe(false);
    expect(isNoteReview(review())).toBe(false);
  });
});

describe('generateNoteReviews — ノート 1 冊 = 復習 1 件', () => {
  it('問が何問あっても作るのは 1 件だけ', () => {
    const gen = generateNoteReviews(note(), [], T);
    expect(gen.created.length).toBe(1);
    expect(gen.skipped).toBe(0);
  });

  it('問はミニタスク「問1」…として 1 件の中に入る', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    expect(r.subs).toEqual(['問1', '問2', '問3']);
    expect(r.subsDone).toEqual([false, false, false]);
  });

  it('タイトルは単元名そのまま（問番号を付けない）', () => {
    const [r] = generateNoteReviews(note({ unit: '数列' }), [], T).created;
    expect(r.title).toBe('数列');
  });

  it('見積りは問数ぶん', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    expect(r.min).toBe(15); // 5 分 × 3 問
  });

  it('同じノートを2回取り込んでも増えない（冪等）', () => {
    const first = generateNoteReviews(note(), [], T).created;
    const again = generateNoteReviews(note(), first, T);
    expect(again.created.length).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it('完了済みの系列も「消化済み」として作り直さない', () => {
    const done = review({ id: noteSeriesId('nabc'), seriesId: noteSeriesId('nabc'), done: true });
    expect(generateNoteReviews(note(), [done], T).created.length).toBe(0);
  });

  it('古い「問ごと」の未完了行が残っているうちは作らない（移行前に二重に並ばない）', () => {
    const legacy = review({ id: 'nb-nabc-c0', seriesId: 'nb-nabc-c0' });
    expect(generateNoteReviews(note(), [legacy], T).created.length).toBe(0);
  });

  it('問が 1 つも無いノートには作らない', () => {
    expect(generateNoteReviews(note({ cards: [] }), [], T).created.length).toBe(0);
  });

  it('stage は当日、due は今日、最初から今日のToDoに積まれる', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    expect(r.stage).toBe('当日');
    expect(r.due).toBe(T);
    expect(r.last).toBe(T);
    expect(r.added).toBe(true);
    expect(r.done).toBe(false);
    expect(r.src).toBe(NOTE_REVIEW_SRC);
    expect(r.reviewNo).toBe(1);
  });

  it('当日を消化すると翌日へ送られる（理解度によらず）', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    (['high', 'mid', 'low'] as const).forEach((g) => {
      const next = nextReviewOf(r, g, 'XS', T, { newId: () => 'g' }).next;
      expect(next?.stage).toBe('翌日');
      expect(next?.due).toBe(TOMORROW);
    });
  });

  it('初回は id === seriesId', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    expect(r.id).toBe(r.seriesId);
    expect(r.id).toBe('nb-nabc');
  });

  it('他ノート・手動追加の復習には影響されない', () => {
    const others = [review({ id: 'u1' }), review({ id: 'nb-nzzz', seriesId: 'nb-nzzz' })];
    expect(generateNoteReviews(note(), others, T).created.length).toBe(1);
  });

  it('トースト文言', () => {
    expect(generateMessage({ created: [], skipped: 1 })).toBeNull();
    expect(generateMessage(generateNoteReviews(note(), [], T))).toBe('復習カードを1件作成しました');
  });
});

describe('リンクの不変条件（nextReviewOf を通しても解決する）', () => {
  it('段階を進めても seriesId からノートを引ける', () => {
    const [first] = generateNoteReviews(note(), [], T).created;
    let cur = first;
    // 当日 → 翌日 → 3日後 → 1週間後 → 2週間後（次は「定着」で系列終了）
    for (let i = 0; i < 4; i += 1) {
      const t = nextReviewOf(cur, 'high', 'S', T, { newId: () => 'gen' + i });
      expect(t.next).not.toBeNull();
      cur = t.next as Review;
      expect(cur.id).not.toBe(cur.seriesId); // 2 回目以降は id が別になる
      expect(noteRefOf(cur.seriesId)).toEqual({ noteId: 'nabc', cardId: null });
    }
    expect(nextReviewOf(cur, 'high', 'S', T).next).toBeNull();
  });

  it('理解度「不安」で巻き戻してもリンクは切れない', () => {
    const [first] = generateNoteReviews(note(), [], T).created;
    const next = nextReviewOf(first, 'low', 'XS', T, { newId: () => 'g' }).next as Review;
    expect(next.stage).toBe('翌日');
    expect(noteRefOf(next.seriesId)).toEqual({ noteId: 'nabc', cardId: null });
  });
});

describe('collapseNoteReviews — 問ごと → 1 冊 1 行への移行', () => {
  function legacyRow(cardId: string, over: Partial<Review> = {}): Review {
    const id = 'nb-nabc-' + cardId;
    return review({ id, seriesId: id, title: '数列 問X', subj: '数学', added: true, ...over });
  }

  it('未完了の問ごとの行が 1 行に畳まれる', () => {
    const rows = [legacyRow('c0'), legacyRow('c1'), legacyRow('c2')];
    const out = collapseNoteReviews(rows, [note()], T);
    expect(out.changed).toBe(true);
    expect(out.reviews.length).toBe(1);
    expect(out.reviews[0].id).toBe('nb-nabc');
    expect(out.reviews[0].title).toBe('数列');
    expect(out.reviews[0].subs).toEqual(['問1', '問2', '問3']);
  });

  it('日付はいちばん遅れている行から引き継ぐ（進んでいるほうに合わせない）', () => {
    const rows = [
      legacyRow('c0', { due: '2026-08-20', stage: '2週間後', reviewNo: 4 }),
      legacyRow('c1', { due: '2026-08-08', stage: '翌日', reviewNo: 2 }),
    ];
    const out = collapseNoteReviews(rows, [note()], T);
    expect(out.reviews[0].due).toBe('2026-08-08');
    expect(out.reviews[0].stage).toBe('翌日');
    expect(out.reviews[0].reviewNo).toBe(2);
  });

  it('完了済みの古い行は学習履歴なので残す', () => {
    const rows = [legacyRow('c0'), legacyRow('c1', { id: 'old-done', done: true })];
    const out = collapseNoteReviews(rows, [note()], T);
    expect(out.reviews.some((r) => r.id === 'old-done')).toBe(true);
  });

  it('冪等 ―― 畳んだあとに通しても何も起きない', () => {
    const once = collapseNoteReviews([legacyRow('c0'), legacyRow('c1')], [note()], T);
    const twice = collapseNoteReviews(once.reviews, [note()], T);
    expect(twice.changed).toBe(false);
    expect(twice.reviews).toBe(once.reviews);
  });

  it('既に 1 冊 1 行があるノートは、古い行を落とすだけ', () => {
    const unit = review({ id: 'nb-nabc', seriesId: 'nb-nabc', title: '数列' });
    const out = collapseNoteReviews([unit, legacyRow('c0')], [note()], T);
    expect(out.reviews.map((r) => r.id)).toEqual(['nb-nabc']);
  });

  it('ノートが消えていれば行も残さない', () => {
    const out = collapseNoteReviews([legacyRow('c0')], [], T);
    expect(out.reviews.length).toBe(0);
  });

  it('ノート由来でない復習には触らない', () => {
    const out = collapseNoteReviews([review({ id: 'u1' }), legacyRow('c0')], [note()], T);
    expect(out.reviews.some((r) => r.id === 'u1')).toBe(true);
  });
});

describe('syncNoteReviews — 単元名・教科・ミニタスクの追従', () => {
  it('未完了行のタイトル・教科が追従する', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    const out = syncNoteReviews(note({ unit: '数列と漸化式', subject: '数A' }), [r]);
    expect(out[0].title).toBe('数列と漸化式');
    expect(out[0].subj).toBe('数A');
  });

  it('問が増えるとミニタスクも増え、済んだぶんは位置で引き継がれる', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    const started = { ...r, subsDone: [true, false, false] };
    const grown = note({ cards: [card({ cardId: 'c0' }), card({ cardId: 'c1' }), card({ cardId: 'c2' }), card({ cardId: 'c3' })] });
    const out = syncNoteReviews(grown, [started]);
    expect(out[0].subs).toEqual(['問1', '問2', '問3', '問4']);
    expect(out[0].subsDone).toEqual([true, false, false, false]);
  });

  it('完了済みの行は触らない', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    const done = { ...r, done: true };
    expect(syncNoteReviews(note({ unit: '別の名前' }), [done])[0].title).toBe('数列');
  });

  it('変化が無ければ同じ配列参照を返す', () => {
    const [r] = generateNoteReviews(note(), [], T).created;
    const rows = [r];
    expect(syncNoteReviews(note(), rows)).toBe(rows);
  });
});

describe('dueCardsOfNote — 今日ぶんの問', () => {
  function withReview(over: Partial<Review> = {}) {
    const [r] = generateNoteReviews(note(), [], T).created;
    return [{ ...r, ...over }];
  }

  it('ノートの並び順で問を返す', () => {
    const due = dueCardsOfNote(withReview(), note(), T);
    expect(due?.cards.map((c) => c.cardNo)).toEqual([1, 2, 3]);
    expect(due?.remaining).toBe(3);
  });

  it('ミニタスクの済みが問の済みになる', () => {
    const due = dueCardsOfNote(withReview({ subsDone: [true, false, false] }), note(), T);
    expect(due?.cards.map((c) => c.done)).toEqual([true, false, false]);
    expect(due?.remaining).toBe(2);
  });

  it('今日完了した行は残る（ToDo の1枚が消えないように）', () => {
    const due = dueCardsOfNote(withReview({ done: true, due: T }), note(), T);
    expect(due).not.toBeNull();
    expect(due?.remaining).toBe(0);
  });

  it('前回までの完了履歴（due < 今日）は含めない', () => {
    expect(dueCardsOfNote(withReview({ done: true, due: '2026-08-01' }), note(), T)).toBeNull();
  });

  it('まだ先の予定（due > 今日）は含めない', () => {
    expect(dueCardsOfNote(withReview({ due: TOMORROW }), note(), T)).toBeNull();
  });

  it('遅れている（due < 今日）未完了は含める', () => {
    expect(dueCardsOfNote(withReview({ due: '2026-08-01' }), note(), T)).not.toBeNull();
  });

  it('他ノート・手動追加の復習は混ざらない', () => {
    const rows = [review({ id: 'u1', due: T, added: true }), review({ id: 'nb-nzzz', seriesId: 'nb-nzzz', due: T })];
    expect(dueCardsOfNote(rows, note(), T)).toBeNull();
  });
});

describe('worstGradeToday — 行を送るときの理解度', () => {
  it('今日つけた中でいちばん低いものを返す', () => {
    const n = note({
      cards: [
        card({ cardId: 'c0', attempts: [{ day: T, grade: 'high' }] }),
        card({ cardId: 'c1', attempts: [{ day: T, grade: 'low' }] }),
        card({ cardId: 'c2', attempts: [{ day: T, grade: 'mid' }] }),
      ],
    });
    expect(worstGradeToday([n], 'nabc', T)).toBe('low');
  });

  it('昨日までの記録は見ない', () => {
    const n = note({ cards: [card({ cardId: 'c0', attempts: [{ day: '2026-08-01', grade: 'low' }] })] });
    expect(worstGradeToday([n], 'nabc', T)).toBeNull();
  });

  it('ノートが無ければ null', () => {
    expect(worstGradeToday([], 'nabc', T)).toBeNull();
  });
});

describe('cascadeNoteRemoval（N-030〜N-032）', () => {
  function noteRows(): Review[] {
    return generateNoteReviews(note(), [], T).created;
  }

  it('N-030 未完了だけ消え、完了済みは残る', () => {
    const rows = noteRows().concat([review({ id: 'nb-nabc-old', seriesId: 'nb-nabc-old', done: true })]);
    const out = cascadeNoteRemoval(rows, [], null, 'nabc');
    expect(out.reviews.map((r) => r.id)).toEqual(['nb-nabc-old']);
    expect(out.removedIds).toEqual(['nb-nabc']);
  });

  it('古い「問ごと」の未完了行もまとめて落ちる', () => {
    const rows = [review({ id: 'nb-nabc-c0', seriesId: 'nb-nabc-c0' })];
    expect(cascadeNoteRemoval(rows, [], null, 'nabc').reviews.length).toBe(0);
  });

  it('N-031 order からも外れる', () => {
    const rows = noteRows();
    const out = cascadeNoteRemoval(rows, ['nb-nabc', 'u1'], null, 'nabc');
    expect(out.order).toEqual(['u1']);
  });

  it('N-032 selId が対象なら null になる', () => {
    const out = cascadeNoteRemoval(noteRows(), [], 'nb-nabc', 'nabc');
    expect(out.selId).toBeNull();
  });

  it('対象が無いときは参照ごと不変', () => {
    const rows = [review({ id: 'u1' })];
    const out = cascadeNoteRemoval(rows, [], null, 'nzzz');
    expect(out.reviews).toBe(rows);
    expect(out.removedIds).toEqual([]);
  });
});
