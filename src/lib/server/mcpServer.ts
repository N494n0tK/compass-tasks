/**
 * Compass — MCP（Model Context Protocol）の JSON-RPC 層
 *
 * Streamable HTTP のうち、Compass が必要とする最小限だけを実装する:
 *  - `initialize` / `notifications/initialized` / `ping`
 *  - `tools/list` / `tools/call`
 *  - `resources/list` / `prompts/list`（capability は名乗らないが、
 *    起動時に無条件で叩いてくるクライアントがいるので空配列で答える）
 *
 * SSE は張らない。Compass のツールはどれも 1 往復で終わるので、通知も進捗も要らない。
 * `GET`（サーバー起点のストリーム）には 405 を返す ―― 仕様上それが「対応しない」の作法。
 *
 * 依存は `mcpTools.ts` だけ。HTTP のことは `app/api/mcp/[[...key]]/route.ts` が持つ。
 */

import { callTool, TOOLS, type ToolContext } from './mcpTools';

/** 実装が名乗るプロトコル版。クライアントが知っている版を送ってきたらそちらへ合わせる */
export const PROTOCOL_VERSION = '2025-06-18';

/** 合わせにいける版。これ以外を要求されたら {@link PROTOCOL_VERSION} で答える */
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

/**
 * クライアントに名乗る実装の版。**ツールを足したら必ず上げる。**
 *
 * ChatGPT のカスタム MCP は、接続したときのツール一覧をプラグイン定義に焼き付ける
 * （接続を解除して繋ぎ直しても再取得しない。2026-08-28 実測）。版が変わったことを
 * 手がかりに読み直す可能性があるので、ここを据え置くと新しいツールが永遠に見えない。
 */
export const SERVER_INFO = {
  name: 'compass-study',
  title: 'Compass 授業ノート',
  version: '1.1.0',
} as const;

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function reply(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function replyError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** `tools/list` に出す形。`annotations.readOnlyHint` で「書かないツール」を明示する */
function toolListing() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.readOnly,
      destructiveHint: false,
      idempotentHint: t.readOnly,
      openWorldHint: false,
    },
  }));
}

/**
 * 1 件のリクエストを処理する。通知（`id` を持たないメッセージ）には `null` を返し、
 * 呼び出し側は本文を出さずに 202 を返す。
 *
 * `makeContext` は遅延にしてある ―― `initialize` や `tools/list` だけなら
 * Firestore の設定が無くても答えられるようにするため（繋いだ直後に
 * 「設定が足りません」で全滅すると、原因が分からない）。
 */
export async function handleRpc(
  message: JsonRpcRequest,
  makeContext: () => ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined || message.id === null;
  const method = typeof message.method === 'string' ? message.method : '';

  if (!method) {
    return isNotification ? null : replyError(id, JSONRPC_INVALID_REQUEST, 'method がありません');
  }

  // 通知は返事をしない（`notifications/initialized` / `notifications/cancelled` …）
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const params = (message.params ?? {}) as { protocolVersion?: unknown };
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Compass（復習アプリ）の授業ノートを読み、想起問題の理解度を積むためのサーバーです。' +
          'ノート本文・重要語・想起問題は読めます。自分のまとめ（summary）・自分の疑問（doubt）・' +
          'ノート写真（scans）は読めますが書けません。復習の間隔と学習履歴も変更できません。' +
          'ノートの取り込みは import_note の dry_run で検証してから commit してください。',
      });
    }

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: toolListing() });

    case 'resources/list':
      return reply(id, { resources: [] });

    case 'resources/templates/list':
      return reply(id, { resourceTemplates: [] });

    case 'prompts/list':
      return reply(id, { prompts: [] });

    case 'tools/call': {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return replyError(id, JSONRPC_INVALID_PARAMS, 'params.name がありません');
      if (!TOOLS.some((t) => t.name === name)) {
        return replyError(id, JSONRPC_INVALID_PARAMS, '不明なツールです: ' + name);
      }
      try {
        const result = await callTool(name, params.arguments, makeContext());
        return reply(id, {
          content: [{ type: 'text', text: result.text }],
          structuredContent: result.data,
          isError: !!result.isError,
        });
      } catch (e) {
        // ツールの中で落ちたことは**プロトコルのエラーにしない**（仕様どおり
        // `isError: true` の結果として返し、エージェントが読んで直せるようにする）
        const message_ = e instanceof Error ? e.message : String(e);
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, message: message_ }, null, 2) }],
          structuredContent: { ok: false, message: message_ },
          isError: true,
        });
      }
    }

    default:
      return isNotification
        ? null
        : replyError(id, JSONRPC_METHOD_NOT_FOUND, '未対応のメソッドです: ' + method);
  }
}

/** バッチ（配列）にも答える。2025-03-26 のクライアントが送ってくることがある */
export async function handleMessage(
  body: unknown,
  makeContext: () => ToolContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out: JsonRpcResponse[] = [];
    for (const item of body) {
      const res = await handleRpc((item ?? {}) as JsonRpcRequest, makeContext);
      if (res) out.push(res);
    }
    return out.length ? out : null;
  }
  if (!body || typeof body !== 'object') {
    return replyError(null, JSONRPC_INVALID_REQUEST, 'JSON-RPC のオブジェクトではありません');
  }
  return handleRpc(body as JsonRpcRequest, makeContext);
}
