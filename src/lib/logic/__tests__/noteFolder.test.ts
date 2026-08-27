/**
 * 教科フォルダに潜る（`logic/noteFolder.ts`）
 *
 * 見ているのは 3 つ:
 *  - **潜ったら他の教科が出ないこと**。Finder でフォルダを開いたのと同じ状態になるか
 *  - **教科名が空のノートの行き先**。見出し・行の帯・潜り先で「その他」がずれないこと
 *  - **閉じ込められないこと**。無い教科に潜ったままにならず、0 件でも段（＝戻り道）が残る
 */

import { describe, expect, it } from 'vitest';

import type { Note } from '../../model/notes';
import {
  folderEnterPatch,
  folderExists,
  folderGroups,
  folderUp,
  groupNotesBySubject,
  noteCrumbs,
  notesInFolder,
  resolveFolder,
  subjectKeyOf,
} from '../noteFolder';

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-06',
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
    createdAt: '2026-08-06',
    updatedAt: '2026-08-06',
    trashedAt: '',
    ...over,
  };
}

/** 教科ちがいの 3 冊（数学 2 / 英語 1）。並びは一覧に渡ってくる順そのまま */
const math1 = note({ id: 'm1', subject: '数学', unit: '数列' });
const eng = note({ id: 'e1', subject: '英語', unit: '関係詞' });
const math2 = note({ id: 'm2', subject: '数学', unit: '整数' });
const all = [math1, eng, math2];

describe('subjectKeyOf', () => {
  it('教科名が空なら「その他」に寄せる（行の帯・見出し・潜り先で同じ名前にする）', () => {
    expect(subjectKeyOf(note({ subject: '' }))).toBe('その他');
    expect(subjectKeyOf(note({ subject: '化学' }))).toBe('化学');
  });
});

describe('groupNotesBySubject', () => {
  it('最初に出てきた順に畳む（名前順に並べ替えない）', () => {
    expect(groupNotesBySubject(all).map(([s]) => s)).toEqual(['数学', '英語']);
  });

  it('同じ教科のノートは渡された順のまま 1 つの段に入る', () => {
    const [[, list]] = groupNotesBySubject(all);
    expect(list.map((n) => n.id)).toEqual(['m1', 'm2']);
  });

  it('教科が空のノートは「その他」の段にまとまる', () => {
    const x = note({ id: 'x1', subject: '' });
    expect(groupNotesBySubject([x]).map(([s]) => s)).toEqual(['その他']);
  });
});

describe('notesInFolder', () => {
  it('潜っている教科だけに絞る', () => {
    expect(notesInFolder(all, '数学').map((n) => n.id)).toEqual(['m1', 'm2']);
  });

  it('潜っていなければ全部通す', () => {
    expect(notesInFolder(all, null)).toHaveLength(3);
  });

  it('「その他」へ潜ると教科名が空のノートが出る', () => {
    const x = note({ id: 'x1', subject: '' });
    expect(notesInFolder([...all, x], 'その他').map((n) => n.id)).toEqual(['x1']);
  });
});

describe('folderGroups', () => {
  it('潜っていなければ教科ごとの段', () => {
    expect(folderGroups(all, null)).toHaveLength(2);
  });

  it('潜っていればその教科ひとつだけ（他の教科の見出しごと消える）', () => {
    const groups = folderGroups(all, '数学');
    expect(groups.map(([s]) => s)).toEqual(['数学']);
    expect(groups[0][1].map((n) => n.id)).toEqual(['m1', 'm2']);
  });

  it('中身が 0 件でも段は返す（段ごと消すと上へ戻る手立てが画面から消える）', () => {
    expect(folderGroups([], '数学')).toEqual([['数学', []]]);
  });
});

describe('folderExists / resolveFolder', () => {
  it('ノートが 1 冊でもある教科にだけ潜れる', () => {
    expect(folderExists(all, '数学')).toBe(true);
    expect(folderExists(all, '物理')).toBe(false);
  });

  it('存在しない教科に潜ったままなら上へ戻す（全部捨てた後に取り残されない）', () => {
    expect(resolveFolder(all, '物理')).toBe(null);
    expect(resolveFolder([], '数学')).toBe(null);
  });

  it('実在する潜り先はそのまま（同じ値を返して無駄な書き戻しをしない）', () => {
    expect(resolveFolder(all, '数学')).toBe('数学');
  });

  it('潜っていなければ何もしない', () => {
    expect(resolveFolder([], null)).toBe(null);
  });
});

describe('folderUp', () => {
  it('教科の中からは「すべての教科」へ上がる', () => {
    expect(folderUp('数学')).toBe(null);
  });

  it('一番上でもう一度上がっても壊れない', () => {
    expect(folderUp(null)).toBe(null);
  });
});

describe('noteCrumbs', () => {
  it('潜っていなければ 1 段も出さない（押しても動かない行を常設しない）', () => {
    expect(noteCrumbs(all, null)).toEqual([]);
  });

  it('「ノート ＞ 教科」の 2 段。末尾がいまいる段で、件数はその教科のぶん', () => {
    const crumbs = noteCrumbs(all, '数学');
    expect(crumbs.map((c) => c.label)).toEqual(['ノート', '数学']);
    expect(crumbs[0]).toMatchObject({ folder: null, count: 3, current: false });
    expect(crumbs[1]).toMatchObject({ folder: '数学', count: 2, current: true });
  });

  it('0 件の教科でもパンくずは出る（そこからしか戻れない）', () => {
    expect(noteCrumbs([], '数学').map((c) => c.count)).toEqual([0, 0]);
  });
});

describe('folderEnterPatch', () => {
  it('潜ると同時に絞り込みチップを畳む（同じ「教科で絞る」を二重に持たない）', () => {
    expect(folderEnterPatch('数学')).toEqual({ nbFolder: '数学', nbSubjFilter: null });
  });
});
