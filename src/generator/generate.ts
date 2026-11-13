import type { ChordQualityId, Fragment, LengthId, Lick, LickChord, LickNote, Tier } from '../types';
import { RENDERABLE_DURS, TPB } from '../types';
import { FRAGMENTS } from '../fragments';
import { CHORDS } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { LENGTHS, expandProgression, getProgression } from '../theory/progressions';
import { SCORE_CEIL, TIER_THRESHOLDS, scoreLick, tierForScore } from '../difficulty/score';
import { Rng, randomSeed } from './rng';
import { type Ev, eventsToNotes, fixJoins, leapPenalty } from './connect';

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
  /** default: random */
  seed?: number;
  /** default: FRAGMENTS */
  fragments?: Fragment[];
}

const CANDIDATES_PER_ROUND = 30;
const MAX_ROUNDS = 3;

/* ------------------------------ fragment pools ------------------------------ */

const RENDERABLE = new Set<number>(RENDERABLE_DURS);

/** A fragment is usable only if its durations fill its beats exactly and ties are consistent. */
function isValidFragment(f: Fragment): boolean {
  if (!f.notes.length) return false;
  let sum = 0;
  for (let i = 0; i < f.notes.length; i++) {
    const n = f.notes[i];
    if (!RENDERABLE.has(n.dur)) return false;
    sum += n.dur;
    if (n.tie && (n.rel == null || i + 1 >= f.notes.length || f.notes[i + 1].rel !== n.rel)) return false;
  }
  return sum === f.beats * TPB && f.notes.some(n => n.rel != null);
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

function makePools(frags: Fragment[]): Pools {
  const valid = frags.filter(isValidFragment);
  const cache = new Map<string, Fragment[]>();
  return {
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
}

/* ------------------------------ planning ------------------------------ */

interface PlanItem {
  frag: Fragment;
  chordIdx: number;
  /** start tick */
  start: number;
}

const LEVEL_WEIGHT = [1, 0.3, 0.06, 0.02];

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

function firstNoteOk(f: Fragment, q: ChordQualityId): boolean {
  const first = f.notes[0];
  if (first.rel == null) return true;
  const c = CHORDS[q];
  return [...c.tones, ...c.tensions].some(t => mod12(t) === mod12(first.rel as number));
}

function buildPlan(
  rng: Rng, chords: LickChord[], slotBeats: number[], pools: Pools, tier: Tier, sharp: number,
): PlanItem[] {
  const plan: PlanItem[] = [];
  let beat = 0;
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
    parts.forEach((b, pi) => {
      const ending = isLastSlot && pi === parts.length - 1;
      const pool = pools.get(q, b as 2 | 4, ending);
      const frag = rng.weighted(pool, f => {
        let w = Math.pow(LEVEL_WEIGHT[Math.min(3, Math.abs(f.level - tier))], sharp);
        if (f.id === prevId) w *= 0.15;
        if (pi === 0 && !firstNoteOk(f, q)) w *= 0.2;
        return w;
      });
      prevId = frag.id;
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
  const pools = makePools(opts.fragments ?? FRAGMENTS);
  const rng = new Rng(seed);

  let best: { notes: LickNote[]; plan: PlanItem[]; cost: number; dist: number } | null = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sharp = 1 + round * 0.8;
    for (let c = 0; c < CANDIDATES_PER_ROUND; c++) {
      const plan = buildPlan(rng, chords, slotBeats, pools, reqTier, sharp);
      const octaves = chooseOctaves(plan, chords, opts.range);
      const { events, fragStarts } = planToEvents(plan, chords, octaves);
      const fixes = fixJoins(events, chords, opts.range);
      const notes = eventsToNotes(events, chords);
      const cost = lickCost(events, fragStarts, opts.range, fixes);
      const score = scoreLick(notes, chords, def).score;
      const dist = target !== undefined ? Math.abs(score - target) : tierDistance(score, reqTier);
      if (!best || dist < best.dist || (dist === best.dist && cost < best.cost)) best = { notes, plan, cost, dist };
    }
    if (best && best.dist <= tol) break;
  }
  const b = best!;
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
    notes: b.notes,
    totalTicks,
    fragmentIds: b.plan.map(p => p.frag.id),
    cellStarts: b.plan.map(p => p.start),
    difficulty: scoreLick(b.notes, chords, def),
    createdAt: Date.now(),
  };
}

/** Shift a lick to a new tonic; respell chords; re-fit the octave to `range`. Rhythm, intervals, difficulty unchanged. */
export function transposeLick(lick: Lick, keyPc: number, range: [number, number]): Lick {
  const def = getProgression(lick.progressionId);
  const newKey = mod12(keyPc);
  const delta = mod12(newKey - lick.keyPc);
  const pitches = lick.notes.filter(n => n.midi != null).map(n => n.midi as number);
  const centre = range[0] + 0.4 * (range[1] - range[0]);
  let bestShift = delta;
  let bestCost = Infinity;
  for (let m = -4; m <= 4; m++) {
    const s = delta + 12 * m;
    let viol = 0;
    let sum = 0;
    for (const p of pitches) {
      const q = p + s;
      viol += Math.max(0, range[0] - q, q - range[1]);
      sum += q;
    }
    const cost = viol * 40 + (pitches.length ? Math.abs(sum / pitches.length - centre) : 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = s;
    }
  }
  const chords = expandProgression(def, lick.length, newKey);
  const notes: LickNote[] = lick.notes.map(n => ({ ...n, midi: n.midi == null ? null : n.midi + bestShift }));
  return {
    ...lick,
    id: makeId(lick.progressionId, lick.length, newKey, lick.requestedTier, lick.seed),
    keyPc: newKey,
    chords,
    notes,
    fragmentIds: [...lick.fragmentIds],
    ...(Array.isArray(lick.cellStarts) ? { cellStarts: [...lick.cellStarts] } : {}),
    difficulty: { ...lick.difficulty, features: lick.difficulty.features.map(f => ({ ...f })) },
    createdAt: Date.now(),
  };
}

