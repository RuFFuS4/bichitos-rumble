// ---------------------------------------------------------------------------
// Server bot brain (server/src/sim/bot.ts — computeBotInput).
// Pure decision function: PlayerSchema is a type-only import there, so
// plain objects with the read fields are valid stand-ins. All probabilistic
// branches are pinned by stubbing Math.random (never by sampling).
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { getAbilityKit } from '../../server/src/sim/abilities.js';
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
  cooldownLeft?: number;
}

/** Every slot of the critter's server kit, idle and off cooldown. */
function readyKit(critterName: string): AbilityLike[] {
  return getAbilityKit(critterName).map((d) => ({ abilityType: d.type, active: false, windUpLeft: 0, cooldownLeft: 0 }));
}

function makePlayer(overrides: {
  sessionId: string;
  critterName?: string;
  x: number;
  z: number;
  rotationY?: number;
  falling?: boolean;
  immunityTimer?: number;
  stunTimer?: number;
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
    stunTimer: overrides.stunTimer ?? 0,
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

  it("a gliding J (Ice Slide) probes as far as it carries: 3 u × its glide factor", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // Facing +X at x = 7: Sergei's probes (x = 8 and 10) are floor.
    const sergei = makePlayer({ sessionId: 'bot', x: 7, z: 0, rotationY: Math.PI / 2 });
    const enemy = makePlayer({ sessionId: 'e', x: 7, z: 4.5 });
    expect(computeBotInput(sergei, [sergei, enemy], arenaDisc(12)).ability1).toBe(true);
    // Kowalski glides 2.16× as far: her probe lands at x ≈ 13.5, void.
    const kowalski = makePlayer({ sessionId: 'bot', critterName: 'Kowalski', x: 7, z: 0, rotationY: Math.PI / 2 });
    expect(computeBotInput(kowalski, [kowalski, enemy], arenaDisc(12)).ability1).toBe(false);
    // From x = 4 it lands at ≈ 10.5, floor.
    const inside = makePlayer({ sessionId: 'bot', critterName: 'Kowalski', x: 4, z: 0, rotationY: Math.PI / 2 });
    const enemy2 = makePlayer({ sessionId: 'e', x: 4, z: 4.5 });
    expect(computeBotInput(inside, [inside, enemy2], arenaDisc(12)).ability1).toBe(true);
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

  it('a stunned bot presses nothing (Trunk Grip / Slam), even with every die rigged to succeed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const enemy = makePlayer({ sessionId: 'e', x: 1.5, z: 0, isHeadbutting: true });
    const free = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0 });
    const freeInput = computeBotInput(free, [free, enemy]);
    expect(freeInput.headbutt).toBe(true);
    expect(freeInput.ability2).toBe(true); // Steel Shell against the incoming headbutt
    const stunned = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0, stunTimer: 0.5 });
    const input = computeBotInput(stunned, [stunned, enemy]);
    expect([input.headbutt, input.ability1, input.ability2, input.ultimate]).toEqual([false, false, false, false]);
    // It still steers toward the target (rooted anyway: effectiveSpeed is 0).
    expect(input.moveX).toBeCloseTo(PACE, 6);
    expect(input.moveZ).toBeCloseTo(0, 6);
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

describe('server bot — the L gate (SIM.bots.ultimateOnline)', () => {
  it('stays shut until BrawlRoom runs the L like the sim: no bot presses its L', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(SIM.bots.ultimateOnline).toBe(false);
    const sergei = makePlayer({ sessionId: 'bot', x: 0, z: 0, abilities: readyKit('Sergei') });
    const enemy = makePlayer({ sessionId: 'e', x: 3, z: 0 });
    expect(computeBotInput(sergei, [sergei, enemy]).ultimate).toBe(false);
  });
});

describe('server bot — the L (online bots cast it since 2026-09-24, mirror of src/bot.ts)', () => {
  // The rules below, with the deploy gate open (it opens in the BrawlRoom
  // slice; see SIM.bots.ultimateOnline).
  const gate = SIM.bots as { ultimateOnline: boolean };
  beforeAll(() => { gate.ultimateOnline = true; });
  afterAll(() => { gate.ultimateOnline = false; });

  it('a buff L (Sergei Frenzy) fires with the nearest enemy within buffRange, any direction, and only when ready', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const sergei = makePlayer({ sessionId: 'bot', x: 0, z: 0, abilities: readyKit('Sergei') });
    const enemyAt = (x: number, z: number) => makePlayer({ sessionId: 'e', x, z });
    expect(computeBotInput(sergei, [sergei, enemyAt(3, 0)]).ultimate).toBe(true);
    expect(computeBotInput(sergei, [sergei, enemyAt(0, -3)]).ultimate).toBe(true); // behind him too
    expect(computeBotInput(sergei, [sergei, enemyAt(3.6, 0)]).ultimate).toBe(false); // buffRange 3.5
    const cooling = readyKit('Sergei');
    cooling[2].cooldownLeft = 4;
    const onCooldown = makePlayer({ sessionId: 'bot', x: 0, z: 0, abilities: cooling });
    expect(computeBotInput(onCooldown, [onCooldown, enemyAt(3, 0)]).ultimate).toBe(false);
    const running = readyKit('Sergei');
    running[2].active = true;
    const inFrenzy = makePlayer({ sessionId: 'bot', x: 0, z: 0, abilities: running });
    expect(computeBotInput(inFrenzy, [inFrenzy, enemyAt(3, 0)]).ultimate).toBe(false);
    const stunned = makePlayer({ sessionId: 'bot', x: 0, z: 0, stunTimer: 1, abilities: readyKit('Sergei') });
    expect(computeBotInput(stunned, [stunned, enemyAt(3, 0)]).ultimate).toBe(false);
  });

  it('the L roll is the buff rate per second converted at 30 Hz', () => {
    const threshold = 1 - Math.pow(1 - SIM.bots.fireRatesPerSec.buff, 1 / 30);
    const run = (roll: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      // 3 u: outside the J's band (> 3) and short of both radial K gates.
      const bot = makePlayer({ sessionId: 'bot', x: 0, z: 0, abilities: readyKit('Sergei') });
      const enemy = makePlayer({ sessionId: 'e', x: 3, z: 0 });
      const input = computeBotInput(bot, [bot, enemy]);
      vi.restoreAllMocks();
      return input.ultimate;
    };
    expect(run(threshold - 1e-12)).toBe(true);
    expect(run(threshold + 1e-12)).toBe(false);
  });

  it('Trunk Grip fires on whom the grip would take, past headbutt range and short of gripMaxRange', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const trunk = makePlayer({ sessionId: 'bot', critterName: 'Trunk', x: 0, z: 0, abilities: readyKit('Trunk') }); // facing +Z
    const enemyAt = (x: number, z: number, immunityTimer = 0) => makePlayer({ sessionId: 'e', x, z, immunityTimer });
    expect(computeBotInput(trunk, [trunk, enemyAt(0, 6)]).ultimate).toBe(true);
    expect(computeBotInput(trunk, [trunk, enemyAt(0, 2.5)]).ultimate).toBe(false); // < targetedMinRange 3
    expect(computeBotInput(trunk, [trunk, enemyAt(0, 11)]).ultimate).toBe(false); // > gripMaxRange 10 (the grip reaches 28)
    expect(computeBotInput(trunk, [trunk, enemyAt(6, 0)]).ultimate).toBe(false); // 90° off: outside its ±35°
    expect(computeBotInput(trunk, [trunk, enemyAt(0, 6, 1)]).ultimate).toBe(false); // the grip skips the immune
    // It judges the grip's own target, not the nearest enemy: one at 2 u to
    // the side doesn't stop it from taking the one 6 u ahead.
    const side = makePlayer({ sessionId: 's', x: 2, z: 0 });
    expect(computeBotInput(trunk, [trunk, side, enemyAt(0, 6)]).ultimate).toBe(true);
  });

  it('Frozen Floor needs min(2, enemies alive) within floorRadius × floorCastRadiusFrac (4.8 u), not buffRange', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const kowalski = makePlayer({ sessionId: 'bot', critterName: 'Kowalski', x: 0, z: 0, abilities: readyKit('Kowalski') });
    const a = makePlayer({ sessionId: 'a', x: 4, z: 0 });
    const b = makePlayer({ sessionId: 'b', x: 0, z: 4.5 });
    const far = makePlayer({ sessionId: 'c', x: 0, z: -8 });
    expect(computeBotInput(kowalski, [kowalski, a, b]).ultimate).toBe(true); // 2 of 2 on the ice
    expect(computeBotInput(kowalski, [kowalski, a, far]).ultimate).toBe(false); // 1 of 2
    expect(computeBotInput(kowalski, [kowalski, a]).ultimate).toBe(true); // 1v1: the one left is enough, at 4 u
    const out = makePlayer({ sessionId: 'a', x: 5, z: 0 });
    expect(computeBotInput(kowalski, [kowalski, out]).ultimate).toBe(false); // 5 > 4.8
  });

  it('Cone Pulse fires with the nearest enemy within buffRange and inside its ±45° cone', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const cheeto = makePlayer({ sessionId: 'bot', critterName: 'Cheeto', x: 0, z: 0, abilities: readyKit('Cheeto') }); // facing +Z
    const enemyAt = (x: number, z: number) => makePlayer({ sessionId: 'e', x, z });
    expect(computeBotInput(cheeto, [cheeto, enemyAt(0, 3)]).ultimate).toBe(true);
    const off = (60 * Math.PI) / 180;
    expect(computeBotInput(cheeto, [cheeto, enemyAt(3 * Math.sin(off), 3 * Math.cos(off))]).ultimate).toBe(false);
    expect(computeBotInput(cheeto, [cheeto, enemyAt(0, 4)]).ultimate).toBe(false); // ahead but past 3.5 u
  });

  it("Shelly's Saw Shell: never shelled up, nor on the tick the shell comes up", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const calm = makePlayer({ sessionId: 'e', x: 2, z: 0 });
    const free = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0, abilities: readyKit('Shelly') });
    expect(computeBotInput(free, [free, calm]).ultimate).toBe(true);
    // Anchored: the saw would stand still.
    const shelledKit = readyKit('Shelly');
    shelledKit[1].active = true;
    const shelled = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0, abilities: shelledKit });
    expect(computeBotInput(shelled, [shelled, calm]).ultimate).toBe(false);
    // An incoming headbutt raises the shell this tick: the L waits.
    const butting = makePlayer({ sessionId: 'e', x: 2, z: 0, isHeadbutting: true });
    const raising = computeBotInput(free, [free, butting]);
    expect(raising.ability2).toBe(true);
    expect(raising.ultimate).toBe(false);
    // With the K cooling down the reflex press does nothing, so the L goes.
    const coolingKit = readyKit('Shelly');
    coolingKit[1].cooldownLeft = 5;
    const cooling = makePlayer({ sessionId: 'bot', critterName: 'Shelly', x: 0, z: 0, abilities: coolingKit });
    expect(computeBotInput(cooling, [cooling, butting]).ultimate).toBe(true);
  });

  it("Sebastian's All-in is never pressed: BrawlRoom's hold loop has no bot path to drop a charge", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const sebastian = makePlayer({ sessionId: 'bot', critterName: 'Sebastian', x: 0, z: 0, abilities: readyKit('Sebastian') });
    for (const z of [1.5, 3, 6]) {
      const ahead = makePlayer({ sessionId: 'e', x: 0, z });
      expect(computeBotInput(sebastian, [sebastian, ahead]).ultimate).toBe(false);
    }
  });
});
