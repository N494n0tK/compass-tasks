/**
 * Compass — 生データ ↔ `Note` の読み替え（純ロジック）
 *
 * `components/parts/NotebookPersistence.ts` にあった `sanitizeNotes` / `sortNoteList` /
 * `upsertNote` をここへ移した。理由は 1 つだけ ―― **サーバー側からも同じ関数で読みたい**
 * から。`/api/mcp`（docs/notebook/mcp.md）は Firestore の生ドキュメントを直接読むので、
 * クライアントと違う読み方をすると「アプリでは畳まれている旧 `blocks` が、Notion からは
 * 生のまま見える」といったズレが起きる。`NotebookPersistence` は `'use client'` なので
 * サーバーからは import できない。
 *
 * `NotebookPersistence` は互換のため同じ名前で re-export する（呼び出し側は変えない）。
 *
 * 純ロジック。React / firebase / localStorage を import しない。
 */

import { migrateLegacyBlocks } from './noteImport';
import { migrateLegacyKeyColor, normalizeKeyColor } from './noteKeywords';
import {
  NOTE_KEYWORD_MAX,
  NOTE_SCAN_MAX,
  NOTE_SECTION_MAX,
  type Note,
  type NoteCard,
  type NoteSection,
} from '../model/notes';
import type { ReviewGrade } from '../model/types';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * localStorage / Firestore から来た生データを `Note` として読む。
 * 壊れた行は**黙って捨てる**（`dataPatch` と同じ方針。起動を止めない）。
 *
 * v0.14 より前に保存したノートは `blocks`（AI の補足）＋ 5 色で入っている。
 * ここで `sections`（自分のノートの再現 ＋ AI の添削）と 3 色へ畳む。
 * 畳み方は取り込みと**同じ関数**（`migrateLegacyBlocks` / `migrateLegacyKeyColor`）を通す ――
 * 2 か所で書くと、貼り直したノートと読み込んだノートで中身が変わってしまう。
 */
export function sanitizeNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const out: Note[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const n = item as Record<string, unknown>;
    if (!str(n.id) || !Array.isArray(n.cards)) return;
    /**
     * 旧形式か。`sections` が無い行だけを旧扱いにする（`sections: []` の新しい空ノートは
     * 旧扱いしない ―― 旧 `green`＝年号を `blue` へ倒す規則が、新しい緑を毎回食ってしまう）。
     */
    const legacy = !Array.isArray(n.sections);
    const cards: NoteCard[] = (n.cards as Record<string, unknown>[])
      .filter((c) => c && typeof c === 'object' && str(c.cardId))
      .map((c) => ({
        cardId: str(c.cardId),
        q: str(c.q),
        a: str(c.a),
        guide: str(c.guide),
        src: str(c.src),
        // v0.11 以前のノートには無い。既存分は AI 作として読む
        origin: c.origin === 'self' ? ('self' as const) : ('ai' as const),
        // 解いた記録。壊れた行は落とし、古い順に並べ直す
        attempts: (Array.isArray(c.attempts) ? (c.attempts as Record<string, unknown>[]) : [])
          .filter(
            (t) =>
              t &&
              typeof t === 'object' &&
              /^\d{4}-\d{2}-\d{2}$/.test(String(t.day)) &&
              (t.grade === 'high' || t.grade === 'mid' || t.grade === 'low'),
          )
          .map((t) => ({ day: String(t.day), grade: t.grade as ReviewGrade }))
          .sort((x, y) => x.day.localeCompare(y.day)),
      }));
    // 本文（v0.14 で `blocks` から置き換え）。中身の無い区画は落とす
    const sections: NoteSection[] = (
      Array.isArray(n.sections) ? (n.sections as Record<string, unknown>[]) : []
    )
      .filter((s) => s && typeof s === 'object' && !Array.isArray(s))
      .map((s) => ({ heading: str(s.heading), text: str(s.text), ai: str(s.ai) }))
      .filter((s) => !!s.text || !!s.ai);
    // 旧 `blocks` は `sections` とカードの `guide` へ畳む（警告は出せないので黙って直す）
    if (legacy) sections.push(...migrateLegacyBlocks(n.blocks, cards, null));
    // 重要語（v0.12 で追加）。壊れた行は落とし、語の重複だけ除く
    const keyColorOf = legacy ? migrateLegacyKeyColor : normalizeKeyColor;
    const seenTerms = new Set<string>();
    const keywords = (Array.isArray(n.keywords) ? n.keywords : [])
      .map((k) => {
        const item = k && typeof k === 'object' ? (k as Record<string, unknown>) : null;
        const term = (typeof k === 'string' ? k : item ? str(item.term) : '').trim();
        return { term, color: keyColorOf(item?.color), note: item ? str(item.note) : '' };
      })
      .filter((k) => {
        if (!k.term || seenTerms.has(k.term)) return false;
        seenTerms.add(k.term);
        return true;
      })
      .slice(0, NOTE_KEYWORD_MAX);
    // 自分のノートの写真（v0.13 で追加）。実体は IndexedDB、ここはメタデータだけ
    const scans = (Array.isArray(n.scans) ? (n.scans as Record<string, unknown>[]) : [])
      .filter((k) => k && typeof k === 'object' && str(k.scanId))
      .slice(0, NOTE_SCAN_MAX)
      .map((k) => ({
        scanId: str(k.scanId),
        mime: str(k.mime) || 'image/jpeg',
        w: typeof k.w === 'number' ? k.w : 0,
        h: typeof k.h === 'number' ? k.h : 0,
        bytes: typeof k.bytes === 'number' ? k.bytes : 0,
        caption: str(k.caption),
      }));
    const ex = n.exercise && typeof n.exercise === 'object' ? (n.exercise as Record<string, unknown>) : {};
    out.push({
      id: str(n.id),
      v: 1,
      date: str(n.date),
      subject: str(n.subject),
      unit: str(n.unit),
      scans,
      cards,
      sections: sections.slice(0, NOTE_SECTION_MAX),
      summary: str(n.summary),
      keywords,
      exercise: { q: str(ex.q), a: str(ex.a) },
      doubt: str(n.doubt),
      notice: str(n.notice),
      createdAt: str(n.createdAt) || str(n.date),
      updatedAt: str(n.updatedAt) || str(n.date),
      // ゴミ箱の印（v0.15 で追加）。日付の形でないものは「生きている」と読む
      trashedAt: /^\d{4}-\d{2}-\d{2}$/.test(str(n.trashedAt)) ? str(n.trashedAt) : '',
    });
  });
  return sortNoteList(out);
}

/** 新しい授業日が先。同日は id 昇順（`persistence.sortNotes` と同じ規則） */
export function sortNoteList(notes: readonly Note[]): Note[] {
  return notes.slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** 同じ id があれば差し替え、無ければ足してから並べ直す */
export function upsertNote(notes: readonly Note[], note: Note): Note[] {
  const exists = notes.some((n) => n.id === note.id);
  return sortNoteList(exists ? notes.map((n) => (n.id === note.id ? note : n)) : notes.concat([note]));
}
