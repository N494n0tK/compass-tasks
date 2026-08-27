import { describe, expect, it } from 'vitest';

import type { Note } from '../../model/notes';
import type { NotionPullLog } from '../../model/types';
import {
  isNotionDatePageTitle,
  matchExistingNote,
  normalizeNotionId,
  notionChildPage,
  notionCodeBlock,
  planNotionPull,
  sanitizeNotionNoteBlocks,
  sanitizeNotionPullLog,
  selectNotionPages,
  type NotionChildPage,
  type NotionNoteBlock,
} from '../notionPull';

/** 最小の Note。取り込み経路の実物は noteImport 側でテスト済みなので、ここは骨だけ */
function makeNote(over: Partial<Note>): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-17',
    subject: '歴総',
    unit: '産業革命',
    scans: [],
    cards: [],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-17',
    updatedAt: '2026-08-17',
    trashedAt: '',
    ...over,
  };
}

function makeBlock(over: Partial<NotionNoteBlock>): NotionNoteBlock {
  return {
    pageId: 'p1',
    pageTitle: '8月17日',
    blockId: 'b1',
    edited: '2026-08-17T08:00:00.000Z',
    text: '{}',
    ...over,
  };
}

describe('isNotionDatePageTitle', () => {
  it('エージェントの命名規則 M月D日（再実行の「 (2)」付きも）を受ける', () => {
    expect(isNotionDatePageTitle('8月17日')).toBe(true);
    expect(isNotionDatePageTitle('8月17日 (2)')).toBe(true);
    expect(isNotionDatePageTitle('12月3日')).toBe(true);
    expect(isNotionDatePageTitle('2026-08-13')).toBe(true);
  });

  it('日付でない子ページ（指示文など）は読まない', () => {
    expect(isNotionDatePageTitle('【エージェント指示文】毎日17時の授業ノート→JSON変換')).toBe(false);
    expect(isNotionDatePageTitle('メモ')).toBe(false);
    expect(isNotionDatePageTitle('')).toBe(false);
  });
});

describe('notionChildPage / notionCodeBlock', () => {
  it('child_page ブロックからタイトルと時刻を抜く', () => {
    const page = notionChildPage({
      id: 'abc',
      type: 'child_page',
      child_page: { title: '8月17日' },
      created_time: '2026-08-17T08:00:00.000Z',
      last_edited_time: '2026-08-17T09:00:00.000Z',
    });
    expect(page).toEqual({
      id: 'abc',
      title: '8月17日',
      created: '2026-08-17T08:00:00.000Z',
      edited: '2026-08-17T09:00:00.000Z',
    });
  });

  it('child_page 以外・壊れた行は null', () => {
    expect(notionChildPage({ id: 'x', type: 'paragraph' })).toBeNull();
    expect(notionChildPage(null)).toBeNull();
    expect(notionChildPage({ type: 'child_page', child_page: {} })).toBeNull(); // id 無し
  });

  it('code ブロックは rich_text の plain_text を連結する（2000 字ごとの分割に耐える）', () => {
    const code = notionCodeBlock({
      id: 'blk',
      type: 'code',
      last_edited_time: '2026-08-17T09:00:00.000Z',
      code: { rich_text: [{ plain_text: '{"a":' }, { plain_text: '1}' }], language: 'json' },
    });
    expect(code).toEqual({ id: 'blk', edited: '2026-08-17T09:00:00.000Z', text: '{"a":1}' });
  });

  it('code 以外・中身が空のブロックは null', () => {
    expect(notionCodeBlock({ id: 'x', type: 'paragraph' })).toBeNull();
    expect(
      notionCodeBlock({ id: 'x', type: 'code', code: { rich_text: [{ plain_text: '  ' }] } }),
    ).toBeNull();
  });
});

describe('selectNotionPages', () => {
  const page = (id: string, title: string, created: string, edited: string): NotionChildPage => ({
    id,
    title,
    created,
    edited,
  });

  it('日付ページだけを、最近編集の max 枚 → 作成の古い順で返す', () => {
    const pages = [
      page('p1', '8月15日', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z'),
      page('p2', '【エージェント指示文】…', '2026-08-01T00:00:00Z', '2026-08-20T00:00:00Z'),
      page('p3', '8月17日', '2026-08-17T08:00:00Z', '2026-08-17T08:00:00Z'),
      page('p4', '8月17日 (2)', '2026-08-17T09:00:00Z', '2026-08-17T09:00:00Z'),
    ];
    // 指示文が消え、max=2 で最近編集の 2 枚（p3, p4）が作成の古い順で並ぶ
    expect(selectNotionPages(pages, 2).map((p) => p.id)).toEqual(['p3', 'p4']);
    // max に余裕があれば全日付ページ。順序は作成の古い順（再実行ページが原本の後）
    expect(selectNotionPages(pages, 10).map((p) => p.id)).toEqual(['p1', 'p3', 'p4']);
  });
});

describe('normalizeNotionId', () => {
  it('URL 末尾の 32 桁 hex を UUID 形式へ', () => {
    expect(normalizeNotionId('3bb9fcddfdf481ddb2fcdbd6a7e2f297')).toBe(
      '3bb9fcdd-fdf4-81dd-b2fc-dbd6a7e2f297',
    );
  });

  it('UUID 形式・それ以外の文字列はそのまま（trim だけ）', () => {
    expect(normalizeNotionId(' 3bb9fcdd-fdf4-81dd-b2fc-dbd6a7e2f297 ')).toBe(
      '3bb9fcdd-fdf4-81dd-b2fc-dbd6a7e2f297',
    );
    expect(normalizeNotionId('not-an-id')).toBe('not-an-id');
  });
});

describe('sanitizeNotionPullLog / sanitizeNotionNoteBlocks', () => {
  it('壊れた行は黙って捨てる（sanitizeNotes と同じ方針）', () => {
    expect(
      sanitizeNotionPullLog({
        b1: { noteId: 'n1', edited: 'T1' },
        b2: { noteId: 1, edited: 'T1' },
        b3: 'x',
        b4: { noteId: '', edited: 'T2' }, // 検証エラーの記録は正当
      }),
    ).toEqual({ b1: { noteId: 'n1', edited: 'T1' }, b4: { noteId: '', edited: 'T2' } });
    expect(sanitizeNotionPullLog(null)).toEqual({});
    expect(sanitizeNotionPullLog([1, 2])).toEqual({});
  });

  it('ルートのレスポンスも同じく防御的に読む', () => {
    const rows = sanitizeNotionNoteBlocks([
      { pageId: 'p', pageTitle: '8月17日', blockId: 'b1', edited: 'T', text: '{}' },
      { blockId: '', text: '{}' },
      { blockId: 'b2', text: '   ' },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].blockId).toBe('b1');
    expect(sanitizeNotionNoteBlocks(undefined)).toEqual([]);
  });
});

describe('planNotionPull', () => {
  it('ログと edited が一致するブロックだけを読み飛ばす', () => {
    const blocks = [
      makeBlock({ blockId: 'b1', edited: 'T1' }), // ログ一致 → skip
      makeBlock({ blockId: 'b2', edited: 'T2' }), // ログの edited が古い → pending
      makeBlock({ blockId: 'b3', edited: 'T1' }), // ログに無い → pending
    ];
    const log: NotionPullLog = {
      b1: { noteId: 'n1', edited: 'T1' },
      b2: { noteId: 'n2', edited: 'T1' },
    };
    const plan = planNotionPull(blocks, log);
    expect(plan.pending.map((b) => b.blockId)).toEqual(['b2', 'b3']);
    expect(plan.skipped).toBe(1);
  });

  it('検証エラーの記録（noteId 空）も edited が同じなら再挑戦しない', () => {
    const log: NotionPullLog = { b1: { noteId: '', edited: 'T1' } };
    expect(planNotionPull([makeBlock({ blockId: 'b1', edited: 'T1' })], log).pending).toEqual([]);
    // Notion 側で直せば edited が変わり、拾い直す
    expect(
      planNotionPull([makeBlock({ blockId: 'b1', edited: 'T2' })], log).pending,
    ).toHaveLength(1);
  });
});

describe('matchExistingNote', () => {
  const notes = [
    makeNote({ id: 'n1', date: '2026-08-17', subject: '歴総', unit: '産業革命' }),
    makeNote({ id: 'n2', date: '2026-08-17', subject: '数学', unit: '二次関数' }),
  ];

  it('同じブロックの以前の取り込み先（ログ）を最優先で返す', () => {
    const log: NotionPullLog = { b1: { noteId: 'n2', edited: 'T0' } };
    // 3 つ組は n1 に一致するが、ログが n2 を指すならそちら（同じブロックは同じノートへ）
    expect(
      matchExistingNote(notes, log, 'b1', { date: '2026-08-17', subject: '歴総', unit: '産業革命' })
        ?.id,
    ).toBe('n2');
  });

  it('ログが無ければ 授業日+教科+単元 の一致で上書き先にする（再実行ページの重複防止）', () => {
    expect(
      matchExistingNote(notes, {}, 'bX', { date: '2026-08-17', subject: '歴総', unit: '産業革命' })
        ?.id,
    ).toBe('n1');
    expect(
      matchExistingNote(notes, {}, 'bX', { date: '2026-08-18', subject: '歴総', unit: '産業革命' }),
    ).toBeNull();
  });

  it('ログの指すノートが消されていたら 3 つ組へフォールバックする', () => {
    const log: NotionPullLog = { b1: { noteId: 'nGONE', edited: 'T0' } };
    expect(
      matchExistingNote(notes, log, 'b1', { date: '2026-08-17', subject: '数学', unit: '二次関数' })
        ?.id,
    ).toBe('n2');
  });
});
