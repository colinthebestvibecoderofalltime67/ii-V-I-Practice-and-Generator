/**
 * Guards the 12-ticks-per-beat grid migration: behaviour must be identical to the old 16th-note grid
 * (4 ticks per beat). The numbers below were dumped from the pre-migration code (seeded RNG, so deterministic).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadPrototypeLicks } from '../scripts/legacy';
import { SWING_RATIO, tickToBeats } from '../src/audio/timing';
import { scoreLick } from '../src/difficulty/score';
import { lickToMidi } from '../src/export/midi';
import { AUTHORED_FRAGMENTS, AUTHORED_UNIT, FRAGMENTS, fromSixteenths } from '../src/fragments';
import { TRIPLET_FRAGMENTS } from '../src/fragments/lib/triplets';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { barOf, beatOf, splitDur } from '../src/theory/rhythm';
import { expandProgression, getProgression } from '../src/theory/progressions';
import { RENDERABLE_DURS, TICKS_PER_16TH, TPB, TPBAR, TRIPLET_DURS, type LickNote } from '../src/types';

const range = concertRange(getInstrument('tenor'));
// The pinned licks below were produced before the triplet library existed, so they are generated from the 16th-grid
// libraries only (same pool as then). Adding fragments to the pool legitimately changes seeded output.
const LEGACY_POOL = AUTHORED_FRAGMENTS.map(fromSixteenths);

describe('grid constants', () => {
  it('are consistent', () => {
    expect(TPB).toBe(12);
    expect(TPBAR).toBe(4 * TPB);
    expect(TICKS_PER_16TH).toBe(TPB / 4);
    expect([...RENDERABLE_DURS]).toEqual([3, 6, 9, 12, 18, 24, 36, 48]);
    expect([...TRIPLET_DURS]).toEqual([2, 4, 8]);
    expect(AUTHORED_UNIT).toBe(TICKS_PER_16TH);
  });
  it('three triplet notes fill an 8th, a quarter or a half', () => {
    for (const d of TRIPLET_DURS) expect((3 * d) % (TPB / 2)).toBe(0);
  });
});

describe('splitDur / bar helpers', () => {
  it('splits greedily into renderable values', () => {
    expect(splitDur(0)).toEqual([]);
    expect(splitDur(3)).toEqual([3]);
    expect(splitDur(15)).toEqual([12, 3]);
    expect(splitDur(30)).toEqual([24, 6]);
    expect(splitDur(48)).toEqual([48]);
    expect(splitDur(66)).toEqual([48, 18]);
    for (let d = 3; d <= 96; d += 3) {
      const parts = splitDur(d);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(d);
      for (const p of parts) expect((RENDERABLE_DURS as readonly number[]).includes(p)).toBe(true);
    }
  });
  it('throws (never returns undefined/NaN) for durations it cannot express', () => {
    expect(() => splitDur(1)).toThrow(/splitDur/);
    expect(() => splitDur(4)).toThrow(/splitDur/);
    expect(() => splitDur(Number.NaN)).toThrow(/splitDur/);
    expect(() => splitDur(-3)).toThrow(/splitDur/);
  });
  it('beatOf / barOf', () => {
    expect([beatOf(0), beatOf(11), beatOf(12), barOf(47), barOf(48), barOf(95), barOf(96)]).toEqual([0, 0, 1, 0, 1, 1, 2]);
  });
});

describe('fragments are authored in 16ths and scaled on load', () => {
  it('scales every duration by 3 without mutating the authored data', () => {
    // FRAGMENTS = scaled 16th-grid libraries + the triplet library (already on the engine grid, appended last)
    expect(FRAGMENTS.length).toBe(AUTHORED_FRAGMENTS.length + TRIPLET_FRAGMENTS.length);
    FRAGMENTS.slice(0, AUTHORED_FRAGMENTS.length).forEach((f, i) => {
      const a = AUTHORED_FRAGMENTS[i];
      expect(f.id).toBe(a.id);
      expect(f.notes.length).toBe(a.notes.length);
      f.notes.forEach((n, k) => {
        expect(n.dur).toBe(a.notes[k].dur * 3);
        expect(n.rel).toBe(a.notes[k].rel);
        expect(n.tie).toBe(a.notes[k].tie);
      });
      expect(a.notes.reduce((s, n) => s + n.dur, 0)).toBe(a.beats * 4);
    });
  });
  it('fromSixteenths is pure', () => {
    const src = { id: 'x', qualities: ['m7' as const], beats: 2 as const, notes: [{ rel: 0, dur: 4 }, { rel: 3, dur: 4 }], tags: [], level: 1 as const, source: 'original' as const };
    const out = fromSixteenths(src);
    expect(out.notes.map(n => n.dur)).toEqual([12, 12]);
    expect(src.notes.map(n => n.dur)).toEqual([4, 4]);
  });
});

describe('tickToBeats is unchanged on scaled ticks', () => {
  // the pre-migration implementation, on 16th-note ticks
  const old = (tick: number, swing: boolean): number => {
    if (!swing) return tick / 4;
    const beat = Math.floor(tick / 4);
    const r = tick - beat * 4;
    const off = r === 0 ? 0 : r === 1 ? SWING_RATIO / 2 : r === 2 ? SWING_RATIO : SWING_RATIO + (1 - SWING_RATIO) / 2;
    return beat + off;
  };
  for (const swing of [false, true]) {
    it(`swing=${swing}`, () => {
      for (let t = 0; t < 48; t++) expect(tickToBeats(t * 3, swing)).toBe(old(t, swing));
    });
  }
  it('interpolates between 16ths (for upcoming triplets) and stays monotonic', () => {
    expect(tickToBeats(2, false)).toBeCloseTo(1 / 6);
    for (let t = 1; t < 96; t++) expect(tickToBeats(t, true)).toBeGreaterThan(tickToBeats(t - 1, true));
  });
});

describe('scoreLick on the prototype licks equals the pre-migration scores', () => {
  const prog = getProgression('major-251');
  const chords = expandProgression(prog, 'standard', 0);
  const expected: Record<number, number> = {
    0: 0.2, 1: 0.8, 2: 0.8, 3: 13.6, 4: 1.8, 5: 0, 6: 6, 7: 0, 8: 3.2, 9: 6.9, 40: 9.7, 41: 15, 42: 5.8, 43: 13.7, 44: 35.4,
  };
  const licks = loadPrototypeLicks();
  for (const [i, score] of Object.entries(expected)) {
    it(`prototype lick ${i}`, () => {
      const notes: LickNote[] = licks[+i].notes.map(n => ({
        midi: n.midi, start: n.start, dur: n.dur, ...(n.tie ? { tie: true } : {}), chord: Math.min(2, Math.floor(n.start / TPBAR)),
      }));
      expect(notes.every(n => n.start % 3 === 0 && n.dur % 3 === 0)).toBe(true);
      expect(scoreLick(notes, chords, prog).score).toBe(score);
    });
  }
});

describe('generator output on the new grid', () => {
  const lick = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 3, range, seed: 3, fragments: LEGACY_POOL });
  it('is version 2 and every start/dur is a multiple of a 16th (3 ticks)', () => {
    expect(lick.version).toBe(2);
    expect(lick.totalTicks).toBe(3 * TPBAR);
    for (const n of lick.notes) {
      expect(n.start % 3).toBe(0);
      expect(n.dur % 3).toBe(0);
      expect((RENDERABLE_DURS as readonly number[]).includes(n.dur)).toBe(true);
      expect(barOf(n.start)).toBe(barOf(n.start + n.dur - 1));
    }
    for (const c of lick.chords) { expect(c.start % TPB).toBe(0); expect(c.dur % TPB).toBe(0); }
    for (const s of lick.cellStarts!) expect(s % TPB).toBe(0);
  });
  it('reproduces the pre-migration lick (seed 3, tier 3, key C, tenor range)', () => {
    expect(lick.fragmentIds).toEqual(['m7-proto-48', 'dom7-orig-17', 'maj7-proto-51']);
    expect(lick.cellStarts).toEqual([0, 48, 96]);
    expect(lick.difficulty.score).toBe(21.4);
    expect(lick.notes.slice(0, 4).map(n => [n.midi, n.start, n.dur])).toEqual([[null, 0, 6], [52, 6, 6], [55, 12, 6], [57, 18, 6]]);
    expect(lick.notes.length).toBe(18);
  });
  it('exports byte-identical MIDI (sha1 of files dumped before the migration)', () => {
    const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 4, range, seed: 3, fragments: LEGACY_POOL });
    expect(l.difficulty.score).toBe(47.1);
    const sha = (swing: boolean, comping: boolean) =>
      createHash('sha1').update(lickToMidi(l, { bpm: 120, swing, comping, comp: 'rootless' })).digest('hex');
    expect(sha(false, false)).toBe('b570709e2eba449b99a5bd5af6be5616de8d8c52');
    expect(sha(false, true)).toBe('fbf67a38d22331d40dcea3accb3c20ae007c3c3e');
    expect(sha(true, false)).toBe('a97603c03f93d97ef7ef3d0c9363f092411fb10e');
    expect(sha(true, true)).toBe('0b2e21a2a22f5351b687ea139e4c2c809b05a83a');
  });
});
