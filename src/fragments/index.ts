import type { ChordQualityId, Fragment } from '../types';
import { SEED_FRAGMENTS } from './lib/seed';

/** Every fragment the generator may use. Add new lib files to this array. */
export const FRAGMENTS: Fragment[] = [...SEED_FRAGMENTS];

export const fragmentsFor = (q: ChordQualityId, beats?: 2 | 4): Fragment[] =>
  FRAGMENTS.filter(f => f.qualities.includes(q) && (beats === undefined || f.beats === beats));
