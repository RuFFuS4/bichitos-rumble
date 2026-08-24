// ---------------------------------------------------------------------------
// Balance framework v2 invariants (2026-08-21/24). These are the rails a
// balance pass must not silently break: headbuttBoost budget, the PWS →
// numeric derivation, and the nominal PWS point budget per critter.
//
// Sources: server/src/sim/config.ts (CRITTER_CONFIGS — three-free mirror
// of the client presets, guarded by scripts/verify-ability-parity.mjs)
// and the shared pws-stats table. Roster names come from src/roster.ts
// so a critter added to the roster without server config fails here.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { CRITTER_CONFIGS, getCritterConfig } from '../../server/src/sim/config.js';
import { CRITTER_PWS, deriveCritterStats } from '../../src/pws-stats';
import { getPlayableNames } from '../../src/roster';

const playable = getPlayableNames();

describe('balance invariants (marco v2)', () => {
  it('headbuttBoost across the whole roster stays inside [1.0, 1.5]', () => {
    // The v2 budget: boosts are FEEDBACK multipliers, not raw power —
    // Trunk's old 2.30 (effective force 110) was the outlier that
    // motivated the rail. 1.0 = no boost; 1.5 = Sebastian-tier signature.
    for (const name of playable) {
      const boost = getCritterConfig(name).headbuttBoost ?? 1.0;
      expect(boost, `${name} headbuttBoost`).toBeGreaterThanOrEqual(1.0);
      expect(boost, `${name} headbuttBoost`).toBeLessThanOrEqual(1.5);
    }
  });

  it('headbuttBoost golden per critter (accidental retune fails loudly)', () => {
    const boosts = Object.fromEntries(
      playable.map((n) => [n, getCritterConfig(n).headbuttBoost ?? 1.0]),
    );
    expect(boosts).toEqual({
      Sergei: 1.40,
      Trunk: 1.0, // balance v2 micropass 3: 2.30 → default
      Kurama: 1.15,
      Shelly: 1.30,
      Kermit: 1.0,
      Sihans: 1.0,
      Kowalski: 1.20,
      Cheeto: 1.30,
      Sebastian: 1.45, // roster max — Glass Cannon signature
    });
  });

  it('every playable derives PWS stats inside the documented ranges', () => {
    for (const name of playable) {
      const pws = CRITTER_PWS[name];
      expect(pws, `${name} missing from CRITTER_PWS`).toBeDefined();
      for (const level of [pws.p, pws.w, pws.s]) {
        expect(Number.isInteger(level)).toBe(true);
        expect(level).toBeGreaterThanOrEqual(-2);
        expect(level).toBeLessThanOrEqual(2);
      }
      const d = deriveCritterStats(name);
      expect(d.speed, `${name}.speed`).toBeGreaterThanOrEqual(8.0);
      expect(d.speed, `${name}.speed`).toBeLessThanOrEqual(18.0);
      expect(d.mass, `${name}.mass`).toBeGreaterThanOrEqual(0.6 - 1e-12);
      expect(d.mass, `${name}.mass`).toBeLessThanOrEqual(1.4 + 1e-12);
      expect(d.headbuttForce, `${name}.force`).toBeGreaterThanOrEqual(10.0);
      expect(d.headbuttForce, `${name}.force`).toBeLessThanOrEqual(18.0);
    }
  });

  it('server configs equal the PWS derivation — except Trunk, whose overrides are pinned', () => {
    for (const name of playable) {
      const cfg = CRITTER_CONFIGS[name];
      const d = deriveCritterStats(name);
      if (name === 'Trunk') {
        // Documented exception (2026-05-01 final block): "la bestia" —
        // speed 8 → 16 and headbuttForce 16 → 48 are hand overrides on
        // top of PWS (1,1,-2). Mass still derives. If a rebalance drops
        // the overrides, update HERE and in the client preset together.
        expect(cfg.speed).toBe(16);
        expect(cfg.headbuttForce).toBe(48);
        expect(cfg.mass).toBeCloseTo(d.mass, 12);
      } else {
        expect(cfg.speed, `${name}.speed`).toBeCloseTo(d.speed, 12);
        expect(cfg.mass, `${name}.mass`).toBeCloseTo(d.mass, 12);
        expect(cfg.headbuttForce, `${name}.force`).toBeCloseTo(d.headbuttForce, 12);
      }
    }
  });

  it('nominal PWS budget: p+w+s within [-1, +1] for everyone except Sebastian (+2, documented)', () => {
    const sums = Object.fromEntries(
      playable.map((n) => {
        const { p, w, s } = CRITTER_PWS[n];
        return [n, p + w + s];
      }),
    );
    // Golden totals — any accidental tuple edit shifts a sum and fails.
    expect(sums).toEqual({
      Sergei: 0,
      Trunk: 0,
      Kurama: 0,
      Shelly: 0,
      Kermit: 0,
      Sihans: 0,
      Kowalski: 0,
      Cheeto: 1,
      // EXCEPTION (balance v2, 2026-08-21): w -2 → -1 to stop the
      // massRatio yeet (audit: 0/6 wins, 2.9 falls/match) pushed his
      // total to +2. Accepted glass-cannon premium — if a future pass
      // rebalances him back into [-1, +1], tighten this to the rule.
      Sebastian: 2,
    });
    for (const [name, sum] of Object.entries(sums)) {
      if (name === 'Sebastian') continue;
      expect(sum, `${name} PWS sum`).toBeGreaterThanOrEqual(-1);
      expect(sum, `${name} PWS sum`).toBeLessThanOrEqual(1);
    }
  });
});
