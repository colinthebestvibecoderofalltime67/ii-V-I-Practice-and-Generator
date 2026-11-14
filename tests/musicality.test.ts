import { describe, expect, it } from 'vitest';
import { lickMetrics, summarize } from '../src/analysis/musicality';
import type { Lick, LickChord, LickNote } from '../src/types';

const chords: LickChord[] = [
  { rootPc: 2, quality: 'm7', symbol: 'Dm7', start: 0, dur: 48 },
  { rootPc: 7, quality: 'dom7alt', symbol: 'G7alt', start: 48, dur: 48 },
];
const mk = (notes: LickNote[], cellStarts: number[] = [0, 48]): Lick => ({
  version: 2, id: 't', seed: 1, progressionId: 'major-251-alt', length: 'standard', keyPc: 0, mode: 'major', requestedTier: 2,
  chords, notes, totalTicks: 96, fragmentIds: ['a', 'b'], cellStarts,
  difficulty: { score: 10, tier: 2, features: [] }, createdAt: 0,
});

describe('lickMetrics', () => {
  it('finds an anticipation tied over the chord change and the V arriving on its 3rd', () => {
    const l = mk([
      { midi: null, start: 0, dur: 42, chord: 0 },
      { midi: 71, start: 42, dur: 6, tie: true, chord: 0 },   // B on the "and" of 4, tied into G7alt (its 3rd)
      { midi: 71, start: 48, dur: 48, chord: 1 },
    ]);
    const m = lickMetrics(l);
    expect(m.anticipations).toBe(1);
    expect(m.startsWithRest).toBe(true);
    expect(m.dominantArrivalGuide).toEqual([true]);
  });
  it('counts a seam re-attack, natural 5 over 7alt on a beat, and a long chromatic note', () => {
    const l = mk([
      { midi: 62, start: 0, dur: 36, chord: 0 },
      { midi: 74, start: 36, dur: 12, chord: 0 },
      { midi: 74, start: 48, dur: 12, chord: 1 },   // same pitch re-attacked at the cell seam (D = natural 5 of G7alt)
      { midi: 66, start: 60, dur: 36, chord: 1 },   // F# held: not in G altered scale
    ]);
    const m = lickMetrics(l);
    expect(m.seamRepeats).toBe(1);
    expect(m.altNaturalOnBeat).toBe(1);
    expect(m.longChromaticOnBeat).toBe(2); // the natural 5 (D) and F♯ are both outside the altered scale, each held a beat
    expect(m.dominantArrivalGuide).toEqual([false]);
    expect(summarize([l]).seamRepeatShare).toBe(1);
  });
});
