'use client';

/**
 * Compass — タスクを片づけたときに下から届く祝い
 *
 * 要望の原文（2026-08-28）:
 * 「タスクをクリアするごとに、下に Clawd くんからメッセージが届くようにして！
 *   左下に Clawd のお祝いの gif のアイコンをおいて、その右にお祝い文があるみたいな！」
 *
 * ## トーストと分けた理由
 *
 * `ShellToast` は画面の下**中央**に出る「知らせ」で、保存の失敗や取り込みの結果など
 * **読まないと困ること**のための場所。祝いをそこへ混ぜると、
 *  - 大事な知らせを祝いが上書きして消してしまう（トーストは 1 本しか出せない）
 *  - 逆に、祝いのつもりで出したものが「何か問題が起きた」の場所に出る
 * ので別の席（左下）に置いた。要望の「左下に」もこの分担と噛み合っている。
 *
 * 祝いは**消えても困らない**ので、勝手に出て勝手に引っ込む。読み上げも
 * `aria-live="polite"` に留めて、いま読んでいるところを遮らない。
 */

import { useEffect, useRef, useState } from 'react';
import type { ClawdCheerMsg } from '../../lib/model/types';
import { Clawd } from './Clawd';
import { ShellOverlay } from './ShellOverlay';
import { store, useAppStore } from '../useStore';

/** 出ている時間（ms）。読み終わるが、次の一手の邪魔にはならない長さ */
const CHEER_MS = 3600;

/** 引っ込む動きの長さ。`clawd-chat.css` の `ccheer-out` と揃える */
const OUT_MS = 220;

export function ClawdCheer() {
  const { state: S } = useAppStore();
  const cheer = S.clawdCheer;

  /**
   * 引っ込むところまで見せるために、文言は**この部品が持ち直す**
   * （`ShellToast` と同じ手）。state 側が `null` になっても、出口の 0.22 秒に
   * 出す中身が要る。
   */
  const [shown, setShown] = useState<ClawdCheerMsg | null>(cheer);
  const [out, setOut] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    if (dropTimer.current !== null) clearTimeout(dropTimer.current);

    if (cheer) {
      setShown(cheer);
      setOut(false);
      // 続けて片づけたときは、時間を数え直す（前の祝いの残り時間で消えない）
      hideTimer.current = setTimeout(() => store.setState({ clawdCheer: null }), CHEER_MS);
      return;
    }
    setOut(true);
    // 外すのは animationend ではなく時間で。動きを止めている人は animation が
    // 鳴らないので、animationend を待つと出たまま残る（`ShellToast` と同じ理由）
    dropTimer.current = setTimeout(() => setShown(null), OUT_MS);
  }, [cheer]);

  useEffect(
    () => () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      if (dropTimer.current !== null) clearTimeout(dropTimer.current);
    },
    [],
  );

  if (!shown) return null;

  return (
    <ShellOverlay>
      <div
        // `n` で作り直して、続けて片づけたときも毎回ちゃんと鳴らす
        key={shown.n}
        className={'ccheer' + (out ? ' is-out' : '')}
        role="status"
        aria-live="polite"
      >
        {/* 左下の祝いの Clawd。置いた瞬間に 1 周だけ流す（触りに行くものではない）。
            装飾なので読み上げには載せない */}
        <Clawd kind="cheer" size={40} interactive={false} autoPlay />
        <div className="ccheer__text">
          <span className="ccheer__who">CLAWD</span>
          {shown.text}
        </div>
      </div>
    </ShellOverlay>
  );
}
