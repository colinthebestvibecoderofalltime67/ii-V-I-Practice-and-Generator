import { describe, expect, it } from 'vitest';
import { FRAGMENTS } from '../src/fragments';
import { ORIGINAL_FRAGMENTS } from '../src/fragments/lib/original';
import { RENDERABLE_DURS } from '../src/types';
import type { ChordQualityId, Fragment } from '../src/types';
import { isChordToneOrTension } from '../src/theory/chords';

const QUALS: ChordQualityId[] = ['m7', 'm7b5', 'dom7', 'dom7alt', 'maj7', 'm6'];
const ENDING_OK = new Set([0, 2, 3, 4, 7, 9, 11]);
const mod12 = (n: number) => ((n % 12) + 12) % 12;

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
      expect(f.notes.reduce((s, n) => s + n.dur, 0)).toBe(f.beats * 4);
      for (const n of f.notes) expect((RENDERABLE_DURS as readonly number[]).includes(n.dur)).toBe(true);
      f.notes.forEach((n, i) => {
        if (n.tie) {
          expect(n.rel).not.toBeNull();
          expect(f.notes[i + 1]?.rel).toBe(n.rel);
        }
      });
      expect(f.notes.some(n => n.rel !== null)).toBe(true);
    });

    it(`${f.id} obeys the strong-beat rule`, () => {
      for (const { n, t } of attacks(f)) {
        if (n.rel === null || (t !== 0 && t !== 8)) continue;
        for (const q of f.qualities) expect(isChordToneOrTension(n.rel, 0, q), `${f.id} rel ${n.rel} at tick ${t} over ${q}`).toBe(true);
      }
    });

    if (f.ending) {
      it(`${f.id} ends on a held chord tone`, () => {
        const sounding = f.notes.filter(n => n.rel !== null);
        let last = sounding.length - 1;
        let dur = sounding[last].dur;
        while (last > 0 && sounding[last - 1].tie) { last--; dur += sounding[last].dur; }
        expect(dur).toBeGreaterThanOrEqual(4);
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
