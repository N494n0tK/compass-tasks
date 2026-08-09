/**
 * Compass — 貼り付け JSON（`compass-note@1`）の検証と取り込み
 *
 * 仕様: docs/notebook/spec.md §3.2 / §3.3 / §3.4、受け入れ N-001〜N-020。
 *
 * 方針:
 *  - **エラーが 1 件でもあれば note を返さない**（部分保存しない, N-016）。
 *  - 直せるものは warning にして既定値へ落とす（日付の形式・未知ブロック・範囲外の `qi`）。
 *  - 未知のトップレベルキーは黙って無視する（プロンプト B の出力揺れを弾かない, N-014）。
 *  - 旧スキーマの `qi`（recall の配列インデックス）はここで `cardId` に解決する。
 *    以降アプリ内では `cardId` しか使わない（`model/notes.ts` の注記）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import {
  NOTE_CARD_MAX,
  NOTE_KEYWORD_MAX,
  NOTE_SCHEMA,
  type Note,
  type NoteBlock,
  type NoteCard,
  type NoteCardOrigin,
  type NoteKeyword,
} from '../model/notes';
import { normalizeKeyColor } from './noteKeywords';
import type { ISODate } from '../model/types';

/** `dates.ts` / `reviews.ts` と同じ日付形式の判定 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 1 件の指摘。`path` は JSON 上の位置（`recall[2].a` など）、`message` はそのまま UI に出す */
export interface NoteImportIssue {
  path: string;
  message: string;
}

/** 上書き取り込みで、既存カードがどう入れ替わったか（復習のカスケードに使う, spec §3.4） */
export interface NoteUpdateDiff {
  keptCardIds: string[];
  addedCardIds: string[];
  removedCardIds: string[];
}

export type NoteImportResult =
  | {
      ok: true;
      note: Note;
      warnings: NoteImportIssue[];
      /** 上書きでないときは `null` */
      diff: NoteUpdateDiff | null;
    }
  | { ok: false; errors: NoteImportIssue[] };

export interface NoteImportOptions {
  /** `date` 欠落・不正時の既定値、`createdAt` / `updatedAt` */
  today: ISODate;
  /** 指定すると上書き取り込み（`id` / `createdAt` を維持し `cardId` をインデックス一致で引き継ぐ） */
  existing?: Note | null;
  /** ノート ID の生成。既定は `'n' + base36 + rand`（レガシー uid と同じ式に接頭辞を付けたもの） */
  newNoteId?: () => string;
  /** カード ID の生成。`index` は recall 内の位置。既定は `'c' + base36 + index` */
  newCardId?: (index: number) => string;
}

/** 既定のノート ID。`noteRefOf` の正規表現 `^n[0-9a-z]+$` に収まる形にする */
export function defaultNoteId(): string {
  return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 999).toString(36);
}

/** 既定のカード ID。`^c[0-9a-z]+$` に収まる形。同一ノート内での一意性は呼び出し側で担保する */
export function defaultCardId(index: number): string {
  return 'c' + Date.now().toString(36) + index.toString(36);
}

// ─────────────────────────────────────────────────────────────
// 小物
// ─────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 文字列以外（数値・null・欠落）は空文字として扱う。必須判定は呼び出し側で */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** `origin` は自己申告。`"self"` 以外はすべて AI 作として扱う（spec §3.6） */
function asOrigin(v: unknown): NoteCardOrigin {
  return v === 'self' ? 'self' : 'ai';
}

/**
 * 生成 AI の出力から JSON 本体を取り出す。
 *
 * 「JSON だけを出せ」と指示しても、実際には
 *  - コードブロック（```json … ```）で囲む
 *  - 「以下が JSON です」などの前置き・後書きを付ける
 *  - 全角の引用符を混ぜる（これは直せないのでエラーにする）
 * が頻発する。前 2 つは**機械的に落とせる**のでここで吸収し、warning として報告する。
 *
 * @returns `text` … 抽出した JSON 文字列 / `trimmed` … 何か削ったか
 */
export function extractJsonObject(input: string): { text: string; trimmed: boolean } {
  const raw = input.trim();
  // ``` で始まるコードブロックを剥がす（言語指定 ```json / ```JSON にも対応）
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(raw);
  const body = (fenced ? fenced[1] : raw).trim();
  // 最初の { から対応する } までを取り出す（前置き・後書きを落とす）
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return { text: body, trimmed: body !== raw };
  const sliced = body.slice(start, end + 1);
  return { text: sliced, trimmed: sliced !== raw };
}

/** JSON で意味を持つエスケープ（`\uXXXX` は別途桁数を見る） */
const VALID_ESCAPES = '"\\/bfnrt';

/**
 * 文字列の中の**無効なエスケープ**を機械的に直す。
 *
 * 生成 AI は LaTeX を吐くとき、`\\dfrac` のように 2 個重ねる指示を出していても
 * どこか 1 か所で `\circ` `\times` `\sum` のように 1 個で書いてしまう。
 * JSON では `\c` は不正なので、**たった 1 か所で全体が読めなくなる**（実際に起きた）。
 *
 * ここでは文字列リテラルの内側だけを見て、`\` の次が JSON の有効なエスケープ
 * （`" \ / b f n r t` と桁の揃った `\uXXXX`）でなければバックスラッシュを 2 個にする。
 * `\circ` → `\\circ` となり、パース後の文字列は LaTeX として正しい `\circ` に戻る。
 *
 * **厳密なパースに失敗したときだけ**呼ぶこと（成功したものを触らない）。
 */
export function repairJsonEscapes(input: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = input[i + 1];
    if (next !== undefined && VALID_ESCAPES.indexOf(next) >= 0) {
      out += ch + next;
      i += 1;
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 2, i + 6))) {
      out += input.slice(i, i + 6);
      i += 5;
      continue;
    }
    // 無効なエスケープ。バックスラッシュ自身をエスケープする（次の文字は次周で出す）
    out += '\\\\';
  }
  return out;
}

/** ノート内で衝突しない `cardId` を確保する */
function uniqueCardId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 1;
  while (used.has(base + n.toString(36))) n += 1;
  return base + n.toString(36);
}

// ─────────────────────────────────────────────────────────────
// 本体
// ─────────────────────────────────────────────────────────────

/**
 * 貼り付けられた文字列を検証して {@link Note} にする。
 *
 * ```ts
 * const res = parseNoteJson(text, { today });
 * if (!res.ok) return showErrors(res.errors);
 * saveNote(res.note);
 * ```
 */
export function parseNoteJson(text: string, options: NoteImportOptions): NoteImportResult {
  const errors: NoteImportIssue[] = [];
  const warnings: NoteImportIssue[] = [];
  const { today, existing = null } = options;
  const newNoteId = options.newNoteId || defaultNoteId;
  const newCardId = options.newCardId || defaultCardId;

  // ── JSON として読めるか。コードブロックや前置きは剥がしてから読む
  const extracted = extractJsonObject(text);
  let raw: unknown;
  let repairedEscapes = false;
  try {
    raw = JSON.parse(extracted.text);
  } catch (e) {
    // LaTeX のバックスラッシュを 1 個で書いてしまった（`\circ` など）ケースを救う
    let recovered = false;
    try {
      raw = JSON.parse(repairJsonEscapes(extracted.text));
      recovered = true;
      repairedEscapes = true;
    } catch {
      /* 直せなかった。元のエラーを返す */
    }
    if (!recovered) {
      const reason = e instanceof Error ? e.message : String(e);
      return { ok: false, errors: [{ path: '$', message: 'JSONとして読み取れません: ' + reason }] };
    }
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ path: '$', message: 'JSONのトップレベルはオブジェクトにしてください' }],
    };
  }
  if (extracted.trimmed) {
    warnings.push({
      path: '$',
      message: 'コードブロックや前後の文章を取り除いてから読み込みました',
    });
  }
  if (repairedEscapes) {
    warnings.push({
      path: '$',
      message: 'LaTeXのバックスラッシュ（\\circ など）が1個だったので補って読み込みました',
    });
  }

  // ── schema
  // 前後の空白は落とす。**行そのものが無い**のは AI がよく忘れるだけなので warning で通し、
  // **別の値が入っている**（別アプリ・別バージョンの JSON）ときだけエラーにする。
  const schema = typeof raw.schema === 'string' ? raw.schema.trim() : raw.schema;
  if (schema !== NOTE_SCHEMA) {
    if (schema === undefined || schema === null || schema === '') {
      warnings.push({
        path: 'schema',
        message: 'schema が無いので "' + NOTE_SCHEMA + '" として読み込みました',
      });
    } else {
      errors.push({
        path: 'schema',
        message:
          'schema は "' +
          NOTE_SCHEMA +
          '" にしてください（受信: ' +
          (typeof schema === 'string' ? '"' + schema + '"' : String(schema)) +
          '）',
      });
    }
  }

  // ── date（直せるので warning）。空文字は「資料から読めなかった」の合図なので黙って今日にする
  let date: ISODate = today;
  if (typeof raw.date === 'string' && ISO_RE.test(raw.date.trim())) {
    date = raw.date.trim();
  } else if (raw.date !== undefined && raw.date !== null && raw.date !== '') {
    warnings.push({ path: 'date', message: 'date の形式が不正なので今日の日付にしました' });
  }

  // ── subject / unit
  const subject = asString(raw.subject).trim();
  if (!subject) errors.push({ path: 'subject', message: '教科を入力してください' });
  const unit = asString(raw.unit).trim();
  if (!unit) errors.push({ path: 'unit', message: '単元名を入力してください' });

  // ── recall → cards
  const usedCardIds = new Set<string>();
  const cards: NoteCard[] = [];
  const recall = raw.recall;
  if (!Array.isArray(recall) || recall.length === 0) {
    errors.push({ path: 'recall', message: 'recall を1件以上入れてください' });
  } else if (recall.length > NOTE_CARD_MAX) {
    errors.push({
      path: 'recall',
      message:
        'recall は' + NOTE_CARD_MAX + '件までです（受信: ' + recall.length + '件）',
    });
  } else {
    recall.forEach((item, i) => {
      if (!isPlainObject(item)) {
        errors.push({ path: 'recall[' + i + ']', message: '想起問題の形式が不正です' });
        return;
      }
      const q = asString(item.q).trim();
      const a = asString(item.a).trim();
      if (!q) errors.push({ path: 'recall[' + i + '].q', message: '問題文が空です' });
      if (!a) errors.push({ path: 'recall[' + i + '].a', message: '解答が空です' });
      // 既存カードとはインデックスで対応付ける（spec §3.4 / N-018）
      const inherited = existing?.cards[i]?.cardId;
      const cardId = uniqueCardId(inherited || newCardId(i), usedCardIds);
      usedCardIds.add(cardId);
      cards.push({
        cardId,
        q: asString(item.q),
        a: asString(item.a),
        guide: asString(item.guide),
        src: asString(item.src),
        // 指定が無ければ AI 作。「自分で書いた問い」は名乗り出た分だけ数える（spec §3.6）
        origin: asOrigin(item.origin),
      });
    });
  }

  // ── blocks（`qi` → `cardId`）
  const blocks: NoteBlock[] = [];
  if (raw.blocks !== undefined && !Array.isArray(raw.blocks)) {
    warnings.push({ path: 'blocks', message: 'blocks を配列として読み取れないので空にしました' });
  } else if (Array.isArray(raw.blocks)) {
    raw.blocks.forEach((item, i) => {
      const path = 'blocks[' + i + ']';
      if (!isPlainObject(item)) {
        warnings.push({ path, message: 'ブロックの形式が不正なので無視しました' });
        return;
      }
      if (item.t === 'def') {
        blocks.push({ t: 'def', title: asString(item.title), body: asString(item.body) });
        return;
      }
      if (item.t === 'ex') {
        let cardId: string | null = null;
        // `"qi": "0"`（文字列）で来ることがあるので数値に寄せる
        const qi =
          typeof item.qi === 'string' && /^-?\d+$/.test(item.qi.trim())
            ? parseInt(item.qi, 10)
            : item.qi;
        if (typeof qi === 'number' && Number.isInteger(qi)) {
          if (qi >= 0 && qi < cards.length) {
            cardId = cards[qi].cardId;
          } else {
            warnings.push({
              path: path + '.qi',
              message: 'qi=' + qi + ' は recall の範囲外なので未対応にしました',
            });
          }
        }
        blocks.push({
          t: 'ex',
          cardId,
          guide: asString(item.guide),
          solution: asString(item.solution),
          caution: asString(item.caution),
        });
        return;
      }
      warnings.push({
        path: path + '.t',
        message: '未知のブロック種別 "' + String(item.t) + '" を無視しました',
      });
    });
  }

  // ── keywords（コーネル式のキュー欄。spec §3.5）
  // 語そのものが本文と 1 文字も違わないことが命なので、trim 以外は触らない。
  // 重複・空文字・上限超過は**黙って落とす**（内容の欠落ではないので warning にしない）。
  const keywords: NoteKeyword[] = [];
  if (raw.keywords !== undefined && !Array.isArray(raw.keywords)) {
    warnings.push({ path: 'keywords', message: 'keywords を配列として読み取れないので空にしました' });
  } else if (Array.isArray(raw.keywords)) {
    const seen = new Set<string>();
    raw.keywords.forEach((item) => {
      // ただの文字列の配列で来ることがある（"keywords": ["産業革命", …]）
      const term = (typeof item === 'string' ? item : isPlainObject(item) ? asString(item.term) : '')
        .trim();
      if (!term || seen.has(term)) return;
      if (keywords.length >= NOTE_KEYWORD_MAX) return;
      seen.add(term);
      keywords.push({
        term,
        color: normalizeKeyColor(isPlainObject(item) ? item.color : undefined),
        note: isPlainObject(item) ? asString(item.note).trim() : '',
      });
    });
    if (raw.keywords.length > NOTE_KEYWORD_MAX) {
      warnings.push({
        path: 'keywords',
        message: '重要語は' + NOTE_KEYWORD_MAX + '語までなので、先頭から採用しました',
      });
    }
  }

  // ── exercise
  let exercise = { q: '', a: '' };
  if (isPlainObject(raw.exercise)) {
    exercise = { q: asString(raw.exercise.q), a: asString(raw.exercise.a) };
  } else if (raw.exercise !== undefined) {
    warnings.push({ path: 'exercise', message: 'exercise を読み取れないので空にしました' });
  }

  if (errors.length) return { ok: false, errors };

  const note: Note = {
    id: existing?.id || newNoteId(),
    v: 1,
    date,
    subject,
    unit,
    cards,
    blocks,
    summary: asString(raw.summary).trim(),
    keywords,
    exercise,
    doubt: asString(raw.doubt),
    notice: asString(raw.notice),
    createdAt: existing?.createdAt || today,
    updatedAt: today,
  };

  return { ok: true, note, warnings, diff: existing ? diffCards(existing, note) : null };
}

/** 上書き前後のカードの入れ替わり（`cardId` の集合差）。N-019 / N-020 */
export function diffCards(before: Note, after: Note): NoteUpdateDiff {
  const beforeIds = before.cards.map((c) => c.cardId);
  const afterIds = after.cards.map((c) => c.cardId);
  const afterSet = new Set(afterIds);
  const beforeSet = new Set(beforeIds);
  return {
    keptCardIds: afterIds.filter((id) => beforeSet.has(id)),
    addedCardIds: afterIds.filter((id) => !beforeSet.has(id)),
    removedCardIds: beforeIds.filter((id) => !afterSet.has(id)),
  };
}

/** 取り込み結果のプレビュー文（モーダルの確認行）。`3枚のカード / 復習3件を作成` */
export function importSummary(note: Note, newReviewCount: number): string {
  return (
    note.subject +
    ' ' +
    note.unit +
    ' · カード' +
    note.cards.length +
    '枚 · 復習' +
    newReviewCount +
    '件を作成'
  );
}
