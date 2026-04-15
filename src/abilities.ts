import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerHitStop, triggerCameraShake, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, FEEL } from './gamefeel';
import { play as playSound } from './audio';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy';

/**
 * Semantic tags attached to an ability definition. The bot AI (and any
 * future ability-aware consumer) decides what to do with an ability by
 * inspecting these tags, NOT by its index in the slot array.
 *
 * Tags currently understood by bot.ts:
 *   'mobility'  — dash / reposition / close distance
 *   'aoe_push'  — area effect that pushes targets away
 *
 * Add more tags as new ability types are introduced. Keep them plain
 * strings — no class hierarchy, no enum, no registry.
 */
export type AbilityTag =
  | 'mobility'
  | 'aoe_push'
  | 'buff'
  | 'targeted'
  | 'defensive'
  | 'utility'
  | 'risky';

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
  /** Semantic tags. Required — bot AI depends on this to pick abilities. */
  tags: AbilityTag[];
  /** Short one-line description shown in character select info pane. */
  description: string;
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
// Ability factory — base values come from FEEL, overrides per critter
// ---------------------------------------------------------------------------

function makeChargeRush(overrides: Partial<AbilityDef> = {}): AbilityDef {
  return {
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
    tags: ['mobility'],
    description: 'Frontal dash that pushes enemies',
    ...overrides,
  };
}

function makeGroundPound(overrides: Partial<AbilityDef> = {}): AbilityDef {
  return {
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
    tags: ['aoe_push'],
    description: 'Slams ground, knocking back nearby enemies',
    ...overrides,
  };
}

function makeFrenzy(overrides: Partial<AbilityDef> = {}): AbilityDef {
  return {
    type: 'frenzy',
    name: 'Frenzy',
    key: 'L',
    cooldown: FEEL.frenzy.cooldown,
    duration: FEEL.frenzy.duration,
    windUp: FEEL.frenzy.windUp,
    speedMultiplier: FEEL.frenzy.speedMultiplier,
    massMultiplier: FEEL.frenzy.massMultiplier,
    impulse: 0,
    slowDuringWindUp: FEEL.frenzy.slowDuringWindUp,
    radius: 0,
    force: 0,
    tags: ['buff'],
    description: 'Temporary speed and power boost',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-critter ability sets — each critter has unique names + stats
// ---------------------------------------------------------------------------

export const CRITTER_ABILITIES: Record<string, AbilityDef[]> = {
  // Rojo — Balanced Brawler (uses FEEL defaults)
  Rojo: [
    makeChargeRush(),
    makeGroundPound(),
  ],

  // Azul — Fast Skirmisher: hits fast, hits often, smaller payoffs
  // Sprint tuning: impulse 20 → 22 so the dash reads clearly above Rojo's
  Azul: [
    makeChargeRush({
      name: 'Quick Dash',
      impulse: 22,
      duration: 0.25,
      cooldown: 3.0,
      speedMultiplier: 2.7,
      massMultiplier: 1.4,
    }),
    makeGroundPound({
      name: 'Sharp Stomp',
      radius: 2.8,
      force: 20,
      windUp: 0.25,
      cooldown: 4.5,
    }),
  ],

  // Verde — Heavy Crusher: slow but devastating
  // Sprint tuning: Earthquake was OP. Nerfed radius 4.8 → 4.2, force 40 → 34,
  // cooldown 7.5 → 8.5. Still the hardest-hitting AoE, but no longer
  // a "I win" button on small late-game arenas.
  Verde: [
    makeChargeRush({
      name: 'Heavy Charge',
      impulse: 13,
      duration: 0.40,
      cooldown: 5.0,
      speedMultiplier: 2.0,
      massMultiplier: 3.0,
    }),
    makeGroundPound({
      name: 'Earthquake',
      radius: 4.2,
      force: 34,
      windUp: 0.5,
      cooldown: 8.5,
    }),
  ],

  // Morado — Glass Cannon: high risk, high reward
  // Sprint tuning: Blitz cooldown 3.5 → 3.0 so Morado gets its burst more often.
  // Combined with baseline headbutt 11 → 13 on the preset, Morado finally
  // threatens in mid-range even between abilities.
  Morado: [
    makeChargeRush({
      name: 'Blitz',
      impulse: 22,
      duration: 0.28,
      cooldown: 3.0,
      speedMultiplier: 2.8,
      massMultiplier: 1.2,
    }),
    makeGroundPound({
      name: 'Shockwave',
      radius: 3.2,
      force: 34,
      windUp: 0.3,
      cooldown: 6.5,
    }),
  ],

  // Sergei — Balanced (first real roster character, gorilla)
  // Validates 3-ability pipeline: charge_rush + ground_pound + frenzy (ultimate).
  Sergei: [
    makeChargeRush({
      name: 'Gorilla Rush',
      description: 'Heavy palm strike charge',
      impulse: 18,
      duration: 0.32,
      cooldown: 4.5,
      speedMultiplier: 2.4,
      massMultiplier: 2.2,
    }),
    makeGroundPound({
      name: 'Shockwave',
      description: 'Slams ground with both fists',
      radius: 3.2,
      force: 30,
      windUp: 0.35,
      cooldown: 6.5,
    }),
    makeFrenzy({ description: 'Enters berserk mode: +speed, +power' }),
  ],

  // Trunk — elephant Bruiser: slow, heavy, devastating
  // Kit built from base factories with heavy tuning. No ultimate in Bloque B;
  // adding one later is a pure data change.
  Trunk: [
    makeChargeRush({
      name: 'Trunk Ram',
      description: 'Unstoppable forward dash with tusks',
      impulse: 14,
      duration: 0.40,
      cooldown: 5.0,
      speedMultiplier: 2.0,
      massMultiplier: 3.0,
    }),
    makeGroundPound({
      name: 'Earthquake',
      description: 'Foot stomp that shakes the arena',
      radius: 4.2,
      force: 34,
      windUp: 0.5,
      cooldown: 8.5,
    }),
  ],
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

/**
 * Find the first ability state whose definition carries the given tag,
 * or null if none matches. Callers that want to decide by semantic tag
 * (bot AI, future tooltips) should use this instead of indexing into
 * the ability states array directly.
 */
export function findAbilityByTag(
  states: AbilityState[],
  tag: AbilityTag,
): AbilityState | null {
  for (const s of states) {
    if (s.def.tags.includes(tag)) return s;
  }
  return null;
}

export function activateAbility(state: AbilityState, _critter: Critter): boolean {
  if (!canActivateAbility(state)) return false;
  state.active = true;
  state.effectFired = false;
  state.windUpLeft = state.def.windUp;
  state.durationLeft = state.def.duration;
  // Effect is fired from updateAbilities, which always has access to scene.
  // This avoids needing a null-scene placeholder and keeps the firing path unified.
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
  playSound('abilityFire');
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
  // Always shake on ground pound (the slam itself is dramatic)
  triggerCameraShake(FEEL.shake.groundPound);
  if (hitCount > 0) {
    triggerHitStop(FEEL.hitStop.groundPound);
  }
  spawnShockwaveRing(scene, critter.x, critter.z, def.radius);
  playSound('groundPound');
}

function fireFrenzy(_def: AbilityDef, _critter: Critter): void {
  // Frenzy is a pure buff — no positional effect. The speed/mass multipliers
  // are applied automatically by getSpeedMultiplier/getMassMultiplier while
  // the ability state is active. The visual glow is handled in critter.ts.
  playSound('abilityFire');
}

const EFFECT_MAP: Record<AbilityType, (def: AbilityDef, critter: Critter, all: Critter[], scene: THREE.Scene) => void> = {
  charge_rush: fireChargeRush,
  ground_pound: fireGroundPound,
  frenzy: fireFrenzy,
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
      // Wind-up phase (visible charge-up before the effect fires)
      if (s.windUpLeft > 0) {
        s.windUpLeft -= dt;
        if (s.windUpLeft <= 0 && !s.effectFired) {
          fireEffect(s, critter, allCritters, scene);
          s.effectFired = true;
        }
        continue;
      }
      // No wind-up, or wind-up finished — fire effect once if not already fired
      if (!s.effectFired) {
        fireEffect(s, critter, allCritters, scene);
        s.effectFired = true;
      }
      // Drain active duration
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

/**
 * Spawn a dramatic shockwave at (x, z). Two concentric rings:
 *  - inner white flash that expands fast and fades quickly
 *  - outer red torus that expands to maxRadius with a thicker tube
 */
export function spawnShockwaveRing(scene: THREE.Scene, x: number, z: number, maxRadius: number): void {
  const duration = 450; // ms
  const startTime = performance.now();

  // Outer red torus (the "slam" ring)
  const outerGeo = new THREE.TorusGeometry(0.3, 0.28, 10, 40);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff3322,
    transparent: true,
    opacity: 0.9,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = Math.PI / 2;
  outer.position.set(x, 0.35, z);
  scene.add(outer);

  // Inner white flash (fades faster than the outer ring)
  const innerGeo = new THREE.TorusGeometry(0.3, 0.18, 10, 40);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = Math.PI / 2;
  inner.position.set(x, 0.5, z);
  scene.add(inner);

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Outer: grows to maxRadius + 10% overshoot, eased out
    const outerEase = 1 - Math.pow(1 - t, 2);
    const outerScale = (0.3 + outerEase * (maxRadius * 1.1 / 0.3));
    outer.scale.set(outerScale, outerScale, 1);
    outerMat.opacity = 0.9 * (1 - t);

    // Inner: grows faster, fades in half the time
    const innerT = Math.min(t * 2, 1);
    const innerScale = (0.3 + innerT * (maxRadius * 0.7 / 0.3));
    inner.scale.set(innerScale, innerScale, 1);
    innerMat.opacity = 1.0 * (1 - innerT);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(outer);
      scene.remove(inner);
      outerGeo.dispose();
      outerMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
    }
  }
  requestAnimationFrame(animate);
}
