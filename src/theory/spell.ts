import type { ChordQualityId, Instrument, Lick, Mode } from '../types';
import { CHORDS } from './chords';
import { keySignatureName, keyUsesSharps, mod12 } from './pitch';

/**
 * Note spelling (pure, no DOM).
 *
 * A pitch is spelled as letter + accidental. Three layers, all driven by the chord a note sits over:
 *  1. Key: the tonic is spelled as the key signature names it (keySignatureName; F♯ vs G♭ etc. unchanged).
 *  2. Chord root: letter = tonic letter + degree step (ii = 2nd letter, V = 5th, ♭II = 2nd, ♭VII = 7th, iv = 4th);
 *     if that spelling needs double accidentals inside the chord's scale, a clean enharmonic root is used instead.
 *  3. Note: letter = root letter + the chord-degree step of the note (3rd = 3rd letter ...); notes that are not
 *     chord/scale degrees ("chromatic") take sharp-of-lower when rising, flat-of-upper when falling.
 */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export interface Spelled { letter: Letter; acc: number }
export interface SpelledNote extends Spelled { octave: number }

const LETTERS: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const letterIdx = (l: Letter): number => LETTERS.indexOf(l);

/** Spell a pitch class on a given letter (index 0..6, wraps). acc is semitones above the natural letter. */
function onLetter(idx: number, pc: number): Spelled {
  const i = ((idx % 7) + 7) % 7;
  return { letter: LETTERS[i], acc: mod12(pc - LETTER_PC[i] + 6) - 6 };
}

export const spelledPc = (s: Spelled): number => mod12(LETTER_PC[letterIdx(s.letter)] + s.acc);

/** Tonic of a key, spelled as its key signature name (e.g. 6 major = "Gb", 6 minor = "F#"). */
export function spellKeyTonic(keyPc: number, mode: Mode = 'major'): Spelled {
  const n = keySignatureName(keyPc, mode);
  return { letter: n[0] as Letter, acc: n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0 };
}

/** Letter steps above the tonic for each semitone degree: I, ♭II, ii, ♭III, iii, iv, ♭V, V, ♭VI, vi, ♭VII, vii. */
const DEGREE_STEP = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

/**
 * Letter step (0..6) above the chord root for each semitone above the root; null = not a degree of the chord
 * (chromatic: spelled by direction). dom7alt follows the altered-scale spelling G A♭ B♭ B D♭ E♭ F
 * (♯9 written as ♭3, ♯11 as ♭5), so its scale reuses the 3rd's letter once.
 */
const STEPS: Record<ChordQualityId, (number | null)[]> = {
  m7: [0, null, 1, 2, null, 3, null, 4, null, 5, 6, null],
  m7b5: [0, 1, null, 2, null, 3, 4, null, 5, null, 6, null],
  dom7: [0, null, 1, null, 2, 3, null, 4, null, 5, 6, null],
  dom7alt: [0, 1, null, 2, 2, null, 4, null, 5, null, 6, null],
  maj7: [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6],
  m6: [0, null, 1, 2, null, 3, null, 4, null, 5, null, 6],
  mMaj7: [0, null, 1, 2, null, 3, null, 4, null, 5, null, 6],
};

/**
 * Spell the degree `step` letters above the root. Chord tones always keep their letter; any other degree that would
 * need a double accidental (e.g. the ♭5 of E♭7alt = B𝄫) moves to the neighbouring letter (A) instead.
 */
function degree(root: Spelled, quality: ChordQualityId, step: number, pc: number): Spelled {
  const ri = letterIdx(root.letter);
  const s = onLetter(ri + step, pc);
  if (Math.abs(s.acc) <= 1 || CHORDS[quality].tones.includes(mod12(pc - spelledPc(root)))) return s;
  for (const d of [-1, 1]) {
    const alt = onLetter(ri + step + d, pc);
    if (Math.abs(alt.acc) <= 1) return alt;
  }
  return s;
}

/** The 7 scale notes of a chord from its spelled root, in CHORDS[q].scale order. */
export function spellScale(root: Spelled, quality: ChordQualityId): Spelled[] {
  const rpc = spelledPc(root);
  return CHORDS[quality].scale.map(rel => degree(root, quality, STEPS[quality][mod12(rel)] as number, rpc + rel));
}

const isWeird = (s: Spelled): boolean =>
  (s.acc === 1 && (s.letter === 'B' || s.letter === 'E')) || (s.acc === -1 && (s.letter === 'C' || s.letter === 'F'));

/**
 * Root of a chord in a key. Functional spelling first (tritone sub = ♭II, backdoor = ♭VII / iv); when that makes
 * the chord's scale need double accidentals (e.g. ♭II7 in D♭ = E𝄫7), the cleaner enharmonic root wins.
 * The tonic chord always keeps the key's own spelling.
 */
export function spellChordRoot(rootPc: number, quality: ChordQualityId, keyPc: number, mode: Mode = 'major'): Spelled {
  const tonic = spellKeyTonic(keyPc, mode);
  const deg = mod12(rootPc - keyPc);
  const fi = letterIdx(tonic.letter) + DEGREE_STEP[deg];
  const functional = onLetter(fi, rootPc);
  if (deg === 0) return functional;
  let best = functional;
  let bestScore = Infinity;
  for (const idx of [fi, fi - 1, fi + 1]) {
    const cand = onLetter(idx, rootPc);
    if (Math.abs(cand.acc) > 1) continue;
    const doubles = spellScale(cand, quality).filter(s => Math.abs(s.acc) > 1).length;
    const score = doubles + (isWeird(cand) ? 0.5 : 0) + Math.abs(cand.acc) * 0.01;
    if (score < bestScore - 1e-9) { best = cand; bestScore = score; }
  }
  return best;
}

export type SpellStyle = 'unicode' | 'ascii' | 'vex';

/** "E♭", "F♯" (unicode); "Eb", "F#" (ascii); "eb/4" (vex; octave appended for a SpelledNote). */
export function formatSpelling(s: Spelled | SpelledNote, style: SpellStyle = 'unicode'): string {
  const n = Math.abs(s.acc);
  const sym = s.acc > 0 ? (style === 'unicode' ? '♯' : '#') : style === 'unicode' ? '♭' : 'b';
  const acc = sym.repeat(n);
  if (style === 'vex') return s.letter.toLowerCase() + acc + ('octave' in s ? '/' + s.octave : '');
  return s.letter + acc;
}

export interface NoteContext {
  root: Spelled;
  quality: ChordQualityId;
  /** Where the melody goes next: chromatic notes rise as sharps, fall as flats. */
  direction?: 'up' | 'down' | null;
  /** Fallback for a chromatic note with no direction when the root has no accidental. */
  sharps?: boolean;
}

/** Spell a MIDI pitch (in whatever pitch space the root is in) over a chord. */
export function spellNote(midi: number, ctx: NoteContext): SpelledNote {
  const pc = mod12(midi);
  const rootPc = spelledPc(ctx.root);
  const step = STEPS[ctx.quality][mod12(pc - rootPc)];
  let s: Spelled;
  if (step != null) s = degree(ctx.root, ctx.quality, step, pc);
  else {
    const white = LETTER_PC.indexOf(pc);
    if (white >= 0) s = onLetter(white, pc);
    else {
      const sharp = ctx.direction ? ctx.direction === 'up' : ctx.root.acc !== 0 ? ctx.root.acc > 0 : !!ctx.sharps;
      s = sharp ? onLetter(LETTER_PC.indexOf(mod12(pc - 1)), pc) : onLetter(LETTER_PC.indexOf(mod12(pc + 1)), pc);
    }
  }
  return { ...s, octave: Math.floor((midi - s.acc) / 12) - 1 };
}

/**
 * Written spelling of every lick note (null for rests), for an instrument: spelled in the WRITTEN key over the
 * written chord root. Index = lick.notes index (the renderer reuses it for every tied piece of a note).
 */
export function spellLick(lick: Lick, inst: Instrument): (SpelledNote | null)[] {
  const t = inst.transpose;
  const key = mod12(lick.keyPc + t);
  const sharps = keyUsesSharps(key, lick.mode);
  const roots = lick.chords.map(c => spellChordRoot(mod12(c.rootPc + t), c.quality, key, lick.mode));
  const out: (SpelledNote | null)[] = [];
  lick.notes.forEach((n, i) => {
    if (n.midi == null) { out.push(null); return; }
    const prev = lick.notes[i - 1];
    // a tied continuation keeps the head's spelling, even across a chord change
    if (prev && prev.tie && prev.midi === n.midi && out[i - 1]) { out.push(out[i - 1]); return; }
    const c = lick.chords[n.chord];
    let j = i;
    while (lick.notes[j].tie && lick.notes[j + 1]) j++;
    const next = lick.notes[j + 1];
    const direction = next && next.midi != null && next.midi !== n.midi ? (next.midi > n.midi ? 'up' : 'down') : null;
    out.push(spellNote(n.midi + t, { root: roots[n.chord], quality: c.quality, direction, sharps }));
  });
  return out;
}

/** Chord symbol text for a chord root, e.g. "A♭7alt" (unicode) or "Ab7alt" (ascii). */
export function chordSymbolText(root: Spelled, quality: ChordQualityId, style: SpellStyle = 'unicode'): string {
  return formatSpelling(root, style) + CHORDS[quality].suffix;
}
