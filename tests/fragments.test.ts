import { describe, expect, it } from 'vitest';
import { FRAGMENTS } from '../src/fragments';
import { ORIGINAL_FRAGMENTS } from '../src/fragments/lib/original';
import { RENDERABLE_DURS, TPB } from '../src/types';
import type { ChordQualityId, Fragment } from '../src/types';
import { isChordToneOrTension } from '../src/theory/chords';
import { findTupletGroups, isTupletDur } from '../src/theory/rhythm';
import { isValidFragment } from '../src/generator/generate';
import { TRIPLET_FRAGMENTS } from '../src/fragments/lib/triplets';
import { parseNotes } from '../src/fragments/lib/notation';

const QUALS: ChordQualityId[] = ['m7', 'm7b5', 'dom7', 'dom7alt', 'maj7', 'm6'];
const ENDING_OK = new Set([0, 2, 3, 4, 7, 9, 11]);
const mod12 = (n: number) => ((n % 12) + 12) % 12;

// FRAGMENTS is already scaled to the engine grid (12 ticks per beat), so ticks below are engine ticks.
const attacks = (f: Fragment) => {
  let t = 0;
  return f.notes.map(n => { const r = { n, t }; t += n.dur; return r; });
};

describe('fragment structure', () => {
  it('has unique ids', () => {
    const ids = FRAGMENTS.map(f => f.id);
    expect(ids.length - new Set(ids).size).toBe(0);
  });

  for (const f of FRAGMENTS) {
    it(`${f.id} is structurally valid`, () => {
      expect(f.qualities.length).toBeGreaterThan(0);
      expect(f.notes.reduce((s, n) => s + n.dur, 0)).toBe(f.beats * TPB);
      // non-triplet durations are renderable; triplet durations must form well-formed groups with no ties
      for (const n of f.notes) expect(isTupletDur(n.dur) || (RENDERABLE_DURS as readonly number[]).includes(n.dur), `${f.id} dur ${n.dur}`).toBe(true);
      expect(findTupletGroups(attacks(f).map(({ n, t }) => ({ start: t, dur: n.dur }))).errors, f.id).toEqual([]);
      expect(isValidFragment(f), `${f.id} isValidFragment`).toBe(true);
      f.notes.forEach((n, i) => {
        if (isTupletDur(n.dur)) {
          expect(n.tie, `${f.id} tie inside triplet`).toBeFalsy();
          expect(f.notes[i - 1]?.tie, `${f.id} tie into triplet`).toBeFalsy();
        }
        if (n.tie) {
          expect(n.rel).not.toBeNull();
          expect(f.notes[i + 1]?.rel).toBe(n.rel);
        }
      });
      expect(f.notes.some(n => n.rel !== null)).toBe(true);
    });

    it(`${f.id} obeys the strong-beat rule`, () => {
      for (const { n, t } of attacks(f)) {
        if (n.rel === null || (t !== 0 && t !== 2 * TPB)) continue;
        for (const q of f.qualities) expect(isChordToneOrTension(n.rel, 0, q), `${f.id} rel ${n.rel} at tick ${t} over ${q}`).toBe(true);
      }
    });

    if (f.ending) {
      it(`${f.id} ends on a held chord tone`, () => {
        const sounding = f.notes.filter(n => n.rel !== null);
        let last = sounding.length - 1;
        let dur = sounding[last].dur;
        while (last > 0 && sounding[last - 1].tie) { last--; dur += sounding[last].dur; }
        expect(dur).toBeGreaterThanOrEqual(TPB);
        expect(ENDING_OK.has(mod12(sounding[sounding.length - 1].rel as number))).toBe(true);
      });
    }
  }

  it('original fragments keep a sane register', () => {
    for (const f of ORIGINAL_FRAGMENTS) {
      const rels = f.notes.filter(n => n.rel !== null).map(n => n.rel as number);
      expect(Math.max(...rels) - Math.min(...rels), f.id).toBeLessThanOrEqual(17);
      expect(Math.min(...rels), f.id).toBeGreaterThanOrEqual(-7);
      expect(Math.max(...rels), f.id).toBeLessThanOrEqual(26);
    }
  });

  it('m6-family fragments never contain a b7', () => {
    for (const f of FRAGMENTS.filter(x => x.qualities.includes('m6') || x.qualities.includes('mMaj7')))
      for (const n of f.notes) if (n.rel !== null) expect(mod12(n.rel), f.id).not.toBe(10);
  });
});

describe('triplet notation and validation', () => {
  it('maps triplet tokens straight to ticks and still scales plain numbers', () => {
    expect(parseNotes('0:t16 3:t16x2 r:t8 7:t8x2 9:tq 10:tqx2 4:2 5:4~ 5:1', 3).map(n => n.dur)).toEqual([2, 4, 4, 8, 8, 16, 6, 12, 3]);
    expect(parseNotes('0:4 3:2', 1).map(n => n.dur)).toEqual([4, 2]);
    expect(() => parseNotes('0:t8', 1)).toThrow();
    expect(() => parseNotes('0:t8~ 0:t8', 3)).toThrow();
  });
  const mk = (notes: string, beats: 2 | 4 = 2): Fragment => ({ id: 'x', qualities: ['m7'], beats, notes: parseNotes(notes, 3), tags: [], level: 2, source: 'original' });
  it('accepts well-formed triplet fragments', () => {
    expect(isValidFragment(mk('0:t8 3:t8 7:t8 10:4'))).toBe(true);
    expect(isValidFragment(mk('0:tq 3:tqx2'))).toBe(true);
    expect(isValidFragment(mk('0:2 3:t16 5:t16 7:t16 10:4'))).toBe(true);
    expect(isValidFragment(mk('r:t8 3:t8x2 10:4'))).toBe(true);
  });
  it('rejects malformed triplet fragments', () => {
    expect(isValidFragment(mk('0:t8 3:t8 10:4'))).toBe(false); // group does not fill its span / total wrong
    expect(isValidFragment(mk('0:2 3:t8 5:t8 7:t8 10:2'))).toBe(false); // t8 group off the beat
    expect(isValidFragment(mk('0:4 3:tq 5:tq 7:tq'))).toBe(false); // quarter-triplet starting on beat 2
    const tied = mk('0:t8 0:t8 7:t8 10:4');
    tied.notes[0].tie = true; // tie out of a triplet group
    expect(isValidFragment(tied)).toBe(false);
    const into = mk('0:4 0:t8 3:t8 7:t8 10:4', 4);
    into.notes[0].tie = true; // tie into a triplet group (and total is wrong anyway)
    expect(isValidFragment(into)).toBe(false);
    const into2 = mk('0:4 0:4 3:t8 7:t8 10:t8 3:4', 4);
    into2.notes[1].tie = true;
    expect(isValidFragment(into2)).toBe(false);
  });
  it('the triplet library has the intended size, kinds and levels', () => {
    expect(TRIPLET_FRAGMENTS.length).toBeGreaterThanOrEqual(60);
    expect(TRIPLET_FRAGMENTS.length).toBeLessThanOrEqual(90);
    const kinds = (f: Fragment) => new Set(findTupletGroups(attacks(f).map(({ n, t }) => ({ start: t, dur: n.dur }))).groups.map(g => g.kind));
    for (const f of TRIPLET_FRAGMENTS) {
      const ks = kinds(f);
      expect(ks.size, `${f.id} has a triplet`).toBeGreaterThan(0);
      expect(f.source).toBe('original');
      expect(f.id).toMatch(/^[a-z0-9]+-trip-\d{2}$/);
      if (ks.has('t16')) expect(f.level, `${f.id} t16 only at level 4`).toBe(4);
      if (ks.has('tq')) expect(f.level, `${f.id} tq at 3-4`).toBeGreaterThanOrEqual(3);
      expect(f.level).toBeGreaterThanOrEqual(2);
    }
    for (const q of ['m7', 'm7b5', 'dom7', 'dom7alt', 'maj7', 'm6', 'mMaj7'] as const) {
      expect(TRIPLET_FRAGMENTS.filter(f => f.qualities.includes(q)).length, q).toBeGreaterThanOrEqual(8);
      expect(TRIPLET_FRAGMENTS.some(f => f.qualities.includes(q) && f.beats === 2), q).toBe(true);
      expect(TRIPLET_FRAGMENTS.some(f => f.qualities.includes(q) && f.beats === 4), q).toBe(true);
    }
    expect(TRIPLET_FRAGMENTS.filter(f => f.ending).length).toBeGreaterThanOrEqual(4);
  });
  it('triplet fragments keep a sane register', () => {
    for (const f of TRIPLET_FRAGMENTS) {
      const rels = f.notes.filter(n => n.rel !== null).map(n => n.rel as number);
      expect(Math.max(...rels) - Math.min(...rels), f.id).toBeLessThanOrEqual(17);
      expect(Math.min(...rels), f.id).toBeGreaterThanOrEqual(-7);
      expect(Math.max(...rels), f.id).toBeLessThanOrEqual(26);
    }
  });
});

describe('fragment coverage', () => {
  const count = (pred: (f: Fragment) => boolean) => FRAGMENTS.filter(pred).length;

  for (const q of QUALS) {
    for (const beats of [2, 4] as const) {
      it(`${q} has >= 4 ${beats}-beat fragments`, () => {
        expect(count(f => f.qualities.includes(q) && f.beats === beats)).toBeGreaterThanOrEqual(4);
      });
    }
  }

  for (const q of ['maj7', 'm6'] as const) {
    it(`${q} has >= 3 endings`, () => {
      expect(count(f => f.qualities.includes(q) && !!f.ending)).toBeGreaterThanOrEqual(3);
    });
  }

  it('maj7 has non-ending 4-beat and 2-beat material', () => {
    expect(count(f => f.qualities.includes('maj7') && f.beats === 4 && !f.ending)).toBeGreaterThanOrEqual(8);
    expect(count(f => f.qualities.includes('maj7') && f.beats === 2 && !f.ending)).toBeGreaterThanOrEqual(6);
  });

  for (const q of ['m7', 'dom7', 'maj7'] as const) {
    for (const tier of [1, 2, 3, 4]) {
      it(`${q} has >= 3 fragments at level ${tier}`, () => {
        expect(count(f => f.qualities.includes(q) && f.level === tier)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('dom7alt and expert coverage', () => {
    for (const q of ['m7', 'dom7', 'dom7alt', 'maj7'] as const)
      expect(count(f => f.source === 'original' && f.qualities.includes(q) && f.level === 4), q).toBeGreaterThanOrEqual(6);
    expect(count(f => f.source === 'original' && f.qualities.includes('dom7alt'))).toBeGreaterThanOrEqual(20);
    expect(count(f => f.source === 'original' && f.qualities.includes('m6') && !!f.ending)).toBeGreaterThanOrEqual(8);
  });
});
