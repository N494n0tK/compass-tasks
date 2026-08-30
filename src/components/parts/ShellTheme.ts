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

import { useEffect, useState } from 'react';
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
  glass: 'glass',
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
/**
 * `glass` — Liquid Glass。`data-theme="glass"`。
 *
 * ほかの 3 テーマが「同じ版を違う紙に刷ったもの」なのに対し、**これだけ紙が無い**。
 * 面は色を持たず、後ろの景色を透かして曇らせたガラス板として置かれる
 * （実際の透け方は `app/glass.css`。ここが決めるのは字と差し色だけ）。
 *
 * ## 地の色をほぼ透明にしてある理由
 *
 * `--bg1` / `--bg2` / `--bg3` を薄い白に寄せ、`glass.css` 側で
 * `background: color-mix(...)` + `backdrop-filter` に読み替える。
 * トークンを不透明のままにすると、ガラスにしたい面と、そうでない小さなチップまで
 * 全部が曇りガラスになって、画面が白い霧で埋まる。
 *
 * ## 字は白のまま強くする
 *
 * ぼかした背景の上では、暗い字はどうしても沈む。`--tx0`〜`--tx3` はダークテーマより
 * 1 段明るくして、ガラス越しでも読める側に倒してある。
 */
const GLASS_TOKENS: Record<string, string> = {
  // 地。ここは「ガラスそのものの色」で、後ろは `glass.css` の backdrop-filter が透かす
  '--bg0': '#0b1020',
  '--bg1': 'rgba(255,255,255,.10)',
  '--bg2': 'rgba(255,255,255,.06)',
  '--bg3': 'rgba(255,255,255,.16)',
  // 縁。ガラスの角に乗るハイライトなので、線というより光
  '--line': 'rgba(255,255,255,.14)',
  '--line2': 'rgba(255,255,255,.26)',
  '--tx0': '#ffffff',
  '--tx1': '#e8edf7',
  '--tx2': '#b8c2d4',
  '--tx3': '#8e99ad',
  '--acc': '#ffffff',
  '--accBg': 'rgba(255,255,255,.18)',
  '--vio': '#c0a8ff',
  '--vioBg': 'rgba(160,130,255,.22)',
  '--grn': '#5fe6a8',
  '--grnBg': 'rgba(60,220,150,.20)',
  '--pink': '#ff8f66',
  '--pinkBg': 'rgba(255,110,60,.24)',
  '--blue': '#7cc4ff',
  '--blueBg': 'rgba(90,170,255,.22)',
  '--org': '#ffd98a',
  '--orgBg': 'rgba(255,190,90,.22)',
  '--ink': '#6ee7dc',
  '--inkBg': 'rgba(70,220,205,.20)',
  '--onAcc': '#10162a',
  // 方眼は敷かない。ガラスの後ろに罫が見えると「紙の上のガラス」になってしまい、
  // 透かしているのが景色ではなく紙だとばれる
  '--grid': 'transparent',
  '--grid2': 'transparent',
  // ガラスは角を丸く取る。ここだけ「校内プリント」の 2–3px を離れる
  '--rad': '16px',
  '--rad-s': '10px',
  ...SUBJECTS_DARK,
};

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

// ─────────────────────────────────────────────────────────────
// Glass の時刻背景
// ─────────────────────────────────────────────────────────────

/** CSS に渡す Glass 背景の時刻レイヤー。値は純粋な helper から作る。 */
export interface GlassTimePalette {
  base: string;
  dawn: string;
  warm: string;
  cool: string;
}

interface GlassTimeStop {
  minute: number;
  base: string;
  dawn: string;
  warm: string;
  cool: string;
}

/**
 * 0:00〜24:00 の数点を補間した、暗い背景に白文字が乗るための色見本。
 * 境目を分岐で切り替えず RGB 補間するので、夜明け・日中・夕焼け・夜が滑らかに
 * つながる。最後の 24:00 は 0:00 と同じ色にして日周の継ぎ目も連続にする。
 */
const GLASS_TIME_STOPS: readonly GlassTimeStop[] = [
  { minute: 0, base: '#091329', dawn: '#394a9a', warm: '#67406d', cool: '#234e79' },
  { minute: 240, base: '#112049', dawn: '#765196', warm: '#b46a7d', cool: '#355b8d' },
  { minute: 420, base: '#1b4673', dawn: '#e48b6f', warm: '#7cb9d2', cool: '#34759c' },
  { minute: 720, base: '#214d72', dawn: '#86b7e5', warm: '#e4b18b', cool: '#2c8690' },
  { minute: 960, base: '#28466c', dawn: '#f2ae75', warm: '#bd7186', cool: '#2b6b85' },
  { minute: 1140, base: '#3f2d55', dawn: '#f08a67', warm: '#9f5879', cool: '#25536f' },
  { minute: 1320, base: '#131a3a', dawn: '#7966be', warm: '#4d4a91', cool: '#1c3d63' },
  { minute: 1440, base: '#091329', dawn: '#394a9a', warm: '#67406d', cool: '#234e79' },
];

function clampGlassMinute(minutes: number): number {
  if (!Number.isFinite(minutes)) return 720;
  const rounded = Math.round(minutes);
  return ((rounded % 1440) + 1440) % 1440;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixHex(a: string, b: string, amount: number): string {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return rgbToHex([
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ]);
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Glass の背景色を時刻から純粋に求める。範囲外は一周するため、保存データが壊れても
 * UI が白飛びせず、slider と現在時刻のどちらから呼んでも同じ結果になる。
 */
export function glassTimePalette(minutes: number): GlassTimePalette {
  const value = clampGlassMinute(minutes);
  let left = GLASS_TIME_STOPS[0];
  let right = GLASS_TIME_STOPS[GLASS_TIME_STOPS.length - 1];
  for (let i = 1; i < GLASS_TIME_STOPS.length; i += 1) {
    if (value <= GLASS_TIME_STOPS[i].minute) {
      right = GLASS_TIME_STOPS[i];
      left = GLASS_TIME_STOPS[i - 1];
      break;
    }
  }
  const span = Math.max(1, right.minute - left.minute);
  const amount = Math.max(0, Math.min(1, (value - left.minute) / span));
  const base = mixHex(left.base, right.base, amount);
  const dawn = mixHex(left.dawn, right.dawn, amount);
  const warm = mixHex(left.warm, right.warm, amount);
  const cool = mixHex(left.cool, right.cool, amount);
  return {
    base,
    dawn: withAlpha(dawn, 0.34),
    warm: withAlpha(warm, 0.3),
    cool: withAlpha(cool, 0.28),
  };
}

/** slider の値・ラベルを同じ規則で表示する（秒は時計側で別に表示する）。 */
export function formatGlassTime(minutes: number): string {
  const value = clampGlassMinute(minutes);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Date を直接受け取る純粋な現在時刻 helper（テストと表示側の共通基準）。 */
export function localMinuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 現在時刻追従を必要とする面だけ 15 秒ごとに同期する。初期値は正午で固定して hydration
 * を安定させ、最初の effect でローカル時刻へ追従する。
 */
export function useLocalMinuteOfDay(enabled: boolean): number {
  const [minutes, setMinutes] = useState(12 * 60);
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setMinutes(localMinuteOfDay(new Date()));
    sync();
    const timer = window.setInterval(sync, 15_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return minutes;
}

/** 画面ごとの署名カラー（HTML:2674） */
export const VIEW_TOKEN: Readonly<Record<ViewId, string>> = {
  cockpit: 'acc',
  tests: 'vio',
  todo: 'pink',
  review: 'grn',
  add: 'org',
  data: 'blue',
  // ノートと問題抽出は同じ紙の表裏（読む面と解く面）なので、版も同じ `--ink` を使う。
  // ほかの 6 画面が 1 画面 1 色なのに対し、この 2 つだけは対で 1 色
  notebook: 'ink',
  extract: 'ink',
  // Claude の色（`--org`）。この画面だけは Compass ではなく Clawd の版で刷る
  clawd: 'org',
};

/**
 * `themeStyle`（HTML:2640-2678）。`.compass-theme-mode` のインラインスタイルになる。
 * 末尾で `--view` / `--viewBg` / `--grad` を上書きする順序までレガシーどおり。
 */
export function buildThemeStyle(
  theme: Theme,
  view: ViewId,
  glassTimeMinutes = 12 * 60
): Record<string, string> {
  const light = theme === 'light';
  const note = theme === 'note';
  const glass = theme === 'glass';
  const style: Record<string, string> = {
    ...NEON_TOKENS,
    ...(light ? LIGHT_TOKENS : note ? NOTE_TOKENS : glass ? GLASS_TOKENS : {}),
  };
  const viewToken = VIEW_TOKEN[view] || 'acc';
  style['--view'] = 'var(--' + viewToken + ')';
  style['--viewBg'] = 'var(--' + viewToken + 'Bg)';
  style['--grad'] = 'var(--view)';
  if (glass) {
    const palette = glassTimePalette(glassTimeMinutes);
    style['--glass-time-base'] = palette.base;
    style['--glass-time-dawn'] = palette.dawn;
    style['--glass-time-warm'] = palette.warm;
    style['--glass-time-cool'] = palette.cool;
  }
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
  { id: 'add', label: 'タスク追加', dot: 'var(--org)', g: 'none' },
  { id: 'data', label: 'データ', dot: 'var(--blue)', g: 'none' },
  // レガシーに無い追加画面。既定順ではいちばん後ろの 7 番目・8 番目
  // （`navOrder` はドラッグで変えられる）
  { id: 'notebook', label: 'ノート', dot: 'var(--ink)', g: 'none' },
  { id: 'extract', label: '問題抽出', dot: 'var(--ink)', g: 'none' },
  /**
   * Clawd。**隠しタブ**なので、`clawdFound` が立つまでナビに出ない（`ShellNav` が外す）。
   * 見つけたあとは末尾に並ぶ ―― ここだけは予定を扱う道具ではなく相棒なので、
   * 仕事の並びの外側に置く。
   */
  { id: 'clawd', label: 'Clawd', dot: 'var(--org)', g: 'none' },
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
  notebook: ['ノート', '授業ノートを読み、想起問題で引き出す'],
  extract: ['問題抽出', '全ノートの問題を、理解度の低い順に解き直す'],
  clawd: ['Clawd', 'ひと息つく。励ましてもらう'],
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
