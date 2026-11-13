import { describe, expect, it } from 'vitest';
import { SWING_RATIO, makeTimeline, soundingNotes, tickToBeats } from '../src/audio/timing';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import type { Lick, LickNote } from '../src/types';
import { TPB } from '../src/types';

describe('tickToBeats', () => {
  it('is linear when straight', () => {
    for (let t = 0; t < 144; t++) expect(tickToBeats(t, false)).toBe(t / TPB);
  });
  it('swings off-beat eighths and sixteenths (16th = 3 ticks)', () => {
    expect(tickToBeats(0, true)).toBe(0);
    expect(tickToBeats(6, true)).toBeCloseTo(SWING_RATIO);
    expect(tickToBeats(3, true)).toBeCloseTo(SWING_RATIO / 2);
    expect(tickToBeats(9, true)).toBeCloseTo(SWING_RATIO + (1 - SWING_RATIO) / 2);
    expect(tickToBeats(18, true)).toBeCloseTo(1 + SWING_RATIO);
    expect(tickToBeats(12, true)).toBe(1);
  });
  it('is monotonic and keeps beats fixed', () => {
    for (let t = 1; t < 192; t++) expect(tickToBeats(t, true)).toBeGreaterThan(tickToBeats(t - 1, true));
    for (let b = 0; b < 16; b++) expect(tickToBeats(b * TPB, true)).toBe(b);
  });
});

describe('soundingNotes', () => {
  it('merges ties and skips rests', () => {
    const notes: LickNote[] = [
      { midi: 60, start: 0, dur: 12, chord: 0 },
      { midi: null, start: 12, dur: 12, chord: 0 },
      { midi: 62, start: 24, dur: 12, tie: true, chord: 0 },
      { midi: 62, start: 36, dur: 12, tie: true, chord: 0 },
      { midi: 62, start: 48, dur: 24, chord: 1 },
      { midi: 64, start: 72, dur: 24, chord: 1 },
    ];
    const s = soundingNotes({ notes });
    expect(s).toEqual([
      { midi: 60, start: 0, dur: 12, indices: [0] },
      { midi: 62, start: 24, dur: 48, indices: [2, 3, 4] },
      { midi: 64, start: 72, dur: 24, indices: [5] },
    ]);
  });
  it('does not merge a same-pitch note after an untied one', () => {
    const notes: LickNote[] = [
      { midi: 60, start: 0, dur: 12, chord: 0 },
      { midi: 60, start: 12, dur: 12, chord: 0 },
    ];
    expect(soundingNotes({ notes } as Pick<Lick, 'notes'>)).toHaveLength(2);
  });
});

const nn = (start: number, dur: number) => ({ start, dur, midi: 60 });
const run = (starts: number[], len: number) => starts.map((s, i) => nn(s, (starts[i + 1] ?? len) - s));
const on = { swing: true, straight16: true };

describe('makeTimeline', () => {
  it('is linear with swing off', () => {
    const tl = makeTimeline(run([0, 3, 6, 9], 12), { swing: false, straight16: true });
    for (let t = 0; t < 12; t++) expect(tl(t)).toBe(t / TPB);
  });
  it('plays four 16ths straight, an 8th pair swung, dotted-8th + 16th straight', () => {
    const tl = makeTimeline(run([0, 3, 6, 9], 12), on);
    expect([0, 3, 6, 9].map(tl)).toEqual([0, 0.25, 0.5, 0.75]);
    expect([0, 6].map(makeTimeline(run([0, 6], 12), on))).toEqual([0, SWING_RATIO]);
    expect([0, 9].map(makeTimeline(run([0, 9], 12), on))).toEqual([0, 0.75]);
  });
  it('decides per beat in a mixed bar', () => {
    const tl = makeTimeline(run([0, 3, 6, 9, 12, 18], 24), on);
    expect(tl(6)).toBe(0.5);
    expect(tl(18)).toBeCloseTo(1 + SWING_RATIO);
    expect(tl(12)).toBe(1);
    const off = makeTimeline(run([0, 3, 6, 9, 12, 18], 24), { swing: true, straight16: false });
    expect(off(6)).toBeCloseTo(SWING_RATIO);
    expect(off(3)).toBeCloseTo(SWING_RATIO / 2);
  });
  it('keeps triplets exact thirds with swing on or off', () => {
    for (const swing of [true, false]) {
      for (const s16 of [true, false]) {
        const o = { swing, straight16: s16 };
        expect([0, 4, 8].map(makeTimeline(run([0, 4, 8], 12), o))).toEqual([0, 4 / 12, 8 / 12]);
        const q = makeTimeline([nn(0, 24), nn(24, 8), nn(32, 8), nn(40, 8), nn(48, 12)], o);
        expect([24, 32, 40, 48].map(q)).toEqual([24 / 12, 32 / 12, 40 / 12, 4]);
        const t16 = makeTimeline([nn(0, 2), nn(2, 2), nn(4, 2), nn(6, 6)], o);
        expect([0, 2, 4, 6].map(t16)).toEqual([0, 2 / 12, 4 / 12, 0.5]);
      }
    }
  });
  it('is monotonic with fixed beats, and straight16=false equals legacy tickToBeats (no triplets)', () => {
    const range = concertRange(getInstrument('tenor'));
    for (const tier of [1, 2, 3, 4] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const lick = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: seed % 12, tier, range, seed });
        const hasTriplet = lick.notes.some(n => n.dur % 3 !== 0);
        for (const s16 of [true, false]) {
          const tl = makeTimeline(lick.notes, { swing: true, straight16: s16 });
          for (let t = 1; t <= lick.totalTicks; t++) expect(tl(t)).toBeGreaterThan(tl(t - 1));
          for (let b = 0; b <= lick.totalTicks / TPB; b++) expect(tl(b * TPB)).toBe(b);
          if (!s16 && !hasTriplet) for (let t = 0; t <= lick.totalTicks; t++) expect(tl(t)).toBe(tickToBeats(t, true));
        }
      }
    }
  });
});
