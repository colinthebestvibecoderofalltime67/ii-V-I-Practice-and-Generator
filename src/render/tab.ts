/**
 * Pure fret assignment for tablature. No DOM, no VexFlow.
 *
 * Dynamic programming over all (string, fret) candidates of each pitched note, minimising
 * hand movement. String numbering follows VexFlow: 1 = HIGHEST string. `tuning` is low string first.
 */
export interface FretPos {
  str: number;
  fret: number;
}

interface Cand {
  idx: number; // index into tuning (0 = lowest)
  fret: number;
}

const MAX_SPAN = 4;

/** Cost of playing a candidate on its own (position preference). */
function ownCost(c: Cand): number {
  let cost = c.fret * 0.04; // mild preference for low positions
  if (c.fret > 12) cost += 1.5 + (c.fret - 12) * 0.3; // prefer frets 0..12
  return cost;
}

/** The fret that represents hand position (open strings do not move the hand). */
function transitionCost(a: Cand, b: Cand): number {
  let dist: number;
  if (a.fret === 0 || b.fret === 0) dist = 1; // open string: cheap, hand barely moves
  else dist = Math.abs(a.fret - b.fret);
  let cost = dist * 1.0;
  if (a.fret > 0 && b.fret > 0 && dist > MAX_SPAN) cost += (dist - MAX_SPAN) * 2.5; // span penalty
  const sd = Math.abs(a.idx - b.idx);
  cost += sd <= 1 ? 0 : (sd - 1) * 0.6; // prefer adjacent strings
  return cost;
}

export function assignFrets(
  written: (number | null)[],
  tuning: number[],
  frets: number,
): (FretPos | null)[] {
  const n = written.length;
  const out: (FretPos | null)[] = new Array(n).fill(null);

  // candidates per pitched note
  const cands: Cand[][] = [];
  const noteIdx: number[] = []; // position in `written` for each pitched note
  for (let i = 0; i < n; i++) {
    const m = written[i];
    if (m == null) continue;
    const list: Cand[] = [];
    for (let s = 0; s < tuning.length; s++) {
      const f = m - tuning[s];
      if (Number.isInteger(f) && f >= 0 && f <= frets) list.push({ idx: s, fret: f });
    }
    if (list.length === 0) continue; // out of range -> null
    cands.push(list);
    noteIdx.push(i);
  }
  if (cands.length === 0) return out;

  // Viterbi. cost[i][j] = best cost ending at candidate j of pitched note i.
  const cost: number[][] = [];
  const back: number[][] = [];
  cost.push(cands[0].map(ownCost));
  back.push(cands[0].map(() => -1));
  for (let i = 1; i < cands.length; i++) {
    const row: number[] = [];
    const brow: number[] = [];
    for (const c of cands[i]) {
      let best = Infinity;
      let bj = 0;
      for (let j = 0; j < cands[i - 1].length; j++) {
        const v = cost[i - 1][j] + transitionCost(cands[i - 1][j], c);
        if (v < best - 1e-9) {
          best = v;
          bj = j;
        }
      }
      row.push(best + ownCost(c));
      brow.push(bj);
    }
    cost.push(row);
    back.push(brow);
  }

  let j = 0;
  const last = cost[cost.length - 1];
  for (let k = 1; k < last.length; k++) if (last[k] < last[j] - 1e-9) j = k;
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i][j];
    out[noteIdx[i]] = { str: tuning.length - c.idx, fret: c.fret };
    j = back[i][j];
  }
  return out;
}
