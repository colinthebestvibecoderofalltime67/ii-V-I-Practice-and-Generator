import { describe, expect, it } from 'vitest';
import { generateLick, transposeLick } from '../src/generator';
import { type Ev, eventsToNotes, fixJoins } from '../src/generator/connect';
import { concertRange, getInstrument } from '../src/instruments';
import { scoreLick } from '../src/difficulty/score';
import { findTupletGroups, isTupletDur } from '../src/theory/rhythm';
import { LENGTHS, PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import { TPBAR, type LengthId, type Lick, type LickNote, type Tier } from '../src/types';

const range = concertRange(getInstrument('alto'));
const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
const TIERS: Tier[] = [1, 2, 3, 4];
const kindsOf = (l: Lick) => new Set(findTupletGroups(l.notes).groups.map(g => g.kind));

describe('triplets in generated licks', () => {
  const share: Record<Tier, { n: number; any: number; t16: number }> = {
    1: { n: 0, any: 0, t16: 0 }, 2: { n: 0, any: 0, t16: 0 }, 3: { n: 0, any: 0, t16: 0 }, 4: { n: 0, any: 0, t16: 0 },
  };
  for (const tier of TIERS) {
    for (let i = 0; i < 150; i++) {
      const p = PROGRESSIONS[i % PROGRESSIONS.length];
      const lick = generateLick({ progressionId: p.id, length: LENGTH_IDS[i % 3], keyPc: i % 12, tier, range, seed: 500 + i });
      const { groups, errors } = findTupletGroups(lick.notes);
      expect(errors, lick.id).toEqual([]);
      for (const g of groups) expect(Math.floor(g.start / TPBAR), lick.id).toBe(Math.floor((g.end - 1) / TPBAR));
      for (const n of lick.notes) if (isTupletDur(n.dur)) expect(n.tie).toBeFalsy();
      const k = kindsOf(lick);
      share[tier].n++;
      if (k.size) share[tier].any++;
      if (k.has('t16')) share[tier].t16++;
      const f = lick.difficulty.features.find(x => x.id === 'triplets');
      if (k.size) expect(f && f.points > 0, lick.id).toBe(true);
      else expect(f, lick.id).toBeUndefined();
    }
  }
  it('no triplets for Beginner; 16th-triplets only for Expert', () => {
    expect(share[1].any).toBe(0);
    expect(share[2].t16 + share[3].t16).toBe(0);
    expect(share[4].t16).toBeGreaterThan(0);
  });
  it('triplets show up from Intermediate up without becoming the default texture', () => {
    for (const t of [2, 3, 4] as Tier[]) {
      const r = share[t].any / share[t].n;
      expect(r, `tier ${t} triplet share`).toBeGreaterThan(0.08);
      expect(r, `tier ${t} triplet share`).toBeLessThan(0.45);
    }
  });
  it('transposing keeps triplet rhythm intact', () => {
    let found: Lick | undefined;
    for (let i = 0; i < 300 && !found; i++) {
      const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 4, range, seed: 900 + i });
      if (kindsOf(l).size) found = l;
    }
    expect(found).toBeTruthy();
    const t = transposeLick(found!, 5, range);
    expect(t.notes.map(n => [n.start, n.dur])).toEqual(found!.notes.map(n => [n.start, n.dur]));
    expect(findTupletGroups(t.notes).errors).toEqual([]);
  });
});

describe('join repair keeps triplet groups intact', () => {
  const chords = expandProgression(getProgression('major-251'), 'standard', 0);
  it('eventsToNotes emits triplet notes verbatim, never split or tied', () => {
    const ev: Ev[] = [
      { midi: 62, start: 0, pieces: [4] }, { midi: 65, start: 4, pieces: [4] }, { midi: 69, start: 8, pieces: [4] },
      { midi: 72, start: 12, pieces: [36] },
    ];
    const notes = eventsToNotes(ev, chords);
    expect(notes.map(n => [n.start, n.dur, !!n.tie])).toEqual([[0, 4, false], [4, 4, false], [8, 4, false], [12, 36, false]]);
    expect(notes.map(n => n.chord)).toEqual([0, 0, 0, 0]);
  });
  it('refuses a triplet note that would cross a bar line or be tied', () => {
    expect(() => eventsToNotes([{ midi: 62, start: 44, pieces: [8] }], chords)).toThrow(/bar line/);
    expect(() => eventsToNotes([{ midi: 62, start: 0, pieces: [4, 4] }], chords)).toThrow(/tied/);
  });
  it('fixJoins repairs the pitch at a chord start but leaves triplet timing and the notes before the join alone', () => {
    // last beat of Dm7's bar is a triplet group; G7 starts on a triplet group too; Cmaj7 starts on a held note
    const ev: Ev[] = [
      { midi: 62, start: 0, pieces: [36] },
      { midi: 74, start: 36, pieces: [4] }, { midi: 76, start: 40, pieces: [4] }, { midi: 78, start: 44, pieces: [4] },
      { midi: 63, start: 48, pieces: [4] }, { midi: 65, start: 52, pieces: [4] }, { midi: 67, start: 56, pieces: [4] }, // 63 = Eb over G7: not a chord tone/tension
      { midi: 71, start: 60, pieces: [36] },
      { midi: 72, start: 96, pieces: [48] },
    ];
    const before = ev.map(e => [e.start, e.pieces.join('+')]);
    fixJoins(ev, chords, [50, 90]);
    expect(ev.map(e => [e.start, e.pieces.join('+')])).toEqual(before);
    expect(ev[1].midi).toBe(74); // untouched triplet notes
    expect(ev[2].midi).toBe(76);
    expect(ev[3].midi).toBe(78);
    const notes = eventsToNotes(ev, chords);
    expect(findTupletGroups(notes).errors).toEqual([]);
  });
});

describe('triplet difficulty feature', () => {
  const prog = getProgression('major-251');
  const chords = expandProgression(prog, 'standard', 0);
  const pit = [62, 65, 69, 72];
  const line = (durs: number[]): LickNote[] => {
    let t = 0;
    return durs.map((dur, i) => {
      const n: LickNote = { midi: pit[i % pit.length], start: t, dur, chord: Math.min(2, Math.floor(t / TPBAR)) };
      t += dur;
      return n;
    });
  };
  const Q = 12;
  const feat = (r: ReturnType<typeof scoreLick>) => r.features.find(f => f.id === 'triplets');
  const t8 = scoreLick(line([4, 4, 4, ...Array(11).fill(Q)]), chords, prog);
  const tq = scoreLick(line([8, 8, 8, ...Array(10).fill(Q)]), chords, prog);
  const t16 = scoreLick(line([2, 2, 2, 6, ...Array(11).fill(Q)]), chords, prog);

  it('is absent without triplets', () => {
    expect(feat(scoreLick(line(Array(12).fill(Q)), chords, prog))).toBeUndefined();
  });
  it('weights 8th-triplets < quarter-triplets < 16th-triplets, capped at 10', () => {
    expect(feat(t8)!.points).toBeGreaterThan(0);
    expect(feat(tq)!.points).toBeGreaterThan(feat(t8)!.points);
    expect(feat(t16)!.points).toBeGreaterThan(feat(tq)!.points);
    expect(feat(t16)!.points).toBeLessThanOrEqual(10);
  });
  it('does not double count with 16th-note runs or syncopation', () => {
    expect(t16.features.find(f => f.id === 'sixteenths')!.points).toBe(0);
    expect(t16.features.find(f => f.id === 'syncopation')!.points).toBe(0);
    expect(tq.features.find(f => f.id === 'syncopation')!.points).toBe(0);
    expect(t8.features.find(f => f.id === 'syncopation')!.points).toBe(0);
  });
  it('ignores groups that are all rests', () => {
    const notes = line([4, 4, 4, ...Array(11).fill(Q)]);
    for (let i = 0; i < 3; i++) notes[i].midi = null;
    expect(feat(scoreLick(notes, chords, prog))).toBeUndefined();
  });
});
