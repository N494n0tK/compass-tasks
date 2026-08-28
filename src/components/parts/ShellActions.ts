'use client';

/**
 * Compass — ストア操作の小物（Phase 2B / TASK S0）
 *
 * 出典: HTML:2500-2502（`mutSeg` / `mutExtra` / `mutReview`）、2602-2604（`addToOrder`）。
 * spec §4.17。**浅いコピー**（`{...x}`）であることまで含めて 1:1。
 *
 * 画面コンポーネントからも使えるよう `store` を引数に取る形にしてある。
 */

import type { Extra, Review, Seg } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';

/** `mutSeg(id, fn)`（HTML:2500） */
export function mutSeg(store: CompassStore, id: string, fn: (x: Seg) => Seg): void {
  store.setState((s) => ({ segs: s.segs.map((x) => (x.id === id ? fn({ ...x }) : x)) }));
}

/** `mutExtra(id, fn)`（HTML:2501） */
export function mutExtra(store: CompassStore, id: string, fn: (x: Extra) => Extra): void {
  store.setState((s) => ({ extras: s.extras.map((x) => (x.id === id ? fn({ ...x }) : x)) }));
}

/** `mutReview(id, fn)`（HTML:2502） */
export function mutReview(store: CompassStore, id: string, fn: (x: Review) => Review): void {
  store.setState((s) => ({ reviews: s.reviews.map((x) => (x.id === id ? fn({ ...x }) : x)) }));
}

/**
 * `addToOrder(id)`（HTML:2602-2604）。
 * 既に入っていれば updater が `null` を返す＝内容は変わらないが**通知は飛ぶ**
 * （レガシーも state オブジェクトを作り直して再描画していた）。
 */
export function addToOrder(store: CompassStore, id: string): void {
  store.setState((s) => (s.order.indexOf(id) >= 0 ? null : { order: s.order.concat([id]) }));
}

/**
 * ノートのドリル（その授業の問題だけを解く面）へ飛ぶ。
 * 今日の ToDo / コックピットのノート復習カードから呼ぶ（docs/notebook/spec.md §8）。
 *
 * ノートは 7 番目のタブなので、その画面へ移るだけ。
 */
export function openNoteDrill(store: CompassStore, noteId: string): void {
  store.setState({
    view: 'notebook',
    nbMode: 'drill',
    nbSelNoteId: noteId,
    nbEdit: false,
    nbFullNote: false,
    revSel: null,
  });
}

/** ドリルから「今日のToDo」へ戻る */
export function closeNoteDrill(store: CompassStore): void {
  store.setState({ view: 'todo', nbMode: 'note' });
}

/**
 * ノートを 1 冊開く（docs/daily-mission/plan.md §4.1 のまとめタスクから）。
 * 選択状態の付け方は `openNoteDrill` / 問題抽出の「出典クリック」と同じ流儀。
 */
export function openNote(store: CompassStore, noteId: string): void {
  store.setState((s) => ({
    view: 'notebook',
    nbMode: 'note',
    nbSelNoteId: noteId,
    nbEdit: false,
    // 「想起問題だけ」のレンズだと紙面ごと畳まれていて**まとめ欄が出ない**。
    // まとめを書きに来たのに書けない、では開いた意味がないので自分のノートまで戻す
    nbLens: s.nbLens === 'recall' ? 'mine' : s.nbLens,
    revSel: null,
  }));
}

/**
 * 弱点ドリル ＝ 問題抽出を「苦手な順」で開く（docs/daily-mission/plan.md §4.1）。
 *
 * 狙いは *何をやるか考えるコストをゼロにする* こと。開いた瞬間に上から解けばいい状態に
 * したいので、前に見たときの**理解度の絞り込みは必ず外す**（「◎ばっちり」で絞ったままだと
 * 苦手な順に並べても苦手が 1 問も出てこない）。教科の絞り込みはミッション側の指定で上書きする。
 *
 * @param subj 教科で絞るなら教科名。全教科なら `null`
 */
export function openWeakDrill(store: CompassStore, subj: string | null = null): void {
  store.setState({
    view: 'extract',
    nbExtractSort: 'weak',
    nbExtractGrade: null,
    nbSubjFilter: subj,
    nbMode: 'note',
    nbEdit: false,
  });
}
