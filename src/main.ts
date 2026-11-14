import './styles.css';
import type { Instrument, Lick, Tier } from './types';
import { TIER_NAMES, TPBAR } from './types';
import { barOf } from './theory/rhythm';
import { LENGTHS, PROGRESSIONS, getProgression } from './theory/progressions';
import { INSTRUMENTS, concertRange, concertRangeForLevel, getInstrument } from './instruments';
import { generateLick, randomSeed, transposeLick } from './generator';
import { FEATURE_MAX, displayScore, posToScore, scoreToPos, tierForScore } from './difficulty/score';
import { analyzeLick, type LickAnalysis, type NoteKind } from './theory/analyze';
import { renderLick, type NoteLabel } from './render/notation';
import { lickFingerings } from './render/tab';
import { Player, type PassAction, type PlayOptions } from './audio/player';
import { sessionStep, type SessionConfig } from './practice/session';
import { clampInt, drillKeys, type DrillConfig, type DrillOrder } from './practice/drill';
import { lickToMidi } from './export/midi';
import { Store, type Settings, type StoredEntry } from './storage';
import { Library } from './ui/library';
import { parseShareHash, shareUrl } from './share';
import { downloadBlob, fileName, isTransposing, keyLabel, progressionName, titleKeyLabel } from './ui/format';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('Missing element #' + id);
  return el as T;
};

const store = new Store();
const settings: Settings = store.loadSettings();
let history: StoredEntry[] = store.loadHistory();
/** New licks avoid the cells of the last few licks, so a practice session keeps hearing new figures. */
const RECENT_LICKS = 8;
let favorites: StoredEntry[] = store.loadFavorites();
let lick: Lick | null = null;
/** The lick as generated or loaded, before any refit. Refits always start from it, so folding notes into a
 * narrow range (e.g. bass) is undone when switching back to a wider instrument. */
let sourceLick: Lick | null = null;
let highlight: number[] = [];
const player = new Player();

const inst = (): Instrument => getInstrument(settings.instrumentId);
const persist = (): void => store.saveSettings(settings);
/** Slow practice is 60% of the tempo but never below the player's 40 bpm floor, so display, playback and MIDI agree. */
const effectiveBpm = (): number => (settings.slow ? Math.max(40, Math.round(settings.bpm * 0.6)) : settings.bpm);
const targetTier = (): Tier => tierForScore(posToScore(settings.target));
/** Comfortable range for re-keying or re-fitting a lick: the level it was generated for, not the current slider. */
const comfortFor = (l: Lick): [number, number] =>
  concertRangeForLevel(inst(), l.targetScore !== undefined ? tierForScore(l.targetScore) : l.requestedTier);

/** Highlight colour on the (always white) notation sheet. */
const SHEET_ACCENT = '#2747C9';
/** Note-label colours on the (always white) sheet; the panel legend uses the --k-* CSS tokens, same hues. */
const KIND_COLOR: Record<NoteKind, string> = { chord: '#1C1C1A', tension: '#2747C9', scale: '#6E6D67', chromatic: '#9A3B8F' };
const CHORD_FONT = { family: "Geist, system-ui, sans-serif", weight: '600' };

/** Short names for the sidebar list; the full name is used everywhere else. */
const SHORT_NAME: Record<string, string> = {
  'major-251': 'Major',
  'major-251-alt': 'Altered dominant',
  'minor-251': 'Minor',
  'tritone-251': 'Tritone substitute',
  'backdoor-251': 'Backdoor',
};
const TIER_DESC: Record<Tier, string> = {
  1: 'Guide tones, simple rhythms',
  2: 'Eighth-note lines, scale and arpeggio',
  3: 'Enclosures, chromatic approaches, anticipations',
  4: 'Altered colour, triplets, faster lines',
};

/** "Imaj7" -> "I", "V7alt" -> "V7alt", "iiø7" -> "iiø", "i6" -> "i". */
const romanShort = (r: string): string => r.replace(/maj7|7(?!alt)|6/g, '');
const romansFor = (progressionId: string): string[] => getProgression(progressionId).slots.map(s => romanShort(s.roman));
const lengthShort = (id: keyof typeof LENGTHS): string => /\((.*)\)/.exec(LENGTHS[id].label)?.[1] ?? LENGTHS[id].label;
const instShort = (i: Instrument): string => i.name.replace(/\s*\(.*\)$/, '');

/* ---------------------------------------------------------------- controls */

function radio(name: string, value: string, html: string): HTMLLabelElement {
  const l = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  l.append(input);
  l.insertAdjacentHTML('beforeend', html);
  return l;
}

function buildStaticControls(): void {
  $('prog-list').replaceChildren(...PROGRESSIONS.map(p =>
    radio('prog', p.id, `<span>${SHORT_NAME[p.id] ?? p.name}</span><span class="roman">${romansFor(p.id).join(' ')}</span>`)));
  $('len-list').replaceChildren(...(Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map(id =>
    radio('len', id, `<span>${lengthShort(id)}</span>`)));
  $<HTMLSelectElement>('sel-inst').innerHTML = INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
}

function fillKeyOptions(): void {
  // Labels follow the lick on screen (its mode), not the sidebar progression.
  const mode = lick ? lick.mode : getProgression(settings.progressionId).mode;
  const sel = $<HTMLSelectElement>('sel-key');
  let html = '<option value="random">Random</option>';
  // Transposing instruments read the written key (matching the title); the concert key follows in brackets.
  const t = inst().transpose;
  for (let pc = 0; pc < 12; pc++) {
    const concert = keyLabel(pc, mode);
    const label = t % 12 === 0 ? concert : `${keyLabel((pc + t) % 12, mode)} (concert ${concert})`;
    html += `<option value="${pc}">${label}</option>`;
  }
  sel.innerHTML = html;
  sel.value = String(settings.key);
}

const check = (id: string, on: boolean): void => { $<HTMLInputElement>(id).checked = on; };
const setRadio = (name: string, value: string): void => {
  document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(r => { r.checked = r.value === value; });
};

function syncControls(): void {
  const prog = getProgression(settings.progressionId);
  const i = inst();
  setRadio('prog', settings.progressionId);
  syncTarget();
  $('t-analyze').setAttribute('aria-pressed', String(settings.analyze));
  setRadio('len', settings.length);
  $<HTMLSelectElement>('sel-inst').value = settings.instrumentId;
  $<HTMLSelectElement>('sel-key').value = String(settings.key);
  $('prog-desc').textContent = prog.description;
  const hint = $('tier-hint');
  if (targetTier() < prog.minTier) {
    hint.hidden = false;
    hint.textContent = `${prog.name} is usually ${TIER_NAMES[prog.minTier]} material, so ${TIER_NAMES[targetTier()]} licks here will be very simple.`;
  } else hint.hidden = true;

  check('c-swing', settings.swing);
  check('c-straight16', settings.straight16);
  $<HTMLInputElement>('c-straight16').disabled = !settings.swing;
  $('straight16-wrap').setAttribute('aria-disabled', String(!settings.swing));
  check('c-piano', settings.piano);
  check('c-loop', settings.loop);
  check('c-hide', settings.hide);
  $('tab-wrap').hidden = !i.tab;
  check('c-tab', settings.showTab);
  $('fingers-wrap').hidden = !i.tab || !settings.showTab;
  check('c-fingers', settings.showFingers);
  syncPositions();
  check('c-slow', settings.slow);
  check('c-count', settings.countIn);
  check('c-met', settings.metronome);
  check('c-midi', settings.midiBacking);
  $<HTMLInputElement>('r-bpm').value = String(settings.bpm);
  $('bpm-val').textContent = String(effectiveBpm());
  $('bpm-val').title = settings.slow ? `Slow practice: 60% of ${settings.bpm} (minimum 40)` : '';
  $<HTMLSelectElement>('sel-comp').value = settings.comp;
  $<HTMLSelectElement>('sel-drill').value = settings.drillOrder;
  $<HTMLSelectElement>('sel-drill-rep').value = String(settings.drillRepeats);
  $<HTMLInputElement>('n-drill-step').value = String(settings.drillTempoStep);
  $<HTMLInputElement>('n-drill-max').value = String(settings.drillMaxBpm);
  for (const id of ['sel-drill-rep', 'n-drill-step', 'n-drill-max']) $<HTMLInputElement>(id).disabled = !drillOn();
  $<HTMLInputElement>('r-lead').value = String(settings.leadVolume);
  $<HTMLInputElement>('r-piano').value = String(settings.pianoVolume);

  check('c-cr', settings.callResponse);
  check('c-cr-show', settings.showNotesInResponse);
  check('c-hide-keep', settings.hideKeepChords);
  setRadio('cr-resp', String(settings.responsePasses));
  syncCover();
  updateTransport();
  updateFav();
}

/* ---------------------------------------------------------------- difficulty slider */

function syncTarget(): void {
  const tier = targetTier();
  const score = displayScore(posToScore(settings.target));
  const r = $<HTMLInputElement>('r-target');
  r.value = String(settings.target);
  r.style.setProperty('--pos', String(settings.target / 100));
  r.setAttribute('aria-valuetext', `${TIER_NAMES[tier]}, score ${score}`);
  $('target-tier').textContent = TIER_NAMES[tier];
  $('target-score').textContent = `· aims for ${score} / 100`;
  $('target-desc').textContent = TIER_DESC[tier];
}

/* ---------------------------------------------------------------- analysis */

let analysisFor: { lick: Lick; inst: Instrument; result: LickAnalysis } | null = null;

function currentAnalysis(): LickAnalysis | null {
  if (!lick) return null;
  const i = inst();
  if (!analysisFor || analysisFor.lick !== lick || analysisFor.inst !== i) analysisFor = { lick, inst: i, result: analyzeLick(lick, i) };
  return analysisFor.result;
}

function renderAnalysis(): void {
  const panel = $('analysis');
  const a = settings.analyze ? currentAnalysis() : null;
  panel.hidden = !a;
  if (!a) return;
  $('an-rows').replaceChildren(...a.chords.map(c => {
    const row = document.createElement('div');
    row.className = 'an-row';
    const mk = (cls: string, text: string): HTMLElement => {
      const e = document.createElement('span');
      e.className = cls;
      e.textContent = text;
      return e;
    };
    const notes = mk('an-notes', '');
    notes.append(...c.scaleNotes.map(n => mk('', n)));
    notes.setAttribute('aria-label', 'Scale notes: ' + c.scaleNotes.join(' '));
    row.append(mk('an-sym', c.symbol), mk('an-rom', c.roman), mk('an-scale', c.scaleName + ' scale'), notes);
    return row;
  }));
}

function setAnalyze(on: boolean): void {
  settings.analyze = on;
  persist();
  syncControls();
  renderAnalysis();
  renderNotation();
}

/* ---------------------------------------------------------------- tab positions */

/** Fill the Position select from the current lick; fall back to Auto when the saved position is not playable. */
function syncPositions(): void {
  const i = inst();
  const fing = lick && i.tab ? lickFingerings(lick, i) : null;
  $('pos-wrap').hidden = !i.tab || !settings.showTab;
  if (fing && settings.tabPosition !== 'auto' && !fing.positions.some(p => p.label === settings.tabPosition)) {
    settings.tabPosition = 'auto';
    persist();
  }
  const sel = $<HTMLSelectElement>('sel-pos');
  const opts = [new Option('Auto (easiest)', 'auto')];
  for (const p of fing?.positions ?? []) {
    const frets = p.window[0] === p.window[1] ? `fret ${p.window[0]}` : `frets ${p.window[0]}–${p.window[1]}`;
    const shifts = p.shifts ? `, ${p.shifts} shift${p.shifts > 1 ? 's' : ''}` : '';
    opts.push(new Option(`${p.label} (${frets}${shifts})`, p.label));
  }
  const sig = opts.map(o => o.value + o.text).join('|');
  if (sel.dataset.sig !== sig) { sel.replaceChildren(...opts); sel.dataset.sig = sig; }
  sel.value = settings.tabPosition;
}

/** RenderOptions.tabPosition for the current lick. */
function tabIndex(): 'auto' | number {
  if (!lick || settings.tabPosition === 'auto') return 'auto';
  const i = lickFingerings(lick, inst())?.positions.findIndex(p => p.label === settings.tabPosition) ?? -1;
  return i < 0 ? 'auto' : i;
}

/* ---------------------------------------------------------------- display */

/** Index of the note that most recently started during playback (a tied continuation in a new bar counts). */
let currentNote = -1;

function activeBar(): number | undefined {
  if (!lick || !highlight.length) return undefined;
  const n = lick.notes[currentNote >= 0 && highlight.includes(currentNote) ? currentNote : highlight[0]];
  return n ? barOf(n.start) : undefined;
}

function renderNotation(): void {
  if (!lick) return;
  renderLick($('score'), lick, inst(), {
    highlight,
    showTab: settings.showTab && !!inst().tab,
    tabPosition: tabIndex(),
    showFingers: settings.showFingers,
    highlightColor: SHEET_ACCENT,
    chordFont: CHORD_FONT,
    romans: romansFor(lick.progressionId),
    activeBar: activeBar(),
    noteLabels: noteLabels(),
    hideNotes: notesCovered() && settings.hideKeepChords,
  });
}

/* ---------------------------------------------------------------- hiding the notes (Hide notes + response passes) */

/** True during a response pass whose notes are hidden (set by the session; see drillOnPassStart). */
let responseHide = false;
const notesCovered = (): boolean => settings.hide || responseHide;

/** Cover the sheet (text overlay) or, with chord symbols kept, redraw it without notes. */
function syncCover(): void {
  const wholeCover = notesCovered() && !settings.hideKeepChords;
  $('paper').classList.toggle('covered', wholeCover);
  $('score').classList.toggle('hidden', wholeCover);
  $('cover').setAttribute('aria-hidden', String(!wholeCover));
  $('cover').textContent = responseHide ? 'Your turn. Play it back.' : 'Now play it from memory.';
}

function setResponseHide(on: boolean): void {
  if (responseHide === on) return;
  responseHide = on;
  syncCover();
  renderNotation();
}

/** Degree labels for the sheet when Analyze is on. */
function noteLabels(): (NoteLabel | null)[] | undefined {
  if (!settings.analyze) return undefined;
  return currentAnalysis()?.notes.map(n => (n ? { text: n.label, color: KIND_COLOR[n.kind] } : null));
}

function setStatus(s: string): void {
  $('status').textContent = s;
  updateBar();
}

function renderMeta(): void {
  if (!lick) return;
  const d = lick.difficulty;
  const i = inst();
  $('lick-title').textContent = `${progressionName(lick)} in ${titleKeyLabel(lick, i)}`;
  const who = isTransposing(i) ? `${instShort(i)} · concert ${keyLabel(lick.keyPc, lick.mode)}` : instShort(i);
  const meta = $('lick-meta');
  meta.replaceChildren(`${who} · ${lengthShort(lick.length)} · `);
  if (lick.targetScore !== undefined) meta.append(`aimed for ${displayScore(lick.targetScore)} · scored ${displayScore(d.score)}`);
  else if (d.tier === lick.requestedTier) meta.append(`${TIER_NAMES[d.tier]}, as requested`);
  else {
    const s = document.createElement('span');
    s.className = 'asked';
    s.textContent = `you asked for ${TIER_NAMES[lick.requestedTier]}; this came out ${TIER_NAMES[d.tier]}`;
    meta.append(s);
  }

  updateBar();
  $('tier-name').textContent = TIER_NAMES[d.tier];
  const score = displayScore(d.score);
  $('tier-score').textContent = `${score} / 100`;
  const pct = scoreToPos(d.score);
  $('scale-fill').style.width = `${pct}%`;
  $('scale-mark').style.left = `calc(${pct}% - 1px)`;
  const tgt = $('scale-target');
  tgt.hidden = lick.targetScore === undefined;
  $('scale-key').hidden = tgt.hidden;
  if (lick.targetScore !== undefined) tgt.style.left = `${scoreToPos(lick.targetScore)}%`;
  $('feat-cap').textContent = `What makes it ${TIER_NAMES[d.tier]}`;

  const max = FEATURE_MAX as Record<string, number>;
  const shown = d.features.filter(f => f.points > 0.5).slice(0, 3);
  const rest = d.features.filter(f => !shown.includes(f)).reduce((a, f) => a + f.points, 0);
  const rows: { label: string; points: number; frac: number; other?: boolean }[] = shown.map(f => ({
    label: f.label, points: f.points, frac: f.points / (max[f.id] ?? 20),
  }));
  if (rest > 0.5) rows.push({ label: shown.length ? 'Everything else' : 'Small details', points: rest, frac: rest / 20, other: true });
  if (!rows.length) rows.push({ label: 'Nothing tricky: chord tones in simple rhythm', points: 0, frac: 0, other: true });
  $('feat-rows').replaceChildren(...rows.map(r => {
    const tr = document.createElement('tr');
    if (r.other) tr.className = 'other';
    const a = document.createElement('td');
    a.textContent = r.label;
    const b = document.createElement('td');
    b.className = 'bar';
    b.innerHTML = `<div class="meter"><div style="width:${Math.round(Math.min(1, r.frac) * 100)}%"></div></div>`;
    const c = document.createElement('td');
    c.className = 'pts';
    c.textContent = `+${Math.round(r.points)}`;
    tr.append(a, b, c);
    return tr;
  }));
}

const PLAY_PATH = '<path d="M7 4.5v15l13-7.5z"/>';
const PAUSE_PATH = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';

function updateTransport(): void {
  const playing = player.state === 'playing';
  $('play-label').textContent = playing ? 'Pause' : player.state === 'paused' ? 'Resume' : 'Play';
  $('play-icon').innerHTML = playing ? PAUSE_PATH : PLAY_PATH;
  const dis = !lick;
  for (const id of ['btn-play', 'btn-stop', 'btn-export', 't-fav']) $<HTMLButtonElement>(id).disabled = dis;
  updateBar();
}

function updateFav(): void {
  const on = !!lick && favorites.some(f => f.lick.id === lick!.id);
  $('t-fav').setAttribute('aria-pressed', String(on));
  $('fav-label').textContent = on ? 'Saved' : 'Save';
  $('lib-count').textContent = String(favorites.length);
}

/* ---------------------------------------------------------------- lick lifecycle */

function stopPlayback(): void {
  if (player.state !== 'stopped') player.stop();
  finishDrill();
  highlight = [];
  setStatus('Ready');
  updateTransport();
}

function showLick(l: Lick, record: boolean, replaceId?: string, refitted = false): void {
  lick = l;
  if (!refitted) sourceLick = l;
  highlight = [];
  if (record) {
    if (replaceId && replaceId !== l.id) history = store.removeHistory(replaceId);
    history = store.addHistory(l);
  }
  fillKeyOptions();
  renderMeta();
  renderAnalysis();
  syncPositions();
  renderNotation();
  updateTransport();
  updateFav();
}

function generate(): void {
  stopPlayback();
  const keyPc = settings.key === 'random' ? Math.floor(Math.random() * 12) : settings.key;
  const l = generateLick({
    progressionId: settings.progressionId,
    length: settings.length,
    keyPc,
    tier: targetTier(),
    targetScore: posToScore(settings.target),
    range: concertRange(inst()),
    comfortRange: concertRangeForLevel(inst(), targetTier()),
    avoid: history.slice(0, RECENT_LICKS).flatMap(e => e.lick.fragmentIds),
    seed: randomSeed(),
  });
  showLick(l, true);
}

/** Re-key / re-fit the current lick without regenerating. */
function refit(keyPc: number): void {
  if (!lick) return;
  stopPlayback();
  const old = lick.id;
  const base = sourceLick && sourceLick.id === old ? sourceLick : lick;
  showLick(transposeLick(base, keyPc, concertRange(inst()), comfortFor(base)), true, old, true);
}

function restartIfPlaying(): void {
  if (player.state === 'stopped') return;
  if (player.state === 'paused') { stopPlayback(); renderNotation(); return; }
  startPlayback();
}

/* ---------------------------------------------------------------- playback */

const PROGRAMS: Record<Instrument['timbre'], number> = { reed: 66, brass: 56, flute: 73, string: 40, pluck: 26, keys: 0 };

function playOptions(): PlayOptions {
  return {
    bpm: effectiveBpm(), swing: settings.swing, straight16: settings.straight16, loop: settings.loop || drillOn() || settings.callResponse, metronome: settings.metronome,
    countIn: settings.countIn, piano: settings.piano, comp: settings.comp,
    leadVolume: settings.leadVolume, pianoVolume: settings.pianoVolume, timbre: inst().timbre,
  };
}

function startPlayback(): void {
  if (!lick) return;
  finishDrill(); // a restart mid-drill keeps the key on screen and drills from there
  highlight = [];
  const bars = Math.max(1, Math.ceil(lick.totalTicks / TPBAR));
  const run = startDrill();
  player.play(lick, playOptions(), {
    onNote: (idx, cur) => {
      highlight = idx;
      currentNote = cur ?? -1;
      const b = activeBar();
      if (b !== undefined && !drill) setStatus(`bar ${b + 1} / ${bars}`);
      if (!(notesCovered() && !settings.hideKeepChords)) renderNotation();
    },
    onStatus: s => { if (/count/i.test(s)) setStatus(s.toLowerCase()); },
    onPass: run ? drillOnPass : undefined,
    onPassStart: run ? drillOnPassStart : undefined,
    onEnd: () => { finishDrill(); highlight = []; setStatus(run ? (drillOn() ? 'Drill complete' : 'Ready') : 'Ready'); updateTransport(); renderNotation(); },
  });
  updateTransport();
}

/* ---------------------------------------------------------------- 12-key drill */

interface DrillRun {
  /** The combined 12-key drill + call-and-response configuration (see practice/session.ts). */
  session: SessionConfig;
  /** The lick every key is transposed from (never from an already-transposed copy). */
  base: Lick;
  /** History id of the lick on screen when the drill began; replaced by the lick shown at the end. */
  originalId: string;
}
let drill: DrillRun | null = null;

const drillOn = (): boolean => settings.drillOrder !== 'off';

/** Turn the settings into a run, or null when neither the drill nor call and response is on. Loop is switched on. */
function startDrill(): DrillRun | null {
  if (!lick || !(drillOn() || settings.callResponse)) return null;
  if (!settings.loop) { settings.loop = true; persist(); syncControls(); }
  const base = sourceLick && sourceLick.id === lick.id ? sourceLick : lick;
  const cfg: DrillConfig = { order: settings.drillOrder, repeats: settings.drillRepeats, tempoStep: settings.drillTempoStep, maxBpm: settings.drillMaxBpm, tempoEvery: 'key' };
  drill = {
    session: { callResponse: settings.callResponse, responses: settings.responsePasses, drill: drillOn() ? cfg : null,
      keys: drillOn() ? drillKeys(lick.keyPc, settings.drillOrder, randomSeed()) : [lick.keyPc], startBpm: effectiveBpm() },
    base,
    originalId: lick.id,
  };
  return drill;
}

/** Called by the player ahead of each bar line: decide what the next pass plays. */
function drillOnPass(passIndex: number): PassAction | void {
  const d = drill;
  if (!d) return;
  const st = sessionStep(d.session, passIndex);
  if (st.done) return { stop: true };
  const action: PassAction = { silentLead: st.silentLead };
  if (st.bpm != null) action.bpm = st.bpm;
  if (st.newKey != null) action.lick = transposeLick(d.base, st.newKey, concertRange(inst()), comfortFor(d.base));
  return action;
}

/** Called by the player at the bar line itself: show what is now playing. */
function drillOnPassStart(passIndex: number, info: { lick: Lick; bpm: number }): void {
  const d = drill;
  if (!d) return;
  const st = sessionStep(d.session, passIndex);
  if (info.lick !== lick) {
    settings.key = info.lick.keyPc;
    persist();
    showLick(info.lick, false, undefined, true); // nothing goes to History until the drill stops
  }
  setResponseHide(st.role === 'response' && !settings.showNotesInResponse);
  const parts: string[] = [];
  if (st.drill) {
    const reps = clampInt(d.session.drill!.repeats, 1, 4);
    parts.push(`Key ${st.drill.keyIndex + 1}/${st.drill.keyCount}`, titleKeyLabel(info.lick, inst()), `${info.bpm} BPM`);
    if (reps > 1) parts.push(`pass ${st.drill.repeat + 1}/${reps}`);
  }
  if (d.session.callResponse) parts.push(st.role === 'response' ? 'Your turn' : 'Listen');
  else if (!st.drill) parts.push(`${info.bpm} BPM`);
  setStatus(parts.join(' · '));
}

/** End the drill: the lick on screen (the last key reached) replaces the starting lick in History. */
function finishDrill(): void {
  const d = drill;
  drill = null;
  setResponseHide(false);
  if (!d || !lick || lick.id === d.originalId) return;
  history = store.removeHistory(d.originalId);
  history = store.addHistory(lick);
}

function togglePlay(): void {
  if (!lick) return;
  if (player.state === 'stopped') startPlayback();
  else if (player.state === 'playing') { player.pause(); setStatus('Paused'); }
  else { player.resume(); }
  updateTransport();
}

function onStop(): void {
  const had = highlight.length > 0;
  stopPlayback();
  if (had) renderNotation();
}

/* ---------------------------------------------------------------- export */

function exportStatus(text: string, clearAfter = 0): void {
  const out = $('export-status');
  out.textContent = text;
  if (clearAfter) setTimeout(() => { if (out.textContent === text) out.textContent = ''; }, clearAfter);
}

function doMidi(): void {
  if (!lick) return;
  const bytes = lickToMidi(lick, {
    bpm: effectiveBpm(), swing: settings.swing, straight16: settings.straight16, comping: settings.midiBacking, comp: settings.comp,
    program: PROGRAMS[inst().timbre],
  });
  downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), fileName(lick, 'mid'));
  exportStatus('MIDI downloaded.', 3000);
}

async function doPdf(): Promise<void> {
  if (!lick) return;
  exportStatus('Building PDF…');
  try {
    const { exportPdf } = await import('./export/pdf');
    await exportPdf(lick, inst(), {
      showTab: settings.showTab && !!inst().tab, tabPosition: tabIndex(), showFingers: settings.showFingers, noteLabels: noteLabels(),
    });
    exportStatus('PDF downloaded.', 3000);
  } catch (err) {
    exportStatus('Could not create the PDF: ' + String((err as Error)?.message ?? err));
  }
}

/* ---- share links (src/share.ts): `#l=<code>` carries the lick at concert pitch ---- */

/** Copy text without the async clipboard API: select a readonly input and execCommand('copy'). */
function copyFallback(text: string): boolean {
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = text;
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(input);
  input.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  input.remove();
  return ok;
}

async function doShare(): Promise<void> {
  if (!lick) return;
  const url = shareUrl(lick, location.href);
  $('btn-share').dataset.url = url;
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = copyFallback(url); }
  exportStatus(ok ? 'Link copied.' : 'Could not copy the link.', ok ? 3000 : 6000);
}

/** Open a lick from `#l=...` if present, then clear the hash so a reload does not import it again. Returns true if shown. */
function openSharedLick(): boolean {
  const r = parseShareHash(location.hash);
  if (r.kind === 'none') return false;
  try { window.history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  if (r.kind === 'invalid') { exportStatus("That lick link isn't valid.", 6000); return false; }
  showLick(transposeLick(r.lick, r.lick.keyPc, concertRange(inst()), comfortFor(r.lick)), true);
  exportStatus('Opened a shared lick.', 4000);
  return true;
}

/* ---------------------------------------------------------------- menus & dialogs */

function setupExportMenu(): void {
  const btn = $<HTMLButtonElement>('btn-export');
  const pop = $('export-menu');
  const items = () => [...pop.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const close = (focusBtn = false): void => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  const open = (): void => {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    items()[0]?.focus();
  };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  pop.addEventListener('keydown', e => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Tab') close();
  });
  document.addEventListener('click', e => {
    if (!pop.hidden && !(e.target as HTMLElement).closest('.menu')) close();
  });
  $('btn-midi').addEventListener('click', () => { close(true); doMidi(); });
  $('btn-pdf').addEventListener('click', () => { close(true); void doPdf(); });
  $('btn-share').addEventListener('click', () => { close(true); void doShare(); });
}

function setupDialog(id: string, openerId: string): HTMLDialogElement {
  const dlg = $<HTMLDialogElement>(id);
  $(openerId).addEventListener('click', () => { if (!dlg.open) dlg.showModal(); });
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

/* ---------------------------------------------------------------- wiring */

function bind(): void {
  const lib = new Library({
    getHistory: () => history,
    getFavorites: () => favorites,
    onLoad: l => {
      stopPlayback();
      showLick(transposeLick(l, l.keyPc, concertRange(inst()), comfortFor(l)), true);
    },
    onRemoveFavorite: id => { favorites = store.removeFavorite(id); updateFav(); },
    onClearHistory: () => { store.clearHistory(); history = []; },
    isTransposing: () => isTransposing(inst()),
  });
  const dialogs = [setupDialog('sound', 'btn-sound'), setupDialog('keys', 'btn-keys')];
  setupExportMenu();

  const setting = <K extends keyof Settings>(k: K, v: Settings[K]): void => { settings[k] = v; persist(); syncControls(); };
  const onRadio = (name: string, fn: (v: string) => void): void => {
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(r =>
      r.addEventListener('change', () => { if (r.checked) fn(r.value); }));
  };
  const onCheck = (id: string, fn: (on: boolean) => void): void => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => fn(el.checked));
  };

  $('btn-gen').addEventListener('click', generate);

  onRadio('prog', v => { settings.progressionId = v; persist(); fillKeyOptions(); syncControls(); });
  const target = $<HTMLInputElement>('r-target');
  target.addEventListener('input', () => { settings.target = Math.round(Number(target.value)); persist(); syncControls(); });
  $('t-analyze').addEventListener('click', () => setAnalyze(!settings.analyze));
  onRadio('len', v => setting('length', v as Settings['length']));
  $<HTMLSelectElement>('sel-inst').addEventListener('change', e => {
    settings.instrumentId = (e.target as HTMLSelectElement).value;
    persist(); syncControls(); fillKeyOptions();
    if (lick) refit(lick.keyPc); // refit octave, keep key
  });
  $<HTMLSelectElement>('sel-key').addEventListener('change', e => {
    const v = (e.target as HTMLSelectElement).value;
    settings.key = v === 'random' ? 'random' : Number(v);
    persist(); syncControls();
    if (typeof settings.key === 'number' && lick) refit(settings.key);
  });
  const nudge = (d: number): void => {
    const base = lick ? lick.keyPc : typeof settings.key === 'number' ? settings.key : 0;
    const next = (base + d + 12) % 12;
    settings.key = next;
    persist(); syncControls();
    if (lick) refit(next);
  };
  $('key-dn').addEventListener('click', () => nudge(-1));
  $('key-up').addEventListener('click', () => nudge(1));

  // transport
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-stop').addEventListener('click', onStop);
  onCheck('c-piano', on => { setting('piano', on); restartIfPlaying(); });
  onCheck('c-loop', on => { setting('loop', on); restartIfPlaying(); });
  onCheck('c-swing', on => { setting('swing', on); restartIfPlaying(); });
  onCheck('c-straight16', on => { setting('straight16', on); restartIfPlaying(); });
  onCheck('c-hide', on => { setting('hide', on); renderNotation(); });
  onCheck('c-hide-keep', on => { setting('hideKeepChords', on); renderNotation(); });
  onCheck('c-cr', on => { setting('callResponse', on); restartIfPlaying(); });
  onCheck('c-cr-show', on => { setting('showNotesInResponse', on); if (responseHide && on) setResponseHide(false); });
  onRadio('cr-resp', v => { setting('responsePasses', v === '2' ? 2 : 1); restartIfPlaying(); });
  onCheck('c-tab', on => { setting('showTab', on); renderNotation(); });
  onCheck('c-fingers', on => { setting('showFingers', on); renderNotation(); });
  $<HTMLSelectElement>('sel-pos').addEventListener('change', e => {
    setting('tabPosition', (e.target as HTMLSelectElement).value);
    renderNotation();
  });
  $('t-fav').addEventListener('click', () => {
    if (!lick) return;
    favorites = favorites.some(f => f.lick.id === lick!.id) ? store.removeFavorite(lick.id) : store.addFavorite(lick);
    updateFav();
    if (!store.lastWriteOk) exportStatus('Could not save: browser storage is full or blocked.', 5000);
  });
  const bpm = $<HTMLInputElement>('r-bpm');
  bpm.addEventListener('input', () => { settings.bpm = Number(bpm.value); persist(); syncControls(); });
  bpm.addEventListener('change', restartIfPlaying);

  // sound settings
  onCheck('c-slow', on => { setting('slow', on); restartIfPlaying(); });
  $<HTMLSelectElement>('sel-comp').addEventListener('change', e => { setting('comp', (e.target as HTMLSelectElement).value as Settings['comp']); restartIfPlaying(); });
  const vol = (): void => {
    settings.leadVolume = Number($<HTMLInputElement>('r-lead').value);
    settings.pianoVolume = Number($<HTMLInputElement>('r-piano').value);
    persist();
    player.setVolumes(settings.leadVolume, settings.pianoVolume);
  };
  $('r-lead').addEventListener('input', vol);
  $('r-piano').addEventListener('input', vol);
  $<HTMLSelectElement>('sel-drill').addEventListener('change', e => { setting('drillOrder', (e.target as HTMLSelectElement).value as DrillOrder); });
  $<HTMLSelectElement>('sel-drill-rep').addEventListener('change', e => { setting('drillRepeats', clampInt(Number((e.target as HTMLSelectElement).value), 1, 4)); });
  const numSetting = (id: string, k: 'drillTempoStep' | 'drillMaxBpm', lo: number, hi: number): void => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => { setting(k, el.value === '' ? lo : clampInt(Number(el.value), lo, hi)); });
  };
  numSetting('n-drill-step', 'drillTempoStep', 0, 20);
  numSetting('n-drill-max', 'drillMaxBpm', 40, 320);
  onCheck('c-count', on => setting('countIn', on));
  onCheck('c-met', on => { setting('metronome', on); restartIfPlaying(); });
  onCheck('c-midi', on => setting('midiBacking', on));

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || lib.isOpen || dialogs.some(d => d.open)) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? '';
    if (tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    if (tag === 'INPUT' && !['radio', 'checkbox', 'range'].includes((t as HTMLInputElement).type)) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'g' || e.key === 'G') {
      generate();
    } else if (e.key === 'a' || e.key === 'A') {
      setAnalyze(!settings.analyze);
    }
  });

  // re-render notation on width change (debounced)
  let lastW = $('paper').clientWidth;
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const w = $('paper').clientWidth;
      if (w !== lastW) { lastW = w; renderNotation(); }
    }, 150);
  });
}

/* ---------------------------------------------------------------- phone practice bar */
/* The bar only forwards to the existing buttons (clicking a display:none button still runs its handler). */

const phoneMq = window.matchMedia('(max-width: 760px)');

function updateBar(): void {
  const play = $<HTMLButtonElement>('btn-play');
  $('pb-play-label').textContent = $('play-label').textContent;
  $('pb-play-icon').innerHTML = $('play-icon').innerHTML;
  $<HTMLButtonElement>('pb-play').disabled = play.disabled;
  // No aria-pressed: the visible label itself announces Play / Pause / Resume.
  $('pb-key').textContent = lick ? titleKeyLabel(lick, inst()) : '–';
  const st = $('status').textContent ?? '';
  $('pb-bar').textContent = /Your turn$/.test(st) ? 'Your turn' : /Listen$/.test(st) ? 'Listen' : /^bar /.test(st) ? st.replace(' / ', '/') : /count/.test(st) ? st.replace(/.*: ?/, 'count ') : st === 'Paused' ? 'paused' : lick ? lengthShort(lick.length) : '';
  updateRecap();
}

function updateRecap(): void {
  const romans = romansFor(settings.progressionId).join('–');
  const key = settings.key === 'random' ? 'Random key' : keyLabel(settings.key, getProgression(settings.progressionId).mode);
  $('fold-recap').textContent =
    [`${SHORT_NAME[settings.progressionId] ?? getProgression(settings.progressionId).name} ${romans}`, TIER_NAMES[targetTier()], instShort(inst()), key, lengthShort(settings.length)].join(' · ');
}

function setupPhoneBar(): void {
  const fold = $<HTMLDetailsElement>('lick-settings');
  const fwd = (from: string, to: string): void => $(from).addEventListener('click', () => $(to).click());
  fwd('pb-play', 'btn-play');
  fwd('pb-next', 'btn-gen');
  fwd('pb-dn', 'key-dn');
  fwd('pb-up', 'key-up');
  // Desktop always shows the settings; phones fold them once a first lick exists.
  const sync = (): void => { if (!phoneMq.matches) fold.open = true; };
  phoneMq.addEventListener('change', e => { if (e.matches) fold.open = false; else sync(); });
  if (phoneMq.matches) fold.open = false;
  fold.addEventListener('toggle', updateRecap);
  updateBar();
}

/* ---------------------------------------------------------------- boot */

buildStaticControls();
fillKeyOptions();
syncControls();
bind();
setupPhoneBar();
if (openSharedLick()) { /* shown */ } else if (history.length) {
  const h = history[0].lick;
  showLick(transposeLick(h, h.keyPc, concertRange(inst()), comfortFor(h)), false);
} else {
  generate();
}
// Chord symbols are measured with the web font; redraw once it has loaded.
document.fonts?.ready.then(() => renderNotation()).catch(() => undefined);
