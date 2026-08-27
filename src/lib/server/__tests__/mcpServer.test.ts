import { describe, expect, it } from 'vitest';
import {
  handleMessage,
  handleRpc,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
  PROTOCOL_VERSION,
  SERVER_INFO,
} from '../mcpServer';
import { TOOLS, type ToolContext } from '../mcpTools';
import type { CompassServerStore } from '../compassStore';

const EMPTY_STORE: CompassServerStore = {
  uid: 'uid-test',
  async loadNotes() {
    return [];
  },
  async saveNote() {},
  async readImport() {
    return null;
  },
  async writeImport() {},
  async listImports() {
    return [];
  },
};

const context = (): ToolContext => ({ store: () => EMPTY_STORE, today: '2026-08-25' });

/** 設定が足りないときの `createCompassStore()` を真似る（呼ばれて初めて落ちる） */
const brokenContext = (): ToolContext => ({
  store: () => {
    throw new Error('COMPASS_MCP_UID が未設定です');
  },
  today: '2026-08-25',
});

describe('initialize', () => {
  it('クライアントが知っている版に合わせる', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      context,
    );
    expect((res?.result as Record<string, unknown>).protocolVersion).toBe('2025-03-26');
  });

  it('知らない版なら自分の版を名乗る', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      context,
    );
    const result = res?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual(SERVER_INFO);
    expect(String(result.instructions)).toContain('summary');
  });

  it('Firestore の設定が無くても initialize は答える', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, brokenContext);
    expect(res?.error).toBeUndefined();
  });
});

describe('tools/list', () => {
  it('全ツールを annotations 付きで出す', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, brokenContext);
    const tools = (res?.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.length).toBe(TOOLS.length);
    const read = tools.find((t) => t.name === 'list_notes');
    expect((read?.annotations as Record<string, unknown>).readOnlyHint).toBe(true);
    const write = tools.find((t) => t.name === 'record_understanding');
    expect((write?.annotations as Record<string, unknown>).readOnlyHint).toBe(false);
  });
});

describe('tools/call', () => {
  it('結果を text と structuredContent の両方で返す', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
      context,
    );
    const result = res?.result as Record<string, unknown>;
    expect(result.isError).toBe(false);
    expect((result.structuredContent as Record<string, unknown>).app).toBe('Compass');
    expect((result.content as { type: string; text: string }[])[0].type).toBe('text');
  });

  it('知らないツールは JSON-RPC のエラーで返す', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'drop_database' } },
      context,
    );
    expect(res?.error?.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  it('ツールの中で落ちても isError の結果にする（接続は切らない）', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'whoami' } },
      brokenContext,
    );
    const result = res?.result as Record<string, unknown>;
    expect(res?.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(String((result.structuredContent as Record<string, unknown>).message)).toContain(
      'COMPASS_MCP_UID',
    );
  });
});

describe('その他のメソッド', () => {
  it('通知には返事をしない', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, context)).toBeNull();
  });

  it('ping に空で答える', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 6, method: 'ping' }, context);
    expect(res?.result).toEqual({});
  });

  it('resources / prompts は空配列（capability は名乗らないが叩かれる）', async () => {
    const r = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, context);
    expect(r?.result).toEqual({ resources: [] });
    const p = await handleRpc({ jsonrpc: '2.0', id: 8, method: 'prompts/list' }, context);
    expect(p?.result).toEqual({ prompts: [] });
  });

  it('Firestore の設定が無くても get_timetable は答える', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_timetable' } },
      brokenContext,
    );
    const result = res?.result as Record<string, unknown>;
    expect(result.isError).toBe(false);
    expect((result.structuredContent as Record<string, unknown>).periods).toBe(7);
  });

  it('未対応のメソッドは -32601', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'completion/complete' }, context);
    expect(res?.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });
});

describe('handleMessage', () => {
  it('バッチにも答え、通知だけのバッチは null を返す', async () => {
    const batch = await handleMessage(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      context,
    );
    expect(Array.isArray(batch) && batch.length).toBe(1);
    expect(await handleMessage([{ jsonrpc: '2.0', method: 'notifications/initialized' }], context)).toBeNull();
  });

  it('オブジェクトでない本文は invalid request', async () => {
    const res = (await handleMessage('nope', context)) as { error?: { code: number } };
    expect(res.error?.code).toBe(-32600);
  });
});
