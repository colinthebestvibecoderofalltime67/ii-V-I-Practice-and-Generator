/** Seeded PRNG (mulberry32). Same seed => same sequence. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  /** Weighted pick; weights must be >= 0 and not all zero (falls back to uniform). */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const ws = items.map(weight);
    const total = ws.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
}

export const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
