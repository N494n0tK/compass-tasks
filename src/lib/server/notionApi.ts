/** Compass のサーバー処理が共有する Notion REST クライアント。 */

const NOTION_API = 'https://api.notion.com/v1';

/** 既存のノート受け取り経路が使ってきた版。 */
export const NOTION_BLOCK_API_VERSION = '2022-06-28';

/** Markdown を加工せず `markdown` パラメータへ渡せる版。 */
export const NOTION_MARKDOWN_API_VERSION = '2026-03-11';

export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface NotionApiClient {
  /** `blocks.children.list` を最後のページまで読む。 */
  listBlockChildren(blockId: string): Promise<unknown[]>;
  /** 親ページ直下に、タイトルと Markdown 本文を 1 回の同期 API 呼び出しで作る。 */
  createPageFromMarkdown(input: {
    parentPageId: string;
    title: string;
    markdown: string;
  }): Promise<{ id: string; url: string }>;
}

export function createNotionApiClient(
  token: string,
  version = NOTION_BLOCK_API_VERSION,
): NotionApiClient {
  const auth = token.trim();

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(NOTION_API + path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: 'Bearer ' + auth,
        'Notion-Version': version,
        'content-type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NotionApiError(
        'Notion API ' + res.status + (body ? ': ' + body.slice(0, 300) : ''),
        res.status,
      );
    }
    return res;
  }

  return {
    async listBlockChildren(blockId) {
      const out: unknown[] = [];
      let cursor: string | null = null;
      do {
        const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
        const res = await call('/blocks/' + encodeURIComponent(blockId) + '/children' + query);
        const json = (await res.json()) as {
          results?: unknown[];
          has_more?: boolean;
          next_cursor?: string | null;
        };
        out.push(...(Array.isArray(json.results) ? json.results : []));
        cursor = json.has_more && json.next_cursor ? json.next_cursor : null;
      } while (cursor);
      return out;
    },

    async createPageFromMarkdown({ parentPageId, title, markdown }) {
      const res = await call('/pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentPageId },
          properties: {
            title: {
              type: 'title',
              title: [{ type: 'text', text: { content: title } }],
            },
          },
          // 受け取った body を編集・分割・再構成せず、そのまま Notion へ渡す。
          markdown,
        }),
      });
      const json = (await res.json()) as { id?: unknown; url?: unknown };
      const id = typeof json.id === 'string' ? json.id : '';
      if (!id) throw new NotionApiError('Notion API が作成ページの id を返しませんでした', 502);
      return { id, url: typeof json.url === 'string' ? json.url : '' };
    },
  };
}
