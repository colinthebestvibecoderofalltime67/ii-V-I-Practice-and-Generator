import type { Lick } from '../types';

/** What the practice log remembers about one lick (any key, any instrument). */
export interface PracticeStat {
  /** Concert pitch classes (0..11) the lick has been played in, ascending. */
  keys: number[];
  /** Completed passes. */
  passes: number;
  /** Fastest tempo it was completed at. */
  topBpm: number;
  /** Time of the latest completed pass (ms since epoch). */
  lastAt: number;
}
export type PracticeLog = Record<string, PracticeStat>;

export const PRACTICE_LIMIT = 1000;

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** FNV-1a over a string, with a chosen offset basis. */
function fnv(str: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Key-independent identity of a lick: the progression, length and rhythm, and each pitch as its pitch class
 * relative to the lick's key. The same lick re-keyed, or re-fitted to another instrument's octave, gets the same key.
 */
export function lickContentKey(lick: Pick<Lick, 'progressionId' | 'length' | 'totalTicks' | 'keyPc' | 'notes'>): string {
  const body = [
    lick.progressionId, lick.length, lick.totalTicks,
    ...lick.notes.map(n => `${n.start}.${n.dur}.${n.midi == null ? 'r' : mod12(n.midi - lick.keyPc)}${n.tie ? 't' : ''}`),
  ].join('|');
  return fnv(body, 0x811c9dc5).toString(16).padStart(8, '0') + fnv(body, 0x9e3779b1).toString(16).padStart(8, '0');
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a stored log: drops malformed entries, clamps values, keeps at most PRACTICE_LIMIT (newest by lastAt). */
export function sanitizePractice(raw: unknown): PracticeLog {
  const out: PracticeLog = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const entries: [string, PracticeStat][] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-9a-f]{16}$/.test(k) || typeof v !== 'object' || v === null) continue;
    const e = v as Record<string, unknown>;
    if (!Array.isArray(e.keys) || !isNum(e.passes) || !isNum(e.topBpm) || !isNum(e.lastAt)) continue;
    const keys = [...new Set(e.keys.filter((x): x is number => isNum(x) && Number.isInteger(x) && x >= 0 && x < 12))].sort((a, b) => a - b);
    const passes = Math.max(0, Math.round(e.passes));
    if (!keys.length || !passes) continue;
    entries.push([k, { keys, passes, topBpm: Math.min(320, Math.max(0, Math.round(e.topBpm))), lastAt: e.lastAt }]);
  }
  entries.sort((a, b) => b[1].lastAt - a[1].lastAt);
  for (const [k, v] of entries.slice(0, PRACTICE_LIMIT)) out[k] = v;
  return out;
}

/** New log with one completed pass added (does not mutate). Evicts the oldest entries beyond PRACTICE_LIMIT. */
export function recordPass(log: PracticeLog, contentKey: string, keyPc: number, bpm: number, at: number): PracticeLog {
  const cur = log[contentKey];
  const keys = new Set(cur?.keys ?? []);
  keys.add(mod12(keyPc));
  const next: PracticeLog = {
    ...log,
    [contentKey]: {
      keys: [...keys].sort((a, b) => a - b),
      passes: (cur?.passes ?? 0) + 1,
      topBpm: Math.max(cur?.topBpm ?? 0, Math.round(bpm)),
      lastAt: at,
    },
  };
  const ks = Object.keys(next);
  if (ks.length <= PRACTICE_LIMIT) return next;
  ks.sort((a, b) => next[b].lastAt - next[a].lastAt);
  const kept: PracticeLog = {};
  for (const k of ks.slice(0, PRACTICE_LIMIT)) kept[k] = next[k];
  return kept;
}

/** Whole days since the epoch in local time: the "day" used to pick the lick of the day. */
export function dayNumber(at: number): number {
  const d = new Date(at);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Deterministic pick for a day: the same index all day, a different one tomorrow. */
export function pickForDay<T>(items: readonly T[], at: number): T | undefined {
  if (!items.length) return undefined;
  const day = dayNumber(at);
  return items[Math.floor(fnv(String(day), 0x811c9dc5) % items.length)];
}
