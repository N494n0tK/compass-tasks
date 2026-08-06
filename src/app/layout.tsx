import type { Metadata, Viewport } from "next";
import { FontStylesheet } from "./FontStylesheet";
// ノート画面の数式描画（docs/notebook/spec.md §8）。フォントは katex パッケージに同梱され、
// Next がバンドルするので外部 CDN への接続は増えない。
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compass 復習スケジュール",
  description: "時間割をデータ源にした復習キュー管理",
  icons: {
    icon: "/compass-icon.svg?v=20260728-ink",
    shortcut: "/compass-icon.svg?v=20260728-ink",
    apple: "/compass-icon.svg?v=20260728-ink"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#100f0c"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        {/* レガシー HTML:14-15 と同一: preconnect は googleapis の 1 本のみ */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <FontStylesheet />
      </head>
      <body>{children}</body>
    </html>
  );
}
