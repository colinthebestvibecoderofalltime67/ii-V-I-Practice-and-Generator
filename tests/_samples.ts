/**
 * Shared, memoised lick samples and sweep sizing for the tests (and `npm run musicality`, which imports the same builder so
 * the report and the tests can never drift apart).
 *
 * Vitest runs every test file in its own worker, so memoisation helps within a file: a file that needs the 900-lick session
 * sample in several describes builds it once, lazily (on first call, never at collection time). Across files the sample is
 * rebuilt; with the generator at ~5 ms per lick that is ~5 s per file and it runs in parallel with the other files, which is
 * cheaper and far more robust than a disk cache that would have to be invalidated whenever the generator or the fragment
 * library changes.
 *
 * Sweeps: `SWEEP=full npm test` restores the exhaustive (slow, ~2-3 min) sweep sizes; the default stratified sizes still cover
 * every progression x length x instrument x key class and run in a fraction of the time. CI runs the full sweep weekly.
 */
import { generateLick } from '../src/generator';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import type { LengthId, Lick, Tier } from '../src/types';

/** `SWEEP=full` restores the exhaustive sweep sizes. */
export const FULL_SWEEP = typeof process !== 'undefined' && process.env.SWEEP === 'full';

export const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
export const SLIDER_POSITIONS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];

export interface Sample {
  all: Lick[];
  byTier: Record<Tier, Lick[]>;
}

/**
 * The five classic three-chord progressions: the statistical thresholds in the musicality tests (guide-tone arrivals, altered
 * colour, Lydian dominants, ending degrees...) were calibrated on exactly these, so the default sample stays them. The longer
 * progressions (turnaround, chain-36251, coltrane) are sampled on their own with `progressions: LONG_PROGRESSION_IDS` and judged
 * by their own targets in tests/long-progressions.test.ts.
 */
export const CORE_PROGRESSION_IDS = ['major-251', 'major-251-alt', 'minor-251', 'tritone-251', 'backdoor-251'];
export const LONG_PROGRESSION_IDS = PROGRESSIONS.map(p => p.id).filter(id => !CORE_PROGRESSION_IDS.includes(id));

export interface SessionSampleOptions {
  /** Progression ids to sample (default CORE_PROGRESSION_IDS). */
  progressions?: string[];
  /** Seeds per progression x length x slider position (default 6). */
  seeds?: number;
  /** Like the app, each lick avoids the cells of the previous 8 licks (a practice session). Default true. */
  avoid?: boolean;
  /** Instruments cycled by seed index (default alto, guitar). */
  insts?: string[];
}

const cache = new Map<string, Sample>();

/**
 * The seeded "practice session" sample: every progression x length x slider position (5..95 step 10) x seeds, alternating
 * instruments, with the comfort range of the target tier. Memoised per options.
 */
export function sessionSample(opts: SessionSampleOptions = {}): Sample {
  const seeds = opts.seeds ?? 6;
  const avoid = opts.avoid ?? true;
  const instIds = opts.insts ?? ['alto', 'guitar'];
  const ids = opts.progressions ?? CORE_PROGRESSION_IDS;
  const key = `${seeds}|${avoid}|${instIds.join(',')}|${ids.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const insts = instIds.map(getInstrument);
  const all: Lick[] = [];
  const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
  let seed = 1;
  for (const p of PROGRESSIONS.filter(p => ids.includes(p.id))) {
    for (const length of LENGTH_IDS) {
      for (const pos of SLIDER_POSITIONS) {
        for (let s = 0; s < seeds; s++) {
          const inst = insts[s % insts.length];
          const target = posToScore(pos);
          const l = generateLick({
            progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: target, range: concertRange(inst),
            comfortRange: concertRangeForLevel(inst, tierForScore(target)),
            ...(avoid ? { avoid: all.slice(-8).flatMap(r => r.fragmentIds) } : {}),
            seed: seed++,
          });
          all.push(l);
          byTier[l.requestedTier].push(l);
        }
      }
    }
  }
  const sample = { all, byTier };
  cache.set(key, sample);
  return sample;
}

/** Memoise a lazily built value (for samples that are specific to one file). */
export function lazy<T>(build: () => T): () => T {
  let v: T | undefined;
  let built = false;
  return () => {
    if (!built) { v = build(); built = true; }
    return v as T;
  };
}
