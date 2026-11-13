# ii–V–I Lick Studio

A free web app that **generates jazz ii–V–I (2-5-1) licks** and rates how hard each one is.

- **Generated, not canned.** Each lick is stitched together from a library of short melodic cells, one per chord, using voice-leading rules. The notes on each chord change land on chord tones, the joins are smoothed with chromatic approaches and enclosures, and every lick resolves.
- **Honest difficulty.** Each lick is scored from its actual notes: rhythmic density, 16th-notes, syncopation, chromaticism, altered tensions, leaps and range. The score then puts it into one of four tiers: **Beginner, Intermediate, Advanced or Expert**. The app also shows why it got that rating.
- **Progressions.** It covers major ii–V–I (also with an altered V), minor iiø–V–i, the tritone sub ii–♭II–I and the backdoor iv–♭VII–I. Each comes in short (2 bars), standard (3 bars) or long (6 bars) form, in all 12 keys.
- **Instruments.**
  - Treble-clef instruments: B♭, E♭, F and C.
  - Bass-clef instruments: trombone, cello, bass and piano left hand.
  - Guitar and bass, with tablature.
- **Practice tools.**
  - Synthesized playback with piano and bass backing.
  - Swing or straight feel.
  - Metronome, count-in, loop and a slow-practice mode.
  - A hide-notation mode for playing from memory.
- **Keep and export.** You can save favorites and see your history; both are stored in your browser, with no account. Any lick downloads as **MIDI** or **PDF**.

## Development

```bash
npm install
```

```bash
npm run dev       # local dev server
```

```bash
npm test          # unit tests (Vitest)
```

```bash
npm run build     # type-check + production build into dist/
```

```bash
npm run report    # print generator tier hit-rates and sample licks
```

## Deploying to Vercel (free)

1. Push this repository to GitHub. It is already there if you are reading this on GitHub.
2. Go to <https://vercel.com/new>, sign in with GitHub and **Import** this repository.
3. Keep the detected settings: **Framework preset: Vite**, **Build command:** `npm run build`, **Output directory:** `dist`. Then click **Deploy**.
4. Every push to the default branch redeploys automatically, and every pull request gets its own preview URL.

The site is fully static: no server, no database, no API keys. Vercel's free Hobby plan is enough.

## How it works

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout and contracts.

| Folder | What it does |
| --- | --- |
| `src/theory/` | Pitch spelling, chord qualities, progression registry |
| `src/fragments/` | The melodic cells the generator uses, keyed by chord quality |
| `src/generator/` | Seeded generator: fill slots, voice-lead, fix joins, hit the requested tier |
| `src/difficulty/` | Feature-based difficulty score (0–100) and tiers |
| `src/render/` | VexFlow notation, bass clef, tablature |
| `src/audio/` | Web Audio synth, comping, bass, swing scheduler |
| `src/export/` | MIDI and PDF export |
| `legacy/` | The original single-file prototype; its hand-written licks were mined for fragments |

### Adding a progression

1. Add an entry to `PROGRESSIONS` in `src/theory/progressions.ts`.
2. If it uses a new chord quality, add the quality to `src/theory/chords.ts` and some fragments for it in `src/fragments/lib/`.
3. Run `npm test`. The generator tests automatically cover every registered progression in every length and tier.

### Adding fragments

Fragments live in `src/fragments/lib/`. Each one is a 2- or 4-beat cell. Pitches are written as semitones above the chord root, and durations in 16th-note units (the app scales them to its 12-ticks-per-beat grid on load). `tests/fragments.test.ts` checks that each fragment is well formed and that the notes on strong beats are chord tones.

All licks and fragments are original material written for this tool.
