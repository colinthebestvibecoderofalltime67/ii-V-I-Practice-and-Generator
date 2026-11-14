import type { ChordQualityId, Instrument, Lick } from '../types';
import { CHORDS, inScale, isChordTone } from './chords';
import { getProgression } from './progressions';
import { mod12 } from './pitch';
import { judgedChord } from './rhythm';
import { chordSymbolText, formatSpelling, spellChordRoot, spellLick, spellScale } from './spell';

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

/**
 * Analyse a lick. `inst` decides the spelling: chord symbols on the sheet are written for the
 * instrument (transposed), so symbols and scale notes use the written pitch classes. Degree
 * labels are interval names and do not depend on transposition.
 */
export function analyzeLick(lick: Lick, inst: Instrument): LickAnalysis {
  const writtenKey = mod12(lick.keyPc + inst.transpose);
  const def = getProgression(lick.progressionId);
  const roots = lick.chords.map(c => spellChordRoot(mod12(c.rootPc + inst.transpose), c.quality, writtenKey, lick.mode));
  const spelled = spellLick(lick, inst);
  const chords: ChordAnalysis[] = lick.chords.map((c, i) => {
    const root = roots[i];
    return {
      symbol: chordSymbolText(root, c.quality),
      roman: def.slots[i]?.roman ?? '',
      scaleName: SCALE_NAMES[c.quality],
      scaleNotes: spellScale(root, c.quality).map(n => formatSpelling(n)),
    };
  });

  const notes: (NoteAnalysis | null)[] = [];
  let prevTied = false;
  lick.notes.forEach((n, i) => {
    const continuation = prevTied;
    prevTied = !!n.tie && n.midi != null;
    if (n.midi == null || continuation) { notes.push(null); return; }
    const ci = judgedChord(lick.notes, i);
    const c = lick.chords[ci]; // anticipations are labelled against the chord they arrive on
    let kind = noteKind(n.midi, c.rootPc, c.quality);
    // A secondary dominant (VI7 -> ii) is played with its b9, #9 and b13: tensions there, not chromatic passing notes.
    if (kind === 'chromatic' && def.slots[ci]?.fn === 'secondaryDom' && [1, 3, 8].includes(mod12(n.midi - c.rootPc))) kind = 'tension';
    let approach = false;
    if (kind === 'chromatic') {
      let j = i;
      while (lick.notes[j].tie && lick.notes[j + 1]) j++; // skip tied continuations
      const next = lick.notes[j + 1];
      approach = !!next && next.midi != null && Math.abs(next.midi - n.midi) === 1;
    }
    // A chromatic note's label follows how the sheet spells it (G♯ over C reads ♯5, A♭ reads ♭13).
    const sp = spelled[i];
    const label = (kind === 'chromatic' && sp && chromaticLabel(sp, roots[judgedChord(lick.notes, i)])) || degreeLabel(n.midi, c.rootPc, c.quality);
    notes.push({ label, kind, approach });
  });
  return { notes, chords };
}

const LETTER_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const DEGREE_NAME = ['R', '9', '3', '11', '5', '13', '7'];

/**
 * Degree label of a chromatic note from its spelling: letter distance from the chord root, then ♭/♯ against the major
 * scale. Returns '' for an altered root letter (players say ♭9, not ♯1), so the caller falls back to the usual name.
 */
function chromaticLabel(note: { letter: string; acc: number }, root: { letter: string; acc: number }): string {
  const step = (LETTER_ORDER.indexOf(note.letter) - LETTER_ORDER.indexOf(root.letter) + 7) % 7;
  const semis = mod12(MAJOR_STEPS[LETTER_ORDER.indexOf(note.letter)] + note.acc - MAJOR_STEPS[LETTER_ORDER.indexOf(root.letter)] - root.acc);
  let diff = semis - MAJOR_STEPS[step];
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  if (step === 0 && diff !== 0) return '';
  const acc = diff > 0 ? '♯'.repeat(diff) : '♭'.repeat(-diff);
  return acc + DEGREE_NAME[step];
}
