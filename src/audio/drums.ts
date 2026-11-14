import type { LickChord } from '../types';
import { TPB, TPBAR } from '../types';

export type DrumKind = 'ride' | 'hat' | 'kick' | 'snare';
/** One drum hit: `tick` on the lick's grid (12 per beat), `vel` 0..1. Placed on the swing timeline by the caller. */
export interface DrumEvent { kind: DrumKind; tick: number; vel: number }
export interface DrumOptions {
  /** Seeds the ghosted snare comping, so a pass is the same every time but passes differ. */
  seed?: number;
  /** Feathered kick on every beat (very soft). Default true. */
  kick?: boolean;
  /** A few ghosted snare hits per bar. Default true. */
  snare?: boolean;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWUNG_AND = TPB / 2; // the "and" of a beat; the swing timeline moves it to the triplet position

/**
 * Classic swing drum pattern ("spang-a-lang"): ride on every beat plus the "and" of 2 and 4, hi-hat chick on 2 and 4,
 * feathered kick on every beat, and sparse ghosted snare on the swung "and"s. Pure; times are in ticks.
 */
export function drumEvents(src: number | readonly LickChord[], opts: DrumOptions = {}): DrumEvent[] {
  const total = typeof src === 'number' ? src : src.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  const beats = Math.floor(total / TPB);
  const rand = rng(opts.seed ?? 0);
  const ev: DrumEvent[] = [];
  const bars = Math.ceil(total / TPBAR);
  // pick the ghost-note slots per bar up front so the pattern does not depend on the other events
  const ghosts = new Map<number, number>();
  if (opts.snare !== false) {
    for (let bar = 0; bar < bars; bar++) {
      const n = 1 + Math.floor(rand() * 3); // 1..3 per bar
      for (let k = 0; k < n; k++) ghosts.set(bar * 4 + Math.floor(rand() * 4), 0.2 + rand() * 0.15);
    }
  }
  for (let b = 0; b < beats; b++) {
    const pos = b % 4;
    const tick = b * TPB;
    ev.push({ kind: 'ride', tick, vel: pos === 1 || pos === 3 ? 0.85 : 0.7 });
    if (pos === 1 || pos === 3) {
      ev.push({ kind: 'ride', tick: tick + SWUNG_AND, vel: 0.55 }); // the skip note
      ev.push({ kind: 'hat', tick, vel: 0.8 });
    }
    if (opts.kick !== false) ev.push({ kind: 'kick', tick, vel: 0.22 });
    const g = ghosts.get(b);
    if (g !== undefined && tick + SWUNG_AND < total) ev.push({ kind: 'snare', tick: tick + SWUNG_AND, vel: g });
  }
  return ev.sort((a, b) => a.tick - b.tick);
}
