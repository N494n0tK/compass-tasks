'use client';

/**
 * Compass — テーマトークンと画面メタ
 *
 * 2026-08 のデザイン刷新で色・角丸・影のトークンを総入れ替えした。
 * 画面メタ（`VIEWS` / `TITLES` / `VIEW_TOKEN` / `normalizeNavOrder`）と
 * `data-theme` の正規化（css-notes.md §1）は従来どおり。
 *
 * ## デザイン言語 —「校内プリント」
 *
 * Compass のデータ源は時間割なので、見た目も学校の配布物（時間割表・成績表・
 * ガリ版プリント）に寄せている。判断の軸は 3 つ:
 *
 *  1. **紙は方眼**。背景に 32px の方眼罫（`--grid` / `--grid2`）が通り、
 *     すべての面がその上のセルとして置かれる。角丸は 2–3px、影は使わない。
 *  2. **インクは数色**。リソグラフの版のように、1 画面につき地の墨 + 差し色 1 色。
 *     差し色は画面ごと（`VIEW_TOKEN`）。
 *  3. **蛍光オレンジ（`--pink`）は「いま」専用**。今日のToDo・期限切れ・
 *     現在のコマにしか出さない。ここだけは面で塗る。
 *
 * 3 テーマは同じ版を違う紙に刷ったもの:
 * `note`=夜の藍刷り（既定） / `light`=印刷したプリント / `dark`=深夜（OLED）。
 */

import type { Theme, ThemeSkin, ViewId } from '../../lib/model/types';

// ─────────────────────────────────────────────────────────────
// 構造トークン（テーマ非依存）
// ─────────────────────────────────────────────────────────────

/** 面（パネル・モーダル）の角丸。紙を裁った程度にしか丸めない */
const RAD = '3px';
/** セル（ボタン・入力・チップ・ドット）の角丸 */
const RAD_S = '2px';

/** 教科パレット。11 色（`logic/subjects.ts` が順に割り当てる） */
const SUBJECTS_DARK: Record<string, string> = {
  '--sj-terra': '#ff7a5c',
  '--sj-rose': '#ff8fb0',
  '--sj-indigo': '#8aa4ff',
  '--sj-ochre': '#ffc857',
  '--sj-forest': '#57c88a',
  '--sj-teal': '#4fd0d8',
  '--sj-olive': '#b6d15e',
  '--sj-amber': '#ffab4d',
  '--sj-plum': '#b795f5',
  '--sj-graphite': '#9fb0c2',
  '--sj-steel': '#74b4ee',
};

const SUBJECTS_LIGHT: Record<string, string> = {
  '--sj-terra': '#c2401f',
  '--sj-rose': '#b53a63',
  '--sj-indigo': '#3548a8',
  '--sj-ochre': '#8a6300',
  '--sj-forest': '#1d6f45',
  '--sj-teal': '#0d6f7c',
  '--sj-olive': '#4f6a12',
  '--sj-amber': '#95590c',
  '--sj-plum': '#63409f',
  '--sj-graphite': '#4f5c69',
  '--sj-steel': '#2a6296',
};

// ─────────────────────────────────────────────────────────────
// `.compass-theme` の静的インラインスタイル
// ─────────────────────────────────────────────────────────────

/**
 * SSR 直後（`buildThemeStyle` が当たる前）に見える既定値。
 * 中身は `note`（既定テーマ）と同じなので初期描画で色が飛ばない。
 */
export const STATIC_THEME_TOKENS: Record<string, string> = {
  '--bg0': '#0c1520',
  '--bg1': '#111e2e',
  '--bg2': '#0e1926',
  '--bg3': '#1a2c42',
  '--line': '#1c3049',
  '--line2': '#2c4967',
  '--tx0': '#eaf1f8',
  '--tx1': '#c3d3e3',
  '--tx2': '#8ba2ba',
  '--tx3': '#62798f',
  '--acc': '#f0f5fa',
  '--accBg': '#1d3149',
  '--vio': '#9d8bf2',
  '--vioBg': '#24234a',
  '--grn': '#35c07d',
  '--grnBg': '#10332a',
  '--pink': '#ff5b2e',
  '--pinkBg': '#3a1c11',
  '--blue': '#57a8ff',
  '--blueBg': '#102a45',
  '--org': '#ffc93f',
  '--orgBg': '#382c10',
  // ノート画面の署名カラー（docs/notebook/spec.md §8）
  '--ink': '#39cfc4',
  '--inkBg': '#0e3330',
  '--onAcc': '#0c1520',
  '--grid': 'rgba(120,165,210,.055)',
  '--grid2': 'rgba(120,165,210,.10)',
  '--rad': RAD,
  '--rad-s': RAD_S,
  '--grad': 'var(--view)',
  '--view': 'var(--acc)',
  '--viewBg': 'var(--accBg)',
  '--gAcc': 'none',
  '--gVio': 'none',
  '--gGrn': 'none',
  ...SUBJECTS_DARK,
  fontFamily: 'var(--f-ui)',
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
// themeStyle — 同じ版を 3 種類の紙に刷る
// ─────────────────────────────────────────────────────────────

/**
 * `dark` — 深夜（OLED）。`data-theme="neon"`。
 * 3 テーマの基底でもあるので、ここに全トークンを揃えておく
 * （`note` / `light` は差分だけを上書きする）。
 */
const NEON_TOKENS: Record<string, string> = {
  '--bg0': '#07090d',
  '--bg1': '#0d1219',
  '--bg2': '#0a0e14',
  '--bg3': '#161e29',
  '--line': '#1a2330',
  '--line2': '#2c3948',
  '--tx0': '#f3f7fb',
  '--tx1': '#ccd7e2',
  '--tx2': '#8b9aa9',
  '--tx3': '#5f6d7c',
  '--acc': '#ffffff',
  '--accBg': '#1b2531',
  '--vio': '#ab90ff',
  '--vioBg': '#241f42',
  '--grn': '#2ee08a',
  '--grnBg': '#0b3324',
  '--pink': '#ff5f2e',
  '--pinkBg': '#351608',
  '--blue': '#4fa8ff',
  '--blueBg': '#0c2743',
  '--org': '#ffd23f',
  '--orgBg': '#33280a',
  '--ink': '#2fe0d2',
  '--inkBg': '#093330',
  '--onAcc': '#07090d',
  '--grid': 'rgba(150,180,210,.05)',
  '--grid2': 'rgba(150,180,210,.09)',
  '--rad': RAD,
  '--rad-s': RAD_S,
  '--grad': 'var(--view)',
  '--gAcc': 'none',
  '--gVio': 'none',
  '--gGrn': 'none',
  ...SUBJECTS_DARK,
};

/** `light` — 刷り上がったプリント。紙は温かい灰白、墨は藍 */
const LIGHT_TOKENS: Record<string, string> = {
  '--bg0': '#e7e4db',
  '--bg1': '#fbfaf6',
  '--bg2': '#f2f0e9',
  '--bg3': '#e4e1d7',
  '--line': '#d5d1c5',
  '--line2': '#b2ac9c',
  '--tx0': '#14202e',
  '--tx1': '#2d3b4c',
  '--tx2': '#51606f',
  // 明るい紙の上でも 4.5:1 を切らないところまで濃くする（補助文言もここを使う）
  '--tx3': '#6a7885',
  '--acc': '#17293e',
  '--accBg': '#e2e6ec',
  '--vio': '#6544cf',
  '--vioBg': '#ebe6fb',
  '--grn': '#16794d',
  '--grnBg': '#dcefe3',
  '--pink': '#dd4110',
  '--pinkBg': '#fbe3d9',
  '--blue': '#1665c8',
  '--blueBg': '#e0ecfa',
  '--org': '#9a6a00',
  '--orgBg': '#f7ecd2',
  '--ink': '#0b7d76',
  '--inkBg': '#dcefed',
  '--onAcc': '#fbfaf6',
  '--grid': 'rgba(40,70,105,.055)',
  '--grid2': 'rgba(40,70,105,.10)',
  ...SUBJECTS_LIGHT,
};

/** `note`（既定）— 夜の藍刷り。紙も墨も藍、蛍光オレンジだけが浮く */
const NOTE_TOKENS: Record<string, string> = {
  '--bg0': '#0c1520',
  '--bg1': '#111e2e',
  '--bg2': '#0e1926',
  '--bg3': '#1a2c42',
  '--line': '#1c3049',
  '--line2': '#2c4967',
  '--tx0': '#eaf1f8',
  '--tx1': '#c3d3e3',
  '--tx2': '#8ba2ba',
  '--tx3': '#62798f',
  '--acc': '#f0f5fa',
  '--accBg': '#1d3149',
  '--vio': '#9d8bf2',
  '--vioBg': '#24234a',
  '--grn': '#35c07d',
  '--grnBg': '#10332a',
  '--pink': '#ff5b2e',
  '--pinkBg': '#3a1c11',
  '--blue': '#57a8ff',
  '--blueBg': '#102a45',
  '--org': '#ffc93f',
  '--orgBg': '#382c10',
  '--ink': '#39cfc4',
  '--inkBg': '#0e3330',
  '--onAcc': '#0c1520',
  '--grid': 'rgba(120,165,210,.055)',
  '--grid2': 'rgba(120,165,210,.10)',
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
