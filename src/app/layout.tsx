import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compass 復習スケジュール",
  description: "時間割をデータ源にした復習キュー管理",
  icons: {
    icon: "/compass-icon.svg?v=20260717-summer",
    shortcut: "/compass-icon.svg?v=20260717-summer",
    apple: "/compass-icon.svg?v=20260717-summer"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#090f1d"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
