import type { ChordQualityId, FragNote, FragTag, Fragment, Tier } from '../../types';

/**
 * Hand-written original fragment library (no transcribed solos).
 *
 * Compact note notation: "rel:dur" tokens separated by spaces.
 *   rel = semitones from the chord root ("r" = rest), dur = ticks (16ths, 4 per beat).
 *   A trailing "~" ties the note to the next one (which repeats the same rel).
 * Strong-beat rule: attacks on tick 0 and tick 8 are chord tones or listed tensions of every claimed quality.
 */
const parse = (s: string): FragNote[] =>
  s.trim().split(/\s+/).map(tok => {
    const tie = tok.endsWith('~');
    const [r, d] = (tie ? tok.slice(0, -1) : tok).split(':');
    const n: FragNote = { rel: r === 'r' ? null : Number(r), dur: Number(d) };
    if (tie) n.tie = true;
    return n;
  });

type Q = ChordQualityId;
const o = (id: string, qualities: Q[], beats: 2 | 4, level: Tier, tags: FragTag[], notes: string, ending = false): Fragment => {
  const f: Fragment = { id, qualities, beats, notes: parse(notes), tags, level, source: 'original' };
  if (ending) f.ending = true;
  return f;
};

const MIN: Q[] = ['m7'];
const HALF: Q[] = ['m7b5'];
const DOM: Q[] = ['dom7'];
const ALT: Q[] = ['dom7alt'];
const MAJ: Q[] = ['maj7'];
const MIN6: Q[] = ['m6', 'mMaj7'];

/* ---------------- ii: m7 ---------------- */
const M7: Fragment[] = [
  o('m7-orig-01', MIN, 4, 1, ['arpeggio'], '3:4 7:4 10:4 7:4'),
  o('m7-orig-02', MIN, 4, 1, ['scale'], '7:8 5:4 3:4'),
  o('m7-orig-03', MIN, 4, 1, ['arpeggio'], '10:4 7:4 3:4 0:4'),
  o('m7-orig-04', MIN, 4, 1, ['scale', 'arpeggio'], '0:4 2:4 3:4 7:4'),
  o('m7-orig-05', MIN, 4, 1, ['guide-tone'], '10:8 7:8'),
  o('m7-orig-06', MIN, 4, 2, ['scale'], '0:2 2:2 3:2 5:2 7:2 5:2 3:2 2:2'),
  o('m7-orig-07', MIN, 4, 2, ['arpeggio'], '7:2 10:2 14:2 10:2 7:2 3:2 0:2 3:2'),
  o('m7-orig-08', MIN, 4, 2, ['scale'], '3:2 5:2 7:2 9:2 10:2 9:2 7:2 5:2'),
  o('m7-orig-09', MIN, 4, 2, ['scale'], '10:2 9:2 7:2 5:2 3:2 5:2 7:2 10:2'),
  o('m7-orig-10', MIN, 4, 2, ['arpeggio', 'scale'], '0:2 3:2 7:2 3:2 5:2 3:2 2:2 0:2'),
  o('m7-orig-11', MIN, 4, 2, ['scale'], '14:2 12:2 10:2 7:2 5:2 3:2 2:2 0:2'),
  o('m7-orig-12', MIN, 4, 2, ['pentatonic'], '3:2 5:2 7:2 10:2 12:2 10:2 7:2 5:2'),
  o('m7-orig-13', MIN, 4, 3, ['enclosure'], '7:4 4:2 2:2 3:4 5:2 7:2'),
  o('m7-orig-14', MIN, 4, 3, ['chromatic'], '10:2 11:2 10:2 7:2 3:2 2:2 3:2 5:2'),
  o('m7-orig-15', MIN, 4, 3, ['chromatic', 'scale'], '10:2 9:2 7:2 6:2 5:2 3:2 2:2 0:2'),
  o('m7-orig-16', MIN, 4, 3, ['arpeggio'], 'r:2 3:2 7:2 10:2 14:3 12:1 10:4'),
  o('m7-orig-17', MIN, 4, 3, ['arpeggio', 'motif'], '7:3 5:1 3:2 2:2 0:2 3:2 7:4'),
  o('m7-orig-18', MIN, 4, 3, ['sequence', 'arpeggio'], '14:2 10:2 7:2 5:2 3:2 7:2 10:2 14:2'),
  o('m7-orig-19', MIN, 4, 4, ['scale', 'arpeggio'], '0:1 2:1 3:1 5:1 7:1 5:1 3:1 2:1 0:1 3:1 7:1 10:1 14:1 10:1 7:1 3:1'),
  o('m7-orig-20', MIN, 4, 4, ['chromatic', 'scale'], '7:1 6:1 5:1 3:1 2:1 0:1 -2:1 -5:1 -2:2 0:2 3:2 7:2'),
  o('m7-orig-21', MIN, 4, 4, ['enclosure'], '0:2 4:1 2:1 3:2 7:2 10:2 9:1 11:1 10:2 7:2'),
  o('m7-orig-22', MIN, 4, 4, ['arpeggio'], '7:2 17:2 15:2 12:2 10:2 7:2 3:2 0:2'),
  o('m7-orig-23', MIN, 4, 4, ['arpeggio', 'motif'], '3:3 7:1 10:3 14:1 10:3 7:1 3:2 2:1 0:1'),
  o('m7-orig-24', MIN, 4, 4, ['scale'], '7:4~ 7:2 5:1 3:1 2:2 0:2 3:2 7:2'),
  // two-beat
  o('m7-orig-25', MIN, 2, 1, ['arpeggio'], '3:4 7:4'),
  o('m7-orig-26', MIN, 2, 1, ['arpeggio'], '10:4 7:4'),
  o('m7-orig-27', MIN, 2, 1, ['guide-tone'], '7:4 3:4'),
  o('m7-orig-28', MIN, 2, 2, ['arpeggio'], '0:2 3:2 7:2 10:2'),
  o('m7-orig-29', MIN, 2, 2, ['scale', 'arpeggio'], '10:2 7:2 5:2 3:2'),
  o('m7-orig-30', MIN, 2, 2, ['scale'], '7:2 5:2 3:2 2:2'),
  o('m7-orig-31', MIN, 2, 2, ['scale'], '14:2 12:2 10:2 7:2'),
  o('m7-orig-32', MIN, 2, 2, ['arpeggio'], '3:2 5:2 7:2 10:2'),
  o('m7-orig-33', MIN, 2, 3, ['enclosure'], '7:2 4:1 2:1 3:2 0:2'),
  o('m7-orig-34', MIN, 2, 3, ['chromatic'], '10:2 11:1 10:1 7:2 3:2'),
  o('m7-orig-35', MIN, 2, 3, ['arpeggio'], '14:3 10:1 7:2 3:2'),
  o('m7-orig-36', MIN, 2, 4, ['arpeggio'], '3:1 5:1 7:1 10:1 14:1 10:1 7:1 3:1'),
  o('m7-orig-37', MIN, 2, 4, ['scale'], '14:1 12:1 10:1 7:1 5:1 3:1 2:1 0:1'),
];

/* ---------------- ii: m7b5 ---------------- */
const M7B5: Fragment[] = [
  o('m7b5-orig-01', HALF, 4, 1, ['arpeggio'], '3:4 6:4 10:4 6:4'),
  o('m7b5-orig-02', HALF, 4, 1, ['arpeggio'], '10:4 6:4 3:4 0:4'),
  o('m7b5-orig-03', HALF, 4, 1, ['arpeggio'], '6:8 3:4 0:4'),
  o('m7b5-orig-04', HALF, 4, 2, ['arpeggio'], '0:2 3:2 6:2 3:2 10:2 6:2 3:2 0:2'),
  o('m7b5-orig-05', HALF, 4, 2, ['scale'], '10:2 8:2 6:2 5:2 3:2 5:2 6:2 3:2'),
  o('m7b5-orig-06', HALF, 4, 2, ['scale', 'arpeggio'], '3:2 5:2 6:2 8:2 10:2 8:2 6:2 3:2'),
  o('m7b5-orig-07', HALF, 4, 3, ['enclosure'], '10:2 6:2 4:1 2:1 3:2 6:2 3:2 0:4'),
  o('m7b5-orig-08', HALF, 4, 3, ['scale'], '17:2 15:2 13:2 10:2 8:2 6:2 3:2 0:2'),
  o('m7b5-orig-09', HALF, 4, 3, ['arpeggio', 'motif'], '3:3 6:1 10:2 6:2 5:2 3:2 0:4'),
  o('m7b5-orig-10', HALF, 4, 3, ['scale'], 'r:2 6:2 10:2 13:2 8:2 6:2 5:2 3:2'),
  o('m7b5-orig-11', HALF, 4, 4, ['scale'], '0:1 1:1 3:1 5:1 6:1 8:1 10:1 12:1 10:2 6:2 3:2 0:2'),
  o('m7b5-orig-12', HALF, 4, 4, ['scale', 'sequence'], '10:1 8:1 6:1 5:1 3:1 5:1 6:1 8:1 10:2 15:2 12:2 10:2'),
  o('m7b5-orig-13', HALF, 4, 4, ['arpeggio'], '6:4~ 6:2 5:1 3:1 0:2 3:2 6:2 10:2'),
  o('m7b5-orig-14', HALF, 2, 1, ['arpeggio'], '3:4 6:4'),
  o('m7b5-orig-15', HALF, 2, 1, ['arpeggio'], '10:4 6:4'),
  o('m7b5-orig-16', HALF, 2, 2, ['arpeggio'], '0:2 3:2 6:2 10:2'),
  o('m7b5-orig-17', HALF, 2, 2, ['scale'], '10:2 8:2 6:2 3:2'),
  o('m7b5-orig-18', HALF, 2, 2, ['scale'], '6:2 5:2 3:2 0:2'),
  o('m7b5-orig-19', HALF, 2, 3, ['enclosure'], '10:2 6:2 4:1 2:1 3:2'),
  o('m7b5-orig-20', HALF, 2, 3, ['scale'], '17:2 13:2 10:2 6:2'),
  o('m7b5-orig-21', HALF, 2, 4, ['scale'], '3:1 5:1 6:1 8:1 10:1 8:1 6:1 5:1'),
];

/* ---------------- V: dom7 ---------------- */
const D7: Fragment[] = [
  o('dom7-orig-01', DOM, 4, 1, ['arpeggio'], '10:4 7:4 4:4 0:4'),
  o('dom7-orig-02', DOM, 4, 1, ['guide-tone'], '10:8 7:4 4:4'),
  o('dom7-orig-03', DOM, 4, 1, ['scale'], '7:4 4:4 2:4 0:4'),
  o('dom7-orig-04', DOM, 4, 1, ['arpeggio'], '0:4 4:4 7:4 10:4'),
  o('dom7-orig-05', DOM, 4, 2, ['scale'], '10:2 9:2 7:2 5:2 4:2 2:2 0:2 -2:2'),
  o('dom7-orig-06', DOM, 4, 2, ['arpeggio'], '4:2 7:2 10:2 7:2 4:2 2:2 0:2 2:2'),
  o('dom7-orig-07', DOM, 4, 2, ['scale'], '7:2 9:2 10:2 9:2 7:2 5:2 4:2 2:2'),
  o('dom7-orig-08', DOM, 4, 2, ['scale'], '0:2 2:2 4:2 5:2 7:2 5:2 4:2 2:2'),
  o('dom7-orig-09', DOM, 4, 2, ['arpeggio'], '14:2 12:2 10:2 7:2 4:2 7:2 10:2 7:2'),
  o('dom7-orig-10', DOM, 4, 2, ['scale', 'arpeggio'], '4:2 5:2 7:2 9:2 10:2 9:2 7:2 4:2'),
  o('dom7-orig-11', DOM, 4, 2, ['pentatonic'], '4:2 7:2 9:2 12:2 14:2 12:2 9:2 7:2'),
  o('dom7-orig-12', DOM, 4, 3, ['bebop', 'scale'], '12:2 11:2 10:2 9:2 7:2 5:2 4:2 2:2'),
  o('dom7-orig-13', DOM, 4, 3, ['enclosure', 'chromatic'], '7:2 5:2 3:2 4:2 7:2 4:2 2:2 0:2'),
  o('dom7-orig-14', DOM, 4, 3, ['arpeggio'], 'r:2 4:2 7:2 10:2 9:3 7:1 4:4'),
  o('dom7-orig-15', DOM, 4, 3, ['arpeggio', 'motif'], '14:3 10:1 7:2 4:2 2:2 4:2 7:4'),
  o('dom7-orig-16', DOM, 4, 3, ['chromatic'], '2:2 3:2 4:2 7:2 10:2 9:2 7:2 4:2'),
  o('dom7-orig-17', DOM, 4, 3, ['enclosure'], '4:2 8:2 6:2 7:2 10:2 7:2 4:4'),
  o('dom7-orig-18', DOM, 4, 4, ['chromatic', 'scale'], '10:1 9:1 7:1 5:1 4:1 2:1 0:1 -1:1 -2:2 2:2 4:2 7:2'),
  o('dom7-orig-19', DOM, 4, 4, ['bebop', 'scale'], '0:1 2:1 4:1 5:1 7:1 9:1 10:1 11:1 12:2 10:2 7:2 4:2'),
  o('dom7-orig-20', DOM, 4, 4, ['enclosure'], '4:2 7:1 8:1 6:1 7:1 10:2 14:2 10:2 9:1 7:1 4:2'),
  o('dom7-orig-21', DOM, 4, 4, ['arpeggio'], '4:2 16:2 14:2 10:2 7:2 4:2 2:2 0:2'),
  o('dom7-orig-22', DOM, 4, 4, ['arpeggio', 'motif'], 'r:1 4:1 7:2 10:1 9:1 7:1 4:1 10:3 7:1 4:2 2:1 0:1'),
  o('dom7-orig-23', DOM, 4, 4, ['arpeggio'], '4:2 7:2 10:4~ 10:2 9:1 7:1 4:2 2:1 0:1'),
  // two-beat
  o('dom7-orig-24', DOM, 2, 1, ['arpeggio'], '4:4 7:4'),
  o('dom7-orig-25', DOM, 2, 1, ['guide-tone'], '10:4 7:4'),
  o('dom7-orig-26', DOM, 2, 1, ['arpeggio'], '7:4 4:4'),
  o('dom7-orig-27', DOM, 2, 2, ['scale'], '10:2 9:2 7:2 4:2'),
  o('dom7-orig-28', DOM, 2, 2, ['arpeggio'], '4:2 7:2 10:2 14:2'),
  o('dom7-orig-29', DOM, 2, 2, ['scale'], '7:2 5:2 4:2 2:2'),
  o('dom7-orig-30', DOM, 2, 2, ['scale', 'arpeggio'], '2:2 4:2 7:2 9:2'),
  o('dom7-orig-31', DOM, 2, 3, ['enclosure'], '4:2 5:1 3:1 4:2 7:2'),
  o('dom7-orig-32', DOM, 2, 3, ['arpeggio'], '2:3 4:1 7:2 10:2'),
  o('dom7-orig-33', DOM, 2, 3, ['bebop'], '12:2 11:2 10:2 7:2'),
  o('dom7-orig-34', DOM, 2, 4, ['scale', 'chromatic'], '10:1 9:1 7:1 5:1 4:1 2:1 0:1 -2:1'),
  o('dom7-orig-35', DOM, 2, 4, ['arpeggio'], '4:1 7:1 10:1 14:1 16:1 14:1 10:1 7:1'),
];

/* ---------------- V: dom7alt ---------------- */
const D7ALT: Fragment[] = [
  o('dom7alt-orig-01', ALT, 4, 2, ['altered', 'arpeggio'], '4:4 10:4 13:4 10:4'),
  o('dom7alt-orig-02', ALT, 4, 2, ['altered', 'arpeggio'], '10:4 8:4 4:4 0:4'),
  o('dom7alt-orig-03', ALT, 4, 2, ['altered'], '4:4 10:4 13:8'),
  o('dom7alt-orig-04', ALT, 4, 2, ['altered', 'arpeggio'], '0:2 4:2 8:2 10:2 8:2 4:2 0:2 -2:2'),
  o('dom7alt-orig-05', ALT, 4, 3, ['altered', 'scale'], '10:2 8:2 6:2 4:2 3:2 1:2 0:2 -2:2'),
  o('dom7alt-orig-06', ALT, 4, 3, ['altered', 'arpeggio'], '4:2 7:2 10:2 13:2 16:2 13:2 10:2 7:2'),
  o('dom7alt-orig-07', ALT, 4, 3, ['altered', 'scale'], '4:2 6:2 8:2 10:2 13:2 15:2 16:2 18:2'),
  o('dom7alt-orig-08', ALT, 4, 3, ['altered', 'enclosure'], '10:2 8:2 5:1 3:1 4:2 4:2 8:2 10:4'),
  o('dom7alt-orig-09', ALT, 4, 3, ['altered', 'motif'], '10:2 13:2 10:2 8:2 6:2 4:2 3:2 4:2'),
  o('dom7alt-orig-10', ALT, 4, 3, ['altered', 'arpeggio'], '10:2 15:2 13:2 10:2 8:2 6:2 4:4'),
  o('dom7alt-orig-11', ALT, 4, 4, ['altered', 'scale'], '0:1 1:1 3:1 4:1 6:1 7:1 9:1 10:1 12:2 13:2 15:2 16:2'),
  o('dom7alt-orig-12', ALT, 4, 4, ['altered', 'scale'], '10:1 9:1 7:1 6:1 4:1 3:1 1:1 0:1 0:2 4:2 8:2 10:2'),
  o('dom7alt-orig-13', ALT, 4, 4, ['altered', 'arpeggio'], '4:2 20:2 18:1 15:1 13:2 10:2 8:2 6:2 4:2'),
  o('dom7alt-orig-14', ALT, 4, 4, ['altered', 'motif'], 'r:1 4:1 8:1 10:1 13:2 15:2 13:3 10:1 8:2 4:2'),
  o('dom7alt-orig-15', ALT, 4, 4, ['altered', 'scale'], '18:1 16:1 15:1 13:1 10:1 8:1 6:1 4:1 3:2 4:2 10:4'),
  o('dom7alt-orig-16', ALT, 2, 2, ['altered', 'arpeggio'], '4:2 8:2 10:2 13:2'),
  o('dom7alt-orig-17', ALT, 2, 2, ['altered', 'scale'], '10:2 8:2 6:2 4:2'),
  o('dom7alt-orig-18', ALT, 2, 2, ['altered'], '4:4 10:4'),
  o('dom7alt-orig-19', ALT, 2, 3, ['altered', 'arpeggio'], '13:2 10:2 8:2 4:2'),
  o('dom7alt-orig-20', ALT, 2, 3, ['altered', 'arpeggio'], '4:2 7:2 10:2 13:2'),
  o('dom7alt-orig-21', ALT, 2, 3, ['altered', 'scale'], '6:2 8:2 10:2 13:2'),
  o('dom7alt-orig-22', ALT, 2, 3, ['altered', 'enclosure'], '10:2 5:1 3:1 4:2 8:2'),
  o('dom7alt-orig-23', ALT, 2, 3, ['altered'], '15:2 13:2 10:2 4:2'),
  o('dom7alt-orig-24', ALT, 2, 4, ['altered', 'scale'], '4:1 6:1 8:1 10:1 13:1 15:1 16:1 18:1'),
  o('dom7alt-orig-25', ALT, 2, 4, ['altered', 'scale'], '10:1 9:1 7:1 6:1 4:1 3:1 1:1 0:1'),
  // dominant licks that also work as plain V7 (colour only on weak beats)
  o('dom7alt-orig-26', ['dom7', 'dom7alt'], 2, 2, ['arpeggio', 'altered'], '4:2 7:2 10:2 13:2'),
  o('dom7alt-orig-27', ['dom7', 'dom7alt'], 4, 3, ['arpeggio', 'altered'], '10:2 7:2 4:2 1:2 0:2 4:2 7:2 10:2'),
];

/* ---------------- i: m6 / mMaj7 ---------------- */
const MINOR_TONIC: Fragment[] = [
  o('m6-orig-01', MIN6, 4, 1, ['arpeggio'], '3:4 7:4 11:4 7:4'),
  o('m6-orig-02', MIN6, 4, 2, ['scale'], '0:2 2:2 3:2 5:2 7:2 9:2 11:2 9:2'),
  o('m6-orig-03', MIN6, 4, 2, ['arpeggio'], '7:2 9:2 7:2 3:2 0:2 3:2 7:2 3:2'),
  o('m6-orig-04', MIN6, 4, 2, ['scale'], '14:2 12:2 11:2 9:2 7:2 5:2 3:2 2:2'),
  o('m6-orig-05', MIN6, 4, 3, ['enclosure'], '7:2 4:1 2:1 3:4 0:2 3:2 7:2 9:2'),
  o('m6-orig-06', MIN6, 4, 3, ['chromatic'], '11:2 9:2 7:2 6:1 5:1 3:2 2:2 0:4'),
  o('m6-orig-07', MIN6, 4, 3, ['arpeggio', 'motif'], '3:3 7:1 9:2 11:2 14:3 11:1 9:2 7:2'),
  o('m6-orig-08', MIN6, 4, 4, ['scale'], '0:1 2:1 3:1 5:1 7:1 9:1 11:1 14:1 15:2 14:2 11:2 9:2'),
  // endings
  o('m6-orig-09', MIN6, 4, 1, ['guide-tone'], '7:12 r:4', true),
  o('m6-orig-10', MIN6, 4, 1, ['scale'], '7:4 3:4 0:8', true),
  o('m6-orig-11', MIN6, 4, 1, ['scale'], '9:4 7:4 3:8', true),
  o('m6-orig-12', MIN6, 4, 2, ['arpeggio'], '3:2 7:2 9:2 11:2 14:8', true),
  o('m6-orig-13', MIN6, 4, 2, ['scale'], '0:2 2:2 3:2 5:2 7:2 3:2 0:4', true),
  o('m6-orig-14', MIN6, 4, 2, ['arpeggio'], '7:2 9:2 11:2 14:2 11:2 9:2 7:4', true),
  o('m6-orig-15', MIN6, 4, 3, ['enclosure'], '11:2 9:2 7:2 5:2 3:2 1:1 -1:1 0:4', true),
  o('m6-orig-16', MIN6, 4, 3, ['arpeggio'], 'r:2 3:2 7:2 9:2 11:2 9:2 3:4', true),
  o('m6-orig-17', MIN6, 4, 3, ['scale'], '14:3 12:1 11:2 9:2 7:2 5:2 3:4', true),
  o('m6-orig-18', MIN6, 4, 4, ['scale'], '0:1 2:1 3:1 5:1 7:1 9:1 11:1 14:1 15:2 11:2 7:4', true),
  // two-beat
  o('m6-orig-19', MIN6, 2, 1, ['arpeggio'], '3:4 7:4'),
  o('m6-orig-20', MIN6, 2, 1, ['arpeggio'], '7:4 9:4'),
  o('m6-orig-21', MIN6, 2, 2, ['arpeggio'], '0:2 3:2 7:2 9:2'),
  o('m6-orig-22', MIN6, 2, 2, ['scale'], '9:2 7:2 5:2 3:2'),
  o('m6-orig-23', MIN6, 2, 2, ['scale', 'arpeggio'], '11:2 9:2 7:2 3:2'),
  o('m6-orig-24', MIN6, 2, 3, ['enclosure'], '7:2 4:1 2:1 3:2 0:2'),
  o('m6-orig-25', MIN6, 2, 1, ['guide-tone'], '3:2 0:6', true),
  o('m6-orig-26', MIN6, 2, 2, ['arpeggio'], '7:2 3:6', true),
  o('m6-orig-27', MIN6, 2, 2, ['scale'], '9:2 7:6', true),
];

/* ---------------- I: maj7 ---------------- */
const MAJ7: Fragment[] = [
  o('maj7-orig-01', MAJ, 4, 1, ['arpeggio'], '4:4 7:4 11:4 7:4'),
  o('maj7-orig-02', MAJ, 4, 1, ['arpeggio'], '11:4 7:4 4:4 0:4'),
  o('maj7-orig-03', MAJ, 4, 1, ['scale'], '7:8 4:4 2:4'),
  o('maj7-orig-04', MAJ, 4, 2, ['scale'], '0:2 2:2 4:2 5:2 7:2 5:2 4:2 2:2'),
  o('maj7-orig-05', MAJ, 4, 2, ['arpeggio'], '4:2 7:2 11:2 14:2 11:2 7:2 4:2 0:2'),
  o('maj7-orig-06', MAJ, 4, 2, ['scale', 'arpeggio'], '7:2 9:2 11:2 9:2 7:2 4:2 2:2 0:2'),
  o('maj7-orig-07', MAJ, 4, 2, ['pentatonic'], '2:2 4:2 7:2 9:2 7:2 4:2 2:2 0:2'),
  o('maj7-orig-08', MAJ, 4, 3, ['chromatic', 'scale'], '11:2 9:2 7:2 6:1 5:1 4:2 2:2 0:4'),
  o('maj7-orig-09', MAJ, 4, 3, ['enclosure'], '4:2 8:1 6:1 7:2 11:2 14:2 11:2 9:2 7:2'),
  o('maj7-orig-10', MAJ, 4, 3, ['arpeggio'], 'r:2 4:2 7:2 11:2 14:3 11:1 9:2 7:2'),
  o('maj7-orig-11', MAJ, 4, 3, ['motif', 'scale'], '9:3 7:1 4:2 2:2 0:2 2:2 4:4'),
  o('maj7-orig-12', MAJ, 4, 4, ['bebop', 'scale'], '0:1 2:1 4:1 5:1 7:1 8:1 9:1 11:1 12:2 11:2 9:2 7:2'),
  o('maj7-orig-13', MAJ, 4, 4, ['chromatic', 'scale'], '11:1 9:1 7:1 5:1 4:1 2:1 1:1 0:1 -1:2 0:2 4:2 7:2'),
  o('maj7-orig-14', MAJ, 4, 4, ['arpeggio'], '4:2 16:2 14:2 11:2 7:2 4:2 0:2 -1:2'),
  o('maj7-orig-15', MAJ, 4, 4, ['arpeggio', 'motif'], '7:3 11:1 14:3 11:1 9:3 7:1 4:2 2:1 0:1'),
  o('maj7-orig-16', MAJ, 4, 4, ['enclosure'], '4:1 5:1 3:1 4:1 7:2 11:2 9:2 7:2 6:1 5:1 4:2'),
  // endings
  o('maj7-orig-17', MAJ, 4, 1, ['guide-tone'], '7:12 r:4', true),
  o('maj7-orig-18', MAJ, 4, 1, ['scale'], '4:4 2:4 0:8', true),
  o('maj7-orig-19', MAJ, 4, 2, ['scale', 'arpeggio'], '7:2 9:2 11:2 9:2 7:2 4:2 0:4', true),
  o('maj7-orig-20', MAJ, 4, 2, ['arpeggio'], '4:2 7:2 11:2 14:2 12:8', true),
  o('maj7-orig-21', MAJ, 4, 3, ['enclosure'], '14:2 11:2 9:2 7:2 4:2 1:1 -1:1 0:4', true),
  o('maj7-orig-22', MAJ, 4, 3, ['arpeggio'], 'r:2 4:2 7:2 11:2 14:2 11:2 9:4', true),
  o('maj7-orig-23', MAJ, 4, 4, ['scale', 'arpeggio'], '0:1 2:1 4:1 5:1 7:1 9:1 11:1 14:1 16:2 11:2 7:4', true),
  o('maj7-orig-24', MAJ, 4, 4, ['arpeggio'], 'r:1 4:1 7:1 11:1 14:2 11:2 7:2 4:2 0:4', true),
  o('maj7-orig-25', MAJ, 4, 4, ['arpeggio'], '4:2 16:2 14:2 11:2 9:2 7:2 4:4', true),
  // two-beat
  o('maj7-orig-26', MAJ, 2, 1, ['arpeggio'], '4:4 7:4'),
  o('maj7-orig-27', MAJ, 2, 1, ['arpeggio'], '11:4 7:4'),
  o('maj7-orig-28', MAJ, 2, 2, ['arpeggio'], '0:2 4:2 7:2 11:2'),
  o('maj7-orig-29', MAJ, 2, 2, ['scale'], '7:2 5:2 4:2 2:2'),
  o('maj7-orig-30', MAJ, 2, 2, ['scale', 'arpeggio'], '11:2 9:2 7:2 4:2'),
  o('maj7-orig-31', MAJ, 2, 2, ['arpeggio'], '14:2 11:2 7:2 4:2'),
  o('maj7-orig-32', MAJ, 2, 3, ['enclosure'], '4:2 5:1 3:1 4:2 7:2'),
  o('maj7-orig-33', MAJ, 2, 3, ['enclosure'], '7:2 8:1 6:1 7:2 11:2'),
  o('maj7-orig-34', MAJ, 2, 4, ['bebop', 'scale'], '0:1 2:1 4:1 5:1 7:1 8:1 9:1 11:1'),
  o('maj7-orig-35', MAJ, 2, 4, ['chromatic', 'scale'], '11:1 9:1 7:1 5:1 4:1 2:1 1:1 0:1'),
  o('maj7-orig-36', MAJ, 2, 4, ['arpeggio'], '4:1 7:1 11:1 14:1 16:1 14:1 11:1 7:1'),
  o('maj7-orig-37', MAJ, 2, 1, ['guide-tone'], '2:2 0:6', true),
  o('maj7-orig-38', MAJ, 2, 2, ['arpeggio'], '7:2 4:6', true),
  o('maj7-orig-39', MAJ, 2, 2, ['arpeggio'], '11:2 7:6', true),
];

export const ORIGINAL_FRAGMENTS: Fragment[] = [...M7, ...M7B5, ...D7, ...D7ALT, ...MINOR_TONIC, ...MAJ7];
