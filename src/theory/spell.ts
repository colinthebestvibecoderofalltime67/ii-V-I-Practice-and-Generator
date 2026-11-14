import type { ChordQualityId, Instrument, Lick, Mode } from '../types';
import { CHORDS } from './chords';
import { keySignatureName, keyUsesSharps, mod12 } from './pitch';
import { judgedChord } from './rhythm';
import { PROGRESSIONS } from './progressions';

/**
 * Note spelling (pure, no DOM).
 *
 * A pitch is spelled as letter + accidental. Three layers, all driven by the chord a note sits over:
 *  1. Key: the tonic is spelled as the key signature names it (keySignatureName; F♯ vs G♭ etc. unchanged).
 *  2. Chord root: letter = tonic letter + degree step (ii = 2nd letter, V = 5th, ♭II = 2nd, ♭VII = 7th, iv = 4th);
 *     diatonic roots (I, ii, V) always keep it; a borrowed root that is awkward (E𝄫, C♭, F♭) uses the enharmonic one.
 *  3. Note: letter = root letter + the chord-degree step of the note (3rd = 3rd letter ...); notes that are not
 *     chord tones (and the minor tonic's leading tone) keep their letter even with 𝄪/𝄫; tensions needing a double
 *     accidental move to a neighbouring letter; notes that are not scale degrees ("chromatic") take
 *     sharp-of-lower when rising, flat-of-upper when falling.
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
  // the natural 9th of a half-diminished chord is not in its Locrian scale but is a common diatonic tone: it keeps the 9th's letter
  // (C# over Bm7b5, written the same way wherever it falls in the bar), and shares it with the b9
  m7b5: [0, 1, 1, 2, null, 3, 4, null, 5, null, 6, null],
  dom7: [0, null, 1, null, 2, 3, null, 4, null, 5, 6, null],
  dom7alt: [0, 1, null, 2, 2, null, 4, null, 5, null, 6, null],
  maj7: [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6],
  m6: [0, null, 1, 2, null, 3, null, 4, null, 5, null, 6],
  mMaj7: [0, null, 1, 2, null, 3, null, 4, null, 5, null, 6],
};

const isWeird = (s: Spelled): boolean =>
  (s.acc === 1 && (s.letter === 'B' || s.letter === 'E')) || (s.acc === -1 && (s.letter === 'C' || s.letter === 'F'));

/**
 * Spell the degree `step` letters above the root.
 *  - Chord tones always keep their letter, even with a double accidental (F𝄪 = 3rd of D♯7alt).
 *  - So does the leading tone (major 7th) of the minor-tonic chords m6 / mMaj7 (F𝄪 in G♯m6): it defines the key.
 *  - Any other scale tone (tension) that would need a double accidental, or the ♯9 of an altered chord when
 *    written as a ♭3 would be F♭/C♭, moves to the neighbouring letter (D♭7alt: ♭9 D, ♯9 E, ♭5 G, ♭13 A).
 */
function degree(root: Spelled, quality: ChordQualityId, step: number, pc: number): Spelled {
  const ri = letterIdx(root.letter);
  const s = onLetter(ri + step, pc);
  const rel = mod12(pc - spelledPc(root));
  if (CHORDS[quality].tones.includes(rel) || (rel === 11 && (quality === 'm6' || quality === 'mMaj7'))) return s;
  if (Math.abs(s.acc) <= 1 && !(quality === 'dom7alt' && rel === 3 && isWeird(s))) return s;
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

/**
 * Root of a chord in a key. Functional spelling first (tritone sub = ♭II, backdoor = ♭VII / iv); when a borrowed
 * root is awkward (♭II7 in D♭ = E𝄫7, iv in G♭ = C♭m7, ♭VII7 in G♭ = F♭7) or needs doubles, the cleaner enharmonic root
 * wins. Diatonic roots (I, ii, V) never change.
 */
export function spellChordRoot(rootPc: number, quality: ChordQualityId, keyPc: number, mode: Mode = 'major'): Spelled {
  const tonic = spellKeyTonic(keyPc, mode);
  const deg = mod12(rootPc - keyPc);
  const fi = letterIdx(tonic.letter) + DEGREE_STEP[deg];
  const functional = onLetter(fi, rootPc);
  // Diatonic functional roots (I/i, ii, V) always keep the key's letters, whatever double accidental a chord tone
  // then needs (D♯7alt in G♯ minor). Only a borrowed root (♭II, iv, ♭VII ...) may move to an enharmonic
  // neighbour, when its own spelling is awkward (E𝄫, C♭, F♭, E♯, B♯) or its chord tones would need doubles (G♭m7 → F♯m7).
  if (deg === 0 || deg === 2 || deg === 7) return functional;
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

/** "E♭", "F♯", "F𝄪" (unicode); "Eb", "F#", "F##" (ascii); "eb/4", "f##/5" (vex; octave appended for a SpelledNote). */
export function formatSpelling(s: Spelled | SpelledNote, style: SpellStyle = 'unicode'): string {
  const n = Math.abs(s.acc);
  let acc: string;
  if (style === 'unicode') acc = n === 2 ? (s.acc > 0 ? '𝄪' : '𝄫') : (s.acc > 0 ? '♯' : '♭').repeat(n);
  else acc = (s.acc > 0 ? '#' : 'b').repeat(n); // VexFlow 4: "f##/5", "bbb/4"
  if (style === 'vex') return s.letter.toLowerCase() + acc + ('octave' in s ? '/' + s.octave : '');
  return s.letter + acc;
}

export interface NoteContext {
  root: Spelled;
  quality: ChordQualityId;
  /** Where the melody goes next: chromatic notes rise as sharps, fall as flats. */
  direction?: 'up' | 'down' | null;
  /** The note moves down by a half step to a chord tone: an upper chromatic neighbour, written flat (C♭ over E♭m7, F♭ over A♭maj7). */
  halfStepDownToChordTone?: boolean;
  /** Fallback for a chromatic note with no direction when the root has no accidental. */
  sharps?: boolean;
  /**
   * The chord is a secondary dominant (VI7 -> ii) with its ♭9 and ♭13 (the analysis labels them so): ♭9 is written on the 9th's
   * letter (D♭ over C7, not C♯) and ♭13 on the 13th's (A♭, not G♯).
   */
  secondaryDom?: boolean;
  /** The note rises a half step to a note spelled `lowerNeighbourOf`: written on the letter below it (E♯ under F♯, D♯ under E, B♯ under C♯). */
  lowerNeighbourOf?: Spelled;
}

/** Spell a MIDI pitch (in whatever pitch space the root is in) over a chord. */
export function spellNote(midi: number, ctx: NoteContext): SpelledNote {
  const pc = mod12(midi);
  const rootPc = spelledPc(ctx.root);
  const rel = mod12(pc - rootPc);
  let step = STEPS[ctx.quality][rel];
  if (ctx.secondaryDom && ctx.quality === 'dom7' && (rel === 1 || rel === 8)) step = rel === 1 ? 1 : 5;
  const ri = letterIdx(ctx.root.letter);
  let s: Spelled | undefined;
  if (step != null) s = degree(ctx.root, ctx.quality, step, pc);
  else {
    // the major 7th as a passing / leading tone over a dominant or minor 7th is the 7th letter's sharp (A♯ over B7, C♯ over Dm7)
    if (rel === 11 && (ctx.quality === 'dom7' || ctx.quality === 'm7')) {
      const alt = onLetter(ri + 6, pc);
      if (Math.abs(alt.acc) <= 1 && !isWeird(alt)) s = alt;
    }
    // a lower neighbour is written relative to its target: the letter below it
    if (!s && ctx.lowerNeighbourOf) {
      const alt = onLetter(letterIdx(ctx.lowerNeighbourOf.letter) - 1, pc);
      if (Math.abs(alt.acc) <= 1) s = alt;
    }
    if (!s) {
      const white = LETTER_PC.indexOf(pc);
      if (white >= 0) s = ctx.halfStepDownToChordTone && (pc === 11 || pc === 4) ? onLetter(LETTER_PC.indexOf(mod12(pc + 1)), pc) : onLetter(white, pc);
      else {
        const sharp = ctx.direction ? ctx.direction === 'up' : ctx.root.acc !== 0 ? ctx.root.acc > 0 : !!ctx.sharps;
        s = sharp ? onLetter(LETTER_PC.indexOf(mod12(pc - 1)), pc) : onLetter(LETTER_PC.indexOf(mod12(pc + 1)), pc);
      }
    }
  }
  return { ...s, octave: octaveOf(midi, s) };
}

const octaveOf = (midi: number, s: Spelled): number => Math.floor((midi - s.acc) / 12) - 1;

/** Respell a pitch as the sharp of the letter below (up) or the flat of the letter above (down); null for a white key. */
function respellDir(midi: number, up: boolean): SpelledNote | null {
  const pc = mod12(midi);
  if (LETTER_PC.indexOf(pc) >= 0) return null;
  const s = up ? onLetter(LETTER_PC.indexOf(mod12(pc - 1)), pc) : onLetter(LETTER_PC.indexOf(mod12(pc + 1)), pc);
  return { ...s, octave: octaveOf(midi, s) };
}

/**
 * Written spelling of every lick note (null for rests), for an instrument: spelled in the WRITTEN key over the
 * written chord root. Index = lick.notes index (the renderer reuses it for every tied piece of a note).
 *
 * Chromatic (non-degree) notes are spelled in three layers: the note itself (the chord and direction, see spellNote), the
 * target it resolves to (a half-step lower neighbour is the letter below its target), and the chord's bar as a whole
 * (the same pitch class over the same chord keeps one spelling, and free chromatic notes follow the sharps or flats of the
 * resolving ones in that bar, so a figure is not written D♭ A♯ B).
 */
export function spellLick(lick: Lick, inst: Instrument): (SpelledNote | null)[] {
  const t = inst.transpose;
  const key = mod12(lick.keyPc + t);
  const sharps = keyUsesSharps(key, lick.mode);
  const roots = lick.chords.map(c => spellChordRoot(mod12(c.rootPc + t), c.quality, key, lick.mode));
  const slots = PROGRESSIONS.find(p => p.id === lick.progressionId)?.slots;
  const n = lick.notes.length;
  const out: (SpelledNote | null)[] = new Array(n).fill(null);
  const done: boolean[] = new Array(n).fill(false);
  /** 'cont' = tied continuation of an earlier note; 'resolve' = moves a half step; 'free' = other chromatic note; 'fixed' = a degree of its chord. */
  const kind: ('cont' | 'resolve' | 'free' | 'fixed')[] = new Array(n).fill('fixed');
  const chordOf: number[] = new Array(n).fill(0);

  const spellAt = (i: number): SpelledNote | null => {
    if (done[i]) return out[i];
    done[i] = true;
    const note = lick.notes[i];
    if (note.midi == null) return null;
    const prev = lick.notes[i - 1];
    // a tied continuation keeps the head's spelling, even across a chord change
    if (prev && prev.tie && prev.midi === note.midi && spellAt(i - 1)) { kind[i] = 'cont'; return (out[i] = out[i - 1]); }
    // an anticipation is spelled over the chord it arrives on (a tied-in 3rd of the I is that chord's 3rd)
    const ci = judgedChord(lick.notes, i);
    chordOf[i] = ci;
    const c = lick.chords[ci];
    let j = i;
    while (lick.notes[j].tie && lick.notes[j + 1]) j++;
    const next = lick.notes[j + 1];
    const direction = next && next.midi != null && next.midi !== note.midi ? (next.midi > note.midi ? 'up' : 'down') : null;
    // A chromatic upper neighbour is written as a flat (C♭→B♭, F♭→E♭) only in flat contexts: the chord root is flat
    // and the chord tone it falls to is spelled flat. Over C7 the bebop line stays B→B♭; over B7alt, E→D♯.
    let halfStepDownToChordTone = false;
    if (next && next.midi != null && next.midi === note.midi - 1 && roots[ci].acc < 0) {
      const nci = judgedChord(lick.notes, j + 1);
      const nc = lick.chords[nci];
      if (CHORDS[nc.quality].tones.some(x => mod12(x) === mod12(next.midi! - nc.rootPc))) {
        halfStepDownToChordTone = spellNote(next.midi + t, { root: roots[nci], quality: nc.quality, direction: null, sharps }).acc < 0;
      }
    }
    const secondaryDom = slots?.[ci]?.fn === 'secondaryDom';
    const ctx: NoteContext = { root: roots[ci], quality: c.quality, direction, sharps, halfStepDownToChordTone, secondaryDom };
    if (next && next.midi != null && next.midi === note.midi + 1) {
      const target = spellAt(j + 1);
      if (target) ctx.lowerNeighbourOf = target;
    }
    const sp = spellNote(note.midi + t, ctx);
    const rel = mod12(note.midi + t - spelledPc(roots[ci]));
    if (STEPS[c.quality][rel] == null && !(secondaryDom && c.quality === 'dom7' && (rel === 1 || rel === 8))) {
      kind[i] = next && next.midi != null && Math.abs(next.midi - note.midi) === 1 ? 'resolve' : 'free';
    }
    return (out[i] = sp);
  };
  for (let i = 0; i < n; i++) spellAt(i);

  // the same pitch class over the same chord keeps one spelling (the resolving note's, else the first free one's); free chromatic
  // notes of a bar follow the sharps or flats of its resolving notes
  const byChord = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 'resolve' && kind[i] !== 'free') continue;
    const l = byChord.get(chordOf[i]);
    if (l) l.push(i); else byChord.set(chordOf[i], [i]);
  }
  for (const idxs of byChord.values()) {
    const resolveSign = new Set(idxs.filter(i => kind[i] === 'resolve' && out[i]!.acc !== 0).map(i => Math.sign(out[i]!.acc)));
    const byPc = new Map<number, SpelledNote>();
    for (const i of idxs) if (kind[i] === 'resolve' && !byPc.has(mod12(lick.notes[i].midi!))) byPc.set(mod12(lick.notes[i].midi!), out[i]!);
    for (const i of idxs) {
      if (kind[i] !== 'free') continue;
      const pcI = mod12(lick.notes[i].midi!);
      const ref = byPc.get(pcI);
      if (ref) { out[i] = { ...ref, octave: octaveOf(lick.notes[i].midi! + t, ref) }; continue; }
      if (out[i]!.acc !== 0 && resolveSign.size === 1 && !resolveSign.has(Math.sign(out[i]!.acc))) {
        const r = respellDir(lick.notes[i].midi! + t, [...resolveSign][0] > 0);
        if (r) out[i] = r;
      }
      byPc.set(pcI, out[i]!);
    }
  }
  for (let i = 0; i < n; i++) if (kind[i] === 'cont') {
    let h = i;
    while (kind[h] === 'cont') h--;
    out[i] = out[h];
  }
  return out;
}

/** Chord symbol text for a chord root, e.g. "A♭7alt" (unicode) or "Ab7alt" (ascii). */
export function chordSymbolText(root: Spelled, quality: ChordQualityId, style: SpellStyle = 'unicode'): string {
  return formatSpelling(root, style) + CHORDS[quality].suffix;
}
