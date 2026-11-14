/**
 * Musicality metrics for generated licks (pure, no DOM). Used by `npm run musicality` and by tests, so phrasing
 * and vocabulary changes are judged by numbers rather than taste. Each metric answers one question a jazz
 * player would ask of a line; see docs/ARCHITECTURE.md.
 */
import type { Lick, LickNote } from '../types';
import { TPB } from '../types';
import { CHORDS, inScale } from '../theory/chords';
import { mod12 } from '../theory/pitch';

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
  /** Natural 5th or natural 13th attacked on a beat over a 7alt chord. */
  altNaturalOnBeat: number;
  /** Non-scale (chromatic) notes attacked on a beat and held a beat or longer. */
  longChromaticOnBeat: number;
  /** Highest pitch minus lowest, in semitones. */
  span: number;
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
  return { anticipations, startsWithRest, seamRepeats, dominantArrivalGuide, altNaturalOnBeat, longChromaticOnBeat, span };
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
  /** Natural 5/13 on-beat attacks over 7alt per 1,000 attacks. */
  altNaturalPerK: number;
  longChromaticPerK: number;
  /** Share of licks containing the most-used fragment, and its id. */
  topCellShare: number;
  topCell: string;
}

export function summarize(licks: readonly Lick[]): MusicalitySummary {
  let ant = 0, rest = 0, seam = 0, guideHit = 0, guideN = 0, altNat = 0, longChr = 0, nAtt = 0;
  const cellUse = new Map<string, number>();
  for (const l of licks) {
    const m = lickMetrics(l);
    if (m.anticipations > 0) ant++;
    if (m.startsWithRest) rest++;
    if (m.seamRepeats > 0) seam++;
    for (const g of m.dominantArrivalGuide) if (g !== null) { guideN++; if (g) guideHit++; }
    altNat += m.altNaturalOnBeat;
    longChr += m.longChromaticOnBeat;
    nAtt += attacks(l.notes).length;
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
    altNaturalPerK: (1000 * altNat) / Math.max(1, nAtt),
    longChromaticPerK: (1000 * longChr) / Math.max(1, nAtt),
    topCellShare: top / n,
    topCell,
  };
}
