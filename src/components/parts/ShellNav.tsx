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
 *
 * ── 動き（ux-refresh.md §10 / `app/motion.css` の語彙）────────────────
 * 選んでいる画面のしるし（左端 4px の縦罫）は motion.css 側で伸び縮みするようにした。
 * ここ（TSX）で足したのは、CSS だけでは鳴らせない 3 つ:
 *   1. 遅れの数が変わった（`.mo-tick` を key で再生）
 *   2. カウントダウンの行が消えた（`.mo-out` を見せてから state を落とす）
 *   3. 追加を受け付けなかった（欠けている欄が首を振る）
 */

import { useEffect, useRef, useState } from 'react';
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

/**
 * 行が消えていくのを見せる時間（ms）。`motion.css` の `--mo-fast`(.16s) と同じ長さ。
 * これを過ぎてから state を落とす ―― 先に落とすと DOM ごと消えて 1 フレームも見えない。
 */
const ROW_OUT_MS = 160;

/**
 * 動きを止めている人か。止めている人に「消えるのを見せるための待ち時間」だけ課すと、
 * 何も起きないまま操作が 0.16 秒遅れるだけになるので、待たずに落とす。
 */
const reduceMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    .filter((v): v is (typeof VIEWS)[number] => !!v)
    // Clawd は**隠しタブ**。トップバーの ✳ を押して見つけるまで並べない
    // （`clawdFound` は保存するので、一度見つけたら以後ずっと出る）
    .filter((v) => v.id !== 'clawd' || S.clawdFound);

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

  /**
   * 消えていく途中の行（`.mo-out` を当てているあいだだけ id が入る）。
   * トーストと違って行は自分の場所を持っているので、黙って抜けると
   * 「何が消えたのか」も「そもそも消えたのか」も分からない。
   */
  /**
   * **id ごとにタイマーを持つ。** 単一のスロットにすると、160ms 以内に 2 行目を消したとき
   * 1 本目のタイマーを取り消さずに上書きしてしまい、1 本目の `.mo-out` が途中で剥がれて
   * 「一瞬戻ってから消える」というちらつきになる。
   */
  const [dying, setDying] = useState<ReadonlySet<string>>(() => new Set());
  const dieTimers = useRef(new Map<string, number>());
  /** 消し終える前に画面を離れることがある（ナビは常駐だが、モバイル↔デスクトップの切替や HMR で外れる） */
  useEffect(() => {
    const timers = dieTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const removeCountdown = (id: string) => {
    const drop = () =>
      store.setState((s) => ({ countdowns: (s.countdowns || []).filter((x) => x.id !== id) }));
    if (reduceMotion()) {
      drop();
      return;
    }
    if (dieTimers.current.has(id)) return; // 同じ行の連打
    setDying((prev) => new Set(prev).add(id));
    dieTimers.current.set(
      id,
      window.setTimeout(() => {
        dieTimers.current.delete(id);
        setDying((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        drop();
      }, ROW_OUT_MS),
    );
  };

  /** 追加を受け付けなかったとき、欠けている欄そのものが首を振る（`.mo-nudge`） */
  const [nudge, setNudge] = useState<'title' | 'date' | null>(null);

  const addCountdown = () => {
    const title = (store.getState().countdownTitle || '').trim();
    const date = store.getState().countdownDate || T;
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // 文言（トースト）は「名前と日付」としか言えないので、どちらが欠けているかは
      // 欄の動きで指す。class を外してから足し直さないと animation は二度と鳴らないので、
      // 鳴り終わりに null へ戻す（下の onAnimationEnd）。
      // 動きを止めている人には鳴り終わりが来ない ―― class を付けっぱなしにしないため触らない
      if (!reduceMotion()) setNudge(!title ? 'title' : 'date');
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
  const glass = S.theme === 'glass';
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
        className="compass-brand mo-press"
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
                borderRadius: 'var(--rad-s)',
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
            {/* 遅れの数は放っておくと増える。増えた回だけ短く弾ませて気づかせる
                （key を数の入った文字列そのものにして再生させる） */}
            {badge ? (
              <span key={badge} className="app-nav-item__badge mo-tick">
                {badge}
              </span>
            ) : null}
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
            borderRadius: 'var(--rad-s)',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: 'var(--tx3)', flex: 1 }}>カウントダウン</div>
            <span style={{ font: "700 10px var(--f-num)", color: 'var(--tx3)' }}>
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
            {countdownRows.map((c, i) => (
              <div
                key={c.id}
                // 足したときは下から起き上がり（新しい行だけが鳴る）、消すときは縮んで薄くなる。
                // 頭の 8 行までしかずらさない（motion.css の決まり 2）
                className={'mo-in mo-lift' + (dying.has(c.id) ? ' mo-out' : '')}
                style={cssVars({
                  '--i': Math.min(i, 7),
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto 20px',
                  gap: '6px',
                  alignItems: 'center',
                  padding: '6px 7px',
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--rad-s)',
                })}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      font: "700 11px var(--f-ui)",
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
                  style={{ font: "700 16px var(--f-num)", color: c.c, whiteSpace: 'nowrap' }}
                >
                  {c.days}
                </div>
                <button
                  className="hv-pink-text mo-tap"
                  aria-label={c.title + ' を消す'}
                  onClick={() => removeCountdown(c.id)}
                  style={{
                    width: '20px',
                    height: '20px',
                    border: 'none',
                    borderRadius: 'var(--rad-s)',
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
            className={'fc-acc' + (nudge === 'title' ? ' mo-nudge' : '')}
            onAnimationEnd={() => setNudge(null)}
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
              borderRadius: 'var(--rad-s)',
              background: 'var(--bg2)',
              color: 'var(--tx0)',
              font: "500 11.5px var(--f-ui)",
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className={'fc-acc' + (nudge === 'date' ? ' mo-nudge' : '')}
              onAnimationEnd={() => setNudge(null)}
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
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx0)',
                font: "600 10.5px var(--f-num)",
                outline: 'none',
                // HTML:903 には color-scheme の指定が無い（付いているのは 1317/1381/1390/1599）。
                // `:root{color-scheme:dark}` のまま = ライトテーマでもピッカーは dark。レガシーどおり
              }}
            />
            <button
              className="mo-tap"
              onClick={addCountdown}
              style={{
                width: '34px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 14px var(--f-ui)",
                cursor: 'pointer',
                boxShadow: 'var(--gAcc)',
              }}
            >
              ＋
            </button>
          </div>
        </div>
        {/* 選択中は `.is-on`（配色は globals.css）。旧実装はインライン style + <span> で
            キーボードから操作できなかったので、ボタンにして aria-pressed を付けた */}
        <div className="theme-switch" role="group" aria-label="テーマ">
          <button
            type="button"
            className={'mo-press ' + (note ? 'is-on' : '')}
            aria-pressed={note}
            onClick={() => setTheme('note')}
          >
            ✎ ノート
          </button>
          <button
            type="button"
            className={'mo-press ' + (!light && !note && !glass ? 'is-on' : '')}
            aria-pressed={!light && !note && !glass}
            onClick={() => setTheme('dark')}
          >
            ✦ ダーク
          </button>
          <button
            type="button"
            className={'mo-press ' + (light ? 'is-on' : '')}
            aria-pressed={light}
            onClick={() => setTheme('light')}
          >
            ☀ ライト
          </button>
          {/* Liquid Glass。ほかの 3 つが「同じ版を違う紙に刷ったもの」なのに対し、
              これだけ紙が無い（`app/glass.css`）。並びの最後に置くのは、
              いつもの 3 つを押し間違えないため */}
          <button
            type="button"
            className={'mo-press ' + (glass ? 'is-on' : '')}
            aria-pressed={glass}
            onClick={() => setTheme('glass')}
          >
            ◈ ガラス
          </button>
        </div>
        <div className="nav-shortcuts" aria-hidden="true">
          <span>
            <kbd>1</kbd>–<kbd>8</kbd> 画面
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
        {/* 「保存中 → 保存済み」は、書いたものが無事だったかを言う唯一の場所。
            key で書き直させて、変わったことに気づけるようにする（数秒に 1 度の変化なので
            ちらつきにはならない。1 秒に何度も変わるようになったら外すこと） */}
        <div className="nav-cloud mo-swap" key={S.cloudStatus}>
          {(CLOUD_STATUS_MAP[S.cloudStatus] || '保存待ち') + ' · ' + (S.cloudUser || 'gmail.com')}
        </div>
        <div className="nav-version">Compass v0.8</div>
      </div>
    </div>
  );
}
