/** Node-only loader for the ~54 hand-written licks in the legacy prototype (all in C, ii–V–I, 1 bar per chord). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface PrototypeLick {
  title: string;
  /** Prototype level label. */
  level: 'Beginner' | 'Medium' | 'Advanced';
  /** Notes in CONCERT C major over Dm7 (bar 0) – G7 (bar 1) – Cmaj7 (bar 2). Times in TICKS (16ths). midi null = rest. */
  notes: { midi: number | null; start: number; dur: number; tie: boolean }[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const LEGACY_FILE = resolve(here, '../legacy/jazz-lick-studio-standalone_3.html');

export function loadPrototypeLicks(): PrototypeLick[] {
  const html = readFileSync(LEGACY_FILE, 'utf8');
  const m = html.match(/const LIB=(\[.*?\]);\n/s);
  if (!m) throw new Error('LIB not found in legacy file');
  const raw = JSON.parse(m[1]) as { t: string; lv: PrototypeLick['level']; n: [number, number, number][] }[];
  return raw.map(l => {
    let pos = 0;
    const notes = l.n.map(([midi, eighths, tie]) => {
      const n = { midi: midi < 0 ? null : midi, start: pos, dur: eighths * 2, tie: !!tie };
      pos += eighths * 2;
      return n;
    });
    return { title: l.t, level: l.lv, notes };
  });
}
