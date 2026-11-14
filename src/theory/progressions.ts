import type { LengthId, LickChord, ProgressionDef } from '../types';
import { TPB } from '../types';
import { mod12 } from './pitch';
import { chordSymbolText, spellChordRoot } from './spell';

/**
 * Registry of progressions. To add one, append an entry here; if it uses a new chord
 * quality, add that quality to theory/chords.ts and fragments for it in src/fragments/lib.
 */
export const PROGRESSIONS: ProgressionDef[] = [
  {
    id: 'major-251', name: 'Major ii–V–I', mode: 'major', complexity: 0, minTier: 1,
    description: 'The classic: Dm7 – G7 – Cmaj7 in C.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7' },
      { degree: 7, quality: 'dom7', roman: 'V7' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7' },
    ],
  },
  {
    id: 'major-251-alt', name: 'Major ii–V–I (altered V)', mode: 'major', complexity: 0.35, minTier: 3,
    description: 'Altered dominant tension (b9, #9, b13) resolving to major.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7' },
      { degree: 7, quality: 'dom7alt', roman: 'V7alt' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7' },
    ],
  },
  {
    id: 'minor-251', name: 'Minor iiø–V–i', mode: 'minor', complexity: 0.5, minTier: 2,
    description: 'Half-diminished ii, altered V, minor tonic: Dm7♭5 – G7alt – Cm6.',
    slots: [
      { degree: 2, quality: 'm7b5', roman: 'iiø7' },
      { degree: 7, quality: 'dom7alt', roman: 'V7alt' },
      { degree: 0, quality: 'm6', roman: 'i6' },
    ],
  },
  {
    id: 'tritone-251', name: 'Tritone sub ii–♭II–I', mode: 'major', complexity: 0.4, minTier: 2,
    description: 'The V is replaced by the dominant a tritone away: Dm7 – Db7 – Cmaj7.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7' },
      { degree: 1, quality: 'dom7', roman: '♭II7' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7' },
    ],
  },
  {
    id: 'backdoor-251', name: 'Backdoor iv–♭VII–I', mode: 'major', complexity: 0.3, minTier: 2,
    description: 'Borrowed from the parallel minor: Fm7 – Bb7 – Cmaj7.',
    slots: [
      { degree: 5, quality: 'm7', roman: 'iv7' },
      { degree: 10, quality: 'dom7', roman: '♭VII7' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7' },
    ],
  },
];

export const LENGTHS: Record<LengthId, { label: string; beats: number[] }> = {
  short: { label: 'Short (2 bars)', beats: [2, 2, 4] },
  standard: { label: 'Standard (3 bars)', beats: [4, 4, 4] },
  long: { label: 'Long (6 bars)', beats: [8, 8, 8] },
};

export function getProgression(id: string): ProgressionDef {
  const p = PROGRESSIONS.find(p => p.id === id);
  if (!p) throw new Error(`Unknown progression: ${id}`);
  return p;
}

/** Concrete chords (concert) for a progression, length and tonic. Times in ticks. */
export function expandProgression(def: ProgressionDef, length: LengthId, keyPc: number): LickChord[] {
  const beats = LENGTHS[length].beats;
  let start = 0;
  return def.slots.map((s, i) => {
    const rootPc = mod12(keyPc + s.degree);
    const dur = beats[i] * TPB;
    const c: LickChord = {
      rootPc,
      quality: s.quality,
      symbol: chordSymbolText(spellChordRoot(rootPc, s.quality, keyPc, def.mode), s.quality),
      start,
      dur,
    };
    start += dur;
    return c;
  });
}

export const totalTicks = (length: LengthId): number => LENGTHS[length].beats.reduce((a, b) => a + b, 0) * TPB;
