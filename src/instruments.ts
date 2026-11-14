import type { Instrument, Tier } from './types';

/** Written ranges are comfortable (not extreme) ranges. transpose = written − concert. */
export const INSTRUMENTS: Instrument[] = [
  { id: 'alto', name: 'Alto sax (E♭)', transpose: 9, clef: 'treble', range: [58, 90], timbre: 'reed', keyLabel: 'Eb' },
  { id: 'tenor', name: 'Tenor sax (B♭)', transpose: 14, clef: 'treble', range: [58, 90], timbre: 'reed', keyLabel: 'Bb' },
  { id: 'soprano', name: 'Soprano sax (B♭)', transpose: 2, clef: 'treble', range: [58, 90], timbre: 'reed', keyLabel: 'Bb' },
  { id: 'bari', name: 'Baritone sax (E♭)', transpose: 21, clef: 'treble', range: [58, 90], timbre: 'reed', keyLabel: 'Eb' },
  { id: 'trumpet', name: 'Trumpet (B♭)', transpose: 2, clef: 'treble', range: [54, 86], timbre: 'brass', keyLabel: 'Bb' },
  { id: 'clarinet', name: 'Clarinet (B♭)', transpose: 2, clef: 'treble', range: [52, 89], timbre: 'reed', keyLabel: 'Bb' },
  { id: 'horn', name: 'French horn (F)', transpose: 7, clef: 'treble', range: [53, 84], timbre: 'brass', keyLabel: 'F' },
  { id: 'flute', name: 'Flute (C)', transpose: 0, clef: 'treble', range: [60, 93], timbre: 'flute', keyLabel: 'C' },
  { id: 'violin', name: 'Violin (C)', transpose: 0, clef: 'treble', range: [55, 93], timbre: 'string', keyLabel: 'C' },
  { id: 'piano', name: 'Piano / C instrument (treble)', transpose: 0, clef: 'treble', range: [55, 89], timbre: 'keys', keyLabel: 'C' },
  {
    id: 'guitar', name: 'Guitar (tab)', transpose: 12, clef: 'treble', range: [52, 86], timbre: 'pluck', keyLabel: 'C',
    tab: { tuning: [52, 57, 62, 67, 71, 76], frets: 17 },
  },
  { id: 'trombone', name: 'Trombone (bass clef)', transpose: 0, clef: 'bass', range: [40, 72], timbre: 'brass', keyLabel: 'C' },
  {
    id: 'bass', name: 'Bass (bass clef + tab)', transpose: 12, clef: 'bass', range: [40, 67], timbre: 'pluck', keyLabel: 'C',
    tab: { tuning: [40, 45, 50, 55], frets: 15 },
  },
  { id: 'cello', name: 'Cello (bass clef)', transpose: 0, clef: 'bass', range: [43, 72], timbre: 'string', keyLabel: 'C' },
  { id: 'piano-lh', name: 'Piano left hand / C bass clef', transpose: 0, clef: 'bass', range: [40, 67], timbre: 'keys', keyLabel: 'C' },
];

export function getInstrument(id: string): Instrument {
  return INSTRUMENTS.find(i => i.id === id) ?? INSTRUMENTS[0];
}

/** Comfortable range converted to CONCERT pitch (what the generator needs). */
export function concertRange(inst: Instrument): [number, number] {
  return [inst.range[0] - inst.transpose, inst.range[1] - inst.transpose];
}

/**
 * Comfortable WRITTEN tessitura by difficulty tier. Beginner stays in the middle of the horn, Intermediate trims
 * the extremes less, Advanced only the very top, Expert may use the whole comfortable range. Narrow instruments
 * (bass, low brass) are trimmed less so a lick always fits.
 */
const TRIM: Record<number, [number, number]> = { 1: [4, 6], 2: [2, 3], 3: [0, 1], 4: [0, 0] };
/** Explicit WRITTEN ranges per instrument and tier (1..3); anything not listed uses TRIM. */
const LEVEL_RANGE: Record<string, Partial<Record<1 | 2 | 3, [number, number]>>> = {
  // alto/tenor: avoid low Bb-C# (58-61) and written C#6+ at Beginner; no altissimo-ish E6/F6 at Intermediate
  alto: { 1: [62, 84], 2: [60, 86], 3: [58, 89] },
  tenor: { 1: [62, 84], 2: [60, 86], 3: [58, 89] },
  trumpet: { 1: [57, 79], 2: [55, 84], 3: [54, 85] },
};

export function rangeForLevel(inst: Instrument, tier: Tier): [number, number] {
  const [lo, hi] = inst.range;
  if (tier >= 4) return [lo, hi];
  const explicit = LEVEL_RANGE[inst.id]?.[tier as 1 | 2 | 3];
  if (explicit) return [Math.max(lo, explicit[0]), Math.min(hi, explicit[1])];
  const [tl, th] = TRIM[tier];
  const width = hi - lo;
  // keep at least ~20 semitones so the generator always has room
  const keep = Math.max(width - tl - th, 20);
  const slack = width - keep;
  const t = tl + th || 1;
  const a = Math.min(lo + Math.round((slack * tl) / t), hi - keep);
  return [a, a + keep];
}

/** Comfort range in CONCERT pitch (pass as GenerateOptions.comfortRange). */
export function concertRangeForLevel(inst: Instrument, tier: Tier): [number, number] {
  const [a, b] = rangeForLevel(inst, tier);
  return [a - inst.transpose, b - inst.transpose];
}
