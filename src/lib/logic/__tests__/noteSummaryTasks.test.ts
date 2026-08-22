import { describe, expect, it } from 'vitest';

import type { Note } from '../../model/notes';
import type { Extra } from '../../model/types';
import {
  NOTE_SUMMARY_SRC,
  buildNoteSummaryExtra,
  cascadeNoteSummaryRemoval,
  completeNoteSummaryTasks,
  generateNoteSummaryTasks,
  isSummaryPending,
  noteSummaryExtraId,
  noteSummaryRefOf,
  noteSummaryTitle,
} from '../noteSummaryTasks';

/** 2026-08-06(木) を「今日」とする */
const T = '2026-08-06';
const YESTERDAY = '2026-08-05';
const TWO_DAYS_AGO = '2026-08-04';
const THREE_DAYS_AGO = '2026-08-03';
const TOMORROW = '2026-08-07';

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'nabc',
    v: 1,
    date: T,
    subject: '数学',
    unit: '数列',
    scans: [],
    cards: [],
    sections: [],
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

function single(id: string): Extra {
  return {
    id,
    title: '単発',
    subj: '数学',
    size: 'S',
    min: 10,
    day: T,
    done: false,
    src: '単発タスク',
    timetablePeriod: null,
    timetableDate: null,
  };
}

// ─────────────────────────────────────────────────────────────
// id の文字列規約
// ─────────────────────────────────────────────────────────────

describe('id の文字列規約（nbsum-{noteId}）', () => {
  it('ノート id から組み立て、同じ形で読み戻せる', () => {
    expect(noteSummaryExtraId('nabc')).toBe('nbsum-nabc');
    expect(noteSummaryRefOf('nbsum-nabc')).toBe('nabc');
  });

  it('ほかの自動生成タスクと混ざらない', () => {
    // 単発・ノート復習・デイリーミッション・空文字
    expect(noteSummaryRefOf('umf3k21')).toBeNull();
    expect(noteSummaryRefOf('nb-nabc-c0')).toBeNull();
    expect(noteSummaryRefOf('dm-dmx1-20260806')).toBeNull();
    expect(noteSummaryRefOf('nbsum-')).toBeNull();
    expect(noteSummaryRefOf('nbsum-xabc')).toBeNull();
    expect(noteSummaryRefOf('')).toBeNull();
    expect(noteSummaryRefOf(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// タスクの形
// ─────────────────────────────────────────────────────────────

describe('buildNoteSummaryExtra', () => {
  it('単元名のタスクを今日ぶんとして作る', () => {
    const e = buildNoteSummaryExtra(note(), T);
    expect(e.id).toBe('nbsum-nabc');
    expect(e.title).toBe('「数列」のまとめを書く');
    expect(e.subj).toBe('数学');
    expect(e.size).toBe('S');
    expect(e.min).toBe(10);
    expect(e.day).toBe(T);
    expect(e.done).toBe(false);
    expect(e.src).toBe(NOTE_SUMMARY_SRC);
    expect(e.timetablePeriod).toBeNull();
    expect(e.timetableDate).toBeNull();
  });

  it('単元が空なら教科で代替する', () => {
    expect(noteSummaryTitle({ unit: '', subject: '英語' })).toBe('「英語」のまとめを書く');
    expect(noteSummaryTitle({ unit: '  ', subject: '' })).toBe('「ノート」のまとめを書く');
  });
});

// ─────────────────────────────────────────────────────────────
// 対象の抽出（3 日窓・まとめが空のものだけ）
// ─────────────────────────────────────────────────────────────

describe('isSummaryPending', () => {
  it('今日から 3 日ぶん（today-2 まで）が対象', () => {
    expect(isSummaryPending(note({ date: T }), T)).toBe(true);
    expect(isSummaryPending(note({ date: YESTERDAY }), T)).toBe(true);
    expect(isSummaryPending(note({ date: TWO_DAYS_AGO }), T)).toBe(true);
    expect(isSummaryPending(note({ date: THREE_DAYS_AGO }), T)).toBe(false);
  });

  it('未来日のノートは窓が来るまで待つ（提案は一度きりなので早出しすると取りこぼす）', () => {
    expect(isSummaryPending(note({ date: TOMORROW }), T)).toBe(false);
    expect(isSummaryPending(note({ date: TOMORROW }), TOMORROW)).toBe(true);
  });

  it('まとめが書いてあれば対象にしない（空白だけは空とみなす）', () => {
    expect(isSummaryPending(note({ summary: '要点は3つ' }), T)).toBe(false);
    expect(isSummaryPending(note({ summary: '   \n ' }), T)).toBe(true);
  });
});

describe('generateNoteSummaryTasks — 生成', () => {
  it('まとめ待ちのノート 1 冊につき 1 件、ログに記録する', () => {
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [note()],
      log: [],
      notesLoaded: true,
    });
    expect(res.extras.map((e) => e.id)).toEqual(['nbsum-nabc']);
    expect(res.log).toEqual(['nabc']);
    expect(res.message).toBe('1件のノートに「まとめを書く」を追加しました');
  });

  it('窓の外・まとめ済みは作らない', () => {
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [
        note({ id: 'nold', date: THREE_DAYS_AGO }),
        note({ id: 'ndone', summary: '書いた' }),
        note({ id: 'nnew', date: YESTERDAY }),
      ],
      log: [],
      notesLoaded: true,
    });
    expect(res.extras.map((e) => e.id)).toEqual(['nbsum-nnew']);
    expect(res.log).toEqual(['nnew']);
  });

  it('ノートが 1 冊も無ければ何もしない', () => {
    const log: string[] = [];
    const res = generateNoteSummaryTasks({ today: T, notes: [], log, notesLoaded: true });
    expect(res.extras).toEqual([]);
    expect(res.log).toBe(log);
    expect(res.message).toBeNull();
  });

  it('ノート未読込では何も見ない（空の一覧でログを掃除しない）', () => {
    const log = ['nzzz'];
    const res = generateNoteSummaryTasks({ today: T, notes: [], log, notesLoaded: false });
    expect(res.extras).toEqual([]);
    // 同じ参照 = 保存すべき変更なし
    expect(res.log).toBe(log);
  });
});

describe('generateNoteSummaryTasks — 二度は提案しない', () => {
  it('同じノートは 2 回目以降ずっと作らない', () => {
    const n = note();
    const first = generateNoteSummaryTasks({ today: T, notes: [n], log: [], notesLoaded: true });
    const second = generateNoteSummaryTasks({
      today: T,
      notes: [n],
      log: first.log,
      notesLoaded: true,
    });
    expect(second.extras).toEqual([]);
    expect(second.message).toBeNull();
    expect(second.log).toBe(first.log);
  });

  it('ユーザーが消しても、日をまたいでも復活しない（extras は見ない）', () => {
    const n = note();
    const log = ['nabc'];
    const next = generateNoteSummaryTasks({
      today: YESTERDAY,
      notes: [note({ date: YESTERDAY })],
      log,
      notesLoaded: true,
    });
    expect(next.extras).toEqual([]);
    expect(
      generateNoteSummaryTasks({ today: T, notes: [n], log, notesLoaded: true }).extras,
    ).toEqual([]);
  });

  it('別のノートは提案される', () => {
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [note({ id: 'nabc' }), note({ id: 'nxyz' })],
      log: ['nabc'],
      notesLoaded: true,
    });
    expect(res.extras.map((e) => e.id)).toEqual(['nbsum-nxyz']);
    expect(res.log).toEqual(['nabc', 'nxyz']);
  });
});

describe('generateNoteSummaryTasks — ログの掃除', () => {
  it('存在しないノートの id を落とす', () => {
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [note({ id: 'nabc', summary: '書いた' })],
      log: ['ngone', 'nabc'],
      notesLoaded: true,
    });
    expect(res.log).toEqual(['nabc']);
    expect(res.extras).toEqual([]);
  });

  it('重複した id も畳む', () => {
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [note({ id: 'nabc', summary: '書いた' })],
      log: ['nabc', 'nabc'],
      notesLoaded: true,
    });
    expect(res.log).toEqual(['nabc']);
  });

  it('掃除も生成も無ければ入力と同じ参照を返す', () => {
    const log = ['nabc'];
    const res = generateNoteSummaryTasks({
      today: T,
      notes: [note({ id: 'nabc' })],
      log,
      notesLoaded: true,
    });
    expect(res.log).toBe(log);
  });
});

// ─────────────────────────────────────────────────────────────
// 自動完了
// ─────────────────────────────────────────────────────────────

describe('completeNoteSummaryTasks', () => {
  const task = buildNoteSummaryExtra(note(), T);

  it('まとめが書かれたら未完了のタスクを完了にする', () => {
    const out = completeNoteSummaryTasks([single('u1'), task], note({ summary: '要点は3つ' }));
    expect(out.map((x) => x.done)).toEqual([false, true]);
  });

  it('まとめが空のままなら触らない（同じ参照）', () => {
    const extras = [task];
    expect(completeNoteSummaryTasks(extras, note({ summary: '  ' }))).toBe(extras);
  });

  it('別のノートのタスクには触らない', () => {
    const other = buildNoteSummaryExtra(note({ id: 'nxyz' }), T);
    const extras = [other];
    expect(completeNoteSummaryTasks(extras, note({ summary: '書いた' }))).toBe(extras);
  });

  it('すでに完了なら何も変えない（同じ参照）', () => {
    const extras = [{ ...task, done: true }];
    expect(completeNoteSummaryTasks(extras, note({ summary: '書いた' }))).toBe(extras);
  });
});

// ─────────────────────────────────────────────────────────────
// 削除時のカスケード
// ─────────────────────────────────────────────────────────────

describe('cascadeNoteSummaryRemoval', () => {
  const task = buildNoteSummaryExtra(note(), T);

  it('未完了のまとめタスクを order / selId ごと片付ける', () => {
    const res = cascadeNoteSummaryRemoval(
      [single('u1'), task],
      ['u1', task.id],
      task.id,
      'nabc',
    );
    expect(res.removedIds).toEqual([task.id]);
    expect(res.extras.map((x) => x.id)).toEqual(['u1']);
    expect(res.order).toEqual(['u1']);
    expect(res.selId).toBeNull();
  });

  it('完了済みは学習履歴として残す', () => {
    const done = { ...task, done: true };
    const res = cascadeNoteSummaryRemoval([done], [done.id], null, 'nabc');
    expect(res.removedIds).toEqual([]);
    expect(res.extras).toEqual([done]);
  });

  it('別のノートのタスクは残る（対象が無ければ同じ参照）', () => {
    const extras = [buildNoteSummaryExtra(note({ id: 'nxyz' }), T)];
    const order = [extras[0].id];
    const res = cascadeNoteSummaryRemoval(extras, order, 'u9', 'nabc');
    expect(res.extras).toBe(extras);
    expect(res.order).toBe(order);
    expect(res.selId).toBe('u9');
  });
});
