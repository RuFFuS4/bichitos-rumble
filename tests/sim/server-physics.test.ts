// ---------------------------------------------------------------------------
// Server sim physics (server/src/sim/physics.ts) — the authoritative
// knockback math. three-free by design; PlayerSchema is only a TYPE import
// there, so plain objects with the fields the functions actually read are
// valid stand-ins (verified against the source before writing these).
//
// Golden forces are hardcoded on purpose: an accidental balance edit to
// SIM.collision, headbuttBoost, PWS force or SHELL_REFLECT breaks them.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { resolveCollisions, type ShellReflectEvent } from '../../server/src/sim/physics.js';

interface AbilityLike {
  abilityType: string;
  active: boolean;
  windUpLeft: number;
}

/** Minimal PlayerSchema-like with every field resolveCollisions reads. */
function makePlayer(overrides: {
  sessionId: string;
  critterName: string;
  x: number;
  z: number;
  isHeadbutting?: boolean;
  stunTimer?: number;
  abilities?: AbilityLike[];
}): PlayerSchema {
  return {
    sessionId: overrides.sessionId,
    critterName: overrides.critterName,
    x: overrides.x,
    z: overrides.z,
    vx: 0,
    vz: 0,
    alive: true,
    falling: false,
    immunityTimer: 0,
    isHeadbutting: overrides.isHeadbutting ?? false,
    stunTimer: overrides.stunTimer ?? 0,
    lastHitTargetCritter: '',
    abilities: overrides.abilities ?? [],
  } as unknown as PlayerSchema;
}

/** Shelly with Steel Shell up: slot 1 (K) active, windup done. */
function makeAnchoredShelly(x: number, z: number): PlayerSchema {
  return makePlayer({
    sessionId: 'shelly',
    critterName: 'Shelly',
    x, z,
    abilities: [
      { abilityType: 'charge_rush', active: false, windUpLeft: 0 },
      { abilityType: 'ground_pound', active: true, windUpLeft: 0 }, // Steel Shell
      { abilityType: 'frenzy', active: false, windUpLeft: 0 },
    ],
  });
}

describe('server physics — resolveCollisions', () => {
  it('massRatio: the lighter defender flies further from the same headbutt', () => {
    // Sergei (mass 1.0, force 14, boost 1.40) headbutts → force = 14·3.5·1.40 = 68.6
    const hitBy = (defName: string): number => {
      const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
      const def = makePlayer({ sessionId: 'def', critterName: defName, x: 1.0, z: 0 });
      resolveCollisions([atk, def]);
      return def.vx;
    };
    const kermitDv = hitBy('Kermit'); // mass 0.6 → ratio 1/1.6 = 0.625
    const shellyDv = hitBy('Shelly'); // mass 1.4 → ratio 1/2.4
    expect(kermitDv).toBeGreaterThan(shellyDv);
    expect(kermitDv).toBeCloseTo(68.6 * 0.625, 10); // 42.875
    expect(shellyDv).toBeCloseTo(68.6 / 2.4, 10); // 28.5833…
  });

  it('attacker recoils on connect (recoilFactor 0.35)', () => {
    const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    resolveCollisions([atk, def]);
    expect(atk.vx).toBeCloseTo(-68.6 * 0.35, 10); // -24.01, opposite to the hit
  });

  it('shell reflect: headbutting an anchored Shelly returns the attacker\'s OWN force × 0.85, away from her', () => {
    // Sebastian: force 18, boost 1.45 → reflect = 18·3.5·1.45·0.85 = 77.6475
    const seb = makePlayer({ sessionId: 'seb', critterName: 'Sebastian', x: 0, z: 0, isHeadbutting: true });
    const shelly = makeAnchoredShelly(1.0, 0);
    const reflects: ShellReflectEvent[] = [];
    resolveCollisions([seb, shelly], undefined, reflects);
    expect(seb.vx).toBeCloseTo(-77.6475, 10); // pushed back along -x (away from Shelly)
    expect(seb.vz).toBeCloseTo(0, 12);
    expect(shelly.vx).toBe(0); // the anchored side takes nothing
    expect(shelly.vz).toBe(0);
    // mass ×9999 separation: Shelly barely moves, the attacker eats the overlap
    expect(shelly.x).toBeCloseTo(1.0, 3);
    expect(seb.x).toBeCloseTo(-0.1, 3);
    // The reflect emits its broadcast event (feedback online, 2026-08-24)
    expect(reflects).toEqual([{ attackerSid: 'seb', anchoredSid: 'shelly' }]);

    // Reflect scales with the ATTACKER: a weak hitter bounces off gently.
    // Sihans: force 10, boost default 1.0 → 10·3.5·1.0·0.85 = 29.75
    const sihans = makePlayer({ sessionId: 'sih', critterName: 'Sihans', x: 0, z: 0, isHeadbutting: true });
    const shelly2 = makeAnchoredShelly(1.0, 0);
    resolveCollisions([sihans, shelly2]);
    expect(sihans.vx).toBeCloseTo(-29.75, 10);
    expect(Math.abs(sihans.vx)).toBeLessThan(Math.abs(seb.vx));
  });

  it('anchored bounce without headbutt: running into Steel Shell rebounds at normalPush × 1.4', () => {
    const runner = makePlayer({ sessionId: 'run', critterName: 'Sergei', x: 0, z: 0 });
    const shelly = makeAnchoredShelly(1.0, 0);
    resolveCollisions([runner, shelly]);
    expect(runner.vx).toBeCloseTo(-3.0 * 1.4, 10); // -4.2
    expect(shelly.vx).toBe(0);
  });

  it('stunnedVulnerability: a stunned defender takes exactly ×4 knockback', () => {
    const hitKermit = (stunTimer: number): number => {
      const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
      const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0, stunTimer });
      resolveCollisions([atk, def]);
      return def.vx;
    };
    const normal = hitKermit(0);
    const stunned = hitKermit(0.5);
    expect(stunned / normal).toBeCloseTo(4, 12);
    expect(stunned).toBeCloseTo(42.875 * 4, 10); // 171.5 — Trunk Grip follow-up yeet
  });

  it('headbutt connect records last-attacker credit on the defender (Slayer Belt)', () => {
    const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    const internal = new Map<
      string,
      { respawnTimer: number; lastAttackerSid?: string | null; lastAttackTimeMs?: number }
    >([
      ['atk', { respawnTimer: 0 }],
      ['def', { respawnTimer: 0 }],
    ]);
    resolveCollisions([atk, def], internal);
    const di = internal.get('def')!;
    expect(di.lastAttackerSid).toBe('atk');
    expect(di.lastAttackTimeMs).toBeTypeOf('number');
    expect(internal.get('atk')!.lastAttackerSid).toBeUndefined();
  });
});
