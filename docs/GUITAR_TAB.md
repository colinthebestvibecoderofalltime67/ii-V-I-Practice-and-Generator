# Guitar and bass tab fingering

How the app picks strings, frets and fingers for tab (`src/render/tab.ts`), and why. The first half summarises how guitarists and bassists finger single-note jazz lines. The second half turns that into the cost function.

## Research summary

**Position playing and one finger per fret.** A *position* is named after the fret under the index finger. In a position each finger covers one fret, so the hand covers a 4-fret box across all six strings, about two and a half octaves. The index and the pinky can each reach one fret further, out to a 5-fret box. The two middle fingers stay put and anchor the hand. Moving one finger is a *stretch*; moving the whole hand to a new box is a *position shift*. Ted Greene's *Single Note Soloing* and most jazz methods teach scales and arpeggios this way.
Sources: [Mickylee, guitar positions](https://virtualsheetmusic.com/experts/mickylee/guitar-positions), [Definitive guide to scale positions for jazz guitar](https://www.jazzguitarlessons.net/blog/definitive-guide-scale-positions-jazz-guitar), [jazzguitar.be: scales and positions](https://www.jazzguitar.be/forum/getting-started/80526-scales-positions-improvisation-2.html).

**CAGED and 3-notes-per-string.** CAGED shapes are five position boxes tied to chord shapes. They mix two and three notes per string, and they are good for seeing chord tones under a line. 3-notes-per-string (3NPS) fingerings place exactly three notes on each string. The hand creeps up the neck one shift per string or two, which suits fast scale runs and moving *between* CAGED boxes. Most jazz players use both: a box for the core of a line, and a 3NPS-style creep or a slide when the line runs out of the box.
Sources: [jazzguitar.be: 3NPS + CAGED](https://www.jazzguitar.be/forum/guitar-technique/82349-3nps-caged.html), [thefretboard: 3NPS vs CAGED](https://www.thefretboard.co.uk/discussion/comment/1752370), [jazzguitar.be: how well does CAGED work for jazz](https://jazzguitar.be/forum/theory/13219-how-well-does-caged-method-work-playing-jazz.html).

**Where to shift.** Teachers and players shift where it costs nothing in time: during a rest or a held note, at a phrase or cell boundary, on a beat, or by sliding one finger a half step (Pat Martino's half-step trick, Barry Harris-style lines). A shift in the middle of a run of 16ths is the hardest place. Bebop lines often need shifts, so the goal is to put them in good places rather than to avoid them entirely.
Sources: [jazzguitar.be: do you avoid changing positions?](https://www.jazzguitar.be/forum/guitar-technique/37697-do-you-avoid-changing-positions-when-you-play.html), [jazzguitar.be: bebop technique](https://www.jazzguitar.be/forum/guitar-technique/99644-bebop-technique.html), [jazzguitar.be: enclosure fingerings](https://www.jazzguitar.be/forum/guitar-technique/101323-enclosures-fingerings-bebop.html), [Jazz Guitar Today: the second-string shift](https://jazzguitartoday.com/2020/09/learn-the-second-string-shift).

**String skips and same-finger jumps.** Adjacent strings are easier to pick and finger than skipped ones. Playing two consecutive notes with the same finger on different strings and frets forces a jump. Doing it on the same fret is a *roll*, which is acceptable.

**Open strings.** Jazz guitarists mostly avoid open strings in lines: they ring on, can't be bent or muted the same way, sound different from fretted notes, and break transposable fingerings. They are normal in open position (first position) and are useful as a moment to shift. Some players, such as Ralph Towner and Gene Bertoncini, use them on purpose as drones.
Sources: [Bouffard jazz guitar guidelines (UNL)](https://music.unl.edu/jazzstudies/Bouffard_Jazz_Guitar_Guidelines.pdf), [jazzguitar.be: open strings in single-note soloing](https://www.jazzguitar.be/forum/improvisation/81742-using-open-strings-during-single-note-soloing-improvisation.html).

**How software chooses.** Tab editors and research systems treat fingering as a shortest path, an idea that goes back to Sayegh (1989, the "optimum path paradigm", in other words Viterbi or dynamic programming). Radicioni and Lombardo added phrase segmentation and finger estimation. Typical costs are hand travel (often Manhattan distance on the fretboard), stretches and string changes. MuseScore's automatic tab favours the lowest frets, and users fix positions by hand. Guitar Pro has an "automatic fingering" wizard that minimises hand movement, but its algorithm isn't documented. Lick books usually print one position, often marked "Pos. V" and the like, with finger numbers at shifts.
Sources: [Sayegh-style DP, KTH thesis (DiVA)](https://www.diva-portal.org/smash/get/diva2:668903/FULLTEXT01.pdf), [Radicioni & Lombardo, ISMIR 2007](https://archives.ismir.net/ismir2007/paper/000355.pdf), [Path difference learning for guitar fingering (ICMC 2004)](https://www.mistic.ece.uvic.ca/publications/2004_icmc_pdl.pdf), [MuseScore forum: tab fret choice](https://musescore.org/en/node/308140), [US patent 7238876, automated fingering](https://patents.google.com/patent/US7238876).

**Bass.** Upright players use Simandl 1-2-4 fingering: index, middle and pinky over three frets, with the ring finger helping the pinky. Many electric bassists use 1-2-4 in the low positions, where frets are wide, and one finger per fret from about the 5th to 7th fret up. Bassists shift more often than guitarists and think less in boxes.
Sources: [BassBuzz: fingering showdown](https://forum.bassbuzz.com/t/are-you-fretting-the-wrong-way-bass-fingering-showdown/11476), [Bass Bros: the Simandl technique](https://bassbros.co.uk/blog/the-simandl-technique-game-changer-or-thing-of-the-past/), [TalkingBass: problems with one finger per fret](https://www.talkingbass.net/problems-with-the-1-finger-per-fret-system/).

Caveat: most practice-level sources are teachers' blogs and forums, so the numbers below are judgment calls tuned on real licks, not measured constants.

## Cost model (`src/render/tab.ts`)

**State.** For every note, each state is a string, a fret, a hand position `hp` (the fret under the index finger) and the stretch side already used in that position (none, index-down or pinky-up). The finger follows from `fret − hp`:

| offset | guitar (one finger per fret) | bass below pos. VII (1-2-4) |
| --- | --- | --- |
| −1 | 1, index stretch | 1, stretch |
| 0 | 1 | 1 |
| 1 | 2 | 2 |
| 2 | 3 | 4 |
| 3 | 4 | 4, stretch |
| 4 | 4, pinky stretch | – |

**Hard rules.**
- A position may stretch one way only, so it never covers more than 5 frets.
- An open string keeps the hand where it is. Any shift around it is charged on the next fretted note.

**Costs.** Guitar values, with bass values in brackets where different:

| What | Cost |
| --- | --- |
| Position shift | 3.0 [2.0] + 0.3 per fret of travel (+0.3 per fret beyond 5), times the shift-point discount |
| Stretch | 0.8 [1.0] |
| Same finger, different string and fret | 1.5 |
| Roll: same finger, same fret, next string | 0.5 |
| String skip | 0.9 per skipped string (half after a rest) |
| Hand position | 0.02 × position (a mild preference for lower positions) |
| Frets above 12 | 0.25 per fret |
| Open string | 0.5 in positions I–III, 1.5 in IV–V, 3.0 higher; at most 0.3 when the open string is the only way to play the note |

**Shift-point discounts.** These multiply together, with a floor of 0.12:

| Shift point | Multiplier |
| --- | --- |
| At a cell join (`lick.cellStarts`) | 0.35 |
| After a rest | 0.4 |
| After a quarter note or longer | 0.5 |
| After a dotted 8th | 0.75 |
| Half-step slide on one string with the same finger | 0.45 |
| Whole-step slide | 0.65 |
| Shifting next to an open string | 0.5 |
| On the beat | 0.85 |

**Search.** A Viterbi pass over the states finds the cheapest path. It is deterministic, because ties keep the first state in a fixed order. A 50-note lick takes a few milliseconds per pass.

**Positions ("play it in every position").** `positionsForLick` re-runs the search once per neck position *P*. Each run adds an anchor cost of 1.2 per fret that the hand sits away from *P*, per note. Each result gets a label from its main position ("Pos. V", or "Open pos." for first position with open strings) and is re-scored without the anchor. A result is dropped when:
- it needs more than `1 + ⌊notes/16⌋` shifts;
- it costs far more than the easiest fingering;
- it repeats a cheaper result: same label, a main position within one fret, or more than 70% of notes on the same strings. Open position and II are kept apart.

**Tab display.**
- The opening position is labelled above the tab, and every shift gets a new label.
- The note at each label shows its suggested finger.
- **Finger numbers** adds a finger to every fretted note.
- Marks are small grey sans-serif text, or black in print and PDF.
