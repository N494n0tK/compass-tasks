"use client";

/**
 * Compass — 書体（2026-08 デザイン刷新）
 *
 * 3 つの書体はそれぞれ「誰が刷った文字か」に対応している（globals.css [C-2]）:
 *
 * | 変数        | 書体                  | 役割                                     |
 * |-------------|-----------------------|------------------------------------------|
 * | `--f-disp`  | Zen Kaku Gothic New   | 見出し。学校掲示・プリントの太ゴシック   |
 * | `--f-ui`    | BIZ UDPGothic         | 本文・UI。教科書/配布物の UD ゴシック    |
 * | `--f-num`   | Barlow Condensed      | 数字・データ。時間割表と成績表のコンデンス |
 *
 * 4 つめの Klee One（`--f-hand`「生徒の手書き」）はノート画面の作り直しで
 * 使い手がいなくなったので落とした（2026-08。ノートは手書き用紙をやめて
 * チャートノート v2 の活字の紙面になった）。
 *
 * head の構成（preconnect 1 本 + stylesheet 1 本）はレガシーどおり。
 * サーバーコンポーネントから出すと `<link rel="preload" as="style">` が 1 本増えるため、
 * クライアントコンポーネントで描画している。
 */

export function FontStylesheet() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Barlow+Condensed:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap"
      rel="stylesheet"
    />
  );
}
