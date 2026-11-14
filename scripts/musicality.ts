/**
 * `npm run musicality`: generate a fixed, seeded sample of licks and print the musicality metrics
 * (src/analysis/musicality.ts) overall and per tier. `JSON=1` prints JSON instead (for before/after diffs).
 * Sample: every progression x length x slider position (5..95 step 10) x seeds, on alto sax and guitar.
 */
import { generateLick } from '../src/generator';
import { posToScore } from '../src/difficulty/score';
import { concertRange, getInstrument } from '../src/instruments';
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
        const l = generateLick({ progressionId: p.id, length, keyPc: (seed * 5) % 12, tier: 1, targetScore: posToScore(pos), range: concertRange(inst), seed: seed++ });
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
  console.log('\nantic = licks with an anticipation into a chord change; pickup = starts with a rest; seam = licks that');
  console.log('re-attack the same pitch where two cells join; V-guide = dominant arrivals on the 3rd or 7th;');
  console.log('alt5/13 = natural 5 or 13 on a beat over 7alt, per 1,000 attacks; longChr = chromatic notes held a beat on a beat.');
}
