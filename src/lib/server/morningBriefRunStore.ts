/** Firestore を使った、朝メモ日付単位の分散ロックと実行台帳。 */

import { randomUUID } from 'node:crypto';
import type { ISODate } from '../model/types';
import { createFirestoreClient, type FirestoreClient, type FirestoreSnapshot } from './firestoreRest';
import { readServiceAccount, ServiceAccountError } from './googleAuth';

/** Vercel Function が異常終了しても、同じ日の手動再実行で回収できるようにする。 */
export const MORNING_BRIEF_LOCK_TTL_MS = 15 * 60 * 1000;

export interface MorningBriefClaim {
  claimed: boolean;
  owner: string;
  reason?: 'running' | 'created' | 'raced';
}

export interface MorningBriefRunStore {
  claim(date: ISODate, now: Date): Promise<MorningBriefClaim>;
  markCreated(date: ISODate, owner: string, pageId: string, now: Date): Promise<void>;
  markFailed(date: ISODate, owner: string, error: string, now: Date): Promise<void>;
}

function runPath(uid: string, date: ISODate): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('朝メモの日付が不正です: ' + date);
  return 'users/' + uid + '/morningBriefRuns/' + date;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function runningRecord(owner: string, now: Date) {
  return { status: 'running', owner, startedAt: now.toISOString() };
}

function isFreshRunning(snapshot: FirestoreSnapshot, now: Date): boolean {
  if (str(snapshot.data.status) !== 'running') return false;
  const started = Date.parse(str(snapshot.data.startedAt));
  return Number.isFinite(started) && now.getTime() - started < MORNING_BRIEF_LOCK_TTL_MS;
}

export function createMorningBriefRunStore(
  client?: FirestoreClient,
  uidOverride?: string,
): MorningBriefRunStore {
  const uid = uidOverride || (process.env.COMPASS_MCP_UID || '').trim();
  if (!uid) throw new Error('COMPASS_MCP_UID が未設定です');

  let db = client;
  if (!db) {
    let sa;
    try {
      sa = readServiceAccount();
    } catch (e) {
      throw new Error(e instanceof ServiceAccountError ? e.message : String(e));
    }
    if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT が未設定です');
    db = createFirestoreClient(sa);
  }
  const fs = db;

  async function updateOwned(
    date: ISODate,
    owner: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const path = runPath(uid, date);
    const snapshot = await fs.getSnapshot(path);
    if (!snapshot || str(snapshot.data.owner) !== owner) return false;
    return fs.setIfUnchanged(path, data, snapshot.updateTime, Object.keys(snapshot.data));
  }

  return {
    async claim(date, now) {
      const path = runPath(uid, date);
      const owner = randomUUID();
      const record = runningRecord(owner, now);
      if (await fs.create(path, record)) return { claimed: true, owner };

      const snapshot = await fs.getSnapshot(path);
      if (!snapshot) {
        return (await fs.create(path, record))
          ? { claimed: true, owner }
          : { claimed: false, owner, reason: 'raced' };
      }
      if (str(snapshot.data.status) === 'created') {
        return { claimed: false, owner, reason: 'created' };
      }
      if (isFreshRunning(snapshot, now)) {
        return { claimed: false, owner, reason: 'running' };
      }
      const replaced = await fs.setIfUnchanged(
        path,
        record,
        snapshot.updateTime,
        Object.keys(snapshot.data),
      );
      return replaced
        ? { claimed: true, owner }
        : { claimed: false, owner, reason: 'raced' };
    },

    async markCreated(date, owner, pageId, now) {
      const updated = await updateOwned(date, owner, {
        status: 'created',
        owner,
        pageId,
        completedAt: now.toISOString(),
      });
      if (!updated) throw new Error('朝メモの実行ロックを完了状態へ更新できませんでした');
    },

    async markFailed(date, owner, error, now) {
      await updateOwned(date, owner, {
        status: 'failed',
        owner,
        failedAt: now.toISOString(),
        error: error.slice(0, 300),
      });
    },
  };
}
