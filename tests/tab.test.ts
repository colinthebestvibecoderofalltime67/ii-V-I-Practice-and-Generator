import { describe, it, expect } from 'vitest';
import { assignFrets } from '../src/render/tab';

const GUITAR = [52, 57, 62, 67, 71, 76];
const BASS = [40, 45, 50, 55];

describe('assignFrets', () => {
  it('every assigned fret reproduces the pitch', () => {
    const notes = [52, 55, 59, 64, 67, 71, 74, 79, 60, 62, 65, 69, 72];
    const r = assignFrets(notes, GUITAR, 17);
    r.forEach((p, i) => {
      expect(p).not.toBeNull();
      expect(GUITAR[GUITAR.length - p!.str] + p!.fret).toBe(notes[i]);
      expect(p!.fret).toBeGreaterThanOrEqual(0);
      expect(p!.fret).toBeLessThanOrEqual(17);
    });
    const b = assignFrets([40, 43, 47, 52, 55], BASS, 15);
    b.forEach((p, i) => expect(BASS[BASS.length - p!.str] + p!.fret).toBe([40, 43, 47, 52, 55][i]));
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
    // C major scale, E4 up to C6 (written guitar pitches)
    const scale = [64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
    const r = assignFrets(scale, GUITAR, 17);
    const fretted = r.map(p => p!.fret).filter(f => f > 0);
    // consecutive fretted notes never jump more than a position shift
    for (let i = 1; i < r.length; i++) {
      if (r[i]!.fret > 0 && r[i - 1]!.fret > 0) expect(Math.abs(r[i]!.fret - r[i - 1]!.fret)).toBeLessThanOrEqual(4);
    }
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(9);
    // a short run in the middle of the neck sits in a 4-fret window
    const run = assignFrets([67, 69, 71, 72, 74, 76], GUITAR, 17);
    const fr = run.map(p => p!.fret).filter(f => f > 0);
    expect(Math.max(...fr) - Math.min(...fr)).toBeLessThanOrEqual(4);
  });

  it('is deterministic', () => {
    const notes = [57, 60, 64, null, 67, 71, 62, 65, 69];
    expect(assignFrets(notes, GUITAR, 17)).toEqual(assignFrets(notes, GUITAR, 17));
  });

  it('uses string 1 for the highest string', () => {
    const r = assignFrets([76], GUITAR, 17);
    expect(r[0]).toEqual({ str: 1, fret: 0 });
  });
});
