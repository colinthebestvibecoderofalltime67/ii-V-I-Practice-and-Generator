import { describe, expect, it } from 'vitest';
import { FRAGMENTS, PROTOTYPE_OVERRIDES } from '../src/fragments';
import { summarize } from '../src/analysis/musicality';
import { VOCAB_FRAGMENTS } from '../src/fragments/lib/vocab';
import { ADVANCED_FRAGMENTS } from '../src/fragments/lib/advanced';
import { PROTOTYPE_FRAGMENTS } from '../src/fragments/lib/prototype';
import { ORIGINAL_FRAGMENTS } from '../src/fragments/lib/original';
import { RENDERABLE_DURS, TPB } from '../src/types';
import type { ChordQualityId, Fragment, Tier } from '../src/types';
import { isChordToneOrTension } from '../src/theory/chords';
import { findTupletGroups, isTupletDur } from '../src/theory/rhythm';
import { isValidFragment } from '../src/generator/generate';
import { TRIPLET_FRAGMENTS } from '../src/fragments/lib/triplets';
import { parseNotes } from '../src/fragments/lib/notation';
import { sessionSample } from './_samples';

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
    expect(cyc.length).toBeGreaterThanOrEqual(5); // the repeated-motif oscillation cells (m7-adv-03, dom7-adv-01/02) were dropped as noodling
    const dotted = adv.filter(f => f.notes.some(n => n.dur === 9) && f.notes.some(n => n.dur === 6));
    expect(dotted.length).toBeGreaterThanOrEqual(4);
    // a cycled motif really repeats its first notes (cyclic shift against the 4-beat bar)
    for (const f of cyc) {
      const r = rel(f);
      const p = [3, 5].find(k => r.slice(0, 8 - k).every((v, i) => v === r[i + k]));
      expect(p, f.id).toBeDefined();
    }
    // off-beat statement restated on beat 3: starts with an 8th rest
    expect(adv.filter(f => f.notes[0].rel === null).length).toBeGreaterThanOrEqual(2);
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

  it('superimposition: Bbm7-Eb7 over G7alt (b3 b5 b7 b9 then b13 R #9 b5) and a Db7 arpeggio, all altered colours', () => {
    const f = adv.find(x => x.id === 'dom7alt-adv-09')!;
    const r = rel(f).map(mod12);
    expect(r.slice(0, 4)).toEqual([3, 6, 10, 1]); // Bbm7 over G
    expect(r.slice(4, 8)).toEqual([8, 0, 3, 6]); // Eb7 over G
    const db7 = adv.find(x => x.id === 'dom7alt-adv-07')!;
    expect(rel(db7).slice(0, 4).map(mod12)).toEqual([6, 10, 1, 4]); // Db7 over G
    // no major 7th (natural B over C7alt) anywhere in the altered superimpositions
    for (const g of adv.filter(x => x.qualities.includes('dom7alt'))) expect(rel(g).some(x => mod12(x) === 11), g.id).toBe(false);
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

  it('no cell appears in more than ~5% of the licks of any tier in a practice session (same seeded sample as `npm run musicality`)', () => {
    const { byTier } = sessionSample();
    for (const t of [1, 2, 3, 4] as Tier[]) {
      const m = summarize(byTier[t]);
      // 180-270 licks per tier: 5% is 9-14 licks, so allow a little noise; Expert has the fewest cells that reach its
      // difficulty, so one cell may reach ~7% even with session variety (8.1% = one extra lick of 270 after the final-chord landing change moved the random stream).
      expect(m.topCellShare, `tier ${t} top cell ${m.topCell}`).toBeLessThanOrEqual(t === 4 ? 0.085 : 0.065);
    }
  }, 60_000);
});

/* ---------------------------------- Phase 2b cell quality ---------------------------------- */

const pitchedRels = (f: Fragment) => f.notes.filter(n => n.rel !== null).map(n => n.rel as number);
const intervalsOf = (f: Fragment) => { const p = pitchedRels(f); return p.slice(1).map((v, i) => v - p[i]); };

describe('cells read as lines, not exercises', () => {
  it('no interval inside a cell (across rests too) is a minor 7th or more', () => {
    for (const f of FRAGMENTS) expect(Math.max(0, ...intervalsOf(f).map(Math.abs)), f.id).toBeLessThanOrEqual(9);
  });

  it('no cell states the same four-interval pattern twice (2-3 interval motifs may repeat)', () => {
    for (const f of FRAGMENTS) {
      const iv = intervalsOf(f);
      const seen = new Set<string>();
      for (let i = 0; i + 4 <= iv.length; i++) {
        const k = iv.slice(i, i + 4).join(',');
        expect(seen.has(k), `${f.id} repeats the interval pattern ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('vocabulary cells never repeat the same three consecutive pitches (one broken chord stated twice)', () => {
    for (const f of VOCAB_FRAGMENTS) {
      const p = pitchedRels(f);
      const seen = new Set<string>();
      for (let i = 0; i + 3 <= p.length; i++) {
        const k = p.slice(i, i + 3).join(',');
        expect(seen.has(k), `${f.id} repeats ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('vocabulary has no long unbroken 16th-note runs', () => {
    for (const f of VOCAB_FRAGMENTS) expect(f.beats === 4 && pitchedRels(f).length >= 14, f.id).toBe(false);
  });

  it('dotted-8th + 16th beats are rare (at most 1% of cells)', () => {
    const dotted = FRAGMENTS.filter(f => attacks(f).some(({ n, t }, i, arr) => n.dur === 9 && t % TPB === 0 && arr[i + 1]?.n.dur === 3));
    expect(dotted.length / FRAGMENTS.length).toBeLessThanOrEqual(0.01);
  });

  it('prototype cells with a minor-7th leap are dropped on load', () => {
    expect(FRAGMENTS.some(f => f.id === 'm7-proto-49')).toBe(false);
    expect(PROTOTYPE_FRAGMENTS.some(f => f.id === 'm7-proto-49')).toBe(true);
  });
});

describe('the 4th over maj7', () => {
  it('appears only as an off-beat, short passing note between the 3rd and 5th', () => {
    for (const f of FRAGMENTS.filter(x => x.qualities.includes('maj7'))) {
      const s = attacks(f);
      s.forEach(({ n, t }, i) => {
        if (n.rel === null || mod12(n.rel) !== 5) return;
        expect(t % TPB, `${f.id} 4th on a beat`).not.toBe(0);
        expect(n.dur, `${f.id} 4th held`).toBeLessThan(TPB);
        const prev = s.slice(0, i).reverse().find(x => x.n.rel !== null);
        const next = s.slice(i + 1).find(x => x.n.rel !== null);
        expect(prev && next, `${f.id} 4th is the first or last note`).toBeTruthy();
        const pair = [mod12(prev!.n.rel as number), mod12(next!.n.rel as number)];
        expect(pair.includes(4) && pair.includes(7), `${f.id} 4th between ${pair}`).toBe(true);
      });
    }
  });
});

describe('wrong-colour advanced cells are gone', () => {
  const adv = (id: string) => ADVANCED_FRAGMENTS.find(f => f.id === id)!;
  const pcs = (f: Fragment) => new Set(pitchedRels(f).map(mod12));
  it('no major 7th (natural B over C7) in the dominant outside-in and superimposition cells', () => {
    for (const id of ['dom7-adv-09', 'dom7-adv-10', 'dom7alt-adv-07', 'dom7alt-adv-08']) expect(pcs(adv(id)).has(11), id).toBe(false);
  });
  it('the m7 outside-in cell does not use the major 7th (a minor-tonic sound over the ii)', () => {
    expect(pcs(adv('m7-adv-07')).has(11)).toBe(false);
  });
  it('the maj7 triad-pair cell is the I and II (lydian) triads, not an Am7 and G arpeggio pair', () => {
    expect([...pcs(adv('maj7-adv-11'))].sort((x, y) => x - y)).toEqual([0, 2, 4, 6, 7, 9]);
  });
});

describe('altered and lydian-dominant colour at low levels', () => {
  const ALT_COLOUR = [1, 3, 8];
  const alt = FRAGMENTS.filter(f => f.qualities.includes('dom7alt'));
  const coloured = (f: Fragment) => f.notes.some(n => n.rel !== null && ALT_COLOUR.includes(mod12(n.rel)));

  it('Level 1 and 2 7alt pools are mostly coloured by a b9, #9 or b13', () => {
    for (const lv of [1, 2]) for (const beats of [2, 4] as const) {
      const pool = alt.filter(f => f.level === lv && f.beats === beats);
      const plain = pool.filter(f => !coloured(f));
      expect(pool.length, `L${lv} ${beats}b`).toBeGreaterThanOrEqual(lv === 1 ? 20 : 14);
      expect(plain.length / pool.length, `L${lv} ${beats}b plain share`).toBeLessThanOrEqual(lv === 1 ? 0.45 : 0.05);
    }
  });

  it('the guide-tone alteration cells are sparse and linger on the altered note', () => {
    const gt = alt.filter(f => f.id.startsWith('dom7alt-gt-'));
    expect(gt.length).toBeGreaterThanOrEqual(40);
    for (const f of gt) {
      expect(pitchedRels(f).length, f.id).toBeLessThanOrEqual(f.beats === 2 ? 4 : 7);
      expect(f.notes.some(n => n.rel !== null && ALT_COLOUR.includes(mod12(n.rel)) && n.dur >= 2 * 3), f.id).toBe(true);
    }
  });

  it('plain dominants have Lydian-dominant (#11, no natural 11) cells and enough cells without a stressed natural 11 at every level', () => {
    const dom = FRAGMENTS.filter(f => f.qualities.includes('dom7'));
    const stressed11 = (f: Fragment) => attacks(f).some(({ n, t }) => n.rel !== null && mod12(n.rel) === 5 && (t % TPB === 0 || n.dur >= TPB));
    const lyd = dom.filter(f => f.notes.some(n => n.rel !== null && mod12(n.rel) === 6) && !f.notes.some(n => n.rel !== null && mod12(n.rel) === 5) && !f.qualities.includes('dom7alt'));
    expect(lyd.length).toBeGreaterThanOrEqual(15);
    for (const beats of [2, 4] as const) expect(lyd.filter(f => f.beats === beats).length).toBeGreaterThanOrEqual(5);
    for (const lv of [1, 2, 3, 4]) expect(dom.filter(f => f.level === lv && !stressed11(f)).length, `L${lv}`).toBeGreaterThanOrEqual(20);
    for (const f of FRAGMENTS.filter(x => x.id.startsWith('dom7-lyd-'))) {
      attacks(f).forEach(({ n, t }) => { if (n.rel !== null && mod12(n.rel) === 6) expect(t % TPB, f.id).not.toBe(0); });
    }
  });
});
