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
 * 考えているわけではない。だから会話そのものの自由入力欄は置かず、言えることをボタンで見せて
 * 選ばせる。作業時間だけは、必要な長さを自分で決められる専用欄を用意する。
 */

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  CLAWD_PROMPTS,
  CLAWD_WORK_MAX_MINUTES,
  CLAWD_WORK_MINUTES,
  clawdHello,
  clawdPoke,
  clawdReply,
  clawdWorkGo,
  type ClawdPrompt,
  shouldSubmitClawdWorkMinutes,
  validateClawdWorkMinutes,
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
  /** 作業窓を閉じたとき、一時的な分数ボタンではなく常設の入口へ戻す。 */
  const workTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** 長さを決める札を出しているか。会話の末尾に置く一時的な操作なので state に持たない */
  const [askMin, setAskMin] = useState(false);
  /** 自由入力する作業時間。候補札を選ぶ場合はこの値を経由しない。 */
  const [customMinutes, setCustomMinutes] = useState('');
  const customMinutesRef = useRef<HTMLInputElement | null>(null);
  /** Enter と form submit が同じ作業を二重起動しないための 1 回ロック。 */
  const customSubmitLockRef = useRef(false);

  const customMinutesValidation = validateClawdWorkMinutes(customMinutes);
  const customMinutesError =
    customMinutes && !customMinutesValidation.ok
      ? customMinutesValidation.reason === 'range'
        ? `1〜${CLAWD_WORK_MAX_MINUTES}分で入力してください`
        : `1〜${CLAWD_WORK_MAX_MINUTES}分の整数で入力してください`
      : null;

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

  useEffect(() => {
    if (askMin) {
      customSubmitLockRef.current = false;
      customMinutesRef.current?.focus();
    }
  }, [askMin]);

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
    if (!Number.isSafeInteger(min) || min < 1 || min > CLAWD_WORK_MAX_MINUTES) return;
    setAskMin(false);
    setCustomMinutes('');
    push('me', min + '分');
    startClawdWork(min, workTriggerRef.current);
    setTimeout(() => push('clawd', clawdWorkGo(min)), 380);
  };

  const submitCustomWork = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customMinutesValidation.ok) return;
    if (customSubmitLockRef.current) return;
    customSubmitLockRef.current = true;
    startWork(customMinutesValidation.minutes);
  };

  const submitCustomWorkFromKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const composing = event.nativeEvent.isComposing;
    if (!shouldSubmitClawdWorkMinutes(event.key, composing, customMinutesValidation)) return;
    event.preventDefault();
    if (customSubmitLockRef.current) return;
    if (!customMinutesValidation.ok) return;
    customSubmitLockRef.current = true;
    startWork(customMinutesValidation.minutes);
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
              <div className="cc__min-choices" role="group" aria-label="おすすめの長さ">
                {CLAWD_WORK_MINUTES.map((m) => (
                  <button key={m} type="button" className="cc__min" onClick={() => startWork(m)}>
                    {m}分
                  </button>
                ))}
              </div>
              <form className="cc__custom" onSubmit={submitCustomWork} noValidate>
                <label className="cc__custom-label" htmlFor="cc-custom-minutes">
                  好きな分数
                </label>
                <div className="cc__custom-controls">
                  <input
                    ref={customMinutesRef}
                    id="cc-custom-minutes"
                    className="cc__custom-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint="done"
                    autoComplete="off"
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(event.target.value)}
                    onKeyDown={submitCustomWorkFromKey}
                    aria-describedby="cc-custom-minutes-help"
                    aria-errormessage={customMinutesError ? 'cc-custom-minutes-error' : undefined}
                    aria-invalid={customMinutes.length > 0 && !customMinutesValidation.ok}
                    placeholder="例: 30"
                  />
                  <span className="cc__custom-unit" aria-hidden="true">
                    分
                  </span>
                  <button
                    type="submit"
                    className="cc__custom-submit"
                    disabled={!customMinutesValidation.ok}
                  >
                    決定
                  </button>
                </div>
                <p id="cc-custom-minutes-help" className="cc__custom-help">
                  1〜{CLAWD_WORK_MAX_MINUTES}分の整数。Enterでも決定できます
                </p>
                {customMinutesError ? (
                  <p id="cc-custom-minutes-error" className="cc__custom-error" role="alert">
                    {customMinutesError}
                  </p>
                ) : null}
              </form>
            </div>
          ) : null}
          <div ref={tailRef} />
        </div>
      </div>

      {/* ── 話しかける。会話はボタン、作業時間は上の専用欄で受け取る */}
      <div className="cc__asks" role="group" aria-label="Clawdに話しかける">
        {CLAWD_PROMPTS.map((p) => (
          <button
            key={p.say}
            ref={p.kind === 'work' ? workTriggerRef : undefined}
            type="button"
            className="cc__ask"
            onClick={() => say(p)}
          >
            {p.say}
          </button>
        ))}
      </div>
    </div>
  );
}
