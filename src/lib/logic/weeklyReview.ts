/**
 * Compass — 週次ふりかえり（docs/daily-mission/plan.md §4.3「週次ふりかえり」）
 *
 * 月曜に開いたら、**先週 1 週間を 1 枚にまとめて見せて、まとめを書く欄を添える**。
 * コーネル式の `summary` が「AI ではなく本人が書く欄」であること（docs/notebook/spec.md §3.6）を、
 * ノート 1 枚ぶんから週 1 週ぶんへ広げたもの ―― 数字を眺めるのが目的ではなく、
 * **数字を手がかりに自分の言葉で言い直すこと**が目的の画面なので、
 * 4 つの数字はあくまで書くための材料として並べる。
 *
 * ## 保存するのは文章だけ
 *
 * 復習完了率も学習時間もミッションも集中実測も、既存のキーからその場で導ける。
 * 導けるものを保存すると「あとから台帳や記録を直したのに、ふりかえりの数字だけ昔のまま」
 * という食い違いが生まれる（`missionStats.ts` が達成率を保存しないのと同じ判断）。
 * 保存するのは `state.weekNotes`（その週の月曜 → 書いた文）だけ。
 *
 * ## 数え方は既存の集計から借りる
 *
 * 4 つの数字はどれも**データ画面や Cockpit に既に出ている数字の「先週版」**で、
 * 数え方が 1 か所でもズレると「先週は 70% だったのに、今週の画面では 60% に見える」が起きる。
 * だから式を書き写さず、既存の関数をそのまま先週の範囲で呼ぶ:
 *
 * | 数字 | 借りる先 | 揃えているもの |
 * |---|---|---|
 * | 復習完了率 | `aggregate.computeWeekRate` | 母数＝その週が対象の復習の全件 / 分子＝`done` |
 * | 学習時間 | `aggregate.buildStudyEntries` | 完了復習の二重計上を除く集計元そのもの |
 * | ミッション | `missionStats.buildMissionStats` | `done` / `missed` のマスの決め方 |
 * | 集中実測 | `focusLog.focusTotals` と同じ週枠 | 月曜〜日曜の 7 日・壊れた分数の防御 |
 *
 * 純ロジック。React / firebase を import しない。
 */

import type {
  Extra,
  FocusLogEntry,
  ISODate,
  Mission,
  Plans,
  Review,
  WeekNotes,
} from '../model/types';
import { buildStudyEntries, computeWeekRate, toH, type StudyEntriesInput } from './aggregate';
import { fmtMD, isInWeek, isoShift, mondayOf } from './dates';
import { buildMissionStats } from './missionStats';

/** 対象なしの表示（`computeWeekRate` の `label` と同じ U+2013） */
export const WEEKLY_DASH = '–';

// ─────────────────────────────────────────────────────────────
// 週の範囲
// ─────────────────────────────────────────────────────────────

/** 週ラベル `'8/10-8/16'`（引数はその週の**月曜**） */
export function weekLabelOf(monday: ISODate): string {
  return fmtMD(monday) + '-' + fmtMD(isoShift(monday, 6));
}

export interface WeekRange {
  /** 月曜。`weekNotes` のキーでもある */
  start: ISODate;
  /** 日曜（= 月曜 + 6） */
  end: ISODate;
  /** `'8/10-8/16'` */
  label: string;
}

/**
 * 先週（月曜〜日曜）。
 *
 * `mondayOf` は冪等なので「今週の月曜を 7 日戻す」で足りる（日付演算は UTC 固定なので
 * 年跨ぎ・月跨ぎでもズレない）。**今日が月曜なら「昨日までの 7 日間」**になる ――
 * これがこのカードを月曜に出す理由でもある（週がちょうど閉じた直後だけ、
 * 数字が動かない完成した 1 週間を見せられる）。
 */
export function lastWeekOf(today: ISODate): WeekRange {
  const start = isoShift(mondayOf(today), -7);
  return { start, end: isoShift(start, 6), label: weekLabelOf(start) };
}

// ─────────────────────────────────────────────────────────────
// 集計
// ─────────────────────────────────────────────────────────────

/** `buildWeeklyReport` が読む state の部分形 */
export interface WeeklyReviewInput extends StudyEntriesInput {
  reviews: readonly Review[];
  missions: readonly Mission[];
  extras: readonly Extra[];
  focusLog: readonly FocusLogEntry[];
}

/** カードに 1 枚ずつ並べる数字（表示文字列まで作る） */
export interface WeeklyStat {
  key: 'review' | 'study' | 'mission' | 'focus';
  /** タイルの見出し */
  title: string;
  /** 大きく出す値。対象が無ければ `WEEKLY_DASH` */
  value: string;
  /** 値のすぐ後ろに小さく添える単位。`WEEKLY_DASH` のときは `''` */
  unit: string;
  /** 値の下の内訳・出どころ */
  note: string;
}

export interface WeeklyReport {
  /** 先週の月曜（`weekNotes` のキー） */
  start: ISODate;
  /** 先週の日曜 */
  end: ISODate;
  /** `'8/10-8/16'` */
  rangeLabel: string;
  /** 復習完了率（0-100）。対象 0 件なら `null` */
  reviewRate: number | null;
  /** 復習の完了件数 / 対象件数 */
  reviewDone: number;
  reviewTotal: number;
  /** 学習時間（分）。完了タスクの見積りの合計 */
  studyMinutes: number;
  /** ミッションの実施対象日数と完了日数（全ミッション合算）。対象が 0 日なら `null` */
  mission: { done: number; total: number } | null;
  /** 集中モードの実測（分） */
  focusMinutes: number;
  /** タイル 4 枚（この順に出す） */
  stats: WeeklyStat[];
  /** 畳んだときの 1 行 `'復習 67% · 学習 2.5h · ミッション 8/10日 · 集中 150分'` */
  compactLabel: string;
  /**
   * 先週に何かしらの記録があるか。**1 つも無ければカードを出さない**判断に使う
   * （使い始めた最初の月曜に、全部 `–` のカードが出るのを避ける。
   * 数字が全部空の週は、ふりかえる材料そのものが無い）。
   */
  hasRecord: boolean;
}

/** タイルの見出し */
const STAT_TITLE = {
  review: '復習完了率',
  study: '学習時間',
  mission: 'ミッション',
  focus: '集中実測',
} as const;

/** 畳んだ 1 行に使う短い名前（タイルの見出しは説明的でよいが、1 行に 4 つ並ぶと長い） */
const STAT_SHORT = {
  review: '復習',
  study: '学習',
  mission: 'ミッション',
  focus: '集中',
} as const;

/**
 * 先週 1 週間の集計。
 *
 * @param input `state` のうち集計に使うキーだけ
 * @param plans `store.getPlans()`（`buildStudyEntries` が seg → 教科を引くのに要る）
 * @param today 「今日」。ここから先週を割り出す
 */
export function buildWeeklyReport(
  input: WeeklyReviewInput,
  plans: Plans,
  today: ISODate
): WeeklyReport {
  const week = lastWeekOf(today);

  // ── 復習完了率。**`computeWeekRate` をそのまま先週の日曜で呼ぶ**。
  //    あの関数の枠は「その週の月曜 〜 引数の日」で、引数に先週の日曜を渡せば
  //    枠は先週の月曜〜日曜になる。「今日より後は母数に入れない」という気づかいは
  //    先週にはそもそも効かない（先週の 7 日はすべて過ぎている）ので、
  //    “その週が対象の復習のうち完了した割合” という意味はそのまま保たれる。
  const rate = computeWeekRate(input.reviews, week.end);

  // ── 学習時間。集計元は円グラフ・CSV と同じ `buildStudyEntries`。
  //    完了した復習を足さない（`confirmAsk` が同じ分数を `studyLog` に書くので二重になる）
  //    という規則はこの関数の中にあるので、ここで再実装しないことがそのまま踏襲になる。
  //    日付を持たないエントリはデータ画面の「今週」と同じく数えない。
  const studyMinutes = buildStudyEntries(input, plans).reduce(
    (sum, e) => (e.day && isInWeek(e.day, week.start) ? sum + (Number(e.min) || 0) : sum),
    0
  );

  // ── ミッション。**先週の 7 マスを `missionStats` のカレンダーから読む**。
  //    2 週ぶんを頼むと `weeks[0]` が先週・`weeks[1]` が今週になる（`buildMissionCalendar` は
  //    最後の行が必ず今週）。マスの状態（done / missed / off / before / future）の決め方も
  //    「実施対象日 = done + missed」という母数の取り方も、データ画面の達成率と同じものを使う。
  //    行に付いてくる `rate` / `streak` は “いま” の話なのでここでは読まない。
  //    索引（extras の走査）は `buildMissionStats` が 1 回だけ作って全ミッションで使い回す。
  let missionDone = 0;
  let missionTotal = 0;
  buildMissionStats(input.missions, input.extras, today, 2).forEach((row) => {
    row.calendar.weeks[0].forEach((cell) => {
      if (cell.state === 'done') {
        missionDone += 1;
        missionTotal += 1;
      } else if (cell.state === 'missed') {
        // 「今日の未達は母数に入れない」は先週には出番がない（先週に今日は含まれない）
        missionTotal += 1;
      }
    });
  });
  // 台帳が空／先週はまだミッションを作っていない／全部が実施曜日の外 → いずれも「対象 0 日」。
  // 0/0 を 0% と出すと「先週は 1 日もやらなかった」に見えてしまうので `null` にする
  const mission = missionTotal ? { done: missionDone, total: missionTotal } : null;

  // ── 集中実測。`focusTotals` の「今週」と同じ月曜〜日曜の枠を、先週の月曜で取る。
  //    `min` は保存データを信用せず `Number(...) || 0` で防御する（`focusTotals` と同じ流儀）
  const focusMinutes = input.focusLog.reduce(
    (sum, e) => (e.day && isInWeek(e.day, week.start) ? sum + (Number(e.min) || 0) : sum),
    0
  );

  // `toH` は `'2.5h'` を返す。単位だけ小さく組みたいので末尾の 'h' を外す。
  // 式（`Math.round(m/6)/10`）を書き写すとデータ画面と食い違う余地ができるので、必ず `toH` から作る
  const studyValue = toH(studyMinutes).slice(0, -1);

  const stats: WeeklyStat[] = [
    {
      key: 'review',
      title: STAT_TITLE.review,
      value: rate.rate == null ? WEEKLY_DASH : String(rate.rate),
      unit: rate.rate == null ? '' : '%',
      note: rate.total ? rate.done + '/' + rate.total + '件' : '対象なし',
    },
    {
      key: 'study',
      title: STAT_TITLE.study,
      value: studyValue,
      unit: 'h',
      // 実測（下のタイル）と並ぶので、これが見積りであることを毎回言っておく
      note: studyMinutes ? '完了ぶんの見積り' : '記録なし',
    },
    {
      key: 'mission',
      title: STAT_TITLE.mission,
      value: mission ? mission.done + '/' + mission.total : WEEKLY_DASH,
      unit: mission ? '日' : '',
      note: mission ? '実施できた日' : '対象なし',
    },
    {
      key: 'focus',
      title: STAT_TITLE.focus,
      value: String(focusMinutes),
      unit: '分',
      note: focusMinutes ? 'タイマーの実測' : '記録なし',
    },
  ];

  return {
    start: week.start,
    end: week.end,
    rangeLabel: week.label,
    reviewRate: rate.rate,
    reviewDone: rate.done,
    reviewTotal: rate.total,
    studyMinutes,
    mission,
    focusMinutes,
    stats,
    compactLabel: stats.map((s) => STAT_SHORT[s.key] + ' ' + s.value + s.unit).join(' · '),
    hasRecord: rate.total > 0 || studyMinutes > 0 || mission != null || focusMinutes > 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 書いた文章の出し入れ
// ─────────────────────────────────────────────────────────────

/**
 * 書いた文を 1 週ぶん差し替えた `weekNotes` を返す（元は変更しない）。
 *
 * **空文字ならキーごと消す**。毎回フル置換で保存する構成なので、開いただけの週の
 * 空エントリが溜まっていくのを避ける。`'   '`（空白だけ）は消さない ――
 * 入力中の「まだ 1 文字も打っていないが空白は打った」状態でユーザーの打鍵を
 * 奪わないため（読み手としての「書いてある/書いていない」判定は `hasWeekNote`）。
 */
export function setWeekNote(
  weekNotes: Readonly<WeekNotes>,
  monday: ISODate,
  text: string
): WeekNotes {
  const next: WeekNotes = { ...weekNotes };
  if (text === '') delete next[monday];
  else next[monday] = text;
  return next;
}

/** その週ぶんが「書いてある」か（空白だけは書いていない扱い） */
export function hasWeekNote(weekNotes: Readonly<WeekNotes>, monday: ISODate): boolean {
  return (weekNotes[monday] || '').trim() !== '';
}

/** データ画面に出す「ふりかえりの記録」の 1 行 */
export interface WeekNoteEntry {
  /** その週の月曜 */
  start: ISODate;
  /** `'8/10-8/16'` */
  label: string;
  text: string;
}

/**
 * 出す週数。データ画面のミッション継続カレンダー（`MISSION_CALENDAR_WEEKS`）と同じ 4 週。
 * 同じ画面に「直近4週」の枠が 2 つ並ぶので、期間を揃えて読み比べられるようにする。
 */
export const WEEK_NOTE_LIST_LIMIT = 4;

/**
 * 書いたふりかえりを**新しい週が先**で返す。空（空白だけを含む）の週は出さない。
 * ISO 日付は文字列比較で時系列に並ぶので、キーをそのまま降順に並べれば足りる。
 */
export function recentWeekNotes(
  weekNotes: Readonly<WeekNotes>,
  limit: number = WEEK_NOTE_LIST_LIMIT
): WeekNoteEntry[] {
  return Object.keys(weekNotes)
    .filter((monday) => (weekNotes[monday] || '').trim() !== '')
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, Math.max(0, limit))
    .map((monday) => ({ start: monday, label: weekLabelOf(monday), text: weekNotes[monday] }));
}
