'use client';

/**
 * Compass — 保存トリガと起動時ロード（Phase 2B / TASK S0）
 *
 * 出典: HTML:2290-2316（`loadCloudState`）、2328-2349（`scheduleSave`）、2351-2384（`saveNow`）、
 * 2386-2398（`forceSaveNow`）、2416（`componentDidUpdate` → `scheduleSave`）。
 * spec §4.14 / C-34〜C-40 / C-485〜C-492 / C-139。
 *
 * レガシーとの対応:
 * - `componentDidUpdate` が毎レンダー `scheduleSave()` を呼ぶ → ストア購読 + microtask 1 回に畳む
 *   （同期コード内の連続ミューテーションを 1 回にまとめる ≒ React のバッチ）。
 * - `fetch('/api/app-state')` は `lib/persistence.ts` の `loadCloudState` / `saveCloudState` に置換。
 *   HTTP を挟まないので **成功=解決 / 失敗=reject** の 2 値（architecture §5）。
 *   401/403/503 の分岐（spec Q39, 到達不能）は移植しない。
 */

import { dataPatch, type DataPatchResult } from '../../lib/dataPatch';
import type { ExportData, ISODate, Plans } from '../../lib/model/types';
import {
  cloudErrorMessage,
  type CompassPersistence,
  type SplashGate,
} from '../../lib/persistence';
import type { CompassStore } from '../../lib/store';
import { writeLocalData } from './ShellPrefs';

/** `setTimeout(..., 280)`（HTML:2348）— トレーリングデバウンス */
export const SAVE_DEBOUNCE_MS = 280;
/** 同一 JSON の再試行スロットル（HTML:2336） */
export const SAVE_RETRY_THROTTLE_MS = 1200;

/** 保存準備前の `Cmd/Ctrl+S`（HTML:2387） */
export const TOAST_SAVE_NOT_READY = '保存準備中です';
/** 即時保存の成功（HTML:2397） */
export const TOAST_SAVE_OK = 'Firebaseに保存しました';
/** 即時保存の失敗（HTML:2397）。`+ (_lastCloudError || '未接続')` */
export const TOAST_SAVE_FAIL_PREFIX = 'Firebase保存に失敗: ';
export const TOAST_SAVE_FAIL_FALLBACK = '未接続';

// ─────────────────────────────────────────────────────────────
// dataPatch の差し込み口
// ─────────────────────────────────────────────────────────────

/** `dataPatch(raw)`（HTML:2198-2282 / spec §4.15）の戻り。実装は `lib/dataPatch.ts` */
export type { DataPatchResult };

export type DataPatchFn = (
  raw: unknown,
  current: { plans: Plans; today: ISODate }
) => DataPatchResult;

/** 既定は `lib/dataPatch.ts` の本実装（TASK I0 で結線済み） */
let dataPatchImpl: DataPatchFn = dataPatch;

/**
 * `dataPatch` を差し替える（テスト用）。`null` で本実装へ戻す。
 * 本番経路では呼ぶ必要はない（既定で `lib/dataPatch.ts` が入っている）。
 */
export function registerDataPatch(fn: DataPatchFn | null): void {
  dataPatchImpl = fn ?? dataPatch;
}

/** 保存データを `dataPatch(raw)` に通す（HTML:2117-2120 / 2299） */
export function runDataPatch(
  raw: unknown,
  current: { plans: Plans; today: ISODate }
): DataPatchResult {
  return dataPatchImpl(raw, current);
}

// ─────────────────────────────────────────────────────────────
// SaveController
// ─────────────────────────────────────────────────────────────

/** `json.data && json.data.data ? json.data.data : json.data`（HTML:2296） */
function unwrapSaved(data: unknown): unknown {
  if (data && typeof data === 'object' && (data as { data?: unknown }).data) {
    return (data as { data?: unknown }).data;
  }
  return data;
}

/** `json.data && json.data.email`（HTML:2297） */
function emailOf(data: unknown): string {
  if (data && typeof data === 'object') {
    const v = (data as { email?: unknown }).email;
    if (typeof v === 'string') return v;
  }
  return '';
}

/**
 * レガシーの `_saveReady` / `_lastSaveJson` / `_saveQueuedJson` / `_lastAttemptJson` /
 * `_saveTimer` / `_lastCloudError` を 1 か所にまとめたもの。**uid セッションごとに 1 つ**。
 */
export class SaveController {
  /** `this._saveReady`（HTML:2143）。クラウド読込中は保存しない（C-492） */
  private saveReady = false;
  /** `this._lastSaveJson` */
  private lastSaveJson: string | null = null;
  private saveQueuedJson: string | null = null;
  private saveQueuedPayload: ExportData | null = null;
  private lastAttemptJson: string | null = null;
  private lastAttemptAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** `this._lastCloudError`（HTML:2374）。失敗トーストの理由に入る */
  private lastCloudError = '';
  /**
   * `this._dataRepaired`（HTML:2267 / 2275）。**インスタンスフィールドなので
   * localStorage 側の `dataPatch` で立った分もクラウド読込のコールバックまで残る**
   * （HTML:2119 → 2308）。`markRepaired()` で持ち込む。
   */
  private dataRepaired = false;

  private microtaskQueued = false;
  private disposed = false;

  constructor(
    private readonly store: CompassStore,
    private readonly persistence: CompassPersistence,
    private readonly uid: string,
    private readonly email: string,
    private readonly gate: SplashGate,
    private readonly today: ISODate
  ) {}

  /**
   * 起動時の localStorage 復元（HTML:2117-2120）で M4 / M5 が走ったことを持ち込む。
   * レガシーの `this._dataRepaired = true` が componentDidMount から
   * `loadCloudState` のコールバックまで残るのと同じ（C-502）。
   */
  markRepaired(): void {
    this.dataRepaired = true;
  }

  /** `ready()`（HTML:2143-2148）の前半。`resetUndoBaseline()` は呼び出し側で */
  markReady(): void {
    this.saveReady = true;
    this.lastSaveJson = JSON.stringify(this.store.exportData());
  }

  /**
   * ストア購読から呼ぶ。レガシーの `componentDidUpdate` 相当の粒度になるよう
   * microtask 1 回に畳む。
   */
  notifyChanged = (): void => {
    if (this.disposed || this.microtaskQueued) return;
    this.microtaskQueued = true;
    queueMicrotask(() => {
      this.microtaskQueued = false;
      if (!this.disposed) this.scheduleSave();
    });
  };

  /** `scheduleSave()`（HTML:2328-2349）— 判定順もそのまま */
  scheduleSave(): void {
    if (!this.saveReady) return;
    const payload = this.store.exportData();
    const json = JSON.stringify(payload);
    if (json === this.lastSaveJson) return;
    const now = Date.now();
    if (json === this.saveQueuedJson) return;
    if (json === this.lastAttemptJson && now - this.lastAttemptAt < SAVE_RETRY_THROTTLE_MS) return;
    this.saveQueuedJson = json;
    this.saveQueuedPayload = payload;
    writeLocalData(json);
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    if (this.store.getState().cloudStatus !== 'saving') {
      this.store.setState({ cloudStatus: 'saving' });
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const queued = this.saveQueuedJson;
      const queuedPayload = this.saveQueuedPayload;
      this.lastAttemptJson = queued;
      this.lastAttemptAt = Date.now();
      void this.saveNow(queuedPayload ?? undefined, queued ?? undefined);
    }, SAVE_DEBOUNCE_MS);
  }

  /** `saveNow(payload, queuedJson)`（HTML:2351-2384） */
  async saveNow(payload?: ExportData, queuedJson?: string): Promise<boolean> {
    const data = payload || this.store.exportData();
    const dataJson = queuedJson || JSON.stringify(data);
    writeLocalData(dataJson);
    try {
      await this.persistence.saveCloudState(this.uid, data, this.email);
      this.lastSaveJson = dataJson;
      if (this.saveQueuedJson === dataJson) {
        this.saveQueuedJson = null;
        this.saveQueuedPayload = null;
      }
      this.lastCloudError = '';
      this.store.setState({ cloudStatus: 'saved' });
      return true;
    } catch (e) {
      if (this.saveQueuedJson === dataJson) {
        this.saveQueuedJson = null;
        this.saveQueuedPayload = null;
      }
      this.lastCloudError = cloudErrorMessage(e);
      this.store.setState({ cloudStatus: 'local' });
      return false;
    }
  }

  /** `forceSaveNow()`（HTML:2386-2398）— `Cmd/Ctrl+S` */
  forceSaveNow = async (): Promise<void> => {
    if (!this.saveReady) {
      this.store.showToast(TOAST_SAVE_NOT_READY);
      return;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload = this.store.exportData();
    const json = JSON.stringify(payload);
    this.saveQueuedJson = null;
    this.saveQueuedPayload = null;
    this.lastAttemptJson = json;
    this.lastAttemptAt = Date.now();
    writeLocalData(json);
    this.store.setState({ cloudStatus: 'saving' });
    const ok = await this.saveNow(payload, json);
    this.store.showToast(
      ok ? TOAST_SAVE_OK : TOAST_SAVE_FAIL_PREFIX + (this.lastCloudError || TOAST_SAVE_FAIL_FALLBACK)
    );
  };

  /** `loadCloudState()`（HTML:2290-2316）— 起動時に 1 回だけ（C-34） */
  async loadCloudState(): Promise<void> {
    try {
      const res = await this.persistence.loadCloudState(this.uid, this.email);
      const saved = unwrapSaved(res.data);
      const user = res.email || emailOf(res.data) || this.store.getState().cloudUser;
      if (saved) {
        this.saveReady = false;
        const patch = runDataPatch(saved, {
          plans: this.store.getPlans(),
          today: this.today,
        });
        this.store.update({
          plans: patch.plans,
          state: { ...patch.state, cloudStatus: 'saved', cloudUser: user || '' },
        });
        this.lastSaveJson = JSON.stringify(this.store.exportData());
        this.saveReady = true;
        this.store.resetUndoBaseline();
        // HTML:2308 — `if (this._dataRepaired) { this._dataRepaired = false; this.saveNow(); }`
        if (patch.repaired) this.dataRepaired = true;
        if (this.dataRepaired) {
          this.dataRepaired = false;
          void this.saveNow();
        }
        this.gate.notifyReady();
      } else {
        this.store.setState({ cloudStatus: 'saved', cloudUser: user || '' });
        void this.saveNow();
        this.gate.notifyReady();
      }
    } catch {
      this.store.setState({ cloudStatus: 'local' });
      this.gate.notifyReady();
    }
  }

  /** アンマウント時（`componentWillUnmount`, HTML:2151-2157 相当） */
  dispose(): void {
    this.disposed = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
