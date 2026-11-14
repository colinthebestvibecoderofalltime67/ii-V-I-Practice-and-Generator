import { describe, expect, it } from 'vitest';
import { summarize } from '../src/analysis/musicality';
import { posToScore, scoreLick, tierForScore } from '../src/difficulty/score';
import { FRAGMENTS } from '../src/fragments';
import { generateLick, transposeLick } from '../src/generator';
import { type Ev, fixJoins, fixLeaps, isEndingTone, phraseEvents } from '../src/generator/connect';
import { Rng } from '../src/generator/rng';
import { INSTRUMENTS, concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { judgedChord } from '../src/theory/rhythm';
import { LENGTHS, PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import type { LengthId, Lick, LickChord, LickNote, Tier } from '../src/types';
import { TIER_NAMES } from '../src/types';

const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];

describe('hard instrument range', () => {
  it('reproduces nothing outside the range (bass, tritone-251, key 4, pos 70, seed 2155342693)', () => {
    const range = concertRange(getInstrument('bass'));
    const l = generateLick({ progressionId: 'tritone-251', length: 'standard', keyPc: 4, tier: 1, targetScore: posToScore(70), range, seed: 2155342693 });
    for (const n of l.notes) if (n.midi != null) { expect(n.midi).toBeGreaterThanOrEqual(range[0]); expect(n.midi).toBeLessThanOrEqual(range[1]); }
  });

  it('no note is ever outside the range: every instrument x progression x length x target', () => {
    let seed = 7000;
    for (const inst of INSTRUMENTS) {
      const range = concertRange(inst);
      for (const p of PROGRESSIONS) for (const length of LENGTH_IDS) for (const pos of [10, 50, 90]) {
        const l = generateLick({ progressionId: p.id, length, keyPc: seed % 12, tier: 1, targetScore: posToScore(pos), range, seed: seed++ });
        const bad = l.notes.filter(n => n.midi != null && (n.midi < range[0] || n.midi > range[1]));
        expect(bad, `${inst.id}/${p.id}/${length}/pos${pos}`).toEqual([]);
      }
    }
  }, 120_000);
});

describe('transposeLick comfort range', () => {
  it('re-keying with a comfort range stays inside the hard range and nearer the comfort range than without', () => {
    const inst = getInstrument('alto');
    const range = concertRange(inst);
    const comfort = concertRangeForLevel(inst, 1);
    let withC = 0, without = 0;
    for (let s = 0; s < 40; s++) {
      const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 1, range, comfortRange: comfort, seed: s + 1 });
      const out = (t: Lick) => t.notes.reduce((a, n) => a + (n.midi == null ? 0 : Math.max(0, comfort[0] - n.midi, n.midi - comfort[1])), 0);
      const a = transposeLick(l, (s * 5 + 3) % 12, range, comfort);
      const b = transposeLick(l, (s * 5 + 3) % 12, range);
      for (const n of a.notes) if (n.midi != null) { expect(n.midi).toBeGreaterThanOrEqual(range[0]); expect(n.midi).toBeLessThanOrEqual(range[1]); }
      withC += out(a);
      without += out(b);
    }
    expect(withC).toBeLessThanOrEqual(without);
  });
});

describe('ending tones', () => {
  it('accepts the 6th and 9th over maj7 and the 6th over m6, but not the major 7th over m6', () => {
    expect(isEndingTone(60 + 9, 0, 'maj7')).toBe(true);
    expect(isEndingTone(60 + 2, 0, 'maj7')).toBe(true);
    expect(isEndingTone(60 + 5, 0, 'maj7')).toBe(false);
    expect(isEndingTone(60 + 9, 0, 'm6')).toBe(true);
    expect(isEndingTone(60 + 11, 0, 'm6')).toBe(false);
  });

  it('the final repair never re-attacks the previous pitch', () => {
    const chords: LickChord[] = [{ rootPc: 0, quality: 'maj7', symbol: 'Cmaj7', start: 0, dur: 48 }];
    const ev: Ev[] = [{ midi: 64, start: 0, pieces: [24] }, { midi: 64, start: 24, pieces: [24] }];
    fixJoins(ev, chords, [48, 84]);
    expect(ev[1].midi).not.toBe(ev[0].midi);
    expect(isEndingTone(ev[1].midi as number, 0, 'maj7')).toBe(true);
  });
});

describe('big leaps', () => {
  it('fixLeaps moves a wrong-octave note by an octave and keeps pitch classes', () => {
    const ev: Ev[] = [71, 61, 62, 64].map((m, i) => ({ midi: m, start: i * 6, pieces: [6] }));
    const pcs = ev.map(e => (e.midi as number) % 12);
    fixLeaps(ev, [48, 84]);
    for (let i = 1; i < ev.length; i++) expect(Math.abs((ev[i].midi as number) - (ev[i - 1].midi as number))).toBeLessThan(10);
    expect(ev.map(e => (e.midi as number) % 12)).toEqual(pcs);
  });

  it('a chromatic approach swapped in by fixJoins never adds a leap of 10 or more', () => {
    const chords: LickChord[] = [
      { rootPc: 2, quality: 'm7', symbol: 'Dm7', start: 0, dur: 48 }, { rootPc: 7, quality: 'dom7', symbol: 'G7', start: 48, dur: 48 },
    ];
    for (let from = 60; from <= 84; from++) {
      const ev: Ev[] = [{ midi: from, start: 36, pieces: [6] }, { midi: from, start: 42, pieces: [6] }, { midi: 59, start: 48, pieces: [48] }];
      ev[0].start = 0; ev[0].pieces = [36]; ev[1].start = 36; ev[1].pieces = [12];
      fixJoins(ev, chords, [48, 90]);
      const leap = Math.abs((ev[2].midi as number) - (ev[1].midi as number));
      const was = Math.abs(59 - from);
      if (was < 10) expect(leap).toBeLessThan(10);
    }
  });
});

describe('anticipation edge cases', () => {
  const chords: LickChord[] = [
    { rootPc: 2, quality: 'm7', symbol: 'Dm7', start: 0, dur: 48 }, { rootPc: 7, quality: 'dom7', symbol: 'G7', start: 48, dur: 48 },
  ];
  it('never deletes a guide-tone landing of the previous chord to anticipate', () => {
    for (let seed = 1; seed <= 150; seed++) {
      // ... A(8th) F(8th, the 3rd of Dm7) | B (3rd of G7) ...
      const ev: Ev[] = [
        { midi: 62, start: 0, pieces: [12] }, { midi: 64, start: 12, pieces: [12] }, { midi: 69, start: 24, pieces: [12] },
        { midi: 65, start: 36, pieces: [6] }, { midi: 63, start: 42, pieces: [6] }, { midi: 71, start: 48, pieces: [48] },
      ];
      // the 8th right before the change is F (the 3rd of Dm7): anticipating B would have to delete it
      ev[3] = { midi: 66, start: 36, pieces: [6] };
      ev[4] = { midi: 65, start: 42, pieces: [6] };
      phraseEvents(new Rng(seed), ev, [0, 5], chords, [48, 90], { level: 3 });
      expect(ev.some(e => e.midi === 65), `seed ${seed}`).toBe(true);
    }
  });
});

describe('scorer: anticipation heads belong to the arrival chord', () => {
  it('a chord tone of the arriving chord anticipated an eighth early is not chromatic', () => {
    const prog = getProgression('major-251');
    const chs = expandProgression(prog, 'standard', 0);
    // B (3rd of G7) attacked an 8th before G7 and tied across; against Dm7 B is chromatic
    const notes: LickNote[] = [
      { midi: 62, start: 0, dur: 12, chord: 0 }, { midi: 65, start: 12, dur: 12, chord: 0 }, { midi: 69, start: 24, dur: 12, chord: 0 },
      { midi: 71, start: 42, dur: 6, tie: true, chord: 0 }, { midi: 71, start: 48, dur: 48, chord: 1 },
    ];
    const judged = notes.map((_, i) => judgedChord(notes, i));
    expect(judged[3]).toBe(1);
    const r = scoreLick(notes, chs, prog);
    expect(r.features.find(f => f.id === 'chromatic')?.points ?? 0).toBe(0);
  });
});

describe('sequences and 16th share', () => {
  const sample = (() => {
    const out: Lick[] = [];
    const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
    const insts = ['alto', 'guitar'].map(getInstrument);
    let seed = 1;
    for (const p of PROGRESSIONS) for (const length of LENGTH_IDS) for (const pos of [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]) for (let s = 0; s < 6; s++) {
      const inst = insts[s % 2];
      const l = generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: posToScore(pos), range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tierForScore(posToScore(pos))), seed: seed++ });
      out.push(l);
      byTier[l.requestedTier].push(l);
    }
    return { all: out, byTier };
  })();

  it('at most one sequence cell per lick', () => {
    const tags = new Map(FRAGMENTS.map(f => [f.id, f.tags.includes('sequence')]));
    for (const l of sample.all) expect(l.fragmentIds.filter(id => tags.get(id)).length, l.id).toBeLessThanOrEqual(1);
  }, 60_000);

  it('musicality targets (current library; Phase 2b)', () => {
    const rows = ([1, 2, 3, 4] as Tier[]).map(t => [TIER_NAMES[t], summarize(sample.byTier[t])] as const);
    const m = Object.fromEntries(rows);
    for (const [name, r] of rows) {
      expect(r.bigLeapShare, `${name} leap10`).toBeLessThanOrEqual(0.08);
      expect(r.maj7FourthShare, `${name} maj7-4th`).toBeLessThanOrEqual(0.05);
      expect(r.lydianElevenShare, `${name} lyd-11`).toBeLessThanOrEqual(0.1);
      expect(r.endingRepeatShare, `${name} endRepeat`).toBeLessThanOrEqual(0.01);
    }
    expect(m.Expert.sixteenthShare).toBeLessThanOrEqual(0.35);
    expect(m.Beginner.altPlainShare).toBeLessThanOrEqual(0.4);
    expect(m.Intermediate.altPlainShare).toBeLessThanOrEqual(0.2);
    expect(m.Advanced.altPlainShare).toBeLessThanOrEqual(0.05);
    expect(m.Expert.altPlainShare).toBeLessThanOrEqual(0.05);
    expect(m.Advanced.anticipationShare).toBeGreaterThanOrEqual(0.35);
    expect(m.Expert.anticipationShare).toBeGreaterThanOrEqual(0.35);
  }, 60_000);
});
