import { describe, expect, it } from 'vitest';
import { drumEvents } from '../src/audio/drums';
import { makeTimeline } from '../src/audio/timing';
import { TPB, TPBAR } from '../src/types';

describe('drumEvents', () => {
  const ev = drumEvents(2 * TPBAR, { seed: 5 });
  const of = (k: string) => ev.filter(e => e.kind === k).map(e => e.tick);

  it('rides every beat plus the "and" of 2 and 4', () => {
    expect(of('ride')).toEqual([0, 12, 18, 24, 36, 42, 48, 60, 66, 72, 84, 90]);
  });
  it('hi-hat chick on 2 and 4 only', () => {
    expect(of('hat')).toEqual([12, 36, 60, 84]);
  });
  it('soft kick on every beat', () => {
    expect(of('kick')).toEqual([0, 12, 24, 36, 48, 60, 72, 84]);
    expect(ev.filter(e => e.kind === 'kick').every(e => e.vel <= 0.25)).toBe(true);
  });
  it('ghosted snare: 1..3 per bar, quiet, on the swung "and"s', () => {
    for (let bar = 0; bar < 2; bar++) {
      const s = ev.filter(e => e.kind === 'snare' && Math.floor(e.tick / TPBAR) === bar);
      expect(s.length).toBeGreaterThanOrEqual(1);
      expect(s.length).toBeLessThanOrEqual(3);
      expect(s.every(e => e.tick % TPB === 6 && e.vel < 0.4)).toBe(true);
    }
  });
  it('is deterministic per seed and varies between seeds', () => {
    expect(drumEvents(2 * TPBAR, { seed: 5 })).toEqual(ev);
    const snares = (seed: number) => JSON.stringify(drumEvents(8 * TPBAR, { seed }).filter(e => e.kind === 'snare'));
    expect(snares(6)).not.toBe(snares(5));
  });
  it('options switch kick and snare off; accepts chords; stays within the lick', () => {
    const bare = drumEvents(TPBAR, { kick: false, snare: false });
    expect(bare.some(e => e.kind === 'kick' || e.kind === 'snare')).toBe(false);
    const chords = [{ rootPc: 0, quality: 'm7', symbol: 'x', start: 0, dur: TPBAR }] as never;
    expect(drumEvents(chords, { seed: 1 })).toEqual(drumEvents(TPBAR, { seed: 1 }));
    expect(ev.every(e => e.tick >= 0 && e.tick < 2 * TPBAR)).toBe(true);
  });
  it('the skip note sits a triplet-eighth after the beat on the swing timeline', () => {
    const tl = makeTimeline([], { swing: true, straight16: true });
    expect(tl(18) - tl(12)).toBeCloseTo(2 / 3, 6);
  });
});
