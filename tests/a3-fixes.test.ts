import { describe, expect, it } from 'vitest';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { TIER_THRESHOLDS, displayScore, posToScore, tierForScore } from '../src/difficulty/score';
import { findTupletGroups } from '../src/theory/rhythm';
import { Store, DEFAULT_SETTINGS, type StorageLike } from '../src/storage';
import { plain } from '../src/export/pdf';

const range = concertRange(getInstrument('alto'));

describe('displayScore never crosses a tier threshold', () => {
  it('rounds down just below a threshold', () => {
    for (const th of TIER_THRESHOLDS) {
      for (const s of [th - 0.5, th - 0.3, th - 0.01]) {
        expect(tierForScore(displayScore(s))).toBe(tierForScore(s));
        expect(displayScore(s)).toBe(th - 1);
      }
      expect(displayScore(th)).toBe(th);
    }
    expect(displayScore(14.7)).toBe(14);
    expect(displayScore(posToScore(49))).toBe(14);
    expect(displayScore(posToScore(50))).toBe(15);
  });
});

describe('boundary targets stay inside the target tier', () => {
  it('slider 50 (score 15) yields Advanced licks', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const l = generateLick({ progressionId: 'major-251', length: 'short', keyPc: seed % 12, tier: 1, targetScore: posToScore(50), range, seed });
      expect(l.difficulty.score).toBeGreaterThanOrEqual(15);
    }
  });
  it('just below a boundary (slider 24 and 49) stays in the lower tier', () => {
    for (const [pos, tier] of [[24, 1], [49, 2]] as const) {
      for (let seed = 1; seed <= 60; seed++) {
        const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: seed % 12, tier: 1, targetScore: posToScore(pos), range, seed });
        expect(l.difficulty.tier, `pos ${pos} seed ${seed}`).toBe(tier);
      }
    }
  });
});

describe('Beginner never gets triplets', () => {
  it('no tuplet groups for tier-1 targets, including the known failing seed', () => {
    const cases: [number, number][] = [[22, 422], ...Array.from({ length: 150 }, (_, i) => [10 + (i % 15), 1000 + i] as [number, number])];
    for (const [pos, seed] of cases) {
      const l = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 1, targetScore: posToScore(pos), range, seed });
      expect(findTupletGroups(l.notes).groups).toEqual([]);
    }
  });
});

describe('favorites report what is stored', () => {
  const failing: StorageLike = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  it('returns the unchanged list and flags the failed write', () => {
    const store = new Store(failing);
    const l = generateLick({ progressionId: 'major-251', length: 'short', keyPc: 0, tier: 2, range, seed: 3 });
    expect(store.addFavorite(l)).toEqual([]);
    expect(store.lastWriteOk).toBe(false);
  });
});

describe('defaults and pdf text', () => {
  it('defaults to key C with count-in on', () => {
    expect(DEFAULT_SETTINGS.key).toBe(0);
    expect(DEFAULT_SETTINGS.countIn).toBe(true);
  });
  it('plain() replaces glyphs missing from PDF fonts', () => {
    expect(plain('B♭m7♭5 F♯7')).toBe('Bbm7b5 F#7');
  });
});
