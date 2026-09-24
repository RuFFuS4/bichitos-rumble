// ---------------------------------------------------------------------------
// Server bot brain (server/src/sim/bot.ts — computeBotInput).
// Pure decision function: PlayerSchema is a type-only import there, so
// plain objects with the read fields are valid stand-ins. All probabilistic
// branches are pinned by stubbing Math.random (never by sampling).
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { computeBotInput } from '../../server/src/sim/bot.js';
import { SIM } from '../../server/src/sim/config.js';

/** The move vector's LENGTH is the bot's pace (fraction of a player's
 *  acceleration) — 0.7 since the 2026-09-21 speed-up; the direction is
 *  what the brain decides. */
const PACE = SIM.bots.moveAccelFactor;

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
  rotationY?: number;
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
    rotationY: overrides.rotationY ?? 0, // facing +Z
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
    expect(input.moveX).toBeCloseTo(PACE, 6); // toward `near`, not `far`
    expect(input.moveZ).toBeCloseTo(0, 6);
    expect(input.headbutt).toBe(true); // 1.5 < 2.0
  });

  it('a falling target is bait — ignored in favor of the farther alive one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
    const fallingNear = makePlayer({ sessionId: 'f', x: 1, z: 0, falling: true });
    const alive = makePlayer({ sessionId: 'a', x: 0, z: 5 });
    const input = computeBotInput(bot, [bot, fallingNear, alive]);
    expect(input.moveZ).toBeCloseTo(PACE, 6); // chases the alive one
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
    expect(chased.moveX).toBeCloseTo(PACE, 6);
  });

  it('edge awareness: void directly ahead (isOnArena false at the probe) → full turn toward center', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 11.5, z: 0 });
    const target = makePlayer({ sessionId: 't', x: 14, z: 0 }); // straight off the rim
    const input = computeBotInput(bot, [bot, target], arenaDisc(12));
    // probe at x = 11.5 + 1.1 = 12.6 > 12 → off arena → steer = -pos/|pos|
    expect(input.moveX).toBeCloseTo(-PACE, 10);
    expect(Math.abs(input.moveZ)).toBeLessThan(1e-10);
  });

  it('the pace is applied AFTER the void probe (a pre-scaled vector would shorten the probe)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 11.0, z: 0 });
    const target = makePlayer({ sessionId: 't', x: 14, z: 0 });
    const input = computeBotInput(bot, [bot, target], arenaDisc(12));
    // full probe: 11 + 1.1 = 12.1 > 12 → void → full turn inward at PACE.
    // (Scaled first it would probe 11 + 0.77 = 11.77, see solid ground and
    // only blend — the bot would walk further out.)
    expect(input.moveX).toBeCloseTo(-PACE, 10);
    expect(Math.abs(input.moveZ)).toBeLessThan(1e-10);
  });

  it('edge awareness: inside the danger band the steering blends inward but keeps chasing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const bot = makePlayer({ sessionId: 'bot', x: 11, z: 0 }); // rd 11 > 12 - 1.4
    const target = makePlayer({ sessionId: 't', x: 11, z: 5 }); // tangential chase
    const input = computeBotInput(bot, [bot, target], arenaDisc(12));
    // danger 0.4 → w = (0.4/1.4)·1.6 ≈ 0.457 → normalized (-0.416, 0.909) × PACE
    expect(input.moveX).toBeLessThan(-0.3 * PACE); // pulled toward center (−x)
    expect(input.moveZ).toBeGreaterThan(0.85 * PACE); // still going for the target
    expect(Math.hypot(input.moveX, input.moveZ)).toBeCloseTo(PACE, 6);
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

  it('slot-2 gating is def-shape driven: cone needs one victim in radius, radial pushes need two in radius or one close, projectile needs the 4..14 band', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // all dice succeed → only the gates decide
    // The bot faces its enemy (rotationY = atan2(dx, dz)) unless told otherwise.
    const at = (name: string, x: number, rotationY = Math.atan2(x, 0)) => {
      const bot = makePlayer({ sessionId: 'bot', critterName: name, x: 0, z: 0, rotationY });
      const enemy = makePlayer({ sessionId: 'e', x, z: 0 });
      return { bot, enemy };
    };

    // Sebastian Claw Wave (coneAngleDeg 60, radius 3.5 → gate < 3.15): ONE victim suffices
    let s = at('Sebastian', 2.5);
    expect(computeBotInput(s.bot, [s.bot, s.enemy]).ability2).toBe(true);
    s = at('Sebastian', 3.4); // outside 3.5 × 0.9
    expect(computeBotInput(s.bot, [s.bot, s.enemy]).ability2).toBe(false);
    s = at('Sebastian', 2.5, Math.PI); // in range but behind him: outside the ±60° cone
    expect(computeBotInput(s.bot, [s.bot, s.enemy]).ability2).toBe(false);

    // Sergei Shockwave (radial, radius 3.5): one enemy at 3 u is NOT enough…
    const sergei = at('Sergei', 3);
    expect(computeBotInput(sergei.bot, [sergei.bot, sergei.enemy]).ability2).toBe(false);
    // …two inside the radius are…
    const second = makePlayer({ sessionId: 'e2', x: 0, z: 3 });
    expect(computeBotInput(sergei.bot, [sergei.bot, sergei.enemy, second]).ability2).toBe(true);
    // …and so is a single one within radialSoloFrac of it (3.5 × 0.7 = 2.45).
    const close = at('Sergei', 2);
    expect(computeBotInput(close.bot, [close.bot, close.enemy]).ability2).toBe(true);
    // Not if that one is immune: no push moves it.
    const shielded = makePlayer({ sessionId: 'e', x: 2, z: 0, immunityTimer: 1 });
    expect(computeBotInput(close.bot, [close.bot, shielded]).ability2).toBe(false);
    // Two within 4 u but one outside the 3.5 u radius: not surrounded any more.
    const far = makePlayer({ sessionId: 'e2', x: 0, z: 3.8 });
    expect(computeBotInput(sergei.bot, [sergei.bot, sergei.enemy, far]).ability2).toBe(false);

    // Kowalski Snowball (projectile): mid-range 4..14 only…
    let k = at('Kowalski', 6);
    expect(computeBotInput(k.bot, [k.bot, k.enemy]).ability2).toBe(true);
    k = at('Kowalski', 3); // too close for a snowball
    expect(computeBotInput(k.bot, [k.bot, k.enemy]).ability2).toBe(false);
    // …and within ±rangedAimDeg (35°) of the facing: 45° off does not throw.
    k = at('Kowalski', 6, Math.atan2(6, 0) - (45 * Math.PI) / 180);
    expect(computeBotInput(k.bot, [k.bot, k.enemy]).ability2).toBe(false);
  });

  it('Shadow Step (seeking blink) fires past headbutt range, on a non-immune target, only when the landing push points outward', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // 7 u: in seek range (9) and outside the J's 3..6 band, which would win the tick.
    const cheeto = makePlayer({ sessionId: 'bot', critterName: 'Cheeto', x: 0, z: 0 });
    // Target at (7, 0): push (7, 0) · target (7, 0) > 0 → toward the rim.
    const outward = makePlayer({ sessionId: 'e', x: 7, z: 0 });
    expect(computeBotInput(cheeto, [cheeto, outward]).ability2).toBe(true);
    // Cheeto farther out than the target: the push would shove it inward.
    const outer = makePlayer({ sessionId: 'bot', critterName: 'Cheeto', x: 9, z: 0 });
    const inner = makePlayer({ sessionId: 'e', x: 2, z: 0 });
    expect(computeBotInput(outer, [outer, inner]).ability2).toBe(false);
    // Already at headbutt range (< 3 u), or immune: no.
    const touching = makePlayer({ sessionId: 'e', x: 2, z: 0 });
    expect(computeBotInput(cheeto, [cheeto, touching]).ability2).toBe(false);
    const immune = makePlayer({ sessionId: 'e', x: 7, z: 0, immunityTimer: 1 });
    expect(computeBotInput(cheeto, [cheeto, immune]).ability2).toBe(false);
    // Same tick as its J (target at 5 u, in the J band): the J goes, the blink waits.
    const mid = makePlayer({ sessionId: 'e', x: 5, z: 0 });
    const both = computeBotInput(cheeto, [cheeto, mid]);
    expect(both.ability1).toBe(true);
    expect(both.ability2).toBe(false);
  });

  it('Sand Trap (blink that leaves a zone) fires with the enemy on the quicksand and a landing on the arena', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // zone.radius 3.5 × trapRadiusFrac 0.8 = 2.8; blinkDistance 6.5 along the facing (+Z).
    const sihans = makePlayer({ sessionId: 'bot', critterName: 'Sihans', x: 0, z: 0 });
    const onSand = makePlayer({ sessionId: 'e', x: 2, z: 0 });
    expect(computeBotInput(sihans, [sihans, onSand], arenaDisc(12)).ability2).toBe(true);
    const offSand = makePlayer({ sessionId: 'e', x: 3.2, z: 0 });
    expect(computeBotInput(sihans, [sihans, offSand], arenaDisc(12)).ability2).toBe(false);
    // Facing the rim from z = 7: 7 + 6.5 lands off a 12 u disc.
    const nearRim = makePlayer({ sessionId: 'bot', critterName: 'Sihans', x: 0, z: 7 });
    const enemy = makePlayer({ sessionId: 'e', x: 2, z: 7 });
    expect(computeBotInput(nearRim, [nearRim, enemy], arenaDisc(12)).ability2).toBe(false);
  });

  it('the J is not cast when the dash along the facing runs off the arena', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const enemy = makePlayer({ sessionId: 'e', x: 0, z: 4.5 }); // mobility band 3..6
    // Facing +Z from the centre: probes at 1 and 3 u are floor.
    const center = makePlayer({ sessionId: 'bot', x: 0, z: 0 });
    expect(computeBotInput(center, [center, enemy], arenaDisc(12)).ability1).toBe(true);
    // Facing +X at x = 10: the 3 u probe (x = 13) is void.
    const rim = makePlayer({ sessionId: 'bot', x: 10, z: 0, rotationY: Math.PI / 2 });
    const enemy2 = makePlayer({ sessionId: 'e', x: 10, z: 4.5 });
    expect(computeBotInput(rim, [rim, enemy2], arenaDisc(12)).ability1).toBe(false);
  });

  it("Steel Shell doesn't come up for an incoming charge while the own L runs, but still does for the rim", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const sawing = [
      { abilityType: 'charge_rush', active: false, windUpLeft: 0 },
      { abilityType: 'ground_pound', active: false, windUpLeft: 0 },
      { abilityType: 'frenzy', active: true, windUpLeft: 0 },
    ];
    const shelly = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0, abilities: sawing });
    const butting = makePlayer({ sessionId: 'e', x: 2, z: 0, isHeadbutting: true });
    expect(computeBotInput(shelly, [shelly, butting]).ability2).toBe(false);
    const pinned = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 11.2, z: 0, abilities: sawing });
    const presser = makePlayer({ sessionId: 'e', x: 13, z: 0 });
    expect(computeBotInput(pinned, [pinned, presser], arenaDisc(12)).ability2).toBe(true);
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
