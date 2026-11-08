import type { Lick } from '../types';

/** Fraction of a beat taken by the first eighth of a swung pair (triplet feel). */
export const SWING_RATIO = 2 / 3;

/** Position in beats of a tick (16th note), with optional swing applied to the off-beat eighths/sixteenths. */
export function tickToBeats(tick: number, swing: boolean): number {
  if (!swing) return tick / 4;
  const beat = Math.floor(tick / 4);
  const r = tick - beat * 4;
  const off = r === 0 ? 0 : r === 1 ? SWING_RATIO / 2 : r === 2 ? SWING_RATIO : SWING_RATIO + (1 - SWING_RATIO) / 2;
  return beat + off;
}

/** Duration in beats of the span [tick, tick+dur) with swing applied to both ends. */
export function spanBeats(tick: number, dur: number, swing: boolean): number {
  return tickToBeats(tick + dur, swing) - tickToBeats(tick, swing);
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
