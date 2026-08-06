'use client';

/**
 * Compass — 起動スプラッシュ（Phase 2B / TASK S0）
 *
 * 出典: HTML:789-860（テンプレート）。spec §2.2 / C-1〜C-26。
 * アニメーションは全て CSS（globals.css `[C]`）。ここは DOM 構造と `--li` / `--ci` /
 * `--ring-len` / `--ring-delay` のインライン custom property を 1:1 で出すだけ。
 *
 * 退場はレガシーが `classList.add('compass-splash--ready')` の DOM 直接操作（HTML:2320-2321）
 * だったのを `ready` prop に置き換えた（architecture §7-2 / spec Q20）。
 * **DOM からは消さない**（`visibility:hidden` で残るのが正しい, C-25）。
 */

import type { CSSProperties } from 'react';

const COMPASS_LETTERS = ['C', 'O', 'M', 'P', 'A', 'S', 'S'];

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export function ShellSplash({ ready }: { ready: boolean }) {
  return (
    <div className={'compass-splash' + (ready ? ' compass-splash--ready' : '')} aria-hidden="true">
      <div className="compass-splash__stage">
        <div className="compass-splash__glow"></div>
        <svg className="compass-splash__build" viewBox="0 0 512 512" aria-hidden="true">
          <defs>
            <clipPath id="spDialClip">
              <circle cx="256" cy="256" r="196"></circle>
            </clipPath>
            <linearGradient
              id="spSweepGrad"
              x1="256"
              y1="256"
              x2="452"
              y2="256"
              gradientUnits="userSpaceOnUse"
            >
              <stop className="sp-sweep-a" offset="0"></stop>
              <stop className="sp-sweep-b" offset="1"></stop>
            </linearGradient>
          </defs>
          <line className="sp-guide sp-guide--h" x1="8" y1="256" x2="504" y2="256"></line>
          <line className="sp-guide sp-guide--v" x1="256" y1="8" x2="256" y2="504"></line>
          <circle className="sp-guide-ring" cx="256" cy="256" r="231"></circle>
          <circle className="sp-ticks" cx="256" cy="256" r="212"></circle>
          <circle className="sp-rim sp-rim--under" cx="256" cy="256" r="190"></circle>
          <circle className="sp-rim sp-rim--ink" cx="256" cy="256" r="190"></circle>
          <circle className="sp-face" cx="256" cy="256" r="137"></circle>
          <g clipPath="url(#spDialClip)">
            <g className="sp-sweep">
              <path
                className="sp-sweep-wedge"
                d="M256 256 452 256A196 196 0 0 0 368.4 95.4Z"
              ></path>
              <line className="sp-sweep-edge" x1="256" y1="256" x2="452" y2="256"></line>
            </g>
          </g>
          <circle
            className="sp-ring"
            cx="256"
            cy="256"
            r="113"
            style={cssVars({ '--ring-len': 710, '--ring-delay': '.8s' })}
          ></circle>
          <circle
            className="sp-ring sp-ring--mid"
            cx="256"
            cy="256"
            r="82"
            style={cssVars({ '--ring-len': 516, '--ring-delay': '.88s' })}
          ></circle>
          <circle
            className="sp-ring sp-ring--in"
            cx="256"
            cy="256"
            r="54"
            style={cssVars({ '--ring-len': 340, '--ring-delay': '.96s' })}
          ></circle>
          <text className="sp-card" x="256" y="100" style={cssVars({ '--ci': 0 })}>
            N
          </text>
          <text className="sp-card" x="412" y="256" style={cssVars({ '--ci': 1 })}>
            E
          </text>
          <text className="sp-card" x="256" y="412" style={cssVars({ '--ci': 2 })}>
            S
          </text>
          <text className="sp-card" x="100" y="256" style={cssVars({ '--ci': 3 })}>
            W
          </text>
          <g className="sp-needle">
            <path className="sp-needle-n" d="M280 233 333 120 226 286Z"></path>
            <path className="sp-needle-s" d="M228 280 175 393 282 227Z"></path>
          </g>
          <circle className="sp-pin-pulse" cx="256" cy="256" r="26"></circle>
          <g className="sp-pin">
            <circle className="sp-pin-body" cx="256" cy="256" r="25"></circle>
            <circle className="sp-pin-dot" cx="256" cy="256" r="8"></circle>
          </g>
        </svg>
        <svg className="compass-splash__mark" viewBox="0 0 512 512" aria-hidden="true">
          <defs>
            <radialGradient
              id="mkFace"
              cx="0"
              cy="0"
              r="1"
              gradientTransform="translate(210 196) rotate(48) scale(210)"
              gradientUnits="userSpaceOnUse"
            >
              <stop className="mk-face-a" offset="0"></stop>
              <stop className="mk-face-b" offset="1"></stop>
            </radialGradient>
          </defs>
          <circle className="mk-ticks" cx="256" cy="256" r="212"></circle>
          <circle className="mk-rim mk-rim--under" cx="256" cy="256" r="190"></circle>
          <circle className="mk-rim mk-rim--ink" cx="256" cy="256" r="190"></circle>
          <circle className="mk-face" cx="256" cy="256" r="137"></circle>
          <circle className="mk-ring" cx="256" cy="256" r="113"></circle>
          <circle className="mk-ring mk-ring--mid" cx="256" cy="256" r="82"></circle>
          <circle className="mk-ring mk-ring--in" cx="256" cy="256" r="54"></circle>
          <g className="mk-cards">
            <text className="mk-card" x="256" y="100">
              N
            </text>
            <text className="mk-card" x="412" y="256">
              E
            </text>
            <text className="mk-card" x="256" y="412">
              S
            </text>
            <text className="mk-card" x="100" y="256">
              W
            </text>
          </g>
          <g className="mk-needle">
            <path className="mk-needle-n" d="M280 233 333 120 226 286Z"></path>
            <path className="mk-needle-s" d="M228 280 175 393 282 227Z"></path>
          </g>
          <circle className="mk-pin-body" cx="256" cy="256" r="25"></circle>
          <circle className="mk-pin-dot" cx="256" cy="256" r="8"></circle>
        </svg>
        <div className="compass-splash__word">
          {COMPASS_LETTERS.map((ch, i) => (
            <span key={i} style={cssVars({ '--li': i })}>
              {ch}
            </span>
          ))}
        </div>
        <div className="compass-splash__todo">ToDo</div>
      </div>
    </div>
  );
}
