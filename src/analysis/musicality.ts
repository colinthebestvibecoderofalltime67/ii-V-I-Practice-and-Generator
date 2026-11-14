/**
 * Musicality metrics for generated licks (pure, no DOM). Used by `npm run musicality` and by tests, so phrasing
 * and vocabulary changes are judged by numbers rather than taste. Each metric answers one question a jazz
 * player would ask of a line; see docs/ARCHITECTURE.md.
 */
import type { ConceptId, Lick, LickNote } from '../types';
import { TPB } from '../types';
import { CHORDS, inScale } from '../theory/chords';
import { mod12 } from '../theory/pitch';
import { getProgression } from '../theory/progressions';
import { anticipationFitsOldChord } from '../generator/connect';
import { conceptHits } from '../theory/devices';

/** Degree label of the closing note, for the ending-tone distribution. */
export type EndingDegree = 'R' | '3' | '5' | '7' | '9' | '6' | 'other';
export const ENDING_DEGREES: readonly EndingDegree[] = ['R', '3', '5', '7', '9', '6', 'other'];
const endingDegree = (rel: number): EndingDegree =>
  rel === 0 ? 'R' : rel === 3 || rel === 4 ? '3' : rel === 7 ? '5' : rel === 10 || rel === 11 ? '7' : rel === 2 ? '9' : rel === 9 ? '6' : 'other';

export interface Attack { idx: number; midi: number; start: number; dur: number; chord: number }

/** Attacks with tie chains merged (start/chord of the first note, dur of the whole chain). */
export function attacks(notes: readonly LickNote[]): Attack[] {
  const out: Attack[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.midi == null) continue;
    if (i > 0 && notes[i - 1].tie && notes[i - 1].midi === n.midi) { out[out.length - 1].dur += n.dur; continue; }
    out.push({ idx: i, midi: n.midi, start: n.start, dur: n.dur, chord: n.chord });
  }
  return out;
}

export interface LickMetrics {
  /** A note attacked within one beat before a chord change and still sounding across it. */
  anticipations: number;
  /** The lick starts with a rest (pickup feel). */
  startsWithRest: boolean;
  /** Re-attacks of the same pitch where one melodic cell joins the next. */
  seamRepeats: number;
  /** For each dominant chord: is the note sounding as it arrives its 3rd or 7th? (null = no note sounding) */
  dominantArrivalGuide: (boolean | null)[];
  /** For every chord change (not the first chord): does the note sounding as the chord arrives (an anticipation counts) carry one of its guide tones? null = rest. */
  changeArrivalGuide: (boolean | null)[];
  /** Natural 5th or natural 13th attacked on a beat over a 7alt chord. */
  altNaturalOnBeat: number;
  /** Non-scale (chromatic) notes attacked on a beat and held a beat or longer. */
  longChromaticOnBeat: number;
  /** Highest pitch minus lowest, in semitones. */
  span: number;
  /** Consecutive attacks a minor 7th (10 semitones) or more apart. */
  bigLeaps: number;
  /** Attacks lasting a 16th or less (triplets excluded) and all attacks, for the 16th-note share. */
  sixteenths: number;
  attackCount: number;
  /** For each 7alt chord: does any note over it carry an alteration (♭9, ♯9 or ♭13)? */
  altColoured: boolean[];
  /** The 4th over a maj7 chord attacked on a beat or held a beat or longer (an avoid note). */
  maj7FourthStressed: number;
  /** Beats rhythmed dotted 8th + 16th (march-like under swing). */
  dottedPairs: number;
  /** Natural 11 on a beat or held, over a tritone-sub or backdoor dominant (Lydian-dominant chords). */
  lydianDomEleven: number;
  /** The last attack repeats the pitch of the one before it. */
  endingRepeat: boolean;
  /** For each Lydian dominant (tritone-sub / backdoor V): #11 present and no natural 11 over it; and any b9/#9/b13 over it. */
  lydianSharp11: boolean[];
  lydianAltered: boolean[];
  /** For each secondary dominant (VI7 -> ii): the line over it states the b9; and holds a natural 13 on a beat (it clashes with the ii's b3). */
  secDomFlat9: boolean[];
  secDomNat13Stressed: boolean[];
  /** Longest run of consecutive chord-tone-only attacks within an octave (arpeggio noodling when > 6). */
  noodleRun: number;
  /** Longest stepwise (<= 2 semitones) run of 16th notes starting in the final bar. */
  finalSixteenthRun: number;
  /** Degree of the closing note over the last chord. */
  ending: EndingDegree;
  /** Anticipated notes sounding outside the OLD chord's scale when the old chord is m7b5, 7alt or a Lydian dominant. */
  anticipationClashes: number;
  /** For each 7alt chord: thin colour (fewer than two altered tones, none held a quarter or more on a beat). */
  altThin: boolean[];
  /** For each m7b5 chord: the b5 is stated over it. */
  m7b5Flat5: boolean[];
  /** Adjacent cell pairs, and those sharing their first three or last two pitches (rel to the chord root). */
  cellPairs: number;
  nearDuplicatePairs: number;
}

export function lickMetrics(lick: Lick): LickMetrics {
  const att = attacks(lick.notes);
  const chords = lick.chords;
  let anticipations = 0;
  for (let c = 1; c < chords.length; c++) {
    const t = chords[c].start;
    if (att.some(a => a.start < t && a.start >= t - TPB && a.start + a.dur > t)) anticipations++;
  }
  const startsWithRest = lick.notes.length > 0 && lick.notes[0].midi == null;

  let seamRepeats = 0;
  for (const cs of lick.cellStarts ?? []) {
    if (cs === 0) continue;
    const k = att.findIndex(a => a.start >= cs);
    if (k > 0 && att[k].start === cs && att[k].midi === att[k - 1].midi && att[k - 1].start + att[k - 1].dur === cs) seamRepeats++;
  }

  const dominantArrivalGuide = chords.map(ch => {
    if (ch.quality !== 'dom7' && ch.quality !== 'dom7alt') return undefined;
    const a = att.find(x => x.start <= ch.start && x.start + x.dur > ch.start);
    if (!a) return null;
    const rel = mod12(a.midi - ch.rootPc);
    return CHORDS[ch.quality].guide.some(g => mod12(g) === rel);
  }).filter((v): v is boolean | null => v !== undefined);

  const changeArrivalGuide = chords.slice(1).map(ch => {
    const a = att.find(x => x.start <= ch.start && x.start + x.dur > ch.start);
    if (!a) return null;
    const rel = mod12(a.midi - ch.rootPc);
    return CHORDS[ch.quality].guide.some(g => mod12(g) === rel);
  });

  let altNaturalOnBeat = 0;
  let longChromaticOnBeat = 0;
  for (const a of att) {
    const ch = chords[a.chord];
    const rel = mod12(a.midi - ch.rootPc);
    const onBeat = a.start % TPB === 0;
    if (onBeat && ch.quality === 'dom7alt' && (rel === 7 || rel === 9)) altNaturalOnBeat++;
    if (onBeat && a.dur >= TPB && !inScale(a.midi, ch.rootPc, ch.quality)) longChromaticOnBeat++;
  }
  const ps = att.map(a => a.midi);
  const span = ps.length ? Math.max(...ps) - Math.min(...ps) : 0;

  let bigLeaps = 0;
  for (let i = 1; i < att.length; i++) if (Math.abs(att[i].midi - att[i - 1].midi) >= 10) bigLeaps++;
  const sixteenths = att.filter(a => a.dur <= 3 && a.dur % 3 === 0).length;
  const altColoured = chords.flatMap((ch, ci) => ch.quality !== 'dom7alt' ? [] :
    [att.some(a => a.chord === ci && [1, 3, 8].includes(mod12(a.midi - ch.rootPc)))]);
  let maj7FourthStressed = 0;
  let lydianDomEleven = 0;
  const slots = getProgression(lick.progressionId).slots;
  const isLydChord = (ci: number) => slots[ci]?.fn === 'lydianDom' && chords[ci].quality === 'dom7';
  for (const a of att) {
    const ch = chords[a.chord];
    const rel = mod12(a.midi - ch.rootPc);
    const stressed = a.start % TPB === 0 || a.dur >= TPB;
    if (stressed && ch.quality === 'maj7' && rel === 5) maj7FourthStressed++;
    if (stressed && isLydChord(a.chord) && rel === 5) lydianDomEleven++;
  }
  let dottedPairs = 0;
  const notes = lick.notes;
  for (let i = 0; i + 1 < notes.length; i++) {
    if (notes[i].start % TPB === 0 && notes[i].dur === 9 && notes[i + 1].dur === 3) dottedPairs++;
  }
  const endingRepeat = att.length > 1 && att[att.length - 1].midi === att[att.length - 2].midi;

  const lydianSharp11: boolean[] = [];
  const lydianAltered: boolean[] = [];
  chords.forEach((ch, ci) => {
    if (!isLydChord(ci)) return;
    const rels = att.filter(a => a.chord === ci).map(a => mod12(a.midi - ch.rootPc));
    lydianSharp11.push(rels.includes(6) && !rels.includes(5));
    lydianAltered.push(rels.some(r => r === 1 || r === 3 || r === 8));
  });
  const secDomFlat9: boolean[] = [];
  const secDomNat13Stressed: boolean[] = [];
  chords.forEach((ch, ci) => {
    if (slots[ci]?.fn !== 'secondaryDom' || ch.quality !== 'dom7') return;
    const mine = att.filter(a => a.chord === ci);
    secDomFlat9.push(mine.some(a => mod12(a.midi - ch.rootPc) === 1));
    secDomNat13Stressed.push(mine.some(a => mod12(a.midi - ch.rootPc) === 9 && (a.start % TPB === 0 || a.dur >= TPB)));
  });
  let noodleRun = 0;
  let run: number[] = [];
  for (const a of att) {
    const ch = chords[a.chord];
    if (!CHORDS[ch.quality].tones.some(t => mod12(t) === mod12(a.midi - ch.rootPc))) { run = []; continue; }
    run.push(a.midi);
    while (Math.max(...run) - Math.min(...run) > 12) run.shift();
    noodleRun = Math.max(noodleRun, run.length);
  }
  const lastBar = lick.totalTicks - 4 * TPB;
  let finalSixteenthRun = 0;
  let sr = 0;
  for (let i = 0; i < att.length; i++) {
    const sixteenth = att[i].dur <= 3 && att[i].dur % 3 === 0;
    if (sixteenth && i > 0 && att[i - 1].dur <= 3 && Math.abs(att[i].midi - att[i - 1].midi) <= 2) sr++;
    else sr = sixteenth ? 1 : 0;
    if (att[i].start >= lastBar) finalSixteenthRun = Math.max(finalSixteenthRun, sr);
  }
  const lastAtt = att[att.length - 1];
  const ending = lastAtt ? endingDegree(mod12(lastAtt.midi - chords[lastAtt.chord].rootPc)) : 'other';
  let anticipationClashes = 0;
  for (let c = 1; c < chords.length; c++) {
    const t = chords[c].start;
    for (const a of att) {
      if (a.start < t && a.start >= t - TPB && a.start + a.dur > t && !anticipationFitsOldChord(a.midi, chords[c - 1], isLydChord(c - 1))) anticipationClashes++;
    }
  }
  const altThin = chords.flatMap((ch, ci) => {
    if (ch.quality !== 'dom7alt') return [];
    let n = 0;
    let held = false;
    for (const a of att) {
      if (a.chord !== ci || ![1, 3, 8].includes(mod12(a.midi - ch.rootPc))) continue;
      n++;
      if (a.start % TPB === 0 && a.dur >= TPB) held = true;
    }
    return [n < 2 && !held];
  });
  const m7b5Flat5 = chords.flatMap((ch, ci) => ch.quality !== 'm7b5' ? [] : [att.some(a => a.chord === ci && mod12(a.midi - ch.rootPc) === 6)]);
  let cellPairs = 0;
  let nearDuplicatePairs = 0;
  const cs = lick.cellStarts ?? [];
  const cellRels = cs.map((st, k) => {
    const end = k + 1 < cs.length ? cs[k + 1] : Infinity;
    return att.filter(a => a.start >= st && a.start < end).map(a => mod12(a.midi - chords[a.chord].rootPc));
  });
  for (let k = 1; k < cellRels.length; k++) {
    const p = cellRels[k - 1];
    const q = cellRels[k];
    if (p.length < 3 || q.length < 3) continue;
    cellPairs++;
    if (p.slice(0, 3).join() === q.slice(0, 3).join() || p.slice(-2).join() === q.slice(-2).join()) nearDuplicatePairs++;
  }
  return {
    anticipations, startsWithRest, seamRepeats, dominantArrivalGuide, changeArrivalGuide, altNaturalOnBeat, longChromaticOnBeat, span,
    bigLeaps, sixteenths, attackCount: att.length, altColoured, maj7FourthStressed, dottedPairs, lydianDomEleven, endingRepeat,
    lydianSharp11, lydianAltered, secDomFlat9, secDomNat13Stressed, noodleRun, finalSixteenthRun, ending, anticipationClashes, altThin, m7b5Flat5, cellPairs, nearDuplicatePairs,
  };
}

export interface MusicalitySummary {
  licks: number;
  /** Share of licks with at least one anticipation. */
  anticipationShare: number;
  startsWithRestShare: number;
  /** Share of licks with at least one seam re-attack. */
  seamRepeatShare: number;
  /** Share of dominant arrivals landing on the 3rd or 7th (arrivals with no sounding note excluded). */
  dominantGuideShare: number;
  /** Share of ALL chord changes (every chord after the first) arrived on a guide tone of the new chord (rests excluded). */
  changeGuideShare: number;
  /** Natural 5/13 on-beat attacks over 7alt per 1,000 attacks. */
  altNaturalPerK: number;
  longChromaticPerK: number;
  /** Share of licks containing the most-used fragment, and its id. */
  topCellShare: number;
  topCell: string;
  /** Share of licks with a leap of a minor 7th or more between consecutive notes. */
  bigLeapShare: number;
  /** Share of all attacks that are 16th notes (triplets excluded). */
  sixteenthShare: number;
  /** Share of 7alt chords with no ♭9, ♯9 or ♭13 in the line over them. */
  altPlainShare: number;
  /** Share of licks stressing the 4th over a maj7 chord. */
  maj7FourthShare: number;
  /** Share of licks with two or more dotted-8th-and-16th beats. */
  dottedShare: number;
  /** Share of tritone-sub/backdoor licks stressing the natural 11 over the Lydian-dominant chord. */
  lydianElevenShare: number;
  /** Share of licks whose last note repeats the note before it. */
  endingRepeatShare: number;
  /** Share of tritone-sub/backdoor dominants with the #11 and no natural 11 (the Lydian-dominant sound). */
  lydianSharp11Share: number;
  /** Share of those dominants carrying a b9, #9 or b13 (the wrong, altered colour). */
  lydianAlteredShare: number;
  /** Share of secondary dominants (VI7 -> ii) with a b9, and with a stressed natural 13. */
  secDomFlat9Share: number;
  secDomNat13StressedShare: number;
  /** Share of licks with arpeggio noodling (more than six chord-tone attacks in a row within an octave). */
  noodleShare: number;
  /** Share of licks with a stepwise 16th run of more than four notes in the final bar. */
  finalSixteenthRunShare: number;
  /** Distribution of the closing note's degree over the last chord (shares sum to 1). */
  endingShares: Record<EndingDegree, number>;
  /** Anticipated notes outside the old chord's scale (m7b5, 7alt, Lydian dominant), per anticipation. */
  anticipationClashShare: number;
  /** Share of 7alt chords with thin altered colour (see LickMetrics.altThin). */
  altThinShare: number;
  /** Share of m7b5 chords stating the b5. */
  m7b5Flat5Share: number;
  /** Share of adjacent cell pairs that share their first three or last two pitches. */
  nearDuplicateShare: number;
}

export function summarize(licks: readonly Lick[]): MusicalitySummary {
  let ant = 0, rest = 0, seam = 0, guideHit = 0, guideN = 0, chgHit = 0, chgN = 0, altNat = 0, longChr = 0, nAtt = 0;
  let leap = 0, six = 0, altN = 0, altPlain = 0, fourth = 0, dotted = 0, lyd = 0, lydN = 0, endRep = 0;
  const cellUse = new Map<string, number>();
  let sdN = 0, sd9 = 0, sd13 = 0, lsN = 0, ls = 0, laN = 0, la = 0, nood = 0, f16 = 0, clash = 0, antN = 0, thinN = 0, thin = 0, flatN = 0, flat = 0, pairs = 0, dupPairs = 0;
  const endCount: Record<EndingDegree, number> = { R: 0, '3': 0, '5': 0, '7': 0, '9': 0, '6': 0, other: 0 };
  for (const l of licks) {
    const m = lickMetrics(l);
    if (m.anticipations > 0) ant++;
    if (m.startsWithRest) rest++;
    if (m.seamRepeats > 0) seam++;
    for (const g of m.dominantArrivalGuide) if (g !== null) { guideN++; if (g) guideHit++; }
    for (const g of m.changeArrivalGuide) if (g !== null) { chgN++; if (g) chgHit++; }
    altNat += m.altNaturalOnBeat;
    longChr += m.longChromaticOnBeat;
    nAtt += m.attackCount;
    if (m.bigLeaps > 0) leap++;
    six += m.sixteenths;
    for (const c of m.altColoured) { altN++; if (!c) altPlain++; }
    if (m.maj7FourthStressed > 0) fourth++;
    if (m.dottedPairs >= 2) dotted++;
    if (getProgression(l.progressionId).slots.some(s => s.fn === 'lydianDom')) { lydN++; if (m.lydianDomEleven > 0) lyd++; }
    if (m.endingRepeat) endRep++;
    for (const v of m.lydianSharp11) { lsN++; if (v) ls++; }
    for (const v of m.lydianAltered) { laN++; if (v) la++; }
    for (let k = 0; k < m.secDomFlat9.length; k++) { sdN++; if (m.secDomFlat9[k]) sd9++; if (m.secDomNat13Stressed[k]) sd13++; }
    if (m.noodleRun > 6) nood++;
    if (m.finalSixteenthRun > 4) f16++;
    endCount[m.ending]++;
    clash += m.anticipationClashes;
    antN += m.anticipations;
    for (const v of m.altThin) { thinN++; if (v) thin++; }
    for (const v of m.m7b5Flat5) { flatN++; if (v) flat++; }
    pairs += m.cellPairs;
    dupPairs += m.nearDuplicatePairs;
    for (const id of new Set(l.fragmentIds)) cellUse.set(id, (cellUse.get(id) ?? 0) + 1);
  }
  const n = Math.max(1, licks.length);
  let topCell = '';
  let top = 0;
  for (const [id, c] of cellUse) if (c > top) { top = c; topCell = id; }
  return {
    licks: licks.length,
    anticipationShare: ant / n,
    startsWithRestShare: rest / n,
    seamRepeatShare: seam / n,
    dominantGuideShare: guideN ? guideHit / guideN : 0,
    changeGuideShare: chgN ? chgHit / chgN : 0,
    altNaturalPerK: (1000 * altNat) / Math.max(1, nAtt),
    longChromaticPerK: (1000 * longChr) / Math.max(1, nAtt),
    topCellShare: top / n,
    topCell,
    bigLeapShare: leap / n,
    sixteenthShare: six / Math.max(1, nAtt),
    altPlainShare: altN ? altPlain / altN : 0,
    maj7FourthShare: fourth / n,
    dottedShare: dotted / n,
    lydianElevenShare: lydN ? lyd / lydN : 0,
    endingRepeatShare: endRep / n,
    lydianSharp11Share: lsN ? ls / lsN : 0,
    lydianAlteredShare: laN ? la / laN : 0,
    secDomFlat9Share: sdN ? sd9 / sdN : 0,
    secDomNat13StressedShare: sdN ? sd13 / sdN : 0,
    noodleShare: nood / n,
    finalSixteenthRunShare: f16 / n,
    endingShares: Object.fromEntries(ENDING_DEGREES.map(d => [d, endCount[d] / n])) as Record<EndingDegree, number>,
    anticipationClashShare: antN ? clash / antN : 0,
    altThinShare: thinN ? thin / thinN : 0,
    m7b5Flat5Share: flatN ? flat / flatN : 0,
    nearDuplicateShare: pairs ? dupPairs / pairs : 0,
  };
}

/**
 * Concept hit rate: of the licks generated with a Focus, how much of the concept do the notes deliver (detectDevices)?
 * Per lick, `hits / of` comes from conceptHits: guide tones count the chord changes with a guide-tone link, the other
 * concepts count 1 when the device occurs at all. The rate is hits over opportunities across the licks.
 */
export function conceptHitRate(licks: readonly Lick[], concept: ConceptId): { licks: number; hits: number; of: number; rate: number } {
  let hits = 0;
  let of = 0;
  for (const l of licks) {
    const h = conceptHits(l, concept);
    hits += h.hits;
    of += h.of;
  }
  return { licks: licks.length, hits, of, rate: of ? hits / of : 0 };
}

/** Mean absolute distance between the slider target a lick was generated for and the score it came out with (licks with a target only). */
export function sliderError(licks: readonly Lick[]): number {
  const t = licks.filter(l => l.targetScore !== undefined);
  return t.length ? t.reduce((a, l) => a + Math.abs(l.difficulty.score - (l.targetScore as number)), 0) / t.length : 0;
}
