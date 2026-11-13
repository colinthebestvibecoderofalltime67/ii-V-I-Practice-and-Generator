import { CHORDS } from '../theory/chords';
import type { LickChord } from '../types';
import { TICKS_PER_16TH as S16, TPB, TPBAR } from '../types';

export type CompStyle = 'rootless' | 'block' | 'sparse';
export interface CompEvent { midi: number[]; tick: number; dur: number }

const PIANO_LO = 52, PIANO_HI = 76;
const BASS_LO = 36, BASS_HI = 55;

/** All inversions / octave placements of a voicing inside [lo, hi]. */
function candidates(rootPc: number, intervals: number[], lo: number, hi: number): number[][] {
  const out: number[][] = [];
  const base = intervals.map(i => rootPc + i);
  for (let inv = 0; inv < base.length; inv++) {
    // rotate: lowest `inv` notes go up an octave
    const rot = base.map((n, k) => (k < inv ? n + 12 : n)).sort((a, b) => a - b);
    for (let oct = -48; oct <= 48; oct += 12) {
      const v = rot.map(n => n + oct);
      if (v[0] >= lo && v[v.length - 1] <= hi) out.push(v);
    }
  }
  return out;
}

function movement(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs((a[Math.min(i, a.length - 1)]) - (b[Math.min(i, b.length - 1)]));
  return s;
}

const centre = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Voice-led voicings for each chord (concert MIDI, ascending). */
export function voiceChords(chords: LickChord[], style: CompStyle): number[][] {
  const res: number[][] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const q = CHORDS[c.quality];
    const iv = style === 'block' ? q.block : q.rootless;
    let cands = candidates(c.rootPc, iv, PIANO_LO, PIANO_HI);
    if (!cands.length) cands = candidates(c.rootPc, iv, PIANO_LO - 4, PIANO_HI + 4);
    let best = cands[0], bs = Infinity;
    for (const v of cands) {
      const cost = prev ? movement(prev, v) + Math.abs(centre(v) - centre(prev)) : Math.abs(centre(v) - 64);
      if (cost < bs) { bs = cost; best = v; }
    }
    res.push(best);
    prev = best;
  }
  return res;
}

/** Piano right-hand comping. */
export function compEvents(chords: LickChord[], style: CompStyle): CompEvent[] {
  const voicings = voiceChords(chords, style);
  const ev: CompEvent[] = [];
  chords.forEach((c, i) => {
    const v = voicings[i];
    const last = i === chords.length - 1;
    if (style === 'sparse') {
      ev.push({ midi: v, tick: c.start, dur: c.dur });
    } else if (last) {
      ev.push({ midi: v, tick: c.start, dur: c.dur });
    } else if (c.dur < TPBAR) {
      ev.push({ midi: v, tick: c.start, dur: Math.max(S16, Math.min(c.dur, 6 * S16)) });
    } else {
      for (let t = 0; t + TPBAR <= c.dur; t += TPBAR) {
        // Charleston: dotted quarter on 1, then the "and" of 2
        ev.push({ midi: v, tick: c.start + t, dur: 6 * S16 });
        ev.push({ midi: v, tick: c.start + t + 6 * S16, dur: 6 * S16 });
      }
    }
  });
  return ev;
}

const nearestPc = (pc: number, ref: number, lo: number, hi: number): number => {
  let best = -1, bd = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 !== ((pc % 12) + 12) % 12) continue;
    const d = Math.abs(m - ref);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
};

/** Simple walking / 2-feel bass in concert MIDI 36-55. One quarter note per beat. */
export function bassEvents(chords: LickChord[]): CompEvent[] {
  const roots: number[] = [];
  let ref = 43;
  for (const c of chords) { const r = nearestPc(c.rootPc, ref, BASS_LO, BASS_HI); roots.push(r); ref = r; }
  const ev: CompEvent[] = [];
  chords.forEach((c, i) => {
    const root = roots[i];
    const last = i === chords.length - 1;
    const beats = Math.max(1, Math.round(c.dur / TPB));
    if (last) {
      ev.push({ midi: [root], tick: c.start, dur: c.dur });
      return;
    }
    const tones = CHORDS[c.quality].tones;
    const order = [tones[1], tones[2], tones[tones.length - 1], tones[2]]; // 3rd, 5th, 7th/6th, 5th
    let prev = root;
    for (let b = 0; b < beats; b++) {
      let m: number;
      if (b === 0) m = root;
      else if (b === beats - 1) {
        const target = roots[i + 1];
        const below = target - 1, above = target + 1;
        m = prev >= target ? (below >= BASS_LO ? below : above) : (above <= BASS_HI ? above : below);
      } else {
        m = nearestPc(c.rootPc + order[(b - 1) % order.length], prev, BASS_LO, BASS_HI);
        if (m === prev) m = nearestPc(c.rootPc + tones[2], prev + 1, BASS_LO, BASS_HI);
      }
      ev.push({ midi: [m], tick: c.start + b * TPB, dur: TPB });
      prev = m;
    }
  });
  return ev;
}
