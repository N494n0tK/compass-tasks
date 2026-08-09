'use client';

/**
 * Compass — アプリスイッチャー（Phase 2B / TASK S0）
 *
 * 出典: HTML:1868-1903（テンプレート）、2039-2043（`APP_CATALOG`）、4099-4110（`appSwitcherApps`）。
 * spec §2.9-7 / §10.15（C-456〜C-463）。
 *
 * `.app-switcher-backdrop` は `.compass-shell` の**外**（`.compass-theme-mode` 直下）に出す。
 * 外部アプリへの遷移は spec Q28 のまま `window.top.location.assign(url)`。
 */

import type { CSSProperties } from 'react';
import type { AppMode } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { APP_MODES } from './ShellTheme';

/** `this.APP_CATALOG`（HTML:2039-2043）。url を入れるだけで遷移が有効になる */
export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: string;
  accent: string;
  url: string;
}

export const APP_CATALOG: readonly AppCatalogEntry[] = [
  {
    id: 'gratitude-note',
    name: '感謝ノート',
    description: '毎日の「ありがとう」を残すノート',
    icon: '♡',
    status: '公開中',
    accent: '#ff8fb8',
    url: 'https://kansha-note.vercel.app/',
  },
  {
    id: 'future-app-1',
    name: '次のアプリ',
    description: '新しいCompassアプリのための場所',
    icon: '＋',
    status: 'COMING SOON',
    accent: '#9a79f6',
    url: '',
  },
  {
    id: 'future-app-2',
    name: 'アプリを追加',
    description: 'これから増えるアプリをここに並べます',
    icon: '＋',
    status: 'COMING SOON',
    accent: '#43e6b1',
    url: '',
  },
];

/** 準備中タイルのトースト（HTML:4108） */
export const comingSoonToast = (name: string) => '「' + name + '」は準備中です';

export function ShellAppSwitcher({
  store,
  appMode,
  onSetAppMode,
  onClose,
}: {
  store: CompassStore;
  appMode: AppMode;
  /** **モードを変えるだけ**。ページ遷移もリロードもしない */
  onSetAppMode: (mode: AppMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="app-switcher-backdrop" onClick={onClose}>
      <section
        className="app-switcher-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Compassアプリ一覧"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                font: "700 11px var(--f-num)",
                letterSpacing: '.12em',
                color: 'var(--acc)',
              }}
            >
              COMPASS APPS
            </div>
            <div
              style={{ marginTop: '5px', font: "700 20px var(--f-ui)", color: 'var(--tx0)' }}
            >
              切り替える
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '11.5px',
                lineHeight: 1.65,
                color: 'var(--tx3)',
              }}
            >
              モードは同じアプリの中で切り替わります（下の「ほかのアプリ」は別サイトへ移動）。
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="アプリ一覧を閉じる"
            style={{
              width: '32px',
              height: '32px',
              flex: 'none',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--rad-s)',
              background: 'var(--bg2)',
              color: 'var(--tx2)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── モード。ここは**アプリの移動ではない**。同じアプリのまま中身だけ替わる */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '18px 0 11px' }}
        >
          <span style={{ font: "700 12px var(--f-ui)", color: 'var(--tx1)' }}>モード</span>
          <span style={{ height: '1px', flex: 1, background: 'var(--line)' }}></span>
          <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>
            Shift + ロゴ でも切り替えられます
          </span>
        </div>
        <div style={{ display: 'grid', gap: '7px' }}>
          {APP_MODES.map((m) => {
            const on = m.id === appMode;
            return (
              <button
                key={m.id}
                type="button"
                className={'app-switcher-mode' + (on ? ' is-on' : '')}
                onClick={() => (on ? onClose() : onSetAppMode(m.id))}
                aria-pressed={on}
                style={{ '--mode-accent': 'var(--' + m.token + ')' } as CSSProperties}
              >
                <span className="app-switcher-mode__icon" aria-hidden="true">
                  {m.id === 'notebook' ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                      stroke="var(--mode-accent)" strokeWidth="1.8">
                      <path d="M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                      <path d="M4 17h15M9 3v18M12 8h4" />
                    </svg>
                  ) : (
                    <img src="/compass-icon.svg?v=20260728-ink" alt="" width="34" height="34" />
                  )}
                </span>
                <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <span
                    style={{
                      display: 'block',
                      font: "700 16px var(--f-disp)",
                      color: 'var(--tx0)',
                    }}
                  >
                    {m.name}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: '3px',
                      fontSize: '11px',
                      lineHeight: 1.55,
                      color: 'var(--tx3)',
                    }}
                  >
                    {m.blurb}
                  </span>
                </span>
                <span className="app-switcher-mode__state">{on ? '表示中' : '切り替える →'}</span>
              </button>
            );
          })}
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0 11px' }}
        >
          <span style={{ font: "700 12px var(--f-ui)", color: 'var(--tx1)' }}>
            ほかのアプリ
          </span>
          <span style={{ height: '1px', flex: 1, background: 'var(--line)' }}></span>
          <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>アプリを選ぶと移動できます</span>
        </div>
        <div className="app-switcher-grid">
          {APP_CATALOG.map((app) => (
            <button
              key={app.id}
              type="button"
              className="app-switcher-tile"
              onClick={() => {
                if (app.url) {
                  // spec Q28: レガシーは iframe から親フレーム全体を遷移させていた
                  const top = window.top ?? window;
                  top.location.assign(app.url);
                  return;
                }
                store.showToast(comingSoonToast(app.name));
              }}
              aria-disabled={app.url ? 'false' : 'true'}
              style={{ '--app-accent': app.accent } as CSSProperties}
            >
              <span className="app-switcher-tile__icon" aria-hidden="true">
                {app.icon}
              </span>
              <span
                style={{
                  font: "700 13px var(--f-ui)",
                  color: 'var(--tx0)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  width: '100%',
                }}
              >
                {app.name}
              </span>
              <span style={{ fontSize: '10.5px', lineHeight: 1.55, color: 'var(--tx3)' }}>
                {app.description}
              </span>
              <span className="app-switcher-tile__status">
                {app.url ? '開く ↗' : app.status}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
