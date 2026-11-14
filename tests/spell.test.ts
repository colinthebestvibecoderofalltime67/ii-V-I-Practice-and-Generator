import { judgedChord } from '../src/theory/rhythm';
import { describe, expect, it } from 'vitest';
import {
  type Spelled, chordSymbolText, formatSpelling, spellChordRoot, spellLick, spellNote, spellScale, spelledPc,
} from '../src/theory/spell';
import { analyzeLick } from '../src/theory/analyze';
import { CHORDS } from '../src/theory/chords';
import { keySignatureName, mod12 } from '../src/theory/pitch';
import { LENGTHS, PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import { INSTRUMENTS, concertRange, getInstrument } from '../src/instruments';
import { generateLick } from '../src/generator';
import type { ChordQualityId, Lick, LickNote, LengthId } from '../src/types';

const sp = (s: string): Spelled => ({
  letter: s[0] as Spelled['letter'],
  acc: s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0,
});
const names = (xs: Spelled[]) => xs.map(x => formatSpelling(x));

function mkLick(progressionId: string, keyPc: number, midis: (number | null)[], tied: number[] = []): Lick {
  const def = getProgression(progressionId);
  const chords = expandProgression(def, 'standard', keyPc);
  const notes: LickNote[] = midis.map((m, i) => {
    const start = i * 12;
    const n: LickNote = { midi: m, start, dur: 12, chord: Math.min(2, Math.floor(start / 48)) };
    if (tied.includes(i)) n.tie = true;
    return n;
  });
  return {
    version: 2, id: 'x', seed: 1, progressionId, length: 'standard', keyPc, mode: def.mode, requestedTier: 1,
    chords, notes, totalTicks: 144, fragmentIds: [], difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0,
  };
}

const piano = getInstrument('piano');
const rootsOf = (progId: string, keyPc: number, inst = piano) => {
  const def = getProgression(progId);
  return def.slots.map(s => formatSpelling(spellChordRoot(mod12(keyPc + s.degree + inst.transpose), s.quality, mod12(keyPc + inst.transpose), def.mode)));
};
const chordSymbols = (progId: string, keyPc: number, inst = piano) =>
  analyzeLick(mkLick(progId, keyPc, new Array(12).fill(60)), inst).chords.map(c => c.symbol);

describe('chord roots by function', () => {
  it('minor ii-V-i', () => {
    expect(rootsOf('minor-251', 9)).toEqual(['B', 'E', 'A']);
    expect(rootsOf('minor-251', 3)).toEqual(['F', 'B♭', 'E♭']); // E♭ minor
    expect(rootsOf('minor-251', 2)).toEqual(['E', 'A', 'D']);
    expect(rootsOf('minor-251', 7)).toEqual(['A', 'D', 'G']);
  });
  it('tritone sub is ♭II, backdoor is iv and ♭VII', () => {
    expect(rootsOf('tritone-251', 7)).toEqual(['A', 'A♭', 'G']);
    expect(rootsOf('tritone-251', 0)).toEqual(['D', 'D♭', 'C']);
    expect(rootsOf('tritone-251', 1)).toEqual(['E♭', 'D', 'D♭']); // D♭: E𝄫 avoided
    expect(rootsOf('backdoor-251', 7)).toEqual(['C', 'F', 'G']);
    expect(rootsOf('backdoor-251', 2)).toEqual(['G', 'C', 'D']);
    expect(rootsOf('backdoor-251', 6)).toEqual(['B', 'E', 'G♭']); // C♭m7 / F♭7 avoided in G♭
  });
  it('chord symbols use ♭/♯ glyphs', () => {
    expect(chordSymbols('tritone-251', 7)).toEqual(['Am7', 'A♭7', 'Gmaj7']);
    expect(chordSymbols('backdoor-251', 7)).toEqual(['Cm7', 'F7', 'Gmaj7']);
    expect(chordSymbols('minor-251', 3)).toEqual(['Fm7♭5', 'B♭7alt', 'E♭m6']);
    expect(chordSymbols('major-251', 8, getInstrument('trumpet'))).toEqual(['Cm7', 'F7', 'B♭maj7']);
    expect(expandProgression(getProgression('tritone-251'), 'standard', 7).map(c => c.symbol)).toEqual(['Am7', 'A♭7', 'Gmaj7']);
    expect(chordSymbolText(sp('Ab'), 'dom7', 'ascii')).toBe('Ab7');
  });
});

describe('G♯ minor', () => {
  it('V is D♯7alt, not E♭7alt (alto sax, concert B minor)', () => {
    expect(rootsOf('minor-251', 11, getInstrument('alto-sax'))).toEqual(['A♯', 'D♯', 'G♯']);
    expect(chordSymbols('minor-251', 11, getInstrument('alto-sax'))).toEqual(['A♯m7♭5', 'D♯7alt', 'G♯m6']);
  });
  it('double accidentals format for unicode, ascii and VexFlow', () => {
    const f = { letter: 'F', acc: 2, octave: 4 } as const;
    expect(formatSpelling(f)).toBe('F𝄪');
    expect(formatSpelling(f, 'ascii')).toBe('F##');
    expect(formatSpelling(f, 'vex')).toBe('f##/4');
    expect(formatSpelling({ letter: 'B', acc: -2, octave: 4 }, 'vex')).toBe('bbb/4');
    expect(formatSpelling({ letter: 'B', acc: -2 })).toBe('B𝄫');
  });
});

describe('scales', () => {
  it('review examples', () => {
    expect(names(spellScale(sp('A'), 'm6'))).toEqual(['A', 'B', 'C', 'D', 'E', 'F♯', 'G♯']);
    expect(names(spellScale(sp('E'), 'dom7alt'))).toEqual(['E', 'F', 'G', 'G♯', 'B♭', 'C', 'D']);
    expect(names(spellScale(sp('G'), 'dom7alt'))).toEqual(['G', 'A♭', 'B♭', 'B', 'D♭', 'E♭', 'F']);
    expect(names(spellScale(sp('Ab'), 'dom7'))).toEqual(['A♭', 'B♭', 'C', 'D♭', 'E♭', 'F', 'G♭']);
    expect(names(spellScale(sp('F'), 'dom7'))).toEqual(['F', 'G', 'A', 'B♭', 'C', 'D', 'E♭']);
    expect(names(spellScale(sp('Gb'), 'maj7'))).toEqual(['G♭', 'A♭', 'B♭', 'C♭', 'D♭', 'E♭', 'F']);
    expect(names(spellScale(sp('F'), 'm7b5'))).toEqual(['F', 'G♭', 'A♭', 'B♭', 'C♭', 'D♭', 'E♭']);
    expect(names(spellScale(sp('G#'), 'm6'))).toEqual(['G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯', 'F𝄪']);
    expect(names(spellScale(sp('D#'), 'dom7alt'))).toEqual(['D♯', 'E', 'F♯', 'F𝄪', 'A', 'B', 'C♯']);
    expect(names(spellScale(sp('Db'), 'dom7alt'))).toEqual(['D♭', 'D', 'E', 'F', 'G', 'A', 'C♭']); // tensions avoid doubles
  });
  it('analyze panel uses the sheet spelling (A minor)', () => {
    const l = mkLick('minor-251', 9, new Array(12).fill(69));
    const a = analyzeLick(l, piano);
    expect(a.chords.map(c => c.symbol)).toEqual(['Bm7♭5', 'E7alt', 'Am6']);
    expect(a.chords[2].scaleNotes).toEqual(['A', 'B', 'C', 'D', 'E', 'F♯', 'G♯']);
    expect(a.chords[1].scaleNotes).toEqual(['E', 'F', 'G', 'G♯', 'B♭', 'C', 'D']);
  });
});

describe('note spelling', () => {
  const at = (rootName: string, q: ChordQualityId, midi: number, direction: 'up' | 'down' | null = null) =>
    formatSpelling(spellNote(midi, { root: sp(rootName), quality: q, direction }), 'unicode') + spellNote(midi, { root: sp(rootName), quality: q, direction }).octave;
  it('review cases', () => {
    expect(at('E', 'dom7alt', 68)).toBe('G♯4'); // 3rd of E7alt in A minor
    expect(at('A', 'm6', 66)).toBe('F♯4'); // 6th of Am6
    expect(at('A', 'dom7alt', 61)).toBe('C♯4'); // D minor
    expect(at('D', 'dom7alt', 66)).toBe('F♯4'); // G minor
    expect(at('Ab', 'dom7', 66)).toBe('G♭4'); // tritone sub in G: b7
    expect(at('Ab', 'dom7', 63)).toBe('E♭4'); // 5th
    expect(at('C', 'm7', 63)).toBe('E♭4'); // backdoor in G: iv b3
    expect(at('G', 'm7', 70)).toBe('B♭4'); // backdoor in D
    expect(at('F', 'm7b5', 59)).toBe('C♭4'); // E♭ minor: b5 of Fø (B3 sounds, C♭4 written)
    expect(at('F', 'm7b5', 71)).toBe('C♭5');
    expect(at('G#', 'm6', 67)).toBe('F𝄪4'); // leading tone of G♯ minor keeps its letter
    expect(at('D#', 'dom7alt', 67)).toBe('F𝄪4'); // 3rd of D♯7alt
  });
  it('chromatic notes by direction', () => {
    expect(at('C', 'maj7', 66, 'up')).toBe('F♯4');
    expect(at('C', 'maj7', 66, 'down')).toBe('G♭4');
    expect(at('C', 'maj7', 65, 'down')).toBe('F4'); // white keys never get a spurious accidental
    expect(at('D', 'm7', 61, null)).toBe('D♭4'); // no direction, no hint: flat
  });
  it('tied continuation over a chord change keeps its spelling', () => {
    // A minor: tie E7alt's G♯ into the Am6 bar
    const l = mkLick('minor-251', 9, [null, null, null, null, 64, 68, 68, 69, 69, 69, 69, 69], [6]);
    l.notes[6].chord = 1; l.notes[7].chord = 2;
    const s = spellLick(l, piano);
    expect(formatSpelling(s[6]!)).toBe('G♯');
    expect(formatSpelling(s[7]!)).toBe('A'); // untied A
  });
});

// ---------------------------------------------------------------------------------------------------------
// Sweep: every progression x length x 12 keys x every instrument
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const KEY_SIG_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_SIG_MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const TONE_STEP: Record<number, number> = { 0: 0, 3: 2, 4: 2, 6: 4, 7: 4, 10: 6, 11: 6 };

describe('sweep', () => {
  it('key signatures are unchanged for every key and instrument', () => {
    for (let k = 0; k < 12; k++) {
      expect(keySignatureName(k, 'major')).toBe(KEY_SIG_MAJOR[k]);
      expect(keySignatureName(k, 'minor')).toBe(KEY_SIG_MINOR[k]);
    }
  });

  it('scales have distinct letters, chord tones sit on their degree letter, doubles are rare', () => {
    const rangeCache = new Map<string, [number, number]>();
    let scaleDoubles = 0;
    let scaleRepeats = 0;
    let noteDoubles = 0;
    let notes = 0;
    let licks = 0;
    const doubleCases = new Set<string>();
    const noteDoubleKeys = new Set<string>();
    const bad: string[] = [];
    for (const p of PROGRESSIONS) {
      for (const length of Object.keys(LENGTHS) as LengthId[]) {
        for (let keyPc = 0; keyPc < 12; keyPc++) {
          for (const inst of INSTRUMENTS) {
            const wk = mod12(keyPc + inst.transpose);
            const label = `${p.id}/${length}/k${keyPc}/${inst.id}`;
            // (a) scales
            const chords = expandProgression(p, length, keyPc);
            for (const c of chords) {
              const root = spellChordRoot(mod12(c.rootPc + inst.transpose), c.quality, wk, p.mode);
              expect(spelledPc(root), label).toBe(mod12(c.rootPc + inst.transpose));
              const sc = spellScale(root, c.quality);
              sc.forEach((s, i) => expect(spelledPc(s), label).toBe(mod12(c.rootPc + inst.transpose + CHORDS[c.quality].scale[i])));
              const letters = new Set(sc.map(s => s.letter));
              if (c.quality === 'dom7alt') { if (letters.size < 5) bad.push(`${label} alt letters ${names(sc)}`); } // altered: the 3rd shares a letter with the ♯9; a double accidental is replaced by a neighbouring letter
              else if (letters.size !== 7) { scaleRepeats++; bad.push(`${label} ${c.quality} ${names(sc)}`); }
              const dbl = sc.filter(s => Math.abs(s.acc) > 1);
              if (dbl.length) {
                scaleDoubles += dbl.length;
                doubleCases.add(`${p.mode} written key ${keySignatureName(wk, p.mode)}: ${formatSpelling(root)}${c.quality} -> ${names(sc).join(' ')}`);
              }
            }
            // (b) generated licks
            {
              const rk = inst.id;
              if (!rangeCache.has(rk)) rangeCache.set(rk, concertRange(inst));
              const range = rangeCache.get(rk)!;
              for (const seed of [1, 2]) {
                const tier = ((seed + keyPc) % 4 + 1) as 1 | 2 | 3 | 4;
                const lick = generateLick({ progressionId: p.id, length, keyPc, tier, range, seed });
                licks++;
                const spelled = spellLick(lick, inst);
                lick.notes.forEach((n, i) => {
                  const s = spelled[i];
                  if (n.midi == null) { expect(s, label).toBeNull(); return; }
                  notes++;
                  expect(s, label).not.toBeNull();
                  // spelled pitch equals the written pitch
                  const midi = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[s!.letter] + s!.acc + 12 * (s!.octave + 1);
                  expect(midi, label).toBe(n.midi + inst.transpose);
                  if (Math.abs(s!.acc) > 1) { noteDoubles++; noteDoubleKeys.add(`${p.mode} ${keySignatureName(wk, p.mode)}`); }
                  const c = lick.chords[judgedChord(lick.notes, i)]; // anticipations belong to the chord they arrive on
                  const wroot = spellChordRoot(mod12(c.rootPc + inst.transpose), c.quality, wk, p.mode);
                  const rel = mod12(n.midi - c.rootPc);
                  const tone = CHORDS[c.quality].tones.includes(rel);
                  const prev = lick.notes[i - 1];
                  const cont = prev && prev.tie && prev.midi === n.midi;
                  if (tone && !cont) {
                    let step = TONE_STEP[rel];
                    if (rel === 9) step = 5;
                    const want = LETTERS[(LETTERS.indexOf(wroot.letter) + step) % 7];
                    if (s!.letter !== want) bad.push(`${label} note ${i} rel ${rel} ${formatSpelling(s!)} want letter ${want} over ${formatSpelling(wroot)}${c.quality}`);
                  }
                });
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`sweep: ${licks} licks, ${notes} notes; scale doubles ${scaleDoubles} (${doubleCases.size} distinct cases), note doubles ${noteDoubles} in ${[...noteDoubleKeys].join(', ')}, scale letter repeats ${scaleRepeats}`);
    console.log([...doubleCases].join('\n')); // eslint-disable-line no-console
    expect(bad).toEqual([]);
    // double accidentals only ever appear in G♯ minor (D♯7alt's F𝄪, G♯m6's F𝄪) and the odd extreme key, never in common keys
    for (const k of noteDoubleKeys) expect(['minor G#m']).toContain(k);
    for (const c of doubleCases) expect(c).toMatch(/^minor written key G#m: /);
  }, 120000);
});
