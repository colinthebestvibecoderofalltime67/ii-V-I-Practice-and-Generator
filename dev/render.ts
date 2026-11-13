import { renderLick } from '../src/render/notation';
import { getInstrument } from '../src/instruments';
import type { Lick } from '../src/types';
import { standard, short, longMinor, restHeavy, triplets, tripletRun } from './fixtures';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);
const width = Number(params.get('w') ?? 1000);

function shift(l: Lick, d: number): Lick { return { ...l, notes: l.notes.map(n => ({ ...n, midi: n.midi == null ? null : n.midi + d })) }; }

interface Case { title: string; lick: Lick; inst: string; tab?: boolean; hl?: number[]; print?: boolean; labels?: boolean }
const labelsFor = (l: Lick) => l.notes.map((n, i) => (n.midi == null ? null : { text: ['1', 'b3', '5', 'b7', '9', '3', '#11', '13'][i % 8], color: i % 3 === 0 ? '#2747c9' : undefined }));
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
  { title: 'Triplets - tenor sax', lick: triplets, inst: 'tenor' },
  { title: 'Triplets - trombone (bass clef)', lick: shift(triplets, -24), inst: 'trombone' },
  { title: 'Triplets - guitar + full tab', lick: shift(triplets, -12), inst: 'guitar', tab: true },
  { title: 'Triplet run - tenor sax', lick: tripletRun, inst: 'tenor' },
  { title: 'Triplet run - guitar + full tab, highlight 0-3, 12', lick: shift(tripletRun, -12), inst: 'guitar', tab: true, hl: [0, 1, 2, 3, 12] },
  { title: 'Labels - tenor (triplets)', lick: triplets, inst: 'tenor', labels: true },
  { title: 'Labels - guitar + tab', lick: shift(standard, -12), inst: 'guitar', tab: true, labels: true },
  { title: 'Print - guitar + tab, triplets + labels', lick: shift(triplets, -12), inst: 'guitar', tab: true, print: true, labels: true },
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
  renderLick(box, c.lick, getInstrument(c.inst), { showTab: c.tab, highlight: c.hl, print: c.print, noteLabels: c.labels ? labelsFor(c.lick) : undefined });
});
void root;
(window as unknown as { done: boolean }).done = true;
