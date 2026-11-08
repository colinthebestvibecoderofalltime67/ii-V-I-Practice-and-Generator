/** `npm run report`: sanity-check generator + difficulty scorer. Prints hit-rate matrices, score histograms, top features and sample licks. */
import { FRAGMENTS } from '../src/fragments';
import { INSTRUMENTS, concertRange } from '../src/instruments';
import { generateLick } from '../src/generator';
import { TIER_THRESHOLDS } from '../src/difficulty/score';
import { LENGTHS, PROGRESSIONS } from '../src/theory/progressions';
import { pcName } from '../src/theory/pitch';
import { TIER_NAMES, type LengthId, type Lick, type Tier } from '../src/types';

const PER_TIER = Number(process.env.N ?? 200);
const TIERS: Tier[] = [1, 2, 3, 4];
const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
const REPORT_INSTS = ['alto', 'trumpet', 'trombone', 'bass', 'flute', 'guitar'].map(id => INSTRUMENTS.find(i => i.id === id)!);

const byTier: Record<Tier, Lick[]> = { 1: [], 2: [], 3: [], 4: [] };
for (const tier of TIERS) {
  for (let i = 0; i < PER_TIER; i++) {
    const p = PROGRESSIONS[i % PROGRESSIONS.length];
    const length = LENGTH_IDS[Math.floor(i / PROGRESSIONS.length) % LENGTH_IDS.length];
    const inst = REPORT_INSTS[i % REPORT_INSTS.length];
    byTier[tier].push(generateLick({
      progressionId: p.id, length, keyPc: (i * 5) % 12, tier, range: concertRange(inst), seed: 1000 * tier + i,
    }));
  }
}

console.log(`Fragment library: ${FRAGMENTS.length} fragments. Tier thresholds (score): ${TIER_THRESHOLDS.join(' / ')}\n`);

console.log('== Requested tier (rows) vs computed tier (cols), % ==');
console.table(Object.fromEntries(TIERS.map(t => [
  `${t} ${TIER_NAMES[t]}`,
  Object.fromEntries(TIERS.map(c => [`computed ${c}`, +(100 * byTier[t].filter(l => l.difficulty.tier === c).length / byTier[t].length).toFixed(1)])),
])));

console.log('== Hit rate by progression x tier, % ==');
console.table(Object.fromEntries(PROGRESSIONS.map(p => [
  p.id,
  Object.fromEntries(TIERS.map(t => {
    const ls = byTier[t].filter(l => l.progressionId === p.id);
    return [`tier ${t}`, ls.length ? +(100 * ls.filter(l => l.difficulty.tier === t).length / ls.length).toFixed(0) : NaN];
  })),
])));

console.log('== Hit rate by length x tier, % ==');
console.table(Object.fromEntries(LENGTH_IDS.map(len => [
  len,
  Object.fromEntries(TIERS.map(t => {
    const ls = byTier[t].filter(l => l.length === len);
    return [`tier ${t}`, ls.length ? +(100 * ls.filter(l => l.difficulty.tier === t).length / ls.length).toFixed(0) : NaN];
  })),
])));

console.log('== Score histogram per requested tier (bins of 5) ==');
for (const t of TIERS) {
  const bins = new Array(21).fill(0);
  for (const l of byTier[t]) bins[Math.min(20, Math.floor(l.difficulty.score / 5))]++;
  const scores = byTier[t].map(l => l.difficulty.score).sort((a, b) => a - b);
  console.log(`Tier ${t} ${TIER_NAMES[t]}: min ${scores[0]} median ${scores[Math.floor(scores.length / 2)]} max ${scores[scores.length - 1]}`);
  bins.forEach((n, i) => {
    if (n) console.log(`  ${String(i * 5).padStart(3)}-${String(i * 5 + 4).padEnd(3)} ${'#'.repeat(Math.round((60 * n) / PER_TIER))} ${n}`);
  });
}

console.log('\n== Top features per requested tier (mean points; mean value) ==');
for (const t of TIERS) {
  const acc = new Map<string, { label: string; pts: number; val: number }>();
  for (const l of byTier[t]) for (const f of l.difficulty.features) {
    const a = acc.get(f.id) ?? { label: f.label, pts: 0, val: 0 };
    a.pts += f.points / byTier[t].length;
    a.val += f.value / byTier[t].length;
    acc.set(f.id, a);
  }
  console.log(`Tier ${t}:`, [...acc.values()].sort((a, b) => b.pts - a.pts).slice(0, 5).map(a => `${a.label} ${a.pts.toFixed(1)}pts (${a.val.toFixed(1)})`).join(' | '));
}

function show(l: Lick) {
  const name = (m: number) => pcName(m, l.keyPc, l.mode) + (Math.floor(m / 12) - 1);
  // durations are written in ticks (16ths): 1=16th 2=8th 4=quarter 8=half 16=whole; '~' = tied
  const out: string[] = [];
  l.chords.forEach((c, ci) => {
    const ns = l.notes.filter(n => n.chord === ci).map(n => `${n.midi == null ? 'r' : name(n.midi)}:${n.dur}${n.tie ? '~' : ''}`);
    out.push(`[${c.symbol}] ${ns.join(' ')}`);
  });
  console.log(`  ${l.id}  score ${l.difficulty.score} -> tier ${l.difficulty.tier}  (${l.difficulty.features.slice(0, 3).map(f => f.label).join(', ')})`);
  console.log(`  ${out.join('  |  ')}`);
  console.log(`  fragments: ${l.fragmentIds.join(' ')}`);
}

console.log('\n== Sample licks ==');
for (const t of TIERS) {
  console.log(`\nTier ${t} ${TIER_NAMES[t]}`);
  show(byTier[t][0]);
  show(byTier[t][PROGRESSIONS.length * 3 + 2]);
}
