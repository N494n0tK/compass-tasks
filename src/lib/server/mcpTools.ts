/**
 * Compass — MCP のツール定義と実行（`/api/mcp` の中身）
 *
 * 仕様: docs/notebook/mcp.md。Notion のカスタムエージェントがここへ繋いで、
 *  - 授業ノートを**読む**（`list_notes` / `get_note` / `search_notes`）
 *  - 問題ごとの**理解度を積む**（`record_understanding` / `list_weak_cards` / `get_understanding_stats`）
 *  - `compass-note@2` を**安全に取り込む**（`import_note` の dry_run / commit）
 * の 3 つを行う。
 *
 * ## 書ける場所・書けない場所
 * | 対象 | このサーバー |
 * |---|---|
 * | `users/{uid}/notes/{id}` の本文・カード | 取り込みで書く |
 * | `NoteCard.attempts`（理解度） | 追記する |
 * | `summary` / `doubt` / `scans` | **読むだけ**（上書き取り込みでも既存を引き継ぐ） |
 * | `settings/compass-ui-data`（復習・予定・点数・学習履歴） | **触らない** |
 *
 * `callTool` は Firestore への入口（`CompassServerStore`）を引数で受けるので、
 * テストは偽の store を渡すだけで書ける（`__tests__/mcpTools.test.ts`）。
 */

import { isoShift, todayISO } from '../logic/dates';
import { buildMorningBrief } from '../logic/morningBrief';
import { auditNotes } from '../logic/noteAudit';
import { parseNoteJson } from '../logic/noteImport';
import { searchNotes } from '../logic/noteSearch';
import {
  applyAttempts,
  cardBrief,
  decideImport,
  isValidAttemptDay,
  findNoteByTriple,
  importKeyOf,
  noteBrief,
  noteFull,
  normalizeGrade,
  payloadHashOf,
  understandingStats,
  weakCards,
  type AttemptInput,
  type ImportMode,
  type ImportRecord,
} from '../logic/noteSync';
import { TIMETABLE, timetableSubjects } from '../logic/timetable';
import { NOTE_GRADE_META, type Note } from '../model/notes';
import type { ISODate } from '../model/types';
import type { CompassServerStore } from './compassStore';

/** MCP のツール 1 個ぶん */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** `true` なら Firestore を一切変えない。`tools/list` の annotations に出す */
  readOnly: boolean;
}

export interface ToolResult {
  /** そのまま `content: [{ type: 'text', text }]` になる */
  text: string;
  /** `structuredContent`。エージェントが機械的に読む用 */
  data: unknown;
  /** 失敗（検証エラー・見つからない）なら `true`。プロトコル上のエラーではない */
  isError?: boolean;
}

export interface ToolContext {
  /**
   * Firestore への入口。**必要なツールだけが呼ぶ**関数にしてある ――
   * `get_timetable` のように Firestore を要らないツールは、設定が足りなくても答えられる。
   */
  store: () => CompassServerStore;
  /** 今日（Asia/Tokyo）。テストから固定できるように引数で受ける */
  today?: ISODate;
  /** 台帳の `at` に入れる時刻 */
  now?: () => string;
}

const ISO_DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

const GRADE_ENUM = ['high', 'mid', 'low'] as const;

/** 理解度の意味。ツールの説明文と `whoami` の両方で使う（文言を 2 か所に書かない） */
const GRADE_LEGEND = (Object.keys(NOTE_GRADE_META) as (keyof typeof NOTE_GRADE_META)[])
  .map((g) => g + '=' + NOTE_GRADE_META[g].icon + NOTE_GRADE_META[g].label)
  .join(' / ');

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'whoami',
    title: '接続確認',
    description:
      'この MCP がどの Compass に繋がっているかを返す。ノート件数・最新の授業日・書き込み境界を確認するのに使う。',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_notes',
    title: '授業ノート一覧',
    description:
      '授業ノートを新しい順に一覧する。本文は含まない（本文は get_note）。教科・期間で絞れる。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Compass の教科コード（数学 / 英コ / 化基 …）' },
        from: { ...ISO_DATE, description: '授業日の下限（この日を含む）' },
        to: { ...ISO_DATE, description: '授業日の上限（この日を含む）' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: '既定 30' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_note',
    title: '授業ノート本文',
    description:
      '1 冊の全文（本文 sections・重要語・想起問題と理解度・自分のまとめ・疑問）を返す。note_id か、授業日+教科で引く。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        date: { ...ISO_DATE, description: 'note_id の代わりに授業日で引く' },
        subject: { type: 'string' },
        unit: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_notes',
    title: 'ノート検索',
    description:
      '重要語・本文・想起問題を横断して語をさがす。どの授業で出てきたかを並べるのが用途。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '既定 30' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_weak_cards',
    title: '苦手な問題',
    description:
      '理解度の低い順に想起問題を並べる（不安 → 未着手 → まあまあ。ばっちりは除く）。復習セットを組むときに使う。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '既定 20' },
        include_untried: { type: 'boolean', description: '未着手を含めるか（既定 true）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_understanding_stats',
    title: '理解度の集計',
    description: '教科ごとの理解度（' + GRADE_LEGEND + '・未着手）を集計する。期間で絞れる。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        from: { ...ISO_DATE },
        to: { ...ISO_DATE },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'record_understanding',
    title: '理解度を記録',
    description:
      '想起問題を解いた結果（' +
      GRADE_LEGEND +
      '）をノートへ書き足す。同じ日の同じ問題は 1 件に畳み、後から来た方が勝つ。' +
      '復習の間隔（Compass 正本）には触らない ―― 間隔はアプリで解いたときだけ動く。',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        results: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              card_id: { type: 'string' },
              grade: { type: 'string', enum: [...GRADE_ENUM] },
            },
            required: ['card_id', 'grade'],
            additionalProperties: false,
          },
        },
        day: { ...ISO_DATE, description: '解いた日。既定は今日（Asia/Tokyo）' },
      },
      required: ['note_id', 'results'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_note',
    title: 'ノートを取り込む',
    description:
      'compass-note@2 の JSON を Compass へ取り込む。mode="dry_run"（既定）は検証だけで Firestore を 1 バイトも変えない。' +
      'mode="commit" で保存する。同じ授業の再送は duplicate、内容違いは conflict になり、上書きしたいときだけ overwrite=true を付ける。',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        // `payload` は**中身の鍵を明示して `additionalProperties: true`** にしておく。
        // 型だけ書いて中身を書かないと、クライアント側が親の `additionalProperties: false` を
        // 内側にも当ててしまい、`source` のような余分な鍵を持つ payload が
        // 「payload.source should be not present」で送信前に弾かれる（実測。2026-08-25）。
        payload: {
          description:
            'compass-note@2 のオブジェクト。余分な鍵があっても無視するので、そのまま渡してよい。',
          type: 'object',
          additionalProperties: true,
          properties: {
            schema: { type: 'string' },
            date: { ...ISO_DATE },
            subject: { type: 'string' },
            unit: { type: 'string' },
            recall: { type: 'array', items: { type: 'object', additionalProperties: true } },
            sections: { type: 'array', items: { type: 'object', additionalProperties: true } },
            keywords: { type: 'array', items: { type: 'object', additionalProperties: true } },
            summary: { type: 'string' },
            exercise: { type: 'object', additionalProperties: true },
            doubt: { type: 'string' },
            notice: { type: 'string' },
          },
        },
        /** オブジェクトで渡せないクライアント向け。`payload` と両方あれば `payload` が勝つ */
        payload_json: {
          type: 'string',
          description: 'payload を JSON 文字列で渡す場合はこちら（コードブロック付きでも読む）',
        },
        mode: { type: 'string', enum: ['dry_run', 'commit'], description: '既定 dry_run' },
        overwrite: { type: 'boolean', description: 'conflict を承知で上書きする（既定 false）' },
        idempotency_key: { type: 'string', description: '省略時は 授業日+教科+単元 から作る' },
        source: { type: 'string', description: '台帳に残す出どころ（既定 notion-mcp）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_imports',
    title: '取り込み台帳',
    description: '直近の取り込み結果（冪等性キー・hash・状態・書込み先）を新しい順に返す。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: '既定 20' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_timetable',
    title: '時間割',
    description:
      'Compass が持っている週の基本時間割（曜日 × 7 コマ）と、そこに出てくる教科コードを返す。',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_notes',
    title: 'ノートの形を点検',
    description:
      '取り込んだノートが約束どおりの形か（想起問題の数・重要語が本文に出てくるか・self の並び順など）を'
      + '機械的に見て、指摘を返す。**内容が授業と合っているかは見ない** ―― それは一次資料が要る。'
      + '判定はここで決定的に行うので、呼び出す側は結果をそのまま伝えるだけでよい。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        date: { ...ISO_DATE, description: '見る範囲の上限。既定は今日' },
        days: { type: 'integer', minimum: 1, maximum: 31, description: 'date から遡る日数。既定 1' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'morning_brief',
    title: '朝のメモ',
    description:
      '今日の時間割・持ち物/提出・思い出せるか 3 問を組み立てて返す。`body` はそのまま貼れる Markdown。'
      + '土日は `skipped: true` を返す（何も書かないでよい）。**中身を足したり書き換えたりしない**こと ――'
      + 'ここが返した時間割と問題文がそのまま今日の 1 枚になる。',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { date: { ...ISO_DATE, description: '既定は今日' } },
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

// ─────────────────────────────────────────────────────────────
// 引数の読み取り（MCP クライアントは型を緩く送ってくる）
// ─────────────────────────────────────────────────────────────

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : '';
}

function argInt(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function argBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function ok(data: unknown): ToolResult {
  return { text: JSON.stringify(data, null, 2), data };
}

function fail(message: string, extra: Record<string, unknown> = {}): ToolResult {
  const data = { ok: false, message, ...extra };
  return { text: JSON.stringify(data, null, 2), data, isError: true };
}

/**
 * 内容ハッシュのもとになる形。**id・日時・本人領域を外す**ので、
 * 同じ授業を作り直しても中身が同じなら同じ hash になる。
 */
function hashablePayload(note: Note, incomingDoubt?: string): Record<string, unknown> {
  return {
    date: note.date,
    subject: note.subject,
    unit: note.unit,
    sections: note.sections,
    keywords: note.keywords,
    exercise: note.exercise,
    notice: note.notice,
    cards: note.cards.map((c) => ({ q: c.q, a: c.a, guide: c.guide, src: c.src, origin: c.origin })),
    // **送られてきた** doubt だけを混ぜる（マージ後の値ではない）。
    // 混ぜないと「doubt だけ直した再送」が同じ hash になり duplicate で捨てられる。
    // マージ後を混ぜると、本人がアプリで疑問を書き足した翌日に、同じ payload が
    // 別 hash になって conflict で止まる。送信内容そのものを見るのが正しい。
    doubt: incomingDoubt ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 実行
// ─────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs
    : {}) as Record<string, unknown>;
  const today = ctx.today || todayISO();
  const now = ctx.now || (() => new Date().toISOString());

  switch (name) {
    case 'whoami': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      return ok({
        ok: true,
        app: 'Compass',
        // uid はそのまま返さない（ログに残る）。末尾 4 文字だけで十分に区別できる
        uid_tail: store.uid.slice(-4),
        notes: notes.length,
        latest_lesson: notes[0]?.date ?? null,
        subjects: timetableSubjects(),
        grades: GRADE_LEGEND,
        writable: ['notes.sections', 'notes.cards', 'notes.cards[].attempts'],
        readonly: ['notes.summary', 'notes.doubt', 'notes.scans', 'settings/compass-ui-data'],
      });
    }

    case 'list_notes': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const subject = argStr(args, 'subject');
      const from = argStr(args, 'from');
      const to = argStr(args, 'to');
      const limit = argInt(args, 'limit', 30);
      const rows = notes
        .filter((n) => (!subject || n.subject === subject) && (!from || n.date >= from) && (!to || n.date <= to))
        .slice(0, limit)
        .map(noteBrief);
      return ok({ ok: true, count: rows.length, total: notes.length, notes: rows });
    }

    case 'get_note': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const noteId = argStr(args, 'note_id');
      const date = argStr(args, 'date');
      const subject = argStr(args, 'subject');
      const unit = argStr(args, 'unit');
      let note: Note | null = null;
      if (noteId) note = notes.find((n) => n.id === noteId) ?? null;
      else if (date) {
        const matches = notes.filter(
          (n) => n.date === date && (!subject || n.subject === subject) && (!unit || n.unit === unit),
        );
        if (matches.length > 1) {
          return fail('その日の授業が ' + matches.length + ' 件あります。subject か unit で絞ってください。', {
            candidates: matches.map(noteBrief),
          });
        }
        note = matches[0] ?? null;
      } else {
        return fail('note_id か date のどちらかを指定してください。');
      }
      if (!note) return fail('該当するノートがありません。');
      return ok({ ok: true, note: noteFull(note) });
    }

    case 'search_notes': {
      const query = argStr(args, 'query');
      if (!query) return fail('query を入れてください。');
      const store = ctx.store();
      const notes = await store.loadNotes();
      const hits = searchNotes(notes, query, argInt(args, 'limit', 30));
      return ok({ ok: true, query, count: hits.length, hits });
    }

    case 'list_weak_cards': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const cards = weakCards(notes, {
        subject: argStr(args, 'subject') || undefined,
        limit: argInt(args, 'limit', 20),
        includeUntried: argBool(args, 'include_untried', true),
      });
      return ok({ ok: true, count: cards.length, cards });
    }

    case 'get_understanding_stats': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const stats = understandingStats(notes, {
        from: argStr(args, 'from') || undefined,
        to: argStr(args, 'to') || undefined,
      });
      return ok({ ok: true, legend: GRADE_LEGEND, subjects: stats });
    }

    case 'record_understanding': {
      const noteId = argStr(args, 'note_id');
      if (!noteId) return fail('note_id を入れてください。');
      // 形式を通さない `day` は、書けたように見えて次の読み込みで消える（`sanitizeNotes`）。
      // 「記録しました」と嘘の成功を返さないよう、ここで止める。
      const rawDay = argStr(args, 'day');
      if (rawDay && !isValidAttemptDay(rawDay)) {
        return fail('day は YYYY-MM-DD の形式にしてください（受信: ' + rawDay + '）。');
      }
      const day = rawDay || today;
      const raw = Array.isArray(args.results) ? (args.results as unknown[]) : [];
      const inputs: AttemptInput[] = [];
      const badGrades: unknown[] = [];
      raw.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const r = item as Record<string, unknown>;
        const cardId = typeof r.card_id === 'string' ? r.card_id.trim() : '';
        const grade = normalizeGrade(r.grade);
        if (!cardId) return;
        if (!grade) {
          badGrades.push(r.grade);
          return;
        }
        inputs.push({ cardId, grade });
      });
      if (!inputs.length) {
        return fail('記録できる結果がありません（card_id と grade=high|mid|low が必要）。', {
          bad_grades: badGrades,
        });
      }

      const store = ctx.store();
      const notes = await store.loadNotes();
      const note = notes.find((n) => n.id === noteId);
      if (!note) return fail('該当するノートがありません: ' + noteId);

      const applied = applyAttempts(note, inputs, day);
      if (!applied.changed) {
        return fail('指定された card_id がこのノートにありません。', {
          unknown_card_ids: applied.unknownCardIds,
          available: note.cards.map((c, i) => cardBrief(c, i)),
        });
      }
      await store.saveNote(applied.note);
      return ok({
        ok: true,
        note_id: note.id,
        day,
        recorded: applied.applied.length,
        unknown_card_ids: applied.unknownCardIds,
        cards: applied.note.cards.map((c, i) => cardBrief(c, i)),
        notice: '復習の間隔（Compass 正本）は変更していません。',
      });
    }

    case 'import_note': {
      // `payload`（オブジェクト）優先。文字列でしか渡せないクライアントは `payload_json`。
      // 古い呼び出しが `payload` に文字列を入れてくることもあるので、それも受ける。
      const payload = args.payload ?? args.payload_json;
      if (payload === undefined || payload === null) {
        return fail('payload を入れてください（オブジェクト、または payload_json に JSON 文字列）。');
      }
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const mode: ImportMode = argStr(args, 'mode') === 'commit' ? 'commit' : 'dry_run';
      const overwrite = argBool(args, 'overwrite', false);
      const source = argStr(args, 'source') || 'notion-mcp';
      const knownSubjects = timetableSubjects();

      // 1 回目 — 3 つ組（授業日・教科・単元）を確定するためだけに読む
      const first = parseNoteJson(text, { today, knownSubjects });
      if (!first.ok) {
        return fail('検証に落ちました。取り込んでいません。', {
          status: 'rejected' as const,
          errors: first.errors,
        });
      }

      const store = ctx.store();
      const notes = await store.loadNotes();
      const key =
        argStr(args, 'idempotency_key') ||
        (await importKeyOf(first.note.date, first.note.subject, first.note.unit));
      const record = await store.readImport(key);
      const existing =
        (record?.noteId ? notes.find((n) => n.id === record.noteId) : null) ??
        findNoteByTriple(notes, first.note.date, first.note.subject, first.note.unit);

      // 2 回目 — 上書き先が決まったので、id・cardId・本人領域を引き継いで読み直す
      const parsed = existing ? parseNoteJson(text, { today, knownSubjects, existing }) : first;
      if (!parsed.ok) {
        return fail('検証に落ちました。取り込んでいません。', {
          status: 'rejected' as const,
          errors: parsed.errors,
        });
      }

      const incomingDoubt =
        payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).doubt === 'string'
          ? ((payload as Record<string, unknown>).doubt as string).trim()
          : undefined;
      const payloadHash = await payloadHashOf(hashablePayload(parsed.note, incomingDoubt));
      const decision = decideImport({
        mode,
        record,
        payloadHash,
        overwrite,
        existingNoteId: existing?.id ?? null,
      });

      const base = {
        ok: decision.status !== 'conflict',
        status: decision.status,
        message: decision.message,
        mode,
        idempotency_key: key,
        payload_hash: payloadHash,
        note_id: existing?.id ?? parsed.note.id,
        date: parsed.note.date,
        subject: parsed.note.subject,
        unit: parsed.note.unit,
        cards: parsed.note.cards.length,
        warnings: parsed.warnings,
        diff: parsed.diff,
        protected_fields: {
          summary: '既存を引き継ぎ（AI は書かない）',
          doubt: '既存を引き継ぎ（AI は書かない）',
          scans: '既存を引き継ぎ',
          reviews: '未変更（settings/compass-ui-data に触れていない）',
        },
      };

      if (!decision.write) {
        // conflict も「結果」であって例外ではない。中身は同じで、`isError` だけ立てる
        const result = ok(base);
        return decision.status === 'conflict' ? { ...result, isError: true } : result;
      }

      await store.saveNote(parsed.note);
      const written: ImportRecord = {
        key,
        payloadHash,
        noteId: parsed.note.id,
        status: decision.status,
        revision: (record?.revision ?? 0) + 1,
        mode,
        at: now(),
        source,
        date: parsed.note.date,
        subject: parsed.note.subject,
        unit: parsed.note.unit,
      };
      await store.writeImport(written);
      return ok({ ...base, note_id: parsed.note.id, revision: written.revision, at: written.at });
    }

    case 'list_imports': {
      const rows = await ctx.store().listImports(argInt(args, 'limit', 20));
      return ok({ ok: true, count: rows.length, imports: rows });
    }

    case 'get_timetable': {
      return ok({
        ok: true,
        timezone: 'Asia/Tokyo',
        periods: 7,
        timetable: TIMETABLE,
        subjects: timetableSubjects(),
        notice: '週の基本形。休講・差し替えはアプリ側の「夜の確認」で 1 日ぶんだけ上書きされる。',
      });
    }

    case 'check_notes': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const to = argStr(args, 'date') || today;
      const days = Math.min(argInt(args, 'days', 1), 31);
      const from = isoShift(to, -(days - 1));
      // 「その他」は変換表の逃げ道として正規（教科一覧には出てこない）
      const known = new Set([...timetableSubjects(), 'その他']);
      const target = notes.filter((n) => n.date >= from && n.date <= to);
      return ok({ ok: true, from, to, ...auditNotes(target, known) });
    }

    case 'morning_brief': {
      const store = ctx.store();
      const notes = await store.loadNotes();
      const date = argStr(args, 'date') || today;
      const brief = buildMorningBrief({ date, notes });
      if (!brief) return ok({ ok: true, date, skipped: true, reason: '土日なので朝のメモは作らない' });
      return ok({ ok: true, skipped: false, ...brief });
    }

    default:
      return fail('不明なツールです: ' + name);
  }
}
