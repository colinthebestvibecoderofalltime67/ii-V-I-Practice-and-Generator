import { beforeEach, describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import type { Lick } from '../src/types';
import { concertRange, getInstrument } from '../src/instruments';
import {
  DEFAULT_SETTINGS, FAVORITES_LIMIT, HISTORY_LIMIT, KEYS, Store, isValidLick, migrateLick, sanitizeSettings, type StorageLike,
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
    store.saveSettings({ ...DEFAULT_SETTINGS, bpm: 150, key: 3, target: 88, analyze: true });
    expect(store.loadSettings()).toMatchObject({ bpm: 150, key: 3, target: 88, analyze: true });
    mem.setItem(KEYS.settings, JSON.stringify({ bpm: 9999, key: 99, tier: 7, progressionId: 'nope', comp: 'x', loop: 'yes', swing: false }));
    const s = store.loadSettings();
    expect(s.bpm).toBe(320);
    expect(s.key).toBe(DEFAULT_SETTINGS.key);
    expect(s.target).toBe(DEFAULT_SETTINGS.target);
    expect(s.progressionId).toBe(DEFAULT_SETTINGS.progressionId);
    expect(s.comp).toBe(DEFAULT_SETTINGS.comp);
    expect(s.loop).toBe(DEFAULT_SETTINGS.loop);
    expect(s.swing).toBe(false);
    expect(s.straight16).toBe(true);
    expect(DEFAULT_SETTINGS.straight16).toBe(true);
    mem.setItem(KEYS.settings, JSON.stringify({ straight16: false }));
    expect(store.loadSettings().straight16).toBe(false);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates the old tier setting to a slider position and validates target', () => {
    expect([1, 2, 3, 4].map(tier => sanitizeSettings({ tier }).target)).toEqual([12, 37, 62, 87]);
    expect(sanitizeSettings({ target: 80, tier: 1 }).target).toBe(80);
    expect(sanitizeSettings({ target: 101 }).target).toBe(DEFAULT_SETTINGS.target);
    expect(sanitizeSettings({ target: 3.5 }).target).toBe(DEFAULT_SETTINGS.target);
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

describe('tab settings', () => {
  it('validates tabPosition and showFingers, falling back to defaults', () => {
    expect(DEFAULT_SETTINGS.tabPosition).toBe('auto');
    expect(DEFAULT_SETTINGS.showFingers).toBe(false);
    expect(sanitizeSettings({ tabPosition: 'Pos. VII', showFingers: true })).toMatchObject({ tabPosition: 'Pos. VII', showFingers: true });
    expect(sanitizeSettings({ tabPosition: 'Open pos.' }).tabPosition).toBe('Open pos.');
    for (const bad of ['Pos. 7', '<b>', 3, null, 'auto ']) expect(sanitizeSettings({ tabPosition: bad }).tabPosition).toBe('auto');
    expect(sanitizeSettings({ showFingers: 'yes' }).showFingers).toBe(false);
  });
});

describe('v1 -> v2 lick migration (16th-note ticks -> 12 ticks per beat)', () => {
  /** A lick as saved by the old app: version 1, 4 ticks per beat. */
  const v1 = (): Lick => {
    const l = mk(5);
    const k = (t: number) => t / 3;
    return {
      ...l, version: 1,
      chords: l.chords.map(c => ({ ...c, start: k(c.start), dur: k(c.dur) })),
      notes: l.notes.map(n => ({ ...n, start: k(n.start), dur: k(n.dur) })),
      totalTicks: k(l.totalTicks),
      cellStarts: l.cellStarts!.map(k),
    };
  };

  it('accepts version 1 and 2, rejects garbage versions', () => {
    expect(isValidLick(v1())).toBe(true);
    expect(isValidLick(mk(5))).toBe(true);
    expect(isValidLick({ ...mk(5), version: 3 })).toBe(false);
    expect(isValidLick({ ...mk(5), version: undefined })).toBe(false);
    expect(isValidLick(null)).toBe(false);
    expect(isValidLick('lick')).toBe(false);
    expect(isValidLick({ version: 1 })).toBe(false);
  });

  it('scales a v1 lick by 3 and marks it version 2', () => {
    const old = v1();
    const m = migrateLick(old);
    expect(m.version).toBe(2);
    expect(m.totalTicks).toBe(old.totalTicks * 3);
    expect(m.notes.map(n => [n.start, n.dur])).toEqual(old.notes.map(n => [n.start * 3, n.dur * 3]));
    expect(m.chords.map(c => [c.start, c.dur])).toEqual(old.chords.map(c => [c.start * 3, c.dur * 3]));
    expect(m.cellStarts).toEqual(old.cellStarts!.map(t => t * 3));
    expect(m).toEqual({ ...mk(5), createdAt: m.createdAt });
    expect(old.version).toBe(1); // input not mutated
  });

  it('leaves v2 licks untouched and handles a missing cellStarts', () => {
    const cur = mk(6);
    expect(migrateLick(cur)).toBe(cur);
    const { cellStarts: _drop, ...noCells } = v1();
    expect('cellStarts' in migrateLick(noCells as Lick)).toBe(false);
  });

  it('Store migrates v1 history and favorites on load, and rewrites them as v2', () => {
    const mem = new MemStorage();
    const store = new Store(mem);
    const old = v1();
    mem.setItem(KEYS.history, JSON.stringify([{ lick: old, at: 1 }, { lick: mk(7), at: 2 }, { lick: { ...old, id: 'bad', version: 9 }, at: 3 }]));
    mem.setItem(KEYS.favorites, JSON.stringify([{ lick: old, at: 1 }]));
    const h = store.loadHistory();
    expect(h.map(e => e.lick.version)).toEqual([2, 2]);
    expect(h[0].lick.totalTicks).toBe(old.totalTicks * 3);
    expect(store.loadFavorites()[0].lick.notes[1].start).toBe(old.notes[1].start * 3);
    store.addHistory(mk(8));
    expect(JSON.parse(mem.getItem(KEYS.history)!).every((e: { lick: Lick }) => e.lick.version === 2)).toBe(true);
  });
});
