import { describe, expect, it } from 'vitest';
import { bassEvents } from '../src/audio/comping';
import { summarize } from '../src/analysis/musicality';
import { plainestTier, posToScore, tierForScore, tierHint } from '../src/difficulty/score';
import { FRAGMENTS } from '../src/fragments';
import { generateLick } from '../src/generator';
import { INSTRUMENTS, concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { analyzeLick } from '../src/theory/analyze';
import { CHORDS } from '../src/theory/chords';
import { mod12 } from '../src/theory/pitch';
import { LENGTHS, PROGRESSIONS, expandProgression, getProgression } from '../src/theory/progressions';
import { judgedChord } from '../src/theory/rhythm';
import { formatSpelling, spellLick, spellNote, type Spelled } from '../src/theory/spell';
import type { LengthId, Lick, LickNote, Tier } from '../src/types';
import { TPB, TPBAR } from '../src/types';

/* Stage B fix round, agent FX2: progression colour, endings, spelling, bass. */

const sp = (s: string): Spelled => ({ letter: s[0] as Spelled['letter'], acc: s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0 });
const piano = getInstrument('piano');

/** A lick of 12-tick notes, four per chord of the standard progression (chord index = bar). */
function mkLick(progressionId: string, keyPc: number, midis: (number | null)[]): Lick {
  const def = getProgression(progressionId);
  const chords = expandProgression(def, 'standard', keyPc);
  const notes: LickNote[] = midis.map((m, i) => ({ midi: m, start: i * 12, dur: 12, chord: Math.min(chords.length - 1, Math.floor((i * 12) / 48)) }));
  return {
    version: 2, id: 'x', seed: 1, progressionId, length: 'standard', keyPc, mode: def.mode, requestedTier: 1,
    chords, notes, totalTicks: 144, fragmentIds: [], difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0,
  };
}
const spelled = (l: Lick, inst = piano): string[] => spellLick(l, inst).map(s => (s ? formatSpelling(s) : '-'));

describe('secondary dominant spelling agrees with its label (bug review #2)', () => {
  it('b9 is written on the 9th letter and b13 on the 13th letter over VI7', () => {
    const at = (root: string, midi: number) => formatSpelling(spellNote(midi, { root: sp(root), quality: 'dom7', direction: 'up', secondaryDom: true }));
    expect(at('A', 70)).toBe('B♭'); // G♯ before
    expect(at('G', 68)).toBe('A♭'); // the review's seed 5094 case: G♯ over G7 labelled b9
    expect(at('E♭'.replace('♭', 'b'), 71)).toBe('C♭'); // b13 of E♭7 (was B, seed 5078)
    expect(at('E♭'.replace('♭', 'b'), 59)).toBe('C♭');
    expect(at('Eb', 64)).toBe('F♭'); // b9 of E♭7 (was E, seed 5114)
    // without the secondary-dominant context the chromatic note still follows the line
    expect(formatSpelling(spellNote(70, { root: sp('A'), quality: 'dom7', direction: 'up' }))).toBe('A♯');
  });

  it('sweep: every b9 / b13 over a secondary dominant is spelled the way the Analysis labels it (all keys, instruments, tiers)', () => {
    const L = 'CDEFGAB';
    let checked = 0;
    for (const id of ['turnaround', 'chain-36251', 'coltrane']) {
      const def = getProgression(id);
      for (let s = 0; s < 110; s++) {
        const inst = INSTRUMENTS[s % INSTRUMENTS.length];
        const l = generateLick({ progressionId: id, length: 'standard', keyPc: s % 12, tier: (1 + (s % 4)) as Tier, range: concertRange(inst), seed: 5000 + s });
        const sp2 = spellLick(l, inst);
        const an = analyzeLick(l, inst);
        l.notes.forEach((n, i) => {
          const a = an.notes[i];
          if (!a || n.midi == null || !sp2[i]) return;
          const ci = judgedChord(l.notes, i);
          if (def.slots[ci].fn !== 'secondaryDom') return;
          const rel = mod12(n.midi - l.chords[ci].rootPc);
          if (rel !== 1 && rel !== 8) return;
          checked++;
          const dist = (L.indexOf(sp2[i]!.letter) - L.indexOf(an.chords[ci].symbol[0]) + 7) % 7;
          expect(dist, `${id} seed ${5000 + s} ${an.chords[ci].symbol}: ${formatSpelling(sp2[i]!)} labelled ${a.label}`).toBe(rel === 1 ? 1 : 5);
        });
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('spelling readability (jazz review #8)', () => {
  it('the major 7th over a dominant or minor 7th is the 7th letter (A♯ over B7, D♯ over E7, G♯ over A7, C♯ over Dm7)', () => {
    const at = (root: string, q: 'dom7' | 'm7', midi: number, direction: 'up' | 'down' | null = null) => formatSpelling(spellNote(midi, { root: sp(root), quality: q, direction }));
    expect(at('B', 'dom7', 70, 'up')).toBe('A♯');
    expect(at('B', 'dom7', 70, 'down')).toBe('A♯');
    expect(at('E', 'dom7', 63, 'up')).toBe('D♯');
    expect(at('A', 'dom7', 68, 'up')).toBe('G♯');
    expect(at('D', 'm7', 61, 'up')).toBe('C♯');
    expect(at('D', 'm7', 61, 'down')).toBe('C♯');
    // a white key stays natural and a root whose 7th letter would need E♯ / B♯ / C♭ / F♭ keeps its old spelling
    expect(at('F', 'dom7', 64, 'up')).toBe('E');
    expect(at('F#', 'dom7', 65, 'up')).toBe('F');
  });

  it('a half-step lower neighbour is the letter below its target (F→F♯ is E♯, E♭→E is D♯, C→C♯ is B♯)', () => {
    // key B: C♯m7 F♯7 Bmaj7; F rises to F♯ over Bmaj7
    expect(spelled(mkLick('major-251', 11, [null, null, null, null, null, null, null, null, 65, 66, 71, 66]))[8]).toBe('E♯');
    // key A: Amaj7: E♭ rising to E is D♯ and C rising to C♯ is B♯
    const a = spelled(mkLick('major-251', 9, [null, null, null, null, null, null, null, null, 63, 64, 60, 61]));
    expect(a[8]).toBe('D♯');
    expect(a[10]).toBe('B♯');
    // the old rule is untouched for natural targets: B♭→B over C7 (F: B♭ = A♯ rising)
    expect(spelled(mkLick('major-251', 0, [null, null, null, null, null, null, null, null, 69, 71, 72, 67]))[8]).toBe('A');
  });

  it('within one chord the same pitch class keeps one spelling, and free chromatic notes follow the bar sharps or flats', () => {
    // G7 (key C): C♯/D♭ twice, the first falling away, the second rising away: one spelling
    const g = spelled(mkLick('major-251', 0, [null, null, null, null, 61, 55, 65, 61, 67, null, null, null]));
    expect(g[4]).toBe(g[7]);
    // Gmaj7 (key G): a free D♭ beside an A♯→B rising pair is written C♯
    const m = spelled(mkLick('major-251', 7, [null, null, null, null, null, null, null, null, 61, 58, 59, 67]));
    expect(m.slice(8, 12)).toEqual(['C♯', 'A♯', 'B', 'G']);
  });

  it('rising chromatic neighbours stay sharp and falling upper neighbours stay flat in a plain line (no regression)', () => {
    const l = spelled(mkLick('major-251', 0, [null, null, null, null, 65, 66, 67, 66, 64, 63, 62, 60]));
    expect(l[4]).toBe('F');
    expect(l[5]).toBe('F♯');
    expect(l[9]).toBe('E♭');
  });

  it('sweep: a lick never writes a pitch class two ways over the same chord unless a half step resolves it (turnaround, all keys)', () => {
    let dup = 0, segs = 0;
    for (const id of ['turnaround', 'chain-36251', 'major-251', 'minor-251']) {
      for (let s = 0; s < 50; s++) {
        const inst = INSTRUMENTS[s % INSTRUMENTS.length];
        const l = generateLick({ progressionId: id, length: 'standard', keyPc: s % 12, tier: (1 + (s % 4)) as Tier, range: concertRange(inst), seed: 6000 + s });
        const sp2 = spellLick(l, inst);
        const seen = new Map<string, string>();
        l.notes.forEach((n, i) => {
          if (n.midi == null || !sp2[i]) return;
          const key = `${judgedChord(l.notes, i)}|${mod12(n.midi)}`;
          const t = formatSpelling(sp2[i]!);
          if (seen.has(key)) { segs++; if (seen.get(key) !== t) dup++; } else seen.set(key, t);
        });
      }
    }
    expect(dup / segs).toBeLessThan(0.03); // was ~11% before the bar-consistency rule
  });
});

describe('VI7 colour: b9 / b13 over a secondary dominant, no stressed natural 13', () => {
  const sample = (id: string, pos: number, n = 100): Lick[] => {
    const hist: string[][] = [];
    const out: Lick[] = [];
    for (let k = 0; k < n; k++) {
      const inst = getInstrument(k % 2 ? 'guitar' : 'alto');
      const t = posToScore(pos);
      const tier = tierForScore(t);
      const l = generateLick({ progressionId: id, length: 'standard', keyPc: k % 12, tier, targetScore: t, range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tier), avoid: hist.slice(-8).flat(), seed: 900 + k });
      hist.push(l.fragmentIds);
      out.push(l);
    }
    return out;
  };
  for (const id of ['turnaround', 'chain-36251']) {
    for (const [name, pos] of [['Advanced', 62.5], ['Expert', 87.5]] as const) {
      it(`${id} at ${name}: b9 over VI7 in at least 35% of the licks (was 10-26%), a stressed natural 13 in at most 10%`, () => {
        const m = summarize(sample(id, pos));
        expect(m.secDomFlat9Share, 'b9 share').toBeGreaterThanOrEqual(0.35);
        expect(m.secDomNat13StressedShare, 'stressed natural 13').toBeLessThanOrEqual(0.1); // was 15-17%
      }, 60_000);
    }
  }
  it('Beginner licks stay plain over VI7 (no b9 requirement, the colour is from Intermediate up)', () => {
    const m = summarize(sample('turnaround', 10, 60));
    expect(m.secDomFlat9Share).toBeLessThan(0.2);
  }, 60_000);
});

describe('endings', () => {
  it('no ending cell stops on the 9th right after a b9 / #9 (maj7) or b9 (minor tonic)', () => {
    for (const f of FRAGMENTS.filter(f => f.ending)) {
      const pit = f.notes.filter(n => n.rel != null).map(n => mod12(n.rel!));
      if (pit.length < 2 || pit[pit.length - 1] !== 2) continue;
      const pen = pit[pit.length - 2];
      const bad = f.qualities.includes('maj7') ? [1, 3] : [1];
      expect(bad, `${f.id}: ${f.notes.map(n => n.rel).join(' ')}`).not.toContain(pen);
    }
  });

  const finals = (id: string, tier: Tier, n = 100) => {
    const out: { first: number; last: number }[] = [];
    for (let k = 0; k < n; k++) {
      const inst = getInstrument(k % 2 ? 'guitar' : 'alto');
      const t = posToScore([12.5, 37.5, 62.5, 87.5][tier - 1]);
      const l = generateLick({ progressionId: id, length: 'standard', keyPc: k % 12, tier, targetScore: t, range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tier), seed: 3000 + k });
      const ci = l.chords.length - 1;
      const lc = l.chords[ci];
      const jc = l.notes.map((_, i) => judgedChord(l.notes, i));
      const firstIdx = l.notes.findIndex((n, i) => n.midi != null && jc[i] === ci && !(i > 0 && l.notes[i - 1].tie && l.notes[i - 1].midi === n.midi));
      const lastIdx = l.notes.map((n, i) => (n.midi != null ? i : -1)).filter(i => i >= 0).pop()!;
      out.push({ first: mod12(l.notes[firstIdx].midi! - lc.rootPc), last: mod12(l.notes[lastIdx].midi! - lc.rootPc) });
    }
    return out;
  };

  it('the first note on the final chord is a guide tone like an interior arrival (>= 75%, was 45-65%), classic and long progressions', () => {
    for (const p of PROGRESSIONS) {
      const quality = p.slots[p.slots.length - 1].quality;
      let hit = 0, n = 0;
      for (const tier of [1, 2, 3, 4] as Tier[]) for (const f of finals(p.id, tier, 28)) { n++; if (CHORDS[quality].guide.some(g => mod12(g) === f.first)) hit++; }
      expect(hit / n, p.id).toBeGreaterThanOrEqual(0.75);
    }
  }, 60_000);

  it('9th endings are capped (about 8%) at Expert and never follow a b9 / #9', () => {
    let nine = 0, n = 0;
    for (const p of PROGRESSIONS) for (const f of finals(p.id, 4, 40)) { n++; if (f.last === 2) nine++; }
    expect(nine / n).toBeLessThanOrEqual(0.1);
  }, 60_000);
});

describe('tier hint and short dominants', () => {
  it('Coltrane changes cannot be easier than Intermediate, and the hint says so (the old "very simple" was false)', () => {
    const coltrane = getProgression('coltrane');
    expect(plainestTier(coltrane)).toBe(2);
    for (const p of PROGRESSIONS.filter(p => p.id !== 'coltrane')) expect(plainestTier(p), p.id).toBe(1);
    expect(tierHint(coltrane, 1)).toBe('Coltrane ii–Vs starts at Intermediate: this lick is as simple as they get.');
    expect(tierHint(coltrane, 4)).toBeNull();
    // the other progressions keep the "usually X material" hint below their minTier
    expect(tierHint(getProgression('major-251-alt'), 1)).toMatch(/usually Advanced material/);
    expect(tierHint(getProgression('major-251'), 1)).toBeNull();
    // and the plainest Coltrane lick really is not Beginner
    const alto = concertRange(getInstrument('alto'));
    for (let s = 0; s < 12; s++) {
      const l = generateLick({ progressionId: 'coltrane', length: 'standard', keyPc: s, tier: 1, targetScore: posToScore(5), range: alto, seed: 70 + s });
      expect(l.difficulty.tier, `seed ${70 + s}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('one note is rarely held across a whole 2-beat dominant of Coltrane changes (its colour would never sound)', () => {
    let doms = 0, held = 0;
    for (let s = 0; s < 240; s++) {
      const inst = getInstrument(s % 2 ? 'guitar' : 'alto');
      const t = posToScore([20, 40, 62, 88][s % 4]);
      const l = generateLick({ progressionId: 'coltrane', length: (['short', 'standard', 'long'] as const)[s % 3], keyPc: s % 12, tier: tierForScore(t), targetScore: t, range: concertRange(inst), seed: 400 + s });
      for (const c of l.chords) {
        if (c.quality !== 'dom7' && c.quality !== 'dom7alt') continue;
        if (c.dur !== 2 * TPB) continue;
        doms++;
        const attacks = l.notes.filter(x => x.midi != null && x.start >= c.start && x.start < c.start + c.dur).length;
        const head = l.notes.find(x => x.start <= c.start && x.start + x.dur > c.start);
        if (!head || head.midi == null) continue;
        let j = l.notes.indexOf(head);
        let end = head.start + head.dur;
        while (l.notes[j].tie && l.notes[j + 1]) { j++; end = l.notes[j].start + l.notes[j].dur; }
        if (end >= c.start + c.dur && attacks <= 1) held++;
      }
    }
    expect(held / doms).toBeLessThan(0.03); // 5% before (46 of 1200 in a larger sample), under 1% after
  }, 60_000);
});

describe('walking bass stays smooth over chains of short chords (Coltrane changes in E♭)', () => {
  it('no leap beyond an octave, and a chain of 2-beat chords does not climb to the ceiling and jump', () => {
    let maxLeap = 0, n = 0, top = 0, total = 0;
    for (const p of PROGRESSIONS) for (const length of Object.keys(LENGTHS) as LengthId[]) for (let key = 0; key < 12; key++) {
      const ev = bassEvents(expandProgression(p, length, key)).map(e => e.midi[0]);
      for (let i = 1; i < ev.length; i++) { maxLeap = Math.max(maxLeap, Math.abs(ev[i] - ev[i - 1])); n++; }
      for (const m of ev) { total++; if (m >= 54) top++; }
    }
    expect(maxLeap).toBeLessThanOrEqual(11); // was 18 (a 6th beyond the octave) in the old walk
    expect(top / total, 'share of notes pinned at the ceiling').toBeLessThan(0.08);
  });
  it('Coltrane in E♭: the D7 walk is not D F♯ low-A F♯', () => {
    const ev = bassEvents(expandProgression(getProgression('coltrane'), 'standard', 3));
    for (let i = 1; i < ev.length; i++) expect(Math.abs(ev[i].midi[0] - ev[i - 1].midi[0]), `step ${i}`).toBeLessThanOrEqual(9);
  });
  it('still a root on every chord, a half-step approach into the next root, one note per beat, inside 36-55', () => {
    for (const p of PROGRESSIONS) for (const length of Object.keys(LENGTHS) as LengthId[]) for (const key of [0, 5, 9]) {
      const chords = expandProgression(p, length, key);
      const bass = bassEvents(chords);
      chords.forEach((c, i) => {
        const inChord = bass.filter(e => e.tick >= c.start && e.tick < c.start + c.dur);
        if (i === chords.length - 1) { expect(inChord.length).toBe(1); return; }
        expect(inChord.length).toBe(c.dur / TPB);
        expect(mod12(inChord[0].midi[0])).toBe(c.rootPc);
        const next = bass.find(e => e.tick === c.start + c.dur)!;
        expect(Math.abs(inChord[inChord.length - 1].midi[0] - next.midi[0])).toBe(1);
      });
      for (const e of bass) { expect(e.midi[0]).toBeGreaterThanOrEqual(36); expect(e.midi[0]).toBeLessThanOrEqual(55); }
    }
    expect(TPBAR).toBeGreaterThan(0);
  });
});
