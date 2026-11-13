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
    expect(p.ntrks).toBe(4);
    const tempo = p.tracks[0].find(e => e.meta === 0x51)!;
    expect(tempo.data).toEqual([0x07, 0xa1, 0x20]); // 500000 us
    expect(p.tracks[0].find(e => e.meta === 0x58)!.data!.slice(0, 2)).toEqual([4, 2]);
    p.tracks.forEach(t => expect(t.some(e => e.meta === 0x03)).toBe(true));
  });

  it('has only the lead track when not comping', () => {
    expect(parse(lickToMidi(lick, { ...opts, comping: false })).ntrks).toBe(2);
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
