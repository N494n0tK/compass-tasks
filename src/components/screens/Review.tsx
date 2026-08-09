'use client';

/**
 * Compass — 復習画面（Phase 2B / TASK S4）
 *
 * 移植元: HTML:1505-1560（`[data-screen-label="Review"]`）、3186-3211（統計・消化率）、
 * 3252-3266（`fmtD` / `statusOf`）、3267-3332（チップ・並び替え・行・一括ToDo追加）、
 * 4280-4281 / 4338-4343（`renderVals`）。spec §6.4、css-notes §3.1 / §6。
 *
 * 表のセルには `.rt-cell` と `.rt-cell-<名前>` の**両方**を付ける（css-notes §3.1）。
 * DOM の並び順（教科→タスク名→前回→次回→復習回→間隔→状態→操作）は
 * デスクトップの `grid-template-columns` に順で流し込まれるので変えないこと。
 *
 * ドロワー / モーダルは `parts/ReviewDetail` / `parts/ReviewAskModal`（どちらも `ShellOverlay`）。
 */

import { Fragment } from 'react';
import { fmtD } from '../../lib/logic/dates';
import { computeWeekRate } from '../../lib/logic/aggregate';
import {
  bulkAddToToday,
  bulkAddTargets,
  canAddToToday,
  canComplete,
  isAddedToToday,
  reviewNoOf,
} from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { RevSort, Review as ReviewItem } from '../../lib/model/types';
import { ReviewDetail } from '../parts/ReviewDetail';
import { openAsk, statusOf, ttLabelOf } from '../parts/ReviewShared';
import { addToOrder, mutReview } from '../parts/ShellActions';
import { useSubjColors } from '../parts/ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/** 統計カードの外枠（HTML:1508-1510。3 枚とも幅以外は同じ） */
const STAT_CARD = {
  background: 'var(--bg1)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad)',
  padding: '12px 18px',
} as const;

/** 統計カードの見出し */
const STAT_LABEL = { fontSize: '10px', color: 'var(--tx3)' } as const;

/** ヘッダ / 行で共通の grid（HTML:1527 / 1540） */
const GRID_COLUMNS = '86px minmax(200px,1fr) 84px 96px 68px 86px 72px 158px';

/**
 * 表フッタ（HTML:1557）。JSX の行連結で空白が変わらないよう定数にしてある（文言は 1 バイト同一）
 */
const FOOTER_TEXT =
  '行クリック / ⋯ で詳細パネル(日付変更・削除) · 期限順: 遅れ → 今日 → 今後 → 完了 / 教科ごと: 教科でまとめて表示 · 完了時に理解度を記録すると次の復習が自動で組まれます';

/** `revSortChips`（HTML:3291） */
const SORT_MODES: readonly { id: RevSort; label: string }[] = [
  { id: 'due', label: '期限順' },
  { id: 'subj', label: '教科ごと' },
];

export function Review() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;
  const T = ctx.today;

  // ── 統計カード（HTML:3203-3211 / 4338-4343）
  const revTodayCount = S.reviews.filter((r) => r.due === T && !r.done).length;
  const revLateCount = S.reviews.filter((r) => r.due < T && !r.done).length;
  const weekRate = computeWeekRate(S.reviews, T);

  // ── 一括ToDo追加（v0.9。HTML:3323-3332）
  const revBulkCount = bulkAddTargets(S.reviews, T).length;
  const revBulkAdd = () => {
    const s = store.getState();
    const res = bulkAddToToday(s.reviews, s.order, T);
    if (res.message == null) return;
    store.setState({ reviews: res.reviews, order: res.order });
    store.showToast(res.message);
  };

  // ── 教科チップ（HTML:3267-3279）。`count > 0` のものだけ
  const subjNames = Object.keys(subjColors);
  const revSubjChips = subjNames
    .map((name) => ({
      name,
      count: S.reviews.filter((r) => r.subj === name && !r.done).length,
      on: S.revFilter === name,
      color: subjectColorFor(subjColors, name),
    }))
    .filter((chip) => chip.count > 0);

  // ── 並び替え（HTML:3281-3290）。`Object.keys(SUBJ)` の index で教科をまとめる
  const subjIdx: Record<string, number> = {};
  subjNames.forEach((n, i) => {
    subjIdx[n] = i;
  });
  const revSorted = S.reviews.slice().sort((a, b) => {
    if (S.revSort === 'subj') {
      const sa = subjIdx[a.subj] != null ? subjIdx[a.subj] : 99;
      const sb = subjIdx[b.subj] != null ? subjIdx[b.subj] : 99;
      if (sa !== sb) return sa - sb;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.due < b.due ? -1 : 1;
    }
    // 遅れ+今日=0 / 今後=1 / 完了=2
    const ka = a.done ? 2 : a.due <= T ? 0 : 1;
    const kb = b.done ? 2 : b.due <= T ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return a.due < b.due ? -1 : 1;
  });
  const revFiltered = revSorted.filter((r) => !S.revFilter || r.subj === S.revFilter);
  // 期限順のとき「今日まで」と「明日から」の間に仕切りを入れる（HTML:3299）
  const revFutIdx =
    S.revSort === 'due' ? revFiltered.findIndex((r) => !r.done && r.due > T) : -1;

  // ── 行のアクション（HTML:3316-3318）
  const onRowAdd = (r: ReviewItem) => {
    mutReview(store, r.id, (x) => ((x.added = true), x));
    addToOrder(store, r.id);
    store.showToast('「' + r.subj + ' ' + r.title + '」を今日のToDoに追加しました');
  };

  return (
    <div
      data-screen-label="Review"
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
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ ...STAT_CARD, width: '130px' }}>
          <div style={STAT_LABEL}>今日やる復習</div>
          <div style={{ font: "700 20px var(--f-num)", color: 'var(--pink)' }}>
            {revTodayCount}
            <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>件</span>
          </div>
        </div>
        <div style={{ ...STAT_CARD, width: '130px' }}>
          <div style={STAT_LABEL}>遅れている復習</div>
          <div
            style={{
              font: "700 20px var(--f-num)",
              color: revLateCount ? 'var(--pink)' : 'var(--tx0)',
            }}
          >
            {revLateCount}
            <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>件</span>
          </div>
        </div>
        <div style={{ ...STAT_CARD, width: '150px' }}>
          <div style={STAT_LABEL}>今週の消化率 · {weekRate.meta}</div>
          <div style={{ font: "700 20px var(--f-num)", color: 'var(--grn)' }}>
            {weekRate.label}
            <span style={{ fontSize: '12px' }}>{weekRate.suffix}</span>
          </div>
        </div>
        {revBulkCount > 0 ? (
          <button
            onClick={revBulkAdd}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 16px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grn)',
              color: 'var(--onAcc)',
              font: "700 11.5px var(--f-ui)",
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none',
              boxShadow: 'var(--gGrn)',
            }}
          >
            今日の復習をまとめてToDoへ
            <span
              style={{
                font: "700 10.5px var(--f-num)",
                background: 'color-mix(in srgb,var(--onAcc) 22%,transparent)',
                borderRadius: 'var(--rad-s)',
                padding: '1px 7px',
              }}
            >
              {revBulkCount}
            </span>
          </button>
        ) : null}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>並び替え</span>
            <div
              style={{
                display: 'flex',
                background: 'var(--bg1)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--rad-s)',
                padding: '2px',
              }}
            >
              {SORT_MODES.map((mode) => (
                <span
                  key={mode.id}
                  onClick={() => store.setState({ revSort: mode.id })}
                  style={{
                    font: "700 11px var(--f-ui)",
                    color: S.revSort === mode.id ? 'var(--onAcc)' : 'var(--tx2)',
                    background: S.revSort === mode.id ? 'var(--acc)' : 'transparent',
                    borderRadius: 'var(--rad-s)',
                    padding: '5px 13px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mode.label}
                </span>
              ))}
            </div>
          </div>
          <span style={{ fontSize: '10.5px', color: 'var(--tx3)', marginRight: '2px' }}>
            教科で絞り込み
          </span>
          {revSubjChips.map((chip) => (
            <span
              key={chip.name}
              onClick={() =>
                store.setState((s) => ({
                  revFilter: s.revFilter === chip.name ? null : chip.name,
                }))
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                font: "700 11px var(--f-ui)",
                color: chip.on ? 'var(--onAcc)' : chip.color.c,
                background: chip.on ? chip.color.c : chip.color.bg,
                border: '1px solid ' + chip.color.c,
                borderRadius: 'var(--rad-s)',
                padding: '4px 11px',
                cursor: 'pointer',
              }}
            >
              {chip.name}
              <span style={{ font: "700 10px var(--f-num)" }}>{chip.count}</span>
            </span>
          ))}
        </div>
      </div>
      <div
        className="review-table"
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--rad)',
          overflowX: 'auto',
        }}
      >
        <div className="review-table-inner" style={{ minWidth: '960px' }}>
          <div
            className="review-table-head"
            style={{
              display: 'grid',
              gridTemplateColumns: GRID_COLUMNS,
              gap: '0 10px',
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              fontSize: '10.5px',
              color: 'var(--tx3)',
            }}
          >
            <span>教科</span>
            <span>タスク名</span>
            <span>前回</span>
            <span>次回復習</span>
            <span>復習回</span>
            <span>間隔</span>
            <span>状態</span>
            <span style={{ textAlign: 'right' }}>操作</span>
          </div>
          {revFiltered.map((r, idx) => {
            const color = subjectColorFor(subjColors, r.subj);
            const st = statusOf(ctx, r);
            const ttLabel = ttLabelOf(r);
            const roundLabel = '第' + reviewNoOf(r) + '回';
            const deco = r.done ? 'line-through' : 'none';
            const canAdd = canAddToToday(r, T);
            return (
              <Fragment key={r.id}>
                {idx === revFutIdx && idx > 0 ? (
                  <div
                    className="review-divider"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '16px 14px 6px',
                      background: 'var(--bg2)',
                    }}
                  >
                    <span style={{ flex: 1, borderTop: '1px dashed var(--line2)' }} />
                    <span
                      style={{
                        font: "700 10.5px var(--f-ui)",
                        color: 'var(--tx3)',
                        letterSpacing: '.06em',
                      }}
                    >
                      ▼ 明日から先の復習
                    </span>
                    <span style={{ flex: 1, borderTop: '1px dashed var(--line2)' }} />
                  </div>
                ) : null}
                <div
                  className="review-table-row hv-bg3"
                  onClick={() => store.setState({ revSel: r.id })}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: GRID_COLUMNS,
                    gap: '0 10px',
                    alignItems: 'center',
                    padding: '9px 14px 9px 11px',
                    borderBottom: '1px solid var(--line)',
                    borderLeft: '3px solid ' + color.c,
                    background:
                      !r.done && r.due <= T
                        ? 'color-mix(in srgb, ' + color.c + ' 5%, transparent)'
                        : 'transparent',
                    cursor: 'pointer',
                    opacity: r.done ? 0.45 : 1,
                  }}
                >
                  <span className="rt-cell rt-cell-subj">
                    <span
                      style={{
                        font: "700 10px var(--f-ui)",
                        color: color.c,
                        background: color.bg,
                        borderRadius: 'var(--rad-s)',
                        padding: '2px 8px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.subj}
                    </span>
                  </span>
                  <span
                    className="rt-cell rt-cell-title"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}
                  >
                    <span
                      style={{
                        font: "500 12.5px var(--f-ui)",
                        color: 'var(--tx0)',
                        textDecoration: deco,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.title}
                    </span>
                    {ttLabel ? (
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
                        {ttLabel}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="rt-cell rt-cell-last"
                    data-label="前回"
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--tx3)',
                      fontFamily: "var(--f-num)",
                    }}
                  >
                    {fmtD(ctx, r.last)}
                  </span>
                  <span
                    className="rt-cell rt-cell-next"
                    data-label="次回"
                    style={{
                      font: "700 11.5px var(--f-ui)",
                      color: r.done
                        ? 'var(--tx3)'
                        : r.due <= T
                          ? 'var(--pink)'
                          : 'var(--tx1)',
                    }}
                  >
                    {fmtD(ctx, r.due)}
                  </span>
                  <span className="rt-cell rt-cell-round" data-label="復習回">
                    <span
                      title={r.title + 'の' + roundLabel + '復習'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '48px',
                        font: "700 10.5px var(--f-ui)",
                        color: color.c,
                        background: color.bg,
                        border: '1px solid ' + color.c,
                        borderRadius: 'var(--rad-s)',
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {roundLabel}
                    </span>
                  </span>
                  <span
                    className="rt-cell rt-cell-stage"
                    data-label="間隔"
                    style={{ fontSize: '11px', color: 'var(--tx2)' }}
                  >
                    {r.stage}
                  </span>
                  <span className="rt-cell rt-cell-status" data-label="状態">
                    <span
                      style={{
                        font: "700 10px var(--f-ui)",
                        color: st.c,
                        background: st.bg,
                        borderRadius: 'var(--rad-s)',
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {st.label}
                    </span>
                  </span>
                  <span
                    className="rt-cell rt-cell-actions"
                    style={{
                      display: 'flex',
                      gap: '6px',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                    }}
                  >
                    {canAdd ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowAdd(r);
                        }}
                        style={{
                          font: "700 10.5px var(--f-ui)",
                          color: 'var(--onAcc)',
                          background: 'var(--grn)',
                          border: 'none',
                          borderRadius: 'var(--rad-s)',
                          padding: '4px 10px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        ＋ 今日へ
                      </button>
                    ) : null}
                    {isAddedToToday(r) ? (
                      <span
                        style={{
                          font: "700 10.5px var(--f-ui)",
                          color: 'var(--grn)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✓ 追加済み
                      </span>
                    ) : null}
                    {canComplete(r, T) ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openAsk(store, r.id);
                        }}
                        style={{
                          font: "500 10.5px var(--f-ui)",
                          color: 'var(--tx2)',
                          background: 'none',
                          border: '1px solid var(--line2)',
                          borderRadius: 'var(--rad-s)',
                          padding: '4px 10px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        完了
                      </button>
                    ) : null}
                    <button
                      className="hv-acc-border"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.setState({ revSel: r.id });
                      }}
                      style={{
                        width: '24px',
                        height: '24px',
                        border: '1px solid var(--line2)',
                        borderRadius: 'var(--rad-s)',
                        background: 'none',
                        color: 'var(--tx2)',
                        cursor: 'pointer',
                        fontSize: '13px',
                        lineHeight: 1,
                        flex: 'none',
                      }}
                    >
                      ⋯
                    </button>
                  </span>
                </div>
              </Fragment>
            );
          })}
          <div
            className="review-table-foot"
            style={{ padding: '9px 14px', fontSize: '11px', color: 'var(--tx3)' }}
          >
            {FOOTER_TEXT}
          </div>
        </div>
      </div>
      {/* ShellOverlay で .compass-theme-mode 直下へポータルする（この位置に DOM は出ない） */}
      <ReviewDetail />
      {/* 理解度モーダル（`ReviewAskModal`）は Cockpit / ToDo / 集中モードの `openAsk` からも
          開くので、`CompassApp` に 1 個だけ置いてある（ここでは描かない。二重描画になる） */}
    </div>
  );
}
