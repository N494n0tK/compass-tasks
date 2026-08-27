import { describe, expect, it } from 'vitest';
import { buildDrillItems, type DrillItem } from '../noteExtract';
import {
  buildSimilarPrompt,
  pickSimilarTargets,
  similarCopyHint,
  similarCopyToast,
  SIMILAR_TARGET_MAX,
} from '../similarPrompt';
import type { Note, NoteAttempt, NoteCard } from '../../model/notes';

function card(over: Partial<NoteCard> = {}): NoteCard {
  return { cardId: 'c0', q: 'Q', a: 'A', guide: '', src: '', origin: 'ai', attempts: [], ...over };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    v: 1,
    date: '2026-08-09',
    subject: '数学',
    unit: '数列',
    scans: [],
    cards: [card()],
    sections: [],
    summary: '',
    keywords: [],
    exercise: { q: '', a: '' },
    doubt: '',
    notice: '',
    createdAt: '2026-08-09',
    updatedAt: '2026-08-09',
    trashedAt: '',
    ...over,
  };
}

const at = (day: string, grade: NoteAttempt['grade']): NoteAttempt => ({ day, grade });

/** ノート 1 冊ぶんのカードから抽出項目を作る（画面が渡してくる形） */
const itemsOf = (cards: NoteCard[], over: Partial<Note> = {}): DrillItem[] =>
  buildDrillItems([note({ cards, ...over })], null);

describe('pickSimilarTargets', () => {
  it('一度も解いていない問題は対象外（未着手の「類題」は意味が薄い）', () => {
    const items = itemsOf([
      card({ cardId: 'new' }),
      card({ cardId: 'lo', attempts: [at('2026-08-07', 'low')] }),
    ]);
    expect(pickSimilarTargets(items).map((i) => i.cardId)).toEqual(['lo']);
  });

  it('△不安 → ○まあまあ の順に並ぶ', () => {
    const items = itemsOf([
      card({ cardId: 'mid', attempts: [at('2026-08-01', 'mid')] }),
      card({ cardId: 'lo', attempts: [at('2026-08-08', 'low')] }),
    ]);
    expect(pickSimilarTargets(items).map((i) => i.cardId)).toEqual(['lo', 'mid']);
  });

  it('◎ばっちりだけの問題は対象外', () => {
    const items = itemsOf([
      card({ cardId: 'hi', attempts: [at('2026-08-08', 'high')] }),
      card({ cardId: 'hi2', attempts: [at('2026-08-01', 'low'), at('2026-08-08', 'high')] }),
    ]);
    expect(pickSimilarTargets(items)).toEqual([]);
  });

  it('見るのは直近の記録だけ（前回が◎でも最後が△なら対象）', () => {
    const items = itemsOf([
      card({ cardId: 'back', attempts: [at('2026-08-01', 'high'), at('2026-08-08', 'low')] }),
    ]);
    expect(pickSimilarTargets(items).map((i) => i.cardId)).toEqual(['back']);
  });

  it('同順位のときは渡された並び（＝画面の並び）を保つ', () => {
    const items = itemsOf([
      card({ cardId: 'a', attempts: [at('2026-08-08', 'low')] }),
      card({ cardId: 'b', attempts: [at('2026-08-02', 'low')] }),
      card({ cardId: 'c', attempts: [at('2026-08-05', 'low')] }),
    ]);
    expect(pickSimilarTargets(items).map((i) => i.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('max 件で打ち切る（既定は SIMILAR_TARGET_MAX）', () => {
    const items = itemsOf(
      Array.from({ length: 8 }, (_, i) =>
        card({ cardId: 'c' + i, attempts: [at('2026-08-08', 'low')] }),
      ),
    );
    expect(pickSimilarTargets(items)).toHaveLength(SIMILAR_TARGET_MAX);
    expect(pickSimilarTargets(items, 2).map((i) => i.cardId)).toEqual(['c0', 'c1']);
    expect(pickSimilarTargets(items, 0)).toEqual([]);
  });

  it('演習は記録を持てないので自然に外れる', () => {
    const items = itemsOf([card({ cardId: 'lo', attempts: [at('2026-08-07', 'low')] })], {
      exercise: { q: '演習問題', a: '演習の答え' },
    });
    expect(items.map((i) => i.kind)).toEqual(['想起', '演習']);
    expect(pickSimilarTargets(items).map((i) => i.kind)).toEqual(['想起']);
  });

  it('元の配列を壊さない', () => {
    const items = itemsOf([
      card({ cardId: 'mid', attempts: [at('2026-08-01', 'mid')] }),
      card({ cardId: 'lo', attempts: [at('2026-08-08', 'low')] }),
    ]);
    const before = items.map((i) => i.cardId);
    pickSimilarTargets(items);
    expect(items.map((i) => i.cardId)).toEqual(before);
  });
});

describe('buildSimilarPrompt', () => {
  const targets = pickSimilarTargets(
    itemsOf(
      [
        card({
          cardId: 'lo',
          q: '$a_1=2,\\ a_{n+1}=a_n+3^n$ の一般項を求めよ。',
          a: '$a_n=\\dfrac{3^n+1}{2}$',
          attempts: [at('2026-08-07', 'low')],
        }),
        card({
          cardId: 'mid',
          q: '階差数列を使うのはどんな漸化式のときか？',
          a: '$a_{n+1}=a_n+f(n)$ の形のとき。',
          attempts: [at('2026-08-01', 'mid')],
        }),
      ],
      { subject: '数学', unit: '漸化式と一般項' },
    ),
  );
  const prompt = buildSimilarPrompt(targets);

  it('対象の問題文・模範解答・教科・単元がそのまま載る', () => {
    targets.forEach((t) => {
      expect(prompt).toContain(t.q);
      expect(prompt).toContain(t.a);
    });
    expect(prompt).toContain('数学');
    expect(prompt).toContain('漸化式と一般項');
  });

  it('役割と目的を冒頭で名乗る', () => {
    expect(prompt.startsWith('あなたは高校生の家庭教師です。')).toBe(true);
  });

  it('件数を埋め、プレースホルダを残さない', () => {
    expect(prompt).toContain('苦手な問題（2問）');
    expect(prompt).not.toContain('__N__');
    expect(prompt).not.toContain('__M__');
  });

  it('1問につき類題2問・合計問数を要求する', () => {
    expect(prompt).toContain('類題を2問');
    expect(prompt).toContain('合計4問'); // 2 問 × 2
  });

  it('難易度・解説・対応表を要求する', () => {
    expect(prompt).toContain('同等〜やや易しめ');
    expect(prompt).toContain('2〜3行');
    expect(prompt).toContain('元の問題 → 作った類題');
  });

  it('LaTeX の書き方を指示し、バックスラッシュは1個と断る（JSONではないので）', () => {
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('$$...$$');
    expect(prompt).toContain('LaTeX');
    expect(prompt).toContain('バックスラッシュは1個');
  });

  it('JSON を要求しない（類題はアプリに取り込まない）', () => {
    expect(prompt).toContain('出力は普通の文章で');
    expect(prompt).toContain('JSONにはしない');
    expect(prompt).not.toContain('compass-note@');
    expect(prompt).not.toContain('"schema"');
  });

  it('番号は 1 始まりで、対象の数だけ見出しが並ぶ', () => {
    expect(prompt).toContain('## 問題1 ── 数学 ／ 漸化式と一般項');
    expect(prompt).toContain('## 問題2 ── 数学 ／ 漸化式と一般項');
    expect(prompt).not.toContain('## 問題3');
  });

  it('解答が空のときも黙って落とさず、断り書きを入れる', () => {
    const empty = pickSimilarTargets(
      itemsOf([card({ cardId: 'x', q: '問', a: '  ', attempts: [at('2026-08-07', 'low')] })]),
    );
    expect(buildSimilarPrompt(empty)).toContain('解答が書かれていません');
  });

  it('対象が空なら空文字（UI ではボタンが押せない）', () => {
    expect(buildSimilarPrompt([])).toBe('');
  });
});

describe('表示用の文言', () => {
  it('件数入りのトースト', () => {
    expect(similarCopyToast(3)).toBe(
      '類題プロンプトをコピーしました(3問ぶん)。ChatGPTに貼ってください',
    );
  });

  it('0 件のときは押せない理由になる', () => {
    expect(similarCopyHint(0)).toContain('対象がありません');
    expect(similarCopyHint(2)).toContain('2問');
  });
});
