'use client';

/**
 * Compass — ノート本文の描画（LaTeX 混じりテキスト → HTML）
 *
 * 移植元: `CompassNotebook/チャートノート v3.dc.html` の `esc()` / `mhtml()`（HTML:333-350）。
 * 正規表現も分岐もそのまま。違いは 2 点だけ:
 *  - KaTeX を CDN から `window.katex` 経由で待つ（`setInterval` ポーリング）のをやめ、
 *    npm の `katex` を静的 import する。読み込み待ちの淡色表示は不要になった。
 *  - 出力を `dangerouslySetInnerHTML` で流し込む（レガシーも同じ生 HTML 文字列を作っていた）。
 *
 * **XSS の考え方**: 入力は本人が貼り付けた JSON。数式以外は必ず `esc()` を通すので生タグは
 * 描画されない。KaTeX 側は `throwOnError:false`（不正な TeX はエラー表示になるだけ）。
 */

import katex from 'katex';
import type { CSSProperties } from 'react';

/** `$$…$$`（別行立て）優先、次に `$…$`（行内、改行をまたがない）。HTML:336 と同一 */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/** `esc(t)`（HTML:333） */
function esc(t: string): string {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** エスケープ + 改行 → `<br>`（HTML:337 の `plain`） */
function plain(t: string): string {
  return esc(t).replace(/\n/g, '<br>');
}

/**
 * `mhtml(src)`（HTML:334-350）— LaTeX 混じりテキストを HTML 文字列にする。
 * 数式の描画に失敗したときはレガシーどおり素のテキストへフォールバックする。
 */
export function renderNoteMath(src: string | null | undefined): string {
  if (!src) return '';
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(src))) {
    out += plain(src.slice(last, m.index));
    const tex = m[1] != null ? m[1] : m[2];
    const displayMode = m[1] != null;
    try {
      out += katex.renderToString(tex, { displayMode, throwOnError: false });
    } catch {
      out += plain(tex);
    }
    last = m.index + m[0].length;
  }
  out += plain(src.slice(last));
  return out;
}

export interface NoteMathProps {
  src: string | null | undefined;
  className?: string;
  style?: CSSProperties;
  /** 空のとき出す薄いプレースホルダ（編集モードのヒント用） */
  placeholder?: string;
}

/** LaTeX 混じりのノート本文を描画する。`src` が空なら `placeholder` か何も出さない */
export function NoteMath({ src, className, style, placeholder }: NoteMathProps) {
  const text = (src || '').trim();
  if (!text) {
    return placeholder ? (
      <div className={className} style={{ color: 'var(--tx3)', ...style }}>
        {placeholder}
      </div>
    ) : null;
  }
  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderNoteMath(src) }}
    />
  );
}

/** 一覧の 1 行など、行内に短く出したいとき（`$…$` は同じように描画される） */
export function NoteMathInline({ src, className, style }: NoteMathProps) {
  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderNoteMath(src) }}
    />
  );
}
