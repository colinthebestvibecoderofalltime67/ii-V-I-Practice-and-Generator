import { describe, expect, it } from 'vitest';
import { FRAGMENTS, PROTOTYPE_OVERRIDES } from '../src/fragments';
import { generateLick } from '../src/generator';
import { posToScore } from '../src/difficulty/score';
import { concertRange, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { summarize } from '../src/analysis/musicality';
import { VOCAB_FRAGMENTS } from '../src/fragments/lib/vocab';
import { ADVANCED_FRAGMENTS } from '../src/fragments/lib/advanced';
import { PROTOTYPE_FRAGMENTS } from '../src/fragments/lib/prototype';
import { ORIGINAL_FRAGMENTS } from '../src/fragments/lib/original';
import { RENDERABLE_DURS, TPB } from '../src/types';
import type { ChordQualityId, Fragment, LengthId, Lick, Tier } from '../src/types';
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
    for (const f of [...ORIGINAL_FRAGMENTS, ...VOCAB_FRAGMENTS, ...ADVANCED_FRAGMENTS]) {
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
    expect(TRIPLET_FRAGMENTS.length).toBeLessThanOrEqual(220);
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


/* ---------------------------------- Phase 2 vocabulary ---------------------------------- */

const ALTERED_PCS = [1, 3, 6, 8];
const withTicks = (f: Fragment) => attacks(f).filter(a => a.n.rel !== null).map((a, i, arr) => ({ ...a, next: arr[i + 1] }));

describe('7alt vocabulary uses the altered scale', () => {
  const alt = FRAGMENTS.filter(f => f.qualities.includes('dom7alt'));

  it('has a real altered library', () => {
    expect(alt.length).toBeGreaterThanOrEqual(150);
    for (const beats of [2, 4] as const) for (const lv of [2, 3, 4]) {
      expect(alt.filter(f => f.beats === beats && f.level === lv).length, `${beats}b level ${lv}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('never attacks the natural 5 or natural 13 on a beat', () => {
    for (const f of alt) {
      for (const { n, t } of attacks(f)) {
        if (n.rel === null) continue;
        const pc = mod12(n.rel);
        if (pc === 7 || pc === 9) expect(t % TPB, `${f.id}: rel ${n.rel} at tick ${t} is a natural 5/13 on a beat over 7alt`).not.toBe(0);
      }
    }
  });

  it('allows a natural 5 or 13 only as an off-beat chromatic neighbour resolving by half step, and rarely', () => {
    let odd = 0;
    for (const f of alt) {
      for (const { n, next } of withTicks(f)) {
        const pc = mod12(n.rel as number);
        if (pc !== 7 && pc !== 9) continue;
        odd++;
        expect(next && Math.abs((next.n.rel as number) - (n.rel as number)) === 1, `${f.id}: natural ${pc} must resolve by half step`).toBe(true);
      }
    }
    expect(odd / alt.length).toBeLessThanOrEqual(0.02);
  });

  it('never plays the half-whole diminished scale over 7alt (natural 13 together with natural 5)', () => {
    for (const f of alt) {
      const pcs = new Set(f.notes.filter(n => n.rel !== null).map(n => mod12(n.rel as number)));
      expect(pcs.has(7) && pcs.has(9), f.id).toBe(false);
    }
    // the diminished sound still exists, over a plain V7
    const dim = FRAGMENTS.filter(f => f.qualities.includes('dom7') && !f.qualities.includes('dom7alt') && f.notes.some(n => n.rel !== null && mod12(n.rel) === 9) && f.notes.some(n => n.rel !== null && mod12(n.rel) === 6));
    expect(dim.length).toBeGreaterThanOrEqual(1);
  });

  it('every 7alt cell carries an altered tension (b9, #9, #11 or b13); only plain guide-tone cells at level 1 may be colourless', () => {
    const colourless = alt.filter(f => !f.notes.some(n => n.rel !== null && ALTERED_PCS.includes(mod12(n.rel))));
    for (const f of colourless) {
      expect(f.level, `${f.id} colourless`).toBe(1);
      expect(f.tags, `${f.id} colourless cells are not tagged altered`).not.toContain('altered');
    }
    // a Beginner lick over an altered V cannot afford altered notes in the difficulty score (they cost about a tier),
    // so level 1 keeps a pool of colourless guide-tone cells, but the coloured cells must clearly dominate from level 2 up
    for (const lv of [2, 3, 4]) expect(colourless.filter(f => f.level === lv).length).toBe(0);
    expect(alt.filter(f => !colourless.includes(f)).length).toBeGreaterThanOrEqual(130);
  });

  it('the prototype fixes live in src/fragments/index.ts and survive `npm run mine`', () => {
    // every override targets a generated prototype cell (or seed) that exists; the generated file stays untouched
    const ids = new Set([...PROTOTYPE_FRAGMENTS.map(f => f.id), 'dom7-seed-3']);
    for (const id of Object.keys(PROTOTYPE_OVERRIDES)) expect(ids.has(id), id).toBe(true);
    const raw = PROTOTYPE_FRAGMENTS.find(f => f.id === 'dom7-proto-45')!;
    const live = FRAGMENTS.find(f => f.id === 'dom7-proto-45')!;
    expect(raw.notes.some(n => n.rel === 7)).toBe(true);
    expect(live.notes.some(n => n.rel === 7)).toBe(false);
  });
});

describe('endings', () => {
  const endings = (q: ChordQualityId, beats: 2 | 4, level?: number) => FRAGMENTS.filter(f => f.ending && f.qualities.includes(q) && f.beats === beats && (level === undefined || f.level === level));
  const lastRel = (f: Fragment) => mod12([...f.notes].reverse().find(n => n.rel !== null)!.rel as number);

  it('there is a wide ending pool at every level, so no resolution dominates a tier', () => {
    for (const lv of [1, 2, 3, 4]) {
      expect(endings('maj7', 4, lv).length, `maj7 4b L${lv}`).toBeGreaterThanOrEqual(lv === 1 ? 20 : 14);
      expect(endings('maj7', 2, lv).length, `maj7 2b L${lv}`).toBeGreaterThanOrEqual(7);
      expect(endings('m6', 4, lv).length, `m6 4b L${lv}`).toBeGreaterThanOrEqual(lv === 1 ? 12 : 8);
      expect(endings('m6', 2, lv).length, `m6 2b L${lv}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('resolutions land on the root, 9th, 3rd, 5th, 6th and 7th, not only on the root', () => {
    for (const [q, want] of [['maj7', [0, 2, 4, 7, 9, 11]], ['m6', [0, 3, 7, 9, 11]]] as [ChordQualityId, number[]][]) {
      const all = [...endings(q, 4), ...endings(q, 2)];
      for (const pc of want) expect(all.filter(f => lastRel(f) === pc).length, `${q} ends on pc ${pc}`).toBeGreaterThanOrEqual(3);
      const onRoot = all.filter(f => lastRel(f) === 0).length;
      expect(onRoot / all.length, `${q} root share`).toBeLessThan(0.4);
    }
  });
});

describe('advanced vocabulary (levels 3-4)', () => {
  const adv = FRAGMENTS.filter(f => ADVANCED_FRAGMENTS.some(a => a.id === f.id));
  const rel = (f: Fragment) => f.notes.filter(n => n.rel !== null).map(n => n.rel as number);

  it('has 30-50 original cells, all at level 3 or 4, with unique ids', () => {
    expect(adv.length).toBeGreaterThanOrEqual(30);
    expect(adv.length).toBeLessThanOrEqual(50);
    expect(new Set(adv.map(f => f.id)).size).toBe(adv.length);
    for (const f of adv) { expect(f.level).toBeGreaterThanOrEqual(3); expect(f.source).toBe('original'); }
  });

  it('rhythmic displacement: a three- or five-note motif restated through eight 8ths, or dotted-8th groupings', () => {
    const eighth = 2 * 3;
    const cyc = adv.filter(f => f.beats === 4 && f.notes.length === 8 && f.notes.every(n => n.dur === eighth) && f.tags.includes('motif') && f.notes[0].rel !== null);
    expect(cyc.length).toBeGreaterThanOrEqual(8);
    const dotted = adv.filter(f => f.notes.some(n => n.dur === 9) && f.notes.some(n => n.dur === 6));
    expect(dotted.length).toBeGreaterThanOrEqual(4);
    // a cycled motif really repeats its first notes (cyclic shift against the 4-beat bar)
    for (const f of cyc) {
      const r = rel(f);
      const p = [3, 5].find(k => r.slice(0, 8 - k).every((v, i) => v === r[i + k]));
      expect(p, f.id).toBeDefined();
    }
    // off-beat statement restated on beat 3: starts with an 8th rest
    expect(adv.filter(f => f.notes[0].rel === null).length).toBeGreaterThanOrEqual(3);
  });

  it('triad pairs: 7alt uses only the bVI (b13 R #9) and bV (#11 b7 b9) triads', () => {
    const pairs = adv.filter(f => f.qualities.includes('dom7alt') && f.tags.includes('sequence') && f.tags.includes('arpeggio') && !f.tags.includes('motif'));
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (const f of pairs) for (const r of rel(f)) expect([8, 0, 3, 6, 10, 1], f.id).toContain(mod12(r));
    for (const q of ['maj7', 'm7', 'dom7', 'm6'] as const) expect(adv.some(f => f.qualities.includes(q) && f.tags.includes('sequence') && f.tags.includes('arpeggio') && f.notes.length >= 8 && !f.tags.includes('motif')), q).toBe(true);
  });

  it('Barry Harris 6th-diminished scale lines: the 8-note scale (added half step) over maj7 and m6', () => {
    const bh = adv.filter(f => f.tags.includes('bebop') && f.tags.includes('scale'));
    expect(bh.length).toBeGreaterThanOrEqual(6);
    for (const f of bh) {
      const pcs = new Set(rel(f).map(mod12));
      expect(pcs.has(8) && pcs.has(9), `${f.id} has both the b6 and the 6`).toBe(true);
      if (f.qualities.includes('m6')) expect(pcs.has(10), `${f.id} no b7`).toBe(false);
    }
    expect(bh.some(f => f.qualities.includes('maj7'))).toBe(true);
    expect(bh.some(f => f.qualities.includes('m6'))).toBe(true);
  });

  it('superimposition: the tritone-sub ii-V (Abm7-Db7) over 7alt is spelled out', () => {
    const f = adv.find(x => x.qualities.includes('dom7alt') && x.tags.includes('chromatic') && x.tags.includes('arpeggio'))!;
    const r = rel(f).map(mod12);
    expect(r.slice(0, 4)).toEqual([1, 4, 8, 11]); // Abm7 over G
    expect(r.slice(4, 8)).toEqual(expect.arrayContaining([6, 10, 1, 4])); // Db7 over G
  });

  it('outside-in: lines shifted up a half step and slipped back inside', () => {
    const oi = adv.filter(f => f.tags.includes('enclosure') && f.tags.includes('chromatic'));
    expect(oi.length).toBeGreaterThanOrEqual(5);
  });
});

describe('vocabulary breadth keeps cells from dominating', () => {
  it('library size by quality, beats and level', () => {
    for (const q of QUALS) {
      for (const beats of [2, 4] as const) {
        for (const lv of [1, 2, 3, 4]) {
          const n = FRAGMENTS.filter(f => !f.ending && f.qualities.includes(q) && f.beats === beats && f.level === lv && !f.id.includes('trip')).length;
          const min = q === 'm7b5' || q === 'm6' ? 6 : 10;
          expect(n, `${q} ${beats}b L${lv}`).toBeGreaterThanOrEqual(min);
        }
      }
    }
  });

  it('no cell appears in 5% of the licks of any tier (same seeded sample as `npm run musicality`)', () => {
    const POSITIONS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    const insts = ['alto', 'guitar'].map(getInstrument);
    const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
    let seed = 1;
    for (const p of PROGRESSIONS) for (const length of Object.keys(LENGTHS) as LengthId[]) for (const pos of POSITIONS) for (let s = 0; s < 6; s++) {
      const inst = insts[s % 2];
      const l = generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: posToScore(pos), range: concertRange(inst), seed: seed++ });
      byTier[l.requestedTier].push(l);
    }
    for (const t of [1, 2, 3, 4] as Tier[]) {
      const m = summarize(byTier[t]);
      expect(m.topCellShare, `tier ${t} top cell ${m.topCell}`).toBeLessThan(0.05);
    }
  }, 60_000);
});
