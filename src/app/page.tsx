import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthGate } from "../components/auth/AuthGate";
import { AppShell } from "./AppShell";

/**
 * レガシー（iframe + dc-runtime）の起動ドキュメント。**`?legacy=1` のときだけ**組み立てる。
 * 並走比較用に残してあるだけで、既定の経路はネイティブ実装（`<AuthGate/>`）。
 */
function compassDocument() {
  const root = process.cwd();
  const html = readFileSync(join(root, "Compass App.dc.html"), "utf8");
  const support = readFileSync(join(root, "support.js"), "utf8");

  return html.replace(
    '<script src="./support.js"></script>',
    `<script>${support}</script>`
  );
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ preview?: string; legacy?: string }>;
}) {
  const params = await searchParams;
  const previewAllowed =
    process.env.NODE_ENV === "development" || process.env.COMPASS_ENABLE_PREVIEW === "1";
  const preview = previewAllowed && params.preview === "1";

  // 旧実装（iframe + srcDoc）。移行期の並走比較のためだけに残す（architecture §8-2）
  if (params.legacy === "1") {
    return <AppShell srcDoc={compassDocument()} preview={preview} />;
  }

  return <AuthGate preview={preview} />;
}
