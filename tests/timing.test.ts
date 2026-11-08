import { describe, expect, it } from 'vitest';
import { SWING_RATIO, soundingNotes, tickToBeats } from '../src/audio/timing';
import type { Lick, LickNote } from '../src/types';

describe('tickToBeats', () => {
  it('is linear when straight', () => {
    for (let t = 0; t < 48; t++) expect(tickToBeats(t, false)).toBe(t / 4);
  });
  it('swings off-beat eighths and sixteenths', () => {
    expect(tickToBeats(0, true)).toBe(0);
    expect(tickToBeats(2, true)).toBeCloseTo(SWING_RATIO);
    expect(tickToBeats(1, true)).toBeCloseTo(SWING_RATIO / 2);
    expect(tickToBeats(3, true)).toBeCloseTo(SWING_RATIO + (1 - SWING_RATIO) / 2);
    expect(tickToBeats(6, true)).toBeCloseTo(1 + SWING_RATIO);
    expect(tickToBeats(4, true)).toBe(1);
  });
  it('is monotonic and keeps beats fixed', () => {
    for (let t = 1; t < 64; t++) expect(tickToBeats(t, true)).toBeGreaterThan(tickToBeats(t - 1, true));
    for (let b = 0; b < 16; b++) expect(tickToBeats(b * 4, true)).toBe(b);
  });
});

describe('soundingNotes', () => {
  it('merges ties and skips rests', () => {
    const notes: LickNote[] = [
      { midi: 60, start: 0, dur: 4, chord: 0 },
      { midi: null, start: 4, dur: 4, chord: 0 },
      { midi: 62, start: 8, dur: 4, tie: true, chord: 0 },
      { midi: 62, start: 12, dur: 4, tie: true, chord: 0 },
      { midi: 62, start: 16, dur: 8, chord: 1 },
      { midi: 64, start: 24, dur: 8, chord: 1 },
    ];
    const s = soundingNotes({ notes });
    expect(s).toEqual([
      { midi: 60, start: 0, dur: 4, indices: [0] },
      { midi: 62, start: 8, dur: 16, indices: [2, 3, 4] },
      { midi: 64, start: 24, dur: 8, indices: [5] },
    ]);
  });
  it('does not merge a same-pitch note after an untied one', () => {
    const notes: LickNote[] = [
      { midi: 60, start: 0, dur: 4, chord: 0 },
      { midi: 60, start: 4, dur: 4, chord: 0 },
    ];
    expect(soundingNotes({ notes } as Pick<Lick, 'notes'>)).toHaveLength(2);
  });
});
