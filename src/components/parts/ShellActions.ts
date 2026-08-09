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
 * ノートは Keel Notebook モードにあるので、**モードごと移る**。
 * `view` はタスク側のまま残しておくので、ドリルを終えて戻ると元の画面に帰る
 * （`backToNoteDrillOrigin`）。
 */
export function openNoteDrill(store: CompassStore, noteId: string): void {
  store.setState({
    appMode: 'notebook',
    nbMode: 'drill',
    nbSelNoteId: noteId,
    nbEdit: false,
    nbFullNote: false,
    revSel: null,
    focusOpen: false,
  });
}

/** ドリルから「今日のToDo」へ戻る。モードもタスク側に戻す */
export function closeNoteDrill(store: CompassStore): void {
  store.setState({ appMode: 'tasks', view: 'todo', nbMode: 'note' });
}
