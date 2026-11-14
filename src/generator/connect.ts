import type { LickChord, LickNote } from '../types';
import { TICKS_PER_16TH, TPBAR } from '../types';
import { isTupletDur, splitDur } from '../theory/rhythm';
import { CHORDS, inScale, isChordToneOrTension } from '../theory/chords';
import type { Rng } from './rng';
import { mod12 } from '../theory/pitch';

/**
 * A musical event: one sounding pitch (or a rest) made of one or more tied pieces.
 * `pieces` keep the author's original note splits (e.g. 6+4 for a syncopated tie).
 */
export interface Ev {
  midi: number | null;
  start: number;
  pieces: number[];
}

export const evDur = (e: Ev): number => e.pieces.reduce((a, b) => a + b, 0);

/** Penalty for a melodic interval (semitones): free up to a whole step, rising past a 5th. */
export function leapPenalty(d: number): number {
  d = Math.abs(d);
  if (d <= 2) return d * 0.05;
  if (d <= 7) return 0.1 + (d - 2) * 0.4;
  return 2.1 + (d - 7) * 1.5;
}

export function chordIndexAt(chords: LickChord[], tick: number): number {
  for (let i = chords.length - 1; i >= 0; i--) if (tick >= chords[i].start) return i;
  return 0;
}

/** Convert events to LickNotes: split at bar lines, keep renderable durations, tie same-pitch pieces. */
export function eventsToNotes(events: Ev[], chords: LickChord[]): LickNote[] {
  const notes: LickNote[] = [];
  for (const e of events) {
    let pos = e.start;
    e.pieces.forEach((piece, pi) => {
      const lastPiece = pi === e.pieces.length - 1;
      if (isTupletDur(piece)) {
        // Triplet members are emitted verbatim: never split, merged or tied. Groups are aligned by construction,
        // so they cannot cross a bar line; assert it rather than silently splitting a group.
        if (e.pieces.length > 1) throw new Error(`triplet note at tick ${pos} cannot be tied`);
        if (pos % TPBAR + piece > TPBAR) throw new Error(`triplet note at tick ${pos} crosses a bar line`);
        notes.push({ midi: e.midi, start: pos, dur: piece, chord: chordIndexAt(chords, pos) });
        pos += piece;
        return;
      }
      // split the piece at bar lines, then into renderable values
      const segs: number[] = [];
      let left = piece;
      let p = pos;
      while (left > 0) {
        const toBar = TPBAR - (p % TPBAR);
        const seg = Math.min(left, toBar);
        segs.push(...splitDur(seg));
        p += seg;
        left -= seg;
      }
      let sp = pos;
      segs.forEach((d, si) => {
        const n: LickNote = { midi: e.midi, start: sp, dur: d, chord: chordIndexAt(chords, sp) };
        if (e.midi != null && !(lastPiece && si === segs.length - 1)) n.tie = true;
        notes.push(n);
        sp += d;
      });
      pos += piece;
    });
  }
  return notes;
}

/** Notes that may close a lick: chord tones (1 3 5 6/7) or the 9th. */
export function isEndingTone(midi: number, rootPc: number, q: LickChord['quality']): boolean {
  const rel = mod12(midi - rootPc);
  return CHORDS[q].tones.some(t => mod12(t) === rel) || rel === 2;
}

function nearestMatching(
  from: number, ok: (p: number) => boolean, range: [number, number], cost: (p: number) => number, reach = 4,
): number | null {
  let best: number | null = null;
  let bestC = Infinity;
  for (let p = from - reach; p <= from + reach; p++) {
    if (!ok(p)) continue;
    const outside = Math.max(0, range[0] - p, p - range[1]);
    const c = Math.abs(p - from) * 1.0 + outside * 20 + cost(p);
    if (c < bestC) {
      bestC = c;
      best = p;
    }
  }
  return best;
}

/**
 * Join repair. Mutates and returns `events`.
 *  1. The note sounding at each chord start must be a chord tone or available tension; otherwise it
 *     moves to the nearest one (preferring the smoothest join).
 *  2. If the join into that note is an awkward leap (> 7 semitones), the last one or two notes before
 *     the boundary are turned into a chromatic approach or an enclosure when that smooths the line.
 *  3. The final sounding note is forced onto a chord tone or the 9th of the last chord.
 * Triplet notes (durations off the 16th grid) are never retimed or used as flexible approach notes; only their pitch can be
 * repaired when they sit on a chord start. Returns the number of notes that were altered.
 */
export function fixJoins(events: Ev[], chords: LickChord[], range: [number, number]): number {
  let changed = 0;
  const inRange = (p: number) => p >= range[0] && p <= range[1];
  const startTicks = new Set(chords.map(c => c.start));

  const soundingBefore = (i: number): number => {
    for (let j = i - 1; j >= 0; j--) if (events[j].midi != null) return j;
    return -1;
  };

  chords.forEach((c, ci) => {
    const i = events.findIndex(e => e.start === c.start);
    if (i < 0 || events[i].midi == null) return;
    const prev = soundingBefore(i);
    const prevPitch = prev >= 0 ? (events[prev].midi as number) : null;
    let target = events[i].midi as number;

    if (!isChordToneOrTension(target, c.rootPc, c.quality)) {
      const np = nearestMatching(
        target,
        p => isChordToneOrTension(p, c.rootPc, c.quality),
        range,
        p => (prevPitch == null ? 0 : leapPenalty(p - prevPitch)),
      );
      if (np != null) {
        events[i].midi = np;
        target = np;
        changed++;
      }
    }

    if (ci === 0 || prevPitch == null || prev < 0) return;
    if (Math.abs(target - prevPitch) <= 7) return;

    // Awkward leap: try a chromatic approach / enclosure over the last 1-2 notes.
    const j = prev;
    const j2 = soundingBefore(j);
    const before = j2 >= 0 ? (events[j2].midi as number) : null;
    const flexible = (k: number) => k >= 0 && evDur(events[k]) <= 4 * TICKS_PER_16TH && !isTupletDur(evDur(events[k])) && !startTicks.has(events[k].start) && events[k].midi != null;
    const cost = (a: number | null, b: number, t: number) =>
      (a == null ? 0 : leapPenalty(b - a)) + leapPenalty(t - b);
    const orig = (before == null ? 0 : leapPenalty(prevPitch - before)) + leapPenalty(target - prevPitch);
    type Opt = { j2?: number; j: number };
    const opts: Opt[] = [{ j: target - 1 }, { j: target + 1 }];
    if (flexible(j2)) opts.push({ j2: target + 2, j: target - 1 }, { j2: target - 2, j: target + 1 });
    let best: Opt | null = null;
    let bestC = orig - 1;
    if (flexible(j)) {
      for (const o of opts) {
        if (!inRange(o.j) || (o.j2 != null && !inRange(o.j2))) continue;
        const c1 = o.j2 != null
          ? (j2 >= 0 && j2 - 1 >= 0 && events[j2 - 1].midi != null ? leapPenalty(o.j2 - (events[j2 - 1].midi as number)) : 0)
            + leapPenalty(o.j - o.j2) + leapPenalty(target - o.j)
          : cost(before, o.j, target);
        if (c1 < bestC) {
          bestC = c1;
          best = o;
        }
      }
    }
    if (best) {
      events[j].midi = best.j;
      changed++;
      if (best.j2 != null) {
        events[j2].midi = best.j2;
        changed++;
      }
    }
  });

  // Final sounding note must be a chord tone (1 3 5 6/7) or the 9th of the last chord.
  let last = events.length - 1;
  while (last >= 0 && events[last].midi == null) last--;
  if (last >= 0) {
    const e = events[last];
    const c = chords[chordIndexAt(chords, e.start)];
    if (!isEndingTone(e.midi as number, c.rootPc, c.quality)) {
      const np = nearestMatching(e.midi as number, p => isEndingTone(p, c.rootPc, c.quality), range, () => 0, 6);
      if (np != null) {
        e.midi = np;
        changed++;
      }
    }
  }
  return changed;
}

/* ------------------------------ phrasing pass ------------------------------ */

const EIGHTH = 2 * TICKS_PER_16TH;
const hasTuplet = (e: Ev): boolean => e.pieces.some(isTupletDur);

/** Remove events[i], keeping the cell-start indexes (positions in `events`) consistent. */
function removeEvent(events: Ev[], fragStarts: number[], i: number): void {
  events.splice(i, 1);
  for (let k = 0; k < fragStarts.length; k++) if (fragStarts[k] > i) fragStarts[k]--;
}

/** Index of the nearest sounding event before i, or -1. */
function soundingIdxBefore(events: Ev[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (events[j].midi != null) return j;
  return -1;
}

/**
 * Seam repair: where a cell's first attack repeats the pitch the previous cell just ended on, move the previous
 * cell's last note to a neighbouring scale tone (smoothest option), or, failing that, tie the two together.
 * Never touches triplets; a note on a chord start stays a chord tone or tension.
 */
export function fixSeams(events: Ev[], fragStarts: number[], chords: LickChord[], range: [number, number]): number {
  let changed = 0;
  const startTicks = new Set(chords.map(c => c.start));
  for (let f = 1; f < fragStarts.length; f++) {
    const k = fragStarts[f];
    if (k <= 0 || k >= events.length) continue;
    const cur = events[k];
    const prev = events[k - 1];
    if (cur.midi == null || prev.midi == null || cur.midi !== prev.midi || hasTuplet(cur) || hasTuplet(prev)) continue;
    const before = soundingIdxBefore(events, k - 1);
    const beforeMidi = before >= 0 ? (events[before].midi as number) : null;
    const ch = chords[chordIndexAt(chords, prev.start)];
    const onStart = startTicks.has(prev.start);
    let best: number | null = null;
    let bestC = Infinity;
    for (const d of onStart ? [] : [-2, -1, 1, 2]) {
      const p = (prev.midi as number) + d;
      if (p < range[0] || p > range[1] || p === cur.midi || p === beforeMidi) continue;
      if (!inScale(p, ch.rootPc, ch.quality)) continue;
      const c = (beforeMidi == null ? 0 : leapPenalty(p - beforeMidi)) + leapPenalty((cur.midi as number) - p) + (Math.abs(d) === 1 ? 0 : 0.05);
      if (c < bestC) { bestC = c; best = p; }
    }
    if (best != null) {
      prev.midi = best;
      changed++;
    } else {
      // tie the repeat into the previous note (pieces keep the cell boundary, so a chord start stays a note start)
      prev.pieces.push(...cur.pieces);
      removeEvent(events, fragStarts, k);
      changed++;
      // fragStarts[f] now points at the next event, which still belongs to this cell or the next one
    }
  }
  return changed;
}

export interface PhrasingOptions {
  /** Fractional difficulty level 1..4 (Beginner..Expert). */
  level: number;
}

const ANTIC_BY_LEVEL = [0.07, 0.38, 0.4, 0.33];
const lerp4 = (t: readonly number[], level: number): number => {
  const x = Math.min(3, Math.max(0, level - 1));
  const i = Math.min(2, Math.floor(x));
  return t[i] + (t[i + 1] - t[i]) * (x - i);
};

/**
 * Bebop phrasing pass, run between planning/joining and eventsToNotes. Mutates `events` and `fragStarts`.
 *  1. seams: no same-pitch re-attack where two cells join;
 *  2. anticipations: the chord-tone landing on a chord change is attacked an 8th early and tied across the
 *     change (the preceding note or rest gives up that 8th);
 *  3. pickups: the lick may open with a rest (an 8th, a quarter or, at higher levels, a half note) in place of its first notes.
 * Triplets are never altered and the chord-start / bar-line / range invariants are preserved.
 */
export function phraseEvents(
  rng: Rng, events: Ev[], fragStarts: number[], chords: LickChord[], range: [number, number], opts: PhrasingOptions,
): void {
  fixSeams(events, fragStarts, chords, range);

  const pAnt = lerp4(ANTIC_BY_LEVEL, opts.level);
  for (let ci = 1; ci < chords.length; ci++) {
    const c = chords[ci];
    const p = Math.min(0.95, pAnt * (ci === chords.length - 1 ? 1.2 : 0.85));
    if (!rng.chance(p)) continue;
    const i = events.findIndex(e => e.start === c.start);
    if (i < 1) continue;
    const e = events[i];
    const prev = events[i - 1];
    if (e.midi == null || hasTuplet(e) || hasTuplet(prev)) continue;
    const rel = mod12(e.midi - c.rootPc);
    if (!CHORDS[c.quality].tones.some(t => mod12(t) === rel) && !CHORDS[c.quality].guide.some(g => mod12(g) === rel)) continue;
    const last = prev.pieces[prev.pieces.length - 1];
    if (last < EIGHTH) continue;
    // the pitch sounding just before the anticipation must differ (no re-attack)
    const dropsPrev = last === EIGHTH && prev.pieces.length === 1;
    const lead = dropsPrev ? events[i - 2] : prev;
    if (lead && lead.midi === e.midi) continue;
    if (dropsPrev) removeEvent(events, fragStarts, i - 1);
    else if (last === EIGHTH) prev.pieces.pop();
    else prev.pieces[prev.pieces.length - 1] = last - EIGHTH;
    e.start = c.start - EIGHTH;
    e.pieces = [EIGHTH, ...e.pieces];
  }

  // pickup: replace the first notes with a rest
  const pRest = opts.level < 1.5 ? 0.2 : 0.28;
  if (rng.chance(pRest) && events.length > 2) {
    const firstChordEnd = chords.length > 1 ? chords[1].start : Infinity;
    const opt: [number, number][] = [[EIGHTH, 5], [2 * EIGHTH, 4], [4 * EIGHTH, opts.level >= 2.5 ? 1.5 : 0]];
    const avail = opt.filter(o => o[1] > 0 && o[0] < firstChordEnd);
    const d = avail.length ? rng.weighted(avail, o => o[1])[0] : null;
    if (d != null) {
      let acc = 0;
      let n = 0;
      while (n < events.length && acc < d && !hasTuplet(events[n]) && events[n].start === acc) {
        acc += evDur(events[n]);
        n++;
      }
      if (acc === d && n < events.length && events.slice(n).some(x => x.midi != null)) {
        events.splice(0, n, { midi: null, start: 0, pieces: [d] });
        for (let k = 0; k < fragStarts.length; k++) if (fragStarts[k] >= n) fragStarts[k] -= n - 1; else if (k > 0 && fragStarts[k] > 0) fragStarts[k] = 1;
      }
    }
  }
}
