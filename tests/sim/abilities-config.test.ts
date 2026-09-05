// ---------------------------------------------------------------------------
// Client abilities CONFIG layer (src/abilities.ts, post H4 split) — the
// structural contract every consumer (bot brain, HUD, runtime dispatcher,
// parity scraper) relies on. Import note: abilities.ts → gamefeel → three;
// three imports fine under plain node (no DOM at module scope), so no
// vi.mock is needed and the asserts run against the REAL config.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { CRITTER_ABILITIES } from '../../src/abilities';
import { getPlayableNames } from '../../src/roster';

const playable = getPlayableNames();

describe('abilities config (client)', () => {
  it('the 9 playable critters each ship exactly 3 abilities, keyed J/K/L in slot order', () => {
    expect(playable).toHaveLength(9);
    for (const name of playable) {
      const kit = CRITTER_ABILITIES[name];
      expect(kit, `${name} missing from CRITTER_ABILITIES`).toBeDefined();
      expect(kit, `${name} kit size`).toHaveLength(3);
      expect(kit.map((d) => d.key), `${name} key order`).toEqual(['J', 'K', 'L']);
    }
  });

  it('every def carries non-empty semantic tags (the bot brain dispatches on them)', () => {
    for (const name of playable) {
      for (const def of CRITTER_ABILITIES[name]) {
        expect(Array.isArray(def.tags), `${name}/${def.name} tags array`).toBe(true);
        expect(def.tags.length, `${name}/${def.name} has no tags`).toBeGreaterThan(0);
      }
    }
  });

  it('timing sanity: cooldown > 0, duration ≥ 0, windUp ≥ 0 on every def', () => {
    for (const name of playable) {
      for (const def of CRITTER_ABILITIES[name]) {
        expect(def.cooldown, `${name}/${def.name} cooldown`).toBeGreaterThan(0);
        expect(def.duration, `${name}/${def.name} duration`).toBeGreaterThanOrEqual(0);
        expect(def.windUp, `${name}/${def.name} windUp`).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(def.cooldown + def.duration + def.windUp)).toBe(true);
      }
    }
  });

  it("exactly ONE 'defensive' ability in the roster: Shelly Steel Shell (bot defensive-reflex trigger)", () => {
    const defensive: Array<[string, string]> = [];
    for (const name of playable) {
      for (const def of CRITTER_ABILITIES[name]) {
        if (def.tags.includes('defensive')) defensive.push([name, def.name]);
      }
    }
    // If this ever grows, revisit the deterministic shell trigger in both
    // bot brains (src/bot.ts + server/src/sim/bot.ts) before extending it.
    expect(defensive).toEqual([['Shelly', 'Steel Shell']]);
  });

  it('cone-gated abilities always declare coneAngleDeg (Sebastian Claw Wave, ±60°)', () => {
    const cones: Array<[string, string, number]> = [];
    for (const name of playable) {
      for (const def of CRITTER_ABILITIES[name]) {
        if (def.coneAngleDeg !== undefined) {
          expect(def.coneAngleDeg, `${name}/${def.name}`).toBeGreaterThan(0);
          expect(def.coneAngleDeg, `${name}/${def.name}`).toBeLessThanOrEqual(180);
          cones.push([name, def.name, def.coneAngleDeg]);
        }
      }
    }
    expect(cones).toEqual([['Sebastian', 'Claw Wave', 60]]);
  });
});
