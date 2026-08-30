/** GitHub Actions（毎日 07:30 Asia/Tokyo）から呼ばれる Compass 内部ジョブ入口。 */

import { NextResponse, type NextRequest } from 'next/server';
import { createCompassStore } from '../../../../lib/server/compassStore';
import {
  createMorningBriefNotionStore,
  scheduledMorningBriefJob,
} from '../../../../lib/server/morningBriefJob';
import { createMorningBriefRunStore } from '../../../../lib/server/morningBriefRunStore';
import { generateMorningBrief } from '../../../../lib/server/morningBriefService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_CRON_SECRET_LENGTH = 16;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    console.error('[morning-brief] setup_failed', { error: 'CRON_SECRET が未設定か短すぎます' });
    return NextResponse.json(
      {
        ok: false,
        error: 'setup',
        message: 'CRON_SECRET は ' + MIN_CRON_SECRET_LENGTH + ' 文字以上で設定してください',
      },
      { status: 503 },
    );
  }
  if (!safeEqual(req.headers.get('authorization') || '', 'Bearer ' + secret)) {
    return NextResponse.json({ ok: false, error: 'auth' }, { status: 401 });
  }

  const notionToken = (process.env.NOTION_TOKEN || '').trim();
  if (!notionToken) {
    console.error('[morning-brief] setup_failed', { error: 'NOTION_TOKEN が未設定です' });
    return NextResponse.json(
      { ok: false, error: 'setup', message: 'NOTION_TOKEN が未設定です' },
      { status: 503 },
    );
  }

  try {
    const store = createCompassStore();
    const result = await scheduledMorningBriefJob({
      // date を渡さず、MCP と共通の既定「今日・Asia/Tokyo」を使う。
      generate: () => generateMorningBrief(store),
      notion: createMorningBriefNotionStore(notionToken),
      runs: createMorningBriefRunStore(),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[morning-brief] route_failed', { error: message });
    return NextResponse.json({ ok: false, error: 'morning_brief', message }, { status: 500 });
  }
}
