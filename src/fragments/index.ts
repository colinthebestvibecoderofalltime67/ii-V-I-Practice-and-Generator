import type { ChordQualityId, Fragment } from '../types';
import { TICKS_PER_16TH } from '../types';
import { SEED_FRAGMENTS } from './lib/seed';
import { PROTOTYPE_FRAGMENTS } from './lib/prototype';
import { ORIGINAL_FRAGMENTS } from './lib/original';

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

/** Every fragment the generator may use, on the engine tick grid. Add new lib files (authored in 16ths) to the arrays below. */
export const AUTHORED_FRAGMENTS: Fragment[] = [...SEED_FRAGMENTS, ...PROTOTYPE_FRAGMENTS, ...ORIGINAL_FRAGMENTS];
export const FRAGMENTS: Fragment[] = AUTHORED_FRAGMENTS.map(fromSixteenths);

export const fragmentsFor = (q: ChordQualityId, beats?: 2 | 4): Fragment[] =>
  FRAGMENTS.filter(f => f.qualities.includes(q) && (beats === undefined || f.beats === beats));
