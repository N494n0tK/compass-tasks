"use client";

import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDb,
  getFirebaseAuth,
  isFirebaseConfigured,
  signInWithGoogle,
  signOut
} from "../lib/firebase";

type AppShellProps = {
  srcDoc: string;
  preview?: boolean;
};

type MigrateResult = { ok: boolean; migrated: number; skipped?: string };

declare global {
  interface Window {
    COMPASS_CLOUD_GET?: () => Promise<{ data: unknown; email: string }>;
    COMPASS_CLOUD_PUT?: (data: unknown) => Promise<{ ok: true; storage: "firebase" }>;
    COMPASS_MIGRATE_REVIEWS?: () => Promise<MigrateResult>;
  }
}

function compassStateDoc(uid: string) {
  return doc(getDb(), "users", uid, "settings", "compass-ui-data");
}

const reviewTasksCol = (uid: string) => collection(getDb(), "users", uid, "reviewTasks");

function firestoreSafeData(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data));
}

type ReviewTask = Record<string, unknown>;

/** state.reviews を持つ形かどうかだけを見る。想定外の構造なら null を返す。 */
function reviewsHolderOf(data: unknown): { state: Record<string, unknown> } | null {
  if (!data || typeof data !== "object") return null;
  const state = (data as Record<string, unknown>).state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return { state: state as Record<string, unknown> };
}

/**
 * reviewTasks コレクションを読み、保存時に振った _seq の昇順へ戻す。
 * _seq が無いものは末尾へ送り、その中は id 昇順で安定させる。
 * 返す各要素からは _seq を取り除く（埋め込み時と同じ形にするため）。
 */
function sortAndStripSeq(rows: { id: string; body: ReviewTask }[]): ReviewTask[] {
  const seqOf = (body: ReviewTask) =>
    typeof body._seq === "number" && Number.isFinite(body._seq) ? body._seq : null;

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

const DOC_ID_MAX_BYTES = 1500;
const FIRESTORE_BATCH_LIMIT = 500;
/** 1バッチに詰める操作数の上限。Firestore の 500 に対して余裕を取る。 */
const OPS_PER_BATCH = 450;

function idOf(review: ReviewTask): string | null {
  const id = (review as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

/** _seq を落とした素の内容を返す。差分比較と baseline の保存に使う。 */
function stripSeq(review: ReviewTask): ReviewTask {
  const { _seq: _drop, ...rest } = review;
  void _drop;
  return rest;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
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

/** キー順に依存しない JSON 文字列。Firestore 由来とアプリ由来で
 *  キーの並びが違っても、内容が同じなら同じ文字列になる。 */
function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/** Firestore のドキュメントIDとして使えない理由を返す。使えるなら null。 */
function invalidDocIdReason(id: unknown): string | null {
  if (typeof id !== "string") return `id が文字列でない (型: ${typeof id})`;
  if (!id) return "id が空文字";
  if (/^ +$/.test(id)) return "id が半角スペースのみ";
  if (id.includes("/")) return '"/" を含む';
  if (id === "." || id === "..") return `"${id}" と完全一致`;
  if (id.startsWith("__") && id.endsWith("__")) return '"__" で始まり "__" で終わる';
  const bytes = new TextEncoder().encode(id).length;
  if (bytes > DOC_ID_MAX_BYTES) return `UTF-8 ${bytes} バイト (>${DOC_ID_MAX_BYTES})`;
  return null;
}

/**
 * state.reviews を users/{uid}/reviewTasks/{review.id} へ複製する（A-2-2）。
 * state.reviews 側は消さない（二重保持）。
 *
 * - 配列内の位置を _seq として付与する。読み出し側はこれで元の並びへ戻す。
 * - 使えない id が1件でもあれば、1件も書かずに中断する。
 * - reviewsMigratedAt は必ず merge:true で書く。compass-ui-data の
 *   既存フィールド（data / email / updatedAt）を消さないため。
 * - 全件 + フラグを1つの writeBatch でアトミックにコミットする。
 */
async function migrateReviewsToCollection(
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
    const detail = bad.map((b) => `#${b.i} ${JSON.stringify(b.id)}: ${b.reason}`).join(" / ");
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
  batch.set(
    compassStateDoc(uid),
    { reviewsMigratedAt: new Date().toISOString() },
    { merge: true }
  );
  await batch.commit();

  return { ok: true, migrated: reviews.length };
}

function injectedSessionScript(email: string) {
  return `<script>
window.COMPASS_USER_EMAIL=${JSON.stringify(email)};
(function(){
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const waitForBridge = function(name){
    return new Promise(function(resolve, reject){
      var tries = 0;
      var tick = function(){
        var fn = parent && parent[name];
        if (typeof fn === 'function') { resolve(fn); return; }
        tries += 1;
        if (tries > 60) { reject(new Error(name + '_unavailable')); return; }
        setTimeout(tick, 50);
      };
      tick();
    });
  };
  window.fetch = async function(input, init){
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    const baseUrl = parent && parent.location ? parent.location.href : 'https://compass-learning-app.vercel.app/';
    const url = new URL(rawUrl || '/', baseUrl);
    if (url.pathname === '/api/app-state') {
      try {
        const method = ((init && init.method) || 'GET').toUpperCase();
        if (method === 'PUT') {
          const body = init && init.body ? JSON.parse(init.body) : {};
          const put = await waitForBridge('COMPASS_CLOUD_PUT');
          const result = await put(body.data);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        const get = await waitForBridge('COMPASS_CLOUD_GET');
        const result = await get();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        var message = error && (error.code || error.message) ? (error.code || error.message) : 'firebase_bridge_failed';
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    if (!originalFetch) throw new Error('fetch unavailable');
    return originalFetch(input, init);
  };
})();
</script>`;
}

function AuthScreen({
  error,
  onSignIn
}: {
  error: string;
  onSignIn: () => void;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-brand">
          <img src="/compass-icon.svg?v=20260728-ink" alt="" width="46" height="46" />
          <div>
            <h1>Compass</h1>
            <span>学習コックピット</span>
          </div>
        </div>
        <p>
          今日やること、復習、試験計画をひとつの画面で。Googleアカウントでログインすると、学習データが安全に同期されます。
        </p>
        <button className="auth-button" onClick={onSignIn}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z" />
            <path fill="currentColor" opacity=".72" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" />
            <path fill="currentColor" opacity=".5" d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z" />
            <path fill="currentColor" opacity=".86" d="M12 5.9c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 3.2 7.3l3.3 2.6a5.8 5.8 0 0 1 5.5-4Z" />
          </svg>
          Googleで続ける
        </button>
        <small className="auth-footnote">タスク・復習・点数データをFirebaseに保存します</small>
        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  );
}

export function AppShell({ srcDoc, preview = false }: AppShellProps) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [error, setError] = useState("");

  // 直近の GET で確定した reviews の控え。A-2-3 の差分書き込み
  // （追加・更新・削除の判定）の基準になる。
  const baselineReviews = useRef<ReviewTask[] | null>(null);
  const baselineLoaded = useRef(false);
  // 直近の GET で読んだ reviewsMigratedAt。PUT が全置換でこれを書き戻すことで
  // フラグを永続させる（merge を使わないため、payload に明示する必要がある）。
  const migratedAtRef = useRef<unknown>(null);

  useEffect(() => {
    if (preview) {
      setChecking(false);
      return;
    }
    if (!isFirebaseConfigured()) {
      setChecking(false);
      return;
    }

    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setChecking(false);
    });
  }, [preview]);

  useEffect(() => {
    setBridgeReady(false);
    if (preview) {
      window.COMPASS_CLOUD_GET = async () => ({ data: null, email: "preview@localhost" });
      window.COMPASS_CLOUD_PUT = async () => ({ ok: true, storage: "firebase" });
      setBridgeReady(true);
      return () => {
        delete window.COMPASS_CLOUD_GET;
        delete window.COMPASS_CLOUD_PUT;
      };
    }
    if (!user) return;

    window.COMPASS_CLOUD_GET = async () => {
      const snap = await getDoc(compassStateDoc(user.uid));
      const saved = snap.exists() ? snap.data() : null;
      // PUT が全置換で書き戻せるよう、フラグの値をそのまま保持しておく。
      migratedAtRef.current = saved?.reviewsMigratedAt ?? null;
      const data = saved?.data ?? null;
      const result = { data, email: user.email ?? "" };

      const holder = reviewsHolderOf(data);
      if (!holder) {
        // 保存が空、または state を持たない構造。従来どおり返す。
        baselineReviews.current = null;
        baselineLoaded.current = false;
        return result;
      }

      // 未移行なら、埋め込みの state.reviews をそのまま使う。
      if (!saved?.reviewsMigratedAt) {
        const embedded = Array.isArray(holder.state.reviews)
          ? (holder.state.reviews as ReviewTask[])
          : [];
        baselineReviews.current = structuredClone(embedded);
        baselineLoaded.current = true;
        console.info(`[A-2-1] reviews source = embedded (${embedded.length}件)`);
        return result;
      }

      // 移行済みなら、コレクションを正としてサブコレクションから読み直す。
      try {
        const qs = await getDocs(reviewTasksCol(user.uid));
        const rows = qs.docs.map((d) => ({ id: d.id, body: d.data() as ReviewTask }));
        const reviews = sortAndStripSeq(rows);
        holder.state.reviews = reviews;
        baselineReviews.current = structuredClone(reviews);
        baselineLoaded.current = true;
        console.info(`[A-2-1] reviews source = collection (${reviews.length}件)`);
      } catch (e) {
        // 読めなくても落とさない。state.reviews は触らず、埋め込み側をそのまま使わせる。
        const embedded = Array.isArray(holder.state.reviews)
          ? (holder.state.reviews as ReviewTask[])
          : [];
        baselineReviews.current = null;
        baselineLoaded.current = false;
        console.warn("[A-2-1] reviewTasks の読み込みに失敗。埋め込みの reviews を使用します", e);
        console.info(`[A-2-1] reviews source = fallback (${embedded.length}件)`);
      }

      return result;
    };

    window.COMPASS_CLOUD_PUT = async (data: unknown) => {
      const safeData = firestoreSafeData(data);
      const migratedAt = migratedAtRef.current;
      const mainRef = compassStateDoc(user.uid);

      // ── 未移行: 従来と完全に同一の動作。
      //    reviewTasks には触れず、reviewsMigratedAt も payload に含めない。
      if (migratedAt == null) {
        await setDoc(mainRef, {
          data: safeData,
          email: user.email ?? "",
          updatedAt: new Date().toISOString()
        });
        console.info("[A-2-3] put: embedded only");
        return { ok: true, storage: "firebase" };
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
        email: user.email ?? "",
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
          "[A-2-3] 受信データから state.reviews を取り出せないため reviewTasks を更新できません。フラグを落として埋め込みモードへ退避します"
        );
        migratedAtRef.current = null;
        await setDoc(mainRef, mainPayload);
        console.info("[A-2-3] put: 0 updated, 0 deleted (fallback to embedded)");
        return { ok: true, storage: "firebase" };
      }

      // ── baseline との差分を出す
      const baseline = baselineReviews.current;
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
      if (baselineLoaded.current && baseline) {
        baseById.forEach((_v, id) => {
          if (!seenIds.has(id)) deletes.push(id);
        });
      }

      // 全件をコレクションへ反映できるときだけフラグを維持する。
      // 落とした場合は次回の読み込みが埋め込みモードへ戻る。
      if (collectionTrusted) {
        mainPayload.reviewsMigratedAt = migratedAt;
      } else {
        migratedAtRef.current = null;
      }

      const col = reviewTasksCol(user.uid);

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
      baselineReviews.current = structuredClone(reviews.map(stripSeq));
      baselineLoaded.current = true;
      console.info(
        `[A-2-3] put: ${writes.length} updated, ${deletes.length} deleted ` +
          (collectionTrusted ? "(migrated)" : "(fallback to embedded)")
      );
      return { ok: true, storage: "firebase" };
    };

    // A-2-2 の移行トリガー。自動実行はしない。
    // ブラウザのコンソールから await COMPASS_MIGRATE_REVIEWS() で1回だけ呼ぶ。
    window.COMPASS_MIGRATE_REVIEWS = async (): Promise<MigrateResult> => {
      try {
        const snap = await getDoc(compassStateDoc(user.uid));
        const saved = snap.exists() ? snap.data() : null;

        // 二重実行の防止。フラグがあれば何も書かない。
        if (saved?.reviewsMigratedAt) {
          const skipped = `移行済み (${String(saved.reviewsMigratedAt)})`;
          console.info(`[A-2-2] ${skipped}`);
          return { ok: true, migrated: 0, skipped };
        }

        const holder = reviewsHolderOf(saved?.data ?? null);
        if (!holder || !Array.isArray(holder.state.reviews)) {
          const skipped = "state.reviews が見つからないため中断";
          console.warn(`[A-2-2] ${skipped}`);
          return { ok: false, migrated: 0, skipped };
        }

        const reviews = holder.state.reviews as ReviewTask[];
        if (reviews.length === 0) {
          // 空でフラグだけ立てると、以後コレクション側（空）を正としてしまう。
          const skipped = "reviews が0件のため中断（フラグも立てない）";
          console.warn(`[A-2-2] ${skipped}`);
          return { ok: false, migrated: 0, skipped };
        }

        const result = await migrateReviewsToCollection(user.uid, reviews);
        if (result.ok) {
          console.info(`[A-2-2] migrated ${result.migrated} reviews to collection`);
        } else {
          console.warn(`[A-2-2] ${result.skipped ?? "移行に失敗"}`);
        }
        return result;
      } catch (e) {
        const skipped = e instanceof Error ? e.message : String(e);
        console.warn("[A-2-2] 移行に失敗", e);
        return { ok: false, migrated: 0, skipped };
      }
    };

    setBridgeReady(true);

    return () => {
      delete window.COMPASS_CLOUD_GET;
      delete window.COMPASS_CLOUD_PUT;
      delete window.COMPASS_MIGRATE_REVIEWS;
      // ユーザー切り替え時に前のアカウントの baseline やフラグを持ち越さない。
      baselineReviews.current = null;
      baselineLoaded.current = false;
      migratedAtRef.current = null;
    };
  }, [preview, user]);

  const framedDoc = useMemo(() => {
    const email = preview ? "preview@localhost" : (user?.email ?? "");
    return srcDoc.replace("<head>", `<head>${injectedSessionScript(email)}`);
  }, [preview, srcDoc, user?.email]);

  if (preview && bridgeReady) {
    return (
      <main className="legacy-shell">
        <iframe className="legacy-frame" title="Compass Preview" srcDoc={framedDoc} />
      </main>
    );
  }

  if (!isFirebaseConfigured()) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <h1>Compass</h1>
          <p>
            Firebase の環境変数(NEXT_PUBLIC_FIREBASE_API_KEY など)を設定するとログインできるようになります。
          </p>
        </section>
      </main>
    );
  }

  if (checking) {
    return (
      <main className="auth-screen">
        <p className="auth-loading">読み込み中…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        error={error}
        onSignIn={() => signInWithGoogle().catch((e) => setError(String(e?.message ?? e)))}
      />
    );
  }

  if (user.email && !user.email.toLowerCase().endsWith("@gmail.com")) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <h1>Compass</h1>
          <p>{user.email} は利用できません。gmail.com のGoogleアカウントでログインしてください。</p>
          <button className="auth-button" onClick={() => void signOut()}>
            別のアカウントでログイン
          </button>
        </section>
      </main>
    );
  }

  if (!bridgeReady) {
    return (
      <main className="auth-screen">
        <p className="auth-loading">Firebaseに接続中…</p>
      </main>
    );
  }

  return (
    <main className="legacy-shell">
      <iframe className="legacy-frame" title="Compass" srcDoc={framedDoc} />
    </main>
  );
}
