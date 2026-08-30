'use client';

/**
 * Compass — 試験計画画面（Phase 2B / TASK S2）
 *
 * 移植元:
 *  - テンプレート HTML:1040-1121（`sc-if isTests` 配下すべて）
 *  - 値・ハンドラ HTML:2711-2727（`planDays` / `loads` / `days`）、
 *    2728-2873（`activePlanIds` / `planIds` / `enrichSeg` / `plans` / `cells`）、
 *    2689-2690（`overdue` / `redistTargets`）、3788-3789（`pv`）、
 *    4153-4192（再配分の入口・トグル・`applyRedist`）、4210-4218（`wkMaxH` ほか）
 *  - ドロワー / モーダルは `parts/TestsEditorDrawer` / `parts/TestsRedistModal`
 *
 * spec §7.2 / §7.4 / §7.8、§10.7（C-182〜C-213）/ §10.8（C-214〜C-235）。
 * css-notes §6（`.hv-bg3` = スティッキーセル / `.hv-bright` = セグメント）。
 */

import { useRef, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { dayLabel, daysUntil, fmtMD, isoShift } from '../../lib/logic/dates';
import {
  activePlanIds as activePlanIdsOf,
  computePreview,
  decMaxLoad,
  incMaxLoad,
  orderedPlanIds,
  loadBarPct,
  loadsMap,
  maxLoadLabel,
  maxOf,
  overdueSegs,
  planOverdueCount,
  planTimelineDays,
  redistTargetSegs,
  toH,
} from '../../lib/logic/schedule';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Seg } from '../../lib/model/types';
import { addToOrder, mutSeg } from '../parts/ShellActions';
import { ShellOverlay } from '../parts/ShellOverlay';
import { makeSearchMatcher } from '../parts/ShellSearch';
import { useSubjColors } from '../parts/ShellSubjects';
import { TestsRedistModal } from '../parts/TestsRedistModal';
import { dateCtx, store, useAppStore } from '../useStore';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/** セグメントチップの幅（HTML:2740） */
function segWidth(size: Seg['size']): string {
  return size === 'XS' ? '32%' : size === 'S' ? '46%' : size === 'M' ? '68%' : '92%';
}

export function Tests() {
  const { state, plans } = useAppStore();
  const S = state;
  const P = plans;
  const ctx = dateCtx;
  const T = ctx.today;
  const subjColors = useSubjColors(state, plans);
  const { filtering, hit, hitSubject } = makeSearchMatcher(S);
  /** `this._suppressSegClick`（HTML:2745）— D&D 直後のクリック誤爆防止 */
  const suppressSegClick = useRef(false);

  // ── loads / days（HTML:2711-2727）
  const planDays = planTimelineDays(P, S.segs, ctx);
  const loads = loadsMap(planDays, S, T);
  const days = planDays.map((d) => {
    const mx = maxOf(d, S);
    const ld = loads[d.iso];
    const over = ld > mx;
    return {
      iso: d.iso,
      dow: d.dow,
      label: fmtMD(d.iso),
      bg:
        d.iso === T
          ? 'color-mix(in srgb, var(--acc) 8%, transparent)'
          : d.weekend
            ? 'color-mix(in srgb, var(--grn) 5%, transparent)'
            : 'transparent',
      dowC: d.weekend ? 'var(--grn)' : 'var(--tx3)',
      dateC: d.iso === T ? 'var(--acc)' : 'var(--tx1)',
      pct: loadBarPct(ld, mx),
      barC: over ? 'var(--pink)' : d.weekend ? 'var(--grn)' : 'var(--acc)',
      loadC: over ? 'var(--pink)' : 'var(--tx3)',
      loadH: ld ? toH(ld) : '–',
    };
  });

  // ── 計画行の並び（HTML:2729-2736）
  // 期限切れかつ全ミニタスク完了の計画は、Tests・Cockpit・ToDoから自動で消す。
  // 式は lib/logic/schedule.ts に一本化してある（TASK I0）。
  const activePlanIds = activePlanIdsOf(S.segs, P, T);
  const planIds = orderedPlanIds(S, P, T);

  // ── 再配分（HTML:2689-2690 / 3789 / 4153-4154）
  const overdue = overdueSegs(S.segs, P, T);
  const redistTargets = redistTargetSegs(S.segs, P, T, S.redistIncludeManual);
  const pv =
    S.redistOpen && S.redistPlan
      ? computePreview(P, S, ctx, S.redistMode, S.redistPlan, S.redistIncludeManual)
      : null;
  const redistTargetCount = pv ? pv.targets.length : redistTargets.length;

  const openAllRedist = () =>
    store.setState({
      view: 'tests',
      redistOpen: true,
      redistPlan: 'all',
      redistPickMode: false,
      redistMode: 'even',
    });
  const choosePlanRedist = () => {
    if (S.redistPickMode) {
      store.setState({ redistPickMode: false });
      return;
    }
    store.setState({ view: 'tests', redistOpen: false, redistPlan: null, redistPickMode: true });
    store.showToast('再配分したい計画を選択してください');
  };

  const dayCount = planDays.length;
  const timelineMinW = 270 + dayCount * 104 + 'px';
  const timelineMobileMinW = 156 + dayCount * 92 + 'px';
  const gridCols = '270px repeat(' + dayCount + ',minmax(104px,1fr))';

  return (
    <div
      data-screen-label="Tests"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        animation: 'fadeUp .22s ease',
      }}
    >
      <div className="plan-controls" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rad)',
            padding: '12px 16px',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>平日 最大負荷</div>
            <div style={{ font: "700 18px var(--f-num)", color: 'var(--tx0)' }}>
              {maxLoadLabel(S.wkMax)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <button
              onClick={() => store.setState((s) => ({ wkMax: incMaxLoad(s.wkMax) }))}
              style={{
                width: '22px',
                height: '18px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                cursor: 'pointer',
                fontSize: '11px',
                lineHeight: 1,
              }}
            >
              ＋
            </button>
            <button
              onClick={() => store.setState((s) => ({ wkMax: decMaxLoad(s.wkMax) }))}
              style={{
                width: '22px',
                height: '18px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                cursor: 'pointer',
                fontSize: '11px',
                lineHeight: 1,
              }}
            >
              －
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rad)',
            padding: '12px 16px',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>休日 最大負荷</div>
            <div style={{ font: "700 18px var(--f-num)", color: 'var(--grn)' }}>
              {maxLoadLabel(S.weMax)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <button
              onClick={() => store.setState((s) => ({ weMax: incMaxLoad(s.weMax) }))}
              style={{
                width: '22px',
                height: '18px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                cursor: 'pointer',
                fontSize: '11px',
                lineHeight: 1,
              }}
            >
              ＋
            </button>
            <button
              onClick={() => store.setState((s) => ({ weMax: decMaxLoad(s.weMax) }))}
              style={{
                width: '22px',
                height: '18px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                cursor: 'pointer',
                fontSize: '11px',
                lineHeight: 1,
              }}
            >
              －
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rad)',
            padding: '12px 14px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>再配分</div>
            <div style={{ font: "700 13px var(--f-ui)", color: 'var(--tx0)' }}>
              未完了 {redistTargetCount}件
            </div>
          </div>
          <button
            onClick={openAllRedist}
            style={{
              padding: '8px 13px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: "700 12px var(--f-ui)",
              cursor: 'pointer',
              boxShadow: 'var(--gAcc)',
              whiteSpace: 'nowrap',
            }}
          >
            全体を再配分
          </button>
          <button
            onClick={choosePlanRedist}
            aria-pressed={S.redistPickMode ? 'true' : 'false'}
            style={{
              padding: '8px 13px',
              border: '1px solid ' + (S.redistPickMode ? 'var(--acc)' : 'var(--line2)'),
              borderRadius: 'var(--rad-s)',
              background: S.redistPickMode ? 'var(--acc)' : 'var(--bg2)',
              color: S.redistPickMode ? 'var(--onAcc)' : 'var(--tx1)',
              font: "700 12px var(--f-ui)",
              cursor: 'pointer',
              boxShadow: S.redistPickMode ? 'var(--gAcc)' : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {S.redistPickMode ? '計画を選択中…' : '計画ごとに設定'}
          </button>
        </div>
        <div
          className="plan-legend"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '16px',
            fontSize: '11px',
            color: 'var(--tx3)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '22px', borderTop: '2px solid var(--tx2)' }}></span>テスト(実線)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '22px', borderTop: '2px dashed var(--tx2)' }}></span>予習(点線)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '8px',
                height: '10px',
                background: 'var(--accBg)',
                borderRadius: 'var(--rad-s)',
              }}
            ></span>
            XS 5分
            <span
              style={{
                width: '13px',
                height: '10px',
                background: 'var(--accBg)',
                borderRadius: 'var(--rad-s)',
              }}
            ></span>
            S 10分
            <span
              style={{
                width: '20px',
                height: '10px',
                background: 'var(--accBg)',
                borderRadius: 'var(--rad-s)',
              }}
            ></span>
            M 20分
            <span
              style={{
                width: '28px',
                height: '10px',
                background: 'var(--accBg)',
                borderRadius: 'var(--rad-s)',
              }}
            ></span>
            L 30分
          </span>
        </div>
      </div>

      {overdue.length > 0 ? (
        <div
          className="plan-overdue"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'var(--pinkBg)',
            border: '1px solid var(--pink)',
            borderRadius: 'var(--rad)',
            padding: '12px 16px',
          }}
        >
          <span style={{ font: "700 13px var(--f-ui)", color: 'var(--pink)' }}>
            ⚠ 期限前に終わらなかったタスクが {overdue.length}件
          </span>
          <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>
            今日以降〜期限日に、最大負荷を守って自動で組み直せます
          </span>
          <button
            onClick={openAllRedist}
            style={{
              marginLeft: 'auto',
              padding: '8px 16px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--pink)',
              color: 'var(--onAcc)',
              font: "700 12px var(--f-ui)",
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            全体を再配分
          </button>
        </div>
      ) : null}

      {S.redistPickMode ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            padding: '10px 13px',
            background: 'var(--accBg)',
            border: '1px solid var(--acc)',
            borderRadius: 'var(--rad-s)',
            color: 'var(--acc)',
            font: "700 12px var(--f-ui)",
          }}
        >
          ↓ 再配分したい計画を選択してください
        </div>
      ) : null}
      <div className="mobile-scroll-hint">← 横にスワイプして日付を確認 →</div>
      <div
        className="plan-timeline-table"
        role="region"
        aria-label="試験計画の日付カレンダー"
        tabIndex={0}
        style={cssVars({
          '--timeline-days': String(dayCount),
          '--timeline-mobile-min-width': timelineMobileMinW,
          background: 'var(--bg1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--rad)',
          overflowX: 'auto',
        })}
      >
        <div
          className="plan-timeline-head"
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            minWidth: timelineMinW,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              fontSize: '11px',
              color: 'var(--tx3)',
              display: 'flex',
              alignItems: 'end',
              position: 'sticky',
              left: 0,
              background: 'var(--bg1)',
              zIndex: 3,
            }}
          >
            計画 ＼ 日付
          </div>
          {days.map((d) => (
            <div
              key={d.iso}
              style={{
                padding: '8px 4px 6px',
                textAlign: 'center',
                borderLeft: '1px solid var(--line)',
                background: d.bg,
              }}
            >
              <div style={{ fontSize: '10px', color: d.dowC }}>{d.dow}</div>
              <div style={{ font: "700 12px var(--f-num)", color: d.dateC }}>{d.label}</div>
              <div
                style={{
                  height: '26px',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  marginTop: '4px',
                }}
              >
                <div
                  style={{
                    width: '14px',
                    height: d.pct,
                    background: d.barC,
                    borderRadius: 'var(--rad-s) var(--rad-s) 0 0',
                    minHeight: '2px',
                    transition: 'height .4s ease,background .3s ease',
                  }}
                ></div>
              </div>
              <div style={{ fontSize: '9px', color: d.loadC, fontFamily: "var(--f-num)" }}>
                {d.loadH}
              </div>
            </div>
          ))}
        </div>
        {planIds.length === 0 ? (
          <div className="glass-empty plan-empty" role="status" style={{ minWidth: timelineMinW }}>
            <div className="glass-empty__title">試験・予習計画はまだありません</div>
            <div className="glass-empty__hint">
              「追加」からテストまたは予習計画を作成すると、ここに日付ごとの予定が表示されます。
            </div>
          </div>
        ) : planIds.map((pid) => {
          const pl = P[pid];
          const segs = S.segs.filter((s) => s.plan === pid);
          const doneN = segs.filter((s) => s.done).length;
          const sub = subjectColorFor(subjColors, pl.subj);
          // `od`（HTML:2755）— **`manualDay` も数える**（v0.9 で `overdue` 側を揃えた, C-525）
          const od = planOverdueCount(segs, T);
          const isTest = pl.type === 'test';
          const maxSegsInDay = planDays.reduce(
            (mx, d) => Math.max(mx, segs.filter((s) => s.day === d.iso).length),
            0
          );
          const rowDragClass =
            (S.dragPlanRow === pid ? 'is-dragging ' : '') +
            (S.dragPlanOver === pid ? 'is-dragover' : '');
          const onPlanDragEnd = () => store.setState({ dragPlanRow: null, dragPlanOver: null });
          const preloadEditor = () =>
            store.setState({
              editorPlan: pid,
              editorCollapsed: false,
              edPlanName: pl.name || '',
              edPlanSubj: pl.subj || '',
              edPlanDue: pl.due || T,
              edPlanRange: pl.range || '',
              edPlanType: pl.type === 'test' ? 'test' : 'prep',
            });
          const openRedistForPlan = () =>
            store.setState({
              redistOpen: true,
              redistPlan: pid,
              redistPickMode: false,
              editorPlan: null,
              editorCollapsed: false,
            });
          return (
            <div
              key={pid}
              className={'plan-timeline-row ' + rowDragClass}
              onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
                const dragPlanRow = store.getState().dragPlanRow;
                if (!dragPlanRow || dragPlanRow === pid) return;
                e.preventDefault();
                if (store.getState().dragPlanOver !== pid) store.setState({ dragPlanOver: pid });
              }}
              onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
                e.preventDefault();
                const from = store.getState().dragPlanRow;
                if (!from || from === pid) {
                  store.setState({ dragPlanRow: null, dragPlanOver: null });
                  return;
                }
                store.setState((s) => {
                  const prior = Array.isArray(s.planOrder) ? s.planOrder : [];
                  const current = prior
                    .filter((id) => activePlanIds.indexOf(id) >= 0)
                    .concat(activePlanIds.filter((id) => prior.indexOf(id) < 0));
                  const fi = current.indexOf(from);
                  const ti = current.indexOf(pid);
                  if (fi < 0 || ti < 0) return { dragPlanRow: null, dragPlanOver: null };
                  current.splice(fi, 1);
                  current.splice(ti, 0, from);
                  return { planOrder: current, dragPlanRow: null, dragPlanOver: null };
                });
              }}
              onDragEnd={onPlanDragEnd}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                minWidth: timelineMinW,
                borderBottom: '1px solid var(--line)',
                opacity: S.dragPlanRow === pid ? 0.45 : 1,
                boxShadow: S.dragPlanOver === pid ? 'inset 0 2px 0 ' + sub.c : 'none',
                transition: 'opacity .14s ease,box-shadow .14s ease',
              }}
            >
              <div
                className="plan-sticky-cell hv-bg3"
                onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
                  if (S.redistPickMode) {
                    if (e) e.stopPropagation();
                    openRedistForPlan();
                    return;
                  }
                  if (e) e.stopPropagation();
                  preloadEditor();
                }}
                title={S.redistPickMode ? 'この計画の再配分を設定' : 'この計画の詳細を開く'}
                style={{
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  position: 'sticky',
                  left: 0,
                  background: S.redistPickMode
                    ? 'color-mix(in srgb,' + sub.c + ' 10%,var(--bg1))'
                    : 'var(--bg1)',
                  zIndex: 3,
                  transition: 'background .16s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    draggable
                    onClick={(e: ReactMouseEvent<HTMLSpanElement>) => e.stopPropagation()}
                    onDragStart={(e: ReactDragEvent<HTMLSpanElement>) => {
                      store.setState({ dragPlanRow: pid, dragPlanOver: null });
                      try {
                        e.dataTransfer.setData('text/plain', 'plan-row:' + pid);
                        e.dataTransfer.effectAllowed = 'move';
                      } catch {
                        /* レガシーも握りつぶす */
                      }
                    }}
                    onDragEnd={onPlanDragEnd}
                    title="ドラッグして計画の順番を変更"
                    style={{
                      padding: '2px 4px',
                      color: 'var(--tx3)',
                      fontSize: '14px',
                      cursor: 'grab',
                      flex: 'none',
                    }}
                  >
                    ≡
                  </span>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: 'var(--rad-s)',
                      background: sub.c,
                      flex: 'none',
                    }}
                  ></span>
                  <span
                    style={{
                      font: "700 12.5px var(--f-ui)",
                      color: 'var(--tx0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {pl.name}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '10px',
                    color: 'var(--tx3)',
                  }}
                >
                  <span
                    style={{
                      font: "700 9px var(--f-ui)",
                      color: sub.c,
                      border: '1px ' + (isTest ? 'solid' : 'dashed') + ' ' + sub.c,
                      borderRadius: 'var(--rad-s)',
                      padding: '0 5px',
                    }}
                  >
                    {isTest ? 'テスト' : '予習'}
                  </span>
                  {pl.timetablePeriod ? (
                    <span
                      style={{
                        font: "700 9px var(--f-ui)",
                        color: 'var(--org)',
                        background: 'var(--orgBg)',
                        borderRadius: 'var(--rad-s)',
                        padding: '1px 6px',
                      }}
                    >
                      {'時間割 ' + pl.timetablePeriod + '限'}
                    </span>
                  ) : null}
                  <span>
                    あと<b style={{ color: 'var(--tx1)' }}>{daysUntil(ctx, pl.due)}</b>日
                  </span>
                  <span>{doneN + '/' + segs.length + ' 完了'}</span>
                  <span
                    onClick={(e: ReactMouseEvent<HTMLSpanElement>) => {
                      if (e) e.stopPropagation();
                      preloadEditor();
                    }}
                    style={{ color: 'var(--acc)', cursor: 'pointer' }}
                  >
                    ✎ 編集
                  </span>
                  {od ? (
                    <span
                      onClick={(e: ReactMouseEvent<HTMLSpanElement>) => {
                        if (e) e.stopPropagation();
                        openRedistForPlan();
                      }}
                      style={{ color: 'var(--pink)', fontWeight: 700, cursor: 'pointer' }}
                    >
                      ⚠{od}
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                style={{
                  gridColumn: '2 / span ' + dayCount,
                  position: 'relative',
                  minHeight: Math.max(76, maxSegsInDay * 25 + 36) + 'px',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(' + dayCount + ',1fr)',
                    zIndex: 1,
                  }}
                >
                  {planDays.map((d) => {
                    const baseBg =
                      d.iso === T
                        ? 'color-mix(in srgb, var(--acc) 6%, transparent)'
                        : d.weekend
                          ? 'color-mix(in srgb, var(--grn) 4%, transparent)'
                          : 'transparent';
                    const dragged = S.dragTestSeg
                      ? S.segs.find((x) => x.id === S.dragTestSeg)
                      : null;
                    const validDrop = !!dragged && dragged.plan === pid && d.iso < pl.due;
                    const validGoalDrop = S.dragGoalPlan === pid && d.iso >= T;
                    const targetKey = pid + ':' + d.iso;
                    const isTarget = (validDrop || validGoalDrop) && S.dragTestTarget === targetKey;
                    const lineC = pl.due < T || d.iso > pl.due ? 'transparent' : sub.c;
                    const goal = pl.due >= T && d.iso === pl.due;
                    const cellSegs = segs.filter(
                      (s) =>
                        s.day === d.iso &&
                        (!filtering || hit(s.title) || hit(pl.name) || hitSubject(pl.subj))
                    );
                    return (
                      <div
                        key={d.iso}
                        onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
                          if (!validDrop && !validGoalDrop) return;
                          e.preventDefault();
                          try {
                            e.dataTransfer.dropEffect = 'move';
                          } catch {
                            /* レガシーも握りつぶす */
                          }
                          if (store.getState().dragTestTarget !== targetKey)
                            store.setState({ dragTestTarget: targetKey });
                        }}
                        onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
                          if (validGoalDrop) {
                            e.preventDefault();
                            store.update({
                              plans: (p) => ({
                                ...p,
                                [pid]: Object.assign({}, p[pid], { due: d.iso }),
                              }),
                              state: (s) => {
                                const nextSegs = s.segs.map((seg) =>
                                  seg.plan === pid && seg.day && seg.day >= d.iso
                                    ? Object.assign({}, seg, { day: isoShift(d.iso, -1) })
                                    : seg
                                );
                                const mineIds = nextSegs
                                  .filter((seg) => seg.plan === pid)
                                  .map((seg) => seg.id);
                                const todayIds = nextSegs
                                  .filter((seg) => seg.plan === pid && seg.day === T)
                                  .map((seg) => seg.id);
                                return {
                                  segs: nextSegs,
                                  order: s.order
                                    .filter((id) => mineIds.indexOf(id) < 0)
                                    .concat(todayIds),
                                  dragGoalPlan: null,
                                  dragTestTarget: null,
                                  edPlanDue: s.editorPlan === pid ? d.iso : s.edPlanDue,
                                };
                              },
                            });
                            store.showToast(
                              '「' + pl.name + '」のGOALを' + dayLabel(ctx, d.iso) + 'へ変更しました'
                            );
                            return;
                          }
                          if (!validDrop || !dragged) return;
                          e.preventDefault();
                          const oldDay = dragged.day;
                          mutSeg(
                            store,
                            dragged.id,
                            (x) => ((x.day = d.iso), (x.manualDay = true), x)
                          );
                          if (oldDay === T && d.iso !== T)
                            store.setState((s) => ({
                              order: s.order.filter((id) => id !== dragged.id),
                            }));
                          if (d.iso === T) addToOrder(store, dragged.id);
                          store.setState({ dragTestSeg: null, dragTestTarget: null });
                          store.showToast(
                            '「' + dragged.title + '」を' + dayLabel(ctx, d.iso) + 'へ移動しました'
                          );
                        }}
                        onDragLeave={() => {
                          if (store.getState().dragTestTarget === targetKey)
                            store.setState({ dragTestTarget: null });
                        }}
                        style={{
                          position: 'relative',
                          borderLeft: '1px solid ' + (isTarget ? sub.c : 'var(--line)'),
                          background: isTarget
                            ? 'color-mix(in srgb,' + sub.c + ' 18%,var(--bg2))'
                            : baseBg,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          padding: '4px 2px',
                          transition: 'background .14s ease,border-color .14s ease',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: d.iso === pl.due ? '50%' : '0',
                            top: '50%',
                            borderTop: '2px ' + (isTest ? 'solid' : 'dashed') + ' ' + lineC,
                            opacity: 0.78,
                          }}
                        ></div>
                        {cellSegs.map((s) => (
                          <div
                            key={s.id}
                            className="hv-bright"
                            draggable
                            onDragStart={(e: ReactDragEvent<HTMLDivElement>) => {
                              store.setState({
                                dragTestSeg: s.id,
                                dragTestTarget: null,
                                tooltip: null,
                              });
                              try {
                                e.dataTransfer.setData('text/plain', 'segment:' + s.id);
                                e.dataTransfer.effectAllowed = 'move';
                              } catch {
                                /* レガシーも握りつぶす */
                              }
                            }}
                            onDragEnd={() => {
                              suppressSegClick.current = true;
                              store.setState({ dragTestSeg: null, dragTestTarget: null });
                              setTimeout(() => {
                                suppressSegClick.current = false;
                              }, 0);
                            }}
                            onClick={() => {
                              if (suppressSegClick.current) return;
                              mutSeg(store, s.id, (x) => ((x.done = !x.done), x));
                            }}
                            onMouseEnter={(e: ReactMouseEvent<HTMLDivElement>) =>
                              store.setState({
                                tooltip: {
                                  x: e.clientX,
                                  y: e.clientY - 8,
                                  title: s.title + (s.done ? ' ✓済' : ''),
                                  sub:
                                    pl.name +
                                    ' · ' +
                                    s.min +
                                    '分 · ' +
                                    s.size +
                                    ' · ' +
                                    dayLabel(ctx, s.day) +
                                    (s.manualDay ? ' · 手動固定(再配分対象外)' : ''),
                                },
                              })
                            }
                            onMouseLeave={() => store.setState({ tooltip: null })}
                            style={{
                              position: 'relative',
                              zIndex: 2,
                              width: segWidth(s.size),
                              height: '22px',
                              borderRadius: 'var(--rad-s)',
                              background: s.done ? 'transparent' : sub.bg,
                              border: '1.5px solid ' + sub.c,
                              color: sub.c,
                              fontSize: '10px',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              cursor: 'grab',
                              opacity: s.done ? 0.4 : 1,
                              transition: 'background .25s ease,opacity .25s ease',
                              boxShadow: '0 0 0 2px var(--bg1)',
                            }}
                          >
                            {s.done ? '✓' : s.size}
                          </div>
                        ))}
                        {goal ? (
                          <div
                            draggable
                            onDragStart={(e: ReactDragEvent<HTMLDivElement>) => {
                              store.setState({
                                dragGoalPlan: pid,
                                dragTestTarget: null,
                                tooltip: null,
                              });
                              try {
                                e.dataTransfer.setData('text/plain', 'goal:' + pid);
                                e.dataTransfer.effectAllowed = 'move';
                              } catch {
                                /* レガシーも握りつぶす */
                              }
                            }}
                            onDragEnd={() =>
                              store.setState({ dragGoalPlan: null, dragTestTarget: null })
                            }
                            title="ドラッグしてテスト日を変更"
                            style={{
                              position: 'relative',
                              zIndex: 2,
                              padding: '4px 10px',
                              border: '2px solid ' + lineC,
                              borderRadius: 'var(--rad-s)',
                              background: 'var(--bg1)',
                              color: lineC,
                              font: "700 10px var(--f-num)",
                              whiteSpace: 'nowrap',
                              boxShadow: '0 0 12px color-mix(in srgb,' + lineC + ' 35%,transparent)',
                              cursor: 'grab',
                            }}
                          >
                            GOAL {fmtMD(pl.due)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ padding: '9px 14px', fontSize: '11px', color: 'var(--tx3)' }}>
          ≡ 計画は左のハンドルで並び替え · セグメントはドラッグで日付固定 ·
          GOALもドラッグしてテスト日を変更 · クリックで完了 · GOAL当日以降には配置できません
        </div>
      </div>

      {/* オーバーレイ群は `.compass-shell` の外（`.compass-theme-mode` 直下）へ出す（spec §2.1）。
          ミニタスク編集ドロワーは「しまう」状態で他画面へ移っても縦タブが残る必要があるため
          `CompassApp` に 1 個だけ置いてある（ここでは描かない）。再配分モーダルは入口が
          すべて `view:'tests'` を設定するので、この画面が持つ（HTML:2805 / 2810 / 4156）。 */}
      <ShellOverlay>
        {S.redistOpen ? (
          <TestsRedistModal
            state={S}
            plans={P}
            store={store}
            ctx={ctx}
            subjColors={subjColors}
            pv={pv}
            redistTargetsCount={redistTargets.length}
          />
        ) : null}
      </ShellOverlay>
    </div>
  );
}
