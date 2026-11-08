import type { Fragment } from '../../types';

/**
 * Minimal hand-written seed set so the generator can be developed before the full
 * library exists. Rels are semitones from the chord root; durs in 16ths.
 */
export const SEED_FRAGMENTS: Fragment[] = [
  // ii (m7): up the arpeggio 1-b3-5-b7
  { id: 'm7-seed-1', qualities: ['m7'], beats: 4, notes: [{ rel: 0, dur: 4 }, { rel: 3, dur: 4 }, { rel: 7, dur: 4 }, { rel: 10, dur: 4 }], tags: ['arpeggio'], level: 1, source: 'original' },
  { id: 'm7-seed-2', qualities: ['m7'], beats: 4, notes: [{ rel: 7, dur: 2 }, { rel: 5, dur: 2 }, { rel: 3, dur: 2 }, { rel: 2, dur: 2 }, { rel: 0, dur: 2 }, { rel: 3, dur: 2 }, { rel: 7, dur: 2 }, { rel: 10, dur: 2 }], tags: ['scale', 'arpeggio'], level: 2, source: 'original' },
  { id: 'm7-seed-3', qualities: ['m7'], beats: 2, notes: [{ rel: 3, dur: 2 }, { rel: 7, dur: 2 }, { rel: 10, dur: 2 }, { rel: 14, dur: 2 }], tags: ['arpeggio'], level: 2, source: 'original' },
  // V (dom7)
  { id: 'dom7-seed-1', qualities: ['dom7'], beats: 4, notes: [{ rel: 4, dur: 4 }, { rel: 7, dur: 4 }, { rel: 10, dur: 4 }, { rel: 7, dur: 4 }], tags: ['arpeggio'], level: 1, source: 'original' },
  { id: 'dom7-seed-2', qualities: ['dom7'], beats: 4, notes: [{ rel: 10, dur: 2 }, { rel: 9, dur: 2 }, { rel: 7, dur: 2 }, { rel: 5, dur: 2 }, { rel: 4, dur: 2 }, { rel: 2, dur: 2 }, { rel: 0, dur: 2 }, { rel: -2, dur: 2 }], tags: ['scale'], level: 2, source: 'original' },
  { id: 'dom7-seed-3', qualities: ['dom7', 'dom7alt'], beats: 2, notes: [{ rel: 4, dur: 2 }, { rel: 7, dur: 2 }, { rel: 10, dur: 2 }, { rel: 13, dur: 2 }], tags: ['arpeggio', 'altered'], level: 3, source: 'original' },
  // V7alt
  { id: 'dom7alt-seed-1', qualities: ['dom7alt'], beats: 4, notes: [{ rel: 4, dur: 2 }, { rel: 8, dur: 2 }, { rel: 10, dur: 2 }, { rel: 13, dur: 2 }, { rel: 15, dur: 2 }, { rel: 13, dur: 2 }, { rel: 10, dur: 2 }, { rel: 8, dur: 2 }], tags: ['altered', 'arpeggio'], level: 3, source: 'original' },
  // iiø (m7b5)
  { id: 'm7b5-seed-1', qualities: ['m7b5'], beats: 4, notes: [{ rel: 0, dur: 4 }, { rel: 3, dur: 4 }, { rel: 6, dur: 4 }, { rel: 10, dur: 4 }], tags: ['arpeggio'], level: 1, source: 'original' },
  { id: 'm7b5-seed-2', qualities: ['m7b5'], beats: 2, notes: [{ rel: 10, dur: 2 }, { rel: 6, dur: 2 }, { rel: 3, dur: 2 }, { rel: 0, dur: 2 }], tags: ['arpeggio'], level: 2, source: 'original' },
  // I (maj7)
  { id: 'maj7-seed-1', qualities: ['maj7'], beats: 4, notes: [{ rel: 4, dur: 12 }, { rel: null, dur: 4 }], tags: ['guide-tone'], level: 1, ending: true, source: 'original' },
  { id: 'maj7-seed-2', qualities: ['maj7'], beats: 4, notes: [{ rel: 0, dur: 4 }, { rel: 4, dur: 4 }, { rel: 7, dur: 4 }, { rel: 11, dur: 4 }], tags: ['arpeggio'], level: 1, source: 'original' },
  { id: 'maj7-seed-3', qualities: ['maj7'], beats: 2, notes: [{ rel: 4, dur: 2 }, { rel: 7, dur: 2 }, { rel: 11, dur: 2 }, { rel: 14, dur: 2 }], tags: ['arpeggio'], level: 2, source: 'original' },
  // i (m6)
  { id: 'm6-seed-1', qualities: ['m6', 'mMaj7'], beats: 4, notes: [{ rel: 3, dur: 12 }, { rel: null, dur: 4 }], tags: ['guide-tone'], level: 1, ending: true, source: 'original' },
  { id: 'm6-seed-2', qualities: ['m6'], beats: 4, notes: [{ rel: 0, dur: 4 }, { rel: 3, dur: 4 }, { rel: 7, dur: 4 }, { rel: 9, dur: 4 }], tags: ['arpeggio'], level: 1, source: 'original' },
];
