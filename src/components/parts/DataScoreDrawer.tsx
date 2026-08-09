'use client';

/**
 * Compass — 点数推移ドロワー（Phase 2B / TASK S5）
 *
 * 移植元:
 *  - テンプレート HTML:1690-1734（`sc-if scOpen` のドロワー本体）
 *  - 値・ハンドラ HTML:3468-3492（`scArr` / `scX` / `scY` / `scPts` / `scDots` / `scScoreRows`）、
 *    4128-4130（`scW` / `scResize`）、4184（`stopProp`）、4317-4327（`scName` 以下の表示値）
 *  - spec §8.3 / C-442〜C-454
 *
 * `.compass-shell` は `overflow:hidden` + `isolation:isolate` なので、呼び出し側で
 * `<ShellOverlay>` に包んで `.compass-theme-mode` 直下へポータルすること。
 *
 * 開閉条件（`scOpen = scArr.length > 0`）の判定は呼び出し側（DataScreen）。
 * ここは **`scArr` が 1 件以上ある前提**で描画する。
 */

import { Fragment, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { daysUntil, fmtMD, type DateContext } from '../../lib/logic/dates';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import type { AppState, Score } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { savePrefs } from './ShellPrefs';
import { makeResizer } from './ShellResizer';

export interface DataScoreDrawerProps {
  state: AppState;
  store: CompassStore;
  ctx: DateContext;
  subjColors: SubjColors;
  /** `scGroupMap[S.scoreSel]`（日付昇順・1件以上）。HTML:3468 */
  scArr: readonly Score[];
}

const tileStyle: CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 'var(--rad-s)',
  padding: '9px 10px',
};

const tileLabelStyle: CSSProperties = { fontSize: '10px', color: 'var(--tx3)' };

export function DataScoreDrawer({ state, store, ctx, subjColors, scArr }: DataScoreDrawerProps) {
  const S = state;
  const T = ctx.today;

  // HTML:3470-3482
  const scLast = scArr[scArr.length - 1];
  const scPrev = scArr.length > 1 ? scArr[scArr.length - 2] : null;
  const scDv = scPrev && scLast ? scLast.score - scPrev.score : null;
  const scSub = subjectColorFor(subjColors, scLast.subj);

  // 座標変換（HTML:3471-3474）。X 軸は日付の実距離に比例（等間隔ではない, C-446/C-447）
  const scMinD = daysUntil(ctx, scArr[0].day);
  const scMaxD = daysUntil(ctx, scLast.day);
  const scX = (d: number): number =>
    scMaxD === scMinD ? 184 : 30 + ((d - scMinD) / (scMaxD - scMinD)) * 308;
  const scY = (v: number): number => 14 + ((100 - v) / 100) * 156;

  const scPts = scArr
    .map((sc) => scX(daysUntil(ctx, sc.day)).toFixed(1) + ',' + scY(sc.score).toFixed(1))
    .join(' ');
  const scDots = scArr.map((sc) => ({
    id: sc.id,
    cx: scX(daysUntil(ctx, sc.day)).toFixed(1),
    cy: scY(sc.score).toFixed(1),
    label: sc.score,
    labelY: (scY(sc.score) - 8).toFixed(1),
    dayLabel: fmtMD(sc.day),
  }));

  // HTML:3483-3492（reverse 後なので all[i+1] が「1つ古い記録」）
  const scRows = scArr
    .slice()
    .reverse()
    .map((sc, i, all) => {
      const before = all[i + 1];
      const d2 = before ? sc.score - before.score : null;
      return {
        id: sc.id,
        dayLabel: fmtMD(sc.day) + (sc.day === T ? '(今日)' : ''),
        score: sc.score,
        delta: d2 == null ? '' : d2 > 0 ? '+' + d2 : String(d2),
        deltaC:
          d2 == null
            ? 'var(--tx3)'
            : d2 > 0
              ? 'var(--grn)'
              : d2 < 0
                ? 'var(--pink)'
                : 'var(--tx3)',
        onRemove: () =>
          store.setState((s) => ({ scores: s.scores.filter((x) => x.id !== sc.id) })),
      };
    });

  // HTML:4322-4326
  const scDelta = scDv == null ? '–' : scDv > 0 ? '▲ +' + scDv : scDv < 0 ? '▼ ' + scDv : '± 0';
  const scDeltaC =
    scDv == null
      ? 'var(--tx3)'
      : scDv > 0
        ? 'var(--grn)'
        : scDv < 0
          ? 'var(--pink)'
          : 'var(--tx3)';
  const scBest = Math.max.apply(
    null,
    scArr.map((x) => x.score)
  );
  const scAvg = Math.round(scArr.reduce((a, b) => a + b.score, 0) / scArr.length);

  const closeSc = () => store.setState({ scoreSel: null });
  const stopProp = (e: ReactMouseEvent) => e.stopPropagation();
  const scResize = makeResizer(store, 'score', 'left', () => savePrefs(store));

  return (
    <div
      onClick={closeSc}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5,9,20,.45)',
        zIndex: 45,
        animation: 'fadeIn .15s ease',
      }}
    >
      <div
        onClick={stopProp}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: S.panelW.score + 'px',
          maxWidth: '94vw',
          background: 'var(--bg1)',
          borderLeft: '1px solid var(--line2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          padding: '18px',
          animation: 'slideInR .2s ease',
          boxShadow: '-12px 0 40px rgba(5,10,25,.45)',
        }}
      >
        <div
          onMouseDown={scResize}
          style={{
            position: 'absolute',
            left: '-3px',
            top: 0,
            bottom: 0,
            width: '7px',
            cursor: 'ew-resize',
            zIndex: 5,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              font: "700 11px var(--f-ui)",
              color: scSub.c,
              background: scSub.bg,
              borderRadius: 'var(--rad-s)',
              padding: '3px 10px',
              flex: 'none',
            }}
          >
            {scLast.subj}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: "700 14px var(--f-ui)",
              color: 'var(--tx0)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {S.scoreSel || ''}
          </span>
          <button
            type="button"
            onClick={closeSc}
            style={{
              width: '26px',
              height: '26px',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--rad-s)',
              background: 'none',
              color: 'var(--tx2)',
              cursor: 'pointer',
              fontSize: '12px',
              flex: 'none',
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
          <div style={tileStyle}>
            <div style={tileLabelStyle}>最新</div>
            <div
              style={{
                font: "700 16px var(--f-num)",
                color: scSub.c,
                marginTop: '2px',
              }}
            >
              {scLast.score}
              <span style={{ fontSize: '10px' }}>点</span>
            </div>
          </div>
          <div style={tileStyle}>
            <div style={tileLabelStyle}>前回比</div>
            <div
              style={{ font: "700 15px var(--f-num)", color: scDeltaC, marginTop: '3px' }}
            >
              {scDelta}
            </div>
          </div>
          <div style={tileStyle}>
            <div style={tileLabelStyle}>最高</div>
            <div
              style={{ font: "700 16px var(--f-num)", color: 'var(--tx0)', marginTop: '2px' }}
            >
              {scBest}
              <span style={{ fontSize: '10px' }}>点</span>
            </div>
          </div>
          <div style={tileStyle}>
            <div style={tileLabelStyle}>平均</div>
            <div
              style={{ font: "700 16px var(--f-num)", color: 'var(--tx0)', marginTop: '2px' }}
            >
              {scAvg}
              <span style={{ fontSize: '10px' }}>点</span>
            </div>
          </div>
        </div>
        <div style={{ background: 'var(--bg2)', borderRadius: 'var(--rad)', padding: '12px 8px 6px' }}>
          <svg viewBox="0 0 360 200" style={{ width: '100%', height: 'auto' }}>
            <line x1="30" y1="14" x2="338" y2="14" stroke="var(--line)" strokeWidth="1" />
            <line x1="30" y1="92" x2="338" y2="92" stroke="var(--line)" strokeWidth="1" />
            <line x1="30" y1="170" x2="338" y2="170" stroke="var(--line)" strokeWidth="1" />
            <text
              x="24"
              y="18"
              textAnchor="end"
              style={{ font: "10px var(--f-num)", fill: 'var(--tx3)' }}
            >
              100
            </text>
            <text
              x="24"
              y="96"
              textAnchor="end"
              style={{ font: "10px var(--f-num)", fill: 'var(--tx3)' }}
            >
              50
            </text>
            <text
              x="24"
              y="174"
              textAnchor="end"
              style={{ font: "10px var(--f-num)", fill: 'var(--tx3)' }}
            >
              0
            </text>
            <polyline points={scPts} fill="none" stroke={scSub.c} strokeWidth="2" />
            {/* `sc-for` は兄弟として展開されるので `<g>` で包まない（Fragment はDOMを作らない） */}
            {scDots.map((d) => (
              <Fragment key={d.id}>
                <circle cx={d.cx} cy={d.cy} r="3.5" fill={scSub.c} />
                <text
                  x={d.cx}
                  y={d.labelY}
                  textAnchor="middle"
                  style={{ font: "700 10px var(--f-num)", fill: scSub.c }}
                >
                  {d.label}
                </text>
                <text
                  x={d.cx}
                  y="188"
                  textAnchor="middle"
                  style={{ font: "9px var(--f-num)", fill: 'var(--tx3)' }}
                >
                  {d.dayLabel}
                </text>
              </Fragment>
            ))}
          </svg>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>
          記録の履歴 — 同じテスト名で追加すると、ここにつながります
        </div>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
          }}
        >
          {scRows.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                background: 'var(--bg2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--rad-s)',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: '11.5px',
                  color: 'var(--tx2)',
                  fontFamily: "var(--f-num)",
                }}
              >
                {r.dayLabel}
              </span>
              <span style={{ font: "700 10.5px var(--f-num)", color: r.deltaC }}>
                {r.delta}
              </span>
              <span style={{ font: "700 14px var(--f-num)", color: 'var(--tx0)' }}>
                {r.score}
                <span style={{ fontSize: '9px' }}>点</span>
              </span>
              <button
                type="button"
                className="hv-pink-text"
                onClick={r.onRemove}
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
      </div>
    </div>
  );
}
