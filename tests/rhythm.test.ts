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

import { judgedChord } from '../src/theory/rhythm';
import { generateLick } from '../src/generator/generate';
import { concertRange, getInstrument } from '../src/instruments';
import { spellLick } from '../src/theory/spell';
import { analyzeLick } from '../src/theory/analyze';
import { PROGRESSIONS } from '../src/theory/progressions';

describe('anticipations are heard against the chord they arrive on', () => {
  const notes = [
    { midi: 60, start: 0, dur: 42, chord: 0 },
    { midi: 64, start: 42, dur: 6, tie: true, chord: 0 },  // E on the "and" of 4, tied into the next chord
    { midi: 64, start: 48, dur: 48, chord: 1 },
  ];
  it('judgedChord returns the arrival chord for an anticipation and the own chord otherwise', () => {
    expect(judgedChord(notes, 0)).toBe(0);
    expect(judgedChord(notes, 1)).toBe(1);
    expect(judgedChord(notes, 2)).toBe(1);
    // a long note tied over a change (started a beat or more before) keeps its own chord
    expect(judgedChord([{ midi: 64, start: 0, tie: true, chord: 0 }, { midi: 64, start: 48, chord: 1 }], 0)).toBe(0);
  });
  it('no anticipation head is spelled or labelled against the old chord (piano sweep)', () => {
    const piano = getInstrument('piano');
    let heads = 0;
    for (const p of PROGRESSIONS.map(p => p.id)) {
      for (let seed = 1; seed <= 40; seed++) {
        const l = generateLick({ progressionId: p, length: 'standard', keyPc: seed % 12, tier: 3, range: concertRange(piano), seed });
        const a = analyzeLick(l, piano);
        const sp = spellLick(l, piano);
        l.notes.forEach((n, i) => {
          if (n.midi == null || judgedChord(l.notes, i) === n.chord) return;
          heads++;
          expect(a.notes[i]?.kind, `${p} seed ${seed} note ${i}`).not.toBe('chromatic');
          expect(sp[i]).not.toBeNull();
        });
      }
    }
    expect(heads).toBeGreaterThan(20);
  });
});
