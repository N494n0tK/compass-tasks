'use client';

/**
 * Compass — Clawd くん（docs/notebook/ux-refresh.md §11）
 *
 * 本人が持ってきた**本物のドット絵の GIF**をそのまま出す（`public/clawd/`）。
 * 最初は自前で線画を起こしていたが、本人から「自分で作らなくていい、この GIF を使って」と
 * 渡されたので、絵を描く仕事は丸ごと無くなった。ここに残るのは**いつ動かすか**だけ。
 *
 * ## 触るまで動かない
 *
 * GIF は貼った瞬間から延々ループする。学習アプリの画面の端で何かが回り続けるのは
 * 集中を削るだけなので、**既定は 1 コマ目の静止画（`*.png`）**にしておき、
 * 触られたときだけ GIF に差し替えて 1 周ぶん流し、終わったら静止画へ戻す。
 * 本人の「タッチしたら短いアニメーションが流れたりしたらやる気出る」はこの形。
 *
 * 差し替えは `key` を変えて `<img>` を作り直すことでやる ―― 同じ要素の `src` を
 * 戻し入れするだけだと、ブラウザによっては途中のコマから再開して「押したのに
 * 頭から流れない」ことがある。作り直せば必ず 1 コマ目から始まる。
 *
 * ## 3 匹の使い分け
 *
 * 絵柄は 3 つあり、**画面（タブ）ごとに違う 1 匹**が居る（本人の「タブで使い分ければ良さげ」）。
 * 同じ絵があちこちに出るより、部屋ごとに住人が違うほうが、画面を移った実感が出る。
 *
 *  - `type`  … 端末に向かって歩いて打ち始める。**手を動かす画面**（ノート・追加・予定）
 *  - `play`  … 玉で遊ぶ。**待ちの画面**（コックピット・データ）
 *  - `cheer` … クラッカーで祝う。**やり切ったとき**（今日のToDo・復習の完了）
 *
 * ## 大きさ
 *
 * ドット絵なので `image-rendering: pixelated` で拡大し、**整数倍**に近い寸法で置く。
 * 半端な倍率だと網目がにじんで、ドット絵の良さが消える。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/** 絵柄。`public/clawd/clawd-{kind}.gif` と `.png` が対応する */
export type ClawdKind = 'type' | 'play' | 'cheer';

interface ClawdArt {
  /** 静止画（1 コマ目）。触るまではこれ */
  still: string;
  /** 動く版 */
  motion: string;
  /** 1 周の長さ（ms）。コマ数 × 1 コマの時間。これを過ぎたら静止画へ戻す */
  loopMs: number;
  /** 元画像の縦横比（`height / width`）。枠を先に確保して紙面が飛び跳ねないように */
  ratio: number;
  /** 読み上げ。装飾で使うときは `interactive={false}` にして読ませない */
  label: string;
}

/**
 * 素材の実寸は `public/clawd/`（type 100×100 / play 166×166 / cheer 166×112）。
 * `loopMs` は書き出し時のコマ数×間隔そのままで、ここを実物より短くすると
 * 動き終わる前に静止画へ戻って「途中で切れた」ように見える。
 */
const ART: Record<ClawdKind, ClawdArt> = {
  type: {
    still: '/clawd/clawd-type.png',
    motion: '/clawd/clawd-type.gif',
    loopMs: 4320,
    ratio: 1,
    label: 'Clawdくん（歩いて打ち始める）',
  },
  play: {
    still: '/clawd/clawd-play.png',
    motion: '/clawd/clawd-play.gif',
    loopMs: 3920,
    ratio: 1,
    label: 'Clawdくん（玉で遊ぶ）',
  },
  cheer: {
    still: '/clawd/clawd-cheer.png',
    motion: '/clawd/clawd-cheer.gif',
    loopMs: 4240,
    ratio: 112 / 166,
    label: 'Clawdくん（クラッカーで祝う）',
  },
};

/**
 * 画面ごとの住人（`ViewId` → 絵柄）。
 * ここに無い画面は `play`（待ちの姿）に落ちる。
 */
export const CLAWD_BY_VIEW: Record<string, ClawdKind> = {
  cockpit: 'play',
  todo: 'cheer',
  review: 'cheer',
  tests: 'type',
  add: 'type',
  data: 'play',
  notebook: 'type',
  extract: 'type',
};

/** その画面に住んでいる Clawd を引く */
export function clawdForView(view: string): ClawdKind {
  return CLAWD_BY_VIEW[view] || 'play';
}

export interface ClawdProps {
  kind?: ClawdKind;
  /** 横幅（px）。縦は絵の比率で決まる */
  size?: number;
  /**
   * 押せるか。既定 `true`（`<button>` になり、触ると 1 周動く）。
   * すでに押せる行やボタンの**中**に置くときは必ず `false`
   * ―― `<button>` の入れ子は DOM として不正になる。
   */
  interactive?: boolean;
  /** 触られたときに親がやりたいこと（アニメーションは押した時点で始まる） */
  onTap?: () => void;
  /**
   * 置いた瞬間に 1 周だけ流す。「できた」の合図に使う面（全部終わったとき等）向け。
   * 常設の Clawd には付けない ―― 画面を開くたびに動くと、ただの飾りになる。
   */
  autoPlay?: boolean;
  /**
   * 止まらずに動かし続ける。**その場かぎりの「いま祝っている」ためだけ**に使う
   * （作業タイマーが鳴ったあとの窓など）。
   *
   * 常設のものには絶対に付けない ―― 視界の端で何かが回り続けると集中が削れる、
   * というのがこのファイルの既定を静止画にしている理由そのものなので。
   * 付ける側は「本人が閉じるまでの短い時間だけ」であることを確かめること。
   */
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Clawd({
  kind = 'play',
  size = 40,
  interactive = true,
  onTap,
  autoPlay = false,
  loop = false,
  className,
  style,
}: ClawdProps) {
  const art = ART[kind];
  /** 0 = 静止。1 以上 = その回のアニメーション（`key` に使うので押すたびに増やす） */
  const [run, setRun] = useState(autoPlay || loop ? 1 : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 動きを止める設定の人には、そもそも差し替えない（静止画のまま） */
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const play = useCallback(() => {
    if (reduced) return;
    // 既に流しっぱなしなら、押しても何も変えない（作り直すと頭に飛んで不自然）
    if (loop) return;
    // 連打されたら数を進めるだけ。`key` が変わって `<img>` が作り直され、
    // 必ず 1 コマ目から流れ直す
    setRun((n) => n + 1);
  }, [reduced, loop]);

  // 1 周ぶん経ったら静止画へ戻す。`run` が変わるたびに掛け直す（連打で伸びる）。
  // 動かし続ける指定のときは戻さない（GIF は元から無限ループなので放っておけばよい）
  useEffect(() => {
    if (!run || loop) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setRun(0);
    }, art.loopMs);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [run, loop, art.loopMs]);

  const img = (
    <img
      // 動かすときだけ作り直す。静止画のあいだは同じ要素のままなので、
      // 画面が再描画されるたびに読み直しにはならない
      key={run}
      className="clawd__img"
      src={run || (loop && !reduced) ? art.motion : art.still}
      alt=""
      width={Math.round(size)}
      height={Math.round(size * art.ratio)}
      draggable={false}
      decoding="async"
    />
  );

  const box: CSSProperties = {
    // 枠を先に確保しておく。GIF に差し替わった瞬間に寸法が動くと紙面が跳ねる
    width: Math.round(size) + 'px',
    height: Math.round(size * art.ratio) + 'px',
    ...style,
  };

  if (!interactive) {
    return (
      <span className={'clawd' + (className ? ' ' + className : '')} style={box} aria-hidden="true">
        {img}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={'clawd clawd--tap' + (className ? ' ' + className : '')}
      style={box}
      aria-label={art.label}
      onClick={() => {
        play();
        onTap?.();
      }}
    >
      {img}
    </button>
  );
}
