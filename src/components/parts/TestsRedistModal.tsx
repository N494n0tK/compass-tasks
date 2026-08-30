'use client';

/**
 * Compass — 再配分モーダル（Phase 2B / TASK S2）
 *
 * 移植元:
 *  - テンプレート HTML:1735-1815（`sc-if redistOpen` 配下すべて）
 *  - 値 HTML:3788-3843（`pv` / `redistMoves` / `redistDays` / `redistModeChips` / `redistModeText` /
 *    `redistPlanName` / `redistPlanMeta` / `redistUnplaced` / `redistLockedOverText`）
 *  - HTML:4171-4184（`closeRedist` / `toggleRedistManual` / トグルの配色 / `redistLateDays`）
 *  - HTML:4189-4196（`applyRedist` — **押下時に computePreview を再実行**する。spec Q15）
 *  - HTML:4426-4433（`redistHasLockedOver` ほかフラグ類）
 *
 * spec §7.8 / §10.8（C-214〜C-235）。
 * `pv` は Tests 画面が 1 回だけ計算して渡す（コントロール行の「未完了 N件」と共有するため）。
 *
 * DOM 位置は `.compass-theme-mode` 直下（`<ShellOverlay>` で包んで呼ぶこと）。
 */

import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { dayLabel, fmtMD, type DateContext } from '../../lib/logic/dates';
import {
  applyRedist as applyRedistToSegs,
  computePreview,
  maxOf,
  redistLoadBarPct,
  type RedistPreview,
} from '../../lib/logic/schedule';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import type { AppState, Plans, RedistMode } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { addToOrder } from './ShellActions';
import { useDialogFocus } from './useDialogFocus';

/** `redistModeChips`（HTML:3811-3816） */
const REDIST_MODE_CHIPS: readonly { id: RedistMode; label: string }[] = [
  { id: 'even', label: '上限内で均等' },
  { id: 'evenUnlimited', label: '上限無視で均等' },
  { id: 'early', label: 'できるだけ早く' },
  { id: 'late', label: '期限前から' },
];

/** `(Math.round(m / 6) / 10)`（HTML:3806 / 3843）— `toH` から 'h' を除いた数値部 */
const toHNum = (m: number) => Math.round(m / 6) / 10;

export interface TestsRedistModalProps {
  state: AppState;
  plans: Plans;
  store: CompassStore;
  ctx: DateContext;
  subjColors: SubjColors;
  /** `S.redistOpen && S.redistPlan` のときだけ非 null（HTML:3789） */
  pv: RedistPreview | null;
  /** `redistTargets.length`（HTML:2690）。`pv` が無いときのフォールバック */
  redistTargetsCount: number;
}

export function TestsRedistModal({
  state,
  plans,
  store,
  ctx,
  subjColors,
  pv,
  redistTargetsCount,
}: TestsRedistModalProps) {
  const S = state;
  const P = plans;
  const T = ctx.today;

  const closeRedist = () => store.setState({ redistOpen: false, redistPlan: null });
  const stopProp = (e: ReactMouseEvent) => e.stopPropagation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onPanelKeyDown = useDialogFocus({
    open: S.redistOpen,
    panelRef,
    initialFocusRef: cancelRef,
    onClose: closeRedist,
  });

  // ── 移動リスト（HTML:3790-3800）
  const redistMoves = pv
    ? pv.moves.map((m) => {
        const pl = P[m.seg.plan];
        const sub = subjectColorFor(subjColors, pl.subj);
        return {
          id: m.seg.id,
          title: m.seg.title,
          planName: pl.name,
          min: m.seg.min,
          c: sub.c,
          due: fmtMD(pl.due) + 'まで',
          fromLabel: dayLabel(ctx, m.seg.day),
          toLabel: dayLabel(ctx, m.toIso),
          toC: 'var(--grn)',
          bd: 'var(--line)',
        };
      })
    : [];

  // ── 適用後の負荷プレビュー（HTML:3801-3810）
  const redistDays = pv
    ? pv.days.slice(0, 14).map((d) => {
        const mx = maxOf(d, S);
        const ld = pv.loads[d.iso];
        const over = ld > mx;
        return {
          iso: d.iso,
          label: parseInt(d.iso.slice(8, 10), 10),
          dow: d.dow,
          dowC: d.weekend ? 'var(--grn)' : 'var(--tx3)',
          pct: redistLoadBarPct(ld, mx),
          barC: over ? 'var(--pink)' : d.weekend ? 'var(--grn)' : 'var(--acc)',
          loadH: ld ? toHNum(ld) + 'h' : '0',
          loadC: over ? 'var(--pink)' : 'var(--tx2)',
        };
      })
    : [];

  const redistModeText =
    S.redistMode === 'early'
      ? '空きがある早い日から順番に配置'
      : S.redistMode === 'late'
        ? '期限前' + (parseInt(String(S.redistLateDays), 10) || 7) + '日間の空きへ分散'
        : S.redistMode === 'evenUnlimited'
          ? '各計画のタスクを期間全体へ等間隔で配置'
          : '各日の負荷率が近づくように配置';

  const redistPlanObj = S.redistPlan && S.redistPlan !== 'all' ? P[S.redistPlan] : null;
  const redistPlanName =
    S.redistPlan === 'all' ? 'すべての計画' : redistPlanObj ? redistPlanObj.name : '計画';
  const redistPlanMeta = redistPlanObj
    ? redistPlanObj.subj +
      ' · ' +
      (redistPlanObj.type === 'test' ? 'テスト' : '予習') +
      ' · 期限 ' +
      fmtMD(redistPlanObj.due) +
      ' · 平日Max ' +
      S.wkMax / 60 +
      'h / 休日Max ' +
      S.weMax / 60 +
      'h'
    : S.redistPlan === 'all'
      ? '未完了のテスト・予習をまとめて調整 · 平日Max ' +
        S.wkMax / 60 +
        'h / 休日Max ' +
        S.weMax / 60 +
        'h'
      : '';

  const redistUnplaced = pv
    ? pv.unplaced.map((item) => ({
        id: item.seg.id,
        title: item.seg.title,
        planName: P[item.seg.plan] ? P[item.seg.plan].name : '',
        reason: item.reason,
      }))
    : [];
  const redistLockedOver = pv ? pv.lockedOverDays : [];
  const redistLockedOverText = redistLockedOver
    .map((item) => fmtMD(item.iso) + ' ' + toHNum(item.load) + 'h / 上限' + toHNum(item.max) + 'h')
    .join(' · ');

  const ignoresLimit = !!(pv && pv.ignoreLimit);
  const redistHasLockedOver = redistLockedOver.length > 0 && !ignoresLimit;
  const redistLimitNote = ignoresLimit
    ? '最大負荷を無視し、期間全体へ等間隔で配置します'
    : '動かす対象は日ごとの最大負荷を厳守します';
  const redistLoadCaption = ignoresLimit
    ? '赤い棒は設定上限の超過を示します'
    : '日ごとの最大負荷を上限として厳守';
  const redistEmpty = pv ? pv.targets.length === 0 : redistTargetsCount === 0;
  const redistUnplacedTitle = ignoresLimit
    ? redistUnplaced.length + '件はGOAL前に作業日がなく未配置です'
    : '上限を守るため ' + redistUnplaced.length + '件は未配置のまま残します';
  const redistApplyLabel = redistUnplaced.length
    ? '配置できる' + redistMoves.length + '件を適用'
    : 'この内容で再配分する';
  const redistTargetCount = pv ? pv.targets.length : redistTargetsCount;
  const redistLateDays = Math.max(1, Math.min(90, parseInt(String(S.redistLateDays), 10) || 7));

  const manual = S.redistIncludeManual;

  /**
   * `applyRedist`（HTML:4189-4196）。表示中の `pv` ではなく**その場で再計算**した結果を適用する
   * （spec Q15。モーダル表示中に最大負荷を変えるとプレビューと違う内容が入る）。
   */
  const applyRedist = () => {
    const st = store.getState();
    const pv2 = computePreview(
      store.getPlans(),
      st,
      ctx,
      st.redistMode,
      st.redistPlan,
      st.redistIncludeManual
    );
    const res = applyRedistToSegs(st.segs, pv2, T);
    if (!res.applied) {
      store.setState({ redistOpen: false, redistPlan: null });
      store.showToast(res.toast);
      return;
    }
    store.setState({ segs: res.segs, redistOpen: false, redistPlan: null });
    res.orderAdditions.forEach((id) => addToOrder(store, id));
    store.showToast(res.toast);
  };

  return (
    <div
      className="glass-overlay-backdrop"
      onClick={closeRedist}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5,9,20,.66)',
        backdropFilter: 'blur(3px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .15s ease',
      }}
    >
      <div
        ref={panelRef}
        className="glass-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="計画の再配分"
        tabIndex={-1}
        onClick={stopProp}
        onKeyDown={onPanelKeyDown}
        style={{
          width: '620px',
          maxWidth: '92vw',
          maxHeight: '86vh',
          overflow: 'auto',
          background: 'var(--bg1)',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--rad)',
          padding: '22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          animation: 'popIn .18s ease',
          boxShadow: '0 24px 80px rgba(0,0,0,.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ font: "700 16px var(--f-ui)", color: 'var(--tx0)' }}>
              ↻ {redistPlanName} の再配分
            </div>
            <div style={{ fontSize: '12px', color: 'var(--tx3)', marginTop: '3px' }}>
              {redistPlanMeta} · {redistModeText} · 未完了 {redistTargetCount}
              件を今日〜期限前日に配置します
            </div>
          </div>
          <button
            onClick={() => store.setState((s) => ({ redistIncludeManual: !s.redistIncludeManual }))}
            aria-label="手動配置も再配分する"
            aria-pressed={manual ? 'true' : 'false'}
            style={{
              border: '1px solid ' + (manual ? 'var(--acc)' : 'var(--line2)'),
              borderRadius: 'var(--rad-s)',
              background: manual ? 'var(--accBg)' : 'var(--bg2)',
              padding: '7px 9px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <span
              style={{
                width: '34px',
                height: '19px',
                borderRadius: 'var(--rad-s)',
                background: manual ? 'var(--acc)' : 'var(--bg3)',
                border: '1px solid ' + (manual ? 'var(--acc)' : 'var(--line2)'),
                position: 'relative',
                transition: '.16s ease',
                flex: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: '2px',
                  width: '13px',
                  height: '13px',
                  borderRadius: 'var(--rad-s)',
                  background: manual ? 'var(--onAcc)' : 'var(--tx3)',
                  transform: 'translateX(' + (manual ? '15px' : '0px') + ')',
                  transition: '.16s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,.28)',
                }}
              ></span>
            </span>
            <span style={{ textAlign: 'left' }}>
              <span
                style={{
                  display: 'block',
                  font: "700 11px var(--f-ui)",
                  color: manual ? 'var(--acc)' : 'var(--tx2)',
                  whiteSpace: 'nowrap',
                }}
              >
                手動配置も対象
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: '9.5px',
                  color: 'var(--tx3)',
                  marginTop: '1px',
                  whiteSpace: 'nowrap',
                }}
              >
                {manual ? '固定済みも動かす' : '固定済みは守る'}
              </span>
            </span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ width: '100%', fontSize: '10.5px', color: 'var(--tx3)' }}>
            組み方（{redistLimitNote}）
          </span>
          {REDIST_MODE_CHIPS.map((m) => {
            const active = S.redistMode === m.id;
            return (
              <span
                key={m.id}
                onClick={() => store.setState({ redistMode: m.id })}
                style={{
                  font: "700 12px var(--f-ui)",
                  color: active ? 'var(--onAcc)' : 'var(--tx2)',
                  background: active ? 'var(--acc)' : 'var(--bg2)',
                  border: '1px solid ' + (active ? 'var(--acc)' : 'var(--line2)'),
                  borderRadius: 'var(--rad-s)',
                  padding: '6px 13px',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </span>
            );
          })}
        </div>
        {ignoresLimit ? (
          <div
            style={{
              padding: '11px 13px',
              background: 'var(--orgBg)',
              border: '1px solid var(--org)',
              borderRadius: 'var(--rad-s)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ font: "700 12px var(--f-ui)", color: 'var(--org)' }}>
              各計画のタスクを期間全体へ等間隔に配置します
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--tx2)' }}>
              平日・休日の上限は無視します。プレビューの赤い棒で超過日を確認してください。
            </div>
          </div>
        ) : null}
        {S.redistMode === 'late' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              flexWrap: 'wrap',
              padding: '11px 13px',
              background: 'var(--bg2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad-s)',
            }}
          >
            <span style={{ font: "700 11.5px var(--f-ui)", color: 'var(--tx1)' }}>期限前</span>
            <input
              type="number"
              min="1"
              max="90"
              value={redistLateDays}
              onChange={(e) =>
                store.setState({
                  redistLateDays: Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)),
                })
              }
              aria-label="期限前に使う日数"
              style={{
                width: '66px',
                padding: '7px 9px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg1)',
                color: 'var(--tx0)',
                font: "700 13px var(--f-num)",
                outline: 'none',
              }}
            />
            <span style={{ font: "700 11.5px var(--f-ui)", color: 'var(--tx1)' }}>
              日間に分散
            </span>
            <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
              GOAL当日は含めず、この期間の空きを均等に使います
            </span>
          </div>
        ) : null}
        {redistHasLockedOver ? (
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--orgBg)',
              border: '1px solid var(--org)',
              borderRadius: 'var(--rad-s)',
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            <div style={{ font: "700 12px var(--f-ui)", color: 'var(--org)' }}>
              固定された予定だけで上限を超えている日があります
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--tx2)' }}>
              均等に見えない原因です。必要なら右上の「手動配置も対象」をONにしてください。
            </div>
            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>{redistLockedOverText}</div>
          </div>
        ) : null}
        {redistUnplaced.length > 0 ? (
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--pinkBg)',
              border: '1px solid var(--pink)',
              borderRadius: 'var(--rad-s)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ font: "700 12px var(--f-ui)", color: 'var(--pink)' }}>
              {redistUnplacedTitle}
            </div>
            {redistUnplaced.map((u) => (
              <div key={u.id} style={{ fontSize: '10.5px', color: 'var(--tx2)' }}>
                • {u.planName} / {u.title} — {u.reason}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {redistEmpty ? (
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--rad-s)',
                font: "500 12px var(--f-ui)",
                color: 'var(--tx2)',
              }}
            >
              再配分できる未完了タスクはありません。
            </div>
          ) : null}
          {redistMoves.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '11px',
                padding: '11px 13px',
                background: 'var(--bg2)',
                border: '1px solid ' + m.bd,
                borderRadius: 'var(--rad-s)',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: 'var(--rad-s)',
                  background: m.c,
                  flex: 'none',
                }}
              ></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "500 13px var(--f-ui)", color: 'var(--tx0)' }}>
                  {m.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                  {m.planName} · {m.min}分 · 期限 {m.due}
                </div>
              </div>
              <span
                style={{
                  font: "500 11px var(--f-ui)",
                  color: 'var(--pink)',
                  textDecoration: 'line-through',
                }}
              >
                {m.fromLabel}
              </span>
              <span style={{ color: 'var(--tx3)' }}>→</span>
              <span style={{ font: "700 12px var(--f-ui)", color: m.toC }}>{m.toLabel}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg2)', borderRadius: 'var(--rad-s)', padding: '12px 14px' }}>
          <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '8px' }}>
            適用後の負荷(先頭14日) — {redistLoadCaption}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '64px' }}>
            {redistDays.map((d) => (
              <div
                key={d.iso}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '3px',
                  height: '100%',
                  justifyContent: 'flex-end',
                }}
              >
                <div style={{ fontSize: '9px', color: d.loadC, fontFamily: "var(--f-num)" }}>
                  {d.loadH}
                </div>
                <div
                  style={{
                    width: '100%',
                    maxWidth: '34px',
                    height: d.pct,
                    background: d.barC,
                    borderRadius: 'var(--rad-s) var(--rad-s) 0 0',
                    minHeight: '2px',
                  }}
                ></div>
                <div style={{ fontSize: '9.5px', color: d.dowC }}>
                  {d.label}
                  {d.dow}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            ref={cancelRef}
            onClick={closeRedist}
            style={{
              padding: '10px 18px',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--rad-s)',
              background: 'none',
              color: 'var(--tx2)',
              font: "500 13px var(--f-ui)",
              cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
          <button
            onClick={applyRedist}
            style={{
              padding: '10px 22px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grad)',
              color: 'var(--onAcc)',
              font: "700 13px var(--f-ui)",
              cursor: 'pointer',
              boxShadow: 'var(--gAcc)',
            }}
          >
            {redistApplyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
