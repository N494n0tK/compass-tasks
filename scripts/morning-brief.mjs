#!/usr/bin/env node
/**
 * 朝のメモ（Morning Brief）の本文を組み立てて標準出力に吐く。
 *
 * Notion のカスタムエージェントでやっていた「朝の付き添い」を、AI を挟まない形にしたもの。
 * やるのは組み立てだけ ―― 時間割・弱点 3 問・提出物は Compass MCP から取ってきて、
 * 決まった形に並べる。文章を生成しないので、毎朝の出力がぶれない。
 *
 * 使い方:
 *   node scripts/morning-brief.mjs              # 今日（JST）
 *   node scripts/morning-brief.mjs --date 2026-08-28
 *   node scripts/morning-brief.mjs --json       # 機械で読む用
 *
 * 土日は本文を出さず、`SKIP` とだけ出す（呼び出し側はそれを見て何もしない）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_URL = process.env.COMPASS_MCP_URL || 'https://compass-tasks.vercel.app/api/mcp';

/** 想起問題は 3 問。朝に読める量の上限としてこれ以上は出さない */
const RECALL_COUNT = 3;

/** 提出物を探しに行く範囲（日）。これより古い連絡は朝には出さない */
const NOTICE_WINDOW_DAYS = 7;

function loadEnv() {
  const out = {};
  let text = '';
  try {
    text = readFileSync(join(ROOT, '.env.local'), 'utf8');
  } catch {
    return out;
  }
  text.split('\n').forEach((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  });
  return out;
}

const ENV = { ...loadEnv(), ...process.env };
const TOKEN = (ENV.COMPASS_MCP_TOKEN || '').trim();
if (!TOKEN) {
  console.error('env COMPASS_MCP_TOKEN が設定されていません（.env.local を確認してください）');
  process.exit(2);
}

let rpcId = 0;

async function callTool(name, args = {}) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (rpcId += 1),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`MCP error: ${json.error.message}`);
  return JSON.parse(json.result?.content?.[0]?.text ?? '{}');
}

function todayJst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftDate(iso, days) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** `2026-08-28` → `金`。曜日は時間割のキーに合わせる */
function weekdayJa(iso) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return ['日', '月', '火', '水', '木', '金', '土'][d];
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const dateArg = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : '';
  const date = dateArg || todayJst();
  const day = weekdayJa(date);

  if (day === '土' || day === '日') {
    console.log('SKIP');
    return;
  }

  const tt = await callTool('get_timetable');
  const slots = (tt.timetable?.[day] ?? []).filter(Boolean);

  // 弱点は「間違えた問題」を優先し、足りない分だけ未着手から補う。
  // include_untried を最初から true にすると、解いた記録より新しいノートが先に来てしまう。
  const tried = (await callTool('list_weak_cards', { limit: 20, include_untried: false })).cards ?? [];
  const untried = (await callTool('list_weak_cards', { limit: 40, include_untried: true })).cards ?? [];
  const seenId = new Set();
  const pool = [];
  [...tried, ...untried].forEach((c) => {
    if (seenId.has(c.card_id)) return;
    seenId.add(c.card_id);
    pool.push(c);
  });

  // 3 問が同じ教科・同じノートで埋まらないように選ぶ。朝に見る 3 問なので、
  // 「今日ある教科」→「まだ出していない教科」→「まだ出していないノート」の順で優先する。
  const cards = [];
  const usedSubject = new Set();
  const usedNote = new Set();
  const score = (c) =>
    (slots.includes(c.subject) ? 0 : 1) * 4 +
    (usedSubject.has(c.subject) ? 1 : 0) * 2 +
    (usedNote.has(c.note_id) ? 1 : 0);
  while (cards.length < RECALL_COUNT && pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i += 1) if (score(pool[i]) < score(pool[best])) best = i;
    const [picked] = pool.splice(best, 1);
    cards.push(picked);
    usedSubject.add(picked.subject);
    usedNote.add(picked.note_id);
  }

  // 提出物は直近 1 週間のノートの notice から。今日ある教科のものを先に出す
  const recent = (await callTool('list_notes', {
    from: shiftDate(date, -NOTICE_WINDOW_DAYS),
    to: date,
  })).notes ?? [];
  const notices = [];
  for (const n of recent) {
    const full = await callTool('get_note', { note_id: n.note_id });
    const notice = (full.note?.notice ?? '').trim();
    if (notice) notices.push({ subject: n.subject, notice, today: slots.includes(n.subject) });
  }
  notices.sort((a, b) => Number(b.today) - Number(a.today));

  const lines = [];
  lines.push('### 今日の時間割');
  lines.push(slots.length ? slots.map((s, i) => `${i + 1} ${s}`).join(' / ') : '（時間割なし）');
  lines.push('');
  lines.push('### 持ち物・提出');
  if (notices.length) {
    notices.slice(0, 3).forEach((n) => lines.push(`- ${n.subject}：${n.notice}`));
  } else {
    lines.push('- なし');
  }
  lines.push('');
  lines.push(`### 思い出せるか（${cards.length}問）`);
  if (cards.length) {
    cards.forEach((c) => lines.push(`- ${c.q}（${c.subject}・${c.unit}）`));
  } else {
    lines.push('- まだ問題がありません');
  }

  if (asJson) {
    console.log(JSON.stringify({ date, day, slots, notices, cards, body: lines.join('\n') }, null, 2));
    return;
  }
  console.log(`TITLE ${date}`);
  console.log('---');
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
