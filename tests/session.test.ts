import { describe, expect, it } from 'vitest';
import { drillKeys } from '../src/practice/drill';
import { sessionStep, type SessionConfig } from '../src/practice/session';

const base = (o: Partial<SessionConfig> = {}): SessionConfig => ({ callResponse: true, responses: 1, drill: null, keys: [0], startBpm: 100, ...o });
const roles = (c: SessionConfig, n: number): string => Array.from({ length: n }, (_, i) => sessionStep(c, i).role[0]).join('');

describe('sessionStep without the drill', () => {
  it('alternates call and response', () => expect(roles(base(), 6)).toBe('crcrcr'));
  it('two responses per call', () => expect(roles(base({ responses: 2 }), 6)).toBe('crrcrr'));
  it('mutes the lead only on responses; never stops, never changes tempo or key', () => {
    for (let i = 0; i < 9; i++) {
      const s = sessionStep(base(), i);
      expect(s.silentLead).toBe(s.role === 'response');
      expect(s).toMatchObject({ done: false, drill: null, bpm: null, newKey: null });
    }
  });
  it('is all calls when call and response is off', () => {
    const c = base({ callResponse: false });
    expect(roles(c, 4)).toBe('cccc');
    expect(sessionStep(c, 3).groupIndex).toBe(3);
  });
  it('clamps responses to 1..2', () => {
    expect(roles(base({ responses: 9 }), 3)).toBe('crr');
    expect(roles(base({ responses: 0 }), 3)).toBe('crc');
  });
});

describe('sessionStep composed with the 12-key drill', () => {
  const keys = drillKeys(0, 'fourths');
  const drill = (o = {}) => ({ order: 'fourths' as const, repeats: 1, tempoStep: 0, maxBpm: 200, ...o });
  it('changes key after each call+response pair, never between them', () => {
    const c = base({ drill: drill(), keys });
    const seq = Array.from({ length: 6 }, (_, i) => sessionStep(c, i));
    expect(seq.map(s => s.role[0]).join('')).toBe('crcrcr');
    expect(seq.map(s => s.newKey)).toEqual([null, null, 5, null, 10, null]);
    expect(seq.map(s => s.drill!.key)).toEqual([0, 0, 5, 5, 10, 10]);
  });
  it('a pair counts as one repeat: repeats=2 gives 2 pairs per key', () => {
    const c = base({ drill: drill({ repeats: 2 }), keys });
    expect(Array.from({ length: 9 }, (_, i) => sessionStep(c, i).newKey)).toEqual([null, null, null, null, 5, null, null, null, 10]);
  });
  it('two responses: groups of 3 passes', () => {
    const c = base({ responses: 2, drill: drill(), keys });
    expect(Array.from({ length: 7 }, (_, i) => sessionStep(c, i).newKey)).toEqual([null, null, null, 5, null, null, 10]);
  });
  it('tempo ladder steps per key and is the same for a call and its response', () => {
    const c = base({ drill: drill({ tempoStep: 5 }), keys });
    expect(Array.from({ length: 6 }, (_, i) => sessionStep(c, i).bpm)).toEqual([100, 100, 105, 105, 110, 110]);
  });
  it('is done after 12 keys x repeats x group size passes', () => {
    const c = base({ drill: drill({ repeats: 2 }), keys });
    expect(sessionStep(c, 12 * 2 * 2 - 1).done).toBe(false);
    expect(sessionStep(c, 12 * 2 * 2).done).toBe(true);
  });
  it('drill alone (call and response off) behaves like plain drillStep', () => {
    const c = base({ callResponse: false, drill: drill(), keys });
    expect(sessionStep(c, 1)).toMatchObject({ role: 'call', newKey: 5, done: false });
    expect(sessionStep(c, 12).done).toBe(true);
  });
});
