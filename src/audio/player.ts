import type { Lick, Timbre } from '../types';
import { TICKS_PER_16TH, TPB } from '../types';
import { bassEvents, compEvents, type CompStyle } from './comping';
import { bass, click, lead, piano } from './synth';
import { findTupletGroups } from '../theory/rhythm';
import { makeTimeline, soundingNotes, timelineSpan } from './timing';

export interface PlayOptions {
  bpm: number; swing: boolean; straight16: boolean; loop: boolean; metronome: boolean; countIn: boolean;
  piano: boolean; comp: CompStyle; leadVolume: number; pianoVolume: number; timbre: Timbre;
}
/** onNote: `indices` = every note of the sounding tie chain (to highlight); `current` = the note that just started. */
/**
 * Returned by `onPass` to shape the NEXT pass of a looping play. `lick` and `bpm` are sticky (they stay in effect for
 * later passes until replaced); `silentLead` applies to that one pass only.
 */
export interface PassAction {
  /** Play this lick from the next bar line on. */
  lick?: Lick;
  /** Tempo for the next pass (clamped to 40..320). */
  bpm?: number;
  /** Lead muted for this pass (no lead notes, no highlight); backing and metronome still play. */
  silentLead?: boolean;
  /** End playback after the current pass instead of starting another (onEnd fires as usual). */
  stop?: boolean;
}
/** What a pass actually plays; reported to `onPassStart`. */
export interface PassInfo { lick: Lick; bpm: number; silentLead: boolean }
export interface PlayCallbacks {
  onNote?(indices: number[], current?: number): void;
  onStatus?(text: string): void;
  onEnd?(): void;
  /**
   * Loop hook, called shortly before pass `passIndex` (>= 1) is due, i.e. ahead of the bar line, so nothing stops or
   * restarts. Only consulted when `loop` is on. Return a PassAction to change the next pass. This fires BEFORE the
   * pass begins: update visible state in `onPassStart`, which fires exactly at the bar line.
   */
  onPass?(passIndex: number): PassAction | void;
  /** Fires at the start of every pass (index 0 included, after any count-in). */
  onPassStart?(passIndex: number, info: PassInfo): void;
}

/** Pure: fold a PassAction into the sticky lick/bpm state. */
export function applyPassAction(cur: { lick: Lick; bpm: number }, action: PassAction | void): { lick: Lick; bpm: number; silentLead: boolean } {
  return {
    lick: action?.lick ?? cur.lick,
    bpm: Math.min(320, Math.max(40, action?.bpm ?? cur.bpm)),
    silentLead: !!action?.silentLead,
  };
}

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
    const t0 = ctx.currentTime + 0.15;
    let start = t0;
    if (opts.countIn) {
      const spb0 = 60 / bpm;
      for (let i = 0; i < 4; i++) {
        click(ctx, buses.met, t0 + i * spb0, i === 0);
        this.later(t0 + i * spb0, () => cb.onStatus?.('Count-in: ' + (i + 1)));
      }
      start = t0 + 4 * spb0;
    }

    const pass = (st: number, passIndex: number, cur: Lick, curBpm: number, silent: boolean): void => {
      if (session !== this.session || !this.buses) return;
      const spb = 60 / curBpm;
      const sounds = soundingNotes(cur);
      const byFirst = new Map<number, number[]>();
      for (const s of sounds) for (const i of s.indices) byFirst.set(i, s.indices);
      const compEv = opts.piano ? compEvents(cur.chords, opts.comp) : [];
      const bassEv = opts.piano ? bassEvents(cur.chords) : [];
      const beats = cur.totalTicks / TPB;
      const tl = makeTimeline(cur.notes, { swing: opts.swing, straight16: opts.straight16 });
      const groups = findTupletGroups(cur.notes).groups;
      const end = st + beats * spb;
      this.later(st, () => cb.onPassStart?.(passIndex, { lick: cur, bpm: curBpm, silentLead: silent }));
      this.later(st, () => cb.onStatus?.(`${curBpm} BPM`));
      if (silent) this.later(st, () => cb.onNote?.([]));
      else cur.notes.forEach((n, i) => {
        const idx = n.midi == null ? [] : byFirst.get(i) ?? [i];
        this.later(st + tl(n.start) * spb, () => cb.onNote?.(idx, i));
      });
      if (!silent) for (const s of sounds) {
        const t = st + tl(s.start) * spb;
        const g = groups.find(x => s.start >= x.start && s.start < x.end);
        let art = s.dur === TICKS_PER_16TH ? 0.78 : s.dur <= 3 * TICKS_PER_16TH ? 0.9 : 0.97;
        let accent = s.start % (2 * TICKS_PER_16TH) ? 0.75 : 1; // 16ths off the 8th get a softer accent
        if (g) { // triplet notes: shorter in faster groups, first note of the group accented
          art = g.kind === 't16' ? 0.8 : g.kind === 't8' ? 0.9 : 0.95;
          accent = s.start === g.start ? 1 : 0.82;
        }
        const dur = timelineSpan(tl, s.start, s.dur) * spb * art;
        lead(ctx, buses.lead, opts.timbre, s.midi, t, dur, accent);
      }
      if (opts.metronome) for (let j = 0; j < beats; j++) click(ctx, buses.met, st + j * spb, j % 4 === 0);
      for (const e of compEv) {
        const t = st + tl(e.tick) * spb;
        const d = timelineSpan(tl, e.tick, e.dur) * spb;
        e.midi.forEach(m => piano(ctx, buses.piano, m, t, d, 0.13));
      }
      for (const e of bassEv) {
        const t = st + tl(e.tick) * spb;
        const d = timelineSpan(tl, e.tick, e.dur) * spb * 0.92;
        e.midi.forEach(m => bass(ctx, buses.piano, m, t, d, 0.3));
      }
      // ask for / schedule the next pass (or the end) shortly before this one finishes
      this.later(end - 0.5 * spb - 0.15, () => {
        if (session !== this.session) return;
        const action = opts.loop ? cb.onPass?.(passIndex + 1) : undefined;
        if (session !== this.session) return; // the callback may have stopped playback
        if (opts.loop && !action?.stop) {
          const next = applyPassAction({ lick: cur, bpm: curBpm }, action);
          pass(end, passIndex + 1, next.lick, next.bpm, next.silentLead);
        } else this.later(end + 0.3, () => {
          if (session !== this.session) return;
          this.stop();
          cb.onNote?.([]);
          cb.onEnd?.();
        });
      });
    };
    pass(start, 0, lick, bpm, false);
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
