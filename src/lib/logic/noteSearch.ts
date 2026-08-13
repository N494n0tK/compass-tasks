/**
 * Compass — ノート内の語をさがす（ノート画面の検索）
 *
 * ノートのタブにいるあいだ、上の検索欄は**タスクではなくノートの中身**をさがす。
 * 他の画面の検索（`ShellSearch`）が「予定のどこにあるか」を答えるのに対し、
 * こちらは「その語がノートのどこに書いてあるか」を答える。
 *
 * 出す順は、コーネル式のノートを引く順そのもの:
 *
 *   1. キュー欄（左段）の重要語 … まずここを引く。ノートを引くとは本来これのこと
 *   2. 本文・見出し・AI の添削   … 語が実際に書かれている行を前後ごと出す
 *   3. 想起問題                  … 問い / 解答に出てくるもの
 *
 * 一致は `ShellSearch.hit` と同じ**大小無視の部分文字列**。日本語には語境界が
 * 無いので、ここでも単語単位にはしない（`noteKeywords.ts` と同じ立場）。
 *
 * 純ロジック。React / DOM / firebase を import しない。
 */

import { sectionSearchText } from './noteKeywords';
import type { Note, NoteKeyColor } from '../model/notes';

/** 1 件のヒットがノートのどこに出てきたか */
export type NoteHitKind = 'cue' | 'body' | 'card';

export interface NoteHit {
  noteId: string;
  /** 一覧の見出しに使う（ノートの単元名） */
  unit: string;
  subject: string;
  date: string;
  kind: NoteHitKind;
  /** 太く出す語。キュー欄なら重要語そのもの、本文なら節の見出し */
  term: string;
  /** キュー欄のときだけ。本文と同じ 3 色を一覧にも出す */
  color?: NoteKeyColor;
  /** どこに出てきたか（「キュー欄」「本文 · 基本 3 型」「想起問題 2」） */
  where: string;
  /** 前後を切り出した本文（キュー欄のヒントもここに入る） */
  snippet: string;
}

/** 前後をどれだけ残して切り出すか */
const SNIP_BEFORE = 18;
const SNIP_AFTER = 34;

const norm = (s: string) => (s || '').toLowerCase();

/**
 * 改行と連続空白を潰して 1 行にする（一覧は 1 行しか出せない）。
 *
 * 数式の `$` は落とす ―― 一覧で KaTeX を組むと行の高さが揃わないので
 * 素の文字列を出すが、区切りの `$` だけが残ると式が読みにくくなる。
 */
function flatten(text: string): string {
  return (text || '')
    .replace(/\$\$?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `text` の中の `q` の周りを切り出す。見つからなければ頭から。
 * 数式（`$…$`）はそのままの文字列で出す ―― 一覧で KaTeX を組むと行の高さが揃わない。
 */
export function snippetAround(text: string, q: string): string {
  const flat = flatten(text);
  if (!q) return flat.slice(0, SNIP_BEFORE + SNIP_AFTER);
  const at = norm(flat).indexOf(norm(q));
  if (at < 0) return flat.slice(0, SNIP_BEFORE + SNIP_AFTER);
  const from = Math.max(0, at - SNIP_BEFORE);
  const to = Math.min(flat.length, at + q.length + SNIP_AFTER);
  return (from > 0 ? '…' : '') + flat.slice(from, to) + (to < flat.length ? '…' : '');
}

/**
 * このノートが検索語に引っかかるか（サイドバーの一覧を絞るのに使う）。
 * 見るところはヒット一覧と同じ ―― 一覧に出ないノートが左に残ると迷う。
 */
export function noteMatchesQuery(note: Note, q: string): boolean {
  if (!q) return true;
  const needle = norm(q);
  const has = (t: string | null | undefined) => norm(t || '').indexOf(needle) >= 0;
  return (
    has(note.unit) ||
    has(note.subject) ||
    has(note.summary) ||
    has(note.doubt) ||
    has(note.notice) ||
    note.keywords.some((k) => has(k.term) || has(k.note)) ||
    note.sections.some((s) => has(sectionSearchText(s))) ||
    note.cards.some((c) => has(c.q) || has(c.a) || has(c.guide))
  );
}

/**
 * ノート全体から語をさがす。
 *
 * 1 冊 1 か所の重複は潰す（同じ節に 2 回出てきても行は 1 本）が、
 * **同じ語が複数の冊子に出てくるのは潰さない** ―― どの授業で出てきたかを
 * 並べるのが、この検索のいちばんの用途だから。
 */
export function searchNotes(
  notes: readonly Note[],
  q: string,
  limit = 60,
): NoteHit[] {
  const query = (q || '').trim();
  const out: NoteHit[] = [];
  if (!query) return out;
  const needle = norm(query);
  const has = (t: string | null | undefined) => norm(t || '').indexOf(needle) >= 0;

  const cue: NoteHit[] = [];
  const body: NoteHit[] = [];
  const card: NoteHit[] = [];

  notes.forEach((n) => {
    const base = { noteId: n.id, unit: n.unit, subject: n.subject, date: n.date };

    // ── 1. キュー欄（左段）の重要語。語そのものと、そこに添えたひとことの両方
    n.keywords.forEach((kw) => {
      if (!kw.term) return;
      if (!has(kw.term) && !has(kw.note)) return;
      cue.push({
        ...base,
        kind: 'cue',
        term: kw.term,
        color: kw.color,
        where: 'キュー欄',
        snippet: kw.note ? flatten(kw.note) : '',
      });
    });

    // ── 2. 本文。節ごとに 1 行（見出し・自分のノート・AI の添削をまとめて見る）
    n.sections.forEach((s) => {
      const text = sectionSearchText(s);
      if (!has(text)) return;
      body.push({
        ...base,
        kind: 'body',
        term: s.heading || n.unit,
        where: s.heading ? '本文 · ' + s.heading : '本文',
        snippet: snippetAround(has(s.text) ? s.text : text, query),
      });
    });

    // ── 3. 想起問題
    n.cards.forEach((c, i) => {
      if (!has(c.q) && !has(c.a) && !has(c.guide)) return;
      card.push({
        ...base,
        kind: 'card',
        term: '想起問題 ' + (i + 1),
        where: c.origin === 'self' ? '自分で立てた問い' : 'AI が補った問い',
        snippet: snippetAround(has(c.q) ? c.q : has(c.guide) ? c.guide : c.a, query),
      });
    });
  });

  out.push(...cue, ...body, ...card);
  return out.slice(0, limit);
}
