'use client';

/**
 * Compass — テスト前ブースト / 成績からの提案（docs/daily-mission/plan.md §4.2）
 *
 * 今日の ToDo の右カラム最上部に置く小さなカード。**対象があるときだけ**出る。
 * テストも近くなく成績も落ちていない日は 1px も描かない（毎日出る枠は、毎日読み飛ばされる）。
 *
 * ## 2 つを 1 枚に同居させる理由
 *
 * どちらも言っていることは同じ形 ――「この教科を、今日、優先しよう」―― で、行き先も
 * 同じ 2 つ（今日の ToDo / 弱点ドリル）。別々のカードに割ると、右カラムに同じ見た目の枠が
 * 2 つ並んで「今日なにを優先するか」が 2 か所に散る。見出しだけ分けて 1 枚に積む。
 *
 * ## 押しても復習の予定は動かない
 *
 * 「復習を今日へ」は `canAddToToday` と同じ母集団を今日の ToDo に積むだけで、`due` も
 * `stage` も書き換えない（`logic/testBoost.ts` 冒頭の設計判断）。ボタンを押した結果として
 * 間隔反復のはしごが変わることは無い。
 */

import { dayLabel } from '../../lib/logic/dates';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import {
  addReviewsToToday,
  boostReviewIds,
  daysLeftLabel,
  lowScoreSubjects,
  upcomingTests,
} from '../../lib/logic/testBoost';
import type { AppState, ISODate, Plans } from '../../lib/model/types';
import { dateCtx, store } from '../useStore';
import { openWeakDrill } from './ShellActions';

/** 成績からの提案を出す上限。3 つ 4 つ並べると「全部やらないと」になって手が止まる */
const LOW_SCORE_LIMIT = 2;

/** 「弱点をやる」。ToDo カードの行き先ボタン（Todo.tsx の `CARD_GO_BTN`）と同じ見た目 */
const GO_BTN = {
  padding: '4px 10px',
  border: '1px solid var(--ink)',
  borderRadius: 'var(--rad-s)',
  background: 'var(--inkBg)',
  color: 'var(--ink)',
  font: "700 10.5px var(--f-ui)",
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const;

/** 「復習を今日へ」。Review 画面の「＋ 今日へ」と同じ緑（＝今日へ積む操作の色） */
const ADD_BTN = {
  padding: '4px 10px',
  border: 'none',
  borderRadius: 'var(--rad-s)',
  background: 'var(--grn)',
  color: 'var(--onAcc)',
  font: "700 10.5px var(--f-ui)",
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const;

const SECTION_LABEL = {
  font: "700 10px var(--f-ui)",
  color: 'var(--tx3)',
  letterSpacing: '.04em',
} as const;

export interface TodoBoostCardProps {
  state: AppState;
  plans: Plans;
  subjColors: SubjColors;
  today: ISODate;
}

export function TodoBoostCard({ state, plans, subjColors, today }: TodoBoostCardProps) {
  const tests = upcomingTests(plans, today).map((t) => ({
    test: t,
    ids: boostReviewIds(state.reviews, t.subj, t.due, today),
  }));
  // テストが近い教科は上の段で既に「弱点をやる」を出しているので、下の段には重ねない
  const testSubjs = tests.map((t) => t.test.subj);
  const lows = lowScoreSubjects(state.scores, today)
    .filter((row) => testSubjs.indexOf(row.subj) < 0)
    .slice(0, LOW_SCORE_LIMIT);

  if (!tests.length && !lows.length) return null;

  /** その教科の「今日へ積める復習」をまとめて今日の ToDo へ（押下時に数え直す） */
  const boost = (subj: string, due: ISODate) => {
    const s = store.getState();
    const res = addReviewsToToday(
      s.reviews,
      s.order,
      boostReviewIds(s.reviews, subj, due, today),
    );
    if (res.message == null) return;
    store.setState({ reviews: res.reviews, order: res.order });
    store.showToast(res.message);
  };

  return (
    <div
      className="todo-boost"
      style={{
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--rad)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
      }}
    >
      {tests.length ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={SECTION_LABEL}>テスト前ブースト</span>
            <span style={{ flex: 1, borderTop: '1px solid var(--line)' }} />
          </div>
          {tests.map(({ test, ids }) => {
            const sub = subjectColorFor(subjColors, test.subj);
            return (
              <div
                key={test.id}
                title={'テスト日: ' + dayLabel(dateCtx, test.due)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  padding: '9px 10px',
                  background: 'color-mix(in srgb, ' + sub.c + ' 7%, var(--bg2))',
                  borderTop: '1px solid var(--line)',
                  borderRight: '1px solid var(--line)',
                  borderBottom: '1px solid var(--line)',
                  borderLeft: '3px solid ' + sub.c,
                  borderRadius: 'var(--rad-s)',
                }}
              >
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: sub.c,
                    background: sub.bg,
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 8px',
                    flex: 'none',
                  }}
                >
                  {test.subj}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: '80px',
                    font: "700 12px var(--f-ui)",
                    color: 'var(--tx0)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {test.label}
                </span>
                <span
                  style={{
                    font: "700 10.5px var(--f-ui)",
                    color: test.daysLeft <= 1 ? 'var(--pink)' : sub.c,
                    flex: 'none',
                  }}
                >
                  {/* 「まで明日」は日本語として崩れるので接頭辞は付けない。
                      いつのテストかは行の `title`（テスト日）で補う */}
                  {daysLeftLabel(test.daysLeft)}
                </span>
                {ids.length ? (
                  <button onClick={() => boost(test.subj, test.due)} style={ADD_BTN}>
                    {'復習を今日へ(' + ids.length + '件)'}
                  </button>
                ) : null}
                <button onClick={() => openWeakDrill(store, test.subj)} style={GO_BTN}>
                  弱点をやる
                </button>
              </div>
            );
          })}
        </>
      ) : null}

      {lows.length ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={SECTION_LABEL}>成績からの提案</span>
            <span style={{ flex: 1, borderTop: '1px solid var(--line)' }} />
          </div>
          {lows.map((row) => {
            const sub = subjectColorFor(subjColors, row.subj);
            return (
              <div
                key={row.subj}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  padding: '8px 10px',
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--rad-s)',
                }}
              >
                <span
                  style={{
                    font: "700 10px var(--f-ui)",
                    color: sub.c,
                    background: sub.bg,
                    borderRadius: 'var(--rad-s)',
                    padding: '2px 8px',
                    flex: 'none',
                  }}
                >
                  {row.subj}
                </span>
                <span style={{ flex: 1, minWidth: '110px', fontSize: '11.5px', color: 'var(--tx2)' }}>
                  {'直近の' + row.subj + 'は平均'}
                  <b style={{ font: "700 12.5px var(--f-num)", color: 'var(--pink)' }}>
                    {row.avgLabel}
                  </b>
                  点
                </span>
                <button onClick={() => openWeakDrill(store, row.subj)} style={GO_BTN}>
                  弱点をやる
                </button>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
