/**
 * Compass — 予習タスクの自動生成（時間割 → 翌登校日ぶんの予習）
 *
 * 仕様: docs/notebook/spec.md §5、受け入れ N-041〜N-053。
 *
 * レガシーには「時間割のコマをクリックして手動で1件足す」経路しかなかった（HTML:3593 の
 * `pickScheduleSlot`）。ここでは同じ `TIMETABLE` / `dayOverrides` を入力に、
 * **翌登校日の授業ぶんの予習を起動時に自動で積む**。
 *
 * 重複防止は `prepGenLog`（対象日 → 生成済みのコマ）で行う。extras との突き合わせにしないのは、
 * ユーザーが消したタスクを次の起動で復活させないため（N-049）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type {
  DayOverrides,
  Dow,
  Extra,
  ISODate,
  PrepAutoGenSettings,
  PrepGenLog,
} from '../model/types';
import { dowOf, fmtMD, isoShift } from './dates';
import { EMPTY_SLOTS, TIMETABLE } from './timetable';

/** `prepGenLog` を保持する日数。これより古い対象日のキーは捨てる（N-051） */
export const PREP_LOG_KEEP_DAYS = 14;

/** 予習 1 件の既定サイズ（S = 10 分） */
export const PREP_TASK_MIN = 10;

/** `state.prepAutoGen` の既定値（`createInitialState` が使う） */
export const DEFAULT_PREP_AUTOGEN: PrepAutoGenSettings = { enabled: true, offSubjects: [] };

type Timetable = Readonly<Partial<Record<Dow, readonly (string | null)[]>>>;

export interface PrepPlanInput {
  today: ISODate;
  dayOverrides: DayOverrides;
  settings: PrepAutoGenSettings;
  genLog: PrepGenLog;
  /** 既定は `logic/timetable.ts` の `TIMETABLE`（テストで差し替える） */
  timetable?: Timetable;
  /** id 生成。既定はレガシー uid と同式（HTML:2439） */
  newId?: (index: number) => string;
}

export interface PrepPlanResult {
  /** 追加する予習タスク（0 件のこともある） */
  extras: Extra[];
  /** 差し替える `prepGenLog`（prune 済み） */
  genLog: PrepGenLog;
  /** 予習の対象になった授業日 */
  targetDate: ISODate;
  /** トースト文言。0 件なら `null` */
  message: string | null;
}

function defaultNewId(): string {
  return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 999);
}

/** 土日か（`dates.isWeekend` と同判定だが Dow を直接見る） */
function isSchoolDow(dow: Dow): boolean {
  return dow !== '土' && dow !== '日';
}

/**
 * 次の登校日（`today` より後で最も近い月〜金）。金→月 / 土→月 / 日→月（N-041〜N-043）。
 * 週の途中は素直に翌日。
 */
export function nextSchoolDay(today: ISODate): ISODate {
  for (let n = 1; n <= 7; n += 1) {
    const iso = isoShift(today, n);
    if (isSchoolDow(dowOf(iso))) return iso;
  }
  // 到達しない（7 日あれば必ず平日がある）
  return isoShift(today, 1);
}

/** 14 日より古い対象日のキーを落とす（N-051） */
export function prunePrepGenLog(genLog: PrepGenLog, today: ISODate): PrepGenLog {
  const floor = isoShift(today, -PREP_LOG_KEEP_DAYS);
  const out: PrepGenLog = {};
  let dropped = false;
  Object.keys(genLog).forEach((iso) => {
    if (iso >= floor) out[iso] = genLog[iso];
    else dropped = true;
  });
  return dropped ? out : genLog;
}

/**
 * 翌登校日の時間割から予習タスクを組み立てる。
 *
 * 規則（spec §5）:
 *  1. `enabled:false` なら何もしない
 *  2. `dayOverrides[target][period].held === false` のコマは休講なので飛ばす
 *  3. `dayOverrides[target][period].subj` があればその教科で読み替える
 *  4. `offSubjects` の教科は飛ばす
 *  5. `genLog[target]` に載っているコマは生成済みなので飛ばす
 *  6. **同じ教科は 1 日 1 件**（最初のコマを `timetablePeriod` にする）
 */
export function generatePrepTasks(input: PrepPlanInput): PrepPlanResult {
  const { today, dayOverrides, settings, genLog } = input;
  const timetable = input.timetable || TIMETABLE;
  const newId = input.newId || defaultNewId;
  const targetDate = nextSchoolDay(today);

  if (!settings.enabled) {
    return { extras: [], genLog, targetDate, message: null };
  }

  const slots = timetable[dowOf(targetDate)] || EMPTY_SLOTS;
  const overrides = dayOverrides[targetDate] || {};
  const doneP = genLog[targetDate] || [];
  const off = new Set(settings.offSubjects);

  /** 教科 → 最初のコマ番号（1 始まり） */
  const picked = new Map<string, number>();
  /** 生成対象として消費したコマ（教科がまとめられた 2 コマ目も含める） */
  const consumed: number[] = [];

  slots.forEach((slotSubj, i) => {
    const period = i + 1;
    const ov = overrides[String(period)];
    if (ov && ov.held === false) return;
    const overrideSubj = ov && typeof ov.subj === 'string' ? ov.subj.trim() : '';
    const subj = overrideSubj || (slotSubj || '').trim();
    if (!subj) return;
    if (off.has(subj)) return;
    if (doneP.indexOf(period) >= 0) return;
    if (!picked.has(subj)) picked.set(subj, period);
    consumed.push(period);
  });

  const pruned = prunePrepGenLog(genLog, today);
  if (!picked.size) {
    return { extras: [], genLog: pruned, targetDate, message: null };
  }

  const extras: Extra[] = [];
  let n = 0;
  picked.forEach((period, subj) => {
    extras.push({
      id: newId(n),
      title: subj + 'の予習',
      subj,
      size: 'S',
      min: PREP_TASK_MIN,
      day: today,
      done: false,
      src: '予習 · ' + fmtMD(targetDate) + ' ' + period + '限(自動)',
      timetablePeriod: period,
      timetableDate: targetDate,
    });
    n += 1;
  });

  const nextLog: PrepGenLog = { ...pruned };
  nextLog[targetDate] = doneP.concat(consumed.filter((p) => doneP.indexOf(p) < 0)).sort((a, b) => a - b);

  return {
    extras,
    genLog: nextLog,
    targetDate,
    message: extras.length + '件の予習タスクを追加しました(対象: ' + fmtMD(targetDate) + ')',
  };
}
