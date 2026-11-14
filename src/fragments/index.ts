import type { ChordQualityId, FragTag, Fragment } from '../types';
import { TICKS_PER_16TH, TPBAR } from '../types';
import { SEED_FRAGMENTS } from './lib/seed';
import { PROTOTYPE_FRAGMENTS } from './lib/prototype';
import { ORIGINAL_FRAGMENTS } from './lib/original';
import { TRIPLET_FRAGMENTS } from './lib/triplets';
import { VOCAB_FRAGMENTS } from './lib/vocab';
import { ADVANCED_FRAGMENTS } from './lib/advanced';
import { PHASE2B_FRAGMENTS } from './lib/phase2b';
import { FOCUS_FRAGMENTS } from './lib/focus';
import { parseNotes } from './lib/notation';
import { detectDevices, type DeviceKind } from '../theory/devices';

/**
 * Fragments in src/fragments/lib are AUTHORED in sixteenth-note units (1 = 16th, 2 = 8th, 4 = quarter,
 * 16 = whole). The generator works on the 12-ticks-per-beat grid (see types.ts), so every fragment is
 * scaled by this factor on load. Library files must NOT be edited to the new grid.
 */
export const AUTHORED_UNIT = TICKS_PER_16TH;

/** Convert a fragment authored in 16th-note units to the engine's tick grid. Pure; does not mutate its input. */
export function fromSixteenths(f: Fragment): Fragment {
  return { ...f, notes: f.notes.map(n => ({ ...n, dur: n.dur * AUTHORED_UNIT })) };
}

/**
 * Corrections to cells in the generated prototype/seed libraries. `npm run mine` rewrites lib/prototype.ts, so fixes
 * live here and are applied on load (never edit prototype.ts by hand).
 *
 * The altered scale is R b9 #9 3 b5/#11 b13 b7 (rel 0 1 3 4 6 8 10). A cell offered over 7alt must not use the natural 5
 * (rel 7) or natural 13 (rel 9): those belong to the plain V7 / half-whole diminished sound. So a cell that is only
 * wrong over 7alt loses the `dom7alt` quality, and a cell that is 7alt-only gets the offending notes re-spelled.
 * `notes` use the library's compact notation (16th units).
 */
const PLAIN_V7 = { qualities: ['dom7'] as ChordQualityId[] };
export const PROTOTYPE_OVERRIDES: Record<string, { qualities?: ChordQualityId[]; notes?: string }> = {
  'dom7-seed-3': PLAIN_V7,
  'dom7-proto-28h1': PLAIN_V7,
  'dom7-proto-33': PLAIN_V7,
  'dom7-proto-33h1': PLAIN_V7,
  'dom7-proto-34': PLAIN_V7,
  'dom7-proto-34h1': PLAIN_V7,
  'dom7-proto-34h2': PLAIN_V7,
  'dom7-proto-36': PLAIN_V7,
  'dom7-proto-36h1': PLAIN_V7,
  'dom7-proto-42': PLAIN_V7,
  'dom7-proto-46h2': PLAIN_V7,
  'dom7-proto-45': { notes: '1:2 4:2 8:2 10:2 8:2 6:2 4:2 1:2' },
  'dom7-proto-45h1': { notes: '1:2 4:2 8:2 10:2' },
  'dom7-proto-46': { notes: '1:2 0:2 4:2 8:2 10:2 8:2 6:2 4:2' },
  'dom7-proto-46h1': { notes: '1:2 0:2 4:2 8:2' },
  'dom7-proto-50': { notes: '4:2 2:2 0:2 -2:2 1:2 4:2 8:2 10:2' },
  'dom7-proto-54': { notes: '4:2 8:2 10:2 12:2 13:2 12:2 10:2 8:2' },
  'dom7-proto-54h2': { notes: '13:2 12:2 10:2 8:2' },
};

/**
 * Mined prototype cells that leap a minor 7th or more inside the cell (an arpeggio restarted an octave up). They are
 * dropped on load; the generated lib/prototype.ts is never edited by hand.
 */
export const PROTOTYPE_DROP = new Set(['m7-proto-49', 'm7-proto-49h2', 'dom7-proto-49', 'dom7-proto-49h2']);

/**
 * Vocabulary cells dropped on load (the lib files keep them as history):
 *  - noodling: 1-3-2-3-1-3-5-3 (maj7-voc-114), a 5-b7 oscillation (m7-voc-93), and the repeated-motif sequence cells
 *    m7-adv-03, dom7-adv-01/02, m7b5-adv-01, which sound like exercises;
 *  - wall-of-16ths scale/arpeggio runs that make Expert a speed test (maj7-adv-05, m7-adv-06, maj7-voc-69, m6-voc-37);
 *  - Level 2 7alt cells that are Mixolydian with one hidden b13 (dom7alt-voc-28, -77, -81).
 */
export const VOCAB_DROP = new Set([
  'maj7-voc-114', 'm7-voc-93', 'm7-adv-03', 'dom7-adv-01', 'dom7-adv-02', 'm7b5-adv-01',
  'maj7-adv-05', 'm7-adv-06', 'maj7-voc-69', 'm6-voc-37',
  'dom7alt-voc-28', 'dom7alt-voc-77', 'dom7alt-voc-81',
]);

function applyOverride(f: Fragment): Fragment {
  const o = PROTOTYPE_OVERRIDES[f.id];
  if (!o) return f;
  return { ...f, ...(o.qualities ? { qualities: o.qualities } : {}), ...(o.notes ? { notes: parseNotes(o.notes, 1) } : {}) };
}

/** Libraries authored in 16th-note units (scaled x3 on load). Add new 16th-grid lib files here. */
export const AUTHORED_FRAGMENTS: Fragment[] = [...SEED_FRAGMENTS, ...PROTOTYPE_FRAGMENTS.filter(f => !PROTOTYPE_DROP.has(f.id)), ...ORIGINAL_FRAGMENTS].map(applyOverride);

/** The Phase 2 vocabulary (lib/vocab.ts, lib/advanced.ts, lib/phase2b.ts), also authored in 16ths. Kept apart from AUTHORED_FRAGMENTS, which some tests pin. */
export const VOCABULARY_FRAGMENTS: Fragment[] = [...VOCAB_FRAGMENTS, ...ADVANCED_FRAGMENTS, ...PHASE2B_FRAGMENTS, ...FOCUS_FRAGMENTS].filter(f => !VOCAB_DROP.has(f.id));

/**
 * Every fragment the generator may use, on the engine tick grid. Libraries that contain triplet durations
 * (lib/triplets.ts) are already parsed to engine ticks and are appended AFTER the scaled 16th-grid libraries,
 * so FRAGMENTS.slice(0, AUTHORED_FRAGMENTS.length) is exactly the scaled authored set (the vocabulary follows it).
 */
/**
 * Focus tags are derived from the notes, so they cannot drift from what the Analyze view finds (src/theory/devices.ts):
 *  - enclosure / chromatic / triad-pair / sixth-dim / superimposition: the detector fires on the cell over one of its chords;
 * Only adds tags, never removes one; the input is not mutated.
 */
export function withDeviceTags(f: Fragment): Fragment {
  const add = new Set<FragTag>();
  let t = TPBAR; // the cell sits one bar into a chord, so its first note is not "the start of a chord"
  const timed = f.notes.map(n => { const r = { rel: n.rel, start: t, dur: n.dur, tie: n.tie }; t += n.dur; return r; });
  const seen = new Map<DeviceKind, number>();
  for (const q of f.qualities) {
    const notes = timed.map(n => ({ midi: n.rel == null ? null : 60 + n.rel, start: n.start, dur: n.dur, ...(n.tie ? { tie: true } : {}), chord: 0 }));
    for (const k of new Set(detectDevices({ notes, chords: [{ rootPc: 0, quality: q, symbol: '', start: 0, dur: t }] }).map(d => d.kind))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const all = (k: DeviceKind): boolean => seen.get(k) === f.qualities.length; // the device must be there over every chord the cell serves
  if (all('enclosure')) add.add('enclosure');
  if (all('chromatic')) add.add('chromatic');
  if (all('triadPair')) add.add('triad-pair');
  if (all('sixthDim')) add.add('sixth-dim');
  if (all('superimposition') || all('sideSlip')) add.add('superimposition');

  const fresh = [...add].filter(x => !f.tags.includes(x));
  return fresh.length ? { ...f, tags: [...f.tags, ...fresh] } : f;
}

export const FRAGMENTS: Fragment[] = [...AUTHORED_FRAGMENTS.map(fromSixteenths), ...VOCABULARY_FRAGMENTS.map(fromSixteenths), ...TRIPLET_FRAGMENTS].map(withDeviceTags);

export const fragmentsFor = (q: ChordQualityId, beats?: 2 | 4): Fragment[] =>
  FRAGMENTS.filter(f => f.qualities.includes(q) && (beats === undefined || f.beats === beats));
