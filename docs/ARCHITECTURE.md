# Architecture & module contracts

A static Vite + TypeScript site with no backend. The music core in `src/` (everything except `ui/`, `main.ts`, the `Player` class and `render/notation.ts`) is pure TypeScript with no DOM. Vitest tests it in Node.

## Conventions (read first)
- **Shared types:** in `src/types.ts`. Don't change them without coordinating.
- **Time:** positions and durations are integer **ticks on a 12-per-beat grid** (`TPB = 12`, `TPBAR = 48`, `TICKS_PER_16TH = 3` in `src/types.ts`), so triplets also land on whole ticks. 16th = 3, 8th = 6, dotted 8th = 9, quarter = 12, dotted quarter = 18, half = 24, dotted half = 36, whole = 48. Only these durations are drawable as one note: `RENDERABLE_DURS = [3,6,9,12,18,24,36,48]`. `TRIPLET_DURS = [2,4,8]` (16th-, 8th- and quarter-triplet) is exported for the upcoming triplet work and is not used yet. Use the constants, never raw tick literals. `splitDur`, `beatOf` and `barOf` live in `src/theory/rhythm.ts` and are shared by the generator and the notation renderer (`splitDur` throws if a duration cannot be expressed).
- **Pitch:** lick pitches are **concert MIDI**. Written pitch = concert + `instrument.transpose`.
- **Tied notes:** a `LickNote` with `tie: true` is tied to the next note, which has the same midi. Playback merges tied notes into one sound.
- **Bar lines:** a lick note never crosses a bar line (multiples of `TPBAR` = 48 ticks). Every chord start tick has a note or rest starting on it.
- **Chord tones and tensions:** `src/theory/chords.ts` has `isChordTone`, `isChordToneOrTension`, `inScale` and `ALTERED_RELS`.
- **Spelling:** `src/theory/spell.ts` (pure) spells every pitch as letter + accidental from the chord it sits over. (1) The tonic is spelled as `keySignatureName` names it. (2) `spellChordRoot` gives each chord root its letter from the tonic letter + degree (ii = 2nd letter, V = 5th, ♭II = 2nd, iv = 4th, ♭VII = 7th). Diatonic roots (I/i, ii, V; degrees 0, 2, 7) are NEVER swapped, even when a chord tone then needs a double sharp (G♯ minor: A♯m7♭5 – D♯7alt – G♯m6). Only borrowed roots (♭II, iv, ♭VII) switch to the enharmonic root when their own spelling is awkward or their chord tones need doubles (♭II7 in D♭ = D7 not E𝄫7, iv in G♭ = Bm7 not C♭m7, ♭VII7 in G♭ = E7 not F♭7). (3) `spellNote` / `spellScale` put a note on root letter + its chord-degree step (table `STEPS` per quality). Rule table: **chord tones** (root, 3, 5, 7 / 6 of the quality) keep their letter, double accidentals included (F𝄪 = 3rd of D♯7alt); the **leading tone of the minor tonic chords** m6 / mMaj7 keeps its letter too (F𝄪 in G♯m6); **tensions / other scale tones** that would need a double accidental move to the neighbouring letter (D♭7alt = D♭ D E F G A C♭: ♭9 D, ♯9 E, ♭5 G, ♭13 A), and the ♯9 of an altered chord (normally written as ♭3) uses the neighbour letter if it would be F♭/C♭; **chromatic** (non-scale) notes are sharp-of-lower when the line rises, flat-of-upper when it falls. Altered = G A♭ B♭ B D♭ E♭ F with ♯9 written ♭3 and ♯11 as ♭5. Double accidentals therefore occur only in G♯ minor. `spellLick(lick, inst)` spells a whole lick in the WRITTEN key (tied continuations keep the head's spelling); `spellScale` feeds Analyze; `formatSpelling(s, 'unicode' | 'ascii' | 'vex')` (double accidentals: `𝄪` / `𝄫`, `##` / `bb`; VexFlow keys like `f##/4`) and `chordSymbolText` produce strings. Sheet chord symbols and `LickChord.symbol` use ♭/♯ glyphs. The renderer passes the VexFlow key (e.g. `cb/4`) straight to `StaveNote` and `Accidental.applyAccidentals` decides which accidentals to show. `pitch.ts` still has `keyUsesSharps`, `pcName` (key picker / titles), `keySignatureName`; `vexKey` / `chordRootName` are legacy and no longer used for licks.
- **Progressions:** `src/theory/progressions.ts` has `PROGRESSIONS`, `LENGTHS` (short = 2+2+4 beats, standard = 4+4+4, long = 8+8+8), `expandProgression` and `getProgression`.
- **Instruments:** `src/instruments.ts` has `INSTRUMENTS`, `getInstrument` and `concertRange`.
- **Fragments:** `src/fragments/index.ts` exports `FRAGMENTS` and `fragmentsFor(quality, beats?)`. Fragment pitches (`rel`) are semitones from the chord root. Fragments are **authored in sixteenth-note units** (1 = 16th, 4 = quarter) in `src/fragments/lib/*`; `fromSixteenths` multiplies every duration by `AUTHORED_UNIT` (3) on load, so `FRAGMENTS` and `fragmentsFor` already use engine ticks. Do not edit the library files to the new grid. `scripts/mine-prototype.ts` therefore works and emits in 16ths and keeps its own 16th-based split.
- **Legacy licks:** `scripts/legacy.ts` provides `loadPrototypeLicks()` (Node only). It returns the 55 prototype licks in C, already converted to engine ticks.

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
export interface RenderOptions {
  highlight?: number[]; showTab?: boolean; print?: boolean;
  highlightColor?: string;                       // now-playing note colour (default burnt orange)
  chordFont?: { family: string; weight?: string }; // chord-symbol font (default Georgia bold)
  romans?: string[];                             // one roman numeral per lick.chords entry, drawn after each symbol
  activeBar?: number; activeBarColor?: string;   // faint tint behind the bar being played (ignored in print)
  tabPosition?: 'auto' | number;                 // tab fingering: index into lickFingerings(...).positions
  showFingers?: boolean;                         // finger numbers on every tab note (else only at shifts)
  noteLabels?: ({ text: string; color?: string } | null | undefined)[]; // per lick note, drawn in a row under the staff (above the tab)
}
// Triplets: pieces in a triplet group keep their real tick duration, are written at tupletDisplayDur and get a VexFlow
// Tuplet(3:2) (beamed 8th/16th groups show only the "3"; quarter triplets and groups with rests get a bracket). Triplet
// groups beam on their own; other notes beam per beat and never join a triplet. buildPieces() is exported and pure.
// Tab ("Tab. full"): TabNotes with stems/beams/tuplets BELOW the tab staff; rests are StaveNote rests drawn on the tab
// stave; tied continuations keep the stem but show no fret number.
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
export async function exportPdf(lick: Lick, inst: Instrument,
  opts?: Pick<RenderOptions, 'showTab' | 'tabPosition' | 'showFingers' | 'noteLabels'>): Promise<void>;  // triggers download
// Same renderer as on screen (print mode). showTab defaults to !!inst.tab only when the caller passes none,
// so the user's "Show tab" setting is honoured.
```

### Storage: `src/storage/`
Versioned localStorage holding settings, favorites and history. Licks are stored as full `Lick` JSON. `Lick.version` is `2` (12 ticks per beat); version `1` licks (16th-note ticks, 4 per beat) are still accepted by `isValidLick` and are converted by `migrateLick` (every tick value times 3) whenever history or favorites are loaded, so the rest of the app only sees version 2. Every access is wrapped in try/catch.

## Adding a progression
1. Add an entry to `PROGRESSIONS` in `src/theory/progressions.ts`.
2. If it uses a new chord quality, add the quality to `ChordQualityId` and `CHORDS`, then add fragments for it in `src/fragments/lib/`.
3. Run `npm test`. The generator tests cover every registered progression automatically.
