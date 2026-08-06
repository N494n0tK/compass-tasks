'use client';

/**
 * Compass — オーバーレイの差し込み口（Phase 2B / TASK S0）
 *
 * spec §2.1: ミニタスク編集ドロワー / 復習詳細 / 点数推移 / 再配分モーダル / 理解度モーダル /
 * 集中モード / アプリスイッチャー / ツールチップ / トーストは、いずれも
 * **`.compass-shell` の外・`.compass-theme-mode` の直下**にある。
 * `.compass-shell` は `overflow:hidden` + `isolation:isolate`（HTML:181）なので、
 * この位置でないと `position:fixed` がシェルのスタッキングコンテキストに閉じ込められる。
 *
 * 画面コンポーネント（Tests / Review / ToDo / Data）が自分のドロワー・モーダルを出すときは、
 * JSX の親子関係は保ったまま DOM 位置だけをレガシーに合わせるため、
 *
 * ```tsx
 * <ShellOverlay>{redistOpen ? <RedistModal … /> : null}</ShellOverlay>
 * ```
 *
 * のように包むこと。ホスト要素が未マウントの初回レンダーでは何も出さない。
 */

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** `.compass-theme-mode` の DOM ノード。`CompassApp` が提供する */
export const OverlayHostContext = createContext<HTMLElement | null>(null);

export function useOverlayHost(): HTMLElement | null {
  return useContext(OverlayHostContext);
}

export function ShellOverlay({ children }: { children: ReactNode }) {
  const host = useOverlayHost();
  if (!host) return null;
  return createPortal(children, host);
}
