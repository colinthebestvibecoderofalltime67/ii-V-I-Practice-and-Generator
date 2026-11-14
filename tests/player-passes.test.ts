import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ lead: [] as { midi: number; t: number }[], click: [] as number[], piano: [] as number[] }));
vi.mock('../src/audio/synth', () => ({
  lead: (_c: unknown, _o: unknown, _tm: unknown, midi: number, t: number) => { calls.lead.push({ midi, t }); },
  click: (_c: unknown, _o: unknown, t: number) => { calls.click.push(t); },
  piano: (_c: unknown, _o: unknown, _m: number, t: number) => { calls.piano.push(t); },
  bass: () => undefined,
  drum: () => undefined,
}));

import { Player, applyPassAction, type PassInfo, type PlayOptions } from '../src/audio/player';
import { generateLick, transposeLick } from '../src/generator';
import { TPB } from '../src/types';
import { soundingNotes } from '../src/audio/timing';
import { concertRange, getInstrument } from '../src/instruments';

const range = concertRange(getInstrument('alto'));
const lick = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 11 });
const lick2 = transposeLick(lick, 5, range);

const fakeGain = () => ({ gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined, disconnect: () => undefined });
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
  bpm: 240, swing: false, straight16: true, loop: true, metronome: false, countIn: true, piano: true, comp: 'rootless',
  leadVolume: 0.8, pianoVolume: 0.6, timbre: 'reed', ...o,
});

/** Advance the fake audio clock in 20 ms steps and run the player's pump interval each step. */
const run = (seconds: number): void => {
  const steps = Math.round(seconds / 0.02);
  for (let i = 0; i < steps; i++) { FakeCtx.now += 0.02; vi.advanceTimersByTime(20); }
};

describe('applyPassAction', () => {
  it('keeps lick and bpm when there is no action; silentLead is one-shot', () => {
    expect(applyPassAction({ lick, bpm: 120 }, undefined)).toEqual({ lick, bpm: 120, silentLead: false });
    expect(applyPassAction({ lick, bpm: 120 }, { lick: lick2, bpm: 140, silentLead: true })).toEqual({ lick: lick2, bpm: 140, silentLead: true });
  });
  it('clamps bpm to 40..320', () => {
    expect(applyPassAction({ lick, bpm: 120 }, { bpm: 999 }).bpm).toBe(320);
    expect(applyPassAction({ lick, bpm: 120 }, { bpm: 5 }).bpm).toBe(40);
  });
});

describe('Player loop hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeCtx.now = 0;
    calls.lead.length = 0; calls.click.length = 0; calls.piano.length = 0;
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
  });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as { window?: unknown }).window; });

  it('calls onPass before each new pass, swaps lick/bpm seamlessly, count-in only once, then ends on stop', () => {
    const p = new Player();
    const starts: { i: number; info: PassInfo; at: number }[] = [];
    const passCalls: { i: number; at: number }[] = [];
    let ended = 0;
    p.play(lick, opts(), {
      onPass: i => {
        passCalls.push({ i, at: FakeCtx.now });
        if (i === 1) return { lick: lick2, bpm: 300 };
        if (i === 3) return { stop: true };
        return undefined;
      },
      onPassStart: (i, info) => starts.push({ i, info, at: FakeCtx.now }),
      onEnd: () => { ended++; },
    });
    run(30);
    expect(ended).toBe(1);
    expect(p.state).toBe('stopped');
    expect(passCalls.map(c => c.i)).toEqual([1, 2, 3]);
    expect(starts.map(s => s.i)).toEqual([0, 1, 2]);
    expect(starts[0].info.lick).toBe(lick);
    expect(starts[1].info).toMatchObject({ lick: lick2, bpm: 300, silentLead: false });
    expect(starts[2].info).toMatchObject({ lick: lick2, bpm: 300 }); // sticky
    // the hook is consulted before the pass begins, never after
    for (let k = 0; k < 2; k++) expect(passCalls[k].at).toBeLessThanOrEqual(starts[k + 1].at);
    // count-in: exactly 4 clicks, all before the first pass (metronome is off)
    expect(calls.click).toHaveLength(4);
    // pass 1 starts one pass-length (at the old tempo) after pass 0
    const spb = 60 / 240;
    expect(starts[1].at - starts[0].at).toBeCloseTo((lick.totalTicks / TPB) * spb, 1);
  });

  it('silentLead pass plays no lead notes and highlights nothing, backing still plays', () => {
    const p = new Player();
    const notes: (number[] | undefined)[] = [];
    let silentStartedAt = -1;
    p.play(lick, opts({ countIn: false }), {
      onPass: i => (i === 1 ? { silentLead: true } : i === 2 ? { stop: true } : undefined),
      onPassStart: (i, info) => { if (info.silentLead) silentStartedAt = i; },
      onNote: idx => notes.push(idx),
    });
    run(20);
    expect(silentStartedAt).toBe(1);
    // two passes were scheduled but only pass 0 produced lead notes
    expect(calls.lead).toHaveLength(soundingNotes(lick).length);
    expect(notes.filter(n => n && n.length).length).toBeGreaterThan(0);
    // backing (comping) was scheduled in both passes
    const first = Math.min(...calls.piano);
    expect(calls.piano.filter(t => t > first + (lick.totalTicks / TPB) * (60 / 240) - 0.01).length).toBeGreaterThan(0);
  });

  it('does not consult onPass when loop is off', () => {
    const p = new Player();
    const onPass = vi.fn();
    let ended = 0;
    p.play(lick, opts({ loop: false, countIn: false }), { onPass, onEnd: () => { ended++; } });
    run(10);
    expect(onPass).not.toHaveBeenCalled();
    expect(ended).toBe(1);
  });
});
