import { describe, expect, it } from 'vitest';
import { FRAGMENTS } from '../src/fragments';
import { INSTRUMENTS, concertRange, getInstrument } from '../src/instruments';
import { generateLick, transposeLick } from '../src/generator';
import { posToScore, scoreLick, tierForScore } from '../src/difficulty/score';
import { isChordToneOrTension, CHORDS } from '../src/theory/chords';
import { LENGTHS, PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import { mod12 } from '../src/theory/pitch';
import { findTupletGroups, isTupletDur } from '../src/theory/rhythm';
import { RENDERABLE_DURS, TICKS_PER_16TH, TPB, TPBAR, type Lick, type LengthId, type Tier } from '../src/types';

const INSTS = ['alto', 'trumpet', 'trombone', 'bass'];
const SEEDS = 12;
const TIERS: Tier[] = [1, 2, 3, 4];
const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
const KEYS: Record<string, number> = { alto: 0, trumpet: 7, trombone: 3, bass: 10 };

/** Tolerance (semitones) outside the range we accept. 0: the generator keeps every note in range. Raise only
 *  if a custom fragment is wider than a very narrow range, where no octave can fit it. */
const RANGE_TOL = 0;

function checkInvariants(lick: Lick, range: [number, number], label: string) {
  const def = getProgression(lick.progressionId);
  expect(lick.chords, label).toEqual(expandProgression(def, lick.length, lick.keyPc));
  const total = LENGTHS[lick.length].beats.reduce((a, b) => a + b, 0) * TPB;
  expect(lick.totalTicks, label).toBe(total);
  let t = 0;
  lick.notes.forEach((n, i) => {
    expect(n.start, `${label} contiguous #${i}`).toBe(t);
    // non-triplet durations are renderable and on the 16th grid; triplet durations are checked as groups below
    if (!isTupletDur(n.dur)) {
      expect((RENDERABLE_DURS as readonly number[]).includes(n.dur), `${label} dur ${n.dur}`).toBe(true);
      expect(n.start % TICKS_PER_16TH, `${label} on the 16th grid #${i}`).toBe(0);
    } else {
      expect(n.tie, `${label} triplet note #${i} is tied`).toBeFalsy();
    }
    expect(Math.floor(n.start / TPBAR), `${label} bar line at note ${i}`).toBe(Math.floor((n.start + n.dur - 1) / TPBAR));
    const ci = lick.chords.findIndex(c => n.start >= c.start && n.start < c.start + c.dur);
    expect(n.chord, `${label} chord idx #${i}`).toBe(ci);
    if (n.tie) {
      const next = lick.notes[i + 1];
      expect(next, `${label} tie has a successor`).toBeTruthy();
      expect(next.midi, `${label} tie equal midi`).toBe(n.midi);
      expect(n.midi).not.toBeNull();
    }
    if (n.midi != null) {
      expect(n.midi, `${label} low`).toBeGreaterThanOrEqual(range[0] - RANGE_TOL);
      expect(n.midi, `${label} high`).toBeLessThanOrEqual(range[1] + RANGE_TOL);
    }
    t += n.dur;
  });
  expect(t, label).toBe(total);

  // triplets: well-formed, aligned groups that never cross a bar line
  const tg = findTupletGroups(lick.notes);
  expect(tg.errors, `${label} triplet groups`).toEqual([]);
  for (const g of tg.groups) expect(Math.floor(g.start / TPBAR), `${label} ${g.kind} group at ${g.start} crosses a bar`).toBe(Math.floor((g.end - 1) / TPBAR));

  // downbeat rule: the note sounding at each chord start is a chord tone or tension
  lick.chords.forEach((c, ci) => {
    const n = lick.notes.find(x => x.start === c.start);
    expect(n, `${label} note at chord ${ci} start`).toBeTruthy();
    if (n!.midi != null) {
      expect(isChordToneOrTension(n!.midi, c.rootPc, c.quality), `${label} chord-start note over ${c.symbol}`).toBe(true);
    }
  });

  // ending rule
  const sounding = lick.notes.filter(n => n.midi != null);
  const last = sounding[sounding.length - 1];
  const lc = lick.chords[lick.chords.length - 1];
  const rel = mod12(last.midi! - lc.rootPc);
  const okRels = [...CHORDS[lc.quality].tones.map(mod12), 2];
  expect(okRels.includes(rel), `${label} last note rel ${rel} over ${lc.symbol}`).toBe(true);

  // honest label
  expect(lick.difficulty, label).toEqual(scoreLick(lick.notes, lick.chords, def));
}

const strip = (l: Lick) => ({ ...l, createdAt: 0 });

describe('generateLick invariants', () => {
  const hits: Record<Tier, { n: number; hit: number }> = { 1: { n: 0, hit: 0 }, 2: { n: 0, hit: 0 }, 3: { n: 0, hit: 0 }, 4: { n: 0, hit: 0 } };

  it('satisfies all invariants for every progression x length x tier x seed x instrument', () => {
    for (const p of PROGRESSIONS) {
      for (const length of LENGTH_IDS) {
        for (const tier of TIERS) {
          for (let seed = 1; seed <= SEEDS; seed++) {
            const instId = INSTS[(seed + tier) % INSTS.length];
            const range = concertRange(getInstrument(instId));
            const keyPc = (KEYS[instId] + seed) % 12;
            const lick = generateLick({ progressionId: p.id, length, keyPc, tier, range, seed });
            const label = `${p.id}/${length}/t${tier}/s${seed}/${instId}`;
            expect(lick.requestedTier).toBe(tier);
            expect(lick.seed).toBe(seed);
            expect(lick.fragmentIds.length).toBeGreaterThan(0);
            checkInvariants(lick, range, label);
            hits[tier].n++;
            if (lick.difficulty.tier === tier) hits[tier].hit++;
          }
        }
      }
    }
    const rows = TIERS.map(t => ({ tier: t, licks: hits[t].n, hit: hits[t].hit, rate: +(hits[t].hit / hits[t].n).toFixed(3) }));
    console.table(rows);
    const overall = rows.reduce((a, r) => a + r.hit, 0) / rows.reduce((a, r) => a + r.licks, 0);
    console.log(`fragments: ${FRAGMENTS.length}, overall requested-tier hit rate: ${overall.toFixed(3)}`);
    expect(overall).toBeGreaterThanOrEqual(0.9);
    for (const r of rows) expect(r.rate, `tier ${r.tier} hit rate`).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it('every instrument range works', () => {
    for (const inst of INSTRUMENTS) {
      const range = concertRange(inst);
      for (const tier of TIERS) {
        const lick = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 5, tier, range, seed: 7 });
        checkInvariants(lick, range, `${inst.id}/t${tier}`);
      }
    }
  });
});

describe('determinism and options', () => {
  it('same options + seed gives an identical lick; different seeds differ', () => {
    const base = { progressionId: 'minor-251', length: 'long' as const, keyPc: 2, tier: 3 as Tier, range: concertRange(getInstrument('tenor')) };
    const a = generateLick({ ...base, seed: 99 });
    const b = generateLick({ ...base, seed: 99 });
    expect(strip(a)).toEqual(strip(b));
    const variants = new Set([1, 2, 3, 4, 5, 6].map(s => JSON.stringify(generateLick({ ...base, seed: s }).notes)));
    expect(variants.size).toBeGreaterThan(3);
  });

  it('works without a seed and with a custom fragment list (synthesised fallback)', () => {
    const range = concertRange(getInstrument('alto'));
    const l = generateLick({ progressionId: 'minor-251', length: 'standard', keyPc: 0, tier: 2, range });
    checkInvariants(l, range, 'random-seed');
    const empty = generateLick({ progressionId: 'minor-251', length: 'long', keyPc: 4, tier: 4, range, seed: 3, fragments: [] });
    checkInvariants(empty, range, 'no fragments');
    const only = generateLick({ progressionId: 'tritone-251', length: 'short', keyPc: 9, tier: 1, range, seed: 3, fragments: FRAGMENTS.filter(f => f.beats === 4) });
    checkInvariants(only, range, 'only 4-beat fragments');
  });

  it('the last fragment of every lick is an ending fragment', () => {
    const range = concertRange(getInstrument('alto'));
    for (const p of PROGRESSIONS) {
      for (const tier of TIERS) {
        const l = generateLick({ progressionId: p.id, length: 'standard', keyPc: 0, tier, range, seed: 5 });
        const lastId = l.fragmentIds[l.fragmentIds.length - 1];
        const f = FRAGMENTS.find(x => x.id === lastId);
        if (f) expect(f.ending, `${p.id} t${tier} ends with ${lastId}`).toBe(true);
        else expect(lastId.startsWith('synth-')).toBe(true);
      }
    }
  });
});

describe('transposeLick', () => {
  it('preserves rhythm and intervals, respells chords and keeps difficulty', () => {
    for (const p of PROGRESSIONS) {
      // generate inside a 20-semitone window: a transposition (fixed pitch class shift, octave free) is then guaranteed
      // to fit the full trumpet range, so the strict range invariant below does not depend on which fragments were drawn
      const full = concertRange(getInstrument('alto'));
      const range: [number, number] = [full[0] + 4, full[0] + 24];
      const lick = generateLick({ progressionId: p.id, length: 'standard', keyPc: 0, tier: 3, range, seed: 11 });
      for (const key of [1, 6, 7, 10]) {
        const range2 = concertRange(getInstrument('trumpet'));
        const t = transposeLick(lick, key, range2);
        expect(t.keyPc).toBe(key);
        expect(t.chords).toEqual(expandProgression(getProgression(p.id), 'standard', key));
        expect(t.notes.map(n => [n.start, n.dur, n.tie ?? false, n.chord])).toEqual(lick.notes.map(n => [n.start, n.dur, n.tie ?? false, n.chord]));
        const ivs = (l: Lick) => l.notes.filter(n => n.midi != null).map(n => n.midi!).map((m, i, a) => (i ? m - a[i - 1] : 0));
        expect(ivs(t)).toEqual(ivs(lick));
        expect(mod12(t.notes.find(n => n.midi != null)!.midi! - lick.notes.find(n => n.midi != null)!.midi!)).toBe(mod12(key));
        expect(t.difficulty.score).toBe(lick.difficulty.score);
        expect(scoreLick(t.notes, t.chords, getProgression(p.id)).score).toBe(lick.difficulty.score);
        checkInvariants(t, range2, `${p.id} -> key ${key}`);
      }
    }
  });
});

describe('targetScore (difficulty slider)', () => {
  const POSITIONS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

  it('lands near the target across the slider, keeps invariants and the target tier', () => {
    let tierHit = 0;
    let total = 0;
    const all: number[] = [];
    for (const pos of POSITIONS) {
      const target = posToScore(pos);
      const errs: number[] = [];
      let seed = 100 + pos;
      for (const p of PROGRESSIONS) {
        for (const length of LENGTH_IDS) {
          for (let k = 0; k < 2; k++) {
            const instId = INSTS[k];
            const range = concertRange(getInstrument(instId));
            const lick = generateLick({ progressionId: p.id, length, keyPc: KEYS[instId], tier: 1, targetScore: target, range, seed: seed++ });
            checkInvariants(lick, range, `${p.id}/${length}/pos${pos}`);
            expect(lick.targetScore).toBe(target);
            expect(lick.requestedTier).toBe(tierForScore(target));
            errs.push(Math.abs(lick.difficulty.score - target));
            if (lick.difficulty.tier === tierForScore(target)) tierHit++;
            total++;
          }
        }
      }
      all.push(...errs);
      // very low targets are bounded below by the simplest possible licks (about 3 points)
      expect(median(errs), `median error at pos ${pos}`).toBeLessThanOrEqual(pos < 10 ? 2.5 : 1.2);
      if (pos >= 10) {
        const p90 = [...errs].sort((a, b) => a - b)[Math.floor(errs.length * 0.9)];
        expect(p90, `p90 error at pos ${pos}`).toBeLessThanOrEqual(3);
      }
    }
    // Musical preferences (guide-tone landings, comfort range) trade a little accuracy: about 0.7 points median.
    expect(median(all)).toBeLessThanOrEqual(1.0);
    expect(tierHit / total, 'target tier hit rate').toBeGreaterThanOrEqual(0.85);
  }, 120_000);

  it('without targetScore the lick has none and options.tier still rules', () => {
    const range = concertRange(getInstrument('alto'));
    const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 3, range, seed: 4 });
    expect(l.targetScore).toBeUndefined();
    expect(l.requestedTier).toBe(3);
  });
});
