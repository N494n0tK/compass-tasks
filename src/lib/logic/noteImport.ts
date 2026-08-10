/**
 * Compass — 貼り付け JSON（`compass-note@2` / `@1`）の検証と取り込み
 *
 * 仕様: docs/notebook/spec.md §3.2 / §3.3 / §3.4、受け入れ N-001〜N-020。
 *
 * 方針:
 *  - **エラーが 1 件でもあれば note を返さない**（部分保存しない, N-016）。
 *  - 直せるものは warning にして既定値へ落とす（日付の形式・未知ブロック・範囲外の `qi`）。
 *  - 未知のトップレベルキーは黙って無視する（プロンプト B の出力揺れを弾かない, N-014）。
 *  - 旧スキーマの `qi`（recall の配列インデックス）はここで `cardId` に解決する。
 *    以降アプリ内では `cardId` しか使わない（`model/notes.ts` の注記）。
 *  - `@1`（`blocks` + 5 色）も受け続ける。手元に残っている JSON と旧プロンプトの出力を
 *    捨てないため。読み替えは {@link migrateLegacyBlocks} に集約し、保存データの移行
 *    （`NotebookPersistence.sanitizeNotes`）からも同じ関数を使う（二重実装しない）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import {
  NOTE_CARD_MAX,
  NOTE_KEYWORD_MAX,
  NOTE_SCHEMA,
  NOTE_SCHEMAS,
  NOTE_SCHEMA_V1,
  NOTE_SECTION_MAX,
  type Note,
  type NoteCard,
  type NoteCardOrigin,
  type NoteKeyword,
  type NoteSection,
} from '../model/notes';
import { migrateLegacyKeyColor, normalizeKeyColor } from './noteKeywords';
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
  /**
   * 時間割に出てくる教科名（`timetableSubjects()`）。渡すと、これに無い教科で warning を出す。
   * **エラーにはしない**（時間割に無い授業のノートも取れるべき）。
   */
  knownSubjects?: readonly string[];
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
// sections（`compass-note@2`）
// ─────────────────────────────────────────────────────────────

/**
 * 本文の区画を読む。**中身のある区画だけ**を残す。
 *
 * `heading` しか無い区画（`text` も `ai` も空）は、紙面に出しても見出しだけが浮くので捨てる。
 * 配列でないときは**エラー**にする ―― `sections` は `@2` の本文そのもので、
 * 黙って空にすると「取り込めたのにノートが白紙」という一番たちの悪い失敗になる。
 * 一方**キーごと無い**のは AI がよく落とすだけなので、他の欄と同じく空で通す。
 */
function parseSections(
  raw: unknown,
  errors: NoteImportIssue[],
  warnings: NoteImportIssue[],
): NoteSection[] {
  const sections: NoteSection[] = [];
  if (raw === undefined || raw === null) return sections;
  if (!Array.isArray(raw)) {
    errors.push({ path: 'sections', message: 'sections は配列にしてください' });
    return sections;
  }
  raw.forEach((item, i) => {
    const path = 'sections[' + i + ']';
    if (!isPlainObject(item)) {
      warnings.push({ path, message: 'セクションの形式が不正なので無視しました' });
      return;
    }
    const heading = asString(item.heading).trim();
    const text = asString(item.text).trim();
    const ai = asString(item.ai).trim();
    if (!text && !ai) return;
    sections.push({ heading, text, ai });
  });
  return sections;
}

// ─────────────────────────────────────────────────────────────
// 旧 `blocks`（`compass-note@1` / v0.13 以前の保存データ）→ `sections`
// ─────────────────────────────────────────────────────────────

/** 旧 `ex` ブロックの中身を 1 本の文章にする。空の項は落とし、解答・注意には見出しを付ける */
function legacyExText(item: Record<string, unknown>): string {
  const guide = asString(item.guide).trim();
  const solution = asString(item.solution).trim();
  const caution = asString(item.caution).trim();
  return [guide, solution && '解説: ' + solution, caution && '注意: ' + caution]
    .filter((s) => !!s)
    .join('\n');
}

/**
 * カードの `guide` に追記する。
 * 旧 `ex.guide` は `recall.guide` と同じ文が入っていることが多いので、
 * **既に書いてある行は足さない**（同じ方針が 2 回並ぶのを避ける）。
 */
function appendGuide(existing: string, add: string): string {
  if (!add) return existing;
  if (!existing.trim()) return add;
  const lines = add.split('\n').filter((line) => !existing.includes(line));
  return lines.length ? existing + '\n' + lines.join('\n') : existing;
}

/** 旧 `ex` ブロックが指すカード。貼り付け JSON は `qi`、保存データは `cardId` で指す */
function resolveLegacyCard(
  item: Record<string, unknown>,
  cards: readonly NoteCard[],
  path: string,
  warnings: NoteImportIssue[] | null,
): NoteCard | null {
  if (typeof item.cardId === 'string' && item.cardId) {
    return cards.find((c) => c.cardId === item.cardId) || null;
  }
  // `"qi": "0"`（文字列）で来ることがあるので数値に寄せる
  const qi =
    typeof item.qi === 'string' && /^-?\d+$/.test(item.qi.trim())
      ? parseInt(item.qi, 10)
      : item.qi;
  if (typeof qi === 'number' && Number.isInteger(qi)) {
    if (qi >= 0 && qi < cards.length) return cards[qi];
    warnings?.push({
      path: path + '.qi',
      message: 'qi=' + qi + ' は recall の範囲外なので未対応にしました',
    });
  }
  return null;
}

/**
 * 旧 `blocks` を `sections` とカードの `guide` へ畳む（`@1` の取り込みと保存データの移行で共用）。
 *
 * 畳み先は**情報を落とさないこと**を基準に決めた:
 *  - `def` → `{heading: title, text: '', ai: body}`。旧 `def` は「ノートに書いて**いない**こと」
 *    だったので、自分のノート本文（`text`）ではなく **AI の添削**として置く。
 *  - `ex` で対応するカードがある → そのカードの `guide` へ追記する。旧 `ex` は
 *    「その問題の方針・解答・注意」なので、本文の区画に置くと問題から離れて読めなくなる。
 *    `NoteCard.guide` は解答画面で問題のすぐ下に出る唯一の自由記述で、意味も見え方も保たれる。
 *  - `ex` で対応するカードが無い（`qi` が範囲外・`null`、消えたカード）→
 *    `{heading: '解説', text: '', ai: …}` として本文に残す。捨てると内容が黙って消える。
 *  - 見出しも中身も空になった区画は落とす（`sections` の規則と揃える）。
 *
 * ⚠ 渡した `cards` の `guide` を**書き換える**。取り込み中に作った配列だけを渡すこと。
 *
 * @param warnings `null` を渡すと黙って直す（保存データの読み込みは UI に出せないため）
 */
export function migrateLegacyBlocks(
  rawBlocks: unknown,
  cards: NoteCard[],
  warnings: NoteImportIssue[] | null,
): NoteSection[] {
  const sections: NoteSection[] = [];
  if (rawBlocks === undefined || rawBlocks === null) return sections;
  if (!Array.isArray(rawBlocks)) {
    warnings?.push({ path: 'blocks', message: 'blocks を配列として読み取れないので空にしました' });
    return sections;
  }
  rawBlocks.forEach((item, i) => {
    const path = 'blocks[' + i + ']';
    if (!isPlainObject(item)) {
      warnings?.push({ path, message: 'ブロックの形式が不正なので無視しました' });
      return;
    }
    if (item.t === 'def') {
      const heading = asString(item.title).trim();
      const ai = asString(item.body).trim();
      if (ai) sections.push({ heading, text: '', ai });
      return;
    }
    if (item.t === 'ex') {
      const card = resolveLegacyCard(item, cards, path, warnings);
      const body = legacyExText(item);
      if (!body) return;
      if (card) card.guide = appendGuide(card.guide, body);
      else sections.push({ heading: '解説', text: '', ai: body });
      return;
    }
    warnings?.push({
      path: path + '.t',
      message: '未知のブロック種別 "' + String(item.t) + '" を無視しました',
    });
  });
  return sections;
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
  const { today, existing = null, knownSubjects = [] } = options;
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
  // `@1` も受理する（`blocks` は取り込み時に `sections` へ畳む）。
  const schema = typeof raw.schema === 'string' ? raw.schema.trim() : raw.schema;
  if (!(typeof schema === 'string' && (NOTE_SCHEMAS as readonly string[]).includes(schema))) {
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
          '"（旧 "' +
          NOTE_SCHEMA_V1 +
          '" も可）にしてください（受信: ' +
          (typeof schema === 'string' ? '"' + schema + '"' : String(schema)) +
          '）',
      });
    }
  }

  /**
   * 旧形式として読むか。`schema` が `@1` のとき、または `schema` を書き忘れた出力が
   * `sections` を持たず `blocks` を持つとき（旧プロンプトの出力）。
   * 重要語の色の畳み方が変わる ―― 旧 `green` は「年号・数値」なので `blue` へ送る。
   */
  const legacy =
    schema === NOTE_SCHEMA_V1 || (raw.sections === undefined && raw.blocks !== undefined);
  const keyColorOf = legacy ? migrateLegacyKeyColor : normalizeKeyColor;

  // ── date（直せるので warning）。空文字は「資料から読めなかった」の合図なので黙って今日にする
  let date: ISODate = today;
  if (typeof raw.date === 'string' && ISO_RE.test(raw.date.trim())) {
    date = raw.date.trim();
  } else if (raw.date !== undefined && raw.date !== null && raw.date !== '') {
    warnings.push({ path: 'date', message: 'date の形式が不正なので今日の日付にしました' });
  }

  // ── subject / unit
  // 教科は時間割の名前（言語・英コ・歴総 …）に揃えたい。揃っていなくても保存はできるが、
  // 揃っていないと教科の色も予習の突き合わせもズレるので、はっきり知らせる。
  const subject = asString(raw.subject).trim();
  if (!subject) errors.push({ path: 'subject', message: '教科を入力してください' });
  else if (knownSubjects.length && knownSubjects.indexOf(subject) < 0) {
    warnings.push({
      path: 'subject',
      message:
        '教科「' +
        subject +
        '」は時間割にありません（' +
        knownSubjects.join(' / ') +
        '）。ノートの「編集」から選び直せます',
    });
  }
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
      const inheritedCard = existing?.cards[i];
      const inherited = inheritedCard?.cardId;
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
        // 上書き取り込みでは**解いた記録を引き継ぐ**。`cardId` を同じインデックスから
        // 引き継いでいる以上、履歴も同じ問題のものとして残さないと辻褄が合わない
        attempts: inherited ? (inheritedCard?.attempts ?? []).slice() : [],
      });
    });
  }

  // ── sections（本文＝自分のノートの再現）。旧 `blocks` があれば続けて畳む
  const sections = parseSections(raw.sections, errors, warnings);
  if (raw.blocks !== undefined) {
    // `migrateLegacyBlocks` は対応するカードの `guide` を書き換える（上で作った配列を渡す）
    sections.push(...migrateLegacyBlocks(raw.blocks, cards, warnings));
  }
  if (sections.length > NOTE_SECTION_MAX) {
    warnings.push({
      path: 'sections',
      message: '本文は' + NOTE_SECTION_MAX + '区画までなので、先頭から採用しました',
    });
    sections.length = NOTE_SECTION_MAX;
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
        color: keyColorOf(isPlainObject(item) ? item.color : undefined),
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
    // 写真は JSON には入らない（自分で撮るもの）。上書き取り込みでは必ず引き継ぐ
    scans: existing?.scans || [],
    cards,
    sections,
    // まとめは**復習のときに自分で書く欄**（spec §3.6）。AI は常に空で返してくるので、
    // 空を受け取ったら既存の文章を消さずに引き継ぐ ―― そうしないと、あとから JSON を
    // 貼り直すたびに、自分で書いたまとめが黙って消える（写真と同じ扱い）
    summary: asString(raw.summary).trim() || existing?.summary || '',
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
