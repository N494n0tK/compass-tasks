'use client';

/**
 * Compass — 週次ふりかえりカード（docs/daily-mission/plan.md §4.3）
 *
 * 月曜に Cockpit を開いたときだけ、いちばん上に横長で 1 枚出る。
 * 先週の 4 つの数字（復習完了率・学習時間・ミッション・集中実測）と、
 * **まとめを書く欄**。数字は書くための材料で、主役は書く欄の方 ――
 * コーネルの `summary` を AI に書かせない理由（docs/notebook/spec.md §3.6）と同じで、
 * 「自分の言葉で言い直す」ことにしか復習の効き目はない。
 *
 * ## 出す / 出さない
 *
 * - **月曜だけ**。週がちょうど閉じた直後だけ、数字の動かない完成した 1 週間を見せられる。
 *   火曜以降は出ないが、書いた文が消えるわけではない（`weekNotes` に残り、データ画面で読める）。
 * - 先週の記録が 1 つも無ければ出さない（`report.hasRecord`）。ふりかえる材料が無い週に
 *   `–` だけのカードを置いても、読み飛ばす習慣が付くだけ。
 * - ✕ で畳めるのは**そのセッションのあいだだけ**（`state.weekReviewHidden`、保存しない）。
 *
 * ## 書き終わったら畳む
 *
 * 書いてある週は 1 行のコンパクト表示にする。毎週ここに大きな入力欄が居座ると、
 * 月曜の Cockpit が「まず書かされる画面」になる。クリックすれば書き直せる。
 *
 * 数値と表示文字列の導出は `lib/logic/weeklyReview.ts`。ここは DOM とハンドラだけ。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { dowOf } from '../../lib/logic/dates';
import { buildWeeklyReport, setWeekNote } from '../../lib/logic/weeklyReview';
import type { AppState, ISODate, Plans } from '../../lib/model/types';
import { store } from '../useStore';

/**
 * カードの外枠。データ画面・ToDo のカードと同じ流儀（`--bg1` + 1px 罫 + `--rad`）。
 *
 * 外側の余白は**カード自身が持つ**。`.cockpit-grid` は `padding:0`（globals.css）で
 * コマ帯を全幅に敷く作りなので、Cockpit 側に余白用の入れ物を置くと、
 * カードを出さない日（月曜以外）にその入れ物だけが空の隙間として残る。
 * 左右 16px はパネルの本文（`.cockpit-panel` の `padding:0 16px`）と揃えている。
 */
const CARD: CSSProperties = {
  margin: '12px 16px 4px',
  background: 'var(--bg1)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad)',
  padding: '13px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

/** 数字タイル。データ画面の集中モード実測タイルと同じ作り */
const TILE: CSSProperties = {
  flex: 1,
  minWidth: '108px',
  padding: '9px 12px',
  background: 'var(--bg2)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad-s)',
};

const TILE_TITLE: CSSProperties = { fontSize: '10px', color: 'var(--tx3)' };
const TILE_UNIT: CSSProperties = { fontSize: '12px', color: 'var(--tx2)', marginLeft: '1px' };
const TILE_NOTE: CSSProperties = { fontSize: '10px', color: 'var(--tx3)', marginTop: '1px' };

/** ✕。見出し行の右端。押しても消えるのは表示だけなので、色は付けない */
const CLOSE_BTN: CSSProperties = {
  flex: 'none',
  width: '22px',
  height: '22px',
  padding: 0,
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad-s)',
  background: 'transparent',
  color: 'var(--tx3)',
  font: "400 11px var(--f-ui)",
  lineHeight: 1,
  cursor: 'pointer',
};

const TEXTAREA: CSSProperties = {
  width: '100%',
  minHeight: '64px',
  padding: '9px 11px',
  background: 'var(--bg2)',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  color: 'var(--tx1)',
  font: "400 13px var(--f-ui)",
  lineHeight: 1.8,
  outline: 'none',
  resize: 'vertical',
};

export interface WeeklyReviewCardProps {
  state: AppState;
  plans: Plans;
  today: ISODate;
}

export function WeeklyReviewCard({ state, plans, today }: WeeklyReviewCardProps) {
  const isMonday = dowOf(today) === '月';
  // フックは条件の前に置く（月曜以外は集計そのものを組まない）
  const report = useMemo(
    () =>
      isMonday
        ? buildWeeklyReport(
            {
              studyLog: state.studyLog,
              segs: state.segs,
              extras: state.extras,
              reviews: state.reviews,
              missions: state.missions,
              focusLog: state.focusLog,
            },
            plans,
            today
          )
        : null,
    [
      isMonday,
      state.studyLog,
      state.segs,
      state.extras,
      state.reviews,
      state.missions,
      state.focusLog,
      plans,
      today,
    ]
  );
  /**
   * 「いま書いている週」。開いた / 畳んだを**保存された文の有無だけ**から決めると、
   * 1 文字目を打った瞬間に（＝非空になった瞬間に）入力欄が畳まれてしまう。
   * かといってマウント時のスナップショットで決めると、`compass-ui-data` の復元が
   * マウントより後に走る都合で、書いてある週でも再読込のたびに開いた状態から始まる。
   * 「書いてある」に加えて「この週を今いじっているか」を持つと、どちらも起きない。
   */
  const [editing, setEditing] = useState<ISODate | null>(null);

  if (!isMonday || !report || state.weekReviewHidden) return null;

  const text = state.weekNotes[report.start] || '';
  const written = text.trim() !== '';
  if (!report.hasRecord && !written) return null;

  const open = !written || editing === report.start;

  const onChange = (value: string) => {
    // 打ち始めた時点で「この週をいじっている」に入る（1 文字目で畳まれないように）
    setEditing(report.start);
    store.setState((s) => ({ weekNotes: setWeekNote(s.weekNotes, report.start, value) }));
  };

  const heading = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          width: '8px',
          height: '8px',
          flex: 'none',
          borderRadius: 'var(--rad-s)',
          background: 'var(--vio)',
        }}
      />
      <span style={{ font: "700 13px var(--f-disp)", letterSpacing: '.05em', color: 'var(--tx0)' }}>
        先週のふりかえり
      </span>
      <span style={{ font: "600 11.5px var(--f-num)", color: 'var(--tx3)' }}>
        {report.rangeLabel}
      </span>
      <button
        type="button"
        onClick={() => store.setState({ weekReviewHidden: true })}
        title="今日はこのカードを閉じる"
        style={{ ...CLOSE_BTN, marginLeft: 'auto' }}
      >
        ✕
      </button>
    </div>
  );

  // ── 書いてある週は 1 行に畳む。クリックで書き直しに戻る
  if (written && !open) {
    return (
      <div className="weekly-review weekly-review--done" style={CARD}>
        {heading}
        <div
          onClick={() => setEditing(report.start)}
          title="クリックすると書き直せます"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer' }}
        >
          <div
            style={{
              font: "600 11.5px var(--f-num)",
              color: 'var(--tx2)',
              letterSpacing: '.02em',
            }}
          >
            {report.compactLabel}
          </div>
          <div
            style={{
              font: "400 12.5px/1.7 var(--f-ui)",
              color: 'var(--tx1)',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}
          >
            {text}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="weekly-review" style={CARD}>
      {heading}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {report.stats.map((s) => (
          <div key={s.key} style={TILE}>
            <div style={TILE_TITLE}>{s.title}</div>
            <div style={{ font: "700 19px var(--f-num)", color: 'var(--tx0)', lineHeight: 1.2 }}>
              {s.value}
              {s.unit ? <span style={TILE_UNIT}>{s.unit}</span> : null}
            </div>
            <div style={TILE_NOTE}>{s.note}</div>
          </div>
        ))}
      </div>
      <textarea
        className="fc-acc"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="先週の勉強はどうだった？ よかったこと・直すことを自分の言葉で"
        style={TEXTAREA}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: '140px', fontSize: '10.5px', color: 'var(--tx3)' }}>
          書いた内容はデータ画面の「ふりかえりの記録」に残ります
        </span>
        {written ? (
          <button
            type="button"
            onClick={() => setEditing(null)}
            style={{
              marginLeft: 'auto',
              flex: 'none',
              padding: '5px 13px',
              border: 'none',
              borderRadius: 'var(--rad-s)',
              background: 'var(--grn)',
              color: 'var(--onAcc)',
              font: "700 11px var(--f-ui)",
              cursor: 'pointer',
            }}
          >
            書けた
          </button>
        ) : null}
      </div>
    </div>
  );
}
