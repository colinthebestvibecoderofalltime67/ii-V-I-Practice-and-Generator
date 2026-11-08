import type { ChordQualityId } from '../types';
import { mod12 } from './pitch';

export interface ChordQuality {
  id: ChordQualityId;
  /** Suffix appended to the root name for display, e.g. "m7", "7", "maj7", "m7♭5". */
  suffix: string;
  /** Chord tones in semitones above the root. */
  tones: number[];
  /** Guide tones (3rd and 7th or 6th). */
  guide: number[];
  /** Available tensions (may be > 12), e.g. 14 = 9th, 13 = b9. */
  tensions: number[];
  /** Parent scale, semitones above the root. */
  scale: number[];
  /** Rootless 4-note voicing, semitones above the root (comping places it in register). */
  rootless: number[];
  /** Shell / block voicing (root included), semitones above the root. */
  block: number[];
}

export const CHORDS: Record<ChordQualityId, ChordQuality> = {
  m7: {
    id: 'm7', suffix: 'm7',
    tones: [0, 3, 7, 10], guide: [3, 10], tensions: [14, 17],
    scale: [0, 2, 3, 5, 7, 9, 10],
    rootless: [3, 7, 10, 14], block: [0, 10, 15, 19],
  },
  m7b5: {
    id: 'm7b5', suffix: 'm7♭5',
    tones: [0, 3, 6, 10], guide: [3, 10], tensions: [17, 20],
    scale: [0, 1, 3, 5, 6, 8, 10],
    rootless: [3, 6, 10, 17], block: [0, 10, 15, 18],
  },
  dom7: {
    id: 'dom7', suffix: '7',
    tones: [0, 4, 7, 10], guide: [4, 10], tensions: [14, 21],
    scale: [0, 2, 4, 5, 7, 9, 10],
    rootless: [4, 9, 10, 14], block: [0, 10, 16, 21],
  },
  dom7alt: {
    id: 'dom7alt', suffix: '7alt',
    tones: [0, 4, 10], guide: [4, 10], tensions: [13, 15, 18, 20],
    scale: [0, 1, 3, 4, 6, 8, 10],
    rootless: [4, 10, 15, 20], block: [0, 10, 16, 20],
  },
  maj7: {
    id: 'maj7', suffix: 'maj7',
    tones: [0, 4, 7, 11], guide: [4, 11], tensions: [14, 9, 18],
    scale: [0, 2, 4, 5, 7, 9, 11],
    rootless: [4, 7, 11, 14], block: [0, 11, 16, 19],
  },
  m6: {
    id: 'm6', suffix: 'm6',
    tones: [0, 3, 7, 9], guide: [3, 9], tensions: [14, 11],
    scale: [0, 2, 3, 5, 7, 9, 11],
    rootless: [3, 7, 9, 14], block: [0, 9, 15, 19],
  },
  mMaj7: {
    id: 'mMaj7', suffix: 'm(maj7)',
    tones: [0, 3, 7, 11], guide: [3, 11], tensions: [14, 9],
    scale: [0, 2, 3, 5, 7, 9, 11],
    rootless: [3, 7, 11, 14], block: [0, 11, 15, 19],
  },
};

/** True if the pitch is a chord tone of a chord on rootPc. */
export function isChordTone(midi: number, rootPc: number, q: ChordQualityId): boolean {
  return CHORDS[q].tones.some(t => mod12(t) === mod12(midi - rootPc));
}

/** True if the pitch is a chord tone OR an available tension. */
export function isChordToneOrTension(midi: number, rootPc: number, q: ChordQualityId): boolean {
  const c = CHORDS[q];
  return [...c.tones, ...c.tensions].some(t => mod12(t) === mod12(midi - rootPc));
}

/** True if the pitch is in the chord's parent scale. */
export function inScale(midi: number, rootPc: number, q: ChordQualityId): boolean {
  return CHORDS[q].scale.some(t => mod12(t) === mod12(midi - rootPc));
}

/** Altered dominant tensions measured from the chord root: b9, #9, #11, b13. */
export const ALTERED_RELS = [1, 3, 6, 8];
