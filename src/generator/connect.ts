import type { LickChord, LickNote } from '../types';
import { TICKS_PER_16TH, TPBAR } from '../types';
import { splitDur } from '../theory/rhythm';
import { CHORDS, isChordToneOrTension } from '../theory/chords';
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
 * Returns the number of notes that were altered.
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
    const flexible = (k: number) => k >= 0 && evDur(events[k]) <= 4 * TICKS_PER_16TH && !startTicks.has(events[k].start) && events[k].midi != null;
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
