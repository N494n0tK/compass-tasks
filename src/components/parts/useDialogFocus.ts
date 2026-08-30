'use client';

/**
 * Portal される dialog / drawer の共通キーボード約束。
 *
 * それぞれの画面が独自に Esc・初期フォーカス・Tab 折り返しを書き始めると、
 * 新しい drawer を足したときに必ずどれか 1 つが抜ける。ここは見た目を持たず、
 * 「開いたら中へ、閉じたら開いた場所へ戻る」だけを一か所に保つ。
 */
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

const FOCUSABLE =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

type FocusRef = RefObject<HTMLElement | null>;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (item) => !item.hasAttribute('inert') && item.getClientRects().length > 0,
  );
}

export function useDialogFocus({
  open,
  panelRef,
  initialFocusRef,
  restoreFocusRef,
  onClose,
  trapFocus = true,
}: {
  open: boolean;
  panelRef: FocusRef;
  initialFocusRef?: FocusRef;
  restoreFocusRef?: FocusRef;
  onClose: () => void;
  trapFocus?: boolean;
}) {
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  // close callback が再生成されても、開くたびに初期フォーカスを取り直さない。
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    });
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onWindowKeyDown);
      const restoreTarget = restoreFocusRef?.current;
      if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      else openerRef.current?.focus({ preventScroll: true });
      openerRef.current = null;
    };
  }, [open, panelRef, initialFocusRef, restoreFocusRef]);

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!trapFocus || event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables(panel);
      if (!items.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !active || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || !active || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [panelRef, trapFocus],
  );
}
