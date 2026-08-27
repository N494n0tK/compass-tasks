'use client';

/**
 * Compass — ノートの右クリックメニュー（docs/notebook/ux-refresh.md §3 の #5）
 *
 * Finder の「項目を右クリック」に相当する小さなポップアップ。一覧の行を右クリックすると
 * **カーソルのすぐ脇**に出て、改名・削除・教科への潜り込みを選べる。
 *
 * ## 置き方
 *
 * 親は `<NoteContextMenu />` を 1 個だけ置けばよい（props なし）。開いているかどうかは
 * `state.nbMenu` を自分で読むので、条件分岐も要らない。DOM 位置は自前で
 * `ShellOverlay` に逃がしてある ―― `.compass-shell` は `overflow:hidden` +
 * `isolation:isolate` なので、その中に置くと `position:fixed` が閉じ込められて
 * サイドバーの幅で切られる。
 *
 * ## ここは絶対に壊さない
 *
 * **このファイルはノートを消さない。** 選んだ結果は `nbAsk`（確認ダイアログ #6）を
 * 立てるだけで、実際の破壊は #6 → #7 の純ロジックが行う。`window.confirm` も使わない
 * （紙面から浮くうえ、「復習も消すか」を聞けない）。
 */

import { folderEnterPatch } from '../../lib/logic/noteFolder';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { noteCascadeCounts } from '../../lib/logic/noteTrash';
import { ShellOverlay } from './ShellOverlay';
import { store, useAppState } from '../useStore';

/** カーソルの先端と面のすきま。触れそうで触れない距離にして、誤クリックを避ける */
const GAP = 2;
/** 画面の縁に残す最小の余白。反転しても収まらないときはここで止める */
const EDGE = 8;

/**
 * 面が**自分で使う**キー。これ以外が来たらメニューは用済みとみなして閉じる。
 * `1`–`8` の画面切替や `n` / `f` / `⌘K`（`CompassApp` のグローバルショートカット）は
 * メニューを素通りして画面ごと切り替えてしまうので、こちらから畳まないと
 * 「戻ってきたら古い座標のメニューが浮いている」幽霊が残る。Finder も同じで、
 * メニューの外の操作に使うキーが来た時点でメニューは消える。
 */
const OWN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Spacebar']);

/**
 * 単独で押しただけでは何も起こさないキー。指を修飾キーに置いただけで
 * メニューが消えると、⌘+何かを打とうとして毎回閉じられてしまう。
 */
const IDLE_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'OS', 'AltGraph']);

// ─────────────────────────────────────────────────────────────
// 位置決め
// ─────────────────────────────────────────────────────────────

interface Place {
  /** どの `nbMenu` に対して測った結果か。開き直したときに古い座標を使わないための目印 */
  key: string;
  left: number;
  top: number;
  /** `transform-origin`。カーソルの位置をそのまま原点にする */
  origin: string;
}

/** 1 項目 */
interface MenuItem {
  key: string;
  mark: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

export function NoteContextMenu() {
  const S = useAppState();
  const menu = S.nbMenu;

  // フックの並びを固定するため、`menu` は最初に素の値へ崩しておく（閉じていれば空）
  const mid = menu ? menu.noteId : '';
  const mx = menu ? menu.x : 0;
  const my = menu ? menu.y : 0;
  const key = mid + ':' + mx + ':' + my;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 開く直前にフォーカスがあった要素。Esc で閉じたらここへ返す */
  const prevFocus = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [active, setActive] = useState(0);

  const note = mid ? S.notes.find((n) => n.id === mid) || null : null;

  /**
   * 実寸を測ってから置く。`useLayoutEffect` なので描画の前に確定し、
   * 「左上に一瞬出てから飛ぶ」ちらつきが起きない。
   *
   * 端の扱いは**反転が第一手・クランプが第二手**。カーソルの右下に出すと画面から
   * はみ出すときは左（上）へ折り返し、折り返してもなお入らない狭い画面では
   * 縁で止める。折り返しの判定に反対側の余地（`mx - GAP - w >= EDGE`）まで見るのは、
   * 「はみ出すから反転したら今度は反対側がはみ出した」を避けるため。
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!mid || !el) {
      setPlace(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    const flipX = mx + GAP + w > vw - EDGE && mx - GAP - w >= EDGE;
    const flipY = my + GAP + h > vh - EDGE && my - GAP - h >= EDGE;
    const rawLeft = flipX ? mx - GAP - w : mx + GAP;
    const rawTop = flipY ? my - GAP - h : my + GAP;
    const left = Math.max(EDGE, Math.min(rawLeft, vw - EDGE - w));
    const top = Math.max(EDGE, Math.min(rawTop, vh - EDGE - h));

    // 原点はカーソルの座標そのもの（面の中の相対位置）。反転してもクランプされても、
    // 「カーソルから面が生えた」ように見える
    const ox = Math.max(0, Math.min(mx - left, w));
    const oy = Math.max(0, Math.min(my - top, h));
    setPlace({ key: mid + ':' + mx + ':' + my, left, top, origin: ox + 'px ' + oy + 'px' });
  }, [mid, mx, my]);

  /** 開いたら先頭の項目へ。閉じたら元の場所へフォーカスを返す（キーボードだけで往復できる） */
  useEffect(() => {
    if (!mid) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    setActive(0);
    return () => {
      const el = prevFocus.current;
      prevFocus.current = null;
      if (!el || !el.isConnected) return;
      // **無条件に返さない**。画面のどこかをクリックして閉じた場合、そのクリックで
      // 検索窓などにフォーカスが移っていることがあり、返すと本人が選んだ先を奪い返す。
      // 返すのは「まだ面の中にいる」か「面ごと消えて body に落ちた」ときだけ。
      const act = document.activeElement;
      const box = boxRef.current;
      const stray = act && act !== document.body && !(box && box.contains(act));
      if (!stray) el.focus({ preventScroll: true });
    };
  }, [mid, mx, my]);

  /**
   * 実際にフォーカスを移すのは位置が決まってからにする。
   * 測る前の面は `visibility:hidden` で、隠れている要素はフォーカスを受け取れない。
   */
  useEffect(() => {
    if (!mid || !place) return;
    const el = itemRefs.current[active];
    // `preventScroll` は必須。フォーカスでサイドバーが動くと、下の scroll 監視が
    // 自分で自分を閉じてしまう
    if (el) el.focus({ preventScroll: true });
  }, [mid, place, active]);

  /**
   * 閉じる条件。Esc / 面の外を押した / **面が扱わないキー** / スクロール /
   * 画面の外へ行った / 幅が変わった。
   *
   * スクロールと リサイズ で閉じるのは、`nbMenu` が**ビューポート座標**だから
   * ―― 一覧が動いた瞬間にメニューは「別の行の脇」を指してしまう。追随させるより、
   * 消えてくれた方が誤操作が無い（Finder も同じ）。
   */
  useEffect(() => {
    if (!mid) return;
    const close = () => store.setState({ nbMenu: null });
    const onPointer = (e: MouseEvent) => {
      const el = boxRef.current;
      // 面の中の押し込みは見送る。ここで閉じると項目が消えて click が発火しない
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        // Tab も面の中には留めない。ただし既定の移動は止めて、下の後始末で
        // 右クリックした行へフォーカスを返す（面が消えた後の行き先を宙に浮かせない）
        e.preventDefault();
        close();
        return;
      }
      if (IDLE_KEYS.has(e.key)) return;
      // ↑↓ Home End Enter Space は面の中の移動・決定。下の onKeyDown（バブル）へ通す
      if (!e.metaKey && !e.ctrlKey && !e.altKey && OWN_KEYS.has(e.key)) return;
      // それ以外は畳むだけで**止めない**。`1` を押したなら本人は画面を切り替えたいので、
      // メニューを消したうえで `CompassApp` のショートカットにそのまま渡す
      close();
    };
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    // capture で拾わないと、サイドバーの中のスクロールは window まで上がってこない
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [mid]);

  /** 開いている最中にノートが消えた（別経路で削除・ゴミ箱へ移動）ら、指す先が無いので閉じる */
  useEffect(() => {
    if (mid && !note) store.setState({ nbMenu: null });
  }, [mid, note]);

  /**
   * 保険。この部品ごと画面から降りるとき（ノート画面を離れる等）に `nbMenu` を掃除する。
   *
   * **deps は必ず空**にすること。`[mid]` の effect の後始末に入れると、行 A → 行 B と
   * 続けて右クリックしたときに、A の後始末が**もう立っている B の `nbMenu`** を
   * 消してしまう（開いた直後に消える）。
   */
  useEffect(
    () => () => {
      if (store.getState().nbMenu) store.setState({ nbMenu: null });
    },
    [],
  );

  if (!menu || !note) return null;

  // 数え上げは #7 の `noteCascadeCounts` に任せる。あちらは実際の削除と同じ
  // `cascade*` をドライランして数えるので、**聞いた数と消える数が構造的にずれない**。
  // ここに同じ述語をもう 1 本書くと、片方だけ直したときに静かに食い違う。
  const counts = noteCascadeCounts(S, note.id);
  const reviewCount = counts.reviews;
  const summaryCount = counts.summaries;
  // 教科の既定値は `NotebookTree` の見出しと同じ流儀にそろえる（潜り先の名前が食い違わない）
  const subject = note.subject || 'その他';

  const items: MenuItem[] = [
    {
      key: 'rename',
      mark: '✎',
      label: '名称変更',
      run: () =>
        store.setState({
          // 改名も「復習のタイトルまで書き換えるか」を聞く必要があるので、
          // その場で書き換えず #6 のダイアログへ渡す
          nbAsk: {
            kind: 'rename',
            noteId: note.id,
            unit: note.unit,
            nextUnit: note.unit,
            reviewCount,
            summaryCount,
          },
          nbMenu: null,
        }),
    },
  ];

  // すでにその教科へ潜っているときは出さない（押しても何も起きない項目を並べない）
  if (S.nbFolder !== subject) {
    items.push({
      key: 'folder',
      mark: '▤',
      label: 'この教科だけ表示',
      // 潜る入口は 1 つ（`folderEnterPatch`）に寄せる。教科チップの絞り込みを
      // 畳むところまで含まれているので、ここで書き足さない
      run: () => store.setState({ ...folderEnterPatch(subject), nbMenu: null }),
    });
  }

  items.push({
    key: 'trash',
    mark: '⌫',
    label: '削除',
    danger: true,
    run: () =>
      store.setState({
        nbAsk: { kind: 'trash', noteId: note.id, unit: note.unit, reviewCount, summaryCount },
        nbMenu: null,
      }),
  });

  /** ↑↓ で送り、Home/End で端へ。Tab は閉じる（面の外へ抜けたのに面が残るのを避ける） */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = items.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      store.setState({ nbMenu: null });
    }
  };

  const style: CSSProperties = {
    left: (place && place.key === key ? place.left : mx) + 'px',
    top: (place && place.key === key ? place.top : my) + 'px',
    transformOrigin: place && place.key === key ? place.origin : 'left top',
    // 測る前の 1 レンダーだけ隠す。`useLayoutEffect` で確定するので描画には出ない
    visibility: place && place.key === key ? undefined : 'hidden',
  };

  return (
    <ShellOverlay>
      <div
        ref={boxRef}
        className="nb-menu"
        role="menu"
        aria-orientation="vertical"
        aria-label={(note.unit || '単元名なし') + ' の操作'}
        style={style}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 何を右クリックしたのかを 1 行で示す。行が密なので、狙いを外していれば気づける */}
        <div className="nb-menu__head" aria-hidden="true">
          {note.unit || '(単元名なし)'}
        </div>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            tabIndex={i === active ? 0 : -1}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={'nb-menu__item' + (it.danger ? ' nb-menu__item--danger' : '')}
            onMouseEnter={() => setActive(i)}
            onClick={it.run}
          >
            <span className="nb-menu__mark" aria-hidden="true">
              {it.mark}
            </span>
            {it.label}
          </button>
        ))}
      </div>
    </ShellOverlay>
  );
}
