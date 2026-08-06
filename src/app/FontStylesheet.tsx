"use client";

/**
 * レガシー HTML:14-15 と同じ 2 タグ(preconnect 1 本 + stylesheet 1 本)だけを head に出す。
 *
 * サーバーコンポーネントから `<link rel="stylesheet">` を描画すると Flight が
 * `HL[href,"style"]` ヒントを吐き、SSR 側が ReactDOM.preload() を呼んで
 * レガシーには無い `<link rel="preload" as="style">` が 1 本増えてしまう。
 * クライアントコンポーネント側で描画するとヒントが出ず、link だけが head に
 * hoist される(= レガシーと同一の head 構成になる)。
 */
export function FontStylesheet() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&family=Noto+Sans+JP:wght@400;500;700;900&family=Space+Grotesk:wght@500;700&display=swap"
      rel="stylesheet"
    />
  );
}
