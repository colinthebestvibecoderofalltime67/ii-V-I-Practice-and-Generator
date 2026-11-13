import type { Lick, LickChord, LickNote, ChordQualityId } from '../src/types';
import { TICKS_PER_16TH as S } from '../src/types';

// Fixtures below are written in 16th-note units (1 = 16th, 4 = quarter, 16 = bar) and scaled to engine ticks by S.

const DIFF = { score: 10, tier: 1 as const, features: [] };

function chord(rootPc: number, quality: ChordQualityId, symbol: string, start: number, dur: number): LickChord {
  return { rootPc, quality, symbol, start: start * S, dur: dur * S };
}

/** Compact note list: [midi|null, dur, chord, tie?] laid out sequentially. */
function seq(spec: [number | null, number, number, boolean?][]): LickNote[] {
  let t = 0;
  return spec.map(([midi, dur, c, tie]) => {
    const n: LickNote = { midi, start: t * S, dur: dur * S, chord: c };
    if (tie) n.tie = true;
    t += dur;
    return n;
  });
}

function mk(id: string, keyPc: number, mode: 'major' | 'minor', length: 'short' | 'standard' | 'long', chords: LickChord[], notes: LickNote[], total: number): Lick {
  return { version: 2, id, seed: 1, progressionId: 'x', length, keyPc, mode, requestedTier: 1, chords, notes, totalTicks: total * S, fragmentIds: [], difficulty: DIFF, createdAt: 0 };
}

// C major ii-V-I, eighths, tie across bar 2->3. Concert pitches around C4..C5
export const standard = mk('std', 0, 'major', 'standard',
  [chord(2, 'm7', 'Dm7', 0, 16), chord(7, 'dom7', 'G7', 16, 16), chord(0, 'maj7', 'Cmaj7', 32, 16)],
  seq([
    [62, 2, 0], [65, 2, 0], [69, 2, 0], [72, 2, 0], [71, 2, 0], [69, 2, 0], [67, 2, 0], [65, 2, 0],
    [67, 2, 1], [71, 2, 1], [74, 2, 1], [77, 2, 1], [76, 2, 1], [74, 2, 1], [71, 2, 1], [67, 2, 1, true],
    [67, 6, 2], [64, 2, 2], [60, 4, 2], [null, 4, 2],
  ]), 48);

// short: Dm7 | G7 (2+2 beats) | Cmaj7 -> 3 bars? short form = 2+2+4 beats = 2 bars, two chords in bar 1
export const short = mk('short', 0, 'major', 'short',
  [chord(2, 'm7', 'Dm7', 0, 8), chord(7, 'dom7', 'G7', 8, 8), chord(0, 'maj7', 'Cmaj7', 16, 16)],
  seq([
    [65, 1, 0], [67, 1, 0], [69, 1, 0], [72, 1, 0], [71, 1, 0], [69, 1, 0], [67, 1, 0], [65, 1, 0],
    [62, 1, 1], [65, 1, 1], [67, 2, 1], [71, 3, 1], [74, 1, 1], [72, 4, 1],
    [72, 6, 2], [67, 2, 2], [64, 8, 2],
  ]), 32);

// long minor: Dm7b5 (2 bars) G7alt (2 bars) Cm6 (2 bars) in C minor, altered notes
export const longMinor = mk('long', 0, 'minor', 'long',
  [chord(2, 'm7b5', 'Dm7b5', 0, 32), chord(7, 'dom7alt', 'G7alt', 32, 32), chord(0, 'm6', 'Cm6', 64, 32)],
  seq([
    [62, 2, 0], [65, 2, 0], [68, 2, 0], [72, 2, 0], [74, 4, 0], [72, 2, 0], [68, 2, 0],
    [65, 3, 0], [62, 1, 0], [61, 4, 0], [60, 8, 0, true],
    [60, 4, 0], [null, 4, 0], [55, 2, 0], [58, 2, 0], [61, 2, 0], [62, 2, 0],
    [67, 2, 1], [68, 2, 1], [71, 2, 1], [73, 2, 1], [75, 2, 1], [73, 2, 1], [71, 2, 1], [68, 2, 1],
    [66, 2, 1], [68, 2, 1], [71, 2, 1], [74, 2, 1], [72, 4, 1], [68, 4, 1],
    [67, 6, 1], [63, 2, 1], [60, 8, 1, true],
    [60, 8, 2], [58, 4, 2], [55, 4, 2],
    [63, 2, 2], [67, 2, 2], [70, 2, 2], [72, 2, 2], [75, 2, 2], [72, 2, 2], [70, 2, 2], [67, 2, 2],
    [67, 16, 2],
  ]), 96);

// rest-heavy (starts with rests, dotted rests, whole-bar rest)
export const restHeavy = mk('rests', 5, 'major', 'standard',
  [chord(7, 'm7', 'Gm7', 0, 16), chord(0, 'dom7', 'C7', 16, 16), chord(5, 'maj7', 'Fmaj7', 32, 16)],
  seq([
    [null, 4, 0], [67, 2, 0], [70, 2, 0], [null, 2, 0], [74, 2, 0], [null, 4, 0],
    [null, 16, 1],
    [null, 6, 2], [69, 2, 2], [65, 8, 2],
  ]), 48);

/** Like seq() but durations are raw engine ticks (needed for triplets: 2 / 4 / 8). */
function seqT(spec: [number | null, number, number, boolean?][]): LickNote[] {
  let t = 0;
  return spec.map(([midi, dur, c, tie]) => {
    const n: LickNote = { midi, start: t, dur, chord: c };
    if (tie) n.tie = true;
    t += dur;
    return n;
  });
}
const mkT = (id: string, chords: LickChord[], notes: LickNote[]): Lick =>
  ({ ...mk(id, 0, 'major', 'standard', chords, notes, 0), totalTicks: 144 });
const chordT = (rootPc: number, quality: ChordQualityId, symbol: string, bar: number): LickChord =>
  ({ rootPc, quality, symbol, start: bar * 48, dur: 48 });

// Triplets, C major ii-V-I (concert).
// Bar 1: 8th-triplet, quarter+8th triplet (2+1 units), two 8ths, dotted 8th + 16th.
// Bar 2: tied quarter + 8th, 8ths, then a quarter-triplet group on beats 3-4 (one note 2 units long).
// Bar 3: 8th + 16th-triplet turn, 8th-triplet group with a rest + 2-unit note, 8th-triplet, 16th-triplet (8th + 16th) + 8th.
export const triplets = mkT('trip', [chordT(2, 'm7', 'Dm7', 0), chordT(7, 'dom7', 'G7', 1), chordT(0, 'maj7', 'Cmaj7', 2)],
  seqT([
    [62, 4, 0], [65, 4, 0], [69, 4, 0], [72, 8, 0], [71, 4, 0], [69, 6, 0], [67, 6, 0], [65, 9, 0], [62, 3, 0],
    [67, 12, 1, true], [67, 6, 1], [71, 6, 1], [74, 8, 1], [71, 16, 1],
    [72, 6, 2], [71, 2, 2], [69, 2, 2], [67, 2, 2], [null, 4, 2], [69, 8, 2], [67, 4, 2], [64, 4, 2], [60, 4, 2], [64, 4, 2], [67, 2, 2], [72, 6, 2],
  ]));

// Mostly triplets: three full 8th-triplet beats, a 16th-triplet turn, quarter triplets, then a tied long note.
export const tripletRun = mkT('trip2', [chordT(2, 'm7', 'Dm7', 0), chordT(7, 'dom7', 'G7', 1), chordT(0, 'maj7', 'Cmaj7', 2)],
  seqT([
    [62, 4, 0], [65, 4, 0], [69, 4, 0], [72, 4, 0], [69, 4, 0], [65, 4, 0], [67, 4, 0], [71, 4, 0], [74, 4, 0], [77, 4, 0], [74, 4, 0], [71, 4, 0],
    [null, 4, 1], [67, 4, 1], [71, 4, 1], [74, 2, 1], [77, 2, 1], [76, 2, 1], [74, 2, 1], [71, 2, 1], [67, 2, 1], [68, 8, 1], [67, 8, 1], [66, 8, 1],
    [67, 36, 2, true], [67, 12, 2],
  ]));
