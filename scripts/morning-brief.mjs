#!/usr/bin/env node
/**
 * 朝のメモの本文を出す（手で走らせる用）。
 *
 * 組み立てそのものは **Compass MCP の `morning_brief`** が持っている
 * （`src/lib/logic/morningBrief.ts`）。ここはそれを呼んで表示するだけ ――
 * 同じ判断を 2 か所に置くと、片方だけ直したときに朝の 1 枚が静かにずれる。
 *
 * 毎日の実行は ChatGPT のスケジュール「Compass朝のメモ」がやる。
 *
 *   node scripts/morning-brief.mjs
 *   node scripts/morning-brief.mjs --date 2026-08-28
 *   node scripts/morning-brief.mjs --json
 */

import { callTool, flag, todayJst } from './lib/mcp.mjs';

const argv = process.argv.slice(2);
const date = flag(argv, '--date') || todayJst();

const brief = await callTool('morning_brief', { date });

if (argv.includes('--json')) {
  console.log(JSON.stringify(brief, null, 2));
} else if (brief.skipped) {
  console.log('SKIP');
} else {
  console.log(`TITLE ${brief.date}`);
  console.log('---');
  console.log(brief.body);
}
