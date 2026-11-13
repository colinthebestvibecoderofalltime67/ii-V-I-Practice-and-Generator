import { RENDERABLE_DURS, TPB, TPBAR } from '../types';

const DESC = [...RENDERABLE_DURS].sort((a, b) => b - a);

/**
 * Split a duration (ticks) into RENDERABLE_DURS pieces, greedy largest first.
 * Throws if the remainder cannot be expressed (e.g. a duration that is not a multiple of a 16th).
 */
export function splitDur(d: number): number[] {
  if (!Number.isInteger(d) || d < 0) throw new Error(`splitDur: invalid duration ${d}`);
  const out: number[] = [];
  let left = d;
  while (left > 0) {
    const p = DESC.find(x => x <= left);
    if (p === undefined) throw new Error(`splitDur: cannot express ${left} ticks (of ${d}) with renderable durations`);
    out.push(p);
    left -= p;
  }
  return out;
}

/** Beat index (0-based, quarter-note beats) containing a tick. */
export const beatOf = (tick: number): number => Math.floor(tick / TPB);

/** Bar index (0-based, 4/4) containing a tick. */
export const barOf = (tick: number): number => Math.floor(tick / TPBAR);
