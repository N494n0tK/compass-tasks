'use client';

import { useEffect, useState } from 'react';
import {
  formatCountdown,
  formatLocalClock,
  millisecondsUntilLocalMidnight,
  type TopbarClockSnapshot,
} from './topbarClockLogic';

const EMPTY_TIME = '--:--:--';

function useTopbarClock(): TopbarClockSnapshot | null {
  const [snapshot, setSnapshot] = useState<TopbarClockSnapshot | null>(null);

  useEffect(() => {
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const tick = () => {
      if (document.visibilityState === 'hidden') return;

      const now = new Date();
      const untilMidnightMs = millisecondsUntilLocalMidnight(now);
      setSnapshot({
        now,
        current: formatLocalClock(now),
        untilMidnightMs,
        untilMidnight: formatCountdown(untilMidnightMs),
      });

      // 秒境界の少し後へ合わせ、background timer の遅れから早戻りしないようにする。
      const wait = 1000 - (Date.now() % 1000) + 16;
      timer = window.setTimeout(tick, wait);
    };

    const onVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState === 'visible') tick();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    tick();

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return snapshot;
}

export function TopbarClock() {
  const clock = useTopbarClock();
  const current = clock?.current ?? EMPTY_TIME;
  const untilMidnight = clock?.untilMidnight ?? EMPTY_TIME;
  const ariaLabel = clock
    ? `現在時刻 ${clock.current}。日付変更まで ${clock.untilMidnight}`
    : '現在時刻と日付変更までの時間を読み込み中';

  return (
    <div
      className="app-top-clock"
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        flex: '0 1 clamp(118px, 13vw, 156px)',
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'center',
        minWidth: '118px',
        maxWidth: '156px',
        gap: '3px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <time
        dateTime={clock?.now.toISOString()}
        aria-label={clock ? `現在時刻 ${clock.current}` : '現在時刻を読み込み中'}
        style={{
          display: 'block',
          color: 'var(--tx1)',
          font: '600 14px var(--f-num)',
          letterSpacing: '.08em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {current}
      </time>
      <time
        dateTime={clock ? `PT${Math.ceil(clock.untilMidnightMs / 1000)}S` : undefined}
        aria-label={clock ? `日付変更まで ${clock.untilMidnight}` : '日付変更までを読み込み中'}
        style={{
          display: 'block',
          color: 'var(--tx3)',
          font: '500 10px var(--f-num)',
          letterSpacing: '.03em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span aria-hidden="true">日付変更まで </span>
        {untilMidnight}
      </time>
    </div>
  );
}
