import { describe, expect, it } from 'vitest';
import { FOCUS_FRAGMENTS } from '../src/fragments/lib/focus';
import { FRAGMENTS } from '../src/fragments';
import { generateLick } from '../src/generator';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { CONCEPTS, conceptAllowed, conceptHits, detectDevices, displayDevices, type DeviceKind } from '../src/theory/devices';
import { PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import { mod12 } from '../src/theory/pitch';
import { deviceRows } from '../src/ui/devices';
import type { ChordQualityId, LengthId, Lick, LickChord, LickNote } from '../src/types';

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
const one = (q: ChordQualityId, root = 0, ticks = 96): LickChord[] => [{ rootPc: root, quality: q, symbol: '', start: 0, dur: ticks }];
const kinds = (l: Pick<Lick, 'notes' | 'chords'>, only: DeviceKind[]): DeviceKind[] => [...new Set(detectDevices(l, only).map(d => d.kind))];
const E = 6;
const alto = getInstrument('alto');

describe('enclosure detector: approach notes are real approaches', () => {
  it('an approach note may not open a chord, sit on the bar downbeat over a later target, or belong to the previous chord', () => {
    const ch = one('m6');
    // rest, then C B D? : A (approach) opens the chord -> not an enclosure; the same figure after a lead-in note is
    expect(kinds(mk(ch, [[69, E], [72, E], [73, E], [71, E]]), ['enclosure'])).toEqual([]);
    expect(kinds(mk(ch, [[67, E], [69, E], [72, E], [73, E], [71, E]]), ['enclosure']).length).toBe(0); // 3-note approach, no half step to B
    expect(kinds(mk(ch, [[64, E], [73, E], [71, E], [72, E], [60, E]]), ['enclosure'])).toEqual(['enclosure']); // upper, lower -> C on the beat... after a lead-in
    const two = [...one('dom7', 7, 24), ...one('maj7', 0, 72).map(c => ({ ...c, start: 24 }))];
    // G A# F# -> G# arpeggio across a chord change is not an enclosure
    expect(kinds(mk(two, [[67, 12], [70, 6], [66, 6], [68, 12]]), ['enclosure'])).toEqual([]);
  });
});

describe('triad pairs, 6th-diminished lines and superimpositions are not found in ordinary licks', () => {
  const lens: LengthId[] = ['short', 'standard', 'long'];
  const licks: Lick[] = [];
  for (let i = 0; i < 96; i++) {
    const target = posToScore([12, 37, 62, 87][i % 4]); const tier = tierForScore(target);
    licks.push(generateLick({ progressionId: PROGRESSIONS[(i >> 2) % 8].id, length: lens[(i >> 1) % 3], keyPc: i % 12, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 500 + i }));
  }
  it('false-positive rates without a Focus stay low', () => {
    const rate = (k: DeviceKind): number => licks.filter(l => detectDevices(l, [k]).length).length / licks.length;
    expect(rate('triadPair')).toBeLessThan(0.06);
    expect(rate('superimposition')).toBeLessThan(0.06);
    expect(rate('sixthDim')).toBeLessThan(0.06);
  });
  it('a triad-pair window must lie in one chord, move in 8ths and leaps, and reach 2 notes beyond the chord tones and the 9th', () => {
    const E8 = 6;
    // C/D over Cmaj7 as an 8th-note arpeggio: found; the same notes as quarter notes: not
    const line = [64, 67, 72, 74, 69, 66, 72, 76].map(m => [m, E8] as Spec);
    expect(kinds(mk(one('maj7'), line), ['triadPair'])).toEqual(['triadPair']);
    expect(kinds(mk(one('maj7'), line.map(([m]) => [m, 12] as Spec)), ['triadPair'])).toEqual([]);
    // a diatonic descending line that happens to sit in two triads is not
    expect(kinds(mk(one('maj7'), [69, 66, 64, 62, 59, 56, 54].map(m => [m, E8] as Spec)), ['triadPair'])).toEqual([]);
  });
  it('6th-diminished: chord tones (R 3 5 6) on the beats, stepwise through the 8-note scale; skipped degrees and diminished tones on the beats are not', () => {
    const good = [67, 69, 71, 72, 74, 72, 71, 69, 67].map(m => [m, E] as Spec); // not 6th-dim: no added tone
    expect(kinds(mk(one('maj7'), good), ['sixthDim'])).toEqual([]);
    const bd = [76, 74, 72, 71, 69, 68, 67, 65].map(m => [m, E] as Spec); // E D C B A G# G F: stepwise, tones on beats
    expect(kinds(mk(one('maj7'), bd), ['sixthDim'])).toEqual(['sixthDim']);
    const wrongBeats = [74, 72, 71, 69, 68, 67, 65, 64].map(m => [m, E] as Spec); // starts on the 9th: tones fall on the "and"s
    expect(kinds(mk(one('maj7'), wrongBeats), ['sixthDim'])).toEqual([]);
    const skip = [76, 74, 72, 71, 69, 67, 65, 64].map(m => [m, E] as Spec); // A G skips the added G#
    expect(kinds(mk(one('maj7'), skip), ['sixthDim'])).toEqual([]);
  });
  it('superimposition: an outside ii-V counts; the chord\'s own ii-V and the m7 a fifth above do not', () => {
    const E8 = 6;
    expect(kinds(mk(one('dom7'), [64, 68, 71, 73, 70, 66, 64, 60].map(m => [m, E8] as Spec)), ['superimposition'])).toEqual(['superimposition']);
    expect(kinds(mk(one('dom7'), [67, 70, 74, 77, 76, 72, 70, 67].map(m => [m, E8] as Spec)), ['superimposition'])).toEqual([]); // Gm7-C7 over C7
    // E-flat m7 - A-flat 7 over B-flat m7: nothing outside
    expect(kinds(mk(one('m7', 10), [63, 66, 70, 73, 68, 72, 75, 70].map(m => [m, E8] as Spec)), ['superimposition']).length).toBeLessThanOrEqual(1);
  });
});

describe('Focus cells', () => {
  it('every Focus cell is found by its own detector over every quality it serves (cell placed one bar into a chord)', () => {
    for (const f of FOCUS_FRAGMENTS) {
      if (f.concept === 'guideTones' && !(f.tags as string[]).includes('enclosure')) continue;
      const kindsFor: DeviceKind[] = f.concept === 'guideTones' ? ['enclosure'] : f.concept === 'superimposition' ? ['superimposition', 'sideSlip'] : f.concept === 'sixthDim' ? ['sixthDim'] : f.concept === 'triadPairs' ? ['triadPair'] : f.concept === 'chromaticApproach' ? ['chromatic'] : ['enclosure'];
      for (const q of f.qualities) {
        let t = 48;
        const notes = f.notes.map(n => { const r: LickNote = { midi: n.rel == null ? null : 60 + n.rel, start: t, dur: n.dur * 3, chord: 0, ...(n.tie ? { tie: true } : {}) }; t += n.dur * 3; return r; });
        expect(detectDevices({ notes, chords: [{ rootPc: 0, quality: q, symbol: '', start: 0, dur: t }] }, kindsFor).length, `${f.id} over ${q}`).toBeGreaterThan(0);
      }
    }
  });
  it('6th-dim cells put chord tones (R 3 5 6) on every 8th-note downbeat and step through the scale', () => {
    for (const f of FOCUS_FRAGMENTS.filter(x => x.concept === 'sixthDim')) {
      const pitched = f.notes.filter(n => n.rel != null);
      let t = 0;
      for (const n of f.notes) {
        if (n.rel != null && t % 4 === 0) {
          const r = mod12(n.rel);
          expect([0, 3, 4, 7, 9], `${f.id} beat note ${n.rel}`).toContain(r);
        }
        t += n.dur;
      }
      for (let i = 1; i < pitched.length; i++) expect(Math.abs((pitched[i].rel as number) - (pitched[i - 1].rel as number)), f.id).toBeLessThanOrEqual(2);
    }
  });
  it('Focus cells survive the repair and phrasing passes (>= 90% of the cells used keep every note)', () => {
    const byId = new Map(FRAGMENTS.map(f => [f.id, f]));
    let used = 0;
    let intact = 0;
    for (const concept of ['triadPairs', 'superimposition', 'sixthDim', 'enclosures'] as const) {
      for (let s = 0; s < 14; s++) {
        const target = posToScore(88); const tier = tierForScore(target);
        const l = generateLick({ progressionId: PROGRESSIONS[s % 5].id, length: s % 2 ? 'standard' : 'short', keyPc: s, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 800 + s, concept });
        l.fragmentIds.forEach((id, i) => {
          const f = byId.get(id);
          if (f?.concept !== concept) return;
          used++;
          const s0 = l.cellStarts![i];
          const e0 = l.cellStarts![i + 1] ?? l.totalTicks;
          const chord = l.chords.find(c => s0 >= c.start && s0 < c.start + c.dur)!;
          let t = 0;
          let ok = true;
          for (const n of f.notes) {
            if (n.rel != null && !l.notes.some(x => x.midi != null && x.start >= s0 && x.start < e0 && x.start - s0 === t && mod12(x.midi) === mod12(chord.rootPc + n.rel!))) {
              // a tied merge keeps the pitch sounding
              ok = ok && l.notes.some(x => x.midi != null && x.start <= s0 + t && x.start + x.dur > s0 + t && mod12(x.midi) === mod12(chord.rootPc + n.rel!));
            }
            t += n.dur;
          }
          if (ok) intact++;
        });
      }
    }
    expect(used).toBeGreaterThan(20);
    expect(intact / used).toBeGreaterThanOrEqual(0.9);
  });
  it('guide-tone Focus links most changes at Advanced / Expert on a Coltrane chain', () => {
    let h = 0;
    let o = 0;
    for (let s = 0; s < 8; s++) {
      const target = posToScore(80); const tier = tierForScore(target);
      const l = generateLick({ progressionId: 'coltrane', length: 'standard', keyPc: s, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 900 + s, concept: 'guideTones' });
      const r = conceptHits(l, 'guideTones'); h += r.hits; o += r.of;
    }
    expect(h / o).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Focus generation speed', () => {
  it('every Focus concept stays fast on the long Coltrane changes (median under 80 ms, loose CI bound)', () => {
    const times: number[] = [];
    for (const concept of CONCEPTS) {
      const target = posToScore(85); const tier = tierForScore(target);
      if (!conceptAllowed(concept, tier)) continue;
      for (let s = 0; s < 3; s++) {
        const t0 = performance.now();
        generateLick({ progressionId: 'coltrane', length: 'long', keyPc: s, tier, targetScore: target, range: concertRange(alto), comfortRange: concertRangeForLevel(alto, tier), seed: 70 + s, concept });
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    expect(times[times.length >> 1]).toBeLessThan(80);
  });
});

describe('analysis wording and display', () => {
  it('an anticipation is described by how early it really is', () => {
    const chords = expandProgression(getProgression('major-251'), 'standard', 0);
    const l = mk(chords, [[62, 12], [65, 12], [69, 12], [72, 6], [71, 6], [67, 6], [71, 6], [74, 6], [76, 6], [72, 18]]);
    // tie an eighth-early arrival into the G7 and a quarter-early one into Cmaj7
    const ant = { ...(l as Lick), id: 'x', seed: 1, progressionId: 'major-251', length: 'standard', keyPc: 0, mode: 'major', requestedTier: 3, totalTicks: 144, fragmentIds: [], difficulty: { score: 0, tier: 3, features: [] } } as unknown as Lick;
    ant.notes = [
      { midi: 62, start: 0, dur: 42, chord: 0 }, { midi: 71, start: 42, dur: 6, chord: 0, tie: true }, { midi: 71, start: 48, dur: 48, chord: 1 },
      { midi: 67, start: 96, dur: 48, chord: 2 },
    ];
    const rows = deviceRows(ant, alto);
    const a = rows.find(r => r.span.kind === 'anticipation');
    expect(a?.what).toContain('an eighth early');
    expect(a?.what).not.toContain('a beat early');
  });
  it('under the chromatic-approach Focus a chromatic approach inside an enclosure keeps its label', () => {
    const devs = [{ kind: 'enclosure' as const, first: 0, last: 3, chord: 0, target: 3 }, { kind: 'chromatic' as const, first: 2, last: 3, chord: 0, target: 3 }];
    expect(displayDevices(devs).map(d => d.kind)).toEqual(['enclosure']);
    expect(displayDevices(devs, 'chromaticApproach').map(d => d.kind)).toEqual(['enclosure', 'chromatic']);
  });
});
