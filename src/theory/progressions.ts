import type { LengthId, LickChord, ProgressionDef } from '../types';
import { TPB, TPBAR } from '../types';
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
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 7, quality: 'dom7', roman: 'V7', fn: 'primaryV' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
  },
  {
    id: 'major-251-alt', name: 'Major ii–V–I (altered V)', mode: 'major', complexity: 0.35, minTier: 3,
    description: 'Altered dominant tension (b9, #9, b13) resolving to major.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 7, quality: 'dom7alt', roman: 'V7alt', fn: 'altV' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
  },
  {
    id: 'minor-251', name: 'Minor iiø–V–i', mode: 'minor', complexity: 0.5, minTier: 2,
    description: 'Half-diminished ii, altered V, minor tonic: Dm7♭5 – G7alt – Cm6.',
    slots: [
      { degree: 2, quality: 'm7b5', roman: 'iiø7', fn: 'predominant' },
      { degree: 7, quality: 'dom7alt', roman: 'V7alt', fn: 'altV' },
      { degree: 0, quality: 'm6', roman: 'i6', fn: 'tonic' },
    ],
  },
  {
    id: 'tritone-251', name: 'Tritone sub ii–♭II–I', mode: 'major', complexity: 0.4, minTier: 2,
    description: 'The V is replaced by the dominant a tritone away: Dm7 – Db7 – Cmaj7.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 1, quality: 'dom7', roman: '♭II7', fn: 'lydianDom' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
  },
  {
    id: 'backdoor-251', name: 'Backdoor iv–♭VII–I', mode: 'major', complexity: 0.3, minTier: 2,
    description: 'Borrowed from the parallel minor: Fm7 – Bb7 – Cmaj7.',
    slots: [
      { degree: 5, quality: 'm7', roman: 'iv7', fn: 'predominant' },
      { degree: 10, quality: 'dom7', roman: '♭VII7', fn: 'lydianDom' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
  },
  {
    id: 'turnaround', name: 'Turnaround I–VI–ii–V', mode: 'major', complexity: 0.25, minTier: 2,
    description: 'The classic turnaround: Cmaj7 – A7 – Dm7 – G7 – Cmaj7 in C. The VI7 pulls to ii and takes ♭9 and ♭13 colour.',
    slots: [
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
      { degree: 9, quality: 'dom7', roman: 'VI7', fn: 'secondaryDom' },
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 7, quality: 'dom7', roman: 'V7', fn: 'primaryV' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
    rhythm: { short: [2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4], long: [4, 4, 4, 4, 8] },
  },
  {
    id: 'chain-36251', name: 'iii–VI–ii–V–I', mode: 'major', complexity: 0.3, minTier: 2,
    description: 'The circle of fifths home: Em7 – A7 – Dm7 – G7 – Cmaj7 in C.',
    slots: [
      { degree: 4, quality: 'm7', roman: 'iii7', fn: 'tonic' },
      { degree: 9, quality: 'dom7', roman: 'VI7', fn: 'secondaryDom' },
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 7, quality: 'dom7', roman: 'V7', fn: 'primaryV' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
    rhythm: { short: [2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4], long: [4, 4, 4, 4, 8] },
  },
  {
    id: 'coltrane', name: 'Coltrane ii–Vs', mode: 'major', complexity: 0.8, minTier: 3,
    description: 'Major-third cycle over a ii–V–I: Dm7 – E♭7 – A♭maj7 – B7 – Emaj7 – G7 – Cmaj7 in C. Each dominant resolves to a new tonic.',
    slots: [
      { degree: 2, quality: 'm7', roman: 'ii7', fn: 'predominant' },
      { degree: 3, quality: 'dom7', roman: '♭III7', fn: 'primaryV' },
      { degree: 8, quality: 'maj7', roman: '♭VImaj7', fn: 'tonic' },
      { degree: 11, quality: 'dom7', roman: 'VII7', fn: 'primaryV' },
      { degree: 4, quality: 'maj7', roman: 'IIImaj7', fn: 'tonic' },
      { degree: 7, quality: 'dom7', roman: 'V7', fn: 'primaryV' },
      { degree: 0, quality: 'maj7', roman: 'Imaj7', fn: 'tonic' },
    ],
    rhythm: { short: [2, 2, 2, 2, 2, 2, 4], standard: [4, 4, 4, 4, 4, 4, 4], long: [4, 4, 4, 4, 4, 4, 8] },
  },
];

/** Default beats per slot, for progressions of three chords (ii-V-I and its variants). Other progressions set `rhythm`. */
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
  const beats = slotBeats(def, length);
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

/** Beats of each slot of a progression at a length. */
export function slotBeats(def: ProgressionDef, length: LengthId): number[] {
  const beats = def.rhythm?.[length] ?? LENGTHS[length].beats;
  if (beats.length !== def.slots.length) throw new Error(`progression ${def.id}: ${beats.length} slot lengths for ${def.slots.length} chords`);
  return beats;
}

export const totalTicks = (def: ProgressionDef, length: LengthId): number => slotBeats(def, length).reduce((a, b) => a + b, 0) * TPB;

/** Whole bars of a progression at a length. */
export const lengthBars = (def: ProgressionDef, length: LengthId): number => totalTicks(def, length) / TPBAR;

/** "Short (3 bars)": the length's name plus the real bar count for this progression. */
export function lengthLabel(def: ProgressionDef, length: LengthId): string {
  const n = lengthBars(def, length);
  return `${LENGTHS[length].label.replace(/ \(.*\)/, '')} (${n} bar${n === 1 ? '' : 's'})`;
}
