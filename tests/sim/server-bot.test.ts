// ---------------------------------------------------------------------------
// Server bot brain (server/src/sim/bot.ts — computeBotInput).
// Pure decision function: PlayerSchema is a type-only import there, so
// plain objects with the read fields are valid stand-ins. All probabilistic
// branches are pinned by stubbing Math.random (never by sampling).
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { computeBotInput } from '../../server/src/sim/bot.js';

interface AbilityLike {
  abilityType: string;
  active: boolean;
  windUpLeft: number;
}

function makePlayer(overrides: {
  sessionId: string;
  critterName?: string;
  x: number;
  z: number;
  falling?: boolean;
  immunityTimer?: number;
  isHeadbutting?: boolean;
  abilities?: AbilityLike[];
}): PlayerSchema {
  return {
    sessionId: overrides.sessionId,
    critterName: overrides.critterName ?? 'Sergei',
    x: overrides.x,
    z: overrides.z,
    alive: true,
    falling: overrides.falling ?? false,
    immunityTimer: overrides.immunityTimer ?? 0,
    isHeadbutting: overrides.isHeadbutting ?? false,
    abilities: overrides.abilities ?? [],
  } as unknown as PlayerSchema;
}

/** Arena de prueba: disco perfecto, así que el radio direccional
 *  (`radiusAt`, fase 0.5) coincide con el global en todos los ángulos. */
const arenaDisc = (radius: number) => ({
  currentRadius: radius,
  radiusAt: (_angle: number) => radius,
  isOnArena: (x: number, z: number) => x * x + z * z <= radius * radius,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server bot — computeBotInput', () => {
  it('chases the NEAREST alive enemy and headbutts at contact range (< 2 u)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999); // all dice fail → deterministic
    const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
    const near = makePlayer({ sessionId: 'near', x: 1.5, z: 0 });
    const far = makePlayer({ sessionId: 'far', x: 0, z: 8 });
    const input = computeBotInput(bot, [bot, near, far]);
    expect(input.moveX).toBeCloseTo(1, 6); // toward `near`, not `far`
    expect(input.moveZ).toBeCloseTo(0, 6);
    expect(input.headbutt).toBe(true); // 1.5 < 2.0
  });

  it('a falling target is bait — ignored in favor of the farther alive one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
    const fallingNear = makePlayer({ sessionId: 'f', x: 1, z: 0, falling: true });
    const alive = makePlayer({ sessionId: 'a', x: 0, z: 5 });
    const input = computeBotInput(bot, [bot, fallingNear, alive]);
    expect(input.moveZ).toBeCloseTo(1, 6); // chases the alive one
    expect(input.moveX).toBeCloseTo(0, 6);
    expect(input.headbutt).toBe(false); // 5 u away
  });

  it('Kurama in an immunity window is untargetable (Mirror Trick); other immune critters are not', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
    const ghostKurama = makePlayer({ sessionId: 'k', critterName: 'Kurama', x: 2, z: 0, immunityTimer: 1.0 });
    const lost = computeBotInput(bot, [bot, ghostKurama]);
    expect(lost.moveX).toBe(0); // no valid target → stands still
    expect(lost.moveZ).toBe(0);
    expect(lost.headbutt).toBe(false);

    // Post-respawn immunity on a NON-Kurama does not hide the target.
    const immuneSergei = makePlayer({ sessionId: 's', x: 2, z: 0, immunityTimer: 1.0 });
    const chased = computeBotInput(bot, [bot, immuneSergei]);
    expect(chased.moveX).toBeCloseTo(1, 6);
  });

  it('edge awareness: void directly ahead (isOnArena false at the probe) → full turn toward center', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 11.5, z: 0 });
    const target = makePlayer({ sessionId: 't', x: 14, z: 0 }); // straight off the rim
    const input = computeBotInput(bot, [bot, target], arenaDisc(12));
    // probe at x = 11.5 + 1.1 = 12.6 > 12 → off arena → steer = -pos/|pos|
    expect(input.moveX).toBeCloseTo(-1, 10);
    expect(Math.abs(input.moveZ)).toBeLessThan(1e-10);
  });

  it('edge awareness: inside the danger band the steering blends inward but keeps chasing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 11, z: 0 }); // rd 11 > 12 - 1.4
    const target = makePlayer({ sessionId: 't', x: 11, z: 5 }); // tangential chase
    const input = computeBotInput(bot, [bot, target], arenaDisc(12));
    // danger 0.4 → w = (0.4/1.4)·1.6 ≈ 0.457 → normalized (-0.416, 0.909)
    expect(input.moveX).toBeLessThan(-0.3); // pulled toward center (−x)
    expect(input.moveZ).toBeGreaterThan(0.85); // still going for the target
    expect(Math.hypot(input.moveX, input.moveZ)).toBeCloseTo(1, 6);
  });

  it('Steel Shell trigger is DETERMINISTIC: incoming pressure raises the shell, calm does not', () => {
    // Dice rigged to always FAIL — if the shell still comes up, no rng was involved.
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    // Single instance per scenario: the self-filter (`p === bot`) is by reference.
    const shelly = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0 });

    // a) headbutt incoming at 2 u (< 2.8·1.6 = 4.48) → shell up
    const butting = makePlayer({ sessionId: 'e', x: 2, z: 0, isHeadbutting: true });
    expect(computeBotInput(shelly, [shelly, butting]).ability2).toBe(true);

    // b) mobility charge active on the attacker (Trunk-style ram) → shell up
    const charging = makePlayer({
      sessionId: 'e', x: 2, z: 0,
      abilities: [{ abilityType: 'charge_rush', active: true, windUpLeft: 0 }],
    });
    expect(computeBotInput(shelly, [shelly, charging]).ability2).toBe(true);

    // c) calm enemy, no edge pressure → shell stays down
    const calm = makePlayer({ sessionId: 'e', x: 2, z: 0 });
    expect(computeBotInput(shelly, [shelly, calm]).ability2).toBe(false);

    // d) pinned on the rim with an enemy in defend range → shell up
    const pinnedShelly = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 11.2, z: 0 });
    const presser = makePlayer({ sessionId: 'e', x: 13, z: 0 });
    expect(computeBotInput(pinnedShelly, [pinnedShelly, presser], arenaDisc(12)).ability2).toBe(true);
  });

  it('slot-2 gating is def-shape driven: cone needs one victim in radius, radial needs nearbyCount ≥ 2, projectile needs the 4..14 band', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // all dice succeed → only the gates decide
    const at = (name: string, x: number) => {
      const bot = makePlayer({ sessionId: 'bot', critterName: name, x: 0, z: 0 });
      const enemy = makePlayer({ sessionId: 'e', x, z: 0 });
      return { bot, enemy };
    };

    // Sebastian Claw Wave (coneAngleDeg 60, radius 3.5 → gate < 3.15): ONE victim suffices
    let s = at('Sebastian', 2.5);
    expect(computeBotInput(s.bot, [s.bot, s.enemy]).ability2).toBe(true);
    s = at('Sebastian', 3.4); // outside 3.5 × 0.9
    expect(computeBotInput(s.bot, [s.bot, s.enemy]).ability2).toBe(false);

    // Sergei Shockwave (radial): one enemy at 2 u is NOT enough…
    const sergei = at('Sergei', 2);
    expect(computeBotInput(sergei.bot, [sergei.bot, sergei.enemy]).ability2).toBe(false);
    // …but being surrounded (nearbyCount ≥ 2) is.
    const second = makePlayer({ sessionId: 'e2', x: 0, z: 3 });
    expect(computeBotInput(sergei.bot, [sergei.bot, sergei.enemy, second]).ability2).toBe(true);

    // Kowalski Snowball (projectile): mid-range 4..14 only
    let k = at('Kowalski', 6);
    expect(computeBotInput(k.bot, [k.bot, k.enemy]).ability2).toBe(true);
    k = at('Kowalski', 3); // too close for a snowball
    expect(computeBotInput(k.bot, [k.bot, k.enemy]).ability2).toBe(false);
  });

  it('per-tick rate conversion at 30 Hz: fires iff roll < 1-(1-ratePerSec)^(1/30)', () => {
    // Mobility rate mirror of FEEL.bots.fireRatesPerSec.mobility = 0.702.
    // We test the exact FORMULA boundary, not the randomness: the same
    // double-precision expression the bot computes must gate the roll.
    const threshold = 1 - Math.pow(1 - 0.702, 1 / 30); // ≈ 0.03956 per tick
    const run = (roll: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
      const enemy = makePlayer({ sessionId: 'e', x: 0, z: 4.5 }); // mobility band 3..6
      const input = computeBotInput(bot, [bot, enemy]);
      vi.restoreAllMocks();
      return input.ability1;
    };
    expect(run(threshold - 1e-12)).toBe(true);
    expect(run(threshold + 1e-12)).toBe(false);
  });
});
