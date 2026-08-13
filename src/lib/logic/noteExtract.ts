/**
 * Compass — 問題抽出の並べ替えと絞り込み（docs/notebook/spec.md §9）
 *
 * 全ノートの想起問題を 1 本の列にして、**苦手なものから順に**出す。
 *
 * 復習画面（`Review`）が「予定の管理」なのに対し、ここは「予定の外で解き直す場所」。
 * だから並べ替えの基準も日付ではなく **`NoteCard.attempts`（解いた記録）** にする:
 *
 *  - `weak`  … 直近の理解度が低い順。同じなら久しく解いていない方が先
 *  - `stale` … 最後に解いた日が古い順（未着手が先頭）
 *  - `note`  … ノート順（授業日の新しい順 → ノート内の並び）。取り込んだ形のまま
 *
 * 演習（`note.exercise`）は**カードではない**ので記録を持たない。`weak` / `stale` では
 * 常に想起問題のうしろに回す（記録が付かない以上、「未着手」として毎回上位に居座って
 * しまうため）。`note` 順ではノート内の位置のまま。
 *
 * React も store も import しない純関数（テストしやすさのため）。
 */

import { lastAttemptOf, weaknessRank, type Note, type NoteAttempt } from '../model/notes';
import type { NoteExtractSort, ReviewGrade } from '../model/types';

/** 抽出された 1 問 */
export interface DrillItem {
  /** 解答の開閉キー（`state.nbRevealed`） */
  key: string;
  kind: '想起' | '演習';
  note: Note;
  /** 想起問題なら `cardId`。演習は `null`（記録を持たない） */
  cardId: string | null;
  q: string;
  a: string;
  guide: string;
  /** 解いた記録。演習は常に空 */
  attempts: readonly NoteAttempt[];
}

/** 理解度の絞り込み。`'none'` = まだ 1 度も解いていない */
export type ExtractGradeFilter = ReviewGrade | 'none' | null;

/** ノート群 → 抽出項目。空の設問は落とす（v2 と同じ） */
export function buildDrillItems(
  notes: readonly Note[],
  subjFilter: string | null,
): DrillItem[] {
  const out: DrillItem[] = [];
  notes.forEach((note) => {
    if (subjFilter && note.subject !== subjFilter) return;
    note.cards.forEach((card) => {
      if (!card.q.trim()) return;
      out.push({
        key: 'x:r:' + note.id + ':' + card.cardId,
        kind: '想起',
        note,
        cardId: card.cardId,
        q: card.q,
        a: card.a,
        guide: card.guide,
        attempts: card.attempts,
      });
    });
    if (note.exercise.q.trim()) {
      out.push({
        key: 'x:e:' + note.id,
        kind: '演習',
        note,
        cardId: null,
        q: note.exercise.q,
        a: note.exercise.a,
        guide: '',
        attempts: [],
      });
    }
  });
  return out;
}

/** 直近の記録（無ければ `null`） */
export function lastOf(item: Pick<DrillItem, 'attempts'>): NoteAttempt | null {
  return lastAttemptOf({ attempts: item.attempts as NoteAttempt[] });
}

/** 理解度で絞る */
export function filterByGrade(
  items: readonly DrillItem[],
  filter: ExtractGradeFilter,
): DrillItem[] {
  if (!filter) return items.slice();
  return items.filter((it) => {
    const last = lastOf(it);
    return filter === 'none' ? !last : !!last && last.grade === filter;
  });
}

/**
 * 並べ替え。**元の並び順を壊さない**（同点は入力順のまま）ので、
 * 同じ画面を開き直しても問題の位置が跳ねない。
 */
export function sortDrillItems(
  items: readonly DrillItem[],
  sort: NoteExtractSort,
): DrillItem[] {
  if (sort === 'note') return items.slice();
  const keyed = items.map((it, i) => ({ it, i }));
  keyed.sort((a, b) => {
    // 演習は記録を持てないので、記録で並べる 2 つでは常に最後に回す。
    // そうしないと「未着手」として毎回上位に居座り、いつまでも消えない
    const ka = a.it.kind === '演習' ? 1 : 0;
    const kb = b.it.kind === '演習' ? 1 : 0;
    if (ka !== kb) return ka - kb;
    if (sort === 'weak') {
      const d = weaknessRank({ attempts: a.it.attempts as NoteAttempt[] }) -
        weaknessRank({ attempts: b.it.attempts as NoteAttempt[] });
      if (d) return d;
    }
    // 同じ理解度なら「久しく解いていない方」が先。未着手は常に最も古い扱い
    const la = lastOf(a.it);
    const lb = lastOf(b.it);
    if (!la && lb) return -1;
    if (la && !lb) return 1;
    if (la && lb && la.day !== lb.day) return la.day.localeCompare(lb.day);
    return a.i - b.i;
  });
  return keyed.map((k) => k.it);
}

/** 絞り込み → 並べ替えを 1 回で */
export function arrangeDrillItems(
  items: readonly DrillItem[],
  sort: NoteExtractSort,
  filter: ExtractGradeFilter,
): DrillItem[] {
  return sortDrillItems(filterByGrade(items, filter), sort);
}

/** 抽出結果の内訳。絞り込みチップの件数バッジに出す */
export interface ExtractTally {
  all: number;
  none: number;
  low: number;
  mid: number;
  high: number;
}

export function tallyDrillItems(items: readonly DrillItem[]): ExtractTally {
  const t: ExtractTally = { all: items.length, none: 0, low: 0, mid: 0, high: 0 };
  items.forEach((it) => {
    const last = lastOf(it);
    if (!last) t.none++;
    else t[last.grade]++;
  });
  return t;
}
