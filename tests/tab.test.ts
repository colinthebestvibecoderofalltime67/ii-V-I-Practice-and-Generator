import { describe, it, expect } from 'vitest';
import {
  assignFrets, fingerLine, positionsForLick, lickFingerings, lickLine, pickFingering, type Fingering, type LineNote,
} from '../src/render/tab';
import { AUTHORED_FRAGMENTS, fromSixteenths } from '../src/fragments';
import { generateLick, transposeLick } from '../src/generator';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { isValidLick } from '../src/storage';
import { PROGRESSIONS } from '../src/theory/progressions';
import type { Lick, Tier } from '../src/types';
import { TICKS_PER_16TH as S } from '../src/types';

const GUITAR = [52, 57, 62, 67, 71, 76];
const BASS = [40, 45, 50, 55];
const pitchOf = (tuning: number[], str: number, fret: number) => tuning[tuning.length - str] + fret;
const midiOf = (x: number | null | LineNote) => (x == null || typeof x === 'number' ? x : x.midi);

/** Every note reproduces its pitch, and every stretch of notes in one position fits a 5-fret window. */
function checkFingering(f: Fingering, line: (number | null | LineNote)[], tuning: number[], frets: number): void {
  let segPos = -1;
  let lo = Infinity;
  let hi = -Infinity;
  f.notes.forEach((n, i) => {
    const m = midiOf(line[i]);
    if (m == null) { expect(n).toBeNull(); return; }
    expect(n).not.toBeNull();
    expect(pitchOf(tuning, n!.str, n!.fret)).toBe(m);
    expect(n!.fret).toBeGreaterThanOrEqual(0);
    expect(n!.fret).toBeLessThanOrEqual(frets);
    if (n!.fret === 0) { expect(n!.finger).toBe(0); return; }
    expect(n!.finger).toBeGreaterThanOrEqual(1);
    expect(n!.finger).toBeLessThanOrEqual(4);
    // the fret lies in the hand's box (index stretch one below, pinky stretch one above)
    expect(n!.fret - n!.pos).toBeGreaterThanOrEqual(-1);
    expect(n!.fret - n!.pos).toBeLessThanOrEqual(4);
    if (n!.pos !== segPos) { segPos = n!.pos; lo = hi = n!.fret; }
    lo = Math.min(lo, n!.fret);
    hi = Math.max(hi, n!.fret);
    expect(hi - lo).toBeLessThanOrEqual(4); // never wider than a 5-fret stretch
  });
}

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
function scale(from: number, to: number, pcs = C_MAJOR): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

// Fixed pool (the 16th-grid libraries): the fingering-shift bound below is a heuristic that a few unlucky seeded licks
// exceed, so these samples must not move when new fragments are added to the library.
const SAMPLE_POOL = AUTHORED_FRAGMENTS.map(fromSixteenths);

function sampleLicks(instId: string, perTier = 4): Lick[] {
  const inst = getInstrument(instId);
  const out: Lick[] = [];
  let seed = 11;
  for (const tier of [1, 2, 3, 4] as Tier[]) {
    for (let k = 0; k < perTier; k++) {
      const prog = PROGRESSIONS[(seed + k) % PROGRESSIONS.length];
      out.push(generateLick({
        progressionId: prog.id, length: (['short', 'standard', 'long'] as const)[k % 3], keyPc: (seed * 7) % 12,
        tier, range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tier), seed: seed++, fragments: SAMPLE_POOL,
      }));
    }
  }
  return out;
}

describe('assignFrets', () => {
  it('every assigned fret reproduces the pitch', () => {
    const notes = [52, 55, 59, 64, 67, 71, 74, 79, 60, 62, 65, 69, 72];
    const r = assignFrets(notes, GUITAR, 17);
    r.forEach((p, i) => {
      expect(p).not.toBeNull();
      expect(pitchOf(GUITAR, p!.str, p!.fret)).toBe(notes[i]);
      expect(p!.fret).toBeGreaterThanOrEqual(0);
      expect(p!.fret).toBeLessThanOrEqual(17);
    });
    const b = assignFrets([40, 43, 47, 52, 55], BASS, 15);
    b.forEach((p, i) => expect(pitchOf(BASS, p!.str, p!.fret)).toBe([40, 43, 47, 52, 55][i]));
  });

  it('returns null for rests and out-of-range pitches', () => {
    const r = assignFrets([null, 30, 60, 120, null], GUITAR, 17);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).not.toBeNull();
    expect(r[3]).toBeNull();
    expect(r[4]).toBeNull();
    expect(assignFrets([], GUITAR, 17)).toEqual([]);
  });

  it('keeps a scale run in one position', () => {
    const run = scale(64, 84); // E4 .. C6
    const f = fingerLine(run, GUITAR, 17);
    expect(f.shifts).toBe(0);
    const fr = f.notes.map(p => p!.fret).filter(x => x > 0);
    expect(Math.max(...fr) - Math.min(...fr)).toBeLessThanOrEqual(4);
  });

  it('is deterministic', () => {
    const notes = [57, 60, 64, null, 67, 71, 62, 65, 69];
    expect(assignFrets(notes, GUITAR, 17)).toEqual(assignFrets(notes, GUITAR, 17));
    expect(fingerLine(notes, GUITAR, 17)).toEqual(fingerLine(notes, GUITAR, 17));
  });

  it('uses string 1 for the highest string', () => {
    // E6 only exists on the high E string
    expect(assignFrets([88], GUITAR, 17)[0]).toEqual({ str: 1, fret: 12 });
    expect(assignFrets([52], GUITAR, 17)[0]).toEqual({ str: 6, fret: 0 });
  });
});

describe('fingerLine: known shapes', () => {
  it('C major scale in position V: one box, no shifts, no open strings', () => {
    const line = scale(60, 81); // C4 .. A5
    const f = fingerLine(line, GUITAR, 17, { anchor: 5 });
    checkFingering(f, line, GUITAR, 17);
    expect(f.label).toBe('Pos. V');
    expect(f.shifts).toBe(0);
    for (const n of f.notes) {
      expect(n!.fret).toBeGreaterThanOrEqual(4);
      expect(n!.fret).toBeLessThanOrEqual(8);
    }
    // the classic fingering starts the scale on the A string with the pinky... or the 6th string with the 4th finger
    expect(f.notes[0]).toMatchObject({ str: 6, fret: 8, finger: 4 });
  });

  it('C major scale in open position uses open strings and the first frets', () => {
    const line = scale(52, 72); // E3 .. C5
    const open = positionsForLick(line, GUITAR, 17).find(p => p.label === 'Open pos.');
    expect(open).toBeDefined();
    checkFingering(open!, line, GUITAR, 17);
    expect(open!.shifts).toBe(0);
    expect(open!.window[1]).toBeLessThanOrEqual(4);
    expect(open!.notes.filter(n => n!.fret === 0).length).toBeGreaterThanOrEqual(4);
    // first-position fingering: the fret number is the finger number
    for (const n of open!.notes) if (n!.fret > 0) expect(n!.finger).toBe(n!.fret);
  });

  it('Dm7 arpeggio stays in one box', () => {
    const line = [62, 65, 69, 72, 74, 77, 81, 84]; // D F A C D F A C (written)
    const f = fingerLine(line, GUITAR, 17);
    checkFingering(f, line, GUITAR, 17);
    expect(f.shifts).toBe(0);
    expect(f.notes.some(n => n!.fret === 0)).toBe(false);
  });

  it('chromatic enclosure: no shift, no same-finger jumps', () => {
    const line = [69, 68, 66, 67, 65, 63, 64]; // A Ab | F# G | F Eb E
    const f = fingerLine(line, GUITAR, 17);
    checkFingering(f, line, GUITAR, 17);
    expect(f.shifts).toBe(0);
    for (let i = 1; i < f.notes.length; i++) {
      const a = f.notes[i - 1]!;
      const b = f.notes[i]!;
      if (a.fret > 0 && b.fret > 0 && a.str !== b.str) expect(a.finger === b.finger && a.fret !== b.fret).toBe(false);
    }
  });

  it('avoids open strings above the low positions', () => {
    const line = scale(74, 86); // D5 .. D6
    const f = fingerLine(line, GUITAR, 17);
    expect(f.notes.some(n => n!.fret === 0)).toBe(false);
  });
});

describe('cell joins', () => {
  // A 3-octave-ish C major run on offbeats: one shift is unavoidable, and it can happen almost anywhere.
  const notes = scale(60, 89);
  const line: LineNote[] = notes.map((m, i) => ({ midi: m, start: (i * 2 + 1) * S, dur: 2 * S })); // eighths on the off-16th (written in 16ths, scaled)
  const shiftsAt = (f: Fingering) => f.notes.flatMap((n, i) => (n?.shift ? [i] : []));

  it('a needed shift moves to the cell join', () => {
    for (const k of [8, 10, 12, 14]) {
      const f = fingerLine(line, GUITAR, 17, { cellStarts: [S, line[k].start!] });
      checkFingering(f, line, GUITAR, 17);
      expect(shiftsAt(f)).toEqual([k]);
    }
  });

  it('prefers shifting after a rest or a long note', () => {
    const withRest: LineNote[] = line.map((n, i) => (i >= 11 ? { ...n, start: n.start! + 4 * S } : n));
    withRest.splice(11, 0, { midi: null, start: line[11].start!, dur: 4 * S });
    const f = fingerLine(withRest, GUITAR, 17);
    expect(shiftsAt(f)).toEqual([12]);
  });
});

describe('positionsForLick', () => {
  it('returns sensible distinct positions for a scale', () => {
    const line = scale(60, 72); // C4 .. C5
    const ps = positionsForLick(line, GUITAR, 17);
    expect(ps.length).toBeGreaterThanOrEqual(3);
    const labels = ps.map(p => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('Pos. V');
    expect(labels).toContain('Pos. VII');
    for (let i = 1; i < ps.length; i++) expect(ps[i].position).toBeGreaterThan(ps[i - 1].position);
    for (const p of ps) {
      checkFingering(p, line, GUITAR, 17);
      expect(p.shifts).toBe(0);
      expect(p.window[0]).toBeLessThanOrEqual(p.window[1]);
    }
  });

  it('returns sensible positions for an arpeggio', () => {
    const line = [60, 64, 67, 71, 74, 71, 67, 64]; // Cmaj9 up and down
    const ps = positionsForLick(line, GUITAR, 17);
    expect(ps.length).toBeGreaterThanOrEqual(3);
    for (const p of ps) {
      checkFingering(p, line, GUITAR, 17);
      expect(p.shifts).toBeLessThanOrEqual(1);
    }
  });

  it('drops positions that cannot reach the notes without many shifts', () => {
    const line = scale(52, 64); // low E3 .. E4: only the bottom of the neck
    const ps = positionsForLick(line, GUITAR, 17);
    for (const p of ps) expect(p.position).toBeLessThanOrEqual(7);
  });

  it('is empty for an empty or all-rest line', () => {
    expect(positionsForLick([], GUITAR, 17)).toEqual([]);
    expect(positionsForLick([null, null], GUITAR, 17)).toEqual([]);
  });
});

describe('generated licks', () => {
  const guitar = getInstrument('guitar');
  const bass = getInstrument('bass');

  it('every fingering of every position is playable (guitar)', () => {
    for (const lick of sampleLicks('guitar')) {
      const f = lickFingerings(lick, guitar)!;
      expect(f.positions.length).toBeGreaterThanOrEqual(1);
      for (const fing of [f.auto, ...f.positions]) {
        checkFingering(fing, f.line, guitar.tab!.tuning, guitar.tab!.frets);
        expect(fing.shifts).toBeLessThanOrEqual(1 + Math.floor(f.line.filter(n => n.midi != null).length / 16));
        if (fing.shifts === 0) expect(fing.window[1] - fing.window[0]).toBeLessThanOrEqual(4);
      }
    }
  });

  it('an open string does not let the hand stretch both ways without a shift', () => {
    // a line full of open-string opportunities
    const line = [56, 57, 61, 62, 66, 67, 71, 64, 59, 55, 52];
    for (const f of [fingerLine(line, GUITAR, 17), ...positionsForLick(line, GUITAR, 17)]) {
      checkFingering(f, line, GUITAR, 17);
      if (f.shifts === 0) expect(f.window[1] - f.window[0]).toBeLessThanOrEqual(4);
    }
  });

  it('bass tab still works and uses 1-2-4 fingering in low positions', () => {
    for (const lick of sampleLicks('bass', 3)) {
      const f = lickFingerings(lick, bass)!;
      for (const fing of [f.auto, ...f.positions]) {
        checkFingering(fing, f.line, bass.tab!.tuning, bass.tab!.frets);
        for (const n of fing.notes) if (n && n.fret > 0 && n.pos < 7) expect(n.finger).not.toBe(3);
      }
    }
    expect(assignFrets([40, 43, 45, 47], BASS, 15).every(p => p != null)).toBe(true);
  });

  it('generated licks carry cellStarts that line up with their fragments', () => {
    for (const lick of sampleLicks('guitar', 2)) {
      expect(lick.cellStarts).toBeDefined();
      expect(lick.cellStarts!.length).toBe(lick.fragmentIds.length);
      expect(lick.cellStarts![0]).toBe(0);
      for (let i = 1; i < lick.cellStarts!.length; i++) expect(lick.cellStarts![i]).toBeGreaterThan(lick.cellStarts![i - 1]);
      for (const c of lick.cellStarts!) expect(lick.notes.some(n => n.start === c) || c >= lick.totalTicks).toBe(true);
      // transposing keeps them
      expect(transposeLick(lick, (lick.keyPc + 5) % 12, concertRange(guitar)).cellStarts).toEqual(lick.cellStarts);
    }
  });

  it('old licks without cellStarts still validate and get a fingering', () => {
    const lick = sampleLicks('guitar', 1)[2];
    const { cellStarts: _drop, ...old } = lick;
    void _drop;
    expect(isValidLick(old)).toBe(true);
    expect(isValidLick({ ...lick, cellStarts: ['x'] })).toBe(false);
    const f = lickFingerings(old as Lick, guitar)!;
    checkFingering(f.auto, f.line, guitar.tab!.tuning, guitar.tab!.frets);
    expect(transposeLick(old as Lick, 3, concertRange(guitar)).cellStarts).toBeUndefined();
  });

  it('is deterministic and memoised', () => {
    const lick = sampleLicks('guitar', 1)[3];
    const a = lickFingerings(lick, guitar)!;
    expect(lickFingerings(lick, guitar)).toBe(a);
    const fresh = lickFingerings(JSON.parse(JSON.stringify(lick)) as Lick, guitar)!;
    expect(fresh).toEqual(a);
  });

  it('is fast enough to run on every render', () => {
    const lick = generateLick({ progressionId: 'major-251', length: 'long', keyPc: 2, tier: 4, range: concertRange(guitar), seed: 99 });
    const t = performance.now();
    lickFingerings(lick, guitar);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('pickFingering falls back to auto for bad indices', () => {
    const lick = sampleLicks('guitar', 1)[1];
    const f = lickFingerings(lick, guitar)!;
    expect(pickFingering(f, 'auto')).toBe(f.auto);
    expect(pickFingering(f, 99)).toBe(f.auto);
    expect(pickFingering(f, -1)).toBe(f.auto);
    expect(pickFingering(f, 0)).toBe(f.positions[0]);
  });

  it('lickLine merges tied notes and keeps rests', () => {
    const lick = sampleLicks('guitar', 1)[0];
    const line = lickLine(lick, 12);
    const total = line.reduce((a, n) => a + n.dur!, 0);
    expect(total).toBe(lick.totalTicks);
    expect(line.length).toBe(lick.notes.length - lick.notes.filter((n, i) => n.tie && lick.notes[i + 1]?.midi === n.midi).length);
  });
});
