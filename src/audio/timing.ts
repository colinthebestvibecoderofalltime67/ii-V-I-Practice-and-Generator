import type { Lick } from '../types';
import { TICKS_PER_16TH, TPB } from '../types';
import { findTupletGroups } from '../theory/rhythm';

/** Fraction of a beat taken by the first eighth of a swung pair (triplet feel). */
export const SWING_RATIO = 2 / 3;

/**
 * Swung position (fraction of a beat) of each 16th within the beat: straight 0, 1/4, 1/2, 3/4 map to
 * 0, SR/2, SR, SR + (1 - SR)/2. Ticks between these anchors are interpolated linearly.
 */
const SWING_ANCHORS = [0, SWING_RATIO / 2, SWING_RATIO, SWING_RATIO + (1 - SWING_RATIO) / 2, 1];

/** Position in beats of a tick (12 per beat), with optional swing applied to the off-beat eighths/sixteenths. */
export function tickToBeats(tick: number, swing: boolean): number {
  if (!swing) return tick / TPB;
  const beat = Math.floor(tick / TPB);
  const r = tick - beat * TPB;
  const k = Math.floor(r / TICKS_PER_16TH);
  const rem = r - k * TICKS_PER_16TH;
  const off = rem === 0
    ? SWING_ANCHORS[k]
    : SWING_ANCHORS[k] + (SWING_ANCHORS[k + 1] - SWING_ANCHORS[k]) * (rem / TICKS_PER_16TH);
  return beat + off;
}

/** Duration in beats of the span [tick, tick+dur) with swing applied to both ends. */
export function spanBeats(tick: number, dur: number, swing: boolean): number {
  return tickToBeats(tick + dur, swing) - tickToBeats(tick, swing);
}

export interface FeelOptions { swing: boolean; straight16: boolean }
/** Maps a tick to a position in beats. */
export type Timeline = (tick: number) => number;

/**
 * Per-beat swing feel, decided from the lick's note onsets/offsets (rests included):
 *  - swing off: linear.
 *  - beats touching a triplet (off-grid boundary, or inside a triplet group): linear (exact thirds).
 *  - beats with 16th boundaries (offset 3 or 9): linear if `straight16`, else the legacy swung-16th anchors.
 *  - other beats (on-beat / offset-6 events only): swung eighths (offset 6 -> SWING_RATIO).
 * Beat starts always map to integer beats, so the mapping is continuous and monotonic.
 */
export function makeTimeline(
  notes: readonly { start: number; dur: number; midi?: number | null }[],
  opts: FeelOptions,
): Timeline {
  if (!opts.swing) return tick => tick / TPB;
  const linear: boolean[] = [];
  const has16: boolean[] = [];
  const mark = (arr: boolean[], b: number): void => { while (arr.length <= b) arr.push(false); arr[b] = true; };
  for (const n of notes) {
    for (const t of [n.start, n.start + n.dur]) {
      const r = ((t % TPB) + TPB) % TPB;
      const b = Math.floor(t / TPB);
      if (r % TICKS_PER_16TH !== 0) mark(linear, b);
      else if (r === TICKS_PER_16TH || r === 3 * TICKS_PER_16TH) mark(has16, b);
    }
  }
  for (const g of findTupletGroups(notes).groups) {
    for (let b = Math.floor(g.start / TPB); b <= Math.floor((g.end - 1) / TPB); b++) mark(linear, b);
  }
  return tick => {
    const b = Math.floor(tick / TPB);
    if (linear[b] || (opts.straight16 && has16[b])) return tick / TPB;
    return tickToBeats(tick, true);
  };
}

/** Duration in beats of [tick, tick+dur) under a timeline. */
export function timelineSpan(tl: Timeline, tick: number, dur: number): number {
  return tl(tick + dur) - tl(tick);
}

export interface SoundingNote {
  midi: number;
  start: number; // ticks
  dur: number; // ticks, tied notes merged
  /** Indices into lick.notes covered by this sound. */
  indices: number[];
}

/** Non-rest notes with tied notes merged into one sound. */
export function soundingNotes(lick: Pick<Lick, 'notes'>): SoundingNote[] {
  const out: SoundingNote[] = [];
  let open: SoundingNote | null = null; // sound that is still tied forward
  lick.notes.forEach((n, i) => {
    if (n.midi == null) { open = null; return; }
    if (open && open.midi === n.midi) {
      open.dur += n.dur;
      open.indices.push(i);
    } else {
      open = { midi: n.midi, start: n.start, dur: n.dur, indices: [i] };
      out.push(open);
    }
    if (!n.tie) open = null;
  });
  return out;
}
