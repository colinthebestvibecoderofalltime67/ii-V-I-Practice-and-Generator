import { describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import { INSTRUMENTS, concertRange, getInstrument } from '../src/instruments';
import { analyzeLick } from '../src/theory/analyze';
import { formatSpelling, keyAccidentalCount, spellLick, spellNote, type Spelled } from '../src/theory/spell';
import { expandProgression, getProgression } from '../src/theory/progressions';
import { mod12 } from '../src/theory/pitch';
import type { ChordQualityId, Lick, LickNote, Tier } from '../src/types';

/* Spelling fix round FX3: ♯11 over maj7, one ♭6 per bar, enclosures and tensions not overridden by propagation, no E♯/B♯ in plain keys. */

const sp = (s: string): Spelled => ({ letter: s[0] as Spelled['letter'], acc: s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0 });
const f = (s: Spelled | null) => (s ? formatSpelling(s) : '-');
const piano = getInstrument('piano');

/** Notes of 12 ticks, all inside chord `chordIdx` (standard progression); returns the spelling of just those notes. */
function over(progressionId: string, keyPc: number, chordIdx: number, midis: number[]): string[] {
  const def = getProgression(progressionId);
  const chords = expandProgression(def, 'standard', keyPc);
  const notes: LickNote[] = midis.map((m, i) => ({ midi: m, start: chordIdx * 48 + i * 12, dur: 12, chord: chordIdx }));
  const lick: Lick = {
    version: 2, id: 'x', seed: 1, progressionId, length: 'standard', keyPc, mode: def.mode, requestedTier: 1,
    chords, notes, totalTicks: chords.length * 48, fragmentIds: [], difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0,
  };
  return spellLick(lick, piano).map(f);
}

describe('♯11 of a major 7th is the 4th letter sharp', () => {
  const at = (root: string, q: ChordQualityId, midi: number, direction: 'up' | 'down' | null = null) => f(spellNote(midi, { root: sp(root), quality: q, direction }));
  it('A♯ over Emaj7, D♯ over Amaj7, G♯ over Dmaj7, whatever the direction', () => {
    for (const d of ['up', 'down', null] as const) {
      expect(at('E', 'maj7', 70, d)).toBe('A♯');
      expect(at('A', 'maj7', 63, d)).toBe('D♯');
      expect(at('D', 'maj7', 68, d)).toBe('G♯');
    }
    expect(at('F#', 'maj7', 72)).toBe('C'); // B♯ would be needed: the plain ♭5
  });
  it('a lick over the I chord writes and labels it that way', () => {
    // key E (chord 2 = Emaj7): B, A♯, B, E
    expect(over('major-251', 4, 2, [71, 70, 71, 64])).toEqual(['B', 'A♯', 'B', 'E']);
  });
});

describe('dom7 tritone: ♯11 to the 5th or 3rd, ♭5 to the 4th', () => {
  it('C7: F♯ → G and F♯ → E, G♭ → F', () => {
    expect(over('major-251', 5, 1, [66, 67, 66, 64, 66, 65])).toEqual(['F♯', 'G', 'F♯', 'E', 'G♭', 'F']);
  });
});

describe('Barry Harris ♭6 is written one way in the bar', () => {
  it('F♭ over A♭maj7, D♭ over Fmaj7, F over Amaj7, whichever way the line moves', () => {
    const cases: [number, string, number[]][] = [[8, 'F♭', [68, 64, 67, 64, 68, 64]], [5, 'D♭', [65, 61, 64, 61, 65, 61]], [9, 'F', [69, 65, 68, 65, 69, 65]]];
    for (const [key, name, midis] of cases) {
      const s = over('major-251', key, 2, midis);
      const flat6 = [...new Set(s.filter((_, i) => mod12(midis[i]) === mod12(key + 8)))];
      expect(flat6, `key ${key}`).toEqual([name]);
    }
  });
  it('m6 and mMaj7 share the ♭6', () => {
    for (const q of ['m6', 'mMaj7'] as const) for (const d of ['up', 'down', null] as const) expect(f(spellNote(65, { root: sp('A'), quality: q, direction: d }))).toBe('F');
  });
});

describe('propagation does not override tensions or enclosure upper neighbours', () => {
  it('D7 in G: ♭9 is E♭ and ♭13 is B♭, beside sharp resolving notes', () => {
    const s = over('major-251', 7, 1, [63, 66, 70, 69, 65, 66]);
    expect(s[0]).toBe('E♭');
    expect(s[2]).toBe('B♭');
  });
  it('♭13 of B♭7 is G♭, never F♯', () => {
    expect(f(spellNote(66, { root: sp('Bb'), quality: 'dom7', direction: 'up' }))).toBe('G♭');
  });
  it('B♭–G♯–A over Cmaj7 and Dmaj7', () => {
    expect(over('major-251', 0, 2, [70, 68, 69, 67])).toEqual(['B♭', 'G♯', 'A', 'G']);
    expect(over('major-251', 2, 2, [70, 68, 69, 66])).toEqual(['B♭', 'G♯', 'A', 'F♯']);
  });
});

describe('no E♯ / B♯ / F♭ / C♭ as chromatic neighbours in plain keys', () => {
  it('E♯ under F♯ in G and D, ♯9 of D7 in F, B♯ over Amaj7 fall back to the white key', () => {
    expect(over('major-251', 7, 2, [65, 66, 71, 66])[0]).toBe('F');
    expect(over('major-251', 2, 2, [65, 66, 69, 66])[0]).toBe('F');
    expect(over('major-251', 5, 1, [65, 66, 69, 72])[0]).toBe('F');
    expect(over('major-251', 9, 2, [72, 73, 76, 73])[0]).toBe('C');
  });
  it('keyAccidentalCount', () => {
    expect([0, 7, 2, 11, 6, 1].map(k => keyAccidentalCount(k))).toEqual([0, 1, 2, 5, 6, 5]);
    expect(keyAccidentalCount(9, 'minor')).toBe(0);
    expect(keyAccidentalCount(8, 'minor')).toBe(5);
  });
  it('sweep: E♯ B♯ F♭ C♭ never appear on a chromatic passing note in a key with fewer than 6 accidentals, except the letter-fixed ♭6 / ♭9 / ♭13 and the 9 of a half-diminished chord', () => {
    let notes = 0, bad = 0;
    for (const id of ['major-251', 'minor-251', 'turnaround', 'chain-36251', 'coltrane']) {
      for (let s = 0; s < 40; s++) {
        const inst = INSTRUMENTS[s % INSTRUMENTS.length];
        const l = generateLick({ progressionId: id, length: 'standard', keyPc: s % 12, tier: (1 + (s % 4)) as Tier, range: concertRange(inst), seed: 7000 + s });
        const sps = spellLick(l, inst);
        const an = analyzeLick(l, inst);
        const acc = keyAccidentalCount(mod12(l.keyPc + inst.transpose), l.mode);
        l.notes.forEach((n, i) => {
          if (n.midi == null || !sps[i]) return;
          notes++;
          const a = an.notes[i];
          if (!a || a.kind !== 'chromatic' || acc >= 6) return;
          if (['E♯', 'B♯', 'F♭', 'C♭'].includes(f(sps[i])) && !/^♭?(6|9|13)$/.test(a.label)) bad++;
        });
      }
    }
    expect(notes).toBeGreaterThan(2000);
    expect(bad).toBe(0);
  });
});
