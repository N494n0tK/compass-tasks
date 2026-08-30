import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const originalCronSecret = process.env.CRON_SECRET;
const originalNotionToken = process.env.NOTION_TOKEN;

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
  if (originalNotionToken === undefined) delete process.env.NOTION_TOKEN;
  else process.env.NOTION_TOKEN = originalNotionToken;
  vi.restoreAllMocks();
});

describe('GET /api/cron/morning-brief', () => {
  const secret = 'test-secret-12345';

  it('CRON_SECRET 未設定なら 503', async () => {
    delete process.env.CRON_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(new NextRequest('http://localhost/api/cron/morning-brief'));
    expect(res.status).toBe(503);
  });

  it('Authorization が違えば 401', async () => {
    process.env.CRON_SECRET = secret;
    const res = await GET(
      new NextRequest('http://localhost/api/cron/morning-brief', {
        headers: { authorization: 'Bearer wrong' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('認証後に NOTION_TOKEN が無ければ外部処理を始めず 503', async () => {
    process.env.CRON_SECRET = secret;
    delete process.env.NOTION_TOKEN;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(
      new NextRequest('http://localhost/api/cron/morning-brief', {
        headers: { authorization: 'Bearer ' + secret },
      }),
    );
    expect(res.status).toBe(503);
  });
});
