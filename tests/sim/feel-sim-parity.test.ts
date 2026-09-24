// ---------------------------------------------------------------------------
// FEEL (client, src/gamefeel.ts) ↔ SIM (server, server/src/sim/config.ts)
// ---------------------------------------------------------------------------
//
// The server simulates online matches with its own copy of the physics
// numbers. `check-sim-parity` only byte-compares the arena generator, so a
// speed or knockback value changed on one side used to pass `npm run check`
// in green and desync online silently. This pins the numeric pairs that
// live in FEEL and SIM (movement, headbutt, collision, bots, charge rush,
// ground pound, frenzy, lives, match). Changing one side without the other
// fails here. It pins NUMBERS, not code: a server path that reads the same
// number differently (e.g. the dead zone, still unconditional in
// BrawlRoom.ts) is outside its reach. Ability kits are checked by
// scripts/verify-ability-parity.mjs.
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
  ['collision.shellReflectFactor', FEEL.collision.shellReflectFactor, SIM.collision.shellReflectFactor],
  ['collision.stunnedVulnerability', FEEL.collision.stunnedVulnerability, SIM.collision.stunnedVulnerability],
  ['bots.moveAccelFactor', FEEL.bots.moveAccelFactor, SIM.bots.moveAccelFactor],
  ['bots.edgeMargin', FEEL.bots.edgeMargin, SIM.bots.edgeMargin],
  ['bots.edgeSteer', FEEL.bots.edgeSteer, SIM.bots.edgeSteer],
  ['bots.lookAhead', FEEL.bots.lookAhead, SIM.bots.lookAhead],
  ['bots.defendRange', FEEL.bots.defendRange, SIM.bots.defendRange],
  ['bots.fireRatesPerSec.mobility', FEEL.bots.fireRatesPerSec.mobility, SIM.bots.fireRatesPerSec.mobility],
  ['bots.fireRatesPerSec.radial', FEEL.bots.fireRatesPerSec.radial, SIM.bots.fireRatesPerSec.radial],
  ['bots.fireRatesPerSec.cone', FEEL.bots.fireRatesPerSec.cone, SIM.bots.fireRatesPerSec.cone],
  ['bots.fireRatesPerSec.ranged', FEEL.bots.fireRatesPerSec.ranged, SIM.bots.fireRatesPerSec.ranged],
  ['bots.fireRatesPerSec.blinkSeek', FEEL.bots.fireRatesPerSec.blinkSeek, SIM.bots.fireRatesPerSec.blinkSeek],
  ['bots.fireRatesPerSec.trap', FEEL.bots.fireRatesPerSec.trap, SIM.bots.fireRatesPerSec.trap],
  ['bots.fireRatesPerSec.buff', FEEL.bots.fireRatesPerSec.buff, SIM.bots.fireRatesPerSec.buff],
  ['bots.fireRatesPerSec.grip', FEEL.bots.fireRatesPerSec.grip, SIM.bots.fireRatesPerSec.grip],
  ['bots.nearbyRadius', FEEL.bots.nearbyRadius, SIM.bots.nearbyRadius],
  ['bots.radialSoloFrac', FEEL.bots.radialSoloFrac, SIM.bots.radialSoloFrac],
  ['bots.dashProbeNear', FEEL.bots.dashProbeNear, SIM.bots.dashProbeNear],
  ['bots.dashProbeFar', FEEL.bots.dashProbeFar, SIM.bots.dashProbeFar],
  ['bots.rangedAimDeg', FEEL.bots.rangedAimDeg, SIM.bots.rangedAimDeg],
  ['bots.targetedMinRange', FEEL.bots.targetedMinRange, SIM.bots.targetedMinRange],
  ['bots.trapRadiusFrac', FEEL.bots.trapRadiusFrac, SIM.bots.trapRadiusFrac],
  ['bots.buffRange', FEEL.bots.buffRange, SIM.bots.buffRange],
  ['bots.gripMaxRange', FEEL.bots.gripMaxRange, SIM.bots.gripMaxRange],
  ['bots.floorCastRadiusFrac', FEEL.bots.floorCastRadiusFrac, SIM.bots.floorCastRadiusFrac],
  ['groundPound.windUp', FEEL.groundPound.windUp, SIM.groundPound.windUp],
  ['groundPound.slowDuringWindUp', FEEL.groundPound.slowDuringWindUp, SIM.groundPound.slowDuringWindUp],
  ['groundPound.radius', FEEL.groundPound.radius, SIM.groundPound.radius],
  ['groundPound.force', FEEL.groundPound.force, SIM.groundPound.force],
  ['groundPound.cooldown', FEEL.groundPound.cooldown, SIM.groundPound.cooldown],
  ['groundPound.duration', FEEL.groundPound.duration, SIM.groundPound.duration],
  ['frenzy.speedMultiplier', FEEL.frenzy.speedMultiplier, SIM.frenzy.speedMultiplier],
  ['frenzy.massMultiplier', FEEL.frenzy.massMultiplier, SIM.frenzy.massMultiplier],
  ['frenzy.duration', FEEL.frenzy.duration, SIM.frenzy.duration],
  ['frenzy.windUp', FEEL.frenzy.windUp, SIM.frenzy.windUp],
  ['frenzy.slowDuringWindUp', FEEL.frenzy.slowDuringWindUp, SIM.frenzy.slowDuringWindUp],
  ['frenzy.cooldown', FEEL.frenzy.cooldown, SIM.frenzy.cooldown],
  ['lives.default', FEEL.lives.default, SIM.lives.default],
  ['lives.immunityDuration', FEEL.lives.immunityDuration, SIM.lives.immunityDuration],
  ['lives.respawnDelay', FEEL.lives.respawnDelay, SIM.lives.respawnDelay],
  ['lives.fallSpeed', FEEL.lives.fallSpeed, SIM.lives.fallSpeed],
  ['match.duration', FEEL.match.duration, SIM.match.duration],
  ['match.countdown', FEEL.match.countdown, SIM.match.countdown],
  ['chargeRush.impulse', FEEL.chargeRush.impulse, SIM.chargeRush.impulse],
  ['chargeRush.speedMultiplier', FEEL.chargeRush.speedMultiplier, SIM.chargeRush.speedMultiplier],
  ['chargeRush.massMultiplier', FEEL.chargeRush.massMultiplier, SIM.chargeRush.massMultiplier],
  ['chargeRush.duration', FEEL.chargeRush.duration, SIM.chargeRush.duration],
  ['chargeRush.cooldown', FEEL.chargeRush.cooldown, SIM.chargeRush.cooldown],
  ['chargeRush.windUp', FEEL.chargeRush.windUp, SIM.chargeRush.windUp],
  ['allIn.hitMargin', FEEL.allIn.hitMargin, SIM.allIn.hitMargin],
  ['allIn.missProbeStep', FEEL.allIn.missProbeStep, SIM.allIn.missProbeStep],
  // aimTurnDegPerSec and conePulse pin the value only: BrawlRoom doesn't
  // read them yet (pending, DISTRIBUCIÓN buzón fase 2), so green here is
  // not online parity until it does.
  ['allIn.aimTurnDegPerSec', FEEL.allIn.aimTurnDegPerSec, SIM.allIn.aimTurnDegPerSec],
  ['blink.landingProbeStep', FEEL.blink.landingProbeStep, SIM.blink.landingProbeStep],
  ['conePulse.waveStep', FEEL.conePulse.waveStep, SIM.conePulse.waveStep],
  ['conePulse.waveThickness', FEEL.conePulse.waveThickness, SIM.conePulse.waveThickness],
  ['abilities.contactRehitCooldown', FEEL.abilities.contactRehitCooldown, SIM.abilities.contactRehitCooldown],
];

describe('FEEL ↔ SIM parity (client and server simulate with the same numbers)', () => {
  it.each(PAIRS)('%s', (_path, client, server) => {
    expect(server).toBe(client);
  });

  it('a bot never out-accelerates a player (moveAccelFactor ≤ 1)', () => {
    expect(SIM.bots.moveAccelFactor).toBeLessThanOrEqual(1);
  });
});
