import { beforeEach, describe, expect, it } from 'vitest';

import { generateNoteReviews, noteSeriesId } from '../../../lib/logic/noteCards';
import type { Note } from '../../../lib/model/notes';
import type { CompassPersistence, NoteDoc } from '../../../lib/persistence';
import { createStore, type CompassStore } from '../../../lib/store';
import {
  NotebookController,
  commitNote,
  removeNote,
  sanitizeNotes,
  setNotebookController,
  sortNoteList,
  upsertNote,
} from '../NotebookPersistence';

const T = '2026-08-06';
const TOMORROW = '2026-08-07';

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'nabc',
    v: 1,
    date: T,
    subject: '数学',
    unit: '数列',
    cards: [
      { cardId: 'c0', q: 'Q1', a: 'A1', guide: '', src: '', origin: 'ai', attempts: [] },
      { cardId: 'c1', q: 'Q2', a: 'A2', guide: '', src: '', origin: 'ai', attempts: [] },
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

/** `loadNotes` / `saveNote` / `deleteNote` の呼ばれ方だけを記録するスタブ */
function stubPersistence(
  kind: 'firebase' | 'local',
  rows: NoteDoc[] = [],
  failLoad = false,
): CompassPersistence & { saved: NoteDoc[]; deleted: string[] } {
  const saved: NoteDoc[] = [];
  const deleted: string[] = [];
  return {
    kind,
    saved,
    deleted,
    async loadCloudState() {
      return { data: null, email: '', reviewsSource: 'none' as const };
    },
    async saveCloudState() {
      return { ok: true as const, storage: kind, mode: 'embedded' as const, updated: 0, deleted: 0 };
    },
    reset() {},
    async loadNotes() {
      if (failLoad) throw new Error('boom');
      return rows;
    },
    async saveNote(_uid: string, doc: NoteDoc) {
      saved.push(doc);
    },
    async deleteNote(_uid: string, id: string) {
      deleted.push(id);
    },
  };
}

function newStore(): CompassStore {
  return createStore({ today: T, autoCommit: false });
}

beforeEach(() => {
  setNotebookController(null);
});

describe('sanitizeNotes', () => {
  it('壊れた行を落として Note として読む', () => {
    const out = sanitizeNotes([
      null,
      'x',
      { id: '', cards: [] },
      { id: 'n1' }, // cards が無い
      {
        id: 'n2',
        date: '2026-08-01',
        subject: '英語',
        unit: '仮定法',
        cards: [{ cardId: 'c0', q: 'Q' }, { cardId: '' }, null],
        blocks: [{ t: 'def', title: 'x' }, { t: 'zzz' }, { t: 'ex', cardId: 'c0' }],
        exercise: { q: 'E' },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].cards).toHaveLength(1);
    expect(out[0].cards[0]).toEqual({
      cardId: 'c0',
      q: 'Q',
      a: '',
      origin: 'ai',
      guide: '',
      src: '',
      attempts: [],
    });
    expect(out[0].blocks).toHaveLength(2);
    expect(out[0].exercise).toEqual({ q: 'E', a: '' });
    expect(out[0].createdAt).toBe('2026-08-01'); // 欠落時は date で埋める
  });

  it('配列でなければ空', () => {
    expect(sanitizeNotes(null)).toEqual([]);
    expect(sanitizeNotes({ id: 'n1' })).toEqual([]);
  });
});

describe('sortNoteList / upsertNote', () => {
  it('新しい授業日が先、同日は id 昇順', () => {
    const list = [
      note({ id: 'nb', date: '2026-08-01' }),
      note({ id: 'na', date: '2026-08-01' }),
      note({ id: 'nc', date: '2026-08-05' }),
    ];
    expect(sortNoteList(list).map((n) => n.id)).toEqual(['nc', 'na', 'nb']);
  });

  it('同じ id は差し替え、無ければ追加', () => {
    const base = [note({ id: 'na', date: '2026-08-01' })];
    const replaced = upsertNote(base, note({ id: 'na', date: '2026-08-01', unit: '改' }));
    expect(replaced).toHaveLength(1);
    expect(replaced[0].unit).toBe('改');
    expect(upsertNote(base, note({ id: 'nz', date: '2026-08-09' })).map((n) => n.id)).toEqual([
      'nz',
      'na',
    ]);
  });
});

describe('commitNote', () => {
  it('カードぶんの復習を作る（N-021）', () => {
    const store = newStore();
    const res = commitNote(store, note(), T);
    expect(res.created).toBe(2);
    const reviews = store.getState().reviews;
    expect(reviews.map((r) => r.seriesId)).toEqual(['nb-nabc-c0', 'nb-nabc-c1']);
    // 授業当日に消化できるよう、期限は今日でそのまま今日の ToDo に積まれる
    expect(reviews[0].due).toBe(T);
    expect(reviews[0].stage).toBe('当日');
    expect(reviews[0].added).toBe(true);
  });

  it('2 回呼んでも増えない（N-022）', () => {
    const store = newStore();
    commitNote(store, note(), T);
    const again = commitNote(store, note(), T);
    expect(again.created).toBe(0);
    expect(store.getState().reviews).toHaveLength(2);
  });

  it('消えたカードの未完了復習を掃除する（N-033）', () => {
    const store = newStore();
    commitNote(store, note(), T);
    store.setState((s) => ({ order: s.reviews.map((r) => r.id), selId: s.reviews[1].id }));
    const shrunk = note({ cards: [note().cards[0]] });
    const res = commitNote(store, shrunk, T, { removedCardIds: ['c1'] });
    expect(res.removed).toBe(1);
    expect(store.getState().reviews.map((r) => r.seriesId)).toEqual(['nb-nabc-c0']);
    expect(store.getState().order).toEqual(['nb-nabc-c0']);
    expect(store.getState().selId).toBeNull();
  });

  it('単元名を変えると未完了行のタイトルが追従する（N-034）', () => {
    const store = newStore();
    commitNote(store, note(), T);
    store.setState((s) => ({ reviews: s.reviews.map((r, i) => (i ? r : { ...r, done: true })) }));
    commitNote(store, note({ unit: '数列と漸化式' }), T);
    const titles = store.getState().reviews.map((r) => r.title);
    expect(titles).toEqual(['数列 問1', '数列と漸化式 問2']);
  });
});

describe('removeNote', () => {
  it('未完了だけ消し、完了は残す（N-030）', () => {
    const store = newStore();
    commitNote(store, note(), T);
    store.setState((s) => ({
      reviews: s.reviews.map((r, i) => (i ? r : { ...r, done: true })),
      order: s.reviews.map((r) => r.id),
    }));
    const removed = removeNote(store, 'nabc');
    expect(removed).toBe(1);
    expect(store.getState().reviews.map((r) => r.seriesId)).toEqual(['nb-nabc-c0']);
    expect(store.getState().order).toEqual(['nb-nabc-c0']);
  });

  it('対象が無ければ 0', () => {
    const store = newStore();
    expect(removeNote(store, 'nzzz')).toBe(0);
  });
});

describe('NotebookController.boot', () => {
  it('保存無効（preview）ではローカルを正とし、クラウド読み込みでノートを消さない', async () => {
    const store = newStore();
    store.setState({ notes: [note()] });
    const p = stubPersistence('local');
    const ctrl = new NotebookController(store, p, 'u1');
    // localStorage が無い node 環境ではローカルミラーは空。preview では state も空に戻る
    await ctrl.boot();
    expect(store.getState().notesLoaded).toBe(true);
    // クラウドの空配列で上書きしていない = loadNotes を当てにしない経路を通っている
    expect(p.saved).toHaveLength(0);
  });

  it('クラウドに内容があれば置き換える', async () => {
    const store = newStore();
    const ctrl = new NotebookController(store, stubPersistence('firebase', [note() as unknown as NoteDoc]), 'u1');
    await ctrl.boot();
    expect(store.getState().notes.map((n) => n.id)).toEqual(['nabc']);
    expect(store.getState().notesLoaded).toBe(true);
  });

  it('読み込みに失敗しても notesLoaded は立つ', async () => {
    const store = newStore();
    const ctrl = new NotebookController(store, stubPersistence('firebase', [], true), 'u1');
    await ctrl.boot();
    expect(store.getState().notesLoaded).toBe(true);
  });
});

describe('NotebookController.save / remove', () => {
  it('保存はストアとクラウドの両方へ届く', async () => {
    const store = newStore();
    const p = stubPersistence('firebase');
    const ctrl = new NotebookController(store, p, 'u1');
    setNotebookController(ctrl);
    ctrl.save(note());
    expect(store.getState().notes.map((n) => n.id)).toEqual(['nabc']);
    await Promise.resolve();
    expect(p.saved).toHaveLength(1);
  });

  it('削除はストアから外し、クラウドにも伝える', async () => {
    const store = newStore();
    const p = stubPersistence('firebase');
    const ctrl = new NotebookController(store, p, 'u1');
    ctrl.save(note());
    ctrl.remove('nabc');
    expect(store.getState().notes).toEqual([]);
    await Promise.resolve();
    expect(p.deleted).toEqual(['nabc']);
  });

  it('commitNote はモジュールのコントローラ経由でノートを保存する', () => {
    const store = newStore();
    const p = stubPersistence('firebase');
    setNotebookController(new NotebookController(store, p, 'u1'));
    commitNote(store, note(), T);
    expect(store.getState().notes.map((n) => n.id)).toEqual(['nabc']);
  });
});

describe('生成される復習の形（画面から見た不変条件）', () => {
  it('seriesId はノート ID とカード ID から一意に決まる', () => {
    const gen = generateNoteReviews(note(), [], T);
    expect(gen.created.map((r) => r.id)).toEqual([
      noteSeriesId('nabc', 'c0'),
      noteSeriesId('nabc', 'c1'),
    ]);
  });
});
