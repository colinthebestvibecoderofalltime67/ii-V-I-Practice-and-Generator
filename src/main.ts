import './styles.css';
import type { Instrument, Lick, Tier } from './types';
import { TIER_NAMES } from './types';
import { LENGTHS, PROGRESSIONS, getProgression } from './theory/progressions';
import { INSTRUMENTS, concertRange, getInstrument } from './instruments';
import { generateLick, randomSeed, transposeLick } from './generator';
import { renderLick } from './render/notation';
import { lickFingerings } from './render/tab';
import { Player, type PlayOptions } from './audio/player';
import { lickToMidi } from './export/midi';
import { Store, type Settings, type StoredEntry } from './storage';
import { Library } from './ui/library';
import { downloadBlob, fileName, isTransposing, keyLabel, progressionName, writtenKeyLabel } from './ui/format';

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
let highlight: number[] = [];
let status = 'Ready';
const player = new Player();

const inst = (): Instrument => getInstrument(settings.instrumentId);
const persist = (): void => store.saveSettings(settings);
const effectiveBpm = (): number => (settings.slow ? Math.round(settings.bpm * 0.6) : settings.bpm);
const TIERS: Tier[] = [1, 2, 3, 4];

/* ---------------------------------------------------------------- selects */

function buildStaticControls(): void {
  const prog = $<HTMLSelectElement>('sel-prog');
  prog.innerHTML = PROGRESSIONS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const inst = $<HTMLSelectElement>('sel-inst');
  inst.innerHTML = INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join('');

  const seg = $('seg-len');
  for (const [id, def] of Object.entries(LENGTHS)) {
    const m = /^(\w+) \((.*)\)$/.exec(def.label);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.len = id;
    b.innerHTML = `<span>${m ? m[1] : def.label}</span><small class="sub">${m ? m[2] : ''}</small>`;
    b.title = def.label;
    seg.appendChild(b);
  }
  const pills = $('pills-tier');
  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.dataset.tier = String(t);
    b.textContent = TIER_NAMES[t];
    pills.appendChild(b);
  }
}

function fillKeyOptions(): void {
  const mode = getProgression(settings.progressionId).mode;
  const sel = $<HTMLSelectElement>('sel-key');
  let html = '<option value="random">Random key</option>';
  for (let pc = 0; pc < 12; pc++) html += `<option value="${pc}">${keyLabel(pc, mode)}</option>`;
  sel.innerHTML = html;
  sel.value = String(settings.key);
}

const setPressed = (el: HTMLElement, on: boolean): void => el.setAttribute('aria-pressed', String(on));

function syncControls(): void {
  const prog = getProgression(settings.progressionId);
  const i = inst();
  $<HTMLSelectElement>('sel-prog').value = settings.progressionId;
  $<HTMLSelectElement>('sel-inst').value = settings.instrumentId;
  $<HTMLSelectElement>('sel-key').value = String(settings.key);
  $('prog-desc').textContent = prog.description;
  $('seg-len').querySelectorAll('button').forEach(b => setPressed(b, b.dataset.len === settings.length));
  $('pills-tier').querySelectorAll('button').forEach(b => setPressed(b, b.dataset.tier === String(settings.tier)));
  const hint = $('tier-hint');
  if (settings.tier < prog.minTier) {
    hint.hidden = false;
    hint.textContent = `${prog.name} is usually ${TIER_NAMES[prog.minTier]} material. ${TIER_NAMES[settings.tier]} licks here will be very simple.`;
  } else hint.hidden = true;

  setPressed($('t-piano'), settings.piano);
  setPressed($('t-loop'), settings.loop);
  setPressed($('t-swing'), settings.swing);
  setPressed($('t-hide'), settings.hide);
  setPressed($('t-slow'), settings.slow);
  const tabBtn = $('t-tab');
  tabBtn.hidden = !i.tab;
  setPressed(tabBtn, settings.showTab);
  const fingBtn = $('t-fingers');
  fingBtn.hidden = !i.tab || !settings.showTab;
  setPressed(fingBtn, settings.showFingers);
  syncPositions();
  $('t-hide').textContent = settings.hide ? 'Show notation' : 'Hide notation';
  $<HTMLInputElement>('r-bpm').value = String(settings.bpm);
  $('bpm-val').textContent = `${effectiveBpm()} BPM${settings.slow ? ' (slow)' : ''}`;
  $<HTMLSelectElement>('sel-comp').value = settings.comp;
  $<HTMLInputElement>('r-lead').value = String(settings.leadVolume);
  $<HTMLInputElement>('r-piano').value = String(settings.pianoVolume);
  $<HTMLInputElement>('c-count').checked = settings.countIn;
  $<HTMLInputElement>('c-met').checked = settings.metronome;
  $<HTMLInputElement>('c-midi').checked = settings.midiBacking;

  const paper = $('paper');
  paper.classList.toggle('covered', settings.hide);
  $('score').classList.toggle('hidden', settings.hide);
  $('cover').setAttribute('aria-hidden', String(!settings.hide));
  updateTransport();
  updateFav();
}

/* ---------------------------------------------------------------- tab positions */

/** Playable positions of the current lick on the current instrument (empty for non-tab instruments). */
function tabPositions(): string[] {
  if (!lick || !inst().tab) return [];
  return lickFingerings(lick, inst())?.positions.map(p => p.label) ?? [];
}

/** Fill the Position select; fall back to Auto when the saved position is not playable for this lick. */
function syncPositions(): void {
  const field = $('f-pos');
  const show = !!inst().tab && settings.showTab;
  field.hidden = !show;
  field.parentElement?.classList.toggle('has-pos', show);
  const labels = tabPositions();
  if (lick && settings.tabPosition !== 'auto' && !labels.includes(settings.tabPosition)) {
    settings.tabPosition = 'auto';
    persist();
  }
  const sel = $<HTMLSelectElement>('sel-pos');
  const fing = lick && inst().tab ? lickFingerings(lick, inst()) : null;
  const html = ['<option value="auto">Auto (easiest)</option>'];
  fing?.positions.forEach(p => {
    const w = p.window[0] === p.window[1] ? `fret ${p.window[0]}` : `frets ${p.window[0]}–${p.window[1]}`;
    const sh = p.shifts ? ` · ${p.shifts} shift${p.shifts > 1 ? 's' : ''}` : '';
    html.push(`<option value="${p.label}">${p.label} (${w}${sh})</option>`);
  });
  const next = html.join('');
  if (sel.innerHTML !== next) sel.innerHTML = next;
  sel.value = settings.tabPosition;
}

function tabIndex(): 'auto' | number {
  if (settings.tabPosition === 'auto') return 'auto';
  const i = tabPositions().indexOf(settings.tabPosition);
  return i < 0 ? 'auto' : i;
}

/* ---------------------------------------------------------------- display */

function renderNotation(): void {
  if (!lick) return;
  renderLick($('score'), lick, inst(), {
    highlight, showTab: settings.showTab && !!inst().tab, tabPosition: tabIndex(), showFingers: settings.showFingers,
  });
}

function setStatus(s: string): void {
  status = s;
  $('status').textContent = s;
}

function renderMeta(): void {
  if (!lick) return;
  const d = lick.difficulty;
  const badge = $('tier-badge');
  badge.dataset.tier = String(d.tier);
  badge.textContent = `${TIER_NAMES[d.tier]} · ${Math.round(d.score)}/100`;
  const note = $('tier-note');
  if (d.tier !== lick.requestedTier) {
    note.hidden = false;
    note.textContent = `You asked for ${TIER_NAMES[lick.requestedTier]}; this one came out ${TIER_NAMES[d.tier]}.`;
  } else note.hidden = true;

  const i = inst();
  const parts = [`<b>${progressionName(lick)}</b>`, LENGTHS[lick.length].label, `<b>${keyLabel(lick.keyPc, lick.mode)}</b> concert`];
  if (isTransposing(i)) parts[2] += ` · you read <b>${writtenKeyLabel(lick, i)}</b>`;
  $('info').innerHTML = parts.join(' · ');

  const feats = d.features.filter(f => f.points > 0.5).slice(0, 3);
  $('why').hidden = feats.length === 0;
  const chips = $('chips');
  chips.replaceChildren(...feats.map(f => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = f.label;
    return c;
  }));
}

function updateTransport(): void {
  const btn = $('btn-play');
  btn.textContent = player.state === 'playing' ? '❚❚ Pause' : player.state === 'paused' ? '▶ Resume' : '▶ Play';
  const dis = !lick;
  for (const id of ['btn-play', 'btn-stop', 'btn-midi', 'btn-pdf', 't-fav']) $<HTMLButtonElement>(id).disabled = dis;
}

function updateFav(): void {
  const on = !!lick && favorites.some(f => f.lick.id === lick!.id);
  setPressed($('t-fav'), on);
  $('fav-star').textContent = on ? '★' : '☆';
  const n = favorites.length;
  const c = $('lib-count');
  c.hidden = n === 0;
  c.textContent = String(n);
}

/* ---------------------------------------------------------------- lick lifecycle */

function stopPlayback(): void {
  if (player.state !== 'stopped') player.stop();
  highlight = [];
  setStatus('Ready');
  updateTransport();
}

function showLick(l: Lick, record: boolean, replaceId?: string): void {
  lick = l;
  highlight = [];
  if (record) {
    if (replaceId && replaceId !== l.id) history = store.removeHistory(replaceId);
    history = store.addHistory(l);
  }
  renderMeta();
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
    tier: settings.tier,
    range: concertRange(inst()),
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
  showLick(transposeLick(lick, keyPc, concertRange(inst())), true, old);
}

function restartIfPlaying(): void {
  if (player.state === 'stopped') return;
  if (player.state === 'paused') { stopPlayback(); return; }
  startPlayback();
}

/* ---------------------------------------------------------------- playback */

const PROGRAMS: Record<Instrument['timbre'], number> = { reed: 66, brass: 56, flute: 73, string: 40, pluck: 26, keys: 0 };

function playOptions(): PlayOptions {
  return {
    bpm: effectiveBpm(), swing: settings.swing, loop: settings.loop, metronome: settings.metronome,
    countIn: settings.countIn, piano: settings.piano, comp: settings.comp,
    leadVolume: settings.leadVolume, pianoVolume: settings.pianoVolume, timbre: inst().timbre,
  };
}

function startPlayback(): void {
  if (!lick) return;
  highlight = [];
  player.play(lick, playOptions(), {
    onNote: idx => {
      highlight = idx;
      if (!settings.hide) renderNotation();
    },
    onStatus: setStatus,
    onEnd: () => { highlight = []; setStatus('Ready'); updateTransport(); renderNotation(); },
  });
  updateTransport();
}

function togglePlay(): void {
  if (!lick) return;
  if (player.state === 'stopped') startPlayback();
  else if (player.state === 'playing') { player.pause(); setStatus('Paused'); }
  else { player.resume(); setStatus(`${effectiveBpm()} BPM`); }
  updateTransport();
}

function onStop(): void {
  const had = highlight.length > 0;
  stopPlayback();
  if (had) renderNotation();
}

/* ---------------------------------------------------------------- export */

async function doMidi(): Promise<void> {
  if (!lick) return;
  const bytes = lickToMidi(lick, {
    bpm: effectiveBpm(), swing: settings.swing, comping: settings.midiBacking, comp: settings.comp,
    program: PROGRAMS[inst().timbre],
  });
  downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), fileName(lick, 'mid'));
}

async function doPdf(): Promise<void> {
  if (!lick) return;
  const btn = $<HTMLButtonElement>('btn-pdf');
  const out = $('export-status');
  btn.disabled = true;
  out.textContent = 'Building PDF…';
  try {
    const { exportPdf } = await import('./export/pdf');
    await exportPdf(lick, inst(), { tabPosition: tabIndex(), showFingers: settings.showFingers });
    out.textContent = 'PDF saved.';
  } catch (err) {
    out.textContent = 'Could not create the PDF: ' + String((err as Error)?.message ?? err);
  } finally {
    btn.disabled = !lick;
    setTimeout(() => { if (out.textContent === 'PDF saved.') out.textContent = ''; }, 4000);
  }
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
  });

  const setting = <K extends keyof Settings>(k: K, v: Settings[K]): void => { settings[k] = v; persist(); syncControls(); };

  $('btn-gen').addEventListener('click', generate);

  $<HTMLSelectElement>('sel-prog').addEventListener('change', e => {
    settings.progressionId = (e.target as HTMLSelectElement).value;
    persist(); fillKeyOptions(); syncControls();
  });
  $('seg-len').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-len]');
    if (b) setting('length', b.dataset.len as Settings['length']);
  });
  $('pills-tier').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tier]');
    if (b) setting('tier', Number(b.dataset.tier) as Tier);
  });
  $<HTMLSelectElement>('sel-inst').addEventListener('change', e => {
    settings.instrumentId = (e.target as HTMLSelectElement).value;
    persist(); syncControls();
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

  // transport toggles
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-stop').addEventListener('click', onStop);
  $('t-piano').addEventListener('click', () => { setting('piano', !settings.piano); restartIfPlaying(); });
  $('t-loop').addEventListener('click', () => { setting('loop', !settings.loop); restartIfPlaying(); });
  $('t-swing').addEventListener('click', () => { setting('swing', !settings.swing); restartIfPlaying(); });
  $('t-hide').addEventListener('click', () => { setting('hide', !settings.hide); if (!settings.hide) renderNotation(); });
  $('t-tab').addEventListener('click', () => { setting('showTab', !settings.showTab); renderNotation(); });
  $('t-fingers').addEventListener('click', () => { setting('showFingers', !settings.showFingers); renderNotation(); });
  $<HTMLSelectElement>('sel-pos').addEventListener('change', e => {
    setting('tabPosition', (e.target as HTMLSelectElement).value);
    renderNotation();
  });
  $('t-fav').addEventListener('click', () => {
    if (!lick) return;
    favorites = favorites.some(f => f.lick.id === lick!.id) ? store.removeFavorite(lick.id) : store.addFavorite(lick);
    updateFav();
  });

  // settings
  const bpm = $<HTMLInputElement>('r-bpm');
  bpm.addEventListener('input', () => { settings.bpm = Number(bpm.value); persist(); syncControls(); });
  bpm.addEventListener('change', restartIfPlaying);
  const bumpBpm = (d: number): void => { setting('bpm', Math.min(320, Math.max(40, settings.bpm + d))); restartIfPlaying(); };
  $('bpm-dn').addEventListener('click', () => bumpBpm(-5));
  $('bpm-up').addEventListener('click', () => bumpBpm(5));
  $('t-slow').addEventListener('click', () => { setting('slow', !settings.slow); restartIfPlaying(); });
  $<HTMLSelectElement>('sel-comp').addEventListener('change', e => { setting('comp', (e.target as HTMLSelectElement).value as Settings['comp']); restartIfPlaying(); });
  const vol = (): void => {
    settings.leadVolume = Number($<HTMLInputElement>('r-lead').value);
    settings.pianoVolume = Number($<HTMLInputElement>('r-piano').value);
    persist();
    player.setVolumes(settings.leadVolume, settings.pianoVolume);
  };
  $('r-lead').addEventListener('input', vol);
  $('r-piano').addEventListener('input', vol);
  $('c-count').addEventListener('change', e => setting('countIn', (e.target as HTMLInputElement).checked));
  $('c-met').addEventListener('change', e => { setting('metronome', (e.target as HTMLInputElement).checked); restartIfPlaying(); });
  $('c-midi').addEventListener('change', e => setting('midiBacking', (e.target as HTMLInputElement).checked));

  $('btn-midi').addEventListener('click', () => void doMidi());
  $('btn-pdf').addEventListener('click', () => void doPdf());

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || lib.isOpen) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'g' || e.key === 'G') {
      generate();
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
setStatus(status);
