/**
 * Compass MCP への最小クライアント（スクリプト共通）
 *
 * `.env.local` を読んで JSON-RPC を投げるだけ。3 本のスクリプトが同じことを
 * 書き写していたのでここへ寄せた。判定ロジックはここには置かない ――
 * それはサーバー側のツール（check_notes / morning_brief）が持っている。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MCP_URL = process.env.COMPASS_MCP_URL || 'https://compass-tasks.vercel.app/api/mcp';

/** `.env.local` を読む。`KEY=value` だけの素朴な形式（値のクォートは剥がす） */
export function loadEnv() {
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  });
  return out;
}

export const ENV = { ...loadEnv(), ...process.env };

export function need(key) {
  const v = (ENV[key] || '').trim();
  if (!v) {
    console.error(`env ${key} が設定されていません（.env.local を確認してください）`);
    process.exit(2);
  }
  return v;
}

let rpcId = 0;

/** ツールを 1 個呼んで `structuredContent` 相当を返す */
export async function callTool(name, args = {}, token = need('COMPASS_MCP_TOKEN')) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`MCP error: ${json.error.message}`);
  return JSON.parse(json.result?.content?.[0]?.text ?? '{}');
}

/** 日本時間の今日を `YYYY-MM-DD` で */
export function todayJst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `--date 2026-08-27` のような引数を読む */
export function flag(argv, name, fallback = '') {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] || fallback : fallback;
}
