#!/usr/bin/env node
/**
 * Notion の「Compass取り込みJSON」ページに置かれた `compass-note@2` を
 * Compass MCP（/api/mcp）へ流し込む。
 *
 * ChatGPT が授業ノートを作って Notion に置く → このスクリプトが取り込む、という
 * 分担のうしろ半分（docs/notebook/chatgpt-pipeline.md）。Notion AI のクレジットを
 * 使わないのが狙いなので、途中にモデルを挟まない ―― 取り出しも送信も決定的にやる。
 *
 * 使い方:
 *   node scripts/import-notion-json.mjs                    # 今日（JST）の「M月D日」ページ
 *   node scripts/import-notion-json.mjs --date 2026-08-26
 *   node scripts/import-notion-json.mjs --title "テスト 8月26日"
 *   node scripts/import-notion-json.mjs --dry             # dry_run だけ（commit しない）
 *
 * env は `.env.local` から読む（NOTION_TOKEN / NOTION_NOTES_PAGE_ID / COMPASS_MCP_TOKEN）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MCP_URL = process.env.COMPASS_MCP_URL || 'https://compass-tasks.vercel.app/api/mcp';
const SOURCE = 'chatgpt-daily';

// ─────────────────────────────────────────────────────────────
// env
// ─────────────────────────────────────────────────────────────

/** `.env.local` を読む。`KEY=value` だけの素朴な形式（値のクォートは剥がす） */
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

function need(key) {
  const v = (ENV[key] || '').trim();
  if (!v) {
    console.error(`env ${key} が設定されていません（.env.local を確認してください）`);
    process.exit(2);
  }
  return v;
}

/** Notion の id からハイフンを外し、URL 末尾の 32 桁だけを取り出す */
function normalizeNotionId(raw) {
  const hex = String(raw).replace(/-/g, '').trim();
  const m = /([0-9a-f]{32})$/i.exec(hex);
  return m ? m[1] : hex;
}

// ─────────────────────────────────────────────────────────────
// 引数
// ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dry: false, title: '', date: '', catchup: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry') args.dry = true;
    else if (argv[i] === '--catchup') args.catchup = true;
    else if (argv[i] === '--title') args.title = argv[++i] || '';
    else if (argv[i] === '--date') args.date = argv[++i] || '';
  }
  return args;
}

/** `2026-08-27` の n 日前を `YYYY-MM-DD` で返す（日付だけの計算なので UTC 正午を基準にする） */
function shiftDate(iso, days) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 日本時間の今日を `YYYY-MM-DD` で返す */
function todayJst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `2026-08-26` → `8月26日`（エージェントの命名規則） */
function datePageTitle(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`--date は YYYY-MM-DD の形式にしてください（受信: ${iso}）`);
  return `${Number(m[2])}月${Number(m[3])}日`;
}

// ─────────────────────────────────────────────────────────────
// Notion
// ─────────────────────────────────────────────────────────────

async function listChildren(token, blockId) {
  const out = [];
  let cursor = null;
  do {
    const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = await fetch(`${NOTION_API}/blocks/${blockId}/children${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Notion API ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    out.push(...(Array.isArray(json.results) ? json.results : []));
    cursor = json.has_more && json.next_cursor ? json.next_cursor : null;
  } while (cursor);
  return out;
}

/**
 * 対象ページかどうか。`8月26日` と、再実行でできる `8月26日 (2)` を拾う。
 * 空白の有無は Notion 側でぶれるので、比較の前に畳む。
 */
function matchesTitle(pageTitle, wanted) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const t = norm(pageTitle);
  const w = norm(wanted);
  return t === w || new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(\\d+\\)$`).test(t);
}

/** コードブロックの中身（複数の rich_text に割れることがあるので連結する） */
function codeBlockText(raw) {
  if (!raw || raw.type !== 'code') return null;
  const rich = raw.code?.rich_text;
  if (!Array.isArray(rich)) return null;
  const text = rich.map((r) => r?.plain_text ?? '').join('');
  return text.trim() ? text : null;
}

// ─────────────────────────────────────────────────────────────
// Compass MCP
// ─────────────────────────────────────────────────────────────

let rpcId = 0;

async function callTool(token, name, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (rpcId += 1),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`MCP error: ${json.error.message}`);
  const text = json.result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────
// 本体
// ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const notionToken = need('NOTION_TOKEN');
  const notesPageId = normalizeNotionId(need('NOTION_NOTES_PAGE_ID'));
  const mcpToken = need('COMPASS_MCP_TOKEN');

  // `--catchup` は今日・昨日・一昨日を順に見る。生成側（ChatGPT）が 1 日飛んでも
  // 翌日に拾い直せるように。取り込み済みは `duplicate` で弾かれるので何度見てもよい。
  if (args.catchup) {
    const base = args.date || todayJst();
    for (const d of [0, -1, -2].map((n) => shiftDate(base, n))) {
      console.log(`\n===== ${d}`);
      await runOne({ notionToken, notesPageId, mcpToken, date: d, title: '', dry: args.dry });
    }
    return;
  }

  await runOne({
    notionToken,
    notesPageId,
    mcpToken,
    date: args.date || todayJst(),
    title: args.title,
    dry: args.dry,
  });
}

async function runOne({ notionToken, notesPageId, mcpToken, date, title, dry }) {
  const args = { dry };
  const wanted = title || datePageTitle(date);

  const rootChildren = await listChildren(notionToken, notesPageId);
  const pages = rootChildren
    .filter((b) => b?.type === 'child_page')
    .map((b) => ({ id: String(b.id || '').replace(/-/g, ''), title: String(b.child_page?.title || '') }))
    .filter((p) => p.id && matchesTitle(p.title, wanted));

  if (!pages.length) {
    console.log(`対象ページがありません（探した名前: 「${wanted}」）。取り込みは 0 件です。`);
    return;
  }

  const blocks = [];
  for (const page of pages) {
    const children = await listChildren(notionToken, page.id);
    children.forEach((raw) => {
      const text = codeBlockText(raw);
      if (text) blocks.push({ page: page.title, text });
    });
  }

  console.log(`ページ: ${pages.map((p) => p.title).join(' / ')}`);
  console.log(`コードブロック: ${blocks.length} 件${args.dry ? '（dry_run のみ）' : ''}`);

  const summary = [];
  for (const [i, block] of blocks.entries()) {
    const label = `#${i + 1} (${block.page})`;
    let payload;
    try {
      payload = JSON.parse(block.text);
    } catch (e) {
      summary.push(`${label} rejected: JSON として読めません（${e.message}）`);
      continue;
    }
    const head = `${payload.date ?? '?'} ${payload.subject ?? '?'}（${payload.unit ?? '?'}）`;
    try {
      const dry = await callTool(mcpToken, 'import_note', { payload, mode: 'dry_run' });
      // conflict は `ok: false` で返る（例外ではなく結果）。status を先に見ないと
      // 「内容が違う」と「JSON が壊れている」が同じ行に見えてしまう。
      if (!dry.status) {
        summary.push(`${label} ${head} → rejected: ${dry.message || JSON.stringify(dry.errors)}`);
        continue;
      }
      if (dry.status === 'duplicate') {
        summary.push(`${label} ${head} → duplicate（取り込み済み）`);
        continue;
      }
      if (dry.status === 'conflict') {
        summary.push(`${label} ${head} → conflict（既存と内容が違う。overwrite は付けない）`);
        continue;
      }
      if (dry.status !== 'validated') {
        summary.push(`${label} ${head} → ${dry.status}: ${dry.message || ''}`);
        continue;
      }
      if (args.dry) {
        summary.push(`${label} ${head} → validated（dry_run のみ）`);
        continue;
      }
      const done = await callTool(mcpToken, 'import_note', {
        payload,
        mode: 'commit',
        source: SOURCE,
      });
      const warn = done.warnings?.length ? ` warnings=${done.warnings.length}` : '';
      summary.push(`${label} ${head} → ${done.status} ${done.note_id ?? ''}${warn}`);
    } catch (e) {
      summary.push(`${label} ${head} → 失敗: ${e.message}`);
    }
  }

  summary.forEach((line) => console.log(line));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
