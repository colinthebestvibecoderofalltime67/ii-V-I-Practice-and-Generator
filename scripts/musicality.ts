/**
 * `npm run musicality`: generate a fixed, seeded sample of licks and print the musicality metrics
 * (src/analysis/musicality.ts) overall and per tier. `JSON=1` prints JSON instead (for before/after diffs).
 * Sample: every progression x length x slider position (5..95 step 10) x seeds, on alto sax and guitar. Like the app,
 * each lick avoids the cells of the previous 8 licks (a practice session).
 */
import { generateLick } from '../src/generator';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { summarize, type MusicalitySummary } from '../src/analysis/musicality';
import { TIER_NAMES, type LengthId, type Lick, type Tier } from '../src/types';

const SEEDS = Number(process.env.SEEDS ?? 6);
const POSITIONS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
const INSTS = ['alto', 'guitar'].map(getInstrument);

const all: Lick[] = [];
const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
let seed = 1;
for (const p of PROGRESSIONS) {
  for (const length of Object.keys(LENGTHS) as LengthId[]) {
    for (const pos of POSITIONS) {
      for (let s = 0; s < SEEDS; s++) {
        const inst = INSTS[s % INSTS.length];
        const l = generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: posToScore(pos), range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tierForScore(posToScore(pos))), avoid: all.slice(-8).flatMap(r => r.fragmentIds), seed: seed++ });
        all.push(l);
        byTier[l.requestedTier].push(l);
      }
    }
  }
}

const rows: [string, MusicalitySummary][] = [['All', summarize(all)], ...([1, 2, 3, 4] as Tier[]).map(t => [TIER_NAMES[t], summarize(byTier[t])] as [string, MusicalitySummary])];

if (process.env.JSON) {
  console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
} else {
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`.padStart(6);
  const num = (x: number) => x.toFixed(1).padStart(6);
  console.log(`Musicality report: ${all.length} licks (seeded)\n`);
  console.log('Tier          licks  antic  pickup  seam  V-guide  alt5/13‰  longChr‰  topCell');
  for (const [name, m] of rows) {
    console.log(`${name.padEnd(12)} ${String(m.licks).padStart(6)} ${pct(m.anticipationShare)} ${pct(m.startsWithRestShare)} ${pct(m.seamRepeatShare)} ${pct(m.dominantGuideShare)}   ${num(m.altNaturalPerK)}    ${num(m.longChromaticPerK)}  ${pct(m.topCellShare)} ${m.topCell}`);
  }
  console.log('\nTier          leap10  16ths  altPlain  maj7-4th  dotted  lyd-11  endRepeat');
  for (const [name, m] of rows) {
    console.log(`${name.padEnd(12)} ${pct(m.bigLeapShare)} ${pct(m.sixteenthShare)}   ${pct(m.altPlainShare)}    ${pct(m.maj7FourthShare)}  ${pct(m.dottedShare)} ${pct(m.lydianElevenShare)}    ${pct(m.endingRepeatShare)}`);
  }
  console.log('\nTier          lyd#11  lydAlt  noodle  16run  clash  altThin  m7b5-b5  nearDup  ending R/3/5/7/9/6');
  for (const [name, m] of rows) {
    const e = m.endingShares;
    console.log(`${name.padEnd(12)} ${pct(m.lydianSharp11Share)} ${pct(m.lydianAlteredShare)} ${pct(m.noodleShare)} ${pct(m.finalSixteenthRunShare)} ${pct(m.anticipationClashShare)}  ${pct(m.altThinShare)}   ${pct(m.m7b5Flat5Share)}   ${pct(m.nearDuplicateShare)}   ${(['R', '3', '5', '7', '9', '6'] as const).map(d => (100 * e[d]).toFixed(0).padStart(3)).join(' ')}`);
  }
  console.log('\nantic = licks with an anticipation into a chord change; pickup = starts with a rest; seam = licks that');
  console.log('re-attack the same pitch where two cells join; V-guide = dominant arrivals on the 3rd or 7th;');
  console.log('alt5/13 = natural 5 or 13 on a beat over 7alt, per 1,000 attacks; longChr = chromatic notes held a beat on a beat.');
  console.log('leap10 = licks with a leap of a minor 7th or more; 16ths = share of notes that are 16ths; altPlain = 7alt chords');
  console.log('with no b9/#9/b13; maj7-4th = licks stressing the 4th over maj7; dotted = licks with 2+ dotted-8th+16th beats;');
  console.log('lyd#11 = tritone/backdoor dominants with #11 and no natural 11; lydAlt = those with a b9/#9/b13; noodle = licks with >6 chord-tone');
  console.log('attacks in a row; 16run = licks with a stepwise 16th run > 4 in the last bar; clash = anticipations outside the old chord scale');
  console.log('(m7b5/7alt/Lydian dom); altThin = 7alt with <2 altered tones and none held; m7b5-b5 = m7b5 chords stating the b5;');
  console.log('nearDup = adjacent cells sharing first 3 / last 2 pitches; ending = closing-note degree shares.');
  console.log('lyd-11 = tritone/backdoor licks stressing the natural 11 on the dominant; endRepeat = last note repeats the one before.');
}
