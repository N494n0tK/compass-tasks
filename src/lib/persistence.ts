/**
 * Compass — Firestore 永続化レイヤ（現行 `src/app/AppShell.tsx` のブリッジを 1:1 移植）
 *
 * 出典:
 *  - SHELL:29-181（doc 参照 / `firestoreSafeData` / `reviewsHolderOf` / `sortAndStripSeq` /
 *    `invalidDocIdReason` / `migrateReviewsToCollection`）
 *  - SHELL:280-286, 317-365（A-2-1: GET と baseline 確定）
 *  - SHELL:367-511（A-2-3: 差分書き込み PUT）
 *  - SHELL:513-554（A-2-2: `COMPASS_MIGRATE_REVIEWS`）
 *  - SHELL:304-314, 558-566（preview スタブ / ユーザー切り替え時の破棄）
 *  - HTML:2277-2285 `notifyReady()`（スプラッシュの最低表示時間 2900ms）
 *  - spec §1.2 / §1.3 / §4.14、architecture §5 / §7
 *
 * ## この移植で変わったこと（挙動は不変）
 * - `window.COMPASS_CLOUD_GET/PUT/MIGRATE_REVIEWS` というグローバルも iframe も持たない。
 *   呼び出し側が `createPersistence()` の戻り値を直接 await する。
 * - AppShell が `useRef` で持っていた baseline 3点（`baselineReviews` / `baselineLoaded` /
 *   `migratedAtRef`）は、このモジュールのインスタンス状態になる。**uid セッションごとに1つ**。
 *   ユーザー切り替えでは `reset()`（AppShell の effect cleanup 相当）。
 * - HTTP を挟まないので 200/500 という中間表現は無い。**成功 = 解決 / 失敗 = reject** とし、
 *   レガシーが 500 の `{error}` から取り出していた文字列は `cloudErrorMessage()` で再現する。
 *   architecture §5 のとおり 401/403/503 の分岐（spec Q39, 到達不能）は移植しない。
 *
 * firebase の import はこのモジュールでのみ許可（architecture §2）。React は import しない。
 */

import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from './firebase';

// ─────────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────────

/** Firestore のドキュメントIDの上限（UTF-8 バイト数, SHELL:75） */
export const DOC_ID_MAX_BYTES = 1500;

/** 1 writeBatch に入れられる操作数の Firestore 制限（SHELL:76） */
export const FIRESTORE_BATCH_LIMIT = 500;

/** 1バッチに詰める操作数の上限。Firestore の 500 に対して余裕を取る（SHELL:78） */
export const OPS_PER_BATCH = 450;

/** スプラッシュの最低表示時間。`componentDidMount` からの経過（HTML:2283 / spec C-23） */
export const SPLASH_MIN_MS = 2900;

/**
 * スプラッシュの保険タイマー。**レガシーには無い追加**（architecture §7-2 の指示。
 * spec Q20「notifyReady 不達で永久スプラッシュ」を再現しないため）。
 * これが発火しても経路は `notifyReady()` と同じなので、最低表示時間は必ず守られる。
 */
export const SPLASH_FAILSAFE_MS = 12000;

/** preview（Firebase 未設定 / `?preview=1`）で名乗るメールアドレス（SHELL:307, 570） */
export const PREVIEW_EMAIL = 'preview@localhost';

// ─────────────────────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────────────────────

/**
 * `state.reviews` の1要素。Firestore から読んだ生データも通るので、
 * ここでは意図的に緩い型のまま扱う（レガシーと同じく検査もしない）。
 * 呼び出し側が `dataPatch()` を通した後に `Review` として解釈する。
 */
export type ReviewTask = Record<string, unknown>;

/** GET で `state.reviews` をどこから取ったか（`[A-2-1]` のログと同じ区分） */
export type ReviewsSource =
  /** 保存が空、または `state` を持たない構造。reviews に触っていない */
  | 'none'
  /** 未移行。`data.state.reviews` をそのまま使う */
  | 'embedded'
  /** 移行済み。`users/{uid}/reviewTasks` の内容で丸ごと差し替えた */
  | 'collection'
  /** 移行済みだがコレクションを読めなかった。埋め込みへ退避し baseline を無効化した */
  | 'fallback';

/** `loadCloudState()` の戻り。`data` は `exportData()` 相当の生データ（`dataPatch()` へ渡す） */
export interface CloudLoadResult {
  /** `users/{uid}/settings/compass-ui-data` の `data` フィールド。無ければ `null` */
  data: unknown;
  /** レガシーの `json.email`。`user.email ?? ''` */
  email: string;
  /** 追加情報（レガシーの戻りには無い）。`console.info('[A-2-1] …')` と同じ区分 */
  reviewsSource: ReviewsSource;
}

/** PUT がどの経路を通ったか（`[A-2-3]` のログと同じ区分） */
export type SaveMode =
  /** 未移行。メインドキュメントだけを全置換した（`reviewTasks` には触れない） */
  | 'embedded'
  /** 移行済み。`reviewTasks` の差分反映に成功し `reviewsMigratedAt` を維持した */
  | 'migrated'
  /** 移行済みだが全件を反映できなかった。フラグを落として次回の GET を埋め込みへ戻す */
  | 'fallback';

/**
 * `saveCloudState()` の戻り。
 *
 * > **注意**: `cloudStatus` は **`ok` だけ**で決めること（レガシー: `res.ok` → `'saved'` /
 * > それ以外 → `'local'`, HTML:2334）。`storage` は表示・ログ用の付帯情報でしかない。
 * > preview は保存していないが `ok: true` を返す（SHELL:308 と同じ）ので、
 * > レガシー同様 `'saved'` 表示になる。
 */
export interface CloudSaveResult {
  ok: true;
  storage: 'firebase' | 'local';
  mode: SaveMode;
  /** `reviewTasks` へ set した件数 */
  updated: number;
  /** `reviewTasks` から delete した件数 */
  deleted: number;
}

/** `COMPASS_MIGRATE_REVIEWS()` の戻り（SHELL:19） */
export interface MigrateResult {
  ok: boolean;
  migrated: number;
  skipped?: string;
}

/** GET / PUT の実装。Firestore 版と preview 版が同じ形を実装する */
export interface CompassPersistence {
  readonly kind: 'firebase' | 'local';
  /**
   * 起動時に1回だけ呼ぶ（spec §4.14「再取得・ポーリング・フォーカス時再読込はない」）。
   * @param email 省略時は `auth.currentUser.email ?? ''`（AppShell は `user.email ?? ''`）
   */
  loadCloudState(uid: string, email?: string): Promise<CloudLoadResult>;
  /** `data` は `exportData()` の戻り（`{version, plans, state}`）をそのまま渡す */
  saveCloudState(uid: string, data: unknown, email?: string): Promise<CloudSaveResult>;
  /** ユーザー切り替え・サインアウト時に baseline とフラグを破棄する（SHELL:562-565） */
  reset(): void;
}

// ─────────────────────────────────────────────────────────────
// Firestore 参照とプリミティブ（SHELL:29-123 をそのまま）
// ─────────────────────────────────────────────────────────────

function compassStateDoc(uid: string) {
  return doc(getDb(), 'users', uid, 'settings', 'compass-ui-data');
}

const reviewTasksCol = (uid: string) => collection(getDb(), 'users', uid, 'reviewTasks');

/** `undefined` フィールドを落とす（Firestore は undefined を受け付けない, SHELL:35-37） */
function firestoreSafeData(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data));
}

/** AppShell の `user.email ?? ''` に相当。ブリッジと違い uid しか受け取らないため auth から引く */
function currentUserEmail(): string {
  if (!isFirebaseConfigured()) return '';
  try {
    return getFirebaseAuth().currentUser?.email ?? '';
  } catch {
    return '';
  }
}

/** state.reviews を持つ形かどうかだけを見る。想定外の構造なら null を返す（SHELL:42-47） */
function reviewsHolderOf(data: unknown): { state: Record<string, unknown> } | null {
  if (!data || typeof data !== 'object') return null;
  const state = (data as Record<string, unknown>).state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return { state: state as Record<string, unknown> };
}

/**
 * reviewTasks コレクションを読み、保存時に振った `_seq` の昇順へ戻す（SHELL:54-73）。
 * `_seq` が無いものは末尾へ送り、その中は id 昇順で安定させる。
 * 返す各要素からは `_seq` を取り除く（埋め込み時と同じ形にするため）。
 */
export function sortAndStripSeq(rows: { id: string; body: ReviewTask }[]): ReviewTask[] {
  const seqOf = (body: ReviewTask) =>
    typeof body._seq === 'number' && Number.isFinite(body._seq) ? body._seq : null;

  return rows
    .slice()
    .sort((a, b) => {
      const sa = seqOf(a.body);
      const sb = seqOf(b.body);
      if (sa !== null && sb !== null) return sa - sb || a.id.localeCompare(b.id);
      if (sa !== null) return -1;
      if (sb !== null) return 1;
      return a.id.localeCompare(b.id);
    })
    .map(({ body }) => {
      const { _seq: _drop, ...rest } = body;
      void _drop;
      return rest;
    });
}

function idOf(review: ReviewTask): string | null {
  const id = (review as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

/** `_seq` を落とした素の内容を返す。差分比較と baseline の保存に使う（SHELL:86-90） */
function stripSeq(review: ReviewTask): ReviewTask {
  const { _seq: _drop, ...rest } = review;
  void _drop;
  return rest;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    return Object.keys(src)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep(src[k]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * キー順に依存しない JSON 文字列（SHELL:108-110）。Firestore 由来とアプリ由来で
 * キーの並びが違っても、内容が同じなら同じ文字列になる。
 *
 * ※ `exportData()` の保存トリガ判定（spec §4.14「保存判定の注意」）とは別物。
 *    あちらは 23 キーの**配列順に依存する素の `JSON.stringify`** を使う。
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/** Firestore のドキュメントIDとして使えない理由を返す。使えるなら null（SHELL:113-123） */
export function invalidDocIdReason(id: unknown): string | null {
  if (typeof id !== 'string') return `id が文字列でない (型: ${typeof id})`;
  if (!id) return 'id が空文字';
  if (/^ +$/.test(id)) return 'id が半角スペースのみ';
  if (id.includes('/')) return '"/" を含む';
  if (id === '.' || id === '..') return `"${id}" と完全一致`;
  if (id.startsWith('__') && id.endsWith('__')) return '"__" で始まり "__" で終わる';
  const bytes = new TextEncoder().encode(id).length;
  if (bytes > DOC_ID_MAX_BYTES) return `UTF-8 ${bytes} バイト (>${DOC_ID_MAX_BYTES})`;
  return null;
}

/**
 * 保存の失敗理由を1つの文字列にする。
 *
 * レガシーでは iframe の fetch シムが `error.code || error.message || 'firebase_bridge_failed'`
 * を status 500 の `{error}` に詰め（SHELL:224）、アプリ側が `_lastCloudError` に入れていた
 * （HTML:2330）。ブリッジを廃したので、その文字列生成だけをここに残す。
 * 「Firebase保存に失敗: 〜」トースト（HTML:2360）の 〜 に入る。
 */
export function cloudErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'firebase_bridge_failed';
}

// ─────────────────────────────────────────────────────────────
// A-2-2 移行（SHELL:125-181, 513-554）
// ─────────────────────────────────────────────────────────────

/**
 * `state.reviews` を `users/{uid}/reviewTasks/{review.id}` へ複製する（A-2-2, SHELL:135-181）。
 * `state.reviews` 側は消さない（二重保持）。
 *
 * - 配列内の位置を `_seq` として付与する。読み出し側はこれで元の並びへ戻す。
 * - 使えない id が1件でもあれば、1件も書かずに中断する。
 * - `reviewsMigratedAt` は必ず `merge:true` で書く。compass-ui-data の
 *   既存フィールド（data / email / updatedAt）を消さないため。
 * - 全件 + フラグを1つの writeBatch でアトミックにコミットする。
 */
export async function migrateReviewsToCollection(
  uid: string,
  reviews: ReviewTask[]
): Promise<MigrateResult> {
  // 先に全件を検査する。1件でもNGなら書き込みを開始しない。
  const bad = reviews
    .map((review, i) => {
      const id = (review as { id?: unknown }).id;
      return { i, id, reason: invalidDocIdReason(id) };
    })
    .filter((row) => row.reason !== null);

  if (bad.length > 0) {
    const detail = bad.map((b) => `#${b.i} ${JSON.stringify(b.id)}: ${b.reason}`).join(' / ');
    return {
      ok: false,
      migrated: 0,
      skipped: `ドキュメントIDに使えない id が ${bad.length} 件あるため中断: ${detail}`
    };
  }

  // reviews 全件 + フラグ1件を1バッチで送るので、上限を超えないこと。
  if (reviews.length + 1 > FIRESTORE_BATCH_LIMIT) {
    return {
      ok: false,
      migrated: 0,
      skipped: `1バッチの上限 ${FIRESTORE_BATCH_LIMIT} 件を超えるため中断 (reviews ${reviews.length} 件 + フラグ1件)`
    };
  }

  const batch = writeBatch(getDb());
  reviews.forEach((review, seq) => {
    const id = (review as { id: string }).id;
    batch.set(
      doc(reviewTasksCol(uid), id),
      firestoreSafeData({ ...review, _seq: seq }) as ReviewTask
    );
  });
  batch.set(compassStateDoc(uid), { reviewsMigratedAt: new Date().toISOString() }, { merge: true });
  await batch.commit();

  return { ok: true, migrated: reviews.length };
}

/**
 * A-2-2 の移行トリガー（SHELL:515-554）。**自動実行はしない**（spec §1.3）。
 * レガシーはブラウザのコンソールから `await COMPASS_MIGRATE_REVIEWS()` を1回だけ呼ぶ運用だった。
 * その入口をモジュール関数として保つ（window には生やさない）。
 *
 * 実行後に読み直すのは呼び出し側の責任。AppShell も `migratedAtRef` を更新しなかった
 * （＝移行後はリロードして GET し直す運用）ので、ここでもセッション状態には触れない。
 */
export async function migrateReviews(uid: string): Promise<MigrateResult> {
  try {
    const snap = await getDoc(compassStateDoc(uid));
    const saved = snap.exists() ? snap.data() : null;

    // 二重実行の防止。フラグがあれば何も書かない。
    if (saved?.reviewsMigratedAt) {
      const skipped = `移行済み (${String(saved.reviewsMigratedAt)})`;
      console.info(`[A-2-2] ${skipped}`);
      return { ok: true, migrated: 0, skipped };
    }

    const holder = reviewsHolderOf(saved?.data ?? null);
    if (!holder || !Array.isArray(holder.state.reviews)) {
      const skipped = 'state.reviews が見つからないため中断';
      console.warn(`[A-2-2] ${skipped}`);
      return { ok: false, migrated: 0, skipped };
    }

    const reviews = holder.state.reviews as ReviewTask[];
    if (reviews.length === 0) {
      // 空でフラグだけ立てると、以後コレクション側（空）を正としてしまう。
      const skipped = 'reviews が0件のため中断（フラグも立てない）';
      console.warn(`[A-2-2] ${skipped}`);
      return { ok: false, migrated: 0, skipped };
    }

    const result = await migrateReviewsToCollection(uid, reviews);
    if (result.ok) {
      console.info(`[A-2-2] migrated ${result.migrated} reviews to collection`);
    } else {
      console.warn(`[A-2-2] ${result.skipped ?? '移行に失敗'}`);
    }
    return result;
  } catch (e) {
    const skipped = e instanceof Error ? e.message : String(e);
    console.warn('[A-2-2] 移行に失敗', e);
    return { ok: false, migrated: 0, skipped };
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore 版（A-2-1 / A-2-3）
// ─────────────────────────────────────────────────────────────

/**
 * uid 1セッションぶんの GET / PUT。AppShell が `useRef` 3本で持っていた状態
 * （SHELL:282-286）をインスタンスフィールドに置き換えたもの。
 */
class FirestorePersistence implements CompassPersistence {
  readonly kind = 'firebase' as const;

  /** このインスタンスが baseline を持っている uid。切り替わったら自動で捨てる */
  private uid: string | null = null;

  /**
   * 直近の GET / PUT で確定した reviews の控え。A-2-3 の差分書き込み
   * （追加・更新・削除の判定）の基準になる（SHELL:282）。
   */
  private baselineReviews: ReviewTask[] | null = null;

  /** baseline が「確定済み」か。false の間は1件も削除しない（SHELL:283） */
  private baselineLoaded = false;

  /**
   * 直近の GET で読んだ `reviewsMigratedAt`。PUT が全置換でこれを書き戻すことで
   * フラグを永続させる（merge を使わないため、payload に明示する必要がある）（SHELL:286）。
   */
  private migratedAt: unknown = null;

  /** ユーザー切り替え時に前のアカウントの baseline やフラグを持ち越さない（SHELL:562-565） */
  reset(): void {
    this.uid = null;
    this.baselineReviews = null;
    this.baselineLoaded = false;
    this.migratedAt = null;
  }

  /**
   * AppShell では effect の cleanup が uid 変更時に必ず走っていた（SHELL:558-566）。
   * こちらは呼び出し側の `reset()` 忘れでも他ユーザーの baseline で削除判定が
   * 走らないよう、uid が変わった時点で自分から捨てる。
   */
  private useSession(uid: string): void {
    if (this.uid !== uid) {
      this.reset();
      this.uid = uid;
    }
  }

  /** A-2-1（SHELL:317-365） */
  async loadCloudState(uid: string, email?: string): Promise<CloudLoadResult> {
    this.useSession(uid);

    const snap = await getDoc(compassStateDoc(uid));
    const saved = snap.exists() ? snap.data() : null;
    // PUT が全置換で書き戻せるよう、フラグの値をそのまま保持しておく。
    this.migratedAt = saved?.reviewsMigratedAt ?? null;
    const data = saved?.data ?? null;
    const result: CloudLoadResult = {
      data,
      email: email ?? currentUserEmail(),
      reviewsSource: 'none'
    };

    const holder = reviewsHolderOf(data);
    if (!holder) {
      // 保存が空、または state を持たない構造。従来どおり返す。
      this.baselineReviews = null;
      this.baselineLoaded = false;
      return result;
    }

    // 未移行なら、埋め込みの state.reviews をそのまま使う。
    if (!saved?.reviewsMigratedAt) {
      const embedded = Array.isArray(holder.state.reviews)
        ? (holder.state.reviews as ReviewTask[])
        : [];
      this.baselineReviews = structuredClone(embedded);
      this.baselineLoaded = true;
      console.info(`[A-2-1] reviews source = embedded (${embedded.length}件)`);
      result.reviewsSource = 'embedded';
      return result;
    }

    // 移行済みなら、コレクションを正としてサブコレクションから読み直す。
    try {
      const qs = await getDocs(reviewTasksCol(uid));
      const rows = qs.docs.map((d) => ({ id: d.id, body: d.data() as ReviewTask }));
      const reviews = sortAndStripSeq(rows);
      // ★ 呼び出し側へ返す data そのものを書き換える（丸ごと差し替え, spec §1.3）。
      holder.state.reviews = reviews;
      this.baselineReviews = structuredClone(reviews);
      this.baselineLoaded = true;
      console.info(`[A-2-1] reviews source = collection (${reviews.length}件)`);
      result.reviewsSource = 'collection';
    } catch (e) {
      // 読めなくても落とさない。state.reviews は触らず、埋め込み側をそのまま使わせる。
      const embedded = Array.isArray(holder.state.reviews)
        ? (holder.state.reviews as ReviewTask[])
        : [];
      this.baselineReviews = null;
      this.baselineLoaded = false;
      console.warn('[A-2-1] reviewTasks の読み込みに失敗。埋め込みの reviews を使用します', e);
      console.info(`[A-2-1] reviews source = fallback (${embedded.length}件)`);
      result.reviewsSource = 'fallback';
    }

    return result;
  }

  /** A-2-3（SHELL:367-511） */
  async saveCloudState(uid: string, data: unknown, email?: string): Promise<CloudSaveResult> {
    this.useSession(uid);

    const safeData = firestoreSafeData(data);
    const migratedAt = this.migratedAt;
    const mainRef = compassStateDoc(uid);
    const userEmail = email ?? currentUserEmail();

    // ── 未移行: 従来と完全に同一の動作。
    //    reviewTasks には触れず、reviewsMigratedAt も payload に含めない。
    if (migratedAt == null) {
      await setDoc(mainRef, {
        data: safeData,
        email: userEmail,
        updatedAt: new Date().toISOString()
      });
      console.info('[A-2-3] put: embedded only');
      return { ok: true, storage: 'firebase', mode: 'embedded', updated: 0, deleted: 0 };
    }

    // ── 移行済み。
    // ★ merge は使わない。merge はネストしたマップを再帰マージするため、
    //   plans / dayOverrides / scores / studyLog / countdowns / planQuota から
    //   キーを消しても復活してしまう。全置換のまま、payload に
    //   reviewsMigratedAt を明示することでフラグを永続させる。
    //
    // フラグは「コレクションを正確に更新できた」と確認できたときだけ付ける。
    // 読み込み側は移行済みなら state.reviews をコレクションの内容で丸ごと
    // 差し替えるため、書けなかったタスクがあるままフラグを残すと、
    // そのタスクが画面から消えて見える。付けなければ埋め込みモードへ退避する。
    const mainPayload: Record<string, unknown> = {
      data: safeData,
      email: userEmail,
      updatedAt: new Date().toISOString()
    };
    let collectionTrusted = true;

    const holder = reviewsHolderOf(safeData);
    const reviews =
      holder && Array.isArray(holder.state.reviews)
        ? (holder.state.reviews as ReviewTask[])
        : null;

    // reviews を取り出せない構造。reviewTasks には触れず、メインだけ書く。
    // コレクションを更新できないので、フラグを落として埋め込みへ退避させる。
    if (!reviews) {
      console.error(
        '[A-2-3] 受信データから state.reviews を取り出せないため reviewTasks を更新できません。フラグを落として埋め込みモードへ退避します'
      );
      this.migratedAt = null;
      await setDoc(mainRef, mainPayload);
      console.info('[A-2-3] put: 0 updated, 0 deleted (fallback to embedded)');
      return { ok: true, storage: 'firebase', mode: 'fallback', updated: 0, deleted: 0 };
    }

    // ── baseline との差分を出す
    const baseline = this.baselineReviews;
    const baseById = new Map<string, { json: string; seq: number }>();
    baseline?.forEach((row, seq) => {
      const id = idOf(row);
      if (id) baseById.set(id, { json: stableJson(stripSeq(row)), seq });
    });

    const writes: { id: string; body: ReviewTask }[] = [];
    const seenIds = new Set<string>();
    reviews.forEach((review, index) => {
      const rawId = (review as { id?: unknown }).id;
      const reason = invalidDocIdReason(rawId);
      if (reason) {
        // ここで doc() が投げると保存全体が落ちるので、その1件だけ見送る。
        // ただしコレクションはこのタスクを欠いた状態になる。フラグを残すと
        // 読み込み側がその状態を正としてしまい、画面から消えて見える。
        console.error(
          `[A-2-3] id が使えないため reviewTasks へ書き込めません: ${JSON.stringify(rawId)} (${reason})`
        );
        collectionTrusted = false;
        return;
      }
      const id = rawId as string;
      seenIds.add(id);
      const body = stripSeq(review);
      const prev = baseById.get(id);
      // 内容が同じでも配列内の位置が変われば _seq が変わるので更新対象。
      if (!prev || prev.json !== stableJson(body) || prev.seq !== index) {
        writes.push({
          id,
          body: firestoreSafeData({ ...body, _seq: index }) as ReviewTask
        });
      }
    });

    // 削除は baseline にあって今回来なかったものだけ。
    // baseline が無い（GET で確定できていない）ときは1件も消さない。
    // baseline に無いドキュメントには触れない（他アプリ由来のタスクを守る）。
    const deletes: string[] = [];
    if (this.baselineLoaded && baseline) {
      baseById.forEach((_v, id) => {
        if (!seenIds.has(id)) deletes.push(id);
      });
    }

    // 全件をコレクションへ反映できるときだけフラグを維持する。
    // 落とした場合は次回の読み込みが埋め込みモードへ戻る。
    if (collectionTrusted) {
      mainPayload.reviewsMigratedAt = migratedAt;
    } else {
      this.migratedAt = null;
    }

    const col = reviewTasksCol(uid);

    if (writes.length + deletes.length + 1 <= OPS_PER_BATCH) {
      // 通常経路。reviewTasks とメインを1バッチでアトミックに。
      const batch = writeBatch(getDb());
      writes.forEach((w) => batch.set(doc(col, w.id), w.body));
      deletes.forEach((id) => batch.delete(doc(col, id)));
      batch.set(mainRef, mainPayload);
      await batch.commit();
    } else {
      // 上限超え。reviewTasks を先に分割コミットし、メインは最後に単独で書く。
      const ops: Array<{ id: string; body?: ReviewTask }> = [
        ...writes.map((w) => ({ id: w.id, body: w.body })),
        ...deletes.map((id) => ({ id }))
      ];
      for (let i = 0; i < ops.length; i += OPS_PER_BATCH) {
        const batch = writeBatch(getDb());
        ops.slice(i, i + OPS_PER_BATCH).forEach((op) => {
          const ref = doc(col, op.id);
          if (op.body) batch.set(ref, op.body);
          else batch.delete(ref);
        });
        await batch.commit();
      }
      await setDoc(mainRef, mainPayload);
    }

    // commit が成功したときだけ baseline を差し替える。
    // 参照を共有すると次回以降の差分が常に「変更なし」になり、削除が効かなくなる。
    // このPUTで書いた内容が正になったので、GET が失敗していた場合でも
    // 以後の削除判定はこの baseline を信頼してよい。
    this.baselineReviews = structuredClone(reviews.map(stripSeq));
    this.baselineLoaded = true;
    console.info(
      `[A-2-3] put: ${writes.length} updated, ${deletes.length} deleted ` +
        (collectionTrusted ? '(migrated)' : '(fallback to embedded)')
    );
    return {
      ok: true,
      storage: 'firebase',
      mode: collectionTrusted ? 'migrated' : 'fallback',
      updated: writes.length,
      deleted: deletes.length
    };
  }
}

// ─────────────────────────────────────────────────────────────
// ローカル版（Firebase 未設定 / preview） — architecture §7-1
// ─────────────────────────────────────────────────────────────

/**
 * 保存無効・読み込み常に空のスタブ（SHELL:307-308 の preview ブリッジと同じ）。
 *
 * - GET は `{data: null}` を返す → 呼び出し側は新規ユーザー扱いになり、
 *   `cloudStatus:'saved'` + 即 `saveNow()`（＝ここでは何も起きない）へ進む（spec §4.14 / C-38）。
 * - PUT は何もせず成功を返す。`localStorage['compass-ui-data']` への書き込みは
 *   レガシー同様アプリ（ストア）側の責務なので、ここでは触らない（spec §4.13）。
 */
export function createLocalPersistence(email: string = PREVIEW_EMAIL): CompassPersistence {
  return {
    kind: 'local',
    async loadCloudState(): Promise<CloudLoadResult> {
      return { data: null, email, reviewsSource: 'none' };
    },
    async saveCloudState(): Promise<CloudSaveResult> {
      return { ok: true, storage: 'local', mode: 'embedded', updated: 0, deleted: 0 };
    },
    reset() {
      /* 保持する状態が無い */
    }
  };
}

/** Firestore を直に読み書きする実装を作る（uid セッション1つぶん） */
export function createCloudPersistence(): CompassPersistence {
  return new FirestorePersistence();
}

/**
 * 実行環境に合わせて実装を選ぶ（architecture §7-1）。
 * `preview` か Firebase 未設定なら保存無効のローカル版。
 */
export function createPersistence(
  options: { preview?: boolean; email?: string } = {}
): CompassPersistence {
  const { preview = false, email } = options;
  if (preview || !isFirebaseConfigured()) {
    return createLocalPersistence(email ?? PREVIEW_EMAIL);
  }
  return createCloudPersistence();
}

// ─────────────────────────────────────────────────────────────
// スプラッシュのゲート（HTML:2277-2285 `notifyReady()`）
// ─────────────────────────────────────────────────────────────

export interface SplashGateOptions {
  /** 最低表示時間。既定 `SPLASH_MIN_MS`（2900ms, C-23） */
  minMs?: number;
  /**
   * `notifyReady()` が来なくても開場する保険。既定 `SPLASH_FAILSAFE_MS`。
   * `null` を渡すとレガシーどおり「永久スプラッシュ」になる（spec Q20）。
   */
  failsafeMs?: number | null;
  /**
   * 親フレームへ `{type:'compass-ready'}` を postMessage するか（C-27）。既定 true。
   * iframe を廃したので `window.parent === window` のときは送らない
   * （自分自身への message イベントになってしまうため）。
   */
  postReadyMessage?: boolean;
  /** テスト用。既定 `Date.now` */
  now?: () => number;
}

export interface SplashGate {
  /** マウント時刻（レガシーの `this._splashStart`, HTML:2052） */
  readonly startedAt: number;
  /**
   * クラウド読み込みの**全経路の末尾**で呼ぶ（成功・失敗・例外いずれも, spec §1.2-8）。
   * 経過時間に関わらず、マウントから `minMs` 経過するまで `onReady` を呼ばない。
   * 複数回呼んでも開場時刻は `startedAt + minMs` のまま変わらない。
   */
  notifyReady(): void;
  /** アンマウント時に呼ぶ。保留中のタイマーを捨てる */
  cancel(): void;
}

/**
 * スプラッシュ退場のゲート。レガシーは `document.querySelector('.compass-splash')` への
 * 直接 `classList.add` だった（HTML:2281-2282）が、React 版では `onReady` で
 * `splashReady` state を立てる（architecture §7-2 / spec Q20）。
 *
 * レガシーとの差は「保険タイマー」だけで、最低表示時間 2900ms の条件は同一。
 *
 * ```ts
 * const gate = createSplashGate(() => setSplashReady(true));
 * loadCloudState(uid).finally(() => gate.notifyReady());
 * // アンマウント時: gate.cancel()
 * ```
 */
export function createSplashGate(onReady: () => void, options: SplashGateOptions = {}): SplashGate {
  const {
    minMs = SPLASH_MIN_MS,
    failsafeMs = SPLASH_FAILSAFE_MS,
    postReadyMessage = true,
    now = Date.now
  } = options;

  const startedAt = now();
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let failsafeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFailsafe = () => {
    if (failsafeTimer !== null) {
      clearTimeout(failsafeTimer);
      failsafeTimer = null;
    }
  };

  const gate: SplashGate = {
    startedAt,
    notifyReady() {
      clearFailsafe();
      // レガシーは毎回 clearTimeout → setTimeout し直す（HTML:2279-2283）。
      // 待ち時間が `minMs - elapsed` なので、何度呼んでも発火時刻は startedAt + minMs。
      const elapsed = now() - startedAt;
      if (readyTimer !== null) clearTimeout(readyTimer);
      readyTimer = setTimeout(
        () => {
          readyTimer = null;
          onReady();
        },
        Math.max(0, minMs - elapsed)
      );
      if (postReadyMessage) postCompassReady();
    },
    cancel() {
      clearFailsafe();
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
    }
  };

  if (failsafeMs != null) {
    failsafeTimer = setTimeout(() => {
      failsafeTimer = null;
      gate.notifyReady();
    }, failsafeMs);
  }

  return gate;
}

/** C-27。`window.parent` が自分自身（＝埋め込まれていない）なら何もしない */
function postCompassReady(): void {
  try {
    if (typeof window === 'undefined') return;
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'compass-ready' }, '*');
  } catch {
    /* レガシーも握りつぶす（HTML:2284） */
  }
}
