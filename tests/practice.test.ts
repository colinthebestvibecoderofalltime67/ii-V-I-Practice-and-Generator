import { beforeEach, describe, expect, it } from 'vitest';
import { generateLick, transposeLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { DEFAULT_SETTINGS, KEYS, Store } from '../src/storage';
import { PRACTICE_LIMIT, dayNumber, lickContentKey, pickForDay, recordPass, sanitizePractice } from '../src/practice/log';

class Mem {
  m = new Map<string, string>();
  fail = false;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail) throw new Error('quota'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const range = concertRange(getInstrument('alto'));
const lick = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 11 });
const other = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 12 });

describe('lickContentKey', () => {
  it('is the same in another key and another instrument range, different for another lick', () => {
    const f = transposeLick(lick, 5, range);
    expect(f.keyPc).toBe(5);
    expect(lickContentKey(f)).toBe(lickContentKey(lick));
    expect(lickContentKey(transposeLick(lick, 3, concertRange(getInstrument('tenor'))))).toBe(lickContentKey(lick));
    expect(lickContentKey(other)).not.toBe(lickContentKey(lick));
    expect(lickContentKey(lick)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('practice log', () => {
  it('records keys, passes, top bpm and last time', () => {
    const k = 'a'.repeat(16);
    let log = recordPass({}, k, 0, 120, 100);
    log = recordPass(log, k, 5, 160, 200);
    log = recordPass(log, k, 5, 100, 300);
    expect(log[k]).toEqual({ keys: [0, 5], passes: 3, topBpm: 160, lastAt: 300 });
  });
  it('evicts the oldest beyond the cap', () => {
    let log: ReturnType<typeof recordPass> = {};
    const id = (i: number) => i.toString(16).padStart(16, '0');
    for (let i = 0; i < PRACTICE_LIMIT + 5; i++) log = recordPass(log, id(i), 0, 100, i + 1);
    expect(Object.keys(log)).toHaveLength(PRACTICE_LIMIT);
    expect(log[id(0)]).toBeUndefined();
    expect(log[id(PRACTICE_LIMIT + 4)]).toBeDefined();
  });
  it('sanitize drops garbage and clamps', () => {
    const k = 'b'.repeat(16);
    const out = sanitizePractice({
      [k]: { keys: [3, 3, 14, -1, 'x', 7], passes: 2.4, topBpm: 9999, lastAt: 5 },
      short: { keys: [0], passes: 1, topBpm: 100, lastAt: 1 },
      ['c'.repeat(16)]: { keys: [], passes: 1, topBpm: 100, lastAt: 1 },
      ['d'.repeat(16)]: 'nope',
    });
    expect(out).toEqual({ [k]: { keys: [3, 7], passes: 2, topBpm: 320, lastAt: 5 } });
    expect(sanitizePractice(null)).toEqual({});
    expect(sanitizePractice([1, 2])).toEqual({});
    expect(sanitizePractice('x')).toEqual({});
  });
  it('picks the same item all day, by date', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const t = new Date(2026, 5, 3, 9).getTime();
    expect(pickForDay(items, t)).toBe(pickForDay(items, t + 6 * 3600_000));
    expect(dayNumber(t + 24 * 3600_000)).toBe(dayNumber(t) + 1);
    expect(pickForDay([], t)).toBeUndefined();
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pickForDay(items, t + i * 86_400_000)));
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('Store practice + sound settings', () => {
  let mem: Mem;
  let store: Store;
  beforeEach(() => { mem = new Mem(); store = new Store(mem); });

  it('recordPractice persists under iivi:v1:practice, merging keys of the same lick', () => {
    store.recordPractice(lick, 120, 1000);
    store.recordPractice(transposeLick(lick, 7, range), 150, 2000);
    expect(mem.getItem(KEYS.practice)).not.toBeNull();
    const [stat] = Object.values(new Store(mem).loadPractice());
    expect(stat).toEqual({ keys: [0, 7], passes: 2, topBpm: 150, lastAt: 2000 });
  });
  it('survives corrupt storage and a full quota', () => {
    mem.setItem(KEYS.practice, '{not json');
    expect(store.loadPractice()).toEqual({});
    store.recordPractice(lick, 100, 1);
    mem.fail = true;
    const log = store.recordPractice(lick, 200, 2);
    expect(store.lastWriteOk).toBe(false);
    expect(Object.values(log)[0].passes).toBe(1);
  });
  it('drum settings: defaults for old settings, round-trip, sanitizing', () => {
    mem.setItem(KEYS.settings, JSON.stringify({ bpm: 150 }));
    expect(store.loadSettings()).toMatchObject({ drums: true, drumVolume: 0.5, metronome24: false });
    store.saveSettings({ ...DEFAULT_SETTINGS, drums: false, drumVolume: 0.2, metronome24: true });
    expect(store.loadSettings()).toMatchObject({ drums: false, drumVolume: 0.2, metronome24: true });
    mem.setItem(KEYS.settings, JSON.stringify({ drums: 'yes', drumVolume: 7, metronome24: 1 }));
    expect(store.loadSettings()).toMatchObject({ drums: true, drumVolume: 1, metronome24: false });
  });
});

describe('practice log review fixes', () => {
  it('clamps corrupted or future lastAt to a real date range', () => {
    const k = '0123456789abcdef';
    const log = sanitizePractice({ [k]: { keys: [0], passes: 1, topBpm: 120, lastAt: 1e300 } });
    expect(log[k].lastAt).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(Number.isNaN(new Date(log[k].lastAt).getTime())).toBe(false);
  });
  it('always keeps the entry just recorded when the log is full, even with an older timestamp', () => {
    let log: Record<string, { keys: number[]; passes: number; topBpm: number; lastAt: number }> = {};
    for (let i = 0; i < 1000; i++) log[i.toString(16).padStart(16, '0')] = { keys: [0], passes: 1, topBpm: 100, lastAt: 2_000_000_000_000 + i };
    const key = 'ffffffffffffffff';
    log = recordPass(log, key, 5, 140, 1_700_000_000_000); // clock moved backwards
    expect(log[key]).toBeDefined();
    expect(Object.keys(log).length).toBe(1000);
  });
});

describe('floor exit stays inside the target tier (review fix)', () => {
  it('cello minor-251 long at slider 10 stays Beginner', async () => {
    const { generateLick } = await import('../src/generator/generate');
    const { posToScore, tierForScore } = await import('../src/difficulty/score');
    const { concertRange, concertRangeForLevel, getInstrument } = await import('../src/instruments');
    const cello = getInstrument('cello');
    const t = posToScore(10);
    const l = generateLick({ progressionId: 'minor-251', length: 'long', keyPc: 1, tier: 1, targetScore: t, range: concertRange(cello), comfortRange: concertRangeForLevel(cello, tierForScore(t)), seed: 9041 });
    expect(l.difficulty.tier).toBe(1);
  });
});
