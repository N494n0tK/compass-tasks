'use client';

/**
 * Compass — 復習の7日予報の帯（docs/daily-mission/plan.md §4.2）
 *
 * 復習は今日の負荷にしか乗らない（`loadsMap`）ので、Tests のタイムラインを見ても
 * 「木曜に復習が 45 分たまる」は絶対に見えない。その 1 点だけを Review 画面の上に置く。
 *
 * ## 見た目は Tests の負荷バーに合わせる
 *
 * 縦棒 14px・棒の下に数字・週末は緑・超過は `--pink`（Tests:450-485）。同じ「日ごとの重さ」を
 * 表すものが 2 つの画面で違う見た目になると、どちらが本当の負荷なのか分からなくなる。
 * ただし**高さの基準は `wkMax` ではない** ―― 復習だけで 240 分になることはまず無く、
 * その物差しだと全部の棒が潰れて予報にならないので、`max(いちばん重い日, 重い日のしきい値)`
 * を満杯とする。
 *
 * ## クリックで表の絞り込みへ
 *
 * 見せるだけでは前倒しに繋がらないので、日をクリックしたら**その日ぶんだけ**の表になる。
 * 絞り込みの述語は集計と同じ `matchesForecastDay` を通すので、棒の件数と行数は必ず一致する。
 */

import { fmtMD } from '../../lib/logic/dates';
import {
  FORECAST_HEAVY_MIN,
  buildReviewForecast,
  type ReviewForecastDay,
} from '../../lib/logic/reviewForecast';
import { loadBarPct, toH } from '../../lib/logic/schedule';
import type { ISODate, Review } from '../../lib/model/types';

export interface ReviewForecastStripProps {
  reviews: readonly Review[];
  today: ISODate;
  /** 絞り込み中の日（`null` = 絞り込みなし） */
  selected: ISODate | null;
  /** 日をクリックしたとき（同じ日をもう一度で解除するのは呼び出し側の責務） */
  onPick: (iso: ISODate) => void;
}

/** 棒の色。警告色（重い日）→ 週末 → 平日 の順に決まる（Tests:83 と同じ並び） */
function barColorOf(day: ReviewForecastDay): string {
  if (day.heavy) return 'var(--pink)';
  return day.weekend ? 'var(--grn)' : 'var(--acc)';
}

/** 日ラベル。今日・明日だけは曜日より「いつか」を出す */
function dayLabelOf(day: ReviewForecastDay): string {
  return day.offset === 0 ? '今日' : day.offset === 1 ? '明日' : day.dow;
}

/** ツールチップ。遅れの内訳はここに出す（帯の中に入れると数字が読めなくなる） */
function tipOf(day: ReviewForecastDay): string {
  const head = fmtMD(day.iso) + '(' + day.dow + ') · ' + day.count + '件 · ' + day.min + '分';
  return day.overdueCount ? head + '（うち遅れ' + day.overdueCount + '件）' : head;
}

export function ReviewForecastStrip({
  reviews,
  today,
  selected,
  onPick,
}: ReviewForecastStripProps) {
  const fc = buildReviewForecast(reviews, today);
  // 満杯の基準。いちばん重い日を満杯にしつつ、軽い週でも「しきい値までの余裕」が見えるように
  // 最低でも `FORECAST_HEAVY_MIN` を物差しにする（全部 5 分の週で棒が満杯になると誤解を生む）
  const scale = Math.max(fc.peakMin, FORECAST_HEAVY_MIN);

  return (
    <div
      className="review-forecast"
      style={{
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--rad)',
        padding: '10px 14px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ font: "700 11px var(--f-ui)", color: 'var(--tx1)' }}>
          この先7日の復習
        </span>
        <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>
          {fc.totalCount + '件 · ' + toH(fc.totalMin) + ' · 重い日は先に片づける'}
        </span>
        {selected ? (
          <span
            className="glass-control glass-chip"
            role="button"
            tabIndex={0}
            aria-label="7日予報の絞り込みを解除"
            onClick={() => onPick(selected)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(selected);
              }
            }}
            title="絞り込みを解除"
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              font: "700 10px var(--f-ui)",
              color: 'var(--acc)',
              background: 'var(--accBg)',
              border: '1px solid var(--acc)',
              borderRadius: 'var(--rad-s)',
              padding: '3px 9px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {(selected === today ? '今日' : fmtMD(selected)) + 'の復習だけ表示'}
            <span style={{ fontSize: '11px' }}>✕</span>
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(' + fc.days.length + ',minmax(0,1fr))',
          gap: '4px',
        }}
      >
        {fc.days.map((d) => {
          const on = selected === d.iso;
          const peak = fc.peakMin > 0 && fc.peakIso === d.iso;
          const barC = barColorOf(d);
          return (
            <button
              key={d.iso}
              className={'glass-control glass-chip' + (on ? ' is-selected' : '')}
              onClick={() => onPick(d.iso)}
              aria-pressed={on}
              title={tipOf(d)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                padding: '5px 2px 4px',
                border: '1px solid ' + (on ? 'var(--acc)' : 'transparent'),
                borderRadius: 'var(--rad-s)',
                background: on ? 'var(--accBg)' : 'transparent',
                cursor: 'pointer',
                // 0 件の日は薄く（押せることは押せる = 空だと分かるのも情報）
                opacity: d.count ? 1 : 0.45,
                font: 'inherit',
              }}
            >
              <span
                style={{
                  font: (peak ? '700 ' : '500 ') + '10px var(--f-ui)',
                  color:
                    d.offset === 0
                      ? 'var(--acc)'
                      : d.weekend
                        ? 'var(--grn)'
                        : 'var(--tx3)',
                  whiteSpace: 'nowrap',
                }}
              >
                {dayLabelOf(d)}
              </span>
              <span
                style={{
                  width: '100%',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    width: '14px',
                    height: loadBarPct(d.min, scale),
                    minHeight: '2px',
                    background: barC,
                    borderRadius: 0,
                    boxShadow: peak ? '0 0 0 1px color-mix(in srgb,' + barC + ' 45%,transparent)' : 'none',
                    transition: 'height .4s ease,background .3s ease',
                  }}
                />
              </span>
              <span
                style={{
                  font: (peak ? '700 ' : '500 ') + '10px var(--f-num)',
                  color: d.heavy ? 'var(--pink)' : d.count ? 'var(--tx1)' : 'var(--tx3)',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.count}
                <span style={{ fontSize: '8.5px' }}>件</span>
              </span>
              <span
                style={{
                  font: "500 9px var(--f-num)",
                  color: d.heavy ? 'var(--pink)' : 'var(--tx3)',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.min ? d.min + '分' : '–'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
