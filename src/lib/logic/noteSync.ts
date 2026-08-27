/**
 * Compass — Study OS（Notion）↔ Compass の同期プロトコル（純ロジック）
 *
 * 仕様: docs/notebook/mcp.md、Notion「🔎 Compass × Study OS 接続監査｜2026-08-22」の P0。
 *
 * ここが引き受けるのは **判断だけ**で、Firestore も HTTP も触らない:
 *  - 冪等性キーと payload hash の作り方（`importKeyOf` / `payloadHashOf`）
 *  - 同じキーが再来したときの結論（`decideImport` → duplicate / conflict / created / updated）
 *  - MCP に返すノートの整形（`noteBrief` / `noteFull`）
 *  - 理解度（`NoteCard.attempts`）の追記（`applyAttempts`）と集計（`understandingStats`）
 *
 * ## 境界（この版で意図的に守っているもの）
 * Notion 側から書けるのは **`NoteCard.attempts` と、取り込みで作られるノート本文だけ**。
 * `summary`（自分のまとめ）・`doubt`（自分の疑問）・`scans`（自分の写真）は
 * 上書き取り込みでも既存を引き継ぎ（`noteImport.parseNoteJson` の `existing` 経由）、
 * **復習の間隔（`state.reviews`）には一切触らない**。
 * これはアプリ内の `recordNoteAttempt` が既に守っている境界と同じ ―― 間隔の計算は
 * `ReviewShared.completeReview` の仕事で、こちらは「いつ・どう感じたか」だけを残す。
 *
 * 純ロジック。React / firebase / next を import しない（`crypto.subtle` だけ使う）。
 */

import { lastAttemptOf, weaknessRank, type Note, type NoteCard } from '../model/notes';
import type { ISODate, ReviewGrade } from '../model/types';

// ─────────────────────────────────────────────────────────────
// ハッシュと冪等性キー
// ─────────────────────────────────────────────────────────────

/**
 * キーの並びに依存しない JSON 文字列。`persistence.stableJson` と同じ考え方だが、
 * あちらは firebase を抱えたモジュールにあるのでサーバーから使えない（重複は承知の上）。
 */
export function stableStringify(value: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>;
      return Object.keys(src)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortDeep(src[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortDeep(value));
}

/** SHA-256 の 16 進表現。Node 18+ / Vercel / ブラウザのどれでも `crypto.subtle` がある */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** payload の内容ハッシュ。同じ内容なら何度作っても同じ値になる */
export async function payloadHashOf(payload: unknown): Promise<string> {
  return sha256Hex(stableStringify(payload));
}

/**
 * 冪等性キー。**授業日 + 教科 + 単元**の 3 つ組で決まる。
 *
 * ブロック id ではなく 3 つ組にするのは、エージェントの再実行が Notion 側で
 * 別ページ（`8月17日 (2)`）を作る運用だから（docs/notebook/notion-pull.md の
 * 「上書き先の解決」と同じ理由）。手貼り・Notion 受け取り・MCP のどの経路から来ても、
 * 同じ授業なら同じキーに落ちる。
 *
 * 先頭に `ik-` を付け、可変部はハッシュにする ―― 単元名に `/` が入っても
 * Firestore のドキュメント ID として使える形に保つため（`invalidDocIdReason`）。
 */
export async function importKeyOf(date: string, subject: string, unit: string): Promise<string> {
  const hash = await sha256Hex(stableStringify([date, subject, unit]));
  return 'ik-' + hash;
}

// ─────────────────────────────────────────────────────────────
// 取り込みの判断
// ─────────────────────────────────────────────────────────────

/** `dry_run` は Firestore を 1 バイトも変えない。`commit` だけが書く */
export type ImportMode = 'dry_run' | 'commit';

export type ImportStatus =
  /** dry-run が通った。まだ何も書いていない */
  | 'validated'
  /** commit でノートを新規作成した */
  | 'created'
  /** commit で既存ノートを上書きした */
  | 'updated'
  /** 同じキー・同じ hash の再送。**何も書かない** */
  | 'duplicate'
  /** 同じキーで中身が違う。`overwrite` を明示しない限り**何も書かない** */
  | 'conflict'
  /** 検証に落ちた。何も書かない */
  | 'rejected';

/** `users/{uid}/noteImports/{key}` の 1 行。取り込みの台帳（監査の P1「同期ログ」） */
export interface ImportRecord {
  /** 冪等性キー（= ドキュメント ID） */
  key: string;
  payloadHash: string;
  /** 取り込み先のノート ID */
  noteId: string;
  status: ImportStatus;
  /** 同じキーで commit した回数。1 から始まる */
  revision: number;
  mode: ImportMode;
  /** ISO 8601 の日時（`ISODate` ではなく時刻まで持つ。台帳なので追跡できること優先） */
  at: string;
  /** どこから来たか（`notion-mcp` / `manual` …） */
  source: string;
  date: ISODate;
  subject: string;
  unit: string;
}

export interface ImportDecision {
  status: ImportStatus;
  /** Firestore を変えてよいか。`false` のときノートも台帳も書かない */
  write: boolean;
  /** そのままエージェントへ返す説明 */
  message: string;
}

/**
 * 同じ冪等性キーが再来したときの結論。
 *
 * | 前回 | 今回の hash | mode | 結論 |
 * |---|---|---|---|
 * | 無し | — | dry_run | `validated`（書かない） |
 * | 無し | — | commit | `created`（書く） |
 * | 有り | 同じ | どちらでも | `duplicate`（書かない） |
 * | 有り | 違う | `overwrite:false` | `conflict`（書かない） |
 * | 有り | 違う | dry_run + `overwrite:true` | `validated`（書かない） |
 * | 有り | 違う | commit + `overwrite:true` | `updated`（書く） |
 *
 * `conflict` を既定にするのは監査の受け入れ条件（「同一キー・異なる hash は conflict」）。
 * 直した JSON を流し直したいときは、エージェントが `overwrite: true` を明示して呼び直す。
 */
export function decideImport(input: {
  mode: ImportMode;
  record: ImportRecord | null;
  payloadHash: string;
  overwrite?: boolean;
  /** 3 つ組で見つかった既存ノート（台帳が無くても上書きになる経路） */
  existingNoteId?: string | null;
}): ImportDecision {
  const { mode, record, payloadHash, overwrite = false, existingNoteId = null } = input;

  if (record && record.payloadHash === payloadHash && record.status !== 'rejected') {
    return {
      status: 'duplicate',
      write: false,
      message:
        '同じ内容を取り込み済みです（' + record.at + ' / ' + record.status + '）。何も変更していません。',
    };
  }

  if (record && record.payloadHash !== payloadHash && !overwrite) {
    return {
      status: 'conflict',
      write: false,
      message:
        '同じ授業（冪等性キー ' +
        record.key +
        '）が別の内容で取り込み済みです。上書きしてよければ overwrite: true を付けて呼び直してください。',
    };
  }

  const willUpdate = !!(record?.noteId || existingNoteId);
  if (mode === 'dry_run') {
    return {
      status: 'validated',
      write: false,
      message: willUpdate
        ? '検証に通りました。commit すると既存ノートを上書きします（Firestore は未変更）。'
        : '検証に通りました。commit するとノートを新規作成します（Firestore は未変更）。',
    };
  }
  return willUpdate
    ? { status: 'updated', write: true, message: '既存ノートを上書きしました。' }
    : { status: 'created', write: true, message: 'ノートを新規作成しました。' };
}

/** 3 つ組（授業日 + 教科 + 単元）で既存ノートを引く。`notionPull` の上書き先解決と同じ規則 */
export function findNoteByTriple(
  notes: readonly Note[],
  date: string,
  subject: string,
  unit: string,
): Note | null {
  return notes.find((n) => n.date === date && n.subject === subject && n.unit === unit) ?? null;
}

// ─────────────────────────────────────────────────────────────
// 理解度（`NoteCard.attempts`）
// ─────────────────────────────────────────────────────────────

const GRADES: readonly ReviewGrade[] = ['high', 'mid', 'low'];

/** 未知の値は `null`。エージェントの表記ゆれ（丸つけ記号・日本語・1..3）もここで吸収する */
export function normalizeGrade(value: unknown): ReviewGrade | null {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if ((GRADES as readonly string[]).includes(v)) return v as ReviewGrade;
    if (v === '◎' || v === 'ばっちり' || v === 'good' || v === '3') return 'high';
    if (v === '○' || v === '〇' || v === 'まあまあ' || v === 'ok' || v === '2') return 'mid';
    if (v === '△' || v === '不安' || v === 'bad' || v === '1') return 'low';
  }
  if (value === 3) return 'high';
  if (value === 2) return 'mid';
  if (value === 1) return 'low';
  return null;
}

export interface AttemptInput {
  cardId: string;
  grade: ReviewGrade;
}

/**
 * `NoteCard.attempts` に入れてよい日付か。
 *
 * ここを通さずに書くと、書いた直後は成功に見えるのに**次の読み込みで黙って消える** ――
 * `noteDocs.sanitizeNotes` が `^\d{4}-\d{2}-\d{2}$` でない `day` の記録を捨てるため。
 * 記録できていないのに `ok: true` が返るのが一番たちが悪いので、入口で弾く。
 */
export function isValidAttemptDay(day: unknown): day is ISODate {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export interface ApplyAttemptsResult {
  note: Note;
  /** 実際に書き足したカード */
  applied: AttemptInput[];
  /** ノートに無かった cardId */
  unknownCardIds: string[];
  changed: boolean;
}

/**
 * 理解度をノートへ書き足す（アプリ内の `recordNoteAttempt` と同じことをサーバーで行う）。
 *
 * **同じ日の同じカードは 1 件に畳む** ―― Notion 側のエージェントは会話の途中で
 * 何度でも呼べてしまうので、同じ日に 5 回答えても履歴が 5 行にならないようにする。
 * 後から来た理解度が勝つ（言い直しは訂正とみなす）。
 *
 * 復習（`state.reviews`）には触らない。ノート 1 ドキュメントだけが変わる。
 */
export function applyAttempts(
  note: Note,
  inputs: readonly AttemptInput[],
  day: ISODate,
): ApplyAttemptsResult {
  const known = new Set(note.cards.map((c) => c.cardId));
  const applied: AttemptInput[] = [];
  const unknownCardIds: string[] = [];
  const latest = new Map<string, ReviewGrade>();

  inputs.forEach((input) => {
    if (!known.has(input.cardId)) {
      if (!unknownCardIds.includes(input.cardId)) unknownCardIds.push(input.cardId);
      return;
    }
    latest.set(input.cardId, input.grade);
  });

  if (!latest.size) return { note, applied, unknownCardIds, changed: false };

  const cards: NoteCard[] = note.cards.map((card) => {
    const grade = latest.get(card.cardId);
    if (!grade) return card;
    applied.push({ cardId: card.cardId, grade });
    const attempts = card.attempts
      .filter((a) => a.day !== day)
      .concat([{ day, grade }])
      .sort((x, y) => x.day.localeCompare(y.day));
    return { ...card, attempts };
  });

  return { note: { ...note, cards, updatedAt: day }, applied, unknownCardIds, changed: true };
}

// ─────────────────────────────────────────────────────────────
// MCP へ返す整形
// ─────────────────────────────────────────────────────────────

/** 1 問ぶんの理解度の要約 */
export interface CardBrief {
  card_id: string;
  no: number;
  q: string;
  origin: NoteCard['origin'];
  tries: number;
  last_grade: ReviewGrade | null;
  last_day: ISODate | null;
  /** 小さいほど苦手（不安 0 → 未着手 1 → まあまあ 2 → ばっちり 3） */
  weakness: number;
}

export function cardBrief(card: NoteCard, index: number): CardBrief {
  const last = lastAttemptOf(card);
  return {
    card_id: card.cardId,
    no: index + 1,
    q: card.q,
    origin: card.origin,
    tries: card.attempts.length,
    last_grade: last?.grade ?? null,
    last_day: last?.day ?? null,
    weakness: weaknessRank(card),
  };
}

/** 一覧に出す 1 冊ぶん。本文は入れない（`get_note` で取る） */
export function noteBrief(note: Note): Record<string, unknown> {
  return {
    note_id: note.id,
    date: note.date,
    subject: note.subject,
    unit: note.unit,
    cards: note.cards.length,
    graded_cards: note.cards.filter((c) => c.attempts.length).length,
    weak_cards: note.cards.filter((c) => lastAttemptOf(c)?.grade === 'low').length,
    has_summary: !!note.summary,
    keywords: note.keywords.map((k) => k.term),
    updated_at: note.updatedAt,
  };
}

/**
 * 1 冊の全文。**`summary` / `doubt` は読めるが書けない**（AI 不可侵領域）ことを
 * 呼び出し側が誤解しないよう、`readonly_fields` を添えて返す。
 */
export function noteFull(note: Note): Record<string, unknown> {
  return {
    note_id: note.id,
    date: note.date,
    subject: note.subject,
    unit: note.unit,
    sections: note.sections.map((s) => ({ heading: s.heading, text: s.text, ai: s.ai })),
    keywords: note.keywords.map((k) => ({ term: k.term, color: k.color, note: k.note })),
    cards: note.cards.map((c, i) => ({
      ...cardBrief(c, i),
      a: c.a,
      guide: c.guide,
      src: c.src,
      attempts: c.attempts,
    })),
    exercise: note.exercise,
    summary: note.summary,
    doubt: note.doubt,
    notice: note.notice,
    scans: note.scans.length,
    readonly_fields: ['summary', 'doubt', 'scans'],
    updated_at: note.updatedAt,
  };
}

export interface WeakCard extends CardBrief {
  note_id: string;
  date: ISODate;
  subject: string;
  unit: string;
}

/** 苦手な順（`weaknessRank`）。同点なら授業日が新しい順 */
export function weakCards(
  notes: readonly Note[],
  opts: { subject?: string; limit?: number; includeUntried?: boolean } = {},
): WeakCard[] {
  const { subject, limit = 20, includeUntried = true } = opts;
  const out: WeakCard[] = [];
  notes.forEach((note) => {
    if (subject && note.subject !== subject) return;
    note.cards.forEach((card, i) => {
      if (!includeUntried && !card.attempts.length) return;
      // ばっちりで終わっている問題は「苦手」ではない
      if (weaknessRank(card) === 3) return;
      out.push({
        ...cardBrief(card, i),
        note_id: note.id,
        date: note.date,
        subject: note.subject,
        unit: note.unit,
      });
    });
  });
  out.sort((a, b) => a.weakness - b.weakness || b.date.localeCompare(a.date));
  return out.slice(0, Math.max(1, limit));
}

export interface SubjectStat {
  subject: string;
  notes: number;
  cards: number;
  tried: number;
  high: number;
  mid: number;
  low: number;
  untried: number;
}

/** 科目ごとの理解度。`from` / `to` は授業日で絞る（両端を含む） */
export function understandingStats(
  notes: readonly Note[],
  opts: { from?: string; to?: string } = {},
): SubjectStat[] {
  const bySubject = new Map<string, SubjectStat>();
  notes.forEach((note) => {
    if (opts.from && note.date < opts.from) return;
    if (opts.to && note.date > opts.to) return;
    const stat = bySubject.get(note.subject) ?? {
      subject: note.subject,
      notes: 0,
      cards: 0,
      tried: 0,
      high: 0,
      mid: 0,
      low: 0,
      untried: 0,
    };
    stat.notes += 1;
    note.cards.forEach((card) => {
      stat.cards += 1;
      const last = lastAttemptOf(card);
      if (!last) {
        stat.untried += 1;
        return;
      }
      stat.tried += 1;
      stat[last.grade] += 1;
    });
    bySubject.set(note.subject, stat);
  });
  return Array.from(bySubject.values()).sort(
    (a, b) => b.low - a.low || a.subject.localeCompare(b.subject),
  );
}
