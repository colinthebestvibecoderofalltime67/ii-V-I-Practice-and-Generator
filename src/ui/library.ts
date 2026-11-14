import type { Lick } from '../types';
import { TIER_NAMES } from '../types';
import { LENGTHS } from '../theory/progressions';
import type { StoredEntry } from '../storage';
import type { PracticeStat } from '../practice/log';
import { keyLabel, pretty, progressionName, relativeTime } from './format';
import { pcName } from '../theory/pitch';

export interface LibraryHooks {
  getHistory(): StoredEntry[];
  getFavorites(): StoredEntry[];
  onLoad(lick: Lick): void;
  onRemoveFavorite(id: string): void;
  onClearHistory(): void;
  /** True when the selected instrument transposes; keys are then labelled "concert". */
  isTransposing?(): boolean;
  /** Practice stats for this lick (any key), if it has been played. */
  getPractice?(lick: Lick): PracticeStat | undefined;
  /** Today's lick for the top of the Saved tab: a saved lick, or one generated from a fixed seed. */
  getLickOfDay?(): { lick: Lick; saved: boolean } | null;
}

/** Pitch classes in cycle-of-fifths order, clockwise from the top: the key wheel. */
const WHEEL = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SVGNS = 'http://www.w3.org/2000/svg';

/** Key names for the wheel's accessible label ("C, F, B♭"). */
export const keyNames = (pcs: readonly number[]): string => pcs.map(pc => pretty(pcName(pc, 0, 'major'))).join(', ');

/** Compact 12-dot key wheel; filled dots are the keys practised. */
export function keyWheel(pcs: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.setAttribute('class', 'wheel');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', pcs.length ? `Practiced in ${keyNames(pcs)}` : 'Not practiced in any key yet');
  WHEEL.forEach((pc, i) => {
    const a = (i / 12) * Math.PI * 2;
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', (Math.sin(a) * 8.5).toFixed(2));
    c.setAttribute('cy', (-Math.cos(a) * 8.5).toFixed(2));
    c.setAttribute('r', '2.1');
    if (pcs.includes(pc)) c.setAttribute('class', 'on');
    svg.appendChild(c);
  });
  return svg;
}

/** "practiced today / yesterday / 2 days ago". */
export function practicedAgo(at: number, now = Date.now()): string {
  const dayOf = (t: number): number => { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000); };
  const d = dayOf(now) - dayOf(at);
  if (d <= 0) return 'practiced today';
  if (d === 1) return 'practiced yesterday';
  if (d < 60) return `practiced ${d} days ago`;
  return `practiced ${new Date(at).toLocaleDateString()}`;
}

type Tab = 'history' | 'favorites';

/** History & favorites drawer, built on <dialog>. */
export class Library {
  private dlg = document.getElementById('library') as HTMLDialogElement;
  private list = document.getElementById('lib-list') as HTMLUListElement;
  private sub = document.getElementById('lib-sub') as HTMLElement;
  private clear = document.getElementById('lib-clear') as HTMLButtonElement;
  private tabHist = document.getElementById('tab-history') as HTMLButtonElement;
  private tabFav = document.getElementById('tab-favs') as HTMLButtonElement;
  private tab: Tab = 'history';

  constructor(private hooks: LibraryHooks) {
    document.getElementById('btn-history')!.addEventListener('click', () => this.open('history'));
    document.getElementById('btn-saved')!.addEventListener('click', () => this.open('favorites'));
    document.getElementById('lib-close')!.addEventListener('click', () => this.dlg.close());
    this.dlg.addEventListener('click', e => { if (e.target === this.dlg) this.dlg.close(); });
    this.tabHist.addEventListener('click', () => this.setTab('history'));
    this.tabFav.addEventListener('click', () => this.setTab('favorites'));
    for (const t of [this.tabHist, this.tabFav]) {
      t.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const next = t === this.tabHist ? 'favorites' : 'history';
          this.setTab(next);
          (next === 'history' ? this.tabHist : this.tabFav).focus();
        }
      });
    }
    this.clear.addEventListener('click', () => {
      if (!this.hooks.getHistory().length) return;
      if (confirm('Clear your lick history? Favorites are kept.')) { this.hooks.onClearHistory(); this.render(); }
    });
    this.list.addEventListener('click', e => {
      const el = e.target as HTMLElement;
      const rm = el.closest<HTMLElement>('[data-remove]');
      if (rm) { this.hooks.onRemoveFavorite(rm.dataset.remove!); this.render(); return; }
      const ld = el.closest<HTMLElement>('[data-load]');
      if (!ld) return;
      const src = this.tab === 'history' ? this.hooks.getHistory() : this.hooks.getFavorites();
      if (ld.dataset.load === 'daily') {
        const day = this.hooks.getLickOfDay?.();
        if (day) { this.dlg.close(); this.hooks.onLoad(day.lick); }
        return;
      }
      const entry = src.find(en => en.lick.id === ld.dataset.load);
      if (entry) { this.dlg.close(); this.hooks.onLoad(entry.lick); }
    });
  }

  get isOpen(): boolean { return this.dlg.open; }

  open(tab: Tab = this.tab): void {
    this.tab = tab;
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  private setTab(t: Tab): void {
    this.tab = t;
    this.render();
  }

  render(): void {
    const hist = this.tab === 'history';
    this.tabHist.setAttribute('aria-selected', String(hist));
    this.tabFav.setAttribute('aria-selected', String(!hist));
    this.tabHist.tabIndex = hist ? 0 : -1;
    this.tabFav.tabIndex = hist ? -1 : 0;
    this.list.setAttribute('aria-labelledby', hist ? 'tab-history' : 'tab-favs');
    const entries = hist ? this.hooks.getHistory() : this.hooks.getFavorites();
    this.clear.hidden = !hist;
    this.sub.textContent = hist ? `Last ${entries.length} generated, newest first` : `${entries.length} saved`;
    this.list.replaceChildren();
    const now = Date.now();
    if (!hist) {
      const day = this.hooks.getLickOfDay?.();
      if (day) this.list.appendChild(this.row(day.lick, now, { daily: day.saved ? 'From your saved licks' : 'Generated for today' }));
    }
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'lib-empty';
      li.textContent = hist ? 'No licks yet. Generate one and it will show up here.' : 'Nothing saved yet. Press Save on a lick you like.';
      this.list.appendChild(li);
      return;
    }
    for (const { lick, at } of entries) {
      const li = this.row(lick, now, { at });
      if (!hist) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'lib-rm';
        rm.dataset.remove = lick.id;
        rm.title = 'Remove from saved';
        rm.setAttribute('aria-label', 'Remove from saved');
        rm.textContent = '\u2715';
        li.appendChild(rm);
      }
      this.list.appendChild(li);
    }
  }

  /** One list row: title, details line, and the practice stats when the lick has been played. */
  private row(lick: Lick, now: number, o: { at?: number; daily?: string }): HTMLLIElement {
    const concert = this.hooks.isTransposing?.() ? 'concert ' : '';
    const li = document.createElement('li');
    li.className = 'lib-item' + (o.daily ? ' lib-daily' : '');
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'lib-load';
    load.dataset.load = o.daily ? 'daily' : lick.id;
    const l1 = document.createElement('span');
    l1.className = 'l1';
    l1.textContent = progressionName(lick);
    if (o.daily) {
      const tag = document.createElement('span');
      tag.className = 'daily-tag';
      tag.textContent = 'Lick of the day';
      load.append(tag);
    }
    const l2 = document.createElement('span');
    l2.className = 'l2';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.tier = String(lick.difficulty.tier);
    badge.textContent = TIER_NAMES[lick.difficulty.tier];
    const rest = document.createElement('span');
    const len = LENGTHS[lick.length].label.replace(/ \(.*\)/, '');
    rest.textContent = `${concert}${keyLabel(lick.keyPc, lick.mode)} \u00b7 ${len}` + (o.daily ? ` \u00b7 ${o.daily}` : o.at !== undefined ? ` \u00b7 ${relativeTime(o.at, now)}` : '');
    l2.append(badge, rest);
    load.append(l1, l2);
    const st = this.hooks.getPractice?.(lick);
    if (st) {
      const l3 = document.createElement('span');
      l3.className = 'l3';
      const n = document.createElement('span');
      n.className = 'mono';
      n.textContent = `${st.keys.length}/12 keys`;
      const bpm = document.createElement('span');
      bpm.className = 'mono';
      bpm.textContent = `\u2669 = ${st.topBpm}`;
      bpm.title = 'Fastest tempo completed';
      const ago = document.createElement('span');
      ago.textContent = practicedAgo(st.lastAt, now);
      l3.append(keyWheel(st.keys), n, bpm, ago);
      load.append(l3);
    }
    load.setAttribute('aria-label', `${o.daily ? 'Load lick of the day: ' : 'Load '}${progressionName(lick)} in ${concert}${keyLabel(lick.keyPc, lick.mode)}, ${TIER_NAMES[lick.difficulty.tier]}` + (st ? `, practiced in ${st.keys.length} of 12 keys: ${keyNames(st.keys)}` : ''));
    li.appendChild(load);
    return li;
  }
}
