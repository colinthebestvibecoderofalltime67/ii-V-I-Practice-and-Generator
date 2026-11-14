import type { ChordQualityId, ConceptId, Fragment, LengthId, Lick, LickChord, LickNote, ProgressionSlot, Tier } from '../types';
import { RENDERABLE_DURS, TICKS_PER_16TH, TPB, TPBAR } from '../types';
import { FRAGMENTS } from '../fragments';
import { CHORDS, inScale } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { findTupletGroups, isTupletDur, type TupletKind } from '../theory/rhythm';
import { expandProgression, getProgression, slotBeats } from '../theory/progressions';
import { SCORE_CEIL, TIER_THRESHOLDS, scoreLick, scoreToPos, tierForScore } from '../difficulty/score';
import { Rng, randomSeed } from './rng';
import { type Ev, anticipationFitsOldChord, eventsToNotes, fixJoins, fixLeaps, leapPenalty, phraseEvents } from './connect';
import { conceptAllowed, conceptHits, guideRels, isThird } from '../theory/devices';

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
  /**
   * Fragment ids heard recently (e.g. in the last few licks of a practice session). They are strongly down-weighted so
   * consecutive licks don't keep reusing the same figure. Optional; doesn't change output when empty.
   */
  avoid?: readonly string[];
  /** default: random */
  seed?: number;
  /** default: FRAGMENTS */
  fragments?: Fragment[];
  /**
   * Focus concept to practise (see src/theory/devices.ts). Cells that carry it are boosted and candidates are ranked by whether the
   * device really occurs. Ignored (and not recorded on the lick) when the concept is not offered at the lick's tier
   * (conceptAllowed). Without a concept the output is exactly what it always was.
   */
  concept?: ConceptId;
}

const CANDIDATES_PER_ROUND = 50;
/** With a Focus, more candidates per round: the lick must both deliver the concept and sit on the slider target. */
const CANDIDATES_PER_ROUND_FOCUS = 48;
const MAX_ROUNDS = 7;
/**
 * A target below the simplest possible licks can never be reached: once the level is at its floor and a round from the
 * fourth on is still too hard, more rounds only redraw the same distribution, so searching stops.
 */
const FLOOR_AFTER_ROUND = 4;

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

/**
 * Static, per-pool data about a list of fragments (built once per fragment array, alongside the pool cache): the cell
 * info as interned integers (so "same figure as the previous cell" is an integer compare), the 16th-note counts, flags
 * and inverted indexes. buildPlan only touches the few cells whose weight depends on the previous pick.
 */
interface PoolData {
  frags: Fragment[];
  n: number;
  ids: string[];
  info: CellInfo[];
  /** interned rels / shape / first3 / last2 */
  rels: Int32Array; shape: Int32Array; first3: Int32Array; last2: Int32Array;
  n16: Int32Array; nAttacks: Int32Array;
  seq: Uint8Array; dotted: Uint8Array;
  seqList: number[]; dottedList: number[];
  /** cells with at least three 16th attacks (the only ones the 16th-share cap can hit) */
  capList: number[];
  byId: Map<string, number[]>;
  byRels: Map<number, number[]>; byShape: Map<number, number[]>; byFirst3: Map<number, number[]>; byLast2: Map<number, number[]>;
}

const internTable = new Map<string, number>();
function intern(s: string): number {
  let v = internTable.get(s);
  if (v === undefined) { v = internTable.size; internTable.set(s, v); }
  return v;
}

function addTo(m: Map<number, number[]>, key: number, i: number): void {
  const l = m.get(key);
  if (l) l.push(i); else m.set(key, [i]);
}

function makePoolData(frags: Fragment[]): PoolData {
  const n = frags.length;
  const pd: PoolData = {
    frags, n, ids: frags.map(f => f.id), info: frags.map(cellInfo),
    rels: new Int32Array(n), shape: new Int32Array(n), first3: new Int32Array(n), last2: new Int32Array(n),
    n16: new Int32Array(n), nAttacks: new Int32Array(n), seq: new Uint8Array(n), dotted: new Uint8Array(n),
    seqList: [], dottedList: [], capList: [], byId: new Map(),
    byRels: new Map(), byShape: new Map(), byFirst3: new Map(), byLast2: new Map(),
  };
  for (let i = 0; i < n; i++) {
    const f = frags[i];
    const c = pd.info[i];
    pd.rels[i] = intern(c.rels); pd.shape[i] = intern(c.shape); pd.first3[i] = intern(c.first3); pd.last2[i] = intern(c.last2);
    const sc = sixteenthCount(f);
    pd.n16[i] = sc.n16; pd.nAttacks[i] = sc.n;
    if (f.tags.includes('sequence')) { pd.seq[i] = 1; pd.seqList.push(i); }
    if (c.dotted) { pd.dotted[i] = 1; pd.dottedList.push(i); }
    if (sc.n16 >= 3) pd.capList.push(i);
    const l = pd.byId.get(f.id);
    if (l) l.push(i); else pd.byId.set(f.id, [i]);
    addTo(pd.byRels, pd.rels[i], i); addTo(pd.byShape, pd.shape[i], i); addTo(pd.byFirst3, pd.first3[i], i); addTo(pd.byLast2, pd.last2[i], i);
  }
  return pd;
}

interface Pools {
  get(q: ChordQualityId, beats: 2 | 4, ending: boolean): PoolData;
}

/** Pools are built once per fragment list (the library is large; validating it on every lick was the main cost). */
const poolCache = new WeakMap<readonly Fragment[], Pools>();

function makePools(frags: Fragment[]): Pools {
  const hit = poolCache.get(frags);
  if (hit) return hit;
  const valid = frags.filter(isValidFragment);
  const cache = new Map<string, PoolData>();
  const pools: Pools = {
    get(q, beats, ending) {
      const key = `${q}|${beats}|${ending ? 1 : 0}`;
      let v = cache.get(key);
      if (!v) {
        let fl = valid.filter(f => f.qualities.includes(q) && f.beats === beats && !!f.ending === ending);
        if (!fl.length) fl = [synthFragment(q, beats, ending)];
        v = makePoolData(fl);
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

/** What a dominant chord is doing in its progression: colours the cell choice (see cellWeight). */
export type ChordRole = 'lyd' | 'primaryV' | 'alt' | 'secondary' | 'other';
const ROLE_OF_FN: Record<ProgressionSlot['fn'], ChordRole> = {
  lydianDom: 'lyd', altV: 'alt', primaryV: 'primaryV', secondaryDom: 'secondary', tonic: 'other', predominant: 'other',
};
export function chordRoles(slots: readonly Pick<ProgressionSlot, 'fn'>[]): ChordRole[] {
  return slots.map(sl => ROLE_OF_FN[sl.fn]);
}

/**
 * At most this share of a lick's attacks may be 16th notes (Expert is reached by language, not by speed alone).
 * Cells are chosen against a running count, so a lick can still use a few fast cells but never a wall of 16ths.
 */
const MAX_SIXTEENTH_SHARE: Record<Tier, number> = { 1: 0.3, 2: 0.3, 3: 0.27, 4: 0.2 };
const SIXTEENTH_OVER_COST = 8;
/** The finished lick's 16th-note share is softly capped lower than the cell-by-cell cap above (Expert: about a quarter). */
const SIXTEENTH_SOFT_CAP: Record<Tier, number> = { 1: 0.3, 2: 0.3, 3: 0.27, 4: 0.2 };
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
const TRIPLET_FACTOR: Record<Tier, number> = { 1: 0, 2: 1.3, 3: 0.22, 4: 0.05 };
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
function partitionSlot(rng: Rng, slotBeats: number, startBeat: number, endingPiece: 2 | 4 | null, pFour = 0.6): number[] {
  const tail = endingPiece ?? 0;
  let remaining = slotBeats - tail;
  let beat = startBeat;
  const out: number[] = [];
  while (remaining > 0) {
    const canFour = remaining >= 4 && beat % 4 === 0;
    const p = remaining === 2 || !canFour ? 2 : rng.chance(pFour) ? 4 : 2;
    out.push(p);
    remaining -= p;
    beat += p;
  }
  if (endingPiece) out.push(endingPiece);
  return out;
}

/** Pitch content (rel pitches), melodic shape and colour of a fragment, to spot loops, noodling and wrong colours. */
interface CellInfo {
  rels: string;
  shape: string;
  /** First three / last two pitches (rel, mod 12): cells sharing them sound like the same figure. */
  first3: string;
  last2: string;
  pcs: Set<number>;
  attacks: number;
  /** Altered tensions (b9, #9, b13) present, and one of them held a quarter or longer on a beat. */
  alt: number;
  altHeld: boolean;
  nat11: boolean;
  sharp11: boolean;
  /** Has a b9 / b13 (the colour a secondary dominant wants), and a natural 13 stressed (on a beat or held a beat): it clashes with the b3 of the ii it resolves to. */
  flat9or13: boolean;
  nat13Strong: boolean;
  /** Last pitched note, rel mod 12. */
  lastRel: number;
  firstRel: number;
  /** Has a dotted 8th + 16th pair (march-like under swing): at most one such cell per lick. */
  dotted: boolean;
  /** Does the first pitched note land on a guide tone of q? */
  firstGuide(q: ChordQualityId): boolean;
}
const cellInfos = new WeakMap<Fragment, CellInfo>();
function cellInfo(f: Fragment): CellInfo {
  let s = cellInfos.get(f);
  if (!s) {
    const rels: number[] = [];
    let alt = 0;
    let altHeld = false;
    let flat9or13 = false;
    let nat13Strong = false;
    let t = 0;
    f.notes.forEach((n, i) => {
      if (n.rel != null && !(i > 0 && f.notes[i - 1].tie && f.notes[i - 1].rel === n.rel)) {
        rels.push(n.rel);
        const r = mod12(n.rel);
        if (r === 1 || r === 3 || r === 8) {
          alt++;
          if (t % TPB === 0 && n.dur >= TPB) altHeld = true;
          if (r !== 3) flat9or13 = true;
        }
        if (r === 9 && (t % TPB === 0 || n.dur >= TPB)) nat13Strong = true;
      }
      t += n.dur;
    });
    const m = rels.map(r => mod12(r));
    s = {
      rels: m.join(','), shape: rels.slice(1).map((r, i) => r - rels[i]).join(','),
      first3: m.slice(0, 3).join(','), last2: m.slice(-2).join(','),
      pcs: new Set(m), attacks: m.length, alt, altHeld, nat11: m.includes(5), sharp11: m.includes(6), flat9or13, nat13Strong, lastRel: m[m.length - 1], firstRel: m[0],
      dotted: f.notes.some((n, i) => n.dur === 9 && f.notes[i + 1]?.dur === 3),
      firstGuide: (q: ChordQualityId) => CHORDS[q].guide.some(g => mod12(g) === m[0]),
    };
    cellInfos.set(f, s);
  }
  return s;
}

/**
 * Cell weight factors that depend on the chord the cell lands on (its role in the progression) and on the level:
 *  - tritone-sub / backdoor dominants (Lydian dominant): Lydian (#11, no natural 11) cells x12; no b9/#9/b13 (that is the altered
 *    sound, not Lydian dominant) and no natural 11 anywhere;
 *  - the V7 of a major ii-V-I stays Mixolydian-first: Lydian cells x0.3;
 *  - low-level 7alt: cells with fewer than two altered tones that never hold one on a beat are thin (they sound Mixolydian) x0.15;
 *  - m7b5 cells of Level 2+ should state the b5; near-endless oscillation between two or three pitches is noodling.
 */
function roleWeight(f: Fragment, q: ChordQualityId, role: ChordRole, level: number): number {
  const c = cellInfo(f);
  let w = 1;
  if (q === 'dom7' && role === 'lyd') {
    const lydCell = c.sharp11 && !c.nat11 && c.alt === 0;
    if (lydCell) { const d = Math.abs(f.level - level); w *= d <= (level >= 3.5 ? 0.5 : level >= 2.5 ? 2 : 0.5) ? (level >= 2.5 ? 12 : 4) : d <= 1 ? 2 : 1; }
    if (c.alt > 0) w *= 0.05;
    if (c.nat11) w *= 0.08;
  } else if (q === 'dom7' && role === 'primaryV' && c.sharp11 && !c.nat11 && c.alt === 0) w *= 0.3;
  else if (q === 'dom7' && role === 'secondary') {
    // VI7 -> ii: the b9 / b13 colour of a dominant that resolves to a MINOR chord, from Intermediate up (not for Beginner). The Lydian
    // #11 sound and a stressed natural 13 (it clashes with the ii's b3: F# on A7 against Dm7's F) are out; the V7 of a major ii-V-I keeps them.
    if (level < 1.5) { if (c.sharp11 && !c.nat11 && c.alt === 0) w *= 0.3; if (c.alt > 0) w *= 0.3; }
    else {
      if (c.sharp11 || c.nat13Strong) w *= 0.3;
      if (c.flat9or13) {
        // the library has few b9 / b13 cells above Level 2: a lower-level one is worth nearly as much as a level-matched cell here
        const d = Math.abs(f.level - level);
        w *= (level < 2.5 ? 3 : 8) * (d > 1 ? Math.min(8, lerpTable(LEVEL_WEIGHT, 1) / lerpTable(LEVEL_WEIGHT, d)) : 1);
      }
      else if (c.alt > 0) w *= level < 2.5 ? 1.6 : 2.5;
    }
  }
  if (q === 'dom7alt' && c.alt < 2 && !c.altHeld) w *= level < 1.5 ? 0.8 : level < 2.5 ? 0.25 : 0.6;
  if (q === 'm7b5' && f.level >= 2 && !c.pcs.has(6)) w *= 0.2;
  if (c.attacks >= 7 && c.pcs.size <= 3) w *= 0.05;
  return w;
}

function firstNoteOk(f: Fragment, q: ChordQualityId): boolean {
  const first = f.notes[0];
  if (first.rel == null) return true;
  const c = CHORDS[q];
  const r = mod12(first.rel);
  return c.tones.some(t => mod12(t) === r) || c.tensions.some(t => mod12(t) === r);
}

/** Static weights of one pool in one context (chord role, first cell or not) for one round, with prefix sums. */
interface BaseWeights {
  w: Float64Array;
  /** cum[i] = w[0] + ... + w[i], summed left to right (so cum[n-1] is the same total the linear scan used) */
  cum: Float64Array;
  total: number;
}
/** Per round: pool -> BaseWeights by (role, first cell) slot. */
type RoundCache = Map<PoolData, (BaseWeights | undefined)[]>;
const ROLE_SLOT: Record<ChordRole, number> = { lyd: 0, primaryV: 1, alt: 2, other: 3, secondary: 4 };
/** Cache slots (index >= 20) of the Focus concepts' neighbouring-chord contexts. */
const ctxSlots = new Map<string, number>();
const ctxSlot = (key: string): number => {
  let v = ctxSlots.get(key);
  if (v === undefined) { v = 20 + ctxSlots.size; ctxSlots.set(key, v); }
  return v;
};

/** Cells of a pool the previous picks single out (indexes of cells in the pool); `mask[i]` = recently heard. */
interface AvoidInfo { mask: Uint8Array; list: number[] }

/** Where a cell sits in the lick, for the Focus concepts whose boost depends on the neighbouring chord. */
interface CellCtx {
  /** First cell of a chord that follows another (guide-tone arrival), last cell of a chord that is followed by another (guide-tone departure). */
  arrives: boolean;
  departs: boolean;
  /**
   * Guide tones: which of this chord's guide tones (bit i = CHORDS[q].guide[i]) are within 2 semitones of where the previous cell
   * ended (arrival), and which of them lie within 2 semitones of a guide tone of the next chord (departure).
   */
  arrNear?: number;
  depNear?: number;
  /** First cell of the final chord, with the chord before it (anticipate the I). */
  chord: LickChord;
  anticOld?: LickChord;
  anticOldLydian?: boolean;
}

/** Weight factor of a cell for the Focus concept (static for the whole call, so it lives in the per-round base weights). */
const CONCEPT_BOOST = 10;
/** With a Focus the search goes on until a candidate that delivers it lands this close to the target (score points). */
const STOP_TOL = 0.9;
/** The tight stop applies to the first rounds only; later a delivering candidate inside the normal tolerance ends the search (keeps Focus licks fast). */
const STOP_TOL_ROUNDS = 2;
/** From this round on a delivering candidate inside the target's tier ends the search wherever it sits (the target may simply be out of reach for the chosen cells). */
const LATE_ROUND = 4;
/** With a Focus, a search that has seen no delivering candidate by this round (0-based) gives up. */
const NO_HIT_ROUNDS = 2;
const FOCUS_POOL_MAX_SCALE = 6;
const TAG_CONCEPTS: ReadonlySet<ConceptId> = new Set<ConceptId>(['enclosures', 'chromaticApproach', 'triadPairs', 'sixthDim', 'superimposition']);
const CONCEPT_TAG: Partial<Record<ConceptId, string>> = { enclosures: 'enclosure', chromaticApproach: 'chromatic', triadPairs: 'triad-pair', sixthDim: 'sixth-dim', superimposition: 'superimposition' };
const hasTagForConcept = (f: Fragment, c: ConceptId): boolean => hasTag(f, CONCEPT_TAG[c] as string);
const GB = 4;
const GBAD = 0.4;
const hasTag = (f: Fragment, t: string): boolean => (f.tags as string[]).includes(t);
const nearPc = (a: number, b: number): boolean => { const d = mod12(a - b); return d <= 2 || d >= 10; };
function conceptFactor(f: Fragment, c: CellInfo, q: ChordQualityId, concept: ConceptId, ctx: CellCtx, tier: Tier): number {
  switch (concept) {
    case 'enclosures': return hasTag(f, 'enclosure') ? CONCEPT_BOOST : 1;
    case 'chromaticApproach': return hasTag(f, 'chromatic') ? (tier === 1 ? 2 : tier === 2 ? 4 : 6) : 1;
    case 'triadPairs': return hasTag(f, 'triad-pair') ? CONCEPT_BOOST : 1;
    case 'sixthDim': return hasTag(f, 'sixth-dim') ? CONCEPT_BOOST : 1;
    case 'superimposition': return hasTag(f, 'superimposition') ? CONCEPT_BOOST : 1;
    case 'guideTones': {
      if (!ctx.arrives && !ctx.departs) return 1;
      // a guide-tone link needs the old chord's last note to be a guide tone within 2 semitones of one of the new chord's: arrival
      // cells are weighed against the pitch the previous cell really ended on, departure cells against the chord that follows
      const guide = guideRels(q);
      const good = tier >= 2 ? 10 : GB;
      const bad = tier >= 2 ? 0.2 : GBAD;
      let x = 1;
      if (ctx.arrives) {
        const gi = guide.findIndex(g => mod12(g) === c.firstRel);
        x *= gi < 0 ? bad : (ctx.arrNear ?? 3) & (1 << gi) ? good : 0.6;
      }
      if (ctx.departs) {
        const gi = guide.findIndex(g => mod12(g) === c.lastRel);
        x *= gi < 0 ? bad : (ctx.depNear ?? 3) & (1 << gi) ? good : 0.6;
      }
      return x;
    }
    case 'anticipateI': {
      if (!ctx.anticOld) return 1;
      const root = ctx.chord.rootPc;
      if (!CHORDS[q].tones.some(t => mod12(t) === c.firstRel) || !anticipationFitsOldChord(60 + root + c.firstRel, ctx.anticOld, !!ctx.anticOldLydian)) return 0.3;
      // the I's 3rd / b3 and root sound anticipated; its 5th and 7th are mostly common tones of the V (a held note, and not labelled)
      return c.firstRel === 0 || isThird(q, c.firstRel) ? 6 : 1.5;
    }
  }
}

function baseWeights(
  pd: PoolData, q: ChordQualityId, role: ChordRole, level: number, sharp: number, tier: Tier, first: boolean, ending: boolean, chainLanding: boolean,
  concept?: ConceptId, ctx?: CellCtx,
): BaseWeights {
  const n = pd.n;
  const w = new Float64Array(n);
  const cum = new Float64Array(n);
  let total = 0;
  let boosted = 0;
  for (let i = 0; i < n; i++) {
    const f = pd.frags[i];
    if (f.concept && f.concept !== concept) { w[i] = 0; cum[i] = total; continue; } // a Focus cell is offered only under its own Focus
    let x = Math.pow(lerpTable(LEVEL_WEIGHT, Math.abs(f.level - level)), sharp);
    x *= tripletFactor(f, level, tier);
    const ci0 = pd.info[i];
    x *= roleWeight(f, q, role, level);
    if (ending) {
      // the closing note: root/3rd/5th beat the 9th and the 6th (a 6th in the minor tonic is a Beginner/Intermediate trap)
      if (ci0.lastRel === 2 && tier >= 3) x *= tier === 4 ? 0.2 : 0.35;
      if (ci0.lastRel === 9) x *= q === 'maj7' ? (tier === 4 ? 0.25 : 0.8) : tier <= 2 ? 0.1 : tier === 3 ? 0.5 : 0.25;
    }
    if (first && !firstNoteOk(f, q)) x *= 0.2;
    if (first && (q === 'dom7' || q === 'dom7alt' || chainLanding) && !ci0.firstGuide(q) && f.notes[0].rel != null) x *= 0.3; // a dominant arrives on its 3rd or 7th (so does every interior chord of a long chain)
    let boost = 1;
    if (concept && ctx) { boost = conceptFactor(f, ci0, q, concept, ctx, tier); x *= boost; }
    w[i] = x;
    total += x;
    cum[i] = total;
    if (boost > 1) boosted += x;
  }
  // A small pool of Focus cells (e.g. the 2-beat triad pairs for m7b5) must still be drawn about half the time, or a short lick
  // never gets one: scale the boosted cells up to a share of ~55% of the pool's weight (at most x6). Tag concepts only.
  if (concept && boosted > 0 && TAG_CONCEPTS.has(concept) && boosted < 1.2 * (total - boosted)) {
    const k = Math.min(FOCUS_POOL_MAX_SCALE, (1.2 * (total - boosted)) / boosted);
    if (k > 1.01) {
      total = 0;
      for (let i = 0; i < n; i++) {
        if (w[i] > 0 && pd.frags[i].concept === concept && hasTagForConcept(pd.frags[i], concept)) w[i] *= k;
        total += w[i];
        cum[i] = total;
      }
    }
  }
  return { w, cum, total };
}

/* Scratch for pickCell (single-threaded; grown on demand, never allocated per pick). */
let scratchSize = 0;
let touched = new Int32Array(0);
let stampArr = new Int32Array(0);
let dcum = new Float64Array(0);
let stampGen = 0;
function ensureScratch(n: number): void {
  if (n <= scratchSize) return;
  scratchSize = Math.max(n, 256);
  touched = new Int32Array(scratchSize);
  stampArr = new Int32Array(scratchSize);
  dcum = new Float64Array(scratchSize);
  stampGen = 0;
}
let nTouched = 0;
function touch(i: number): void {
  if (stampArr[i] !== stampGen) { stampArr[i] = stampGen; touched[nTouched++] = i; }
}
function touchAll(l: number[] | undefined): void {
  if (l) for (let j = 0; j < l.length; j++) touch(l[j]);
}

/** Running state of buildPlan that the per-pick factors depend on. */
interface PickState {
  prevId: string;
  hasPrev: boolean;
  pRels: number; pShape: number; pFirst3: number; pLast2: number;
  seqCells: number; dottedCells: number; n16: number; nAll: number;
  /** Focus cells already in this lick (under a Focus): the same cell is not played twice. */
  used: string[];
}

/**
 * Weighted pick of one cell. The static weights come from the per-round BaseWeights; only the cells whose weight depends on
 * the previous picks (same id / same figure as the previous cell, heard recently, a second sequence or dotted cell, the 16th-share cap)
 * are adjusted, and the pick is a binary search over the prefix sums. Same distribution as the linear scan, no allocation.
 */
function pickCell(rng: Rng, pd: PoolData, bw: BaseWeights, st: PickState, av: AvoidInfo | undefined, tier: Tier): number {
  const n = pd.n;
  ensureScratch(n);
  stampGen++;
  nTouched = 0;
  const cap = MAX_SIXTEENTH_SHARE[tier];
  touchAll(pd.byId.get(st.prevId));
  if (av) touchAll(av.list);
  if (st.hasPrev) {
    touchAll(pd.byRels.get(st.pRels)); touchAll(pd.byShape.get(st.pShape));
    touchAll(pd.byFirst3.get(st.pFirst3)); touchAll(pd.byLast2.get(st.pLast2));
  }
  if (st.seqCells > 0) touchAll(pd.seqList);
  if (st.dottedCells > 0) touchAll(pd.dottedList);
  for (let j = 0; j < st.used.length; j++) touchAll(pd.byId.get(st.used[j]));
  const capList = pd.capList;
  for (let j = 0; j < capList.length; j++) {
    const i = capList[j];
    if ((st.n16 + pd.n16[i]) / (st.nAll + pd.nAttacks[i]) > cap) touch(i);
  }
  const m = nTouched;
  // ascending order (insertion sort: m is small)
  for (let a = 1; a < m; a++) {
    const v = touched[a];
    let b = a - 1;
    while (b >= 0 && touched[b] > v) { touched[b + 1] = touched[b]; b--; }
    touched[b + 1] = v;
  }
  let total = bw.total;
  let run = 0;
  for (let k = 0; k < m; k++) {
    const i = touched[k];
    let w = bw.w[i];
    const base = w;
    if (pd.ids[i] === st.prevId) w *= 0.05;
    if (av && av.mask[i]) w *= av.mask[i] === 2 ? 0.3 : 0.01;
    if (st.hasPrev && (pd.rels[i] === st.pRels || pd.shape[i] === st.pShape || pd.first3[i] === st.pFirst3 || pd.last2[i] === st.pLast2)) w *= 0.12;
    if (st.seqCells > 0 && pd.seq[i]) w *= 0.002; // one sequence per lick
    if (st.dottedCells > 0 && pd.dotted[i]) w *= 0.02; // one dotted-8th cell per lick
    if (st.used.length && st.used.includes(pd.ids[i])) w *= 0.02; // a Focus cell is not repeated within a lick
    if (pd.n16[i] >= 3 && (st.n16 + pd.n16[i]) / (st.nAll + pd.nAttacks[i]) > cap) w *= 0.02;
    run += w - base;
    dcum[k] = run;
  }
  total += run;
  if (!(total > 0)) return rng.int(n);
  const r = rng.next() * total;
  const cum = bw.cum;
  // find the segment: first touched cell whose adjusted prefix exceeds r
  let k = 0;
  while (k < m && cum[touched[k]] + dcum[k] <= r) k++;
  const off = k === 0 ? 0 : dcum[k - 1];
  let lo = k === 0 ? 0 : touched[k - 1] + 1;
  let hi = k < m ? touched[k] : n - 1; // hi satisfies the predicate (or is the fallback: the last cell)
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] + off > r) hi = mid; else lo = mid + 1;
  }
  return Math.min(lo, n - 1);
}

function buildPlan(
  rng: Rng, chords: LickChord[], slotBeats: number[], pools: Pools, level: number, sharp: number, tier: Tier,
  avoid: ReadonlySet<string> | undefined, roles: ChordRole[], roundCache: RoundCache, avoidCache: Map<PoolData, AvoidInfo>,
  concept?: ConceptId,
): PlanItem[] {
  const plan: PlanItem[] = [];
  let prevLastAbs: number | null = null; // pitch class the previous cell ended on (guide-tone steering)
  const st: PickState = { prevId: '', hasPrev: false, pRels: 0, pShape: 0, pFirst3: 0, pLast2: 0, seqCells: 0, dottedCells: 0, n16: 0, nAll: 0, used: [] };
  let beat = 0;
  chords.forEach((chord, ci) => {
    const isLastSlot = ci === chords.length - 1;
    const q = chord.quality;
    let endingPiece: 2 | 4 | null = null;
    if (isLastSlot) {
      const opts = ([4, 2] as const).filter(b => b <= slotBeats[ci]);
      endingPiece = rng.weighted(opts, b => (b === 4 ? 3 : 1));
    }
    const parts = partitionSlot(rng, slotBeats[ci], beat, endingPiece, roles[ci] === 'lyd' ? 0.25 : 0.6); // 2-beat cells: the Lydian-dominant cells are mostly short
    let tick = chord.start;
    st.prevId = '';
    parts.forEach((b, pi) => {
      const ending = isLastSlot && pi === parts.length - 1;
      const pd = pools.get(q, b as 2 | 4, ending);
      // Weight factors that depend only on the cell, the chord and the round (level, sharpness) are computed once per round.
      let slots = roundCache.get(pd);
      if (!slots) { slots = new Array(20); roundCache.set(pd, slots); }
      // interior chords of a chain of more than three chords land on a guide tone like a dominant does, and so does the final chord (the
      // resolution is as important as any interior change)
      const chainLanding = (chords.length > 3 && ci > 0 && !isLastSlot) || isLastSlot;
      let slot = (ROLE_SLOT[roles[ci]] * 2 + (pi === 0 ? 1 : 0)) * 2 + (chainLanding ? 1 : 0);
      // Focus concepts that depend on the neighbouring chord get their own cache slot per context (never used without a concept)
      let ctx: CellCtx | undefined;
      if (concept) {
        const arrives = pi === 0 && ci > 0;
        const departs = pi === parts.length - 1 && !isLastSlot;
        const antic = concept === 'anticipateI' && isLastSlot && pi === 0 && ci > 0;
        ctx = { arrives, departs, chord, ...(antic ? { anticOld: chords[ci - 1], anticOldLydian: roles[ci - 1] === 'lyd' } : {}) };
        if (concept === 'guideTones' && (arrives || departs)) {
          const guide = guideRels(q);
          if (arrives && prevLastAbs !== null) ctx.arrNear = guide.reduce((m, g, i) => (nearPc(prevLastAbs! - chord.rootPc, g) ? m | (1 << i) : m), 0);
          if (departs) {
            const nx = chords[ci + 1];
            ctx.depNear = guide.reduce((m, g, i) => (guideRels(nx.quality).some(h => nearPc(g, nx.rootPc + h - chord.rootPc)) ? m | (1 << i) : m), 0);
          }
          slot = ctxSlot(`g${slot}|${ctx.arrNear ?? 'x'}|${ctx.depNear ?? 'x'}`);
        }
        else if (antic) slot = ctxSlot(`a${slot}|${chords[ci - 1].quality}|${mod12(chords[ci - 1].rootPc - chord.rootPc)}|${roles[ci - 1] === 'lyd' ? 1 : 0}`);
      }
      let bw = slots[slot];
      if (!bw) { bw = baseWeights(pd, q, roles[ci], level, sharp, tier, pi === 0, ending, chainLanding, concept, ctx); slots[slot] = bw; }
      let av: AvoidInfo | undefined;
      if (avoid) {
        av = avoidCache.get(pd);
        if (!av) {
          av = { mask: new Uint8Array(pd.n), list: [] };
          // under a Focus its own cells are only softly avoided (2): a small pool must keep delivering the concept
          for (let i = 0; i < pd.n; i++) if (avoid.has(pd.ids[i])) { av.mask[i] = concept && pd.frags[i].concept === concept ? 2 : 1; av.list.push(i); }
          avoidCache.set(pd, av);
        }
      }
      const idx = pickCell(rng, pd, bw, st, av, tier);
      const frag = pd.frags[idx];
      if (pd.seq[idx]) st.seqCells++;
      if (pd.dotted[idx]) st.dottedCells++;
      st.n16 += pd.n16[idx];
      st.nAll += pd.nAttacks[idx];
      if (frag.concept) st.used.push(frag.id);
      st.prevId = pd.ids[idx];
      st.hasPrev = true;
      prevLastAbs = mod12(chord.rootPc + pd.info[idx].lastRel);
      st.pRels = pd.rels[idx]; st.pShape = pd.shape[idx]; st.pFirst3 = pd.first3[idx]; st.pLast2 = pd.last2[idx];
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

/** Pitch summary of a fragment's pitched notes (rel from the chord root): enough to rebuild first / last / mean at any octave. */
interface FragPitch { first: number; last: number; sum: number; cnt: number; rels: number[] }
const fragPitches = new WeakMap<Fragment, FragPitch>();
function fragPitch(f: Fragment): FragPitch {
  let v = fragPitches.get(f);
  if (!v) {
    v = { first: 0, last: 0, sum: 0, cnt: 0, rels: [] };
    for (const n of f.notes) {
      if (n.rel == null) continue;
      if (!v.cnt) v.first = n.rel;
      v.last = n.rel;
      v.sum += n.rel;
      v.cnt++;
      v.rels.push(n.rel);
    }
    fragPitches.set(f, v);
  }
  return v;
}

const K_COUNT = K_MAX - K_MIN + 1;
/** Range violation of a fragment at every (root pitch class, octave), computed once per lick request and fragment. */
type FitMemo = Map<Fragment, Float64Array>;

function violOf(memo: FitMemo, f: Fragment, rootPc: number, k: number, range: [number, number]): number {
  let row = memo.get(f);
  if (!row) { row = new Float64Array(12 * K_COUNT).fill(-1); memo.set(f, row); }
  const slot = rootPc * K_COUNT + (k - K_MIN);
  let v = row[slot];
  if (v < 0) {
    v = 0;
    const base = baseOf(rootPc) + 12 * k;
    const rels = fragPitch(f).rels;
    for (let i = 0; i < rels.length; i++) {
      const p = base + rels[i];
      v += Math.max(0, range[0] - p, p - range[1]);
    }
    row[slot] = v;
  }
  return v;
}

/* Scratch for the Viterbi (grown on demand). */
let vitCost = new Float64Array(0);
let vitFrom = new Int8Array(0);
const joinPen = new Float64Array(2 * K_COUNT - 1);

/** Viterbi over per-fragment octave choices: smooth joins, inside the range, centred. */
function chooseOctaves(plan: PlanItem[], chords: LickChord[], range: [number, number], memo: FitMemo): number[] {
  const centre = range[0] + 0.4 * (range[1] - range[0]);
  const n = plan.length;
  if (vitCost.length < n * K_COUNT) { vitCost = new Float64Array(n * K_COUNT); vitFrom = new Int8Array(n * K_COUNT); }
  let prevLast = 0;
  let prevHasLast = false;
  for (let i = 0; i < n; i++) {
    const item = plan[i];
    const rootPc = chords[item.chordIdx].rootPc;
    const base = baseOf(rootPc);
    const fp = fragPitch(item.frag);
    const hasPitch = fp.cnt > 0;
    // join(k, pk) depends only on k - pk: first - prev.last = d0 + 12 (k - pk)
    if (i > 0 && hasPitch && prevHasLast) {
      const d0 = base + fp.first - prevLast;
      for (let dk = -(K_COUNT - 1); dk < K_COUNT; dk++) joinPen[dk + K_COUNT - 1] = leapPenalty(d0 + 12 * dk);
    }
    for (let k = 0; k < K_COUNT; k++) {
      const viol = violOf(memo, item.frag, rootPc, K_MIN + k, range);
      const mean = hasPitch ? (fp.cnt * (base + 12 * (K_MIN + k)) + fp.sum) / fp.cnt : (range[0] + range[1]) / 2;
      const own = viol * 40 + Math.abs(mean - centre) * 0.12;
      if (i === 0) { vitCost[k] = own; vitFrom[k] = -1; continue; }
      let best = Infinity;
      let from = 0;
      const useJoin = hasPitch && prevHasLast;
      for (let pk = 0; pk < K_COUNT; pk++) {
        const c = vitCost[(i - 1) * K_COUNT + pk] + (useJoin ? joinPen[k - pk + K_COUNT - 1] : 0);
        if (c < best) { best = c; from = pk; }
      }
      vitCost[i * K_COUNT + k] = best + own;
      vitFrom[i * K_COUNT + k] = from;
    }
    prevHasLast = hasPitch;
    prevLast = hasPitch ? base + fp.last : 0; // at octave 0; octave k adds 12 k (folded into dk above)
  }
  let bi = 0;
  const lastRow = (n - 1) * K_COUNT;
  for (let k = 1; k < K_COUNT; k++) if (vitCost[lastRow + k] < vitCost[lastRow + bi]) bi = k;
  const out: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = K_MIN + bi;
    bi = vitFrom[i * K_COUNT + bi];
  }
  return out;
}

/* ------------------------------ assembly ------------------------------ */

function planToEvents(plan: PlanItem[], chords: LickChord[], octaves: number[], concept?: ConceptId): { events: Ev[]; fragStarts: number[] } {
  const events: Ev[] = [];
  const fragStarts: number[] = [];
  plan.forEach((item, i) => {
    const base = baseOf(chords[item.chordIdx].rootPc);
    const lock = !!concept && item.frag.concept === concept; // a Focus cell is not rewritten by the repair and phrasing passes
    fragStarts.push(events.length);
    let pos = item.start;
    let open: Ev | null = null;
    for (const n of item.frag.notes) {
      const midi = n.rel == null ? null : base + n.rel + 12 * octaves[i];
      if (open) {
        open.pieces.push(n.dur);
      } else {
        open = lock ? { midi, start: pos, pieces: [n.dur], lock: true } : { midi, start: pos, pieces: [n.dur] };
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
  let fs = 0; // fragStarts is ascending
  events.forEach((e, i) => {
    while (fs < fragStarts.length && fragStarts[fs] < i) fs++;
    if (e.midi == null) return;
    sum += e.midi;
    cnt++;
    cost += Math.max(0, range[0] - e.midi, e.midi - range[1]) * 40;
    if (prev != null && fs < fragStarts.length && fragStarts[fs] === i) cost += leapPenalty(e.midi - prev);
    prev = e.midi;
  });
  if (cnt) cost += Math.abs(sum / cnt - centre) * 0.12;
  return cost;
}

/**
 * Landing penalty by the note's degree (semitones above the chord root), in "score points" so it can be added to the
 * candidate's distance from the target. Dominants must land on the 3rd or 7th; the tonic's best landings are the 3rd,
 * 7th/6th, then 9th and 5th (root weakest); other chords prefer a guide tone too.
 * `chain`: an interior chord of a progression of more than three chords (turnaround, Coltrane changes): every change there is a
 * resolution, so a non-dominant chord is also landed on its 3rd or 7th (the classic three-chord progressions keep their light preference).
 */
function landingPenalty(q: ChordQualityId, rel: number, last: boolean, chain = false): number {
  const c = CHORDS[q];
  if (c.guide.some(g => mod12(g) === rel)) return 0;
  if (q === 'dom7' || q === 'dom7alt') return rel === 0 ? 3 : 2.5;
  if (chain && !last) return rel === 0 ? 2 : 1.5;
  if (last) {
    if (rel === 2 || rel === 7) return 0.15;
    if (rel === 0) return 1.8;
    return 0.6;
  }
  return rel === 0 ? 0.4 : 0.2;
}

/**
 * Penalty for the lick's closing note by its degree over the last chord: root, 3rd, 5th and 7th are the endings; the 9th (Advanced
 * and up) and the 6th (always in the minor tonic below Advanced; at Expert everywhere) are coloured endings used sparingly.
 */
function closingPenalty(q: ChordQualityId, rel: number, tier: Tier): number {
  if (rel === 9) return q === 'maj7' ? (tier === 4 ? 2 : 0.4) : tier <= 2 ? 1.2 : tier === 3 ? 1 : 2;
  if (rel === 2) return tier === 4 ? 2.2 : tier === 3 ? 1.6 : 0.4;
  if (rel === 0) return 0.3;
  if (rel === 7) return 0.1;
  return CHORDS[q].tones.some(t => mod12(t) === rel) ? 0 : 0.6;
}

/**
 * Preference terms (score points) used to rank candidates besides difficulty: guide-tone arrivals at chord changes,
 * no long non-scale note on a beat, staying inside the comfortable tessitura, and the line's own manners: no natural 11
 * on a Lydian dominant, no arpeggio noodling (a run of more than six chord-tone attacks within an octave), and no
 * long stepwise 16th run in the last bar.
 */
function preference(events: Ev[], chords: LickChord[], comfort: [number, number], lydian: boolean[], tier: Tier, secondary: boolean[]): number {
  const nC = chords.length;
  const nE = events.length;
  let pen = 0;
  // Events are sorted by start, so the event sounding at each chord start and the chord of each event are found with moving pointers.
  if (durScratch.length < nE) durScratch = new Int32Array(nE * 2);
  const durs = durScratch;
  for (let i = 0; i < nE; i++) {
    const pcs = events[i].pieces;
    let d = 0;
    for (let j = 0; j < pcs.length; j++) d += pcs[j];
    durs[i] = d;
  }
  let ei = 0;
  for (let ci = 0; ci < nC; ci++) {
    const ch = chords[ci];
    while (ei < nE && events[ei].start + durs[ei] <= ch.start) ei++;
    const e = ei < nE && events[ei].start <= ch.start ? events[ei] : undefined;
    if (!e || e.midi == null) continue;
    // one note held across a whole short dominant: its colour (the alteration, the Lydian #11) never sounds (Coltrane changes: F through D♭7)
    if ((ch.quality === 'dom7' || ch.quality === 'dom7alt') && ch.dur === 2 * TPB && e.start + durs[ei] >= ch.start + ch.dur) {
      let attacks = 0;
      for (let k = ei; k < nE && events[k].start < ch.start + ch.dur; k++) if (events[k].midi != null && events[k].start >= ch.start) attacks++;
      if (attacks <= 1) pen += 8;
    }
    pen += landingPenalty(ch.quality, mod12(e.midi - ch.rootPc), ci === nC - 1, nC > 3 && ci > 0);
  }
  let closing: Ev | undefined;
  for (let i = nE - 1; i >= 0; i--) if (events[i].midi != null) { closing = events[i]; break; }
  if (closing) { const lc = chords[nC - 1]; pen += closingPenalty(lc.quality, mod12((closing.midi as number) - lc.rootPc), tier); }
  let out = 0;
  if (flagScratch.length < nC * 3) flagScratch = new Int32Array(nC * 3 + 16);
  const flags = flagScratch;
  flags.fill(0, 0, nC * 3);
  // per chord: flags[3 ci] altered tone seen (anticipation-adjusted chord); flags[3 ci + 1] count of altered tones;
  // flags[3 ci + 2] bit 1 = one held a quarter on a beat, bit 2 = m7b5 states its b5
  let prevMidi: number | null = null;
  let runLen = 0;
  let runLo = 0;
  let runHi = 0;
  let sixRun = 0;
  const endTick = nE ? events[nE - 1].start + durs[nE - 1] : 0;
  let cp = 0; // chordIndexAt(chords, e.start)
  let heads = 0;
  let sixteenths = 0;
  for (let i = 0; i < nE; i++) {
    const e = events[i];
    if (e.midi == null) { runLen = 0; sixRun = 0; continue; }
    const dur = durs[i];
    heads++;
    if (e.pieces[0] <= TICKS_PER_16TH && e.pieces.length === 1) sixteenths++;
    out += Math.max(0, comfort[0] - e.midi, e.midi - comfort[1]);
    if (prevMidi != null && Math.abs(e.midi - prevMidi) >= 10) pen += 14; // a leap of a minor 7th or more
    // an anticipation head (attacked within a beat before a change and tied over it) is judged on the arrival chord
    while (cp + 1 < nC && e.start >= chords[cp + 1].start) cp++;
    let ci = cp;
    const next = chords[ci + 1];
    if (next && e.start + dur > next.start && next.start - e.start < TPB) ci++;
    const ch = chords[ci];
    const rel = mod12(e.midi - ch.rootPc);
    const stressed = e.start % TPB === 0 || dur >= TPB;
    if (e.start % TPB === 0 && dur >= TPB && !inScale(e.midi, ch.rootPc, ch.quality)) pen += 1.5;
    if (stressed && rel === 5 && (ch.quality === 'maj7' || (ch.quality === 'dom7' && lydian[ci]))) pen += 10; // avoid note
    if (rel === 5 && ch.quality === 'dom7' && lydian[ci]) pen += 4; // natural 11 on a Lydian dominant, stressed or not
    if ((rel === 1 || rel === 3 || rel === 8) && ch.quality === 'dom7' && lydian[ci]) pen += 3; // the altered sound is not Lydian dominant
    if (tier >= 2 && secondary[ci] && stressed && rel === 9) pen += 3; // a stressed natural 13 on VI7 clashes with the b3 of the ii it resolves to
    if (ch.quality === 'dom7alt' && (rel === 1 || rel === 3 || rel === 8)) flags[3 * ci] = 1;
    // altered-tone count and m7b5's b5 judge each event on the chord it starts in (not the arrival chord)
    const own = chords[cp];
    const orel = mod12(e.midi - own.rootPc);
    if (own.quality === 'dom7alt' && (orel === 1 || orel === 3 || orel === 8)) {
      flags[3 * cp + 1]++;
      if (e.start % TPB === 0 && dur >= TPB) flags[3 * cp + 2] |= 1;
    }
    if (own.quality === 'm7b5' && orel === 6) flags[3 * cp + 2] |= 2;
    // arpeggio noodling: more than six chord-tone attacks in a row inside an octave
    if (CHORDS[ch.quality].tones.some(t => mod12(t) === rel)) {
      if (runLen === 0) { runLo = e.midi; runHi = e.midi; }
      runLo = Math.min(runLo, e.midi);
      runHi = Math.max(runHi, e.midi);
      if (runHi - runLo > 12) { runLen = 1; runLo = e.midi; runHi = e.midi; } else runLen++;
      if (runLen > 6 && tier >= 2) pen += (runLen === 7 ? 4 : 2) * (tier === 2 ? 0.6 : 1) * (nC > 3 ? 2 : 1); // longer chains give more room to noodle: doubled there
    } else runLen = 0;
    // a stepwise 16th run in the last bar longer than four notes
    if (dur <= TICKS_PER_16TH && e.start >= endTick - TPBAR && prevMidi != null && Math.abs(e.midi - prevMidi) <= 2 && sixRun > 0) {
      sixRun++;
      if (sixRun > 4) pen += 3;
    } else sixRun = dur <= TICKS_PER_16TH ? 1 : 0;
    prevMidi = e.midi;
  }
  // Expert is reached by language, not by speed alone: the share of 16th-note attacks is capped (a soft cap at the finished lick)
  if (heads) pen += Math.max(0, sixteenths / heads - SIXTEENTH_SOFT_CAP[tier]) * SIXTEENTH_OVER_COST;
  for (let ci = 0; ci < nC; ci++) if (chords[ci].quality === 'dom7alt' && !flags[3 * ci]) pen += 6; // 7alt must sound altered
  // ... and not just by one passing note: two altered tones, or one held a quarter on a beat
  for (let ci = 0; ci < nC; ci++) {
    if (chords[ci].quality !== 'dom7alt' || !flags[3 * ci]) continue;
    if (flags[3 * ci + 1] < 2 && !(flags[3 * ci + 2] & 1)) pen += tier === 1 ? 0 : tier === 2 ? 1.5 : 2;
  }
  if (tier >= 2) for (let ci = 0; ci < nC; ci++) { // m7b5 states its b5
    if (chords[ci].quality === 'm7b5' && !(flags[3 * ci + 2] & 2)) pen += 1.5;
  }
  return pen + Math.min(out, 40) * 0.12;
}
let durScratch = new Int32Array(256);
let flagScratch = new Int32Array(64);

/** Ranking penalty (score points) for a candidate that misses the Focus concept: per chord change for guide tones, once for the rest. */
const CONCEPT_MISS_BY_TIER: readonly number[] = [10, 10, 16, 14];
/** Guide tones at Advanced / Expert: every change that is not linked costs more, so the search favours the fully linked candidates. */
const CONCEPT_MISS_GT_HIGH = 11;
function conceptPenalty(notes: LickNote[], chords: LickChord[], concept: ConceptId, tier: Tier): { pen: number; hit: boolean } {
  const { hits, of } = conceptHits({ notes, chords }, concept);
  const miss = of - hits;
  // a long chain of changes may leave one link open (a lick must still sit on the slider's target)
  const hit = miss <= (concept === 'guideTones' ? Math.floor(of / 6) : 0);
  return { pen: (concept === 'guideTones' && tier >= 3 ? CONCEPT_MISS_GT_HIGH : CONCEPT_MISS_BY_TIER[tier - 1]) * miss, hit };
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
  const concept: ConceptId | undefined = opts.concept && conceptAllowed(opts.concept, reqTier) ? opts.concept : undefined;
  const tol = target !== undefined ? scoreTolerance(reqTier) : 0;
  const def = getProgression(opts.progressionId);
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const keyPc = mod12(opts.keyPc);
  const chords = expandProgression(def, opts.length, keyPc);
  const beatsPerSlot = slotBeats(def, opts.length);
  const totalTicks = chords.reduce((a, c) => a + c.dur, 0);
  const comfort: [number, number] = opts.comfortRange
    ? [Math.max(opts.range[0], opts.comfortRange[0]), Math.min(opts.range[1], opts.comfortRange[1])]
    : opts.range;
  const fitRange = comfort[1] - comfort[0] >= 14 ? comfort : opts.range;
  const pools = makePools(opts.fragments ?? FRAGMENTS);
  const avoidSet = opts.avoid?.length ? new Set(opts.avoid) : undefined;
  const rng = new Rng(seed);
  const avoidCache = new Map<PoolData, AvoidInfo>();
  const fitMemo: FitMemo = new Map();
  // Lydian-dominant chords (tritone-sub bII7, backdoor bVII7): the natural 11 is an avoid note there
  const roles = chordRoles(def.slots);
  const lydian = roles.map(r => r === 'lyd');
  const secondary = roles.map(r => r === 'secondary');

  let best: { notes: LickNote[]; plan: PlanItem[]; cost: number; dist: number; pref: number; hit: boolean } | null = null;
  // Without a target the level is the tier (integer, exactly the original weighting). With a target it starts at
  // the target's fractional level and is nudged each round toward where the candidates actually scored.
  let level = target !== undefined ? levelForTarget(target) : reqTier;
  let roundCache: RoundCache | null = null;
  let cachedLevel = NaN;
  let cachedSharp = NaN;
  let nHit = 0; // under a Focus: candidates that delivered the concept so far
  const hitScores: number[] = []; // under a Focus: scores of the candidates that deliver the concept (all rounds)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sharp = 1 + Math.min(round, 2) * 0.8;
    const roundScores: number[] = [];
    // the per-pool weights depend only on (level, sharpness): rounds that keep both (the level is clamped, sharpness stops growing) share them
    if (!roundCache || level !== cachedLevel || sharp !== cachedSharp) { roundCache = new Map(); cachedLevel = level; cachedSharp = sharp; }
    for (let c = 0; c < (concept ? CANDIDATES_PER_ROUND_FOCUS : CANDIDATES_PER_ROUND); c++) {
      const plan = buildPlan(rng, chords, beatsPerSlot, pools, level, sharp, reqTier, avoidSet, roles, roundCache!, avoidCache, concept);
      const octaves = chooseOctaves(plan, chords, fitRange, fitMemo);
      const { events, fragStarts } = planToEvents(plan, chords, octaves, concept);
      const fixes = fixJoins(events, chords, opts.range) + fixLeaps(events, opts.range);
      phraseEvents(rng, events, fragStarts, chords, opts.range, { level, lydian, ...(concept === 'anticipateI' ? { anticipateLast: true } : {}) });
      const notes = eventsToNotes(events, chords);
      const cost = lickCost(events, fragStarts, opts.range, fixes);
      const score = scoreLick(notes, chords, def).score;
      let pref = preference(events, chords, fitRange, lydian, reqTier, secondary);
      let outside = 0;
      for (const n of notes) if (n.midi != null) outside += Math.max(0, opts.range[0] - n.midi, n.midi - opts.range[1]);
      pref += outside * 60; // the hard range outranks everything
      const focus = concept ? conceptPenalty(notes, chords, concept, reqTier) : null;
      pref += focus ? focus.pen : 0;
      if (focus?.hit) nHit++;
      roundScores.push(score);
      if (focus?.hit) hitScores.push(score);
      // With a target, staying inside the target's tier outranks closeness (a target on a boundary must not land across it).
      const dist = target !== undefined
        ? (tierDistance(score, reqTier) > 0 ? 1000 : 0) + Math.abs(score - target) + pref
        : (tierDistance(score, reqTier) > 0 ? 1000 + tierDistance(score, reqTier) : 0) + pref;
      if (!best || dist < best.dist || (dist === best.dist && cost < best.cost)) best = { notes, plan, cost, dist, pref, hit: !focus || focus.hit };
    }
    if (best && best.dist - best.pref <= (concept ? (round < STOP_TOL_ROUNDS ? Math.min(tol, STOP_TOL) : round < LATE_ROUND ? tol : 999) : tol) && best.hit) break; // with a Focus, keep searching until a candidate delivers it (first rounds: as close to the target as it gets)
    if (concept && round >= NO_HIT_ROUNDS && nHit === 0) break; // nothing in the pool delivers the concept here: do not search on (speed)
    if (target !== undefined) {
      // under a Focus the delivering candidates are the ones that matter: when they overshoot, the level drops faster, so the cells around
      // the Focus cell get cheaper and the score comes back to the target
      const ref = concept && hitScores.length >= 2 ? hitScores.slice(-8) : roundScores;
      const mid = [...ref].sort((a, b) => a - b)[ref.length >> 1];
      if (mid > target + tol) {
        // stop early only once the best candidate is inside the target tier (dist < 1000)
        if (level <= 1 && round >= FLOOR_AFTER_ROUND && best && best.dist - best.pref < 1000 && best.hit) break;
        level = Math.max(1, level - 0.4);
      }
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
    ...(concept ? { focus: concept } : {}),
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

