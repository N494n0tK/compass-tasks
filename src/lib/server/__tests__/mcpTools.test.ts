import { beforeEach, describe, expect, it } from 'vitest';
import { callTool, TOOLS } from '../mcpTools';
import type { CompassServerStore } from '../compassStore';
import type { ImportRecord } from '../../logic/noteSync';
import type { Note } from '../../model/notes';

const TODAY = '2026-08-25';

/** Firestore の代わり。`saveNote` / `writeImport` が呼ばれた回数も数える */
function fakeStore(notes: Note[] = []) {
  const state = {
    notes: notes.slice(),
    imports: new Map<string, ImportRecord>(),
    writes: 0,
    importWrites: 0,
  };
  const store: CompassServerStore = {
    uid: 'uid-abcd1234',
    async loadNotes() {
      return state.notes.slice();
    },
    async saveNote(note) {
      state.writes += 1;
      const i = state.notes.findIndex((n) => n.id === note.id);
      if (i >= 0) state.notes[i] = note;
      else state.notes.push(note);
    },
    async readImport(key) {
      return state.imports.get(key) ?? null;
    },
    async writeImport(record) {
      state.importWrites += 1;
      state.imports.set(record.key, record);
    },
    async listImports(limit = 20) {
      return Array.from(state.imports.values())
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);
    },
  };
  return { store, state };
}

function ctx(store: CompassServerStore) {
  return { store: () => store, today: TODAY, now: () => '2026-08-25T09:00:00.000Z' };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-20',
    subject: '数学',
    unit: '順列',
    scans: [],
    cards: [
      { cardId: 'c1', q: '順列とは', a: '並べ方', guide: '', src: '', origin: 'self', attempts: [] },
      { cardId: 'c2', q: '階乗とは', a: '積', guide: '', src: '', origin: 'ai', attempts: [] },
    ],
    sections: [{ heading: '導入', text: '', ai: '順列は並べ方' }],
    summary: '',
    keywords: [{ term: '順列', color: 'red', note: '' }],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-20',
    updatedAt: '2026-08-20',
    trashedAt: '',
    ...over,
  };
}

const PAYLOAD = {
  schema: 'compass-note@2',
  date: '2026-08-25',
  subject: '数学',
  unit: '順列・階乗',
  recall: [{ q: '順列とは何か', a: '並べ方の総数', guide: '', src: '', origin: 'self' }],
  sections: [{ heading: '導入', text: '', ai: '順列 … 並べ方の総数' }],
  keywords: [{ term: '順列', color: 'red', note: '' }],
  summary: '',
  exercise: { q: '', a: '' },
  doubt: '',
  notice: '',
};

/** `structuredContent` をそのまま読む（`text` は同じ内容の整形版） */
async function call(store: CompassServerStore, name: string, args: unknown = {}) {
  const res = await callTool(name, args, ctx(store));
  return { ...res, data: res.data as Record<string, unknown> };
}

describe('ツール定義', () => {
  it('読み取り専用のツールは readOnly が立っている', () => {
    const write = TOOLS.filter((t) => !t.readOnly).map((t) => t.name).sort();
    expect(write).toEqual(['import_note', 'record_understanding']);
  });

  it('入力スキーマは追加プロパティを許さない（引数の打ち間違いに気付ける）', () => {
    TOOLS.forEach((t) => expect(t.inputSchema.additionalProperties).toBe(false));
  });
});

describe('読み取り', () => {
  it('whoami が uid を丸ごと返さない', async () => {
    const { store } = fakeStore([note()]);
    const { data } = await call(store, 'whoami');
    expect(data.uid_tail).toBe('1234');
    expect(JSON.stringify(data)).not.toContain('uid-abcd1234');
    expect(data.notes).toBe(1);
  });

  it('list_notes は本文を返さない', async () => {
    const { store } = fakeStore([note(), note({ id: 'n2', subject: '英コ', date: '2026-08-21' })]);
    const { data } = await call(store, 'list_notes', {});
    expect(data.count).toBe(2);
    expect(JSON.stringify(data)).not.toContain('順列は並べ方');
  });

  it('list_notes は教科と期間で絞れる', async () => {
    const { store } = fakeStore([note(), note({ id: 'n2', subject: '英コ', date: '2026-08-21' })]);
    expect((await call(store, 'list_notes', { subject: '英コ' })).data.count).toBe(1);
    expect((await call(store, 'list_notes', { from: '2026-08-21' })).data.count).toBe(1);
    expect((await call(store, 'list_notes', { to: '2026-08-19' })).data.count).toBe(0);
  });

  it('get_note は note_id でも 授業日+教科 でも引ける', async () => {
    const { store } = fakeStore([note()]);
    expect((await call(store, 'get_note', { note_id: 'n1' })).isError).toBeFalsy();
    const byDate = await call(store, 'get_note', { date: '2026-08-20', subject: '数学' });
    expect((byDate.data.note as Record<string, unknown>).note_id).toBe('n1');
  });

  it('同じ日に複数あるときは候補を返して止まる', async () => {
    const { store } = fakeStore([note(), note({ id: 'n2', unit: '階乗' })]);
    const res = await call(store, 'get_note', { date: '2026-08-20' });
    expect(res.isError).toBe(true);
    expect((res.data.candidates as unknown[]).length).toBe(2);
  });

  it('get_timetable が週の基本形と教科コードを返す', async () => {
    const { store } = fakeStore();
    const { data } = await call(store, 'get_timetable');
    expect(data.periods).toBe(7);
    expect(data.subjects).toContain('数学');
  });
});

describe('record_understanding', () => {
  it('理解度をノートへ書き足す（復習には触れない）', async () => {
    const { store, state } = fakeStore([note()]);
    const { data } = await call(store, 'record_understanding', {
      note_id: 'n1',
      results: [{ card_id: 'c1', grade: 'low' }],
    });
    expect(data.recorded).toBe(1);
    expect(state.writes).toBe(1);
    expect(state.notes[0].cards[0].attempts).toEqual([{ day: TODAY, grade: 'low' }]);
    expect(String(data.notice)).toContain('復習の間隔');
  });

  it('grade の表記ゆれを吸収する', async () => {
    const { store, state } = fakeStore([note()]);
    await call(store, 'record_understanding', { note_id: 'n1', results: [{ card_id: 'c1', grade: '◎' }] });
    expect(state.notes[0].cards[0].attempts[0].grade).toBe('high');
  });

  it('知らない card_id だけなら何も書かず、候補を返す', async () => {
    const { store, state } = fakeStore([note()]);
    const res = await call(store, 'record_understanding', {
      note_id: 'n1',
      results: [{ card_id: 'zzz', grade: 'high' }],
    });
    expect(res.isError).toBe(true);
    expect(state.writes).toBe(0);
    expect((res.data.available as unknown[]).length).toBe(2);
  });

  it('day が YYYY-MM-DD でなければ書かずに止まる（黙って消えるのを防ぐ）', async () => {
    const { store, state } = fakeStore([note()]);
    const res = await call(store, 'record_understanding', {
      note_id: 'n1',
      results: [{ card_id: 'c1', grade: 'high' }],
      day: '8/25',
    });
    expect(res.isError).toBe(true);
    expect(state.writes).toBe(0);
    expect(String(res.data.message)).toContain('YYYY-MM-DD');
  });

  it('ノートが無ければ書かない', async () => {
    const { store, state } = fakeStore([]);
    const res = await call(store, 'record_understanding', {
      note_id: 'nope',
      results: [{ card_id: 'c1', grade: 'high' }],
    });
    expect(res.isError).toBe(true);
    expect(state.writes).toBe(0);
  });
});

describe('import_note', () => {
  let fake: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    fake = fakeStore([]);
  });

  it('dry_run は Firestore を 1 バイトも変えない', async () => {
    const { data } = await call(fake.store, 'import_note', { payload: PAYLOAD });
    expect(data.status).toBe('validated');
    expect(fake.state.writes).toBe(0);
    expect(fake.state.importWrites).toBe(0);
    expect(fake.state.notes.length).toBe(0);
  });

  it('commit でノート 1 件と台帳 1 行ができる', async () => {
    const { data } = await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    expect(data.status).toBe('created');
    expect(data.revision).toBe(1);
    expect(fake.state.notes.length).toBe(1);
    expect(fake.state.imports.size).toBe(1);
  });

  it('同じ payload の再送は duplicate で、何も書かない', async () => {
    await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    const before = fake.state.writes;
    const { data } = await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    expect(data.status).toBe('duplicate');
    expect(fake.state.writes).toBe(before);
    expect(fake.state.notes.length).toBe(1);
  });

  it('同じ授業で中身が違うと conflict、overwrite:true で updated', async () => {
    await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    const changed = { ...PAYLOAD, notice: '小テストあり' };

    const conflict = await call(fake.store, 'import_note', { payload: changed, mode: 'commit' });
    expect(conflict.data.status).toBe('conflict');
    expect(conflict.isError).toBe(true);
    expect(fake.state.notes[0].notice).toBe('');

    const forced = await call(fake.store, 'import_note', {
      payload: changed,
      mode: 'commit',
      overwrite: true,
    });
    expect(forced.data.status).toBe('updated');
    expect(forced.data.revision).toBe(2);
    expect(fake.state.notes.length).toBe(1);
    expect(fake.state.notes[0].notice).toBe('小テストあり');
  });

  it('JSON 文字列でもコードブロック付きでも受ける', async () => {
    const fenced = '```json\n' + JSON.stringify(PAYLOAD) + '\n```';
    const { data } = await call(fake.store, 'import_note', { payload: fenced });
    expect(data.status).toBe('validated');
    expect((data.warnings as unknown[]).length).toBeGreaterThan(0);
  });

  it('検証に落ちたら rejected で何も書かない', async () => {
    const bad = { ...PAYLOAD, recall: [] };
    const res = await call(fake.store, 'import_note', { payload: bad, mode: 'commit' });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe('rejected');
    expect(fake.state.writes).toBe(0);
  });

  it('上書きでも本人領域（summary / doubt / scans）を消さない', async () => {
    const existing = note({
      id: 'nx',
      date: PAYLOAD.date,
      subject: PAYLOAD.subject,
      unit: PAYLOAD.unit,
      summary: '自分のまとめ',
      doubt: 'なぜ階乗を使う？',
      scans: [{ scanId: 's1', mime: 'image/jpeg', w: 10, h: 10, bytes: 100, caption: '' }],
    });
    const seeded = fakeStore([existing]);
    const { data } = await call(seeded.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    expect(data.status).toBe('updated');
    expect(seeded.state.notes.length).toBe(1);
    expect(seeded.state.notes[0].id).toBe('nx');
    expect(seeded.state.notes[0].summary).toBe('自分のまとめ');
    expect(seeded.state.notes[0].doubt).toBe('なぜ階乗を使う？');
    expect(seeded.state.notes[0].scans.length).toBe(1);
  });

  it('上書きでも既存の理解度（attempts）を捨てない', async () => {
    const existing = note({
      id: 'nx',
      date: PAYLOAD.date,
      subject: PAYLOAD.subject,
      unit: PAYLOAD.unit,
      cards: [
        {
          cardId: 'c1',
          q: '順列とは何か',
          a: '並べ方の総数',
          guide: '',
          src: '',
          origin: 'self',
          attempts: [{ day: '2026-08-24', grade: 'low' }],
        },
      ],
    });
    const seeded = fakeStore([existing]);
    await call(seeded.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    expect(seeded.state.notes[0].cards[0].attempts).toEqual([{ day: '2026-08-24', grade: 'low' }]);
  });

  it('payload に余分な鍵（source など）が混ざっていても無視して取り込む', async () => {
    const withExtra = { ...PAYLOAD, source: 'notion-daily', 元ノート: 'https://example.com' };
    const { data } = await call(fake.store, 'import_note', { payload: withExtra, mode: 'commit' });
    expect(data.status).toBe('created');
    expect(fake.state.notes.length).toBe(1);
  });

  it('payload_json でも受ける（文字列しか渡せないクライアント向け）', async () => {
    const { data } = await call(fake.store, 'import_note', {
      payload_json: JSON.stringify(PAYLOAD),
      mode: 'commit',
    });
    expect(data.status).toBe('created');
  });

  it('payload の入力スキーマは中身の鍵を拒まない', () => {
    const tool = TOOLS.find((t) => t.name === 'import_note');
    const payload = (tool?.inputSchema.properties as Record<string, Record<string, unknown>>).payload;
    expect(payload.type).toBe('object');
    expect(payload.additionalProperties).toBe(true);
  });

  it('doubt だけ違う再送は duplicate にならず、上書き提案（conflict）になる', async () => {
    await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    const withDoubt = { ...PAYLOAD, doubt: 'なぜ余事象が速いのか' };
    const res = await call(fake.store, 'import_note', { payload: withDoubt, mode: 'commit' });
    // hash に「送られてきた doubt」が入っているので、内容違いとして扱われる
    expect(res.data.status).toBe('conflict');
    const forced = await call(fake.store, 'import_note', {
      payload: withDoubt,
      mode: 'commit',
      overwrite: true,
    });
    expect(forced.data.status).toBe('updated');
    expect(fake.state.notes[0].doubt).toBe('なぜ余事象が速いのか');
  });

  it('台帳が list_imports から読める', async () => {
    await call(fake.store, 'import_note', { payload: PAYLOAD, mode: 'commit' });
    const { data } = await call(fake.store, 'list_imports', {});
    expect(data.count).toBe(1);
    expect((data.imports as Record<string, unknown>[])[0].source).toBe('notion-mcp');
  });
});

describe('check_notes / morning_brief', () => {
  it('check_notes は期間を絞って点検し、指摘の種類を数える', async () => {
    const good = note({ id: 'g', date: '2026-08-25' });
    // 重要語が本文に無いノート（紙面で色が塗れない）
    const bad = note({
      id: 'b',
      date: '2026-08-25',
      keywords: [{ term: '本文に無い語', color: 'red', note: '' }],
    });
    // 期間の外。点検されないことを確かめるために古い日付にする
    const old = note({ id: 'o', date: '2026-08-01', sections: [] });
    const { store } = fakeStore([good, bad, old]);

    const { data } = await call(store, 'check_notes', { date: '2026-08-25', days: 1 });
    expect(data.from).toBe('2026-08-25');
    expect(data.checked).toBe(2);
    expect(data.flagged).toBe(2); // どちらも重要語が 1 語しかない
    expect((data.by_code as Record<string, number>).keyword_missing).toBe(1);
  });

  it('check_notes は days で遡る', async () => {
    const { store } = fakeStore([note({ id: 'a', date: '2026-08-25' }), note({ id: 'b', date: '2026-08-23' })]);
    expect((await call(store, 'check_notes', { date: '2026-08-25', days: 1 })).data.checked).toBe(1);
    expect((await call(store, 'check_notes', { date: '2026-08-25', days: 3 })).data.checked).toBe(2);
  });

  it('check_notes は date を省くと今日を見る', async () => {
    const { store } = fakeStore([note({ id: 'a', date: TODAY })]);
    const { data } = await call(store, 'check_notes', {});
    expect(data.to).toBe(TODAY);
    expect(data.checked).toBe(1);
  });

  it('morning_brief は土日を作らない', async () => {
    const { store } = fakeStore([]);
    const { data } = await call(store, 'morning_brief', { date: '2026-08-29' });
    expect(data.skipped).toBe(true);
  });

  it('morning_brief は貼れる本文と素材を両方返す', async () => {
    const { store } = fakeStore([note({ id: 'a', date: '2026-08-27', notice: 'プリント提出' })]);
    const { data } = await call(store, 'morning_brief', { date: '2026-08-28' });
    expect(data.skipped).toBe(false);
    expect(data.slots).toEqual(['現国', '体育', '地総', '英コ', '数学', 'LHR']);
    expect(String(data.body)).toContain('- 数学：プリント提出');
    expect(String(data.body)).toContain('### 思い出せるか');
  });

  it('morning_brief は引数なしなら今日（Asia/Tokyo）を使う', async () => {
    const { store } = fakeStore([]);
    const { data } = await call(store, 'morning_brief', {});
    expect(data.date).toBe(TODAY);
    expect(data.skipped).toBe(false);
  });

  it('新しい 2 つは読むだけのツールとして出ている', () => {
    ['check_notes', 'morning_brief'].forEach((name) => {
      expect(TOOLS.find((t) => t.name === name)?.readOnly).toBe(true);
    });
  });
});
