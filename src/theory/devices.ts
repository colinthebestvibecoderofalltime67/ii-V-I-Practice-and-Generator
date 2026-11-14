import type { ChordQualityId, ConceptId, Lick, LickChord, LickNote, Tier } from '../types';
import { TPB } from '../types';
import { CHORDS, inScale } from './chords';
import { mod12 } from './pitch';
import { judgedChord } from './rhythm';

/**
 * Improvisation devices found in the NOTES of a lick (pure, no DOM). Working from the notes means shared, imported and old
 * licks (which carry no fragment ids) are analysed exactly like freshly generated ones, and the generator can check that a
 * lick really contains the concept it was asked to practise.
 *
 * Common ground:
 *  - an "attack" is a note head with its tie chain merged (the chain is one attack from `first` to `last`);
 *  - two attacks are "contiguous" when no rest lies between them;
 *  - an attack is judged on `judgedChord` (an anticipation belongs to the chord it arrives on), `rel` = semitones above that
 *    chord's root, mod 12;
 *  - "chord tone" = CHORDS[q].tones (7alt: R, 3, b7 only), "guide tone" = CHORDS[q].guide (3rd and 7th, or 6th).
 *
 * Detectors (each returns spans of lick-note indexes `first..last`; `chord` is the judged chord of the arrival note):
 *
 *  enclosure      A chord tone T that starts on a beat or the "and" of a beat, approached by the 2 or 3 contiguous attacks
 *                 right before it (the longest match wins), each 1 or 2 semitones from T (never T itself), with at least one
 *                 approach note above AND one below T, at least one a half step from T, and consecutive approach notes
 *                 moving (no repeats) by at most a major third. (Upper + lower neighbour, or the 3-note forms
 *                 "step, half step, half step".) Span = approach..T.
 *  chromatic      A note NOT in the parent scale of its judged chord (at most a beat long) followed contiguously by an
 *                 attack a half step away that is a chord tone. Span = the approach note..the chord tone.
 *  guideTone      At a chord change, the attack sounding as the new chord starts (a held anticipation counts) is a guide tone of the
 *                 new chord, and the attack right before it (contiguous, judged on the OLD chord) is a guide tone of the old
 *                 chord at most 2 semitones away (0 allowed when it is re-attacked, e.g. 3rd of ii to 7th of V). Span =
 *                 old..new; `chord` = the new chord. One per change at most.
 *  anticipation   A tie chain attacked less than a beat before a chord change and sounding across it (what judgedChord calls an
 *                 anticipation). Span = the chain; `chord` = the chord it arrives on. The Focus "anticipate the I" needs
 *                 one whose chord is the last chord.
 *  triadPair      >= 6 contiguous attacks drawn only from two triads of the same quality (both major or both minor) whose roots
 *                 are a whole step apart (C/D, F/G, Ab/Gb ...: the classic pairs over maj7, m7, dom7 and 7alt), each triad
 *                 played >= 3 times with all 3 of its pitch classes, at least one switch from one triad to the other, and
 *                 >= half of the intervals leaps of a minor third or more (an arpeggiated line, not a scale that happens to
 *                 sit inside six pitch classes); every note of both triads (all 3 pitch classes of each) is played.
 *  sixthDim       >= 6 contiguous attacks inside one chord (maj7: rel 0 2 4 5 7 8 9 11, the Barry Harris 6th-diminished scale
 *                 = major scale + #5; m6 / mMaj7: 0 2 3 5 7 8 9 11) that use the added tone (rel 8), are mostly stepwise
 *                 (>= 60% of the intervals <= 2 semitones), start on a 6th-chord or maj7 tone and have chord tones
 *                 (R 3 5 6 7) on at least half of their on-beat attacks. Over maj7 and m6 / mMaj7 only.
 *  superimposition  Within one chord, >= 4 contiguous attacks that (a) outline a ii7-V7 a fourth apart that is not the chord's
 *                 own harmony: every pitch class belongs to m7(r) or 7(r+5), with >= 2 distinct pitch classes only in the
 *                 m7 and >= 2 only in the 7 (Gm7-C7 over C7, Bbm7-Eb7 over G7alt), or (b) outline the dominant a tritone
 *                 away (tritone substitution, over a dominant chord: >= 3 of its 4 tones, nothing else, >= 2 of them outside
 *                 the sounding chord's tones). Span = the window.
 *  sideSlip       3 to 6 contiguous attacks inside one chord that are a chord-tone figure shifted a half step up or down
 *                 (every note minus the shift is a chord tone, at least 2 are outside the chord's scale), followed by an attack
 *                 that resolves by at most a whole step onto a chord tone within the same beat. Span = figure..resolution.
 */
export type DeviceKind = 'enclosure' | 'chromatic' | 'guideTone' | 'anticipation' | 'triadPair' | 'sixthDim' | 'superimposition' | 'sideSlip';

export interface DeviceSpan {
  kind: DeviceKind;
  /** Lick note indexes (first note of the first attack .. last note of the last attack). */
  first: number;
  last: number;
  /** The chord (index into lick.chords) the device is judged on. */
  chord: number;
  /** Note index of the arrival (target) note for enclosure / chromatic / guideTone / anticipation. */
  target?: number;
}

/** Short label drawn over the bracket on the sheet. */
export const DEVICE_LABEL: Record<DeviceKind, string> = {
  enclosure: 'encl.',
  chromatic: 'chrom.',
  guideTone: 'GT',
  anticipation: 'antic.',
  triadPair: 'triad pair',
  sixthDim: '6th dim',
  superimposition: 'super.',
  sideSlip: 'side-slip',
};

/** Long name for the Analysis panel. */
export const DEVICE_NAME: Record<DeviceKind, string> = {
  enclosure: 'Enclosure',
  chromatic: 'Chromatic approach',
  guideTone: 'Guide-tone line',
  anticipation: 'Anticipation',
  triadPair: 'Triad pair',
  sixthDim: '6th-diminished line',
  superimposition: 'Superimposition',
  sideSlip: 'Side-slip',
};

/** The Focus concepts, in menu order. */
export const CONCEPTS: readonly ConceptId[] = ['guideTones', 'enclosures', 'chromaticApproach', 'anticipateI', 'triadPairs', 'sixthDim', 'superimposition'];

export const CONCEPT_NAME: Record<ConceptId, string> = {
  guideTones: 'Guide tones',
  enclosures: 'Enclosures',
  chromaticApproach: 'Chromatic approaches',
  anticipateI: 'Anticipate the I',
  triadPairs: 'Triad pairs',
  sixthDim: 'Barry Harris 6th-dim',
  superimposition: 'Superimposition / side-slip',
};

/** Lower-case form for the meta line ("Focus: enclosures"). */
export const CONCEPT_SHORT: Record<ConceptId, string> = {
  guideTones: 'guide tones',
  enclosures: 'enclosures',
  chromaticApproach: 'chromatic approaches',
  anticipateI: 'anticipate the I',
  triadPairs: 'triad pairs',
  sixthDim: '6th-dim',
  superimposition: 'superimposition',
};

/** One line under the Focus menu. */
export const CONCEPT_DESC: Record<ConceptId, string> = {
  guideTones: 'Land on the 3rd or 7th of each new chord, one step from the last chord’s guide tone.',
  enclosures: 'Circle a chord tone from above and below, then land on it.',
  chromaticApproach: 'Slide into chord tones by a half step from outside the scale.',
  anticipateI: 'Play the first note of the final tonic an eighth early, tied over the bar line.',
  triadPairs: 'Alternate two triads a whole step apart for a modern, open sound.',
  sixthDim: 'Run the major 6th scale with the added half step; chord tones fall on the beats.',
  superimposition: 'Outline a different ii–V (or slip a half step off the chord) and resolve.',
};

/** Lowest tier that offers a concept: Beginner+ for the first four, Advanced+ for the rest. */
export const CONCEPT_MIN_TIER: Record<ConceptId, Tier> = {
  guideTones: 1, enclosures: 1, chromaticApproach: 1, anticipateI: 1, triadPairs: 3, sixthDim: 3, superimposition: 3,
};

export const conceptAllowed = (c: ConceptId, tier: Tier): boolean => tier >= CONCEPT_MIN_TIER[c];

export const isConceptId = (v: unknown): v is ConceptId => typeof v === 'string' && (CONCEPTS as readonly string[]).includes(v);

/** Device kinds that count as a hit for each concept (anticipateI and guideTones have extra conditions, see conceptHits). */
const CONCEPT_KINDS: Record<ConceptId, DeviceKind[]> = {
  guideTones: ['guideTone'],
  enclosures: ['enclosure'],
  chromaticApproach: ['chromatic'],
  anticipateI: ['anticipation'],
  triadPairs: ['triadPair'],
  sixthDim: ['sixthDim'],
  superimposition: ['superimposition', 'sideSlip'],
};

/* ------------------------------------------------------------------ attacks */

interface Att {
  first: number;
  last: number;
  midi: number;
  start: number;
  end: number;
  /** judged chord (anticipations count on the chord they arrive on) */
  chord: number;
  own: number;
  /** semitones above the judged chord's root, mod 12 */
  rel: number;
}

type NoteLike = Pick<LickNote, 'midi' | 'start' | 'dur' | 'tie' | 'chord'>;

function attacksOf(notes: readonly NoteLike[], chords: readonly LickChord[]): Att[] {
  const out: Att[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.midi == null) continue;
    const prev = notes[i - 1];
    if (prev && prev.tie && prev.midi === n.midi) { const a = out[out.length - 1]; a.last = i; a.end = n.start + n.dur; continue; }
    const chord = judgedChord(notes, i);
    out.push({ first: i, last: i, midi: n.midi, start: n.start, end: n.start + n.dur, chord, own: n.chord, rel: mod12(n.midi - chords[chord].rootPc) });
  }
  return out;
}

const contiguous = (a: Att, b: Att): boolean => a.end === b.start;
const isTone = (q: ChordQualityId, rel: number): boolean => CHORDS[q].tones.some(t => mod12(t) === rel);
const isGuide = (q: ChordQualityId, rel: number): boolean => CHORDS[q].guide.some(g => mod12(g) === rel);

/* ------------------------------------------------------------------ detectors */

/** Accent of an attack: 1 on the bar downbeat, 0 elsewhere (an approach note must not be accented over its target). */
const strength = (start: number): number => (start % (4 * TPB) === 0 ? 1 : 0);

function enclosures(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (let t = 2; t < att.length; t++) {
    const T = att[t];
    const off = T.start % TPB;
    if ((off !== 0 && off !== TPB / 2) || !isTone(chords[T.chord].quality, T.rel)) continue;
    const tq = chords[T.chord].quality;
    const ts = strength(T.start);
    for (const k of [3, 2]) {
      if (t - k < 0) continue;
      let ok = true;
      let up = false;
      let down = false;
      let half = false;
      let outside = false;
      for (let j = t - k; j < t && ok; j++) {
        const d = att[j].midi - T.midi;
        const ad = Math.abs(d);
        if (ad < 1 || ad > 2) { ok = false; break; }
        // an approach note belongs to the target's chord, does not open a chord and is not accented over the target
        if (att[j].chord !== T.chord || att[j].own !== T.chord || chords.some(c => c.start === att[j].start) || strength(att[j].start) > ts) { ok = false; break; }
        if (!isTone(tq, att[j].rel)) outside = true;
        if (d > 0) up = true; else down = true;
        if (ad === 1) half = true;
        if (!contiguous(att[j], att[j + 1])) ok = false;
        if (j > t - k) { const iv = Math.abs(att[j].midi - att[j - 1].midi); if (iv < 1 || iv > 4) ok = false; }
      }
      if (ok && up && down && half && outside) {
        out.push({ kind: 'enclosure', first: att[t - k].first, last: T.last, chord: T.chord, target: T.first });
        break;
      }
    }
  }
}

function chromatics(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (let i = 0; i + 1 < att.length; i++) {
    const a = att[i];
    const b = att[i + 1];
    if (!contiguous(a, b) || Math.abs(b.midi - a.midi) !== 1) continue;
    if (a.end - a.start > TPB) continue;
    const ca = chords[a.chord];
    if (inScale(a.midi, ca.rootPc, ca.quality) || !isTone(chords[b.chord].quality, b.rel)) continue;
    out.push({ kind: 'chromatic', first: a.first, last: b.last, chord: b.chord, target: b.first });
  }
}

function guideTones(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (let c = 1; c < chords.length; c++) {
    const t = chords[c].start;
    const bi = att.findIndex(a => a.start <= t && a.end > t && a.chord === c);
    if (bi < 1) continue;
    const B = att[bi];
    const A = att[bi - 1];
    if (A.chord !== c - 1 || !contiguous(A, B)) continue;
    if (!isGuide(chords[c].quality, B.rel) || !isGuide(chords[c - 1].quality, A.rel)) continue;
    if (Math.abs(B.midi - A.midi) > 2) continue;
    out.push({ kind: 'guideTone', first: A.first, last: B.last, chord: c, target: B.first });
  }
}

function anticipations(att: Att[], out: DeviceSpan[]): void {
  for (const a of att) {
    if (a.chord !== a.own) out.push({ kind: 'anticipation', first: a.first, last: a.last, chord: a.chord, target: a.first });
  }
}

/** Split attacks into runs with no rest between them. */
function runsOf(att: Att[]): Att[][] {
  const runs: Att[][] = [];
  let cur: Att[] = [];
  for (const a of att) {
    if (cur.length && !contiguous(cur[cur.length - 1], a)) { runs.push(cur); cur = []; }
    cur.push(a);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

const triad = (root: number, minor: boolean): number[] => [mod12(root), mod12(root + (minor ? 3 : 4)), mod12(root + 7)];

/** Split attacks into contiguous runs inside one judged chord (triad pairs, 6th-diminished lines and superimpositions live inside one chord). */
function chordRuns(att: Att[]): Att[][] {
  const out: Att[][] = [];
  for (const run of runsOf(att)) {
    let cur: Att[] = [];
    for (const a of run) {
      if (cur.length && cur[0].chord !== a.chord) { out.push(cur); cur = []; }
      cur.push(a);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Number of distinct pitch classes of a window that are not in a set of chord-relative pitch classes. */
const outsideOf = (w: Att[], inside: (rel: number) => boolean): number => new Set(w.filter(a => !inside(a.rel)).map(a => a.rel)).size;

function triadPairs(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (const seg of chordRuns(att)) {
    if (seg.length < 6) continue;
    const q = chords[seg[0].chord].quality;
    const cands: { s: number; e: number; score: number }[] = [];
    // major and minor pairs are judged together: the best (longest) window wins where they overlap
    for (const minor of [false, true]) {
      for (let r = 0; r < 12; r++) {
        const A = triad(r, minor);
        const B = triad(r + 2, minor);
        const which = (pc: number): 0 | 1 | -1 => (A.includes(pc) ? 0 : B.includes(pc) ? 1 : -1);
        let s = 0;
        while (s < seg.length) {
          if (which(mod12(seg[s].midi)) < 0) { s++; continue; }
          let e = s;
          while (e + 1 < seg.length && which(mod12(seg[e + 1].midi)) >= 0) e++;
          const w = seg.slice(s, e + 1);
          if (w.length >= 6) {
            const cnt = [0, 0];
            const pcs: Set<number>[] = [new Set(), new Set()];
            let switches = 0;
            let leaps = 0;
            let big = 0;
            w.forEach((a, i) => {
              const g = which(mod12(a.midi)) as 0 | 1;
              cnt[g]++;
              pcs[g].add(mod12(a.midi));
              if (i > 0) {
                if (which(mod12(w[i - 1].midi)) !== g) switches++;
                const iv = Math.abs(a.midi - w[i - 1].midi);
                if (iv >= 3) leaps++;
                if (iv >= 4) big++;
              }
            });
            const fast = w.filter(a => a.end - a.start <= TPB / 2).length;
            // not a scale that happens to sit in six pitch classes: >= 2 pitch classes beyond the chord tones and the 9th
            const outside = outsideOf(w, rel => isTone(q, rel) || rel === 2);
            if (cnt[0] >= 3 && cnt[1] >= 3 && pcs[0].size === 3 && pcs[1].size === 3 && switches >= 1 && leaps >= 0.65 * (w.length - 1) && big >= 2 && fast >= 0.75 * w.length && outside >= 2) {
              cands.push({ s: seg[s].first, e: seg[e].last, score: w.length * 100 + leaps });
            }
          }
          s = e + 1;
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const kept: { s: number; e: number }[] = [];
    for (const c of cands) {
      if (kept.some(k => c.s <= k.e && c.e >= k.s)) continue;
      kept.push(c);
      out.push({ kind: 'triadPair', first: c.s, last: c.e, chord: seg[0].chord });
    }
  }
}

const SIXTH_DIM_MAJ = [0, 2, 4, 5, 7, 8, 9, 11];
const SIXTH_DIM_MIN = [0, 2, 3, 5, 7, 8, 9, 11];

/** b follows a by one degree of the 8-note scale (no degree skipped), whatever the direction. */
function scaleStep(scale: readonly number[], a: Att, b: Att): boolean {
  const d = b.midi - a.midi;
  if (d === 0 || Math.abs(d) > 2) return false;
  const ia = scale.indexOf(a.rel);
  const ib = scale.indexOf(b.rel);
  if (ia < 0 || ib < 0) return false;
  return (((ib - ia) % 8) + 8) % 8 === (d > 0 ? 1 : 7);
}

function sixthDims(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (const seg of chordRuns(att)) {
    const q = chords[seg[0].chord].quality;
    const scale = q === 'maj7' ? SIXTH_DIM_MAJ : q === 'm6' || q === 'mMaj7' ? SIXTH_DIM_MIN : null;
    if (!scale) continue;
    const sixth = q === 'maj7' ? [0, 4, 7, 9] : [0, 3, 7, 9]; // R 3 5 6: the 6th chord, which sits on the beats
    let s = 0;
    while (s < seg.length) {
      if (!scale.includes(seg[s].rel)) { s++; continue; }
      let e = s;
      while (e + 1 < seg.length && scaleStep(scale, seg[e], seg[e + 1])) e++;
      const w = seg.slice(s, e + 1);
      if (w.length >= 6 && w.some(a => a.rel === 8) && w.some(a => a.rel === 9)) {
        const beats = w.filter(a => a.start % TPB === 0);
        const good = beats.filter(a => sixth.includes(a.rel)).length;
        const maj7s = beats.filter(a => a.rel === 11).length;
        if (beats.length >= 2 && good >= 0.75 * beats.length && maj7s <= 1) {
          out.push({ kind: 'sixthDim', first: w[0].first, last: w[w.length - 1].last, chord: w[0].chord });
        }
      }
      s = e + 1;
    }
  }
}

const pcsOf = (root: number, tones: number[]): Set<number> => new Set(tones.map(t => mod12(root + t)));
const M7 = [0, 3, 7, 10];
const D7 = [0, 4, 7, 10];

function superimpositions(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  const taken = new Set<number>();
  for (const seg of chordRuns(att)) {
    if (seg.length < 4) continue;
    const ch = chords[seg[0].chord];
    const mark = (w: Att[]): void => {
      out.push({ kind: 'superimposition', first: w[0].first, last: w[w.length - 1].last, chord: w[0].chord });
      for (const a of w) taken.add(a.first);
    };
    // genuinely outside: at least 2 pitch classes beyond the chord's parent scale
    const outsideScale = (w: Att[]): boolean => outsideOf(w, rel => CHORDS[ch.quality].scale.some(t => mod12(t) === rel)) >= 2;
    // (a) a ii-V a fourth apart: the m7 first, then the 7. Not the chord's own ii-V (Gm7-C7 over C7, Dm7-G7 over Cmaj7) nor the
    // m7 a fifth above the root (an upper structure: Gm7 over C7, Am7 over Dm7).
    for (let r = 0; r < 12; r++) {
      if (r === ch.rootPc || r === mod12(ch.rootPc + 7) || (ch.quality === 'maj7' && r === mod12(ch.rootPc + 2))) continue;
      const ii = pcsOf(r, M7);
      const v = pcsOf(r + 5, D7);
      const pc = (i: number): number => mod12(seg[i].midi);
      for (let k = 2; k + 2 <= seg.length; k++) {
        let s = k;
        while (s > 0 && ii.has(pc(s - 1))) s--;
        let e = k - 1;
        while (e + 1 < seg.length && v.has(pc(e + 1))) e++;
        if (k - s < 2 || e - k + 1 < 2 || seg.slice(s, e + 1).some(a => taken.has(a.first))) continue;
        const L = new Set(seg.slice(s, k).map(a => mod12(a.midi)));
        const R = new Set(seg.slice(k, e + 1).map(a => mod12(a.midi)));
        const iiOnly = [...L].filter(p => !v.has(p)).length;
        const vOnly = [...R].filter(p => !ii.has(p)).length;
        const w = seg.slice(s, e + 1);
        const leaps = w.slice(1).filter((a, i) => Math.abs(a.midi - w[i].midi) >= 3).length;
        if (L.size >= 3 && R.size >= 3 && iiOnly >= 2 && vOnly >= 2 && leaps >= (w.length - 1) / 2 && outsideScale(w)) { mark(w); break; }
      }
    }
    // (b) the dominant a tritone away, over a dominant chord
    if (ch.quality === 'dom7' || ch.quality === 'dom7alt') {
      const sub = pcsOf(ch.rootPc + 6, D7);
      let s = 0;
      while (s < seg.length) {
        if (!sub.has(mod12(seg[s].midi))) { s++; continue; }
        let e = s;
        while (e + 1 < seg.length && sub.has(mod12(seg[e + 1].midi))) e++;
        const w = seg.slice(s, e + 1);
        if (w.length >= 4 && !w.some(a => taken.has(a.first))) {
          const used = new Set(w.map(a => mod12(a.midi)));
          const outside = [...used].filter(p => !isTone(ch.quality, mod12(p - ch.rootPc))).length;
          if (used.size >= 3 && outside >= 2 && outsideScale(w)) mark(w);
        }
        s = e + 1;
      }
    }
  }
}

function sideSlips(att: Att[], chords: readonly LickChord[], out: DeviceSpan[]): void {
  for (let i = 0; i < att.length; i++) {
    for (let len = 6; len >= 3; len--) {
      const j = i + len; // the resolution
      if (j >= att.length) continue;
      const w = att.slice(i, j);
      const R = att[j];
      if (w.some((a, k) => a.chord !== w[0].chord || (k > 0 && !contiguous(w[k - 1], a)))) continue;
      if (!contiguous(w[w.length - 1], R) || R.chord !== w[0].chord) continue;
      const ch = chords[w[0].chord];
      if (!isTone(ch.quality, R.rel) || Math.abs(R.midi - w[w.length - 1].midi) > 2) continue;
      const outside = w.filter(a => !inScale(a.midi, ch.rootPc, ch.quality)).length;
      if (outside < 2) continue;
      // the figure is a chord-tone figure shifted a half step
      const shifted = [1, -1].some(sh => w.every(a => isTone(ch.quality, mod12(a.rel - sh))));
      if (!shifted) continue;
      out.push({ kind: 'sideSlip', first: w[0].first, last: R.last, chord: R.chord });
      i = j - 1; // do not overlap
      break;
    }
  }
}

/* ------------------------------------------------------------------ API */

/**
 * All devices found in a lick, sorted by first note. `kinds` restricts the work to those detectors (the generator asks for the
 * one it needs). Pure: works on notes and chords only.
 */
export function detectDevices(lick: Pick<Lick, 'notes' | 'chords'>, kinds?: readonly DeviceKind[]): DeviceSpan[] {
  const want = (k: DeviceKind): boolean => !kinds || kinds.includes(k);
  const { notes, chords } = lick;
  const att = attacksOf(notes, chords);
  const out: DeviceSpan[] = [];
  if (want('enclosure')) enclosures(att, chords, out);
  if (want('chromatic')) chromatics(att, chords, out);
  if (want('guideTone')) guideTones(att, chords, out);
  if (want('anticipation')) anticipations(att, out);
  if (want('triadPair')) triadPairs(att, chords, out);
  if (want('sixthDim')) sixthDims(att, chords, out);
  if (want('superimposition')) superimpositions(att, chords, out);
  if (want('sideSlip')) sideSlips(att, chords, out);
  return out.sort((a, b) => a.first - b.first || b.last - a.last);
}

/**
 * Devices for display (brackets and the Analysis list): a chromatic approach that is part of an enclosure, and a
 * side-slip inside a superimposition window, are not shown twice.
 */
export function displayDevices(devs: readonly DeviceSpan[]): DeviceSpan[] {
  const inside = (a: DeviceSpan, b: DeviceSpan): boolean => a !== b && a.first >= b.first && a.last <= b.last;
  return devs.filter(d => {
    if (d.kind === 'chromatic') return !devs.some(e => (e.kind === 'enclosure' || e.kind === 'sixthDim') && inside(d, e));
    if (d.kind === 'sideSlip') return !devs.some(e => e.kind === 'superimposition' && inside(d, e));
    return true;
  });
}

/**
 * How well a lick delivers a Focus concept, as hits / opportunities: guideTones = chord changes with a guide-tone link (of
 * chords.length - 1); anticipateI = 1 when the last chord is anticipated; the others = 1 when the device occurs at least once.
 */
export function conceptHits(lick: Pick<Lick, 'notes' | 'chords'>, concept: ConceptId): { hits: number; of: number } {
  const devs = detectDevices(lick, CONCEPT_KINDS[concept]);
  if (concept === 'guideTones') return { hits: new Set(devs.map(d => d.chord)).size, of: lick.chords.length - 1 };
  if (concept === 'anticipateI') return { hits: devs.some(d => d.chord === lick.chords.length - 1) ? 1 : 0, of: 1 };
  return { hits: devs.length ? 1 : 0, of: 1 };
}

export const conceptKinds = (concept: ConceptId): readonly DeviceKind[] => CONCEPT_KINDS[concept];
