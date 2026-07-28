import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppShell } from "./AppShell";

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
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  const previewAllowed = process.env.NODE_ENV === "development" || process.env.COMPASS_ENABLE_PREVIEW === "1";
  const preview = previewAllowed && params.preview === "1";
  return <AppShell srcDoc={compassDocument()} preview={preview} />;
}
