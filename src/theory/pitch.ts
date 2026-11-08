import type { Mode } from '../types';

export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Pitch-class names offered in the key picker (concert). */
export const KEY_NAMES = FLAT_NAMES;

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Major key pitch classes spelled with sharps: G D A E B (as in the prototype). */
const SHARP_MAJOR = new Set([7, 2, 9, 4, 11]);

/** True if a key (tonic pitch class + mode) is spelled with sharps. Minor keys follow their relative major. */
export function keyUsesSharps(tonicPc: number, mode: Mode = 'major'): boolean {
  const major = mode === 'minor' ? mod12(tonicPc + 3) : mod12(tonicPc);
  return SHARP_MAJOR.has(major);
}

/** Note name for a pitch class in a key, e.g. pcName(1, 2) -> "C#" (D major), pcName(1, 0) -> "Db". */
export function pcName(pc: number, tonicPc: number, mode: Mode = 'major'): string {
  return (keyUsesSharps(tonicPc, mode) ? SHARP_NAMES : FLAT_NAMES)[mod12(pc)];
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/**
 * Spelling for a chord ROOT. Roots that belong to the key's major scale use the key's
 * preference; non-diatonic roots (bII, bVII...) are spelled with flats.
 */
export function chordRootName(rootPc: number, tonicPc: number, mode: Mode = 'major'): string {
  const majorTonic = mode === 'minor' ? mod12(tonicPc + 3) : mod12(tonicPc);
  const diatonic = MAJOR_SCALE.includes(mod12(rootPc - majorTonic));
  return diatonic ? pcName(rootPc, tonicPc, mode) : FLAT_NAMES[mod12(rootPc)];
}

/** VexFlow key string, e.g. vexKey(61, true) -> "c#/4", vexKey(61, false) -> "db/4". */
export function vexKey(midi: number, sharps: boolean): string {
  const n = (sharps ? SHARP_NAMES : FLAT_NAMES)[mod12(midi)];
  return n[0].toLowerCase() + n.slice(1) + '/' + (Math.floor(midi / 12) - 1);
}

const MAJOR_SIG = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_SIG = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** VexFlow key-signature name for a tonic + mode. */
export function keySignatureName(tonicPc: number, mode: Mode = 'major'): string {
  return (mode === 'minor' ? MINOR_SIG : MAJOR_SIG)[mod12(tonicPc)];
}

/** Display name of a key, e.g. "Eb" or "C minor". */
export function keyDisplayName(tonicPc: number, mode: Mode = 'major'): string {
  return mode === 'minor' ? `${pcName(tonicPc, tonicPc, 'minor')} minor` : pcName(tonicPc, tonicPc, 'major');
}

export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
