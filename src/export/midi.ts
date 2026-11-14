import type { Lick } from '../types';
import { TPB } from '../types';
import { bassEvents, compEvents, type CompEvent, type CompStyle } from '../audio/comping';
import { drumEvents } from '../audio/drums';
import { makeTimeline, soundingNotes, type Timeline } from '../audio/timing';

const PPQ = 480;

export interface MidiOptions {
  bpm: number; swing: boolean; comping: boolean; comp: CompStyle;
  /** General MIDI program for the lead (default 66 alto sax). */
  program?: number;
  /** With swing: keep 16th-note beats straight (default false = legacy swung 16ths). */
  straight16?: boolean;
  /** With comping: add a drum track on channel 10 (default true). */
  drums?: boolean;
}

/** General MIDI percussion notes. */
const GM_DRUM = { ride: 51, hat: 44, kick: 36, snare: 38 } as const;

interface Ev { t: number; order: number; bytes: number[] }

function vlq(n: number): number[] {
  n = Math.max(0, Math.round(n));
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const str = (s: string) => Array.from(s).map(c => c.charCodeAt(0) & 0x7f);
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

function trackChunk(events: Ev[], endTick: number): number[] {
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) { body.push(...vlq(e.t - last), ...e.bytes); last = e.t; }
  const end = Math.max(last, endTick);
  body.push(...vlq(end - last), ...meta(0x2f, []));
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

const tk = (tick: number, tl: Timeline) => Math.round(tl(tick) * PPQ);

function noteEvents(list: { midi: number[]; tick: number; dur: number }[], ch: number, vel: number, tl: Timeline): Ev[] {
  const ev: Ev[] = [];
  for (const n of list) {
    const on = tk(n.tick, tl);
    const off = Math.max(on + 1, tk(n.tick + n.dur, tl));
    for (const m of n.midi) {
      ev.push({ t: on, order: 1, bytes: [0x90 | ch, m & 127, vel] });
      ev.push({ t: off, order: 0, bytes: [0x80 | ch, m & 127, 0] });
    }
  }
  return ev;
}

export function lickToMidi(lick: Lick, opts: MidiOptions): Uint8Array {
  const tl = makeTimeline(lick.notes, { swing: opts.swing, straight16: opts.straight16 ?? false });
  const bpm = Math.min(320, Math.max(20, opts.bpm));
  const endTick = Math.round((lick.totalTicks / TPB) * PPQ);

  const tempo = Math.round(60_000_000 / bpm);
  const conductor: Ev[] = [
    { t: 0, order: -2, bytes: meta(0x03, str('ii-V-I lick')) },
    { t: 0, order: -1, bytes: meta(0x51, [(tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]) },
    { t: 0, order: -1, bytes: meta(0x58, [4, 2, 24, 8]) },
  ];

  const leadList: CompEvent[] = soundingNotes(lick).map(s => ({ midi: [s.midi], tick: s.start, dur: s.dur }));
  const lead: Ev[] = [
    { t: 0, order: -2, bytes: meta(0x03, str('Lead')) },
    { t: 0, order: -1, bytes: [0xc0, (opts.program ?? 66) & 127] },
    ...noteEvents(leadList, 0, 96, tl),
  ];

  const tracks = [trackChunk(conductor, endTick), trackChunk(lead, endTick)];
  if (opts.comping) {
    const piano: Ev[] = [
      { t: 0, order: -2, bytes: meta(0x03, str('Piano')) },
      { t: 0, order: -1, bytes: [0xc1, 0] },
      ...noteEvents(compEvents(lick.chords, opts.comp), 1, 64, tl),
    ];
    const bass: Ev[] = [
      { t: 0, order: -2, bytes: meta(0x03, str('Bass')) },
      { t: 0, order: -1, bytes: [0xc2, 32] },
      ...noteEvents(bassEvents(lick.chords), 2, 88, tl),
    ];
    tracks.push(trackChunk(piano, endTick), trackChunk(bass, endTick));
    if (opts.drums !== false) {
      const hits: Ev[] = [{ t: 0, order: -2, bytes: meta(0x03, str('Drums')) }];
      for (const e of drumEvents(lick.totalTicks, { seed: lick.seed })) {
        const on = tk(e.tick, tl);
        hits.push({ t: on, order: 1, bytes: [0x99, GM_DRUM[e.kind], Math.max(1, Math.round(e.vel * 100))] });
        hits.push({ t: on + 60, order: 0, bytes: [0x89, GM_DRUM[e.kind], 0] });
      }
      tracks.push(trackChunk(hits, endTick));
    }
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  return Uint8Array.from([...header, ...tracks.flat()]);
}
