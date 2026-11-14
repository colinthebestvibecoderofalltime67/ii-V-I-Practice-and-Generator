import { describe, expect, it } from 'vitest';
import { lickMetrics, summarize } from '../src/analysis/musicality';
import { TIER_THRESHOLDS } from '../src/difficulty/score';
import { FRAGMENTS } from '../src/fragments';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS, expandProgression, lengthBars, lengthLabel, slotBeats, totalTicks } from '../src/theory/progressions';
import { TPB, TPBAR, type LengthId, type Lick, type Tier } from '../src/types';
import { LONG_PROGRESSION_IDS, lazy, sessionSample } from './_samples';

const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];

/**
 * Beats per slot of every progression at every length: a table, not a derivation, so a change to a rhythm is a visible edit.
 * Short is two beats per chord, standard one bar per chord; the ending chord always has a bar or more; every length is whole bars.
 */
const BEATS: Record<string, Record<LengthId, number[]>> = {
  'major-251': { short: [2, 2, 4], standard: [4, 4, 4], long: [8, 8, 8] },
  'major-251-alt': { short: [2, 2, 4], standard: [4, 4, 4], long: [8, 8, 8] },
  'minor-251': { short: [2, 2, 4], standard: [4, 4, 4], long: [8, 8, 8] },
  'tritone-251': { short: [2, 2, 4], standard: [4, 4, 4], long: [8, 8, 8] },
  'backdoor-251': { short: [2, 2, 4], standard: [4, 4, 4], long: [8, 8, 8] },
  'turnaround': { short: [2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4], long: [4, 4, 4, 4, 8] },
  'chain-36251': { short: [2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4], long: [4, 4, 4, 4, 8] },
  'coltrane': { short: [2, 2, 2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4, 4, 4], long: [4, 4, 4, 4, 4, 4, 8] },
};
/** Bars per length. */
const BARS: Record<string, Record<LengthId, number>> = {
  'major-251': { short: 2, standard: 3, long: 6 },
  'turnaround': { short: 3, standard: 5, long: 6 },
  'chain-36251': { short: 3, standard: 5, long: 6 },
  'coltrane': { short: 4, standard: 7, long: 8 },
};

describe('progression registry', () => {
  it('share indexes are append-only: the first five are fixed, the new ones follow in order', () => {
    expect(PROGRESSIONS.map(p => p.id).slice(0, 8)).toEqual([
      'major-251', 'major-251-alt', 'minor-251', 'tritone-251', 'backdoor-251', 'turnaround', 'chain-36251', 'coltrane',
    ]);
    expect(PROGRESSIONS.length).toBeLessThanOrEqual(16); // 4 bits in a share link
  });

  it('every progression has an expectation row; rhythms are whole bars, one entry per chord, a bar or more at the end', () => {
    expect(Object.keys(BEATS).sort()).toEqual(PROGRESSIONS.map(p => p.id).sort());
    for (const p of PROGRESSIONS) for (const length of LENGTH_IDS) {
      const beats = slotBeats(p, length);
      expect(beats, `${p.id}/${length}`).toEqual(BEATS[p.id][length]);
      expect(beats.length).toBe(p.slots.length);
      const total = beats.reduce((a, b) => a + b, 0);
      expect(total % 4, `${p.id}/${length} whole bars`).toBe(0);
      expect(totalTicks(p, length)).toBe(total * TPB);
      expect(lengthBars(p, length)).toBe(total / 4);
      expect(Math.min(...beats), `${p.id}/${length} shortest chord`).toBeGreaterThanOrEqual(2);
      expect(beats[beats.length - 1], `${p.id}/${length} ending chord`).toBeGreaterThanOrEqual(4);
      if (BARS[p.id]) expect(lengthBars(p, length), `${p.id}/${length} bars`).toBe(BARS[p.id][length]);
      // chords are contiguous from tick 0 and fill the lick
      const chords = expandProgression(p, length, 5);
      expect(chords[0].start).toBe(0);
      chords.forEach((c, i) => { if (i) expect(c.start, `${p.id}/${length} chord ${i}`).toBe(chords[i - 1].start + chords[i - 1].dur); });
      const last = chords[chords.length - 1];
      expect(last.start + last.dur).toBe(totalTicks(p, length));
      // a bar is never longer than 3 distinct chords: chords of 2 beats come in pairs that fill a bar or sit on beat 1/3 only
      chords.forEach(c => expect(c.start % (2 * TPB), `${p.id}/${length} ${c.symbol} starts on beat 1 or 3`).toBe(0));
    }
  });

  it('length labels carry the real bar count', () => {
    const t = PROGRESSIONS.find(p => p.id === 'turnaround')!;
    expect(lengthLabel(t, 'short')).toBe('Short (3 bars)');
    expect(lengthLabel(t, 'standard')).toBe('Standard (5 bars)');
    expect(lengthLabel(PROGRESSIONS[0], 'long')).toBe('Long (6 bars)');
    expect(lengthLabel(PROGRESSIONS.find(p => p.id === 'coltrane')!, 'long')).toBe('Long (8 bars)');
  });

  it('a rhythm that does not match the chord count is refused', () => {
    expect(() => slotBeats({ ...PROGRESSIONS[0], rhythm: { short: [4, 4], standard: [4, 4], long: [4, 4] } }, 'short')).toThrow();
  });

  it('the new progressions: roots, qualities and spellable functions', () => {
    const q = (id: string) => PROGRESSIONS.find(p => p.id === id)!.slots.map(s => `${s.degree}${s.quality}`);
    expect(q('turnaround')).toEqual(['0maj7', '9dom7', '2m7', '7dom7', '0maj7']);
    expect(q('chain-36251')).toEqual(['4m7', '9dom7', '2m7', '7dom7', '0maj7']);
    expect(q('coltrane')).toEqual(['2m7', '3dom7', '8maj7', '11dom7', '4maj7', '7dom7', '0maj7']);
    // VI7 is modelled as a plain dom7 with the secondaryDom function, not as 7alt
    for (const id of ['turnaround', 'chain-36251']) expect(PROGRESSIONS.find(p => p.id === id)!.slots[1]).toMatchObject({ quality: 'dom7', fn: 'secondaryDom' });
  });
});

describe('generator over the longer progressions', () => {
  it('cells: 4-beat cells start on a bar line, every beat is filled, only the last cell is an ending, every chord start has a note', () => {
    const alto = concertRange(getInstrument('alto'));
    for (const id of LONG_PROGRESSION_IDS) for (const length of LENGTH_IDS) for (const tier of [1, 2, 3, 4] as Tier[]) for (let seed = 1; seed <= 6; seed++) {
      const l = generateLick({ progressionId: id, length, keyPc: (seed * 7) % 12, tier, range: alto, seed });
      const label = `${id}/${length}/t${tier}/s${seed}`;
      const starts = l.cellStarts!;
      expect(starts.length, label).toBe(l.fragmentIds.length);
      starts.forEach((st, i) => {
        const f = FRAGMENTS.find(x => x.id === l.fragmentIds[i]);
        const end = i + 1 < starts.length ? starts[i + 1] : l.totalTicks;
        const beats = (end - st) / TPB;
        if (f) expect(f.beats, `${label} cell ${i} length`).toBe(beats);
        expect([2, 4], `${label} cell ${i} beats`).toContain(beats);
        if (beats === 4) expect(st % TPBAR, `${label} 4-beat cell ${i} on a bar line`).toBe(0);
        // a cell never straddles a chord change
        const ci = l.chords.findIndex(c => st >= c.start && st < c.start + c.dur);
        expect(end, `${label} cell ${i} stays inside ${l.chords[ci].symbol}`).toBeLessThanOrEqual(l.chords[ci].start + l.chords[ci].dur);
      });
      // exactly one chord start per slot has a note on it
      for (const c of l.chords) expect(l.notes.some(n => n.start === c.start), `${label} ${c.symbol}`).toBe(true);
    }
  });

  it('the generator is deterministic for the new progressions', () => {
    const alto = concertRange(getInstrument('alto'));
    for (const id of LONG_PROGRESSION_IDS) {
      const a = generateLick({ progressionId: id, length: 'standard', keyPc: 2, tier: 3, range: alto, seed: 77 });
      const b = generateLick({ progressionId: id, length: 'standard', keyPc: 2, tier: 3, range: alto, seed: 77 });
      expect({ ...a, createdAt: 0 }).toEqual({ ...b, createdAt: 0 });
    }
  });
});

describe('difficulty calibration of the longer progressions', () => {
  it('complexity grows with the harmony, and the baseline of Coltrane sits in Intermediate (so the hint says Advanced)', () => {
    const c = (id: string) => PROGRESSIONS.find(p => p.id === id)!;
    expect(c('turnaround').complexity).toBeGreaterThan(c('major-251').complexity);
    expect(c('coltrane').complexity).toBeGreaterThan(Math.max(...PROGRESSIONS.filter(p => p.id !== 'coltrane').map(p => p.complexity)));
    expect(c('coltrane').minTier).toBe(3);
    // 8 points of "harmony" at complexity 1: Coltrane alone costs more than the Beginner/Intermediate boundary minus the rest of a plain lick
    expect(8 * c('coltrane').complexity).toBeGreaterThan(TIER_THRESHOLDS[0] - 2);
  });
});

describe('musicality of the longer progressions (same seeded session sample as `npm run musicality`)', () => {
  const sample = lazy(() => sessionSample({ progressions: LONG_PROGRESSION_IDS }));
  const of = (id: string, tier?: Tier): Lick[] => sample().all.filter(l => l.progressionId === id && (tier === undefined || l.requestedTier === tier));

  for (const id of LONG_PROGRESSION_IDS) {
    it(`${id}: arrivals on guide tones, no big leaps, clean endings`, () => {
      const ls = of(id);
      expect(ls.length).toBe(3 * 10 * 6);
      const m = summarize(ls);
      expect(m.dominantGuideShare, 'dominant arrivals on the 3rd or 7th').toBeGreaterThanOrEqual(0.85);
      // every change before the last is a resolution: the line lands on a guide tone there; the last chord may also take the 5th / 9th / root
      let hit = 0, n = 0, allHit = 0, allN = 0;
      for (const l of ls) {
        const g = lickMetrics(l).changeArrivalGuide;
        g.forEach((v, i) => {
          if (v === null) return;
          allN++; if (v) allHit++;
          if (i < g.length - 1) { n++; if (v) hit++; }
        });
      }
      expect(hit / n, 'guide-tone arrival on every change before the ending chord').toBeGreaterThanOrEqual(0.85);
      expect(allHit / allN, 'guide-tone arrival on every change including the ending').toBeGreaterThanOrEqual(0.78);
      expect(m.bigLeapShare, 'leaps of a 7th or more').toBeLessThanOrEqual(0.02);
      expect(m.endingRepeatShare).toBe(0);
      expect(m.finalSixteenthRunShare).toBeLessThanOrEqual(0.06);
      expect(m.anticipationClashShare).toBeLessThanOrEqual(0.02);
      expect(m.nearDuplicateShare).toBeLessThanOrEqual(0.05);
      // closing note: root, 3rd, 5th, 7th, 9th or 6th over the final chord (the metric files an anticipated last note under "other")
      expect(m.endingShares.other).toBeLessThanOrEqual(0.03);
      expect(m.endingShares.R + m.endingShares['3'] + m.endingShares['5']).toBeGreaterThanOrEqual(0.6);
      expect(m.endingShares['9']).toBeLessThanOrEqual(0.25);
      expect(m.maj7FourthShare).toBe(0);
    });

    it(`${id}: no arpeggio noodling at Advanced and Expert`, () => {
      expect(summarize(of(id, 3)).noodleShare, 'Advanced').toBeLessThanOrEqual(0.2);
      expect(summarize(of(id, 4)).noodleShare, 'Expert').toBeLessThanOrEqual(0.1);
    });
  }

  it('anticipations: judged per chord change (the share of licks with one grows with the number of changes), same ranges as the classics per change', () => {
    const rate = (ls: Lick[]) => ls.reduce((a, l) => a + lickMetrics(l).anticipations, 0) / ls.reduce((a, l) => a + l.chords.length - 1, 0);
    for (const id of LONG_PROGRESSION_IDS) {
      expect(rate(of(id, 1)), `${id} Beginner`).toBeLessThanOrEqual(0.12);
      expect(rate(of(id, 2)), `${id} Intermediate`).toBeLessThanOrEqual(0.3);
      for (const t of [3, 4] as Tier[]) {
        expect(rate(of(id, t)), `${id} t${t}`).toBeGreaterThanOrEqual(0.15);
        expect(rate(of(id, t)), `${id} t${t}`).toBeLessThanOrEqual(0.55);
      }
    }
  });

  it('a secondary dominant (VI7) carries b9 / #9 / b13 colour from Intermediate up, none for Beginner', () => {
    const alt = (ls: Lick[]) => ls.filter(l => {
      const ch = l.chords[1];
      return l.notes.some(n => n.midi != null && n.chord === 1 && [1, 3, 8].includes((n.midi - ch.rootPc + 120) % 12));
    }).length / ls.length;
    for (const id of ['turnaround', 'chain-36251']) {
      expect(alt(of(id, 1)), `${id} Beginner`).toBeLessThanOrEqual(0.08);
      expect(alt(of(id, 3)), `${id} Advanced`).toBeGreaterThanOrEqual(0.4);
      expect(alt(of(id, 4)), `${id} Expert`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('Coltrane: Beginner is rarely reachable (the harmony alone costs about 6 points), Intermediate and above are reachable', () => {
    const scores = (t: Tier) => of('coltrane', t).map(l => l.difficulty.score);
    expect(Math.min(...of('coltrane').map(l => l.difficulty.score))).toBeGreaterThan(5);
    const asked = of('coltrane', 1);
    expect(asked.filter(l => l.difficulty.tier === 1).length / asked.length, 'Beginner requests that really score Beginner').toBeLessThanOrEqual(0.25);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(scores(3))).toBeGreaterThan(TIER_THRESHOLDS[1]);
    expect(mean(scores(4))).toBeGreaterThan(TIER_THRESHOLDS[2]);
  });
});
