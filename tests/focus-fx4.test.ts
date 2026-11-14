import { describe, expect, it } from 'vitest';
import { FOCUS_FRAGMENTS } from '../src/fragments/lib/focus';
import { FRAGMENTS } from '../src/fragments';
import { generateLick } from '../src/generator';
import { type Ev, fixJoins } from '../src/generator/connect';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { CONCEPTS, CONCEPT_UNAVAILABLE, conceptAllowed, conceptAvailable, conceptHits, detectDevices, guideRels, type DeviceKind } from '../src/theory/devices';
import { PROGRESSIONS } from '../src/theory/progressions';
import { focusHint } from '../src/ui/devices';
import type { ChordQualityId, ConceptId, LengthId, Lick, LickChord, LickNote, Tier } from '../src/types';

type Spec = [midi: number | null, dur: number, tie?: boolean];
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
const ch = (rootPc: number, quality: ChordQualityId, start: number, dur: number): LickChord => ({ rootPc, quality, symbol: '', start, dur });
const kinds = (l: Pick<Lick, 'notes' | 'chords'>, only: DeviceKind[]): DeviceKind[] => [...new Set(detectDevices(l, only).map(d => d.kind))];
const E = 6;
const Q = 12;
const alto = getInstrument('alto');

describe('FX4 detectors', () => {
  it('a cross-barline enclosure: the approach notes sit on the previous chord, the target opens the next on its root / 3rd / 7th', () => {
    // B-flat 7 | E-flat maj7: ... E C# -> D (the 7th of Ebmaj7) on the downbeat
    const two = [ch(10, 'dom7', 0, 48), ch(3, 'maj7', 48, 48)];
    const l = mk(two, [[70, Q], [65, Q], [66, Q], [64, E], [61, E], [62, Q * 2], [null, Q * 2]]);
    const d = detectDevices(l, ['enclosure']);
    expect(d).toHaveLength(1);
    expect(l.notes[d[0].first].chord).toBe(0);
    expect(d[0].chord).toBe(1);
    expect(d[0].target).toBe(5);
    // the same figure into the 5th of the new chord (B-flat... F over E-flat) is not one: only root / 3rd / 7th
    expect(kinds(mk(two, [[70, Q], [65, Q], [66, Q], [66, E], [63, E], [65, Q * 2], [null, Q * 2]]), ['enclosure'])).toEqual([]);
    // an approach note on the new chord's downbeat is still excluded (the target would not open the chord)
    expect(kinds(mk(two, [[70, Q], [65, Q], [66, Q], [66, Q], [64, E], [62, E], [63, Q], [null, Q]]), ['enclosure'])).toEqual([]);
  });

  it('an anticipation that is only a common tone of the old chord is not labelled, the I\'s 3rd and root are', () => {
    const two = [ch(7, 'dom7', 0, 48), ch(0, 'maj7', 48, 48)];
    // V root G held over the bar line -> the I's 5th: a common tone
    expect(kinds(mk(two, [[72, Q * 3 + E], [67, E, true], [67, Q + E], [null, Q * 2]]), ['anticipation'])).toEqual([]);
    // V 3rd B -> the I's 7th: common tone
    expect(kinds(mk(two, [[72, Q * 3 + E], [71, E, true], [71, Q + E], [null, Q * 2]]), ['anticipation'])).toEqual([]);
    // E over G7 is the 13th... it is not a G7 chord tone: it arrives as the I's 3rd
    expect(kinds(mk(two, [[72, Q * 3 + E], [64, E, true], [64, Q + E], [null, Q * 2]]), ['anticipation'])).toEqual(['anticipation']);
    // the I's root C over G7 (an 11th) anticipates the tonic
    expect(kinds(mk(two, [[71, Q * 3 + E], [72, E, true], [72, Q + E], [null, Q * 2]]), ['anticipation'])).toEqual(['anticipation']);
  });

  it('m6: only the b3 is a guide tone, the 6th is not', () => {
    expect([...guideRels('m6')]).toEqual([3]);
    expect([...guideRels('m7')]).toEqual([3, 10]);
    // B7alt 3rd (D#) -> Em6 6th (C#): not a guide-tone link; -> the b3 (G) from the b7 (A) is
    const two = [ch(11, 'dom7alt', 0, 48), ch(4, 'm6', 48, 48)];
    expect(kinds(mk(two, [[69, Q * 3], [63, Q], [61, Q * 2], [null, Q * 2]]), ['guideTone'])).toEqual([]);
    expect(kinds(mk(two, [[72, Q * 3], [69, Q], [67, Q * 2], [null, Q * 2]]), ['guideTone'])).toEqual(['guideTone']);
  });

  it('the tritone substitute\'s ii-V (Abm7 - Db7) over G7alt counts as a superimposition', () => {
    const alt = [ch(7, 'dom7alt', 0, 48)];
    // G7alt, Ab m7 (Eb Gb Ab) then Db7 (Db F Ab): 8th-note arpeggios
    const l = mk(alt, [[63, E], [66, E], [68, E], [73, E], [77, E], [80, E], [77, E], [null, Q]]);
    expect(kinds(l, ['superimposition'])).toEqual(['superimposition']);
  });
});

describe('FX4 cells', () => {
  const byId = new Map(FRAGMENTS.map(f => [f.id, f]));
  it('no triad-pair cell over a dominant uses the natural 7th (F/G over C7 put a B natural on a dominant)', () => {
    for (const f of FOCUS_FRAGMENTS.filter(x => x.concept === 'triadPairs' && x.qualities.includes('dom7'))) {
      for (const n of f.notes) if (n.rel != null) expect(((n.rel % 12) + 12) % 12, f.id).not.toBe(11);
    }
  });
  it('m6-foc-chr-01 puts its E natural on an off-beat 8th, not on a quarter', () => {
    const f = FOCUS_FRAGMENTS.find(x => x.id === 'm6-foc-chr-01')!;
    let t = 0;
    for (const n of f.notes) {
      if (n.rel === 4) { expect(t % 4, 'off the beat').toBe(2); expect(n.dur).toBe(2); }
      t += n.dur;
    }
  });
  it('every two-beat Advanced triad-pair / superimposition cell for m7b5 and dom7alt that FX4 added scores under a 16th-heavy cell: <= 6 attacks', () => {
    for (const id of ['m7b5-foc-tp-06', 'm7b5-foc-tp-07', 'm7b5-foc-tp-08', 'dom7alt-foc-tp-13', 'dom7alt-foc-tp-14', 'dom7alt-foc-tp-15', 'dom7alt-foc-tp-16', 'dom7alt-foc-sup-17', 'dom7alt-foc-sup-18', 'dom7alt-foc-sup-19', 'dom7alt-foc-sup-20']) {
      const f = byId.get(id)!;
      expect(f.beats).toBe(2);
      expect(f.level).toBe(3);
      expect(f.notes.length).toBe(6);
    }
  });
  it('a Focus cell is not played twice in one lick', () => {
    let dup = 0;
    let licks = 0;
    for (const concept of ['triadPairs', 'enclosures', 'chromaticApproach', 'superimposition'] as ConceptId[]) {
      for (let s = 0; s < 24; s++) {
        const target = posToScore([65, 85][s % 2]); const tier = tierForScore(target);
        const l = generateLick({ progressionId: PROGRESSIONS[s % 5].id, length: (['short', 'standard', 'long'] as const)[s % 3], keyPc: s % 12, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 70 + s, concept });
        const ids = l.fragmentIds.filter(id => byId.get(id)?.concept === concept);
        if (new Set(ids).size < ids.length) dup++;
        licks++;
      }
    }
    expect(dup / licks).toBeLessThanOrEqual(0.02);
  }, 40_000);
});

describe('FX4 repair: a cell\'s resolution of a chromatic / b9 note is kept', () => {
  it('fixJoins leaves a last note that resolves a non-scale note by step alone, even when the next chord starts far away', () => {
    const chords = [ch(0, 'maj7', 0, 48), ch(7, 'dom7', 48, 48)];
    // Cmaj7: ... Db (b9, outside the scale) -> C (root) on the last 8th, then G7 opens on an F an octave and a half higher
    const base = (): Ev[] => [
      { midi: 64, start: 0, pieces: [12] }, { midi: 67, start: 12, pieces: [12] }, { midi: 61, start: 24, pieces: [12] },
      { midi: 60, start: 36, pieces: [12] }, { midi: 77, start: 48, pieces: [48] },
    ];
    const ev = base();
    fixJoins(ev, chords, [48, 90]);
    expect(ev[2].midi).toBe(61);
    expect(ev[3].midi).toBe(60);
  });
  it('...while an ordinary awkward leap into a chord change still gets an approach note', () => {
    const chords = [ch(0, 'maj7', 0, 48), ch(7, 'dom7', 48, 48)];
    const ev: Ev[] = [{ midi: 64, start: 0, pieces: [12] }, { midi: 67, start: 12, pieces: [12] }, { midi: 62, start: 24, pieces: [12] }, { midi: 60, start: 36, pieces: [12] }, { midi: 77, start: 48, pieces: [48] }];
    fixJoins(ev, chords, [48, 90]);
    expect(ev[3].midi).not.toBe(60);
  });
});

describe('FX4 Focus availability', () => {
  it('conceptAvailable is false where the tier does not offer the concept, and the table only names real progressions / lengths / tiers', () => {
    expect(conceptAvailable('triadPairs', 'major-251', 'standard', 2)).toBe(false);
    expect(conceptAvailable('enclosures', 'major-251', 'standard', 2)).toBe(true);
    const ids = new Set(PROGRESSIONS.map(p => p.id));
    for (const c of CONCEPTS) {
      for (const [key, span] of Object.entries(CONCEPT_UNAVAILABLE[c] ?? {})) {
        expect(span[0], key).toBeLessThanOrEqual(span[1]);
        const [p, len, tier] = key.split('|');
        expect(ids.has(p), key).toBe(true);
        expect(['short', 'standard', 'long']).toContain(len);
        expect(conceptAllowed(c, Number(tier) as 1 | 2 | 3 | 4), key).toBe(true);
      }
    }
  });
  it('focusHint says so when a concept is not available for the progression, length and tier', () => {
    expect(focusHint('enclosures', 2)).toBe('');
    const entries = CONCEPTS.flatMap(c => Object.entries(CONCEPT_UNAVAILABLE[c] ?? {}).map(([k, span]) => [c, k, span] as const));
    expect(entries.length).toBeGreaterThan(0);
    for (const [c, key, span] of entries) {
      const [p, len, tier] = key.split('|');
      const prog = PROGRESSIONS.find(x => x.id === p)!;
      expect(conceptAvailable(c, p, len as LengthId, Number(tier) as Tier, span[0]), key).toBe(false);
      expect(focusHint(c, Number(tier) as Tier, prog, len as LengthId, span[0]), key).toMatch(/only sometimes fit/);
    }
  });
});

describe('FX4 hit rates where the UI offers a concept (sampled positions)', () => {
  const POS = [30, 58, 90];
  const lens: LengthId[] = ['short', 'standard'];
  for (const c of CONCEPTS) {
    it(`${c}: >= 80% of the licks deliver it wherever it is available (3 positions x 8 progressions x 2 lengths x 3 seeds)`, () => {
      let hits = 0;
      let n = 0;
      let worst = 1;
      for (const pos of POS) {
        const target = posToScore(pos); const tier = tierForScore(target);
        if (!conceptAllowed(c, tier)) continue;
        for (const p of PROGRESSIONS) {
          for (const length of lens) {
            if (!conceptAvailable(c, p.id, length, tier, pos)) continue;
            let h = 0;
            for (let s = 0; s < 3; s++) {
              const l = generateLick({ progressionId: p.id, length, keyPc: (s * 5 + pos) % 12, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 900 + s, concept: c });
              const r = conceptHits(l, c);
              if (c === 'guideTones' ? r.hits >= Math.ceil(r.of * 0.7) : r.hits > 0) h++;
            }
            hits += h; n += 3; worst = Math.min(worst, h / 3);
          }
        }
      }
      if (n) expect(hits / n, `${c} worst point ${worst}`).toBeGreaterThanOrEqual(0.8);
    }, 60_000);
  }
});
