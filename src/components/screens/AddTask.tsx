'use client';

/**
 * Compass — タスク追加画面（Phase 2B / TASK S6）
 *
 * 移植元:
 *  - テンプレート HTML:1334-1502（`<sc-if value="{{ isAdd }}">` の中身）
 *  - `renderVals` HTML:3534-3749（`// ── add screen` ブロック）
 *  - 値の受け渡し HTML:4369-4422
 *
 * spec §5.2 / §7.3 / §4.9 / C-344〜C-386、css-notes §6（`.fc-acc*` / `.hv-pink-text`）・§7。
 *
 * 配置・日付・教科色の計算式は `lib/logic/*` に置いてあるものを必ず経由する
 * （`computeInitialPlacement` / `resolvePlanStart` / `scheduleDateOf` / `mondayOf` / `dayLabel`）。
 *
 * v0.9 の該当分:
 *  - **A1**: `submitAdd` の `addDay === T` 判定と `addToOrder` はレガシーのまま。未来日の extra を
 *    今日に自動収集するのは `ShellTodayItems.buildTodayItems` 側の責務（spec §5.1）。
 *  - **A4**: `dayOverrides` の読み書きキーを `addScheduleDate` に統一（HTML:3563-3574 / spec §4.9）。
 */

import { useMemo, type CSSProperties } from 'react';
import { dayLabel, dowOf, fmtMD, isoShift, mondayOf, scheduleDateOf } from '../../lib/logic/dates';
import { computeInitialPlacement, resolvePlanStart, type MiniDraft } from '../../lib/logic/schedule';
import { orderedSubjectNames, subjectColorFor, type SubjColor } from '../../lib/logic/subjects';
// `TIMETABLE` / `EMPTY_SLOTS` は予習の自動生成（logic/prepAutogen）と共有するため
// lib/logic/timetable.ts へ移した。値はレガシーのまま（HTML:2044-2049）
import { EMPTY_SLOTS, TIMETABLE } from '../../lib/logic/timetable';
import type {
  AddDone,
  AddType,
  AppState,
  DayOverride,
  Dow,
  Extra,
  Plan,
  Plans,
  Review,
  Seg,
  SizeKey,
  SlotOverride,
} from '../../lib/model/types';
import { addToOrder } from '../parts/ShellActions';
import { useSubjColors } from '../parts/ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

// ─────────────────────────────────────────────────────────────
// 定数（レガシー constructor 由来）
// ─────────────────────────────────────────────────────────────

/**
 * `this.SIZE_MIN`（HTML:2037）。`lib/logic` では非公開のローカルコピーになっているので
 * ここでも同値をローカル定義する（`ShellTodayItems.ts` と同じ扱い）。
 */
const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

const SIZE_KEYS: readonly SizeKey[] = ['XS', 'S', 'M', 'L'];

/** `addTypes`（HTML:3535） */
const ADD_TYPES: readonly { id: AddType; label: string }[] = [
  { id: 'single', label: '今日のタスク' },
  { id: 'review', label: '復習' },
  { id: 'prep', label: '予習' },
  { id: 'test', label: 'テスト' },
];

/** `dayHeads`（HTML:3536） */
const DAY_HEADS: Readonly<Record<AddType, string>> = {
  single: '予定日',
  review: '復習日',
  prep: '期限日',
  test: 'テスト日',
};

/** `day2Heads`（HTML:3537）。single / review は `''`（`|| ''`, HTML:4380） */
const DAY2_HEADS: Readonly<Partial<Record<AddType, string>>> = {
  prep: '開始予定日',
  test: '計画開始日',
};

/** `addGeneratorChips` の元データ（HTML:3656-3659） */
const GENERATOR_MODES: readonly { id: AppState['addGenerator']; label: string }[] = [
  { id: 'manual', label: '1件ずつ' },
  { id: 'duo', label: 'DUO 範囲分割' },
  { id: 'chart', label: '青チャート用' },
];

/** 週ストリップの曜日ラベル（HTML:3625） */
const WEEK_DAY_LABELS: readonly string[] = ['月', '火', '水', '木', '金'];

/** 未登録教科のフォールバック色（HTML:3601 の `{ c:'var(--tx3)', bg:'var(--bg3)' }`） */
const EMPTY_SLOT_COLOR: SubjColor = { c: 'var(--tx3)', bg: 'var(--bg3)' };

// ── トースト文言（HTML:3590 / 3680 / 3684 / 3688 / 3692 / 3694）
const TOAST_DUO_INVALID = 'DUOの開始・終了・区切り数を正しく入力してください';
const TOAST_CHART_INVALID = 'プリントの開始番号と終了番号を正しく入力してください';
const TOAST_GENERATE_LIMIT = '一度に生成できるのは500件までです';
const TOAST_GENERATE_DUP = '同じ名前のミニタスクはすでに追加済みです';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/** `focusEl(id)`（HTML:2608）。`setTimeout 0` → `focus()` → あれば `select()` */
function focusEl(id: string): void {
  setTimeout(() => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  }, 0);
}

/** `intValue`（HTML:3670） */
const intValue = (value: string): number => Math.floor(Number(value));

interface Chip {
  label: string;
  c: string;
  bg: string;
  bd: string;
  onPick: () => void;
}

/** `sizeChip(cur, onPick)`（HTML:3636-3642） */
function sizeChip(cur: SizeKey, onPick: (z: SizeKey) => void): (z: SizeKey) => Chip {
  return (z) => ({
    label: z + '·' + SIZE_MIN[z] + '分',
    c: cur === z ? 'var(--onAcc)' : 'var(--tx2)',
    bg: cur === z ? 'var(--acc)' : 'var(--bg2)',
    bd: cur === z ? 'var(--acc)' : 'var(--line2)',
    onPick: () => onPick(z),
  });
}

// ─────────────────────────────────────────────────────────────
// 画面
// ─────────────────────────────────────────────────────────────

export function AddTask() {
  const { state, plans } = useAppStore();
  const subjColors = useSubjColors(state, plans);
  const S = state;
  const P = plans;
  const T = dateCtx.today;
  const TOMORROW = dateCtx.tomorrow;
  const light = S.theme === 'light';

  // ── 教科候補（HTML:3538-3548）。並びは lib/logic/subjects.ts に一本化（TASK I0）
  const subjNames = useMemo(() => Object.keys(subjColors), [subjColors]);
  const subjOrdered = orderedSubjectNames(subjNames, S.recentSubjs);
  const addSubjOptions = subjOrdered;
  const addSubjChips = subjOrdered.slice(0, 8).map((name) => {
    const sub = subjectColorFor(subjColors, name);
    return {
      name,
      c: S.addSubj === name ? 'var(--onAcc)' : sub.c,
      bg: S.addSubj === name ? sub.c : sub.bg,
      bd: sub.c,
      onPick: () =>
        store.setState((s) => ({ addSubj: name, addErr: { ...s.addErr, subj: null } })),
    };
  });

  // ── 種類チップ（HTML:3549-3555）
  const addTypeChips: Chip[] = ADD_TYPES.map((t) => ({
    label: t.label,
    c: S.addType === t.id ? 'var(--tx0)' : 'var(--tx2)',
    bg: S.addType === t.id ? 'var(--bg3)' : 'var(--bg2)',
    bd: S.addType === t.id ? 'var(--acc)' : 'var(--line2)',
    onPick: () =>
      store.setState({
        addType: t.id,
        // `this.state.addDetailOpen`（= 現在値）を読むので store から引く
        addDetailOpen:
          t.id === 'test' || t.id === 'prep' ? true : store.getState().addDetailOpen,
        addErr: {},
        addDone: null,
      }),
  }));

  // ── 時間割の表示日（HTML:3556-3562 / spec §4.9・v0.9 A4）
  const rawTimetableDate = S.timetableFocusDate || T;
  const timetableMonday = mondayOf(rawTimetableDate);
  const addScheduleDate = scheduleDateOf(rawTimetableDate);
  const addScheduleDow = dowOf(addScheduleDate);
  const addBaseSlots = TIMETABLE[addScheduleDow] || EMPTY_SLOTS;
  const addDayOverrides: DayOverride = (S.dayOverrides && S.dayOverrides[addScheduleDate]) || {};

  /** `setSlotOverride(period, patch)`（HTML:3563-3574）。書き込みキーは `addScheduleDate`（v0.9 A4） */
  const setSlotOverride = (period: number, patch: SlotOverride) => {
    store.setState((s) => {
      const all = { ...(s.dayOverrides || {}) };
      const day: DayOverride = { ...(all[addScheduleDate] || {}) };
      day[String(period)] = { ...(day[String(period)] || {}), ...patch };
      all[addScheduleDate] = day;
      return { dayOverrides: all };
    });
  };

  /** `pickScheduleSlot(period, subj)`（HTML:3575-3591） */
  const pickScheduleSlot = (period: number, subj: string) => {
    const clean = (subj || '').trim();
    if (!clean) return;
    // レガシーはここで `this.subjOf(clean)` を呼んで色を登録するが、教科色表は
    // `addSubj` を含む派生値なので `addSubj: clean` を書いた時点で採番される（architecture §6）
    store.setState((s) => ({
      addSlotSel: period,
      addSlotDate: addScheduleDate,
      addType: 'review' as AddType,
      addTitle: period + '限の復習',
      addSubj: clean,
      addSize: s.addSize || 'S',
      addErr: {},
      addDone: null,
    }));
    focusEl('add-title');
    store.showToast(period + '限「' + clean + '」をAddに入力しました');
  };

  // ── スロット（HTML:3592-3624）
  const addScheduleSlots = addBaseSlots.map((baseSubj, idx) => {
    const period = idx + 1;
    const ov: SlotOverride = addDayOverrides[String(period)] || {};
    const subj = ov.subj != null ? ov.subj : baseSubj || '';
    const held = ov.held != null ? ov.held : !!baseSubj;
    const active = S.addSlotSel === period;
    // 同じ日付・時限を起点に登録された項目が1件でもあれば追加済みとして扱う。
    const fromThisSlot = (row: Extra | Review | Plan | undefined | null) =>
      !!row &&
      String(row.timetablePeriod || '') === String(period) &&
      row.timetableDate === addScheduleDate;
    const hasAdded =
      S.extras.some(fromThisSlot) ||
      S.reviews.some(fromThisSlot) ||
      Object.keys(P).some((id) => fromThisSlot(P[id]));
    const sub = subj ? subjectColorFor(subjColors, subj) : EMPTY_SLOT_COLOR;
    return {
      no: period,
      subj,
      active,
      hasAdded,
      pencil: sub.c,
      slotClass: (active ? 'is-active ' : '') + (hasAdded ? 'is-added ' : '') + (!held ? 'is-empty' : ''),
      addedLabel: '✓ 追加済み',
      noC: active ? 'var(--acc)' : held ? 'var(--tx1)' : 'var(--tx3)',
      bg: active
        ? 'color-mix(in srgb, var(--acc) 11%, var(--bg2))'
        : hasAdded
          ? 'color-mix(in srgb, var(--grn) 7%, var(--bg2))'
          : held
            ? 'var(--bg2)'
            : 'color-mix(in srgb, var(--tx3) 6%, var(--bg2))',
      bd: active
        ? 'var(--acc)'
        : hasAdded
          ? 'color-mix(in srgb, var(--grn) 55%, var(--line))'
          : held
            ? 'var(--line)'
            : 'var(--line2)',
      glow: active
        ? 'var(--gAcc)'
        : hasAdded
          ? '0 0 0 1px color-mix(in srgb, var(--grn) 18%, transparent)'
          : 'none',
      op: held ? 1 : 0.58,
      inputBd: active ? 'var(--acc)' : sub.c,
      meta: held ? (baseSubj ? '基本: ' + baseSubj : '臨時コマ') : '基本なし',
      metaC: 'var(--tx3)',
      onPick: () => {
        if (held) pickScheduleSlot(period, subj);
      },
      onSubjChange: (next: string) => {
        setSlotOverride(period, { subj: next, held: next.trim() ? true : held });
      },
    };
  });

  // ── 週ストリップ（HTML:3625-3635）
  const gotoWeekDay = (iso: string) =>
    store.setState({ timetableFocusDate: iso, addSlotSel: null, addSlotDate: null });
  const scheduleWeekControls = [
    {
      label: '‹',
      aria: '前の週',
      c: 'var(--tx2)',
      bg: 'var(--bg2)',
      bd: 'var(--line2)',
      glow: 'none',
      onPick: () => gotoWeekDay(isoShift(timetableMonday, -7)),
    },
  ]
    .concat(
      WEEK_DAY_LABELS.map((label, i) => {
        const iso = isoShift(timetableMonday, i);
        const active = iso === addScheduleDate;
        return {
          label: label + ' ' + fmtMD(iso),
          aria: label + '曜日 ' + fmtMD(iso),
          c: active ? 'var(--onAcc)' : 'var(--tx2)',
          bg: active ? 'var(--acc)' : 'var(--bg2)',
          bd: active ? 'var(--acc)' : 'var(--line2)',
          glow: active ? 'var(--gAcc)' : 'none',
          onPick: () => gotoWeekDay(iso),
        };
      })
    )
    .concat([
      {
        label: '›',
        aria: '次の週',
        c: 'var(--tx2)',
        bg: 'var(--bg2)',
        bd: 'var(--line2)',
        glow: 'none',
        onPick: () => gotoWeekDay(isoShift(timetableMonday, 7)),
      },
    ]);

  // ── サイズチップ / ミニタスク（HTML:3636-3655）
  const addSizeChips = SIZE_KEYS.map(
    sizeChip(S.addSize, (z) => store.setState({ addSize: z }))
  );
  const addMiniSizeChips = SIZE_KEYS.map(
    sizeChip(S.addMiniSize, (z) => {
      store.setState({ addMiniSize: z });
      focusEl('add-mini');
    })
  );
  const addMiniRows = S.addMinis.map((m, i) => ({
    title: m.title,
    sizeLabel: m.size + '·' + m.min + '分',
    onRemove: () =>
      store.setState((s) => ({ addMinis: s.addMinis.filter((_x, j) => j !== i) })),
  }));

  /** `pushMini()`（HTML:3649-3655） */
  const pushMini = () => {
    const t = (S.addMiniTitle || '').trim();
    if (!t) return;
    const z = S.addMiniSize;
    store.setState((s) => ({
      addMinis: s.addMinis.concat([{ title: t, size: z, min: SIZE_MIN[z] }]),
      addMiniTitle: '',
    }));
    focusEl('add-mini');
  };

  // ── 自動細分化（HTML:3656-3695）
  const addGeneratorChips: Chip[] = GENERATOR_MODES.map((mode) => {
    const active = S.addGenerator === mode.id;
    return {
      label: mode.label,
      c: active ? 'var(--onAcc)' : 'var(--tx2)',
      bg: active ? 'var(--acc)' : 'var(--bg2)',
      bd: active ? 'var(--acc)' : 'var(--line2)',
      onPick: () => store.setState({ addGenerator: mode.id, addDetailOpen: true }),
    };
  });
  const duoStartN = intValue(S.duoStart);
  const duoEndN = intValue(S.duoEnd);
  const duoChunkN = intValue(S.duoChunk);
  const duoPreviewCount =
    duoStartN >= 1 && duoEndN >= duoStartN && duoChunkN >= 1
      ? Math.ceil((duoEndN - duoStartN + 1) / duoChunkN)
      : 0;
  const chartStartN = intValue(S.chartStart);
  const chartEndN = intValue(S.chartEnd);
  const chartPreviewCount =
    chartStartN >= 1 && chartEndN >= chartStartN ? (chartEndN - chartStartN + 1) * 4 : 0;

  /** `generateProgramMinis()`（HTML:3675-3695）。**最新 state** を読む（`this.state.*`） */
  const generateProgramMinis = () => {
    const cur = store.getState();
    const mode = cur.addGenerator;
    const titles: string[] = [];
    if (mode === 'duo') {
      const start = intValue(cur.duoStart);
      const end = intValue(cur.duoEnd);
      const chunk = intValue(cur.duoChunk);
      if (!(start >= 1 && end >= start && chunk >= 1)) {
        store.showToast(TOAST_DUO_INVALID);
        return;
      }
      for (let n = start; n <= end; n += chunk) titles.push(n + '–' + Math.min(end, n + chunk - 1));
    } else if (mode === 'chart') {
      const start = intValue(cur.chartStart);
      const end = intValue(cur.chartEnd);
      if (!(start >= 1 && end >= start)) {
        store.showToast(TOAST_CHART_INVALID);
        return;
      }
      for (let n = start; n <= end; n++) titles.push(n + 'fe', n + 'be');
      for (let n = start; n <= end; n++) titles.push(n + 'fp', n + 'bp');
    } else {
      focusEl('add-mini');
      return;
    }
    if (titles.length > 500) {
      store.showToast(TOAST_GENERATE_LIMIT);
      return;
    }
    const existing = new Set(cur.addMinis.map((item) => item.title));
    const z = cur.addMiniSize;
    const rows = titles
      .filter((title) => !existing.has(title))
      .map((title) => ({ title, size: z, min: SIZE_MIN[z] }));
    if (!rows.length) {
      store.showToast(TOAST_GENERATE_DUP);
      return;
    }
    store.setState((s) => ({ addMinis: s.addMinis.concat(rows) }));
    store.showToast(rows.length + '件のミニタスクを生成しました');
  };

  /** `submitAdd()`（HTML:3696-3749） */
  const submitAdd = () => {
    const t = (S.addTitle || '').trim();
    const subj = (S.addSubj || '').trim();
    const errs: AppState['addErr'] = {};
    if (!t) errs.title = 'タスク名を入力してください';
    if (!subj) errs.subj = '教科を入力してください';
    if (!S.addDay) errs.day = DAY_HEADS[S.addType] + 'を選んでください';
    if (Object.keys(errs).length) {
      store.setState({ addErr: errs, addDone: null });
      return;
    }
    // レガシー `this.subjOf(subj)`（未登録教科の色を採番して登録）は、教科色表が
    // plans / extras / reviews / addSubj からの派生になったので不要（architecture §6）
    const uid = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 999);
    const memo = (S.addMemo || '').trim();
    const minis = S.addMinis.slice();
    const timetablePeriod = S.addSlotSel || null;
    const timetableDate = timetablePeriod ? S.addSlotDate || addScheduleDate : null;
    let done: AddDone;
    if (S.addType === 'single') {
      const ex: Extra = {
        id: uid,
        title: t,
        subj,
        size: S.addSize,
        min: SIZE_MIN[S.addSize],
        day: S.addDay,
        done: false,
        src: '単発タスク' + (memo ? ' · ' + memo : ''),
        timetablePeriod,
        timetableDate,
      };
      if (minis.length) {
        ex.subs = minis.map((m) => m.title);
        ex.subsDone = minis.map(() => false);
        ex.subSizes = minis.map((m) => m.size);
      }
      store.setState((s) => ({ extras: s.extras.concat([ex]) }));
      if (S.addDay === T) addToOrder(store, uid);
      done = {
        label: '「' + subj + ' ' + t + '」を追加しました(' + dayLabel(dateCtx, S.addDay) + ')',
        view: 'todo',
        go: 'ToDoで見る',
      };
    } else if (S.addType === 'review') {
      const rv: Review = {
        id: uid,
        seriesId: uid,
        reviewNo: 1,
        title: t,
        subj,
        stage: '翌日',
        last: T,
        due: S.addDay,
        min: SIZE_MIN[S.addSize],
        src: timetablePeriod
          ? '時間割から追加' + (memo ? ' · ' + memo : '')
          : '手動追加' + (memo ? ' · ' + memo : ''),
        timetablePeriod,
        timetableDate,
        added: false,
        done: false,
      };
      store.setState((s) => ({ reviews: s.reviews.concat([rv]) }));
      done = {
        label:
          '復習「' + subj + ' ' + t + '」を追加しました(次回 ' + dayLabel(dateCtx, S.addDay) + ')',
        view: 'review',
        go: 'Reviewで見る',
      };
    } else {
      const due = S.addDay;
      const start = resolvePlanStart(S.addDay2, due, T);
      // レガシーは `this.PLANS[uid] = {…}` と直接 mutate してから配置計算 → setState する
      const plan: Plan = {
        name: subj + ' ' + t,
        type: S.addType === 'test' ? 'test' : 'prep',
        due,
        subj,
        range: memo || '範囲は未設定',
        timetablePeriod,
        timetableDate,
      };
      const nextPlans: Plans = { ...P, [uid]: plan };
      const list: MiniDraft[] = minis.length
        ? minis
        : [{ title: '内容を細分化する', size: 'M', min: SIZE_MIN.M }];
      // 初期配置も再配分と同じエンジンを使う(GOAL当日は含めない)
      const placement = computeInitialPlacement({
        plans: nextPlans,
        segs: S.segs,
        extras: S.extras,
        reviews: S.reviews,
        limits: { wkMax: S.wkMax, weMax: S.weMax },
        ctx: dateCtx,
        start,
        due,
        list,
        // spec Q11: ミニ未入力ならダミー1件は**必ず未配分**（`minis.length ? … : []`）
        minisCount: minis.length,
      });
      const newSegs: Seg[] = list.map((m, i) => ({
        id: uid + '-' + i,
        plan: uid,
        title: m.title,
        size: m.size,
        min: m.min,
        day: placement.dayOf[i],
        done: false,
      }));
      store.update({ plans: nextPlans, state: (s) => ({ segs: s.segs.concat(newSegs) }) });
      newSegs.forEach((sg) => {
        if (sg.day === T) addToOrder(store, sg.id);
      });
      done = {
        label:
          (S.addType === 'test' ? 'テスト計画' : '予習計画') +
          '「' +
          subj +
          ' ' +
          t +
          '」を作成しました(細分化 ' +
          newSegs.length +
          '件)',
        view: 'tests',
        go: 'Testsで見る',
      };
    }
    store.setState((s) => ({
      addTitle: '',
      addMemo: '',
      addMinis: [],
      addMiniTitle: '',
      addErr: {},
      addDone: done,
      addSlotSel: null,
      addSlotDate: null,
      recentSubjs: [subj].concat(s.recentSubjs.filter((x) => x !== subj)).slice(0, 4),
    }));
    store.showToast(done.label);
    focusEl('add-title');
  };

  // ── 表示用の派生値（HTML:4369-4421）
  const addScheduleLabel = fmtMD(addScheduleDate) + '(' + addScheduleDow + ')';
  const addFromTimetable = !!S.addSlotSel;
  const addTimetableLabel = S.addSlotSel
    ? fmtMD(S.addSlotDate || addScheduleDate) +
      '(' +
      dowOf(S.addSlotDate || addScheduleDate) +
      ') ' +
      S.addSlotSel +
      '限'
    : '';
  const addDayHead = DAY_HEADS[S.addType];
  const addHasStart = S.addType === 'prep' || S.addType === 'test';
  const addDay2Head = DAY2_HEADS[S.addType] || '';
  const schemeVal = light ? 'light' : 'dark';
  const addErrTitle = S.addErr.title || false;
  const addErrSubj = S.addErr.subj || false;
  const addErrDay = S.addErr.day || false;
  const addDetailArrow = S.addDetailOpen ? '▾' : '▸';
  const addDetailHint = S.addType === 'review' ? '(メモ)' : '(細分化・メモ)';
  const addShowSize = S.addType === 'single' || S.addType === 'review';
  const addSizeHead = S.addType === 'review' ? '目安時間(復習1回ぶん)' : 'サイズ(目安時間)';
  const addHasMini = S.addType !== 'review';
  const addShowGenerator = S.addType === 'test' || S.addType === 'prep';
  const addMiniHasSize = S.addType !== 'review';
  const addDoneLabel = S.addDone ? S.addDone.label : '';
  const addGoLabel = S.addDone ? S.addDone.go : '';

  const pickToday = () =>
    store.setState((s) => ({ addDay: T, addErr: { ...s.addErr, day: null } }));
  const pickTomorrow = () =>
    store.setState((s) => ({ addDay: TOMORROW, addErr: { ...s.addErr, day: null } }));
  const addContinue = () => {
    store.setState({ addDone: null });
    focusEl('add-title');
  };
  const addGoView = () => {
    const v = S.addDone ? S.addDone.view : 'cockpit';
    store.setState({ view: v, addDone: null });
  };

  return (
    <div
      data-screen-label="Add"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '18px 20px',
        display: 'flex',
        justifyContent: 'center',
        animation: 'fadeUp .22s ease',
      }}
    >
      <div
        style={{
          width: 'min(1180px,100%)',
          display: 'grid',
          gridTemplateColumns: 'minmax(420px,600px) minmax(320px,1fr)',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        {/* ── 左カラム: 入力フォーム（HTML:1337-1469） */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            height: 'fit-content',
            paddingBottom: '24px',
          }}
        >
          {S.addDone ? (
            <div
              style={{
                background: 'var(--grnBg)',
                border: '1px solid var(--grn)',
                borderRadius: 'var(--rad)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                animation: 'popIn .18s ease',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: '200px',
                  font: "700 12.5px var(--f-ui)",
                  color: 'var(--grn)',
                }}
              >
                ✓ {addDoneLabel}
              </span>
              <button
                onClick={addContinue}
                style={{
                  padding: '7px 14px',
                  border: '1px solid var(--grn)',
                  borderRadius: 'var(--rad-s)',
                  background: 'none',
                  color: 'var(--grn)',
                  font: "700 11.5px var(--f-ui)",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flex: 'none',
                }}
              >
                続けて追加
              </button>
              <button
                onClick={addGoView}
                style={{
                  padding: '7px 14px',
                  border: 'none',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--grn)',
                  color: 'var(--onAcc)',
                  font: "700 11.5px var(--f-ui)",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flex: 'none',
                }}
              >
                {addGoLabel} →
              </button>
            </div>
          ) : null}

          <div
            style={{
              background: 'var(--bg1)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad)',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '15px',
            }}
          >
            {addFromTimetable ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: '1px solid var(--org)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--orgBg)',
                  color: 'var(--org)',
                  font: "700 11.5px var(--f-ui)",
                }}
              >
                <span>時間割から入力 · {addTimetableLabel}</span>
                <button
                  onClick={() => store.setState({ addSlotSel: null, addSlotDate: null })}
                  style={{
                    marginLeft: 'auto',
                    border: 'none',
                    background: 'none',
                    color: 'var(--org)',
                    font: "500 10.5px var(--f-ui)",
                    cursor: 'pointer',
                  }}
                >
                  解除
                </button>
              </div>
            ) : null}

            <div>
              <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>種類</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {addTypeChips.map((t) => (
                  <span
                    key={t.label}
                    onClick={t.onPick}
                    style={{
                      font: "500 12px var(--f-ui)",
                      color: t.c,
                      background: t.bg,
                      border: '1px solid ' + t.bd,
                      borderRadius: 'var(--rad-s)',
                      padding: '7px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                {'タスク名 '}
                <span style={{ color: 'var(--pink)' }}>*</span>
              </div>
              <input
                id="add-title"
                name="compass-task-title"
                autoComplete="off"
                className="fc-acc-glow"
                value={S.addTitle}
                onChange={(e) => {
                  const el = e.currentTarget || e.target;
                  if (!el || el.id !== 'add-title') return;
                  const v = el.value;
                  const keepSubj = store.getState().addSubj;
                  store.setState((s) => ({
                    addTitle: v,
                    addSubj: keepSubj,
                    addErr: { ...s.addErr, title: null },
                  }));
                }}
                onKeyDown={(e) => {
                  // タスク名でEnterを押しても教科欄へフォーカスを移さない。
                  if (e.key === 'Enter') e.preventDefault();
                }}
                placeholder="例: 例題61–65 / 助動詞プリント"
                style={{
                  width: '100%',
                  padding: '11px 13px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg2)',
                  color: 'var(--tx0)',
                  font: "500 13.5px var(--f-ui)",
                  outline: 'none',
                }}
              />
              {addErrTitle ? (
                <div style={{ fontSize: '11px', color: 'var(--pink)', marginTop: '5px' }}>
                  {addErrTitle}
                </div>
              ) : null}
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                {'教科 '}
                <span style={{ color: 'var(--pink)' }}>*</span>
                {' — 自由入力OK。候補にない教科はそのまま新規追加されます'}
              </div>
              <input
                id="add-subj"
                name="compass-task-subject"
                autoComplete="off"
                className="fc-acc-glow"
                list="compass-subj-list"
                value={S.addSubj}
                onChange={(e) => {
                  const el = e.currentTarget || e.target;
                  if (!el || el.id !== 'add-subj') return;
                  const v = el.value;
                  const keepTitle = store.getState().addTitle;
                  store.setState((s) => ({
                    addSubj: v,
                    addTitle: keepTitle,
                    addErr: { ...s.addErr, subj: null },
                  }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const el = document.getElementById('add-day');
                    if (el) el.focus();
                  }
                }}
                placeholder="例: 数学 / English / EC"
                style={{
                  width: '100%',
                  padding: '11px 13px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg2)',
                  color: 'var(--tx0)',
                  font: "500 13.5px var(--f-ui)",
                  outline: 'none',
                }}
              />
              <datalist id="compass-subj-list">
                {addSubjOptions.map((name) => (
                  <option key={name} value={name}></option>
                ))}
              </datalist>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {addSubjChips.map((s) => (
                  <span
                    key={s.name}
                    onClick={s.onPick}
                    style={{
                      font: "700 11.5px var(--f-ui)",
                      color: s.c,
                      background: s.bg,
                      border: '1px solid ' + s.bd,
                      borderRadius: 'var(--rad-s)',
                      padding: '5px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    {s.name}
                  </span>
                ))}
              </div>
              {addErrSubj ? (
                <div style={{ fontSize: '11px', color: 'var(--pink)', marginTop: '5px' }}>
                  {addErrSubj}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '230px' }}>
                <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                  {addDayHead} <span style={{ color: 'var(--pink)' }}>*</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    id="add-day"
                    type="date"
                    className="fc-acc"
                    value={S.addDay}
                    min={T}
                    onChange={(e) => {
                      const v = e.target.value;
                      store.setState((s) => ({ addDay: v, addErr: { ...s.addErr, day: null } }));
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '10px 12px',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      background: 'var(--bg2)',
                      color: 'var(--tx0)',
                      font: "500 13px var(--f-num)",
                      outline: 'none',
                      colorScheme: schemeVal,
                    }}
                  />
                  <span
                    onClick={pickToday}
                    style={{
                      font: "700 11px var(--f-ui)",
                      color: S.addDay === T ? 'var(--onAcc)' : 'var(--tx2)',
                      background: S.addDay === T ? 'var(--acc)' : 'var(--bg2)',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      padding: '7px 11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flex: 'none',
                    }}
                  >
                    今日
                  </span>
                  <span
                    onClick={pickTomorrow}
                    style={{
                      font: "700 11px var(--f-ui)",
                      color: S.addDay === TOMORROW ? 'var(--onAcc)' : 'var(--tx2)',
                      background: S.addDay === TOMORROW ? 'var(--acc)' : 'var(--bg2)',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      padding: '7px 11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flex: 'none',
                    }}
                  >
                    明日
                  </span>
                </div>
                {addErrDay ? (
                  <div style={{ fontSize: '11px', color: 'var(--pink)', marginTop: '5px' }}>
                    {addErrDay}
                  </div>
                ) : null}
              </div>
              {addHasStart ? (
                <div style={{ flex: 1, minWidth: '230px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                    {addDay2Head}(任意) — 細分化タスクをこの日から配分
                  </div>
                  <input
                    type="date"
                    className="fc-acc"
                    value={S.addDay2}
                    min={T}
                    onChange={(e) => store.setState({ addDay2: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      background: 'var(--bg2)',
                      color: 'var(--tx0)',
                      font: "500 13px var(--f-num)",
                      outline: 'none',
                      colorScheme: schemeVal,
                    }}
                  />
                </div>
              ) : null}
            </div>

            {addShowSize ? (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                  {addSizeHead}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {addSizeChips.map((z) => (
                    <span
                      key={z.label}
                      onClick={z.onPick}
                      style={{
                        font: "700 11.5px var(--f-num)",
                        color: z.c,
                        background: z.bg,
                        border: '1px solid ' + z.bd,
                        borderRadius: 'var(--rad-s)',
                        padding: '6px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      {z.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* ── 詳細（細分化・メモ）（HTML:1406-1465） */}
          <div
            style={{
              background: 'var(--bg1)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad)',
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div
              onClick={() => store.setState((s) => ({ addDetailOpen: !s.addDetailOpen }))}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <span style={{ font: "700 12.5px var(--f-ui)", color: 'var(--tx1)' }}>
                {addDetailArrow} 詳細{addDetailHint}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: 'var(--tx3)' }}>
                クリックで開閉
              </span>
            </div>
            {S.addDetailOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {addHasMini ? (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                      細分化タスク — Enterで連続追加できます
                    </div>
                    {addShowGenerator ? (
                      <div
                        style={{
                          marginBottom: '10px',
                          padding: '11px',
                          background: 'var(--bg2)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--rad-s)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '9px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              font: "700 11px var(--f-ui)",
                              color: 'var(--tx1)',
                              marginRight: '2px',
                            }}
                          >
                            自動で細分化
                          </span>
                          {addGeneratorChips.map((g) => (
                            <button
                              key={g.label}
                              onClick={g.onPick}
                              style={{
                                padding: '5px 9px',
                                border: '1px solid ' + g.bd,
                                borderRadius: 'var(--rad-s)',
                                background: g.bg,
                                color: g.c,
                                font: "700 10.5px var(--f-ui)",
                                cursor: 'pointer',
                              }}
                            >
                              {g.label}
                            </button>
                          ))}
                        </div>
                        {S.addGenerator === 'duo' ? (
                          <>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3,minmax(0,1fr)) auto',
                                gap: '7px',
                                alignItems: 'end',
                              }}
                            >
                              <label style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                                開始
                                <input
                                  type="number"
                                  min="1"
                                  value={S.duoStart}
                                  onChange={(e) => store.setState({ duoStart: e.target.value })}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '7px 8px',
                                    border: '1px solid var(--line2)',
                                    borderRadius: 'var(--rad-s)',
                                    background: 'var(--bg1)',
                                    color: 'var(--tx0)',
                                  }}
                                />
                              </label>
                              <label style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                                終了
                                <input
                                  type="number"
                                  min="1"
                                  value={S.duoEnd}
                                  onChange={(e) => store.setState({ duoEnd: e.target.value })}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '7px 8px',
                                    border: '1px solid var(--line2)',
                                    borderRadius: 'var(--rad-s)',
                                    background: 'var(--bg1)',
                                    color: 'var(--tx0)',
                                  }}
                                />
                              </label>
                              <label style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                                何例文ずつ
                                <input
                                  type="number"
                                  min="1"
                                  value={S.duoChunk}
                                  onChange={(e) => store.setState({ duoChunk: e.target.value })}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '7px 8px',
                                    border: '1px solid var(--line2)',
                                    borderRadius: 'var(--rad-s)',
                                    background: 'var(--bg1)',
                                    color: 'var(--tx0)',
                                  }}
                                />
                              </label>
                              <button
                                onClick={generateProgramMinis}
                                style={{
                                  height: '34px',
                                  padding: '0 12px',
                                  border: 'none',
                                  borderRadius: 'var(--rad-s)',
                                  background: 'var(--grad)',
                                  color: 'var(--onAcc)',
                                  font: "700 11px var(--f-ui)",
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {duoPreviewCount}件を生成
                              </button>
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>
                              例: 1〜400を10ずつ → 1–10、11–20 … 391–400
                            </div>
                          </>
                        ) : null}
                        {S.addGenerator === 'chart' ? (
                          <>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto',
                                gap: '7px',
                                alignItems: 'end',
                              }}
                            >
                              <label style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                                プリント開始
                                <input
                                  type="number"
                                  min="1"
                                  value={S.chartStart}
                                  onChange={(e) => store.setState({ chartStart: e.target.value })}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '7px 8px',
                                    border: '1px solid var(--line2)',
                                    borderRadius: 'var(--rad-s)',
                                    background: 'var(--bg1)',
                                    color: 'var(--tx0)',
                                  }}
                                />
                              </label>
                              <label style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>
                                プリント終了
                                <input
                                  type="number"
                                  min="1"
                                  value={S.chartEnd}
                                  onChange={(e) => store.setState({ chartEnd: e.target.value })}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '7px 8px',
                                    border: '1px solid var(--line2)',
                                    borderRadius: 'var(--rad-s)',
                                    background: 'var(--bg1)',
                                    color: 'var(--tx0)',
                                  }}
                                />
                              </label>
                              <button
                                onClick={generateProgramMinis}
                                style={{
                                  height: '34px',
                                  padding: '0 12px',
                                  border: 'none',
                                  borderRadius: 'var(--rad-s)',
                                  background: 'var(--grad)',
                                  color: 'var(--onAcc)',
                                  font: "700 11px var(--f-ui)",
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {chartPreviewCount}件を生成
                              </button>
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>
                              例題を全プリント分 → 練習の順で、1fe・1be … 1fp・1bp と生成します。
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {addMiniHasSize ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                          marginBottom: '7px',
                        }}
                      >
                        {addMiniSizeChips.map((z) => (
                          <span
                            key={z.label}
                            onClick={z.onPick}
                            style={{
                              font: "700 11.5px var(--f-num)",
                              color: z.c,
                              background: z.bg,
                              border: '1px solid ' + z.bd,
                              borderRadius: 'var(--rad-s)',
                              padding: '6px 12px',
                              cursor: 'pointer',
                            }}
                          >
                            {z.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <input
                      id="add-mini"
                      className="fc-acc"
                      value={S.addMiniTitle}
                      onChange={(e) => store.setState({ addMiniTitle: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') pushMini();
                      }}
                      placeholder="例: 例題45–48 → Enter"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--line2)',
                        borderRadius: 'var(--rad-s)',
                        background: 'var(--bg2)',
                        color: 'var(--tx0)',
                        font: "500 12.5px var(--f-ui)",
                        outline: 'none',
                      }}
                    />
                    {S.addMinis.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '5px',
                          marginTop: '8px',
                        }}
                      >
                        {addMiniRows.map((m, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '7px 10px',
                              background: 'var(--bg2)',
                              border: '1px solid var(--line)',
                              borderRadius: 'var(--rad-s)',
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                font: "500 12px var(--f-ui)",
                                color: 'var(--tx0)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {m.title}
                            </span>
                            <span
                              style={{
                                font: "700 10px var(--f-num)",
                                color: 'var(--tx2)',
                                background: 'var(--bg3)',
                                borderRadius: 'var(--rad-s)',
                                padding: '2px 7px',
                                flex: 'none',
                              }}
                            >
                              {m.sizeLabel}
                            </span>
                            <button
                              className="hv-pink-text"
                              onClick={m.onRemove}
                              style={{
                                width: '20px',
                                height: '20px',
                                border: 'none',
                                borderRadius: 'var(--rad-s)',
                                background: 'none',
                                color: 'var(--tx3)',
                                cursor: 'pointer',
                                fontSize: '11px',
                                flex: 'none',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
                    メモ(任意)
                  </div>
                  <input
                    className="fc-acc"
                    value={S.addMemo}
                    onChange={(e) => store.setState({ addMemo: e.target.value })}
                    placeholder="範囲・注意点など"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      background: 'var(--bg2)',
                      color: 'var(--tx0)',
                      font: "500 12.5px var(--f-ui)",
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <button
            onClick={submitAdd}
            style={{
              padding: '13px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: "700 14px var(--f-ui)",
              cursor: 'pointer',
              boxShadow: 'var(--gAcc)',
            }}
          >
            ＋ 追加する
          </button>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--tx3)',
              lineHeight: 1.7,
              padding: '0 4px',
            }}
          >
            サイズ(XS=5分 / S=10分 / M=20分 / L=30分)や細分化は、あとからミニタスク編集でも変更できます。
          </div>
        </div>

        {/* ── 右カラム: 今日の時間割（HTML:1471-1499） */}
        <div
          style={{
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rad)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            height: 'fit-content',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: 'var(--rad-s)',
                background: 'var(--org)',
                boxShadow: 'var(--gAcc)',
              }}
            ></span>
            <div
              style={{
                font: "700 14px var(--f-ui)",
                color: 'var(--tx0)',
                whiteSpace: 'nowrap',
              }}
            >
              今日の時間割
            </div>
            <div
              className="timetable-week-strip"
              style={{
                marginLeft: 'auto',
                display: 'grid',
                gridTemplateColumns: '32px repeat(5,minmax(48px,1fr)) 32px',
                gap: '4px',
                flex: 1,
                minWidth: '330px',
              }}
            >
              {scheduleWeekControls.map((d, i) => (
                <button
                  key={i}
                  onClick={d.onPick}
                  aria-label={d.aria}
                  style={{
                    minWidth: 0,
                    padding: '6px 4px',
                    border: '1px solid ' + d.bd,
                    borderRadius: 'var(--rad-s)',
                    background: d.bg,
                    color: d.c,
                    cursor: 'pointer',
                    font: "700 10.5px var(--f-ui)",
                    boxShadow: d.glow,
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div
              style={{
                width: '100%',
                paddingLeft: '16px',
                fontSize: '11px',
                color: 'var(--tx3)',
              }}
            >
              {addScheduleLabel} · 復習日とは別の日付です
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {addScheduleSlots.map((slot) => (
              <div
                key={slot.no}
                className={'timetable-slot ' + slot.slotClass}
                onClick={slot.onPick}
                style={cssVars({
                  '--slot-pencil': slot.pencil,
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '38px minmax(0,1fr)',
                  gap: '9px',
                  alignItems: 'center',
                  padding: '10px 10px',
                  background: slot.bg,
                  border: '1px solid ' + slot.bd,
                  borderRadius: 'var(--rad-s)',
                  boxShadow: slot.glow,
                  opacity: slot.op,
                  cursor: 'pointer',
                })}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <div style={{ font: "700 17px var(--f-num)", color: slot.noC }}>{slot.no}</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>限</div>
                </div>
                <div
                  style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}
                >
                  <input
                    className="timetable-slot__subject fc-acc-glow"
                    value={slot.subj}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => slot.onSubjChange(e.target.value)}
                    placeholder="教科を入力"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid ' + slot.inputBd,
                      borderRadius: 'var(--rad-s)',
                      background: 'var(--bg2)',
                      color: 'var(--tx0)',
                      font: "700 13px var(--f-ui)",
                      outline: 'none',
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '10.5px',
                        color: slot.metaC,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {slot.meta}
                    </div>
                    {slot.hasAdded ? (
                      <span
                        style={{
                          flex: 'none',
                          padding: '3px 8px',
                          border: '1px solid var(--grn)',
                          borderRadius: 'var(--rad-s)',
                          background: 'var(--grnBg)',
                          color: 'var(--grn)',
                          font: "700 10px var(--f-ui)",
                          boxShadow: 'var(--gGrn)',
                        }}
                      >
                        {slot.addedLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
