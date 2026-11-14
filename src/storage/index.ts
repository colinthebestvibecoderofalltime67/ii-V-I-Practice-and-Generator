import type { Lick } from '../types';
import { TICKS_PER_16TH } from '../types';
import { LENGTHS, PROGRESSIONS } from '../theory/progressions';
import { INSTRUMENTS } from '../instruments';
import type { CompStyle } from '../audio/comping';
import { lickContentKey, recordPass, sanitizePractice, type PracticeLog } from '../practice/log';
import { DRILL_ORDERS, clampInt, type DrillOrder } from '../practice/drill';

/** Persisted user settings. Everything here is a per-browser convenience. */
export interface Settings {
  progressionId: string;
  length: keyof typeof LENGTHS;
  /** Difficulty slider position, integer 0..100 (see difficulty/score.ts posToScore). */
  target: number;
  instrumentId: string;
  /** 'random' or a concert pitch class 0..11. */
  key: 'random' | number;
  bpm: number;
  slow: boolean;
  piano: boolean;
  loop: boolean;
  swing: boolean;
  straight16: boolean;
  hide: boolean;
  showTab: boolean;
  comp: CompStyle;
  leadVolume: number;
  pianoVolume: number;
  countIn: boolean;
  metronome: boolean;
  /** Swing drums with the backing (only sound while Backing is on). */
  drums: boolean;
  drumVolume: number;
  /** Metronome clicks only on beats 2 and 4. */
  metronome24: boolean;
  midiBacking: boolean;
  /** Tab fingering: 'auto' (easiest) or a position label such as "Pos. V" / "Open pos.". */
  tabPosition: 'auto' | string;
  /** Show finger numbers on every tab note. */
  showFingers: boolean;
  /** Show scale-degree labels and the scale of each chord. */
  analyze: boolean;
  /** 12-key drill: order of keys ('off' = normal play), passes per key 1..4, tempo ladder step 0..20 BPM and its cap. */
  drillOrder: DrillOrder;
  drillRepeats: number;
  drillTempoStep: number;
  drillMaxBpm: number;
  /** Call and response: alternate a played lick (call) with a muted pass (response). */
  callResponse: boolean;
  /** Response passes after each call, 1 or 2. */
  responsePasses: 1 | 2;
  /** Keep the notes visible during the response pass (default: hidden). */
  showNotesInResponse: boolean;
  /** When Hide notes is on, keep the chord symbols readable. */
  hideKeepChords: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  progressionId: 'major-251',
  length: 'standard',
  target: 37,
  instrumentId: 'alto',
  key: 0,
  bpm: 120,
  slow: false,
  piano: true,
  loop: false,
  swing: true,
  straight16: true,
  hide: false,
  showTab: true,
  comp: 'rootless',
  leadVolume: 0.8,
  pianoVolume: 0.6,
  countIn: true,
  metronome: false,
  drums: true,
  drumVolume: 0.5,
  metronome24: false,
  midiBacking: true,
  tabPosition: 'auto',
  showFingers: false,
  analyze: false,
  drillOrder: 'off',
  drillRepeats: 1,
  drillTempoStep: 0,
  drillMaxBpm: 200,
  callResponse: false,
  responsePasses: 1,
  showNotesInResponse: false,
  hideKeepChords: true,
};

/** Old `tier` setting -> middle of that tier's slider band. */
const LEGACY_TIER_TARGET: Record<number, number> = { 1: 12, 2: 37, 3: 62, 4: 87 };

/** Labels that positionsForLick can produce. */
export const TAB_POSITION_RE = /^(Open pos\.|Pos\. [IVX]{1,6})$/;

export interface StoredEntry { lick: Lick; at: number }

export const HISTORY_LIMIT = 50;
export const FAVORITES_LIMIT = 500;

export const KEYS = {
  settings: 'iivi:v1:settings',
  history: 'iivi:v1:history',
  favorites: 'iivi:v1:favorites',
  practice: 'iivi:v1:practice',
} as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shape check for a stored lick (version 1 or 2). Cheap but strict enough that rendering/playing cannot crash. */
export function isValidLick(v: unknown): v is Lick {
  if (!isObj(v)) return false;
  if ((v.version !== 1 && v.version !== 2) || typeof v.id !== 'string' || !isNum(v.seed) || !isNum(v.keyPc) || !isNum(v.totalTicks)) return false;
  if (!PROGRESSIONS.some(p => p.id === v.progressionId)) return false;
  if (typeof v.length !== 'string' || !(v.length in LENGTHS)) return false;
  if (v.mode !== 'major' && v.mode !== 'minor') return false;
  if (![1, 2, 3, 4].includes(v.requestedTier as number)) return false;
  if (!Array.isArray(v.chords) || v.chords.length === 0 || !Array.isArray(v.notes) || v.notes.length === 0) return false;
  if (!Array.isArray(v.fragmentIds) || !isNum(v.createdAt)) return false;
  if (v.targetScore !== undefined && !isNum(v.targetScore)) return false;
  if (v.cellStarts !== undefined && !(Array.isArray(v.cellStarts) && v.cellStarts.every(isNum))) return false;
  for (const c of v.chords) {
    if (!isObj(c) || !isNum(c.rootPc) || typeof c.quality !== 'string' || typeof c.symbol !== 'string' || !isNum(c.start) || !isNum(c.dur)) return false;
  }
  for (const n of v.notes) {
    if (!isObj(n) || !(n.midi === null || isNum(n.midi)) || !isNum(n.start) || !isNum(n.dur) || !isNum(n.chord)) return false;
    if (n.chord < 0 || n.chord >= v.chords.length) return false;
  }
  const d = v.difficulty;
  if (!isObj(d) || !isNum(d.score) || ![1, 2, 3, 4].includes(d.tier as number) || !Array.isArray(d.features)) return false;
  for (const f of d.features) {
    if (!isObj(f) || typeof f.id !== 'string' || typeof f.label !== 'string' || !isNum(f.points)) return false;
  }
  return true;
}

/**
 * Bring a stored lick to the current time grid. Version 1 licks were saved with 16th-note ticks (4 per beat);
 * version 2 uses 12 ticks per beat, so every tick value is multiplied by 3. Version 2 licks are returned as-is.
 * Input must already have passed isValidLick.
 */
export function migrateLick(lick: Lick): Lick {
  if (lick.version === 2) return lick;
  const k = TICKS_PER_16TH;
  return {
    ...lick,
    version: 2,
    chords: lick.chords.map(c => ({ ...c, start: c.start * k, dur: c.dur * k })),
    notes: lick.notes.map(n => ({ ...n, start: n.start * k, dur: n.dur * k })),
    totalTicks: lick.totalTicks * k,
    ...(Array.isArray(lick.cellStarts) ? { cellStarts: lick.cellStarts.map(t => t * k) } : {}),
  };
}

export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!isObj(raw)) return s;
  if (typeof raw.progressionId === 'string' && PROGRESSIONS.some(p => p.id === raw.progressionId)) s.progressionId = raw.progressionId;
  if (typeof raw.length === 'string' && raw.length in LENGTHS) s.length = raw.length as Settings['length'];
  if (isNum(raw.target) && Number.isInteger(raw.target) && raw.target >= 0 && raw.target <= 100) s.target = raw.target;
  else if (isNum(raw.tier) && [1, 2, 3, 4].includes(raw.tier)) s.target = LEGACY_TIER_TARGET[raw.tier]; // migrate the old 4-way setting
  if (typeof raw.instrumentId === 'string' && INSTRUMENTS.some(i => i.id === raw.instrumentId)) s.instrumentId = raw.instrumentId;
  if (raw.key === 'random') s.key = 'random';
  else if (isNum(raw.key) && Number.isInteger(raw.key) && raw.key >= 0 && raw.key < 12) s.key = raw.key;
  if (isNum(raw.bpm)) s.bpm = clamp(Math.round(raw.bpm), 40, 320);
  if (isNum(raw.leadVolume)) s.leadVolume = clamp(raw.leadVolume, 0, 1);
  if (isNum(raw.pianoVolume)) s.pianoVolume = clamp(raw.pianoVolume, 0, 1);
  if (isNum(raw.drumVolume)) s.drumVolume = clamp(raw.drumVolume, 0, 1);
  if (raw.comp === 'rootless' || raw.comp === 'block' || raw.comp === 'sparse') s.comp = raw.comp;
  if (typeof raw.tabPosition === 'string' && (raw.tabPosition === 'auto' || TAB_POSITION_RE.test(raw.tabPosition))) s.tabPosition = raw.tabPosition;
  if (typeof raw.drillOrder === 'string' && (DRILL_ORDERS as readonly string[]).includes(raw.drillOrder)) s.drillOrder = raw.drillOrder as DrillOrder;
  if (isNum(raw.drillRepeats)) s.drillRepeats = clampInt(raw.drillRepeats, 1, 4);
  if (isNum(raw.drillTempoStep)) s.drillTempoStep = clampInt(raw.drillTempoStep, 0, 20);
  if (isNum(raw.drillMaxBpm)) s.drillMaxBpm = clampInt(raw.drillMaxBpm, 40, 320);
  if (raw.responsePasses === 1 || raw.responsePasses === 2) s.responsePasses = raw.responsePasses;
  for (const k of ['callResponse', 'showNotesInResponse', 'hideKeepChords'] as const) {
    if (isBool(raw[k])) s[k] = raw[k];
  }
  for (const k of ['slow', 'piano', 'loop', 'swing', 'straight16', 'hide', 'showTab', 'showFingers', 'countIn', 'metronome', 'drums', 'metronome24', 'midiBacking', 'analyze'] as const) {
    if (isBool(raw[k])) s[k] = raw[k];
  }
  return s;
}

/** Minimal slice of the Storage interface we rely on. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultBackend(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Facade over versioned localStorage. Never throws; behaves as an empty store when storage is blocked. */
export class Store {
  private backend: StorageLike | null;
  constructor(backend?: StorageLike | null) {
    this.backend = backend === undefined ? defaultBackend() : backend;
  }

  private read(key: string): unknown {
    try {
      const raw = this.backend?.getItem(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  /** False when the most recent write was rejected (quota, blocked storage). */
  lastWriteOk = true;

  private write(key: string, value: unknown): boolean {
    let ok = false;
    try {
      if (this.backend) {
        this.backend.setItem(key, JSON.stringify(value));
        ok = true;
      }
    } catch {
      ok = false;
    }
    this.lastWriteOk = ok;
    return ok;
  }

  private readEntries(key: string, limit: number): StoredEntry[] {
    const raw = this.read(key);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: StoredEntry[] = [];
    for (const e of raw) {
      if (!isObj(e) || !isNum(e.at) || !isValidLick(e.lick) || seen.has(e.lick.id)) continue;
      seen.add(e.lick.id);
      out.push({ lick: migrateLick(e.lick), at: e.at });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* settings */
  loadSettings(): Settings { return sanitizeSettings(this.read(KEYS.settings)); }
  saveSettings(s: Settings): void { this.write(KEYS.settings, s); }

  /* practice log: per-lick stats keyed by lickContentKey */
  loadPractice(): PracticeLog { return sanitizePractice(this.read(KEYS.practice)); }
  /** Record one completed pass of `lick` (in its own key) at `bpm`. Returns the stored log; unchanged if the write fails. */
  recordPractice(lick: Lick, bpm: number, at = Date.now()): PracticeLog {
    const before = this.loadPractice();
    const next = recordPass(before, lickContentKey(lick), lick.keyPc, bpm, at);
    return this.write(KEYS.practice, next) ? next : before;
  }

  /* history: newest first */
  loadHistory(): StoredEntry[] { return this.readEntries(KEYS.history, HISTORY_LIMIT); }
  addHistory(lick: Lick, at = Date.now()): StoredEntry[] {
    const list = [{ lick, at }, ...this.loadHistory().filter(e => e.lick.id !== lick.id)].slice(0, HISTORY_LIMIT);
    this.write(KEYS.history, list);
    return list;
  }
  removeHistory(id: string): StoredEntry[] {
    const list = this.loadHistory().filter(e => e.lick.id !== id);
    this.write(KEYS.history, list);
    return list;
  }
  clearHistory(): void { this.write(KEYS.history, []); }

  /* favorites: newest first */
  loadFavorites(): StoredEntry[] { return this.readEntries(KEYS.favorites, FAVORITES_LIMIT); }
  addFavorite(lick: Lick, at = Date.now()): StoredEntry[] {
    const before = this.loadFavorites();
    const list = [{ lick, at }, ...before.filter(e => e.lick.id !== lick.id)].slice(0, FAVORITES_LIMIT);
    // Return what is actually stored: if the write fails the list is unchanged.
    return this.write(KEYS.favorites, list) ? list : before;
  }
  removeFavorite(id: string): StoredEntry[] {
    const before = this.loadFavorites();
    const list = before.filter(e => e.lick.id !== id);
    return this.write(KEYS.favorites, list) ? list : before;
  }
}
