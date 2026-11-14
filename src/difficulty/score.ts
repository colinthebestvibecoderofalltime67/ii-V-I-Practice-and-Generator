import type { DifficultyFeature, DifficultyResult, LickChord, LickNote, ProgressionDef, Tier } from '../types';
import { ALTERED_RELS, inScale, isChordTone, isChordToneOrTension } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { TICKS_PER_16TH as S16, TPB } from '../types';
import { beatOf, findTupletGroups, isTupletDur, type TupletKind } from '../theory/rhythm';

/**
 * Difficulty scoring (0..100) from the NOTES ONLY (tempo is not a factor).
 *
 * Each feature maps a measured value to 0..max points by a clamped linear ramp. The maxima
 * sum to 100. Weights and thresholds were calibrated against the 55 prototype licks
 * (tests/difficulty.test.ts): Beginner = quarter-note scales/arpeggios, Medium = steady 8ths,
 * Advanced = 8ths with chromatic/altered colour. Tier 4 (Expert) needs what the prototype
 * barely has: 16th-note runs, heavy chromaticism / altered tensions, big leaps, wide range.
 */
export const TIER_THRESHOLDS: [number, number, number] = [7, 15, 44];

export const FEATURE_MAX = {
  density: 20,
  sixteenths: 14,
  syncopation: 10,
  offchord: 14,
  chromatic: 14,
  altered: 8,
  leaps: 8,
  range: 4,
  harmony: 8,
  /** Only present (and only > 0) for licks that contain a triplet group; see TRIPLET_WEIGHT. The other maxima sum
   *  to 100, so this is bonus headroom: scores are clamped to 100 and licks without triplets are unchanged. */
  triplets: 10,
} as const;

/**
 * Triplet difficulty per group (summed over the lick, then ramped to FEATURE_MAX.triplets over 0..TRIPLET_FULL):
 *  - 8th-triplet (one beat): moderate;
 *  - quarter-triplet (two-beat cross-beat feel, replaces the sync contribution a tied/off-beat note would get): more;
 *  - 16th-triplet (an 8th split in three; fast): most.
 * Groups that only contain rests are ignored.
 * No double counting: triplet notes never start/stop on the 16th grid, so syncopation (start % TPB tests for 16th
 * offsets, and tied notes) does not see them, and the `sixteenths` feature only counts real 16ths (dur === 3),
 * NOT 16th-triplet notes (dur 2); their speed is paid for once, through the weight below.
 */
const TRIPLET_WEIGHT: Record<TupletKind, number> = { t8: 1, tq: 1.8, t16: 2.4 };
const TRIPLET_FULL = 4;

const ramp = (v: number, lo: number, hi: number): number => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

export function tierForScore(score: number): Tier {
  if (score < TIER_THRESHOLDS[0]) return 1;
  if (score < TIER_THRESHOLDS[1]) return 2;
  if (score < TIER_THRESHOLDS[2]) return 3;
  return 4;
}

/** Whole-number score for display that never rounds across a tier threshold (14.6 shows as 14, still Intermediate). */
export function displayScore(score: number): number {
  const r = Math.round(score);
  const t = tierForScore(score);
  if (t < 4 && r >= TIER_THRESHOLDS[t - 1]) return TIER_THRESHOLDS[t - 1] - 1;
  if (t > 1 && r < TIER_THRESHOLDS[t - 2]) return TIER_THRESHOLDS[t - 2];
  return r;
}

/**
 * Practical maximum score: the 95th percentile of 360 Expert licks (all progressions, lengths,
 * four instruments, seeds 1..360) was 57.4, rounded up. The slider's top end maps here.
 */
export const SCORE_CEIL = 58;

/** Slider positions (0..100) of the boundaries between tiers 1|2, 2|3, 3|4: each tier gets a quarter of the travel. */
export const TIER_POS: [number, number, number] = [25, 50, 75];

const KNOTS_SCORE = [0, ...TIER_THRESHOLDS, SCORE_CEIL];
const KNOTS_POS = [0, ...TIER_POS, 100];

function piecewise(x: number, from: number[], to: number[]): number {
  if (!(x > from[0])) return to[0];
  for (let i = 1; i < from.length; i++) {
    if (x <= from[i]) return to[i - 1] + ((x - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
  }
  return to[to.length - 1];
}

/** Slider position 0..100 -> target difficulty score (piecewise linear, tier boundaries at 25/50/75). */
export const posToScore = (pos: number): number => piecewise(pos, KNOTS_POS, KNOTS_SCORE);

/** Difficulty score -> slider position 0..100 (inverse of posToScore, clamped). */
export const scoreToPos = (score: number): number => piecewise(score, KNOTS_SCORE, KNOTS_POS);

const r1 = (n: number) => Math.round(n * 10) / 10;

function chordAt(chords: LickChord[], tick: number): LickChord {
  for (let i = chords.length - 1; i >= 0; i--) if (tick >= chords[i].start) return chords[i];
  return chords[0];
}

interface Attack { midi: number; start: number; dur: number; tied: boolean; crossesBeat: boolean }

/** Merge tie chains into single sounding attacks. */
function attacks(notes: LickNote[]): Attack[] {
  const out: Attack[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.midi == null) continue;
    let dur = n.dur;
    let tied = false;
    let j = i;
    while (notes[j].tie && j + 1 < notes.length && notes[j + 1].midi === n.midi) {
      j++;
      dur += notes[j].dur;
      tied = true;
    }
    i = j;
    const end = n.start + dur;
    out.push({
      midi: n.midi, start: n.start, dur, tied,
      crossesBeat: beatOf(end - 1) > beatOf(n.start),
    });
  }
  return out;
}

export function scoreLick(notes: LickNote[], chords: LickChord[], progression: ProgressionDef): DifficultyResult {
  const att = attacks(notes);
  const endTick = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const beats = Math.max(1, endTick / TPB);
  const N = Math.max(1, att.length);

  // density: attacks per beat
  const density = att.length / beats;
  // share of 16th-or-shorter attacks (merged durations)
  const is16 = (a: Attack) => a.dur <= S16 && !isTupletDur(a.dur);
  const share16 = att.filter(is16).length / N;
  // fraction of beats that contain 16th motion (runs, not isolated 16ths)
  let runs16 = 0;
  for (let i = 0; i + 1 < att.length; i++) if (is16(att[i]) && is16(att[i + 1])) runs16++;
  const run16Share = runs16 / N;

  // syncopation per beat
  let sync = 0;
  for (const a of att) {
    const p = a.start % TPB;
    if (p === 2 * S16 && a.dur > 2 * S16 && a.crossesBeat) sync += 1; // held across the next beat from the "and"
    else if (p === S16 || p === 3 * S16) sync += a.dur >= 2 * S16 ? 1 : 0.35; // off-16th, held or not
    else if (p === 0 && a.dur === 3 * S16) sync += 0.2; // dotted 8th on the beat
    if (a.tied) sync += a.crossesBeat ? 0.6 : 0.3; // tie across beat or bar
  }
  const syncPerBeat = sync / beats;

  // chromaticism and altered tensions relative to the sounding chord
  let chroma = 0;
  let nct = 0;
  let altN = 0;
  let domN = 0;
  for (const a of att) {
    const c = chordAt(chords, a.start);
    const inside = inScale(a.midi, c.rootPc, c.quality) || isChordToneOrTension(a.midi, c.rootPc, c.quality);
    if (!inside) chroma += 1;
    if (!isChordTone(a.midi, c.rootPc, c.quality)) nct += 1;
    if (c.quality === 'dom7' || c.quality === 'dom7alt') {
      domN++;
      if (ALTERED_RELS.includes(mod12(a.midi - c.rootPc))) altN++;
    }
  }
  const chromaShare = chroma / N;
  const nctShare = nct / N;
  const altShare = domN ? altN / domN : 0;
  // for altered chords the altered scale is "in scale", so count altered share over all attacks too
  const altOfAll = altN / N;

  // leaps
  let sum = 0;
  let max = 0;
  let big = 0;
  for (let i = 1; i < att.length; i++) {
    const d = Math.abs(att[i].midi - att[i - 1].midi);
    sum += d;
    max = Math.max(max, d);
    if (d > 7) big++;
  }
  const meanLeap = att.length > 1 ? sum / (att.length - 1) : 0;
  const bigShare = att.length > 1 ? big / (att.length - 1) : 0;

  const mids = att.map(a => a.midi);
  const span = mids.length ? Math.max(...mids) - Math.min(...mids) : 0;

  // triplet groups that contain at least one sounding note, weighted by kind
  let tripletLoad = 0;
  let tripletGroups = 0;
  if (notes.some(n => isTupletDur(n.dur))) {
    for (const g of findTupletGroups(notes).groups) {
      if (!notes.slice(g.first, g.last + 1).some(n => n.midi != null)) continue;
      tripletLoad += TRIPLET_WEIGHT[g.kind];
      tripletGroups++;
    }
  }

  const F = FEATURE_MAX;
  const features: DifficultyFeature[] = [
    { id: 'density', label: 'Busy rhythm', value: r1(density), points: F.density * ramp(density, 0.9, 3.4) },
    {
      id: 'sixteenths', label: '16th-note runs', value: r1(share16 * 100),
      points: F.sixteenths * (0.6 * ramp(share16, 0.0, 0.5) + 0.4 * ramp(run16Share, 0, 0.4)),
    },
    { id: 'syncopation', label: 'Syncopation', value: r1(syncPerBeat), points: F.syncopation * ramp(syncPerBeat, 0.05, 1.0) },
    { id: 'offchord', label: 'Passing & extension tones', value: r1(nctShare * 100), points: F.offchord * ramp(nctShare, 0.05, 0.4) },
    { id: 'chromatic', label: 'Chromatic notes', value: r1(chromaShare * 100), points: F.chromatic * ramp(chromaShare, 0.04, 0.35) },
    {
      id: 'altered', label: 'Altered tensions', value: r1(Math.max(altShare, altOfAll) * 100),
      points: F.altered * ramp(altShare, 0.12, 0.6),
    },
    {
      id: 'leaps', label: 'Wide leaps', value: max,
      points: F.leaps * (0.4 * ramp(meanLeap, 2.6, 5.5) + 0.3 * ramp(max, 7, 14) + 0.3 * ramp(bigShare, 0, 0.2)),
    },
    { id: 'range', label: 'Wide range', value: span, points: F.range * ramp(span, 10, 26) },
    { id: 'harmony', label: 'Advanced harmony', value: progression.complexity, points: F.harmony * progression.complexity },
  ];
  if (tripletGroups > 0) {
    features.push({ id: 'triplets', label: 'Triplets', value: tripletGroups, points: F.triplets * ramp(tripletLoad, 0, TRIPLET_FULL) });
  }
  for (const f of features) f.points = r1(f.points);
  features.sort((a, b) => b.points - a.points);
  const score = Math.max(0, Math.min(100, r1(features.reduce((s, f) => s + f.points, 0))));
  return { score, tier: tierForScore(score), features };
}
