import type { Timbre } from '../types';
import { midiToHz } from '../theory/pitch';

interface Voice {
  a: OscillatorType; b: OscillatorType; bm: number; mx: number; c0: number; c1: number;
  vib: number; pk: number; lvl: number; attack: number; vibRate: number;
  /** 'sustain' = held envelope; 'decay' = struck/plucked exponential decay. */
  env: 'sustain' | 'decay'; decay?: number;
}

export const TIMBRES: Record<Timbre, Voice> = {
  reed: { a: 'sawtooth', b: 'square', bm: 1, mx: .35, c0: 1000, c1: 1400, vib: 10, pk: 6, lvl: .28, attack: .025, vibRate: 5.3, env: 'sustain' },
  brass: { a: 'sawtooth', b: 'sawtooth', bm: 1, mx: .5, c0: 1300, c1: 2200, vib: 5, pk: 3, lvl: .22, attack: .025, vibRate: 5.3, env: 'sustain' },
  flute: { a: 'triangle', b: 'sine', bm: 2, mx: .5, c0: 3500, c1: 1500, vib: 12, pk: 0, lvl: .4, attack: .025, vibRate: 5.3, env: 'sustain' },
  string: { a: 'sawtooth', b: 'sawtooth', bm: 1, mx: .6, c0: 900, c1: 1600, vib: 16, pk: 2, lvl: .2, attack: .09, vibRate: 5.8, env: 'sustain' },
  pluck: { a: 'sawtooth', b: 'triangle', bm: 1, mx: .6, c0: 700, c1: 2600, vib: 0, pk: 1, lvl: .34, attack: .004, vibRate: 5, env: 'decay', decay: 1.1 },
  keys: { a: 'triangle', b: 'sine', bm: 2, mx: .3, c0: 2500, c1: 3500, vib: 0, pk: 0, lvl: .36, attack: .006, vibRate: 5, env: 'decay', decay: 1.6 },
};

/** Lead voice. `acc` is accent 0..1. */
export function lead(ctx: AudioContext, out: AudioNode, timbre: Timbre, midi: number, t: number, dur: number, acc: number): void {
  const T = TIMBRES[timbre] ?? TIMBRES.reed;
  const fr = midiToHz(midi);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  const g2 = ctx.createGain(), fl = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), g = ctx.createGain();
  o1.type = T.a; o2.type = T.b;
  o1.frequency.value = fr; o2.frequency.value = fr * T.bm; o2.detune.value = 4; g2.gain.value = T.mx;
  o1.connect(fl); o2.connect(g2); g2.connect(fl);
  fl.type = 'lowpass'; fl.Q.value = 2;
  fl.frequency.setValueAtTime(T.c0 * .7, t);
  fl.frequency.linearRampToValueAtTime(T.c0 + acc * T.c1, t + .05);
  pk.type = 'peaking'; pk.frequency.value = 1100; pk.gain.value = T.pk;
  fl.connect(pk); pk.connect(g); g.connect(out);
  const a = T.lvl * acc;
  const nodes: AudioScheduledSourceNode[] = [o1, o2];
  let end: number;
  if (T.env === 'sustain') {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + T.attack);
    g.gain.setValueAtTime(a, Math.max(t + T.attack + .005, t + dur - .04));
    g.gain.linearRampToValueAtTime(0, t + dur + .03);
    end = t + dur + .08;
  } else {
    const len = Math.max(dur, .12);
    const tail = Math.min(T.decay ?? 1, len * 1.8 + .15);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + T.attack);
    g.gain.exponentialRampToValueAtTime(.0008, t + tail);
    fl.frequency.cancelScheduledValues(t);
    fl.frequency.setValueAtTime(T.c0 + acc * T.c1, t);
    fl.frequency.exponentialRampToValueAtTime(T.c0 * .6, t + tail);
    end = t + tail + .05;
  }
  if (T.vib > 0) {
    const lf = ctx.createOscillator(), lg = ctx.createGain();
    lf.frequency.value = T.vibRate;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(T.vib, t + Math.max(.2, dur * .5));
    lf.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    nodes.push(lf);
  }
  nodes.forEach(o => { o.start(t); o.stop(end); });
}

/** Comping piano note. */
export function piano(ctx: AudioContext, out: AudioNode, midi: number, t: number, dur: number, vol: number): void {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), h = ctx.createGain();
  const f = midiToHz(midi);
  o.type = 'triangle'; o2.type = 'sine';
  o.frequency.value = f; o2.frequency.value = f * 2; h.gain.value = .25;
  o.connect(g); o2.connect(h); h.connect(g); g.connect(out);
  const e = t + Math.min(dur, 2.2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + .006);
  g.gain.exponentialRampToValueAtTime(.0008, e + .1);
  o.start(t); o2.start(t); o.stop(e + .15); o2.stop(e + .15);
}

/** Plucky bass note (sine + triangle). */
export function bass(ctx: AudioContext, out: AudioNode, midi: number, t: number, dur: number, vol: number): void {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  const f = midiToHz(midi);
  o.type = 'sine'; o2.type = 'triangle';
  o.frequency.value = f; o2.frequency.value = f;
  fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(260, t + .25);
  o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(out);
  const e = t + Math.min(dur, 2.5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + .008);
  g.gain.exponentialRampToValueAtTime(vol * .45, t + Math.min(.35, dur));
  g.gain.setValueAtTime(vol * .45, Math.max(t + .36, e - .03));
  g.gain.linearRampToValueAtTime(0, e + .04);
  o.start(t); o2.start(t); o.stop(e + .08); o2.stop(e + .08);
}

/** Metronome click. */
export function click(ctx: AudioContext, out: AudioNode, t: number, accent: boolean): void {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1800 : 1200;
  o.connect(g); g.connect(out);
  g.gain.setValueAtTime(.2, t);
  g.gain.exponentialRampToValueAtTime(.001, t + .04);
  o.start(t); o.stop(t + .05);
}
