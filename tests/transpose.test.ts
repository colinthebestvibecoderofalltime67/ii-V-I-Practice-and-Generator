import { describe, it, expect } from 'vitest';
import { generateLick, transposeLick } from '../src/generator';
import { INSTRUMENTS, concertRange, getInstrument } from '../src/instruments';
import { posToScore } from '../src/difficulty/score';
import { lickFingerings } from '../src/render/tab';
import { PROGRESSIONS, LENGTHS } from '../src/theory/progressions';
import type { Lick, LengthId } from '../src/types';

const pitched = (l: Lick) => l.notes.filter(n => n.midi != null).map(n => n.midi as number);
const maxLeap = (l: Lick) => pitched(l).reduce((m, p, i, a) => (i ? Math.max(m, Math.abs(p - a[i - 1])) : m), 0);
const shape = (l: Lick) => l.notes.map(n => [n.start, n.dur, n.tie ?? false, n.chord, n.midi == null ? -1 : (((n.midi - l.keyPc) % 12) + 12) % 12]);

describe('transposeLick range folding', () => {
  it('repro: alto lick refit to bass stays inside the bass range', () => {
    const alto = getInstrument('alto');
    const bass = getInstrument('bass');
    const lick = generateLick({
      progressionId: 'major-251', length: 'short', keyPc: 1, tier: 3,
      targetScore: posToScore(95), range: concertRange(alto), seed: 108,
    });
    const t = transposeLick(lick, 1, concertRange(bass));
    const [lo, hi] = concertRange(bass);
    for (const m of pitched(t)) {
      expect(m).toBeGreaterThanOrEqual(lo);
      expect(m).toBeLessThanOrEqual(hi);
    }
    expect(shape(t)).toEqual(shape(lick));
  });

  it('property sweep: every instrument, every key, in range; tab never fret-less', () => {
    const gens = ['alto', 'tenor', 'trumpet', 'guitar', 'bass', 'trombone', 'flute'].map(getInstrument);
    let n = 0, after = 0, folded = 0, tabNotes = 0, noFret = 0, worstExtra = 0;
    for (const p of PROGRESSIONS) for (const len of Object.keys(LENGTHS) as LengthId[]) for (const seed of [1, 2, 3]) for (const pos of [10, 40, 70, 95]) {
      const g = gens[(seed + pos + n) % gens.length];
      const lick = generateLick({ progressionId: p.id, length: len, keyPc: (seed * 5) % 12, tier: 3, targetScore: posToScore(pos), range: concertRange(g), seed });
      for (const inst of INSTRUMENTS) {
        const [lo, hi] = concertRange(inst);
        for (let key = 0; key < 12; key++) {
          const t = transposeLick(lick, key, [lo, hi]);
          n++;
          expect(shape(t)).toEqual(shape(lick)); // rhythm, ties and key-relative pitch classes unchanged
          const bad = pitched(t).filter(m => m < lo || m > hi).length;
          after += bad;
          expect(bad, `${p.id} ${len} s${seed} ${inst.id} k${key}`).toBe(0);
          worstExtra = Math.max(worstExtra, maxLeap(t) - maxLeap(lick));
          expect(maxLeap(t)).toBeLessThanOrEqual(maxLeap(lick) + 12);
          const o = pitched(lick);
          if (new Set(pitched(t).map((m, i) => m - o[i])).size > 1) folded++;
          if (inst.tab) {
            const f = lickFingerings(t, inst)!;
            f.line.forEach((x, i) => { if (x.midi != null) { tabNotes++; if (!f.auto.notes[i]) noFret++; } });
          }
        }
      }
    }
    console.log(`sweep n=${n} folded=${folded} outOfRangeAfter=${after} tabNotes=${tabNotes} noFret=${noFret} worstExtraLeap=${worstExtra}`);
    expect(after).toBe(0);
    expect(noFret).toBe(0);
  }, 600000);
});
