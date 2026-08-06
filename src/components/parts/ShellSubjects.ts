'use client';

/**
 * Compass — 教科カラー表の生成（Phase 2B / TASK S0）
 *
 * 出典: HTML:2608-2618（`renderVals` 冒頭の `knownSubjects` 先行登録）、2053-2059（`subjOf`）。
 * architecture §6 / spec Q35 / C-99。
 *
 * レガシーはレンダー中に `this.SUBJ` を変異させていたが、ここでは
 * `lib/logic/subjects.ts` の純関数でデータ変更時に 1 回だけ組み立てる。
 * **キーの挿入順**がレガシーの `Object.keys(SUBJ)` と一致するので、
 * 検索ポップオーバーの教科チップ順もパレット巡回の色も同じになる。
 */

import { useMemo } from 'react';
import { allTimeSubjectOrder, buildStudyEntries } from '../../lib/logic/aggregate';
import {
  createSubjectColors,
  subjectAppearanceOrder,
  withSubjectColors,
  type SubjColors,
} from '../../lib/logic/subjects';
import type { AppState, Plans } from '../../lib/model/types';

/** レガシー `this.SUBJ` と等価な表を作る（純関数） */
export function buildSubjColors(state: AppState, plans: Plans): SubjColors {
  const entries = buildStudyEntries(state, plans);
  const names = subjectAppearanceOrder({
    plans,
    segs: state.segs,
    extras: state.extras,
    reviews: state.reviews,
    scores: state.scores,
    addSubj: state.addSubj,
    scoreSubj: state.scoreSubj,
    // studyLog 限定教科は全期間の円グラフ順で採番される（spec Q35）
    studySubjects: allTimeSubjectOrder(entries),
  });
  return withSubjectColors(createSubjectColors(), names);
}

/** `buildSubjColors` を state / plans 単位でメモ化したフック */
export function useSubjColors(state: AppState, plans: Plans): SubjColors {
  return useMemo(() => buildSubjColors(state, plans), [state, plans]);
}
