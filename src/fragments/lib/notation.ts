import type { FragNote } from '../../types';
import { TICKS_PER_16TH } from '../../types';
import { TUPLET_SPEC, type TupletKind } from '../../theory/rhythm';

/**
 * Shared parser for the compact fragment notation used by the hand-written libraries.
 *
 *   "rel:dur" tokens separated by spaces. rel = semitones from the chord root ("r" = rest).
 *   dur is either
 *     - a plain number of 16ths (1 = 16th, 2 = 8th, 4 = quarter, 16 = whole), or
 *     - a triplet token: t16 / t8 / tq (one unit of a 16th-, 8th- or quarter-note triplet) and the doubled
 *       t16x2 / t8x2 / tqx2 (two units). Triplet tokens are ALREADY on the 48-tick grid (2/4/8 ticks per unit).
 *   A trailing "~" ties the note to the next one (which repeats the same rel). Not allowed on triplet tokens.
 *
 * `plainUnit` is how many ticks one plain-number step is worth:
 *   1                 -> keep plain numbers in 16ths (legacy libraries, scaled later by fromSixteenths)
 *   TICKS_PER_16TH    -> emit finished 48-grid ticks (libraries that mix plain and triplet durations)
 * Triplet tokens are never multiplied, so a library that uses them must use the second form and bypass
 * fromSixteenths (see lib/triplets.ts and fragments/index.ts).
 */
export function parseNotes(s: string, plainUnit: number = 1): FragNote[] {
  return s.trim().split(/\s+/).map(tok => {
    const tie = tok.endsWith('~');
    const [r, d] = (tie ? tok.slice(0, -1) : tok).split(':');
    const m = /^(t16|t8|tq)(x2)?$/.exec(d ?? '');
    let dur: number;
    if (m) {
      if (tie) throw new Error(`fragment token "${tok}": triplet notes cannot be tied`);
      if (plainUnit === 1) throw new Error(`fragment token "${tok}": triplet durations need a library parsed with plainUnit = ${TICKS_PER_16TH}`);
      dur = TUPLET_SPEC[m[1] as TupletKind].unit * (m[2] ? 2 : 1);
    } else {
      dur = Number(d) * plainUnit;
      if (!Number.isFinite(dur)) throw new Error(`fragment token "${tok}": bad duration`);
    }
    const n: FragNote = { rel: r === 'r' ? null : Number(r), dur };
    if (tie) n.tie = true;
    return n;
  });
}
