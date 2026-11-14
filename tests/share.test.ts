import { describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import { INSTRUMENTS, concertRange, getInstrument } from '../src/instruments';
import { isValidLick } from '../src/storage';
import { analyzeLick } from '../src/theory/analyze';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { decodeLick, encodeLick, parseShareHash, shareUrl } from '../src/share';
import { isTupletDur } from '../src/theory/rhythm';
import type { LengthId, Lick, Tier } from '../src/types';
import { FULL_SWEEP } from './_samples';

const lengths = Object.keys(LENGTHS) as LengthId[];
const range = concertRange(getInstrument('alto'));

function roundTrip(l: Lick): string {
  const code = encodeLick(l);
  const d = decodeLick(code);
  expect(d, l.id).not.toBeNull();
  expect(d!.notes).toEqual(l.notes);
  expect(d!.chords).toEqual(l.chords);
  expect(d!.progressionId).toBe(l.progressionId);
  expect(d!.keyPc).toBe(l.keyPc);
  expect(d!.mode).toBe(l.mode);
  expect(d!.length).toBe(l.length);
  expect(d!.totalTicks).toBe(l.totalTicks);
  expect(d!.requestedTier).toBe(l.requestedTier);
  expect(d!.difficulty.score).toBeCloseTo(l.difficulty.score, 6);
  expect(isValidLick(d)).toBe(true);
  expect(() => analyzeLick(d!, getInstrument('alto'))).not.toThrow();
  return code;
}

describe('share codes', () => {
  it('round-trips generated licks across progressions, lengths, targets and keys', () => {
    let triplets = 0, ties = 0, rests = 0, n = 0;
    const maxLen: Record<string, number> = {};
    for (const p of PROGRESSIONS) for (const length of lengths) for (const target of [5, 30, 55, 80, 100]) for (let s = 0; s < 4; s++) {
      const tier = ([1, 2, 3, 4] as Tier[])[Math.min(3, Math.floor(target / 26))];
      const l = generateLick({ progressionId: p.id, length, keyPc: (s * 5 + target) % 12, tier, targetScore: target, range, seed: s * 101 + target });
      const code = roundTrip(l);
      maxLen[length] = Math.max(maxLen[length] ?? 0, code.length);
      n++;
      if (l.notes.some(x => isTupletDur(x.dur))) triplets++;
      if (l.notes.some((x, i) => x.tie && x.chord !== l.notes[i + 1]?.chord)) ties++;
      if (l.notes[0].midi == null) rests++;
    }
    expect(n).toBe(PROGRESSIONS.length * 3 * 5 * 4);
    expect(triplets).toBeGreaterThan(0);
    expect(ties).toBeGreaterThan(0);
    expect(rests).toBeGreaterThan(0);
    // target: 3-bar link under ~200 characters, 6-bar under ~400
    expect(maxLen.standard).toBeLessThan(200);
    expect(maxLen.long).toBeLessThan(400);
    expect(maxLen.short).toBeLessThan(200);
  }, 60000);

  it('decoded id is stable, and shareUrl/parseShareHash agree', () => {
    const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 3, tier: 3, range, seed: 5 });
    const url = shareUrl(l, 'https://example.com/app/?x=1#old');
    expect(url.startsWith('https://example.com/app/?x=1#l=')).toBe(true);
    const hash = url.slice(url.indexOf('#'));
    const a = parseShareHash(hash);
    const b = parseShareHash(hash);
    expect(a.kind).toBe('lick');
    if (a.kind === 'lick' && b.kind === 'lick') expect(a.lick.id).toBe(b.lick.id);
    expect(parseShareHash('').kind).toBe('none');
    expect(parseShareHash('#other').kind).toBe('none');
    expect(parseShareHash('#l=!!!').kind).toBe('invalid');
  });

  it('rejects malformed codes and never throws on mutated ones', () => {
    const l = generateLick({ progressionId: 'minor-251', length: 'long', keyPc: 7, tier: 4, targetScore: 90, range, seed: 9 });
    const code = encodeLick(l);
    for (const c of ['', 'A', '!!!!', code.slice(0, -3), code + 'AA', code.slice(0, 10), 'AAAA', '_____']) expect(decodeLick(c), c).toBeNull();
    const b = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const flip = (i: number, v: number) =>
      btoa(Array.from(b, (ch, k) => String.fromCharCode(k === i ? v : ch.charCodeAt(0))).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeLick(flip(0, 0x30 | (b.charCodeAt(0) & 15)))).toBeNull(); // unknown version
    expect(decodeLick(flip(1, 0xf0 | (b.charCodeAt(1) & 15)))).toBeNull(); // unknown progression
    expect(decodeLick(flip(1, (b.charCodeAt(1) & 0xf0) | 13))).toBeNull(); // key > 11
    expect(decodeLick(flip(2, 255))).toBeNull(); // score > 100
    expect(decodeLick(flip(3, 0xff))).toBeNull(); // bad note header
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 2000; k++) {
      const d = decodeLick(flip(Math.floor(rnd() * b.length), Math.floor(rnd() * 256)));
      if (d) expect(isValidLick(d)).toBe(true);
    }
  });

  it('encodes a quarter-triplet pair (dur 16) and still decodes v1 links', { timeout: 60_000 }, () => {
    // find a lick with a 2-unit quarter triplet (dur 16); which seed produces one changes as the generator evolves
    let l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 4, targetScore: 90, range, seed: 356 });
    for (let seed = 1; seed < 3000 && !l.notes.some(n => n.dur === 16); seed++) {
      l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 4, targetScore: 90, range, seed });
    }
    expect(l.notes.some(n => n.dur === 16)).toBe(true);
    expect(() => shareUrl(l, 'https://x.test/')).not.toThrow();
    roundTrip(l);
    // a v1 link (version nibble 1, no dur 16) written by the old encoder must keep decoding to the same lick
    const l1 = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 2, tier: 2, range, seed: 3 });
    const bytes = Array.from(atob(encodeLick(l1).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    bytes[0] = (bytes[0] & 0x0f) | 0x10;
    const v1 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const d = decodeLick(v1);
    expect(d).not.toBeNull();
    expect(d!.notes).toEqual(l1.notes);
  });

  it('sweep: every generated lick (instruments x progressions x lengths x targets x seeds) encodes and round-trips', () => {
    // Default: every instrument x progression x length with 2 of the 4 targets (alternating by instrument) and 1 seed (~450 licks);
    // SWEEP=full: all 4 targets x 2 seeds (1800 licks).
    const targets = [15, 50, 85, 100];
    const seeds = FULL_SWEEP ? 2 : 1;
    let n = 0;
    let expected = 0;
    INSTRUMENTS.forEach((inst, ii) => {
      for (const p of PROGRESSIONS) for (const length of lengths) targets.forEach((target, ti) => {
        if (!FULL_SWEEP && (ti + ii) % 2 === 1) return;
        for (let s = 0; s < seeds; s++) {
          expected++;
          const tier = ([1, 2, 3, 4] as Tier[])[Math.min(3, Math.floor(target / 26))];
          const l = generateLick({ progressionId: p.id, length, keyPc: (s * 7 + target + n) % 12, tier, targetScore: target, range: concertRange(inst), seed: s * 977 + target + n });
          const d = decodeLick(encodeLick(l));
          expect(d, `${inst.id} ${l.id}`).not.toBeNull();
          expect(d!.notes).toEqual(l.notes);
          n++;
        }
      });
    });
    expect(n).toBe(expected);
    expect(n).toBe(INSTRUMENTS.length * PROGRESSIONS.length * 3 * (FULL_SWEEP ? 4 * 2 : 2));
    expect(n).toBeGreaterThan(FULL_SWEEP ? 1500 : 400);
  }, 240000);
});
