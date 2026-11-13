import type { ChordQualityId, Fragment } from '../types';
import { TICKS_PER_16TH } from '../types';
import { SEED_FRAGMENTS } from './lib/seed';
import { PROTOTYPE_FRAGMENTS } from './lib/prototype';
import { ORIGINAL_FRAGMENTS } from './lib/original';
import { TRIPLET_FRAGMENTS } from './lib/triplets';

/**
 * Fragments in src/fragments/lib are AUTHORED in sixteenth-note units (1 = 16th, 2 = 8th, 4 = quarter,
 * 16 = whole). The generator works on the 12-ticks-per-beat grid (see types.ts), so every fragment is
 * scaled by this factor on load. Library files must NOT be edited to the new grid.
 */
export const AUTHORED_UNIT = TICKS_PER_16TH;

/** Convert a fragment authored in 16th-note units to the engine's tick grid. Pure; does not mutate its input. */
export function fromSixteenths(f: Fragment): Fragment {
  return { ...f, notes: f.notes.map(n => ({ ...n, dur: n.dur * AUTHORED_UNIT })) };
}

/** Libraries authored in 16th-note units (scaled x3 on load). Add new 16th-grid lib files here. */
export const AUTHORED_FRAGMENTS: Fragment[] = [...SEED_FRAGMENTS, ...PROTOTYPE_FRAGMENTS, ...ORIGINAL_FRAGMENTS];

/**
 * Every fragment the generator may use, on the engine tick grid. Libraries that contain triplet durations
 * (lib/triplets.ts) are already parsed to engine ticks and are appended AFTER the scaled 16th-grid libraries,
 * so FRAGMENTS.slice(0, AUTHORED_FRAGMENTS.length) is exactly the scaled authored set.
 */
export const FRAGMENTS: Fragment[] = [...AUTHORED_FRAGMENTS.map(fromSixteenths), ...TRIPLET_FRAGMENTS];

export const fragmentsFor = (q: ChordQualityId, beats?: 2 | 4): Fragment[] =>
  FRAGMENTS.filter(f => f.qualities.includes(q) && (beats === undefined || f.beats === beats));
