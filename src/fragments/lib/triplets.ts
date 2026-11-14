import type { ChordQualityId, FragTag, Fragment, Tier } from '../../types';
import { TICKS_PER_16TH } from '../../types';
import { parseNotes } from './notation';

/**
 * Original triplet fragments (hand-written, no transcribed solos).
 *
 * Notation: see ./notation.ts. Plain numbers are 16ths (1 = 16th, 2 = 8th, 4 = quarter); the tokens
 * t8 / tq / t16 (and t8x2 / tqx2 / t16x2) are triplet units given directly in 48-grid ticks.
 * Unlike the other libraries this one is parsed straight to ENGINE ticks (plain numbers x3), so it is
 * NOT run through fromSixteenths (see fragments/index.ts).
 *
 * Layout rules every fragment follows (also enforced by isValidFragment and tests/fragments.test.ts):
 *   - 8th-triplet groups (t8) fill exactly one beat, quarter-triplet groups (tq) two beats from beat 1 or 3,
 *     16th-triplet groups (t16) one 8th. Group members are never tied.
 *   - Attacks on beat 1 and beat 3 are chord tones or listed tensions of every claimed quality.
 *   - Level 2: plain arpeggio triplets; 3-4: enclosures, turns, mixes, quarter-triplets; t16 only at level 4.
 */
const trip = (id: string, qualities: ChordQualityId[], beats: 2 | 4, level: Tier, tags: FragTag[], notes: string, ending = false): Fragment => {
  const f: Fragment = { id, qualities, beats, notes: parseNotes(notes, TICKS_PER_16TH), tags, level, source: 'original' };
  if (ending) f.ending = true;
  return f;
};

type Q = ChordQualityId;
const MIN: Q[] = ['m7'];
const HALF: Q[] = ['m7b5'];
const DOM: Q[] = ['dom7'];
const ALT: Q[] = ['dom7alt'];
const MAJ: Q[] = ['maj7'];
const MIN6: Q[] = ['m6', 'mMaj7'];

/* ---------------- ii: m7 ---------------- */
const M7: Fragment[] = [
  trip('m7-trip-01', MIN, 2, 2, ['arpeggio'], '0:t8 3:t8 7:t8 10:4'),
  trip('m7-trip-02', MIN, 2, 2, ['arpeggio'], '3:t8 7:t8 10:t8 14:4'),
  trip('m7-trip-03', MIN, 2, 2, ['arpeggio'], '10:t8 7:t8 3:t8 0:4'),
  trip('m7-trip-04', MIN, 4, 2, ['arpeggio'], '0:t8 3:t8 7:t8 10:4 7:t8 3:t8 0:t8 3:4'),
  trip('m7-trip-05', MIN, 4, 2, ['arpeggio'], '7:4 10:t8 14:t8 10:t8 7:4 3:4'),
  trip('m7-trip-06', MIN, 4, 2, ['arpeggio', 'motif'], '3:t8 7:t8 10:t8 7:t8 10:t8 14:t8 10:8'),
  trip('m7-trip-07', MIN, 2, 3, ['arpeggio'], '10:t8 14:t8 17:t8 14:4'),
  trip('m7-trip-08', MIN, 2, 3, ['enclosure'], '5:t8 4:t8 2:t8 3:4'),
  trip('m7-trip-09', MIN, 2, 3, ['enclosure', 'chromatic'], '10:t8 8:t8 6:t8 7:4'),
  trip('m7-trip-10', MIN, 4, 3, ['scale'], '3:2 5:2 7:t8 5:t8 3:t8 2:4 0:4'),
  trip('m7-trip-11', MIN, 4, 3, ['motif'], '7:4 5:t8 3:t8 2:t8 3:8'),
  trip('m7-trip-12', MIN, 2, 3, ['guide-tone'], '10:tq 7:tq 3:tq'),
  trip('m7-trip-13', MIN, 2, 3, ['guide-tone'], '7:tqx2 3:tq'),
  trip('m7-trip-14', MIN, 4, 3, ['guide-tone'], '10:tq 7:tq 3:tq 0:8'),
  trip('m7-trip-15', MIN, 4, 4, ['arpeggio'], '3:tq 7:tq 10:tq 14:tq 10:tq 7:tq'),
  trip('m7-trip-16', MIN, 2, 4, ['chromatic'], '10:2 7:t16 6:t16 7:t16 3:4'),
  trip('m7-trip-17', MIN, 2, 4, ['scale'], '0:2 2:t16 3:t16 5:t16 7:2 10:2'),
  trip('m7-trip-18', MIN, 4, 4, ['enclosure'], '7:2 3:t16 2:t16 3:t16 10:4 14:t8 10:t8 7:t8 3:4'),
];

/* ---------------- iiø: m7b5 ---------------- */
const M7B5: Fragment[] = [
  trip('m7b5-trip-01', HALF, 2, 2, ['arpeggio'], '0:t8 3:t8 6:t8 10:4'),
  trip('m7b5-trip-02', HALF, 2, 2, ['arpeggio'], '10:t8 6:t8 3:t8 0:4'),
  trip('m7b5-trip-03', HALF, 4, 2, ['arpeggio'], '3:t8 6:t8 10:t8 15:4 10:t8 6:t8 3:t8 6:4'),
  trip('m7b5-trip-04', HALF, 2, 3, ['enclosure'], '10:t8 7:t8 5:t8 6:4'),
  trip('m7b5-trip-05', HALF, 2, 3, ['enclosure'], '5:t8 4:t8 2:t8 3:4'),
  trip('m7b5-trip-06', HALF, 4, 3, ['scale', 'bebop'], '10:2 8:2 6:t8 5:t8 3:t8 5:4 3:4'),
  trip('m7b5-trip-07', HALF, 4, 3, ['guide-tone'], '10:tq 6:tq 3:tq 5:8'),
  trip('m7b5-trip-08', HALF, 4, 3, ['arpeggio', 'scale'], '3:t8 6:t8 10:t8 8:2 6:2 5:4 3:4'),
  trip('m7b5-trip-09', HALF, 4, 4, ['arpeggio'], '3:tq 6:tq 10:tq 15:tq 10:tq 6:tq'),
  trip('m7b5-trip-10', HALF, 2, 4, ['chromatic'], '10:2 8:t16 6:t16 8:t16 6:4'),
];

/* ---------------- V: dom7 ---------------- */
const D7: Fragment[] = [
  trip('dom7-trip-01', DOM, 2, 2, ['arpeggio'], '0:t8 4:t8 7:t8 10:4'),
  trip('dom7-trip-02', DOM, 2, 2, ['arpeggio'], '4:t8 7:t8 10:t8 14:4'),
  trip('dom7-trip-03', DOM, 2, 2, ['arpeggio'], '10:t8 7:t8 4:t8 0:4'),
  trip('dom7-trip-04', DOM, 4, 2, ['arpeggio'], '0:t8 4:t8 7:t8 10:4 9:t8 7:t8 4:t8 4:4'),
  trip('dom7-trip-05', DOM, 4, 2, ['arpeggio'], '7:4 10:t8 14:t8 10:t8 9:4 7:4'),
  trip('dom7-trip-06', DOM, 4, 2, ['arpeggio'], '4:t8 7:t8 10:t8 14:t8 10:t8 7:t8 4:8'),
  trip('dom7-trip-07', DOM, 2, 3, ['arpeggio'], '10:t8 14:t8 16:t8 14:4'),
  trip('dom7-trip-08', DOM, 2, 3, ['enclosure'], '7:t8 5:t8 3:t8 4:4'),
  trip('dom7-trip-09', DOM, 2, 3, ['enclosure', 'chromatic'], '9:t8 8:t8 6:t8 7:4'),
  trip('dom7-trip-10', DOM, 4, 3, ['bebop', 'scale'], '10:t8 9:t8 7:t8 5:2 4:2 2:t8 4:t8 7:t8 10:4'),
  trip('dom7-trip-11', DOM, 4, 3, ['arpeggio'], '4:2 7:2 10:t8 14:t8 10:t8 9:4 7:4'),
  trip('dom7-trip-12', DOM, 4, 3, ['guide-tone'], '10:tq 9:tq 7:tq 4:8'),
  trip('dom7-trip-13', DOM, 2, 3, ['guide-tone'], '4:tq 7:tq 10:tq'),
  trip('dom7-trip-14', DOM, 4, 4, ['arpeggio'], '0:tq 4:tq 7:tq 10:tq 14:tq 10:tq'),
  trip('dom7-trip-15', DOM, 2, 4, ['chromatic'], '7:2 4:t16 5:t16 4:t16 7:4'),
  trip('dom7-trip-16', DOM, 4, 4, ['bebop', 'scale'], '0:t8 2:t8 4:t8 7:2 9:2 10:t16 9:t16 7:t16 4:2 2:2 0:2'),
];

/* ---------------- V: dom7alt ---------------- */
const D7ALT: Fragment[] = [
  trip('dom7alt-trip-01', ALT, 2, 2, ['altered', 'arpeggio'], '4:t8 8:t8 10:t8 13:4'),
  trip('dom7alt-trip-02', ALT, 2, 2, ['altered', 'arpeggio'], '10:t8 8:t8 4:t8 0:4'),
  trip('dom7alt-trip-03', ALT, 2, 3, ['altered'], '13:t8 10:t8 8:t8 4:4'),
  trip('dom7alt-trip-04', ALT, 2, 3, ['altered', 'enclosure'], '6:t8 5:t8 3:t8 4:4'),
  trip('dom7alt-trip-05', ALT, 4, 3, ['altered', 'arpeggio'], '4:t8 8:t8 10:t8 13:t8 15:t8 13:t8 10:8'),
  trip('dom7alt-trip-06', ALT, 4, 3, ['altered', 'scale'], '10:t8 8:t8 6:t8 4:4 3:t8 1:t8 0:t8 -2:4'),
  trip('dom7alt-trip-07', ALT, 4, 3, ['altered', 'guide-tone'], '10:tq 8:tq 6:tq 4:8'),
  trip('dom7alt-trip-08', ALT, 2, 3, ['altered', 'guide-tone'], '13:tq 10:tq 4:tq'),
  trip('dom7alt-trip-09', ALT, 4, 4, ['altered'], '4:tq 8:tq 10:tq 13:tq 15:tq 13:tq'),
  trip('dom7alt-trip-10', ALT, 2, 4, ['altered', 'chromatic'], '15:2 13:t16 12:t16 10:t16 8:4'),
  trip('dom7alt-trip-11', ALT, 2, 4, ['altered'], '4:t16 6:t16 8:t16 10:2 13:4'),
  trip('dom7alt-trip-12', ALT, 4, 4, ['altered', 'chromatic'], '4:t16 6:t16 8:t16 10:t16 12:t16 13:t16 15:2 13:2 12:4 10:2 8:2'),
  trip('dom7alt-trip-13', ALT, 4, 4, ['altered', 'chromatic'], '13:t16 12:t16 10:t16 8:t16 6:t16 4:t16 3:2 4:2 6:4 4:4'),
];

/* ---------------- I: maj7 ---------------- */
const MAJ7: Fragment[] = [
  trip('maj7-trip-01', MAJ, 2, 2, ['arpeggio'], '0:t8 4:t8 7:t8 11:4'),
  trip('maj7-trip-02', MAJ, 2, 2, ['arpeggio'], '4:t8 7:t8 11:t8 14:4'),
  trip('maj7-trip-03', MAJ, 2, 2, ['arpeggio'], '11:t8 7:t8 4:t8 0:4'),
  trip('maj7-trip-04', MAJ, 4, 2, ['arpeggio'], '0:t8 4:t8 7:t8 11:4 9:t8 7:t8 4:t8 7:4'),
  trip('maj7-trip-05', MAJ, 4, 2, ['arpeggio'], '7:4 11:t8 14:t8 11:t8 9:4 7:4'),
  trip('maj7-trip-06', MAJ, 2, 3, ['enclosure'], '7:t8 5:t8 3:t8 4:4'),
  trip('maj7-trip-07', MAJ, 2, 3, ['enclosure', 'chromatic'], '11:t8 8:t8 6:t8 7:4'),
  trip('maj7-trip-08', MAJ, 4, 3, ['bebop', 'scale'], '7:t8 6:t8 4:t8 2:2 0:2 -1:t8 2:t8 4:t8 7:4'),
  trip('maj7-trip-09', MAJ, 4, 3, ['guide-tone'], '11:tq 9:tq 7:tq 4:8'),
  trip('maj7-trip-10', MAJ, 4, 3, ['scale'], '11:2 9:2 7:t8 4:t8 2:t8 4:4 7:4'),
  trip('maj7-trip-11', MAJ, 4, 3, ['motif'], '4:t8 7:t8 4:t8 2:t8 4:t8 0:t8 -1:4 0:4'),
  trip('maj7-trip-12', MAJ, 4, 4, ['arpeggio'], '0:tq 4:tq 7:tq 11:tq 14:tq 11:tq'),
  trip('maj7-trip-13', MAJ, 2, 4, ['chromatic'], '7:2 4:t16 6:t16 7:t16 11:4'),
  trip('maj7-trip-14', MAJ, 4, 4, ['scale', 'arpeggio'], '4:2 7:2 9:t16 11:t16 9:t16 7:2 4:t8 7:t8 11:t8 9:4'),
  // endings: triplet pickup, then hold the resolution
  trip('maj7-trip-15', MAJ, 4, 3, ['arpeggio'], '0:t8 4:t8 7:t8 11:4 4:8', true),
  trip('maj7-trip-16', MAJ, 2, 3, ['enclosure'], '7:t8 4:t8 2:t8 0:4', true),
  trip('maj7-trip-17', MAJ, 4, 3, ['scale'], '11:2 9:2 7:t8 4:t8 2:t8 4:8', true),
];

/* ---------------- i: m6 / mMaj7 (no b7 anywhere) ---------------- */
const M6: Fragment[] = [
  trip('m6-trip-01', MIN6, 2, 2, ['arpeggio'], '0:t8 3:t8 7:t8 9:4'),
  trip('m6-trip-02', MIN6, 2, 2, ['arpeggio'], '3:t8 7:t8 9:t8 14:4'),
  trip('m6-trip-03', MIN6, 2, 2, ['arpeggio'], '9:t8 7:t8 3:t8 0:4'),
  trip('m6-trip-04', MIN6, 4, 2, ['arpeggio'], '0:t8 3:t8 7:t8 9:4 7:t8 3:t8 0:t8 3:4'),
  trip('m6-trip-05', MIN6, 2, 3, ['enclosure'], '7:t8 4:t8 2:t8 3:4'),
  trip('m6-trip-06', MIN6, 2, 3, ['enclosure', 'chromatic'], '9:t8 8:t8 6:t8 7:4'),
  trip('m6-trip-07', MIN6, 4, 3, ['motif'], '3:4 5:t8 3:t8 2:t8 0:4 3:4'),
  trip('m6-trip-08', MIN6, 4, 3, ['guide-tone'], '9:tq 7:tq 3:tq 0:8'),
  trip('m6-trip-09', MIN6, 4, 4, ['arpeggio'], '0:tq 3:tq 7:tq 9:tq 11:tq 9:tq'),
  trip('m6-trip-10', MIN6, 2, 4, ['chromatic'], '7:2 3:t16 5:t16 7:t16 9:4'),
  // endings
  trip('m6-trip-11', MIN6, 4, 3, ['arpeggio'], '0:t8 3:t8 7:t8 9:4 7:8', true),
  trip('m6-trip-12', MIN6, 2, 3, ['enclosure'], '7:t8 3:t8 2:t8 0:4', true),
  trip('m6-trip-13', MIN6, 4, 3, ['scale'], '9:2 7:2 3:t8 2:t8 0:t8 3:8', true),
  trip('m6-trip-14', MIN6, 4, 3, ['guide-tone'], '7:tq 3:tq 0:tq 3:8', true),
];

/* ---------------- more plain triplet arpeggios (level 2) ----------------
 * The generator now draws from much bigger straight-8th pools, so these keep triplets a regular Intermediate flavour. */
const MORE: Fragment[] = [
  trip('m7-trip-19', MIN, 2, 2, ['arpeggio'], '3:t8 7:t8 10:t8 7:4'),
  trip('m7-trip-20', MIN, 4, 2, ['arpeggio'], '3:4 7:t8 10:t8 14:t8 10:4 7:4'),
  trip('m7b5-trip-11', HALF, 2, 2, ['arpeggio'], '3:t8 6:t8 10:t8 6:4'),
  trip('m7b5-trip-12', HALF, 4, 2, ['arpeggio'], '3:4 6:t8 10:t8 15:t8 10:4 6:4'),
  trip('dom7-trip-17', DOM, 2, 2, ['arpeggio'], '4:t8 7:t8 10:t8 7:4'),
  trip('dom7-trip-18', DOM, 4, 2, ['arpeggio'], '4:4 7:t8 10:t8 14:t8 10:4 7:4'),
  trip('dom7alt-trip-14', ALT, 2, 2, ['altered', 'arpeggio'], '4:t8 8:t8 10:t8 8:4'),
  trip('maj7-trip-18', MAJ, 2, 2, ['arpeggio'], '4:t8 7:t8 11:t8 7:4'),
  trip('maj7-trip-19', MAJ, 4, 2, ['arpeggio'], '4:4 7:t8 11:t8 14:t8 11:4 7:4'),
  trip('m6-trip-15', MIN6, 2, 2, ['arpeggio'], '3:t8 7:t8 9:t8 7:4'),
  trip('m6-trip-16', MIN6, 4, 2, ['arpeggio'], '3:4 7:t8 9:t8 14:t8 9:4 7:4'),
  // level 3: a triplet beat inside 8th-note lines
  trip('m7-trip-21', MIN, 2, 3, ['scale'], '7:4 5:t8 3:t8 2:t8'),
  trip('m7-trip-22', MIN, 2, 3, ['arpeggio', 'scale'], '10:t8 7:t8 3:t8 5:2 3:2'),
  trip('m7-trip-23', MIN, 4, 3, ['arpeggio'], '3:2 5:2 7:t8 10:t8 14:t8 10:4 7:4'),
  trip('m7-trip-24', MIN, 4, 3, ['arpeggio', 'scale'], '10:t8 7:t8 3:t8 0:2 3:2 5:2 7:2 10:4'),
  trip('dom7-trip-19', DOM, 2, 3, ['scale'], '7:4 5:t8 4:t8 2:t8'),
  trip('dom7-trip-20', DOM, 2, 3, ['arpeggio', 'scale'], '10:t8 7:t8 4:t8 2:2 4:2'),
  trip('dom7-trip-21', DOM, 4, 3, ['arpeggio'], '4:2 7:2 10:t8 9:t8 7:t8 4:2 2:2 0:4'),
  trip('dom7alt-trip-15', ALT, 2, 3, ['altered', 'arpeggio'], '4:4 10:t8 13:t8 15:t8'),
  trip('dom7alt-trip-16', ALT, 4, 3, ['altered', 'arpeggio'], '4:2 8:2 10:t8 13:t8 15:t8 13:2 10:2 8:4'),
  trip('maj7-trip-20', MAJ, 2, 3, ['arpeggio'], '4:4 7:t8 9:t8 11:t8'),
  trip('maj7-trip-21', MAJ, 4, 3, ['arpeggio', 'scale'], '4:2 7:2 11:t8 9:t8 7:t8 4:2 2:2 0:4'),
  trip('m7b5-trip-13', HALF, 2, 3, ['arpeggio'], '3:4 6:t8 5:t8 3:t8'),
  trip('m7b5-trip-14', HALF, 4, 3, ['arpeggio', 'scale'], '3:2 6:2 10:t8 8:t8 6:t8 5:2 3:2 0:4'),
  trip('m6-trip-17', MIN6, 2, 3, ['arpeggio'], '3:4 7:t8 9:t8 11:t8'),
  trip('m6-trip-18', MIN6, 4, 3, ['arpeggio', 'scale'], '3:2 7:2 9:t8 11:t8 14:t8 11:2 9:2 7:4'),
  // level 4: a 16th-triplet turn
  trip('m7-trip-25', MIN, 4, 4, ['chromatic', 'arpeggio'], '3:2 7:2 10:t16 12:t16 14:t16 12:2 10:2 7:2 3:2 0:2'),
  trip('dom7-trip-22', DOM, 4, 4, ['chromatic', 'arpeggio'], '4:2 7:2 10:t16 12:t16 14:t16 12:2 10:2 9:2 7:2 4:2'),
  trip('dom7alt-trip-17', ALT, 4, 4, ['altered', 'chromatic'], '4:2 8:2 10:t16 12:t16 13:t16 12:2 10:2 8:2 6:2 4:2'),
  trip('maj7-trip-22', MAJ, 4, 4, ['chromatic', 'arpeggio'], '4:2 7:2 11:t16 12:t16 14:t16 12:2 11:2 9:2 7:2 4:2'),
  trip('m7b5-trip-15', HALF, 4, 4, ['chromatic', 'arpeggio'], '3:2 6:2 10:t16 12:t16 15:t16 12:2 10:2 8:2 6:2 3:2'),
  trip('m6-trip-19', MIN6, 4, 4, ['chromatic', 'arpeggio'], '3:2 7:2 9:t16 11:t16 14:t16 11:2 9:2 7:2 3:2 0:2'),
  // more quarter-triplets and 16th-triplet turns
  trip('m7-trip-26', MIN, 2, 3, ['guide-tone'], '7:tq 10:tq 14:tq'),
  trip('m7-trip-27', MIN, 2, 3, ['guide-tone'], '14:tq 10:tq 7:tq'),
  trip('m7-trip-28', MIN, 2, 4, ['chromatic', 'arpeggio'], '7:2 10:t16 12:t16 14:t16 10:4'),
  trip('dom7-trip-23', DOM, 2, 3, ['guide-tone'], '10:tq 7:tq 4:tq'),
  trip('dom7-trip-24', DOM, 2, 3, ['guide-tone'], '7:tq 10:tq 14:tq'),
  trip('dom7-trip-25', DOM, 2, 4, ['chromatic', 'arpeggio'], '4:2 7:t16 9:t16 10:t16 7:4'),
  trip('dom7alt-trip-18', ALT, 2, 3, ['altered', 'guide-tone'], '10:tq 4:tq 13:tq'),
  trip('dom7alt-trip-19', ALT, 2, 4, ['altered', 'chromatic'], '4:2 8:t16 10:t16 13:t16 10:4'),
  trip('maj7-trip-23', MAJ, 2, 3, ['guide-tone'], '11:tq 7:tq 4:tq'),
  trip('maj7-trip-24', MAJ, 2, 3, ['guide-tone'], '4:tq 7:tq 11:tq'),
  trip('maj7-trip-25', MAJ, 2, 4, ['chromatic', 'arpeggio'], '4:2 7:t16 9:t16 11:t16 7:4'),
  trip('m7b5-trip-16', HALF, 2, 3, ['guide-tone'], '10:tq 6:tq 3:tq'),
  trip('m7b5-trip-17', HALF, 2, 4, ['chromatic', 'arpeggio'], '3:2 6:t16 8:t16 10:t16 6:4'),
  trip('m6-trip-20', MIN6, 2, 3, ['guide-tone'], '9:tq 7:tq 3:tq'),
  trip('m6-trip-21', MIN6, 2, 4, ['chromatic', 'arpeggio'], '3:2 7:t16 9:t16 11:t16 7:4'),
  trip('m7-trip-29', MIN, 4, 4, ['arpeggio'], '3:tq 7:tq 10:tq 14:2 12:2 10:2 7:2'),
  trip('dom7-trip-26', DOM, 4, 4, ['arpeggio'], '4:tq 7:tq 10:tq 9:2 7:2 4:2 2:2'),
  trip('maj7-trip-26', MAJ, 4, 4, ['arpeggio'], '4:tq 7:tq 11:tq 9:2 7:2 4:2 2:2'),
  trip('dom7alt-trip-20', ALT, 4, 4, ['altered', 'arpeggio'], '4:tq 10:tq 13:tq 10:2 8:2 6:2 4:2'),
  // 16th-triplet turns (level 4): scale-step triplets inside chord-tone 8th lines
  trip('m7-trip-30', MIN, 2, 4, ['arpeggio', 'scale'], '7:t16 5:t16 3:t16 2:2 0:4'),
  trip('m7-trip-31', MIN, 2, 4, ['arpeggio', 'scale'], '-2:t16 0:t16 2:t16 3:2 0:4'),
  trip('m7-trip-32', MIN, 2, 4, ['arpeggio', 'scale'], '3:t16 5:t16 7:t16 9:2 12:4'),
  trip('m7-trip-33', MIN, 2, 4, ['arpeggio', 'scale'], '12:2 14:t16 15:t16 17:t16 19:4'),
  trip('m7-trip-34', MIN, 4, 4, ['arpeggio', 'scale'], '12:2 15:2 14:t16 12:t16 10:t16 7:2 12:2 15:2 12:2 15:2'),
  trip('m7-trip-35', MIN, 4, 4, ['arpeggio', 'scale'], '12:2 7:2 5:t16 3:t16 2:t16 3:2 -2:2 0:2 3:2 0:2'),
  trip('m7-trip-36', MIN, 4, 4, ['arpeggio', 'scale'], '19:2 15:2 14:t16 12:t16 10:t16 12:2 7:2 10:2 15:2 12:2'),
  trip('m7-trip-37', MIN, 4, 4, ['arpeggio', 'scale'], '3:2 0:2 2:t16 3:t16 5:t16 3:2 7:2 10:2 7:2 3:2'),
  trip('m7-trip-38', MIN, 4, 4, ['arpeggio', 'scale'], '7:2 10:2 9:t16 7:t16 5:t16 7:2 3:2 -2:2 3:2 7:2'),
  trip('dom7-trip-27', DOM, 2, 4, ['arpeggio', 'scale'], '7:2 9:t16 10:t16 12:t16 16:4'),
  trip('dom7-trip-28', DOM, 2, 4, ['arpeggio', 'scale'], '0:2 -2:t16 -3:t16 -5:t16 -2:4'),
  trip('dom7-trip-29', DOM, 2, 4, ['arpeggio', 'scale'], '10:2 9:t16 7:t16 5:t16 4:4'),
  trip('dom7-trip-30', DOM, 2, 4, ['arpeggio', 'scale'], '12:t16 10:t16 9:t16 7:2 4:4'),
  trip('dom7-trip-31', DOM, 4, 4, ['arpeggio', 'scale'], '7:2 10:2 9:t16 7:t16 5:t16 7:2 4:2 0:2 -2:2 0:2'),
  trip('dom7-trip-32', DOM, 4, 4, ['arpeggio', 'scale'], '0:2 -2:2 0:t16 2:t16 4:t16 7:2 0:2 -2:2 0:2 -2:2'),
  trip('dom7-trip-33', DOM, 4, 4, ['arpeggio', 'scale'], '16:2 19:2 17:t16 16:t16 14:t16 10:2 12:2 16:2 12:2 16:2'),
  trip('dom7-trip-34', DOM, 4, 4, ['arpeggio', 'scale'], '12:2 7:2 9:t16 10:t16 12:t16 10:2 16:2 19:2 16:2 19:2'),
  trip('dom7-trip-35', DOM, 4, 4, ['arpeggio', 'scale'], '4:2 7:2 9:t16 10:t16 12:t16 16:2 10:2 7:2 10:2 12:2'),
  trip('maj7-trip-27', MAJ, 2, 4, ['arpeggio', 'scale'], '12:t16 11:t16 9:t16 7:2 4:4'),
  trip('maj7-trip-28', MAJ, 2, 4, ['arpeggio', 'scale'], '0:2 2:t16 4:t16 5:t16 7:4'),
  trip('maj7-trip-29', MAJ, 2, 4, ['arpeggio', 'scale'], '0:2 2:t16 4:t16 5:t16 4:4'),
  trip('maj7-trip-30', MAJ, 2, 4, ['arpeggio', 'scale'], '7:t16 5:t16 4:t16 2:2 0:4'),
  trip('maj7-trip-31', MAJ, 4, 4, ['arpeggio', 'scale'], '7:2 4:2 5:t16 7:t16 9:t16 12:2 7:2 4:2 7:2 4:2'),
  trip('maj7-trip-32', MAJ, 4, 4, ['arpeggio', 'scale'], '4:2 0:2 2:t16 4:t16 5:t16 4:2 7:2 12:2 7:2 12:2'),
  trip('maj7-trip-33', MAJ, 4, 4, ['arpeggio', 'scale'], '12:2 16:2 14:t16 12:t16 11:t16 7:2 12:2 7:2 4:2 7:2'),
  trip('maj7-trip-34', MAJ, 4, 4, ['arpeggio', 'scale'], '16:2 19:2 17:t16 16:t16 14:t16 12:2 16:2 19:2 16:2 12:2'),
  trip('maj7-trip-35', MAJ, 4, 4, ['arpeggio', 'scale'], '12:2 7:2 5:t16 4:t16 2:t16 0:2 4:2 7:2 4:2 0:2'),
  trip('dom7alt-trip-21', ALT, 2, 4, ['altered', 'chromatic'], '3:2 1:t16 0:t16 -2:t16 0:4'),
  trip('dom7alt-trip-22', ALT, 2, 4, ['altered', 'chromatic'], '10:t16 8:t16 6:t16 4:2 0:4'),
  trip('dom7alt-trip-23', ALT, 2, 4, ['altered', 'chromatic'], '8:2 10:t16 12:t16 13:t16 10:4'),
  trip('dom7alt-trip-24', ALT, 2, 4, ['altered', 'chromatic'], '15:2 13:t16 12:t16 10:t16 6:4'),
  trip('dom7alt-trip-25', ALT, 4, 4, ['altered', 'chromatic'], '10:2 8:2 10:t16 12:t16 13:t16 12:2 16:2 15:2 16:2 12:2'),
  trip('dom7alt-trip-26', ALT, 4, 4, ['altered', 'chromatic'], '8:2 4:2 3:t16 1:t16 0:t16 4:2 3:2 6:2 3:2 8:2'),
  trip('dom7alt-trip-27', ALT, 4, 4, ['altered', 'chromatic'], '16:2 12:2 10:t16 8:t16 6:t16 8:2 4:2 3:2 4:2 3:2'),
  trip('dom7alt-trip-28', ALT, 4, 4, ['altered', 'chromatic'], '12:2 10:2 8:t16 6:t16 4:t16 3:2 0:2 3:2 6:2 4:2'),
  trip('dom7alt-trip-29', ALT, 4, 4, ['altered', 'chromatic'], '10:2 15:2 13:t16 12:t16 10:t16 8:2 12:2 8:2 3:2 4:2'),
  trip('m7b5-trip-18', HALF, 2, 4, ['arpeggio', 'scale'], '0:t16 2:t16 3:t16 5:2 3:4'),
  trip('m7b5-trip-19', HALF, 2, 4, ['arpeggio', 'scale'], '12:2 14:t16 15:t16 17:t16 15:4'),
  trip('m7b5-trip-20', HALF, 2, 4, ['arpeggio', 'scale'], '6:t16 8:t16 10:t16 12:2 10:4'),
  trip('m7b5-trip-21', HALF, 2, 4, ['arpeggio', 'scale'], '10:t16 12:t16 14:t16 15:2 12:4'),
  trip('m7b5-trip-22', HALF, 4, 4, ['arpeggio', 'scale'], '6:2 3:2 5:t16 6:t16 8:t16 10:2 6:2 3:2 0:2 -2:2'),
  trip('m7b5-trip-23', HALF, 4, 4, ['arpeggio', 'scale'], '3:2 6:2 5:t16 3:t16 2:t16 -2:2 0:2 3:2 6:2 10:2'),
  trip('m7b5-trip-24', HALF, 4, 4, ['arpeggio', 'scale'], '15:2 10:2 8:t16 6:t16 5:t16 3:2 6:2 3:2 6:2 3:2'),
  trip('m7b5-trip-25', HALF, 4, 4, ['arpeggio', 'scale'], '10:2 12:2 10:t16 8:t16 6:t16 3:2 10:2 15:2 12:2 10:2'),
  trip('m7b5-trip-26', HALF, 4, 4, ['arpeggio', 'scale'], '-2:2 3:2 5:t16 6:t16 8:t16 10:2 6:2 3:2 -2:2 0:2'),
  trip('m6-trip-22', MIN6, 2, 4, ['arpeggio', 'scale'], '15:2 14:t16 12:t16 11:t16 15:4'),
  trip('m6-trip-23', MIN6, 2, 4, ['arpeggio', 'scale'], '19:t16 17:t16 15:t16 14:2 12:4'),
  trip('m6-trip-24', MIN6, 2, 4, ['arpeggio', 'scale'], '15:2 14:t16 12:t16 11:t16 12:4'),
  trip('m6-trip-25', MIN6, 2, 4, ['arpeggio', 'scale'], '0:2 2:t16 3:t16 5:t16 3:4'),
  trip('m6-trip-26', MIN6, 4, 4, ['arpeggio', 'scale'], '0:2 3:2 5:t16 7:t16 9:t16 7:2 12:2 9:2 7:2 3:2'),
  trip('m6-trip-27', MIN6, 4, 4, ['arpeggio', 'scale'], '15:2 12:2 11:t16 9:t16 7:t16 3:2 9:2 7:2 12:2 7:2'),
  trip('m6-trip-28', MIN6, 4, 4, ['arpeggio', 'scale'], '15:2 12:2 11:t16 9:t16 7:t16 9:2 3:2 7:2 3:2 7:2'),
  trip('m6-trip-29', MIN6, 4, 4, ['arpeggio', 'scale'], '3:2 0:2 2:t16 3:t16 5:t16 7:2 9:2 7:2 9:2 12:2'),
  trip('m6-trip-30', MIN6, 4, 4, ['arpeggio', 'scale'], '15:2 12:2 11:t16 9:t16 7:t16 3:2 9:2 12:2 9:2 12:2'),
];

/** Triplet fragments, already on the engine grid (do not scale). */
export const TRIPLET_FRAGMENTS: Fragment[] = [...M7, ...M7B5, ...D7, ...D7ALT, ...MAJ7, ...M6, ...MORE];
