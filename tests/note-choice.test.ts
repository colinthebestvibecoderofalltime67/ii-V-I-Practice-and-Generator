import { describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import { posToScore } from '../src/difficulty/score';
import { INSTRUMENTS, concertRange, concertRangeForLevel, getInstrument, rangeForLevel } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { attacks, summarize } from '../src/analysis/musicality';
import { mod12 } from '../src/theory/pitch';
import type { LengthId, Lick, Tier } from '../src/types';

function sample(instId: string, tier: Tier, pos: number, comfort: boolean, n = 2): Lick[] {
  const inst = getInstrument(instId);
  const out: Lick[] = [];
  let seed = 7000 + pos;
  for (const p of PROGRESSIONS) {
    for (const length of Object.keys(LENGTHS) as LengthId[]) {
      for (let k = 0; k < n; k++) {
        out.push(generateLick({
          progressionId: p.id, length, keyPc: (seed * 5) % 12, tier, targetScore: posToScore(pos),
          range: concertRange(inst), ...(comfort ? { comfortRange: concertRangeForLevel(inst, tier) } : {}), seed: seed++,
        }));
      }
    }
  }
  return out;
}

describe('rangeForLevel', () => {
  it('Expert is the full range; lower tiers are nested inside it', () => {
    for (const i of INSTRUMENTS) {
      const r = [1, 2, 3, 4].map(t => rangeForLevel(i, t as Tier));
      expect(r[3]).toEqual(i.range);
      for (let t = 0; t < 3; t++) {
        expect(r[t][0]).toBeGreaterThanOrEqual(r[t + 1][0]);
        expect(r[t][1]).toBeLessThanOrEqual(r[t + 1][1]);
      }
      expect(r[0][1] - r[0][0]).toBeGreaterThanOrEqual(19);
    }
  });
  it('encodes the named limits', () => {
    expect(rangeForLevel(getInstrument('alto'), 1)[0]).toBeGreaterThanOrEqual(62); // no low Bb-C#
    expect(rangeForLevel(getInstrument('alto'), 1)[1]).toBeLessThanOrEqual(84); // written C6
    expect(rangeForLevel(getInstrument('tenor'), 2)[1]).toBeLessThan(88); // no E6/F6
    expect(rangeForLevel(getInstrument('trumpet'), 1)[1]).toBeLessThanOrEqual(79); // G5
    expect(rangeForLevel(getInstrument('trumpet'), 2)[1]).toBeLessThanOrEqual(84); // C6
  });
});

describe('licks stay in the level range', () => {
  for (const instId of ['alto', 'tenor', 'trumpet']) {
    for (const [tier, pos] of [[1, 12], [1, 22], [2, 35], [2, 45]] as [Tier, number][]) {
      it(`${instId} tier ${tier} pos ${pos}: >= 95% of notes in the written comfort range, all in the hard range`, () => {
        const inst = getInstrument(instId);
        const [lo, hi] = rangeForLevel(inst, tier);
        let inN = 0;
        let total = 0;
        for (const l of sample(instId, tier, pos, true)) {
          for (const a of attacks(l.notes)) {
            const w = a.midi + inst.transpose;
            total++;
            if (w >= lo && w <= hi) inN++;
            expect(w).toBeGreaterThanOrEqual(inst.range[0]);
            expect(w).toBeLessThanOrEqual(inst.range[1]);
          }
        }
        expect(inN / total).toBeGreaterThanOrEqual(0.95);
      });
    }
  }
  it('no Beginner alto lick starts on low written Bb', () => {
    const inst = getInstrument('alto');
    for (const l of sample('alto', 1, 15, true, 3)) {
      const first = attacks(l.notes)[0];
      expect(first.midi + inst.transpose).toBeGreaterThan(61);
    }
  });
});

describe('guide-tone arrival', () => {
  it('dominants arrive on the 3rd or 7th >= 80% in every tier', () => {
    for (const [tier, pos] of [[1, 12], [2, 35], [3, 60], [4, 90]] as [Tier, number][]) {
      const m = summarize(sample('alto', tier, pos, false, 4));
      expect(m.dominantGuideShare, `tier ${tier}`).toBeGreaterThanOrEqual(0.8);
      expect(m.longChromaticPerK).toBeLessThan(1);
    }
  });
  it('the final tonic is rarely approached on the root', () => {
    let root = 0;
    let n = 0;
    for (const l of sample('alto', 2, 35, false)) {
      const ch = l.chords[l.chords.length - 1];
      const a = attacks(l.notes).find(x => x.start <= ch.start && x.start + x.dur > ch.start);
      if (!a) continue;
      n++;
      if (mod12(a.midi - ch.rootPc) === 0) root++;
    }
    expect(root / n).toBeLessThan(0.15);
  });
});
