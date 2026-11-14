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
import { Player, type PlayOptions } from './audio/player';
import { lickToMidi } from './export/midi';
import { Store, type Settings, type StoredEntry } from './storage';
import { Library } from './ui/library';
import { downloadBlob, fileName, isTransposing, keyLabel, progressionName, titleKeyLabel } from './ui/format';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('Missing element #' + id);
  return el as T;
};

const store = new Store();
const settings: Settings = store.loadSettings();
let history: StoredEntry[] = store.loadHistory();
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
  1: 'Quarter notes, chord tones',
  2: 'Eighth notes, scale and arpeggio',
  3: 'Enclosures, chromatic approaches',
  4: '16th-note runs, altered colour',
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
  $<HTMLInputElement>('r-lead').value = String(settings.leadVolume);
  $<HTMLInputElement>('r-piano').value = String(settings.pianoVolume);

  $('paper').classList.toggle('covered', settings.hide);
  $('score').classList.toggle('hidden', settings.hide);
  $('cover').setAttribute('aria-hidden', String(!settings.hide));
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
  });
}

/** Degree labels for the sheet when Analyze is on. */
function noteLabels(): (NoteLabel | null)[] | undefined {
  if (!settings.analyze) return undefined;
  return currentAnalysis()?.notes.map(n => (n ? { text: n.label, color: KIND_COLOR[n.kind] } : null));
}

function setStatus(s: string): void {
  $('status').textContent = s;
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
    seed: randomSeed(),
  });
  if (settings.hide) { settings.hide = false; persist(); syncControls(); }
  showLick(l, true);
}

/** Re-key / re-fit the current lick without regenerating. */
function refit(keyPc: number): void {
  if (!lick) return;
  stopPlayback();
  const old = lick.id;
  const base = sourceLick && sourceLick.id === old ? sourceLick : lick;
  showLick(transposeLick(base, keyPc, concertRange(inst())), true, old, true);
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
    bpm: effectiveBpm(), swing: settings.swing, straight16: settings.straight16, loop: settings.loop, metronome: settings.metronome,
    countIn: settings.countIn, piano: settings.piano, comp: settings.comp,
    leadVolume: settings.leadVolume, pianoVolume: settings.pianoVolume, timbre: inst().timbre,
  };
}

function startPlayback(): void {
  if (!lick) return;
  highlight = [];
  const bars = Math.max(1, Math.ceil(lick.totalTicks / TPBAR));
  player.play(lick, playOptions(), {
    onNote: (idx, cur) => {
      highlight = idx;
      currentNote = cur ?? -1;
      const b = activeBar();
      if (b !== undefined) setStatus(`bar ${b + 1} / ${bars}`);
      if (!settings.hide) renderNotation();
    },
    onStatus: s => { if (/count/i.test(s)) setStatus(s.toLowerCase()); },
    onEnd: () => { highlight = []; setStatus('Ready'); updateTransport(); renderNotation(); },
  });
  updateTransport();
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
      showLick(transposeLick(l, l.keyPc, concertRange(inst())), true);
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
  onCheck('c-hide', on => { setting('hide', on); if (!on) renderNotation(); });
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

/* ---------------------------------------------------------------- boot */

buildStaticControls();
fillKeyOptions();
syncControls();
bind();
if (history.length) {
  const h = history[0].lick;
  showLick(transposeLick(h, h.keyPc, concertRange(inst())), false);
} else {
  generate();
}
// Chord symbols are measured with the web font; redraw once it has loaded.
document.fonts?.ready.then(() => renderNotation()).catch(() => undefined);
