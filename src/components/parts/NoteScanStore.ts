'use client';

/**
 * Compass — ノートの写真の実体置き場（docs/notebook/spec.md §6.2）
 *
 * ノートの写真は**端末の IndexedDB に置く**。理由:
 *
 *  - Firestore の 1 ドキュメント上限は 1MB。スマホで撮ったノート 1 枚で軽く超える。
 *  - localStorage は文字列だけ・5MB 前後で、写真には狭すぎる。
 *  - Firebase Storage はこのプロジェクトでまだ有効化していない。
 *
 * なので `Note.scans` にはメタデータ（寸法・バイト数・見出し）だけを保存し、
 * 画像そのものはここが持つ。**現状は端末ローカル**で、別の端末では写真だけが
 * 見えない（メタデータは同期されるので枠と枚数は出る。§12-6 で受容した割り切り）。
 *
 * 取り込み時に長辺 `NOTE_SCAN_MAX_EDGE` まで縮め、JPEG に焼き直す。
 * ノートの字が読める解像度は保ちつつ、1 授業ぶんが数百 KB に収まる。
 *
 * `objectUrl()` が返す URL はモジュール内でキャッシュする。React の再レンダーごとに
 * `createObjectURL` すると同じ画像のぶんだけメモリが積み上がるため。
 */

import {
  NOTE_SCAN_MAX_EDGE,
  type NoteScan,
} from '../../lib/model/notes';

const DB_NAME = 'compass-note-scans';
const DB_VERSION = 1;
const STORE = 'scans';

/** IndexedDB のキー。ノートを消したら前方一致で掃除できる形にしておく */
export function scanKey(noteId: string, scanId: string): string {
  return noteId + ':' + scanId;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('この端末では写真を保存できません（IndexedDB が使えません）'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB を開けませんでした'));
  });
  // 失敗したら次回もう一度開き直せるようにする（Safari のプライベートモードなど）
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB の読み書きに失敗しました'));
      }),
  );
}

// ─────────────────────────────────────────────────────────────
// 読み書き
// ─────────────────────────────────────────────────────────────

export function putScanBlob(noteId: string, scanId: string, blob: Blob): Promise<void> {
  return tx('readwrite', (s) => s.put(blob, scanKey(noteId, scanId))).then(() => undefined);
}

export function getScanBlob(noteId: string, scanId: string): Promise<Blob | null> {
  return tx<Blob | undefined>('readonly', (s) => s.get(scanKey(noteId, scanId))).then(
    (v) => v || null,
  );
}

export function deleteScanBlob(noteId: string, scanId: string): Promise<void> {
  revokeObjectUrl(noteId, scanId);
  return tx('readwrite', (s) => s.delete(scanKey(noteId, scanId))).then(() => undefined);
}

/** ノートを消したとき。そのノートの写真を全部落とす */
export async function deleteNoteScans(noteId: string, scans: readonly NoteScan[]): Promise<void> {
  await Promise.all(
    scans.map((s) =>
      deleteScanBlob(noteId, s.scanId).catch(() => {
        /* 1 枚消せなくても残りは消す */
      }),
    ),
  );
}

// ─────────────────────────────────────────────────────────────
// 表示用の URL（キャッシュ付き）
// ─────────────────────────────────────────────────────────────

const urlCache = new Map<string, string>();

/** 描画用の `blob:` URL。同じ写真には同じ URL を返す */
export async function objectUrl(noteId: string, scanId: string): Promise<string | null> {
  const key = scanKey(noteId, scanId);
  const hit = urlCache.get(key);
  if (hit) return hit;
  const blob = await getScanBlob(noteId, scanId);
  if (!blob) return null;
  // 並行して呼ばれて 2 本作られたときは先着を残す
  const existing = urlCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function revokeObjectUrl(noteId: string, scanId: string): void {
  const key = scanKey(noteId, scanId);
  const url = urlCache.get(key);
  if (!url) return;
  URL.revokeObjectURL(url);
  urlCache.delete(key);
}

// ─────────────────────────────────────────────────────────────
// 取り込み（縮小して JPEG に焼き直す）
// ─────────────────────────────────────────────────────────────

export interface PreparedScan {
  blob: Blob;
  mime: string;
  w: number;
  h: number;
}

/**
 * 選ばれたファイルを表示用に整える。長辺を {@link NOTE_SCAN_MAX_EDGE} まで縮め、
 * JPEG（品質 0.82）に焼き直す。HEIC など `createImageBitmap` が読めない形式は
 * `<img>` 経由で読み直す。
 */
export async function prepareScan(file: File): Promise<PreparedScan> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, NOTE_SCAN_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  // ノートの細い線を潰さないよう、縮小は高品質で
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82),
  );
  if (!blob) throw new Error('画像を保存できる形にできませんでした');
  return { blob, mime: 'image/jpeg', w, h };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* HEIC など。<img> で読み直す */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('この画像は読み込めませんでした'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `'s' + base36`。ノート内での一意性は呼び出し側が確認する */
export function newScanId(index: number): string {
  return 's' + Date.now().toString(36) + index.toString(36);
}
