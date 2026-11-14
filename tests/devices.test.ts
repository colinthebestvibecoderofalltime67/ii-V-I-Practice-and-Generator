import { describe, expect, it } from 'vitest';
import { conceptHitRate, sliderError } from '../src/analysis/musicality';
import { FRAGMENTS, withDeviceTags } from '../src/fragments';
import { ADVANCED_FRAGMENTS } from '../src/fragments/lib/advanced';
import { ORIGINAL_FRAGMENTS } from '../src/fragments/lib/original';
import { PHASE2B_FRAGMENTS } from '../src/fragments/lib/phase2b';
import { VOCAB_FRAGMENTS } from '../src/fragments/lib/vocab';
import { fromSixteenths } from '../src/fragments';
import { generateLick } from '../src/generator';
import { concertRange, getInstrument } from '../src/instruments';
import { sanitizeSettings } from '../src/storage';
import {
  CONCEPTS, CONCEPT_MIN_TIER, conceptAllowed, conceptHits, detectDevices, displayDevices, type DeviceKind,
} from '../src/theory/devices';
import { expandProgression, getProgression } from '../src/theory/progressions';
import type { ChordQualityId, ConceptId, Fragment, Lick, LickChord, LickNote, Tier } from '../src/types';
import { deviceRows, focusHint } from '../src/ui/devices';
import { conceptSample } from './_samples';

/* ------------------------------ hand-built licks ------------------------------ */

type Spec = [midi: number | null, dur: number, tie?: boolean];

/** Notes from a list (start ticks accumulate; the chord of a note is the one that starts at or before it). */
function mk(chords: LickChord[], spec: Spec[]): Pick<Lick, 'notes' | 'chords'> {
  let t = 0;
  const notes: LickNote[] = spec.map(([midi, dur, tie]) => {
    let chord = 0;
    chords.forEach((c, i) => { if (t >= c.start) chord = i; });
    const n: LickNote = { midi, start: t, dur, chord, ...(tie ? { tie: true } : {}) };
    t += dur;
    return n;
  });
  return { notes, chords };
}
const iiVI = expandProgression(getProgression('major-251'), 'standard', 0); // Dm7 G7 Cmaj7, 4 beats each
const one = (q: ChordQualityId, root = 0, ticks = 48): LickChord[] => [{ rootPc: root, quality: q, symbol: '', start: 0, dur: ticks }];
const kinds = (l: Pick<Lick, 'notes' | 'chords'>, only?: DeviceKind[]): DeviceKind[] => [...new Set(detectDevices(l, only).map(d => d.kind))];
const E = 6; // an 8th
const Q = 12;

describe('detectDevices: each device on a hand-built lick', () => {
  it('enclosure: upper then lower neighbour into a chord tone on the "and", and lower then upper on a beat', () => {
    // Dm7: D, then G (+2 above F) E (-1 below F) -> F (3rd) on the "and" of 2
    const a = mk(iiVI, [[62, E], [67, E], [64, E], [65, E], [69, Q * 2], [72, Q * 4], [null, Q * 4], [60, Q * 4]]);
    const d = detectDevices(a, ['enclosure']);
    expect(d).toHaveLength(1);
    expect([d[0].first, d[0].last, d[0].chord]).toEqual([1, 3, 0]);
    // beat landing, below-then-above: Cmaj7 target E: D#? (63? no) D (-2) F (+1) -> E on beat 3
    const b = mk(one('maj7'), [[72, E], [67, E], [62, E], [65, E], [64, Q], [67, Q * 2]]);
    expect(kinds(b, ['enclosure'])).toEqual(['enclosure']);
    // a three-note approach in 16ths (step, half step, half step from the other side) into F on the beat
    const c = mk(one('m7'), [[60, 3], [65, 3], [64, 3], [62, 3], [63, Q * 2], [null, Q * 2]]);
    expect(detectDevices(c, ['enclosure']).map(d => [d.first, d.last])).toEqual([[1, 4]]);
  });

  it('enclosure needs a chord-tone target, both sides, a half step, and a beat or "and" landing', () => {
    expect(kinds(mk(one('maj7'), [[60, Q], [62, E], [60 + 1, E], [62, Q * 2], [67, Q]]), ['enclosure'])).toEqual([]); // target D is not a chord tone
    expect(kinds(mk(one('maj7'), [[60, Q], [66, E], [67, E], [64, Q * 2], [67, Q]]), ['enclosure'])).toEqual([]); // 66 and 67 are both above 64? 66 is +2, 67 +3
    // both approach notes below the target: not an enclosure
    expect(kinds(mk(one('maj7'), [[60, Q], [62, E], [63, E], [64, Q * 2], [67, Q]]), ['enclosure'])).toEqual([]);
    // whole steps on both sides: no half step
    expect(kinds(mk(one('maj7'), [[60, Q], [62, E], [66, E], [64, Q * 2], [67, Q]]), ['enclosure'])).toEqual([]);
    // lands off the grid of beats and "ands" (a 16th late)
    expect(kinds(mk(one('maj7'), [[60, 15], [65, 3], [62, 3], [64, Q * 2], [67, Q]]), ['enclosure'])).toEqual([]);
  });

  it('chromatic approach: a non-scale note resolving by half step onto a chord tone', () => {
    // G7: Bb (not in Mixolydian) -> B (3rd), then D
    const l = mk(iiVI, [[null, Q * 4], [67, Q], [70, E], [71, E], [74, Q * 2]]);
    const d = detectDevices(l, ['chromatic']);
    expect(d).toHaveLength(1);
    expect(d[0].target).toBe(3);
    // an in-scale note (A -> B over G7) is not a chromatic approach
    expect(kinds(mk(iiVI, [[null, Q * 4], [67, Q], [69, E], [71, E], [74, Q * 2]]), ['chromatic'])).toEqual([]);
    // resolving onto a non-chord tone does not count
    expect(kinds(mk(iiVI, [[null, Q * 4], [67, Q], [70, E], [69, E], [74, Q * 2]]), ['chromatic'])).toEqual([]);
  });

  it('guide tone: the 7th of ii steps to the 3rd of V at the change (and not a leap to the root)', () => {
    // Dm7 ends on C (7th), G7 starts on B (3rd)
    const a = mk(iiVI, [[62, Q], [65, Q], [69, Q], [72, Q], [71, Q * 2], [74, Q * 2], [null, Q * 4]]);
    const d = detectDevices(a, ['guideTone']);
    expect(d).toHaveLength(1);
    expect([d[0].chord, d[0].first, d[0].last]).toEqual([1, 3, 4]);
    // Dm7 ends on D (root), G7 starts on G (root): no guide-tone link
    const b = mk(iiVI, [[65, Q], [69, Q], [72, Q], [74, Q], [67, Q * 2], [71, Q * 2], [null, Q * 4]]);
    expect(kinds(b, ['guideTone'])).toEqual([]);
    // 3rd of ii (F) to 7th of V (F): the same note re-attacked is allowed; a rest in between is not
    const c = mk(iiVI, [[69, Q * 3], [65, Q], [65, Q * 2], [71, Q * 2], [null, Q * 4]]);
    expect(kinds(c, ['guideTone'])).toEqual(['guideTone']);
    const r = mk(iiVI, [[69, Q * 3], [65, E], [null, E], [65, Q * 2], [71, Q * 2], [null, Q * 4]]);
    expect(kinds(r, ['guideTone'])).toEqual([]);
  });

  it('guide tone: counts a held anticipation as the arrival', () => {
    // C (7th of Dm7) on beat 4, then B (3rd of G7) attacked on the "and" of 4 and tied across the bar line
    const t = mk(iiVI, [[62, Q], [65, Q], [69, Q], [72, E], [71, E, true], [71, Q * 2 + E], [null, Q * 4 + E]]);
    expect(detectDevices(t, ['anticipation']).map(d => [d.first, d.last, d.chord])).toEqual([[4, 5, 1]]);
    expect(kinds(t, ['guideTone'])).toEqual(['guideTone']);
  });

  it('anticipation: a tie chain attacked less than a beat before the change; the Focus needs the final tonic', () => {
    // E on the "and" of beat 4 of bar 2, tied into Cmaj7 (the 3rd of the final tonic)
    const l = mk(iiVI, [[null, Q * 7], [71, E], [76, E, true], [76, Q * 3 + E], [null, 0]].filter(x => (x[1] as number) > 0).map(([m, d, t]) => [m, d, !!t] as Spec));
    const d = detectDevices(l, ['anticipation']);
    expect(d).toHaveLength(1);
    expect(d[0].chord).toBe(2);
    expect(conceptHits(l, 'anticipateI')).toEqual({ hits: 1, of: 1 });
    // a note held across the change from a full beat before is not an anticipation
    const far = mk(iiVI, [[null, Q * 3], [72, Q + Q, true], [72, Q * 2], [null, Q * 4]]);
    expect(kinds(far, ['anticipation'])).toEqual([]);
  });

  it('triad pair: two triads a whole step apart played as arpeggios', () => {
    // C7: C E G, then F# A D (the D triad), C-D pair
    const l = mk(one('dom7'), [[60, E], [64, E], [67, E], [66, E], [69, E], [74, E], [69, E], [66, E]]);
    const d = detectDevices(l, ['triadPair']);
    expect(d).toHaveLength(1);
    expect([d[0].first, d[0].last]).toEqual([0, 7]);
    // 7alt: the bVI (Ab) and bV (Gb) major triads over G7alt
    const alt = mk(one('dom7alt', 7), [[68, E], [72, E], [75, E], [70, E], [73, E], [78, E], [75, E], [72, E]]);
    expect(kinds(alt, ['triadPair'])).toEqual(['triadPair']);
  });

  it('triad pair: a scale line, a plain arpeggio and a one-triad line are not triad pairs', () => {
    const scale = mk(one('dom7'), [[62, E], [64, E], [65, E], [67, E], [65, E], [64, E], [62, E], [60, E]]); // D E F G F E D C: inside C/Bb pcs, but stepwise
    expect(kinds(scale, ['triadPair'])).toEqual([]);
    const arp = mk(one('dom7'), [[60, E], [64, E], [67, E], [70, E], [72, E], [70, E], [67, E], [64, E]]);
    expect(kinds(arp, ['triadPair'])).toEqual([]);
    const oneTriad = mk(one('dom7'), [[60, E], [64, E], [67, E], [72, E], [67, E], [64, E], [60, E], [64, E]]);
    expect(kinds(oneTriad, ['triadPair'])).toEqual([]);
  });

  it('6th-diminished line over maj7 and m6 (with the added tone)', () => {
    // C maj: C B A G# G F E D (down from the root)
    const maj = mk(one('maj7'), [[72, E], [71, E], [69, E], [68, E], [67, E], [65, E], [64, E], [62, E]]);
    expect(kinds(maj, ['sixthDim'])).toEqual(['sixthDim']);
    // C m6: C D Eb F G Ab A B (up)
    const min = mk(one('m6'), [[60, E], [62, E], [63, E], [65, E], [67, E], [68, E], [69, E], [71, E]]);
    expect(kinds(min, ['sixthDim'])).toEqual(['sixthDim']);
    // the plain major scale (no added tone) is not it
    const major = mk(one('maj7'), [[72, E], [71, E], [69, E], [67, E], [65, E], [64, E], [62, E], [60, E]]);
    expect(kinds(major, ['sixthDim'])).toEqual([]);
    // only five notes in the scale in a row
    const short = mk(one('maj7'), [[72, E], [71, E], [69, E], [68, E], [67, E], [66, E], [64, Q], [60, Q * 2]]);
    expect(kinds(short, ['sixthDim'])).toEqual([]);
    // the same notes over a dominant chord: not a 6th-diminished line
    expect(kinds(mk(one('dom7'), [[72, E], [71, E], [69, E], [68, E], [67, E], [65, E], [64, E], [62, E]]), ['sixthDim'])).toEqual([]);
  });

  it('superimposition: Gm7 then C7 arpeggios over C7, and the tritone-substitute arpeggio over G7alt', () => {
    const gm7c7 = mk(one('dom7'), [[70, E], [74, E], [77, E], [79, E], [76, E], [72, E], [70, E], [67, E]]);
    expect(kinds(gm7c7, ['superimposition'])).toEqual(['superimposition']);
    const tritone = mk(one('dom7alt', 7), [[73, E], [77, E], [80, E], [83, E], [80, E], [77, E], [73, E], [71, E]]); // Db7 (Db F Ab B) over G7alt
    expect(kinds(tritone, ['superimposition'])).toEqual(['superimposition']);
    // a plain C7 arpeggio and a C mixolydian line are not
    expect(kinds(mk(one('dom7'), [[60, E], [64, E], [67, E], [70, E], [72, E], [70, E], [67, E], [64, E]]), ['superimposition'])).toEqual([]);
    expect(kinds(mk(one('dom7'), [[60, E], [62, E], [64, E], [65, E], [67, E], [69, E], [70, E], [72, E]]), ['superimposition'])).toEqual([]);
  });

  it('side-slip: a chord-tone figure a half step away that resolves by step onto a chord tone', () => {
    // Cmaj7: C (beat 1), then the E G B figure slipped down a half step (Eb Gb Bb), resolving up to B
    const l = mk(one('maj7'), [[60, Q], [63, E], [66, E], [70, E], [71, Q + E], [null, Q * 2]].map(([m, d]) => [m, d] as Spec));
    const d = detectDevices(l, ['sideSlip']);
    expect(d).toHaveLength(1);
    expect([d[0].first, d[0].last]).toEqual([1, 4]);
    // the same figure kept in the scale (E G B) is not a slip
    expect(kinds(mk(one('maj7'), [[60, Q], [64, E], [67, E], [71, E], [72, Q + E], [null, Q * 2]]), ['sideSlip'])).toEqual([]);
  });

  it('plain scale runs and arpeggios trigger nothing (false-positive guard)', () => {
    const scaleUpDown = mk(one('maj7'), [[60, E], [62, E], [64, E], [65, E], [67, E], [69, E], [71, E], [72, E], [71, E], [69, E], [67, E], [65, E], [64, E], [62, E], [60, E], [null, E]].map(([m, d]) => [m, d] as Spec));
    expect(detectDevices(scaleUpDown)).toEqual([]);
    const arp = mk(one('maj7'), [[60, E], [64, E], [67, E], [71, E], [72, E], [71, E], [67, E], [64, E]]);
    const found = kinds(arp);
    expect(found).not.toContain('enclosure');
    expect(found).not.toContain('chromatic');
    expect(found).not.toContain('triadPair');
    expect(found).not.toContain('sixthDim');
    expect(found).not.toContain('sideSlip');
  });

  it('displayDevices drops a chromatic approach that is part of an enclosure', () => {
    const enc = mk(one('maj7'), [[60, Q], [66, E], [63, E], [64, Q * 2], [null, Q]]); // F# ... Eb ... E: +2, -1
    const all = detectDevices(enc);
    expect(all.map(d => d.kind).sort()).toEqual(['chromatic', 'enclosure']);
    expect(displayDevices(all).map(d => d.kind)).toEqual(['enclosure']);
  });
});

/* ------------------------------ concept metadata ------------------------------ */

describe('concepts', () => {
  it('level rules: Beginner+ for four, Advanced+ for three', () => {
    for (const c of ['guideTones', 'enclosures', 'chromaticApproach', 'anticipateI'] as ConceptId[]) expect(CONCEPT_MIN_TIER[c]).toBe(1);
    for (const c of ['triadPairs', 'sixthDim', 'superimposition'] as ConceptId[]) {
      expect(conceptAllowed(c, 2)).toBe(false);
      expect(conceptAllowed(c, 3)).toBe(true);
    }
    expect(CONCEPTS).toHaveLength(7);
  });

  it('a concept that is not allowed at the tier is ignored: same lick, no focus recorded; the hint says so', () => {
    const range = concertRange(getInstrument('alto'));
    const o = { progressionId: 'major-251', length: 'standard' as const, keyPc: 0, tier: 2 as Tier, range, seed: 42 };
    const a = generateLick(o);
    const b = generateLick({ ...o, concept: 'triadPairs' });
    expect(b.focus).toBeUndefined();
    expect(b.notes).toEqual(a.notes);
    expect(generateLick({ ...o, tier: 3, concept: 'triadPairs' }).focus).toBe('triadPairs');
    expect(focusHint('triadPairs', 2)).toBe('Triad pairs are Advanced+ material — this lick ignores the focus.');
    expect(focusHint('triadPairs', 3)).toBe('');
    expect(focusHint('sixthDim', 1)).toContain('Advanced+');
  });

  it('settings persist the focus and sanitize junk', () => {
    expect(sanitizeSettings({ focus: 'enclosures' }).focus).toBe('enclosures');
    expect(sanitizeSettings({ focus: 'triadPairs' }).focus).toBe('triadPairs');
    expect(sanitizeSettings({ focus: 'nonsense' }).focus).toBe('any');
    expect(sanitizeSettings({ focus: 7 }).focus).toBe('any');
    expect(sanitizeSettings({}).focus).toBe('any');
  });
});

/* ------------------------------ the generator ------------------------------ */

describe('without a Focus the generator is unchanged', () => {
  it('Focus cells carry weight zero, so the pool behaves exactly as it did without them', () => {
    const range = concertRange(getInstrument('tenor'));
    const old = FRAGMENTS.filter(f => !f.concept);
    expect(old.length).toBeLessThan(FRAGMENTS.length);
    for (let s = 1; s <= 40; s++) {
      for (const tier of [1, 2, 3, 4] as Tier[]) {
        const o = { progressionId: (['major-251', 'minor-251', 'major-251-alt'] as const)[s % 3], length: 'standard' as const, keyPc: s % 12, tier, range, seed: s };
        const a = generateLick({ ...o, fragments: old });
        const b = generateLick(o);
        expect(b.notes, `seed ${s} tier ${tier}`).toEqual(a.notes);
        expect(b.fragmentIds).toEqual(a.fragmentIds);
        expect(b.focus).toBeUndefined();
      }
    }
  });

  it('Focus cells are used only under their own Focus', () => {
    const range = concertRange(getInstrument('alto'));
    for (let s = 1; s <= 15; s++) {
      const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: s % 12, tier: 3, range, seed: s, concept: 'enclosures' });
      for (const id of l.fragmentIds) {
        const f = FRAGMENTS.find(x => x.id === id)!;
        if (f.concept) expect(f.concept, id).toBe('enclosures');
      }
    }
  });
});

describe('device tags follow the detector', () => {
  const raw = [...ORIGINAL_FRAGMENTS, ...VOCAB_FRAGMENTS, ...ADVANCED_FRAGMENTS, ...PHASE2B_FRAGMENTS].map(fromSixteenths);
  const found = (f: Fragment, kind: DeviceKind): boolean => {
    const tagged = withDeviceTags(f);
    const tag = { enclosure: 'enclosure', chromatic: 'chromatic', triadPair: 'triad-pair', sixthDim: 'sixth-dim', superimposition: 'superimposition' }[kind as 'enclosure'];
    return tagged.tags.includes(tag as never);
  };

  it('hand-tagged enclosure cells are mostly found as enclosures by the detector (over their own chord)', () => {
    const hand = raw.filter(f => f.tags.includes('enclosure'));
    const hit = hand.filter(f => found(f, 'enclosure') && detectsOn(f, 'enclosure'));
    expect(hand.length).toBeGreaterThan(30);
    expect(hit.length / hand.length).toBeGreaterThanOrEqual(0.5);
  });

  it('every derived tag is backed by the detector, and every Focus cell is found by its own detector', () => {
    for (const f of FRAGMENTS) {
      if (f.tags.includes('sixth-dim')) expect(detectsOn(f, 'sixthDim'), f.id).toBe(true);
      if (f.tags.includes('triad-pair')) expect(detectsOn(f, 'triadPair'), f.id).toBe(true);
      if (f.tags.includes('superimposition')) expect(detectsOn(f, 'superimposition') || detectsOn(f, 'sideSlip'), f.id).toBe(true);
    }
    const need: Partial<Record<ConceptId, DeviceKind[]>> = {
      enclosures: ['enclosure'], chromaticApproach: ['chromatic'], triadPairs: ['triadPair'], sixthDim: ['sixthDim'], superimposition: ['superimposition', 'sideSlip'],
    };
    for (const f of FRAGMENTS.filter(x => x.concept && need[x.concept])) {
      expect(need[f.concept!]!.some(k => detectsOn(f, k)), f.id).toBe(true);
    }
  });
});

function detectsOn(f: Fragment, kind: DeviceKind): boolean {
  let t = 0;
  const notes: LickNote[] = f.notes.map(n => { const r: LickNote = { midi: n.rel == null ? null : 60 + n.rel, start: t, dur: n.dur, chord: 0, ...(n.tie ? { tie: true } : {}) }; t += n.dur; return r; });
  return f.qualities.every(q => detectDevices({ notes, chords: [{ rootPc: 0, quality: q, symbol: '', start: 0, dur: t }] }, [kind]).length > 0);
}

describe('Focus cell pools', () => {
  const count = (pred: (f: Fragment) => boolean) => FRAGMENTS.filter(pred).length;
  const pool = (tag: string, q: ChordQualityId, lv: number) => count(f => f.level === lv && f.qualities.includes(q) && (f.tags as string[]).includes(tag));

  it('enclosure and chromatic-approach pools have >= 8 cells per quality and level (7alt has no Beginner chromatic note: every note is in its scale)', () => {
    for (const q of ['m7', 'm7b5', 'dom7', 'dom7alt', 'maj7', 'm6'] as ChordQualityId[]) {
      for (const lv of [1, 2, 3, 4]) {
        expect(pool('enclosure', q, lv), `enclosure ${q} L${lv}`).toBeGreaterThanOrEqual(8);
        if (!(q === 'dom7alt' && lv === 1)) expect(pool('chromatic', q, lv), `chromatic ${q} L${lv}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('Advanced+ pools: triad pairs (m7, dom7, maj7, 7alt), 6th-dim (maj7, m6), superimposition (m7, dom7, maj7, 7alt) at levels 3 and 4', () => {
    for (const lv of [3, 4]) {
      for (const q of ['m7', 'dom7', 'maj7', 'dom7alt'] as ChordQualityId[]) expect(pool('triad-pair', q, lv), `triad-pair ${q} L${lv}`).toBeGreaterThanOrEqual(8);
      for (const q of ['maj7', 'm6'] as ChordQualityId[]) expect(pool('sixth-dim', q, lv), `sixth-dim ${q} L${lv}`).toBeGreaterThanOrEqual(8);
      for (const q of ['m7', 'dom7', 'maj7', 'dom7alt'] as ChordQualityId[]) expect(pool('superimposition', q, lv), `superimposition ${q} L${lv}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('guide-tone cells exist at Advanced and Expert for every quality', () => {
    for (const lv of [3, 4]) for (const q of ['m7', 'm7b5', 'dom7', 'dom7alt', 'maj7', 'm6'] as ChordQualityId[]) {
      expect(pool('guide-tone', q, lv), `guide-tone ${q} L${lv}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('6th-dim lines can close a lick over the tonic (maj7 and m6 endings)', () => {
    for (const q of ['maj7', 'm6'] as ChordQualityId[]) expect(count(f => !!f.ending && f.qualities.includes(q) && (f.tags as string[]).includes('sixth-dim')), q).toBeGreaterThanOrEqual(4);
  });
});

describe('Focus hit rates and slider accuracy', () => {
  /** What the generator is held to, per concept and tier (the share of licks / chord changes that really contain the device). */
  const floor = (c: ConceptId, t: Tier): number => (c === 'guideTones' ? 0.7 : c === 'chromaticApproach' && t === 1 ? 0.1 : 0.9);
  const maes: number[] = [];
  for (const c of CONCEPTS) {
    for (const t of [1, 2, 3, 4] as Tier[]) {
      if (!conceptAllowed(c, t)) continue;
      it(`${c} at ${t}: >= ${Math.round(100 * floor(c, t))}% of the licks deliver it, slider error stays close to the no-focus error`, () => {
        const licks = conceptSample(c, t);
        const r = conceptHitRate(licks, c);
        expect(r.rate, `${c} T${t} hit ${r.hits}/${r.of}`).toBeGreaterThanOrEqual(floor(c, t));
        for (const l of licks) expect(l.focus).toBe(c);
        const diff = sliderError(licks) - sliderError(conceptSample(undefined, t));
        maes.push(diff);
        expect(diff, `${c} T${t}`).toBeLessThanOrEqual(0.9);
      }, 40_000);
    }
  }
  it('on average the Focus costs under 0.4 score points of slider accuracy', () => {
    expect(maes.length).toBe(22);
    expect(maes.reduce((a, b) => a + b, 0) / maes.length).toBeLessThanOrEqual(0.4);
  });
});

describe('Analysis rows', () => {
  it('describe enclosure and anticipation devices with the arrival note, its role and the bar', () => {
    const inst = getInstrument('piano') ?? getInstrument('alto');
    const range = concertRange(inst);
    const l = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 0, tier: 3, range, seed: 5, concept: 'enclosures' });
    const rows = deviceRows(l, inst);
    expect(rows.some(r => r.name === 'Enclosure')).toBe(true);
    for (const r of rows) {
      expect(r.where).toMatch(/^bar [1-3]$/);
      expect(r.mark.first).toBeLessThanOrEqual(r.mark.last);
    }
    const enc = rows.find(r => r.name === 'Enclosure')!;
    expect(enc.what).toMatch(/^→ [A-G][♭♯𝄪𝄫]? \((root|3rd|♭3rd|5th|♭5th|6th|7th|♭7th) of /);
  });
});
