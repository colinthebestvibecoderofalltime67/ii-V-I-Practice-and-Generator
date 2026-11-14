import type { Instrument, Lick } from '../types';
import { TIER_NAMES } from '../types';
import { type RenderOptions, renderLick } from '../render/notation';
import { downloadBlob, fileName, isTransposing, keyLabel, progressionName, writtenKeyLabel } from '../ui/format';
import { displayScore } from '../difficulty/score';

const RENDER_WIDTH = 720;
/** Built-in PDF fonts lack the flat/sharp signs. */
export const plain = (s: string): string => s.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/♮/g, '').replace(/Δ/g, 'maj');

/** Sanitise every SVG text node for the built-in fonts (WinAnsi has ø and °, not ♭ ♯). */
export function sanitizeSvgText(svg: Element): void {
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue ?? '';
    const c = plain(t);
    if (c !== t) n.nodeValue = c;
  }
}

/** Render the lick to an A4 portrait PDF and trigger a download. `opts.showTab` defaults to "the instrument has a tab". jsPDF and svg2pdf load on demand. */
export async function exportPdf(
  lick: Lick, inst: Instrument,
  opts: Pick<RenderOptions, 'showTab' | 'tabPosition' | 'showFingers' | 'noteLabels' | 'devices'> = {},
): Promise<void> {
  const [{ jsPDF }, svg2pdfMod] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const svg2pdf = svg2pdfMod.svg2pdf;

  const holder = document.createElement('div');
  holder.style.cssText = `position:absolute;left:-10000px;top:0;width:${RENDER_WIDTH}px;background:#fff;`;
  document.body.appendChild(holder);
  try {
    const svg = renderLick(holder, lick, inst, { print: true, ...opts, showTab: opts.showTab ?? !!inst.tab });
    if (!svg) throw new Error('Could not render notation for the PDF.');
    // svg2pdf reads font sizes in pt as 0; give text plain unitless pixel sizes.
    for (const el of [svg, ...Array.from(svg.querySelectorAll('[font-size]'))]) {
      const m = /^([\d.]+)pt$/.exec(el.getAttribute('font-size') ?? '');
      if (m) el.setAttribute('font-size', String(+(parseFloat(m[1]) * (4 / 3)).toFixed(2)));
    }
    sanitizeSvgText(svg);
    const vb = svg.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : parseFloat(svg.getAttribute('width') || '') || RENDER_WIDTH;
    const h = vb && vb.height ? vb.height : parseFloat(svg.getAttribute('height') || '') || 300;

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;

    // title block
    doc.setTextColor(30, 30, 30);
    doc.setFont('times', 'bold');
    doc.setFontSize(22);
    doc.text(plain(progressionName(lick)), margin, margin + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(90, 90, 90);
    const ky = isTransposing(inst)
      ? `Key: ${plain(writtenKeyLabel(lick, inst))}  |  concert ${plain(keyLabel(lick.keyPc, lick.mode))}`
      : `Key: ${plain(keyLabel(lick.keyPc, lick.mode))}`;
    const lines = [
      ky,
      `Instrument: ${plain(inst.name)}`,
      `Difficulty: ${TIER_NAMES[lick.difficulty.tier]} (${displayScore(lick.difficulty.score)}/100)`,
      `Date: ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    ];
    lines.forEach((l, i) => doc.text(l, margin, margin + 40 + i * 15));
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, margin + 40 + lines.length * 15, pageW - margin, margin + 40 + lines.length * 15);

    // notation scaled to page width
    const drawW = pageW - margin * 2;
    const drawH = (h / w) * drawW;
    const top = margin + 40 + lines.length * 15 + 20;
    await svg2pdf(svg, doc, { x: margin, y: top, width: drawW, height: Math.min(drawH, pageH - top - margin - 20) });

    // footer
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 140);
    doc.text('Generated with ii-V-I Lick Studio', margin, pageH - 24);

    downloadBlob(doc.output('blob'), fileName(lick, 'pdf', inst));
  } finally {
    holder.remove();
  }
}
