import { describe, expect, it } from 'vitest';
import { findTupletGroups, isTupletDur, tupletDisplayDur } from '../src/theory/rhythm';

const seq = (durs: number[], start = 0) => {
  let t = start;
  return durs.map(dur => { const s = t; t += dur; return { start: s, dur }; });
};

describe('findTupletGroups', () => {
  it('finds 8th, quarter and 16th triplet groups', () => {
    const { groups, errors } = findTupletGroups(seq([4, 4, 4, 6, 2, 2, 2, 8, 8, 8, 12]));
    expect(errors).toEqual([]);
    expect(groups.map(g => [g.kind, g.start, g.end, g.first, g.last])).toEqual([
      ['t8', 0, 12, 0, 2], ['t16', 18, 24, 4, 6], ['tq', 24, 48, 7, 9],
    ]);
  });
  it('allows 2-unit notes inside a group', () => {
    const { groups, errors } = findTupletGroups(seq([8, 4, 4, 8]));
    expect(errors).toEqual([]);
    expect(groups.map(g => g.kind)).toEqual(['t8', 't8']);
  });
  it('ignores normal rhythms', () => {
    expect(findTupletGroups(seq([3, 3, 6, 12, 24])).groups).toEqual([]);
  });
  it('reports misaligned and unterminated groups', () => {
    expect(findTupletGroups(seq([6, 4, 4, 4])).errors.length).toBeGreaterThan(0); // t8 starting on the "and"
    expect(findTupletGroups(seq([4, 4])).errors.length).toBeGreaterThan(0);
  });
  it('helpers', () => {
    expect([2, 4, 8, 16].every(isTupletDur)).toBe(true);
    expect([3, 6, 12].some(isTupletDur)).toBe(false);
    expect(tupletDisplayDur(4)).toBe(6);
  });
});
