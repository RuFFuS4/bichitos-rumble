// ---------------------------------------------------------------------------
// FEEL (client, src/gamefeel.ts) ↔ SIM (server, server/src/sim/config.ts)
// ---------------------------------------------------------------------------
//
// The server simulates online matches with its own copy of the physics
// numbers. `check-sim-parity` only byte-compares the arena generator, so a
// speed or knockback value changed on one side used to pass `npm run check`
// in green and desync online silently. This pins every numeric pair the
// two simulations share. Changing one side without the other fails here.
// (2026-09-21, speed-up to accelerationScale 2.2 — docs/FEELING.md §7.)
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/gamefeel';
import { SIM } from '../../server/src/sim/config.js';

const PAIRS: Array<[string, number, number]> = [
  ['movement.frictionHalfLife', FEEL.movement.frictionHalfLife, SIM.movement.frictionHalfLife],
  ['movement.idleFrictionHalfLife', FEEL.movement.idleFrictionHalfLife, SIM.movement.idleFrictionHalfLife],
  ['movement.maxSpeed', FEEL.movement.maxSpeed, SIM.movement.maxSpeed],
  ['movement.accelerationScale', FEEL.movement.accelerationScale, SIM.movement.accelerationScale],
  ['movement.velocityDeadZone', FEEL.movement.velocityDeadZone, SIM.movement.velocityDeadZone],
  ['headbutt.anticipation', FEEL.headbutt.anticipation.duration, SIM.headbutt.anticipation],
  ['headbutt.lunge', FEEL.headbutt.lunge.duration, SIM.headbutt.lunge],
  ['headbutt.cooldown', FEEL.headbutt.cooldown, SIM.headbutt.cooldown],
  ['headbutt.velocityBoost', FEEL.headbutt.lunge.velocityBoost, SIM.headbutt.velocityBoost],
  ['headbutt.recoilFactor', FEEL.headbutt.recoilFactor, SIM.headbutt.recoilFactor],
  ['collision.normalPushForce', FEEL.collision.normalPushForce, SIM.collision.normalPushForce],
  ['collision.headbuttMultiplier', FEEL.collision.headbuttMultiplier, SIM.collision.headbuttMultiplier],
  ['collision.anchoredBounceFactor', FEEL.collision.anchoredBounceFactor, SIM.collision.anchoredBounceFactor],
  ['bots.moveAccelFactor', FEEL.bots.moveAccelFactor, SIM.bots.moveAccelFactor],
  ['chargeRush.impulse', FEEL.chargeRush.impulse, SIM.chargeRush.impulse],
  ['chargeRush.speedMultiplier', FEEL.chargeRush.speedMultiplier, SIM.chargeRush.speedMultiplier],
  ['chargeRush.massMultiplier', FEEL.chargeRush.massMultiplier, SIM.chargeRush.massMultiplier],
  ['chargeRush.duration', FEEL.chargeRush.duration, SIM.chargeRush.duration],
  ['chargeRush.cooldown', FEEL.chargeRush.cooldown, SIM.chargeRush.cooldown],
  ['chargeRush.windUp', FEEL.chargeRush.windUp, SIM.chargeRush.windUp],
];

describe('FEEL ↔ SIM parity (client and server simulate with the same numbers)', () => {
  it.each(PAIRS)('%s', (_path, client, server) => {
    expect(server).toBe(client);
  });
});
