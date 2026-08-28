import { describe, expect, it } from 'vitest';

import {
  CLAWD_PROMPTS,
  clawdCheerText,
  clawdHello,
  clawdPoke,
  clawdReply,
} from '../clawdTalk';

describe('clawdCheerText — 片づけたときの一言', () => {
  it('通し番号で回り、同じ番号なら必ず同じ言葉（乱数を使わない）', () => {
    expect(clawdCheerText(0, false)).toBe(clawdCheerText(0, false));
    expect(clawdCheerText(0, false)).not.toBe(clawdCheerText(1, false));
  });

  it('全部片づけた回は別の言葉になる', () => {
    expect(clawdCheerText(0, true)).not.toBe(clawdCheerText(0, false));
    expect(clawdCheerText(0, true)).toContain('やりきった');
  });

  it('番号が負・巨大・NaN でも落ちない', () => {
    for (const n of [-1, -999, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typeof clawdCheerText(n, false)).toBe('string');
      expect(clawdCheerText(n, false).length).toBeGreaterThan(0);
    }
  });

  it('煽らない ―― 残り件数を数える言い方を混ぜていない', () => {
    // 「あと3件！」のような言い方は、残りが多い日ほど嘘になる（clawdTalk.ts の方針 2）
    for (let n = 0; n < 24; n += 1) {
      expect(clawdCheerText(n, false)).not.toMatch(/あと\d|残り\d/);
    }
  });
});

describe('clawdHello — 時間帯の挨拶', () => {
  it('朝・昼・夕・夜で言葉が変わる', () => {
    const morning = clawdHello(8);
    const day = clawdHello(13);
    const evening = clawdHello(19);
    const night = clawdHello(2);
    expect(new Set([morning, day, evening, night]).size).toBe(4);
    expect(morning).toContain('おはよう');
  });

  it('境界（5 / 11 / 17 / 23）で切り替わる', () => {
    expect(clawdHello(4)).toBe(clawdHello(23));
    expect(clawdHello(5)).not.toBe(clawdHello(4));
    expect(clawdHello(10)).toBe(clawdHello(5));
    expect(clawdHello(11)).not.toBe(clawdHello(10));
    expect(clawdHello(16)).toBe(clawdHello(11));
    expect(clawdHello(17)).not.toBe(clawdHello(16));
    expect(clawdHello(22)).toBe(clawdHello(17));
    expect(clawdHello(23)).not.toBe(clawdHello(22));
  });

  it('壊れた時刻は昼として扱う', () => {
    expect(clawdHello(Number.NaN)).toBe(clawdHello(12));
  });
});

describe('clawdPoke / clawdReply — 触れ合い', () => {
  it('続けて触ると言葉が変わる', () => {
    expect(clawdPoke(0)).not.toBe(clawdPoke(1));
  });

  it('話しかけはどれも返しを 1 つ以上持つ', () => {
    expect(CLAWD_PROMPTS.length).toBeGreaterThan(0);
    CLAWD_PROMPTS.forEach((p) => {
      expect(p.say.length).toBeGreaterThan(0);
      expect(p.reply.length).toBeGreaterThan(0);
      p.reply.forEach((r) => expect(r.length).toBeGreaterThan(0));
    });
  });

  it('同じボタンを続けて押しても返しが回る', () => {
    const p = CLAWD_PROMPTS.find((x) => x.reply.length > 1)!;
    expect(clawdReply(p, 0)).not.toBe(clawdReply(p, 1));
    expect(clawdReply(p, 0)).toBe(clawdReply(p, p.reply.length));
  });
});
