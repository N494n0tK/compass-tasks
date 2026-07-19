"use client";

import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  getDb,
  getFirebaseAuth,
  isFirebaseConfigured,
  signInWithGoogle,
  signOut
} from "../lib/firebase";

type AppShellProps = {
  srcDoc: string;
};

declare global {
  interface Window {
    COMPASS_CLOUD_GET?: () => Promise<{ data: unknown; email: string }>;
    COMPASS_CLOUD_PUT?: (data: unknown) => Promise<{ ok: true; storage: "firebase" }>;
  }
}

function compassStateDoc(uid: string) {
  return doc(getDb(), "users", uid, "settings", "compass-ui-data");
}

function firestoreSafeData(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data));
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
          <img src="/compass-icon.svg?v=20260717-summer" alt="" width="46" height="46" />
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

export function AppShell({ srcDoc }: AppShellProps) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setChecking(false);
      return;
    }

    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    setBridgeReady(false);
    if (!user) return;

    window.COMPASS_CLOUD_GET = async () => {
      const snap = await getDoc(compassStateDoc(user.uid));
      const saved = snap.exists() ? snap.data() : null;
      return {
        data: saved?.data ?? null,
        email: user.email ?? ""
      };
    };

    window.COMPASS_CLOUD_PUT = async (data: unknown) => {
      const safeData = firestoreSafeData(data);
      await setDoc(compassStateDoc(user.uid), {
        data: safeData,
        email: user.email ?? "",
        updatedAt: new Date().toISOString()
      });
      return { ok: true, storage: "firebase" };
    };

    setBridgeReady(true);

    return () => {
      delete window.COMPASS_CLOUD_GET;
      delete window.COMPASS_CLOUD_PUT;
    };
  }, [user]);

  const framedDoc = useMemo(() => {
    const email = user?.email ?? "";
    return srcDoc.replace("<head>", `<head>${injectedSessionScript(email)}`);
  }, [srcDoc, user?.email]);

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
