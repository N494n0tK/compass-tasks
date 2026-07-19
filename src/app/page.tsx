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

export default function Home() {
  return <AppShell srcDoc={compassDocument()} />;
}
