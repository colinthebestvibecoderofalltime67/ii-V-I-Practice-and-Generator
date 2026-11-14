import { describe, expect, it } from 'vitest';
import { DRILL_ORDERS, drillKeys, drillStep, type DrillConfig, type DrillOrder } from '../src/practice/drill';

const ACTIVE = DRILL_ORDERS.filter(o => o !== 'off');
const cfg = (o: Partial<DrillConfig> = {}): DrillConfig => ({ order: 'fourths', repeats: 1, tempoStep: 0, maxBpm: 200, ...o });

describe('drillKeys', () => {
  it('every active order visits all 12 keys exactly once, starting on the start key', () => {
    for (const order of ACTIVE) for (let k = 0; k < 12; k++) {
      const seq = drillKeys(k, order, 7 + k);
      expect(seq).toHaveLength(12);
      expect(new Set(seq).size).toBe(12);
      expect(seq[0]).toBe(k);
    }
  });
  it('off is just the start key', () => expect(drillKeys(5, 'off')).toEqual([5]));
  it('cycle of 4ths from C is the jazz order', () => expect(drillKeys(0, 'fourths')).toEqual([0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]));
  it('cycle of 5ths from C', () => expect(drillKeys(0, 'fifths')).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]));
  it('chromatic up / down wrap around', () => {
    expect(drillKeys(10, 'chromatic-up').slice(0, 4)).toEqual([10, 11, 0, 1]);
    expect(drillKeys(1, 'chromatic-down').slice(0, 4)).toEqual([1, 0, 11, 10]);
  });
  it('whole steps: one whole-tone scale then the other', () => expect(drillKeys(0, 'whole-steps')).toEqual([0, 2, 4, 6, 8, 10, 1, 3, 5, 7, 9, 11]));
  it('random is deterministic per seed and differs between seeds', () => {
    expect(drillKeys(3, 'random', 42)).toEqual(drillKeys(3, 'random', 42));
    expect(drillKeys(3, 'random', 42)).not.toEqual(drillKeys(3, 'random', 43));
    expect(drillKeys(3, 'random', 42)).not.toEqual(drillKeys(3, 'chromatic-up'));
  });
  it('normalizes out-of-range start keys', () => expect(drillKeys(-1, 'chromatic-up')[0]).toBe(11));
});

describe('drillStep', () => {
  const keys = drillKeys(0, 'fourths');
  it('advances the key every `repeats` passes', () => {
    const c = cfg({ repeats: 2 });
    const seen = Array.from({ length: 24 }, (_, i) => drillStep(c, keys, 120, i));
    expect(seen.map(s => s.key)).toEqual(keys.flatMap(k => [k, k]));
    expect(seen.map(s => s.keyChanged).filter(Boolean)).toHaveLength(11);
    expect(seen[0].keyChanged).toBe(false);
    expect(seen[1]).toMatchObject({ repeat: 1, keyChanged: false });
    expect(seen[2]).toMatchObject({ repeat: 0, keyChanged: true, keyIndex: 1 });
    expect(seen.every(s => !s.done)).toBe(true);
  });
  it('is done after the last pass of the last key', () => {
    expect(drillStep(cfg({ repeats: 3 }), keys, 120, 35).done).toBe(false);
    expect(drillStep(cfg({ repeats: 3 }), keys, 120, 36)).toMatchObject({ done: true, keyIndex: 11 });
  });
  it('tempo ladder per key change, capped at max', () => {
    const c = cfg({ repeats: 2, tempoStep: 10, maxBpm: 150 });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => drillStep(c, keys, 120, i).bpm)).toEqual([120, 120, 130, 130, 140, 140, 150, 150, 150]);
  });
  it('tempo ladder per pass', () => {
    const c = cfg({ repeats: 2, tempoStep: 5, maxBpm: 200, tempoEvery: 'pass' });
    expect([0, 1, 2, 3].map(i => drillStep(c, keys, 100, i).bpm)).toEqual([100, 105, 110, 115]);
  });
  it('no ladder when step is 0; a start tempo above the cap is not lowered', () => {
    expect(drillStep(cfg({ tempoStep: 0 }), keys, 140, 5).bpm).toBe(140);
    expect(drillStep(cfg({ tempoStep: 10, maxBpm: 100 }), keys, 140, 5).bpm).toBe(140);
  });
  it('clamps repeats to 1..4 and works for a single-key cycle', () => {
    expect(drillStep(cfg({ repeats: 9 }), keys, 120, 4)).toMatchObject({ keyIndex: 1 });
    expect(drillStep(cfg({ repeats: 0 }), keys, 120, 1)).toMatchObject({ keyIndex: 1 });
    expect(drillStep(cfg({ order: 'off' }), [4], 120, 1).done).toBe(true);
  });
  it('covers all 12 keys for every order', () => {
    for (const order of ACTIVE as DrillOrder[]) {
      const ks = drillKeys(7, order, 5);
      const c = cfg({ order, repeats: 2 });
      const got = new Set(Array.from({ length: 24 }, (_, i) => drillStep(c, ks, 120, i).key));
      expect(got.size).toBe(12);
    }
  });
});
