'use client';

/**
 * Compass — Cockpit 画面（Phase 2B / TASK S1）
 *
 * 移植元:
 *  - テンプレート HTML:968-1039（`.cockpit-grid[data-screen-label="Cockpit"]` の 3 パネル）
 *  - `plans`（Cockpit カードが使う派生値）HTML:2727-2830
 *  - `decorate` / `ckToday` / `toggleItem` HTML:2914-2941
 *  - `revDecorate` / `ckReviews` / `ckDrop` / `ckReturnDrop` HTML:3186-3249
 *  - renderVals HTML:4143（`goTodo`/`goTests`/`goReview`）、4155-4157（`openRedist`）、
 *    4207（`wkMaxH`）、4216-4224、4301-4307
 *
 * spec §5.3（今日のタスク）/ §5.4（D&D）/ §6.6（復習セクション）/ §2.10（空状態）、
 * css-notes §6（`style-hover` → `.hv-*`）/ §7（DOM 構造の前提）。
 *
 * リスト算術は自前で書かず `lib/logic` と `parts/Shell*` を通す
 * （`buildTodayItems` / `todayLoadPct` / `toH` / `computeWeekRate` / `dayLabel` / `daysUntil`）。
 */

import { useMemo, type CSSProperties, type DragEvent } from 'react';
import { computeWeekRate } from '../../lib/logic/aggregate';
import { dayLabel, daysUntil } from '../../lib/logic/dates';
import { canAddToToday, isAddedToToday } from '../../lib/logic/reviews';
import { orderedPlanIds, toH, todayLoadPct } from '../../lib/logic/schedule';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Review } from '../../lib/model/types';
import { KomaStrip } from '../parts/KomaStrip';
import { addToOrder, mutExtra, mutReview, mutSeg, openNoteDrill } from '../parts/ShellActions';
import { makeSearchMatcher } from '../parts/ShellSearch';
import { useSubjColors } from '../parts/ShellSubjects';
import { buildTodayItems, todayTotals, type TodayItem } from '../parts/ShellTodayItems';
import { dateCtx, store, useAppStore } from '../useStore';

/** `--dot` などのカスタムプロパティを style オブジェクトへ流し込む */
const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/**
 * `draggable` 属性は**文字列 `'true'` / `'false'`**（HTML:996 の `r.drag` / 1019 の `p.canDrag`）。
 * React も同じ文字列をそのまま属性へ出すので、レガシーの出力と一致する。
 */
type DraggableAttr = 'true' | 'false';

export function Cockpit() {
  const { state, plans } = useAppStore();
  const S = state;
  const T = dateCtx.today;
  const subjColors = useSubjColors(S, plans);
  // 検索中は裏の画面も絞り込む（HTML:2621-2630 / spec §2.5）
  const { filtering, hit, hitSubject } = makeSearchMatcher(S);
  const light = S.theme === 'light';

  // ── 今日のタスク（HTML:2885-2913）
  const todayItems = useMemo(() => buildTodayItems(S, plans, T), [S, plans, T]);
  const totals = todayTotals(todayItems);
  const { totalMin, doneMin } = totals;

  // 復習の完了は理解度モーダル（revAsk）を経由する（HTML:2915）
  const openAsk = (id: string) =>
    store.setState({ revAsk: id, revAskGrade: null, revAskSize: null, revAskReveal: false, revSel: null });

  /** `toggleItem(it)`（HTML:2916-2921）+ ノートの復習はドリルへ（v0.10, spec §8） */
  const toggleItem = (it: TodayItem) => () => {
    if (it.noteId && !it.done) return openNoteDrill(store, it.noteId);
    if (it.kind === 'seg') mutSeg(store, it.id, (x) => ((x.done = !x.done), x));
    else if (it.kind === 'extra') mutExtra(store, it.id, (x) => ((x.done = !x.done), x));
    else if (!it.done) openAsk(it.id);
    else mutReview(store, it.id, (x) => ((x.done = false), x));
  };

  /** `decorate(it)`（HTML:2922-2936）+ `ckToday` の D&D（2937-2940） */
  const ckToday = todayItems
    .filter((it) => !filtering || hit(it.title) || hitSubject(it.subj) || hit(it.src))
    .map((it) => {
      const sub = subjectColorFor(subjColors, it.subj);
      return {
        id: it.id,
        title: it.title,
        size: it.size,
        min: it.min,
        subj: it.subj,
        meta: it.min + '分 · ' + it.src,
        ttLabel: it.timetablePeriod ? '時間割 ' + it.timetablePeriod + '限' : false,
        c: sub.c,
        bg: sub.bg,
        // タスク枠の背景に教科のイメージカラーをうっすら入れる
        tintBg: 'color-mix(in srgb, ' + sub.c + ' 7%, var(--bg2))',
        op: it.done ? 0.5 : 1,
        deco: it.done ? 'line-through' : 'none',
        boxBd: it.done ? 'var(--acc)' : 'var(--line2)',
        boxBg: it.done ? 'var(--acc)' : 'transparent',
        check: it.done ? '✓' : '',
        onToggle: toggleItem(it),
        onCkDragStart: (e: DragEvent<HTMLDivElement>) => {
          store.setState({ dragCkItem: { id: it.id, kind: it.kind } });
          try {
            e.dataTransfer.setData('text/plain', 'today:' + it.id);
            e.dataTransfer.effectAllowed = 'move';
          } catch {
            /* noop（レガシーどおり握り潰す） */
          }
        },
        onCkDragEnd: () => store.setState({ dragCkItem: null }),
      };
    });

  // ── 復習（HTML:3186-3216）
  /** `revDecorate(r)`（HTML:3186-3202）のうち Cockpit が使うぶん + `ckReviews` の D&D（3213-3216） */
  const decorateReview = (r: Review) => {
    const sub = subjectColorFor(subjColors, r.subj);
    return {
      id: r.id,
      title: r.title,
      subj: r.subj,
      stage: r.stage,
      min: r.min,
      src: r.src,
      ttLabel: r.timetablePeriod ? '時間割 ' + r.timetablePeriod + '限' : false,
      subjC: sub.c,
      subjBg: sub.bg,
      dueC: r.due === T ? 'var(--pink)' : 'var(--tx3)',
      dueLabel: dayLabel(dateCtx, r.due),
      cardBg:
        r.due === T && !r.done ? 'color-mix(in srgb, var(--grn) 6%, var(--bg2))' : 'var(--bg2)',
      cardBd:
        r.due === T && !r.done ? 'color-mix(in srgb, var(--grn) 35%, var(--line))' : 'var(--line)',
      op: r.done ? 0.5 : 1,
      canAdd: canAddToToday(r, T),
      isAdded: isAddedToToday(r),
      onAdd: () => {
        mutReview(store, r.id, (x) => ((x.added = true), x));
        addToOrder(store, r.id);
        store.showToast('「' + r.subj + ' ' + r.title + '」を今日のToDoに追加しました');
      },
      // Cockpitの復習カードは「今日のタスク」カラムへドラッグ&ドロップで追加できる
      drag: (!r.added && !r.done ? 'true' : 'false') as DraggableAttr,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        store.setState({ dragRev: r.id });
        try {
          e.dataTransfer.setData('text/plain', r.id);
          e.dataTransfer.effectAllowed = 'copy';
        } catch {
          /* noop */
        }
      },
      onDragEnd: () => store.setState({ dragRev: null }),
    };
  };

  const revToday = S.reviews.filter((r) => r.due === T && !r.done);
  const weekRate = computeWeekRate(S.reviews, T);
  const ckReviews = S.reviews
    .filter((r) => !filtering || hit(r.title) || hitSubject(r.subj))
    .map(decorateReview);

  // ── 試験・予習計画（HTML:2729-2735 の planIds + 2748-2793 のカード用派生値）
  // 期限切れかつ全ミニタスク完了の計画は、Tests・Cockpit・ToDoから自動で消す。
  // 式は lib/logic/schedule.ts に一本化してある（TASK I0）。
  const planIds = orderedPlanIds(S, plans, T);
  const ckPlans = planIds.map((pid) => {
    const pl = plans[pid];
    const segs = S.segs.filter((s) => s.plan === pid);
    const doneN = segs.filter((s) => s.done).length;
    const next = segs.filter((s) => !s.done).sort((a, b) => (a.day < b.day ? -1 : 1))[0];
    const sub = subjectColorFor(subjColors, pl.subj);
    const od = segs.filter((s) => !s.done && s.day < T).length;
    const isTest = pl.type === 'test';
    return {
      pid,
      name: pl.name,
      range: pl.range,
      c: sub.c,
      ttLabel: pl.timetablePeriod ? '時間割 ' + pl.timetablePeriod + '限' : false,
      typeLabel: isTest ? 'テスト' : '予習',
      bStyle: isTest ? 'solid' : 'dashed',
      bColor: od ? 'var(--pink)' : 'var(--line2)',
      cardBg: isTest
        ? 'color-mix(in srgb, ' + (light ? '#6d4de0' : '#a78bfa') + ' 6%, var(--bg2))'
        : 'var(--bg2)',
      cardGlow: 'none',
      daysLeft: daysUntil(dateCtx, pl.due),
      dueText: dayLabel(dateCtx, pl.due),
      dash: Math.round((doneN / segs.length) * 182),
      progPct: Math.round((doneN / segs.length) * 100) + '%',
      progText: doneN + '/' + segs.length + ' 完了',
      nextTitle: next ? next.title : '完了！',
      goTests: () => store.setState({ view: 'tests' }),
      canDrag: (next ? 'true' : 'false') as DraggableAttr,
      onCkPlanDragStart: (e: DragEvent<HTMLDivElement>) => {
        if (!next) {
          e.preventDefault();
          return;
        }
        store.setState({ dragCkPlan: pid });
        try {
          e.dataTransfer.setData('text/plain', 'plan:' + pid);
          e.dataTransfer.effectAllowed = 'copy';
        } catch {
          /* noop */
        }
      },
      onCkPlanDragEnd: () => store.setState({ dragCkPlan: null }),
    };
  });

  // ── D&D（HTML:3218-3249 / 4301-4307）
  /** `ckDragOver`（HTML:4303）— 復習カード / 計画カードを掴んでいるときだけ受け付ける */
  const ckDragOver = (e: DragEvent<HTMLDivElement>) => {
    const s = store.getState();
    if (s.dragRev || s.dragCkPlan) e.preventDefault();
  };

  /** `ckDrop`（HTML:3218-3237） */
  const ckDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const s = store.getState();
    const reviewId = s.dragRev;
    const planId = s.dragCkPlan;
    if (reviewId) {
      const r = s.reviews.find((x) => x.id === reviewId);
      mutReview(store, reviewId, (x) => ((x.added = true), x));
      addToOrder(store, reviewId);
      store.setState({ dragRev: null });
      if (r) store.showToast('「' + r.subj + ' ' + r.title + '」を今日のToDoに追加しました');
      return;
    }
    if (planId) {
      // 配列順で最初の未完了ミニタスクを今日へ
      const seg = s.segs.find((x) => x.plan === planId && !x.done);
      if (!seg) return;
      mutSeg(store, seg.id, (x) => ((x.day = T), x));
      addToOrder(store, seg.id);
      store.setState({ dragCkPlan: null, selId: seg.id });
      store.showToast('「' + seg.title + '」を今日のToDoに追加しました');
    }
  };

  /** `ckReturnDragOver`（HTML:3239）— 復習パネル / 計画パネルが「今日から外す」ドロップ先 */
  const ckReturnDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (store.getState().dragCkItem) e.preventDefault();
  };

  /** `ckReturnDrop`（HTML:3240-3249） */
  const ckReturnDrop = (e: DragEvent<HTMLDivElement>) => {
    const drag = store.getState().dragCkItem;
    if (!drag) return;
    e.preventDefault();
    if (drag.kind === 'rev') mutReview(store, drag.id, (x) => ((x.added = false), x));
    else if (drag.kind === 'seg') mutSeg(store, drag.id, (x) => ((x.day = ''), x));
    else if (drag.kind === 'extra') mutExtra(store, drag.id, (x) => ((x.day = ''), x));
    store.setState((s) => ({
      order: s.order.filter((id) => id !== drag.id),
      dragCkItem: null,
      selId: s.selId === drag.id ? null : s.selId,
    }));
    store.showToast('今日のToDoから戻しました');
  };

  // ── 表示値（HTML:4216-4224 / 4301-4305）
  const ckDropBd = S.dragRev || S.dragCkPlan ? 'var(--grn)' : 'var(--line)';
  const ckDropHint = !!(S.dragRev || S.dragCkPlan);
  const ckReturnBd = S.dragCkItem ? 'var(--acc)' : 'var(--line)';
  const todayCountLabel = todayItems.length + '件 · ' + toH(totalMin);
  const wkMaxH = S.wkMax / 60 + 'h';

  const goTodo = () => store.setState({ view: 'todo' });
  const goTests = () => store.setState({ view: 'tests' });
  const goReview = () => store.setState({ view: 'review' });
  /** `openRedist`（HTML:4155-4157） */
  const openRedist = () =>
    store.setState({
      view: 'tests',
      redistOpen: true,
      redistPlan: 'all',
      redistPickMode: false,
      redistMode: 'even',
    });

  return (
    <div
      className="cockpit-grid"
      data-screen-label="Cockpit"
      style={{
        flex: 1,
        overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '16px',
        padding: '18px 20px',
        alignContent: 'start',
        animation: 'fadeUp .22s ease',
      }}
    >
      {/* 今日のコマ帯。3 パネルの上に全幅で敷く（globals.css の `.koma-strip`） */}
      <KomaStrip state={S} store={store} today={T} todayItems={todayItems} />

      {/* 今日 */}
      <div
        className="cockpit-panel cockpit-panel--today"
        onDragOver={ckDragOver}
        onDrop={ckDrop}
        style={{
          background: 'var(--bg1)',
          border: '1px solid ' + ckDropBd,
          borderRadius: 'var(--rad)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minHeight: '560px',
        }}
      >
        <div
          className="cockpit-panel-title"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span className="panel-dot" style={cssVars({ '--dot': 'var(--acc)' })}></span>
          <span className="panel-heading">今日のタスク</span>
          <span className="panel-heading__meta">{todayCountLabel}</span>
        </div>
        <div className="load-bar">
          <div
            className="load-bar__fill"
            style={{ width: todayLoadPct(totalMin, doneMin, S.wkMax) }}
          ></div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '-4px' }}>
          {'負荷 ' + toH(totalMin) + ' / 平日Max ' + wkMaxH}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', overflow: 'auto' }}>
          {ckToday.map((it) => (
            <div
              key={it.id}
              className="cockpit-task"
              draggable="true"
              onDragStart={it.onCkDragStart}
              onDragEnd={it.onCkDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                background: it.tintBg,
                // shorthand + longhand の混在を避けて辺ごとに書く（計算値は同一）
                borderTop: '1px solid var(--line)',
                borderRight: '1px solid var(--line)',
                borderBottom: '1px solid var(--line)',
                borderLeft: '3px solid ' + it.c,
                borderRadius: 'var(--rad-s)',
                opacity: it.op,
                cursor: 'grab',
              }}
            >
              <div
                onClick={it.onToggle}
                style={{
                  width: '17px',
                  height: '17px',
                  flex: 'none',
                  border: '1.5px solid ' + it.boxBd,
                  borderRadius: 'var(--rad-s)',
                  background: it.boxBg,
                  color: 'var(--onAcc)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {it.check}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    font: "500 13px var(--f-ui)",
                    color: 'var(--tx0)',
                    textDecoration: it.deco,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {it.title}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: 'var(--tx3)',
                  }}
                >
                  <span>{it.meta}</span>
                  {it.ttLabel ? (
                    <span
                      style={{
                        font: "700 9px var(--f-ui)",
                        color: 'var(--org)',
                        background: 'var(--orgBg)',
                        borderRadius: 'var(--rad-s)',
                        padding: '1px 6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {it.ttLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                style={{
                  font: "700 10px var(--f-ui)",
                  color: it.c,
                  background: it.bg,
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 8px',
                  flex: 'none',
                }}
              >
                {it.subj}
              </span>
              <span
                style={{
                  font: "700 10px var(--f-num)",
                  color: it.c,
                  background: it.bg,
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 7px',
                }}
              >
                {it.size}
              </span>
            </div>
          ))}
          {ckToday.length === 0 ? (
            <div className="empty-note">
              <b>今日のタスクはまだ空です</b>
              <span>右の復習や計画から「＋ 今日へ」で積みましょう。ドラッグでもここに置けます。</span>
            </div>
          ) : null}
        </div>
        {ckDropHint ? (
          <div
            style={{
              border: '1.5px dashed var(--grn)',
              borderRadius: 'var(--rad-s)',
              padding: '12px',
              textAlign: 'center',
              font: "700 12px var(--f-ui)",
              color: 'var(--grn)',
              background: 'var(--grnBg)',
            }}
          >
            ここにドロップで今日のToDoに追加
          </div>
        ) : null}
        <button
          className="hv-acc-outline"
          onClick={goTodo}
          style={{
            marginTop: 'auto',
            padding: '10px',
            border: '1px dashed var(--line2)',
            borderRadius: 'var(--rad-s)',
            background: 'none',
            color: 'var(--tx2)',
            font: "500 12px var(--f-ui)",
            cursor: 'pointer',
          }}
        >
          ToDo画面で実行する →
        </button>
      </div>
      {/* 復習 */}
      <div
        className="cockpit-panel cockpit-panel--review"
        onDragOver={ckReturnDragOver}
        onDrop={ckReturnDrop}
        style={{
          background: 'var(--bg1)',
          border: '1px solid ' + ckReturnBd,
          borderRadius: 'var(--rad)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          className="cockpit-panel-title"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span className="panel-dot" style={cssVars({ '--dot': 'var(--grn)' })}></span>
          <span className="panel-heading">復習</span>
          <span className="panel-heading__meta" style={{ color: 'var(--pink)' }}>
            {'今日 ' + revToday.length + '件'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', overflow: 'auto' }}>
          {ckReviews.map((r) => (
            <div
              key={r.id}
              className="cockpit-review"
              draggable={r.drag}
              onDragStart={r.onDragStart}
              onDragEnd={r.onDragEnd}
              style={{
                padding: '11px 12px',
                background: r.cardBg,
                border: '1px solid ' + r.cardBd,
                borderRadius: 'var(--rad-s)',
                opacity: r.op,
                cursor: 'grab',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: r.subjC,
                    background: r.subjBg,
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 8px',
                  }}
                >
                  {r.subj}
                </span>
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: 'var(--grn)',
                    background: 'var(--grnBg)',
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 8px',
                  }}
                >
                  {r.stage + 'の復習'}
                </span>
                {r.ttLabel ? (
                  <span
                    style={{
                      font: "700 9px var(--f-ui)",
                      color: 'var(--org)',
                      background: 'var(--orgBg)',
                      borderRadius: 'var(--rad-s)',
                      padding: '1px 6px',
                    }}
                  >
                    {r.ttLabel}
                  </span>
                ) : null}
                <span style={{ font: "700 11px var(--f-ui)", color: r.dueC }}>{r.dueLabel}</span>
              </div>
              <div
                style={{ font: "500 13px var(--f-ui)", color: 'var(--tx0)', marginTop: '5px' }}
              >
                {r.title}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '5px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                  {r.src + ' · ' + r.min + '分'}
                </span>
                {r.canAdd ? (
                  <button
                    onClick={r.onAdd}
                    style={{
                      font: "700 11px var(--f-ui)",
                      color: 'var(--onAcc)',
                      background: 'var(--grn)',
                      border: 'none',
                      borderRadius: 'var(--rad-s)',
                      padding: '4px 11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flex: 'none',
                    }}
                  >
                    ＋ 今日へ
                  </button>
                ) : null}
                {r.isAdded ? (
                  <span style={{ font: "700 11px var(--f-ui)", color: 'var(--grn)' }}>
                    ✓ 今日のToDoに追加済み
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {ckReviews.length === 0 ? (
            <div className="empty-note">
              <b>復習の予定はありません</b>
              <span>
                復習タスクを完了して理解度を記録すると、翌日→3日後→1週間後→2週間後の間隔で次の復習が自動で積まれます。
              </span>
            </div>
          ) : null}
        </div>
        <div
          className="cockpit-week-rate"
          onClick={goReview}
          style={{
            marginTop: 'auto',
            padding: '10px 12px',
            background: 'var(--bg2)',
            borderRadius: 'var(--rad-s)',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <span style={{ font: "700 18px var(--f-num)", color: 'var(--grn)' }}>
            {weekRate.label + weekRate.suffix}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--tx2)', lineHeight: 1.4 }}>
            {'今週の復習消化率 · ' + weekRate.meta}
            <br />
            Review画面へ →
          </span>
        </div>
      </div>
      {/* 予習・テスト */}
      <div
        className="cockpit-panel cockpit-panel--plans"
        onDragOver={ckReturnDragOver}
        onDrop={ckReturnDrop}
        style={{
          background: 'var(--bg1)',
          border: '1px solid ' + ckReturnBd,
          borderRadius: 'var(--rad)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          className="cockpit-panel-title"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span className="panel-dot" style={cssVars({ '--dot': 'var(--vio)' })}></span>
          <span className="panel-heading" style={{ whiteSpace: 'nowrap' }}>
            試験・予習計画
          </span>
          <span className="panel-heading__link" onClick={goTests}>
            計画を見る →
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', overflow: 'auto' }}>
          {ckPlans.map((p) => (
            <div
              key={p.pid}
              className="cockpit-plan"
              draggable={p.canDrag}
              onDragStart={p.onCkPlanDragStart}
              onDragEnd={p.onCkPlanDragEnd}
              onClick={p.goTests}
              style={{
                padding: '13px',
                background: p.cardBg,
                border: '1px ' + p.bStyle + ' ' + p.bColor,
                borderRadius: 'var(--rad)',
                display: 'flex',
                gap: '13px',
                alignItems: 'center',
                cursor: 'grab',
                boxShadow: p.cardGlow,
              }}
            >
              <div style={{ position: 'relative', width: '62px', height: '62px', flex: 'none' }}>
                <svg width="62" height="62" viewBox="0 0 68 68">
                  <circle
                    cx="34"
                    cy="34"
                    r="29"
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth="6"
                  ></circle>
                  <circle
                    cx="34"
                    cy="34"
                    r="29"
                    fill="none"
                    stroke={p.c}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={p.dash + ' 182'}
                    transform="rotate(-90 34 34)"
                    style={{ transition: 'stroke-dasharray .5s ease' }}
                  ></circle>
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
                  <span style={{ fontSize: '9px', color: p.c }}>あと</span>
                  <span
                    style={{
                      font: "700 20px var(--f-num)",
                      color: 'var(--tx0)',
                      lineHeight: 1,
                    }}
                  >
                    {p.daysLeft}
                    <span style={{ fontSize: '11px' }}>日</span>
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ font: "700 13px var(--f-ui)", color: 'var(--tx0)' }}>
                    {p.name}
                  </span>
                  <span
                    style={{
                      font: "700 9px var(--f-ui)",
                      color: p.c,
                      border: '1px ' + p.bStyle + ' ' + p.c,
                      borderRadius: 'var(--rad-s)',
                      padding: '1px 5px',
                    }}
                  >
                    {p.typeLabel}
                  </span>
                  {p.ttLabel ? (
                    <span
                      style={{
                        font: "700 9px var(--f-ui)",
                        color: 'var(--org)',
                        background: 'var(--orgBg)',
                        borderRadius: 'var(--rad-s)',
                        padding: '1px 6px',
                      }}
                    >
                      {p.ttLabel}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                  {p.dueText + ' · ' + p.range}
                </div>
                <div
                  style={{
                    height: '6px',
                    background: 'var(--line)',
                    borderRadius: 'var(--rad-s)',
                    marginTop: '7px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: p.progPct,
                      height: '100%',
                      background: p.c,
                      transition: 'width .45s ease',
                    }}
                  ></div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tx2)', marginTop: '4px' }}>
                  {p.progText + ' · 次: '}
                  <b style={{ color: p.c }}>{p.nextTitle}</b>
                </div>
              </div>
            </div>
          ))}
          {ckPlans.length === 0 ? (
            <div className="empty-note">
              <b>計画がありません</b>
              <span>
                「タスク追加」からテストや予習の計画を作ると、ここに残り日数と進捗が並びます。
              </span>
            </div>
          ) : null}
        </div>
        <button
          className="cockpit-primary-action"
          onClick={openRedist}
          style={{
            marginTop: 'auto',
            padding: '11px',
            border: 'none',
            borderRadius: 'var(--rad-s)',
            background: 'var(--grad)',
            color: 'var(--onAcc)',
            font: "700 13px var(--f-ui)",
            cursor: 'pointer',
            boxShadow: 'var(--gAcc)',
          }}
        >
          未完了タスクを再配分
        </button>
      </div>
    </div>
  );
}
