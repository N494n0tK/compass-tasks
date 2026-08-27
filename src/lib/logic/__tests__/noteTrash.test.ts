import { describe, expect, it } from 'vitest';

import type { Note, NoteCard } from '../../model/notes';
import { NOTE_TRASH_DAYS, NOTE_UNDO_MAX, type Extra, type NoteUndo, type Review } from '../../model/types';
import { noteSeriesId } from '../noteCards';
import { noteSummaryExtraId } from '../noteSummaryTasks';
import {
  applyNoteUndo,
  expiredTrashIds,
  noteCascadeCounts,
  noteLabel,
  purgeTrash,
  pushNoteUndo,
  renameNote,
  restoreNote,
  restoreOrder,
  sortTrashList,
  trashDaysLeft,
  trashNote,
  undoMessage,
  type NoteTrashState,
} from '../noteTrash';

/** 2026-08-06(木) を「今日」とする（`noteCards.test.ts` と同じ日） */
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
    cards: [card({ cardId: 'c0' }), card({ cardId: 'c1' })],
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

/** ノート由来の復習（`seriesId` の命名規約だけがリンク） */
function noteReview(noteId: string, cardId: string, over: Partial<Review> = {}): Review {
  const sid = noteSeriesId(noteId, cardId);
  return review({ id: sid, seriesId: sid, title: '数列 問1', subj: '数学', ...over });
}

function summaryExtra(noteId: string, over: Partial<Extra> = {}): Extra {
  return {
    id: noteSummaryExtraId(noteId),
    title: '「数列」のまとめを書く',
    subj: '数学',
    size: 'S',
    min: 10,
    day: T,
    done: false,
    src: 'まとめを書く · ノートから提案',
    timetablePeriod: null,
    timetableDate: null,
    ...over,
  };
}

/** `AppState` の必要なところだけを模した入力 */
function state(over: Partial<NoteTrashState> = {}): NoteTrashState {
  return {
    notes: [note()],
    notesTrash: [],
    reviews: [],
    extras: [],
    order: [],
    selId: null,
    nbSelNoteId: null,
    nbUndo: [],
    ...over,
  };
}

/** 既定の全部入り: 未完了 2 件 + 完了 1 件 + まとめタスク + 別ノートの行 */
function fullState(): NoteTrashState {
  return state({
    reviews: [
      noteReview('nabc', 'c0', { id: 'nb-nabc-c0' }),
      noteReview('nabc', 'c1', { id: 'nb-nabc-c1' }),
      noteReview('nabc', 'c2', { id: 'nb-nabc-c2', done: true }),
      review({ id: 'umanual' }),
    ],
    extras: [summaryExtra('nabc')],
    order: ['umanual', 'nb-nabc-c0', 'nbsum-nabc', 'nb-nabc-c1'],
    nbSelNoteId: 'nabc',
  });
}

describe('trashNote — ゴミ箱へ入れる', () => {
  it('notes から消えて notesTrash に入り、trashedAt が付く', () => {
    const out = trashNote(state(), { noteId: 'nabc', alsoReviews: false, today: T, at: 1 });
    expect(out.changed).toBe(true);
    expect(out.next.notes).toEqual([]);
    expect(out.next.notesTrash.map((n) => n.id)).toEqual(['nabc']);
    expect(out.next.notesTrash[0].trashedAt).toBe(T);
    // 保存すべきノート = 印を立てたあとの姿
    expect(out.note?.trashedAt).toBe(T);
  });

  it('捨てても updatedAt は動かさない（中身を書き換えた日ではないから）', () => {
    const out = trashNote(state({ notes: [note({ updatedAt: '2026-07-01' })] }), {
      noteId: 'nabc',
      alsoReviews: true,
      today: T,
      at: 1,
    });
    expect(out.next.notesTrash[0].updatedAt).toBe('2026-07-01');
  });

  it('開いていたノートを捨てたら選択を外す', () => {
    const out = trashNote(fullState(), { noteId: 'nabc', alsoReviews: false, today: T, at: 1 });
    expect(out.next.nbSelNoteId).toBeNull();
  });

  it('alsoReviews:true で未完了の復習とまとめタスクが消える。完了済みは残る', () => {
    const out = trashNote(fullState(), { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    expect(out.next.reviews.map((r) => r.id)).toEqual(['nb-nabc-c2', 'umanual']);
    expect(out.next.extras).toEqual([]);
    expect(out.next.order).toEqual(['umanual']);
    expect(out.removedReviews).toBe(2);
    expect(out.removedSummaries).toBe(1);
  });

  it('alsoReviews:false なら復習もまとめも並びも触らない', () => {
    const s = fullState();
    const out = trashNote(s, { noteId: 'nabc', alsoReviews: false, today: T, at: 1 });
    expect(out.next.reviews).toBe(s.reviews);
    expect(out.next.extras).toBe(s.extras);
    expect(out.next.order).toBe(s.order);
    expect(out.removedReviews).toBe(0);
  });

  it('完了済みの復習は alsoReviews:true でも消えない', () => {
    const s = state({ reviews: [noteReview('nabc', 'c0', { done: true })] });
    const out = trashNote(s, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    expect(out.next.reviews).toHaveLength(1);
  });

  it('もう居ないノートには何もしない（二度押しで履歴が積み上がらない）', () => {
    const once = trashNote(state(), { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const twice = trashNote({ ...state(), ...once.next }, {
      noteId: 'nabc',
      alsoReviews: true,
      today: T,
      at: 2,
    });
    expect(twice.changed).toBe(false);
    expect(twice.next.nbUndo).toHaveLength(1);
  });

  it('控えるのは「操作前の姿」= trashedAt が空のノート', () => {
    const out = trashNote(fullState(), { noteId: 'nabc', alsoReviews: true, today: T, at: 7 });
    const u = out.next.nbUndo[0];
    expect(u.kind).toBe('trash');
    expect(u.note.trashedAt).toBe('');
    expect(u.reviews.map((r) => r.id)).toEqual(['nb-nabc-c0', 'nb-nabc-c1']);
    expect(u.extras.map((x) => x.id)).toEqual(['nbsum-nabc']);
    expect(u.order).toEqual(['umanual', 'nb-nabc-c0', 'nbsum-nabc', 'nb-nabc-c1']);
    expect(u.at).toBe(7);
  });
});

describe('applyNoteUndo — ⌘Z', () => {
  it('捨てたのを取り消すとノートも復習もまとめも並びも元通り', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const back = applyNoteUndo({ ...s0, ...trashed.next });

    expect(back.entry?.kind).toBe('trash');
    expect(back.next.notes.map((n) => n.id)).toEqual(['nabc']);
    expect(back.next.notes[0].trashedAt).toBe('');
    expect(back.next.notesTrash).toEqual([]);
    expect(back.next.reviews.map((r) => r.id).sort()).toEqual(
      s0.reviews.map((r) => r.id).sort(),
    );
    expect(back.next.extras.map((x) => x.id)).toEqual(['nbsum-nabc']);
    expect(back.next.order).toEqual(s0.order);
    expect(back.next.nbUndo).toEqual([]);
    expect(undoMessage(back)).toBe('「数列」を元に戻しました');
  });

  it('取り消しのあいだに足した行は並びから落ちない', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    // 捨てたあとに新しいタスクを積んだ状態で取り消す
    const mid: NoteTrashState = {
      ...s0,
      ...trashed.next,
      order: trashed.next.order.concat(['unew']),
    };
    const back = applyNoteUndo(mid);
    expect(back.next.order).toContain('unew');
    // 消えた行は元の位置（umanual の直後 / nbsum の直後）へ戻る
    expect(back.next.order).toEqual(['umanual', 'nb-nabc-c0', 'nbsum-nabc', 'nb-nabc-c1', 'unew']);
  });

  it('履歴が空なら何もしない', () => {
    const out = applyNoteUndo(state());
    expect(out.changed).toBe(false);
    expect(out.entry).toBeNull();
    expect(undoMessage(out)).toBe('取り消せる操作がありません');
  });

  it('同じ控えを二度適用しても行が二重にならない（冪等）', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const first = applyNoteUndo({ ...s0, ...trashed.next });
    // 履歴から落ちているのを無理やり積み直して、もう一度同じ 1 手を当てる
    const again = applyNoteUndo({
      ...s0,
      ...first.next,
      nbUndo: [trashed.next.nbUndo[0]],
    });
    expect(again.next.notes).toHaveLength(1);
    expect(again.next.reviews.map((r) => r.id).sort()).toEqual(s0.reviews.map((r) => r.id).sort());
    expect(again.next.order).toEqual(s0.order);
  });

  it('末尾から 1 手ずつ戻る', () => {
    const s0 = state({ notes: [note({ id: 'na' }), note({ id: 'nb', unit: '確率' })] });
    const a = trashNote(s0, { noteId: 'na', alsoReviews: false, today: T, at: 1 });
    const b = trashNote({ ...s0, ...a.next }, { noteId: 'nb', alsoReviews: false, today: T, at: 2 });
    const u1 = applyNoteUndo({ ...s0, ...b.next });
    expect(u1.entry?.noteId).toBe('nb');
    const u2 = applyNoteUndo({ ...s0, ...u1.next });
    expect(u2.entry?.noteId).toBe('na');
    expect(u2.next.notesTrash).toEqual([]);
  });
});

describe('restoreNote — ゴミ箱から戻す', () => {
  it('捨てたときに消した復習も一緒に戻る', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const back = restoreNote({ ...s0, ...trashed.next }, { noteId: 'nabc', at: 2 });

    expect(back.next.notes[0].trashedAt).toBe('');
    expect(back.next.notesTrash).toEqual([]);
    expect(back.next.reviews.map((r) => r.id).sort()).toEqual(s0.reviews.map((r) => r.id).sort());
    expect(back.next.extras.map((x) => x.id)).toEqual(['nbsum-nabc']);
    expect(back.next.order).toEqual(s0.order);
  });

  it('控えが無ければノートだけ戻る（復習は作り直さない）', () => {
    const s = state({
      notes: [],
      notesTrash: [note({ trashedAt: '2026-08-01' })],
      reviews: [review({ id: 'umanual' })],
    });
    const back = restoreNote(s, { noteId: 'nabc', at: 2 });
    expect(back.next.notes.map((n) => n.id)).toEqual(['nabc']);
    expect(back.next.reviews.map((r) => r.id)).toEqual(['umanual']);
  });

  it('「捨てた」控えは残したまま restore を積む（履歴は一本道）', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const back = restoreNote({ ...s0, ...trashed.next }, { noteId: 'nabc', at: 2 });
    // 捨てた控えを消してしまうと、下の「4 手」で復習の控えがどこからも辿れなくなる
    expect(back.next.nbUndo.map((u) => u.kind)).toEqual(['trash', 'restore']);
    expect(back.next.nbUndo[1].note.trashedAt).toBe(T);
    expect(back.restoredReviews).toBe(2);
  });

  it('捨てる→戻す→⌘Z→戻す の 4 手でも復習の間隔が失われない', () => {
    const s0 = fullState();
    const kept = s0.reviews.filter((r) => !r.done).map((r) => r.id).sort();
    // 1. 捨てる（復習も）
    const t = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    // 2. 戻す
    const r1 = restoreNote({ ...s0, ...t.next }, { noteId: 'nabc', at: 2 });
    expect(r1.restoredReviews).toBe(2);
    // 3. ⌘Z（戻したのを取り消す = またゴミ箱へ）
    const u = applyNoteUndo({ ...s0, ...r1.next });
    expect(u.entry?.kind).toBe('restore');
    expect(u.next.notesTrash.map((n) => n.id)).toContain('nabc');
    // 4. もう一度戻す ―― ここで復習が戻らないのが以前の穴だった
    const r2 = restoreNote({ ...s0, ...u.next }, { noteId: 'nabc', at: 4 });
    expect(r2.restoredReviews).toBe(2);
    expect(r2.next.reviews.filter((x) => !x.done).map((x) => x.id).sort()).toEqual(kept);
    expect(r2.next.order).toEqual(s0.order);
  });

  it('戻したのを取り消すとゴミ箱へ帰り、戻した行も引き上げられる', () => {
    const s0 = fullState();
    const trashed = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const restored = restoreNote({ ...s0, ...trashed.next }, { noteId: 'nabc', at: 2 });
    const undone = applyNoteUndo({ ...s0, ...restored.next });

    expect(undone.entry?.kind).toBe('restore');
    expect(undone.next.notes).toEqual([]);
    expect(undone.next.notesTrash.map((n) => n.id)).toEqual(['nabc']);
    expect(undone.next.notesTrash[0].trashedAt).toBe(T);
    // 捨てた直後と同じ状態（完了済みと手動の行だけ）
    expect(undone.next.reviews.map((r) => r.id)).toEqual(['nb-nabc-c2', 'umanual']);
    expect(undone.next.extras).toEqual([]);
    expect(undone.next.order).toEqual(['umanual']);
    expect(undoMessage(undone)).toBe('「数列」をゴミ箱へ戻しました');
  });

  it('ゴミ箱に無い id には何もしない', () => {
    expect(restoreNote(state(), { noteId: 'nzzz', at: 1 }).changed).toBe(false);
  });
});

describe('renameNote — 改名も同じ入口', () => {
  it('名前を合わせるとき、未完了の復習とまとめタスクの題名が追従する', () => {
    const s = fullState();
    const out = renameNote(s, { noteId: 'nabc', unit: '数列と漸化式', syncTitles: true, today: TOMORROW, at: 1 });
    expect(out.next.notes[0].unit).toBe('数列と漸化式');
    expect(out.next.notes[0].updatedAt).toBe(TOMORROW);
    expect(out.next.reviews.find((r) => r.id === 'nb-nabc-c0')?.title).toBe('数列と漸化式 問1');
    // 完了済みは学習履歴なので触らない
    expect(out.next.reviews.find((r) => r.id === 'nb-nabc-c2')?.title).toBe('数列 問1');
    // **改名では何も消さない** ―― 間隔を壊さないのがこの操作の約束
    expect(out.removedReviews).toBe(0);
    expect(out.removedSummaries).toBe(0);
    expect(out.next.reviews.length).toBe(s.reviews.length);
  });

  it('名前を合わせないときは復習の題名が元のまま残る（間隔も動かない）', () => {
    const s = fullState();
    const out = renameNote(s, { noteId: 'nabc', unit: '確率', syncTitles: false, today: TOMORROW, at: 1 });
    expect(out.next.notes[0].unit).toBe('確率');
    expect(out.next.reviews.find((r) => r.id === 'nb-nabc-c0')?.title).toBe('数列 問1');
    expect(out.next.reviews.map((r) => r.id).sort()).toEqual(s.reviews.map((r) => r.id).sort());
  });

  it('改名の取り消しで名前もタイトルも戻る', () => {
    const s0 = fullState();
    const renamed = renameNote(s0, { noteId: 'nabc', unit: '数列と漸化式', syncTitles: true, today: TOMORROW, at: 1 });
    const back = applyNoteUndo({ ...s0, ...renamed.next });
    expect(back.entry?.kind).toBe('rename');
    expect(back.next.notes[0].unit).toBe('数列');
    expect(back.next.reviews.find((r) => r.id === 'nb-nabc-c0')?.title).toBe('数列 問1');
    expect(back.next.order).toEqual(s0.order);
    expect(undoMessage(back)).toBe('「数列」の名前を元に戻しました');
  });

  it('名前が変わらない / 空なら何もしない', () => {
    expect(renameNote(state(), { noteId: 'nabc', unit: '数列', syncTitles: true, today: T, at: 1 }).changed).toBe(false);
    expect(renameNote(state(), { noteId: 'nabc', unit: '  ', syncTitles: true, today: T, at: 1 }).changed).toBe(false);
  });
});

describe('取り消しは「その操作が変えたところ」だけを戻す', () => {
  it('改名 → まとめを書く → ⌘Z で、まとめが残る', () => {
    const s0 = fullState();
    const renamed = renameNote(s0, { noteId: 'nabc', unit: '数列と漸化式', syncTitles: true, today: TOMORROW, at: 1 });
    // 名前を変えたあとに、紙面でまとめを書いた（`commitNote` が通る道）
    const mid = {
      ...s0,
      ...renamed.next,
      notes: renamed.next.notes.map((n) =>
        n.id === 'nabc' ? { ...n, summary: 'あとから書いたまとめ' } : n,
      ),
    };
    const back = applyNoteUndo(mid);
    const note = back.next.notes.find((n) => n.id === 'nabc')!;
    expect(note.unit).toBe('数列');                       // 名前は戻る
    expect(note.summary).toBe('あとから書いたまとめ');      // 途中で書いたものは残る
  });

  it('捨てる → ⌘Z のあいだに別のノートを編集しても巻き込まない', () => {
    const s0 = fullState();
    const t = trashNote(s0, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    const mid = {
      ...s0,
      ...t.next,
      notes: t.next.notes.concat([note({ id: 'nzzz', unit: '別のノート' })]),
    };
    const back = applyNoteUndo(mid);
    expect(back.next.notes.map((n) => n.id).sort()).toContain('nzzz');
  });
});

describe('trashDaysLeft / expiredTrashIds / purgeTrash — 30 日の境界', () => {
  /** `T` から n 日前を `trashedAt` に持つノート */
  function trashedDaysAgo(id: string, n: number): Note {
    const ms = new Date(T + 'T00:00:00Z').getTime() - n * 86400000;
    return note({ id, trashedAt: new Date(ms).toISOString().slice(0, 10) });
  }

  it('捨てた当日は 30 日残り', () => {
    expect(trashDaysLeft(trashedDaysAgo('n0', 0), T)).toBe(NOTE_TRASH_DAYS);
  });

  it('30 日ちょうどは「今日が最終日」でまだ消えない', () => {
    const n = trashedDaysAgo('n30', 30);
    expect(trashDaysLeft(n, T)).toBe(0);
    expect(expiredTrashIds([n], T)).toEqual([]);
  });

  it('31 日目に消える', () => {
    const n = trashedDaysAgo('n31', 31);
    expect(trashDaysLeft(n, T)).toBe(-1);
    expect(expiredTrashIds([n], T)).toEqual(['n31']);
  });

  it('trashedAt が空のものは（壊れたデータでも）消さない', () => {
    expect(expiredTrashIds([note({ id: 'nbad', trashedAt: '' })], T)).toEqual([]);
  });

  it('purgeTrash は期限切れだけ抜いて、その id と履歴を返す', () => {
    const alive = trashedDaysAgo('nA', 29);
    const dead = trashedDaysAgo('nB', 40);
    const undo: NoteUndo = {
      kind: 'trash',
      noteId: 'nB',
      label: '数列',
      note: dead,
      reviews: [],
      extras: [],
      order: [],
      at: 1,
    };
    const out = purgeTrash({ notesTrash: [alive, dead], nbUndo: [undo] }, T);
    expect(out.removedIds).toEqual(['nB']);
    expect(out.notesTrash.map((n) => n.id)).toEqual(['nA']);
    // 本当に消えたノートは ⌘Z の対象から外す
    expect(out.nbUndo).toEqual([]);
  });

  it('期限切れが無ければ入力と同じ参照を返す', () => {
    const trash = [trashedDaysAgo('nA', 1)];
    const out = purgeTrash({ notesTrash: trash, nbUndo: [] }, T);
    expect(out.notesTrash).toBe(trash);
    expect(out.removedIds).toEqual([]);
  });
});

describe('pushNoteUndo — 履歴の深さ', () => {
  function entry(i: number): NoteUndo {
    return {
      kind: 'trash',
      noteId: 'n' + i,
      label: 'u' + i,
      note: note({ id: 'n' + i }),
      reviews: [],
      extras: [],
      order: [],
      at: i,
    };
  }

  it('NOTE_UNDO_MAX を超えたら古い方から落ちる', () => {
    let stack: NoteUndo[] = [];
    for (let i = 0; i < NOTE_UNDO_MAX + 3; i += 1) stack = pushNoteUndo(stack, entry(i));
    expect(stack).toHaveLength(NOTE_UNDO_MAX);
    expect(stack[0].noteId).toBe('n3');
    expect(stack[stack.length - 1].noteId).toBe('n' + (NOTE_UNDO_MAX + 2));
  });

  it('同じ 1 手（kind/noteId/at が同じ）は積み直さない', () => {
    const e = entry(1);
    expect(pushNoteUndo(pushNoteUndo([], e), e)).toHaveLength(1);
  });
});

describe('小道具', () => {
  it('restoreOrder は元の位置へ差し戻す', () => {
    expect(restoreOrder(['a', 'd'], ['a', 'b', 'c', 'd'], ['b', 'c'])).toEqual(['a', 'b', 'c', 'd']);
    // 先頭が消えていた場合
    expect(restoreOrder(['b'], ['a', 'b'], ['a'])).toEqual(['a', 'b']);
    // すでに並んでいるなら触らない
    const cur = ['a', 'b'];
    expect(restoreOrder(cur, ['a', 'b'], ['b'])).toBe(cur);
  });

  it('noteCascadeCounts は実際に消える数と一致する', () => {
    const s = fullState();
    expect(noteCascadeCounts(s, 'nabc')).toEqual({ reviews: 2, summaries: 1 });
    const out = trashNote(s, { noteId: 'nabc', alsoReviews: true, today: T, at: 1 });
    expect({ reviews: out.removedReviews, summaries: out.removedSummaries }).toEqual({
      reviews: 2,
      summaries: 1,
    });
  });

  it('noteLabel は単元名が空なら一覧と同じ言い方にする', () => {
    expect(noteLabel(note())).toBe('数列');
    expect(noteLabel(note({ unit: '' }))).toBe('(単元名なし)');
  });

  it('sortTrashList は捨てたのが新しい順', () => {
    const a = note({ id: 'na', trashedAt: '2026-08-01' });
    const b = note({ id: 'nb', trashedAt: '2026-08-05' });
    expect(sortTrashList([a, b]).map((n) => n.id)).toEqual(['nb', 'na']);
  });
});
