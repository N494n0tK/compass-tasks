'use client';

/**
 * Compass — 「今日のタスク」リストの組み立て（Phase 2B / TASK S0）
 *
 * 出典: HTML:2876-2912（`itemOf` / `todayIds` / `todayItems` / `totalMin` / `progMin` / `doneMin`）。
 * spec §5.1 / §5.2 / C-517〜C-519、C-104 / C-106（トップバーの N/M と進捗バー）。
 *
 * トップバーのカウンタと進捗バーはこの派生値だけを使う。Cockpit / ToDo / 集中モードも
 * 同じ `todayItems` を土台にするので、**画面側でも必ずこのモジュールを通すこと**
 * （式を書き直すとカウンタと本文がずれる）。
 *
 * 純ロジック（React に依存しない）だが、`lib/logic` は「レガシーのクラス外関数」だけを持つ方針なので
 * `renderVals` の内側で組み立てられていたこの派生は components 側に置いている。
 */

import type {
  AppState,
  Extra,
  ISODate,
  Plans,
  Review,
  Seg,
  SizeKey,
  SubSize,
  TaskKind,
} from '../../lib/model/types';

/** `this.SIZE_MIN`（HTML:2037）。`progMin` の重み付けに使う */
const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/** `itemOf(id)` の戻り（HTML:2877-2884）。3 種のタスクを 1 つの形に正規化したもの */
export interface TodayItem {
  kind: TaskKind;
  id: string;
  title: string;
  subj: string;
  min: number;
  size: SizeKey;
  done: boolean;
  src: string;
  /** seg のみ（`P[sg.plan].due`） */
  due?: ISODate;
  subs?: string[];
  subsDone?: boolean[];
  subSizes?: SubSize[];
  timetablePeriod: number | null;
  timetableDate: ISODate | null;
  /** seg のみ（`ref: sg`） */
  ref?: Seg;
}

/** `todayItems` の組み立てが読む state の部分形 */
export interface TodayItemsInput {
  segs: readonly Seg[];
  extras: readonly Extra[];
  reviews: readonly Review[];
  order: readonly string[];
}

/**
 * `itemOf(id)`（HTML:2876-2885）。**孤児 seg のガードは無い**（レガシーどおり。
 * `P[sg.plan]` が無いと TypeError になる = spec §4.15 末尾の「未実装の防御」を維持）。
 */
export function itemOf(
  state: TodayItemsInput,
  plans: Plans,
  today: ISODate,
  id: string
): TodayItem | null {
  const sg = state.segs.find((s) => s.id === id);
  if (sg && sg.day === today) {
    return {
      kind: 'seg',
      id: sg.id,
      title: sg.title,
      subj: plans[sg.plan].subj,
      min: sg.min,
      size: sg.size,
      done: sg.done,
      src: plans[sg.plan].name,
      due: plans[sg.plan].due,
      subs: sg.subs,
      subsDone: sg.subsDone,
      subSizes: sg.subSizes,
      timetablePeriod: plans[sg.plan].timetablePeriod,
      timetableDate: plans[sg.plan].timetableDate,
      ref: sg,
    };
  }
  const ex = state.extras.find((x) => x.id === id);
  if (ex && (!ex.day || ex.day === today)) {
    return {
      kind: 'extra',
      id: ex.id,
      title: ex.title,
      subj: ex.subj,
      min: ex.min,
      size: ex.size,
      done: ex.done,
      src: ex.src,
      subs: ex.subs,
      subsDone: ex.subsDone,
      subSizes: ex.subSizes,
      timetablePeriod: ex.timetablePeriod,
      timetableDate: ex.timetableDate,
    };
  }
  const rv = state.reviews.find((r) => r.id === id && r.added && !(r.done && r.due < today));
  if (rv) {
    return {
      kind: 'rev',
      id: rv.id,
      title: rv.title,
      subj: rv.subj,
      min: rv.min,
      size: 'S',
      done: rv.done,
      src: rv.stage + 'の復習',
      timetablePeriod: rv.timetablePeriod,
      timetableDate: rv.timetableDate,
    };
  }
  return null;
}

/**
 * `todayIds` → `todayItems`（HTML:2886-2894 / C-517・C-518）。
 *
 * 1. `state.order` をそのまま先頭に
 * 2. `segs` の `day===今日`、`extras` の `day===今日`、`reviews` の `added && !(done && due<今日)` を
 *    **この順で**、order 未収録のものだけ追記
 * 3. `kind==='seg'` を上、それ以外を下に仕切り直す
 */
export function buildTodayItems(
  state: TodayItemsInput,
  plans: Plans,
  today: ISODate
): TodayItem[] {
  const todayIds = state.order.slice();
  state.segs.forEach((s) => {
    if (s.day === today && todayIds.indexOf(s.id) < 0) todayIds.push(s.id);
  });
  // 未来日で作った単発タスクは order に入らないので、その日が来たらここで拾う
  state.extras.forEach((x) => {
    if (x.day === today && todayIds.indexOf(x.id) < 0) todayIds.push(x.id);
  });
  state.reviews.forEach((r) => {
    if (r.added && !(r.done && r.due < today) && todayIds.indexOf(r.id) < 0) todayIds.push(r.id);
  });
  const seqItems = todayIds
    .map((id) => itemOf(state, plans, today, id))
    .filter((it): it is TodayItem => !!it);
  const planItems = seqItems.filter((i) => i.kind === 'seg');
  const otherItems = seqItems.filter((i) => i.kind !== 'seg');
  return planItems.concat(otherItems);
}

/**
 * `progMin(it)`（HTML:2896-2910）。
 * 全サブタスクにサイズが付いていれば時間で重み付け、なければ個数で均等割り。
 */
export function progMin(it: TodayItem): number {
  if (it.done) return it.min;
  const n = it.subs ? it.subs.length : 0;
  if (!n) return 0;
  const subs = it.subs as string[];
  const w = subs.map((_t, i) => {
    const key = it.subSizes ? it.subSizes[i] : undefined;
    return (key && SIZE_MIN[key as SizeKey]) || 0;
  });
  if (w.every((x) => x > 0)) {
    const totalW = w.reduce((a, b) => a + b, 0);
    const doneW = w.reduce((a, b, i) => a + (it.subsDone && it.subsDone[i] ? b : 0), 0);
    return (it.min * doneW) / totalW;
  }
  const dn = it.subsDone ? it.subsDone.filter(Boolean).length : 0;
  return (it.min * dn) / n;
}

/** `totalMin` / `doneMin` / `remainMin`（HTML:2895, 2911-2912） */
export interface TodayTotals {
  totalMin: number;
  doneMin: number;
  remainMin: number;
  /** `donutPct`（HTML:4232）— 進捗バーとドーナツで共有 */
  donutPct: number;
  doneCount: number;
  totalCount: number;
}

export function todayTotals(items: readonly TodayItem[]): TodayTotals {
  const totalMin = items.reduce((a, b) => a + b.min, 0);
  const doneMin = items.reduce((a, b) => a + progMin(b), 0);
  return {
    totalMin,
    doneMin,
    remainMin: totalMin - doneMin,
    donutPct: totalMin ? Math.round((doneMin / totalMin) * 100) : 0,
    doneCount: items.filter((i) => i.done).length,
    totalCount: items.length,
  };
}

/** `AppState` から直接引くショートカット */
export function todayItemsOf(state: AppState, plans: Plans, today: ISODate): TodayItem[] {
  return buildTodayItems(state, plans, today);
}
