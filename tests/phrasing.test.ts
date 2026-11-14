import { describe, expect, it } from 'vitest';
import { summarize } from '../src/analysis/musicality';
import { posToScore } from '../src/difficulty/score';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import type { LengthId, Lick, Tier } from '../src/types';
import { TPBAR } from '../src/types';
import { CORE_PROGRESSION_IDS } from './_samples';

const INSTS = ['alto', 'guitar'].map(getInstrument);
const POS: Record<Tier, number[]> = { 1: [5, 15], 2: [30, 40], 3: [55, 70], 4: [80, 95] };

function sample(tier: Tier): Lick[] {
  const out: Lick[] = [];
  let seed = 100 * tier;
  // The classic three-chord progressions only: "share of licks with at least one anticipation" grows with the number of chord changes,
  // so the ranges below do not transfer to the 5- and 7-chord progressions (judged per change in tests/long-progressions.test.ts).
  for (const p of PROGRESSIONS.filter(p => CORE_PROGRESSION_IDS.includes(p.id))) {
    for (const length of Object.keys(LENGTHS) as LengthId[]) {
      for (const pos of POS[tier]) {
        for (let s = 0; s < 3; s++) {
          seed++;
          out.push(generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier, targetScore: posToScore(pos), range: concertRange(INSTS[s % 2]), seed }));
        }
      }
    }
  }
  return out;
}

describe('phrasing pass', () => {
  const byTier = new Map<Tier, ReturnType<typeof summarize>>();
  const lickSets = new Map<Tier, Lick[]>();
  for (const t of [1, 2, 3, 4] as Tier[]) {
    it(`tier ${t}: anticipation share in range`, () => {
      const licks = sample(t);
      lickSets.set(t, licks);
      const m = summarize(licks);
      byTier.set(t, m);
      const [lo, hi] = ({ 1: [0, 0.18], 2: [0.12, 0.38], 3: [0.33, 0.55], 4: [0.33, 0.55] } as Record<Tier, [number, number]>)[t];
      expect(m.anticipationShare, `tier ${t}`).toBeGreaterThanOrEqual(lo);
      expect(m.anticipationShare, `tier ${t}`).toBeLessThanOrEqual(hi);
      expect(m.seamRepeatShare, 'seam re-attacks').toBeLessThan(0.1);
    }, 60_000);
  }

  it('about a quarter of licks open with a rest and anticipated notes are tied across the change', () => {
    const all = [1, 2, 3, 4].flatMap(t => lickSets.get(t as Tier) ?? sample(t as Tier));
    const m = summarize(all);
    expect(m.startsWithRestShare).toBeGreaterThanOrEqual(0.18);
    expect(m.startsWithRestShare).toBeLessThanOrEqual(0.32);
    for (const l of all) {
      l.notes.forEach((n, i) => {
        if (!n.tie || n.midi == null) return;
        const nx = l.notes[i + 1];
        if (nx.chord !== n.chord) {
          // a tie over a chord change: the continuation sits exactly on the chord start; no tie touches a bar line wrongly
          expect(nx.start).toBe(l.chords[nx.chord].start);
        }
        expect(Math.floor(n.start / TPBAR)).toBe(Math.floor((n.start + n.dur - 1) / TPBAR));
      });
    }
  }, 60_000);

  it('does not repeat the same cell or pitch loop twice in a row inside one chord', () => {
    let loops = 0;
    let pairs = 0;
    for (const l of [1, 2, 3, 4].flatMap(t => lickSets.get(t as Tier) ?? sample(t as Tier))) {
      for (let i = 1; i < l.fragmentIds.length; i++) {
        const a = l.cellStarts![i - 1];
        const b = l.cellStarts![i];
        if (l.notes.find(n => n.start === a)?.chord !== l.notes.find(n => n.start === b)?.chord) continue;
        pairs++;
        if (l.fragmentIds[i] === l.fragmentIds[i - 1]) loops++;
      }
    }
    expect(loops / Math.max(1, pairs)).toBeLessThan(0.03);
  }, 60_000);
});
