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
  | 'motif'
  /** Two triads a whole step apart, alternated (src/theory/devices.ts detects the pairs from the notes). */
  | 'triad-pair'
  /** Barry Harris 6th-diminished scale line over maj7 / m6. */
  | 'sixth-dim'
  /** A different ii-V (or a tritone-sub / half-step side-slip figure) played over one chord. */
  | 'superimposition'
  /** First note is a chord tone that can sound early over the previous chord (tied-over anticipation into the I). */
  | 'anticipation-target';

/**
 * A "Focus" concept the player can practise (see src/theory/devices.ts for how each is found in the notes).
 * Beginner+: guideTones, enclosures, chromaticApproach, anticipateI. Advanced+: triadPairs, sixthDim, superimposition.
 */
export type ConceptId =
  | 'guideTones'
  | 'enclosures'
  | 'chromaticApproach'
  | 'anticipateI'
  | 'triadPairs'
  | 'sixthDim'
  | 'superimposition';

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
  /**
   * A cell written for one Focus concept (src/theory/devices.ts). It is offered only while that Focus is on, so lick generation
   * without a Focus draws from exactly the pool it always had.
   */
  concept?: ConceptId;
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
  /** The Focus concept this lick was generated for (absent when none, or when it was not allowed at the lick's tier). */
  focus?: ConceptId;
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
