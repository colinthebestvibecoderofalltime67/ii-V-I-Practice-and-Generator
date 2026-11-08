/**
 * Shared data model. Every module builds against these types.
 *
 * TIME UNIT: all positions and durations are in SIXTEENTH NOTES ("ticks").
 *   4 ticks = 1 beat (quarter note), 16 ticks = one 4/4 bar.
 *
 * PITCH: all lick pitches are CONCERT (sounding) MIDI numbers. Written pitch for a
 * transposing instrument = concert + instrument.transpose (see src/instruments.ts).
 */

export type ChordQualityId = 'm7' | 'm7b5' | 'dom7' | 'dom7alt' | 'maj7' | 'm6' | 'mMaj7';

export type Mode = 'major' | 'minor';

export type LengthId = 'short' | 'standard' | 'long';

/** 1 Beginner, 2 Intermediate, 3 Advanced, 4 Expert */
export type Tier = 1 | 2 | 3 | 4;

export const TIER_NAMES: Record<Tier, string> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced',
  4: 'Expert',
};

/** Durations (in ticks) that notation can draw as a single note: 16th, 8th, dotted 8th, quarter, dotted quarter, half, dotted half, whole. */
export const RENDERABLE_DURS = [1, 2, 3, 4, 6, 8, 12, 16] as const;

/* ---------------- fragments (the generator's raw material) ---------------- */

export interface FragNote {
  /** Semitones relative to the chord root (0 = root, 4 = maj 3rd, 10 = b7, 14 = 9th, -1 = maj 7th below root...). null = rest. */
  rel: number | null;
  /** Duration in ticks (sixteenths). Must be one of RENDERABLE_DURS. */
  dur: number;
  /** True if this note is tied to the next note (which must have the same rel). */
  tie?: boolean;
}

export type FragTag =
  | 'arpeggio'
  | 'scale'
  | 'enclosure'
  | 'chromatic'
  | 'bebop'
  | 'altered'
  | 'pentatonic'
  | 'guide-tone'
  | 'sequence'
  | 'motif';

export interface Fragment {
  /** Unique, stable id, e.g. "m7-proto-03a" or "dom7alt-orig-12". */
  id: string;
  /** Chord qualities this fragment works over (relative to that chord's root). */
  qualities: ChordQualityId[];
  /** Length in beats. Sum of note durs must equal beats * 4 ticks. */
  beats: 2 | 4;
  notes: FragNote[];
  tags: FragTag[];
  /** Author's difficulty estimate. The real label always comes from difficulty/score.ts. */
  level: Tier;
  /** True if it ends with a sustained resolution and can close a lick (used for the final I chord). */
  ending?: boolean;
  source: 'prototype' | 'original';
}

/* ---------------- progressions ---------------- */

export interface ProgressionSlot {
  /** Root of this chord in semitones above the tonic (ii = 2, V = 7, bII = 1, iv = 5, bVII = 10, I = 0). */
  degree: number;
  quality: ChordQualityId;
  /** Roman numeral label for UI, e.g. "ii", "V7", "bII7". */
  roman: string;
}

export interface ProgressionDef {
  id: string;
  name: string;
  mode: Mode;
  /** 0..1 harmonic complexity, fed into the difficulty score. */
  complexity: number;
  /** Lowest tier this progression is recommended for (UI hint only, never a hard block). */
  minTier: Tier;
  description: string;
  slots: ProgressionSlot[];
}

/* ---------------- a generated lick ---------------- */

export interface LickChord {
  rootPc: number; // 0..11 concert
  quality: ChordQualityId;
  /** Chord symbol spelled for the concert key, e.g. "Dm7", "G7", "Db7", "Cmaj7". */
  symbol: string;
  start: number; // ticks
  dur: number; // ticks
}

export interface LickNote {
  /** Concert MIDI pitch, null = rest. */
  midi: number | null;
  start: number; // ticks from lick start
  dur: number; // ticks; one of RENDERABLE_DURS; never crosses a bar line
  /** Tied to the next note (same midi). */
  tie?: boolean;
  /** Index into Lick.chords of the chord sounding under this note. */
  chord: number;
}

export interface DifficultyFeature {
  id: string;
  /** Human label for UI chips, e.g. "16th-note runs", "Altered tensions". */
  label: string;
  /** Raw measured value (feature-specific units). */
  value: number;
  /** Points this feature contributed to the 0..100 score. */
  points: number;
}

export interface DifficultyResult {
  score: number; // 0..100
  tier: Tier;
  features: DifficultyFeature[]; // sorted by points, descending
}

export interface Lick {
  version: 1;
  id: string;
  seed: number;
  progressionId: string;
  length: LengthId;
  /** Concert pitch class of the tonic (I or i chord). */
  keyPc: number;
  mode: Mode;
  /** The tier the user asked for. */
  requestedTier: Tier;
  chords: LickChord[];
  notes: LickNote[];
  totalTicks: number;
  fragmentIds: string[];
  difficulty: DifficultyResult;
  createdAt: number;
}

/* ---------------- instruments ---------------- */

export type Clef = 'treble' | 'bass';
export type Timbre = 'reed' | 'brass' | 'flute' | 'string' | 'pluck' | 'keys';

export interface Instrument {
  id: string;
  name: string;
  /** Semitones WRITTEN above CONCERT (alto sax 9, tenor sax 14, trumpet 2, guitar 12, bass 12). */
  transpose: number;
  clef: Clef;
  /** Comfortable WRITTEN range [low, high] in MIDI. */
  range: [number, number];
  timbre: Timbre;
  /** Guitar-style tab: open-string WRITTEN MIDI pitches, low string first. */
  tab?: { tuning: number[]; frets: number };
  /** Key used for the transposition label in UI ("Bb", "Eb", "F", "C"). */
  keyLabel: string;
}
