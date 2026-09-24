import * as THREE from 'three';
import { Critter } from './critter';
import { activateAbility, getSlipperyZone, tickSebastianHoldToFire } from './abilities-runtime';
import { FEEL } from './gamefeel';
import { getMoveVector, isHeld } from './input';

/**
 * Player controller — reads device-agnostic input via the input abstraction.
 * Never touches the keyboard directly. When touch input is added, this file
 * needs no changes.
 */
export function updatePlayer(
  critter: Critter,
  dt: number,
  scene?: THREE.Scene,
  allCritters?: readonly Critter[],
): void {
  // No input while falling (bots and the server skip fallers too): a J/K
  // pressed in the void used to arm and go off at the respawn point, and
  // Sebastian could fire the All-in mid-fall at whoever pushed him.
  if (!critter.alive || critter.falling) return;

  const move = getMoveVector();
  let mx = move.x;
  let mz = move.z;

  // Reduce steering during Charge Rush (commitment)
  const chargeState = critter.abilityStates[0];
  if (chargeState?.active && chargeState.def.type === 'charge_rush' && chargeState.windUpLeft <= 0) {
    mx *= FEEL.chargeRush.steerFactor;
    mz *= FEEL.chargeRush.steerFactor;
  }

  // 2026-04-30 final-L — Toxic Touch confused inversion (offline).
  // Server applies the same inversion in BrawlRoom; this branch
  // covers vs-bots / dev-tools paths.
  if (critter.confusedTimer > 0) { mx = -mx; mz = -mz; }

  // Signal whether player is actively steering (kills drift when idle)
  critter.hasInput = mx !== 0 || mz !== 0;
  critter.moveX = mx;
  critter.moveZ = mz;

  // On someone else's ice (Kowalski Frozen Floor) there is less grip.
  // Applied before moveAccel so the friction loop's dead zone sees the
  // real push. Mirror: bot.ts and BrawlRoom's input step.
  const ice = getSlipperyZone(critter.x, critter.z, critter.config.name);
  const accel = critter.effectiveSpeed * FEEL.movement.accelerationScale * (ice?.accelMult ?? 1);
  critter.moveAccel = Math.hypot(mx, mz) * accel;
  critter.pace = 1;
  critter.vx += mx * accel * dt;
  critter.vz += mz * accel * dt;

  // Headbutt is a held action — the critter state machine handles cooldown
  if (isHeld('headbutt')) {
    critter.startHeadbutt();
  }

  // Abilities
  if (isHeld('ability1') && critter.abilityStates[0]) {
    activateAbility(critter.abilityStates[0], critter);
  }
  if (isHeld('ability2') && critter.abilityStates[1]) {
    activateAbility(critter.abilityStates[1], critter);
  }
  // Ultimate — only critters with a third ability respond. Safe on current
  // roster (placeholders have 2 abilities → abilityStates[2] is undefined).
  // 2026-05-01 final block — Sebastian's L is hold-to-fire: pressing
  // doesn't activate, it starts a charge state with the trajectory
  // preview painted on the ground; releasing fires the dash.
  // `tickSebastianHoldToFire` owns that state machine. Other critters
  // keep the press-to-activate behaviour.
  const lState = critter.abilityStates[2];
  if (lState) {
    const ultDown = isHeld('ultimate');
    if (lState.def.holdToFireL && scene && allCritters) {
      tickSebastianHoldToFire(critter, ultDown, dt, allCritters as Critter[], scene);
    } else if (ultDown) {
      activateAbility(lState, critter);
    }
  }
}
