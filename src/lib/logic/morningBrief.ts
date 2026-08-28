/**
 * Compass — 朝のメモ（授業が始まる前に読む 1 枚）を組み立てる
 *
 * 中身は 3 つだけ: 今日の時間割 / 持ち物・提出 / 思い出せるか 3 問。
 * **文章を生成しない**ので、毎朝の出力がぶれない。素材（時間割・弱点・連絡）は
 * すべて既存のデータから取るだけで、ここで新しいことは言わない。
 *
 * 土日は `null` を返す（呼び出し側はそれを見て何も書かない）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import { dowOf, isoShift, isWeekend } from './dates';
import { weakCards, type WeakCard } from './noteSync';
import { EMPTY_SLOTS, TIMETABLE } from './timetable';
import type { Note } from '../model/notes';
import type { Dow, ISODate } from '../model/types';

/** 朝に出す想起問題の数。これ以上は登校前に読めない */
export const BRIEF_RECALL_COUNT = 3;

/** 連絡事項を拾いに行く範囲（日）。これより古い連絡は朝には出さない */
export const BRIEF_NOTICE_WINDOW_DAYS = 7;

export interface BriefNotice {
  subject: string;
  notice: string;
  /** 今日ある教科か。true のものを先に並べる */
  today: boolean;
}

export interface MorningBrief {
  date: ISODate;
  weekday: Dow;
  /** 今日の時間割（空きコマは除いた並び） */
  slots: string[];
  notices: BriefNotice[];
  cards: WeakCard[];
  /** そのまま貼れる本文（Markdown） */
  body: string;
}

/**
 * 3 問が同じ教科・同じノートで埋まらないように選ぶ。
 *
 * 素直に「苦手な順」で上から 3 つ取ると、片寄っているときに全部同じ教科になる
 * （実測で `weakCards(8)` が 数学 6 / 言語 2 だった日がある）。朝に見る 3 問なので、
 * 「今日ある教科」→「まだ出していない教科」→「まだ出していないノート」の順に優先する。
 * 貪欲法で足りる ―― 3 問しか選ばないので、最適解を探す価値がない。
 */
function pickDiverse(pool: readonly WeakCard[], slots: readonly string[], count: number): WeakCard[] {
  const rest = [...pool];
  const picked: WeakCard[] = [];
  const usedSubject = new Set<string>();
  const usedNote = new Set<string>();
  const score = (c: WeakCard): number =>
    (slots.includes(c.subject) ? 0 : 1) * 4 +
    (usedSubject.has(c.subject) ? 1 : 0) * 2 +
    (usedNote.has(c.note_id) ? 1 : 0);

  while (picked.length < count && rest.length) {
    let best = 0;
    for (let i = 1; i < rest.length; i += 1) if (score(rest[i]) < score(rest[best])) best = i;
    const [one] = rest.splice(best, 1);
    picked.push(one);
    usedSubject.add(one.subject);
    usedNote.add(one.note_id);
  }
  return picked;
}

export function buildMorningBrief(opts: {
  date: ISODate;
  notes: readonly Note[];
  recallCount?: number;
  noticeWindowDays?: number;
}): MorningBrief | null {
  const { date, notes, recallCount = BRIEF_RECALL_COUNT, noticeWindowDays = BRIEF_NOTICE_WINDOW_DAYS } = opts;
  if (isWeekend(date)) return null;

  const weekday = dowOf(date);
  const slots = [...(TIMETABLE[weekday] ?? EMPTY_SLOTS)].filter((s): s is string => !!s);

  // 「間違えた問題」を先に積み、足りない分だけ未着手から補う。
  // 最初から未着手込みで取ると、解いた記録より新しいノートの問題が前に来てしまう。
  const tried = weakCards(notes, { limit: 20, includeUntried: false });
  const untried = weakCards(notes, { limit: 40, includeUntried: true });
  const seen = new Set<string>();
  const pool: WeakCard[] = [];
  [...tried, ...untried].forEach((c) => {
    if (seen.has(c.card_id)) return;
    seen.add(c.card_id);
    pool.push(c);
  });
  const cards = pickDiverse(pool, slots, recallCount);

  const from = isoShift(date, -noticeWindowDays);
  const notices: BriefNotice[] = notes
    .filter((n) => n.date >= from && n.date <= date && n.notice.trim())
    .map((n) => ({ subject: n.subject, notice: n.notice.trim(), today: slots.includes(n.subject) }))
    .sort((a, b) => Number(b.today) - Number(a.today));

  const lines: string[] = [];
  lines.push('### 今日の時間割');
  lines.push(slots.length ? slots.map((s, i) => `${i + 1} ${s}`).join(' / ') : '（時間割なし）');
  lines.push('');
  lines.push('### 持ち物・提出');
  if (notices.length) notices.slice(0, 3).forEach((n) => lines.push(`- ${n.subject}：${n.notice}`));
  else lines.push('- なし');
  lines.push('');
  lines.push(`### 思い出せるか（${cards.length}問）`);
  if (cards.length) cards.forEach((c) => lines.push(`- ${c.q}（${c.subject}・${c.unit}）`));
  else lines.push('- まだ問題がありません');

  return { date, weekday, slots, notices, cards, body: lines.join('\n') };
}
