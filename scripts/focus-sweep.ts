/**
 * Focus delivery sweep: for every offered concept x progression x length x slider position it generates `N` licks (default 20) and
 * reports where fewer than THRESHOLD of them contain the device. The output of `all` is the body of CONCEPT_UNAVAILABLE in
 * src/theory/devices.ts (spans of slider positions per "progression|length|tier").
 *
 *   npx tsx scripts/focus-sweep.ts [concept|all] [N] [step]
 *   POS=55,60,65 PROGS=minor-251 LENS=short npx tsx scripts/focus-sweep.ts superimposition 20
 */
import { generateLick } from '../src/generator';
import { concertRange, concertRangeForLevel, getInstrument } from '../src/instruments';
import { posToScore, tierForScore } from '../src/difficulty/score';
import { CONCEPTS, conceptAllowed, conceptHits } from '../src/theory/devices';
import { PROGRESSIONS } from '../src/theory/progressions';
import type { ConceptId, LengthId } from '../src/types';

const THRESHOLD = 0.8;
const which = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 20);
const step = Number(process.argv[4] ?? 5);
const positions = process.env.POS ? process.env.POS.split(',').map(Number) : Array.from({ length: Math.floor(100 / step) + 1 }, (_, i) => i * step);
const progs = process.env.PROGS ? process.env.PROGS.split(',') : PROGRESSIONS.map(p => p.id);
const lens = (process.env.LENS ? process.env.LENS.split(',') : ['short', 'standard', 'long']) as LengthId[];

const out: Record<string, Record<string, [number, number]>> = {};
for (const concept of CONCEPTS as readonly ConceptId[]) {
  if (which !== 'all' && which !== concept) continue;
  for (const pos of positions) {
    const target = posToScore(pos);
    const tier = tierForScore(target);
    if (!conceptAllowed(concept, tier)) continue;
    for (const p of progs) {
      for (const length of lens) {
        let ok = 0;
        let links = 0;
        let of = 0;
        for (let k = 0; k < N; k++) {
          const inst = getInstrument(k % 2 ? 'guitar' : 'alto');
          const lick = generateLick({ progressionId: p, length, keyPc: (k * 5) % 12, tier, targetScore: target, range: concertRange(inst), comfortRange: concertRangeForLevel(inst, tier), seed: 900 + k, concept });
          const r = conceptHits(lick, concept);
          if (r.hits > 0) ok++;
          links += r.hits;
          of += r.of;
        }
        // guide tones are judged per chord change, the others per lick
        const rate = concept === 'guideTones' ? links / of : ok / N;
        if (rate < THRESHOLD) {
          const key = `${p}|${length}|${tier}`;
          const span = ((out[concept] ??= {})[key] ??= [pos, pos]);
          span[0] = Math.min(span[0], pos);
          span[1] = Math.max(span[1], pos);
        }
      }
    }
  }
}
for (const [concept, spans] of Object.entries(out)) {
  console.log(`  ${concept}: {`);
  for (const [key, span] of Object.entries(spans).sort()) console.log(`    '${key}': [${span[0]}, ${span[1]}],`);
  console.log('  },');
}
