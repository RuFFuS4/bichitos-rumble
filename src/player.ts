import { Critter } from './critter';
import { activateAbility } from './abilities';
import { FEEL } from './gamefeel';
import { getMoveVector, isHeld } from './input';

/**
 * Player controller — reads device-agnostic input via the input abstraction.
 * Never touches the keyboard directly. When touch input is added, this file
 * needs no changes.
 */
export function updatePlayer(critter: Critter, dt: number): void {
  if (!critter.alive) return;

  const move = getMoveVector();
  let mx = move.x;
  let mz = move.z;

  // Reduce steering during Charge Rush (commitment)
  const chargeState = critter.abilityStates[0];
  if (chargeState?.active && chargeState.def.type === 'charge_rush' && chargeState.windUpLeft <= 0) {
    mx *= FEEL.chargeRush.steerFactor;
    mz *= FEEL.chargeRush.steerFactor;
  }

  // Signal whether player is actively steering (kills drift when idle)
  critter.hasInput = mx !== 0 || mz !== 0;

  const accel = critter.effectiveSpeed * FEEL.movement.accelerationScale;
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
  if (isHeld('ultimate') && critter.abilityStates[2]) {
    activateAbility(critter.abilityStates[2], critter);
  }
}
