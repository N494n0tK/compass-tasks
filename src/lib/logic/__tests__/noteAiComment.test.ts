import { describe, expect, it } from 'vitest';

import {
  parseNoteAiComment,
  shouldUseNoteAiBlockComment,
  type NoteAiBlock,
} from '../noteAiComment';

/** 行の中身を `//` の後ろに出る素のテキストに戻す（記号を落としたぶんも込み） */
function textOf(b: NoteAiBlock): string {
  return b.kind === 'line' ? b.spans.map((s) => s.text).join('') : '';
}

describe('parseNoteAiComment（AI の添削 → コメント行。ux-refresh.md §8）', () => {
  it('1 行 = 1 コメント行。前後の空白は落ちる', () => {
    const b = parseNoteAiComment('  電気陰性度の差が大きい  \n共有結合は電子を出し合う');
    expect(b.map((x) => x.kind)).toEqual(['line', 'line']);
    expect(textOf(b[0])).toBe('電気陰性度の差が大きい');
    expect(textOf(b[1])).toBe('共有結合は電子を出し合う');
  });

  it('空行は段の切れ目として残る（連続しても 1 つぶん）', () => {
    const b = parseNoteAiComment('一段め\n\n\n二段め');
    expect(b.map((x) => x.kind)).toEqual(['line', 'gap', 'line']);
  });

  it('先頭と末尾の空行は落とす（区画の間の余白は紙面側が持つ）', () => {
    const b = parseNoteAiComment('\n\n添削\n\n');
    expect(b.map((x) => x.kind)).toEqual(['line']);
  });

  it('中身が無ければ空配列（呼ぶ側は「添削なし」として何も出さない）', () => {
    expect(parseNoteAiComment('')).toEqual([]);
    expect(parseNoteAiComment(null)).toEqual([]);
    expect(parseNoteAiComment('  \n\n \n')).toEqual([]);
  });

  it('既定の調子は note（灰）。ふつうの補足に色は乗らない', () => {
    const b = parseNoteAiComment('板書では省かれたが、教科書 p.62 に図がある');
    expect(b[0]).toMatchObject({ kind: 'line', tone: 'note' });
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].spans.every((s) => s.tone === 'note')).toBe(true);
  });

  it('訂正の定型文「正しくは」は warn へ倒す（spec §3.8 の型）', () => {
    const b = parseNoteAiComment('ノートは 3 mol だが正しくは 2 mol');
    expect(b[0]).toMatchObject({ tone: 'warn' });
  });

  it('誤り・注意・重要・抜けの語も warn へ倒す', () => {
    for (const s of ['ここは誤り', '符号に注意', '重要: 定義の向き', 'この条件がノートから抜けている']) {
      expect(parseNoteAiComment(s)[0]).toMatchObject({ tone: 'warn' });
    }
  });

  it('行頭の ! ※ × は warn。印そのものは落とさない（なぜ色が付いたかを残す）', () => {
    const b = parseNoteAiComment('! 単位が違う\n※ 例外あり\n× 逆向き');
    expect(b.map((x) => (x.kind === 'line' ? x.tone : null))).toEqual(['warn', 'warn', 'warn']);
    expect(textOf(b[0])).toBe('! 単位が違う');
    expect(textOf(b[1])).toBe('※ 例外あり');
  });

  it('当たりすぎる語は warn にしない（否定文のたびに紫になっては「重要」が消える）', () => {
    expect(parseNoteAiComment('これはイオン結合ではない')[0]).toMatchObject({ tone: 'note' });
  });

  it('言い換え・用語は term（色は持たず、灰が一段明るくなるだけの段）', () => {
    expect(parseNoteAiComment('アニミズムとは霊が宿るとする考え方')[0]).toMatchObject({ tone: 'term' });
    expect(parseNoteAiComment('= anima（ラテン語で霊魂）')[0]).toMatchObject({ tone: 'term' });
  });

  it('warn は term より強い（両方当たったら warn）', () => {
    expect(parseNoteAiComment('すなわち、ここは誤り')[0]).toMatchObject({ tone: 'warn' });
  });

  it('**…** は語だけを warn にする。行は note のまま（差し色を 1 語ぶんだけ使う）', () => {
    const b = parseNoteAiComment('酸化数は **+2** で数える');
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].tone).toBe('note');
    expect(b[0].spans).toEqual([
      { text: '酸化数は ', tone: 'note' },
      { text: '+2', tone: 'warn' },
      { text: ' で数える', tone: 'note' },
    ]);
  });

  it('**…** の記号は落とし、【…】の記号は残す（後者は語の切れ目として読む）', () => {
    const b = parseNoteAiComment('【自由電子】金属の中を動ける電子');
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].spans).toEqual([
      { text: '【自由電子】', tone: 'term' },
      { text: '金属の中を動ける電子', tone: 'note' },
    ]);
  });

  it('閉じない ** は記号として読まない（そのまま字として出る）', () => {
    const b = parseNoteAiComment('計算は 2**3 のつもり');
    expect(textOf(b[0])).toBe('計算は 2**3 のつもり');
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].spans.every((s) => s.tone === 'note')).toBe(true);
  });

  it('行の調子が warn なら、その行の断片はすべて warn（行内の印より弱くならない）', () => {
    const b = parseNoteAiComment('正しくは 【共有結合】 と呼ぶ');
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].tone).toBe('warn');
    expect(b[0].spans.every((s) => s.tone === 'warn')).toBe(true);
  });

  it('$…$ の中身は素通し。中の ** や 【】は記号として読まない', () => {
    const b = parseNoteAiComment('係数は $a**b$ と $c$ で $【x】$');
    expect(textOf(b[0])).toBe('係数は $a**b$ と $c$ で $【x】$');
  });

  it('数式の中の手がかり語で調子を倒さない（\\mathrm{注意} で紫にならない）', () => {
    expect(parseNoteAiComment('$\\mathrm{注意}$ は式の中の字')[0]).toMatchObject({ tone: 'note' });
  });

  it('強調が数式をまたいでも壊れない（数式は素通しのまま調子だけ乗る）', () => {
    const b = parseNoteAiComment('**式は $x^2$ だ**');
    if (b[0].kind !== 'line') throw new Error('line を期待');
    expect(b[0].spans).toEqual([{ text: '式は $x^2$ だ', tone: 'warn' }]);
  });

  it('行をまたぐ $$…$$ は 1 行に畳む（行に割ると数式が壊れる）', () => {
    const b = parseNoteAiComment('公式は\n$$\na^2+b^2=c^2\n$$');
    expect(b.map((x) => x.kind)).toEqual(['line', 'line']);
    expect(textOf(b[1])).toBe('$$\na^2+b^2=c^2\n$$');
  });

  it('1 行に収まる $$…$$ はそのまま 1 行', () => {
    const b = parseNoteAiComment('公式は\n$$a^2+b^2=c^2$$');
    expect(b).toHaveLength(2);
    expect(textOf(b[1])).toBe('$$a^2+b^2=c^2$$');
  });

  it('CRLF でも行の割り方は変わらない', () => {
    const b = parseNoteAiComment('一行め\r\n\r\n二行め');
    expect(b.map((x) => x.kind)).toEqual(['line', 'gap', 'line']);
  });
});

describe('数式の取り違え（行を畳む判定）', () => {
  it('隣り合ったインライン数式を「開いた $$」と読み違えない', () => {
    // `$a$$b$` の境目は別行立ての開きではない。素朴に `$$` を数えると
    // ここから下の行が全部 1 本に融合していた
    const out = parseNoteAiComment('係数 $a$$b$ を見よ\n二行め\n三行め');
    const lines = out.filter((b) => b.kind === 'line');
    expect(lines.length).toBe(3);
  });

  it('本当に行をまたぐ別行立ては 1 行に畳む', () => {
    const out = parseNoteAiComment('式は $$\nx = 1\n$$ である\n次の行');
    const lines = out.filter((b) => b.kind === 'line');
    expect(lines.length).toBe(2);
  });

  it('閉じないまま終わっても落ちない', () => {
    expect(() => parseNoteAiComment('開いたまま $$\nx = 1')).not.toThrow();
    expect(() => parseNoteAiComment('価格は $100 です')).not.toThrow();
  });
});

describe('短い行コメント / 長いブロックコメントの切り替え', () => {
  it('短い添削は // のまま', () => {
    const src = '正しくは 2 mol';
    expect(shouldUseNoteAiBlockComment(src, parseNoteAiComment(src))).toBe(false);
  });

  it('4行以上はブロックコメントにする', () => {
    const src = '一行め\n二行め\n三行め\n四行め';
    expect(shouldUseNoteAiBlockComment(src, parseNoteAiComment(src))).toBe(true);
  });

  it('1行でも長文ならブロックコメントにする', () => {
    const src = '長い補足'.repeat(25);
    expect(shouldUseNoteAiBlockComment(src, parseNoteAiComment(src))).toBe(true);
  });
});
