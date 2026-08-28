#!/usr/bin/env node
/**
 * 取り込んだノートの形を点検する（手で走らせる用）。
 *
 * 判定は **Compass MCP の `check_notes`** が持っている（`src/lib/logic/noteAudit.ts`）。
 * ここは結果を読みやすく並べるだけ。中身が授業と合っているかは見ない ―― 形だけ。
 *
 * 毎日の実行は ChatGPT のスケジュール「Compassノート点検」がやる。
 *
 *   node scripts/check-notes.mjs
 *   node scripts/check-notes.mjs --days 3
 *   node scripts/check-notes.mjs --date 2026-08-27
 */

import { callTool, flag, todayJst } from './lib/mcp.mjs';

const argv = process.argv.slice(2);
const date = flag(argv, '--date') || todayJst();
const days = Number(flag(argv, '--days', '1')) || 1;

const r = await callTool('check_notes', { date, days });

console.log(`対象: ${r.from} 〜 ${r.to} / ノート ${r.checked} 冊`);
if (!r.checked) {
  console.log('見るものがありません。');
  process.exit(0);
}

r.notes.forEach((n) => {
  const head = `${n.date} ${n.subject}（${n.unit}）`;
  if (n.ok) {
    console.log(`OK   ${head}`);
    return;
  }
  console.log(`要確認 ${head}`);
  n.findings.forEach((f) => console.log(`       - ${f.message}`));
});
console.log(`\n指摘あり ${r.flagged} 冊 / ${r.checked} 冊`);
