import { describe, expect, it } from 'vitest';
import { buildPieces } from '../src/render/notation';
import type { Lick, LickNote } from '../src/types';

function lick(notes: LickNote[]): Lick {
  return { version: 2, id: 't', seed: 1, progressionId: 'x', length: 'standard', keyPc: 0, mode: 'major', requestedTier: 1,
    chords: [], notes, totalTicks: 96, fragmentIds: [], difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0 };
}
const n = (midi: number | null, start: number, dur: number, tie?: boolean): LickNote => ({ midi, start, dur, chord: 0, ...(tie ? { tie } : {}) });

describe('buildPieces with triplets', () => {
  it('keeps triplet notes whole, writes them at 3/2 and groups them', () => {
    const l = lick([
      n(60, 0, 4), n(62, 4, 4), n(64, 8, 4), // t8
      n(65, 12, 8), n(null, 20, 4), // t8: quarter + eighth rest
      n(67, 24, 6), n(69, 30, 6), // plain 8ths
      n(71, 36, 2), n(72, 38, 2), n(74, 40, 2), n(76, 42, 6), // t16 + 8th
    ]);
    const [bar] = buildPieces(l, 0, 2);
    expect(bar.reduce((a, p) => a + p.dur, 0)).toBe(48);
    expect(bar.slice(0, 3).map(p => [p.dur, p.disp, p.tup?.kind, p.tup?.group])).toEqual([[4, 6, 't8', 0], [4, 6, 't8', 0], [4, 6, 't8', 0]]);
    expect(bar[3]).toMatchObject({ dur: 8, disp: 12, tup: { kind: 't8', group: 1 } });
    expect(bar[4]).toMatchObject({ midi: null, dur: 4, disp: 6, tup: { group: 1 } });
    expect(bar[5].tup).toBeUndefined();
    expect(bar.slice(7, 10).map(p => [p.dur, p.disp, p.tup?.kind])).toEqual([[2, 3, 't16'], [2, 3, 't16'], [2, 3, 't16']]);
    expect(bar[10].tup).toBeUndefined();
  });

  it('never ties triplet notes and still splits ordinary notes', () => {
    const l = lick([n(60, 0, 4, true), n(60, 4, 4), n(62, 8, 4), n(64, 12, 36, true), n(64, 48, 12)]);
    const [b0, b1] = buildPieces(l, 0, 2);
    expect(b0.filter(p => p.tup).every(p => !p.tieNext)).toBe(true);
    expect(b0.reduce((a, p) => a + p.dur, 0)).toBe(48);
    expect(b1[0]).toMatchObject({ dur: 12, cont: true });
    expect(b0[b0.length - 1].tieNext).toBe(true);
  });

  it('fills gaps with rests', () => {
    const [bar] = buildPieces(lick([n(60, 12, 12)]), 0, 1);
    expect(bar.map(p => [p.midi, p.dur])).toEqual([[null, 12], [60, 12], [null, 24]]);
  });
});
