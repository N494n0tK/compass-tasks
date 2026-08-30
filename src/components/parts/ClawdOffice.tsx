'use client';

/** 全画面表示用の Clawd Office。残り時間の更新はここでは絶対に行わない。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { clawdWorkDoneDuration } from '../../lib/logic/clawdTalk';
import type { ClawdWork } from '../../lib/model/types';
import { store, useAppStore } from '../useStore';
import { ShellOverlay } from './ShellOverlay';
import { useDialogFocus } from './useDialogFocus';
import type { OfficeWeather } from './ClawdOfficeScene';
import {
  OFFICE_MAX_MINUTES,
  clockText,
  durationFromParts,
  durationParts,
  formatOfficeTime,
  isOfficeIdle,
  officeStatus,
  type OfficeStatus,
} from './clawdOfficeLogic';

const PRESETS = [5, 15, 25, 45, 60] as const;

// The procedural 1200x735 canvas renderer is the heaviest part of this feature.
// Keep it out of the ordinary Compass bundle until the user actually opens the office.
const ClawdOfficeScene = dynamic(
  () => import('./ClawdOfficeScene').then((module) => module.ClawdOfficeScene),
  { ssr: false },
);
const TIMES = [
  { name: '朝', minutes: 420 },
  { name: '昼', minutes: 780 },
  { name: '夕', minutes: 1080 },
  { name: '夜', minutes: 1170 },
] as const;
const WEATHERS: Array<{ id: OfficeWeather; label: string }> = [
  { id: 'clear', label: '快晴' },
  { id: 'cloudy', label: 'くもり' },
  { id: 'rain', label: '雨' },
  { id: 'snow', label: '雪' },
  { id: 'storm', label: '雷雨' },
];

function totalSeconds(work: ClawdWork): number {
  return Math.max(5, Math.round(work.totalSec ?? work.min * 60));
}

function workPhase(work: ClawdWork): 'work' | 'pause' | 'done' {
  if (work.done) return 'done';
  return work.running ? 'work' : 'pause';
}

function statusText(status: OfficeStatus): string {
  return {
    idle: '待機中',
    open: '準備中',
    work: '作業中',
    pause: '一時停止',
    close: '片づけ中',
    done: '完了',
  }[status];
}

function statusSub(status: OfficeStatus): string {
  return {
    idle: 'スタートすると、Clawdくんが PC を出して作業を始めます',
    open: 'PC を出しています…',
    work: 'カタカタ…一緒に集中しましょう',
    pause: 'PCをしまって待っています',
    close: 'PC をしまっています…',
    done: 'おつかれさまでした！',
  }[status];
}

function playChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    [880, 1174.7, 1567.9].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.16;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 1);
    });
    window.setTimeout(() => void context.close(), 1200);
  } catch {
    // AudioContext を使えないブラウザでも完了表示は正しく残す。
  }
}

export function ClawdOffice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useAppStore();
  const work = state.clawdWork;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [weather, setWeather] = useState<OfficeWeather>('clear');
  const [fixedMinutes, setFixedMinutes] = useState(1170);
  const [timeFlow, setTimeFlow] = useState(false);
  const [currentSelected, setCurrentSelected] = useState(false);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [sessions, setSessions] = useState(0);
  const [pokeNonce, setPokeNonce] = useState(0);
  const [transition, setTransition] = useState<'open' | 'close' | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const previousDoneRef = useRef(false);
  const previousRunRef = useRef<{ running: boolean; done: boolean } | null>(
    work ? { running: work.running, done: work.done } : null,
  );

  const onPanelKeyDown = useDialogFocus({
    open,
    panelRef,
    initialFocusRef: closeRef,
    onClose,
  });

  // 画面を閉じる時点で work が消えていたら portal の中身も確実に閉じる。
  useEffect(() => {
    if (open && !work) onClose();
  }, [open, work, onClose]);

  // Officeの表示中だけでなく、小窓に戻っている間の完了も観測する。
  // ClawdOffice自体は作業stateがある間mountedなので、一度だけ数えて音を鳴らせる。
  useEffect(() => {
    if (!work) {
      previousDoneRef.current = false;
      setToastVisible(false);
      return;
    }
    let toastTimer = 0;
    if (work.done && !previousDoneRef.current) {
      setSessions((value) => value + 1);
      if (soundRef.current) playChime();
      setToastVisible(true);
      toastTimer = window.setTimeout(() => setToastVisible(false), 4500);
    } else if (!work.done) {
      setToastVisible(false);
    }
    previousDoneRef.current = work.done;
    return () => window.clearTimeout(toastTimer);
  }, [work?.done]);

  // canvasのPC出し入れと同じ830ms/1000msだけ、バッジと説明も
  // 「準備中」「片づけ中」にする。タイマー本体はここで更新しない。
  useEffect(() => {
    if (!work) {
      previousRunRef.current = null;
      setTransition(null);
      return;
    }
    const previous = previousRunRef.current;
    previousRunRef.current = { running: work.running, done: work.done };
    if (!previous) return;

    let next: 'open' | 'close' | null = null;
    if (work.done && !previous.done) next = 'close';
    else if (work.running && !previous.running) next = 'open';
    else if (!work.running && previous.running) next = 'close';
    else if (!work.done && previous.done) setTransition(null);
    if (!next) return;

    setTransition(next);
    const timer = window.setTimeout(() => setTransition(null), next === 'open' ? 830 : 1000);
    return () => window.clearTimeout(timer);
  }, [work?.done, work?.running]);

  const setDuration = useCallback((seconds: number) => {
    store.setState((current) => {
      const active = current.clawdWork;
      if (!active) return null;
      const totalSec = durationFromParts(Math.floor(seconds / 60), seconds % 60);
      return {
        clawdWork: {
          ...active,
          min: Math.max(1, Math.floor(totalSec / 60)),
          totalSec,
          deadlineAt: undefined,
          leftSec: totalSec,
          running: false,
          done: false,
        },
      };
    });
  }, []);

  const toggle = useCallback(() => {
    store.setState((current) => {
      const active = current.clawdWork;
      if (!active) return null;
      const totalSec = totalSeconds(active);
      if (active.done) return { clawdWork: { ...active, totalSec, deadlineAt: Date.now() + totalSec * 1000, leftSec: totalSec, running: true, done: false } };
      const nextRunning = !active.running;
      return {
        clawdWork: {
          ...active,
          totalSec,
          deadlineAt: nextRunning ? Date.now() + Math.max(0, active.leftSec) * 1000 : undefined,
          running: nextRunning,
        },
      };
    });
  }, []);

  const reset = useCallback(() => {
    store.setState((current) => {
      const active = current.clawdWork;
      if (!active) return null;
      const totalSec = totalSeconds(active);
      return { clawdWork: { ...active, totalSec, deadlineAt: undefined, leftSec: totalSec, running: false, done: false } };
    });
  }, []);

  // supplied office の keyboard shortcut を引き継ぐ。入力中は数字の編集を
  // 邪魔しない。タイマー更新は既存小窓の effect に委ね、この handler は state を
  // 切り替えるだけである。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, reset, toggle]);

  const roomMinutes = useMemo(() => {
    if (!work || !timeFlow) return fixedMinutes;
    const elapsed = Math.max(0, totalSeconds(work) - work.leftSec);
    return (fixedMinutes + (elapsed / Math.max(1, totalSeconds(work))) * 120) % 1440;
  }, [fixedMinutes, timeFlow, work]);

  if (!open || !work) return null;
  const duration = totalSeconds(work);
  const idle = isOfficeIdle(work.running, work.done, work.leftSec, duration);
  const displayStatus = transition
    ? officeStatus(work.running, work.done, transition)
    : idle
      ? 'idle'
      : officeStatus(work.running, work.done, null);
  const parts = durationParts(duration);
  const progress = Math.max(0, Math.min(1, 1 - work.leftSec / duration));
  const selectedMoment = TIMES.find((item) => item.minutes === fixedMinutes)?.name;

  return (
    <ShellOverlay>
      <div className="clawd-office" role="presentation">
        <div ref={panelRef} className="clawd-office__app" role="dialog" aria-modal="true" aria-label="Clawd Office 作業タイマー" tabIndex={-1} onKeyDown={onPanelKeyDown}>
          <div className="clawd-office__stage">
            <ClawdOfficeScene phase={workPhase(work)} timeMinutes={roomMinutes} weather={weather} pokeNonce={pokeNonce} toastMessage={toastVisible ? 'おつかれさま！' : ''} onPoke={() => setPokeNonce((value) => value + 1)} />
            <button ref={closeRef} type="button" className="clawd-office__exit" onClick={onClose} aria-label="小さなタイマーへ戻る">
              <span aria-hidden="true">↙</span> 縮小
            </button>
          </div>

          <aside className="clawd-office__panel" aria-label="Clawd Office の設定">
            <div className="clawd-office__head">
              <span className="clawd-office__eyebrow">Focus with Clawd</span>
              <span className={'clawd-office__badge' + (displayStatus === 'work' ? ' is-on' : '')}>{statusText(displayStatus)}</span>
            </div>
            <div className="clawd-office__time" aria-live="off">{formatOfficeTime(work.leftSec)}</div>
            <div className="clawd-office__sub">{statusSub(displayStatus)}</div>
            <div className="clawd-office__bar" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>

            <div className="clawd-office__label"><span>セッションの長さ</span></div>
            <div className="clawd-office__chips" role="group" aria-label="プリセット時間">
              {PRESETS.map((minutes) => <button key={minutes} type="button" className={'clawd-office__chip' + (duration === minutes * 60 ? ' is-selected' : '')} onClick={() => setDuration(minutes * 60)}>{minutes}分</button>)}
            </div>
            <div className="clawd-office__custom">
              <div className="clawd-office__stepper">
                <button type="button" onClick={() => setDuration(durationFromParts(parts.minutes - 1, parts.seconds))} aria-label="分を減らす">−</button>
                <input type="number" min="0" max={OFFICE_MAX_MINUTES} value={parts.minutes} onChange={(event) => setDuration(durationFromParts(Number(event.target.value), parts.seconds))} aria-label="分" />
                <span>分</span>
                <button type="button" onClick={() => setDuration(durationFromParts(parts.minutes + 1, parts.seconds))} aria-label="分を増やす">+</button>
              </div>
              <div className="clawd-office__stepper">
                <button type="button" onClick={() => setDuration(durationFromParts(parts.minutes, parts.seconds - 5))} aria-label="秒を減らす">−</button>
                <input type="number" min="0" max="59" step="5" value={parts.seconds} onChange={(event) => setDuration(durationFromParts(parts.minutes, Number(event.target.value)))} aria-label="秒" />
                <span>秒</span>
                <button type="button" onClick={() => setDuration(durationFromParts(parts.minutes, parts.seconds + 5))} aria-label="秒を増やす">+</button>
              </div>
            </div>
            <div className="clawd-office__actions">
              <button type="button" className="clawd-office__primary" onClick={toggle}>{work.done || idle ? 'スタート' : work.running ? '一時停止' : '再開'}</button>
              <button type="button" className="clawd-office__ghost" onClick={reset}>リセット</button>
            </div>
            <p className="clawd-office__hint">作業中のClawdくんをクリックすると、手を止めてこっちを見て、うーんと伸びをしてから作業に戻ります。</p>

            <hr />
            <div className="clawd-office__field">
              <div className="clawd-office__label"><span>時刻</span><b>{clockText(roomMinutes)}</b></div>
              <div className="clawd-office__chips clawd-office__chips--two" role="group" aria-label="時刻モード">
                <button type="button" className={'clawd-office__chip' + (!timeFlow ? ' is-selected' : '')} onClick={() => { setFixedMinutes(Math.floor(roomMinutes)); setTimeFlow(false); }}>固定</button>
                <button type="button" className={'clawd-office__chip' + (timeFlow ? ' is-selected' : '')} onClick={() => setTimeFlow(true)}>タイマーと連動</button>
              </div>
              <input className="clawd-office__slider" type="range" min="0" max="1439" step="1" value={Math.floor(roomMinutes)} onChange={(event) => { setCurrentSelected(false); setTimeFlow(false); setFixedMinutes(Number(event.target.value)); }} aria-label="部屋の時刻" />
              <div className="clawd-office__chips clawd-office__moments" role="group" aria-label="時刻を選ぶ">
                {TIMES.map((item) => <button key={item.name} type="button" className={'clawd-office__chip' + (selectedMoment === item.name && !currentSelected ? ' is-selected' : '')} onClick={() => { setCurrentSelected(false); setTimeFlow(false); setFixedMinutes(item.minutes); }}>{item.name}</button>)}
                <button type="button" className={'clawd-office__chip' + (currentSelected ? ' is-selected' : '')} onClick={() => { const now = new Date(); setCurrentSelected(true); setTimeFlow(false); setFixedMinutes(now.getHours() * 60 + now.getMinutes()); }}>現在</button>
              </div>
            </div>
            <div className="clawd-office__field">
              <div className="clawd-office__label"><span>外の天気</span></div>
              <div className="clawd-office__chips" role="group" aria-label="外の天気">
                {WEATHERS.map((item) => <button key={item.id} type="button" className={'clawd-office__chip' + (weather === item.id ? ' is-selected' : '')} onClick={() => setWeather(item.id)}>{item.label}</button>)}
              </div>
            </div>
            <div className="clawd-office__foot">
              <span>完了セッション {sessions}</span>
              <button type="button" onClick={() => setSound((value) => !value)}>{sound ? '🔔 終了音 ON' : '🔕 終了音 OFF'}</button>
            </div>
            {work.done ? <div className="clawd-office__done" role="status">{clawdWorkDoneDuration(duration, work.min)}</div> : null}
          </aside>
        </div>
      </div>
    </ShellOverlay>
  );
}
