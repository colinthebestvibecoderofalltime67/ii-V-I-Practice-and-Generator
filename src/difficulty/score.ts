import type { DifficultyFeature, DifficultyResult, LickChord, LickNote, ProgressionDef, Tier } from '../types';
import { ALTERED_RELS, inScale, isChordTone, isChordToneOrTension } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { TICKS_PER_16TH as S16, TPB } from '../types';
import { beatOf, findTupletGroups, isTupletDur, judgedChord, type TupletKind } from '../theory/rhythm';

/**
 * Difficulty scoring (0..100) from the NOTES ONLY (tempo is not a factor).
 *
 * Each feature maps a measured value to 0..max points by a clamped linear ramp. The maxima
 * sum to 100. Weights and thresholds were calibrated against the 55 prototype licks
 * (tests/difficulty.test.ts): Beginner = quarter-note scales/arpeggios, Medium = steady 8ths,
 * Advanced = 8ths with chromatic/altered colour. Tier 4 (Expert) is reached by jazz LANGUAGE, not speed: 16th-note
 * runs are capped at a small share of the points; chromatic enclosures and approach notes, altered tensions (a long,
 * resolving altered note counts for much less than a fast altered run), syncopation and anticipations, rests and
 * rhythmic variety, and register span carry the rest.
 */
export const TIER_THRESHOLDS: [number, number, number] = [7, 15, 44];

export const FEATURE_MAX = {
  density: 18,
  sixteenths: 8,
  syncopation: 10,
  offchord: 12,
  chromatic: 12,
  altered: 10,
  approach: 6,
  leaps: 8,
  range: 4,
  harmony: 8,
  phrasing: 4,
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
 * Practical maximum score of the slider's top end. Untargeted Expert licks reach a 95th percentile of about 59, but
 * that tail needs 16th-note walls; with the 16th-share cap and the musical preferences (no avoid notes, no big leaps,
 * altered V that sounds altered) targets above ~54 are not met within the slider-accuracy bounds, so the top is 54.
 */
export const SCORE_CEIL = 54;

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


interface Attack { midi: number; start: number; dur: number; tied: boolean; crossesBeat: boolean; chord: number }

/** Merge tie chains into single sounding attacks. */
function attacks(notes: LickNote[]): Attack[] {
  const out: Attack[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.midi == null) continue;
    const i0 = i;
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
      // an anticipation head is judged against the chord it arrives on
      chord: judgedChord(notes, i0),
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

  // chromaticism and altered tensions relative to the chord each note belongs to (anticipation heads: the arrival chord)
  const lydian = chords.map((_, i) => progression.slots[i]?.roman === '♭II7' || progression.slots[i]?.roman === '♭VII7');
  const chordOf = (a: Attack): LickChord => chords[a.chord] ?? chords[0];
  let chroma = 0;
  let nct = 0;
  let altN = 0;
  let altWeighted = 0;
  let domN = 0;
  att.forEach((a, k) => {
    const c = chordOf(a);
    const rel = mod12(a.midi - c.rootPc);
    const lyd11 = c.quality === 'dom7' && lydian[a.chord] && rel === 6; // sharp 11 of a Lydian dominant: a tension, not chromatic
    const inside = lyd11 || inScale(a.midi, c.rootPc, c.quality) || isChordToneOrTension(a.midi, c.rootPc, c.quality);
    if (!inside) chroma += 1;
    let nctW = isChordTone(a.midi, c.rootPc, c.quality) ? 0 : 1;
    if (c.quality === 'dom7' || c.quality === 'dom7alt') {
      domN++;
      if (ALTERED_RELS.includes(rel) || lyd11) {
        altN++;
        // a long altered note that steps into a chord tone is a colour, not a technical demand
        const nx = att[k + 1];
        const resolves = a.dur >= TPB && nx != null && Math.abs(nx.midi - a.midi) <= 2 && isChordTone(nx.midi, chordOf(nx).rootPc, chordOf(nx).quality);
        altWeighted += resolves ? 0.2 : 1;
        if (resolves && nctW) nctW = 0.2;
      }
    }
    nct += nctW;
  });
  const chromaShare = chroma / N;
  const nctShare = nct / N;
  const altShare = domN ? altWeighted / domN : 0;
  // for altered chords the altered scale is "in scale", so count altered share over all attacks too
  const altOfAll = altN / N;

  // approach notes and enclosures: a chromatic neighbour of a chord tone that the line then resolves onto
  const isCT = (a: Attack) => isChordTone(a.midi, chordOf(a).rootPc, chordOf(a).quality);
  let approachLoad = 0;
  for (let i = 0; i + 1 < att.length; i++) {
    const t = att[i + 1];
    const d = att[i].midi - t.midi;
    if (!isCT(t) || isCT(att[i]) || att[i].dur >= TPB) continue; // a held note is a colour, not a quick approach
    const prevPitch = i > 0 ? att[i - 1].midi : null;
    if (Math.abs(d) === 1) {
      approachLoad += 1;
      // enclosure: the note before approaches from the other side
      if (prevPitch != null && Math.sign(prevPitch - t.midi) === -Math.sign(d) && Math.abs(prevPitch - t.midi) <= 2 && !isCT(att[i - 1])) approachLoad += 0.5;
    }
  }
  // two-note enclosures where the first note is the diatonic neighbour (x, chromatic y, target)
  for (let i = 0; i + 2 < att.length; i++) {
    const t = att[i + 2];
    const x = att[i].midi - t.midi;
    const y = att[i + 1].midi - t.midi;
    if (isCT(t) && !isCT(att[i]) && !isCT(att[i + 1]) && Math.abs(x) <= 2 && Math.abs(y) === 1 && Math.sign(x) === -Math.sign(y)) approachLoad += 0.5;
  }

  // phrasing: rests and rhythmic variety
  const restTicks = notes.reduce((m, n) => m + (n.midi == null ? n.dur : 0), 0);
  const restShare = restTicks / Math.max(1, endTick);
  const distinctDur = new Set(att.map(a => a.dur)).size;

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
    { id: 'density', label: 'Busy rhythm', value: r1(density), points: F.density * ramp(density, 0.9, 3.2) },
    {
      id: 'sixteenths', label: '16th-note runs', value: r1(share16 * 100),
      points: F.sixteenths * (0.6 * ramp(share16, 0.0, 0.35) + 0.4 * ramp(run16Share, 0, 0.3)),
    },
    { id: 'syncopation', label: 'Syncopation', value: r1(syncPerBeat), points: F.syncopation * ramp(syncPerBeat, 0.05, 1.0) },
    { id: 'offchord', label: 'Passing & extension tones', value: r1(nctShare * 100), points: F.offchord * ramp(nctShare, 0.05, 0.4) },
    { id: 'chromatic', label: 'Chromatic notes', value: r1(chromaShare * 100), points: F.chromatic * ramp(chromaShare, 0.04, 0.25) },
    {
      id: 'altered', label: 'Altered tensions', value: r1(Math.max(altShare, altOfAll) * 100),
      points: F.altered * ramp(altShare, 0.1, 0.5),
    },
    {
      id: 'leaps', label: 'Wide leaps', value: max,
      points: F.leaps * (0.4 * ramp(meanLeap, 2.6, 5.5) + 0.3 * ramp(max, 7, 14) + 0.3 * ramp(bigShare, 0, 0.2)),
    },
    { id: 'range', label: 'Wide range', value: span, points: F.range * ramp(span, 10, 26) },
    { id: 'approach', label: 'Chromatic approaches', value: r1(approachLoad), points: F.approach * ramp(approachLoad / beats, 0.03, 0.3) },
    {
      id: 'phrasing', label: 'Rests & rhythmic variety', value: r1(restShare * 100),
      points: F.phrasing * (0.5 * ramp(restShare, 0.04, 0.15) + 0.5 * ramp(distinctDur, 3, 6)),
    },
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
