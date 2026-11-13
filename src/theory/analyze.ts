import type { ChordQualityId, Instrument, Lick } from '../types';
import { CHORDS, inScale, isChordTone } from './chords';
import { getProgression } from './progressions';
import { FLAT_NAMES, SHARP_NAMES, chordRootName, keyUsesSharps, mod12 } from './pitch';

/**
 * Analysis of a lick: scale-degree labels per note and the parent scale of each chord.
 *
 * Degree label table (index = semitones above the chord root). Spelling depends on the chord:
 * minor qualities call pc 3 the b3 and pc 4 a (chromatic) 3; dominant/major call pc 3 the #9 and
 * pc 4 the 3; pc 6 is b5 on minor qualities and #11 on dominant/major; pc 8 is b13;
 * pc 9 is 13, except 6 on m6; pc 10 is b7 and pc 11 is 7 on every quality.
 */
const MINOR_LIKE = ['R', '♭9', '9', '♭3', '3', '11', '♭5', '5', '♭13', '13', '♭7', '7'];
const DOMINANT_LIKE = ['R', '♭9', '9', '♯9', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7'];
const LABELS: Record<ChordQualityId, string[]> = {
  m7: MINOR_LIKE,
  m7b5: MINOR_LIKE,
  dom7: DOMINANT_LIKE,
  dom7alt: DOMINANT_LIKE,
  maj7: DOMINANT_LIKE,
  m6: MINOR_LIKE.map((l, i) => (i === 9 ? '6' : l)),
  mMaj7: MINOR_LIKE,
};

/** Name of each chord's parent scale. Every CHORDS[q].scale set matches its name exactly (checked in tests). */
export const SCALE_NAMES: Record<ChordQualityId, string> = {
  m7: 'Dorian',
  m7b5: 'Locrian',
  dom7: 'Mixolydian',
  dom7alt: 'Altered',
  maj7: 'Ionian (major)',
  m6: 'Melodic minor',
  mMaj7: 'Melodic minor',
};

export type NoteKind = 'chord' | 'tension' | 'scale' | 'chromatic';

export interface NoteAnalysis { label: string; kind: NoteKind; approach: boolean }
export interface ChordAnalysis { symbol: string; roman: string; scaleName: string; scaleNotes: string[] }
export interface LickAnalysis { notes: (NoteAnalysis | null)[]; chords: ChordAnalysis[] }

/** Degree label of a pitch over a chord ("R", "♭9", "♯11", "13"...). Octave does not matter. */
export function degreeLabel(midi: number, rootPc: number, quality: ChordQualityId): string {
  return LABELS[quality][mod12(midi - rootPc)];
}

export function noteKind(midi: number, rootPc: number, quality: ChordQualityId): NoteKind {
  if (isChordTone(midi, rootPc, quality)) return 'chord';
  const rel = mod12(midi - rootPc);
  if (CHORDS[quality].tensions.some(t => mod12(t) === rel)) return 'tension';
  return inScale(midi, rootPc, quality) ? 'scale' : 'chromatic';
}

/** "Eb" -> "E♭", "F#" -> "F♯". */
export const prettyNote = (s: string): string => s.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯');

/** Notes of the chord's parent scale from its root, spelled to match the chord symbol on the sheet. */
function scaleNotes(rootPc: number, quality: ChordQualityId, writtenKey: number, mode: Lick['mode']): string[] {
  const root = chordRootName(rootPc, writtenKey, mode);
  const sharps = root.includes('#') ? true : root.includes('b') ? false : keyUsesSharps(writtenKey, mode);
  const names = sharps ? SHARP_NAMES : FLAT_NAMES;
  return CHORDS[quality].scale.map(s => prettyNote(s === 0 ? root : names[mod12(rootPc + s)]));
}

/**
 * Analyse a lick. `inst` decides the spelling: chord symbols on the sheet are written for the
 * instrument (transposed), so symbols and scale notes use the written pitch classes. Degree
 * labels are interval names and do not depend on transposition.
 */
export function analyzeLick(lick: Lick, inst: Instrument): LickAnalysis {
  const writtenKey = mod12(lick.keyPc + inst.transpose);
  const def = getProgression(lick.progressionId);
  const chords: ChordAnalysis[] = lick.chords.map((c, i) => {
    const wRoot = mod12(c.rootPc + inst.transpose);
    return {
      symbol: prettyNote(chordRootName(wRoot, writtenKey, lick.mode)) + CHORDS[c.quality].suffix,
      roman: def.slots[i]?.roman ?? '',
      scaleName: SCALE_NAMES[c.quality],
      scaleNotes: scaleNotes(wRoot, c.quality, writtenKey, lick.mode),
    };
  });

  const notes: (NoteAnalysis | null)[] = [];
  let prevTied = false;
  lick.notes.forEach((n, i) => {
    const continuation = prevTied;
    prevTied = !!n.tie && n.midi != null;
    if (n.midi == null || continuation) { notes.push(null); return; }
    const c = lick.chords[n.chord];
    const kind = noteKind(n.midi, c.rootPc, c.quality);
    let approach = false;
    if (kind === 'chromatic') {
      let j = i;
      while (lick.notes[j].tie && lick.notes[j + 1]) j++; // skip tied continuations
      const next = lick.notes[j + 1];
      approach = !!next && next.midi != null && Math.abs(next.midi - n.midi) === 1;
    }
    notes.push({ label: degreeLabel(n.midi, c.rootPc, c.quality), kind, approach });
  });
  return { notes, chords };
}
