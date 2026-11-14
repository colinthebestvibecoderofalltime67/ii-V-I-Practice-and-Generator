import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rec = vi.hoisted(() => ({ now: 0, late: [] as { what: string; t: number; at: number }[], n: 0 }));
const note = (what: string, t: number): void => { rec.n++; if (t < rec.now - 1e-9) rec.late.push({ what, t, at: rec.now }); };
vi.mock('../src/audio/synth', () => ({
  lead: (_c: unknown, _o: unknown, _tm: unknown, _midi: number, t: number) => note('lead', t),
  click: (_c: unknown, _o: unknown, t: number) => note('click', t),
  piano: (_c: unknown, _o: unknown, _m: number, t: number) => note('piano', t),
  bass: (_c: unknown, _o: unknown, _m: number, t: number) => note('bass', t),
}));

import { PASS_LOOKAHEAD, Player, type PlayOptions } from '../src/audio/player';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';

const range = concertRange(getInstrument('alto'));
const lick = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 11 });

const fakeGain = () => ({ gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined, disconnect: () => undefined });
class FakeCtx {
  state = 'running';
  destination = {};
  get currentTime() { return rec.now; }
  createGain() { return fakeGain(); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}
const opts = (o: Partial<PlayOptions> = {}): PlayOptions => ({
  bpm: 200, swing: false, straight16: true, loop: true, metronome: true, countIn: false, piano: true, comp: 'rootless',
  leadVolume: 0.8, pianoVolume: 0.6, timbre: 'reed', ...o,
});

describe('background-tab throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rec.now = 0; rec.late.length = 0; rec.n = 0;
    (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
  });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as { window?: unknown }).window; });

  it('looks at least 1.5 s ahead', () => { expect(PASS_LOOKAHEAD).toBeGreaterThanOrEqual(1.5); });

  it('with the timer clamped to 1 s, no later pass is scheduled in the past', () => {
    const p = new Player();
    const passes: number[] = [];
    p.play(lick, opts(), { onPassStart: i => passes.push(i) });
    // a throttled tab: the pump runs once per second of audio time
    for (let k = 0; k < 40; k++) { rec.now += 1; vi.advanceTimersByTime(20); }
    p.stop();
    expect(passes.length).toBeGreaterThanOrEqual(3);
    expect(rec.n).toBeGreaterThan(100);
    expect(rec.late).toEqual([]);
  });
});
