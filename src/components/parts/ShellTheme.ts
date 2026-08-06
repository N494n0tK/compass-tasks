'use client';

/**
 * Compass — テーマトークンと画面メタ（Phase 2B / TASK S0）
 *
 * 出典:
 *  - HTML:786（`.compass-theme` のインライン静的トークン）
 *  - HTML:2637-2678（`glow` / `rad` / `acc` / `gl()` / `themeStyle` / `VIEW_TOKEN`）
 *  - HTML:2680-2687（`views`）、2709（`titles`）、4115（`themeName`）
 *  - css-notes.md §1（`data-theme` の正規化）、§2
 *
 * `props`（glow=3 / radius=12 / accent='#3d3629'）は dc エディタ専用で UI から変更できないため、
 * spec Q27 の「既定値で定数にインライン化」を採る（値・計算式はレガシーと同一）。
 */

import type { Theme, ThemeSkin, ViewId } from '../../lib/model/types';

// ─────────────────────────────────────────────────────────────
// props（HTML:1882 の data-props 既定値）
// ─────────────────────────────────────────────────────────────

/** `props.glow`（0–10, 既定 3）。`glow = clamp/3` なので既定 1（HTML:2637） */
const PROP_GLOW = 3;
/** `props.radius`（既定 12） */
const PROP_RADIUS = 12;
/** `props.accent`（既定 '#3d3629'）。**light テーマの `--acc`/`--grad` にだけ効く** */
const PROP_ACCENT = '#3d3629';

const GLOW = Math.max(0, Math.min(10, PROP_GLOW)) / 3;
const RAD = PROP_RADIUS + 'px';

/** `gl(col, base)`（HTML:2639） */
function gl(col: string, base: number): string {
  return GLOW === 0
    ? 'none'
    : '0 0 ' +
        Math.round(base * GLOW) +
        'px color-mix(in srgb, ' +
        col +
        ' ' +
        Math.round(30 * Math.min(GLOW, 2)) +
        '%, transparent)';
}

// ─────────────────────────────────────────────────────────────
// `.compass-theme` の静的インラインスタイル（HTML:786）
// ─────────────────────────────────────────────────────────────

/** HTML:786 の `style="…"` を 1:1 で写したもの。値も順序もレガシーどおり */
export const STATIC_THEME_TOKENS: Record<string, string> = {
  '--bg0': '#100f0c',
  '--bg1': '#1a1814',
  '--bg2': '#151310',
  '--bg3': '#26231c',
  '--line': '#37332b',
  '--line2': '#4e4940',
  '--tx0': '#f2ede1',
  '--tx1': '#dbd4c7',
  '--tx2': '#a9a296',
  '--tx3': '#867f76',
  '--acc': '#f2ede1',
  '--accBg': '#2b2822',
  '--vio': '#bda7e6',
  '--vioBg': '#2b2438',
  '--grn': '#96c49c',
  '--grnBg': '#1d2c21',
  '--pink': '#dd9184',
  '--pinkBg': '#36231f',
  '--blue': '#93b3cf',
  '--blueBg': '#1e2933',
  '--org': '#ddb277',
  '--orgBg': '#33281c',
  // ノート画面の署名カラー（レガシーに無い追加。docs/notebook/spec.md §8）
  '--ink': '#cbb693',
  '--inkBg': '#2f2719',
  '--onAcc': '#141310',
  '--rad': '12px',
  '--grad': 'var(--view)',
  '--view': 'var(--acc)',
  '--viewBg': 'var(--accBg)',
  '--gAcc': 'none',
  '--gVio': 'none',
  '--gGrn': 'none',
  '--sj-terra': '#d98a78',
  '--sj-rose': '#d894ac',
  '--sj-indigo': '#8ba3dd',
  '--sj-ochre': '#dcb765',
  '--sj-forest': '#7fb08b',
  '--sj-teal': '#6fb6c4',
  '--sj-olive': '#a8bf6e',
  '--sj-amber': '#e0a76a',
  '--sj-plum': '#b795dc',
  '--sj-graphite': '#a09a8e',
  '--sj-steel': '#8fb0cd',
  fontFamily: "'Noto Sans JP',system-ui,sans-serif",
};

// ─────────────────────────────────────────────────────────────
// data-theme（css-notes.md §1）
// ─────────────────────────────────────────────────────────────

/**
 * `state.theme`（保存値）→ `data-theme` 属性値。
 * レガシーの反転命名（note→'dark' / dark→'neon'）は正規化済み。
 * **3 テーマとも必ず属性を出力すること**（モバイル FAB の詳細度稼ぎに使われる）。
 */
export const THEME_ATTR: Readonly<Record<Theme, ThemeSkin>> = {
  note: 'note',
  light: 'light',
  dark: 'neon',
};

// ─────────────────────────────────────────────────────────────
// themeStyle（HTML:2640-2678）
// ─────────────────────────────────────────────────────────────

/** neon（素の 2026 基底）。`Object.assign` の第1引数（HTML:2640-2650） */
const NEON_TOKENS: Record<string, string> = {
  '--bg0': '#071421',
  '--bg1': '#0b1b2b',
  '--bg2': '#081725',
  '--bg3': '#10273a',
  '--line': '#193147',
  '--line2': '#29465f',
  '--tx0': '#f1f6fb',
  '--tx1': '#d4e0eb',
  '--tx2': '#8fa5b9',
  '--tx3': '#5d768c',
  '--acc': '#42d7f2',
  '--accBg': '#0b3343',
  '--vio': '#9a79f6',
  '--vioBg': '#282044',
  '--grn': '#4cda91',
  '--grnBg': '#153829',
  '--pink': '#ff6e5b',
  '--pinkBg': '#3b2427',
  '--blue': '#58a6ff',
  '--blueBg': '#142c48',
  '--org': '#efa960',
  '--orgBg': '#3a2b1d',
  '--ink': '#e879c7',
  '--inkBg': '#3a1f34',
  '--onAcc': '#04131d',
  '--rad': RAD,
  '--grad': 'linear-gradient(90deg,#42d7f2,#58a6ff)',
  '--gAcc': gl('#42d7f2', 14),
  '--gVio': gl('#9a79f6', 14),
  '--gGrn': gl('#4cda91', 12),
  '--sj-terra': '#ef5350',
  '--sj-rose': '#f277a8',
  '--sj-indigo': '#5b7bf0',
  '--sj-ochre': '#f3c74f',
  '--sj-forest': '#2aa578',
  '--sj-teal': '#35cfe8',
  '--sj-olive': '#9bd63b',
  '--sj-amber': '#f59e42',
  '--sj-plum': '#9a6bde',
  '--sj-graphite': '#7f8a99',
  '--sj-steel': '#4f9cf6',
};

/** Ink & Paper — Day（HTML:2651-2660） */
const LIGHT_TOKENS: Record<string, string> = {
  '--bg0': '#f3f0e6',
  '--bg1': '#fffdf6',
  '--bg2': '#faf6ea',
  '--bg3': '#ebe5d4',
  '--line': '#ded7c4',
  '--line2': '#c4bba4',
  '--tx0': '#1f1c16',
  '--tx1': '#3a352c',
  '--tx2': '#6b6458',
  '--tx3': '#958d7d',
  '--accBg': '#e9e3d2',
  '--vio': '#6a4ac2',
  '--vioBg': '#ece5fa',
  '--grn': '#2b7d52',
  '--grnBg': '#dcefe2',
  '--pink': '#c04832',
  '--pinkBg': '#fae3dc',
  '--blue': '#2a68a6',
  '--blueBg': '#e1ecf7',
  '--org': '#a56717',
  '--orgBg': '#f6e9d4',
  '--ink': '#7a5c2e',
  '--inkBg': '#f0e7d3',
  '--onAcc': '#fffdf6',
  '--acc': PROP_ACCENT,
  '--grad': PROP_ACCENT,
  '--gAcc': 'none',
  '--gVio': 'none',
  '--gGrn': 'none',
  '--sj-terra': '#b04b39',
  '--sj-rose': '#a34866',
  '--sj-indigo': '#3a55a8',
  '--sj-ochre': '#8f6c11',
  '--sj-forest': '#2e6d46',
  '--sj-teal': '#1f7484',
  '--sj-olive': '#57731d',
  '--sj-amber': '#a5661a',
  '--sj-plum': '#6f4aa8',
  '--sj-graphite': '#655f55',
  '--sj-steel': '#37678d',
};

/** Ink & Paper — Night（HTML:2661-2671） */
const NOTE_TOKENS: Record<string, string> = {
  '--bg0': '#100f0c',
  '--bg1': '#1a1814',
  '--bg2': '#151310',
  '--bg3': '#26231c',
  '--line': '#37332b',
  '--line2': '#4e4940',
  '--tx0': '#f2ede1',
  '--tx1': '#dbd4c7',
  '--tx2': '#a9a296',
  '--tx3': '#867f76',
  '--acc': '#f2ede1',
  '--accBg': '#2b2822',
  '--vio': '#bda7e6',
  '--vioBg': '#2b2438',
  '--grn': '#96c49c',
  '--grnBg': '#1d2c21',
  '--pink': '#dd9184',
  '--pinkBg': '#36231f',
  '--blue': '#93b3cf',
  '--blueBg': '#1e2933',
  '--org': '#ddb277',
  '--orgBg': '#33281c',
  '--ink': '#cbb693',
  '--inkBg': '#2f2719',
  '--onAcc': '#141310',
  '--rad': '12px',
  '--grad': '#f2ede1',
  '--gAcc': 'none',
  '--gVio': 'none',
  '--gGrn': 'none',
  '--sj-terra': '#d98a78',
  '--sj-rose': '#d894ac',
  '--sj-indigo': '#8ba3dd',
  '--sj-ochre': '#dcb765',
  '--sj-forest': '#7fb08b',
  '--sj-teal': '#6fb6c4',
  '--sj-olive': '#a8bf6e',
  '--sj-amber': '#e0a76a',
  '--sj-plum': '#b795dc',
  '--sj-graphite': '#a09a8e',
  '--sj-steel': '#8fb0cd',
};

/** 画面ごとの署名カラー（HTML:2674） */
export const VIEW_TOKEN: Readonly<Record<ViewId, string>> = {
  cockpit: 'acc',
  tests: 'vio',
  todo: 'pink',
  review: 'grn',
  add: 'org',
  data: 'blue',
  notebook: 'ink',
};

/**
 * `themeStyle`（HTML:2640-2678）。`.compass-theme-mode` のインラインスタイルになる。
 * 末尾で `--view` / `--viewBg` / `--grad` を上書きする順序までレガシーどおり。
 */
export function buildThemeStyle(theme: Theme, view: ViewId): Record<string, string> {
  const light = theme === 'light';
  const note = theme === 'note';
  const style: Record<string, string> = {
    ...NEON_TOKENS,
    ...(light ? LIGHT_TOKENS : note ? NOTE_TOKENS : {}),
  };
  const viewToken = VIEW_TOKEN[view] || 'acc';
  style['--view'] = 'var(--' + viewToken + ')';
  style['--viewBg'] = 'var(--' + viewToken + 'Bg)';
  style['--grad'] = 'var(--view)';
  return style;
}

// ─────────────────────────────────────────────────────────────
// 画面メタ
// ─────────────────────────────────────────────────────────────

/** `views`（HTML:2680-2687）。ナビの既定順 */
export interface ViewDef {
  id: ViewId;
  label: string;
  dot: string;
  g: string;
}

export const VIEWS: readonly ViewDef[] = [
  { id: 'cockpit', label: 'コックピット', dot: 'var(--acc)', g: 'var(--gAcc)' },
  { id: 'tests', label: '試験計画', dot: 'var(--vio)', g: 'var(--gVio)' },
  { id: 'todo', label: '今日のToDo', dot: 'var(--pink)', g: 'none' },
  { id: 'review', label: '復習', dot: 'var(--grn)', g: 'var(--gGrn)' },
  // レガシーに無い追加画面。既定順では復習の隣（`navOrder` はドラッグで変えられる）
  { id: 'notebook', label: 'ノート', dot: 'var(--ink)', g: 'none' },
  { id: 'add', label: 'タスク追加', dot: 'var(--org)', g: 'none' },
  { id: 'data', label: 'データ', dot: 'var(--blue)', g: 'none' },
];

/** `views.map(v => v.id)`（HTML:2691）。`navViewOrder()` の `all` と同じ並び */
export const ALL_VIEW_IDS: readonly ViewId[] = VIEWS.map((v) => v.id);

/** `titles`（HTML:2709）。**ナビラベル「データ」に対しヘッダは「学習データ」** */
export const TITLES: Readonly<Record<ViewId, readonly [string, string]>> = {
  cockpit: ['コックピット', '今日やることを選ぶ・調整する'],
  review: ['復習', '復習予定を一覧表でチェックする'],
  tests: ['試験計画', '予習・テスト計画と負荷を見る'],
  todo: ['今日のToDo', '今日のタスクを実行する'],
  add: ['タスク追加', 'タスク・復習・予習・テストを自由に追加'],
  data: ['学習データ', '勉強時間とテスト結果をふり返る'],
  notebook: ['ノート', '授業ノートを取り込み、想起カードで復習する'],
};

/**
 * `navOrder` の正規化（HTML:2692）と `navViewOrder()`（HTML:2450-2454）は同じ式。
 * 保存値のうち妥当な id だけを残し、欠けている id を既定順で後ろに足す。
 */
export function normalizeNavOrder(navOrder: unknown): ViewId[] {
  const saved = Array.isArray(navOrder)
    ? (navOrder as ViewId[]).filter((id) => ALL_VIEW_IDS.indexOf(id) >= 0)
    : [];
  return saved.concat(ALL_VIEW_IDS.filter((id) => saved.indexOf(id) < 0));
}
