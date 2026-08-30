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

import type { Extra, ISODate, Mission, MissionGenLog, MissionKind, SizeKey } from '../model/types';
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
export const MISSION_SIZE_MIN: Readonly<Record<SizeKey, number>> = {
  XS: 5,
  S: 10,
  M: 20,
  L: 30,
};

/**
 * 生成 Extra の id の形。`missionId` は `newMissionId` が作る `'dm' + base36`。
 * `noteCards.NOTE_SERIES_RE` と同じく、**この正規表現だけがリンクの実体**。
 */
export const MISSION_EXTRA_RE = /^dm-(dm[0-9a-z]+)-(\d{4})(\d{2})(\d{2})$/;

/** 台帳 id。レガシー uid（HTML:2439）と同式に接頭辞を付けたもの */
export function newMissionId(): string {
  return 'dm' + Date.now().toString(36) + Math.floor(Math.random() * 999);
}

// ─────────────────────────────────────────────────────────────
// 弱点ドリル（plan.md §4.1「弱点ドリルのミッション化」）
// ─────────────────────────────────────────────────────────────

/**
 * 教科を指定しないミッションの表示名。
 *
 * `subj: ''` にしないのは、教科チップ（ToDo カード・台帳一覧）が空の色板になり、
 * 完了ぶんが学習時間の円グラフで**名前の無い一切れ**になるため。名前が入っていれば
 * 「どの教科でもない勉強を何分やったか」として素直に読める。
 */
export const MISSION_ALL_SUBJ = '全教科';

/**
 * プリセット「弱点問題を3問」。
 *
 * 弱点ドリルは *何をやるか考えるコスト* をゼロにするのが狙いなので、登録も
 * 1 タップで済ませたい（タイトルもサイズも既に埋まっている状態から始める）。
 *
 * サイズは S(10分)。想起問題 1 問ぶんの復習は 5 分（`noteCards.NOTE_REVIEW_MIN`）だが、
 * 毎日の習慣として続く量に寄せて 3 問で 10 分に丸めた ―― 見積りが大きいほど
 * 「今日は時間がないから明日」で飛ばされる。
 */
export const WEAK_MISSION_PRESET: Readonly<{
  title: string;
  size: SizeKey;
  kind: MissionKind;
}> = { title: '弱点問題を3問', size: 'S', kind: 'weak' };

/** 弱点ドリルのミッションか（ToDo カードに「弱点をやる」を出すかの判定） */
export function isWeakMission(mission: Pick<Mission, 'kind'> | null | undefined): boolean {
  return !!mission && mission.kind === 'weak';
}

/**
 * 弱点ドリルを開くときに効かせる教科の絞り込み。全教科なら `null`（絞らない）。
 * ミッションに実在の教科名が入っていれば、その教科の苦手だけを並べる。
 */
export function missionSubjFilter(mission: Pick<Mission, 'subj'>): string | null {
  const subj = (mission.subj || '').trim();
  return !subj || subj === MISSION_ALL_SUBJ ? null : subj;
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
    min: MISSION_SIZE_MIN[mission.size],
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
// 台帳の編集と「今日ぶん」の同期
// ─────────────────────────────────────────────────────────────

export interface ReconcileMissionTodayInput {
  today: ISODate;
  /** 編集・停止・削除される前の台帳。id は `next` と同じでなければならない。 */
  previous: Mission;
  /** 編集後。`null` は台帳から削除する操作。 */
  next: Mission | null;
  extras: readonly Extra[];
  genLog: MissionGenLog;
  order: readonly string[];
}

export interface ReconcileMissionTodayResult {
  extras: Extra[];
  genLog: MissionGenLog;
  order: string[];
  /** 今日ぶんを新しく積んだか。 */
  created: boolean;
  /** 今日ぶんの表示内容を更新したか。 */
  updated: boolean;
  /** 今日ぶんの未完了タスクを外したか。 */
  removed: boolean;
}

/** `genLog[today]` から 1 件だけ外す。ほかの日・ほかのミッションは触らない。 */
function forgetMissionToday(
  genLog: MissionGenLog,
  today: ISODate,
  missionId: string,
): MissionGenLog {
  const ids = genLog[today] || [];
  if (ids.indexOf(missionId) < 0) return genLog;
  const nextIds = ids.filter((id) => id !== missionId);
  const next = { ...genLog };
  if (nextIds.length) next[today] = nextIds;
  else delete next[today];
  return next;
}

/**
 * 台帳の編集・ON/OFF・削除を、今日すでに生成された `Extra` と食い違わせない。
 *
 * - 未完了の今日ぶんは、タイトル・教科・見積りをその場で更新する。
 * - OFF / 今日を実施曜日から外す / 台帳削除では、未完了の今日ぶんだけを外す。
 * - 完了済みは履歴なので消さず、内容も過去の実績として固定する。
 * - ユーザーが ToDo 側で今日ぶんを手動削除していた場合、通常の編集では復活させない。
 *   ただし OFF にした時点でログを外すため、もう一度 ON にすれば今日ぶんを作り直せる。
 *
 * React / store を知らない純関数にして、専用タブと既存の追加画面から共有する。
 */
export function reconcileMissionToday(
  input: ReconcileMissionTodayInput,
): ReconcileMissionTodayResult {
  const { today, previous, next } = input;
  const extraId = missionExtraId(previous.id, today);
  const existing = input.extras.find((extra) => extra.id === extraId) || null;
  const shouldAppear = !!next && next.active && isMissionDay(next, today);

  let extras = input.extras.slice();
  let genLog = input.genLog;
  let order = input.order.slice();
  let created = false;
  let updated = false;
  let removed = false;

  if (!shouldAppear) {
    // 完了済みは「今日やった」という実績。台帳を止めたり消したりしても残す。
    if (existing && !existing.done) {
      extras = extras.filter((extra) => extra.id !== extraId);
      order = order.filter((id) => id !== extraId);
      removed = true;
    }
    // OFF → ON、曜日を戻す、という明示操作では今日ぶんを再生成できるようにする。
    if (!existing || !existing.done) genLog = forgetMissionToday(genLog, today, previous.id);
    return { extras, genLog, order, created, updated, removed };
  }

  if (existing) {
    // 完了前だけ台帳の最新内容へ追従。完了後は履歴を後から書き換えない。
    if (!existing.done && next) {
      const fresh = buildMissionExtra(next, today);
      extras = extras.map((extra) =>
        extra.id === extraId
          ? {
              ...extra,
              title: fresh.title,
              subj: fresh.subj,
              size: fresh.size,
              min: fresh.min,
              src: fresh.src,
            }
          : extra,
      );
      updated = true;
    }
    return { extras, genLog, order, created, updated, removed };
  }

  const logged = (genLog[today] || []).indexOf(previous.id) >= 0;
  if (!logged && next) {
    const fresh = buildMissionExtra(next, today);
    extras = extras.concat([fresh]);
    order = order.indexOf(fresh.id) >= 0 ? order : order.concat([fresh.id]);
    genLog = {
      ...genLog,
      [today]: (genLog[today] || []).concat([previous.id]),
    };
    created = true;
  }

  return { extras, genLog, order, created, updated, removed };
}

// ─────────────────────────────────────────────────────────────
// 連続日数（保存しない。完了済みの生成 Extra から毎回導出する）
// ─────────────────────────────────────────────────────────────

/**
 * missionId → その日ぶんを完了した日の集合。
 *
 * 連続日数も達成率もカレンダー（`missionStats.ts`）も、結局この 1 本の索引だけを見る。
 * extras の全走査になるので、複数のミッションを並べる画面では**1 回作って使い回す**こと。
 */
export function missionDoneDays(extras: readonly Extra[]): Map<string, Set<ISODate>> {
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
 *
 * `doneDays` は `missionDoneDays(extras).get(mission.id)`。索引を作る側と分けてあるので、
 * 一覧画面は索引 1 個で全ミッションぶんを引ける。
 */
export function missionStreakFrom(
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
  return missionStreakFrom(mission, missionDoneDays(extras).get(mission.id), today);
}

/** missionId → 連続日数。一覧で 1 件ずつ引くと extras を何度も走査するのでまとめて作る */
export function missionStreaks(
  missions: readonly Mission[],
  extras: readonly Extra[],
  today: ISODate
): Record<string, number> {
  const doneDays = missionDoneDays(extras);
  const out: Record<string, number> = {};
  missions.forEach((m) => {
    out[m.id] = missionStreakFrom(m, doneDays.get(m.id), today);
  });
  return out;
}
