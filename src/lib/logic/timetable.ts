/**
 * Compass — 時間割（レガシー `Compass App.dc.html` 1:1 移植）
 *
 * 出典: HTML:2044-2049（`this.TIMETABLE`）、3561（`|| [null,…]`）。spec §4.9。
 *
 * `screens/AddTask.tsx` のローカル定数だったものを、予習の自動生成
 * （`logic/prepAutogen.ts`）と共有するためにここへ移した。**値は 1 文字も変えていない。**
 * レガシー同様コードにハードコードされ、保存もされない（1日ぶんの上書きだけが
 * `state.dayOverrides` に載る）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Dow } from '../model/types';

/** `this.TIMETABLE`（HTML:2044-2049） */
export const TIMETABLE: Readonly<Partial<Record<Dow, readonly (string | null)[]>>> = {
  月: ['言語', '英コ', '体育', '数学', '歴総', '論表', null],
  火: ['化基', '英コ', '芸術', '芸術', '生基', '地総', '数学'],
  水: ['数学', '数学', '体育', '言語', '英コ', '現国', null],
  木: ['生基', '歴総', '化基', '論表', '数学', '言語', '保健'],
  金: ['現国', '体育', '地総', '英コ', '数学', 'LHR', null],
};

/** 未定義の曜日（土日）に落ちたときの空コマ 7 個（HTML:3561 の `|| [null,…]`） */
export const EMPTY_SLOTS: readonly (string | null)[] = [null, null, null, null, null, null, null];

/** 時間割に現れる教科名（重複なし・出現順）。予習の教科 ON/OFF チップに使う */
export function timetableSubjects(
  timetable: Readonly<Partial<Record<Dow, readonly (string | null)[]>>> = TIMETABLE,
): string[] {
  const out: string[] = [];
  (Object.keys(timetable) as Dow[]).forEach((dow) => {
    (timetable[dow] || []).forEach((subj) => {
      if (subj && out.indexOf(subj) < 0) out.push(subj);
    });
  });
  return out;
}
