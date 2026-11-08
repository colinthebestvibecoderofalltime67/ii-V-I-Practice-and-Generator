import { describe, expect, it } from 'vitest';
import { bassEvents, compEvents, voiceChords, type CompStyle } from '../src/audio/comping';
import { CHORDS } from '../src/theory/chords';
import type { ChordQualityId, LickChord } from '../src/types';

const QUALITIES = Object.keys(CHORDS) as ChordQualityId[];
const mk = (rootPc: number, quality: ChordQualityId, start: number, beats: number): LickChord =>
  ({ rootPc, quality, symbol: 'x', start, dur: beats * 4 });
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
      const ch = [mk(r + 2, 'm7', 0, 4), mk(r + 7, q, 16, 4), mk(r, 'maj7', 32, 4)].map(c => ({ ...c, rootPc: c.rootPc % 12 }));
      const v = voiceChords(ch, 'rootless');
      for (let i = 1; i < v.length; i++) {
        const move = v[i].reduce((s, m, k) => s + Math.abs(m - v[i - 1][k]), 0);
        expect(move).toBeLessThanOrEqual(24);
      }
    }
  });

  it('plays Charleston on long chords, beat 1 on short ones, holds the last', () => {
    const ch = [mk(2, 'm7', 0, 2), mk(7, 'dom7', 8, 2), mk(0, 'maj7', 16, 8)];
    const ev = compEvents(ch, 'rootless');
    expect(ev.filter(e => e.tick < 16).map(e => e.tick)).toEqual([0, 8]);
    expect(ev.filter(e => e.tick >= 16)).toEqual([{ midi: ev[2].midi, tick: 16, dur: 32 }]);
    const ev2 = compEvents([mk(2, 'm7', 0, 4), mk(7, 'dom7', 16, 4), mk(0, 'maj7', 32, 8)], 'block');
    expect(ev2.map(e => e.tick)).toEqual([0, 6, 16, 22, 32]);
    expect(compEvents([mk(2, 'm7', 0, 4), mk(7, 'dom7', 16, 4)], 'sparse').map(e => e.tick)).toEqual([0, 16]);
  });
});

describe('bass', () => {
  it('hits the root on every chord start, in range, for all qualities and lengths', () => {
    for (const q of QUALITIES) for (const beats of [2, 4, 8]) for (let r = 0; r < 12; r++) {
      const ch = [mk(r, q, 0, beats), mk((r + 5) % 12, 'dom7', beats * 4, beats), mk((r + 10) % 12, 'maj7', beats * 8, beats)];
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
