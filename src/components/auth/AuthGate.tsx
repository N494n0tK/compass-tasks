'use client';

/**
 * Compass — 認証ゲート（Phase 2B / TASK I0）
 *
 * 旧 `src/app/AppShell.tsx` L274-639 のうち **iframe / fetch シム / window ブリッジを除いた
 * 認証部分だけ**を移植したもの。ブリッジ（`COMPASS_CLOUD_GET` / `PUT`）は
 * `lib/persistence.ts` が直に Firestore を叩くので不要になった（architecture §1 / §5）。
 *
 * 画面の出し分け（AppShell と同じ順序・同じ文言）:
 *
 * | 条件 | 表示 |
 * |---|---|
 * | `preview`（`?preview=1`） | 認証を通さず `<CompassApp preview>`（保存無効・ローカルのみ） |
 * | Firebase 未設定 | 環境変数の案内パネル |
 * | 認証状態を確認中 | 「読み込み中…」 |
 * | 未ログイン | `<AuthScreen>` |
 * | gmail.com 以外 | 利用不可の案内 + 「別のアカウントでログイン」 |
 * | それ以外 | `<CompassApp uid email>` |
 *
 * `window.COMPASS_MIGRATE_REVIEWS`（spec §1.3 / A-2-2）はログイン済みのときだけ生やす。
 * 自動実行はしない。コンソールから `await COMPASS_MIGRATE_REVIEWS()` を 1 回だけ呼ぶ運用。
 */

import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  signInWithGoogle,
  signOut,
} from '../../lib/firebase';
import { migrateReviews, PREVIEW_EMAIL, type MigrateResult } from '../../lib/persistence';
import { CompassApp } from '../CompassApp';
import { AuthScreen } from './AuthScreen';

declare global {
  interface Window {
    /** A-2-2 の移行トリガー（SHELL:515-554）。コンソールから手動で 1 回だけ呼ぶ */
    COMPASS_MIGRATE_REVIEWS?: () => Promise<MigrateResult>;
  }
}

export interface AuthGateProps {
  /** `?preview=1`。認証もクラウド保存も通さず、ローカルのみで動かす */
  preview?: boolean;
}

export function AuthGate({ preview = false }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  /**
   * preview も最初のクライアント描画までは SSR と同じ殻を返す。
   *
   * `CompassApp` はモジュール共有の `dateCtx` を読むため、日付をまたいだ Next dev
   * サーバーでは SSR 側に前日の値が残り得る。preview だけ直ちに本体を SSR すると、
   * ブラウザの「今日」と食い違って hydration error（左下の `1 Issue`）になる。
   * 本体は mount 後に出せば、今日の値を持つクライアントだけで描画される。
   */
  const [clientReady, setClientReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setClientReady(true);
  }, []);

  // SHELL:288-302 — preview / 未設定なら購読しない
  useEffect(() => {
    if (preview || !isFirebaseConfigured()) {
      setChecking(false);
      return;
    }
    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setChecking(false);
    });
  }, [preview]);

  // SHELL:513-554 — `COMPASS_MIGRATE_REVIEWS` の設置と後片付け
  const uid = user?.uid ?? '';
  useEffect(() => {
    if (preview || !uid) return;
    window.COMPASS_MIGRATE_REVIEWS = () => migrateReviews(uid);
    return () => {
      delete window.COMPASS_MIGRATE_REVIEWS;
    };
  }, [preview, uid]);

  if (preview && clientReady) {
    return <CompassApp uid="" email={PREVIEW_EMAIL} preview />;
  }

  if (!isFirebaseConfigured()) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <h1>Compass</h1>
          <p>
            Firebase の環境変数(NEXT_PUBLIC_FIREBASE_API_KEY
            など)を設定するとログインできるようになります。
          </p>
        </section>
      </main>
    );
  }

  if (checking || preview) {
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

  if (user.email && !user.email.toLowerCase().endsWith('@gmail.com')) {
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

  return <CompassApp uid={user.uid} email={user.email ?? ''} />;
}

export default AuthGate;
