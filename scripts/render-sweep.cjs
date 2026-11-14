// Render sweep for the device brackets: node scripts/render-sweep.cjs [url]   (needs `npm run dev` and Playwright)
// Generates Focus licks over progressions x lengths x widths, draws them with their device brackets and counts bracket labels
// that leave the SVG or overlap another bracket label. Expected: 0 and 0.
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
(async () => {
  const url = process.argv[2] || 'http://localhost:5420/';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url);
  await page.waitForSelector('#btn-gen', { state: 'attached' });
  const res = await page.evaluate(async () => {
    const G = await import('/src/generator/index.ts');
    const R = await import('/src/render/notation.ts');
    const D = await import('/src/ui/devices.ts');
    const I = await import('/src/instruments.ts');
    const S = await import('/src/difficulty/score.ts');
    const concepts = ['guideTones', 'enclosures', 'chromaticApproach', 'anticipateI', 'triadPairs', 'sixthDim', 'superimposition'];
    const progs = ['major-251', 'minor-251', 'turnaround', 'coltrane'];
    const lens = ['short', 'long'];
    const widths = [360, 768, 1280];
    const names = ['triad pair', 'encl.', 'GT', 'antic.', 'chrom.', 'super.', 'side-slip', '6th dim'];
    const isLab = t => names.some(n => t === n || t === `(${n})`);
    let renders = 0, labels = 0, outside = 0, overlaps = 0, nodev = 0;
    const examples = [];
    const inst = I.getInstrument('alto');
    let seed = 1;
    for (const w of widths) for (const prog of progs) for (const len of lens) for (const concept of concepts) for (const pos of [40, 90]) {
      const host = document.createElement('div');
      host.style.width = w + 'px'; host.style.background = '#fff';
      document.body.prepend(host);
      const target = S.posToScore(pos); const tier = S.tierForScore(target);
      const lick = G.generateLick({ progressionId: prog, length: len, keyPc: seed % 12, tier, targetScore: target, range: I.concertRange(inst), comfortRange: I.concertRangeForLevel(inst, tier), seed: seed++, concept });
      const rows = D.deviceRows(lick, inst);
      const svg = R.renderLick(host, lick, inst, { showTab: false, devices: rows.map(r => r.mark) });
      renders++;
      const sb = svg.getBoundingClientRect();
      const labs = [...svg.querySelectorAll('text')].filter(t => isLab(t.textContent)).map(t => ({ s: t.textContent, b: t.getBoundingClientRect() }));
      labels += labs.length;
      if (!labs.length) nodev++;
      for (const l of labs) if (l.b.right > sb.right + 0.5 || l.b.left < sb.left - 0.5) { outside++; if (examples.length < 5) examples.push(`outside ${l.s} ${Math.round(l.b.left)}-${Math.round(l.b.right)} svg ${Math.round(sb.right)} w${w} ${prog} ${len} ${concept}`); }
      for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
        const a = labs[i].b, b = labs[j].b;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 1 && iy > 6) { overlaps++; if (examples.length < 5) examples.push(`overlap ${labs[i].s}[${Math.round(a.left)}-${Math.round(a.right)},${Math.round(a.top)}]~${labs[j].s}[${Math.round(b.left)}-${Math.round(b.right)},${Math.round(b.top)}] w${w} ${prog} ${len} ${concept}`); }
      }
      host.remove();
    }
    return { renders, labels, outside, overlaps, nodev, examples };
  });
  console.log(JSON.stringify(res));
  await browser.close();
  process.exit(res.outside || res.overlaps ? 1 : 0);
})();
