import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerHitStop, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, FEEL } from './gamefeel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AbilityType = 'charge_rush' | 'ground_pound';

export interface AbilityDef {
  type: AbilityType;
  name: string;
  key: string;
  cooldown: number;
  duration: number;
  windUp: number;
  speedMultiplier: number;
  massMultiplier: number;
  impulse: number;
  slowDuringWindUp: number;
  radius: number;
  force: number;
}

export interface AbilityState {
  def: AbilityDef;
  cooldownLeft: number;
  durationLeft: number;
  windUpLeft: number;
  active: boolean;
  effectFired: boolean;
}

// ---------------------------------------------------------------------------
// Ability definitions — read from centralized FEEL config
// ---------------------------------------------------------------------------

const CHARGE_RUSH: AbilityDef = {
  type: 'charge_rush',
  name: 'Charge Rush',
  key: 'J',
  cooldown: FEEL.chargeRush.cooldown,
  duration: FEEL.chargeRush.duration,
  windUp: FEEL.chargeRush.windUp,
  speedMultiplier: FEEL.chargeRush.speedMultiplier,
  massMultiplier: FEEL.chargeRush.massMultiplier,
  impulse: FEEL.chargeRush.impulse,
  slowDuringWindUp: 1.0,
  radius: 0,
  force: 0,
};

const GROUND_POUND: AbilityDef = {
  type: 'ground_pound',
  name: 'Ground Pound',
  key: 'K',
  cooldown: FEEL.groundPound.cooldown,
  duration: FEEL.groundPound.duration,
  windUp: FEEL.groundPound.windUp,
  speedMultiplier: 1.0,
  massMultiplier: 1.0,
  impulse: 0,
  slowDuringWindUp: FEEL.groundPound.slowDuringWindUp,
  radius: FEEL.groundPound.radius,
  force: FEEL.groundPound.force,
};

export const CRITTER_ABILITIES: Record<string, AbilityDef[]> = {
  Rojo:   [CHARGE_RUSH, GROUND_POUND],
  Azul:   [CHARGE_RUSH, GROUND_POUND],
  Verde:  [CHARGE_RUSH, GROUND_POUND],
  Morado: [CHARGE_RUSH, GROUND_POUND],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function stateFromDef(def: AbilityDef): AbilityState {
  return { def, cooldownLeft: 0, durationLeft: 0, windUpLeft: 0, active: false, effectFired: false };
}

export function createAbilityStates(critterName: string): AbilityState[] {
  const defs = CRITTER_ABILITIES[critterName];
  if (!defs) return [];
  return defs.map(stateFromDef);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function canActivateAbility(state: AbilityState): boolean {
  return state.cooldownLeft <= 0 && !state.active;
}

export function activateAbility(state: AbilityState, critter: Critter): boolean {
  if (!canActivateAbility(state)) return false;
  state.active = true;
  state.effectFired = false;
  state.windUpLeft = state.def.windUp;
  state.durationLeft = state.def.duration;
  if (state.def.windUp <= 0) {
    fireEffect(state, critter, [], null!);
    state.effectFired = true;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Per-type effect helpers
// ---------------------------------------------------------------------------

function fireChargeRush(def: AbilityDef, critter: Critter): void {
  const angle = critter.mesh.rotation.y;
  critter.vx += Math.sin(angle) * def.impulse;
  critter.vz += Math.cos(angle) * def.impulse;
  applyDashFeedback(critter);
}

function fireGroundPound(def: AbilityDef, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  let hitCount = 0;
  for (const other of allCritters) {
    if (other === critter || !other.alive) continue;
    const dx = other.x - critter.x;
    const dz = other.z - critter.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < def.radius && dist > 0.01) {
      const nx = dx / dist;
      const nz = dz / dist;
      const falloff = 1 - dist / def.radius;
      other.vx += nx * def.force * falloff;
      other.vz += nz * def.force * falloff;
      applyImpactFeedback(other);
      hitCount++;
    }
  }
  applyLandingFeedback(critter);
  if (hitCount > 0) {
    triggerHitStop(FEEL.hitStop.groundPound);
  }
  spawnShockwaveRing(scene, critter.x, critter.z, def.radius);
}

const EFFECT_MAP: Record<AbilityType, (def: AbilityDef, critter: Critter, all: Critter[], scene: THREE.Scene) => void> = {
  charge_rush: fireChargeRush,
  ground_pound: fireGroundPound,
};

function fireEffect(state: AbilityState, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  EFFECT_MAP[state.def.type](state.def, critter, allCritters, scene);
}

// ---------------------------------------------------------------------------
// Tick update
// ---------------------------------------------------------------------------

export function updateAbilities(
  states: AbilityState[],
  critter: Critter,
  allCritters: Critter[],
  scene: THREE.Scene,
  dt: number,
): void {
  for (const s of states) {
    if (s.active) {
      if (s.windUpLeft > 0) {
        s.windUpLeft -= dt;
        if (s.windUpLeft <= 0 && !s.effectFired) {
          fireEffect(s, critter, allCritters, scene);
          s.effectFired = true;
        }
        continue;
      }
      s.durationLeft -= dt;
      if (s.durationLeft <= 0) {
        s.active = false;
        s.cooldownLeft = s.def.cooldown;
      }
    } else if (s.cooldownLeft > 0) {
      s.cooldownLeft -= dt;
    }
  }
}

// ---------------------------------------------------------------------------
// Stat multipliers
// ---------------------------------------------------------------------------

export function getSpeedMultiplier(states: AbilityState[]): number {
  let m = 1.0;
  for (const s of states) {
    if (!s.active) continue;
    if (s.windUpLeft > 0) {
      m *= s.def.slowDuringWindUp;
    } else {
      m *= s.def.speedMultiplier;
    }
  }
  return m;
}

export function getMassMultiplier(states: AbilityState[]): number {
  let m = 1.0;
  for (const s of states) {
    if (s.active && s.windUpLeft <= 0) {
      m *= s.def.massMultiplier;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// VFX: shockwave ring
// ---------------------------------------------------------------------------

function spawnShockwaveRing(scene: THREE.Scene, x: number, z: number, maxRadius: number): void {
  const geo = new THREE.TorusGeometry(0.5, 0.12, 8, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.3, z);
  scene.add(ring);

  const duration = 300;
  const start = performance.now();

  function animate() {
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    const scale = 0.5 + t * (maxRadius / 0.5);
    ring.scale.set(scale, scale, 1);
    mat.opacity = 0.8 * (1 - t);
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(ring);
      geo.dispose();
      mat.dispose();
    }
  }
  requestAnimationFrame(animate);
}
