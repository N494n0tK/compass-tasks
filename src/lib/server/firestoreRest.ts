/**
 * Compass — Firestore REST API の最小クライアント（サーバー専用）
 *
 * `firebase-admin` を足さずに済ませるための薄い層。やることは 2 つだけ:
 *  1. Firestore の「型付き値」（`stringValue` / `mapValue` …）と素の JSON の相互変換
 *  2. document の取得・一覧・全置換
 *
 * Compass が Firestore に入れているのは `JSON.parse(JSON.stringify(...))` を通した
 * 素の JSON（`persistence.firestoreSafeData`）だけなので、変換で扱うのは
 * 文字列・数値・真偽・null・配列・オブジェクトの 6 つで足りる。
 * 読む側は保険として `timestampValue` / `referenceValue` / `bytesValue` も文字列に落とす。
 *
 * 認証は `googleAuth.accessToken()`。React / firebase を import しない。
 */

import { accessToken, type ServiceAccount } from './googleAuth';

const API_ROOT = 'https://firestore.googleapis.com/v1';

/** 一覧の 1 往復で取る件数。Firestore の上限は 300 */
const PAGE_SIZE = 300;

/** 一覧で読む総件数の上限。暴走した読み取りでタイムアウトさせないための保険 */
export const LIST_HARD_LIMIT = 2000;

export class FirestoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────
// 値の変換
// ─────────────────────────────────────────────────────────────

/** Firestore の整数値として送れる範囲（それ以外は double にする） */
const SAFE_INT = Number.MAX_SAFE_INTEGER;

export function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { doubleValue: value };
    return Number.isInteger(value) && Math.abs(value) <= SAFE_INT
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  }
  // 関数・Symbol などはデータに入らない（`firestoreSafeData` と同じく落とす）
  return { nullValue: null };
}

export function toFirestoreFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] === undefined) return;
    out[k] = toFirestoreValue(obj[k]);
  });
  return out;
}

export function fromFirestoreValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('referenceValue' in v) return String(v.referenceValue);
  if ('bytesValue' in v) return String(v.bytesValue);
  if ('arrayValue' in v) {
    const values = (v.arrayValue as { values?: unknown[] } | undefined)?.values;
    return Array.isArray(values) ? values.map(fromFirestoreValue) : [];
  }
  if ('mapValue' in v) {
    const fields = (v.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields;
    return fields ? fromFirestoreFields(fields) : {};
  }
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

export function fromFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(fields).forEach((k) => {
    out[k] = fromFirestoreValue(fields[k]);
  });
  return out;
}

/** `updateMask.fieldPaths` に入れる形。識別子でないキーはバッククォートで包む */
export function fieldPath(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : '`' + key.replace(/`/g, '\\`') + '`';
}

// ─────────────────────────────────────────────────────────────
// document 操作
// ─────────────────────────────────────────────────────────────

export interface FirestoreClient {
  /** 1 件読む。無ければ `null` */
  get(path: string): Promise<Record<string, unknown> | null>;
  /** 競合検出に使う `updateTime` 付きの読み取り。 */
  getSnapshot(path: string): Promise<FirestoreSnapshot | null>;
  /** コレクションを全件読む（`LIST_HARD_LIMIT` まで）。戻りは `{ id, data }` */
  list(collectionPath: string): Promise<{ id: string; data: Record<string, unknown> }[]>;
  /**
   * 1 件を**全置換**で書く。`data` に無いフィールドは消える
   * （クライアントの `setDoc` と同じ挙動。`previousKeys` で消す対象を明示する）。
   */
  set(path: string, data: Record<string, unknown>, previousKeys?: readonly string[]): Promise<void>;
  /** ドキュメントが無いときだけ作る。既存なら `false`（日付単位ロック用）。 */
  create(path: string, data: Record<string, unknown>): Promise<boolean>;
  /** 読み取った `updateTime` から変わっていないときだけ全置換する。 */
  setIfUnchanged(
    path: string,
    data: Record<string, unknown>,
    updateTime: string,
    previousKeys?: readonly string[],
  ): Promise<boolean>;
}

export interface FirestoreSnapshot {
  data: Record<string, unknown>;
  updateTime: string;
}

function docsRoot(projectId: string): string {
  return API_ROOT + '/projects/' + projectId + '/databases/(default)/documents';
}

/** REST クライアントを作る。`path` は `users/uid/notes/n1` のようなコレクション相対パス */
export function createFirestoreClient(sa: ServiceAccount): FirestoreClient {
  const root = docsRoot(sa.projectId);

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await accessToken(sa);
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      cache: 'no-store',
    });
  }

  async function fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => '');
    throw new FirestoreError(
      'Firestore ' + what + ' に失敗 (' + res.status + ')' + (body ? ': ' + body.slice(0, 300) : ''),
      res.status,
    );
  }

  async function getSnapshot(path: string): Promise<FirestoreSnapshot | null> {
    const res = await call(root + '/' + path);
    if (res.status === 404) return null;
    if (!res.ok) await fail(res, 'get ' + path);
    const json = (await res.json()) as { fields?: Record<string, unknown>; updateTime?: unknown };
    return {
      data: fromFirestoreFields(json.fields ?? {}),
      updateTime: typeof json.updateTime === 'string' ? json.updateTime : '',
    };
  }

  function updateQuery(data: Record<string, unknown>, previousKeys: readonly string[] = []): string {
    const paths = Array.from(new Set([...Object.keys(data), ...previousKeys])).map(fieldPath);
    return paths.map((p) => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
  }

  return {
    async get(path) {
      return (await getSnapshot(path))?.data ?? null;
    },

    getSnapshot,

    async list(collectionPath) {
      const out: { id: string; data: Record<string, unknown> }[] = [];
      let pageToken = '';
      do {
        const query =
          '?pageSize=' + PAGE_SIZE + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const res = await call(root + '/' + collectionPath + query);
        if (res.status === 404) return out;
        if (!res.ok) await fail(res, 'list ' + collectionPath);
        const json = (await res.json()) as {
          documents?: { name?: string; fields?: Record<string, unknown> }[];
          nextPageToken?: string;
        };
        (json.documents ?? []).forEach((doc) => {
          const name = String(doc.name ?? '');
          const id = name.slice(name.lastIndexOf('/') + 1);
          if (id) out.push({ id, data: fromFirestoreFields(doc.fields ?? {}) });
        });
        pageToken = json.nextPageToken ?? '';
      } while (pageToken && out.length < LIST_HARD_LIMIT);
      // 1 ページ 300 件なので、最後のページで上限をまたぐ。返す件数は必ず上限以内に切る
      return out.length > LIST_HARD_LIMIT ? out.slice(0, LIST_HARD_LIMIT) : out;
    },

    async set(path, data, previousKeys = []) {
      // 新しいキー ∪ 消したい古いキー を updateMask に並べる。マスクに載って本文に無い
      // フィールドはサーバー側で削除されるので、これで「全置換」と同じ結果になる。
      const query = updateQuery(data, previousKeys);
      const res = await call(root + '/' + path + '?' + query, {
        method: 'PATCH',
        body: JSON.stringify({ fields: toFirestoreFields(data) }),
      });
      if (!res.ok) await fail(res, 'set ' + path);
    },

    async create(path, data) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length < 2 || parts.length % 2 !== 0) {
        throw new FirestoreError('Firestore create の document path が不正です: ' + path, 400);
      }
      const documentId = parts.pop() as string;
      const collectionPath = parts.join('/');
      const res = await call(
        root + '/' + collectionPath + '?documentId=' + encodeURIComponent(documentId),
        {
          method: 'POST',
          body: JSON.stringify({ fields: toFirestoreFields(data) }),
        },
      );
      if (res.status === 409) return false;
      if (!res.ok) await fail(res, 'create ' + path);
      return true;
    },

    async setIfUnchanged(path, data, updateTime, previousKeys = []) {
      if (!updateTime) return false;
      const mask = updateQuery(data, previousKeys);
      const query =
        mask +
        (mask ? '&' : '') +
        'currentDocument.updateTime=' +
        encodeURIComponent(updateTime);
      const res = await call(root + '/' + path + '?' + query, {
        method: 'PATCH',
        body: JSON.stringify({ fields: toFirestoreFields(data) }),
      });
      if (res.status === 409 || res.status === 412) return false;
      // Firestore は precondition 不一致を HTTP 400 + FAILED_PRECONDITION で返すこともある。
      if (res.status === 400) {
        const body = await res.text().catch(() => '');
        if (body.includes('FAILED_PRECONDITION')) return false;
        throw new FirestoreError(
          'Firestore compare-and-set ' + path + ' に失敗 (400)' + (body ? ': ' + body.slice(0, 300) : ''),
          400,
        );
      }
      if (!res.ok) await fail(res, 'compare-and-set ' + path);
      return true;
    },
  };
}
