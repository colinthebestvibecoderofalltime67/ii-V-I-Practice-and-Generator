import { describe, expect, it } from 'vitest';
import { loadPrototypeLicks } from '../scripts/legacy';
import type { LickNote } from '../src/types';
import { TICKS_PER_16TH as S, TPBAR } from '../src/types';
import { TIER_THRESHOLDS, scoreLick, tierForScore } from '../src/difficulty/score';
import { expandProgression, getProgression } from '../src/theory/progressions';

const prog = getProgression('major-251');
const chords = expandProgression(prog, 'standard', 0);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

const protoScores = () => {
  const by: Record<string, { score: number; tier: number }[]> = { Beginner: [], Medium: [], Advanced: [] };
  for (const l of loadPrototypeLicks()) {
    const notes: LickNote[] = l.notes.map(n => ({
      midi: n.midi, start: n.start, dur: n.dur, ...(n.tie ? { tie: true } : {}), chord: Math.min(2, Math.floor(n.start / TPBAR)),
    })); // prototype notes arrive in engine ticks already
    const r = scoreLick(notes, chords, prog);
    by[l.level].push({ score: r.score, tier: r.tier });
  }
  return by;
};

// spec durations are written in 16ths (1 = 16th, 4 = quarter, 16 = bar) and scaled to engine ticks
const mk = (spec: [number | null, number][], tieAll = false): LickNote[] => {
  let t = 0;
  return spec.map(([midi, d16]) => {
    const dur = d16 * S;
    const n: LickNote = { midi, start: t, dur, chord: Math.min(2, Math.floor(t / TPBAR)) };
    if (tieAll) n.tie = true;
    t += dur;
    return n;
  });
};

describe('difficulty calibration on the prototype licks', () => {
  const by = protoScores();

  it('prints the confusion matrix', () => {
    const rows = Object.entries(by).map(([level, v]) => ({
      level, n: v.length, mean: +mean(v.map(x => x.score)).toFixed(1),
      tier1: v.filter(x => x.tier === 1).length, tier2: v.filter(x => x.tier === 2).length,
      tier3: v.filter(x => x.tier === 3).length, tier4: v.filter(x => x.tier === 4).length,
    }));
    console.table(rows);
    expect(rows.length).toBe(3);
  });

  it('mean score rises clearly Beginner < Medium < Advanced', () => {
    const [b, m, a] = ['Beginner', 'Medium', 'Advanced'].map(k => mean(by[k].map(x => x.score)));
    expect(m - b).toBeGreaterThan(5);
    expect(a - m).toBeGreaterThan(5);
  });

  it('>= 75% of Beginner licks are tier 1', () => {
    expect(by.Beginner.filter(x => x.tier === 1).length / by.Beginner.length).toBeGreaterThanOrEqual(0.75);
  });
  it('>= 60% of Medium licks are tier 2', () => {
    expect(by.Medium.filter(x => x.tier === 2).length / by.Medium.length).toBeGreaterThanOrEqual(0.6);
  });
  it('>= 75% of Advanced licks are tier >= 3', () => {
    expect(by.Advanced.filter(x => x.tier >= 3).length / by.Advanced.length).toBeGreaterThanOrEqual(0.75);
  });
  it('Expert is rare among the prototype licks (it needs 16th runs, heavy chromaticism, big leaps)', () => {
    const all = Object.values(by).flat();
    expect(all.filter(x => x.tier === 4).length / all.length).toBeLessThanOrEqual(0.1);
  });
});

describe('scoreLick extremes', () => {
  it('whole notes on chord tones are tier 1 with a tiny score', () => {
    const notes = mk([[62, 16], [59, 16], [64, 16]]);
    const r = scoreLick(notes, chords, prog);
    expect(r.tier).toBe(1);
    expect(r.score).toBeLessThan(3);
  });

  it('a dense chromatic altered 16th line with big leaps is tier 4', () => {
    const pitches = [62, 66, 61, 69, 60, 72, 59, 75, 58, 78, 57, 81, 56, 77, 60, 73];
    const spec: [number, number][] = [];
    for (let i = 0; i < 16; i++) spec.push([pitches[i], 1]); // Dm7 bar
    const g7 = [68, 75, 66, 73, 70, 77, 61, 80, 63, 75, 68, 78, 64, 73, 66, 79];
    for (const p of g7) spec.push([p, 1]);
    const c = [71, 78, 66, 73, 69, 80, 61, 76, 70, 79, 62, 74, 68, 81, 65, 77];
    for (const p of c) spec.push([p, 1]);
    const alt = getProgression('major-251-alt');
    const r = scoreLick(mk(spec), expandProgression(alt, 'standard', 0), alt);
    expect(r.tier).toBe(4);
    expect(r.score).toBeGreaterThan(60);
    expect(r.features[0].points).toBeGreaterThanOrEqual(r.features[r.features.length - 1].points);
  });

  it('a plain stepwise 16th-note scale run is harder than quarter notes but not necessarily expert', () => {
    const quarters = scoreLick(mk([[62, 4], [64, 4], [65, 4], [67, 4], [67, 4], [65, 4], [64, 4], [62, 4], [60, 16]]), chords, prog);
    const sixteenths: [number, number][] = [];
    for (let i = 0; i < 24; i++) sixteenths.push([62 + (i % 8), 2]);
    for (let i = 0; i < 16; i++) sixteenths.push([60 + (i % 5), 1]);
    const runs = scoreLick(mk(sixteenths), chords, prog);
    expect(runs.score).toBeGreaterThan(quarters.score + 10);
  });

  it('features are sorted by points, scores are bounded and tempo-free', () => {
    const r = scoreLick(mk([[62, 2], [63, 2], [66, 1], [70, 1], [61, 2], [64, 8]]), chords, prog);
    for (let i = 1; i < r.features.length; i++) expect(r.features[i - 1].points).toBeGreaterThanOrEqual(r.features[i].points);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.tier).toBe(tierForScore(r.score));
  });

  it('tierForScore respects TIER_THRESHOLDS', () => {
    const [a, b, c] = TIER_THRESHOLDS;
    expect([tierForScore(a - 0.1), tierForScore(a), tierForScore(b), tierForScore(c)]).toEqual([1, 2, 3, 4]);
  });

  it('progression complexity adds points', () => {
    const notes = mk([[62, 4], [65, 4], [69, 4], [72, 4]]);
    const hard = getProgression('minor-251');
    const a = scoreLick(notes, chords, prog).score;
    const b = scoreLick(notes, chords, hard).score;
    expect(b).toBeGreaterThan(a);
  });

  it('syncopated tied notes score above the same line on the beat', () => {
    const straight = mk([[62, 4], [65, 4], [69, 4], [72, 4], [71, 16]]);
    const sync = mk([[62, 2], [65, 6], [69, 4], [72, 2], [71, 2], [67, 6]].map(([m, d]) => [m, d] as [number, number]));
    const sc = scoreLick(sync, chords, prog).features.find(f => f.id === 'syncopation')!.points;
    const st = scoreLick(straight, chords, prog).features.find(f => f.id === 'syncopation')!.points;
    expect(sc).toBeGreaterThan(st);
  });
});
