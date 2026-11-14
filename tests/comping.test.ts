import { describe, expect, it } from 'vitest';
import { bassEvents, compEvents, voiceChords, type CompStyle } from '../src/audio/comping';
import { CHORDS } from '../src/theory/chords';
import type { ChordQualityId, LengthId, LickChord } from '../src/types';
import { LENGTHS, PROGRESSIONS, expandProgression } from '../src/theory/progressions';
import { TPB, TPBAR } from '../src/types';

const QUALITIES = Object.keys(CHORDS) as ChordQualityId[];
/** `startBeat` and `beats` are in beats; start/dur are converted to ticks. */
const mk = (rootPc: number, quality: ChordQualityId, startBeat: number, beats: number): LickChord =>
  ({ rootPc, quality, symbol: 'x', start: startBeat * TPB, dur: beats * TPB });
const pcs = (v: number[]) => v.map(m => ((m % 12) + 12) % 12);

describe('piano comping', () => {
  for (const style of ['rootless', 'block', 'sparse'] as CompStyle[]) {
    it(`voices every quality and root in register (${style})`, () => {
      for (const q of QUALITIES) for (let r = 0; r < 12; r++) {
        const [v] = voiceChords([mk(r, q, 0, 4)], style);
        for (const m of v) { expect(m).toBeGreaterThanOrEqual(52); expect(m).toBeLessThanOrEqual(76); }
        for (const g of CHORDS[q].guide) expect(pcs(v)).toContain((r + g) % 12);
      }
    });
  }

  it('keeps voice-leading movement small', () => {
    for (const q of QUALITIES) for (let r = 0; r < 12; r++) {
      const ch = [mk(r + 2, 'm7', 0, 4), mk(r + 7, q, 4, 4), mk(r, 'maj7', 8, 4)].map(c => ({ ...c, rootPc: c.rootPc % 12 }));
      const v = voiceChords(ch, 'rootless');
      for (let i = 1; i < v.length; i++) {
        const move = v[i].reduce((s, m, k) => s + Math.abs(m - v[i - 1][k]), 0);
        expect(move).toBeLessThanOrEqual(24);
      }
    }
  });

  it('plays Charleston on long chords, beat 1 on short ones, holds the last', () => {
    const ch = [mk(2, 'm7', 0, 2), mk(7, 'dom7', 2, 2), mk(0, 'maj7', 4, 8)];
    const ev = compEvents(ch, 'rootless');
    expect(ev.filter(e => e.tick < TPBAR).map(e => e.tick)).toEqual([0, 2 * TPB]);
    expect(ev.filter(e => e.tick >= TPBAR)).toEqual([{ midi: ev[2].midi, tick: TPBAR, dur: 8 * TPB }]);
    const ev2 = compEvents([mk(2, 'm7', 0, 4), mk(7, 'dom7', 4, 4), mk(0, 'maj7', 8, 8)], 'block');
    expect(ev2.map(e => e.tick)).toEqual([0, 18, 48, 66, 96]); // Charleston: beat 1, then the "and" of 2 (dotted quarter later)
    expect(compEvents([mk(2, 'm7', 0, 4), mk(7, 'dom7', 4, 4)], 'sparse').map(e => e.tick)).toEqual([0, TPBAR]);
  });
});

describe('bass', () => {
  it('hits the root on every chord start, in range, for all qualities and lengths', () => {
    for (const q of QUALITIES) for (const beats of [2, 4, 8]) for (let r = 0; r < 12; r++) {
      const ch = [mk(r, q, 0, beats), mk((r + 5) % 12, 'dom7', beats, beats), mk((r + 10) % 12, 'maj7', beats * 2, beats)];
      const ev = bassEvents(ch);
      for (const c of ch) {
        const e = ev.find(x => x.tick === c.start)!;
        expect(e).toBeDefined();
        expect(e.midi[0] % 12).toBe(c.rootPc);
      }
      for (const e of ev) { expect(e.midi[0]).toBeGreaterThanOrEqual(36); expect(e.midi[0]).toBeLessThanOrEqual(55); }
      // chromatic approach into next root
      for (let i = 0; i < ch.length - 1; i++) {
        const last = ev.filter(x => x.tick < ch[i + 1].start).pop()!;
        const next = ev.find(x => x.tick === ch[i + 1].start)!;
        expect(Math.abs(last.midi[0] - next.midi[0])).toBe(1);
      }
    }
  });
});

describe('comping and bass over every registered progression (2-beat chords included)', () => {
  it('bass: a root on each chord, one quarter per beat, a half-step approach into the next root, inside 36-55', () => {
    for (const p of PROGRESSIONS) for (const length of Object.keys(LENGTHS) as LengthId[]) for (const key of [0, 4, 7, 10]) {
      const chords = expandProgression(p, length, key);
      const bass = bassEvents(chords);
      const label = `${p.id}/${length}/k${key}`;
      chords.forEach((c, i) => {
        const inChord = bass.filter(e => e.tick >= c.start && e.tick < c.start + c.dur);
        if (i === chords.length - 1) { expect(inChord.length, `${label} last`).toBe(1); expect(inChord[0].dur).toBe(c.dur); return; }
        expect(inChord.length, `${label} ${c.symbol} one note per beat`).toBe(c.dur / TPB);
        expect(((inChord[0].midi[0] % 12) + 12) % 12, `${label} ${c.symbol} starts on its root`).toBe(c.rootPc);
        const next = bass.find(e => e.tick === c.start + c.dur)!;
        expect(Math.abs(inChord[inChord.length - 1].midi[0] - next.midi[0]), `${label} approach into ${chords[i + 1].symbol}`).toBe(1);
      });
      for (const e of bass) { expect(e.midi[0]).toBeGreaterThanOrEqual(36); expect(e.midi[0]).toBeLessThanOrEqual(55); }
    }
  });

  it('piano: every chord is voiced inside its own span, with small movement between chords', () => {
    for (const p of PROGRESSIONS) for (const style of ['rootless', 'block', 'sparse'] as CompStyle[]) {
      const chords = expandProgression(p, 'short', 3);
      const ev = compEvents(chords, style);
      chords.forEach(c => {
        const mine = ev.filter(e => e.tick >= c.start && e.tick < c.start + c.dur);
        expect(mine.length, `${p.id} ${style} ${c.symbol}`).toBeGreaterThan(0);
        for (const e of mine) expect(e.tick + e.dur, `${p.id} ${style} ${c.symbol}`).toBeLessThanOrEqual(c.start + c.dur);
      });
      const v = voiceChords(chords, style);
      for (let i = 1; i < v.length; i++) expect(v[i].reduce((s, m, k) => s + Math.abs(m - v[i - 1][Math.min(k, v[i - 1].length - 1)]), 0), `${p.id} ${style} chord ${i}`).toBeLessThanOrEqual(30);
    }
  });
});
