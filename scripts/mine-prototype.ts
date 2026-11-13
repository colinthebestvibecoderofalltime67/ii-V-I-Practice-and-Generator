/**
 * Mines the 55 prototype licks (C, Dm7 | G7 | Cmaj7, one bar each) into chord-relative
 * fragments and writes src/fragments/lib/prototype.ts.
 *
 *   npx tsx scripts/mine-prototype.ts      (or: npm run mine)
 *
 * UNITS: fragment library files are AUTHORED in sixteenth-note units (1 = 16th, 4 = quarter); src/fragments/index.ts
 * scales them to the engine's 12-ticks-per-beat grid on load. So this script converts the prototype licks
 * (engine ticks) back to 16ths, mines in 16ths, and emits 16th-unit data. It therefore keeps its own
 * 16th-based splitDur instead of the engine's theory/rhythm.splitDur.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadPrototypeLicks } from './legacy';
import { RENDERABLE_DURS, TICKS_PER_16TH } from '../src/types';
import type { ChordQualityId, FragNote, FragTag, Fragment, Tier } from '../src/types';
import { inScale, isChordToneOrTension, isChordTone } from '../src/theory/chords';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/fragments/lib/prototype.ts');
const LEVEL: Record<string, Tier> = { Beginner: 1, Medium: 2, Advanced: 3 };
const BARS = [
  { start: 0, root: 62, prefix: 'm7', quality: 'm7' as ChordQualityId },
  { start: 16, root: 67, prefix: 'dom7', quality: 'dom7' as ChordQualityId },
  { start: 32, root: 60, prefix: 'maj7', quality: 'maj7' as ChordQualityId },
];

interface Piece { rel: number | null; dur: number; tie: boolean; cont: boolean }

/** Renderable durations in 16th units (1 2 3 4 6 8 12 16). */
const RENDERABLE_16THS = RENDERABLE_DURS.map(d => d / TICKS_PER_16TH);

/** 16th-unit split of a duration into renderable pieces (largest first). NOT the engine splitDur (that one works in ticks). */
function splitDur(d: number): number[] {
  const out: number[] = [];
  const sorted = [...RENDERABLE_16THS].sort((a, b) => b - a);
  while (d > 0) {
    const p = sorted.find(x => x <= d)!;
    out.push(p);
    d -= p;
  }
  return out;
}

/** Slice [from, to) out of a lick, relative to a root. */
function slice(notes: { midi: number | null; start: number; dur: number; tie: boolean }[], from: number, to: number, root: number): { frag: FragNote[]; startsMid: boolean } {
  const pieces: Piece[] = [];
  let startsMid = false;
  for (const n of notes) {
    const s = Math.max(n.start, from);
    const e = Math.min(n.start + n.dur, to);
    if (e <= s) continue;
    const cont = n.start < from;
    if (cont && s === from) startsMid = true;
    const crossesOut = n.start + n.dur > to;
    pieces.push({ rel: n.midi === null ? null : n.midi - root, dur: e - s, tie: n.tie && !crossesOut, cont });
  }
  const frag: FragNote[] = [];
  for (const p of pieces) {
    const parts = splitDur(p.dur);
    parts.forEach((d, i) => {
      const note: FragNote = { rel: p.rel, dur: d };
      const tied = p.rel !== null && (i < parts.length - 1 || p.tie);
      if (tied) note.tie = true;
      frag.push(note);
    });
  }
  // a trailing tie with nothing after it is invalid
  const last = frag[frag.length - 1];
  if (last) delete last.tie;
  return { frag, startsMid };
}

const sig = (notes: FragNote[], beats: number) => beats + '|' + notes.map(n => `${n.rel}:${n.dur}${n.tie ? '~' : ''}`).join(',');

function startTicks(notes: FragNote[]): { n: FragNote; t: number }[] {
  let t = 0;
  return notes.map(n => { const r = { n, t }; t += n.dur; return r; });
}

/** Strong-beat check: attacks on tick 0 / 8 must be chord tones or tensions of the quality. */
function strongOk(notes: FragNote[], q: ChordQualityId): boolean {
  return startTicks(notes).every(({ n, t }) => n.rel === null || (t !== 0 && t !== 8) || isChordToneOrTension(n.rel, 0, q));
}

/** Merged (tie-collapsed) sounding notes. */
function merged(notes: FragNote[]): { rel: number; dur: number; t: number }[] {
  const out: { rel: number; dur: number; t: number }[] = [];
  let t = 0;
  let prevTied = false;
  for (const n of notes) {
    if (n.rel !== null) {
      if (prevTied) out[out.length - 1].dur += n.dur;
      else out.push({ rel: n.rel, dur: n.dur, t });
    }
    prevTied = !!n.tie;
    t += n.dur;
  }
  return out;
}

function inferTags(notes: FragNote[], q: ChordQualityId, hasAlt: boolean): FragTag[] {
  const m = merged(notes);
  const tags = new Set<FragTag>();
  const iv = m.slice(1).map((n, i) => ({ a: m[i].rel, b: n.rel, d: Math.abs(n.rel - m[i].rel) }));
  if (iv.length) {
    const steps = iv.filter(x => x.d <= 2).length;
    const ctLeaps = iv.filter(x => x.d >= 3 && isChordTone(x.a, 0, q) && isChordTone(x.b, 0, q)).length;
    if (ctLeaps / iv.length >= 0.5) tags.add('arpeggio');
    if (steps / iv.length >= 0.6) tags.add('scale');
    if (iv.some(x => x.d === 1 && (!inScale(x.a, 0, q) || !inScale(x.b, 0, q)))) tags.add('chromatic');
  }
  // enclosure: approach from above and below a chord tone
  for (let i = 2; i < m.length; i++) {
    const [a, b, c] = [m[i - 2].rel, m[i - 1].rel, m[i].rel];
    if (isChordTone(c, 0, q) && Math.abs(a - c) <= 2 && Math.abs(b - c) <= 2 && a !== c && b !== c && Math.sign(a - c) !== Math.sign(b - c)) tags.add('enclosure');
  }
  if (hasAlt) tags.add('altered');
  if (tags.size === 0) tags.add('motif');
  return [...tags];
}

const HELD_OK = new Set([0, 2, 4, 7, 9, 11]);
function isEnding(notes: FragNote[]): boolean {
  const m = merged(notes);
  if (!m.length) return false;
  const last = m[m.length - 1];
  return last.dur >= 4 && HELD_OK.has(((last.rel % 12) + 12) % 12);
}

const out: Fragment[] = [];
const seen = new Set<string>();

// prototype licks arrive in engine ticks; mine in the library's authoring unit (16ths)
const prototypeLicks = loadPrototypeLicks().map(l => ({
  ...l,
  notes: l.notes.map(n => ({ ...n, start: n.start / TICKS_PER_16TH, dur: n.dur / TICKS_PER_16TH })),
}));

prototypeLicks.forEach((lick, li) => {
  const num = String(li + 1).padStart(2, '0');
  const level = LEVEL[lick.level];
  BARS.forEach(bar => {
    const windows = [
      { from: 0, to: 16, beats: 4 as const, suffix: '' },
      { from: 0, to: 8, beats: 2 as const, suffix: 'h1' },
      { from: 8, to: 16, beats: 2 as const, suffix: 'h2' },
    ];
    for (const w of windows) {
      const { frag, startsMid } = slice(lick.notes, bar.start + w.from, bar.start + w.to, bar.root);
      if (w.beats === 2 && startsMid) continue;
      if (!frag.some(n => n.rel !== null)) continue;
      const rels = frag.filter(n => n.rel !== null).map(n => n.rel as number);
      if (Math.max(...rels) - Math.min(...rels) > 19) continue;
      let candidates: ChordQualityId[][];
      let hasAlt = false;
      if (bar.quality === 'dom7') {
        hasAlt = rels.some(r => [1, 3, 8].includes(((r % 12) + 12) % 12));
        candidates = hasAlt ? [['dom7', 'dom7alt'], ['dom7alt'], ['dom7']] : [['dom7']];
      } else candidates = [[bar.quality]];
      // keep the first candidate set that passes the strong-beat rule for every quality in it
      const quals = candidates.find(c => c.every(q => strongOk(frag, q)));
      if (!quals) continue;
      if (hasAlt && !quals.includes('dom7alt')) hasAlt = false;
      const key = sig(frag, w.beats) + '|' + quals.join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      const ending = bar.quality === 'maj7' && isEnding(frag);
      const f: Fragment = {
        id: `${bar.prefix}-proto-${num}${w.suffix}`,
        qualities: quals,
        beats: w.beats,
        notes: frag,
        tags: inferTags(frag, quals[0], hasAlt),
        level,
        source: 'prototype',
      };
      if (ending) f.ending = true;
      out.push(f);
    }
  });
});

const fmtNote = (n: FragNote) => `{ rel: ${n.rel}, dur: ${n.dur}${n.tie ? ', tie: true' : ''} }`;
const fmt = (f: Fragment) =>
  `  { id: '${f.id}', qualities: [${f.qualities.map(q => `'${q}'`).join(', ')}], beats: ${f.beats}, notes: [${f.notes.map(fmtNote).join(', ')}], tags: [${f.tags.map(t => `'${t}'`).join(', ')}], level: ${f.level},${f.ending ? ' ending: true,' : ''} source: 'prototype' },`;

const file = `import type { Fragment } from '../../types';

/**
 * GENERATED by scripts/mine-prototype.ts (npm run mine). Do not edit by hand.
 * Fragments sliced from the legacy prototype licks (C: Dm7 | G7 | Cmaj7), relative to each chord root.
 */
export const PROTOTYPE_FRAGMENTS: Fragment[] = [
${out.map(fmt).join('\n')}
];
`;
writeFileSync(OUT, file);
console.log(`wrote ${out.length} fragments to ${OUT}`);
