import { describe, expect, it } from 'vitest';
import { ENDING_DEGREES, lickMetrics, summarize } from '../src/analysis/musicality';
import { FRAGMENTS, VOCAB_DROP } from '../src/fragments';
import { VOCAB_FRAGMENTS } from '../src/fragments/lib/vocab';
import { ADVANCED_FRAGMENTS } from '../src/fragments/lib/advanced';
import { PHASE2B_FRAGMENTS } from '../src/fragments/lib/phase2b';
import { inScale } from '../src/theory/chords';
import { judgedChord } from '../src/theory/rhythm';
import { generateLick } from '../src/generator';
import { Rng } from '../src/generator/rng';
import { anticipationFitsOldChord, phraseEvents, type Ev } from '../src/generator/connect';
import { chordRoles } from '../src/generator/generate';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { TIER_NAMES, type Fragment, type LengthId, type Lick, type LickChord, type Tier } from '../src/types';

/** Round-2 review (Opus jazz-educator): dominant colour by function, noodling, thin altered cells, Expert 16ths, endings, anticipation filter. */

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const frag = (id: string): Fragment => {
  const f = FRAGMENTS.find(x => x.id === id);
  if (!f) throw new Error(`no fragment ${id}`);
  return f;
};
const rels = (f: Fragment) => f.notes.filter(n => n.rel !== null).map(n => n.rel as number);

describe('library: round-2 cell fixes', () => {
  it('drops the noodling cells, the 16th walls and the hidden-b13 "altered" cells', () => {
    const raw = new Set([...VOCAB_FRAGMENTS, ...ADVANCED_FRAGMENTS, ...PHASE2B_FRAGMENTS].map(f => f.id));
    for (const id of VOCAB_DROP) {
      expect(raw.has(id), `${id} exists in the raw library (a misspelt id would drop nothing)`).toBe(true);
      expect(FRAGMENTS.some(f => f.id === id), id).toBe(false);
    }
    for (const id of ['maj7-voc-114', 'm7-voc-93', 'm7-adv-03', 'dom7-adv-01', 'dom7-adv-02', 'm7b5-adv-01', 'maj7-adv-05', 'm7-adv-06', 'maj7-voc-69', 'm6-voc-37', 'dom7alt-voc-28', 'dom7alt-voc-77', 'dom7alt-voc-81']) {
      expect(VOCAB_DROP.has(id), id).toBe(true);
    }
  });

  it('the minor-tonic endings never move from the major 3rd to the minor 3rd', () => {
    for (const id of ['m6-vend-61', 'm6-vend-62', 'm6-p2bend-07']) expect(rels(frag(id)).map(mod12), id).not.toContain(4);
    expect(rels(frag('m6-vend-61')).map(mod12)).toEqual([0, 2, 3]);
    expect(rels(frag('m6-vend-62')).map(mod12)).toEqual([0, 2, 3]);
  });

  it('maj7-vend-40 has no internal leap of a minor 6th or more, and m7b5-voc-71 states the b5', () => {
    const r = rels(frag('maj7-vend-40'));
    for (let i = 1; i < r.length; i++) expect(Math.abs(r[i] - r[i - 1]), `step ${i}`).toBeLessThan(8);
    expect(rels(frag('m7b5-voc-71')).map(mod12)).toContain(6);
  });

  it('the guide-tone alteration cells no longer all end on the root of the V', () => {
    const gt = FRAGMENTS.filter(f => f.id.startsWith('dom7alt-gt-'));
    const onRoot = gt.filter(f => mod12(rels(f)[rels(f).length - 1]) === 0);
    expect(onRoot.length / gt.length).toBeLessThanOrEqual(0.2);
    expect(gt.filter(f => mod12(rels(f)[rels(f).length - 1]) === 4).length).toBeGreaterThanOrEqual(8);
  });

  it('the Lydian-dominant vocabulary has Level 1-2 cells and dense Expert cells, with the #11 never on a beat', () => {
    const lyd = FRAGMENTS.filter(f => f.id.startsWith('dom7-lyd-'));
    for (const lv of [1, 2, 3, 4]) expect(lyd.filter(f => f.level === lv).length, `L${lv}`).toBeGreaterThanOrEqual(lv === 4 ? 6 : 5);
    for (const f of lyd) {
      let t = 0;
      for (const n of f.notes) { if (n.rel !== null && mod12(n.rel) === 6) expect(t % 12, f.id).not.toBe(0); expect(n.rel === null || mod12(n.rel) !== 5, `${f.id} natural 11`).toBe(true); t += n.dur; }
    }
  });
});

describe('anticipation filter: the early note must fit the OLD chord', () => {
  const bm7b5: LickChord = { rootPc: 11, quality: 'm7b5', symbol: 'Bm7♭5', start: 0, dur: 48 };
  const e7alt: LickChord = { rootPc: 4, quality: 'dom7alt', symbol: 'E7alt', start: 48, dur: 48 };
  const db7: LickChord = { rootPc: 1, quality: 'dom7', symbol: 'D♭7', start: 0, dur: 48 };
  const cmaj7: LickChord = { rootPc: 0, quality: 'maj7', symbol: 'Cmaj7', start: 48, dur: 48 };

  it('anticipationFitsOldChord: scale of m7b5, 7alt and the Lydian dominant; everything else unfiltered', () => {
    expect(anticipationFitsOldChord(68, bm7b5, false)).toBe(false); // G♯ (the 3rd of E7alt) is not in B Locrian
    expect(anticipationFitsOldChord(64, bm7b5, false)).toBe(true); // E is the 4th
    expect(anticipationFitsOldChord(64, db7, true)).toBe(false); // E (the 3rd of Cmaj7) sounds as a #9 over D♭7
    expect(anticipationFitsOldChord(67, db7, true)).toBe(true); // G is the #11
    expect(anticipationFitsOldChord(71, db7, true)).toBe(true); // B is the b7
    expect(anticipationFitsOldChord(64, db7, false)).toBe(true); // plain dominants are not filtered
    expect(anticipationFitsOldChord(69, e7alt, false)).toBe(false); // natural 13 over 7alt
  });

  const run = (a: LickChord, b: LickChord, arrival: number, lydian: boolean[]) => {
    let early = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const ev: Ev[] = [
        { midi: 62, start: 0, pieces: [12] }, { midi: 65, start: 12, pieces: [12] }, { midi: 69, start: 24, pieces: [12] },
        { midi: 66, start: 36, pieces: [12] }, { midi: arrival, start: 48, pieces: [48] },
      ];
      phraseEvents(new Rng(seed), ev, [0, 4], [a, b], [48, 90], { level: 3, lydian });
      if (ev.some(e => e.midi === arrival && e.start === 42)) early++;
    }
    return early;
  };
  it('a 3rd of the 7alt is never sounded early over Bm7b5, the root of it may be', () => {
    expect(run(bm7b5, e7alt, 68, [false, false])).toBe(0); // G♯
    expect(run(bm7b5, e7alt, 64, [false, false])).toBeGreaterThan(0); // E
  });
  it('the 3rd of the I is never sounded early over the Lydian-dominant subV, its 7th may be', () => {
    expect(run(db7, cmaj7, 64, [true, false])).toBe(0);
    expect(run(db7, cmaj7, 71, [true, false])).toBeGreaterThan(0);
    expect(run(db7, cmaj7, 64, [false, false])).toBeGreaterThan(0); // unflagged: allowed (backdoor/plain dominants keep their anticipations)
  });
});

describe('chord roles', () => {
  it('Lydian dominants are the tritone-sub and backdoor V chords; the major-251 V7 is the primary V', () => {
    const roles = (id: string) => chordRoles(id, PROGRESSIONS.find(p => p.id === id)!.slots);
    expect(roles('tritone-251')).toEqual(['other', 'lyd', 'other']);
    expect(roles('backdoor-251')).toEqual(['other', 'lyd', 'other']);
    expect(roles('major-251')).toEqual(['other', 'primaryV', 'other']);
    expect(roles('minor-251')).toEqual(['other', 'alt', 'other']);
  });
});

describe('round-2 musicality targets (same seeded session sample as `npm run musicality`)', () => {
  const INSTS = ['alto', 'guitar'].map(getInstrument);
  const all: Lick[] = [];
  const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
  let seed = 1;
  for (const p of PROGRESSIONS) for (const length of Object.keys(LENGTHS) as LengthId[]) for (const pos of [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]) for (let s = 0; s < 6; s++) {
    const inst = INSTS[s % INSTS.length];
    const l = generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: posToScore(pos), range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tierForScore(posToScore(pos))), avoid: all.slice(-8).flatMap(r => r.fragmentIds), seed: seed++ });
    all.push(l);
    byTier[l.requestedTier].push(l);
  }
  const m = Object.fromEntries(([1, 2, 3, 4] as Tier[]).map(t => [TIER_NAMES[t], summarize(byTier[t])]));
  const lydLicks = all.filter(l => l.progressionId === 'tritone-251' || l.progressionId === 'backdoor-251');

  it('tritone-sub and backdoor dominants sound Lydian: #11, no natural 11, no b9/#9/b13', () => {
    const s = summarize(lydLicks);
    expect(s.lydianSharp11Share).toBeGreaterThanOrEqual(0.35); // was 16%
    expect(s.lydianAlteredShare).toBeLessThanOrEqual(0.1); // was 27%
    expect(m.Advanced.lydianSharp11Share).toBeGreaterThanOrEqual(0.55);
    expect(m.Expert.lydianSharp11Share).toBeGreaterThanOrEqual(0.5);
    for (const t of ['Advanced', 'Expert']) expect(m[t].lydianAlteredShare, t).toBeLessThanOrEqual(0.15);
    expect(m.Expert.lydianElevenShare).toBeLessThanOrEqual(0.1);
  });

  it('few licks noodle on chord tones (a run of more than six chord-tone attacks within an octave); near-duplicate neighbours are rare', () => {
    expect(m.Advanced.noodleShare).toBeLessThanOrEqual(0.1); // was 14%
    expect(m.Expert.noodleShare).toBeLessThanOrEqual(0.08);
    expect(m.Intermediate.noodleShare).toBeLessThanOrEqual(0.35);
    for (const t of Object.keys(m)) expect(m[t].nearDuplicateShare, t).toBeLessThanOrEqual(0.05);
  });

  it('no stepwise 16th run longer than four notes in the final bar (rare), and the Expert 16th share stays in check', () => {
    for (const t of Object.keys(m)) expect(m[t].finalSixteenthRunShare, t).toBeLessThanOrEqual(0.06); // Expert was 8%
    expect(m.Expert.sixteenthShare).toBeLessThanOrEqual(0.3);
  });

  it('anticipated notes never leave the scale of an m7b5, 7alt or Lydian-dominant chord they sound over', () => {
    for (const t of Object.keys(m)) expect(m[t].anticipationClashShare, t).toBe(0); // was 21-30%
    for (const l of all) expect(lickMetrics(l).anticipationClashes, l.id).toBe(0);
    // independent check (not the generator's own filter): an anticipation head sounds over its OLD chord first; over an
    // m7b5, 7alt or tritone-sub/backdoor dominant it must be in that chord's scale (Lydian dominant: 0 2 4 6 7 9 10)
    const LYD = [0, 2, 4, 6, 7, 9, 10];
    let heads = 0;
    for (const l of all) {
      const lydianProg = l.progressionId === 'tritone-251' || l.progressionId === 'backdoor-251';
      l.notes.forEach((n, i) => {
        if (n.midi == null || judgedChord(l.notes, i) === n.chord) return;
        heads++;
        const old = l.chords[n.chord];
        const rel = mod12(n.midi - old.rootPc);
        if (old.quality === 'm7b5' || old.quality === 'dom7alt') expect(inScale(n.midi, old.rootPc, old.quality), `${l.id} note ${i}`).toBe(true);
        if (lydianProg && old.quality === 'dom7') expect(LYD.includes(rel), `${l.id} note ${i} rel ${rel}`).toBe(true);
      });
    }
    expect(heads).toBeGreaterThan(50);
  });

  it('7alt carries real altered colour at the lower tiers, and the m7b5 states its b5', () => {
    expect(m.Intermediate.altThinShare).toBeLessThanOrEqual(0.2); // was 23%
    expect(summarize(all).altThinShare).toBeLessThanOrEqual(0.2); // was 20%
    for (const t of ['Intermediate', 'Advanced', 'Expert']) expect(m[t].m7b5Flat5Share, t).toBeGreaterThanOrEqual(0.75);
  });

  it('endings: Expert lands on the root, 3rd or 5th at least 45% of the time, the 9th at most 25%, the 6th at most 15%', () => {
    const e = m.Expert.endingShares;
    expect(e.R + e['3'] + e['5']).toBeGreaterThanOrEqual(0.45); // was 38%
    expect(e['9']).toBeLessThanOrEqual(0.25); // was 29%
    expect(e['6']).toBeLessThanOrEqual(0.15); // was 22%
    for (const t of ['Beginner', 'Intermediate']) expect(m[t].endingShares['6'], t).toBeLessThanOrEqual(0.08);
    for (const t of Object.keys(m)) expect(ENDING_DEGREES.reduce((a, d) => a + m[t].endingShares[d], 0), t).toBeCloseTo(1, 6);
  });

  it('the V still arrives on its 3rd or 7th and the earlier targets hold', () => {
    for (const t of Object.keys(m)) {
      expect(m[t].dominantGuideShare, `${t} V-guide`).toBeGreaterThanOrEqual(0.8);
      expect(m[t].bigLeapShare, `${t} leaps`).toBeLessThanOrEqual(0.02);
      expect(m[t].maj7FourthShare, `${t} maj7-4th`).toBe(0);
      expect(m[t].dottedShare, `${t} dotted`).toBe(0);
    }
    expect(m.Beginner.anticipationShare).toBeLessThanOrEqual(0.15);
    expect(m.Intermediate.anticipationShare).toBeGreaterThanOrEqual(0.2);
    expect(m.Intermediate.anticipationShare).toBeLessThanOrEqual(0.4);
    for (const t of ['Advanced', 'Expert']) {
      expect(m[t].anticipationShare, t).toBeGreaterThanOrEqual(0.35);
      expect(m[t].anticipationShare, t).toBeLessThanOrEqual(0.55);
    }
  });
}, 120_000);
