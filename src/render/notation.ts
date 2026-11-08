import {
  Accidental, Barline, Beam, Dot, Formatter, Fraction, GhostNote, Renderer, Stave, StaveConnector, StaveNote,
  StaveTie, TabNote, TabStave, Voice,
} from 'vexflow';
import type { Instrument, Lick } from '../types';
import { RENDERABLE_DURS } from '../types';
import { CHORDS } from '../theory/chords';
import { chordRootName, keySignatureName, keyUsesSharps, mod12, vexKey } from '../theory/pitch';
import { assignFrets } from './tab';

export interface RenderOptions {
  highlight?: number[];
  showTab?: boolean;
  print?: boolean;
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
  1: ['16', 0], 2: ['8', 0], 3: ['8', 1], 4: ['q', 0], 6: ['q', 1], 8: ['h', 0], 12: ['h', 1], 16: ['w', 0],
};
const MAX_BARS_PER_LINE = 4;
const MARGIN = 10;

/** One drawable note/rest (a lick note may become several tied pieces). */
interface Piece {
  noteIdx: number;
  start: number;
  dur: number;
  midi: number | null; // written
  tieNext: boolean;
  cont: boolean; // continuation of a tied chain (tab shows only the first)
}

interface Bar {
  pieces: Piece[];
  notes: StaveNote[];
  tabNotes: (TabNote | GhostNote)[];
  voice: Voice;
  tabVoice?: Voice;
  formatter: Formatter;
  minW: number;
  chordIdx: number[]; // lick.chords indices starting in this bar
  chordPiece: number[]; // piece index per chordIdx (-1 if none)
}

/** Split a duration into renderable pieces, greedy largest first. */
function splitDur(dur: number): number[] {
  const out: number[] = [];
  let left = dur;
  const sorted = [...RENDERABLE_DURS].sort((a, b) => b - a);
  while (left > 0) {
    const d = sorted.find(x => x <= left) ?? 1;
    out.push(d);
    left -= d;
  }
  return out;
}

function buildPieces(lick: Lick, transpose: number, nBars: number): Piece[][] {
  const bars: Piece[][] = Array.from({ length: nBars }, () => []);
  const notes = lick.notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.start - b.n.start);
  for (const { n, i } of notes) {
    const midi = n.midi == null ? null : n.midi + transpose;
    let pos = n.start;
    const end = n.start + n.dur;
    const segs: { start: number; dur: number }[] = [];
    while (pos < end) {
      const barEnd = (Math.floor(pos / 16) + 1) * 16;
      const segEnd = Math.min(end, barEnd);
      let p = pos;
      for (const d of splitDur(segEnd - pos)) {
        segs.push({ start: p, dur: d });
        p += d;
      }
      pos = segEnd;
    }
    segs.forEach((s, k) => {
      const bar = Math.floor(s.start / 16);
      if (bar >= nBars) return;
      const isLast = k === segs.length - 1;
      bars[bar].push({
        noteIdx: i, start: s.start, dur: s.dur, midi,
        tieNext: midi != null && (isLast ? !!n.tie : true),
        cont: false,
      });
    });
  }
  // mark continuations & fill gaps with rests (defensive)
  const flat: Piece[] = [];
  bars.forEach((pcs, b) => {
    let t = b * 16;
    const filled: Piece[] = [];
    for (const p of pcs) {
      if (p.start > t) for (const d of splitDur(p.start - t)) { filled.push({ noteIdx: -1, start: t, dur: d, midi: null, tieNext: false, cont: false }); t += d; }
      filled.push(p);
      t = Math.max(t, p.start + p.dur);
    }
    if (t < (b + 1) * 16) for (const d of splitDur((b + 1) * 16 - t)) { filled.push({ noteIdx: -1, start: t, dur: d, midi: null, tieNext: false, cont: false }); t += d; }
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
  const [d, dots] = DUR_NAME[p.dur] ?? ['q', 0];
  let n: StaveNote;
  if (p.midi == null) {
    n = new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: d + 'd'.repeat(dots) + 'r', clef });
  } else {
    n = new StaveNote({ keys: [vexKey(p.midi, sharps)], duration: d + 'd'.repeat(dots), clef, auto_stem: true });
  }
  if (dots) Dot.buildAndAttach([n], { all: true });
  return n;
}

function makeTabNote(p: Piece, pos: { str: number; fret: number } | null): TabNote | GhostNote {
  const [d, dots] = DUR_NAME[p.dur] ?? ['q', 0];
  if (p.midi == null || p.cont || !pos) {
    const g = new GhostNote({ duration: d + 'd'.repeat(dots) });
    if (dots) Dot.buildAndAttach([g as unknown as StaveNote], { all: true });
    return g;
  }
  const t = new TabNote({ positions: [{ str: pos.str, fret: pos.fret }], duration: d + 'd'.repeat(dots) });
  if (dots) Dot.buildAndAttach([t as unknown as StaveNote], { all: true });
  return t;
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
  const nBars = Math.max(1, Math.ceil(lick.totalTicks / 16));
  const showTab = !!(opts.showTab && inst.tab);
  const tab = inst.tab;

  // ---------- phase 1: notes, voices, minimum widths ----------
  const pieceBars = buildPieces(lick, inst.transpose, nBars);
  const flatPieces = pieceBars.flat();
  const tabPos = showTab && tab
    ? (() => {
        // assign frets over the first piece of each tied chain only
        const idx = flatPieces.map((p, i) => ({ p, i })).filter(x => x.p.midi != null && !x.p.cont);
        const res = assignFrets(idx.map(x => x.p.midi), tab.tuning, tab.frets);
        const m = new Map<number, { str: number; fret: number } | null>();
        idx.forEach((x, k) => m.set(x.i, res[k]));
        return m;
      })()
    : null;

  let pi = 0;
  const bars: Bar[] = pieceBars.map((pcs, b) => {
    const notes = pcs.map(p => makeNote(p, clef, sharps));
    pcs.forEach((p, k) => {
      if (hl.has(p.noteIdx)) notes[k].setStyle({ fillStyle: HL, strokeStyle: HL });
    });
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(notes);
    Accidental.applyAccidentals([voice], keySig);
    const formatter = new Formatter().joinVoices([voice]);
    let tabNotes: (TabNote | GhostNote)[] = [];
    let tabVoice: Voice | undefined;
    const base = pi;
    if (showTab) {
      tabNotes = pcs.map((p, k) => {
        const tn = makeTabNote(p, tabPos?.get(base + k) ?? null);
        if (hl.has(p.noteIdx) && tn instanceof TabNote) tn.setStyle({ fillStyle: HL, strokeStyle: HL });
        return tn;
      });
      tabVoice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(tabNotes);
      formatter.joinVoices([tabVoice]);
    }
    pi += pcs.length;
    const chordIdx: number[] = [];
    const chordPiece: number[] = [];
    lick.chords.forEach((c, ci) => {
      if (Math.floor(c.start / 16) !== b) return;
      chordIdx.push(ci);
      let k = pcs.findIndex(p => p.start === c.start);
      if (k < 0) k = pcs.findIndex(p => p.start >= c.start);
      chordPiece.push(k);
    });
    const minW = formatter.preCalculateMinTotalWidth(tabVoice ? [voice, tabVoice] : [voice]);
    return { pieces: pcs, notes, tabNotes, voice, tabVoice, formatter, minW, chordIdx, chordPiece };
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
      const startT = lick.chords[ci].start % 16;
      const endT = next != null ? lick.chords[next].start % 16 : 16;
      const span = endT - startT;
      const need = (textW[ci] + 10) * (16 / Math.max(1, span));
      if (span < 16) w = Math.max(w, need);
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
  const extraTop = Math.max(0, (hi - topLineMidi) * 2.9 + 4);
  const extraBot = Math.max(0, (botLineMidi - lo) * 2.9 + 4);
  const CHORD_BASE = 24; // chord baseline below system top
  const topLineOff = CHORD_BASE + 24 + extraTop;
  const staffH = 40;
  const belowStaff = 30 + extraBot;
  const tabSpacing = 13;
  const tabLines = tab ? tab.tuning.length : 0;
  const tabH = showTab ? (tabLines - 1) * tabSpacing : 0;
  const sysH = topLineOff + staffH + belowStaff + (showTab ? 6 + tabH + 24 : 0);
  const totalH = Math.ceil(MARGIN + systems.length * sysH + 6);

  // ---------- phase 2: draw ----------
  const root = document.createElement('div');
  const renderer = new Renderer(root, Renderer.Backends.SVG);
  renderer.resize(layoutW + 2 * MARGIN, totalH);
  const ctx = renderer.getContext();
  const svg = root.querySelector('svg') as SVGSVGElement;
  const drawnNotes: Map<number, StaveNote> = new Map(); // global piece index -> note
  const drawnTab: Map<number, TabNote | GhostNote> = new Map();
  if (print) {
    ctx.setFillStyle('#000');
    ctx.setStrokeStyle('#000');
  }

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
        const desiredTop = topLineY + staffH + belowStaff + 6;
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

      const beams = Beam.generateBeams(B.notes, { groups: [new Fraction(1, 4)], beam_rests: false });
      B.voice.draw(ctx, st);
      beams.forEach(bm => {
        const ns = bm.getNotes();
        if (!print && ns.length && ns.every(n => B.notes.indexOf(n as StaveNote) >= 0 && hl.has(B.pieces[B.notes.indexOf(n as StaveNote)].noteIdx))) {
          bm.setStyle({ fillStyle: HL, strokeStyle: HL });
        }
        bm.setContext(ctx).draw();
      });
      if (B.tabVoice && tst) B.tabVoice.draw(ctx, tst);
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
