import { describe, expect, it } from 'vitest';
import { lickToMidi } from '../src/export/midi';
import { soundingNotes } from '../src/audio/timing';
import { expandProgression, PROGRESSIONS } from '../src/theory/progressions';
import type { Lick, LickNote } from '../src/types';
import { TICKS_PER_16TH, TPBAR } from '../src/types';

interface MEv { t: number; status: number; d1?: number; d2?: number; meta?: number; data?: number[] }
function parse(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  expect(tag(0)).toBe('MThd');
  expect(dv.getUint32(4)).toBe(6);
  const format = dv.getUint16(8), ntrks = dv.getUint16(10), division = dv.getUint16(12);
  let o = 14;
  const tracks: MEv[][] = [];
  for (let k = 0; k < ntrks; k++) {
    expect(tag(o)).toBe('MTrk');
    const len = dv.getUint32(o + 4);
    o += 8;
    const end = o + len;
    const evs: MEv[] = [];
    let t = 0, run = 0;
    while (o < end) {
      let delta = 0, x;
      do { x = b[o++]; delta = (delta << 7) | (x & 0x7f); } while (x & 0x80);
      t += delta;
      let st = b[o];
      if (st === 0xff) {
        const type = b[o + 1]; o += 2;
        let l = 0; do { x = b[o++]; l = (l << 7) | (x & 0x7f); } while (x & 0x80);
        evs.push({ t, status: 0xff, meta: type, data: Array.from(b.slice(o, o + l)) });
        o += l;
      } else {
        if (st & 0x80) { run = st; o++; } else st = run;
        const hi = st & 0xf0;
        const n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        evs.push({ t, status: st, d1: b[o], d2: n === 2 ? b[o + 1] : undefined });
        o += n;
      }
    }
    expect(o).toBe(end);
    expect(evs[evs.length - 1].meta).toBe(0x2f);
    tracks.push(evs);
  }
  expect(o).toBe(b.length);
  return { format, ntrks, division, tracks };
}

const chords = expandProgression(PROGRESSIONS[0], 'standard', 0);
// start/dur below are written in 16ths and scaled to engine ticks
const N = (midi: number | null, start: number, dur: number, extra: Partial<LickNote> = {}): LickNote =>
  ({ midi, start: start * TICKS_PER_16TH, dur: dur * TICKS_PER_16TH, chord: Math.min(2, Math.floor((start * TICKS_PER_16TH) / TPBAR)), ...extra });
const lick: Lick = {
  version: 2, id: 't', seed: 1, progressionId: PROGRESSIONS[0].id, length: 'standard', keyPc: 0, mode: 'major',
  requestedTier: 1, chords, totalTicks: 3 * TPBAR, fragmentIds: [],
  difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0,
  notes: [
    N(62, 0, 2), N(65, 2, 2), N(69, 4, 2), N(72, 6, 2), N(null, 8, 4), N(71, 12, 2), N(69, 14, 2),
    N(67, 16, 4, { tie: true }), N(67, 20, 4), N(65, 24, 2), N(64, 26, 2), N(62, 28, 4),
    N(60, 32, 8, { tie: true }), N(60, 40, 8),
  ],
};

const ons = (t: MEv[], ch?: number) => t.filter(e => (e.status & 0xf0) === 0x90 && e.d2! > 0 && (ch == null || (e.status & 15) === ch));
const offs = (t: MEv[], ch?: number) => t.filter(e => (e.status & 0xf0) === 0x80 && (ch == null || (e.status & 15) === ch));

describe('lickToMidi', () => {
  const opts = { bpm: 120, swing: false, comping: true, comp: 'rootless' as const };

  it('writes a valid SMF with header, tempo and time signature', () => {
    const p = parse(lickToMidi(lick, opts));
    expect(p.format).toBe(1);
    expect(p.division).toBe(480);
    expect(p.ntrks).toBe(5);
    const tempo = p.tracks[0].find(e => e.meta === 0x51)!;
    expect(tempo.data).toEqual([0x07, 0xa1, 0x20]); // 500000 us
    expect(p.tracks[0].find(e => e.meta === 0x58)!.data!.slice(0, 2)).toEqual([4, 2]);
    p.tracks.forEach(t => expect(t.some(e => e.meta === 0x03)).toBe(true));
  });

  it('has only the lead track when not comping', () => {
    expect(parse(lickToMidi(lick, { ...opts, comping: false })).ntrks).toBe(2); // no drums either
  });

  it('can leave the drums out', () => {
    expect(parse(lickToMidi(lick, { ...opts, drums: false })).ntrks).toBe(4);
  });

  it('writes a drum track on channel 10 (index 9) on the swung grid', () => {
    const p = parse(lickToMidi(lick, { ...opts, swing: true, straight16: true }));
    const d = p.tracks[4];
    const on = ons(d);
    expect(on.length).toBeGreaterThan(0);
    expect(on.every(e => (e.status & 15) === 9)).toBe(true);
    const notes = new Set(on.map(e => e.d1));
    expect([...notes].every(n => [36, 38, 44, 51].includes(n!))).toBe(true);
    expect(notes.has(51) && notes.has(44) && notes.has(36)).toBe(true);
    expect(ons(d).length).toBe(offs(d).length);
    // ride: beats at multiples of 480, plus the swung "and" of 2 and 4 at +320
    const ride = on.filter(e => e.d1 === 51).map(e => e.t);
    expect(ride.slice(0, 6)).toEqual([0, 480, 800, 960, 1440, 1760]);
    // hi-hat on 2 and 4 only
    expect(on.filter(e => e.d1 === 44).map(e => e.t).slice(0, 2)).toEqual([480, 1440]);
  });

  it('balances note-ons/offs and counts merged lead notes', () => {
    const p = parse(lickToMidi(lick, opts));
    for (const t of p.tracks) expect(ons(t).length).toBe(offs(t).length);
    const sounding = soundingNotes(lick).length;
    expect(sounding).toBe(11);
    expect(ons(p.tracks[1]).length).toBe(sounding);
    expect(ons(p.tracks[2], 1).length).toBeGreaterThan(0);
    expect(ons(p.tracks[3], 2).length).toBeGreaterThan(0);
    expect(p.tracks[1].find(e => (e.status & 0xf0) === 0xc0)!.d1).toBe(66);
    expect(p.tracks[3].find(e => (e.status & 0xf0) === 0xc0)!.d1).toBe(32);
  });

  it('positions notes at 480 PPQ and merges ties into one long note', () => {
    const lead = ons(parse(lickToMidi(lick, opts)).tracks[1]);
    expect(lead[0].t).toBe(0);
    expect(lead[1].t).toBe(240);
    const p = parse(lickToMidi(lick, opts));
    const tied = ons(p.tracks[1]).find(e => e.t === 16 * 120)!;
    const off = offs(p.tracks[1]).find(e => e.d1 === tied.d1 && e.t > tied.t)!;
    expect(off.t - tied.t).toBe(8 * 120);
  });

  it('shifts off-beat eighths when swung', () => {
    const straight = ons(parse(lickToMidi(lick, opts)).tracks[1]);
    const swung = ons(parse(lickToMidi(lick, { ...opts, swing: true })).tracks[1]);
    expect(swung[0].t).toBe(0);
    expect(straight[2].t).toBe(480); // beat 2 unchanged
    expect(swung[2].t).toBe(480);
    expect(straight[1].t).toBe(240);
    expect(swung[1].t).toBe(320); // 2/3 of a beat
  });
});

describe('lickToMidi feel', () => {
  const mk = (notes: [number, number][]): Lick => ({
    ...lick,
    notes: notes.map(([s, d]) => ({ midi: 60, start: s, dur: d, chord: 0 })),
    totalTicks: 3 * TPBAR,
  });
  const base = { bpm: 120, swing: true, comping: false, comp: 'rootless' as const };
  it('writes 8th triplets at 0/160/320 ticks', () => {
    const l = mk([[0, 4], [4, 4], [8, 4], [12, 36], [48, 48], [96, 48]]);
    for (const swing of [true, false]) {
      const t = ons(parse(lickToMidi(l, { ...base, swing, straight16: true })).tracks[1]).map(e => e.t);
      expect(t.slice(0, 4)).toEqual([0, 160, 320, 480]);
    }
  });
  it('keeps 16ths straight with swing on when straight16', () => {
    const l = mk([[0, 3], [3, 3], [6, 3], [9, 3], [12, 36], [48, 48], [96, 48]]);
    const straight = ons(parse(lickToMidi(l, { ...base, straight16: true })).tracks[1]).map(e => e.t);
    expect(straight.slice(0, 4)).toEqual([0, 120, 240, 360]);
    const legacy = ons(parse(lickToMidi(l, base)).tracks[1]).map(e => e.t);
    expect(legacy[2]).toBe(320);
  });
});
