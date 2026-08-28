/**
 * Compass — 取り込んだノートが「約束どおりの形か」を機械的に見る
 *
 * 仕様: docs/notebook/spec.md §3.5、および ChatGPT 用の生成指示書の「出す前の自己チェック」。
 *
 * ここが見るのは**規則で決まることだけ**。授業の内容と合っているか、という意味の判断はしない
 * ―― それは一次資料（文字起こし）を読まないと言えず、ここでやると嘘をつく。
 *
 * なぜ AI ではなくコードなのか: 一番効く検査が「重要語が本文に 1 文字も違わず出てくるか」で、
 * これは `String.includes` そのもの。LLM に頼むと「だいたい合っている」を通してしまい、
 * 紙面で色が塗られない語が黙って積もる（実際、旧 Notion エージェントのノートは
 * 8 冊がここで引っかかった）。判定は決定的に、報告だけ AI に、という分担にしている。
 *
 * 純ロジック。React / firebase を import しない。
 */

import { NOTE_CARD_MAX, NOTE_KEY_COLORS, NOTE_SECTION_MAX, type Note } from '../model/notes';
import type { ISODate } from '../model/types';

/** 想起問題の下限。これを割ると 1 回の復習が成立しない */
export const AUDIT_RECALL_MIN = 3;
/** 上限は取り込み側の上限と同じ（別々に持つとどちらかが古くなる） */
export const AUDIT_RECALL_MAX = NOTE_CARD_MAX;

/**
 * 重要語の数。`NOTE_KEYWORD_MAX`（24）はデータとして壊れない上限で、
 * こちらは**紙面の流儀としての上限**。24 語に色が付いた紙は、どれも重要でなくなる。
 */
export const AUDIT_KEYWORD_MIN = 6;
export const AUDIT_KEYWORD_MAX = 12;

const COLORS: ReadonlySet<string> = new Set(NOTE_KEY_COLORS);

/** 指摘 1 件。`code` は機械で数える用、`message` は人が読む用 */
export interface AuditFinding {
  code: string;
  message: string;
}

export interface NoteAudit {
  note_id: string;
  date: ISODate;
  subject: string;
  unit: string;
  ok: boolean;
  findings: AuditFinding[];
  /**
   * 「自分のまとめ」が埋まっているか。**指摘ではなく事実**として返す。
   *
   * ここは本人が復習で書く欄なので、埋まっていること自体は正常 ―― むしろ良い。
   * ただし取り込み JSON が `summary` を持っていると本人の文章を上書きできてしまうので、
   * 「AI が書いたのか本人が書いたのか」は取り込みの入口（`import_note` の warning）で見る。
   * 保存後のノートを見るここからは、書いた主が誰かは**分からない**。
   */
  summary_written: boolean;
}

function push(findings: AuditFinding[], code: string, message: string): void {
  findings.push({ code, message });
}

/** 1 冊を見る。`knownSubjects` は時間割に出てくる教科（`whoami` の `subjects`）＋ `その他` */
export function auditNote(note: Note, knownSubjects: ReadonlySet<string>): NoteAudit {
  const findings: AuditFinding[] = [];

  if (!knownSubjects.has(note.subject)) {
    push(findings, 'subject_unknown', `教科「${note.subject}」が時間割の一覧に無い（大分類を作っていないか）`);
  }

  if (!note.sections.length) {
    push(findings, 'sections_empty', 'sections が空');
  }
  if (note.sections.length > NOTE_SECTION_MAX) {
    push(
      findings,
      'sections_too_many',
      `区画が ${note.sections.length} 個（${NOTE_SECTION_MAX} 個まで。段落ごとに切り刻んでいないか）`,
    );
  }
  note.sections.forEach((s, i) => {
    if (!s.text.trim() && !s.ai.trim()) {
      push(findings, 'section_blank', `sections[${i}]「${s.heading}」が text も ai も空`);
    }
  });

  if (note.cards.length < AUDIT_RECALL_MIN || note.cards.length > AUDIT_RECALL_MAX) {
    push(
      findings,
      'recall_count',
      `想起問題が ${note.cards.length} 問（${AUDIT_RECALL_MIN}〜${AUDIT_RECALL_MAX} 問のはず）`,
    );
  }
  note.cards.forEach((c, i) => {
    if (!c.q.trim()) push(findings, 'recall_no_q', `recall[${i}] に問題文が無い`);
    if (!c.a.trim()) push(findings, 'recall_no_a', `recall[${i}] に解答が無い`);
  });

  // self は ai より先。並び順が崩れると「自分が書いた問い」が AI の問いに埋もれる
  const firstAi = note.cards.findIndex((c) => c.origin === 'ai');
  const lastSelf = note.cards.map((c) => c.origin).lastIndexOf('self');
  if (firstAi !== -1 && lastSelf > firstAi) {
    push(findings, 'recall_order', 'recall の self が ai より後ろにある');
  }

  if (note.keywords.length < AUDIT_KEYWORD_MIN || note.keywords.length > AUDIT_KEYWORD_MAX) {
    push(
      findings,
      'keyword_count',
      `重要語が ${note.keywords.length} 語（${AUDIT_KEYWORD_MIN}〜${AUDIT_KEYWORD_MAX} 語のはず）`,
    );
  }

  // 本文に無い語は色が塗れない ―― 索引として死んでいるので必ず見る。
  // 部分一致で塗るので、1 文字でも違えば当たらない（「独立」と「独立な試行」は別物）。
  const haystack = note.sections.map((s) => `${s.text}\n${s.ai}`).join('\n');
  note.keywords.forEach((k) => {
    if (!COLORS.has(k.color)) {
      push(findings, 'keyword_color', `重要語「${k.term}」の色が ${k.color}（${NOTE_KEY_COLORS.join('/')} のみ）`);
    }
    if (k.term && !haystack.includes(k.term)) {
      push(findings, 'keyword_missing', `重要語「${k.term}」が本文に無い（部分一致で色を塗れない）`);
    }
  });

  return {
    note_id: note.id,
    date: note.date,
    subject: note.subject,
    unit: note.unit,
    ok: findings.length === 0,
    findings,
    summary_written: !!note.summary.trim(),
  };
}

export interface AuditReport {
  checked: number;
  flagged: number;
  /** 指摘の種類ごとの件数。何が多いかが一目で分かる */
  by_code: Record<string, number>;
  notes: NoteAudit[];
}

/** 期間ぶんをまとめて見る。並びは渡された順（`list_notes` の新しい順）のまま */
export function auditNotes(notes: readonly Note[], knownSubjects: ReadonlySet<string>): AuditReport {
  const rows = notes.map((n) => auditNote(n, knownSubjects));
  const byCode: Record<string, number> = {};
  rows.forEach((r) => r.findings.forEach((f) => (byCode[f.code] = (byCode[f.code] ?? 0) + 1)));
  return {
    checked: rows.length,
    flagged: rows.filter((r) => !r.ok).length,
    by_code: byCode,
    notes: rows,
  };
}
