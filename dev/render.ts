import { renderLick } from '../src/render/notation';
import { getInstrument } from '../src/instruments';
import type { Lick } from '../src/types';
import { standard, short, longMinor, restHeavy } from './fixtures';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);
const width = Number(params.get('w') ?? 1000);

function shift(l: Lick, d: number): Lick { return { ...l, notes: l.notes.map(n => ({ ...n, midi: n.midi == null ? null : n.midi + d })) }; }

interface Case { title: string; lick: Lick; inst: string; tab?: boolean; hl?: number[]; print?: boolean }
const cases: Case[] = [
  { title: 'Alto sax - standard', lick: standard, inst: 'alto' },
  { title: 'Alto sax - short (2 chords in bar 1, 16ths)', lick: short, inst: 'alto' },
  { title: 'Alto sax - long minor (altered)', lick: longMinor, inst: 'alto' },
  { title: 'Alto sax - rest-heavy (F)', lick: restHeavy, inst: 'alto' },
  { title: 'Trombone (bass clef) - standard', lick: shift(standard, -24), inst: 'trombone' },
  { title: 'Trombone - long minor', lick: shift(longMinor, -24), inst: 'trombone' },
  { title: 'Guitar + tab - standard', lick: shift(standard, -12), inst: 'guitar', tab: true },
  { title: 'Guitar + tab - short', lick: shift(short, -12), inst: 'guitar', tab: true },
  { title: 'Guitar + tab - long minor', lick: shift(longMinor, -12), inst: 'guitar', tab: true },
  { title: 'Bass + tab - standard', lick: shift(standard, -36), inst: 'bass', tab: true },
  { title: 'Bass + tab - rest-heavy', lick: shift(restHeavy, -36), inst: 'bass', tab: true },
  { title: 'Highlight (notes 3-6, 12) - tenor', lick: standard, inst: 'tenor', hl: [3, 4, 5, 6, 12] },
  { title: 'Print mode - guitar tab', lick: short, inst: 'guitar', tab: true, print: true, hl: [1, 2] },
];

const only = params.get('only');
cases.forEach((c, i) => {
  if (only && String(i) !== only) return;
  const wrap = document.createElement('section');
  wrap.style.cssText = `width:${width}px;margin:0 0 8px;`;
  wrap.innerHTML = `<h3 style="font:600 13px sans-serif;margin:4px 0">${c.title}</h3>`;
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border:1px solid #ddd;';
  wrap.appendChild(box);
  document.getElementById('root')!.appendChild(wrap);
  renderLick(box, c.lick, getInstrument(c.inst), { showTab: c.tab, highlight: c.hl, print: c.print });
});
void root;
(window as unknown as { done: boolean }).done = true;
