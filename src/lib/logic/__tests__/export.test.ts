import { describe, expect, it } from 'vitest';

import { PERSISTENT_KEYS, type ExportData, type Score } from '../../model/types';
import {
  BACKUP_MIME,
  CSV_BOM,
  CSV_EOL,
  CSV_MIME,
  buildBackupJson,
  buildStudyCsv,
  csvByDay,
  csvCell,
  csvRow,
  exportStamp,
  sortScoresByDay,
  type StudyEntry,
} from '../export';

/** 基準日（dates.test.ts と同じ）。ファイル名は `20260805` になる */
const T = '2026-08-05';

/** BOM をソースに直書きしないための定数（U+FEFF） */
const BOM = String.fromCharCode(0xfeff);

// ─────────────────────────────────────────────────────────────
// csvCell / csvRow — RFC4180（C-560）
// ─────────────────────────────────────────────────────────────

describe('csvCell', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('数学')).toBe('数学');
    expect(csvCell('2026-08-01')).toBe('2026-08-01');
    expect(csvCell(20)).toBe('20');
    expect(csvCell(0)).toBe('0');
    expect(csvCell('')).toBe('');
  });

  it('maps null / undefined to the empty string', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes on comma', () => {
    expect(csvCell('期末考査, 前期')).toBe('"期末考査, 前期"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('小テスト"漢字"')).toBe('"小テスト""漢字"""');
    expect(csvCell('"')).toBe('""""');
  });

  it('quotes on CR / LF / CRLF', () => {
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('does not quote other whitespace（前後空白・タブはそのまま）', () => {
    expect(csvCell('  数学  ')).toBe('  数学  ');
    expect(csvCell('a\tb')).toBe('a\tb');
  });
});

describe('csvRow', () => {
  it('joins cells with a comma', () => {
    expect(csvRow(['date', 'subject', 'minutes'])).toBe('date,subject,minutes');
    expect(csvRow(['2026-08-01', '数学', 20])).toBe('2026-08-01,数学,20');
  });

  it('escapes per cell, not per row', () => {
    expect(csvRow(['a,b', 'c"d', null])).toBe('"a,b","c""d",');
  });
});

// ─────────────────────────────────────────────────────────────
// 並べ替え（C-559）
// ─────────────────────────────────────────────────────────────

describe('csvByDay', () => {
  it('sorts ascending and pushes empty days to the end', () => {
    const rows: StudyEntry[] = [
      { day: '', subj: 'a', min: 1 },
      { day: '2026-08-01', subj: 'b', min: 2 },
      { day: '2026-07-31', subj: 'c', min: 3 },
    ];
    expect(
      rows
        .slice()
        .sort(csvByDay)
        .map((r) => r.subj)
    ).toEqual(['c', 'b', 'a']);
  });

  it('returns 0 for the same day', () => {
    expect(csvByDay({ day: '2026-08-01' }, { day: '2026-08-01' })).toBe(0);
    expect(csvByDay({ day: '' }, { day: '' })).toBe(0);
  });
});

describe('sortScoresByDay', () => {
  const sc = (id: string, day: string): Score => ({ id, name: 't', subj: '数学', day, score: 10 });

  it('sorts ascending by day without mutating the input', () => {
    const input = [sc('c', '2026-08-02'), sc('a', '2026-06-01'), sc('b', '2026-07-10')];
    const out = sortScoresByDay(input);
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the input order for same-day scores', () => {
    const input = [sc('x', '2026-08-01'), sc('y', '2026-08-01'), sc('z', '2026-08-01')];
    expect(sortScoresByDay(input).map((s) => s.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('exportStamp', () => {
  it('strips the hyphens', () => {
    expect(exportStamp(T)).toBe('20260805');
    expect(exportStamp('2026-12-31')).toBe('20261231');
  });
});

// ─────────────────────────────────────────────────────────────
// JSON バックアップ（C-557）
// ─────────────────────────────────────────────────────────────

const SAMPLE_EXPORT: ExportData = {
  version: 1,
  plans: {
    p1: {
      name: '数学 中間対策',
      type: 'test',
      due: '2026-08-20',
      subj: '数学',
      range: '範囲は未設定',
      timetablePeriod: null,
      timetableDate: null,
    },
  },
  state: {
    theme: 'note',
    themeVersion: 3,
    view: 'cockpit',
    navOrder: ['cockpit', 'tests', 'todo', 'review', 'add', 'data'],
    planOrder: ['p1'],
    wkMax: 120,
    weMax: 180,
    selId: null,
    panelW: { nav: 70, search: 320, editor: 360, review: 360, score: 360 },
    studyLog: [{ day: '2026-08-01', subj: '数学', min: 20 }],
    scores: [{ id: 'sc1', name: '期末考査', subj: '英語', day: '2026-07-10', score: 88 }],
    countdowns: [],
    addSubj: '数学',
    addType: 'single',
    addSize: 'M',
    recentSubjs: ['数学'],
    dayOverrides: {},
    timetableFocusDate: T,
    planQuota: {},
    segs: [],
    extras: [],
    reviews: [],
    order: [],
    prepAutoGen: { enabled: true, offSubjects: [] },
    prepGenLog: {},
  },
};

describe('buildBackupJson', () => {
  it('names the file compass-backup-YYYYMMDD.json with the JSON mime', () => {
    const out = buildBackupJson(SAMPLE_EXPORT, T);
    expect(out.filename).toBe('compass-backup-20260805.json');
    expect(out.mime).toBe(BACKUP_MIME);
    expect(out.mime).toBe('application/json');
  });

  it('is the persisted payload verbatim, pretty-printed with 2 spaces', () => {
    const out = buildBackupJson(SAMPLE_EXPORT, T);
    expect(out.content).toBe(JSON.stringify(SAMPLE_EXPORT, null, 2));
    expect(out.content.startsWith('{\n  "version": 1,\n  "plans": {\n    "p1": {')).toBe(true);
    // 末尾に改行は付かない（レガシー exportJson と同じ）
    expect(out.content.endsWith('}')).toBe(true);
    expect(JSON.parse(out.content)).toEqual(SAMPLE_EXPORT);
  });

  it('keeps the 3 top-level keys and every state key in PERSISTENT_KEYS order', () => {
    const parsed = JSON.parse(buildBackupJson(SAMPLE_EXPORT, T).content);
    expect(Object.keys(parsed)).toEqual(['version', 'plans', 'state']);
    expect(Object.keys(parsed.state)).toEqual([...PERSISTENT_KEYS]);
  });

  it('falls back to the real today when no date is given', () => {
    expect(buildBackupJson(SAMPLE_EXPORT).filename).toMatch(/^compass-backup-\d{8}\.json$/);
  });
});

// ─────────────────────────────────────────────────────────────
// 学習 CSV（C-558〜C-560）
// ─────────────────────────────────────────────────────────────

const STUDY: StudyEntry[] = [
  { day: '2026-08-01', subj: '数学', min: 20 },
  { day: '', subj: '英語', min: 10 },
  { day: '2026-07-31', subj: '国語', min: 15 },
];

const SCORES: Score[] = [
  { id: 's1', name: '期末考査, 前期', subj: '英語', day: '2026-07-10', score: 88 },
  { id: 's2', name: '小テスト"漢字"', subj: '国語', day: '2026-06-01', score: 70 },
  { id: 's3', name: '実力\r\n判定', subj: '数学', day: '2026-08-02', score: 55 },
];

describe('buildStudyCsv', () => {
  it('names the file compass-study-YYYYMMDD.csv with the CSV mime', () => {
    const out = buildStudyCsv(STUDY, SCORES, T);
    expect(out.filename).toBe('compass-study-20260805.csv');
    expect(out.mime).toBe(CSV_MIME);
    expect(out.mime).toBe('text/csv;charset=utf-8');
  });

  it('emits both tables separated by one blank line, sorted, RFC4180-escaped', () => {
    const out = buildStudyCsv(STUDY, SCORES, T);
    expect(out.content).toBe(
      BOM +
        [
          '学習ログ',
          'date,subject,minutes',
          '2026-07-31,国語,15',
          '2026-08-01,数学,20',
          ',英語,10',
          '',
          'テスト結果',
          'date,test,subject,score',
          '2026-06-01,"小テスト""漢字""",国語,70',
          '2026-07-10,"期末考査, 前期",英語,88',
          '2026-08-02,"実力\r\n判定",数学,55',
        ].join(CSV_EOL) +
        CSV_EOL
    );
  });

  it('starts with the UTF-8 BOM', () => {
    const out = buildStudyCsv(STUDY, SCORES, T);
    expect(out.content.charCodeAt(0)).toBe(0xfeff);
    expect(out.content.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe(BOM);
    // BOM の直後がラベル行
    expect(out.content.slice(1).startsWith('学習ログ' + CSV_EOL)).toBe(true);
  });

  it('uses CRLF everywhere and ends with a trailing CRLF', () => {
    const content = buildStudyCsv(STUDY, SCORES, T).content;
    expect(content.endsWith(CSV_EOL)).toBe(true);
    // 埋め込みの CR/LF はすべて引用符の中（= 生の LF は必ず CR を伴う）
    expect(content.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps the two header rows', () => {
    const rows = buildStudyCsv(STUDY, SCORES, T).content.slice(1).split(CSV_EOL);
    expect(rows[1]).toBe('date,subject,minutes');
    expect(rows.indexOf('date,test,subject,score')).toBeGreaterThan(0);
  });

  it('separates the tables with exactly one blank line', () => {
    const rows = buildStudyCsv(STUDY, SCORES, T).content.slice(1).split(CSV_EOL);
    const blank = rows.indexOf('');
    expect(rows[blank - 1]).toBe(',英語,10');
    expect(rows[blank + 1]).toBe('テスト結果');
    expect(rows.slice(blank + 1).indexOf('')).toBe(rows.slice(blank + 1).length - 1);
  });

  it('handles empty data — labels and headers only', () => {
    const out = buildStudyCsv([], [], T);
    expect(out.content).toBe(
      BOM +
        ['学習ログ', 'date,subject,minutes', '', 'テスト結果', 'date,test,subject,score'].join(
          CSV_EOL
        ) +
        CSV_EOL
    );
    expect(out.filename).toBe('compass-study-20260805.csv');
  });

  it('handles one empty table and one populated table', () => {
    expect(buildStudyCsv([], SCORES.slice(0, 1), T).content).toBe(
      BOM +
        [
          '学習ログ',
          'date,subject,minutes',
          '',
          'テスト結果',
          'date,test,subject,score',
          '2026-07-10,"期末考査, 前期",英語,88',
        ].join(CSV_EOL) +
        CSV_EOL
    );
    expect(buildStudyCsv(STUDY.slice(0, 1), [], T).content).toBe(
      BOM +
        [
          '学習ログ',
          'date,subject,minutes',
          '2026-08-01,数学,20',
          '',
          'テスト結果',
          'date,test,subject,score',
        ].join(CSV_EOL) +
        CSV_EOL
    );
  });

  it('escapes commas / quotes / newlines in subject and title cells too', () => {
    const rows = buildStudyCsv(
      [{ day: '2026-08-01', subj: '数学,応用', min: 20 }],
      [{ id: 's', name: 'a"b', subj: 'c\nd', day: '2026-08-01', score: 0 }],
      T
    )
      .content.slice(1)
      .split(CSV_EOL);
    expect(rows[2]).toBe('2026-08-01,"数学,応用",20');
    expect(rows[rows.length - 2]).toBe('2026-08-01,"a""b","c\nd",0');
  });

  it('does not mutate its inputs', () => {
    const study = STUDY.slice();
    const scores = SCORES.slice();
    buildStudyCsv(study, scores, T);
    expect(study).toEqual(STUDY);
    expect(scores).toEqual(SCORES);
  });

  it('falls back to the real today when no date is given', () => {
    expect(buildStudyCsv([], []).filename).toMatch(/^compass-study-\d{8}\.csv$/);
  });
});
