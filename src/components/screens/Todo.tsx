'use client';

/**
 * Compass — 「今日のToDo」画面（Phase 2B / TASK S3）
 *
 * 移植元:
 *  - テンプレート HTML:1124-1233（`[data-screen-label="ToDo"]`）
 *  - renderVals  HTML:2916-2922（`openAsk` / `toggleItem`）、2923-2935（`decorate`）、
 *                2987-3035（`sel` / `selSubs` / `deleteSelected` / `addTodoSub`）、
 *                3037-3069（`todoPlanIds` / `selectedPid` / `todoPlanCards`）、
 *                3070-3115（`todoOtherItems` / ノルマ線 / `todoPlanRows`）、
 *                4231-4278（`donutPct` ほか ToDo の値）
 *  - 集中モードは `parts/TodoFocusOverlay`（HTML:1854-1866 / 4048-4076）
 *
 * spec §5.5 / §5.6 / §7.7、パリティ C-236〜C-287。
 *
 * ## この画面の要点
 * - 左カラムは「テスト・予習計画」＋「復習・単発タスク」の 2 セクション。**並べ替えはできない**
 *   （`todoItems` / `dragProps` はテンプレート未参照のデッドコード, spec §5.9）。
 * - 復習・単発カードはカード全体が `onSelect`、内側のチェックが `onToggle`。
 *   **stopPropagation が無いので両方発火する**（spec §11-Q7 / C-244）。1:1 で再現する。
 * - 右下は「計画詳細」と「タスク詳細」の排他表示（`sel.kind` で決まる, C-248）。
 * - 「今日のノルマ」線はドラッグ中に `planQuota` をライブ更新する（C-261）。表示専用で
 *   負荷計算・再配分・完了判定には影響しない（C-265）。
 */

import { Fragment, type DragEvent } from 'react';
import { daysUntil, dayLabel } from '../../lib/logic/dates';
import { toH } from '../../lib/logic/schedule';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Seg, SubTaskFields } from '../../lib/model/types';
import { mutExtra, mutSeg, openNoteDrill } from '../parts/ShellActions';
import { useSubjColors } from '../parts/ShellSubjects';
import { buildTodayItems, todayTotals, type TodayItem } from '../parts/ShellTodayItems';
import { SIZE_MIN, gl, orderedPlanIds, sizeChips, toggleItem } from '../parts/TodoActions';
import { dateCtx, store, useAppStore } from '../useStore';

export function Todo() {
  const { state, plans } = useAppStore();
  const S = state;
  const P = plans;
  const T = dateCtx.today;
  const subjColors = useSubjColors(state, plans);

  // ── 今日のリスト（HTML:2886-2912 / parts/ShellTodayItems）
  const todayItems = buildTodayItems(state, plans, T);
  const otherItems = todayItems.filter((i) => i.kind !== 'seg');
  const totals = todayTotals(todayItems);
  // HTML:4233 — ドーナツの `stroke-dasharray`（円周 327）
  const donutDash = totals.totalMin
    ? Math.round((totals.doneMin / totals.totalMin) * 327)
    : 0;

  // ── 選択中のタスク（HTML:2987-2989）
  const sel: TodayItem | null =
    todayItems.find((i) => i.id === S.selId) || todayItems[0] || null;
  const todoShowTaskDetail = !!sel && (sel.kind === 'rev' || sel.kind === 'extra');
  const todoShowPlanDetail = !todoShowTaskDetail;

  // ── 計画（HTML:2730-2735 → 3037-3042）
  const planIds = orderedPlanIds(S, P, T);
  const todoPlanIds = planIds.filter((pid) => S.segs.some((s) => s.plan === pid && s.day === T));
  const selectedSegForPlan = S.segs.find((s) => s.id === S.selId);
  const selectedOtherForTodo = todayItems.find(
    (i) => i.id === S.selId && (i.kind === 'rev' || i.kind === 'extra')
  );
  let selectedPid: string | null = selectedSegForPlan
    ? selectedSegForPlan.plan
    : todoPlanIds[0] || planIds[0] || null;
  if (todoPlanIds.length && todoPlanIds.indexOf(selectedPid as string) < 0) {
    selectedPid = todoPlanIds[0];
  }

  // ── ノルマ線（HTML:3081-3089 / spec §7.7）
  const todoPlan = selectedPid ? P[selectedPid] : null;
  const todoPlanSub = todoPlan
    ? subjectColorFor(subjColors, todoPlan.subj)
    : { c: 'var(--tx2)', bg: 'var(--bg2)' };
  const todoPlanSegs = selectedPid ? S.segs.filter((s) => s.plan === selectedPid) : [];
  const autoQuotaIdx = todoPlanSegs.reduce(
    (last, s, i) => (s.day && s.day <= T ? i : last),
    -1
  );
  const savedQuotaIdx =
    selectedPid && S.planQuota && Number.isInteger(S.planQuota[selectedPid])
      ? S.planQuota[selectedPid]
      : null;
  const quotaIdx =
    savedQuotaIdx == null
      ? autoQuotaIdx
      : Math.max(0, Math.min(todoPlanSegs.length - 1, savedQuotaIdx));
  const quotaSegs = quotaIdx >= 0 ? todoPlanSegs.slice(0, quotaIdx + 1) : [];
  const selectedTodaySegs = todoPlanSegs.filter((s) => s.day === T);
  const selectedTodayDone = selectedTodaySegs.filter((s) => s.done).length;
  const selectedTodayRemain = selectedTodaySegs.filter((s) => !s.done).length;

  const todoPlanC = todoPlanSub.c;
  const todoPlanBg = todoPlanSub.bg;
  const todoPlanDone = todoPlanSegs.filter((s) => s.done).length;

  // ── 選択タスクの操作（HTML:3006-3035）
  const selC = sel ? subjectColorFor(subjColors, sel.subj).c : 'var(--tx2)';
  const selBg = sel ? subjectColorFor(subjColors, sel.subj).bg : 'var(--bg2)';
  const selCanAddSub = !!sel && (sel.kind === 'seg' || sel.kind === 'extra');

  const deleteSelected = () => {
    if (!sel) return;
    const title = sel.title;
    const id = sel.id;
    if (sel.kind === 'seg') {
      store.setState((s) => ({
        segs: s.segs.filter((x) => x.id !== id),
        order: s.order.filter((o) => o !== id),
        selId: null,
      }));
    } else if (sel.kind === 'extra') {
      store.setState((s) => ({
        extras: s.extras.filter((x) => x.id !== id),
        order: s.order.filter((o) => o !== id),
        selId: null,
      }));
    } else {
      store.setState((s) => ({
        reviews: s.reviews.filter((x) => x.id !== id),
        order: s.order.filter((o) => o !== id),
        selId: null,
      }));
    }
    store.showToast('「' + title + '」を削除しました');
  };

  const addTodoSub = () => {
    const t = (store.getState().todoNewSub || '').trim();
    if (!sel || !selCanAddSub || !t) return;
    const z = store.getState().todoNewSize || 'S';
    const fn = <X extends SubTaskFields>(x: X): X => {
      const prevN = (x.subs || []).length;
      x.subs = (x.subs || []).concat([t]);
      x.subsDone = (x.subsDone || []).concat([false]);
      // 既存のサイズなしミニタスクぶんは空で埋めて位置を合わせる
      const sz = (x.subSizes || []).slice();
      while (sz.length < prevN) sz.push('');
      sz.push(z);
      x.subSizes = sz;
      return x;
    };
    if (sel.kind === 'seg') mutSeg(store, sel.id, fn);
    else mutExtra(store, sel.id, fn);
    store.setState({ todoNewSub: '' });
  };

  const toggleSubAt = (target: TodayItem, i: number) => {
    const fn = <X extends SubTaskFields>(x: X): X => {
      const sd = (x.subsDone || []).slice();
      sd[i] = !sd[i];
      x.subsDone = sd;
      return x;
    };
    if (target.kind === 'seg') mutSeg(store, target.id, fn);
    else mutExtra(store, target.id, fn);
  };

  // ── ノルマ線のドラッグ（HTML:3109-3112）
  const onQuotaStart = (e: DragEvent) => {
    store.setState({ dragQuota: selectedPid });
    try {
      e.dataTransfer.setData('text/plain', 'quota:' + selectedPid);
      e.dataTransfer.effectAllowed = 'move';
    } catch {
      /* noop */
    }
  };
  const onQuotaEnd = () => store.setState({ dragQuota: null });
  const onQuotaOver = (e: DragEvent, i: number) => {
    if (store.getState().dragQuota !== selectedPid) return;
    e.preventDefault();
    if (quotaIdx === i) return;
    store.setState((st) => ({
      planQuota: Object.assign({}, st.planQuota || {}, { [selectedPid as string]: i }),
    }));
  };
  const onQuotaDrop = (e: DragEvent, i: number, title: string) => {
    if (store.getState().dragQuota !== selectedPid) return;
    e.preventDefault();
    store.setState((st) => ({
      planQuota: Object.assign({}, st.planQuota || {}, { [selectedPid as string]: i }),
      dragQuota: null,
    }));
    store.showToast('今日のノルマを「' + title + '」までに変更しました');
  };

  const selSubs = sel && sel.subs ? sel.subs : [];

  return (
    <div
      data-screen-label="ToDo"
      style={{
        flex: 1,
        overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(360px,2fr) minmax(480px,3fr)',
        gap: '16px',
        padding: '18px 20px',
        alignContent: 'start',
        animation: 'fadeUp .22s ease',
      }}
    >
      {/* ══ 左カラム ══ */}
      <div
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--rad)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: 'var(--rad-s)',
              background: 'var(--acc)',
              boxShadow: 'var(--gAcc)',
            }}
          ></span>
          <span style={{ font: "700 14px var(--f-ui)", color: 'var(--tx0)' }}>今日のToDo</span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--tx3)' }}>
            計画名でまとめて表示
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 2px 2px',
            font: "700 10.5px var(--f-ui)",
            color: 'var(--tx3)',
            letterSpacing: '.04em',
          }}
        >
          <span>{'テスト・予習計画 · ' + todoPlanIds.length + '件'}</span>
          <span style={{ flex: 1, borderTop: '1px solid var(--line)' }}></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {todoPlanIds.map((pid) => {
            const pl = P[pid];
            const sub = subjectColorFor(subjColors, pl.subj);
            const segs = S.segs.filter((s) => s.plan === pid);
            const todaySegs = segs.filter((s) => s.day === T);
            const doneN = segs.filter((s) => s.done).length;
            const todayDone = todaySegs.filter((s) => s.done).length;
            const todayRemain = todaySegs.filter((s) => !s.done).length;
            const active = !selectedOtherForTodo && pid === selectedPid;
            const isTest = pl.type === 'test';
            return (
              <div
                key={pid}
                className="todo-plan-card"
                onClick={() => {
                  const first = todaySegs[0] || segs[0];
                  if (first) store.setState({ selId: first.id });
                }}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '13px 14px 12px 17px',
                  background: active
                    ? 'color-mix(in srgb, ' + sub.c + ' 14%, var(--bg3))'
                    : 'color-mix(in srgb, ' + sub.c + ' 7%, var(--bg2))',
                  border: '1px solid ' + (active ? sub.c : 'var(--line)'),
                  borderRadius: 'var(--rad-s)',
                  cursor: 'pointer',
                  boxShadow: active
                    ? '0 0 0 1px color-mix(in srgb, ' +
                      sub.c +
                      ' 35%, transparent), ' +
                      gl(sub.c, 8)
                    : 'none',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: '4px',
                    background: sub.c,
                  }}
                ></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      font: "700 10px var(--f-ui)",
                      color: sub.c,
                      background: sub.bg,
                      border: '1px ' + (isTest ? 'solid' : 'dashed') + ' ' + sub.c,
                      borderRadius: 'var(--rad-s)',
                      padding: '2px 7px',
                    }}
                  >
                    {isTest ? 'テスト' : '予習'}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "700 13.5px var(--f-ui)",
                      color: 'var(--tx0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {pl.name}
                  </span>
                  <span style={{ font: "700 11px var(--f-ui)", color: sub.c }}>
                    {todayRemain ? 'あと' + todayRemain + '個' : '今日分OK'}
                  </span>
                  <span style={{ color: 'var(--tx3)' }}>›</span>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--tx3)', marginTop: '6px' }}>
                  {pl.subj +
                    ' / ' +
                    dayLabel(dateCtx, pl.due) +
                    'まで / 今日 ' +
                    todayDone +
                    '/' +
                    todaySegs.length +
                    ' / 全体 ' +
                    doneN +
                    '/' +
                    segs.length}
                </div>
                <div
                  style={{
                    height: '5px',
                    background: 'var(--line)',
                    borderRadius: 'var(--rad-s)',
                    marginTop: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: segs.length
                        ? Math.round((doneN / segs.length) * 100) + '%'
                        : '0%',
                      background: sub.c,
                      boxShadow: gl(sub.c, 7),
                    }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 2px 2px',
            font: "700 10.5px var(--f-ui)",
            color: 'var(--tx3)',
            letterSpacing: '.04em',
          }}
        >
          <span>{'復習・単発タスク · ' + otherItems.length + '件'}</span>
          <span style={{ flex: 1, borderTop: '1px solid var(--line)' }}></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {otherItems.map((it) => {
            const active = S.selId === it.id;
            const sub = subjectColorFor(subjColors, it.subj);
            return (
              <div
                key={it.id}
                className="todo-other-card"
                onClick={() => store.setState({ selId: it.id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '11px 12px',
                  background: active
                    ? 'color-mix(in srgb, ' + sub.c + ' 14%, var(--bg3))'
                    : 'color-mix(in srgb, ' + sub.c + ' 7%, var(--bg2))',
                  // レガシー: `border:1px solid …;border-left:3px solid …`。
                  // React は shorthand と longhand を混ぜると再レンダーで border-left が
                  // 消えることがある（"conflicting property" 警告）ので辺ごとに分ける。
                  // 計算値はレガシーと同一。
                  borderTop: '1px solid ' + (active ? sub.c : 'var(--line)'),
                  borderRight: '1px solid ' + (active ? sub.c : 'var(--line)'),
                  borderBottom: '1px solid ' + (active ? sub.c : 'var(--line)'),
                  borderLeft: '3px solid ' + sub.c,
                  borderRadius: 'var(--rad-s)',
                  cursor: 'pointer',
                  opacity: it.done ? 0.5 : 1,
                  boxShadow: active
                    ? '0 0 0 1px color-mix(in srgb, ' +
                      sub.c +
                      ' 30%, transparent), ' +
                      gl(sub.c, 7)
                    : 'none',
                }}
              >
                {/* stopPropagation は無い＝トグルと選択が同時に起きる（C-244） */}
                <div
                  onClick={() => toggleItem(store, it)}
                  style={{
                    width: '18px',
                    height: '18px',
                    flex: 'none',
                    border: '1.5px solid ' + (it.done ? 'var(--acc)' : 'var(--line2)'),
                    borderRadius: 'var(--rad-s)',
                    background: it.done ? 'var(--acc)' : 'transparent',
                    color: 'var(--onAcc)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {it.done ? '✓' : ''}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      font: "500 13px var(--f-ui)",
                      color: 'var(--tx0)',
                      textDecoration: it.done ? 'line-through' : 'none',
                    }}
                  >
                    {it.title}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
                    {it.min + '分 · ' + it.src}
                  </div>
                </div>
                {/* ノート由来の復習は、その授業の問題だけを並べたドリル面で解く（spec §8） */}
                {it.noteId ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openNoteDrill(store, it.noteId as string);
                    }}
                    style={{
                      padding: '4px 10px',
                      border: '1px solid var(--ink)',
                      borderRadius: 'var(--rad-s)',
                      background: 'var(--inkBg)',
                      color: 'var(--ink)',
                      font: "700 10.5px var(--f-ui)",
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ノートで復習
                  </button>
                ) : null}
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: sub.c,
                    background: sub.bg,
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 8px',
                  }}
                >
                  {it.subj}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 右カラム ══ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ── サマリー（ドーナツ / ノルマ / 集中モード） */}
        <div
          className="todo-summary"
          style={{
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rad)',
            padding: '16px',
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative', width: '110px', height: '110px', flex: 'none' }}>
            <svg width="110" height="110" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" strokeWidth="10"></circle>
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#cmpGrad)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={donutDash + ' 327'}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dasharray .55s ease' }}
              ></circle>
              <defs>
                {/* stop-color は `.todo-summary linearGradient stop` が上書きする（css-notes §7） */}
                <linearGradient id="cmpGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#4fd8e8"></stop>
                  <stop offset="1" stopColor="#8a6cf5"></stop>
                </linearGradient>
              </defs>
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  font: "700 26px var(--f-num)",
                  color: 'var(--tx0)',
                  lineHeight: 1,
                }}
              >
                {totals.donutPct}
                <span style={{ fontSize: '13px' }}>%</span>
              </span>
              <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>完了</span>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>今日のノルマ</div>
              <div style={{ font: "700 15px var(--f-ui)", color: 'var(--tx0)' }}>
                {todayItems.length + '件 · ' + toH(totals.totalMin) + ' をやり切る'}
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--tx2)', lineHeight: 1.6 }}>
              完了 <b style={{ color: 'var(--acc)' }}>{totals.doneCount}</b> / {totals.totalCount}件<br />残り <b style={{ color: 'var(--tx0)' }}>{toH(totals.remainMin)}</b>
            </div>
          </div>
          <button
            className="focus-launch"
            onClick={() => store.setState({ focusOpen: true })}
            style={{
              alignSelf: 'stretch',
              minWidth: '128px',
              padding: '11px 14px',
              border: '1px solid var(--acc)',
              borderRadius: 'var(--rad-s)',
              background: 'var(--accBg)',
              color: 'var(--acc)',
              font: "700 12.5px var(--f-ui)",
              cursor: 'pointer',
              boxShadow: 'var(--gAcc)',
            }}
          >
            ▶ 集中モード
          </button>
        </div>

        {/* ── (A) 計画詳細（HTML:1162-1185 / spec §7.7） */}
        {todoShowPlanDetail ? (
          <div
            style={{
              background: 'var(--bg1)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '16px 16px 13px',
                borderBottom: '1px solid var(--line)',
                background: 'color-mix(in srgb,' + todoPlanC + ' 7%,var(--bg1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: todoPlanC,
                    background: todoPlanBg,
                    borderRadius: 'var(--rad-s)',
                    padding: '3px 9px',
                  }}
                >
                  {todoPlan ? (todoPlan.type === 'test' ? 'テスト' : '予習') : '計画'}
                </span>
                <span style={{ font: "700 16px var(--f-ui)", color: 'var(--tx0)' }}>
                  {todoPlan ? todoPlan.name : '計画を選択'}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    font: "700 11px var(--f-ui)",
                    color: todoPlanC,
                  }}
                >
                  {todoPlan
                    ? 'あと' + Math.max(0, daysUntil(dateCtx, todoPlan.due)) + '日'
                    : '–'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '5px' }}>
                {(todoPlan ? todoPlan.subj : '–') +
                  ' · ' +
                  (todoPlan
                    ? '期限 ' +
                      dayLabel(dateCtx, todoPlan.due) +
                      ' · ' +
                      todoPlanDone +
                      '/' +
                      todoPlanSegs.length +
                      ' 完了'
                    : '')}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,1fr)',
                  gap: '8px',
                  marginTop: '12px',
                }}
              >
                <div style={{ padding: '9px 10px', background: 'var(--bg2)', borderRadius: 'var(--rad-s)' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>全体進捗</div>
                  <b style={{ font: "700 14px var(--f-num)", color: 'var(--tx0)' }}>
                    {todoPlanDone + ' / ' + todoPlanSegs.length}
                  </b>
                </div>
                <div style={{ padding: '9px 10px', background: 'var(--bg2)', borderRadius: 'var(--rad-s)' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>今日の進捗</div>
                  <b style={{ font: "700 13px var(--f-ui)", color: 'var(--acc)' }}>
                    {selectedTodaySegs.length
                      ? selectedTodayDone +
                        ' / ' +
                        selectedTodaySegs.length +
                        '（あと' +
                        selectedTodayRemain +
                        'こ）'
                      : '今日分なし'}
                  </b>
                </div>
                <div style={{ padding: '9px 10px', background: 'var(--bg2)', borderRadius: 'var(--rad-s)' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>今日のノルマ</div>
                  <b style={{ font: "700 12px var(--f-ui)", color: todoPlanC }}>
                    {quotaSegs.length
                      ? todoPlanSegs[quotaIdx].title + 'まで'
                      : '今日のノルマなし'}
                  </b>
                </div>
              </div>
            </div>
            <div
              style={{
                padding: '12px 14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                maxHeight: '490px',
                overflow: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '1px 2px 8px',
                  fontSize: '10.5px',
                  color: 'var(--tx3)',
                }}
              >
                <span>ミニタスク一覧</span>
                <span style={{ marginLeft: 'auto' }}>ノルマ線を上下にドラッグして変更</span>
              </div>
              {todoPlanSegs.map((s, i) => {
                const overdue = !!s.day && s.day < T && !s.done;
                const today = s.day === T;
                const future = !!s.day && s.day > T;
                const rowTint = today ? 12 : overdue ? 10 : 5;
                return (
                  <Fragment key={s.id}>
                    <div
                      onDragOver={(e) => onQuotaOver(e, i)}
                      onDrop={(e) => onQuotaDrop(e, i, s.title)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px minmax(0,1fr) auto auto',
                        gap: '9px',
                        alignItems: 'center',
                        padding: '9px 10px',
                        background:
                          'color-mix(in srgb, ' + todoPlanC + ' ' + rowTint + '%, var(--bg2))',
                        border:
                          '1px solid ' +
                          (overdue ? 'var(--pink)' : today ? todoPlanC : 'var(--line)'),
                        borderRadius: 'var(--rad-s)',
                        opacity: s.done ? 0.52 : 1,
                      }}
                    >
                      <div
                        onClick={() => mutSeg(store, s.id, (x: Seg) => ((x.done = !x.done), x))}
                        style={{
                          width: '17px',
                          height: '17px',
                          border: '1.5px solid ' + (s.done ? 'var(--acc)' : 'var(--line2)'),
                          borderRadius: 'var(--rad-s)',
                          background: s.done ? 'var(--acc)' : 'transparent',
                          color: 'var(--onAcc)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {s.done ? '✓' : ''}
                      </div>
                      <span
                        style={{
                          minWidth: 0,
                          font: "500 12.5px var(--f-ui)",
                          color: 'var(--tx0)',
                          textDecoration: s.done ? 'line-through' : 'none',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {s.title}
                      </span>
                      <span
                        style={{
                          font: "700 9.5px var(--f-ui)",
                          color: overdue
                            ? 'var(--pink)'
                            : today
                              ? 'var(--acc)'
                              : future
                                ? 'var(--tx2)'
                                : 'var(--tx3)',
                          background: overdue
                            ? 'var(--pinkBg)'
                            : today
                              ? 'var(--accBg)'
                              : 'var(--bg3)',
                          borderRadius: 'var(--rad-s)',
                          padding: '2px 7px',
                        }}
                      >
                        {dayLabel(dateCtx, s.day)}
                      </span>
                      <span
                        style={{
                          font: "700 10px var(--f-num)",
                          color: todoPlanC,
                          background: todoPlanBg,
                          borderRadius: 'var(--rad-s)',
                          padding: '2px 7px',
                        }}
                      >
                        {s.size + '·' + s.min + '分'}
                      </span>
                    </div>
                    {i === quotaIdx ? (
                      <div
                        className="quota-line"
                        draggable
                        onDragStart={onQuotaStart}
                        onDragEnd={onQuotaEnd}
                        title="ドラッグして今日のノルマを変更"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          margin: '3px -4px',
                          color: 'var(--acc)',
                        }}
                      >
                        <span style={{ fontSize: '15px' }}>⠿</span>
                        <span style={{ flex: 1, borderTop: '2px solid var(--acc)' }}></span>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--rad-s)',
                            background: 'var(--acc)',
                            color: 'var(--onAcc)',
                            font: "700 10.5px var(--f-ui)",
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ↕ 今日のノルマ ここまで
                        </span>
                        <span style={{ flex: 1, borderTop: '2px solid var(--acc)' }}></span>
                        <span style={{ fontSize: '15px' }}>⠿</span>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
              {todoPlanSegs.length === 0 ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--tx3)',
                    fontSize: '12px',
                  }}
                >
                  計画を選ぶとミニタスクを表示します
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── (B) タスク詳細（rev / extra のみ, HTML:1186-1230） */}
        {todoShowTaskDetail && sel ? (
          <div
            style={{
              background: 'var(--bg1)',
              border: '1px solid ' + selC,
              borderRadius: 'var(--rad)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 0 0 1px color-mix(in srgb,' + selC + ' 20%,transparent)',
            }}
          >
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid var(--line)',
                background: 'color-mix(in srgb,' + selC + ' 7%,var(--bg1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: selC,
                    background: selBg,
                    borderRadius: 'var(--rad-s)',
                    padding: '3px 9px',
                  }}
                >
                  {sel.kind === 'rev' ? '復習' : sel.kind === 'extra' ? '単発タスク' : '計画'}
                </span>
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: selC,
                    background: selBg,
                    borderRadius: 'var(--rad-s)',
                    padding: '3px 9px',
                  }}
                >
                  {sel.subj}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: 'var(--tx3)' }}>
                  選択中のタスク
                </span>
              </div>
              <div
                style={{
                  font: "700 17px var(--f-ui)",
                  color: 'var(--tx0)',
                  marginTop: '10px',
                }}
              >
                {sel.title}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--tx2)', marginTop: '5px' }}>
                {'見積 ' +
                  sel.min +
                  '分 · サイズ ' +
                  sel.size +
                  (sel.due ? ' · 期限 ' + dayLabel(dateCtx, sel.due) : '')}
              </div>
            </div>
            <div
              style={{
                padding: '14px 16px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ font: "700 11px var(--f-ui)", color: 'var(--tx1)' }}>タスク</span>
                <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>
                  この1件だけを表示しています
                </span>
              </div>
              <div
                onClick={() => toggleItem(store, sel)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px minmax(0,1fr) auto',
                  gap: '10px',
                  alignItems: 'center',
                  padding: '12px',
                  background: 'color-mix(in srgb,' + selC + ' 7%,var(--bg2))',
                  border: '1px solid color-mix(in srgb,' + selC + ' 35%,var(--line))',
                  borderRadius: 'var(--rad-s)',
                  cursor: 'pointer',
                  opacity: sel.done ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    border: '1.5px solid ' + (sel.done ? 'var(--acc)' : 'var(--line2)'),
                    borderRadius: 'var(--rad-s)',
                    background: sel.done ? 'var(--acc)' : 'transparent',
                    color: 'var(--onAcc)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {sel.done ? '✓' : ''}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      font: "600 13px var(--f-ui)",
                      color: 'var(--tx0)',
                      textDecoration: sel.done ? 'line-through' : 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {sel.title}
                  </div>
                  <div
                    style={{ fontSize: '10.5px', color: 'var(--tx3)', marginTop: '3px' }}
                  >
                    {sel.src}
                  </div>
                </div>
                <span
                  style={{
                    font: "700 10px var(--f-num)",
                    color: selC,
                    background: selBg,
                    borderRadius: 'var(--rad-s)',
                    padding: '3px 8px',
                  }}
                >
                  {sel.size + ' · ' + sel.min + '分'}
                </span>
              </div>
              <button
                className="hv-pink-outline"
                onClick={deleteSelected}
                style={{
                  alignSelf: 'flex-start',
                  padding: '6px 10px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'none',
                  color: 'var(--tx3)',
                  font: "500 11px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                削除
              </button>
              <div
                style={{
                  borderTop: '1px solid var(--line)',
                  paddingTop: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '2px' }}>
                  細分化タスク
                </div>
                {selSubs.map((t, i) => {
                  const dn = !!(sel.subsDone && sel.subsDone[i]);
                  const sz = sel.subSizes && sel.subSizes[i];
                  return (
                    <Fragment key={i}>
                      <div
                        onClick={() => toggleSubAt(sel, i)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '9px',
                          padding: '8px 10px',
                          background: 'var(--bg2)',
                          borderRadius: 'var(--rad-s)',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            width: '15px',
                            height: '15px',
                            flex: 'none',
                            border: '1.5px solid ' + (dn ? 'var(--acc)' : 'var(--line2)'),
                            borderRadius: 'var(--rad-s)',
                            background: dn ? 'var(--acc)' : 'transparent',
                            color: 'var(--onAcc)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 700,
                          }}
                        >
                          {dn ? '✓' : ''}
                        </div>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: '12.5px',
                            color: 'var(--tx1)',
                            textDecoration: dn ? 'line-through' : 'none',
                          }}
                        >
                          {t}
                        </span>
                        {sz ? (
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
                            {sz + '·' + SIZE_MIN[sz] + '分'}
                          </span>
                        ) : null}
                      </div>
                      {/* seg 用のノルマ区切り。このパネルは rev/extra でしか出ないので事実上デッド */}
                      {sel.kind === 'seg' && i === selSubs.length - 1 ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '7px',
                            margin: '2px 2px 3px',
                            paddingTop: '7px',
                            borderTop: '1px dashed var(--acc)',
                            font: "700 10.5px var(--f-ui)",
                            color: 'var(--acc)',
                          }}
                        >
                          <span style={{ fontSize: '12px' }}>☷</span>
                          <span>今日のノルマここまで</span>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
                {selSubs.length === 0 ? (
                  <div style={{ fontSize: '11.5px', color: 'var(--tx3)' }}>
                    細分化はまだありません
                  </div>
                ) : null}
                {selCanAddSub ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        gap: '6px',
                        flexWrap: 'wrap',
                        marginTop: '4px',
                      }}
                    >
                      {sizeChips(S.todoNewSize).map((z) => (
                        <span
                          key={z.key}
                          onClick={() => store.setState({ todoNewSize: z.key })}
                          style={{
                            font: "700 10.5px var(--f-num)",
                            color: z.c,
                            background: z.bg,
                            border: '1px solid ' + z.bd,
                            borderRadius: 'var(--rad-s)',
                            padding: '4px 10px',
                            cursor: 'pointer',
                          }}
                        >
                          {z.label}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        className="fc-acc"
                        value={S.todoNewSub}
                        onChange={(e) => store.setState({ todoNewSub: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addTodoSub();
                        }}
                        placeholder="ミニタスクを追加… (Enter)"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '8px 10px',
                          border: '1px solid var(--line2)',
                          borderRadius: 'var(--rad-s)',
                          background: 'var(--bg2)',
                          color: 'var(--tx0)',
                          font: "500 12px var(--f-ui)",
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={addTodoSub}
                        style={{
                          padding: '8px 13px',
                          border: 'none',
                          borderRadius: 'var(--rad-s)',
                          background: 'var(--grad)',
                          color: 'var(--onAcc)',
                          font: "700 11.5px var(--f-ui)",
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        ＋ 追加
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 集中モード（`TodoFocusOverlay`）は画面切替でも消えない必要があるので
          `CompassApp` に 1 個だけ置いてある（ここでは描かない。タイマーが 2 本になる） */}
    </div>
  );
}
