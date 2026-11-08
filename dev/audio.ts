import { Player } from '../src/audio/player';
import { expandProgression, PROGRESSIONS } from '../src/theory/progressions';
import type { Lick, LickNote, Timbre } from '../src/types';

const chords = expandProgression(PROGRESSIONS[0], 'standard', 0);
const N = (midi: number | null, start: number, dur: number, tie = false): LickNote =>
  ({ midi, start, dur, tie: tie || undefined, chord: Math.min(2, Math.floor(start / 16)) });
const lick: Lick = {
  version: 1, id: 'fixture', seed: 1, progressionId: PROGRESSIONS[0].id, length: 'standard', keyPc: 0, mode: 'major',
  requestedTier: 1, chords, totalTicks: 48, fragmentIds: [], difficulty: { score: 0, tier: 1, features: [] }, createdAt: 0,
  notes: [N(62, 0, 2), N(65, 2, 2), N(69, 4, 2), N(72, 6, 2), N(null, 8, 4), N(71, 12, 2), N(69, 14, 2),
    N(67, 16, 4, true), N(67, 20, 4), N(65, 24, 2), N(64, 26, 2), N(62, 28, 4), N(60, 32, 8, true), N(60, 40, 8)],
};

const w = window as unknown as { noteCount: number; ended: boolean };
w.noteCount = 0; w.ended = false;
const player = new Player();
const $ = (id: string) => document.getElementById(id)!;
$('play').onclick = () => {
  w.ended = false;
  player.play(lick, {
    bpm: 160, swing: true, loop: (document.getElementById('loop') as HTMLInputElement).checked, metronome: true, countIn: true,
    piano: true, comp: 'rootless', leadVolume: 0.8, pianoVolume: 0.6,
    timbre: (document.getElementById('timbre') as HTMLSelectElement).value as Timbre,
  }, {
    onNote: i => { w.noteCount++; $('note').textContent = JSON.stringify(i); },
    onStatus: s => { $('status').textContent = s; },
    onEnd: () => { w.ended = true; $('status').textContent = 'Ended'; },
  });
};
$('pause').onclick = () => player.pause();
$('resume').onclick = () => player.resume();
$('stop').onclick = () => player.stop();
