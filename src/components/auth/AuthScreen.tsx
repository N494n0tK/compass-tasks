'use client';

/**
 * Compass — サインイン画面（`src/app/AppShell.tsx` L238-272 の逐語移植）
 *
 * architecture §2 / §7-3。マークアップ・文言・SVG のパスまで旧 `AppShell.AuthScreen` と同一。
 * スタイルは `globals.css` `[A]` 節の `.auth-*`（css-notes §8）。
 */

export interface AuthScreenProps {
  error: string;
  onSignIn: () => void;
}

export function AuthScreen({ error, onSignIn }: AuthScreenProps) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
            <path
              fill="currentColor"
              d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"
            />
            <path
              fill="currentColor"
              opacity=".72"
              d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"
            />
            <path
              fill="currentColor"
              opacity=".5"
              d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z"
            />
            <path
              fill="currentColor"
              opacity=".86"
              d="M12 5.9c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 3.2 7.3l3.3 2.6a5.8 5.8 0 0 1 5.5-4Z"
            />
          </svg>
          Googleで続ける
        </button>
        <small className="auth-footnote">タスク・復習・点数データをFirebaseに保存します</small>
        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  );
}
