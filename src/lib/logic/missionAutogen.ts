/**
 * Compass — デイリーミッションの自動生成（台帳 → 今日ぶんの Extra）
 *
 * 仕様: docs/daily-mission/plan.md §3（案 B）。
 *
 * 「毎日やること」を専用のタスク種別にはしない。台帳（`state.missions`）だけを持ち、
 * 今日ぶんの実体は **ただの `Extra`** として起動時に積む。こうすると ToDo 表示・完了トグル・
 * 集中モード・学習時間の集計（完了 Extra は `buildStudyEntries` が拾う）が無改修で動く。
 *
 * 重複防止は `missionGenLog`（日付 → その日ぶんを生成済みの missionId）で行う。extras との
 * 突き合わせにしないのは、ユーザーが今日のミッションを消したときに次の起動で復活させないため
 * （`prepAutogen.ts` と同じ設計判断）。
 *
 * ミッションと生成 Extra のリンクは外部キーではなく **id の文字列規約**
 * （`dm-{missionId}-{YYYYMMDD}`）で持つ。`Extra` にフィールドを足さずに済み、
 * 完了履歴だけからでも連続日数を引き直せる（`noteCards.ts` の `nb-…` と同じ流儀）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Extra, ISODate, Mission, MissionGenLog, SizeKey } from '../model/types';
import { DOW, dowOf, isoShift } from './dates';

/** `missionGenLog` を保持する日数。これより古い日付のキーは捨てる（`prepGenLog` と同じ） */
export const MISSION_LOG_KEEP_DAYS = 14;

/** 生成した Extra の出典。ToDo カードの説明行にそのまま出る */
export const MISSION_SRC = 'デイリーミッション';

/** ストリークのループ上限（`aggregate.STREAK_MAX_DAYS` と同じ無限ループ防止） */
export const MISSION_STREAK_MAX_DAYS = 3650;

/**
 * `this.SIZE_MIN`（HTML:2037）。`lib/logic` では非公開のローカルコピーになっているので
 * ここでも同値を置く（`ShellTodayItems.ts` / `AddTask.tsx` と同じ扱い）。
 */
const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/**
 * 生成 Extra の id の形。`missionId` は `newMissionId` が作る `'dm' + base36`。
 * `noteCards.NOTE_SERIES_RE` と同じく、**この正規表現だけがリンクの実体**。
 */
export const MISSION_EXTRA_RE = /^dm-(dm[0-9a-z]+)-(\d{4})(\d{2})(\d{2})$/;

/** 台帳 id。レガシー uid（HTML:2439）と同式に接頭辞を付けたもの */
export function newMissionId(): string {
  return 'dm' + Date.now().toString(36) + Math.floor(Math.random() * 999);
}

/** ミッション + 日付 → 生成 Extra の id */
export function missionExtraId(missionId: string, day: ISODate): string {
  return 'dm-' + missionId + '-' + day.slice(0, 4) + day.slice(5, 7) + day.slice(8, 10);
}

export interface MissionRef {
  missionId: string;
  /** その Extra が担当している日 */
  day: ISODate;
}

/** 生成 Extra の id → ミッションと日付。ミッション由来でなければ `null`（単発の `'u…'` など） */
export function missionRefOf(extraId: string | null | undefined): MissionRef | null {
  if (typeof extraId !== 'string') return null;
  const m = MISSION_EXTRA_RE.exec(extraId);
  return m ? { missionId: m[1], day: m[2] + '-' + m[3] + '-' + m[4] } : null;
}

/**
 * その日がミッションの実施日か。`dows` が空なら毎日。
 * 曜日番号は `dates.DOW`（0=日 … 6=土）に合わせる。
 */
export function isMissionDay(mission: Pick<Mission, 'dows'>, iso: ISODate): boolean {
  const dows = mission.dows;
  if (!dows || !dows.length) return true;
  return dows.indexOf(DOW.indexOf(dowOf(iso))) >= 0;
}

/** 今日ぶんの実体。`day` が今日なので `buildTodayItems` がそのまま今日の一覧へ載せる */
export function buildMissionExtra(mission: Mission, day: ISODate): Extra {
  return {
    id: missionExtraId(mission.id, day),
    title: mission.title,
    subj: mission.subj,
    size: mission.size,
    min: SIZE_MIN[mission.size],
    day,
    done: false,
    src: MISSION_SRC,
    timetablePeriod: null,
    timetableDate: null,
  };
}

/** 14 日より古い日付のキーを落とす（`prunePrepGenLog` と同型。変化が無ければ同じ参照） */
export function pruneMissionGenLog(genLog: MissionGenLog, today: ISODate): MissionGenLog {
  const floor = isoShift(today, -MISSION_LOG_KEEP_DAYS);
  const out: MissionGenLog = {};
  let dropped = false;
  Object.keys(genLog).forEach((iso) => {
    if (iso >= floor) out[iso] = genLog[iso];
    else dropped = true;
  });
  return dropped ? out : genLog;
}

export interface MissionPlanInput {
  today: ISODate;
  missions: readonly Mission[];
  genLog: MissionGenLog;
}

export interface MissionPlanResult {
  /** 追加するミッションタスク（0 件のこともある） */
  extras: Extra[];
  /** 差し替える `missionGenLog`（prune 済み） */
  genLog: MissionGenLog;
  /** トースト文言。0 件なら `null` */
  message: string | null;
}

/**
 * 今日ぶんのミッションタスクを組み立てる。
 *
 * 規則（plan.md §3.3）:
 *  1. `active:false` のミッションは飛ばす（台帳からは消さない一時停止）
 *  2. 今日が `dows` に無ければ飛ばす（`dows` 空 = 毎日）
 *  3. `genLog[today]` に載っているミッションは生成済みなので飛ばす
 *     （**extras は見ない** = 消したミッションは復活しない）
 *
 * やり残しは持ち越さない。昨日ぶんの Extra は `day` が昨日のまま今日の一覧から外れる
 * （復習と違って積み上がらないのが習慣タスクには正しい）。
 */
export function generateMissionTasks(input: MissionPlanInput): MissionPlanResult {
  const { today, missions, genLog } = input;
  const doneIds = genLog[today] || [];
  const pending = missions.filter(
    (m) => m.active && isMissionDay(m, today) && doneIds.indexOf(m.id) < 0
  );

  const pruned = pruneMissionGenLog(genLog, today);
  if (!pending.length) {
    return { extras: [], genLog: pruned, message: null };
  }

  const nextLog: MissionGenLog = { ...pruned };
  nextLog[today] = doneIds.concat(pending.map((m) => m.id));

  const extras = pending.map((m) => buildMissionExtra(m, today));
  return {
    extras,
    genLog: nextLog,
    message: extras.length + '件のデイリーミッションを追加しました',
  };
}

// ─────────────────────────────────────────────────────────────
// 連続日数（保存しない。完了済みの生成 Extra から毎回導出する）
// ─────────────────────────────────────────────────────────────

/** missionId → その日ぶんを完了した日の集合 */
function doneDaysByMission(extras: readonly Extra[]): Map<string, Set<ISODate>> {
  const out = new Map<string, Set<ISODate>>();
  extras.forEach((x) => {
    if (!x.done) return;
    const ref = missionRefOf(x.id);
    if (!ref) return;
    const set = out.get(ref.missionId);
    if (set) set.add(ref.day);
    else out.set(ref.missionId, new Set([ref.day]));
  });
  return out;
}

/**
 * 今日から遡った連続実施日数。
 *
 * - **今日ぶんが未完了でも昨日まで続いていれば途切れない**（`aggregate.computeStreak` が
 *   起点を「今日 or 昨日」にしているのと同じ扱い）。
 * - `dows` で実施日を絞っているミッションは**非実施日を飛ばして**連続とみなす
 *   （月水金のミッションは火木土日を挟んでも連続）。
 * - 実施日でなくてもやってあれば数える（曜日をあとから変えた場合に記録が消えないように）。
 */
function streakFrom(
  mission: Pick<Mission, 'dows'>,
  doneDays: Set<ISODate> | undefined,
  today: ISODate
): number {
  if (!doneDays || !doneDays.size) return 0;
  let days = 0;
  // 今日ぶんがまだなら昨日から数え始める（今日の未完了では途切れさせない）
  let cursor = doneDays.has(today) ? today : isoShift(today, -1);
  for (let i = 0; i < MISSION_STREAK_MAX_DAYS; i += 1) {
    if (doneDays.has(cursor)) days += 1;
    else if (isMissionDay(mission, cursor)) break;
    cursor = isoShift(cursor, -1);
  }
  return days;
}

/** 1 つのミッションの連続日数 */
export function missionStreak(
  mission: Pick<Mission, 'id' | 'dows'>,
  extras: readonly Extra[],
  today: ISODate
): number {
  return streakFrom(mission, doneDaysByMission(extras).get(mission.id), today);
}

/** missionId → 連続日数。一覧で 1 件ずつ引くと extras を何度も走査するのでまとめて作る */
export function missionStreaks(
  missions: readonly Mission[],
  extras: readonly Extra[],
  today: ISODate
): Record<string, number> {
  const doneDays = doneDaysByMission(extras);
  const out: Record<string, number> = {};
  missions.forEach((m) => {
    out[m.id] = streakFrom(m, doneDays.get(m.id), today);
  });
  return out;
}
