'use client';

/**
 * Compass — ノートのゴミ箱（docs/notebook/ux-refresh.md §3 の改善点 #7）
 *
 * 要望の「1ヶ月はゴミ箱に入れとくみたいな感じに」の見えるところ。
 * `state.nbTrashOpen` が true のあいだだけ、捨てたノートを
 * **単元名 / 教科 / 捨てた日 / あと何日で消えるか**で並べて出す。
 *
 * ## この面が持たないもの
 *
 * 破壊も復元も**しない**。押されたら `onRestore(noteId)` を呼ぶだけで、
 * `notes` / `notesTrash` / `reviews` の書き換えは親が `lib/logic/noteTrash.ts` の
 * `restoreNote()` を通してやる（保存の配線も親）。ゴミ箱の面が自分で state を
 * いじり始めると、右クリックメニュー（#5）・確認ダイアログ（#6）と合わせて
 * 破壊の経路が 3 本になり、片方だけ直したときにずれる。
 *
 * ## 一覧の行を `NoteRow` にしなかった理由
 *
 * `NoteRow` は「開く / 右クリックで操作する」ための行で、押すとノートが開く。
 * ゴミ箱の中身は開けない（`state.notes` に無いので `NoteView` が引けない）ので、
 * 同じ見た目にすると押しても何も起きない行になってしまう。ここは
 * 「捨てた日と残り日数を読んで、戻すかどうかだけ決める」ための別の行にしてある。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dowOf, fmtMD } from '../../lib/logic/dates';
import { sortTrashList, trashDaysLeft } from '../../lib/logic/noteTrash';
import { subjectColorFor } from '../../lib/logic/subjects';
import { NOTE_TRASH_DAYS, type ISODate } from '../../lib/model/types';
import { ShellOverlay } from './ShellOverlay';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

/** 行が抜けていくアニメーションの長さ。`nb-trash.css` の `nbtc-out` と揃える */
const OUT_MS = 180;

export interface NoteTrashPanelProps {
  /** 今日。残り日数の計算に使う */
  today: ISODate;
  /**
   * 「元に戻す」。親が `restoreNote(store.getState(), { noteId })` の結果を
   * state と Firestore へ流す。
   */
  onRestore: (noteId: string) => void;
  /** 閉じる。省略時は `nbTrashOpen:false` を落とすだけ（表示 state なのでここで持ってよい） */
  onClose?: () => void;
}

export function NoteTrashPanel({ today, onRestore, onClose }: NoteTrashPanelProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const open = S.nbTrashOpen;

  /** 抜けていく途中の行。アニメーションのあいだだけ id を持つ */
  const [leaving, setLeaving] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    if (onClose) onClose();
    else store.setState({ nbTrashOpen: false });
  }, [onClose]);

  // 捨てたのが新しい順。探しに来るのはたいてい直前に捨てたもの
  const rows = useMemo(() => sortTrashList(S.notesTrash), [S.notesTrash]);

  // Esc で閉じる（モーダル・メニューの共通の約束。§5-4）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 開いたら面そのものへフォーカスを移す（Esc と読み上げの起点をここにする）
  useEffect(() => {
    if (open) sheet.current?.focus();
  }, [open]);

  // 閉じたら途中の行を忘れる。開き直したときに 1 行だけ消えて見えるのを防ぐ
  useEffect(() => {
    if (!open) setLeaving(null);
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * 戻す。抜けていく動きを見せてから親へ渡す ―― 押した行がその場で消えると、
   * どれを戻したのかが分からない。動きを切っている人はその場で渡す。
   */
  const restore = (noteId: string) => {
    if (leaving) return; // 連打で 2 行同時に抜けるのを防ぐ
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onRestore(noteId);
      return;
    }
    setLeaving(noteId);
    timer.current = setTimeout(() => {
      timer.current = null;
      setLeaving(null);
      onRestore(noteId);
    }, OUT_MS);
  };

  if (!open) return null;

  return (
    <ShellOverlay>
      <div className="nbtc-back" onClick={close}>
        <div
          ref={sheet}
          className="nbtc-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nbtc-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="nbtc-head">
            <div>
              <h2 id="nbtc-title" className="nbtc-title">
                ゴミ箱
              </h2>
              <p className="nbtc-lede">
                捨てたノートは{NOTE_TRASH_DAYS}日ここに残ります。戻せば復習も一緒に戻ります。
              </p>
            </div>
            <button type="button" className="nbtc-x" onClick={close} aria-label="ゴミ箱を閉じる">
              ✕
            </button>
          </div>

          {rows.length ? (
            <ul className="nbtc-list">
              {rows.map((n, i) => {
                const c = subjectColorFor(subjColors, n.subject || 'その他');
                const left = trashDaysLeft(n, today);
                return (
                  <li
                    key={n.id}
                    className={'nbtc-item' + (leaving === n.id ? ' is-out' : '')}
                    style={{ ['--i' as string]: String(Math.min(i, 8)) }}
                  >
                    <span className="nbtc-subj" style={{ color: c.c, background: c.bg }}>
                      {n.subject || 'その他'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="nbtc-unit">{n.unit || '(単元名なし)'}</div>
                      <div className="nbtc-meta">{trashedLabel(n.trashedAt)}</div>
                    </div>
                    <span className={'nbtc-left' + leftClass(left)}>{leftLabel(left)}</span>
                    <button
                      type="button"
                      className="nbtc-restore"
                      onClick={() => restore(n.id)}
                      aria-label={'「' + (n.unit || '(単元名なし)') + '」を元に戻す'}
                    >
                      元に戻す
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="nbtc-empty">
              <div className="nbtc-empty-h">ゴミ箱は空です</div>
              <p className="nbtc-empty-p">
                ノートを右クリックして「削除」すると、ここに{NOTE_TRASH_DAYS}日ぶん残ります。
              </p>
            </div>
          )}

          <div className="nbtc-foot">
            ⌘Z でも直前の操作を取り消せます。{NOTE_TRASH_DAYS}日を過ぎたものは自動で消えます。
          </div>
        </div>
      </div>
    </ShellOverlay>
  );
}

/** 「8/6(木) に捨てた」。印が無い（あってはならない）行は日付を出さない */
function trashedLabel(trashedAt: string): string {
  if (!trashedAt) return '捨てた日が不明';
  return fmtMD(trashedAt) + '(' + dowOf(trashedAt) + ') に捨てた';
}

/** 残り日数の文言。0 = 今日が最終日、負 = すでに期限切れ（次の起動で消える） */
function leftLabel(left: number): string {
  if (left < 0) return 'まもなく消えます';
  if (left === 0) return '今日まで';
  return 'あと' + left + '日';
}

/**
 * 色が付くのは残り 3 日から。蛍光オレンジ（`--pink`）は「いま」専用なので、
 * 最終日と期限切れにだけ使う（§1-3）。
 */
function leftClass(left: number): string {
  if (left <= 0) return ' is-last';
  return left <= 3 ? ' is-soon' : '';
}
