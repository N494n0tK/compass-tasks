'use client';

/**
 * Compass — 集中モード（Phase 2B / TASK S3）
 *
 * 移植元: HTML:1854-1866（テンプレート）、4048-4076（`focusItem` / タイマー / プリセット /
 * `completeFocusTask`）、4235-4245（renderVals）。spec §5.6 / パリティ C-276〜C-287。
 *
 * DOM 位置はレガシーと同じ **`.compass-shell` の外・`.compass-theme-mode` 直下**
 * （`<ShellOverlay>` でポータル）。`position:fixed` がシェルの `isolation:isolate` に
 * 閉じ込められないようにするため（ShellOverlay の注記）。
 *
 * ## タイマー（唯一のタイマー）
 * レガシーは `this._focusTimer`（`setInterval`）をコンポーネントのインスタンスに持ち、
 * `closeFocus` / `setFocusPreset` / Escape / Undo のたびに `clearInterval` していた。
 * ここでは **`state.focusRunning` を購読する effect** にしてある（architecture §3 /
 * store.ts の注記）。`focusRunning:false` になれば cleanup が確実に走るので、
 * Escape（CompassApp）も Undo（store）も余分な後始末なしにタイマーを止められる。
 */

import { useEffect } from 'react';
import type { AppState } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { mutExtra, mutSeg } from './ShellActions';
import { ShellOverlay } from './ShellOverlay';
import type { TodayItem } from './ShellTodayItems';
import { openAsk } from './TodoActions';

/** タイマーが 0 になったとき（HTML:4058） */
export const TOAST_FOCUS_END = '集中時間が終了しました。おつかれさま！';

/** `focusPresets`（HTML:4074）= 15分 / 25分 / 45分 */
export const FOCUS_PRESETS: readonly number[] = [15, 25, 45];

/**
 * `focusItem`（HTML:4049）
 * = 「選択中かつ未完了」→ 無ければ「今日のリストで最初の未完了」→ 無ければ null。
 */
export function focusItemOf(
  items: readonly TodayItem[],
  selId: string | null
): TodayItem | null {
  return (
    items.find((it) => it.id === selId && !it.done) || items.find((it) => !it.done) || null
  );
}

/** `focusTime`（HTML:4050）— `MM:SS`（どちらも `padStart(2,'0')`） */
export function focusTimeLabel(remaining: number): string {
  return (
    String(Math.floor(remaining / 60)).padStart(2, '0') +
    ':' +
    String(remaining % 60).padStart(2, '0')
  );
}

export interface TodoFocusOverlayProps {
  state: AppState;
  store: CompassStore;
  /** `buildTodayItems(...)` の結果（`parts/ShellTodayItems`） */
  todayItems: readonly TodayItem[];
}

export function TodoFocusOverlay({ state, store, todayItems }: TodoFocusOverlayProps) {
  const S = state;

  // ── `toggleFocus` の `setInterval`（HTML:4056-4063）を effect に置き換えたもの
  useEffect(() => {
    if (!S.focusRunning) return;
    const timer = setInterval(() => {
      store.setState((st) => {
        if (st.focusRemaining <= 1) {
          // レガシーどおり setState の更新関数から出てから出す（HTML:4058）
          setTimeout(() => store.showToast(TOAST_FOCUS_END), 0);
          return { focusRemaining: 0, focusRunning: false };
        }
        return { focusRemaining: st.focusRemaining - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [S.focusRunning, store]);

  if (!S.focusOpen) return null;

  const focusItem = focusItemOf(todayItems, S.selId);

  /** `closeFocus`（HTML:4052）。タイマー停止は上の effect の cleanup が担当 */
  const closeFocus = () => store.setState({ focusOpen: false, focusRunning: false });

  /** `setFocusPreset(min)`（HTML:4065） */
  const setFocusPreset = (min: number) =>
    store.setState({ focusPreset: min, focusRemaining: min * 60, focusRunning: false });

  /** `toggleFocus`（HTML:4053-4064）— 実行中なら停止、停止中なら開始 */
  const toggleFocus = () => {
    if (S.focusRunning) {
      store.setState({ focusRunning: false });
      return;
    }
    store.setState({ focusRunning: true });
  };

  /** HTML:4244 — 残 0 のときは「もう一度」＝現在のプリセットにリセット */
  const onToggleClick = () => {
    if (S.focusRemaining === 0) {
      setFocusPreset(S.focusPreset || 25);
      return;
    }
    toggleFocus();
  };

  /** `completeFocusTask`（HTML:4066-4073） */
  const completeFocusTask = () => {
    if (!focusItem) return;
    if (focusItem.kind === 'seg') mutSeg(store, focusItem.id, (x) => ((x.done = true), x));
    else if (focusItem.kind === 'extra')
      mutExtra(store, focusItem.id, (x) => ((x.done = true), x));
    else {
      // 復習は理解度モーダルへ回す（トーストは出ない）
      closeFocus();
      openAsk(store, focusItem.id);
      return;
    }
    closeFocus();
    store.showToast('「' + focusItem.title + '」を完了しました');
  };

  const focusToggleLabel = S.focusRunning
    ? '一時停止'
    : S.focusRemaining === 0
      ? 'もう一度'
      : '▶ 集中開始';

  return (
    <ShellOverlay>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 65,
          background: 'color-mix(in srgb,var(--bg0) 92%,black)',
          backdropFilter: 'blur(16px)',
          display: 'grid',
          placeItems: 'center',
          animation: 'fadeIn .18s ease',
        }}
      >
        <div
          style={{
            width: 'min(560px,92vw)',
            padding: '28px',
            background: 'var(--bg1)',
            border: '1px solid var(--line2)',
            borderRadius: 'var(--rad)',
            boxShadow: '0 30px 100px rgba(0,0,0,.55)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ width: '100%', display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                font: "700 12px var(--f-ui)",
                color: 'var(--acc)',
                letterSpacing: '.08em',
              }}
            >
              FOCUS MODE
            </span>
            <button
              onClick={closeFocus}
              style={{
                marginLeft: 'auto',
                width: '30px',
                height: '30px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'none',
                color: 'var(--tx2)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
          <div>
            <div style={{ font: "700 20px var(--f-ui)", color: 'var(--tx0)' }}>
              {focusItem ? focusItem.title : '今日のタスクはありません'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--tx3)', marginTop: '6px' }}>
              {focusItem
                ? focusItem.subj + ' · ' + focusItem.min + '分 · ' + focusItem.src
                : '先にToDoへタスクを追加してください'}
            </div>
          </div>
          <div
            style={{
              width: '210px',
              height: '210px',
              border: '10px solid var(--line)',
              borderTopColor: 'var(--acc)',
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              boxShadow: 'var(--gAcc)',
            }}
          >
            <span
              style={{
                font: "700 48px var(--f-num)",
                color: 'var(--tx0)',
                letterSpacing: '.03em',
              }}
            >
              {focusTimeLabel(S.focusRemaining)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '7px' }}>
            {FOCUS_PRESETS.map((min) => (
              <button
                key={min}
                onClick={() => setFocusPreset(min)}
                style={{
                  padding: '6px 13px',
                  border:
                    '1px solid ' + (S.focusPreset === min ? 'var(--acc)' : 'var(--line2)'),
                  borderRadius: 'var(--rad-s)',
                  background: S.focusPreset === min ? 'var(--acc)' : 'var(--bg2)',
                  color: S.focusPreset === min ? 'var(--onAcc)' : 'var(--tx2)',
                  font: "700 11px var(--f-num)",
                  cursor: 'pointer',
                }}
              >
                {min + '分'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <button
              onClick={onToggleClick}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--acc)',
                color: 'var(--onAcc)',
                font: "700 13px var(--f-ui)",
                cursor: 'pointer',
              }}
            >
              {focusToggleLabel}
            </button>
            {focusItem ? (
              <button
                onClick={completeFocusTask}
                style={{
                  flex: 1,
                  padding: '12px',
                  border: '1px solid var(--grn)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--grnBg)',
                  color: 'var(--grn)',
                  font: "700 13px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                ✓ タスク完了
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </ShellOverlay>
  );
}
