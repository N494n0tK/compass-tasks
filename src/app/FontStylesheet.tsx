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
 * | `--f-hand`  | Klee One              | **自分が書いたもの**。ノート画面だけで使う |
 *
 * `--f-hand`（Klee One）は一度落としたが v0.13 で戻した。ノート画面の主役が
 * 「自分で撮った手書きノートの写真」になり、**書体が著者を示す**ようになったため:
 * 自分の言葉（自作の問い・疑問・まとめ）は Klee One、AI が作った補足は
 * BIZ UDPGothic。読む前に「これは誰が書いたか」が分かる（notebook/spec.md §8.3）。
 *
 * head の構成（preconnect 1 本 + stylesheet 1 本）はレガシーどおり。
 * サーバーコンポーネントから出すと `<link rel="preload" as="style">` が 1 本増えるため、
 * クライアントコンポーネントで描画している。
 */

export function FontStylesheet() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Barlow+Condensed:wght@500;600;700&family=Klee+One:wght@400;600&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap"
      rel="stylesheet"
    />
  );
}
