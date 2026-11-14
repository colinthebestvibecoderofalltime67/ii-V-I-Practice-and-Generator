import type { Instrument, Lick, Mode, Tier } from '../types';
import { TIER_NAMES } from '../types';
import { getProgression } from '../theory/progressions';
import { mod12, pcName } from '../theory/pitch';

/** "Eb" -> "E♭", "C# minor" -> "C♯ minor". */
export const pretty = (s: string): string => s.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯');

/** Concert key as shown in the UI: "E♭" or "C minor". */
export function keyLabel(keyPc: number, mode: Mode): string {
  const n = pretty(pcName(keyPc, keyPc, mode));
  return mode === 'minor' ? `${n} minor` : n;
}

/** Key the player reads for a lick on this instrument. */
export function writtenKeyLabel(lick: Lick, inst: Instrument): string {
  return keyLabel(mod12(lick.keyPc + inst.transpose), lick.mode);
}

/** Title key: the key the player reads (concert key for non-transposing instruments). */
export const titleKeyLabel = (lick: Lick, inst: Instrument): string => writtenKeyLabel(lick, inst);

export const isTransposing = (inst: Instrument): boolean => mod12(inst.transpose) !== 0;

export const tierName = (t: Tier): string => TIER_NAMES[t];

/** ASCII-only file name, e.g. lick-major-251-Eb-advanced.mid */
export function fileName(lick: Lick, ext: string): string {
  const key = pcName(lick.keyPc, lick.keyPc, lick.mode) + (lick.mode === 'minor' ? 'm' : '');
  const tier = TIER_NAMES[lick.difficulty.tier].toLowerCase();
  return `lick-${lick.progressionId}-${key}-${tier}.${ext}`;
}

export const progressionName = (lick: Lick): string => getProgression(lick.progressionId).name;

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(at).toLocaleDateString();
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
