import { describe, expect, it } from 'vitest';
import { buildMorningBrief } from '../morningBrief';
import type { Note, NoteCard } from '../../model/notes';

/** 2026-08-28 は金曜（時間割: 現国/体育/地総/英コ/数学/LHR） */
const FRI = '2026-08-28';
const SAT = '2026-08-29';

function card(id: string, q: string): NoteCard {
  return { cardId: id, q, a: '答', guide: '', src: '', origin: 'ai', attempts: [] };
}

function note(over: Partial<Note> & Pick<Note, 'id' | 'subject'>): Note {
  return {
    v: 1,
    date: '2026-08-27',
    unit: '単元',
    scans: [],
    cards: [],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-27',
    updatedAt: '2026-08-27',
    trashedAt: '',
    ...over,
  } as Note;
}

describe('buildMorningBrief', () => {
  it('土日は作らない', () => {
    expect(buildMorningBrief({ date: SAT, notes: [] })).toBeNull();
  });

  it('今日の時間割を空きコマ抜きで並べる', () => {
    const b = buildMorningBrief({ date: FRI, notes: [] });
    expect(b?.weekday).toBe('金');
    expect(b?.slots).toEqual(['現国', '体育', '地総', '英コ', '数学', 'LHR']);
    // 7 コマ目の null は落ちている
    expect(b?.slots).toHaveLength(6);
  });

  it('問題が無い日でも本文は成立する', () => {
    const b = buildMorningBrief({ date: FRI, notes: [] });
    expect(b?.body).toContain('### 今日の時間割');
    expect(b?.body).toContain('- なし');
    expect(b?.body).toContain('- まだ問題がありません');
  });

  it('3 問が 1 冊のノートに固まらない', () => {
    const notes = [
      note({ id: 'a', subject: '数学', unit: '三角', cards: [card('a1', 'Q1'), card('a2', 'Q2'), card('a3', 'Q3')] }),
      note({ id: 'b', subject: '数学', unit: '数列', cards: [card('b1', 'Q4'), card('b2', 'Q5')] }),
    ];
    const b = buildMorningBrief({ date: FRI, notes });
    expect(b?.cards).toHaveLength(3);
    expect(new Set(b?.cards.map((c) => c.note_id)).size).toBeGreaterThan(1);
  });

  it('今日ある教科を先に出す', () => {
    const notes = [
      // 言語は金曜の時間割に無い / 数学はある
      note({ id: 'x', subject: '言語', cards: [card('x1', '言語の問')] }),
      note({ id: 'y', subject: '数学', cards: [card('y1', '数学の問')] }),
    ];
    const b = buildMorningBrief({ date: FRI, notes, recallCount: 1 });
    expect(b?.cards[0].subject).toBe('数学');
  });

  it('連絡は直近だけ拾い、今日ある教科を先に並べる', () => {
    const notes = [
      note({ id: 'p', subject: '言語', date: '2026-08-27', notice: '古文単語テスト' }),
      note({ id: 'q', subject: '数学', date: '2026-08-27', notice: 'プリント提出' }),
      note({ id: 'r', subject: '数学', date: '2026-08-01', notice: '大昔の連絡' }),
    ];
    const b = buildMorningBrief({ date: FRI, notes });
    expect(b?.notices.map((n) => n.notice)).toEqual(['プリント提出', '古文単語テスト']);
    expect(b?.body).toContain('- 数学：プリント提出');
  });

  it('連絡の窓は日数で切れる', () => {
    const notes = [note({ id: 'p', subject: '数学', date: '2026-08-20', notice: '8日前の連絡' })];
    expect(buildMorningBrief({ date: FRI, notes })?.notices).toHaveLength(0);
    expect(buildMorningBrief({ date: FRI, notes, noticeWindowDays: 10 })?.notices).toHaveLength(1);
  });

  it('問題文をそのまま本文に載せる（言い換えない）', () => {
    const notes = [note({ id: 'y', subject: '数学', unit: '三角', cards: [card('y1', '加法定理とは何か')] })];
    const b = buildMorningBrief({ date: FRI, notes });
    expect(b?.body).toContain('- 加法定理とは何か（数学・三角）');
  });
});
