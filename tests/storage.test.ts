import { beforeEach, describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import {
  DEFAULT_SETTINGS, FAVORITES_LIMIT, HISTORY_LIMIT, KEYS, Store, isValidLick, sanitizeSettings, type StorageLike,
} from '../src/storage';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const blocked: StorageLike = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};

const range = concertRange(getInstrument('alto'));
const mk = (seed: number) => generateLick({ progressionId: 'major-251', length: 'standard', keyPc: seed % 12, tier: 2, range, seed });

describe('storage', () => {
  let mem: MemStorage;
  let store: Store;
  beforeEach(() => { mem = new MemStorage(); store = new Store(mem); });

  it('returns defaults for empty storage', () => {
    expect(store.loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(store.loadHistory()).toEqual([]);
    expect(store.loadFavorites()).toEqual([]);
  });

  it('round-trips settings and sanitizes bad values', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, bpm: 150, key: 3, tier: 4 });
    expect(store.loadSettings()).toMatchObject({ bpm: 150, key: 3, tier: 4 });
    mem.setItem(KEYS.settings, JSON.stringify({ bpm: 9999, key: 99, tier: 7, progressionId: 'nope', comp: 'x', loop: 'yes', swing: false }));
    const s = store.loadSettings();
    expect(s.bpm).toBe(320);
    expect(s.key).toBe('random');
    expect(s.tier).toBe(DEFAULT_SETTINGS.tier);
    expect(s.progressionId).toBe(DEFAULT_SETTINGS.progressionId);
    expect(s.comp).toBe(DEFAULT_SETTINGS.comp);
    expect(s.loop).toBe(DEFAULT_SETTINGS.loop);
    expect(s.swing).toBe(false);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
  });

  it('history is newest-first, deduped by id and capped', () => {
    const a = mk(1), b = mk(2);
    store.addHistory(a); store.addHistory(b); store.addHistory(a);
    expect(store.loadHistory().map(e => e.lick.id)).toEqual([a.id, b.id]);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) store.addHistory(mk(100 + i * 12));
    expect(store.loadHistory().length).toBe(HISTORY_LIMIT);
    store.clearHistory();
    expect(store.loadHistory()).toEqual([]);
  });

  it('favorites add/remove and cap', () => {
    const a = mk(5);
    store.addFavorite(a);
    expect(store.loadFavorites()).toHaveLength(1);
    store.removeFavorite(a.id);
    expect(store.loadFavorites()).toHaveLength(0);
    const big = Array.from({ length: FAVORITES_LIMIT + 3 }, (_, i) => ({ lick: { ...a, id: 'x' + i }, at: i }));
    mem.setItem(KEYS.favorites, JSON.stringify(big));
    expect(store.loadFavorites()).toHaveLength(FAVORITES_LIMIT);
  });

  it('drops corrupt entries and survives bad JSON', () => {
    const good = mk(7);
    mem.setItem(KEYS.history, JSON.stringify([
      { lick: good, at: 1 }, { lick: { ...good, id: 'bad', notes: 'nope' }, at: 2 }, null, 5, { at: 3 },
      { lick: { ...good, id: 'bad2', progressionId: 'unknown' }, at: 4 },
    ]));
    expect(store.loadHistory().map(e => e.lick.id)).toEqual([good.id]);
    mem.setItem(KEYS.history, '{not json');
    expect(store.loadHistory()).toEqual([]);
    mem.setItem(KEYS.favorites, '{"a":1}');
    expect(store.loadFavorites()).toEqual([]);
    expect(isValidLick(good)).toBe(true);
    expect(isValidLick(null)).toBe(false);
  });

  it('works with storage blocked', () => {
    const s = new Store(blocked);
    expect(s.loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => s.saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(s.addHistory(mk(1))).toBeTruthy();
    expect(s.loadFavorites()).toEqual([]);
    expect(() => new Store(null).addFavorite(mk(2))).not.toThrow();
  });
});
