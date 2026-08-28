'use client';

/**
 * Compass — Clawd と話す面（隠しタブ `view: 'clawd'`）
 *
 * 要望の原文（2026-08-28）:
 * 「押したらチャットタブっていう隠しタブが出てきて、そこには真ん中に Clawd くんがいて、
 *   そこで励ましてもらったり応援してもらったり、Clawd くんと触れ合ったりできる」
 * 「そのタブ UI はめっちゃ Claude っぽくして！」
 *
 * ## ここだけ「校内プリント」を離れる
 *
 * アプリの他の 8 画面は方眼のプリント（`ShellTheme.ts` の冒頭）で、角丸は 2–3px、
 * 影は使わず、面で塗るのは「いま」だけ、という約束で組んである。
 * **この画面はその外に置く。** 理由は 2 つ:
 *
 *  1. ここは予定を扱う道具ではない。同じ紙で刷ると「もう 1 つの作業画面」に見えて、
 *     ひと息つく場所にならない。
 *  2. 本人の要望が「めっちゃ Claude っぽく」なので、寄せる先は Compass ではなく Claude。
 *     温かい紙色・大きめの角丸・ゆったりした行間・オレンジ 1 色、という別の版で刷る。
 *
 * 方眼だけは透かして残す（`.compass-shell::before` は画面の下に敷かれたまま）。
 * ここが Compass の中の一室だということまでは消さない。
 *
 * ## 何をしているか / していないか
 *
 * Clawd の言葉は `lib/logic/clawdTalk.ts` に**書いてある固定の文**で、その場で
 * 考えているわけではない。だから**自由入力の欄を置いていない** ―― 何を打っても
 * 返せるふりをするのは、この画面ができることを偽ることになる。
 * 言えることをボタンで見せて選ばせるほうが正直だし、疲れているときに
 * 文章を考えなくて済むぶん、実際に押せる。
 */

import { useEffect, useRef, useState } from 'react';
import {
  CLAWD_PROMPTS,
  CLAWD_WORK_MINUTES,
  clawdHello,
  clawdPoke,
  clawdReply,
  clawdWorkGo,
  type ClawdPrompt,
} from '../../lib/logic/clawdTalk';
import type { ClawdMsg } from '../../lib/model/types';
import { Clawd } from '../parts/Clawd';
import { startClawdWork } from '../parts/ClawdWorkWindow';
import { buildTodayItems, todayTotals } from '../parts/ShellTodayItems';
import { dateCtx, store, useAppStore } from '../useStore';

/** 会話に 1 通足す。`n` は通し番号（言葉を回すのにも使う） */
function push(who: ClawdMsg['who'], text: string): void {
  store.setState((s) => ({
    clawdLog: s.clawdLog.concat([{ who, text, n: s.clawdLog.length }]),
  }));
}

export function ClawdChat() {
  const { state: S, plans } = useAppStore();
  const T = dateCtx.today;
  const log = S.clawdLog;

  const totals = todayTotals(buildTodayItems(S, plans, T));
  const allDone = totals.totalCount > 0 && totals.doneCount === totals.totalCount;

  /** 会話の末尾。1 通増えるたびにそこへ寄せる */
  const tailRef = useRef<HTMLDivElement | null>(null);
  /** 長さを決める札を出しているか。会話の末尾に置く一時的な操作なので state に持たない */
  const [askMin, setAskMin] = useState(false);

  // 開いたら挨拶から始める。**保存していない**ので、開くたびに 1 通目が置かれる
  useEffect(() => {
    if (store.getState().clawdLog.length) return;
    push('clawd', clawdHello(new Date().getHours()));
  }, []);

  // 増えたら末尾へ。`behavior:'smooth'` は動きを止めている人には効かないので、
  // そのときは一瞬で飛ぶ（見えないより飛ぶほうがよい）
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [log.length, askMin]);

  /** Clawd を触る。押すたびに違う言葉が返る */
  const poke = () => push('clawd', clawdPoke(store.getState().clawdLog.length));

  /** 話しかける。自分の言葉を置いてから、少し置いて返ってくる */
  const say = (p: ClawdPrompt) => {
    push('me', p.say);
    const n = store.getState().clawdLog.length;
    // 即答すると「用意された文」に見える。ひと呼吸だけ置く
    setTimeout(() => push('clawd', clawdReply(p, n)), 420);
    // 「一緒に作業して」は言葉で終わらない。返しのすぐ下に長さの札を出す
    if (p.kind === 'work') setTimeout(() => setAskMin(true), 460);
  };

  /**
   * 長さを決めて始める。窓は `CompassApp` に置いてあるので、
   * ここを離れて別の画面へ移っても回り続ける（それがこの窓の存在理由）。
   */
  const startWork = (min: number) => {
    setAskMin(false);
    push('me', min + '分');
    startClawdWork(min);
    setTimeout(() => push('clawd', clawdWorkGo(min)), 380);
  };

  return (
    <div data-screen-label="Clawd" className="cc">
      <div className="cc__sheet">
        {/* ── 真ん中の Clawd。触ると 1 周ぶん動いて、一言返す */}
        <div className="cc__stage">
          <Clawd
            kind={allDone ? 'cheer' : 'play'}
            size={128}
            onTap={poke}
            className="cc__clawd"
          />
          <div className="cc__name">Clawd</div>
          <div className="cc__sub">
            {allDone
              ? '今日のぶんは終わってる。ここは休むところ'
              : '触ると反応する。急かさないし、採点もしない'}
          </div>
        </div>

        {/* ── 会話 */}
        <div className="cc__log" role="log" aria-label="Clawdとの会話" aria-live="polite">
          {log.map((m) => (
            <div key={m.n} className={'cc__row cc__row--' + m.who}>
              {m.who === 'clawd' ? (
                <Clawd kind="play" size={22} interactive={false} className="cc__avatar" />
              ) : null}
              <div className="cc__bubble">{m.text}</div>
            </div>
          ))}
          {/* 長さの札。返しの続きに見えるよう、Clawd のアイコンぶん字下げして置く */}
          {askMin ? (
            <div className="cc__mins" role="group" aria-label="作業する長さ">
              {CLAWD_WORK_MINUTES.map((m) => (
                <button key={m} type="button" className="cc__min" onClick={() => startWork(m)}>
                  {m}分
                </button>
              ))}
            </div>
          ) : null}
          <div ref={tailRef} />
        </div>
      </div>

      {/* ── 話しかける。自由入力は置かない（このファイルの冒頭を見よ） */}
      <div className="cc__asks" role="group" aria-label="Clawdに話しかける">
        {CLAWD_PROMPTS.map((p) => (
          <button key={p.say} type="button" className="cc__ask" onClick={() => say(p)}>
            {p.say}
          </button>
        ))}
      </div>
    </div>
  );
}
