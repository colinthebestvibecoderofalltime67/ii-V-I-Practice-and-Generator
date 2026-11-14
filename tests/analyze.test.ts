import { describe, expect, it } from 'vitest';
import { SCALE_NAMES, analyzeLick, degreeLabel, noteKind } from '../src/theory/analyze';
import { CHORDS } from '../src/theory/chords';
import { getInstrument } from '../src/instruments';
import { expandProgression, getProgression } from '../src/theory/progressions';
import { generateLick } from '../src/generator';
import { concertRange } from '../src/instruments';
import type { ChordQualityId, Lick, LickNote } from '../src/types';

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe('scale names match the scale sets', () => {
  const SETS: Record<string, number[]> = {
    Dorian: [0, 2, 3, 5, 7, 9, 10],
    Locrian: [0, 1, 3, 5, 6, 8, 10],
    Mixolydian: [0, 2, 4, 5, 7, 9, 10],
    Altered: [0, 1, 3, 4, 6, 8, 10],
    'Ionian (major)': [0, 2, 4, 5, 7, 9, 11],
    'Melodic minor': [0, 2, 3, 5, 7, 9, 11],
  };
  it.each(Object.keys(SCALE_NAMES) as ChordQualityId[])('%s', q => {
    expect(sorted(CHORDS[q].scale)).toEqual(SETS[SCALE_NAMES[q]]);
  });
});

describe('degreeLabel', () => {
  const cases: [ChordQualityId, string[]][] = [
    ['m7', ['R', '♭9', '9', '♭3', '3', '11', '♭5', '5', '♭13', '13', '♭7', '7']],
    ['m7b5', ['R', '♭9', '9', '♭3', '3', '11', '♭5', '5', '♭13', '13', '♭7', '7']],
    ['dom7', ['R', '♭9', '9', '♯9', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7']],
    ['dom7alt', ['R', '♭9', '9', '♯9', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7']],
    ['maj7', ['R', '♭9', '9', '♯9', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7']],
    ['m6', ['R', '♭9', '9', '♭3', '3', '11', '♭5', '5', '♭13', '6', '♭7', '7']],
    ['mMaj7', ['R', '♭9', '9', '♭3', '3', '11', '♭5', '5', '♭13', '13', '♭7', '7']],
  ];
  it.each(cases)('%s', (q, labels) => {
    for (let rel = 0; rel < 12; rel++) {
      expect(degreeLabel(60 + 7 + rel + 12, 7, q)).toBe(labels[rel]);
    }
  });
  it('key facts', () => {
    expect(degreeLabel(67 + 3, 7, 'dom7alt')).toBe('♯9');
    expect(degreeLabel(62 + 3, 2, 'm7')).toBe('♭3');
  });
});

describe('noteKind', () => {
  it('classifies', () => {
    // G7 (root 7): B chord tone, A tension (9), C scale (11), G# chromatic
    expect(noteKind(71, 7, 'dom7')).toBe('chord');
    expect(noteKind(69, 7, 'dom7')).toBe('tension');
    expect(noteKind(72, 7, 'dom7')).toBe('scale');
    expect(noteKind(68, 7, 'dom7')).toBe('chromatic');
    // G7alt: Ab is a tension, B natural chord tone, D (5) chromatic
    expect(noteKind(68, 7, 'dom7alt')).toBe('tension');
    expect(noteKind(74, 7, 'dom7alt')).toBe('chromatic');
    // Dm7: E is the 9 (tension), B the 13 (scale)
    expect(noteKind(64, 2, 'm7')).toBe('tension');
    expect(noteKind(71, 2, 'm7')).toBe('scale'); // B = 13 in Dorian
  });
});

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

describe('analyzeLick', () => {
  const flute = getInstrument('flute');
  it('Dm7-G7-Cmaj7 in C: scales, labels, approach marking, rests, ties', () => {
    // D F A C | G# A B(tie) B | C(tie)... bars: 4 quarter notes per chord
    const l = mkLick('major-251', 0, [62, 65, 69, 72, 68, 69, 71, 71, 72, null, 76, 79], [6]);
    const a = analyzeLick(l, flute);
    expect(a.chords.map(c => c.symbol)).toEqual(['Dm7', 'G7', 'Cmaj7']);
    expect(a.chords.map(c => c.scaleName)).toEqual(['Dorian', 'Mixolydian', 'Ionian (major)']);
    expect(a.chords[0].scaleNotes).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C']);
    expect(a.chords[1].scaleNotes).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(a.chords[2].scaleNotes).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(a.chords.map(c => c.roman)).toEqual(['ii7', 'V7', 'Imaj7']);
    expect(a.notes.slice(0, 4).map(n => n!.label)).toEqual(['R', '♭3', '5', '♭7']);
    expect(a.notes.slice(0, 4).map(n => n!.kind)).toEqual(['chord', 'chord', 'chord', 'chord']);
    expect(a.notes[4]).toEqual({ label: '♭9', kind: 'chromatic', approach: true }); // G# over G7, resolves to A
    expect(a.notes[5]!.label).toBe('9');
    expect(a.notes[5]!.kind).toBe('tension');
    expect(a.notes[6]!.label).toBe('3'); // tied note keeps label
    expect(a.notes[7]).toBeNull(); // tie continuation
    expect(a.notes[9]).toBeNull(); // rest
    expect(a.notes[10]!.label).toBe('3');
  });

  it('chromatic note not moving by a half step is not an approach', () => {
    const l = mkLick('major-251', 0, [62, 65, 69, 72, 68, 72, 71, 67, 72, 71, 76, 79]);
    expect(analyzeLick(l, flute).notes[4]).toMatchObject({ kind: 'chromatic', approach: false });
  });

  it('minor iiø-V-i in C: Locrian, Altered, melodic minor; altered spelling G A♭ B♭ B D♭ E♭ F', () => {
    const l = mkLick('minor-251', 0, [62, 65, 68, 72, 68, 71, 75, 77, 72, 75, 79, 81]);
    const a = analyzeLick(l, flute);
    expect(a.chords.map(c => c.symbol)).toEqual(['Dm7♭5', 'G7alt', 'Cm6']);
    expect(a.chords.map(c => c.scaleName)).toEqual(['Locrian', 'Altered', 'Melodic minor']);
    expect(a.chords[0].scaleNotes).toEqual(['D', 'E♭', 'F', 'G', 'A♭', 'B♭', 'C']);
    expect(a.chords[1].scaleNotes).toEqual(['G', 'A♭', 'B♭', 'B', 'D♭', 'E♭', 'F']);
    expect(a.chords[2].scaleNotes).toEqual(['C', 'D', 'E♭', 'F', 'G', 'A', 'B']);
    expect(a.notes[9]!.label).toBe('♭3');
    expect(a.notes[11]!.label).toBe('6');
  });

  it('spells for the written key on transposing instruments', () => {
    // alto sax (+9): Dm7 G7 Cmaj7 in C is written B m7 -> E7 -> A maj7 ... in A major (sharps)
    const alto = getInstrument('alto');
    const l = mkLick('major-251', 0, new Array(12).fill(60));
    const a = analyzeLick(l, alto);
    expect(a.chords.map(c => c.symbol)).toEqual(['Bm7', 'E7', 'Amaj7']);
    expect(a.chords[0].scaleNotes).toEqual(['B', 'C♯', 'D', 'E', 'F♯', 'G♯', 'A']);
    // trumpet (+2): Dm7 G7 Cmaj7 -> Em7 A7 Dmaj7 (D major, sharps)
    const tpt = analyzeLick(l, getInstrument('trumpet'));
    expect(tpt.chords.map(c => c.symbol)).toEqual(['Em7', 'A7', 'Dmaj7']);
    expect(tpt.chords[2].scaleNotes).toEqual(['D', 'E', 'F♯', 'G', 'A', 'B', 'C♯']);
    // flat key: Eb with a concert-pitch instrument
    const eb = mkLick('major-251', 3, new Array(12).fill(60));
    const e = analyzeLick(eb, flute);
    expect(e.chords.map(c => c.symbol)).toEqual(['Fm7', 'B♭7', 'E♭maj7']);
    expect(e.chords[0].scaleNotes).toEqual(['F', 'G', 'A♭', 'B♭', 'C', 'D', 'E♭']);
  });

  it('is parallel to lick.notes for generated licks', () => {
    const l = generateLick({ progressionId: 'tritone-251', length: 'long', keyPc: 5, tier: 4, range: concertRange(flute), seed: 3 });
    const a = analyzeLick(l, flute);
    expect(a.notes.length).toBe(l.notes.length);
    l.notes.forEach((n, i) => {
      if (n.midi == null) expect(a.notes[i]).toBeNull();
      else if (a.notes[i]) expect(a.notes[i]!.label).toBeTruthy();
    });
  });
});

describe('chromatic labels follow the sheet spelling', () => {
  it('labels match spelled accidentals across a sweep', async () => {
    const { generateLick } = await import('../src/generator/generate');
    const { concertRange, getInstrument } = await import('../src/instruments');
    const { spellLick } = await import('../src/theory/spell');
    const inst = getInstrument('alto');
    let checked = 0;
    for (const p of ['major-251', 'major-251-alt', 'minor-251', 'tritone-251', 'backdoor-251']) {
      for (let seed = 1; seed <= 30; seed++) {
        const l = generateLick({ progressionId: p, length: 'standard', keyPc: seed % 12, tier: 4, range: concertRange(inst), seed });
        const a = analyzeLick(l, inst);
        const sp = spellLick(l, inst);
        a.notes.forEach((n, i) => {
          if (!n || n.kind !== 'chromatic') return;
          checked++;
          const acc = sp[i]!.acc;
          // a sharp-spelled note never gets a flat label and vice versa (relative to a natural-root chord the signs agree)
          // (an altered root letter keeps the usual name ♭9 — players don't say ♯1)
          if (acc > 0 && n.label !== '♭9') expect(n.label.startsWith('♭'), `${p} ${seed} ${n.label}`).toBe(false);
        });
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
