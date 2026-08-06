/**
 * Compass — エクスポート（JSON バックアップ / 学習 CSV）。v0.9 パックの 1:1 移植。
 *
 * 出典:
 *  - legacy `Compass App.dc.html` 3506-3532（`expStamp` / `csvCell` / `csvRow` / `csvByDay` /
 *    `exportJson` / `exportCsv`）、2284-2288（`exportData`）、2486-2499（`downloadText`）、
 *    3379-3382（`studyEntries` の組み立て）、3450（`scoreSorted`）
 *  - spec §8.7（8.7.1 共通ヘルパ / 8.7.2 JSON / 8.7.3 CSV）、パリティ C-556〜C-563
 *
 * ## この module の責務
 * 「何を書き出すか」だけ。**DOM には触れない**（`Blob` / `a[download]` / `URL.revokeObjectURL` /
 * トーストはコンポーネント層 = レガシー `downloadText` C-561 の担当）。ここは
 * `{ filename, mime, content }` を返すだけの純関数で、React / firebase を import しない。
 *
 * ## 呼び出し側（コンポーネント層）が守ること
 * - 戻り値の `content` を **そのまま** Blob に渡す（CSV の BOM・CRLF・末尾改行は content に含む）。
 * - 成功で「JSONを書き出しました」/「CSVを書き出しました」、例外で「書き出しに失敗しました」
 *   のトースト（{@link EXPORT_TOAST}）。state は一切変更しない（C-562）。
 */

import type { ExportData, ISODate, ISODateOrEmpty, Score } from '../model/types';
import { todayISO } from './dates';

// ─────────────────────────────────────────────────────────────
// 戻り値・定数
// ─────────────────────────────────────────────────────────────

/** 書き出し 1 件ぶんの素材。コンポーネント層が Blob + a[download] に流す */
export interface DownloadPayload {
  /** `compass-backup-YYYYMMDD.json` / `compass-study-YYYYMMDD.csv` */
  filename: string;
  /** `Blob` の `type`（レガシー `downloadText` の第2引数, HTML:3520 / 3530） */
  mime: string;
  /** ファイルの中身そのもの（CSV は BOM 込み） */
  content: string;
}

/** JSON バックアップの MIME（HTML:3520） */
export const BACKUP_MIME = 'application/json';

/** 学習 CSV の MIME（HTML:3530） */
export const CSV_MIME = 'text/csv;charset=utf-8';

/**
 * Excel が UTF-8 と判定できるように CSV の先頭へ付ける BOM（HTML:3529-3530 / C-560）。
 * U+FEFF（ZERO WIDTH NO-BREAK SPACE）1文字。ソース上で不可視にならないよう `\uFEFF` で書く。
 */
export const CSV_BOM = '\uFEFF';

/** CSV の改行は CRLF、末尾にも 1 つ付く（C-560） */
export const CSV_EOL = '\r\n';

/** 学習ログ表のラベル行と見出し行（HTML:3524 / C-558） */
export const CSV_STUDY_LABEL = '学習ログ';
export const CSV_STUDY_HEADER = ['date', 'subject', 'minutes'] as const;

/** テスト結果表のラベル行と見出し行（HTML:3527 / C-558） */
export const CSV_SCORE_LABEL = 'テスト結果';
export const CSV_SCORE_HEADER = ['date', 'test', 'subject', 'score'] as const;

/** 書き出し後のトースト文言（HTML:3521 / 3531 / C-561）。表示はコンポーネント層 */
export const EXPORT_TOAST = {
  json: 'JSONを書き出しました',
  csv: 'CSVを書き出しました',
  fail: '書き出しに失敗しました',
} as const;

/**
 * 学習ログ 1 行ぶん。レガシー `studyEntries` の要素（HTML:3379-3382）と同形
 * （studyLog + 完了 seg + 完了 extra を 1 本にまとめたもの。完了した復習は
 * `confirmAsk` が studyLog に書いているのでここには入らない）。
 */
export interface StudyEntry {
  /** 未配分のまま完了した単発タスクなどは `''` */
  day: ISODateOrEmpty;
  subj: string;
  min: number;
}

// ─────────────────────────────────────────────────────────────
// CSV プリミティブ（HTML:3509-3518）
// ─────────────────────────────────────────────────────────────

/**
 * `csvCell(v)`（HTML:3509-3512 / C-560）— RFC4180。
 * `null` / `undefined` は空文字。`"` `,` CR LF のいずれかを含むときだけ `"` で囲み、
 * 中の `"` を二重化する。**それ以外は一切加工しない**（前後空白もタブもそのまま）。
 */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** `csvRow(cells)`（HTML:3513）— セルを `,` で連結（改行は付けない） */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * `csvByDay`（HTML:3515-3518）— 日付昇順。**`day` が空のものは末尾**へ寄せるため、
 * 空文字を `'9999-99-99'` に読み替えて比較する（C-559）。
 */
export function csvByDay(a: { day: ISODateOrEmpty }, b: { day: ISODateOrEmpty }): number {
  const x = a.day || '9999-99-99';
  const y = b.day || '9999-99-99';
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * `scoreSorted`（HTML:3450）— `scores` を `day` 昇順に並べた新しい配列。
 *
 * > 比較関数は**同値でも 0 を返さない**（`a.day < b.day ? -1 : 1`）レガシーそのままを維持する。
 * > 「同点は 0 を返す」に直すと同日データの並びが変わりうるので直さない。
 */
export function sortScoresByDay(scores: readonly Score[]): Score[] {
  return scores.slice().sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * `expStamp`（HTML:3508）— `'2026-08-05'` → `'20260805'`。ファイル名の日付部分。
 */
export function exportStamp(today: ISODate): string {
  return today.replace(/-/g, '');
}

// ─────────────────────────────────────────────────────────────
// JSON バックアップ（HTML:3519-3522 / C-557）
// ─────────────────────────────────────────────────────────────

/**
 * `exportJson`（HTML:3519-3522）の中身を組み立てる。
 *
 * `JSON.stringify(exportData(), null, 2)` **そのもの** = クラウド / localStorage に保存している
 * ペイロードと完全に同形（`{version:1, plans, state}`）。インデントは 2 スペース、末尾に改行は付かない。
 *
 * > キー順は渡された `data` のプロパティ順がそのまま出る。`state` の 23 キーを
 * > `PERSISTENT_KEYS` の順で組み立てるのは呼び出し側（store / persistence）の責務
 * > （spec §4.14 の保存判定と同じ文字列になるようにするため）。
 *
 * @param data `exportData()` の戻り
 * @param today ファイル名に使う日付。既定は実時刻（Asia/Tokyo）。レガシーは起動時に固定した
 *   `T` を使うので、アプリからは `DateContext.today` を渡すこと。
 */
export function buildBackupJson(data: ExportData, today: ISODate = todayISO()): DownloadPayload {
  return {
    filename: 'compass-backup-' + exportStamp(today) + '.json',
    mime: BACKUP_MIME,
    content: JSON.stringify(data, null, 2),
  };
}

// ─────────────────────────────────────────────────────────────
// 学習 CSV（HTML:3523-3532 / C-558〜C-560）
// ─────────────────────────────────────────────────────────────

/**
 * `exportCsv`（HTML:3523-3532）の中身を組み立てる。**1 ファイルに 2 つの表**を空行 1 つで区切る。
 *
 * ```
 * 学習ログ
 * date,subject,minutes
 * …
 *                        ← 空行
 * テスト結果
 * date,test,subject,score
 * …
 * ```
 *
 * - 学習ログは円グラフと同じ `studyEntries`（studyLog + 完了 seg + 完了 extra）を
 *   日付昇順（空日付は末尾）で**全件**。期間チップの絞り込みは掛からない（C-559）。
 * - テスト結果は `scores` を日付昇順で全件。
 * - 先頭に BOM、改行は CRLF、末尾にも改行（C-560）。
 *
 * @param studyEntries 円グラフと同じ集計元。この関数は破壊的変更をしない（`slice()` してから並べ替え）
 * @param scores `state.scores`。並べ替えはこの中で行う（`scoreSorted` と同じ比較関数）
 * @param today ファイル名に使う日付。既定は実時刻（Asia/Tokyo）。
 */
export function buildStudyCsv(
  studyEntries: readonly StudyEntry[],
  scores: readonly Score[],
  today: ISODate = todayISO()
): DownloadPayload {
  const lines: string[] = [CSV_STUDY_LABEL, csvRow(CSV_STUDY_HEADER)];
  studyEntries
    .slice()
    .sort(csvByDay)
    .forEach((e) => lines.push(csvRow([e.day, e.subj, e.min])));
  lines.push('');
  lines.push(CSV_SCORE_LABEL, csvRow(CSV_SCORE_HEADER));
  sortScoresByDay(scores).forEach((sc) => lines.push(csvRow([sc.day, sc.name, sc.subj, sc.score])));
  return {
    filename: 'compass-study-' + exportStamp(today) + '.csv',
    mime: CSV_MIME,
    content: CSV_BOM + lines.join(CSV_EOL) + CSV_EOL,
  };
}
