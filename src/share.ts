import type { LengthId, Lick, LickNote, Tier } from './types';
import { RENDERABLE_DURS, TPBAR, TRIPLET_DURS } from './types';
import { LENGTHS, PROGRESSIONS, expandProgression, totalTicks } from './theory/progressions';
import { findTupletGroups } from './theory/rhythm';
import { scoreLick } from './difficulty/score';

/**
 * Shareable lick links. A lick is packed into a few dozen bytes and written as base64url, so it can live in a URL
 * hash (`#l=<code>`; a hash never reaches a server). The NOTES are stored, not the generator seed, so a link keeps
 * working after the generator changes. Everything else (chords, mode, tick positions, chord index per note,
 * difficulty) is derived on decode. Cell/fragment ids are not stored (analysis and rendering work without them).
 *
 * Binary layout (versions 1 and 2; they differ only in the duration table, see DURS):
 *   byte 0   version (high 4 bits) | length index (2 bits) | requestedTier - 1 (2 bits)
 *   byte 1   progression index in PROGRESSIONS (high 4 bits, so the registry is append-only) | keyPc (low 4 bits)
 *   byte 2   targetScore: 0 = none, else round(score * 2) + 1
 *   then one record per note until the notes fill the lick (the total length is implied by progression + length):
 *     byte   duration code (low 4 bits, index into DURS) | 0x10 tie to next | 0x20 rest
 *     varint zigzag(pitch - previous pitch)   (omitted for rests and for the note after a tie, which repeats its
 *                                              pitch; the first pitch is relative to 60)
 * Pitches are CONCERT MIDI.
 */
export const SHARE_VERSION = 2;
export const SHARE_PARAM = 'l';

/**
 * Duration tables by version. v1 had no 16 (a 2-unit quarter-triplet note, which the generator does produce). v2 only
 * APPENDS to v1 so the codes of old links keep their meaning; links written as v1 still decode with the v1 table.
 */
const DURS_V1 = [2, 3, 4, 6, 8, 9, 12, 18, 24, 36, 48];
const DURS_V2 = [...DURS_V1, 16];
const DURS_BY_VERSION: Record<number, readonly number[]> = { 1: DURS_V1, 2: DURS_V2 };
const DURS = DURS_V2;
// Everything the generator can emit must be encodable: renderable values, triplet units and their 2-unit forms.
if (![...RENDERABLE_DURS, ...TRIPLET_DURS, ...TRIPLET_DURS.map(d => 2 * d)].every(d => DURS.includes(d))) throw new Error('share: DURS table is missing a duration');
const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
const MAX_NOTES = 400;
const TIE = 0x10;
const REST = 0x20;

const zigzag = (n: number): number => (n < 0 ? -2 * n - 1 : 2 * n);
const unzigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function toBase64Url(bytes: number[]): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): number[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length % 4 === 1) return null;
  try {
    const s = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    return Array.from(s, c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Encode a lick (concert pitch) to a URL-safe string. Throws if the lick cannot be represented. */
export function encodeLick(lick: Lick): string {
  const pi = PROGRESSIONS.findIndex(p => p.id === lick.progressionId);
  const li = LENGTH_IDS.indexOf(lick.length);
  if (pi < 0 || pi > 15 || li < 0) throw new Error('lick cannot be shared');
  const out: number[] = [
    (SHARE_VERSION << 4) | (li << 2) | (lick.requestedTier - 1),
    (pi << 4) | (((lick.keyPc % 12) + 12) % 12),
    lick.targetScore === undefined ? 0 : Math.min(255, Math.max(0, Math.round(lick.targetScore * 2)) + 1),
  ];
  let prev = 60;
  let tiedFrom = false;
  for (const n of lick.notes) {
    const d = DURS.indexOf(n.dur);
    if (d < 0) throw new Error('lick cannot be shared');
    out.push(d | (n.tie && n.midi != null ? TIE : 0) | (n.midi == null ? REST : 0));
    if (n.midi != null && !tiedFrom) {
      let z = zigzag(n.midi - prev);
      while (z >= 0x80) { out.push((z % 0x80) | 0x80); z = Math.floor(z / 0x80); }
      out.push(z);
    }
    if (n.midi != null) prev = n.midi;
    tiedFrom = !!n.tie && n.midi != null;
  }
  return toBase64Url(out);
}

/** Decode and validate a share code. Returns null for anything that is not a well-formed lick. */
export function decodeLick(code: string): Lick | null {
  const b = fromBase64Url(code);
  if (!b || b.length < 4 || b.length > 3 + 4 * MAX_NOTES) return null;
  const durs = DURS_BY_VERSION[b[0] >> 4];
  if (!durs) return null;
  const length = LENGTH_IDS[(b[0] >> 2) & 3];
  const tier = ((b[0] & 3) + 1) as Tier;
  const def = PROGRESSIONS[b[1] >> 4];
  const keyPc = b[1] & 15;
  if (!length || !def || keyPc > 11) return null;
  const targetScore = b[2] === 0 ? undefined : (b[2] - 1) / 2;
  if (targetScore !== undefined && targetScore > 100) return null;

  const total = totalTicks(def, length);
  const notes: LickNote[] = [];
  const chords = expandProgression(def, length, keyPc);
  let i = 3;
  let t = 0;
  let prev = 60;
  let tiedFrom = false;
  let chord = 0;
  while (t < total) {
    if (i >= b.length || notes.length >= MAX_NOTES) return null;
    const h = b[i++];
    if (h & 0xc0) return null;
    const dur = durs[h & 15];
    if (dur === undefined) return null;
    const tie = (h & TIE) !== 0;
    const rest = (h & REST) !== 0;
    if (rest && (tie || tiedFrom)) return null;
    if (t + dur > total) return null;
    // a note may not cross a bar line
    if (Math.floor(t / TPBAR) !== Math.floor((t + dur - 1) / TPBAR)) return null;
    let midi: number | null = null;
    if (!rest) {
      if (tiedFrom) midi = prev;
      else {
        let z = 0;
        let mul = 1;
        for (;;) {
          if (i >= b.length || mul > 0x4000) return null;
          const c = b[i++];
          z += (c & 0x7f) * mul;
          mul *= 0x80;
          if (!(c & 0x80)) break;
        }
        midi = prev + unzigzag(z);
      }
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
      prev = midi;
    }
    while (chord + 1 < chords.length && t >= chords[chord + 1].start) chord++;
    notes.push({ midi, start: t, dur, ...(tie ? { tie: true } : {}), chord });
    tiedFrom = tie;
    t += dur;
  }
  if (i !== b.length || tiedFrom || !notes.length) return null;
  if (findTupletGroups(notes).errors.length) return null;

  // A stable id from the content, so opening the same link twice is one History entry.
  let h = 2166136261;
  for (const x of b) h = Math.imul(h ^ x, 16777619) >>> 0;
  return {
    version: 2,
    id: `${def.id}-${length}-k${keyPc}-t${tier}-s${h}`,
    seed: h,
    progressionId: def.id,
    length,
    keyPc,
    mode: def.mode,
    requestedTier: tier,
    ...(targetScore !== undefined ? { targetScore } : {}),
    chords,
    notes,
    totalTicks: total,
    fragmentIds: [],
    difficulty: scoreLick(notes, chords, def),
    createdAt: Date.now(),
  };
}

/** `<base>#l=<code>`; base is the page URL (any existing hash is replaced). */
export const shareUrl = (lick: Lick, base: string): string => `${base.replace(/#.*$/, '')}#${SHARE_PARAM}=${encodeLick(lick)}`;

export type ShareHash = { kind: 'none' } | { kind: 'invalid' } | { kind: 'lick'; lick: Lick };

/** Interpret location.hash. Anything without an `l=` parameter is 'none' (other hashes are not ours). */
export function parseShareHash(hash: string): ShareHash {
  const m = new RegExp(`^#?${SHARE_PARAM}=(.*)$`).exec(hash);
  if (!m) return { kind: 'none' };
  const lick = decodeLick(m[1]);
  return lick ? { kind: 'lick', lick } : { kind: 'invalid' };
}
