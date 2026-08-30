import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotionApiClient, NOTION_MARKDOWN_API_VERSION } from '../notionApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotionApiClient', () => {
  it('タイトルと未加工の Markdown を単一 create-page リクエストで送る', async () => {
    const body = '### 見出し\n\n- そのまま  \n末尾';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.so/page-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createNotionApiClient('secret-token', NOTION_MARKDOWN_API_VERSION);
    await client.createPageFromMarkdown({
      parentPageId: 'parent-1',
      title: '2026-08-31',
      markdown: body,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.notion.com/v1/pages');
    expect(payload.markdown).toBe(body);
    expect(payload).not.toHaveProperty('children');
    expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2026-03-11');
    expect(JSON.stringify(payload)).toContain('2026-08-31');
  });

  it('API 失敗は内容を自作せず例外にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"down"}', { status: 503 })),
    );
    const client = createNotionApiClient('secret-token', NOTION_MARKDOWN_API_VERSION);
    await expect(
      client.createPageFromMarkdown({ parentPageId: 'p', title: '2026-08-31', markdown: BODY }),
    ).rejects.toThrow('Notion API 503');
  });
});

const BODY = '### 本文';
