import { describe, expect, it } from 'vitest';
import {
  reduceClawdWorkPhase,
  WORK_INTRO_FRAMES,
  WORK_INTRO_MS,
  WORK_PACK_FRAMES,
  WORK_PACK_MS,
  WORK_FRAME_MS,
} from '../clawdWorkMotion';

describe('Clawd work motion', () => {
  it('keeps the source GIF timing in sync with the one-shot phases', () => {
    expect(WORK_INTRO_MS).toBe(WORK_INTRO_FRAMES * WORK_FRAME_MS);
    expect(WORK_PACK_MS).toBe(WORK_PACK_FRAMES * WORK_FRAME_MS);
    expect(WORK_INTRO_MS).toBe(1440);
    expect(WORK_PACK_MS).toBe(960);
  });

  it('opens once on the first start, then returns to typing', () => {
    expect(reduceClawdWorkPhase('intro', 'start')).toBe('intro');
    expect(reduceClawdWorkPhase('intro', 'intro-finished')).toBe('typing');
    expect(reduceClawdWorkPhase('typing', 'intro-finished')).toBe('typing');
  });

  it('packs when paused and stays packed after the one-shot ends', () => {
    expect(reduceClawdWorkPhase('typing', 'pause')).toBe('pack');
    expect(reduceClawdWorkPhase('pack', 'pack-finished')).toBe('packed');
    expect(reduceClawdWorkPhase('packed', 'pack-finished')).toBe('packed');
  });

  it('reopens from both packed and mid-pack states when resumed', () => {
    expect(reduceClawdWorkPhase('packed', 'start')).toBe('intro');
    expect(reduceClawdWorkPhase('pack', 'start')).toBe('intro');
    expect(reduceClawdWorkPhase('intro', 'pause')).toBe('pack');
  });

  it('ignores stale completion events after a newer transition', () => {
    // A pack timeout that fires after resume must not put the new intro back in
    // the packed state. The reducer is intentionally monotonic for these events.
    const resumed = reduceClawdWorkPhase('packed', 'start');
    expect(reduceClawdWorkPhase(resumed, 'pack-finished')).toBe('intro');
    expect(reduceClawdWorkPhase(resumed, 'intro-finished')).toBe('typing');
  });
});
