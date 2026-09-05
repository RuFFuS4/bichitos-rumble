// ---------------------------------------------------------------------------
// P/W/S stat derivation — single source of truth for speed/mass/force.
// The golden table pins the CURRENT numeric output for the whole roster:
// any accidental edit to CRITTER_PWS or to the linear scalars
// (SPEED 13±2.5·s, MASS 1.0±0.20·w, FORCE 14±2.0·p) fails loudly here.
// (client src/pws-stats.ts and server/src/sim/pws-stats.ts are byte-identical
//  copies — parity itself is guarded by scripts/check-pws-parity.mjs.)
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { CRITTER_PWS, deriveCritterStats, toDerivedStats } from '../../src/pws-stats';

// Golden derived stats as of balance v2 (2026-08-21: Sebastian w -2 → -1).
const GOLDEN: Record<string, { speed: number; mass: number; force: number }> = {
  Sergei:    { speed: 13.0, mass: 1.0, force: 14 }, // (0,0,0) baseline
  Trunk:     { speed:  8.0, mass: 1.2, force: 16 }, // (1,1,-2)
  Kurama:    { speed: 18.0, mass: 0.8, force: 12 }, // (-1,-1,2)
  Shelly:    { speed:  8.0, mass: 1.4, force: 14 }, // (0,2,-2)
  Kermit:    { speed: 15.5, mass: 0.6, force: 16 }, // (1,-2,1)
  Sihans:    { speed: 18.0, mass: 1.0, force: 10 }, // (-2,0,2)
  Kowalski:  { speed: 13.0, mass: 0.8, force: 16 }, // (1,-1,0)
  Cheeto:    { speed: 15.5, mass: 0.8, force: 16 }, // (1,-1,1)
  Sebastian: { speed: 15.5, mass: 0.8, force: 18 }, // (2,-1,1)
};

describe('pws-stats derivation', () => {
  it('deriveCritterStats reproduces the golden table for all 9 critters', () => {
    expect(Object.keys(CRITTER_PWS).sort()).toEqual(Object.keys(GOLDEN).sort());
    for (const [name, expected] of Object.entries(GOLDEN)) {
      const d = deriveCritterStats(name);
      expect(d.speed, `${name}.speed`).toBeCloseTo(expected.speed, 12);
      expect(d.mass, `${name}.mass`).toBeCloseTo(expected.mass, 12);
      expect(d.headbuttForce, `${name}.headbuttForce`).toBeCloseTo(expected.force, 12);
    }
  });

  it('toDerivedStats at the ±2 extremes hits the documented range ends', () => {
    const max = toDerivedStats({ p: 2, w: 2, s: 2 });
    expect(max.speed).toBeCloseTo(18.0, 12);
    expect(max.mass).toBeCloseTo(1.4, 12);
    expect(max.headbuttForce).toBeCloseTo(18.0, 12);

    const min = toDerivedStats({ p: -2, w: -2, s: -2 });
    expect(min.speed).toBeCloseTo(8.0, 12);
    expect(min.mass).toBeCloseTo(0.6, 12);
    expect(min.headbuttForce).toBeCloseTo(10.0, 12);
  });

  it('each axis is independent: one P/W/S step moves only its own stat', () => {
    const base = toDerivedStats({ p: 0, w: 0, s: 0 });
    const sUp = toDerivedStats({ p: 0, w: 0, s: 1 });
    expect(sUp.speed - base.speed).toBeCloseTo(2.5, 12);
    expect(sUp.mass).toBeCloseTo(base.mass, 12);
    expect(sUp.headbuttForce).toBeCloseTo(base.headbuttForce, 12);

    const wUp = toDerivedStats({ p: 0, w: 1, s: 0 });
    expect(wUp.mass - base.mass).toBeCloseTo(0.2, 12);
    expect(wUp.speed).toBeCloseTo(base.speed, 12);

    const pUp = toDerivedStats({ p: 1, w: 0, s: 0 });
    expect(pUp.headbuttForce - base.headbuttForce).toBeCloseTo(2.0, 12);
    expect(pUp.speed).toBeCloseTo(base.speed, 12);
  });

  it('unknown names fall back to Sergei baseline (roster-dev placeholders)', () => {
    const d = deriveCritterStats('Rojo');
    expect(d).toEqual(deriveCritterStats('Sergei'));
    expect(d.speed).toBeCloseTo(13.0, 12);
  });
});
