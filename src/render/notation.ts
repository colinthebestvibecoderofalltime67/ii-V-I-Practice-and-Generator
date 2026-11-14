import {
  Accidental, Barline, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote,
  StaveTie, TabNote, TabStave, Tuplet, Voice,
} from 'vexflow';
import type { Instrument, Lick } from '../types';
import { TPBAR } from '../types';
import { barOf, findTupletGroups, isTupletDur, splitDur, tupletDisplayDur, type TupletKind } from '../theory/rhythm';
import { CHORDS } from '../theory/chords';
import { chordRootName, keySignatureName, keyUsesSharps, mod12, vexKey } from '../theory/pitch';
import { type FingeredNote, lickFingerings, pickFingering, roman } from './tab';

export interface NoteLabel { text: string; color?: string }

export interface RenderOptions {
  highlight?: number[];
  showTab?: boolean;
  print?: boolean;
  /** Tab fingering: 'auto' (easiest) or an index into positionsForLick / lickFingerings().positions. */
  tabPosition?: 'auto' | number;
  /** Show a suggested finger above every fretted tab note (otherwise only where the hand shifts). */
  showFingers?: boolean;
  /**
   * Optional text label per lick note (index into lick.notes; null/undefined = none), drawn in a row under the
   * standard staff. Used by Analyze for chord degrees. (Implementation: see notation renderer.)
   */
  noteLabels?: (NoteLabel | null | undefined)[];
  /** Colour for highlighted (now-playing) notes. Default: burnt orange. */
  highlightColor?: string;
  /** Chord-symbol font. Default: Georgia bold. */
  chordFont?: { family: string; weight?: string };
  /** Roman numeral per lick.chords entry, drawn small and grey after each chord symbol. */
  romans?: string[];
  /** Bar index (0-based) to tint as "now playing"; ignored in print mode. */
  activeBar?: number;
  /** Fill for the active-bar tint. Default: a faint blue. */
  activeBarColor?: string;
}

const DEFAULT_HL = '#b4531a';
const CHORD_FONT = "Georgia, 'Times New Roman', serif";
const CHORD_SIZE = 19;
const ROMAN_FONT = "'Geist Mono', ui-monospace, monospace";
const ROMAN_SIZE = 12;
const DUR_NAME: Record<number, [string, number]> = {
  3: ['16', 0], 6: ['8', 0], 9: ['8', 1], 12: ['q', 0], 18: ['q', 1], 24: ['h', 0], 36: ['h', 1], 48: ['w', 0],
};
const MAX_BARS_PER_LINE = 4;
const MARGIN = 10;

/** Tuplet membership of a piece (index of the group within its bar). */
export interface PieceTup { group: number; kind: TupletKind }

/** One drawable note/rest (a lick note may become several tied pieces). */
export interface Piece {
  noteIdx: number;
  start: number;
  /** Real duration in ticks (triplet notes keep their 2/4/8-tick value). */
  dur: number;
  /** Written duration in ticks (differs from dur only inside triplet groups). */
  disp: number;
  tup?: PieceTup;
  midi: number | null; // written
  tieNext: boolean;
  cont: boolean; // continuation of a tied chain (tab shows only the first)
}

interface TupGroup { kind: TupletKind; idx: number[] }

interface Bar {
  pieces: Piece[];
  notes: StaveNote[];
  tabNotes: StaveNote[];
  groups: TupGroup[];
  tuplets: Tuplet[];
  tabTuplets: Tuplet[];
  voice: Voice;
  tabVoice?: Voice;
  formatter: Formatter;
  minW: number;
  chordIdx: number[]; // lick.chords indices starting in this bar
  chordPiece: number[]; // piece index per chordIdx (-1 if none)
}

/** Split a lick into per-bar drawable pieces (pure; exported for tests). Triplet notes are never split or tied. */
export function buildPieces(lick: Lick, transpose: number, nBars: number): Piece[][] {
  const bars: Piece[][] = Array.from({ length: nBars }, () => []);
  const notes = lick.notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.start - b.n.start);
  for (const { n, i } of notes) {
    const midi = n.midi == null ? null : n.midi + transpose;
    let pos = n.start;
    const end = n.start + n.dur;
    const segs: { start: number; dur: number }[] = [];
    if (isTupletDur(n.dur)) segs.push({ start: pos, dur: n.dur });
    else {
      while (pos < end) {
        const barEnd = (barOf(pos) + 1) * TPBAR;
        const segEnd = Math.min(end, barEnd);
        let p = pos;
        for (const d of splitDur(segEnd - pos)) {
          segs.push({ start: p, dur: d });
          p += d;
        }
        pos = segEnd;
      }
    }
    segs.forEach((s, k) => {
      const bar = barOf(s.start);
      if (bar >= nBars) return;
      const isLast = k === segs.length - 1;
      bars[bar].push({
        noteIdx: i, start: s.start, dur: s.dur, disp: s.dur, midi,
        tieNext: midi != null && (isLast ? !!n.tie : true),
        cont: false,
      });
    });
  }
  // mark continuations & fill gaps with rests (defensive)
  const flat: Piece[] = [];
  const rest = (t: number, d: number): Piece => ({ noteIdx: -1, start: t, dur: d, disp: d, midi: null, tieNext: false, cont: false });
  const fillGap = (filled: Piece[], t: number, to: number): number => {
    const gap = to - t;
    for (const d of isTupletDur(gap) ? [gap] : splitDur(gap)) { filled.push(rest(t, d)); t += d; }
    return t;
  };
  bars.forEach((pcs, b) => {
    let t = b * TPBAR;
    const filled: Piece[] = [];
    for (const p of pcs) {
      if (p.start > t) t = fillGap(filled, t, p.start);
      filled.push(p);
      t = Math.max(t, p.start + p.dur);
    }
    if (t < (b + 1) * TPBAR) fillGap(filled, t, (b + 1) * TPBAR);
    // triplet groups: written duration + group membership
    const { groups } = findTupletGroups(filled);
    groups.forEach((g, gi) => {
      for (let k = g.first; k <= g.last; k++) {
        filled[k].disp = tupletDisplayDur(filled[k].dur);
        filled[k].tup = { group: gi, kind: g.kind };
        filled[k].tieNext = false;
      }
    });
    bars[b] = filled;
    flat.push(...filled);
  });
  for (let i = 1; i < flat.length; i++) {
    if (flat[i - 1].tieNext && flat[i].midi != null && flat[i].midi === flat[i - 1].midi) flat[i].cont = true;
    else if (flat[i - 1].tieNext) flat[i - 1].tieNext = false; // tie to a different pitch: drop it
  }
  if (flat.length) flat[flat.length - 1].tieNext = false;
  return bars;
}

function makeNote(p: Piece, clef: 'treble' | 'bass', sharps: boolean): StaveNote {
  const [d, dots] = DUR_NAME[p.disp] ?? ['q', 0];
  let n: StaveNote;
  if (p.midi == null) {
    n = new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: d + 'd'.repeat(dots) + 'r', clef });
  } else {
    n = new StaveNote({ keys: [vexKey(p.midi, sharps)], duration: d + 'd'.repeat(dots), clef, auto_stem: true });
  }
  if (dots) Dot.buildAndAttach([n], { all: true });
  return n;
}

/**
 * Full-tab note ("Tab. full"): stems down. Notes are TabNotes with stems (tied continuations keep the stem but
 * show no fret number); rests are ordinary rest StaveNotes drawn on the tab staff (GhostNote draws nothing).
 */
function makeTabNote(p: Piece, pos: FingeredNote | null): StaveNote {
  const [d, dots] = DUR_NAME[p.disp] ?? ['q', 0];
  let n: StaveNote;
  if (p.midi == null) {
    n = new StaveNote({ keys: ['b/4'], duration: d + 'd'.repeat(dots) + 'r', clef: 'treble' });
    if (dots) Dot.buildAndAttach([n], { all: true });
    return n;
  }
  // A pitched note must never turn into a rest: with no fret (out of the instrument's range) mark it '?'.
  if (!pos && !p.cont && import.meta.env?.DEV) console.warn('tab: no fret for pitched note', p.midi);
  const t = new TabNote({ positions: [{ str: pos ? pos.str : 1, fret: p.cont ? '' : pos ? pos.fret : '?' }], duration: d + 'd'.repeat(dots) }, true);
  t.setStemDirection(-1);
  return t as unknown as StaveNote;
}

/**
 * Augmentation dots on full-tab notes. VexFlow's TabNote dots land unreliably (often hidden by the tab lines),
 * so draw them by hand: just right of the stem, in the gap between the tab staff and the beams.
 */
function drawTabDots(ctx: ReturnType<Renderer['getContext']>, notes: StaveNote[], pcs: Piece[], color: string): void {
  notes.forEach((n, i) => {
    if (n.isRest() || !(DUR_NAME[pcs[i].disp]?.[1] > 0)) return;
    const tn = n as unknown as TabNote;
    let ext: { topY: number; baseY: number };
    try { ext = tn.getStemExtents(); } catch { return; }
    const x = tn.getStemX() + 5;
    const y = Math.min(ext.topY, ext.baseY) + 7;
    ctx.save();
    ctx.setFillStyle(color);
    ctx.beginPath();
    ctx.arc(x, y, 1.7, 0, Math.PI * 2, false);
    ctx.fill();
    ctx.restore();
  });
}

/** Beams for one bar: triplet groups beam as their own unit; the rest beams per beat and never joins a triplet. */
function makeBeams(notes: StaveNote[], pcs: Piece[], groups: TupGroup[]): Beam[] {
  const opt = { groups: [new Fraction(1, 4)], beam_rests: false };
  if (!groups.length) return Beam.generateBeams(notes, opt);
  const beams: Beam[] = [];
  for (const g of groups) {
    if (g.kind !== 'tq') beams.push(...Beam.generateBeams(g.idx.map(k => notes[k]), opt));
  }
  let seg: StaveNote[] = [];
  let segBeat = -1;
  const flush = (): void => { if (seg.length > 1) beams.push(...Beam.generateBeams(seg, opt)); seg = []; };
  pcs.forEach((p, k) => {
    const beat = Math.floor((p.start % TPBAR) / 12);
    if (p.tup || beat !== segBeat) { flush(); segBeat = beat; }
    if (!p.tup) seg.push(notes[k]);
  });
  flush();
  return beams;
}

function errorDiv(container: HTMLElement, err: unknown): null {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'err';
  div.textContent = 'Could not draw this lick: ' + String((err as Error)?.message ?? err);
  container.appendChild(div);
  return null;
}

export function renderLick(
  container: HTMLElement,
  lick: Lick,
  inst: Instrument,
  opts: RenderOptions = {},
): SVGSVGElement | null {
  container.innerHTML = '';
  try {
    return doRender(container, lick, inst, opts);
  } catch (err) {
    return errorDiv(container, err);
  }
}

function doRender(container: HTMLElement, lick: Lick, inst: Instrument, opts: RenderOptions): SVGSVGElement {
  const print = !!opts.print;
  const hl = new Set(print ? [] : opts.highlight ?? []);
  const HL = opts.highlightColor ?? DEFAULT_HL;
  const chordFamily = opts.chordFont?.family ?? CHORD_FONT;
  const chordWeight = opts.chordFont?.weight ?? 'bold';
  const romans = opts.romans && opts.romans.length === lick.chords.length ? opts.romans : null;
  const activeBar = print ? -1 : opts.activeBar ?? -1;
  const clef = inst.clef;
  const writtenKey = mod12(lick.keyPc + inst.transpose);
  const sharps = keyUsesSharps(writtenKey, lick.mode);
  const keySig = keySignatureName(writtenKey, lick.mode);
  const nBars = Math.max(1, Math.ceil(lick.totalTicks / TPBAR));
  const showTab = !!(opts.showTab && inst.tab);
  const tab = inst.tab;

  // ---------- phase 1: notes, voices, minimum widths ----------
  const pieceBars = buildPieces(lick, inst.transpose, nBars);
  const flatPieces = pieceBars.flat();
  let firstLabel = '';
  let firstPos = -1;
  const tabPos = showTab && tab
    ? (() => {
        // fingering is computed per tied chain (lickLine); the first piece of each chain carries it
        const fing = lickFingerings(lick, inst);
        const m = new Map<number, FingeredNote | null>();
        if (!fing) return m;
        const chosen = pickFingering(fing, opts.tabPosition);
        firstLabel = chosen.label;
        firstPos = chosen.position;
        const byStart = new Map<number, FingeredNote>();
        fing.line.forEach((n, i) => { const f = chosen.notes[i]; if (f && n.midi != null) byStart.set(n.start!, f); });
        flatPieces.forEach((p, i) => { if (p.midi != null && !p.cont) m.set(i, byStart.get(p.start) ?? null); });
        return m;
      })()
    : null;
  // where to print a position label / finger number above the tab
  const tabMarks = new Map<number, { label?: string; finger?: number }>();
  if (tabPos) {
    let first = true;
    for (const [i, f] of [...tabPos].sort((a, b) => a[0] - b[0])) {
      if (!f || f.fret === 0) continue;
      const mark: { label?: string; finger?: number } = {};
      if (first || f.shift) {
        // name the opening position as the position menu does ("Open pos.", "Pos. V")
        mark.label = first && (f.pos === firstPos || (firstLabel === 'Open pos.' && f.pos <= 1)) ? firstLabel : `Pos. ${roman(f.pos)}`;
        mark.finger = f.finger;
      }
      if (opts.showFingers) mark.finger = f.finger;
      if (mark.label || mark.finger) tabMarks.set(i, mark);
      first = false;
    }
  }

  let pi = 0;
  let headPos: FingeredNote | null = null; // fingering of the current tied chain (tab shows stems on continuations)
  const hasTuplets = flatPieces.some(p => p.tup);
  const labels = opts.noteLabels ?? [];
  const hasLabels = labels.some(l => l && l.text);
  const bars: Bar[] = pieceBars.map((pcs, b) => {
    const notes = pcs.map(p => makeNote(p, clef, sharps));
    pcs.forEach((p, k) => {
      if (hl.has(p.noteIdx)) notes[k].setStyle({ fillStyle: HL, strokeStyle: HL });
    });
    const groups: TupGroup[] = [];
    pcs.forEach((p, k) => {
      if (!p.tup) return;
      (groups[p.tup.group] ??= { kind: p.tup.kind, idx: [] }).idx.push(k);
    });
    const mkTuplet = (ns: StaveNote[], g: TupGroup, bottom: boolean): Tuplet => {
      const items = g.idx.map(k => ns[k]);
      // beamed 8th/16th groups (no rests, nothing longer than an 8th written) show only the "3"
      const beamed = g.kind !== 'tq' && g.idx.every(k => pcs[k].midi != null && pcs[k].disp <= 6);
      return new Tuplet(items, {
        num_notes: 3, notes_occupied: 2, bracketed: !beamed, ratioed: false,
        location: bottom ? Tuplet.LOCATION_BOTTOM : Tuplet.LOCATION_TOP,
      });
    };
    const tuplets = groups.map(g => mkTuplet(notes, g, false));
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(notes);
    Accidental.applyAccidentals([voice], keySig);
    const formatter = new Formatter().joinVoices([voice]);
    let tabNotes: StaveNote[] = [];
    let tabTuplets: Tuplet[] = [];
    let tabVoice: Voice | undefined;
    const base = pi;
    if (showTab) {
      tabNotes = pcs.map((p, k) => {
        const own = tabPos?.get(base + k) ?? null;
        if (p.midi == null) headPos = null;
        else if (!p.cont) headPos = own;
        const tn = makeTabNote(p, p.midi == null ? null : p.cont ? headPos : own);
        if (hl.has(p.noteIdx)) tn.setStyle({ fillStyle: HL, strokeStyle: HL });
        return tn;
      });
      tabTuplets = groups.map(g => mkTuplet(tabNotes, g, true));
      tabVoice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(tabNotes);
      formatter.joinVoices([tabVoice]);
    }
    pi += pcs.length;
    const chordIdx: number[] = [];
    const chordPiece: number[] = [];
    lick.chords.forEach((c, ci) => {
      if (barOf(c.start) !== b) return;
      chordIdx.push(ci);
      let k = pcs.findIndex(p => p.start === c.start);
      if (k < 0) k = pcs.findIndex(p => p.start >= c.start);
      chordPiece.push(k);
    });
    const minW = formatter.preCalculateMinTotalWidth(tabVoice ? [voice, tabVoice] : [voice]);
    return { pieces: pcs, notes, tabNotes, groups, tuplets, tabTuplets, voice, tabVoice, formatter, minW, chordIdx, chordPiece };
  });

  // chord labels
  const chordLabel = lick.chords.map(c => {
    const root = chordRootName(mod12(c.rootPc + inst.transpose), writtenKey, lick.mode);
    return root + CHORDS[c.quality].suffix;
  });

  // measure text
  const probeDiv = document.createElement('div');
  probeDiv.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0';
  document.body.appendChild(probeDiv);
  const probe = new Renderer(probeDiv, Renderer.Backends.SVG);
  probe.resize(100, 100);
  const pctx = probe.getContext();
  pctx.setFont(chordFamily, CHORD_SIZE, chordWeight);
  const labelW = chordLabel.map(t => pctx.measureText(t).width);
  pctx.setFont(ROMAN_FONT, ROMAN_SIZE, 'normal');
  const romanW = romans ? romans.map(r => pctx.measureText(r).width) : null;
  const textW = labelW.map((w, i) => w + (romanW ? romanW[i] + 6 : 0));
  // stave modifier widths
  const bare = new Stave(0, 0, 400);
  const bareStart = bare.getNoteStartX();
  const full = new Stave(0, 0, 400).addClef(clef).addKeySignature(keySig);
  const fullStart = full.getNoteStartX();
  probeDiv.remove();

  // widths needed per bar (note area + stave start modifiers + end padding)
  const END_PAD = 14;
  const needNotes = bars.map((B, b) => {
    let w = B.minW + 16;
    // chord labels need room between chord starts
    B.chordIdx.forEach((ci, k) => {
      const next = B.chordIdx[k + 1];
      const startT = lick.chords[ci].start % TPBAR;
      const endT = next != null ? lick.chords[next].start % TPBAR : TPBAR;
      const span = endT - startT;
      const need = (textW[ci] + 10) * (TPBAR / Math.max(1, span));
      if (span < TPBAR) w = Math.max(w, need);
      else w = Math.max(w, textW[ci] + 30); // a lone chord's label must still fit inside its bar
    });
    void b;
    return w;
  });
  const startMod = (first: boolean) => (first ? fullStart : bareStart);

  // ---------- layout into systems ----------
  const containerW = container.clientWidth || container.getBoundingClientRect().width || 900;
  const avail = Math.max(300, containerW - 2 * MARGIN);
  const systems: number[][] = [];
  {
    let cur: number[] = [];
    let used = 0;
    bars.forEach((_, b) => {
      const first = cur.length === 0;
      const w = needNotes[b] + startMod(first) + END_PAD;
      if (!first && (used + w > avail || cur.length >= MAX_BARS_PER_LINE)) {
        systems.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(b);
      used += needNotes[b] + startMod(cur.length === 1) + END_PAD;
    });
    if (cur.length) systems.push(cur);
  }
  // balance: avoid a lonely last bar when earlier lines are fuller (only if everything still fits)
  const sysNeed = (s: number[]) => s.reduce((a, b, i) => a + needNotes[b] + startMod(i === 0) + END_PAD, 0);
  const layoutW = Math.max(avail, ...systems.map(sysNeed));

  // vertical metrics
  const midis = flatPieces.filter(p => p.midi != null).map(p => p.midi as number);
  const hi = midis.length ? Math.max(...midis) : 70;
  const lo = midis.length ? Math.min(...midis) : 60;
  const topLineMidi = clef === 'bass' ? 57 : 77;
  const botLineMidi = clef === 'bass' ? 43 : 64;
  const TUP_H = 14; // room for a triplet bracket / number
  const extraTop = Math.max(0, (hi - topLineMidi) * 2.9 + 4) + (hasTuplets ? TUP_H : 0);
  const extraBot = Math.max(0, (botLineMidi - lo) * 2.9 + 4);
  const CHORD_BASE = 24; // chord baseline below system top
  const topLineOff = CHORD_BASE + 24 + extraTop;
  const staffH = 40;
  const belowStaff = 30 + extraBot;
  const tabSpacing = 13;
  const tabLines = tab ? tab.tuning.length : 0;
  const tabH = showTab ? (tabLines - 1) * tabSpacing : 0;
  const TAB_ANNOT = 24; // room above the tab for position labels and finger numbers
  const tabGap = 6 + (showTab ? TAB_ANNOT : 0);
  const LABEL_BAND = hasLabels ? 22 : 0; // note-label row between the staff and the tab
  const TAB_BELOW = 54 + (hasTuplets ? 12 : 0); // full tab: stems, beams and triplet numbers hang below the tab staff
  const sysH = topLineOff + staffH + belowStaff + LABEL_BAND + (showTab ? tabGap + tabH + TAB_BELOW : 0);
  const totalH = Math.ceil(MARGIN + systems.length * sysH + 6);

  // ---------- phase 2: draw ----------
  const root = document.createElement('div');
  const renderer = new Renderer(root, Renderer.Backends.SVG);
  renderer.resize(layoutW + 2 * MARGIN, totalH);
  const ctx = renderer.getContext();
  const svg = root.querySelector('svg') as SVGSVGElement;
  const drawnNotes: Map<number, StaveNote> = new Map(); // global piece index -> note
  const drawnTab: Map<number, StaveNote> = new Map();
  if (print) {
    ctx.setFillStyle('#000');
    ctx.setStrokeStyle('#000');
  }

  const MARK_FONT = 'Arial, Helvetica, sans-serif';
  const markColor = print ? '#000' : '#6E6D67';
  let lastLabelRight = -Infinity;
  let lastLabelSys = -1;
  const drawTabMarks = (B: Bar, base: number, tabTop: number): void => {
    ctx.save();
    ctx.setFillStyle(markColor);
    B.tabNotes.forEach((tn, k) => {
      const mark = tabMarks.get(base + k);
      if (!mark || !(tn instanceof TabNote)) return;
      const x = tn.getAbsoluteX() + tn.getGlyphWidth() / 2;
      if (mark.finger) {
        ctx.setFont(MARK_FONT, 10, 'normal');
        const t = String(mark.finger);
        ctx.fillText(t, x - ctx.measureText(t).width / 2, tabTop - 8);
      }
      if (mark.label) {
        ctx.setFont(MARK_FONT, 10, 'bold');
        const w = ctx.measureText(mark.label).width;
        const sys = Math.round(tabTop);
        const lx = Math.max(x - 4, sys === lastLabelSys ? lastLabelRight + 4 : -Infinity);
        ctx.fillText(mark.label, lx, tabTop - 19);
        lastLabelRight = lx + w;
        lastLabelSys = sys;
      }
    });
    ctx.restore();
  };

  // note labels: centred under the first piece of each note; a colliding label is nudged right
  const labelRight: Record<number, number> = {};
  const labelDone = new Set<number>();
  const drawLabels = (B: Bar, b: number, si: number, bandTop: number): void => {
    ctx.save();
    ctx.setFont(ROMAN_FONT, 10.5, 'normal');
    B.pieces.forEach((p, k) => {
      const lab = labels[p.noteIdx];
      if (p.noteIdx < 0 || p.cont || !lab || !lab.text || labelDone.has(p.noteIdx)) return;
      labelDone.add(p.noteIdx);
      const n = B.notes[k];
      const cx = (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;
      const w = ctx.measureText(lab.text).width;
      let lx = cx - w / 2;
      const prev = labelRight[si];
      if (prev != null && lx < prev + 3) lx = prev + 3;
      labelRight[si] = lx + w;
      ctx.setFillStyle(print ? '#222' : lab.color ?? '#6E6D67');
      ctx.fillText(lab.text, lx, bandTop + 11);
    });
    ctx.restore();
    void b;
  };

  const pieceBase: number[] = [];
  {
    let s = 0;
    bars.forEach(B => { pieceBase.push(s); s += B.pieces.length; });
  }
  const sysOfBar: number[] = [];
  systems.forEach((s, si) => s.forEach(b => (sysOfBar[b] = si)));

  systems.forEach((sys, si) => {
    const y0 = MARGIN + si * sysH;
    const topLineY = y0 + topLineOff;
    const need = sys.map(b => needNotes[b] + END_PAD);
    const mods = sys.map((_, i) => startMod(i === 0));
    const total = layoutW;
    // distribute spare width proportionally to note-area need
    let widths: number[];
    const base = sys.map((_, i) => need[i] + mods[i]);
    const baseSum = base.reduce((a, b) => a + b, 0);
    const prevFull = si > 0 && systems[si - 1].length > sys.length;
    let target = total;
    if (si === systems.length - 1 && prevFull && si > 0) {
      // last, shorter line: do not stretch more than the average bar of the previous line
      const prevAvg = layoutW / systems[si - 1].length;
      target = Math.min(total, Math.max(baseSum, prevAvg * sys.length));
    }
    const spare = Math.max(0, target - baseSum);
    const noteSum = need.reduce((a, b) => a + b, 0);
    widths = base.map((w, i) => w + (spare * need[i]) / noteSum);

    let x = MARGIN;
    sys.forEach((b, k) => {
      const B = bars[b];
      const w = widths[k];
      if (b === activeBar) {
        ctx.save();
        ctx.setFillStyle(opts.activeBarColor ?? 'rgba(39,71,201,0.06)');
        ctx.fillRect(x, y0 + 2, w, sysH - 8);
        ctx.restore();
      }
      const st = new Stave(x, topLineY - 40, w);
      if (k === 0) st.addClef(clef).addKeySignature(keySig);
      if (b === bars.length - 1) st.setEndBarType(Barline.type.END);
      st.setContext(ctx).draw();
      let tst: TabStave | null = null;
      if (showTab) {
        tst = new TabStave(x, 0, w, { num_lines: tabLines, spacing_between_lines_px: tabSpacing });
        const desiredTop = topLineY + staffH + belowStaff + LABEL_BAND + tabGap;
        tst.setY(desiredTop - tst.getYForLine(0));
        if (k === 0) tst.addClef('tab');
        if (b === bars.length - 1) tst.setEndBarType(Barline.type.END);
        tst.setContext(ctx).draw();
        if (k === 0) new StaveConnector(st, tst).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        new StaveConnector(st, tst)
          .setType(b === bars.length - 1 ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT)
          .setContext(ctx).draw();
        // remove the default key-signature gap mismatch: align note start across both staves
        tst.setNoteStartX(Math.max(st.getNoteStartX(), tst.getNoteStartX()));
        st.setNoteStartX(Math.max(st.getNoteStartX(), tst.getNoteStartX()));
      }
      const formatW = Math.max(40, st.getNoteEndX() - st.getNoteStartX() - 12);
      B.formatter.format(B.tabVoice ? [B.voice, B.tabVoice] : [B.voice], formatW);

      const beams = makeBeams(B.notes, B.pieces, B.groups);
      const tabBeams = B.tabVoice ? makeBeams(B.tabNotes, B.pieces, B.groups) : [];
      // triplet brackets sit on the stem side of the standard staff, always below the full tab
      B.groups.forEach((g, gi) => {
        const lead = g.idx.map(k => B.notes[k]).find(n => !n.isRest());
        B.tuplets[gi].setTupletLocation(lead && lead.getStemDirection() < 0 ? Tuplet.LOCATION_BOTTOM : Tuplet.LOCATION_TOP);
      });
      B.voice.draw(ctx, st);
      const drawBeams = (bms: Beam[], ns: StaveNote[]): void => bms.forEach(bm => {
        const bn = bm.getNotes();
        if (!print && bn.length && bn.every(n => ns.indexOf(n as StaveNote) >= 0 && hl.has(B.pieces[ns.indexOf(n as StaveNote)].noteIdx))) {
          bm.setStyle({ fillStyle: HL, strokeStyle: HL });
        }
        bm.setContext(ctx).draw();
      });
      drawBeams(beams, B.notes);
      B.tuplets.forEach(t => t.setContext(ctx).draw());
      if (B.tabVoice && tst) {
        B.tabVoice.draw(ctx, tst);
        drawBeams(tabBeams, B.tabNotes);
        B.tabTuplets.forEach(t => t.setTupletLocation(Tuplet.LOCATION_BOTTOM).setContext(ctx).draw());
        drawTabDots(ctx, B.tabNotes, B.pieces, '#000');
        drawTabMarks(B, pieceBase[b], tst.getYForLine(0));
      }
      if (hasLabels) drawLabels(B, b, si, topLineY + staffH + belowStaff);
      B.notes.forEach((n, i) => drawnNotes.set(pieceBase[b] + i, n));
      B.tabNotes.forEach((n, i) => drawnTab.set(pieceBase[b] + i, n));

      // chord symbols
      ctx.save();
      ctx.setFont(chordFamily, CHORD_SIZE, chordWeight);
      ctx.setFillStyle('#000');
      B.chordIdx.forEach((ci, j) => {
        const pk = B.chordPiece[j];
        const nx = pk >= 0 ? B.notes[pk].getAbsoluteX() : st.getNoteStartX();
        ctx.fillText(chordLabel[ci], nx - 2, y0 + CHORD_BASE);
        if (romans) {
          ctx.save();
          ctx.setFont(ROMAN_FONT, ROMAN_SIZE, 'normal');
          ctx.setFillStyle(print ? '#000' : '#6E6D67');
          ctx.fillText(romans[ci], nx - 2 + labelW[ci] + 6, y0 + CHORD_BASE);
          ctx.restore();
          ctx.setFont(chordFamily, CHORD_SIZE, chordWeight);
        }
      });
      ctx.restore();
      x += w;
    });
  });

  // ties (drawn after all notes so we know every position)
  const globalPieces = bars.flatMap(B => B.pieces);
  const sysOfPiece = bars.flatMap((B, b) => B.pieces.map(() => sysOfBar[b]));
  for (let i = 0; i < globalPieces.length; i++) {
    const p = globalPieces[i];
    if (!p.tieNext || i + 1 >= globalPieces.length) continue;
    const a = drawnNotes.get(i)!;
    const c = drawnNotes.get(i + 1)!;
    const sameSys = sysOfPiece[i] === sysOfPiece[i + 1];
    const draw = (first: StaveNote | null, last: StaveNote | null) => {
      const tie = new StaveTie({ first_note: first, last_note: last, first_indices: [0], last_indices: [0] });
      tie.setContext(ctx).draw();
    };
    if (sameSys) draw(a, c);
    else {
      draw(a, null);
      draw(null, c);
    }
  }
  void drawnTab;

  // ---------- finalise ----------
  svg.setAttribute('class', 'lick-svg');
  svg.style.display = 'block';
  if (print) svg.style.background = '#fff';
  const scale = containerW / (layoutW + 2 * MARGIN);
  if (layoutW > avail + 1 && scale >= 0.7) {
    // dense bar wider than the container: shrink to fit (down to 70%)
    svg.setAttribute('viewBox', `0 0 ${layoutW + 2 * MARGIN} ${totalH}`);
    svg.setAttribute('width', String(Math.floor(containerW)));
    svg.setAttribute('height', String(Math.ceil(totalH * scale)));
    svg.style.width = Math.floor(containerW) + 'px';
    svg.style.height = Math.ceil(totalH * scale) + 'px';
  } else if (layoutW > avail + 1) {
    container.style.overflowX = 'auto';
  }
  container.appendChild(svg);
  return svg;
}
