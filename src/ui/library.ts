import type { Lick } from '../types';
import { TIER_NAMES } from '../types';
import { LENGTHS } from '../theory/progressions';
import type { StoredEntry } from '../storage';
import { keyLabel, progressionName, relativeTime } from './format';

export interface LibraryHooks {
  getHistory(): StoredEntry[];
  getFavorites(): StoredEntry[];
  onLoad(lick: Lick): void;
  onRemoveFavorite(id: string): void;
  onClearHistory(): void;
  /** True when the selected instrument transposes; keys are then labelled "concert". */
  isTransposing?(): boolean;
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
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'lib-empty';
      li.textContent = hist ? 'No licks yet. Generate one and it will show up here.' : 'Nothing saved yet. Press Save on a lick you like.';
      this.list.appendChild(li);
      return;
    }
    const now = Date.now();
    for (const { lick, at } of entries) {
      const li = document.createElement('li');
      li.className = 'lib-item';
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'lib-load';
      load.dataset.load = lick.id;
      const l1 = document.createElement('span');
      l1.className = 'l1';
      l1.textContent = progressionName(lick);
      const l2 = document.createElement('span');
      l2.className = 'l2';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.tier = String(lick.difficulty.tier);
      badge.textContent = TIER_NAMES[lick.difficulty.tier];
      const rest = document.createElement('span');
      rest.textContent = `${this.hooks.isTransposing?.() ? 'concert ' : ''}${keyLabel(lick.keyPc, lick.mode)} · ${LENGTHS[lick.length].label.replace(/ \(.*\)/, '')} · ${relativeTime(at, now)}`;
      l2.append(badge, rest);
      load.append(l1, l2);
      load.setAttribute('aria-label', `Load ${progressionName(lick)} in ${this.hooks.isTransposing?.() ? 'concert ' : ''}${keyLabel(lick.keyPc, lick.mode)}, ${TIER_NAMES[lick.difficulty.tier]}`);
      li.appendChild(load);
      if (!hist) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'lib-rm';
        rm.dataset.remove = lick.id;
        rm.title = 'Remove from saved';
        rm.setAttribute('aria-label', 'Remove from saved');
        rm.textContent = '✕';
        li.appendChild(rm);
      }
      this.list.appendChild(li);
    }
  }
}
