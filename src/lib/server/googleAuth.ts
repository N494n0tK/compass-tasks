/**
 * Compass — サービスアカウントで Google のアクセストークンを取る（サーバー専用）
 *
 * `/api/mcp`（docs/notebook/mcp.md）は**ブラウザのログインを経由せずに** Firestore を読む。
 * クライアント SDK（`lib/firebase.ts`）はログイン済みユーザーの権限で動くので使えない。
 * かといって `firebase-admin` を足すと依存が一気に重くなるため、すでに入っている `jose` で
 * サービスアカウント JWT を署名し、OAuth2 のトークンエンドポイントで access token に
 * 交換する ―― これだけで Firestore REST API（`firestoreRest.ts`）が叩ける。
 *
 * 必要な env（Vercel の Production / Preview 両方に入れる。`NEXT_PUBLIC` を付けない）:
 *  - `FIREBASE_SERVICE_ACCOUNT` … サービスアカウント JSON そのまま、または base64
 *
 * サービスアカウントは Firestore を**ルール無視で**読み書きできる。だから
 * `/api/mcp` 側の入口（トークン照合）と `COMPASS_MCP_UID` の固定が安全境界になる。
 */

import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Firestore を読み書きするスコープ */
const SCOPE = 'https://www.googleapis.com/auth/datastore';

/** アクセストークンの寿命（秒）。Google 側の既定も 3600 */
const TOKEN_TTL_SEC = 3600;

/** 期限のどれだけ前に取り直すか（秒）。サーバーレスの時計ずれぶんの余裕 */
const REFRESH_MARGIN_SEC = 120;

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export class ServiceAccountError extends Error {}

/**
 * env からサービスアカウントを読む。未設定なら `null`（呼び出し側が 503 の設定案内を返す）。
 * 壊れている（JSON でない・鍵が無い）ときは投げる ―― 黙って未設定扱いにすると、
 * 設定したつもりで動かない状態が一番わかりにくい。
 */
export function readServiceAccount(): ServiceAccount | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ServiceAccountError('FIREBASE_SERVICE_ACCOUNT を JSON として読めません');
  }
  const projectId = String(parsed.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '');
  const clientEmail = String(parsed.client_email || '');
  // Vercel の env に貼ると改行が `\n` の 2 文字で入ることが多い
  const privateKey = String(parsed.private_key || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new ServiceAccountError(
      'FIREBASE_SERVICE_ACCOUNT に project_id / client_email / private_key が揃っていません',
    );
  }
  return { projectId, clientEmail, privateKey };
}

/**
 * インスタンスが生きている間だけのキャッシュ。サーバーレスでも 1 リクエスト 1 往復を防げる。
 * 鍵ごとに持つ（テストで別のサービスアカウントを渡しても混ざらない）。
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** テスト用。キャッシュを空にする */
export function resetAccessTokenCache(): void {
  tokenCache.clear();
}

/** アクセストークンを取る（キャッシュが生きていればそのまま返す） */
export async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCache.get(sa.clientEmail);
  if (hit && hit.expiresAt > now + REFRESH_MARGIN_SEC) return hit.token;

  const key = await importPKCS8(sa.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.clientEmail)
    .setSubject(sa.clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SEC)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ServiceAccountError(
      'Google のトークン取得に失敗しました (' + res.status + ')' + (body ? ': ' + body.slice(0, 300) : ''),
    );
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ServiceAccountError('access_token が返りませんでした');
  const ttl = typeof json.expires_in === 'number' ? json.expires_in : TOKEN_TTL_SEC;
  tokenCache.set(sa.clientEmail, { token: json.access_token, expiresAt: now + ttl });
  return json.access_token;
}
