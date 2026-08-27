#!/usr/bin/env node
/**
 * Compass に入ったノートを、スキーマの約束どおりか機械的に見る。
 *
 * Notion の Verifier（17:30 検証層）がやっていた「取り込んだ内容を見る」仕事のうち、
 * **規則で決まる部分だけ**を AI 抜きで引き受ける。中身が授業と合っているか、という
 * 意味の判断はしない ―― それは一次資料を読む必要があり、ここでやると嘘をつく。
 *
 * 使い方:
 *   node scripts/check-notes.mjs                 # 今日（JST）
 *   node scripts/check-notes.mjs --days 3        # 今日から3日ぶん遡る
 *   node scripts/check-notes.mjs --date 2026-08-27
 *
 * 終了コードは常に 0（見つけた指摘は標準出力に出す）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_URL = process.env.COMPASS_MCP_URL || 'https://compass-tasks.vercel.app/api/mcp';

/** 想起問題の数（spec §3.5）。これを外れたら指摘する */
const RECALL_MIN = 3;
const RECALL_MAX = 8;

/** 重要語の数（spec §3.5） */
const KEYWORD_MIN = 6;
const KEYWORD_MAX = 12;

/** 使ってよい色。orange などが混じると紙面の意味が壊れる */
const COLORS = new Set(['red', 'blue', 'green']);

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
  console.error('env COMPASS_MCP_TOKEN が設定されていません');
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

/** 1 冊ぶんの指摘。空配列なら文句なし */
function checkNote(note, knownSubjects) {
  const bad = [];
  const sections = note.sections ?? [];
  const keywords = note.keywords ?? [];
  const cards = note.cards ?? [];

  if (!knownSubjects.has(note.subject)) {
    bad.push(`教科「${note.subject}」が時間割の一覧に無い（大分類を作っていないか）`);
  }
  if ((note.summary ?? '') !== '') {
    bad.push('summary が空でない（本人が書く欄なので AI は触らない）');
  }
  if (!sections.length) bad.push('sections が空');
  sections.forEach((s, i) => {
    if (!(s.text ?? '').trim() && !(s.ai ?? '').trim()) {
      bad.push(`sections[${i}]「${s.heading ?? ''}」が text も ai も空`);
    }
  });

  if (cards.length < RECALL_MIN || cards.length > RECALL_MAX) {
    bad.push(`想起問題が ${cards.length} 問（${RECALL_MIN}〜${RECALL_MAX} 問のはず）`);
  }
  cards.forEach((c, i) => {
    if (!(c.q ?? '').trim()) bad.push(`recall[${i}] に問題文が無い`);
    if (!(c.a ?? '').trim()) bad.push(`recall[${i}] に解答が無い`);
    if (!c.origin) bad.push(`recall[${i}] に origin が無い`);
  });
  // self は ai より先。並び順が崩れると「自分の問い」が埋もれる
  const firstAi = cards.findIndex((c) => c.origin === 'ai');
  const lastSelf = cards.map((c) => c.origin).lastIndexOf('self');
  if (firstAi !== -1 && lastSelf > firstAi) bad.push('recall の self が ai より後ろにある');

  if (keywords.length < KEYWORD_MIN || keywords.length > KEYWORD_MAX) {
    bad.push(`重要語が ${keywords.length} 語（${KEYWORD_MIN}〜${KEYWORD_MAX} 語のはず）`);
  }
  // 本文に無い語は色が塗れない ―― 索引として死んでいるので必ず見る
  const haystack = sections.map((s) => `${s.text ?? ''}\n${s.ai ?? ''}`).join('\n');
  keywords.forEach((k) => {
    if (!COLORS.has(k.color)) bad.push(`重要語「${k.term}」の色が ${k.color}（red/blue/green のみ）`);
    if (k.term && !haystack.includes(k.term)) {
      bad.push(`重要語「${k.term}」が本文に無い（部分一致で色を塗れない）`);
    }
  });

  return bad;
}

async function main() {
  const argv = process.argv.slice(2);
  const dateArg = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : '';
  const days = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) || 1 : 1;
  const base = dateArg || todayJst();
  const from = dateArg ? base : shiftDate(base, -(days - 1));

  const known = new Set([...(await callTool('whoami')).subjects ?? [], 'その他']);
  const notes = (await callTool('list_notes', { from, to: base })).notes ?? [];

  console.log(`対象: ${from} 〜 ${base} / ノート ${notes.length} 冊`);
  if (!notes.length) {
    console.log('見るものがありません。');
    return;
  }

  let flagged = 0;
  for (const brief of notes) {
    const full = (await callTool('get_note', { note_id: brief.note_id })).note;
    const bad = checkNote(full, known);
    const head = `${full.date} ${full.subject}（${full.unit}）`;
    if (!bad.length) {
      console.log(`OK   ${head}`);
      continue;
    }
    flagged += 1;
    console.log(`要確認 ${head}`);
    bad.forEach((b) => console.log(`       - ${b}`));
  }
  console.log(`\n指摘あり ${flagged} 冊 / ${notes.length} 冊`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
