import { Critter } from './critter';
import { activateAbility } from './abilities';
import { FEEL } from './gamefeel';

const keys: Record<string, boolean> = {};
// "Fresh" keys = keys that have been pressed since the last consumeKey call.
// Edge-detected: a held key only produces one entry per physical press.
const freshKeys: Set<string> = new Set();

window.addEventListener('keydown', (e) => {
  if (!e.repeat) {
    freshKeys.add(e.code);
  }
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

export function updatePlayer(critter: Critter, dt: number): void {
  if (!critter.alive) return;

  let mx = 0;
  let mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) mz = -1;
  if (keys['KeyS'] || keys['ArrowDown']) mz = 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx = -1;
  if (keys['KeyD'] || keys['ArrowRight']) mx = 1;

  // Normalize diagonal
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }

  // Reduce steering during Charge Rush (commitment)
  const chargeState = critter.abilityStates[0];
  if (chargeState?.active && chargeState.def.type === 'charge_rush' && chargeState.windUpLeft <= 0) {
    mx *= FEEL.chargeRush.steerFactor;
    mz *= FEEL.chargeRush.steerFactor;
  }

  // Signal whether player is actively steering
  critter.hasInput = len > 0;

  const accel = critter.effectiveSpeed * FEEL.movement.accelerationScale;
  critter.vx += mx * accel * dt;
  critter.vz += mz * accel * dt;

  // Headbutt on Space
  if (keys['Space']) {
    critter.startHeadbutt();
  }

  // Abilities
  if (keys['KeyJ'] && critter.abilityStates[0]) {
    activateAbility(critter.abilityStates[0], critter);
  }
  if (keys['KeyK'] && critter.abilityStates[1]) {
    activateAbility(critter.abilityStates[1], critter);
  }
}

export function isRestartPressed(): boolean {
  return !!keys['KeyR'];
}

/** Edge-detected: returns true exactly once per physical key press. */
export function consumeKey(code: string): boolean {
  if (freshKeys.has(code)) {
    freshKeys.delete(code);
    return true;
  }
  return false;
}

/** Clear all pending fresh-key edges (useful when switching phases). */
export function clearFreshKeys(): void {
  freshKeys.clear();
}
