/**
 * Shared data model. Every module builds against these types.
 *
 * TIME UNIT: all positions and durations are integer "ticks" on a 12-per-beat grid, so that
 * straight subdivisions AND triplets land on whole numbers:
 *   12 ticks = 1 beat (quarter note), 48 ticks = one 4/4 bar.
 *   16th = 3, 8th = 6, dotted 8th = 9, quarter = 12, dotted quarter = 18, half = 24, dotted half = 36, whole = 48.
 *   (8th-triplet = 4, quarter-triplet = 8, 16th-triplet = 2; see TRIPLET_DURS.)
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

/** Ticks per beat (quarter note). */
export const TPB = 12;
/** Ticks per 4/4 bar. */
export const TPBAR = 48;
/** Ticks in one sixteenth note (the unit fragments are authored in; see src/fragments/index.ts). */
export const TICKS_PER_16TH = 3;

/** Durations (in ticks) that notation can draw as a single note: 16th, 8th, dotted 8th, quarter, dotted quarter, half, dotted half, whole. */
export const RENDERABLE_DURS = [3, 6, 9, 12, 18, 24, 36, 48] as const;

/** Triplet durations in ticks: 16th-triplet, 8th-triplet, quarter-triplet. Exported for the upcoming triplet work; not used yet. */
export const TRIPLET_DURS = [2, 4, 8] as const;

/* ---------------- fragments (the generator's raw material) ---------------- */

export interface FragNote {
  /** Semitones relative to the chord root (0 = root, 4 = maj 3rd, 10 = b7, 14 = 9th, -1 = maj 7th below root...). null = rest. */
  rel: number | null;
  /** Duration in ticks (TPB = 12 per beat). Must be one of RENDERABLE_DURS. */
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
  /** Length in beats. Sum of note durs must equal beats * TPB ticks. */
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

/**
 * What a chord does in its progression. Colours the generator's cell choice (generate.ts chordRoles), the difficulty
 * score's Lydian-dominant detection and the musicality metrics; never used to decide where a lick ends (that is the last slot).
 *  tonic: I, iii, or a local tonic inside a longer chain (maj7 / m7);
 *  predominant: ii, iv (the chord that sets up the dominant);
 *  primaryV: a plain dominant that resolves to the next chord (Mixolydian first);
 *  secondaryDom: a dominant of a non-tonic chord (VI7 -> ii): Mixolydian with b9 / b13 colour allowed;
 *  lydianDom: tritone-sub bII7 or backdoor bVII7 (Lydian dominant: #11, no natural 11, no altered tensions);
 *  altV: a dom7alt dominant (altered scale).
 */
export type SlotFn = 'tonic' | 'predominant' | 'primaryV' | 'secondaryDom' | 'lydianDom' | 'altV';

export interface ProgressionSlot {
  /** Root of this chord in semitones above the tonic (ii = 2, V = 7, bII = 1, iv = 5, bVII = 10, I = 0). */
  degree: number;
  quality: ChordQualityId;
  /** Roman numeral label for UI, e.g. "ii", "V7", "bII7". */
  roman: string;
  fn: SlotFn;
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
  /**
   * Beats per slot for each length (one entry per slot; every length must sum to whole bars, i.e. a multiple of 4,
   * and no slot may be shorter than 2 beats). Default: LENGTHS in theory/progressions.ts, which only fits three slots.
   * The last slot holds the lick's ending, so it should be at least 4 beats.
   */
  rhythm?: Record<LengthId, number[]>;
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
  /** 1 = legacy 16th-note ticks (4/beat); migrated to 2 on load (storage/migrateLick). 2 = 12 ticks per beat. */
  version: 1 | 2;
  id: string;
  seed: number;
  progressionId: string;
  length: LengthId;
  /** Concert pitch class of the tonic (I or i chord). */
  keyPc: number;
  mode: Mode;
  /** The tier the user asked for. */
  requestedTier: Tier;
  /** Exact difficulty score (0..100) the user aimed for with the slider. Absent on older licks. */
  targetScore?: number;
  chords: LickChord[];
  notes: LickNote[];
  totalTicks: number;
  fragmentIds: string[];
  /** Tick where each melodic cell (fragment) starts, parallel to fragmentIds. Optional: older saved licks lack it. */
  cellStarts?: number[];
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
