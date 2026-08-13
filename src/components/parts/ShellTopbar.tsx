'use client';

/**
 * Compass — トップバー + 検索ポップオーバー（Phase 2B / TASK S0）
 *
 * 出典: HTML:922-965（テンプレート）、4130-4133（`todayHeader` / `viewTitle` / `viewSub`）、
 * 4196-4206（検索の開閉と結果）、4232（`donutPct`）、4247（`doneCount` / `totalCount`）、
 * 4155-4157（`hasOverdue` / `openRedist`）。spec §2.4 / §2.5 / C-100〜C-128。
 *
 * DOM 順は ランチャー → `.app-search` → `.app-view-title` → `.app-top-actions` → `.app-progress`。
 * 見た目の並びは CSS の `order`（0/2/1/3）が担当するので **DOM 順を変えないこと**（C-100）。
 */

import type { CSSProperties } from 'react';
import type { DateContext } from '../../lib/logic/dates';
import type { SubjColors } from '../../lib/logic/subjects';
import type { AppState, Plans } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { addToOrder, mutReview, mutSeg } from './ShellActions';
import {
  buildSearchResults,
  buildSubjChips,
  canonicalSubject,
  makeSearchMatcher,
  searchAddReviewToast,
  searchAddSegToast,
} from './ShellSearch';
import { TITLES } from './ShellTheme';
import { todayTotals, type TodayItem } from './ShellTodayItems';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export interface ShellTopbarProps {
  state: AppState;
  plans: Plans;
  store: CompassStore;
  ctx: DateContext;
  subjColors: SubjColors;
  todayItems: readonly TodayItem[];
  /** `overdue.length`（HTML:2689）。ナビのバッジと同じ数え方 */
  overdueCount: number;
  onOpenAppSwitcher: () => void;
}

export function ShellTopbar({
  state,
  plans,
  store,
  ctx,
  subjColors,
  todayItems,
  overdueCount,
  onOpenAppSwitcher,
}: ShellTopbarProps) {
  const S = state;
  const T = ctx.today;
  const matcher = makeSearchMatcher(S);
  const { q } = matcher;
  const totals = todayTotals(todayItems);
  // ノートのタブだけは中に 2 つの面がある（読む面 / その授業の今日ぶんを解くドリル面）。
  // ドリルに入っているあいだは見出しもそれに合わせる
  const title: readonly [string, string] =
    S.view === 'notebook' && S.nbMode === 'drill'
      ? ['今日の復習', 'この授業の、今日ぶんの問題だけを解く']
      : TITLES[S.view];
  // `parseInt(T.slice(5,7),10)+'月'+parseInt(T.slice(8,10),10)+'日('+DAYS[0].dow+')'`（HTML:4130）
  const todayHeader =
    parseInt(T.slice(5, 7), 10) +
    '月' +
    parseInt(T.slice(8, 10), 10) +
    '日(' +
    ctx.days[0].dow +
    ')';

  const subjChips = S.searchOpen ? buildSubjChips(subjColors, q) : [];
  const searchResults = S.searchOpen
    ? buildSearchResults(S, plans, subjColors, ctx, matcher)
    : [];

  return (
    <div
      className="compass-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '12px 20px',
        borderBottom: '1px solid var(--line)',
        flex: 'none',
      }}
    >
      <button
        type="button"
        className="mobile-app-launcher"
        onClick={onOpenAppSwitcher}
        aria-label="Compassアプリ一覧を開く"
        aria-haspopup="dialog"
      >
        <img src="/compass-icon.svg?v=20260728-ink" alt="" width="25" height="25" />
      </button>
      <div className="app-search">
        <svg width="14" height="14" viewBox="0 0 20 20">
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2"></circle>
          <line
            x1="13.5"
            y1="13.5"
            x2="18"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          ></line>
        </svg>
        <input
          id="app-search-input"
          className="app-search-input"
          value={S.query}
          onChange={(e) => store.setState({ query: e.target.value })}
          onFocus={() => store.setState({ searchOpen: true })}
          placeholder="タスク名・教科で検索…"
          aria-label="タスク名・教科で検索"
        />
        {S.query.trim().length > 0 ? (
          <button
            className="app-search-clear"
            onClick={() => store.setState({ query: '', searchOpen: true })}
            aria-label="検索語を消去"
          >
            ✕
          </button>
        ) : null}
        <span className="app-search-shortcut">⌘K</span>
        {S.searchOpen ? (
          <div className="app-search-popover">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ font: "700 12px var(--f-ui)", color: 'var(--tx0)' }}>検索</span>
              <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
                入力と同時に絞り込みます
              </span>
              <button
                className="app-search-clear"
                onClick={() => store.setState({ searchOpen: false, query: '' })}
                aria-label="検索を閉じる"
                style={{ marginLeft: 'auto' }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>教科で絞り込み</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {subjChips.map((s) => (
                <span
                  key={s.name}
                  onClick={() =>
                    store.setState({
                      query: canonicalSubject(store.getState().query) === s.name ? '' : s.name,
                      searchOpen: true,
                    })
                  }
                  style={{
                    font: "700 10.5px var(--f-ui)",
                    color: s.c,
                    background: s.bg,
                    border: '1px solid ' + s.bd,
                    borderRadius: 'var(--rad-s)',
                    padding: '4px 10px',
                    cursor: 'pointer',
                  }}
                >
                  {s.name}
                </span>
              ))}
            </div>
            {q.length === 0 ? (
              <div
                style={{
                  padding: '18px 10px',
                  textAlign: 'center',
                  color: 'var(--tx3)',
                  fontSize: '11.5px',
                  borderTop: '1px solid var(--line)',
                }}
              >
                上のバーにタスク名または教科を入力してください
              </div>
            ) : null}
            {q.length > 0 ? (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--tx3)',
                  borderTop: '1px solid var(--line)',
                  paddingTop: '10px',
                }}
              >
                {'結果 ' + searchResults.length + '件 — 今日のToDoへ追加できます'}
              </div>
            ) : null}
            <div className="app-search-results">
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    padding: '9px 10px',
                    background: 'var(--bg2)',
                    borderRadius: 'var(--rad-s)',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: 'var(--rad-s)',
                      background: r.c,
                      flex: 'none',
                    }}
                  ></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        font: "500 12px var(--f-ui)",
                        color: 'var(--tx0)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.title}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>{r.where}</div>
                  </div>
                  {r.canAdd ? (
                    <button
                      onClick={() => {
                        if (r.kind === 'seg') {
                          mutSeg(store, r.id, (x) => ((x.day = T), x));
                          addToOrder(store, r.id);
                          store.showToast(searchAddSegToast(r.title));
                        } else if (r.kind === 'rev') {
                          mutReview(store, r.id, (x) => ((x.added = true), x));
                          addToOrder(store, r.id);
                          store.showToast(searchAddReviewToast(r.title));
                        }
                      }}
                      style={{
                        font: "700 10.5px var(--f-ui)",
                        color: 'var(--acc)',
                        background: 'var(--accBg)',
                        border: 'none',
                        borderRadius: 'var(--rad-s)',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        flex: 'none',
                      }}
                    >
                      ＋ 今日へ
                    </button>
                  ) : null}
                  {r.tag ? (
                    <span style={{ fontSize: '10px', color: 'var(--tx3)', flex: 'none' }}>
                      {r.tag}
                    </span>
                  ) : null}
                </div>
              ))}
              {q.length > 0 && searchResults.length === 0 ? (
                <div
                  style={{
                    padding: '18px 10px',
                    textAlign: 'center',
                    color: 'var(--tx3)',
                    fontSize: '11.5px',
                  }}
                >
                  一致するタスクがありません
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="app-view-title">
        <div className="app-view-title__name">{title[0]}</div>
        <div className="app-view-title__sub">{title[1]}</div>
      </div>
      <div
        className="app-top-actions"
        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        {overdueCount > 0 ? (
          <button
            className="app-alert-pill"
            onClick={() =>
              store.setState({
                view: 'tests',
                redistOpen: true,
                redistPlan: 'all',
                redistPickMode: false,
                redistMode: 'even',
              })
            }
          >
            {'⚠ 未完了 ' + overdueCount + '件 → 再配分'}
          </button>
        ) : null}
        <div className="app-day-meter" role="group" aria-label="今日の進捗">
          <span className="app-day-meter__date">{todayHeader}</span>
          <span className="app-day-meter__count">
            {totals.doneCount}
            <i>/</i>
            {totals.totalCount}
          </span>
        </div>
      </div>
      <div
        className="app-progress"
        role="progressbar"
        aria-label="今日の完了率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={totals.donutPct}
        style={cssVars({ '--done': totals.donutPct + '%' })}
      >
        <span></span>
      </div>
    </div>
  );
}
