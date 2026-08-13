import { describe, expect, it } from 'vitest';

import { parseNoteBody } from '../noteBody';

describe('parseNoteBody（本文の記法。spec §3.10 / N-141〜N-145）', () => {
  it('N-141 空行は余白として残る（連続しても 1 つぶん）', () => {
    const b = parseNoteBody('原始宗教\n\n\nアニミズム');
    expect(b.map((x) => x.kind)).toEqual(['lines', 'gap', 'lines']);
  });

  it('末尾と先頭の空行は落とす（区画の間は row-gap が持つ）', () => {
    const b = parseNoteBody('\n\nアニミズム\n\n');
    expect(b.map((x) => x.kind)).toEqual(['lines']);
  });

  it('N-142 行頭の空白 2 つでぶら下げが 1 段下がる（全角空白は 2 と数える）', () => {
    const b = parseNoteBody('アニミズム … 霊が宿る\n  = anima\n　ラテン語\n    タマ');
    if (b[0].kind !== 'lines') throw new Error('lines を期待');
    expect(b[0].lines.map((l) => l.depth)).toEqual([0, 1, 1, 2]);
    expect(b[0].lines[1].text).toBe('= anima');
  });

  it('N-143 行頭にすでに記号がある行・ぶら下げの行に「・」を打たない', () => {
    const b = parseNoteBody('○ アニミズム\n多神教\n  → 霊力を人格化\n① 第一\n- ダッシュ');
    if (b[0].kind !== 'lines') throw new Error('lines を期待');
    expect(b[0].lines.map((l) => l.bullet)).toEqual([false, true, false, false, false]);
  });

  it('N-144 行頭 | が 2 行以上続くと表になる（--- の上が見出し）', () => {
    const b = parseNoteBody('| 語 | 意味 |\n| --- | --- |\n| anima | 霊魂 |\n| totem | 動植物 |');
    expect(b).toHaveLength(1);
    if (b[0].kind !== 'table') throw new Error('table を期待');
    expect(b[0].head).toEqual(['語', '意味']);
    expect(b[0].rows).toEqual([
      ['anima', '霊魂'],
      ['totem', '動植物'],
    ]);
  });

  it('区切り行が無い表は見出し無しで読む', () => {
    const b = parseNoteBody('| a | b |\n| c | d |');
    if (b[0].kind !== 'table') throw new Error('table を期待');
    expect(b[0].head).toBeNull();
    expect(b[0].rows).toHaveLength(2);
  });

  it('| で始まる行が 1 本だけなら表にしない（ただの行）', () => {
    const b = parseNoteBody('| これは表ではない |\n次の行');
    expect(b.map((x) => x.kind)).toEqual(['lines']);
  });

  it('表は前後の行と別のかたまりになる', () => {
    const b = parseNoteBody('三大宗教\n| 名 | 地域 |\n| --- | --- |\n| 仏教 | 東 |\nex. 開祖');
    expect(b.map((x) => x.kind)).toEqual(['lines', 'table', 'lines']);
  });

  it('N-145 複数行にまたがる $$…$$ は丸ごと raw で返す（行に割ると数式が壊れる）', () => {
    const b = parseNoteBody('公式\n$$\na^2+b^2\n$$');
    expect(b).toEqual([{ kind: 'raw', text: '公式\n$$\na^2+b^2\n$$' }]);
  });

  it('1 行に収まる $$…$$ は普通の行として読む', () => {
    const b = parseNoteBody('公式\n$$a^2+b^2=c^2$$');
    if (b[0].kind !== 'lines') throw new Error('lines を期待');
    expect(b[0].lines).toHaveLength(2);
  });

  it('空文字は空配列', () => {
    expect(parseNoteBody('')).toEqual([]);
    expect(parseNoteBody('   \n  ')).toEqual([]);
  });
});
