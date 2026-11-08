# Architecture & module contracts

A static Vite + TypeScript site with no backend. The music core in `src/` (everything except `ui/`, `main.ts`, the `Player` class and `render/notation.ts`) is pure TypeScript with no DOM. Vitest tests it in Node.

## Conventions (read first)
- **Shared types:** in `src/types.ts`. Don't change them without coordinating.
- **Time:** positions and durations are in **ticks = sixteenth notes**. 4 ticks make a beat and 16 make a 4/4 bar. Only these durations are drawable as one note: `RENDERABLE_DURS = [1,2,3,4,6,8,12,16]`.
- **Pitch:** lick pitches are **concert MIDI**. Written pitch = concert + `instrument.transpose`.
- **Tied notes:** a `LickNote` with `tie: true` is tied to the next note, which has the same midi. Playback merges tied notes into one sound.
- **Bar lines:** a lick note never crosses a bar line (multiples of 16 ticks). Every chord start tick has a note or rest starting on it.
- **Chord tones and tensions:** `src/theory/chords.ts` has `isChordTone`, `isChordToneOrTension`, `inScale` and `ALTERED_RELS`.
- **Spelling:** `src/theory/pitch.ts` has `keyUsesSharps`, `pcName`, `chordRootName`, `vexKey` and `keySignatureName`.
- **Progressions:** `src/theory/progressions.ts` has `PROGRESSIONS`, `LENGTHS` (short = 2+2+4 beats, standard = 4+4+4, long = 8+8+8), `expandProgression` and `getProgression`.
- **Instruments:** `src/instruments.ts` has `INSTRUMENTS`, `getInstrument` and `concertRange`.
- **Fragments:** `src/fragments/index.ts` exports `FRAGMENTS` and `fragmentsFor(quality, beats?)`. Fragment pitches (`rel`) are semitones from the chord root. Fragment durations are in ticks.
- **Legacy licks:** `scripts/legacy.ts` provides `loadPrototypeLicks()` (Node only). It returns the 55 prototype licks in C, already converted to ticks.

## Module contracts

### Generator: `src/generator/`
```ts
export interface GenerateOptions {
  progressionId: string; length: LengthId; keyPc: number; tier: Tier;
  range: [number, number];          // CONCERT comfortable range (use concertRange(inst))
  seed?: number;                    // default: random
  fragments?: Fragment[];           // default: FRAGMENTS
}
export function generateLick(opts: GenerateOptions): Lick;      // never throws for registered progressions
export function transposeLick(lick: Lick, keyPc: number, range: [number, number]): Lick;
```

### Difficulty: `src/difficulty/score.ts`
```ts
export function scoreLick(notes: LickNote[], chords: LickChord[], progression: ProgressionDef): DifficultyResult;
export function tierForScore(score: number): Tier;
export const TIER_THRESHOLDS: [number, number, number];          // score cut-offs between tiers 1|2, 2|3, 3|4
```

### Notation: `src/render/` (browser)
```ts
export interface RenderOptions { highlight?: number[]; showTab?: boolean; print?: boolean;
  tabPosition?: 'auto' | number; showFingers?: boolean }   // index into lickFingerings(...).positions
export function renderLick(container: HTMLElement, lick: Lick, inst: Instrument, opts?: RenderOptions): SVGSVGElement | null;
// src/render/tab.ts (pure)
export function assignFrets(written: (number | null)[], tuning: number[], frets: number): ({ str: number; fret: number } | null)[];
export function fingerLine(line: LineInput, tuning: number[], frets: number, opts?: FingerOptions): Fingering;  // + finger, hand position, shifts
export function positionsForLick(line: LineInput, tuning: number[], frets: number, cellStarts?: number[]): Fingering[];
export function lickFingerings(lick: Lick, inst: Instrument): { line; auto: Fingering; positions: Fingering[] } | null;  // memoised
```
The fingering model and its sources are in [GUITAR_TAB.md](GUITAR_TAB.md). Generated licks carry an optional `cellStarts` (tick of each fragment), which makes shifting at cell joins cheap; older saved licks without it still work.
`highlight` holds indices into `lick.notes`. `str` is 1-based with string 1 being the highest, the VexFlow convention.

### Audio: `src/audio/`
```ts
// timing.ts (pure)
export const SWING_RATIO = 2 / 3;
export function tickToBeats(tick: number, swing: boolean): number;   // position in beats, swing applied
// comping.ts (pure)
export type CompStyle = 'rootless' | 'block' | 'sparse';
export interface CompEvent { midi: number[]; tick: number; dur: number }            // concert, ticks
export function compEvents(chords: LickChord[], style: CompStyle): CompEvent[];      // piano right hand
export function bassEvents(chords: LickChord[]): CompEvent[];                         // walking/2-feel bass
// player.ts (browser)
export interface PlayOptions { bpm: number; swing: boolean; loop: boolean; metronome: boolean; countIn: boolean;
  piano: boolean; comp: CompStyle; leadVolume: number; pianoVolume: number; timbre: Timbre }
export interface PlayCallbacks { onNote?(indices: number[]): void; onStatus?(text: string): void; onEnd?(): void }
export class Player {
  get state(): 'stopped' | 'playing' | 'paused';
  play(lick: Lick, opts: PlayOptions, cb?: PlayCallbacks): void;
  pause(): void; resume(): void; stop(): void;
  setVolumes(lead: number, piano: number): void;
}
```

### Export: `src/export/`
```ts
// midi.ts (pure)
export function lickToMidi(lick: Lick, opts: { bpm: number; swing: boolean; comping: boolean; comp: CompStyle }): Uint8Array;
// pdf.ts (browser)
export async function exportPdf(lick: Lick, inst: Instrument): Promise<void>;  // triggers download
```

### Storage: `src/storage/`
Versioned localStorage holding settings, favorites and history. Licks are stored as full `Lick` JSON. Every access is wrapped in try/catch.

## Adding a progression
1. Add an entry to `PROGRESSIONS` in `src/theory/progressions.ts`.
2. If it uses a new chord quality, add the quality to `ChordQualityId` and `CHORDS`, then add fragments for it in `src/fragments/lib/`.
3. Run `npm test`. The generator tests cover every registered progression automatically.
