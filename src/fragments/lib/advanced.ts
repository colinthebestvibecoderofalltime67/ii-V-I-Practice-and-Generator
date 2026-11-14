import type { ChordQualityId, FragTag, Fragment, Tier } from '../../types';
import { parseNotes } from './notation';

/**
 * Advanced vocabulary (levels 3-4), original and hand-written. Same compact notation as original.ts
 * (rel:dur in 16ths, scaled x3 on load; "r" = rest). Idioms, each tagged so the Analyze view can name them:
 *
 *  - Rhythmic displacement: a 3- or 5-note motif cycled through eight 8ths so every restatement starts on a
 *    different part of the beat, a motif that starts off the beat and is restated on beat 3, and dotted-8th
 *    (3-3-2) groupings. Tags: motif, sequence.
 *  - Triad pairs: two triads from the parent scale alternated (7alt: the b13-R-#9 and #11-b7-b9 triads, i.e. the
 *    bVI and bV major triads, all altered tones; maj7: I and II = lydian; m7: bIII and IV = dorian; dom7: I and
 *    bVII = mixolydian). Tags: arpeggio, sequence.
 *  - Barry Harris 6th-diminished scale (the major / minor 6th scale with the added half step, eight notes, so
 *    chord tones land on the beats going up or down). Tags: scale, bebop.
 *  - Superimposition: a ii-V played inside one chord (Bbm7-Eb7 and a Db7 arpeggio over G7alt, Gm7-C7 over C7,
 *    Dm7b5-G7alt over Cm6). Tags: arpeggio, chromatic (the tritone-sub ones also altered).
 *  - Outside-in: a phrase shifted up a half step and slipped back inside, landing on a chord tone on the strong beat.
 *    Tags: chromatic, enclosure.
 *
 * Strong-beat rule (beats 1 and 3) and the 7alt rule (no natural 5 / 13 on a beat) are checked in tests/fragments.test.ts.
 */
type Q = ChordQualityId;
const a = (id: string, qualities: Q[], beats: 2 | 4, level: Tier, tags: FragTag[], notes: string): Fragment =>
  ({ id, qualities, beats, notes: parseNotes(notes, 1), tags, level, source: 'original' });

const MIN: Q[] = ['m7'];
const HALF: Q[] = ['m7b5'];
const DOM: Q[] = ['dom7'];
const ALT: Q[] = ['dom7alt'];
const MAJ: Q[] = ['maj7'];
const MIN6: Q[] = ['m6', 'mMaj7'];

export const ADVANCED_FRAGMENTS: Fragment[] = [
  /* ---- rhythmic displacement ---- */
  a('m7-adv-01', MIN, 4, 3, ['motif', 'sequence', 'arpeggio'], '7:2 10:2 14:2 12:2 10:2 7:2 10:2 14:2'),
  a('m7-adv-02', MIN, 4, 3, ['motif', 'sequence'], '3:2 5:2 7:2 10:2 7:2 3:2 5:2 7:2'),
  a('m7-adv-03', MIN, 4, 3, ['motif'], 'r:2 7:2 10:2 14:2 7:2 10:2 14:2 r:2'),
  a('m7-adv-04', MIN, 4, 4, ['motif', 'sequence'], '3:3 7:3 10:2 14:3 10:3 7:2'),
  a('dom7-adv-01', DOM, 4, 3, ['motif', 'sequence', 'arpeggio'], '4:2 7:2 10:2 9:2 7:2 4:2 7:2 10:2'),
  a('dom7-adv-02', DOM, 4, 3, ['motif', 'sequence'], '4:2 5:2 7:2 10:2 7:2 4:2 5:2 7:2'),
  a('dom7-adv-03', DOM, 4, 3, ['motif'], 'r:2 4:2 7:2 10:2 4:2 7:2 10:2 r:2'),
  a('dom7-adv-04', DOM, 4, 4, ['motif', 'sequence'], '4:3 7:3 10:2 9:3 7:3 4:2'),
  a('maj7-adv-01', MAJ, 4, 3, ['motif', 'sequence', 'arpeggio'], '7:2 11:2 14:2 12:2 11:2 7:2 11:2 14:2'),
  a('maj7-adv-02', MAJ, 4, 3, ['motif', 'sequence'], '4:2 7:2 9:2 11:2 9:2 4:2 7:2 9:2'),
  a('maj7-adv-03', MAJ, 4, 4, ['motif', 'sequence'], '4:3 7:3 11:2 14:3 11:3 7:2'),
  a('dom7alt-adv-01', ALT, 4, 3, ['altered', 'motif', 'sequence'], '4:2 10:2 13:2 10:2 8:2 4:2 10:2 13:2'),
  a('dom7alt-adv-02', ALT, 4, 4, ['altered', 'motif', 'sequence'], '4:3 10:3 13:2 15:3 13:3 10:2'),
  a('dom7alt-adv-03', ALT, 4, 3, ['altered', 'motif'], 'r:2 8:2 10:2 13:2 8:2 10:2 13:2 r:2'),
  a('m6-adv-01', MIN6, 4, 3, ['motif', 'sequence', 'arpeggio'], '3:2 7:2 9:2 12:2 9:2 3:2 7:2 9:2'),
  a('m7b5-adv-01', HALF, 4, 3, ['motif', 'sequence', 'arpeggio'], '3:2 6:2 10:2 12:2 10:2 3:2 6:2 10:2'),

  /* ---- triad pairs ---- */
  a('dom7alt-adv-04', ALT, 4, 3, ['altered', 'arpeggio', 'sequence'], '10:2 13:2 18:2 15:2 12:2 8:2 12:2 15:2'),
  a('dom7alt-adv-05', ALT, 4, 4, ['altered', 'arpeggio', 'sequence'], '10:1 13:1 18:1 15:1 12:1 8:1 13:1 10:1 6:1 8:1 12:1 15:1 10:1 13:1 18:1 15:1'),
  a('dom7alt-adv-06', ALT, 2, 4, ['altered', 'arpeggio'], '10:1 13:1 18:1 15:1 12:1 8:1 12:1 15:1'),
  a('maj7-adv-04', MAJ, 4, 3, ['arpeggio', 'sequence'], '4:2 7:2 12:2 9:2 14:2 18:2 14:2 9:2'),
  a('maj7-adv-05', MAJ, 4, 4, ['arpeggio', 'sequence'], '16:1 12:1 7:1 14:1 9:1 6:1 12:1 7:1 4:1 9:1 6:1 2:1 7:1 4:1 0:1 -1:1'),
  a('maj7-adv-06', MAJ, 2, 4, ['arpeggio'], '0:1 4:1 7:1 6:1 9:1 14:1 9:1 6:1'),
  a('m7-adv-05', MIN, 4, 3, ['arpeggio', 'sequence'], '3:2 7:2 10:2 9:2 12:2 17:2 14:2 10:2'),
  a('m7-adv-06', MIN, 4, 4, ['arpeggio', 'sequence'], '10:1 7:1 3:1 12:1 9:1 5:1 3:1 7:1 10:1 5:1 9:1 12:1 10:1 7:1 3:1 0:1'),
  a('dom7-adv-05', DOM, 4, 3, ['arpeggio', 'sequence'], '4:2 7:2 12:2 10:2 14:2 17:2 14:2 10:2'),
  a('dom7-adv-06', DOM, 4, 4, ['arpeggio', 'sequence'], '4:1 7:1 12:1 10:1 14:1 17:1 14:1 10:1 7:1 4:1 0:1 2:1 5:1 4:1 2:1 0:1'),
  a('m6-adv-02', MIN6, 4, 4, ['arpeggio', 'sequence'], '3:1 7:1 12:1 11:1 14:1 11:1 7:1 11:1 7:1 3:1 0:1 -1:1 2:1 7:1 2:1 0:1'),

  /* ---- Barry Harris 6th-diminished scale ---- */
  a('maj7-adv-07', MAJ, 4, 3, ['scale', 'bebop'], '12:2 11:2 9:2 8:2 7:2 5:2 4:2 2:2'),
  a('maj7-adv-08', MAJ, 4, 3, ['scale', 'bebop'], '4:2 5:2 7:2 8:2 9:2 11:2 12:2 14:2'),
  a('maj7-adv-09', MAJ, 2, 4, ['scale', 'bebop'], '7:1 8:1 9:1 11:1 12:1 14:1 16:1 19:1'),
  a('maj7-adv-10', MAJ, 4, 4, ['scale', 'bebop'], '4:1 7:1 8:1 9:1 11:1 9:1 7:1 4:1 2:2 4:2 7:2 4:2'),
  a('m6-adv-03', MIN6, 4, 3, ['scale', 'bebop'], '12:2 11:2 9:2 8:2 7:2 5:2 3:2 2:2'),
  a('m6-adv-04', MIN6, 2, 4, ['scale', 'bebop'], '3:1 5:1 7:1 8:1 9:1 11:1 12:1 14:1'),
  a('m6-adv-05', MIN6, 4, 4, ['scale', 'bebop'], '3:1 5:1 7:1 8:1 9:1 7:1 5:1 3:1 0:2 3:2 7:2 3:2'),

  /* ---- superimposition: a ii-V inside one chord ---- */
  a('dom7alt-adv-07', ALT, 4, 4, ['altered', 'arpeggio', 'chromatic'], '6:2 10:2 13:2 16:2 13:2 10:2 6:2 4:2'),
  a('dom7alt-adv-08', ALT, 2, 4, ['altered', 'arpeggio', 'chromatic'], '6:1 10:1 13:1 16:1 13:1 10:1 6:2'),
  a('dom7alt-adv-09', ALT, 4, 4, ['altered', 'arpeggio'], '3:2 6:2 10:2 13:2 8:2 12:2 15:2 18:2'),
  a('dom7-adv-07', DOM, 4, 4, ['arpeggio', 'chromatic'], '10:2 14:2 17:2 19:2 16:2 12:2 10:2 7:2'),
  a('dom7-adv-08', DOM, 2, 4, ['arpeggio', 'chromatic'], '10:1 14:1 17:1 19:1 16:1 12:1 10:1 7:1'),
  a('m6-adv-06', MIN6, 4, 4, ['arpeggio', 'chromatic'], '2:2 5:2 8:2 12:2 11:2 14:2 8:2 7:2'),
  a('maj7-adv-11', MAJ, 4, 4, ['arpeggio', 'sequence'], '12:2 7:2 4:2 6:2 9:2 14:2 9:2 7:2'),

  /* ---- outside-in: half step up and back, resolving on the strong beat ---- */
  a('m7-adv-07', MIN, 4, 4, ['chromatic', 'enclosure'], '3:2 10:2 8:2 6:2 7:2 5:2 3:2 0:2'),
  a('m7-adv-08', MIN, 2, 4, ['chromatic', 'enclosure'], '7:1 10:1 14:1 8:1 11:1 15:1 10:1 7:1'),
  a('dom7-adv-09', DOM, 4, 4, ['chromatic', 'enclosure'], '10:2 7:2 5:2 3:2 4:2 7:2 10:2 7:2'),
  a('dom7-adv-10', DOM, 2, 4, ['chromatic', 'enclosure'], '10:1 8:1 6:1 7:1 4:2 7:2'),
  a('maj7-adv-12', MAJ, 4, 4, ['chromatic', 'enclosure'], '11:2 4:2 8:2 6:2 7:2 4:2 2:2 0:2'),
  a('m6-adv-07', MIN6, 2, 4, ['chromatic', 'enclosure'], '0:1 3:1 7:1 1:1 4:1 8:1 3:1 0:1'),
];
