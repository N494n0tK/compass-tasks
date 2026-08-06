'use client';

/**
 * Compass — 左ナビ（モバイルでは下部バー）（Phase 2B / TASK S0）
 *
 * 出典: HTML:863-918（テンプレート）、2680-2708（`views` / `navItems`）、
 * 4078-4096（`countdownRows` / `addCountdown`）、4097-4098（cloud ラベル）、
 * 4137-4143（テーマスイッチ）。spec §2.3 / C-44〜C-69 / C-41〜C-43。
 *
 * モバイルの下部バー化・FAB は CSS だけで起きる（globals.css の ≤820px ブロック）。
 * `.nav-dot` は `display:none!important` だが **span 自体は出力する**（`.app-nav-item span` の
 * 子数ルールに関係する, css-notes §2.3）。
 */

import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { daysUntil, fmtMD, type DateContext } from '../../lib/logic/dates';
import type { AppState, Countdown, ViewId } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { ALL_VIEW_IDS, VIEWS, normalizeNavOrder } from './ShellTheme';

/** `cloudStatusMap`（HTML:4097）。`login` は architecture §5 で到達不能だが表引きは残す */
const CLOUD_STATUS_MAP: Readonly<Record<string, string>> = {
  loading: '同期中',
  saving: '保存中',
  saved: '保存済み',
  local: '端末保存',
  login: '未ログイン',
};

/** カウントダウン検証の失敗（HTML:4092） */
export const TOAST_COUNTDOWN_INVALID = '名前と日付を入力してください';
/** カウントダウン追加の成功（HTML:4095） */
export const TOAST_COUNTDOWN_ADDED = 'カウントダウンを追加しました';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export interface ShellNavProps {
  state: AppState;
  store: CompassStore;
  ctx: DateContext;
  /**
   * `overdue.length`（HTML:2689 / `overdueSegs`）。
   * **(v0.9)** 手動配置(manualDay)でも遅れていることに変わりはないので数える。
   * トップバーのピルと同じ値を使うため `CompassApp` で 1 回だけ計算して渡す。
   */
  overdueCount: number;
  savePrefs: () => void;
  onOpenAppSwitcher: () => void;
  onNavResize: (e: ReactMouseEvent) => void;
}

export function ShellNav({
  state,
  store,
  ctx,
  overdueCount,
  savePrefs,
  onOpenAppSwitcher,
  onNavResize,
}: ShellNavProps) {
  const S = state;
  const T = ctx.today;
  const navW = S.panelW.nav + 'px';

  const orderedViews = normalizeNavOrder(S.navOrder)
    .map((id) => VIEWS.find((v) => v.id === id))
    .filter((v): v is (typeof VIEWS)[number] => !!v);

  // ── カウントダウン（HTML:4078-4096）
  const countdownRows = (S.countdowns || [])
    .map((c: Countdown) => {
      const diff = daysUntil(ctx, c.date);
      return {
        id: c.id,
        title: c.title,
        date: c.date,
        dateLabel: fmtMD(c.date),
        days: diff === 0 ? '今日' : diff > 0 ? diff + '日' : Math.abs(diff) + '日前',
        c: diff < 0 ? 'var(--tx3)' : diff <= 3 ? 'var(--pink)' : 'var(--acc)',
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const addCountdown = () => {
    const title = (store.getState().countdownTitle || '').trim();
    const date = store.getState().countdownDate || T;
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      store.showToast(TOAST_COUNTDOWN_INVALID);
      return;
    }
    const id = 'cd' + Date.now().toString(36) + Math.floor(Math.random() * 99);
    store.setState((s) => ({
      countdowns: (s.countdowns || []).concat([{ id, title, date }]),
      countdownTitle: '',
      countdownDate: date,
    }));
    store.showToast(TOAST_COUNTDOWN_ADDED);
  };

  const light = S.theme === 'light';
  const note = S.theme === 'note';
  const setTheme = (theme: AppState['theme']) =>
    store.setState({ theme, themeVersion: 3 }, () => savePrefs());

  return (
    <div
      className="compass-nav"
      style={cssVars({
        '--nav-width': navW,
        position: 'relative',
        width: navW,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '16px 12px',
        borderRight: '1px solid var(--line)',
        background: 'var(--bg2)',
      })}
    >
      <div
        onMouseDown={onNavResize}
        style={{
          position: 'absolute',
          right: '-3px',
          top: 0,
          bottom: 0,
          width: '7px',
          cursor: 'ew-resize',
          zIndex: 20,
        }}
      ></div>
      <button
        type="button"
        className="compass-brand"
        onClick={onOpenAppSwitcher}
        aria-label="Compassアプリ一覧を開く"
        aria-haspopup="dialog"
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px 16px' }}
      >
        <div className="compass-brand__mark" aria-label="Compass">
          <img
            src="/compass-icon.svg?v=20260728-ink"
            alt=""
            width="34"
            height="34"
            style={{ display: 'block' }}
          />
        </div>
        <div className="compass-brand__text">
          <div className="compass-brand__name">Compass</div>
          <div className="compass-brand__tag">学習コックピット</div>
        </div>
        <span className="compass-brand__chevron" aria-hidden="true">
          ↗
        </span>
      </button>
      {orderedViews.map((v, vi) => {
        const active = S.view === v.id;
        const dragClass =
          (S.dragNav === v.id ? 'is-dragging ' : '') + (S.navDragOver === v.id ? 'is-dragover' : '');
        const badge = v.id === 'tests' && overdueCount ? '⚠' + overdueCount : false;
        return (
          <button
            key={v.id}
            type="button"
            draggable
            className={'app-nav-item ' + (active ? 'is-active' : '') + ' ' + dragClass}
            data-nav={v.id}
            onDragStart={(e) => {
              store.setState({ dragNav: v.id });
              try {
                e.dataTransfer.setData('text/plain', v.id);
                e.dataTransfer.effectAllowed = 'move';
              } catch {
                /* レガシーも握りつぶす */
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const dragNav = store.getState().dragNav;
              if (dragNav && dragNav !== v.id) store.setState({ navDragOver: v.id });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = store.getState().dragNav;
              if (!from || from === v.id) return;
              store.setState((s) => {
                const a = ((s.navOrder || ALL_VIEW_IDS) as ViewId[]).filter(
                  (id) => ALL_VIEW_IDS.indexOf(id) >= 0
                );
                const fi = a.indexOf(from);
                const ti = a.indexOf(v.id);
                if (fi < 0 || ti < 0) return { dragNav: null, navDragOver: null };
                a.splice(fi, 1);
                a.splice(ti, 0, from);
                return { navOrder: a, dragNav: null, navDragOver: null };
              });
            }}
            onDragEnd={() => store.setState({ dragNav: null, navDragOver: null })}
            onClick={() => store.setState({ view: v.id })}
            style={cssVars({
              '--nav-hue': v.dot,
              background: 'transparent',
              border: '1px solid transparent',
            })}
          >
            <span
              className="nav-dot"
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '99px',
                background: v.dot,
                boxShadow: active ? v.g : 'none',
              }}
            ></span>
            <span
              className="app-nav-item__label"
              style={{ flex: 1, color: active ? v.dot : 'var(--tx2)' }}
            >
              {v.label}
            </span>
            {badge ? <span className="app-nav-item__badge">{badge}</span> : null}
            <span className="app-nav-item__key" aria-hidden="true">
              {String(vi + 1)}
            </span>
          </button>
        );
      })}
      <div
        className="compass-nav-footer"
        style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div
          style={{
            padding: '10px 12px',
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: 'var(--tx3)', flex: 1 }}>カウントダウン</div>
            <span style={{ font: "700 10px 'Space Grotesk'", color: 'var(--tx3)' }}>
              {countdownRows.length}件
            </span>
          </div>
          {countdownRows.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--tx3)', lineHeight: 1.4 }}>
              下で自由に追加できます
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              maxHeight: '118px',
              overflow: 'auto',
            }}
          >
            {countdownRows.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto 20px',
                  gap: '6px',
                  alignItems: 'center',
                  padding: '6px 7px',
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      font: "700 11px 'Noto Sans JP'",
                      color: 'var(--tx0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ fontSize: '9.5px', color: 'var(--tx3)' }}>{c.dateLabel}</div>
                </div>
                <div
                  style={{ font: "700 16px 'Space Grotesk'", color: c.c, whiteSpace: 'nowrap' }}
                >
                  {c.days}
                </div>
                <button
                  className="hv-pink-text"
                  onClick={() =>
                    store.setState((s) => ({
                      countdowns: (s.countdowns || []).filter((x) => x.id !== c.id),
                    }))
                  }
                  style={{
                    width: '20px',
                    height: '20px',
                    border: 'none',
                    borderRadius: '6px',
                    background: 'none',
                    color: 'var(--tx3)',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <input
            className="fc-acc"
            value={S.countdownTitle}
            onChange={(e) => store.setState({ countdownTitle: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCountdown();
            }}
            placeholder="テスト名"
            style={{
              width: '100%',
              padding: '7px 8px',
              border: '1px solid var(--line2)',
              borderRadius: '8px',
              background: 'var(--bg2)',
              color: 'var(--tx0)',
              font: "500 11.5px 'Noto Sans JP'",
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className="fc-acc"
              type="date"
              value={S.countdownDate}
              onChange={(e) => store.setState({ countdownDate: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCountdown();
              }}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 8px',
                border: '1px solid var(--line2)',
                borderRadius: '8px',
                background: 'var(--bg2)',
                color: 'var(--tx0)',
                font: "600 10.5px 'Space Grotesk'",
                outline: 'none',
                // HTML:903 には color-scheme の指定が無い（付いているのは 1317/1381/1390/1599）。
                // `:root{color-scheme:dark}` のまま = ライトテーマでもピッカーは dark。レガシーどおり
              }}
            />
            <button
              onClick={addCountdown}
              style={{
                width: '34px',
                border: 'none',
                borderRadius: '8px',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 14px 'Noto Sans JP'",
                cursor: 'pointer',
                boxShadow: 'var(--gAcc)',
              }}
            >
              ＋
            </button>
          </div>
        </div>
        <div className="theme-switch" role="group" aria-label="テーマ">
          <span
            onClick={() => setTheme('note')}
            style={{
              color: note ? 'var(--onAcc)' : 'var(--tx3)',
              background: note ? 'var(--acc)' : 'transparent',
            }}
          >
            ✎ ノート
          </span>
          <span
            onClick={() => setTheme('dark')}
            style={{
              color: !light && !note ? 'var(--onAcc)' : 'var(--tx3)',
              background: !light && !note ? 'var(--acc)' : 'transparent',
            }}
          >
            ✦ ダーク
          </span>
          <span
            onClick={() => setTheme('light')}
            style={{
              color: light ? 'var(--onAcc)' : 'var(--tx3)',
              background: light ? 'var(--acc)' : 'transparent',
            }}
          >
            ☀ ライト
          </span>
        </div>
        <div className="nav-shortcuts" aria-hidden="true">
          <span>
            <kbd>1</kbd>–<kbd>6</kbd> 画面
          </span>
          <span>
            <kbd>/</kbd> 検索
          </span>
          <span>
            <kbd>N</kbd> 追加
          </span>
          <span>
            <kbd>F</kbd> 集中
          </span>
        </div>
        <div className="nav-cloud">
          {(CLOUD_STATUS_MAP[S.cloudStatus] || '保存待ち') + ' · ' + (S.cloudUser || 'gmail.com')}
        </div>
        <div className="nav-version">Compass v0.8</div>
      </div>
    </div>
  );
}
