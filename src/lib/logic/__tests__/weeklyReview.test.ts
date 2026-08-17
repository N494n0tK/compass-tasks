import { describe, expect, it } from 'vitest';

import type {
  Extra,
  FocusLogEntry,
  ISODate,
  Mission,
  Plans,
  Review,
  Seg,
  StudyLogEntry,
  WeekNotes,
} from '../../model/types';
import { computeWeekRate, toH } from '../aggregate';
import { dowOf } from '../dates';
import { buildMissionExtra } from '../missionAutogen';
import {
  WEEKLY_DASH,
  WEEK_NOTE_LIST_LIMIT,
  buildWeeklyReport,
  hasWeekNote,
  lastWeekOf,
  recentWeekNotes,
  setWeekNote,
  weekLabelOf,
  type WeeklyReviewInput,
} from '../weeklyReview';

/**
 * 2026-08-17 は月曜（カードが出る日）。先週 = 08-10(月) 〜 08-16(日)。
 * `今週` の日付は「先週に数えてはいけない側」の見張りに使う。
 */
const TODAY = '2026-08-17';
const LAST_MON = '2026-08-10';
const LAST_WED = '2026-08-12';
const LAST_SUN = '2026-08-16';
/** 先週より前（先々週の日曜） */
const BEFORE = '2026-08-09';

const PLANS: Plans = {
  p1: {
    name: '数学 中間対策',
    type: 'test',
    due: '2026-08-31',
    subj: '数学',
    range: '範囲は未設定',
    timetablePeriod: null,
    timetableDate: null,
  },
};

function seg(over: Partial<Seg> = {}): Seg {
  return {
    id: over.id || 's1',
    plan: 'p1',
    title: 'ミニタスク',
    size: 'M',
    min: 20,
    day: LAST_WED,
    done: true,
    ...over,
  };
}

function extra(over: Partial<Extra> = {}): Extra {
  return {
    id: over.id || 'u1',
    title: '単発',
    subj: '英語',
    size: 'S',
    min: 10,
    day: LAST_WED,
    done: true,
    src: '単発タスク',
    timetablePeriod: null,
    timetableDate: null,
    ...over,
  };
}

function review(over: Partial<Review> = {}): Review {
  return {
    id: over.id || 'r1',
    seriesId: over.id || 'r1',
    reviewNo: 1,
    title: '三角比',
    subj: '数学',
    stage: '翌日',
    last: BEFORE,
    due: LAST_WED,
    min: 15,
    src: '手動追加',
    timetablePeriod: null,
    timetableDate: null,
    added: false,
    done: false,
    ...over,
  };
}

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: over.id || 'dmx1',
    title: '英単語 DUO 1セクション',
    subj: '英語',
    size: 'S',
    dows: [],
    active: true,
    createdAt: '2026-07-01',
    ...over,
  };
}

/** その日ぶんを消化した状態のミッション Extra（`missionStats` のテストと同じ作り方） */
function missionDone(m: Mission, day: ISODate): Extra {
  return { ...buildMissionExtra(m, day), done: true };
}

function input(over: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return {
    studyLog: [],
    segs: [],
    extras: [],
    reviews: [],
    missions: [],
    focusLog: [],
    ...over,
  };
}

const report = (over: Partial<WeeklyReviewInput> = {}, today: ISODate = TODAY) =>
  buildWeeklyReport(input(over), PLANS, today);

// ─────────────────────────────────────────────────────────────
// 週の範囲
// ─────────────────────────────────────────────────────────────

describe('lastWeekOf', () => {
  it('月曜に開いたら「昨日までの7日間」', () => {
    expect(dowOf(TODAY)).toBe('月');
    expect(lastWeekOf(TODAY)).toEqual({
      start: LAST_MON,
      end: LAST_SUN,
      label: '8/10-8/16',
    });
  });

  it('週の中のどの日から見ても同じ先週を指す（月曜〜日曜で 1 つ）', () => {
    const base = lastWeekOf(TODAY);
    ['2026-08-18', '2026-08-20', '2026-08-22', '2026-08-23'].forEach((iso) => {
      expect(lastWeekOf(iso)).toEqual(base);
    });
    // 日曜（週の最終日）までが同じ週。翌月曜からは 1 週ぶん進む
    expect(dowOf('2026-08-23')).toBe('日');
    expect(lastWeekOf('2026-08-24').start).toBe('2026-08-17');
  });

  it('年をまたいでもズレない', () => {
    // 2027-01-04(月) の先週は 2026-12-28(月) 〜 2027-01-03(日)
    expect(lastWeekOf('2027-01-04')).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
      label: '12/28-1/3',
    });
    // 2026-01-04 は日曜。その週の月曜は前年 2025-12-29 なので、先週は 12/22〜12/28
    expect(lastWeekOf('2026-01-04')).toEqual({
      start: '2025-12-22',
      end: '2025-12-28',
      label: '12/22-12/28',
    });
  });

  it('月をまたぐ週のラベル', () => {
    // 2026-09-07(月) の先週は 8/31(月)〜9/6(日)
    expect(weekLabelOf('2026-08-31')).toBe('8/31-9/6');
  });
});

// ─────────────────────────────────────────────────────────────
// 復習完了率 — `computeWeekRate` と意味を揃える
// ─────────────────────────────────────────────────────────────

describe('buildWeeklyReport — 復習完了率', () => {
  it('先週が対象の復習のうち done の割合。母数は月〜日の全件', () => {
    const reviews = [
      review({ id: 'r1', due: LAST_MON, done: true }),
      review({ id: 'r2', due: LAST_WED, done: true }),
      review({ id: 'r3', due: LAST_SUN, done: false }),
    ];
    const r = report({ reviews });
    expect(r.reviewDone).toBe(2);
    expect(r.reviewTotal).toBe(3);
    expect(r.reviewRate).toBe(67); // Math.round(2/3*100)
  });

  it('`computeWeekRate` を先週の日曜で呼んだ結果と完全に一致する', () => {
    const reviews = [
      review({ id: 'r1', due: BEFORE, done: true }),
      review({ id: 'r2', due: LAST_MON, done: true }),
      review({ id: 'r3', due: LAST_SUN, done: false }),
      review({ id: 'r4', due: TODAY, done: true }),
    ];
    const r = report({ reviews });
    const same = computeWeekRate(reviews, LAST_SUN);
    expect([r.reviewDone, r.reviewTotal, r.reviewRate]).toEqual([
      same.done,
      same.total,
      same.rate,
    ]);
  });

  it('先週の外（先々週・今週）の due は母数にも分子にも入らない', () => {
    const r = report({
      reviews: [
        review({ id: 'r1', due: BEFORE, done: true }),
        review({ id: 'r2', due: TODAY, done: true }),
        review({ id: 'r3', due: '2026-08-23', done: true }),
      ],
    });
    expect(r.reviewTotal).toBe(0);
    expect(r.reviewRate).toBeNull();
  });

  it('`added` は問わず、`completedAt` も見ない（判定は `done` だけ）', () => {
    const r = report({
      reviews: [
        review({ id: 'r1', due: LAST_WED, done: true, added: false }),
        // 完了印は付いていないが completedAt だけ残っている壊れたデータ
        review({ id: 'r2', due: LAST_WED, done: false, completedAt: LAST_WED }),
      ],
    });
    expect([r.reviewDone, r.reviewTotal]).toEqual([1, 2]);
  });

  it('母数 0 は null（0% ではない）', () => {
    const r = report();
    expect(r.reviewRate).toBeNull();
    expect(r.stats[0]).toMatchObject({ value: WEEKLY_DASH, unit: '', note: '対象なし' });
  });
});

// ─────────────────────────────────────────────────────────────
// 学習時間 — `buildStudyEntries` と同じ集計元
// ─────────────────────────────────────────────────────────────

describe('buildWeeklyReport — 学習時間', () => {
  it('学習ログ + 完了した seg / extra を先週ぶんだけ足す', () => {
    const r = report({
      studyLog: [{ day: LAST_MON, subj: '数学', min: 40 }],
      segs: [seg({ id: 's1', day: LAST_WED, min: 20, done: true })],
      extras: [extra({ id: 'u1', day: LAST_SUN, min: 10, done: true })],
    });
    expect(r.studyMinutes).toBe(70);
  });

  it('未完了の seg / extra は数えない（チェックを外すと即座に消える）', () => {
    const r = report({
      segs: [seg({ id: 's1', done: false, min: 20 })],
      extras: [extra({ id: 'u1', done: false, min: 10 })],
    });
    expect(r.studyMinutes).toBe(0);
  });

  it('完了した復習を二重に数えない（`confirmAsk` が書いた studyLog のぶんだけ）', () => {
    const r = report({
      studyLog: [{ day: LAST_WED, subj: '数学', min: 15 }],
      reviews: [review({ id: 'r1', due: LAST_WED, done: true, completedAt: LAST_WED, min: 15 })],
    });
    expect(r.studyMinutes).toBe(15);
  });

  it('先週の外の日と、日付を持たない完了タスクは数えない', () => {
    const r = report({
      studyLog: [
        { day: BEFORE, subj: '数学', min: 60 },
        { day: TODAY, subj: '数学', min: 60 },
      ],
      extras: [extra({ id: 'u1', day: '', min: 30, done: true })],
    });
    expect(r.studyMinutes).toBe(0);
  });

  it('孤児 seg（計画が消えている）は数えない', () => {
    const r = report({ segs: [seg({ id: 's1', plan: 'missing', min: 20, done: true })] });
    expect(r.studyMinutes).toBe(0);
  });

  it('壊れた分数は 0 として扱う', () => {
    const broken = [{ day: LAST_WED, subj: '数学', min: 'x' } as unknown as StudyLogEntry];
    expect(report({ studyLog: broken }).studyMinutes).toBe(0);
  });

  it('表示ラベルは `toH` から作る（データ画面の時間表記と必ず一致する）', () => {
    const r = report({ studyLog: [{ day: LAST_MON, subj: '数学', min: 150 }] });
    const tile = r.stats.filter((s) => s.key === 'study')[0];
    expect(tile.value + tile.unit).toBe(toH(150));
    expect(tile.value).toBe('2.5');
    expect(tile.unit).toBe('h');
  });
});

// ─────────────────────────────────────────────────────────────
// ミッション — `missionStats` と同じマスの数え方
// ─────────────────────────────────────────────────────────────

describe('buildWeeklyReport — ミッション', () => {
  it('毎日ミッションは 7 日が母数。完了ぶんが分子', () => {
    const m = mission();
    const r = report({
      missions: [m],
      extras: [missionDone(m, LAST_MON), missionDone(m, LAST_WED), missionDone(m, LAST_SUN)],
    });
    expect(r.mission).toEqual({ done: 3, total: 7 });
  });

  it('実施曜日の外（off）は母数に入らない', () => {
    // 月(1)・水(3)・金(5) だけのミッション → 先週の母数は 3 日
    const m = mission({ id: 'dmx2', dows: [1, 3, 5] });
    const r = report({ missions: [m], extras: [missionDone(m, LAST_MON)] });
    expect(r.mission).toEqual({ done: 1, total: 3 });
  });

  it('作る前（before）の日は母数に入らない', () => {
    const m = mission({ id: 'dmx3', createdAt: LAST_WED });
    const r = report({ missions: [m], extras: [missionDone(m, LAST_WED)] });
    // 水〜日の 5 日が母数
    expect(r.mission).toEqual({ done: 1, total: 5 });
  });

  it('先週より後に作ったミッションは対象 0 日なので null', () => {
    const m = mission({ id: 'dmx4', createdAt: TODAY });
    expect(report({ missions: [m] }).mission).toBeNull();
  });

  it('全ミッションを合算する', () => {
    const a = mission({ id: 'dma' });
    const b = mission({ id: 'dmb', dows: [1] });
    const r = report({
      missions: [a, b],
      extras: [missionDone(a, LAST_MON), missionDone(b, LAST_MON)],
    });
    expect(r.mission).toEqual({ done: 2, total: 8 });
  });

  it('先週の外の完了は数えない', () => {
    const m = mission();
    const r = report({
      missions: [m],
      extras: [missionDone(m, BEFORE), missionDone(m, TODAY)],
    });
    expect(r.mission).toEqual({ done: 0, total: 7 });
  });

  it('台帳から消したミッションの完了履歴は出てこない', () => {
    const gone = mission({ id: 'dmgone' });
    expect(report({ missions: [], extras: [missionDone(gone, LAST_WED)] }).mission).toBeNull();
  });

  it('台帳が空なら null（0/0 を 0% と出さない）', () => {
    const r = report();
    expect(r.mission).toBeNull();
    expect(r.stats[2]).toMatchObject({ value: WEEKLY_DASH, unit: '', note: '対象なし' });
  });

  it('一時停止中（active:false）でも先週やっていた記録は数える', () => {
    // `active` は「これから積むかどうか」の設定で、過去にやった事実とは関係がない
    const m = mission({ id: 'dmoff', active: false });
    const r = report({ missions: [m], extras: [missionDone(m, LAST_MON)] });
    expect(r.mission).toEqual({ done: 1, total: 7 });
  });
});

// ─────────────────────────────────────────────────────────────
// 集中モードの実測
// ─────────────────────────────────────────────────────────────

describe('buildWeeklyReport — 集中実測', () => {
  it('先週（月〜日）の合計分', () => {
    const focusLog: FocusLogEntry[] = [
      { day: LAST_MON, subj: '数学', min: 25 },
      { day: LAST_SUN, subj: '英語', min: 45 },
      { day: BEFORE, subj: '数学', min: 25 },
      { day: TODAY, subj: '数学', min: 25 },
    ];
    expect(report({ focusLog }).focusMinutes).toBe(70);
  });

  it('壊れた分数・日付なしは 0 として扱う', () => {
    const focusLog = [
      { day: LAST_MON, subj: '数学', min: null },
      { day: '', subj: '数学', min: 30 },
    ] as unknown as FocusLogEntry[];
    expect(report({ focusLog }).focusMinutes).toBe(0);
  });

  it('学習時間には合流しない（別々の物差しのまま）', () => {
    const r = report({
      studyLog: [{ day: LAST_MON, subj: '数学', min: 20 }],
      focusLog: [{ day: LAST_MON, subj: '数学', min: 25 }],
    });
    expect(r.studyMinutes).toBe(20);
    expect(r.focusMinutes).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────
// 表示用ラベルと空データ
// ─────────────────────────────────────────────────────────────

describe('buildWeeklyReport — 表示値', () => {
  it('空データは全部 0 / – で、記録なし扱いになる', () => {
    const r = report();
    expect(r.rangeLabel).toBe('8/10-8/16');
    expect(r.start).toBe(LAST_MON);
    expect(r.end).toBe(LAST_SUN);
    expect(r.studyMinutes).toBe(0);
    expect(r.focusMinutes).toBe(0);
    expect(r.hasRecord).toBe(false);
    expect(r.stats.map((s) => s.value)).toEqual([WEEKLY_DASH, '0', WEEKLY_DASH, '0']);
    expect(r.compactLabel).toBe('復習 – · 学習 0h · ミッション – · 集中 0分');
  });

  it('タイルは 復習 → 学習 → ミッション → 集中 の順', () => {
    expect(report().stats.map((s) => s.key)).toEqual(['review', 'study', 'mission', 'focus']);
  });

  it('数字が 1 つでもあれば hasRecord が立つ', () => {
    expect(report({ focusLog: [{ day: LAST_WED, subj: '数学', min: 1 }] }).hasRecord).toBe(true);
    expect(report({ reviews: [review({ due: LAST_WED })] }).hasRecord).toBe(true);
    expect(report({ studyLog: [{ day: LAST_WED, subj: '数学', min: 5 }] }).hasRecord).toBe(true);
    const m = mission();
    expect(report({ missions: [m] }).hasRecord).toBe(true);
  });

  it('埋まったときのコンパクト行', () => {
    const m = mission({ id: 'dmc', dows: [1] });
    const r = report({
      reviews: [
        review({ id: 'r1', due: LAST_MON, done: true }),
        review({ id: 'r2', due: LAST_WED, done: false }),
      ],
      studyLog: [{ day: LAST_MON, subj: '数学', min: 150 }],
      missions: [m],
      extras: [missionDone(m, LAST_MON)],
      focusLog: [{ day: LAST_MON, subj: '数学', min: 45 }],
    });
    // ミッションの完了 Extra（S=10分）も学習時間に乗る（完了 Extra は集計元）
    expect(r.studyMinutes).toBe(160);
    expect(r.compactLabel).toBe('復習 50% · 学習 2.7h · ミッション 1/1日 · 集中 45分');
  });
});

// ─────────────────────────────────────────────────────────────
// 書いた文章
// ─────────────────────────────────────────────────────────────

describe('setWeekNote / hasWeekNote', () => {
  it('その週のぶんだけ差し替える（元は変更しない）', () => {
    const before: WeekNotes = { [LAST_MON]: 'a', '2026-08-03': 'b' };
    const after = setWeekNote(before, LAST_MON, 'c');
    expect(after).toEqual({ [LAST_MON]: 'c', '2026-08-03': 'b' });
    expect(before[LAST_MON]).toBe('a');
  });

  it('空文字はキーごと消す（空のエントリを溜めない）', () => {
    expect(setWeekNote({ [LAST_MON]: 'a' }, LAST_MON, '')).toEqual({});
    expect(LAST_MON in setWeekNote({}, LAST_MON, '')).toBe(false);
  });

  it('空白だけの入力は消さない（打鍵の途中を奪わない）が、書いた扱いにはしない', () => {
    const notes = setWeekNote({}, LAST_MON, '  ');
    expect(notes[LAST_MON]).toBe('  ');
    expect(hasWeekNote(notes, LAST_MON)).toBe(false);
    expect(hasWeekNote({ [LAST_MON]: 'あ' }, LAST_MON)).toBe(true);
    expect(hasWeekNote({}, LAST_MON)).toBe(false);
  });
});

describe('recentWeekNotes', () => {
  it('新しい週が先。ラベルが付く', () => {
    const notes: WeekNotes = {
      '2026-08-03': '古い',
      [LAST_MON]: '新しい',
    };
    expect(recentWeekNotes(notes)).toEqual([
      { start: LAST_MON, label: '8/10-8/16', text: '新しい' },
      { start: '2026-08-03', label: '8/3-8/9', text: '古い' },
    ]);
  });

  it('空・空白だけの週は出さない', () => {
    expect(recentWeekNotes({ [LAST_MON]: '', '2026-08-03': '   ' })).toEqual([]);
  });

  it('既定は直近 4 週まで', () => {
    const notes: WeekNotes = {};
    for (let i = 0; i < 8; i += 1) notes['2026-0' + (i < 4 ? 6 : 7) + '-0' + (i + 1)] = 'x' + i;
    expect(recentWeekNotes(notes)).toHaveLength(WEEK_NOTE_LIST_LIMIT);
    expect(recentWeekNotes(notes, 2)).toHaveLength(2);
    expect(recentWeekNotes(notes, 0)).toEqual([]);
  });
});
