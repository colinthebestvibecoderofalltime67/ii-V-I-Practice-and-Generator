import { Rng } from '../generator/rng';

/** Order in which a lick is walked through the 12 keys. */
export type DrillOrder = 'off' | 'fourths' | 'fifths' | 'chromatic-up' | 'chromatic-down' | 'whole-steps' | 'random';

export const DRILL_ORDERS: readonly DrillOrder[] = ['off', 'fourths', 'fifths', 'chromatic-up', 'chromatic-down', 'whole-steps', 'random'];

export const DRILL_ORDER_LABELS: Record<DrillOrder, string> = {
  off: 'Off',
  fourths: 'Cycle of 4ths',
  fifths: 'Cycle of 5ths',
  'chromatic-up': 'Chromatic up',
  'chromatic-down': 'Chromatic down',
  'whole-steps': 'Whole steps',
  random: 'Random',
};

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/**
 * The key sequence of one drill cycle, starting on `startKey`. Every active order visits all 12 pitch classes
 * exactly once; 'off' is just the start key. 'random' keeps the start key first, then a seeded shuffle of the other
 * 11, so no key repeats before all 12 are done.
 */
export function drillKeys(startKey: number, order: DrillOrder, seed = 1): number[] {
  const k = mod12(startKey);
  const stepped = (step: number): number[] => Array.from({ length: 12 }, (_, i) => mod12(k + i * step));
  switch (order) {
    case 'off': return [k];
    case 'fourths': return stepped(5);
    case 'fifths': return stepped(7);
    case 'chromatic-up': return stepped(1);
    case 'chromatic-down': return stepped(-1);
    case 'whole-steps': { // two whole-tone scales: the start key's, then the other one
      const a = Array.from({ length: 6 }, (_, i) => mod12(k + 2 * i));
      return [...a, ...a.map(x => mod12(x + 1))];
    }
    case 'random': {
      const rest = Array.from({ length: 11 }, (_, i) => mod12(k + i + 1));
      const rng = new Rng(seed);
      for (let i = rest.length - 1; i > 0; i--) { // Fisher-Yates
        const j = rng.int(i + 1);
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [k, ...rest];
    }
  }
}

export interface DrillConfig {
  order: DrillOrder;
  /** Passes played in each key, 1..4. */
  repeats: number;
  /** BPM added per step, 0..20 (0 = no ladder). */
  tempoStep: number;
  /** The ladder never goes above this. */
  maxBpm: number;
  /** When the ladder steps: after every key change (default) or after every pass. */
  tempoEvery?: 'key' | 'pass';
}

export interface DrillStep {
  /** Index of the key within the cycle, 0-based. */
  keyIndex: number;
  /** Number of keys in the cycle (12, or 1 when off). */
  keyCount: number;
  key: number;
  bpm: number;
  /** Pass number within this key, 0-based. */
  repeat: number;
  /** True on the first pass of a key other than the very first. */
  keyChanged: boolean;
  /** True when this pass is past the end of the cycle (the drill is over; nothing should be played). */
  done: boolean;
}

export const clampInt = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * Where the drill is at pass number `passIndex` (0 = the first pass). The tempo ladder starts at `startBpm`, adds
 * `tempoStep` per step and is capped at `maxBpm` (a start tempo above the cap is left alone, never lowered).
 */
export function drillStep(cfg: DrillConfig, keys: readonly number[], startBpm: number, passIndex: number): DrillStep {
  const repeats = clampInt(cfg.repeats, 1, 4);
  const step = clampInt(cfg.tempoStep, 0, 20);
  const total = keys.length * repeats;
  const done = passIndex >= total;
  const p = done ? total - 1 : Math.max(0, passIndex);
  const keyIndex = Math.floor(p / repeats);
  const repeat = p % repeats;
  const steps = cfg.tempoEvery === 'pass' ? p : keyIndex;
  const cap = Math.max(startBpm, cfg.maxBpm);
  const bpm = Math.min(cap, startBpm + step * steps);
  return { keyIndex, keyCount: keys.length, key: keys[keyIndex], bpm, repeat, keyChanged: repeat === 0 && keyIndex > 0, done };
}
