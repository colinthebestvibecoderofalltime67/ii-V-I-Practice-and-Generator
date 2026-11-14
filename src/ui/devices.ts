import type { ConceptId, Instrument, Lick, Tier } from '../types';
import { TIER_NAMES } from '../types';
import { analyzeLick, type LickAnalysis } from '../theory/analyze';
import { CONCEPT_MIN_TIER, CONCEPT_NAME, DEVICE_LABEL, DEVICE_NAME, conceptAllowed, detectDevices, displayDevices, type DeviceSpan } from '../theory/devices';
import { barOf } from '../theory/rhythm';
import { formatSpelling, spellLick } from '../theory/spell';
import type { DeviceMark } from '../render/notation';

/** Pure text and mark helpers for the device brackets and the Analysis list (the DOM code lives in main.ts). */

const DEGREE_WORD: Record<string, string> = {
  R: 'root', '3': '3rd', '♭3': '♭3rd', '5': '5th', '♭5': '♭5th', '7': '7th', '♭7': '♭7th', '6': '6th', '9': '9th', '♭9': '♭9th', '♯9': '♯9th',
  '11': '11th', '♯11': '♯11th', '13': '13th', '♭13': '♭13th',
};

export interface DeviceRow {
  span: DeviceSpan;
  /** "Enclosure" */
  name: string;
  /** "→ E (3rd of Cmaj7)" or "over G7alt" */
  what: string;
  /** "bar 3" */
  where: string;
  mark: DeviceMark;
}

/** Devices of a lick as rows for the Analysis list, plus the marks the renderer draws. Works on notes only (shared licks too). */
export function deviceRows(lick: Lick, inst: Instrument, analysis: LickAnalysis = analyzeLick(lick, inst)): DeviceRow[] {
  const spelled = spellLick(lick, inst);
  return displayDevices(detectDevices(lick)).map(span => {
    const chord = analysis.chords[span.chord]?.symbol ?? '';
    let what = chord ? `over ${chord}` : '';
    if (span.target !== undefined && spelled[span.target]) {
      const label = analysis.notes[span.target]?.label ?? '';
      const word = DEGREE_WORD[label] ?? label;
      what = `→ ${formatSpelling(spelled[span.target]!)}${word && chord ? ` (${word} of ${chord})` : ''}`;
    }
    if (span.kind === 'anticipation') what += ', a beat early';
    if (span.kind === 'sideSlip') what = `over ${chord}, resolving by step`;
    return {
      span, name: DEVICE_NAME[span.kind], what, where: `bar ${barOf(lick.notes[span.first].start) + 1}`,
      mark: { kind: span.kind, first: span.first, last: span.last, label: DEVICE_LABEL[span.kind] },
    };
  });
}

const PLURAL: ConceptId[] = ['guideTones', 'enclosures', 'chromaticApproach', 'triadPairs'];

/** The note shown under the Focus menu when the concept is not offered at the chosen difficulty (empty when it is). */
export function focusHint(concept: ConceptId, tier: Tier): string {
  if (conceptAllowed(concept, tier)) return '';
  return `${CONCEPT_NAME[concept]} ${PLURAL.includes(concept) ? 'are' : 'is'} ${TIER_NAMES[CONCEPT_MIN_TIER[concept]]}+ material \u2014 this lick ignores the focus.`;
}
