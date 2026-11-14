import { RENDERABLE_DURS, TPB, TPBAR } from '../types';

const DESC = [...RENDERABLE_DURS].sort((a, b) => b - a);

/**
 * Split a duration (ticks) into RENDERABLE_DURS pieces, greedy largest first.
 * Throws if the remainder cannot be expressed (e.g. a duration that is not a multiple of a 16th).
 */
export function splitDur(d: number): number[] {
  if (!Number.isInteger(d) || d < 0) throw new Error(`splitDur: invalid duration ${d}`);
  const out: number[] = [];
  let left = d;
  while (left > 0) {
    const p = DESC.find(x => x <= left);
    if (p === undefined) throw new Error(`splitDur: cannot express ${left} ticks (of ${d}) with renderable durations`);
    out.push(p);
    left -= p;
  }
  return out;
}

/** Beat index (0-based, quarter-note beats) containing a tick. */
export const beatOf = (tick: number): number => Math.floor(tick / TPB);

/** Bar index (0-based, 4/4) containing a tick. */
export const barOf = (tick: number): number => Math.floor(tick / TPBAR);

/* ---------------- triplets (shared contract for generator, scoring, audio and notation) ---------------- */

/**
 * Triplet kinds. A triplet group puts 3 equal units in the time of 2 normal ones:
 *  - 't16' 16th-note triplet: unit 2 ticks, group spans 6 (an 8th), starts on an 8th (tick % 6 === 0)
 *  - 't8'  8th-note triplet:  unit 4 ticks, group spans 12 (a beat), starts on a beat (tick % 12 === 0)
 *  - 'tq'  quarter triplet:   unit 8 ticks, group spans 24 (two beats), starts on beat 1 or 3 (tick % 24 === 0)
 * Inside a group each note/rest lasts 1 or 2 units. Durations that are not multiples of a 16th (3 ticks) only
 * ever occur inside triplet groups, so groups are found by walking from a grid point until the running
 * position is back on the 16th grid.
 */
export type TupletKind = 't16' | 't8' | 'tq';

export const TUPLET_SPEC: Record<TupletKind, { unit: number; span: number }> = {
  t16: { unit: 2, span: 6 },
  t8: { unit: 4, span: 12 },
  tq: { unit: 8, span: 24 },
};

const KIND_BY_SPAN: Record<number, TupletKind> = { 6: 't16', 12: 't8', 24: 'tq' };

/** True if a duration can only belong inside a triplet group (not on the 16th grid). */
export const isTupletDur = (dur: number): boolean => dur % 3 !== 0;

export interface TupletGroup {
  kind: TupletKind;
  /** Tick where the group starts / ends (end exclusive). */
  start: number;
  end: number;
  /** Index range into the input array (inclusive). */
  first: number;
  last: number;
}

/**
 * Find triplet groups in a time-ordered, contiguous list of notes/rests.
 * Returns { groups, errors }; errors describe malformed groups (wrong span, misaligned start, bad unit).
 */
export function findTupletGroups(items: readonly { start: number; dur: number }[]): { groups: TupletGroup[]; errors: string[] } {
  const groups: TupletGroup[] = [];
  const errors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!isTupletDur(items[i].dur)) continue;
    const start = items[i].start;
    let j = i;
    let pos = start + items[i].dur;
    while (pos % 3 !== 0 && j + 1 < items.length) { j++; pos += items[j].dur; }
    const span = pos - start;
    const kind = KIND_BY_SPAN[span];
    if (pos % 3 !== 0) { errors.push(`unterminated triplet group at tick ${start}`); break; }
    if (!kind) { errors.push(`triplet group at tick ${start} spans ${span} ticks (must be 6, 12 or 24)`); i = j; continue; }
    const { unit } = TUPLET_SPEC[kind];
    if (start % span !== 0) errors.push(`${kind} group at tick ${start} is not aligned to ${span}`);
    for (let k = i; k <= j; k++) {
      const d = items[k].dur;
      if (d !== unit && d !== 2 * unit) errors.push(`${kind} group at tick ${start}: note ${k} lasts ${d} ticks (unit ${unit})`);
    }
    groups.push({ kind, start, end: pos, first: i, last: j });
    i = j;
  }
  return { groups, errors };
}

/** Written (displayed) value of a note inside a triplet group, in normal ticks: 3 in the time of 2 => x 3/2. */
export const tupletDisplayDur = (dur: number): number => (dur * 3) / 2;

/**
 * The chord a note should be heard against. An anticipation (a note attacked less than a beat before a chord
 * change and tied across it) belongs to the chord it arrives on; every other note belongs to its own chord.
 * Spelling, Analyze labels and difficulty scoring all use this, so an anticipated 3rd is a 3rd, not a chromatic note.
 */
export function judgedChord(notes: readonly { midi: number | null; start: number; tie?: boolean; chord: number }[], i: number): number {
  const n = notes[i];
  if (n.midi == null) return n.chord;
  let j = i;
  while (notes[j].tie && notes[j + 1] && notes[j + 1].midi === n.midi) {
    j++;
    if (notes[j].chord !== n.chord) return notes[j].start - n.start < TPB ? notes[j].chord : n.chord;
  }
  return n.chord;
}
