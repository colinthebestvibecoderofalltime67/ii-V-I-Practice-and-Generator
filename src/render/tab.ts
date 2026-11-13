/**
 * Pure fingering and fret assignment for tablature. No DOM, no VexFlow.
 *
 * The model follows how guitarists actually play single-note lines (see docs/GUITAR_TAB.md):
 * the fretting hand sits in a POSITION (the fret under the index finger), plays one finger per
 * fret across a 4-fret window, may stretch one fret out with the index or the pinky (a 5-fret
 * window, never both ways at once), and SHIFTS to a new position only when it must. Shifts are
 * cheap at natural shift points (a cell join, after a rest or a long note, a half-step slide with
 * one finger, an open string) and expensive in the middle of a run.
 *
 * A Viterbi pass over every (string, fret, hand position, stretch side) state finds the cheapest
 * fingering. It is deterministic and runs in a few milliseconds for a 50-note lick.
 *
 * String numbering follows VexFlow: 1 = HIGHEST string. `tuning` is listed low string first.
 */
import type { Instrument, Lick } from '../types';
import { TICKS_PER_16TH, TPB } from '../types';

export interface FretPos {
  str: number;
  fret: number;
}

/** A note of a line. `start`/`dur` are ticks (TPB = 12 per beat); without them each index is one 16th (3 ticks) long, starting at index * 3. */
export interface LineNote {
  midi: number | null;
  start?: number;
  dur?: number;
}
export type LineInput = (number | null | LineNote)[];

export interface FingeredNote extends FretPos {
  /** Suggested finger, 1 = index … 4 = pinky, 0 = open string. */
  finger: 0 | 1 | 2 | 3 | 4;
  /** Hand position: the fret under the index finger (open strings report the hand's current position). */
  pos: number;
  /** True on the first fretted note after the hand has moved to a new position. */
  shift: boolean;
  /** True when this note needs an index or pinky stretch out of the 4-fret box. */
  stretch: boolean;
}

export interface Fingering {
  notes: (FingeredNote | null)[];
  /** Unanchored playing cost (lower = easier). Comparable across fingerings of the same line. */
  cost: number;
  /** Number of position shifts. */
  shifts: number;
  /** Main hand position (fret under the index finger, most notes). 0 when only open strings. */
  position: number;
  /** "Pos. V", "Open pos." … */
  label: string;
  /** Lowest and highest fretted fret used ([0, 0] when none). */
  window: [number, number];
}

export type TabStyle = 'guitar' | 'bass';

export interface FingerOptions {
  /** Tick positions where a melodic cell starts (shifting there is cheap). Same units as `start`. */
  cellStarts?: number[];
  /** 'bass' uses 1-2-4 (Simandl) fingering below the 7th position. Default: inferred from the tuning. */
  style?: TabStyle;
  /** Keep the hand near this position (used by positionsForLick). */
  anchor?: number;
}

/* ------------------------------------------------------------------ cost model */

interface Costs {
  shiftBase: number; // any position shift
  shiftPerFret: number; // per fret of hand travel
  bigShift: number; // extra per fret beyond 5
  stretch: number; // index/pinky stretch out of the box
  sameFinger: number; // same finger, different string and fret (a "jump")
  roll: number; // same finger, same fret, next string (a roll)
  skip: number; // per skipped string
  posPref: number; // per fret of hand position (mild preference for lower positions)
  high: number; // per fret above 12
  anchor: number; // per fret away from the anchor position, per note
}

const GUITAR_COSTS: Costs = {
  shiftBase: 3, shiftPerFret: 0.3, bigShift: 0.3, stretch: 0.8, sameFinger: 1.5, roll: 0.5,
  skip: 0.9, posPref: 0.02, high: 0.25, anchor: 1.2,
};
const BASS_COSTS: Costs = { ...GUITAR_COSTS, shiftBase: 2, stretch: 1.0 };
/** Bass: 1-2-4 fingering below this hand position, one finger per fret from here up. */
const SIMANDL_BELOW = 7;

/** Shift-point discounts (multiplied together, floored). */
const AT_CELL_JOIN = 0.35;
const AFTER_REST = 0.4;
const AFTER_LONG = 0.5; // previous note a quarter or longer
const AFTER_DOTTED8 = 0.75;
const HALF_STEP_SLIDE = 0.45;
const WHOLE_STEP_SLIDE = 0.65;
const VIA_OPEN = 0.5;
const ON_BEAT = 0.85;
const MIN_DISCOUNT = 0.12;

function openCost(hp: number, onlyOpen: boolean): number {
  const c = hp <= 3 ? 0.5 : hp <= 5 ? 1.5 : 3;
  return onlyOpen ? Math.min(c, 0.3) : c;
}

/* ------------------------------------------------------------------ states */

interface State {
  str: number; // tuning index, 0 = lowest
  fret: number;
  hp: number; // hand position
  ext: -1 | 0 | 1; // stretch side used so far in this position
  s: -1 | 0 | 1; // this note's own stretch
  finger: 0 | 1 | 2 | 3 | 4;
}

interface Ctx {
  start: number;
  prevDur: number;
  restBefore: boolean;
  boundary: boolean;
  onlyOpen: boolean;
}

type Offset = { o: number; finger: 1 | 2 | 3 | 4; s: -1 | 0 | 1 };
const OFPF: Offset[] = [
  { o: 0, finger: 1, s: 0 }, { o: 1, finger: 2, s: 0 }, { o: 2, finger: 3, s: 0 }, { o: 3, finger: 4, s: 0 },
  { o: -1, finger: 1, s: -1 }, { o: 4, finger: 4, s: 1 },
];
const SIMANDL: Offset[] = [
  { o: 0, finger: 1, s: 0 }, { o: 1, finger: 2, s: 0 }, { o: 2, finger: 4, s: 0 },
  { o: -1, finger: 1, s: -1 }, { o: 3, finger: 4, s: 1 },
];

const isBassTuning = (tuning: number[]) => tuning.length <= 4 && tuning[0] < 45;

function normalize(input: LineInput): LineNote[] {
  return input.map((x, i) => {
    if (x == null || typeof x === 'number') return { midi: x ?? null, start: i * TICKS_PER_16TH, dur: TICKS_PER_16TH };
    return { midi: x.midi, start: x.start ?? i * TICKS_PER_16TH, dur: x.dur ?? TICKS_PER_16TH };
  });
}

interface Prepared {
  line: LineNote[];
  idx: number[]; // input index of each playable pitched note
  states: State[][];
  ctx: Ctx[];
  maxHp: number;
  costs: Costs;
}

function prepare(input: LineInput, tuning: number[], frets: number, opts: FingerOptions): Prepared {
  const line = normalize(input);
  const style = opts.style ?? (isBassTuning(tuning) ? 'bass' : 'guitar');
  const costs = style === 'bass' ? BASS_COSTS : GUITAR_COSTS;
  const maxHp = Math.max(1, frets - 3);
  const cells = [...(opts.cellStarts ?? [])].sort((a, b) => a - b);
  const idx: number[] = [];
  const states: State[][] = [];
  const ctx: Ctx[] = [];
  let prev: LineNote | null = null;
  let restSince = false;
  for (let i = 0; i < line.length; i++) {
    const n = line[i];
    if (n.midi == null) { restSince = true; continue; }
    const list: State[] = [];
    let fretted = 0;
    for (let s = 0; s < tuning.length; s++) {
      const f = n.midi - tuning[s];
      if (!Number.isInteger(f) || f < 0 || f > frets) continue;
      if (f === 0) {
        for (let hp = 1; hp <= maxHp; hp++) for (const ext of [-1, 0, 1] as const) list.push({ str: s, fret: 0, hp, ext, s: 0, finger: 0 });
        continue;
      }
      fretted++;
      for (const off of OFPF) {
        const hp = f - off.o;
        if (hp < 1 || hp > maxHp) continue;
        const table = style === 'bass' && hp < SIMANDL_BELOW ? SIMANDL : OFPF;
        const o = table.find(t => t.o === off.o);
        if (!o) continue;
        const exts: (-1 | 0 | 1)[] = o.s !== 0 ? [o.s] : [-1, 0, 1];
        for (const ext of exts) list.push({ str: s, fret: f, hp, ext, s: o.s, finger: o.finger });
      }
    }
    if (list.length === 0) continue; // out of range -> null
    const start = n.start!;
    const pStart = prev ? prev.start! : -Infinity;
    ctx.push({
      start,
      prevDur: prev ? prev.dur! : 0,
      restBefore: !!prev && (restSince || prev.start! + prev.dur! < start),
      boundary: !!prev && cells.some(c => c > pStart && c <= start),
      onlyOpen: fretted === 0,
    });
    states.push(list);
    idx.push(i);
    prev = n;
    restSince = false;
  }
  return { line, idx, states, ctx, maxHp, costs };
}

function ownCost(st: State, cx: Ctx, k: Costs, anchor: number | undefined): number {
  let c = st.hp * k.posPref;
  if (st.fret === 0) c += openCost(st.hp, cx.onlyOpen);
  else {
    if (st.fret > 12) c += (st.fret - 12) * k.high;
    if (st.s !== 0) c += k.stretch;
  }
  if (anchor != null) c += Math.abs(st.hp - anchor) * k.anchor;
  return c;
}

/** Cost of moving from state a (previous note) to b (note with context cx); Infinity if impossible. */
function transCost(a: State, b: State, cx: Ctx, k: Costs): number {
  let c = 0;
  // an open string does not move the hand: it keeps the position and stretch side of the previous note
  // (a shift "during" an open string is charged, discounted, on the next fretted note)
  if (b.fret === 0 && (a.hp !== b.hp || a.ext !== b.ext)) return Infinity;
  if (a.hp === b.hp) {
    // same position: the stretch side must be consistent
    const want = b.s !== 0 ? b.s : a.ext;
    if (b.ext !== want) return Infinity;
    if (b.s !== 0 && a.ext !== 0 && a.ext !== b.s) return Infinity; // both stretches = 6-fret span
  } else {
    if (b.ext !== b.s) return Infinity; // a new position starts with no stretch history
    const d = Math.abs(a.hp - b.hp);
    let m = 1;
    if (cx.boundary) m *= AT_CELL_JOIN;
    if (cx.restBefore) m *= AFTER_REST;
    else if (cx.prevDur >= TPB) m *= AFTER_LONG;
    else if (cx.prevDur === 3 * TICKS_PER_16TH) m *= AFTER_DOTTED8;
    if (a.fret === 0 || b.fret === 0) m *= VIA_OPEN;
    else if (a.str === b.str && a.finger === b.finger) {
      const df = Math.abs(a.fret - b.fret);
      if (df === 1) m *= HALF_STEP_SLIDE;
      else if (df === 2) m *= WHOLE_STEP_SLIDE;
    }
    if (cx.start % TPB === 0) m *= ON_BEAT;
    c += (k.shiftBase + d * k.shiftPerFret + Math.max(0, d - 5) * k.bigShift) * Math.max(MIN_DISCOUNT, m);
  }
  if (a.fret > 0 && b.fret > 0 && a.finger === b.finger && a.str !== b.str) {
    c += a.fret === b.fret && Math.abs(a.str - b.str) === 1 ? k.roll : k.sameFinger;
  }
  const sd = Math.abs(a.str - b.str);
  if (sd > 1) c += (sd - 1) * k.skip * (cx.restBefore ? 0.5 : 1);
  return c;
}

/* ------------------------------------------------------------------ search */

function viterbi(p: Prepared, anchor: number | undefined): number[] {
  const { states, ctx, costs } = p;
  const n = states.length;
  if (n === 0) return [];
  const back: Int32Array[] = [];
  let cost = Float64Array.from(states[0], st => ownCost(st, ctx[0], costs, anchor));
  back.push(new Int32Array(states[0].length).fill(-1));
  for (let i = 1; i < n; i++) {
    const cur = states[i];
    const prv = states[i - 1];
    const row = new Float64Array(cur.length);
    const brow = new Int32Array(cur.length);
    for (let j = 0; j < cur.length; j++) {
      const b = cur[j];
      let best = Infinity;
      let bj = -1;
      for (let q = 0; q < prv.length; q++) {
        const base = cost[q];
        if (base >= best) continue;
        const v = base + transCost(prv[q], b, ctx[i], costs);
        if (v < best - 1e-9) { best = v; bj = q; }
      }
      row[j] = best + ownCost(b, ctx[i], costs, anchor);
      brow[j] = bj;
    }
    cost = row;
    back.push(brow);
  }
  let j = 0;
  for (let q = 1; q < cost.length; q++) if (cost[q] < cost[j] - 1e-9) j = q;
  const path = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    path[i] = j;
    j = back[i][j];
  }
  return path;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n: number): string => ROMAN[n] ?? String(n);

function build(p: Prepared, path: number[], tuning: number[]): Fingering {
  const out: (FingeredNote | null)[] = new Array(p.line.length).fill(null);
  let cost = 0;
  let shifts = 0;
  let lastFrettedHp = -1;
  const hpCount = new Map<number, number>();
  let lo = Infinity;
  let hi = -Infinity;
  let usesOpen = false;
  path.forEach((j, i) => {
    const st = p.states[i][j];
    cost += ownCost(st, p.ctx[i], p.costs, undefined);
    if (i > 0) cost += transCost(p.states[i - 1][path[i - 1]], st, p.ctx[i], p.costs);
    let shift = false;
    if (st.fret > 0) {
      if (lastFrettedHp >= 0 && st.hp !== lastFrettedHp) { shift = true; shifts++; }
      lastFrettedHp = st.hp;
      hpCount.set(st.hp, (hpCount.get(st.hp) ?? 0) + 1);
      lo = Math.min(lo, st.fret);
      hi = Math.max(hi, st.fret);
    } else usesOpen = true;
    out[p.idx[i]] = { str: tuning.length - st.str, fret: st.fret, finger: st.finger, pos: st.hp, shift, stretch: st.s !== 0 };
  });
  let position = 0;
  let most = 0;
  for (const [hp, c] of [...hpCount].sort((a, b) => a[0] - b[0])) if (c > most) { most = c; position = hp; }
  const label = position === 0 || (usesOpen && position === 1) ? 'Open pos.' : `Pos. ${roman(position)}`;
  return {
    notes: out, cost: Math.round(cost * 100) / 100, shifts, position, label,
    window: lo === Infinity ? [0, 0] : [lo, hi],
  };
}

/** Best fingering of a line (hand positions, fingers, shifts). */
export function fingerLine(input: LineInput, tuning: number[], frets: number, opts: FingerOptions = {}): Fingering {
  const p = prepare(input, tuning, frets, opts);
  return build(p, viterbi(p, opts.anchor), tuning);
}

/**
 * The distinct playable fingerings of a line, one per neck position, sorted low to high.
 * Fingerings that need too many shifts (more than 1 + one per 16 notes) are dropped.
 */
export function positionsForLick(
  input: LineInput, tuning: number[], frets: number, cellStarts?: number[], opts: Omit<FingerOptions, 'cellStarts' | 'anchor'> = {},
): Fingering[] {
  const p = prepare(input, tuning, frets, { ...opts, cellStarts });
  const pitched = p.states.length;
  if (!pitched) return [];
  const maxShifts = 1 + Math.floor(pitched / 16);
  const auto = build(p, viterbi(p, undefined), tuning);
  const maxCost = auto.cost * 2.5 + pitched * 0.25 + 2;
  const cands: Fingering[] = [];
  for (let anchor = 1; anchor <= p.maxHp; anchor++) {
    const f = build(p, viterbi(p, anchor), tuning);
    if (f.shifts <= maxShifts && f.cost <= maxCost) cands.push(f);
  }
  // Keep the cheapest fingering of each box: drop one whose main position is within a fret of a cheaper
  // one's, or that puts most notes on the same strings as a cheaper one.
  cands.sort((a, b) => a.cost - b.cost || a.position - b.position);
  const kept: Fingering[] = [];
  for (const f of cands) {
    const dup = kept.some(k => {
      if (k.label === f.label) return true;
      // open position and 2nd position are different shapes, even though the boxes touch
      const openVsFretted = (k.label === 'Open pos.') !== (f.label === 'Open pos.');
      if (!openVsFretted && Math.abs(k.position - f.position) <= 1) return true;
      let same = 0;
      let tot = 0;
      f.notes.forEach((n, i) => { if (n) { tot++; if (k.notes[i]?.str === n.str) same++; } });
      return tot > 0 && same / tot > 0.7;
    });
    if (!dup) kept.push(f);
  }
  return kept.sort((a, b) => a.position - b.position || a.cost - b.cost);
}

/** Fret assignment only (kept for callers that just need string + fret). */
export function assignFrets(written: (number | null)[], tuning: number[], frets: number): (FretPos | null)[] {
  return fingerLine(written, tuning, frets).notes.map(n => (n ? { str: n.str, fret: n.fret } : null));
}

/* ------------------------------------------------------------------ licks */

/** A lick as a line of WRITTEN pitches: tied chains merged into one note, rests kept. */
export function lickLine(lick: Lick, transpose: number): LineNote[] {
  const sorted = [...lick.notes].sort((a, b) => a.start - b.start);
  const out: LineNote[] = [];
  let tiedFrom: LineNote | null = null;
  let tiedMidi: number | null = null;
  for (const n of sorted) {
    const midi = n.midi == null ? null : n.midi + transpose;
    if (tiedFrom && midi != null && midi === tiedMidi) {
      tiedFrom.dur = n.start + n.dur - tiedFrom.start!;
    } else {
      tiedFrom = { midi, start: n.start, dur: n.dur };
      out.push(tiedFrom);
      tiedMidi = midi;
    }
    if (!(n.tie && midi != null)) { tiedFrom = null; tiedMidi = null; }
  }
  return out;
}

export interface LickFingerings {
  line: LineNote[];
  auto: Fingering;
  positions: Fingering[];
}

const memo = new WeakMap<Lick, Map<string, LickFingerings>>();

/** Auto fingering plus every playable position for a lick on a tab instrument (memoised per lick object). */
export function lickFingerings(lick: Lick, inst: Instrument): LickFingerings | null {
  if (!inst.tab) return null;
  let m = memo.get(lick);
  if (!m) { m = new Map(); memo.set(lick, m); }
  const key = `${inst.id}|${inst.transpose}|${inst.tab.tuning.join(',')}|${inst.tab.frets}`;
  const hit = m.get(key);
  if (hit) return hit;
  const line = lickLine(lick, inst.transpose);
  const cells = Array.isArray(lick.cellStarts) ? lick.cellStarts : undefined;
  const { tuning, frets } = inst.tab;
  const res: LickFingerings = {
    line,
    auto: fingerLine(line, tuning, frets, { cellStarts: cells }),
    positions: positionsForLick(line, tuning, frets, cells),
  };
  m.set(key, res);
  return res;
}

/** The fingering to draw for a `tabPosition` setting ('auto' or an index into positions). */
export function pickFingering(f: LickFingerings, tabPosition: 'auto' | number | undefined): Fingering {
  if (typeof tabPosition === 'number' && Number.isInteger(tabPosition) && tabPosition >= 0 && tabPosition < f.positions.length) {
    return f.positions[tabPosition];
  }
  return f.auto;
}
