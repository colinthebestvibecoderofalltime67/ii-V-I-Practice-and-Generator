import type { Lick, Timbre } from '../types';
import { TICKS_PER_16TH, TPB } from '../types';
import { bassEvents, compEvents, type CompStyle } from './comping';
import { bass, click, lead, piano } from './synth';
import { soundingNotes, spanBeats, tickToBeats } from './timing';

export interface PlayOptions {
  bpm: number; swing: boolean; loop: boolean; metronome: boolean; countIn: boolean;
  piano: boolean; comp: CompStyle; leadVolume: number; pianoVolume: number; timbre: Timbre;
}
export interface PlayCallbacks { onNote?(indices: number[]): void; onStatus?(text: string): void; onEnd?(): void }

interface Buses { lead: GainNode; piano: GainNode; met: GainNode }
interface Queued { t: number; fn: () => void }

export class Player {
  private ctx: AudioContext | null = null;
  private buses: Buses | null = null;
  private queue: Queued[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private _state: 'stopped' | 'playing' | 'paused' = 'stopped';
  private session = 0;

  get state(): 'stopped' | 'playing' | 'paused' { return this._state; }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private later(t: number, fn: () => void): void { this.queue.push({ t, fn }); }

  private pump = (): void => {
    if (this._state !== 'playing' || !this.ctx) return;
    const now = this.ctx.currentTime;
    const due = this.queue.filter(q => q.t <= now);
    if (!due.length) return;
    this.queue = this.queue.filter(q => q.t > now);
    due.sort((a, b) => a.t - b.t).forEach(q => q.fn());
  };

  play(lick: Lick, opts: PlayOptions, cb: PlayCallbacks = {}): void {
    this.stop();
    const ctx = this.ensureCtx();
    const session = ++this.session;
    this._state = 'playing';
    this.timer = setInterval(this.pump, 20);

    const buses: Buses = { lead: ctx.createGain(), piano: ctx.createGain(), met: ctx.createGain() };
    buses.lead.gain.value = opts.leadVolume;
    buses.piano.gain.value = opts.pianoVolume;
    buses.met.gain.value = 1;
    (Object.values(buses) as GainNode[]).forEach(b => b.connect(ctx.destination));
    this.buses = buses;

    const bpm = Math.min(320, Math.max(40, opts.bpm));
    const spb = 60 / bpm;
    const t0 = ctx.currentTime + 0.15;
    let start = t0;
    if (opts.countIn) {
      for (let i = 0; i < 4; i++) {
        click(ctx, buses.met, t0 + i * spb, i === 0);
        this.later(t0 + i * spb, () => cb.onStatus?.('Count-in: ' + (i + 1)));
      }
      start = t0 + 4 * spb;
    }

    const sounds = soundingNotes(lick);
    const byFirst = new Map<number, number[]>();
    for (const s of sounds) for (const i of s.indices) byFirst.set(i, s.indices);
    const compEv = opts.piano ? compEvents(lick.chords, opts.comp) : [];
    const bassEv = opts.piano ? bassEvents(lick.chords) : [];
    const beats = lick.totalTicks / TPB;
    const sw = opts.swing;

    const pass = (st: number): void => {
      if (session !== this.session || !this.buses) return;
      const end = st + beats * spb;
      this.later(st, () => cb.onStatus?.(`${bpm} BPM`));
      lick.notes.forEach((n, i) => {
        const idx = n.midi == null ? [] : byFirst.get(i) ?? [i];
        this.later(st + tickToBeats(n.start, sw) * spb, () => cb.onNote?.(idx));
      });
      for (const s of sounds) {
        const t = st + tickToBeats(s.start, sw) * spb;
        const art = s.dur === TICKS_PER_16TH ? 0.78 : s.dur <= 3 * TICKS_PER_16TH ? 0.9 : 0.97;
        const dur = spanBeats(s.start, s.dur, sw) * spb * art;
        lead(ctx, buses.lead, opts.timbre, s.midi, t, dur, s.start % (2 * TICKS_PER_16TH) ? 0.75 : 1); // 16ths off the 8th get a softer accent
      }
      if (opts.metronome) for (let j = 0; j < beats; j++) click(ctx, buses.met, st + j * spb, j % 4 === 0);
      for (const e of compEv) {
        const t = st + tickToBeats(e.tick, sw) * spb;
        const d = spanBeats(e.tick, e.dur, sw) * spb;
        e.midi.forEach(m => piano(ctx, buses.piano, m, t, d, 0.13));
      }
      for (const e of bassEv) {
        const t = st + tickToBeats(e.tick, sw) * spb;
        const d = spanBeats(e.tick, e.dur, sw) * spb * 0.92;
        e.midi.forEach(m => bass(ctx, buses.piano, m, t, d, 0.3));
      }
      // schedule the next pass (or the end) shortly before this one finishes
      this.later(end - 0.5 * spb - 0.15, () => {
        if (session !== this.session) return;
        if (opts.loop) pass(end);
        else this.later(end + 0.3, () => {
          if (session !== this.session) return;
          this.stop();
          cb.onNote?.([]);
          cb.onEnd?.();
        });
      });
    };
    pass(start);
  }

  pause(): void {
    if (this._state !== 'playing' || !this.ctx) return;
    this._state = 'paused';
    void this.ctx.suspend();
  }

  resume(): void {
    if (this._state !== 'paused' || !this.ctx) return;
    this._state = 'playing';
    void this.ctx.resume();
  }

  stop(): void {
    this.session++;
    this.queue = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._state = 'stopped';
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.buses && this.ctx) {
      const b = this.buses;
      this.buses = null;
      const nodes = Object.values(b) as GainNode[];
      nodes.forEach(n => n.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.03));
      setTimeout(() => nodes.forEach(n => n.disconnect()), 500);
    }
  }

  setVolumes(leadV: number, pianoV: number): void {
    if (!this.buses || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.buses.lead.gain.setTargetAtTime(leadV, t, 0.02);
    this.buses.piano.gain.setTargetAtTime(pianoV, t, 0.02);
  }
}
