'use client';

/**
 * Compass — データ画面（Phase 2B / TASK S5）
 *
 * 移植元:
 *  - テンプレート HTML:1236-1331（`sc-if isData` の `[data-screen-label="Data"]` 配下）
 *  - 期間チップ / ストリーク / ヒートマップ HTML:3384-3448・4309-4314
 *  - 円グラフ HTML:3379-3413・4308
 *  - テスト結果 HTML:3449-3504・4315・4328-4338
 *  - エクスポート HTML:3506-3532・4316
 *  - 点数推移ドロワー → `parts/DataScoreDrawer`
 *  - spec §8（§8.0〜§8.7）/ C-412〜C-455・C-538〜C-563
 *
 * **数値と文字列の導出は `lib/logic/aggregate.ts` / `lib/logic/export.ts` にある**（再実装しない）。
 * このファイルは「テンプレートの DOM」と「renderVals のハンドラ」だけを持つ。
 *
 * v0.9 の DOM 順（spec §8 の表）:
 *  1. 期間チップ + 期間ラベル + ストリークピル（`grid-column:1/-1`）
 *  2. 左カラムラッパ（教科別 勉強時間 → 日別の学習量）
 *  3. テスト結果カード
 *  4. エクスポートカード（`grid-column:1/-1`）
 *
 * レガシーに無い追加（docs/daily-mission/plan.md §4.3）は左カラムの続きに置く:
 * デイリーミッションの継続カレンダー → 集中モードの実測。どちらも「日別の学習量」と
 * 同じ「続いているか」を見るための枠なので、ヒートマップの下に並べるのが自然。
 *
 * `[data-screen-label="Data"]>div` の mobile ルール（globals.css 553）が直下の子を
 * `<div>` 前提にしているので、直下は必ず `<div>` にすること（css-notes §7）。
 */

import { useMemo, type CSSProperties, type ChangeEvent } from 'react';
import { DATA_RANGE_CHIPS, aggregateData } from '../../lib/logic/aggregate';
import { fmtMD } from '../../lib/logic/dates';
import {
  EXPORT_TOAST,
  buildBackupJson,
  buildStudyCsv,
  sortScoresByDay,
} from '../../lib/logic/export';
import { focusTotals } from '../../lib/logic/focusLog';
import {
  MISSION_CALENDAR_WEEKS,
  buildMissionStats,
  type MissionDayState,
} from '../../lib/logic/missionStats';
import { orderedPlanIds } from '../../lib/logic/schedule';
import { orderedSubjectNames, subjectColorFor } from '../../lib/logic/subjects';
import type { Score } from '../../lib/model/types';
import { downloadText } from '../parts/DataDownload';
import { DataScoreDrawer } from '../parts/DataScoreDrawer';
import { ShellOverlay } from '../parts/ShellOverlay';
import { useSubjColors } from '../parts/ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/** カード共通の外枠（HTML:1248 / 1273 / 1294 / 1322 で同一） */
const cardStyle: CSSProperties = {
  background: 'var(--bg1)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad)',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  height: 'fit-content',
};

/** 見出しの丸ドット（色と glow はカードごとに差し替える） */
const dotStyle = (background: string, boxShadow: string): CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: 'var(--rad-s)',
  background,
  boxShadow,
});

const headingTextStyle: CSSProperties = {
  font: "700 14px var(--f-ui)",
  color: 'var(--tx0)',
};

const headingMetaStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: '11px',
  color: 'var(--tx3)',
};

const footnoteStyle: CSSProperties = { fontSize: '11px', color: 'var(--tx3)' };

/** ミニカレンダー 1 マスの一辺（px）。ヒートマップの `HEAT.CELL` と同じ大きさに揃える */
const MISSION_CELL = 12;

/**
 * ミニカレンダー 1 マスの色。
 *
 * 色を持つのは「やった（教科色）」と「実施日なのに落とした（薄い赤）」だけ。
 * 28 マス × ミッション件数が並ぶので、5 状態すべてに色を割ると模様になって
 * *続いているか* が読めなくなる。予定の無い日は空白のままにする。
 */
function missionCellFill(state: MissionDayState, subjColor: string): string {
  if (state === 'done') return subjColor;
  if (state === 'missed') return 'color-mix(in srgb, var(--pink) 26%, transparent)';
  if (state === 'off') return 'color-mix(in srgb, var(--tx3) 10%, transparent)';
  return 'transparent';
}

/** 実測タイルの外枠（Review 画面の統計カードと同じ作り。カードの中なので `--bg2`） */
const focusTileStyle: CSSProperties = {
  flex: 1,
  minWidth: '112px',
  padding: '10px 13px',
  background: 'var(--bg2)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--rad-s)',
};

/** テスト記録フォームの入力欄（HTML:1312 / 1314 / 1316 が共通で持つ宣言） */
const fieldStyle: CSSProperties = {
  padding: '9px 11px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'var(--bg2)',
  color: 'var(--tx0)',
  outline: 'none',
};

export function DataScreen() {
  const { state, plans } = useAppStore();
  const S = state;
  const T = dateCtx.today;
  const subjColors = useSubjColors(state, plans);

  // ── 集計（HTML:3379-3448）。期間フィルタが掛かるのは円グラフと凡例だけ（C-543）
  const agg = useMemo(() => aggregateData(S, plans, T), [S, plans, T]);
  const { pie, streak, heatmap } = agg;

  // ── ミッションの継続（plan.md §4.3）。台帳の並び順のまま、直近4週ぶんを 1 行 1 ミッション
  const missionStats = useMemo(
    () => buildMissionStats(S.missions, S.extras, T),
    [S.missions, S.extras, T]
  );
  // ── 集中モードの実測（plan.md §4.3）。**学習時間には合流させない**独立した記録
  const focus = useMemo(() => focusTotals(S.focusLog, T), [S.focusLog, T]);

  // ── アクティブな計画（HTML:2730-2735）。テスト名候補と教科の自動補完に使う
  // 式は lib/logic/schedule.ts の orderedPlanIds に一本化してある（TASK I0）
  const planIds = useMemo(
    () => orderedPlanIds({ segs: S.segs, planOrder: S.planOrder }, plans, T),
    [plans, S.segs, S.planOrder, T]
  );

  // ── テスト結果のグループ化（HTML:3450-3466）
  const scoreSorted = useMemo(() => sortScoresByDay(S.scores), [S.scores]);
  const scGroupMap = useMemo(() => {
    const map: Record<string, Score[]> = {};
    scoreSorted.forEach((sc) => {
      (map[sc.name] = map[sc.name] || []).push(sc);
    });
    return map;
  }, [scoreSorted]);

  const scoreGroups = Object.keys(scGroupMap)
    .map((name) => {
      const arr = scGroupMap[name];
      const last = arr[arr.length - 1];
      const prev = arr.length > 1 ? arr[arr.length - 2] : null;
      const dv = prev ? last.score - prev.score : null;
      // ★ 色は「最新レコードの教科」（C-429）
      const sub = subjectColorFor(subjColors, last.subj);
      return {
        name,
        subj: last.subj,
        c: sub.c,
        bg: sub.bg,
        n: arr.length + '回',
        latest: last.score,
        lastDay: fmtMD(last.day),
        delta: dv == null ? '–' : dv > 0 ? '▲ +' + dv : dv < 0 ? '▼ ' + dv : '± 0',
        deltaC:
          dv == null
            ? 'var(--tx3)'
            : dv > 0
              ? 'var(--grn)'
              : dv < 0
                ? 'var(--pink)'
                : 'var(--tx3)',
        _day: last.day,
        onOpen: () => store.setState({ scoreSel: name }),
      };
    })
    // 最新テストが上（HTML:3466 の非対称比較子をそのまま維持）
    .sort((a, b) => (a._day < b._day ? 1 : -1));

  // ドロワー（HTML:3468-3469）。`scOpen` は「選択グループが1件以上ある」が唯一の条件
  const scArr = S.scoreSel ? scGroupMap[S.scoreSel] || [] : [];
  const scOpen = scArr.length > 0;

  // ── テスト名候補（HTML:3493-3495 / C-433）
  const scoreNameOptions: string[] = [];
  planIds.forEach((pid) => {
    const p = plans[pid];
    if (p.type === 'test' && scoreNameOptions.indexOf(p.name) < 0) scoreNameOptions.push(p.name);
  });
  S.scores.forEach((sc) => {
    if (scoreNameOptions.indexOf(sc.name) < 0) scoreNameOptions.push(sc.name);
  });

  // ── 教科候補（HTML:3538-3541 の `addSubjOptions`。Add 画面と同じ並び, C-435）
  // 並びは lib/logic/subjects.ts の orderedSubjectNames に一本化（TASK I0）
  const addSubjOptions = orderedSubjectNames(Object.keys(subjColors), S.recentSubjs);

  // ── ハンドラ（HTML:3496-3504, 4330-4338）
  const onScoreName = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    // 種類は問わない（prep でも一致すれば拾う, HTML:4332）
    const pl = planIds.map((id) => plans[id]).find((p) => p.name === v);
    store.setState((s) => ({ scoreName: v, scoreSubj: pl ? pl.subj : s.scoreSubj }));
  };
  const onScoreSubj = (e: ChangeEvent<HTMLInputElement>) =>
    store.setState({ scoreSubj: e.target.value });
  const onScoreVal = (e: ChangeEvent<HTMLInputElement>) =>
    store.setState({ scoreVal: e.target.value });
  const onScoreDay = (e: ChangeEvent<HTMLInputElement>) =>
    store.setState({ scoreDay: e.target.value });

  const addScore = () => {
    const n = (S.scoreName || '').trim();
    const sj = (S.scoreSubj || '').trim();
    const v = parseInt(S.scoreVal, 10);
    if (!n || !sj || Number.isNaN(v)) {
      store.showToast('テスト名・教科・点数を入力してください');
      return;
    }
    const scv = Math.max(0, Math.min(100, v));
    // レガシーの `this.subjOf(sj)`（HTML:3501）は SUBJ への先行登録。移植版では
    // `buildSubjColors` が `state.scoreSubj` を採番順に含むので追加の処理は要らない
    store.setState((s) => ({
      scores: s.scores.concat([
        {
          id: 'sc' + Date.now().toString(36) + Math.floor(Math.random() * 99),
          name: n,
          subj: sj,
          day: s.scoreDay || T,
          score: scv,
        },
      ]),
      scoreName: '',
      scoreVal: '',
    }));
    store.showToast('「' + n + '」' + scv + '点を記録しました');
  };

  // ── エクスポート（HTML:3506-3532 / C-556〜C-562）。state は一切変更しない
  const exportJson = () => {
    const file = buildBackupJson(store.exportData(), T);
    const ok = downloadText(file.filename, file.mime, file.content);
    store.showToast(ok ? EXPORT_TOAST.json : EXPORT_TOAST.fail);
  };
  const exportCsv = () => {
    // 学習ログの集計元は円グラフと同じ `studyEntries`（期間チップの絞り込みは掛からない, C-559）
    const file = buildStudyCsv(agg.entries, S.scores, T);
    const ok = downloadText(file.filename, file.mime, file.content);
    store.showToast(ok ? EXPORT_TOAST.csv : EXPORT_TOAST.fail);
  };

  const schemeVal = S.theme === 'light' ? 'light' : 'dark';

  return (
    <>
      <div
        data-screen-label="Data"
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(320px,2fr) minmax(430px,3fr)',
          gap: '16px',
          padding: '18px 20px',
          alignContent: 'start',
          animation: 'fadeUp .22s ease',
        }}
      >
        {/* ── 期間チップ + 期間ラベル + ストリーク（HTML:1238-1246 / C-538） */}
        <div
          style={{
            gridColumn: '1/-1',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              background: 'var(--bg1)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad-s)',
              padding: '2px',
            }}
          >
            {DATA_RANGE_CHIPS.map((m) => (
              <span
                key={m.id}
                onClick={() => store.setState({ dataRange: m.id })}
                style={{
                  font: "700 11px var(--f-ui)",
                  color: agg.range === m.id ? 'var(--onAcc)' : 'var(--tx2)',
                  background: agg.range === m.id ? 'var(--acc)' : 'transparent',
                  borderRadius: 'var(--rad-s)',
                  padding: '6px 15px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <span
            style={{ fontSize: '10.5px', color: 'var(--tx3)', fontFamily: "var(--f-num)" }}
          >
            {agg.rangeNote}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              background: 'var(--bg1)',
              border: '1px solid ' + streak.border,
              borderRadius: 'var(--rad-s)',
              font: "700 12px var(--f-ui)",
              color: streak.color,
              whiteSpace: 'nowrap',
            }}
          >
            {streak.label}
          </span>
        </div>

        {/* ── 左カラム（HTML:1247-1293） */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minWidth: 0,
            height: 'fit-content',
          }}
        >
          {/* カード1: 教科別 勉強時間（HTML:1248-1272 / C-413〜C-422） */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={dotStyle('var(--acc)', 'var(--gAcc)')} />
              <span style={headingTextStyle}>教科別 勉強時間</span>
              <span style={headingMetaStyle}>学習ログ+完了タスク</span>
            </div>
            <div
              style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}
            >
              <div
                style={{ position: 'relative', width: '172px', height: '172px', flex: 'none' }}
              >
                {/* r=15.9 → 円周 ≒ 100 なので dasharray の単位＝% として扱う（spec Q34 / C-414） */}
                <svg width="172" height="172" viewBox="0 0 42 42">
                  <circle
                    cx="21"
                    cy="21"
                    r="15.9"
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth="7"
                  />
                  {pie.slices.map((a) => (
                    <circle
                      key={a.name}
                      cx="21"
                      cy="21"
                      r="15.9"
                      fill="none"
                      stroke={subjectColorFor(subjColors, a.name).c}
                      strokeWidth="7"
                      strokeDasharray={a.dash}
                      strokeDashoffset={a.off}
                    />
                  ))}
                </svg>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      font: "700 22px var(--f-num)",
                      color: 'var(--tx0)',
                      lineHeight: 1,
                    }}
                  >
                    {pie.totalH}
                  </span>
                  <span
                    style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '3px' }}
                  >
                    合計
                  </span>
                </div>
              </div>
              {/* 凡例。0件のときの空状態テキストは存在しない（C-422） */}
              <div
                style={{
                  flex: 1,
                  minWidth: '150px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px',
                }}
              >
                {pie.slices.map((l) => (
                  <div
                    key={l.name}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <span
                      style={{
                        width: '9px',
                        height: '9px',
                        borderRadius: 'var(--rad-s)',
                        background: subjectColorFor(subjColors, l.name).c,
                        flex: 'none',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        font: "500 12px var(--f-ui)",
                        color: 'var(--tx1)',
                      }}
                    >
                      {l.name}
                    </span>
                    <span style={{ font: "700 12px var(--f-num)", color: 'var(--tx0)' }}>
                      {l.h}
                    </span>
                    <span
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--tx3)',
                        width: '34px',
                        textAlign: 'right',
                      }}
                    >
                      {l.pctLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={footnoteStyle}>タスクや復習を完了すると、その分数が自動で加算されます</div>
          </div>

          {/* カード2: 日別の学習量（HTML:1273-1292 / C-549〜C-555） */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={dotStyle('var(--org)', 'none')} />
              <span style={headingTextStyle}>日別の学習量</span>
              <span style={headingMetaStyle}>直近15週</span>
            </div>
            <svg
              viewBox={heatmap.viewBox}
              style={{ width: '100%', maxWidth: '520px', height: 'auto' }}
            >
              {heatmap.months.map((m) => (
                <text
                  key={m.x}
                  x={m.x}
                  y="8"
                  style={{ font: "700 7.5px var(--f-num)", fill: 'var(--tx3)' }}
                >
                  {m.label}
                </text>
              ))}
              {heatmap.dows.map((d) => (
                <text
                  key={d.label}
                  x="0"
                  y={d.y}
                  style={{ font: "8px var(--f-ui)", fill: 'var(--tx3)' }}
                >
                  {d.label}
                </text>
              ))}
              {/* ツールチップはブラウザ標準の `<title>`。JS ハンドラは 0 個（C-552） */}
              {heatmap.cells.map((c) => (
                <rect
                  key={c.iso}
                  x={c.x}
                  y={c.y}
                  width="12"
                  height="12"
                  rx="1"
                  fill={c.fill}
                >
                  <title>{c.tip}</title>
                </rect>
              ))}
            </svg>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10px',
                color: 'var(--tx3)',
              }}
            >
              <span>少</span>
              {heatmap.legend.map((fill, i) => (
                <span
                  key={i}
                  style={{
                    width: '11px',
                    height: '11px',
                    borderRadius: 'var(--rad-s)',
                    background: fill,
                    flex: 'none',
                  }}
                />
              ))}
              <span>多</span>
              <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                マスにカーソルを合わせるとその日の分数が出ます
              </span>
            </div>
          </div>

          {/* ── カード（追加）: デイリーミッションの継続（plan.md §4.3）。
              台帳が空なら**カードごと出さない**（まだ使っていない機能の空箱を置かない） */}
          {missionStats.length ? (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={dotStyle('var(--grn)', 'var(--gGrn)')} />
                <span style={headingTextStyle}>デイリーミッション</span>
                <span style={headingMetaStyle}>{'直近' + MISSION_CALENDAR_WEEKS + '週'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {missionStats.map((row) => {
                  const sub = subjectColorFor(subjColors, row.mission.subj);
                  return (
                    <div
                      key={row.mission.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        // 一時停止中のミッションは薄く（台帳一覧 `AddTask` と同じ扱い）
                        opacity: row.mission.active ? 1 : 0.55,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            font: "600 12.5px var(--f-ui)",
                            color: 'var(--tx0)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {row.mission.title}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '7px',
                            marginTop: '4px',
                            fontSize: '10.5px',
                            color: 'var(--tx3)',
                          }}
                        >
                          <span
                            style={{
                              font: "700 10px var(--f-ui)",
                              color: sub.c,
                              background: sub.bg,
                              borderRadius: 'var(--rad-s)',
                              padding: '2px 7px',
                              flex: 'none',
                            }}
                          >
                            {row.mission.subj}
                          </span>
                          <span style={{ fontFamily: "var(--f-num)" }}>
                            {'達成 ' + row.rateLabel}
                          </span>
                          {/* 1 日目は「連続」ではないので出さない（ToDo カードと同じ閾値） */}
                          {row.streak >= 2 ? (
                            <span style={{ font: "700 10.5px var(--f-num)", color: 'var(--org)' }}>
                              {'🔥' + row.streak}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {/* 28 マス。行＝週（上が古い）、列＝月〜日。ツールチップは
                          ヒートマップと同じくブラウザ標準（JS ハンドラは付けない） */}
                      <div
                        style={{
                          flex: 'none',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(7, ' + MISSION_CELL + 'px)',
                          gap: '3px',
                        }}
                      >
                        {row.calendar.weeks.map((week) =>
                          week.map((cell) => (
                            <span
                              key={cell.iso}
                              title={cell.tip}
                              style={{
                                width: MISSION_CELL + 'px',
                                height: MISSION_CELL + 'px',
                                borderRadius: '1px',
                                background: missionCellFill(cell.state, sub.c),
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 改行で余計な空白が入らないよう、文言は 1 本の文字列で渡す */}
              <div style={footnoteStyle}>
                {'教科色のマスができた日 · 赤いマスは実施曜日なのにやらなかった日 · 今日はまだ達成率に数えません'}
              </div>
            </div>
          ) : null}

          {/* ── カード（追加）: 集中モードの実測（plan.md §4.3）。
              見積り（学習時間）とは別の物差しなので、円グラフには混ぜず独立した枠に出す */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* 集中モードのタイマー環と同じ差し色（`TodoFocusOverlay`）。glow は付けない */}
              <span style={dotStyle('var(--acc)', 'none')} />
              <span style={headingTextStyle}>集中モード実測</span>
              <span style={headingMetaStyle}>{focus.count + 'セッション'}</span>
            </div>
            <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
              <div style={focusTileStyle}>
                <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>今週（月〜日）</div>
                <div style={{ font: "700 20px var(--f-num)", color: 'var(--tx0)' }}>
                  {focus.week}
                  <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>分</span>
                </div>
              </div>
              <div style={focusTileStyle}>
                <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>全期間</div>
                <div style={{ font: "700 20px var(--f-num)", color: 'var(--tx0)' }}>
                  {focus.all}
                  <span style={{ fontSize: '12px', color: 'var(--tx2)' }}>分</span>
                </div>
              </div>
            </div>
            <div style={footnoteStyle}>
              {'タイマーを回した時間そのものです · 上の学習時間（完了タスクの見積り）とは別に数えるので、二重には足されません'}
            </div>
          </div>
        </div>

        {/* ── カード3: テスト結果（HTML:1294-1321 / C-425〜C-441） */}
        <div style={cardStyle}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
          >
            <span style={dotStyle('var(--vio)', 'var(--gVio)')} />
            <span style={headingTextStyle}>テスト結果</span>
            <span style={headingMetaStyle}>クリックで推移を表示</span>
          </div>
          {scoreGroups.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {scoreGroups.map((g) => (
                // 直下 6 つの span の順序がモバイル grid 配置の前提（css-notes §3.2）
                <div
                  key={g.name}
                  className="score-group-row hv-bg3-line2"
                  onClick={g.onOpen}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    padding: '10px 12px',
                    background: 'var(--bg2)',
                    // shorthand + longhand の混在を避けて辺ごとに書く（計算値は同一）
                    borderTop: '1px solid var(--line)',
                    borderRight: '1px solid var(--line)',
                    borderBottom: '1px solid var(--line)',
                    borderLeft: '3px solid ' + g.c,
                    borderRadius: 'var(--rad-s)',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    className="sg-cell-subj"
                    style={{
                      font: "700 10px var(--f-ui)",
                      color: g.c,
                      background: g.bg,
                      borderRadius: 'var(--rad-s)',
                      padding: '2px 8px',
                      flex: 'none',
                    }}
                  >
                    {g.subj}
                  </span>
                  <span
                    className="sg-cell-name"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "500 13px var(--f-ui)",
                      color: 'var(--tx0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {g.name}
                  </span>
                  <span
                    className="sg-cell-meta"
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--tx3)',
                      fontFamily: "var(--f-num)",
                      flex: 'none',
                    }}
                  >
                    {g.n} · 最新 {g.lastDay}
                  </span>
                  <span
                    className="sg-cell-delta"
                    style={{
                      font: "700 11px var(--f-num)",
                      color: g.deltaC,
                      flex: 'none',
                    }}
                  >
                    {g.delta}
                  </span>
                  <span
                    className="sg-cell-score"
                    style={{ font: "700 16px var(--f-num)", color: g.c, flex: 'none' }}
                  >
                    {g.latest}
                    <span style={{ fontSize: '10px' }}>点</span>
                  </span>
                  <span
                    className="sg-cell-arrow"
                    style={{ color: 'var(--tx3)', fontSize: '12px', flex: 'none' }}
                  >
                    →
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {scoreGroups.length === 0 ? (
            <div style={{ fontSize: '11.5px', color: 'var(--tx3)', padding: '6px 2px' }}>
              まだ記録がありません。返却されたテストの点数を下から記録しましょう
            </div>
          ) : null}
          {/* 入力行は常に表示（HTML:1311-1319） */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'center',
              borderTop: '1px solid var(--line)',
              paddingTop: '12px',
            }}
          >
            <input
              className="fc-acc"
              list="compass-score-names"
              value={S.scoreName}
              onChange={onScoreName}
              placeholder="テスト名"
              style={{
                ...fieldStyle,
                flex: 2,
                minWidth: '150px',
                font: "500 12.5px var(--f-ui)",
              }}
            />
            <datalist id="compass-score-names">
              {scoreNameOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <input
              className="fc-acc"
              list="compass-subj-list2"
              value={S.scoreSubj}
              onChange={onScoreSubj}
              placeholder="教科"
              style={{
                ...fieldStyle,
                flex: 1,
                minWidth: '90px',
                font: "500 12.5px var(--f-ui)",
              }}
            />
            <datalist id="compass-subj-list2">
              {addSubjOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <input
              className="fc-acc"
              type="number"
              min="0"
              max="100"
              value={S.scoreVal}
              onChange={onScoreVal}
              placeholder="点数"
              style={{ ...fieldStyle, width: '78px', font: "500 12.5px var(--f-num)" }}
            />
            <input
              className="fc-acc"
              type="date"
              value={S.scoreDay}
              max={T}
              onChange={onScoreDay}
              style={{
                width: '150px',
                padding: '8px 10px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx0)',
                font: "500 12px var(--f-num)",
                outline: 'none',
                colorScheme: schemeVal,
              }}
            />
            {/* Enter キーのハンドラは無い（ボタンのみ, C-439） */}
            <button
              type="button"
              onClick={addScore}
              style={{
                padding: '9px 16px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 12px var(--f-ui)",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flex: 'none',
              }}
            >
              ＋ 記録
            </button>
          </div>
          <div style={footnoteStyle}>
            テスト名はTestsで作った計画から選べます · 同じテスト名で記録すると推移がつながります
          </div>
        </div>

        {/* ── カード4: エクスポート（HTML:1322-1329 / C-556） */}
        <div style={{ ...cardStyle, gridColumn: '1/-1' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
          >
            <span style={dotStyle('var(--tx3)', 'none')} />
            <span style={headingTextStyle}>エクスポート</span>
            <span style={headingMetaStyle}>全期間・全件</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="hv-acc-outline"
              onClick={exportJson}
              style={{
                padding: '9px 16px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                font: "700 12px var(--f-ui)",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              JSONをダウンロード
            </button>
            <button
              type="button"
              className="hv-acc-outline"
              onClick={exportCsv}
              style={{
                padding: '9px 16px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx1)',
                font: "700 12px var(--f-ui)",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              CSVをダウンロード
            </button>
          </div>
          <div style={footnoteStyle}>機種変更やバックアップに。読み込みは未対応です</div>
        </div>
      </div>

      {/* 点数推移ドロワーは `.compass-shell` の外（`.compass-theme-mode` 直下）へ出す */}
      <ShellOverlay>
        {scOpen ? (
          <DataScoreDrawer
            state={S}
            store={store}
            ctx={dateCtx}
            subjColors={subjColors}
            scArr={scArr}
          />
        ) : null}
      </ShellOverlay>
    </>
  );
}
