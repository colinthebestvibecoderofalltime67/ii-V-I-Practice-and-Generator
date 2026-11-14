import { describe, expect, it } from 'vitest';
import { fileName } from '../src/ui/format';
import { generateLick, transposeLick } from '../src/generator/generate';
import { concertRange, getInstrument } from '../src/instruments';

describe('fileName', () => {
  const alto = getInstrument('alto');
  const lick = generateLick({ progressionId: 'major-251', length: 'standard', keyPc: 8, tier: 2, range: concertRange(alto), seed: 5 });
  it('MIDI keeps the concert key', () => {
    expect(fileName(lick, 'mid')).toMatch(/^lick-major-251-Ab-[a-z]+\.mid$/);
  });
  it('a transposing part is named by the written key and instrument', () => {
    expect(fileName(lick, 'pdf', alto)).toMatch(/^lick-major-251-F-alto-[a-z]+\.pdf$/);
    expect(fileName(lick, 'pdf', getInstrument('piano'))).toMatch(/^lick-major-251-Ab-[a-z]+\.pdf$/);
  });
});

describe('refit from the source lick undoes folding', () => {
  it('alto -> bass -> alto returns the original notes', () => {
    const alto = getInstrument('alto');
    for (const seed of [1, 2, 3]) {
      const src = generateLick({ progressionId: 'major-251', length: 'long', keyPc: 1, tier: 4, range: concertRange(alto), seed });
      const back = transposeLick(src, src.keyPc, concertRange(alto));
      expect(back.notes.map(n => n.midi)).toEqual(src.notes.map(n => n.midi));
    }
  });
});
