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
import { useMemo, type CSSProperties } from 'react';
import { splitByKeywords } from '../../lib/logic/noteKeywords';
import type { NoteKeyword } from '../../lib/model/notes';

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

/** 重要語の塗り分け。`renderNoteMath` の第 2 引数 */
export interface NoteMarkOptions {
  keywords: readonly NoteKeyword[];
  /** 確認モード。重要語を付箋で伏せる（クリックで剥がす。剥がす処理は DOM 側） */
  mask?: boolean;
  /**
   * ノート内検索で当たっている語。出てくるところに `<mark class="nb-find">` を敷く。
   * 重要語の色（意味を持つ 3 色）とは別物なので、蛍光ペンの体裁で重ねる。
   * 伏せてある重要語（`mask`）の中には敷かない ―― 付箋の下が透けたら伏せた意味がない。
   */
  find?: string;
}

/** 検索で当たっている語に蛍光ペンを敷く（`find` が空なら素の `plain`） */
function plainFind(t: string, find: string): string {
  if (!find) return plain(t);
  const hay = t.toLowerCase();
  const needle = find.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return out + plain(t.slice(i));
    out += plain(t.slice(i, at));
    out += '<mark class="nb-find">' + plain(t.slice(at, at + find.length)) + '</mark>';
    i = at + find.length;
  }
}

/**
 * 素のテキストに重要語の色を塗る。
 *
 * **数式の中には入らない** ―― この関数を呼ぶのは `renderNoteMath` が
 * `$…$` の外側だと判断した部分だけ。LaTeX のコマンド名にたまたま重要語が
 * 含まれていても壊れない。
 */
function marked(t: string, opt: NoteMarkOptions | undefined): string {
  if (!opt) return plain(t);
  const find = opt.find || '';
  if (!opt.keywords.length) return plainFind(t, find);
  return splitByKeywords(t, opt.keywords)
    .map((p) => {
      if (p.keywordIndex === null) return plainFind(p.text, find);
      const kw = opt.keywords[p.keywordIndex];
      const cls =
        'nb-key nb-key--' + kw.color + (opt.mask ? ' is-hidden' : '');
      // data-nb-key は確認モードのクリック処理（NoteView）が拾う目印
      return (
        '<span class="' +
        cls +
        '" data-nb-key="' +
        p.keywordIndex +
        '"' +
        (opt.mask ? ' role="button" tabindex="0" aria-label="伏せた重要語。開くにはクリック"' : '') +
        '>' +
        (opt.mask ? plain(p.text) : plainFind(p.text, find)) +
        '</span>'
      );
    })
    .join('');
}

/**
 * `mhtml(src)`（HTML:334-350）— LaTeX 混じりテキストを HTML 文字列にする。
 * 数式の描画に失敗したときはレガシーどおり素のテキストへフォールバックする。
 *
 * `mark` を渡すと、数式の外側にある重要語に色が付く（確認モードでは伏せる）。
 */
export function renderNoteMath(
  src: string | null | undefined,
  mark?: NoteMarkOptions,
): string {
  if (!src) return '';
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(src))) {
    out += marked(src.slice(last, m.index), mark);
    const tex = m[1] != null ? m[1] : m[2];
    const displayMode = m[1] != null;
    try {
      out += katex.renderToString(tex, { displayMode, throwOnError: false });
    } catch {
      out += plain(tex);
    }
    last = m.index + m[0].length;
  }
  out += marked(src.slice(last), mark);
  return out;
}

export interface NoteMathProps {
  src: string | null | undefined;
  className?: string;
  style?: CSSProperties;
  /** 空のとき出す薄いプレースホルダ（編集モードのヒント用） */
  placeholder?: string;
  /** 重要語を塗る / 伏せる。渡さなければ素の本文（想起問題・まとめなど） */
  mark?: NoteMarkOptions;
}

/** LaTeX 混じりのノート本文を描画する。`src` が空なら `placeholder` か何も出さない */
export function NoteMath({ src, className, style, placeholder, mark }: NoteMathProps) {
  const text = (src || '').trim();
  // 付箋を剥がすのは DOM のクラス付け替えでやるので、HTML 自体は
  // 本文・重要語・伏せるかどうかだけで決まる（= 剥がしても作り直されない）
  const html = useMemo(
    () => (text ? renderNoteMath(src, mark) : ''),
    [text, src, mark],
  );
  if (!text) {
    return placeholder ? (
      <div className={className} style={{ color: 'var(--tx3)', ...style }}>
        {placeholder}
      </div>
    ) : null;
  }
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 一覧の 1 行など、行内に短く出したいとき（`$…$` は同じように描画される） */
export function NoteMathInline({ src, className, style, mark }: NoteMathProps) {
  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderNoteMath(src, mark) }}
    />
  );
}
