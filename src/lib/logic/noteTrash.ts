/**
 * Compass — ノートのゴミ箱（30日）と取り消し（⌘Z）
 *
 * 仕様: docs/notebook/ux-refresh.md §3 の改善点 #7。
 * 要望の原文は「command + z で戻せるようにしておいて、1ヶ月はゴミ箱に入れとくみたいな感じに」。
 *
 * ## この 1 ファイルが唯一の入口
 *
 * 右クリックメニュー（#5）も確認ダイアログ（#6）もゴミ箱の面（`NoteTrashPanel`）も、
 * **自分で `notes` を書き換えない**でここを通す。破壊と復元が 3 か所に散ると、
 * 「復習は消したのにまとめタスクが残った」「取り消したら並びだけ戻らなかった」が必ず出る。
 *
 * ## 崩してはいけない不変条件
 *
 *  1. **`notes` と `notesTrash` を混ぜない**。ゴミ箱のノートが `state.notes` に紛れ込むと、
 *     一覧・検索・復習生成・問題抽出・今日のToDo のすべてに漏れる（`types.ts` の
 *     `notesTrash` のコメントと同じ理由）。この関数群は必ず片方から抜いて片方へ入れる。
 *  2. **完了済みの復習・まとめタスクは消さない**。学習の記録なので、ノートを捨てても残す
 *     （`noteCards.cascadeNoteRemoval` / `noteSummaryTasks.cascadeNoteSummaryRemoval` の既存方針）。
 *     どれを消すかの判断は**その 2 つに任せる** ―― ここで条件を書き直すと二重管理になる。
 *  3. **取り消しは「操作の直前に戻す」であって「逆操作」ではない**。だから `NoteUndo` に
 *     控えるのは**操作前の姿**（`note` は書き換える前のノートそのもの）。
 *  4. **冪等**。同じエントリを二度適用しても壊れない ―― 書き戻しは id で重複を弾き、
 *     取り除きは「もう無い id」を黙って無視する。
 *
 * ## Firestore は触らない
 *
 * ゴミ箱はドキュメントを消さず `trashedAt` の印を立てるだけ（`model/notes.ts` 参照）。
 * だから捨てる・戻す・改名するのは**ふつうの保存**（`NotebookController.save`）で足りる。
 * 本当に消えるのは 30 日を過ぎたぶんだけで、その削除は親が `NotebookController.remove` で行う。
 * この関数は**消すべき id を返すだけ**。
 *
 * 純ロジック。React / firebase / localStorage を import しない。
 */

import { isoToUtcMs } from './dates';
import { cascadeNoteRemoval, syncNoteReviews } from './noteCards';
import { upsertNote } from './noteDocs';
import {
  cascadeNoteSummaryRemoval,
  noteSummaryExtraId,
  noteSummaryTitle,
} from './noteSummaryTasks';
import type { Note } from '../model/notes';
import {
  NOTE_TRASH_DAYS,
  NOTE_UNDO_MAX,
  type Extra,
  type ISODate,
  type NoteUndo,
  type Review,
} from '../model/types';

const DAY_MS = 86400000;

// ─────────────────────────────────────────────────────────────
// 入出力の形
// ─────────────────────────────────────────────────────────────

/**
 * 操作に要る state の断片。`AppState` がそのまま構造的に当てはまるので、
 * 呼び出し側は `store.getState()` や `setState((s) => …)` の `s` を素で渡せる。
 */
export interface NoteTrashState {
  notes: readonly Note[];
  notesTrash: readonly Note[];
  reviews: readonly Review[];
  extras: readonly Extra[];
  /** seg / extra / review の id が混ざった今日のToDo の並び */
  order: readonly string[];
  selId: string | null;
  nbSelNoteId: string | null;
  /** 取り消し履歴（新しいものが末尾） */
  nbUndo: readonly NoteUndo[];
}

/**
 * `store.setState(next)` へそのまま渡せる形。**キー名は state のキーと同じ**にしてある。
 * 余計なキー（件数など）を混ぜると setState に流し込めなくなるので、数え上げは
 * `NoteTrashOutcome` の側に出す。
 */
export interface NoteTrashPatch {
  notes: Note[];
  notesTrash: Note[];
  reviews: Review[];
  extras: Extra[];
  order: string[];
  selId: string | null;
  nbSelNoteId: string | null;
  nbUndo: NoteUndo[];
}

export interface NoteTrashOutcome {
  /** `store.setState(out.next)` */
  next: NoteTrashPatch;
  /**
   * Firestore へ書き戻すべきノート（`NotebookController.save(note)`）。
   * `null` なら保存不要（＝何も起きなかった）。
   */
  note: Note | null;
  /** 巻き込んだ**未完了**復習の件数。トーストの文言に使う */
  removedReviews: number;
  /** 巻き込んだまとめタスクの件数 */
  removedSummaries: number;
  /**
   * ゴミ箱から戻したときに、**復習まで戻せた件数**（`restoreNote` だけが 0 以外を返す）。
   *
   * 復習の控えは `nbUndo`（一時 state）にしか無いので、リロードを挟んだ復元では
   * ノートだけが戻る。UI が「戻せば復習も一緒に戻ります」と言い切ると嘘になる場面が
   * あるため、実際に戻せた数を返して呼び出し側に言い分けさせる。
   */
  restoredReviews?: number;
  /** 何か変わったか。`false` のとき `next` は入力と同じ中身（流し込んでも無害） */
  changed: boolean;
}

/** 表示名。単元名が空のノートは一覧と同じ言い方にそろえる（`NoteRow` と同文言） */
export function noteLabel(note: Pick<Note, 'unit'>): string {
  return note.unit || '(単元名なし)';
}

/** 入力をそのまま返すパッチ（`changed:false` のとき） */
function keep(s: NoteTrashState): NoteTrashPatch {
  return {
    notes: s.notes as Note[],
    notesTrash: s.notesTrash as Note[],
    reviews: s.reviews as Review[],
    extras: s.extras as Extra[],
    order: s.order as string[],
    selId: s.selId,
    nbSelNoteId: s.nbSelNoteId,
    nbUndo: s.nbUndo as NoteUndo[],
  };
}

/** 何も起きなかったときの返り値 */
function noop(s: NoteTrashState): NoteTrashOutcome {
  return { next: keep(s), note: null, removedReviews: 0, removedSummaries: 0, changed: false };
}

// ─────────────────────────────────────────────────────────────
// 小道具（冪等性はここで担保する）
// ─────────────────────────────────────────────────────────────

/**
 * id が同じものは足さずに書き戻す。取り消しを二度踏んでも行が二重にならない。
 * 足すものが無ければ**入力と同じ参照**を返す（呼び出し側の差分判定に効く）。
 */
function mergeById<T extends { id: string }>(current: readonly T[], add: readonly T[]): T[] {
  if (!add.length) return current as T[];
  const have = new Set(current.map((x) => x.id));
  const rest = add.filter((x) => !have.has(x.id));
  return rest.length ? current.concat(rest) : (current as T[]);
}

/** id の集合で取り除く。もう無い id は黙って無視する */
function dropById<T extends { id: string }>(current: readonly T[], ids: ReadonlySet<string>): T[] {
  if (!ids.size) return current as T[];
  const out = current.filter((x) => !ids.has(x.id));
  return out.length === current.length ? (current as T[]) : out;
}

/**
 * ゴミ箱へ入れる（同じ id があれば差し替え）。**新しく捨てたものが先頭**。
 * ゴミ箱で探すのはたいてい直前に捨てたものなので、並べ替えなしでも上に来るようにしておく。
 */
function putInTrash(trash: readonly Note[], note: Note): Note[] {
  const exists = trash.some((n) => n.id === note.id);
  return exists ? trash.map((n) => (n.id === note.id ? note : n)) : [note].concat(trash as Note[]);
}

/**
 * 消えた行を**元の位置へ**差し戻す。
 *
 * `saved`（操作前の並び）で丸ごと上書きしないのが肝 ―― 捨ててから取り消すまでのあいだに
 * 別のタスクを足していたら、その行が並びから消えてしまう。いま在る並び（`current`）を土台に、
 * 戻す id を「`saved` でその直前にいた、いま現に並んでいる行」の後ろへ挿す。
 */
export function restoreOrder(
  current: readonly string[],
  saved: readonly string[],
  ids: readonly string[],
): string[] {
  const here = new Set(current);
  const want = new Set(ids.filter((id) => !here.has(id)));
  if (!want.size) return current as string[];

  const out = current.slice();
  saved.forEach((id, i) => {
    if (!want.has(id)) return;
    // 錨: `saved` を左へさかのぼって、最初に「いま並びに在る」行を見つける
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = out.indexOf(saved[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    want.delete(id);
  });
  // `saved` にすら無い id（ふつう起きない）は取りこぼさず末尾へ
  want.forEach((id) => out.push(id));
  return out;
}

/**
 * 履歴に 1 手積む。`NOTE_UNDO_MAX` を超えたら**古い方から**捨てる。
 *
 * `at`（操作時刻）が末尾と同じ 1 手は積み直さない ―― ダイアログの「はい」が
 * 二重に発火しても履歴が 2 段にならないようにするためのもので、`NoteUndo.at` は
 * そのための目印（`types.ts`）。
 */
export function pushNoteUndo(stack: readonly NoteUndo[], entry: NoteUndo): NoteUndo[] {
  const last = stack[stack.length - 1];
  if (last && last.at === entry.at && last.kind === entry.kind && last.noteId === entry.noteId) {
    return stack as NoteUndo[];
  }
  const next = stack.concat([entry]);
  return next.length > NOTE_UNDO_MAX ? next.slice(next.length - NOTE_UNDO_MAX) : next;
}

/** 指定したノートに関する履歴を落とす（消えたノートの取り消しを残さない） */
function forgetUndo(stack: readonly NoteUndo[], noteIds: ReadonlySet<string>): NoteUndo[] {
  if (!noteIds.size) return stack as NoteUndo[];
  const out = stack.filter((u) => !noteIds.has(u.noteId));
  return out.length === stack.length ? (stack as NoteUndo[]) : out;
}

// ─────────────────────────────────────────────────────────────
// 巻き込みの数え上げ（#6 の確認ダイアログが使う）
// ─────────────────────────────────────────────────────────────

export interface NoteCascadeCounts {
  /** 巻き込まれる未完了の復習 */
  reviews: number;
  /** 巻き込まれるまとめタスク */
  summaries: number;
}

/**
 * 「消すと何が巻き込まれるか」を数える。`NoteAsk.reviewCount` / `summaryCount` はこれで作る。
 * 数え方を実際の削除と同じ関数（`cascade*`）から取るので、**聞いた数と消える数がずれない**。
 */
export function noteCascadeCounts(
  s: Pick<NoteTrashState, 'reviews' | 'extras' | 'order' | 'selId'>,
  noteId: string,
): NoteCascadeCounts {
  const r = cascadeNoteRemoval(s.reviews, s.order, s.selId, noteId);
  const x = cascadeNoteSummaryRemoval(s.extras, r.order, r.selId, noteId);
  return { reviews: r.removedIds.length, summaries: x.removedIds.length };
}

// ─────────────────────────────────────────────────────────────
// 1. ゴミ箱へ入れる
// ─────────────────────────────────────────────────────────────

export interface TrashNoteOptions {
  noteId: string;
  /**
   * 未完了の復習とまとめタスクも一緒に消すか（#6 のダイアログの答え）。
   * まとめタスクを復習と同じ答えに乗せているのは、聞いているのが 1 問だから ――
   * 「このノートに紐づく予定を片付けるか」の 1 択で、別々に聞くほうが煩わしい。
   */
  alsoReviews: boolean;
  /** 今日（`trashedAt` に入る） */
  today: ISODate;
  /** 操作時刻。テストから固定するためだけの注入点 */
  at?: number;
}

/**
 * ノートをゴミ箱へ入れる。
 *
 * ドキュメントは消さず `trashedAt` を立てて `notes` → `notesTrash` へ移すだけなので、
 * 親は返ってきた `note` をふつうに保存すればよい（`NotebookController.save`）。
 */
export function trashNote(s: NoteTrashState, opts: TrashNoteOptions): NoteTrashOutcome {
  const { noteId, alsoReviews, today } = opts;
  const at = opts.at ?? Date.now();

  const note = s.notes.find((n) => n.id === noteId);
  // すでにゴミ箱の中 / そもそも無い → 何もしない（二度押しで履歴だけ積むのを防ぐ）
  if (!note) return noop(s);

  let reviews = s.reviews as Review[];
  let extras = s.extras as Extra[];
  let order = s.order as string[];
  let selId = s.selId;
  let takenReviews: Review[] = [];
  let takenExtras: Extra[] = [];

  if (alsoReviews) {
    const r = cascadeNoteRemoval(reviews, order, selId, noteId);
    const goneR = new Set(r.removedIds);
    takenReviews = reviews.filter((x) => goneR.has(x.id));
    const x = cascadeNoteSummaryRemoval(extras, r.order, r.selId, noteId);
    const goneX = new Set(x.removedIds);
    takenExtras = extras.filter((e) => goneX.has(e.id));
    reviews = r.reviews;
    extras = x.extras;
    order = x.order;
    selId = x.selId;
  }

  // `updatedAt` は動かさない。あれは**中身を書き換えた日**で、捨てた日は `trashedAt` が持つ。
  // ここで動かすと Notion との突き合わせ（`noteSync`）が「編集された」と読んでしまう。
  const trashed: Note = { ...note, trashedAt: today };

  const undo: NoteUndo = {
    kind: 'trash',
    noteId,
    label: noteLabel(note),
    // 控えるのは**操作前の姿**（`trashedAt: ''` のまま）。書き戻すだけで元に戻る
    note,
    reviews: takenReviews,
    extras: takenExtras,
    order: s.order as string[],
    at,
  };

  return {
    next: {
      notes: s.notes.filter((n) => n.id !== noteId),
      notesTrash: putInTrash(s.notesTrash, trashed),
      reviews,
      extras,
      order,
      selId,
      nbSelNoteId: s.nbSelNoteId === noteId ? null : s.nbSelNoteId,
      nbUndo: pushNoteUndo(s.nbUndo, undo),
    },
    note: trashed,
    removedReviews: takenReviews.length,
    removedSummaries: takenExtras.length,
    changed: true,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. ゴミ箱から戻す
// ─────────────────────────────────────────────────────────────

export interface RestoreNoteOptions {
  noteId: string;
  at?: number;
}

/**
 * ゴミ箱から戻す。**捨てたときに消した復習・まとめタスクも一緒に戻す**。
 *
 * 何を戻すかは `nbUndo` に残っている `kind:'trash'` の控えから引く。控えが無い
 * （履歴から溢れた / 別のセッションで捨てた）ときは**ノートだけ**戻る ―― 復習を
 * 作り直すと `due` が今日にリセットされて、間隔がこっそり巻き戻るから。
 *
 * 使った控えは履歴から落とす。戻したあとに ⌘Z で「捨てた状態」へ行けてしまうと、
 * 目の前の操作（戻した）と履歴の意味がずれる。代わりに `kind:'restore'` を 1 段積む。
 */
export function restoreNote(s: NoteTrashState, opts: RestoreNoteOptions): NoteTrashOutcome {
  const { noteId } = opts;
  const at = opts.at ?? Date.now();

  const trashed = s.notesTrash.find((n) => n.id === noteId);
  if (!trashed) return noop(s);

  // いちばん新しい「このノートを捨てた」控え
  let src: NoteUndo | null = null;
  for (let i = s.nbUndo.length - 1; i >= 0; i -= 1) {
    const u = s.nbUndo[i];
    if (u.kind === 'trash' && u.noteId === noteId) {
      src = u;
      break;
    }
  }

  // 実際に足せたぶんだけを控えと並びに使う（すでに在る行は二度挿さない = 冪等）
  const haveR = new Set(s.reviews.map((r) => r.id));
  const haveX = new Set(s.extras.map((x) => x.id));
  const backReviews = (src ? src.reviews : []).filter((r) => !haveR.has(r.id));
  const backExtras = (src ? src.extras : []).filter((x) => !haveX.has(x.id));
  const reviews = mergeById(s.reviews, backReviews);
  const extras = mergeById(s.extras, backExtras);
  const addedIds = backReviews.map((r) => r.id).concat(backExtras.map((x) => x.id));
  const order = src ? restoreOrder(s.order, src.order, addedIds) : (s.order as string[]);

  const alive: Note = { ...trashed, trashedAt: '' };

  const undo: NoteUndo = {
    kind: 'restore',
    noteId,
    label: noteLabel(trashed),
    // 操作前の姿 = ゴミ箱に入っていたときのノート（`trashedAt` が入ったまま）
    note: trashed,
    // ⚠ `restore` だけは意味が裏返る: **この操作が書き戻した行**を控える。
    //   取り消しは「戻す前」＝この行たちが居なかった状態へ帰るので、id で取り除く
    reviews: backReviews,
    extras: backExtras,
    order: s.order as string[],
    at,
  };

  return {
    next: {
      notes: upsertNote(s.notes, alive),
      notesTrash: s.notesTrash.filter((n) => n.id !== noteId),
      reviews,
      extras,
      order,
      selId: s.selId,
      nbSelNoteId: s.nbSelNoteId,
      /**
       * **捨てた控え（`src`）は消さない。** 以前は「使ったから」と落としていたが、
       * それだと `捨てる → 戻す → ⌘Z（また捨てる）→ 戻す` の 4 手で、
       * 復習の控えがどこからも参照されなくなって間隔が永久に失われた。
       * 消さずに下へ残せば履歴は `[捨てた, 戻した]` の素直な一本道になり、
       * ⌘Z を続けて押すと「戻す前 → 捨てる前」と一貫して遡れる。
       */
      nbUndo: pushNoteUndo(s.nbUndo, undo),
    },
    note: alive,
    removedReviews: 0,
    removedSummaries: 0,
    // 復習まで戻せたか（控えが無ければ 0 = ノートだけ戻った）。呼び出し側が
    // トーストで言い分けるために要る ―― `nbUndo` は一時 state なので、
    // リロードを挟んだ復元では控えが無く、ノートだけが戻るのがふつう
    restoredReviews: backReviews.length,
    changed: true,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 改名（同じ入口を通す）
// ─────────────────────────────────────────────────────────────

export interface RenameNoteOptions {
  noteId: string;
  /** 新しい単元名 */
  unit: string;
  /**
   * 復習カード・まとめタスクの**名前も合わせて直すか**。
   *
   * 「消すか」ではない。要望の原文は削除と改名をひとまとめに「復習の方も消すか聞いて」と
   * 言っているが、**改名で復習を消すのは割に合わない** ―― 消した瞬間に、そのカードが
   * 積み上げてきた間隔（何回できて、次はいつか）が失われる。名前を変えたかっただけの
   * 操作で予定が巻き戻るなら、名前は直せないのと同じになる。
   * なので改名で聞くのは「名前を合わせるか」にした（既定は合わせる）。
   */
  syncTitles: boolean;
  /** 今日（`updatedAt` に入る） */
  today: ISODate;
  at?: number;
}

/**
 * 単元名を変える。
 *
 * 名前を合わせるときは `syncNoteReviews` に通す（`commitNote` と同じ関数。2 か所で
 * 書くと表記が割れる）。まとめタスクの題名も単元名を埋め込んでいる
 * （`noteSummaryTitle` が `「◯◯」のまとめを書く`）ので、そちらも一緒に直す
 * ―― 復習だけ直してまとめが旧名のまま今日の ToDo に残ると、直したつもりが直っていない。
 *
 * **`commitNote` は通さない。** あれは 3 手目に `generateNoteReviews` を回すので、
 * 「復習ごと捨てて → リロード → ゴミ箱から戻した（復習は戻らない）」ノートを改名すると、
 * 全カードぶんの復習が `due:今日` で生え直して間隔がこっそり巻き戻る。
 *
 * 取り消しは**操作前のノートを書き戻して、そのノートでもう一度 `syncNoteReviews` を
 * 通す**だけ。合わせた場合・合わせなかった場合のどちらも 1 本の道で元に戻る。
 */
export function renameNote(s: NoteTrashState, opts: RenameNoteOptions): NoteTrashOutcome {
  const { noteId, unit, syncTitles, today } = opts;
  const at = opts.at ?? Date.now();

  const note = s.notes.find((n) => n.id === noteId);
  if (!note) return noop(s);
  // 前後の空白だけの違い・変化なしでは履歴を積まない
  const nextUnit = unit.trim();
  if (!nextUnit || nextUnit === note.unit) return noop(s);

  const renamed: Note = { ...note, unit: nextUnit, updatedAt: today };

  let reviews = s.reviews as Review[];
  let extras = s.extras as Extra[];

  if (syncTitles) {
    reviews = syncNoteReviews(renamed, reviews);
    // まとめタスクの題名も単元名を含む。**未完了のものだけ**直す ――
    // 済んだ行は「そのとき何をやったか」の記録なので、後から書き換えない
    const sumId = noteSummaryExtraId(noteId);
    const sumTitle = noteSummaryTitle(renamed);
    let touched = false;
    const nextExtras = extras.map((e) => {
      if (e.id !== sumId || e.done || e.title === sumTitle) return e;
      touched = true;
      return { ...e, title: sumTitle };
    });
    if (touched) extras = nextExtras;
  }

  const undo: NoteUndo = {
    kind: 'rename',
    noteId,
    label: noteLabel(note),
    note,
    // 改名では何も消さない。取り消しは「操作前のノートを書き戻して
    // もう一度 `syncNoteReviews` を通す」だけで題名まで戻る
    reviews: [],
    extras: [],
    order: s.order as string[],
    at,
  };

  return {
    next: {
      notes: upsertNote(s.notes, renamed),
      notesTrash: s.notesTrash as Note[],
      reviews,
      extras,
      order: s.order as string[],
      selId: s.selId,
      nbSelNoteId: s.nbSelNoteId,
      nbUndo: pushNoteUndo(s.nbUndo, undo),
    },
    note: renamed,
    removedReviews: 0,
    removedSummaries: 0,
    changed: true,
  };
}

// ─────────────────────────────────────────────────────────────
// 4. 30 日を過ぎたぶんを本当に消す
// ─────────────────────────────────────────────────────────────

/** 捨ててから今日までの日数。`trashedAt` が空 / 未来なら 0（＝まだ 1 日も経っていない） */
function daysInTrash(trashedAt: string, today: ISODate): number {
  if (!trashedAt) return 0;
  const n = Math.round((isoToUtcMs(today) - isoToUtcMs(trashedAt)) / DAY_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * あと何日ゴミ箱に残るか。`0` = 今日が最終日、負 = 期限切れ。
 *
 * 捨てた当日を 1 日目と数えない ―― 「1ヶ月はゴミ箱に入れとく」なら、
 * 30 日目いっぱいまでは戻せてほしい。消えるのは 31 日目の起動から。
 */
export function trashDaysLeft(
  note: Pick<Note, 'trashedAt'>,
  today: ISODate,
  days: number = NOTE_TRASH_DAYS,
): number {
  return days - daysInTrash(note.trashedAt, today);
}

/**
 * 期限切れのノート id。**返すだけで state も Firestore も触らない** ――
 * 実際の削除は親が `NotebookController.remove(id)` で行う（このファイルは純ロジック）。
 *
 * `trashedAt` が空のもの（あってはならないが、壊れたデータや手で書いた JSON なら起こる）は
 * 期限切れにしない。消すほうへ倒すと、印の付け忘れが**復元不能な削除**に化ける。
 */
export function expiredTrashIds(
  notesTrash: readonly Note[],
  today: ISODate,
  days: number = NOTE_TRASH_DAYS,
): string[] {
  return notesTrash
    .filter((n) => !!n.trashedAt && trashDaysLeft(n, today, days) < 0)
    .map((n) => n.id);
}

export interface PurgeTrashResult {
  /** 期限切れを落としたゴミ箱。変化が無ければ**入力と同じ参照** */
  notesTrash: Note[];
  /** 消えたノートの取り消し履歴も落とす（戻せないものを ⌘Z の対象に残さない） */
  nbUndo: NoteUndo[];
  /** 親が `NotebookController.remove()` へ流す id */
  removedIds: string[];
}

/** 起動時の掃除。`expiredTrashIds` の結果を state から抜くところまでやる */
export function purgeTrash(
  s: Pick<NoteTrashState, 'notesTrash' | 'nbUndo'>,
  today: ISODate,
  days: number = NOTE_TRASH_DAYS,
): PurgeTrashResult {
  const removedIds = expiredTrashIds(s.notesTrash, today, days);
  if (!removedIds.length) {
    return { notesTrash: s.notesTrash as Note[], nbUndo: s.nbUndo as NoteUndo[], removedIds };
  }
  const gone = new Set(removedIds);
  return {
    notesTrash: s.notesTrash.filter((n) => !gone.has(n.id)),
    nbUndo: forgetUndo(s.nbUndo, gone),
    removedIds,
  };
}

// ─────────────────────────────────────────────────────────────
// 5. 取り消し（⌘Z）
// ─────────────────────────────────────────────────────────────

export interface NoteUndoOutcome extends NoteTrashOutcome {
  /** 適用した控え。履歴が空なら `null` */
  entry: NoteUndo | null;
}

/**
 * 履歴の末尾 1 件を適用して、直前の 1 手を無かったことにする。
 *
 * 3 つの `kind` の意味:
 *
 * | kind | 操作前の姿 | 取り消しですること |
 * |---|---|---|
 * | `trash` | ノートは生きていて、復習・まとめも在った | ゴミ箱から抜いて `notes` へ戻し、控えた行と並びを書き戻す |
 * | `rename` | 単元名は前の名前 | 前のノートを書き戻し、消した行を戻し、タイトルを追従させ直す |
 * | `restore` | ノートはゴミ箱の中で、戻した行はまだ無かった | ゴミ箱へ入れ直し、戻した行を id で取り除く |
 *
 * `restore` だけ「控えた行を**消す**」向きになる。これは逆操作をしているのではなく、
 * 控えの中身が「その操作が state に足したもの」だから（`restoreNote` の注記を参照）。
 */
export function applyNoteUndo(s: NoteTrashState): NoteUndoOutcome {
  const entry = s.nbUndo[s.nbUndo.length - 1] || null;
  if (!entry) return { ...noop(s), entry: null };

  // 適用しても失敗しても履歴からは必ず落とす（同じ 1 手で引っかかり続けないため）
  const nbUndo = s.nbUndo.slice(0, s.nbUndo.length - 1);
  const rest: NoteTrashState = { ...s, nbUndo };

  if (entry.kind === 'restore') return undoRestore(rest, entry);
  return undoTrashOrRename(rest, entry);
}

/** `trash` / `rename` の取り消し ―― 控えたノートと行を書き戻す */
/**
 * 取り消しで書き戻すノートを作る。
 *
 * **控えたスナップショット（`entry.note`）を丸ごと書き戻さない。**
 * あれは操作した瞬間のノート全体なので、素直に書き戻すと
 * 「改名 → まとめを書く / 1 問解く → ⌘Z」で、名前だけでなく
 * **そのあいだに書いたまとめや解いた記録まで巻き戻って保存される**。
 * トーストは「名前を元に戻しました」としか言わないので、消えたことにも気付けない。
 *
 * そこで土台にするのは**いまのノート**で、控えからは「その操作が変えたところ」だけを
 * 引き戻す:
 *  - `rename`  … `unit` だけ（`updatedAt` は触った印なので今のまま）
 *  - `trash`   … ゴミ箱から出す（`trashedAt` を空に）
 *  - `restore` … ゴミ箱へ戻す（`trashedAt` を捨てた日に）
 *
 * ノートがもう居ないとき（完全削除のあとなど）だけ、控えへ落ちる。
 */
function restoredNote(s: NoteTrashState, entry: NoteUndo): Note {
  const live =
    s.notes.find((n) => n.id === entry.noteId) ||
    s.notesTrash.find((n) => n.id === entry.noteId) ||
    null;
  if (!live) return entry.note;
  if (entry.kind === 'rename') return { ...live, unit: entry.note.unit };
  if (entry.kind === 'restore') return { ...live, trashedAt: entry.note.trashedAt };
  // `trash` の取り消し = ゴミ箱から出す
  return { ...live, trashedAt: '' };
}

function undoTrashOrRename(s: NoteTrashState, entry: NoteUndo): NoteUndoOutcome {
  const back = restoredNote(s, entry);
  const haveR = new Set(s.reviews.map((r) => r.id));
  const haveX = new Set(s.extras.map((x) => x.id));
  // まだ居ない行だけを「戻した行」と数える（二度踏んでも並びが増えない）
  const addedIds = entry.reviews
    .filter((r) => !haveR.has(r.id))
    .map((r) => r.id)
    .concat(entry.extras.filter((x) => !haveX.has(x.id)).map((x) => x.id));
  const reviews0 = mergeById(s.reviews, entry.reviews);
  const extras0 = mergeById(s.extras, entry.extras);
  const order = restoreOrder(s.order, entry.order, addedIds);
  // 単元名を戻したぶん、未完了復習のタイトルも引き戻す（`commitNote` と同じ関数）
  const reviews = syncNoteReviews(back, reviews0);

  return {
    next: {
      notes: upsertNote(s.notes, back),
      // `trash` の取り消しはゴミ箱から抜く。`rename` では元から入っていないので素通り
      notesTrash: s.notesTrash.filter((n) => n.id !== entry.noteId),
      reviews,
      extras: extras0,
      order,
      selId: s.selId,
      nbSelNoteId: s.nbSelNoteId,
      nbUndo: s.nbUndo as NoteUndo[],
    },
    note: back,
    entry,
    removedReviews: 0,
    removedSummaries: 0,
    changed: true,
  };
}

/** `restore` の取り消し ―― ゴミ箱へ入れ直し、戻した行を引き上げる */
function undoRestore(s: NoteTrashState, entry: NoteUndo): NoteUndoOutcome {
  const back = restoredNote(s, entry);
  const goneR = new Set(entry.reviews.map((r) => r.id));
  const goneX = new Set(entry.extras.map((x) => x.id));
  const reviews = dropById(s.reviews, goneR);
  const extras = dropById(s.extras, goneX);
  const gone = new Set<string>([...goneR, ...goneX]);
  const order = gone.size ? s.order.filter((id) => !gone.has(id)) : (s.order as string[]);

  return {
    next: {
      notes: s.notes.filter((n) => n.id !== entry.noteId),
      notesTrash: putInTrash(s.notesTrash, back),
      reviews,
      extras,
      order,
      selId: s.selId && gone.has(s.selId) ? null : s.selId,
      nbSelNoteId: s.nbSelNoteId === entry.noteId ? null : s.nbSelNoteId,
      nbUndo: s.nbUndo as NoteUndo[],
    },
    note: back,
    entry,
    removedReviews: entry.reviews.length,
    removedSummaries: entry.extras.length,
    changed: true,
  };
}

/** トーストの文言。`applyNoteUndo` の結果をそのまま渡す */
export function undoMessage(out: NoteUndoOutcome): string {
  if (!out.entry) return '取り消せる操作がありません';
  const label = out.entry.label;
  if (out.entry.kind === 'trash') return '「' + label + '」を元に戻しました';
  if (out.entry.kind === 'rename') return '「' + label + '」の名前を元に戻しました';
  return '「' + label + '」をゴミ箱へ戻しました';
}

/** ゴミ箱の並び。捨てたのが新しい順、同じ日は id 昇順（`sortNoteList` と同じ流儀） */
export function sortTrashList(notesTrash: readonly Note[]): Note[] {
  return notesTrash
    .slice()
    .sort((a, b) => b.trashedAt.localeCompare(a.trashedAt) || a.id.localeCompare(b.id));
}
