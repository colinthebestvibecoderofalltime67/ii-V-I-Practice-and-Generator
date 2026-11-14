import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ drum: [] as { kind: string; t: number; out: unknown }[], click: [] as { t: number; accent: boolean }[], lead: 0 }));
vi.mock('../src/audio/synth', () => ({
  lead: () => { calls.lead++; },
  click: (_c: unknown, _o: unknown, t: number, accent: boolean) => { calls.click.push({ t, accent }); },
  piano: () => undefined,
  bass: () => undefined,
  drum: (_c: unknown, out: unknown, kind: string, t: number) => { calls.drum.push({ kind, t, out }); },
}));

import { Player, type PlayOptions } from '../src/audio/player';
import { drumEvents } from '../src/audio/drums';
import { tickToBeats } from '../src/audio/timing';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { TPB } from '../src/types';

const range = concertRange(getInstrument('alto'));
const lick = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 11 });

const gains: { gain: { value: number } }[] = [];
const fakeGain = () => { const g = { gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined, disconnect: () => undefined }; gains.push(g); return g; };
class FakeCtx {
  static now = 0;
  state = 'running';
  destination = {};
  get currentTime() { return FakeCtx.now; }
  createGain() { return fakeGain(); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}
const opts = (o: Partial<PlayOptions> = {}): PlayOptions => ({
  bpm: 240, swing: true, straight16: true, loop: true, metronome: false, countIn: false, piano: true, comp: 'rootless',
  leadVolume: 0.8, pianoVolume: 0.6, timbre: 'reed', drums: true, drumVolume: 0.4, ...o,
});
const run = (seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / 0.02); i++) { FakeCtx.now += 0.02; vi.advanceTimersByTime(20); }
};

describe('Player drums', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeCtx.now = 0;
    calls.drum.length = 0; calls.click.length = 0; calls.lead = 0; gains.length = 0;
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
  });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as { window?: unknown }).window; });

  it('schedules the whole pattern on the swing timeline, per pass, on its own bus', () => {
    const p = new Player();
    p.play(lick, opts(), { onPass: i => (i === 2 ? { stop: true } : undefined) });
    run(20);
    const n = (pass: number) => drumEvents(lick.totalTicks, { seed: lick.seed * 131 + pass }).length;
    const per = n(0);
    expect(calls.drum).toHaveLength(n(0) + n(1));
    // the drum bus got the volume
    expect(gains.some(g => g.gain.value === 0.4)).toBe(true);
    expect(new Set(calls.drum.map(d => d.out)).size).toBe(1);
    // times: pass 0 starts at 0.15 s (no count-in), spb = 0.25
    // drums swing every beat on the plain grid, whatever the lead does (straight 16ths / triplets don't straighten the ride)
    const ev = drumEvents(lick.totalTicks, { seed: lick.seed * 131 });
    const first = calls.drum.slice(0, per).map(d => d.t);
    ev.forEach((e, i) => expect(first[i]).toBeCloseTo(0.15 + tickToBeats(e.tick, true) * 0.25, 6));
    // pass 1 begins one pass later, with a different ghost-snare seed
    const passLen = (lick.totalTicks / TPB) * 0.25;
    expect(calls.drum[per].t).toBeCloseTo(0.15 + passLen, 6);
  });

  it('plays no drums during the count-in, and none when drums or Backing are off', () => {
    const p = new Player();
    p.play(lick, opts({ countIn: true, loop: false }), {});
    run(10);
    const start = 0.15 + 4 * 0.25;
    expect(calls.click).toHaveLength(4);
    expect(calls.drum.length).toBeGreaterThan(0);
    expect(calls.drum.every(d => d.t >= start - 1e-9)).toBe(true);
    for (const o of [{ drums: false }, { piano: false }]) {
      calls.drum.length = 0;
      p.play(lick, opts({ ...o, loop: false }), {});
      run(10);
      expect(calls.drum).toHaveLength(0);
    }
  });

  it('keeps playing drums during a silent-lead (your turn) pass', () => {
    const p = new Player();
    p.play(lick, opts(), { onPass: i => (i === 1 ? { silentLead: true } : i === 2 ? { stop: true } : undefined) });
    run(20);
    const n = (pass: number) => drumEvents(lick.totalTicks, { seed: lick.seed * 131 + pass }).length;
    expect(calls.drum).toHaveLength(n(0) + n(1));
  });

  it('metronome on 2 and 4 clicks only those beats, count-in unchanged', () => {
    const p = new Player();
    p.play(lick, opts({ metronome: true, metronome24: true, countIn: true, drums: false, loop: false }), {});
    run(10);
    const beats = lick.totalTicks / TPB;
    expect(calls.click).toHaveLength(4 + beats / 2);
    expect(calls.click.slice(0, 4).map(c => c.accent)).toEqual([true, false, false, false]);
    const t0 = 0.15 + 4 * 0.25;
    calls.click.slice(4).forEach((c, i) => expect(c.t).toBeCloseTo(t0 + (2 * i + 1) * 0.25, 6));
    expect(calls.click.slice(4).every(c => !c.accent)).toBe(true);
  });

  it('onPassEnd fires once per completed pass with the lick and tempo, not for a stopped pass', () => {
    const p = new Player();
    const ends: { i: number; bpm: number }[] = [];
    p.play(lick, opts({ countIn: false }), {
      onPass: i => (i === 1 ? { bpm: 200 } : i === 3 ? { stop: true } : undefined),
      onPassEnd: (i, info) => ends.push({ i, bpm: info.bpm }),
    });
    run(30);
    expect(ends).toEqual([{ i: 0, bpm: 240 }, { i: 1, bpm: 200 }, { i: 2, bpm: 200 }]);
    ends.length = 0;
    p.play(lick, opts({ countIn: false }), { onPassEnd: i => ends.push({ i, bpm: 0 }) });
    run(1);
    p.stop();
    run(10);
    expect(ends).toEqual([]);
  });
});
