import { describe, expect, it } from 'vitest';
import type { FirestoreClient, FirestoreSnapshot } from '../firestoreRest';
import {
  createMorningBriefRunStore,
  MORNING_BRIEF_LOCK_TTL_MS,
} from '../morningBriefRunStore';

function fakeFirestore() {
  const docs = new Map<string, FirestoreSnapshot>();
  let version = 0;
  const write = (path: string, data: Record<string, unknown>) => {
    version += 1;
    docs.set(path, { data: { ...data }, updateTime: 'v' + version });
  };
  const client: FirestoreClient = {
    async get(path) {
      return docs.get(path)?.data ?? null;
    },
    async getSnapshot(path) {
      const hit = docs.get(path);
      return hit ? { data: { ...hit.data }, updateTime: hit.updateTime } : null;
    },
    async list() {
      return [];
    },
    async set(path, data) {
      write(path, data);
    },
    async create(path, data) {
      if (docs.has(path)) return false;
      write(path, data);
      return true;
    },
    async setIfUnchanged(path, data, updateTime) {
      if (docs.get(path)?.updateTime !== updateTime) return false;
      write(path, data);
      return true;
    },
  };
  return { client, docs };
}

describe('MorningBriefRunStore', () => {
  it('同じ日付を原子的に 1 実行だけ claim する', async () => {
    const { client } = fakeFirestore();
    const store = createMorningBriefRunStore(client, 'uid');
    const now = new Date('2026-08-30T22:30:00.000Z');
    const first = await store.claim('2026-08-31', now);
    const second = await store.claim('2026-08-31', now);
    expect(first.claimed).toBe(true);
    expect(second).toMatchObject({ claimed: false, reason: 'running' });
  });

  it('失敗を記録した後は同じ日を再実行できる', async () => {
    const { client } = fakeFirestore();
    const store = createMorningBriefRunStore(client, 'uid');
    const now = new Date('2026-08-30T22:30:00.000Z');
    const first = await store.claim('2026-08-31', now);
    await store.markFailed('2026-08-31', first.owner, 'Notion API 503', now);
    expect((await store.claim('2026-08-31', now)).claimed).toBe(true);
  });

  it('異常終了で残ったロックは TTL 後に安全に引き継ぐ', async () => {
    const { client } = fakeFirestore();
    const store = createMorningBriefRunStore(client, 'uid');
    const now = new Date('2026-08-30T22:30:00.000Z');
    await store.claim('2026-08-31', now);
    const later = new Date(now.getTime() + MORNING_BRIEF_LOCK_TTL_MS + 1);
    expect((await store.claim('2026-08-31', later)).claimed).toBe(true);
  });

  it('作成完了した日付は再 claim しない', async () => {
    const { client } = fakeFirestore();
    const store = createMorningBriefRunStore(client, 'uid');
    const now = new Date('2026-08-30T22:30:00.000Z');
    const first = await store.claim('2026-08-31', now);
    await store.markCreated('2026-08-31', first.owner, 'page-1', now);
    expect(await store.claim('2026-08-31', now)).toMatchObject({
      claimed: false,
      reason: 'created',
    });
  });
});
