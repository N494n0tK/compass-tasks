/**
 * Compass — サーバー側のデータアクセス層（`/api/mcp` 専用）
 *
 * クライアントの `lib/persistence.ts` に対応するサーバー版。違いは 2 つだけ:
 *  - Firebase クライアント SDK ではなく REST（`firestoreRest.ts`）で読み書きする
 *  - 触れるのは **`users/{uid}/notes` と `users/{uid}/noteImports` の 2 コレクションだけ**
 *
 * `users/{uid}/settings/compass-ui-data`（復習・予定・点数・学習履歴が入った 1 ドキュメント）
 * には**読みにも書きにも行かない**。Notion 側の取り込みが既存セーブ全体を置き換える経路に
 * 混ざらないこと ―― これが「🔎 Compass × Study OS 接続監査」の P0-1 そのもの。
 *
 * 対象ユーザーは `COMPASS_MCP_UID` で固定する。サービスアカウントは全ユーザーを読めるので、
 * 「どの uid を触るか」をリクエスト側に決めさせない。
 */

import { sanitizeNotes } from '../logic/noteDocs';
import type { ImportRecord, ImportStatus, ImportMode } from '../logic/noteSync';
import type { Note } from '../model/notes';
import { createFirestoreClient, type FirestoreClient } from './firestoreRest';
import { readServiceAccount, ServiceAccountError } from './googleAuth';

/** 台帳に残す件数の既定。全部返すと MCP の応答が膨らむ */
export const IMPORT_LOG_DEFAULT_LIMIT = 20;

export class CompassSetupError extends Error {}

export interface CompassServerStore {
  readonly uid: string;
  /** 全ノート。`sanitizeNotes` を通すのでアプリと同じ読み方になる（旧 `blocks` も畳む） */
  loadNotes(): Promise<Note[]>;
  /** 1 件を全置換。`previousKeys` を渡すと、消えたフィールドも Firestore から消える */
  saveNote(note: Note, previousKeys?: readonly string[]): Promise<void>;
  readImport(key: string): Promise<ImportRecord | null>;
  writeImport(record: ImportRecord): Promise<void>;
  listImports(limit?: number): Promise<ImportRecord[]>;
}

/** `sanitizeNotes` が畳んでしまう旧フィールド。書き直すときに一緒に消す */
const LEGACY_NOTE_KEYS = ['blocks'] as const;

const notesPath = (uid: string) => 'users/' + uid + '/notes';
const importsPath = (uid: string) => 'users/' + uid + '/noteImports';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const IMPORT_STATUSES: readonly ImportStatus[] = [
  'validated',
  'created',
  'updated',
  'duplicate',
  'conflict',
  'rejected',
];

/** 生ドキュメント → `ImportRecord`。壊れた行は `null`（起動を止めない。`dataPatch` と同じ方針） */
export function toImportRecord(id: string, raw: Record<string, unknown>): ImportRecord | null {
  const status = str(raw.status) as ImportStatus;
  if (!IMPORT_STATUSES.includes(status)) return null;
  const mode = str(raw.mode) === 'commit' ? 'commit' : ('dry_run' as ImportMode);
  return {
    key: id,
    payloadHash: str(raw.payloadHash),
    noteId: str(raw.noteId),
    status,
    revision: typeof raw.revision === 'number' && raw.revision > 0 ? raw.revision : 1,
    mode,
    at: str(raw.at),
    source: str(raw.source) || 'unknown',
    date: str(raw.date),
    subject: str(raw.subject),
    unit: str(raw.unit),
  };
}

/**
 * env から実体を組み立てる。設定が足りなければ {@link CompassSetupError} を投げ、
 * 呼び出し側（`/api/mcp`）が「何を設定すればよいか」を返す。
 */
export function createCompassStore(client?: FirestoreClient, uidOverride?: string): CompassServerStore {
  const uid = uidOverride || (process.env.COMPASS_MCP_UID || '').trim();
  if (!uid) {
    throw new CompassSetupError(
      'COMPASS_MCP_UID が未設定です（Compass にログインして「データ」画面の UID を入れてください）',
    );
  }

  let fs = client;
  if (!fs) {
    let sa;
    try {
      sa = readServiceAccount();
    } catch (e) {
      throw new CompassSetupError(e instanceof ServiceAccountError ? e.message : String(e));
    }
    if (!sa) {
      throw new CompassSetupError(
        'FIREBASE_SERVICE_ACCOUNT が未設定です（docs/notebook/mcp.md のセットアップ手順を参照）',
      );
    }
    fs = createFirestoreClient(sa);
  }
  const db = fs;

  return {
    uid,

    async loadNotes() {
      const rows = await db.list(notesPath(uid));
      return sanitizeNotes(rows.map((r) => r.data));
    },

    async saveNote(note, previousKeys = []) {
      // `undefined` を落として素の JSON にする（クライアントの `firestoreSafeData` と同じ）
      const data = JSON.parse(JSON.stringify(note)) as Record<string, unknown>;
      // 旧 `blocks` を持ったままのドキュメントを書き直すときは、そのフィールドも消す。
      // 残しても `sanitizeNotes` は `sections` があれば読まないが、次に読む人を惑わせる。
      await db.set(notesPath(uid) + '/' + note.id, data, [...previousKeys, ...LEGACY_NOTE_KEYS]);
    },

    async readImport(key) {
      const raw = await db.get(importsPath(uid) + '/' + key);
      return raw ? toImportRecord(key, raw) : null;
    },

    async writeImport(record) {
      const { key: _key, ...body } = record;
      void _key;
      await db.set(importsPath(uid) + '/' + record.key, body as unknown as Record<string, unknown>);
    },

    async listImports(limit = IMPORT_LOG_DEFAULT_LIMIT) {
      const rows = await db.list(importsPath(uid));
      const out: ImportRecord[] = [];
      rows.forEach((row) => {
        const rec = toImportRecord(row.id, row.data);
        if (rec) out.push(rec);
      });
      // 新しい順。`at` は ISO 8601 なので文字列比較でよい
      out.sort((a, b) => b.at.localeCompare(a.at));
      return out.slice(0, Math.max(1, limit));
    },
  };
}
