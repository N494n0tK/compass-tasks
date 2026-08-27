/**
 * Compass — POST /api/mcp（docs/notebook/mcp.md）
 *
 * Notion のカスタムエージェントが「カスタム MCP サーバー」として繋ぐ口。
 * JSON-RPC の中身は `lib/server/mcpServer.ts`、ツールの実装は `lib/server/mcpTools.ts` にあり、
 * ここが持つのは HTTP のことだけ ―― 入口の認証・メソッド・CORS。
 *
 * ## 認証
 * `COMPASS_MCP_TOKEN` と一致する合言葉が要る。渡し方は 3 通り:
 *  1. `Authorization: Bearer <token>`（推奨。ヘッダを付けられるクライアント向け）
 *  2. `POST /api/mcp/<token>`（URL しか設定できないクライアント向け）
 *  3. `POST /api/mcp?key=<token>`（同上）
 *
 * 2 と 3 は**トークンが URL に載る**（アクセスログや履歴に残る）。それでも用意するのは、
 * Notion のカスタム MCP 接続が URL 1 本しか受け取らない場合があるため。漏れたと思ったら
 * `COMPASS_MCP_TOKEN` を作り直せば、その瞬間に古い URL は無効になる。
 *
 * ## 必要な env（`NEXT_PUBLIC` を付けない）
 *  - `COMPASS_MCP_TOKEN`        … 24 文字以上のランダム文字列（`MIN_TOKEN_LENGTH`）
 *  - `COMPASS_MCP_UID`          … 対象の Firebase UID（Compass の「データ」画面に出る）
 *  - `FIREBASE_SERVICE_ACCOUNT` … Firestore を読むサービスアカウント JSON（または base64）
 *
 * 3 つのうち 1 つでも欠けると、接続そのものは通るが（`initialize` / `tools/list` は答える）
 * ツール実行が「設定が足りません」で止まる。原因の分かる止まり方を優先している。
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createCompassStore } from '../../../../lib/server/compassStore';
import { handleMessage, JSONRPC_PARSE_ERROR } from '../../../../lib/server/mcpServer';
import type { ToolContext } from '../../../../lib/server/mcpTools';

/** Firestore REST を叩くのでエッジではなく Node ランタイムで動かす */
export const runtime = 'nodejs';

/** 認証つきの POST なのでキャッシュさせない */
export const dynamic = 'force-dynamic';

/** 短すぎる合言葉を設定と認めない。総当たりを現実的でなくする最低ライン */
const MIN_TOKEN_LENGTH = 24;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  'Access-Control-Max-Age': '86400',
};

/** 長さの違いで早期に抜けない比較。合言葉の一部が推測できてしまうのを避ける */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function presentedToken(req: NextRequest, pathKey: string[] | undefined): string {
  const header = req.headers.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (pathKey && pathKey.length) return decodeURIComponent(pathKey[pathKey.length - 1]);
  return (req.nextUrl.searchParams.get('key') || '').trim();
}

type RouteContext = { params: Promise<{ key?: string[] }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const expected = (process.env.COMPASS_MCP_TOKEN || '').trim();
  if (expected.length < MIN_TOKEN_LENGTH) {
    return NextResponse.json(
      {
        error: 'setup',
        message:
          'COMPASS_MCP_TOKEN が未設定か短すぎます（' +
          MIN_TOKEN_LENGTH +
          '文字以上）。docs/notebook/mcp.md のセットアップ手順を参照してください。',
      },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const { key } = await ctx.params;
  if (!safeEqual(presentedToken(req, key), expected)) {
    return NextResponse.json(
      { error: 'auth', message: 'この MCP サーバーの合言葉が違います。' },
      {
        status: 401,
        headers: { ...CORS_HEADERS, 'WWW-Authenticate': 'Bearer realm="compass-mcp"' },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: JSONRPC_PARSE_ERROR, message: 'JSON として読めません' } },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // store の生成は遅延させる。設定が足りなくても initialize / tools/list / get_timetable は答えたい
  const makeContext = (): ToolContext => ({ store: () => createCompassStore() });

  const result = await handleMessage(body, makeContext);
  // 通知だけのリクエストは本文を返さない（仕様どおり 202）
  if (result === null) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  return NextResponse.json(result, { status: 200, headers: CORS_HEADERS });
}

/** サーバー起点の SSE は張らない。仕様上「対応しない」は 405 で表す */
export function GET(): NextResponse {
  return NextResponse.json(
    { error: 'method', message: 'この MCP サーバーは POST だけを受け付けます（SSE 非対応）。' },
    { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } },
  );
}

/** セッションを持たないので、終了要求は黙って受け入れる */
export function DELETE(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
