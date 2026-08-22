/**
 * Compass — 「まとめが空のノート」から今日の一手を提案する
 *
 * 仕様: docs/daily-mission/plan.md §4.1「まとめ未記入ノートの提示」。
 *
 * コーネル式のまとめ（`Note.summary`）は**自分で書く欄**で、AI は常に空で返す
 * （docs/notebook/spec.md §3.6 / `NotePrompts.ts`）。書くこと自体が復習になる、という
 * 設計の思想をそのまま毎日の行動に落とすのがここ ―― 「まとめが空のノート」は機械的に
 * 分かるので、「〜のまとめを書く」を今日の ToDo へ 1 件積む。
 *
 * ## 設計
 *
 * | 論点 | 答え |
 * |---|---|
 * | 実体 | ただの `Extra`（ミッション・予習と同じ。表示も完了も集計も無改修で動く） |
 * | リンク | id の文字列規約 `nbsum-{noteId}`（`dm-…` / `nb-…` と衝突しない接頭辞） |
 * | 対象 | 授業日が**今日から 3 日以内**で `summary` が空のノート |
 * | 二重提案の防止 | `state.noteSumLog`（提案済みの **noteId**）。extras の実体は見ない |
 * | 完了 | `summary` が空→非空になった瞬間に自動で done（`commitNote` が呼ぶ） |
 *
 * **ログの粒度が `prepGenLog` / `missionGenLog` と違う**のが肝。あちらは「日付 → その日ぶん」
 * で毎日また積むのが正しい（習慣タスク）が、まとめは 1 つの授業につき 1 回しか書かない。
 * だから日付ではなく **noteId 単位で「一度提案したら二度と提案しない」**。消した／無視した
 * ものを翌朝また積み直すのは、相棒として単にしつこい。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Note } from '../model/notes';
import type { Extra, ISODate, SizeKey } from '../model/types';
import { isoShift } from './dates';

/**
 * 追いかける日数（今日を含めて 3 日ぶん = `today-2` 〜 `today`）。
 *
 * 理想は授業当日の夜に書くこと。ただ当日に書けない日はあるので 2 日は追いかける ――
 * それ以上さかのぼると、内容を思い出せないまま「まとめを書く」だけが積み上がる。
 */
export const NOTE_SUMMARY_WINDOW_DAYS = 2;

/** 生成 Extra の出典。ToDo カードの説明行にそのまま出る */
export const NOTE_SUMMARY_SRC = 'まとめを書く · ノートから提案';

/** サイズ。3 行のまとめを自分の言葉で書く時間（S = 10 分） */
export const NOTE_SUMMARY_SIZE: SizeKey = 'S';

/** `SIZE_MIN[NOTE_SUMMARY_SIZE]`（`missionAutogen.ts` と同じくローカルに同値を置く） */
export const NOTE_SUMMARY_MIN = 10;

/**
 * 生成 Extra の id の形。ノート id は `'n' + base36`（`noteImport.defaultNoteId`）。
 * `noteCards.NOTE_SERIES_RE` / `missionAutogen.MISSION_EXTRA_RE` と同じく、
 * **この正規表現だけがリンクの実体**。
 */
export const NOTE_SUMMARY_EXTRA_RE = /^nbsum-(n[0-9a-z]+)$/;

/** ノート → 生成 Extra の id */
export function noteSummaryExtraId(noteId: string): string {
  return 'nbsum-' + noteId;
}

/** 生成 Extra の id → ノート id。まとめタスクでなければ `null`（単発の `'u…'` など） */
export function noteSummaryRefOf(extraId: string | null | undefined): string | null {
  if (typeof extraId !== 'string') return null;
  const m = NOTE_SUMMARY_EXTRA_RE.exec(extraId);
  return m ? m[1] : null;
}

/**
 * タスク名。「どの授業のまとめか」が一目で分かればよいので単元名を使う。
 * 単元が空なら教科、それも空なら（取り込み直後の壊れたノート）ただの「ノート」。
 */
export function noteSummaryTitle(note: Pick<Note, 'unit' | 'subject'>): string {
  const label = (note.unit || '').trim() || (note.subject || '').trim() || 'ノート';
  return '「' + label + '」のまとめを書く';
}

/** 今日ぶんの実体。`day` が今日なので `buildTodayItems` がそのまま今日の一覧へ載せる */
export function buildNoteSummaryExtra(note: Note, today: ISODate): Extra {
  return {
    id: noteSummaryExtraId(note.id),
    title: noteSummaryTitle(note),
    subj: note.subject,
    size: NOTE_SUMMARY_SIZE,
    min: NOTE_SUMMARY_MIN,
    day: today,
    done: false,
    src: NOTE_SUMMARY_SRC,
    timetablePeriod: null,
    timetableDate: null,
  };
}

/**
 * そのノートが「まとめ待ち」か。
 *
 * 未来日のノートを外しているのは、提案が **noteId につき一度きり**だから ――
 * 日付を先に打ち間違えたノートをいま提案してしまうと、本来の授業日には
 * 二度と出てこない。窓に入るまで待つ方が取りこぼしが少ない。
 */
export function isSummaryPending(
  note: Pick<Note, 'date' | 'summary'>,
  today: ISODate,
): boolean {
  if ((note.summary || '').trim()) return false;
  const floor = isoShift(today, -NOTE_SUMMARY_WINDOW_DAYS);
  return note.date >= floor && note.date <= today;
}

export interface NoteSummaryPlanInput {
  today: ISODate;
  /** **現在のノート全件**。ログの掃除にも使うので、絞り込んだ一覧を渡してはいけない */
  notes: readonly Note[];
  /** `state.noteSumLog`（提案済みの noteId） */
  log: readonly string[];
  /**
   * ノートの初回読み込みが終わっているか（`state.notesLoaded`）。
   *
   * **必須にしてある**。ノートは `compass-ui-data` とは別系統で遅れて読み込まれるので、
   * 未読込のまま呼ぶと「ノート 0 件」に見えてログを全部掃除してしまい、
   * 読み込み後に提案済みのものを蒸し返す。読み込めていないなら何もしないのが正しい。
   */
  notesLoaded: boolean;
}

export interface NoteSummaryPlanResult {
  /** 追加するまとめタスク（0 件のこともある） */
  extras: Extra[];
  /** 差し替える `noteSumLog`（掃除済み）。変化が無ければ**入力と同じ参照** */
  log: string[];
  /** トースト文言。0 件なら `null` */
  message: string | null;
}

/**
 * まとめ待ちのノートからタスクを組み立てる。
 *
 * 規則:
 *  1. `notesLoaded` が false なら何もしない（ログも触らない）
 *  2. すでに存在しないノートの id をログから落とす（消したノートのぶんを溜め続けない）
 *  3. ログに載っている noteId は**二度と提案しない**（extras の実体は見ない ＝
 *     ユーザーが消したまとめタスクは復活しない。予習・ミッションと同じ設計判断）
 *  4. 残ったノートのうち「窓の中 かつ まとめが空」のものを 1 件ずつ積む
 */
export function generateNoteSummaryTasks(input: NoteSummaryPlanInput): NoteSummaryPlanResult {
  const { today, notes, log, notesLoaded } = input;
  if (!notesLoaded) return { extras: [], log: log as string[], message: null };

  // ── 掃除: 実在するノートの id だけ残す（重複も畳む）
  const alive = new Set(notes.map((n) => n.id));
  const kept: string[] = [];
  const known = new Set<string>();
  log.forEach((id) => {
    if (!alive.has(id) || known.has(id)) return;
    known.add(id);
    kept.push(id);
  });

  const targets = notes.filter((n) => !known.has(n.id) && isSummaryPending(n, today));
  const nextLog = targets.length ? kept.concat(targets.map((n) => n.id)) : kept;
  // 変化が無ければ同じ参照を返す（呼び出し側の「保存すべき変更があったか」判定に効く）
  const same = nextLog.length === log.length && nextLog.every((id, i) => id === log[i]);

  return {
    extras: targets.map((n) => buildNoteSummaryExtra(n, today)),
    log: same ? (log as string[]) : nextLog,
    message: targets.length
      ? targets.length + '件のノートに「まとめを書く」を追加しました'
      : null,
  };
}

/**
 * まとめが書かれたノートの提案タスクを完了にする。
 *
 * 「書けたかどうか」は `summary` を見れば分かるので、チェックを付けさせない ――
 * 書き終えた直後にもう一度 ToDo へ戻ってチェックを付ける、という空手間を無くす。
 * 完了扱いにするだけで消しはしないので、学習時間の集計にも素直に乗る。
 *
 * @returns 変化が無ければ `extras` と同じ参照
 */
export function completeNoteSummaryTasks(
  extras: readonly Extra[],
  note: Pick<Note, 'id' | 'summary'>,
): Extra[] {
  if (!(note.summary || '').trim()) return extras as Extra[];
  const id = noteSummaryExtraId(note.id);
  let changed = false;
  const out = extras.map((x) => {
    if (x.id !== id || x.done) return x;
    changed = true;
    return { ...x, done: true };
  });
  return changed ? out : (extras as Extra[]);
}

export interface NoteSummaryCascadeResult {
  extras: Extra[];
  order: string[];
  selId: string | null;
  /** 実際に削除したタスクの id */
  removedIds: string[];
}

/**
 * ノートを消したときのまとめタスクの後片付け（`noteCards.cascadeNoteRemoval` の流儀）。
 *
 * **未完了のものだけ**消す。完了済みは「その日にまとめを書いた」学習履歴なので残す。
 */
export function cascadeNoteSummaryRemoval(
  extras: readonly Extra[],
  order: readonly string[],
  selId: string | null,
  noteId: string,
): NoteSummaryCascadeResult {
  const id = noteSummaryExtraId(noteId);
  const removedIds: string[] = [];
  const kept = extras.filter((x) => {
    if (x.id !== id || x.done) return true;
    removedIds.push(x.id);
    return false;
  });
  if (!removedIds.length) {
    return { extras: extras as Extra[], order: order as string[], selId, removedIds };
  }
  const gone = new Set(removedIds);
  return {
    extras: kept,
    order: order.filter((o) => !gone.has(o)),
    selId: selId && gone.has(selId) ? null : selId,
    removedIds,
  };
}
