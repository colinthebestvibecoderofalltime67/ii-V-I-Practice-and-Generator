import type { ChordQualityId, Fragment, LengthId, Lick, LickChord, LickNote, Tier } from '../types';
import { RENDERABLE_DURS, TPB } from '../types';
import { FRAGMENTS } from '../fragments';
import { CHORDS, inScale } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { findTupletGroups, isTupletDur, type TupletKind } from '../theory/rhythm';
import { LENGTHS, expandProgression, getProgression } from '../theory/progressions';
import { SCORE_CEIL, TIER_THRESHOLDS, scoreLick, scoreToPos, tierForScore } from '../difficulty/score';
import { Rng, randomSeed } from './rng';
import { type Ev, chordIndexAt, eventsToNotes, evDur, fixJoins, fixLeaps, leapPenalty, phraseEvents } from './connect';

export interface GenerateOptions {
  progressionId: string;
  length: LengthId;
  keyPc: number;
  tier: Tier;
  /**
   * Optional exact difficulty score (0..100) to aim for, e.g. posToScore(sliderPosition). When given,
   * `tier` is ignored: the tier is tierForScore(targetScore) and the candidate closest to the score wins.
   */
  targetScore?: number;
  /** CONCERT comfortable range (use concertRange(inst)). */
  range: [number, number];
  /**
   * Optional CONCERT tessitura the licks should prefer (e.g. rangeForLevel(inst, tier) shifted to concert pitch).
   * `range` stays the hard limit; the comfort range steers octave choice and candidate ranking. Clamped to `range`.
   */
  comfortRange?: [number, number];
  /** default: random */
  seed?: number;
  /** default: FRAGMENTS */
  fragments?: Fragment[];
}

const CANDIDATES_PER_ROUND = 30;
const MAX_ROUNDS = 3;

/* ------------------------------ fragment pools ------------------------------ */

const RENDERABLE = new Set<number>(RENDERABLE_DURS);

/**
 * A fragment is usable only if its durations fill its beats exactly, ties are consistent and triplets are well formed:
 *  - every non-triplet duration is renderable; triplet durations (not multiples of a 16th) must form valid groups
 *    (findTupletGroups: exact span, aligned start, units of 1 or 2) -- fragments start on a beat, and 4-beat
 *    fragments on a bar line, so group alignment inside the fragment equals alignment in the lick;
 *  - no tie into, out of or inside a triplet group (v1 keeps triplets tie-free).
 */
export function isValidFragment(f: Fragment): boolean {
  if (!f.notes.length) return false;
  let sum = 0;
  const timed: { start: number; dur: number }[] = [];
  for (let i = 0; i < f.notes.length; i++) {
    const n = f.notes[i];
    if (!isTupletDur(n.dur) && !RENDERABLE.has(n.dur)) return false;
    if (isTupletDur(n.dur) && (n.tie || (i > 0 && f.notes[i - 1].tie))) return false;
    timed.push({ start: sum, dur: n.dur });
    sum += n.dur;
    if (n.tie && (n.rel == null || i + 1 >= f.notes.length || f.notes[i + 1].rel !== n.rel)) return false;
  }
  if (sum !== f.beats * TPB || !f.notes.some(n => n.rel != null)) return false;
  return findTupletGroups(timed).errors.length === 0;
}

/** Simple guide-tone / arpeggio fragment, used only when the library has nothing for a combination. */
function synthFragment(q: ChordQualityId, beats: 2 | 4, ending: boolean): Fragment {
  const c = CHORDS[q];
  const id = `synth-${q}-${beats}${ending ? '-end' : ''}`;
  if (ending) {
    const g = c.guide[0];
    return {
      id, qualities: [q], beats, tags: ['guide-tone'], level: 1, ending: true, source: 'original',
      notes: beats === 4 ? [{ rel: g, dur: 3 * TPB }, { rel: null, dur: TPB }] : [{ rel: g, dur: TPB + TPB / 2 }, { rel: null, dur: TPB / 2 }],
    };
  }
  const tones = [...c.tones].sort((a, b) => a - b);
  const count = beats === 4 ? 4 : 4;
  const dur = beats === 4 ? TPB : TPB / 2;
  const notes = Array.from({ length: count }, (_, i) => {
    const k = i + 1; // start on the third
    return { rel: tones[k % tones.length] + 12 * Math.floor(k / tones.length), dur };
  });
  return { id, qualities: [q], beats, tags: ['arpeggio', 'guide-tone'], level: 1, source: 'original', notes };
}

interface Pools {
  get(q: ChordQualityId, beats: 2 | 4, ending: boolean): Fragment[];
}

/** Pools are built once per fragment list (the library is large; validating it on every lick was the main cost). */
const poolCache = new WeakMap<readonly Fragment[], Pools>();

function makePools(frags: Fragment[]): Pools {
  const hit = poolCache.get(frags);
  if (hit) return hit;
  const valid = frags.filter(isValidFragment);
  const cache = new Map<string, Fragment[]>();
  const pools: Pools = {
    get(q, beats, ending) {
      const key = `${q}|${beats}|${ending ? 1 : 0}`;
      let v = cache.get(key);
      if (!v) {
        v = valid.filter(f => f.qualities.includes(q) && f.beats === beats && !!f.ending === ending);
        if (!v.length) v = [synthFragment(q, beats, ending)];
        cache.set(key, v);
      }
      return v;
    },
  };
  poolCache.set(frags, pools);
  return pools;
}

/* ------------------------------ planning ------------------------------ */

interface PlanItem {
  frag: Fragment;
  chordIdx: number;
  /** start tick */
  start: number;
}

const LEVEL_WEIGHT = [1, 0.3, 0.06, 0.02];

/**
 * At most this share of a lick's attacks may be 16th notes (Expert is reached by language, not by speed alone).
 * Cells are chosen against a running count, so a lick can still use a few fast cells but never a wall of 16ths.
 */
const MAX_SIXTEENTH_SHARE = 0.3;
const sixteenthCache = new WeakMap<Fragment, { n16: number; n: number }>();
/** Count of 16th-note attacks (triplets excluded) and of all attacks in a fragment. */
function sixteenthCount(f: Fragment): { n16: number; n: number } {
  let v = sixteenthCache.get(f);
  if (!v) {
    v = { n16: 0, n: 0 };
    f.notes.forEach((n, i) => {
      if (n.rel == null || (i > 0 && f.notes[i - 1].tie && f.notes[i - 1].rel === n.rel)) return;
      v!.n++;
      if (n.dur <= 3 && n.dur % 3 === 0) v!.n16++;
    });
    sixteenthCache.set(f, v);
  }
  return v;
}

/**
 * Triplet fragments are a flavour, not the default texture. Their weight is scaled per requested tier:
 * never for Beginner, freely at Intermediate (where only simple 8th-triplet arpeggios and the odd enclosure exist),
 * damped at Advanced/Expert where many more fragments (and the triplet-scoring) compete. 16th-triplets are Expert only.
 * Fragments without triplets are untouched (factor 1), so pools without triplets draw exactly as before.
 */
const TRIPLET_FACTOR: Record<Tier, number> = { 1: 0, 2: 1, 3: 0.22, 4: 0.12 };
const tripletKinds = new WeakMap<Fragment, Set<TupletKind>>();
function fragTripletKinds(f: Fragment): Set<TupletKind> {
  let k = tripletKinds.get(f);
  if (!k) {
    let t = 0;
    k = new Set(findTupletGroups(f.notes.map(n => { const r = { start: t, dur: n.dur }; t += n.dur; return r; })).groups.map(g => g.kind));
    tripletKinds.set(f, k);
  }
  return k;
}
/** `tier` is the requested (target) tier: Beginner never gets triplets and 16th triplets need Expert, whatever the fractional level. */
export function tripletFactor(f: Fragment, level: number, tier: Tier = Math.round(level) as Tier): number {
  const kinds = fragTripletKinds(f);
  if (!kinds.size) return 1;
  if (tier === 1) return 0;
  if (kinds.has('t16') && (level < 4 || tier < 4)) return 0;
  return lerpTable(TRIPLET_FACTOR_BY_LEVEL, level - 1);
}
const TRIPLET_FACTOR_BY_LEVEL = [TRIPLET_FACTOR[1], TRIPLET_FACTOR[2], TRIPLET_FACTOR[3], TRIPLET_FACTOR[4]];

/** Linear interpolation into a table at a fractional index (clamped). Integer indexes return table entries exactly. */
function lerpTable(t: readonly number[], x: number): number {
  if (x <= 0) return t[0];
  if (x >= t.length - 1) return t[t.length - 1];
  const i = Math.floor(x);
  const f = x - i;
  return f === 0 ? t[i] : t[i] + (t[i + 1] - t[i]) * f;
}

/**
 * Fractional fragment level aimed at for a slider target: the middle of each tier's quarter of slider travel
 * maps to that tier's integer level (pos 12.5 -> 1, 37.5 -> 2, 62.5 -> 3, 87.5 -> 4), so targets near a tier
 * boundary blend the neighbouring levels instead of jumping.
 */
export function levelForTarget(score: number): number {
  return Math.min(4, Math.max(1, 0.5 + scoreToPos(score) / 25));
}

/** Split a slot's beats into 2/4-beat pieces. 4-beat pieces only start on a bar line. */
function partitionSlot(rng: Rng, slotBeats: number, startBeat: number, endingPiece: 2 | 4 | null): number[] {
  const tail = endingPiece ?? 0;
  let remaining = slotBeats - tail;
  let beat = startBeat;
  const out: number[] = [];
  while (remaining > 0) {
    const canFour = remaining >= 4 && beat % 4 === 0;
    const p = remaining === 2 || !canFour ? 2 : rng.chance(0.6) ? 4 : 2;
    out.push(p);
    remaining -= p;
    beat += p;
  }
  if (endingPiece) out.push(endingPiece);
  return out;
}

/** Pitch content (rel pitches) and melodic shape (intervals) of a fragment, to spot loops across different ids. */
const fragSigs = new WeakMap<Fragment, { rels: string; shape: string }>();
function fragSig(f: Fragment): { rels: string; shape: string } {
  let s = fragSigs.get(f);
  if (!s) {
    const rels = f.notes.filter(n => n.rel != null).map(n => n.rel as number);
    s = { rels: rels.map(r => mod12(r)).join(','), shape: rels.slice(1).map((r, i) => r - rels[i]).join(',') };
    fragSigs.set(f, s);
  }
  return s;
}

function firstNoteOk(f: Fragment, q: ChordQualityId): boolean {
  const first = f.notes[0];
  if (first.rel == null) return true;
  const c = CHORDS[q];
  return [...c.tones, ...c.tensions].some(t => mod12(t) === mod12(first.rel as number));
}

function buildPlan(
  rng: Rng, chords: LickChord[], slotBeats: number[], pools: Pools, level: number, sharp: number, tier: Tier,
): PlanItem[] {
  const plan: PlanItem[] = [];
  let beat = 0;
  let seqCells = 0;
  let n16 = 0;
  let nAll = 0;
  chords.forEach((chord, ci) => {
    const isLastSlot = ci === chords.length - 1;
    const q = chord.quality;
    let endingPiece: 2 | 4 | null = null;
    if (isLastSlot) {
      const opts = ([4, 2] as const).filter(b => b <= slotBeats[ci]);
      endingPiece = rng.weighted(opts, b => (b === 4 ? 3 : 1));
    }
    const parts = partitionSlot(rng, slotBeats[ci], beat, endingPiece);
    let tick = chord.start;
    let prevId = '';
    let prevSig: { rels: string; shape: string } | null = null;
    parts.forEach((b, pi) => {
      const ending = isLastSlot && pi === parts.length - 1;
      const pool = pools.get(q, b as 2 | 4, ending);
      const frag = rng.weighted(pool, f => {
        let w = Math.pow(lerpTable(LEVEL_WEIGHT, Math.abs(f.level - level)), sharp);
        w *= tripletFactor(f, level, tier);
        if (f.id === prevId) w *= 0.05;
        else if (prevSig && (fragSig(f).rels === prevSig.rels || fragSig(f).shape === prevSig.shape)) w *= 0.12;
        if (pi === 0 && !firstNoteOk(f, q)) w *= 0.2;
        if (seqCells > 0 && f.tags.includes('sequence')) w *= 0.002; // one sequence per lick
        const c = sixteenthCount(f);
        if (c.n16 >= 3 && (n16 + c.n16) / (nAll + c.n) > MAX_SIXTEENTH_SHARE) w *= 0.02;
        return w;
      });
      if (frag.tags.includes('sequence')) seqCells++;
      n16 += sixteenthCount(frag).n16;
      nAll += sixteenthCount(frag).n;
      prevId = frag.id;
      prevSig = fragSig(frag);
      plan.push({ frag, chordIdx: ci, start: tick });
      tick += b * TPB;
      beat += b;
    });
  });
  return plan;
}

/* ------------------------------ register fitting ------------------------------ */

const K_MIN = -2;
const K_MAX = 5;
/** Octave offset 0 puts the chord root at MIDI 48 + rootPc. */
const baseOf = (rootPc: number) => 48 + rootPc;

interface FitInfo {
  first: number | null;
  last: number | null;
  mean: number;
  viol: number;
}

function fitInfo(f: Fragment, base: number, k: number, range: [number, number]): FitInfo {
  let first: number | null = null;
  let last: number | null = null;
  let sum = 0;
  let cnt = 0;
  let viol = 0;
  for (const n of f.notes) {
    if (n.rel == null) continue;
    const p = base + n.rel + 12 * k;
    if (first == null) first = p;
    last = p;
    sum += p;
    cnt++;
    viol += Math.max(0, range[0] - p, p - range[1]);
  }
  return { first, last, mean: cnt ? sum / cnt : (range[0] + range[1]) / 2, viol };
}

/** Viterbi over per-fragment octave choices: smooth joins, inside the range, centred. */
function chooseOctaves(plan: PlanItem[], chords: LickChord[], range: [number, number]): number[] {
  const centre = range[0] + 0.4 * (range[1] - range[0]);
  const ks: number[] = [];
  for (let k = K_MIN; k <= K_MAX; k++) ks.push(k);
  type Cell = { cost: number; from: number };
  const table: Cell[][] = [];
  const infos: FitInfo[][] = [];
  plan.forEach((item, i) => {
    const base = baseOf(chords[item.chordIdx].rootPc);
    const row: Cell[] = [];
    const irow: FitInfo[] = [];
    ks.forEach(k => {
      const info = fitInfo(item.frag, base, k, range);
      irow.push(info);
      const own = info.viol * 40 + Math.abs(info.mean - centre) * 0.12;
      if (i === 0) {
        row.push({ cost: own, from: -1 });
        return;
      }
      let best = Infinity;
      let from = 0;
      ks.forEach((_, pk) => {
        const prev = infos[i - 1][pk];
        const join = prev.last != null && info.first != null ? leapPenalty(info.first - prev.last) : 0;
        const c = table[i - 1][pk].cost + join;
        if (c < best) {
          best = c;
          from = pk;
        }
      });
      row.push({ cost: best + own, from });
    });
    table.push(row);
    infos.push(irow);
  });
  let bi = 0;
  const lastRow = table[table.length - 1];
  lastRow.forEach((c, i) => {
    if (c.cost < lastRow[bi].cost) bi = i;
  });
  const out: number[] = new Array(plan.length);
  for (let i = plan.length - 1; i >= 0; i--) {
    out[i] = ks[bi];
    bi = table[i][bi].from;
  }
  return out;
}

/* ------------------------------ assembly ------------------------------ */

function planToEvents(plan: PlanItem[], chords: LickChord[], octaves: number[]): { events: Ev[]; fragStarts: number[] } {
  const events: Ev[] = [];
  const fragStarts: number[] = [];
  plan.forEach((item, i) => {
    const base = baseOf(chords[item.chordIdx].rootPc);
    fragStarts.push(events.length);
    let pos = item.start;
    let open: Ev | null = null;
    for (const n of item.frag.notes) {
      const midi = n.rel == null ? null : base + n.rel + 12 * octaves[i];
      if (open) {
        open.pieces.push(n.dur);
      } else {
        open = { midi, start: pos, pieces: [n.dur] };
        events.push(open);
      }
      if (!n.tie) open = null;
      pos += n.dur;
    }
  });
  return { events, fragStarts };
}

/** Musical cost of a finished lick: join smoothness, range violations, register centring, repairs. */
function lickCost(events: Ev[], fragStarts: number[], range: [number, number], fixes: number): number {
  const centre = range[0] + 0.4 * (range[1] - range[0]);
  let cost = fixes * 0.7;
  let sum = 0;
  let cnt = 0;
  let prev: number | null = null;
  const starts = new Set(fragStarts);
  events.forEach((e, i) => {
    if (e.midi == null) return;
    sum += e.midi;
    cnt++;
    cost += Math.max(0, range[0] - e.midi, e.midi - range[1]) * 40;
    if (prev != null && starts.has(i)) cost += leapPenalty(e.midi - prev);
    prev = e.midi;
  });
  if (cnt) cost += Math.abs(sum / cnt - centre) * 0.12;
  return cost;
}

/**
 * Landing penalty by the note's degree (semitones above the chord root), in "score points" so it can be added to the
 * candidate's distance from the target. Dominants must land on the 3rd or 7th; the tonic's best landings are the 3rd,
 * 7th/6th, then 9th and 5th (root weakest); other chords prefer a guide tone too.
 */
function landingPenalty(q: ChordQualityId, rel: number, last: boolean): number {
  const c = CHORDS[q];
  if (c.guide.some(g => mod12(g) === rel)) return 0;
  if (q === 'dom7' || q === 'dom7alt') return rel === 0 ? 3 : 2.5;
  if (last) {
    if (rel === 2 || rel === 7) return 0.15;
    if (rel === 0) return 1.8;
    return 0.6;
  }
  return rel === 0 ? 0.4 : 0.2;
}

/**
 * Preference terms (score points) used to rank candidates besides difficulty: guide-tone arrivals at chord changes,
 * no long non-scale note on a beat, and staying inside the comfortable tessitura.
 */
function preference(events: Ev[], chords: LickChord[], comfort: [number, number], lydian: boolean[]): number {
  let pen = 0;
  chords.forEach((ch, ci) => {
    const e = events.find(x => x.start <= ch.start && x.start + evDur(x) > ch.start);
    if (!e || e.midi == null) return;
    pen += landingPenalty(ch.quality, mod12(e.midi - ch.rootPc), ci === chords.length - 1);
  });
  let out = 0;
  const altSeen = chords.map(() => false);
  let prevMidi: number | null = null;
  for (const e of events) {
    if (e.midi == null) continue;
    out += Math.max(0, comfort[0] - e.midi, e.midi - comfort[1]);
    if (prevMidi != null && Math.abs(e.midi - prevMidi) >= 10) pen += 14; // a leap of a minor 7th or more
    prevMidi = e.midi;
    // an anticipation head (attacked within a beat before a change and tied over it) is judged on the arrival chord
    let ci = chordIndexAt(chords, e.start);
    const next = chords[ci + 1];
    if (next && e.start + evDur(e) > next.start && next.start - e.start < TPB) ci++;
    const ch = chords[ci];
    const rel = mod12(e.midi - ch.rootPc);
    const stressed = e.start % TPB === 0 || evDur(e) >= TPB;
    if (e.start % TPB === 0 && evDur(e) >= TPB && !inScale(e.midi, ch.rootPc, ch.quality)) pen += 1.5;
    if (stressed && rel === 5 && (ch.quality === 'maj7' || (ch.quality === 'dom7' && lydian[ci]))) pen += 10; // avoid note
    if (ch.quality === 'dom7alt' && (rel === 1 || rel === 3 || rel === 8)) altSeen[ci] = true;
  }
  chords.forEach((ch, ci) => { if (ch.quality === 'dom7alt' && !altSeen[ci]) pen += 6; }); // 7alt must sound altered
  return pen + Math.min(out, 40) * 0.12;
}

const makeId = (progressionId: string, length: LengthId, keyPc: number, tier: Tier, seed: number) =>
  `${progressionId}-${length}-k${keyPc}-t${tier}-${seed}`;

function tierDistance(score: number, tier: Tier): number {
  const lo = tier === 1 ? -Infinity : TIER_THRESHOLDS[tier - 2];
  const hi = tier === 4 ? Infinity : TIER_THRESHOLDS[tier - 1];
  if (score < lo) return lo - score;
  if (score >= hi) return score - hi + 0.01;
  return 0;
}

/** How close (in score points) a candidate must be to a target score to stop searching. */
function scoreTolerance(tier: Tier): number {
  const lo = tier === 1 ? 0 : TIER_THRESHOLDS[tier - 2];
  const hi = tier === 4 ? SCORE_CEIL : TIER_THRESHOLDS[tier - 1];
  return Math.max(2, 0.12 * (hi - lo));
}

export function generateLick(opts: GenerateOptions): Lick {
  const target = opts.targetScore !== undefined && Number.isFinite(opts.targetScore) ? opts.targetScore : undefined;
  const reqTier: Tier = target !== undefined ? tierForScore(target) : opts.tier;
  const tol = target !== undefined ? scoreTolerance(reqTier) : 0;
  const def = getProgression(opts.progressionId);
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const keyPc = mod12(opts.keyPc);
  const chords = expandProgression(def, opts.length, keyPc);
  const slotBeats = LENGTHS[opts.length].beats;
  const totalTicks = chords.reduce((a, c) => a + c.dur, 0);
  const comfort: [number, number] = opts.comfortRange
    ? [Math.max(opts.range[0], opts.comfortRange[0]), Math.min(opts.range[1], opts.comfortRange[1])]
    : opts.range;
  const fitRange = comfort[1] - comfort[0] >= 14 ? comfort : opts.range;
  const pools = makePools(opts.fragments ?? FRAGMENTS);
  const rng = new Rng(seed);
  // Lydian-dominant chords (tritone-sub bII7, backdoor bVII7): the natural 11 is an avoid note there
  const lydian = def.slots.map(sl => sl.roman === '♭II7' || sl.roman === '♭VII7');

  let best: { notes: LickNote[]; plan: PlanItem[]; cost: number; dist: number; pref: number } | null = null;
  // Without a target the level is the tier (integer, exactly the original weighting). With a target it starts at
  // the target's fractional level and is nudged each round toward where the candidates actually scored.
  let level = target !== undefined ? levelForTarget(target) : reqTier;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sharp = 1 + round * 0.8;
    const roundScores: number[] = [];
    for (let c = 0; c < CANDIDATES_PER_ROUND; c++) {
      const plan = buildPlan(rng, chords, slotBeats, pools, level, sharp, reqTier);
      const octaves = chooseOctaves(plan, chords, fitRange);
      const { events, fragStarts } = planToEvents(plan, chords, octaves);
      const fixes = fixJoins(events, chords, opts.range) + fixLeaps(events, opts.range);
      phraseEvents(rng, events, fragStarts, chords, opts.range, { level });
      const notes = eventsToNotes(events, chords);
      const cost = lickCost(events, fragStarts, opts.range, fixes);
      const score = scoreLick(notes, chords, def).score;
      let pref = preference(events, chords, fitRange, lydian);
      let outside = 0;
      for (const n of notes) if (n.midi != null) outside += Math.max(0, opts.range[0] - n.midi, n.midi - opts.range[1]);
      pref += outside * 60; // the hard range outranks everything
      roundScores.push(score);
      // With a target, staying inside the target's tier outranks closeness (a target on a boundary must not land across it).
      const dist = target !== undefined
        ? (tierDistance(score, reqTier) > 0 ? 1000 : 0) + Math.abs(score - target) + pref
        : (tierDistance(score, reqTier) > 0 ? 1000 + tierDistance(score, reqTier) : 0) + pref;
      if (!best || dist < best.dist || (dist === best.dist && cost < best.cost)) best = { notes, plan, cost, dist, pref };
    }
    if (best && best.dist - best.pref <= tol) break;
    if (target !== undefined) {
      const mid = [...roundScores].sort((a, b) => a - b)[roundScores.length >> 1];
      if (mid > target + tol) level = Math.max(1, level - 0.4);
      else if (mid < target - tol) level = Math.min(4, level + 0.4);
    }
  }
  const b = best!;
  const finalNotes = foldIntoRange(b.notes, opts.range); // guarantee: never a note outside the instrument range
  // Sanity: contiguity (guards against malformed custom fragments; never expected to trigger)
  const end = b.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  if (end !== totalTicks) throw new Error(`generator produced ${end} ticks, expected ${totalTicks}`);

  return {
    version: 2,
    id: makeId(def.id, opts.length, keyPc, reqTier, seed),
    seed,
    progressionId: def.id,
    length: opts.length,
    keyPc,
    mode: def.mode,
    requestedTier: reqTier,
    ...(target !== undefined ? { targetScore: target } : {}),
    chords,
    notes: finalNotes,
    totalTicks,
    fragmentIds: b.plan.map(p => p.frag.id),
    cellStarts: b.plan.map(p => p.start),
    difficulty: scoreLick(finalNotes, chords, def),
    createdAt: Date.now(),
  };
}

/**
 * Shift a lick to a new tonic; respell chords; re-fit the octave to `range`, then fold any notes still outside it
 * (see foldIntoRange). `comfortRange` (optional, clamped to `range`) steers the octave choice toward the written comfortable
 * tessitura; `range` stays the hard limit. Rhythm and pitch classes never change; intervals and difficulty change only if folding was needed.
 */
export function transposeLick(lick: Lick, keyPc: number, range: [number, number], comfortRange?: [number, number]): Lick {
  const def = getProgression(lick.progressionId);
  const newKey = mod12(keyPc);
  const delta = mod12(newKey - lick.keyPc);
  const pitches = lick.notes.filter(n => n.midi != null).map(n => n.midi as number);
  const comfort: [number, number] = comfortRange
    ? [Math.max(range[0], comfortRange[0]), Math.min(range[1], comfortRange[1])]
    : range;
  const fit = comfort[1] - comfort[0] >= 14 ? comfort : range;
  const centre = fit[0] + 0.4 * (fit[1] - fit[0]);
  let bestShift = delta;
  let bestCost = Infinity;
  for (let m = -4; m <= 4; m++) {
    const s = delta + 12 * m;
    let viol = 0;
    let cviol = 0;
    let sum = 0;
    for (const p of pitches) {
      const q = p + s;
      viol += Math.max(0, range[0] - q, q - range[1]);
      cviol += Math.max(0, fit[0] - q, q - fit[1]);
      sum += q;
    }
    const cost = viol * 40 + cviol * 2 + (pitches.length ? Math.abs(sum / pitches.length - centre) : 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = s;
    }
  }
  const chords = expandProgression(def, lick.length, newKey);
  const shifted: LickNote[] = lick.notes.map(n => ({ ...n, midi: n.midi == null ? null : n.midi + bestShift }));
  const notes = foldIntoRange(shifted, range, fit);
  const folded = notes.some((n, i) => n.midi !== shifted[i].midi);
  return {
    ...lick,
    id: makeId(lick.progressionId, lick.length, newKey, lick.requestedTier, lick.seed),
    keyPc: newKey,
    chords,
    notes,
    fragmentIds: [...lick.fragmentIds],
    ...(Array.isArray(lick.cellStarts) ? { cellStarts: [...lick.cellStarts] } : {}),
    // Unchanged when the lick was only shifted as a whole; re-scored when folding altered the contour (register/leaps).
    difficulty: folded
      ? scoreLick(notes, chords, def)
      : { ...lick.difficulty, features: lick.difficulty.features.map(f => ({ ...f })) },
    createdAt: Date.now(),
  };
}

/**
 * Octave-fold every pitched note that is outside `range` into it (pitch classes and rhythm untouched; in-range notes
 * never move; tied notes stay together). Choice is a Viterbi pass over the folded notes minimising how much each
 * leap differs from the original leap, so a run of out-of-range notes between in-range neighbours moves as one
 * phrase rather than as scattered single-note jumps. Ties break toward the smaller displacement. Deterministic.
 */
export function foldIntoRange(notes: LickNote[], range: [number, number], comfort: [number, number] = range): LickNote[] {
  const [lo, hi] = range;
  // units: pitched notes joined by ties share one pitch
  const unitOf: number[] = new Array(notes.length).fill(-1);
  const orig: number[] = [];
  let prev = -1;
  notes.forEach((n, i) => {
    if (n.midi == null) { prev = -1; return; }
    const pn = i > 0 ? notes[i - 1] : null;
    if (prev >= 0 && pn && pn.tie && pn.midi === n.midi) unitOf[i] = prev;
    else { unitOf[i] = orig.length; orig.push(n.midi); }
    prev = unitOf[i];
  });
  if (!orig.some(m => m < lo || m > hi)) return notes;
  const cands: number[][] = orig.map(m => {
    if (m >= lo && m <= hi) return [m];
    const c: number[] = [];
    for (let k = -8; k <= 8; k++) {
      const q = m + 12 * k;
      if (q >= lo && q <= hi) c.push(q);
    }
    if (!c.length) c.push(Math.min(hi, Math.max(lo, m))); // range narrower than an octave: clamp (not expected)
    return c.sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || a - b);
  });
  const n = orig.length;
  const cost: number[][] = [];
  const back: number[][] = [];
  cost[0] = cands[0].map(q => Math.abs(q - orig[0]) * 0.01 + Math.max(0, comfort[0] - q, q - comfort[1]) * 0.3);
  back[0] = cands[0].map(() => -1);
  for (let i = 1; i < n; i++) {
    cost[i] = [];
    back[i] = [];
    const oi = orig[i] - orig[i - 1];
    cands[i].forEach(q => {
      let best = Infinity;
      let bj = 0;
      cands[i - 1].forEach((p, j) => {
        const c = cost[i - 1][j] + Math.abs(q - p - oi);
        if (c < best) { best = c; bj = j; }
      });
      cost[i].push(best + Math.abs(q - orig[i]) * 0.01 + Math.max(0, comfort[0] - q, q - comfort[1]) * 0.3);
      back[i].push(bj);
    });
  }
  let j = 0;
  for (let k = 1; k < cost[n - 1].length; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  const pick: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    pick[i] = cands[i][j];
    j = back[i][j];
  }
  return notes.map((nt, i) => (unitOf[i] < 0 ? nt : { ...nt, midi: pick[unitOf[i]] }));
}

