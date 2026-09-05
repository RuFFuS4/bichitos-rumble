// ---------------------------------------------------------------------------
// match-rng — the seedable PRNG behind offline determinism (mulberry32).
// If any of these break, replays / golden batches / seeded matches diverge.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { matchRng, seedMatchRng } from '../../src/match-rng';

function draw(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(matchRng());
  return out;
}

describe('match-rng (mulberry32)', () => {
  it('same seed → identical sequence (the determinism contract)', () => {
    seedMatchRng(12345);
    const first = draw(100);
    seedMatchRng(12345);
    const second = draw(100);
    expect(second).toEqual(first);
  });

  it('different seeds → different sequences', () => {
    seedMatchRng(1);
    const a = draw(10);
    seedMatchRng(2);
    const b = draw(10);
    // mulberry32 with adjacent seeds must not collide on the first draws
    expect(a).not.toEqual(b);
  });

  it('every draw lies in [0, 1)', () => {
    seedMatchRng(0xC0FFEE);
    const values = draw(10_000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it('distribution is sane: mean ≈ 0.5 and all deciles populated', () => {
    // Seeded → fully deterministic, so tight-ish bounds cannot flake.
    seedMatchRng(424242);
    const values = draw(10_000);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);

    const buckets = new Array(10).fill(0);
    for (const v of values) buckets[Math.floor(v * 10)]++;
    for (const count of buckets) {
      // uniform expectation 1000/bucket; ±20% is generous yet would
      // catch a broken bit-mix immediately
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });
});
