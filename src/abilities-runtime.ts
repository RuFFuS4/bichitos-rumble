// ---------------------------------------------------------------------------
// abilities-runtime.ts — RUNTIME (gameplay) layer of the abilities system.
// 2026-08-24 ROADMAP H4 split: "Split de abilities.ts (config/runtime/vfx)".
//
// Pure gameplay: ability state creation/activation, per-type effect
// dispatch (fire*), the offline slow-zone manager + per-tick L mechanics,
// stat multipliers and the Sebastian hold-to-fire state machine. Keeps
// the gameplay/visual separation mandated by CLAUDE.md — visual-only
// spawners live in ./abilities-vfx.ts and are CALLED from here at the
// existing integration points (fire effects, zone spawns).
//
// Import rule (no cycles): may import from ./abilities (config) and
// ./abilities-vfx (visuals). Neither of those imports back from here.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerHitStop, triggerCameraShake, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { spawnDustPuff } from './dust-puff';
import { spawnLocalProjectile } from './projectiles';
import {
  CRITTER_ABILITIES,
  CRITTER_VFX_PALETTE,
  type AbilityDef,
  type AbilityState,
  type AbilityTag,
  type AbilityType,
  type ZoneVfxKind,
} from './abilities';
import {
  spawnShockwaveRing,
  spawnZoneRing,
  spawnFrenzyBurst,
  spawnDecoyAt,
  spawnAllInTrajectoryPreview,
} from './abilities-vfx';

// 2026-04-30 final-polish — Sihans Sinkhole opens a real arena hole.
// We need access to the live Arena (to query + kill fragments under
// the hole disc) without making this module depend on `./arena`
// directly (which imports DECOR_TYPES → THREE → cycles). Boot wires
// the arena via `setArenaForAbilities` from main.ts so the gameplay
// path can call `arena.killFragmentIndices(...)` without a static
// circular import.
interface ArenaForAbilities {
  getAliveFragmentsInDisc(cx: number, cz: number, r: number): number[];
  killFragmentIndices(indices: number[]): void;
}
let _arenaRef: ArenaForAbilities | null = null;
export function setArenaForAbilities(a: ArenaForAbilities | null): void {
  _arenaRef = a;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function stateFromDef(def: AbilityDef): AbilityState {
  return {
    def,
    cooldownLeft: 0,
    durationLeft: 0,
    windUpLeft: 0,
    active: false,
    effectFired: false,
    trailTimer: 0,
  };
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
  state.trailTimer = 0;
  // Effect is fired from updateAbilities, which always has access to scene.
  // This avoids needing a null-scene placeholder and keeps the firing path unified.
  return true;
}

// ---------------------------------------------------------------------------
// Per-type effect helpers
// ---------------------------------------------------------------------------

/** Seconds between consecutive dust-puffs in a charge_rush trail.
 *  ~50 ms feels punchy without flooding the pool — most dashes last
 *  0.25–0.45s so a typical dash leaves 5-9 puffs behind. */
const DASH_TRAIL_INTERVAL = 0.05;

/** World-units the trail spawn point is shifted backward from the
 *  critter centre along the velocity vector. Keeps the streak visibly
 *  BEHIND the bichito instead of under its feet — reads as direction
 *  of travel at a glance. Tuned so the offset doesn't push the puff
 *  into the previous puff (each puff is ~0.55u radius pre-scale). */
const DASH_TRAIL_OFFSET = 0.5;

/** Fraction of the critter's velocity magnitude that each trail puff
 *  inherits as backward drift. 0.20 → puff slides backward at a fifth
 *  of the dash speed; combined with the puff's own scale-up + fade
 *  this produces the "motion streak" look without making puffs fly
 *  too far off the dash line. */
const DASH_TRAIL_DRIFT_FRACTION = 0.20;

/** Initial entry burst radius for the dash. Smaller than ground-pound's
 *  shockwave so the dash reads as "explosive launch" not "AoE attack". */
const DASH_ENTRY_BURST_RADIUS = 1.4;

function fireChargeRush(def: AbilityDef, critter: Critter, _all: Critter[], scene: THREE.Scene): void {
  const angle = critter.mesh.rotation.y;
  critter.vx += Math.sin(angle) * def.impulse;
  critter.vz += Math.cos(angle) * def.impulse;
  applyDashFeedback(critter);
  // Entry burst — a small shockwave-style ring at the launch point so
  // the dash starts with a visible "explosive go" beat. Stays at
  // default colours: critter identity already reads through the
  // dust-puff trail + skeletal animation, an extra tint on the dash
  // entry would compete with the ground-pound colour signature.
  spawnShockwaveRing(scene, critter.x, critter.z, DASH_ENTRY_BURST_RADIUS);
  playSound('abilityFire');
}

function fireGroundPound(def: AbilityDef, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  // v0.11 — self-buff K (Shelly Steel Shell, Kurama Mirror Trick).
  // The K skips the outward knockback and instead grants immunity +
  // an optional invisibility/visual flag on the caster. The cooldown
  // and rooted-during-active behaviour come from the existing
  // ROOTED_K spread.
  if (def.selfBuffOnly) {
    const dur = def.selfImmunityDuration ?? 0;
    const invisDur = def.invisibilityDuration ?? 0;
    const total = Math.max(dur, invisDur);
    if (total > 0) {
      // Extend the existing immunity window so the caster can't be
      // pushed during the buff. Bumping critter.immunityTimer is the
      // simplest path — the immunity blink renderer already handles
      // the visual feedback for the duration.
      critter.immunityTimer = Math.max(critter.immunityTimer, total);
    }
    if (invisDur > 0) {
      // 2026-04-29 final-K (Rafa: "lógica al revés — primero decoy
      // en posición original, después mover Kurama HACIA ATRÁS").
      // Order is now:
      //   1. snapshot original position
      //   2. spawn the decoy at that original spot (BEFORE moving)
      //   3. move Kurama backward (opposite of her facing) by
      //      `decoyEscapeDistance`, clamped to arena
      //   4. ghost her mesh + dust burst at the arrival point
      const originX = critter.x;
      const originZ = critter.z;
      // 1+2 — decoy first.
      spawnDecoyAt(scene, critter, invisDur);
      const escDist = def.decoyEscapeDistance ?? 0;
      if (escDist > 0) {
        // 3 — retreat backward from current facing. Kurama
        // mesh rotation.y points where she's facing forward;
        // backward is +PI from that direction.
        const backAngle = critter.mesh.rotation.y + Math.PI;
        let nx = originX + Math.sin(backAngle) * escDist;
        let nz = originZ + Math.cos(backAngle) * escDist;
        const r = Math.sqrt(nx * nx + nz * nz);
        if (r > ARENA_BLINK_RADIUS) {
          nx = (nx / r) * ARENA_BLINK_RADIUS;
          nz = (nz / r) * ARENA_BLINK_RADIUS;
        }
        critter.x = nx;
        critter.z = nz;
        critter.mesh.position.x = nx;
        critter.mesh.position.z = nz;
        critter.vx = 0;
        critter.vz = 0;
        // 4 — dust at arrival so the reappearance reads even at
        // alpha 0.25.
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          spawnDustPuff(scene, nx + Math.cos(a) * 0.4, 0, nz + Math.sin(a) * 0.4);
        }
      }
      // Ghost Kurama AFTER the move so the alpha layer applies to
      // the new position, not the origin (decoy stays opaque-ish
      // because the clone owns its own materials).
      critter.invisibilityTimer = invisDur;
    }
    if (def.selfTintHex !== undefined) {
      critter.selfTintHex = def.selfTintHex;
      critter.selfTintTimer = total;
    }
    // Soft burst at the caster's feet so the activation reads, but
    // no force is applied to anyone.
    const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
    spawnShockwaveRing(scene, critter.x, critter.z, 1.6, palette);
    triggerCameraShake(FEEL.shake.groundPound * 0.4);
    playSound('abilityFire');
    return;
  }
  // 2026-04-29 final-K — Trunk Grip K branch. When `gripK` is set
  // we ignore the radial path entirely: pick a single frontal
  // target, pull them to `gripPullDistance` u in front of Trunk,
  // and write `target.stunTimer`. Pure offline path; the online
  // server runs the same logic in `fireGroundPound`.
  if (def.gripK) {
    const range = def.gripFrontalRange ?? 6.0;
    const halfCone = ((def.gripFrontalAngleDeg ?? 50) * Math.PI) / 180;
    const facingX = Math.sin(critter.mesh.rotation.y);
    const facingZ = Math.cos(critter.mesh.rotation.y);
    let target: Critter | null = null;
    let bestScore = Infinity;
    for (const other of allCritters) {
      if (other === critter || !other.alive || other.falling) continue;
      const dx = other.x - critter.x;
      const dz = other.z - critter.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > range || d < 0.01) continue;
      const nx = dx / d;
      const nz = dz / d;
      const dot = nx * facingX + nz * facingZ;
      if (dot < Math.cos(halfCone)) continue;
      // Score by distance (closest wins).
      if (d < bestScore) { bestScore = d; target = other; }
    }
    const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.groundPound * (def.shakeBoost ?? 1.0));
    playSound('groundPound');
    if (target) {
      const pull = def.gripPullDistance ?? 1.6;
      const tx = critter.x + facingX * pull;
      const tz = critter.z + facingZ * pull;
      // Snap target to the pull point (yank reads as "trunk pulled
      // them in" not "they slid"). Zero their velocity.
      target.x = tx;
      target.z = tz;
      target.mesh.position.x = tx;
      target.mesh.position.z = tz;
      target.vx = 0;
      target.vz = 0;
      target.stunTimer = def.gripStunDuration ?? 2.0;
      // Burst at the target so the yank reads.
      spawnShockwaveRing(scene, tx, tz, 1.0, palette);
      applyImpactFeedback(target);
      triggerHitStop(FEEL.hitStop.groundPound);
    }
    return;
  }
  let hitCount = 0;
  // v0.11 — Sebastian Claw Wave: when `def.coneAngleDeg` is set, the
  // slam only pushes enemies whose direction from the caster falls
  // within ±coneAngleDeg of the caster's facing. Reads as a frontal
  // sweep instead of a radial slam. coneCos saves a per-target
  // acos: dot(dir, facing) ≥ cos(angle) iff the angle is within
  // the cone.
  const coneCos = def.coneAngleDeg !== undefined ? Math.cos((def.coneAngleDeg * Math.PI) / 180) : null;
  const facingX = Math.sin(critter.mesh.rotation.y);
  const facingZ = Math.cos(critter.mesh.rotation.y);
  for (const other of allCritters) {
    if (other === critter || !other.alive) continue;
    const dx = other.x - critter.x;
    const dz = other.z - critter.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < def.radius && dist > 0.01) {
      const nx = dx / dist;
      const nz = dz / dist;
      // Cone gate (only when configured) — direction.target dot facing.
      if (coneCos !== null) {
        const dotFacing = nx * facingX + nz * facingZ;
        if (dotFacing < coneCos) continue;
      }
      const falloff = 1 - dist / def.radius;
      other.vx += nx * def.force * falloff;
      other.vz += nz * def.force * falloff;
      applyImpactFeedback(other);
      // 2026-05-01 final — Trunk Slam K applies a brief stun on
      // every critter inside the AoE via `slamStunDuration`.
      // Stuns from this source compose with the global ×4
      // vulnerable rule in physics — Slam alone reads as a heavy
      // thump, Slam → headbutt deletes the target.
      if (def.slamStunDuration && def.slamStunDuration > 0 && !other.isImmune) {
        other.stunTimer = Math.max(other.stunTimer, def.slamStunDuration);
      }
      hitCount++;
    }
  }
  applyLandingFeedback(critter);
  // Always shake on ground pound (the slam itself is dramatic).
  // v0.11: per-K `shakeBoost` (e.g. Trunk Earthquake 1.4×) scales
  // the shake amplitude so the visual matches the bumped force.
  triggerCameraShake(FEEL.shake.groundPound * (def.shakeBoost ?? 1.0));
  if (hitCount > 0) {
    triggerHitStop(FEEL.hitStop.groundPound);
  }
  // 2026-04-29 K-refinement — Sebastian Claw Wave frontal VFX.
  // When `coneAngleDeg` is set the slam is a frontal cone, so the
  // 360° shockwave ring reads wrong ("dice frontal pero veo 360°").
  // Replaced with: a row of dust-puffs sweeping forward in a fan
  // shape across the cone. The puffs are radial-only (no facing)
  // but their POSITIONS draw a fan in front of the caster, which
  // is enough to communicate "wave goes forward, not all around".
  if (coneCos !== null) {
    const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
    // Tinted half-radius ring at the caster's feet so the activation
    // is still readable, kept smaller than `def.radius` so it
    // doesn't compete with the fan. Uses palette so identity reads.
    spawnShockwaveRing(scene, critter.x, critter.z, def.radius * 0.45, palette);
    // Forward fan of puffs — sweep from -coneAngleDeg to +coneAngleDeg
    // along the facing, distance from 0.6 u to def.radius.
    const baseAngle = critter.mesh.rotation.y;
    const halfCone = (def.coneAngleDeg! * Math.PI) / 180;
    const FAN_PUFFS = 9;
    for (let i = 0; i < FAN_PUFFS; i++) {
      const t = i / (FAN_PUFFS - 1);
      const angle = baseAngle - halfCone + t * halfCone * 2;
      // Distance varies with i so the fan reads as a sweep, not a row.
      const radial = 0.8 + (1 - Math.abs(t - 0.5) * 1.4) * (def.radius * 0.85);
      const px = critter.x + Math.sin(angle) * radial;
      const pz = critter.z + Math.cos(angle) * radial;
      spawnDustPuff(scene, px, 0, pz);
    }
  } else {
    // Per-critter tint: each shockwave reads as the critter's element
    // (Trunk earth, Kurama violet illusion, Kowalski ice, etc.). When
    // no entry exists for the critter, `spawnShockwaveRing` falls back
    // to its original red palette.
    spawnShockwaveRing(scene, critter.x, critter.z, def.radius, CRITTER_VFX_PALETTE[critter.config.name]?.pound);
  }
  playSound('groundPound');
  // Lingering zone (Kermit Poison Cloud, Kowalski Arctic Burst, …) —
  // pushes a slow-zone entry into the offline tracker and renders a
  // persistent ground ring so the area-debuff reads visually for the
  // full lifetime. Server-side mirror is in BrawlRoom; this branch
  // covers offline matches.
  if (def.zone) {
    const kind = deriveZoneVfxKind(critter.config.name);
    activeZones.push({
      x: critter.x, z: critter.z,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
      vfxKind: kind,
      ownerKey: critter.config.name,
    });
    spawnZoneRing(scene, critter.x, critter.z, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary, kind);
  }
}

// ---------------------------------------------------------------------------
// Slow-zone manager (offline) + arena clamp helper
// ---------------------------------------------------------------------------
//
// Mirror of the server-side slow-zone tracker so offline matches feel
// identical to online ones. A zone is a circle on the arena floor that
// debuffs movement speed while a critter stands inside it. Shared module-
// scope state because there are typically <= 4 zones alive at any moment
// (one per K cooldown, decaying for ~2 s) — no need for per-Game state.
//
// Online matches don't push to this list (they consume the server's
// `zoneSpawned` events and apply the slow via the same lookup path);
// `clearActiveZones()` is called on phase transitions so zones from a
// previous match never leak into the next one.


interface ActiveZone {
  x: number;
  z: number;
  radius: number;
  slowMultiplier: number;
  ttl: number;
  vfxKind?: ZoneVfxKind;
  /** Identifier of the caster — used so the owner of the zone is
   *  immune to its slow effect. Offline path stores the critter
   *  name; online path stores the session id. Either matches the
   *  same field passed to `getZoneSlowMultiplier`. */
  ownerKey?: string;
  /** 2026-04-30 final-L — Kowalski Frozen Floor flag. Read by
   *  Critter friction loop to multiply the half-life when this
   *  critter stands inside a slippery zone they don't own. */
  slippery?: boolean;
  /** 2026-04-30 final-L — Sihans Sinkhole flag. Per-frame pull
   *  toward the centre is applied in `tickAbilityZones`. */
  sinkhole?: boolean;
  pullForce?: number;
}

const activeZones: ActiveZone[] = [];

/** Map a critter name to the zone visual kind they spawn. Centralised
 *  so offline (`fireGroundPound`/`fireBlink`) and online
 *  (`pushNetworkZone` from server `zoneSpawned`) classify the same
 *  way. New K zones with their own visual layer get a new branch
 *  here + a new screen-space hook on the consumer side. */
export function deriveZoneVfxKind(critterName: string): ZoneVfxKind {
  if (critterName === 'Kermit') return 'poison';
  if (critterName === 'Sihans') return 'sand';
  if (critterName === 'Kowalski') return 'ice';
  return 'generic';
}

/**
 * 2026-04-30 final-L — per-tick L mechanics for offline matches.
 * Mirrors the server `simulatePlaying` step 2.e+2.f+2.g for the
 * Cone Pulse / Saw / Toxic / Sinkhole pull paths. Called from
 * main.ts gameplay loop with the active critter list each frame.
 *
 * The All-in resolution edge-case is handled in `updateAbilities`
 * via `lastAbilityActive` falling-edge detection.
 */
interface ConePulseState { acc: number; count: number; lastActive: boolean; }
const _pulseStates = new WeakMap<Critter, ConePulseState>();
export function tickLOffline(dt: number, critters: Critter[], scene?: THREE.Scene): void {
  for (const c of critters) {
    if (!c.alive || c.falling) continue;
    const lState = c.abilityStates[2];

    // 2026-05-01 microfix — Cone Pulse must update its rising-edge
    // detector even when the L isn't post-windup yet, so the count
    // resets cleanly each activation (the pre-fix WeakMap of just
    // `acc` carried stale state across activations and never reset
    // the per-pulse counter — first pulse pushed, the rest landed
    // outside the cone radius the target escaped to).
    if (lState?.def?.conePulseL) {
      const isActive = !!lState.active && lState.windUpLeft <= 0;
      let state = _pulseStates.get(c);
      if (!state) state = { acc: 0, count: 0, lastActive: false };
      if (isActive && !state.lastActive) {
        state.acc = 0;
        state.count = 0;
      }
      state.lastActive = isActive;
      if (isActive) {
        state.acc += dt;
        const def = lState.def;
        const interval = def.pulseInterval ?? 0.30;
        const halfCone = ((def.pulseAngleDeg ?? 45) * Math.PI) / 180;
        const cosCone = Math.cos(halfCone);
        const baseForce = def.pulseForce ?? 28;
        const facingX = Math.sin(c.mesh.rotation.y);
        const facingZ = Math.cos(c.mesh.rotation.y);
        while (state.acc >= interval) {
          state.acc -= interval;
          state.count++;
          // 2026-05-01 final block (Rafa: "semicírculo / cono frontal,
          // empuje expandiéndose hacia delante en cada pulso").
          //
          // Each pulse is a WAVE rolling forward through the cone:
          // pulse N's hit band sits between (N × step − thickness/2)
          // and (N × step + thickness/2) along the cone's depth.
          // Force pushes targets along Cheeto's FACING (not radial)
          // so the read is "rugido empuja hacia delante", and the
          // doubling ramp from the prior pass stays.
          const ramp = Math.min(Math.pow(2, state.count - 1), 8);
          const effectiveForce = baseForce * ramp;
          const waveStep = 1.4;
          const waveThickness = 2.0;
          const waveCenter = state.count * waveStep;
          const waveMin = Math.max(0.3, waveCenter - waveThickness * 0.5);
          const waveMax = waveCenter + waveThickness * 0.5;
          for (const other of critters) {
            if (other === c || !other.alive || other.falling) continue;
            if (other.isImmune) continue;
            const dx = other.x - c.x;
            const dz = other.z - c.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < waveMin || d > waveMax || d < 0.01) continue;
            const nx = dx / d;
            const nz = dz / d;
            if (nx * facingX + nz * facingZ < cosCone) continue;
            // Falloff peaks at the wave's centre, drops to 0 at the
            // band edges. Push direction is Cheeto's facing, not
            // radial — the wave sweeps targets FORWARD.
            const fall = 1 - Math.abs(d - waveCenter) / (waveThickness * 0.5);
            other.vx += facingX * effectiveForce * fall;
            other.vz += facingZ * effectiveForce * fall;
          }
          // VFX: arc of dust puffs at the wave's leading edge,
          // spanning the cone's full angular width, plus a small
          // forward-shifted ring for accent.
          if (scene) {
            const palette = CRITTER_VFX_PALETTE[c.config.name]?.pound ?? { color: 0xff5522, secondary: 0xffe066 };
            const baseAngle = Math.atan2(facingX, facingZ);
            const N_PUFFS = 5;
            for (let i = 0; i < N_PUFFS; i++) {
              const t = i / (N_PUFFS - 1);
              const a = baseAngle - halfCone + t * 2 * halfCone;
              spawnDustPuff(scene, c.x + Math.sin(a) * waveCenter, 0, c.z + Math.cos(a) * waveCenter);
            }
            const ringX = c.x + facingX * waveCenter;
            const ringZ = c.z + facingZ * waveCenter;
            spawnShockwaveRing(scene, ringX, ringZ, waveThickness * 0.7, { ...palette, holdMs: 280 });
          }
          triggerCameraShake(FEEL.shake.groundPound * (0.25 + state.count * 0.06));
          playSound('abilityFire');
        }
      }
      _pulseStates.set(c, state);
    }

    if (!lState?.active || lState.windUpLeft > 0) continue;
    const def = lState.def;

    if (def.rammingL) {
      // 2026-05-01 — Trunk Stampede ramming. Same shape as sawL but
      // with a different impulse magnitude. Reach is critter contact
      // radius + a small margin so the ram "catches" critters on
      // approach rather than only on perfect overlap.
      const reach = c.radius + 0.55 + 0.10;
      const impulse = def.ramContactImpulse ?? 50;
      for (const other of critters) {
        if (other === c || !other.alive || other.falling) continue;
        if (other.isImmune) continue;
        const dx = other.x - c.x;
        const dz = other.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > reach * reach || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        other.vx += (dx / d) * impulse;
        other.vz += (dz / d) * impulse;
      }
    }

    if (def.sawL) {
      const reach = c.radius + 0.55 + 0.10;
      const impulse = def.sawContactImpulse ?? 32;
      for (const other of critters) {
        if (other === c || !other.alive || other.falling) continue;
        if (other.isImmune) continue;
        const dx = other.x - c.x;
        const dz = other.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > reach * reach || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        other.vx += (dx / d) * impulse;
        other.vz += (dz / d) * impulse;
      }
    }

    if (def.toxicTouchL) {
      const reach = c.radius + 0.55 + 0.10;
      const dur = def.confusedDuration ?? 3.0;
      for (const other of critters) {
        if (other === c || !other.alive || other.falling) continue;
        if (other.isImmune) continue;
        const dx = other.x - c.x;
        const dz = other.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > reach * reach || d2 < 0.0001) continue;
        other.confusedTimer = Math.max(other.confusedTimer, dur);
      }
    }
  }

  // Sinkhole pull — affects every critter inside any sinkhole zone
  // they don't own.
  for (const c of critters) {
    if (!c.alive || c.falling) continue;
    forEachSinkhole((zone) => {
      const dx = zone.x - c.x;
      const dz = zone.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > zone.radius || d < 0.01) return;
      const fall = 1 - d / zone.radius;
      c.vx += (dx / d) * zone.pullForce * fall * dt;
      c.vz += (dz / d) * zone.pullForce * fall * dt;
    }, c.config.name);
  }
}

/** Tick all live zones forward, removing expired entries. Called from
 *  the offline gameplay loop after physics update. */
export function tickAbilityZones(dt: number): void {
  for (let i = activeZones.length - 1; i >= 0; i--) {
    activeZones[i].ttl -= dt;
    if (activeZones[i].ttl <= 0) activeZones.splice(i, 1);
  }
}

/** Drop ALL active zones — used on match restart / title return so a
 *  late-spawned slow doesn't survive into the next match. */
export function clearActiveZones(): void {
  activeZones.length = 0;
}

/** Register a zone from the network (online client) so the same slow
 *  lookup path serves both modes. */
export function pushNetworkZone(z: ActiveZone): void {
  activeZones.push({ ...z });
}

/** True if the given critter is currently standing inside a
 *  slippery zone (Kowalski Frozen Floor) they don't own. */
export function isOnSlipperyZone(x: number, z: number, ownerKey?: string): boolean {
  for (const zone of activeZones) {
    if (!zone.slippery) continue;
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) return true;
  }
  return false;
}

/** Iterate over every active sinkhole zone that the given owner
 *  doesn't own. Lets the caller apply the inward pull force per
 *  tick on each affected critter. */
export function forEachSinkhole(cb: (zone: { x: number; z: number; radius: number; pullForce: number }) => void, ownerKey?: string): void {
  for (const zone of activeZones) {
    if (!zone.sinkhole) continue;
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
    cb({ x: zone.x, z: zone.z, radius: zone.radius, pullForce: zone.pullForce ?? 14 });
  }
}

/** True if the given world point is inside any active zone of the
 *  given vfxKind. Used by game.ts each frame to drive the local
 *  Kermit Poison Cloud screen-space overlay (`vfxKind: 'poison'`).
 *  Cheap O(zones) — typically <= 4 zones alive at once. */
export function isInsideZoneOfKind(x: number, z: number, kind: ZoneVfxKind): boolean {
  for (const zone of activeZones) {
    if (zone.vfxKind !== kind) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) return true;
  }
  return false;
}

/** Compound slow multiplier from every active zone the point is inside.
 *  Returns 1.0 when not inside any zone. Multiplicative when overlapping.
 *  `ownerKey`: pass the critter's session-id (online) or name (offline)
 *  to skip zones owned by self — used so Kermit isn't slowed by his own
 *  Poison Cloud, Sihans isn't trapped by her own Quicksand, etc. */
export function getZoneSlowMultiplier(x: number, z: number, ownerKey?: string): number {
  let m = 1.0;
  for (const zone of activeZones) {
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) {
      m *= zone.slowMultiplier;
    }
  }
  return m;
}

/** Arena radius — kept in sync with `Arena.radius` (12 u). The 0.4 u
 *  margin keeps blink targets clear of the platform edge so the
 *  destination never lands on a fragment that's about to collapse. */
const ARENA_BLINK_RADIUS = 11.6;

function fireBlink(def: AbilityDef, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  const angle = critter.mesh.rotation.y;
  // Capture origin for VFX + optional zone-at-origin (Sihans Burrow).
  const originX = critter.x;
  const originZ = critter.z;
  let targetX: number;
  let targetZ: number;

  // 2026-04-29 K-refinement — Cheeto Shadow Step seek-nearest.
  // Replica de la lógica server. Find closest alive enemy within
  // `blinkSeekRange` and land `blinkSeekOffset` short on the caster
  // → target line. Falls back to facing-blink if no target in range.
  let seekHit: Critter | null = null;
  if (def.blinkSeekNearest) {
    const range = def.blinkSeekRange ?? 9.0;
    let bestDist = range;
    for (const other of allCritters) {
      if (other === critter || !other.alive) continue;
      if (other.falling || other.isImmune) continue;
      const dx = other.x - critter.x;
      const dz = other.z - critter.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist && d > 0.01) {
        bestDist = d;
        seekHit = other;
      }
    }
  }

  if (seekHit) {
    const dx = seekHit.x - critter.x;
    const dz = seekHit.z - critter.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const offset = def.blinkSeekOffset ?? 1.4;
    targetX = seekHit.x - (dx / d) * offset;
    targetZ = seekHit.z - (dz / d) * offset;
    critter.mesh.rotation.y = Math.atan2(dx, dz);
  } else {
    const dist = def.blinkDistance ?? 4.0;
    targetX = critter.x + Math.sin(angle) * dist;
    targetZ = critter.z + Math.cos(angle) * dist;
  }
  // Clamp to arena disc — never land outside or in the void band.
  const r = Math.sqrt(targetX * targetX + targetZ * targetZ);
  if (r > ARENA_BLINK_RADIUS) {
    targetX = (targetX / r) * ARENA_BLINK_RADIUS;
    targetZ = (targetZ / r) * ARENA_BLINK_RADIUS;
  }
  const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
  spawnShockwaveRing(scene, originX, originZ, 1.2, palette);
  // Teleport
  critter.x = targetX;
  critter.z = targetZ;
  critter.mesh.position.x = targetX;
  critter.mesh.position.z = targetZ;
  critter.vx = 0;
  critter.vz = 0;
  spawnShockwaveRing(scene, targetX, targetZ, 1.4, palette);
  // v0.11 — Cheeto Shadow Step impact: radial knockback at the
  // destination so reappearing next to an enemy reads as
  // offensive, not just a dodge. The caster is excluded from the
  // push (he's the one teleporting in).
  if (def.blinkImpactRadius && def.blinkImpactForce) {
    for (const other of allCritters) {
      if (other === critter || !other.alive) continue;
      const dx = other.x - targetX;
      const dz = other.z - targetZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < def.blinkImpactRadius && d > 0.01) {
        const fall = 1 - d / def.blinkImpactRadius;
        const f = def.blinkImpactForce * fall;
        other.vx += (dx / d) * f;
        other.vz += (dz / d) * f;
        applyImpactFeedback(other);
      }
    }
    triggerCameraShake(FEEL.shake.headbutt * 0.7);
  }
  // v0.11 — zone-at-origin (Sihans Burrow): drop the slow zone
  // where the critter STARTED, not where they appear. Reads as
  // "se hundió aquí, salió allá, y dejó arenas movedizas atrás".
  if (def.zone) {
    const zx = def.zoneAtOrigin ? originX : targetX;
    const zz = def.zoneAtOrigin ? originZ : targetZ;
    const kind = deriveZoneVfxKind(critter.config.name);
    activeZones.push({
      x: zx, z: zz,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
      vfxKind: kind,
      ownerKey: critter.config.name,
    });
    spawnZoneRing(scene, zx, zz, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary, kind);
  }
  // 2026-04-29 K-session — Burrow visual (Sihans). When the blink
  // is configured with `zoneAtOrigin: true` we treat it as the
  // Burrow Rush K (only Sihans uses that flag) and:
  //   · ghost the critter for 0.30 s (handled in critter.updateVisuals,
  //     where Sihans' invisibilityTimer collapses opacity to 0 instead
  //     of the 0.25 ghost used by Kurama Mirror Trick),
  //   · spawn an extra ring of dust-puffs at both origin and
  //     destination so the read is "tierra explota, desaparece,
  //     reaparece en una nube de arena".
  // The blink itself is unchanged — gameplay-wise Sihans still
  // teleports instantly. The visual layer just sells the burrow.
  if (def.zoneAtOrigin) {
    critter.invisibilityTimer = Math.max(critter.invisibilityTimer, 0.30);
    // Origin dust burst (8 puffs in a ring around the leave point)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spawnDustPuff(scene, originX + Math.cos(a) * 0.5, 0, originZ + Math.sin(a) * 0.5);
    }
    // Destination dust burst (8 puffs as he resurfaces)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      spawnDustPuff(scene, targetX + Math.cos(a) * 0.5, 0, targetZ + Math.sin(a) * 0.5);
    }
  }
  applyDashFeedback(critter);
  playSound('abilityFire');
}

function fireFrenzy(def: AbilityDef, critter: Critter, _all: Critter[], scene: THREE.Scene): void {
  // Frenzy is a pure buff — no positional effect on other critters. The
  // speed/mass multipliers are applied automatically by
  // getSpeedMultiplier/getMassMultiplier while the ability state is
  // active; the pulsing emissive glow is handled in critter.ts.
  //
  // What we DO add here: a one-shot "entry" burst so the activation
  // moment reads clearly. Without it the buff starts silently and the
  // player only realises after observing themselves move faster.
  // Per-critter palette tints the burst so the ultimate fanfare feels
  // owned by each character (orange tiger rage, ice blizzard, etc.).
  spawnFrenzyBurst(scene, critter.x, critter.z, CRITTER_VFX_PALETTE[critter.config.name]?.frenzy);
  triggerCameraShake(FEEL.shake.groundPound * 0.55);
  playSound('abilityFire');

  // 2026-04-30 final-L — Copycat dispatch (Kurama). Look up
  // the lastHitTargetCritter and copy that critter's L FLAGS
  // into Kurama's def in place. Subsequent flag branches run
  // exactly like the original critter's L.
  if (def.copycatL) {
    const targetName = critter.lastHitTargetCritter;
    if (targetName) {
      const targetDef = CRITTER_ABILITIES[targetName]?.[2];
      if (targetDef) {
        Object.assign(def, {
          sawL: targetDef.sawL,
          sawContactImpulse: targetDef.sawContactImpulse,
          sawSpinSpeed: targetDef.sawSpinSpeed,
          conePulseL: targetDef.conePulseL,
          pulseInterval: targetDef.pulseInterval,
          pulseRadius: targetDef.pulseRadius,
          pulseAngleDeg: targetDef.pulseAngleDeg,
          pulseForce: targetDef.pulseForce,
          toxicTouchL: targetDef.toxicTouchL,
          confusedDuration: targetDef.confusedDuration,
          allInL: targetDef.allInL,
          allInDashSpeed: targetDef.allInDashSpeed,
          allInDashRange: targetDef.allInDashRange,
          allInHitForce: targetDef.allInHitForce,
          allInMissSelfForce: targetDef.allInMissSelfForce,
          frozenFloorL: targetDef.frozenFloorL,
          floorRadius: targetDef.floorRadius,
          floorDuration: targetDef.floorDuration,
          sinkholeL: targetDef.sinkholeL,
          holeRadius: targetDef.holeRadius,
          holeDuration: targetDef.holeDuration,
          holeForce: targetDef.holeForce,
          holeCastOffset: targetDef.holeCastOffset,
        });
      }
      critter.lastHitTargetCritter = '';
    }
    // Fall through to the spawn branches so the copied flags
    // (frozenFloorL, sinkholeL) still spawn their zones.
  }

  // 2026-04-30 final-L — flag-driven L spawns (offline mirror of
  // server abilities.ts/fireEffect). Server is authoritative for
  // online; this branch covers the offline gameplay path.
  if (def.frozenFloorL) {
    activeZones.push({
      x: critter.x, z: critter.z,
      radius: def.floorRadius ?? 6.0,
      slowMultiplier: 1.0,
      ttl: def.floorDuration ?? 5.0,
      vfxKind: 'ice',
      ownerKey: critter.config.name,
      slippery: true,
    });
    spawnZoneRing(scene, critter.x, critter.z,
      def.floorRadius ?? 6.0, def.floorDuration ?? 5.0,
      0x6cc9ff, 0xffffff, 'ice');
  }
  // 2026-05-01 last-minute — Sebastian All-in trajectory preview.
  // Ground line from Sebastian to the chosen lateral edge endpoint.
  // Painted at activation only when the L is NOT hold-to-fire;
  // hold-to-fire builds spawn the preview at charge START via the
  // `startSebastianAllInCharge` helper instead, so the player sees
  // the line for as long as they keep the input pressed.
  if (def.allInL && !def.holdToFireL) {
    spawnAllInPreview(scene, critter, def.allInDashRange ?? 9, def.duration ?? 1.0);
  }

  if (def.sinkholeL) {
    const offset = def.holeCastOffset ?? 4.0;
    let cx = critter.x + Math.sin(critter.mesh.rotation.y) * offset;
    let cz = critter.z + Math.cos(critter.mesh.rotation.y) * offset;
    const r = Math.sqrt(cx * cx + cz * cz);
    if (r < 4.0) {
      cx = (cx / Math.max(r, 0.01)) * 4.0;
      cz = (cz / Math.max(r, 0.01)) * 4.0;
    }
    const holeR = def.holeRadius ?? 3.0;
    activeZones.push({
      x: cx, z: cz,
      radius: holeR,
      slowMultiplier: 0.55,
      ttl: def.holeDuration ?? 5.0,
      vfxKind: 'sand',
      ownerKey: critter.config.name,
      sinkhole: true,
      pullForce: def.holeForce ?? 14,
    });
    spawnZoneRing(scene, cx, cz,
      holeR, def.holeDuration ?? 5.0,
      0x4a3a26, 0x8b6914, 'sand');
    // 2026-04-30 final-polish (Rafa: "agujero real, los enemigos
    // pueden caer"): knock out arena fragments under the hole disc.
    // Immune centre is filtered server-side and inside Arena.
    // killFragmentIndices, so this never breaks the safe zone.
    if (_arenaRef) {
      const indices = _arenaRef.getAliveFragmentsInDisc(cx, cz, holeR);
      if (indices.length > 0) {
        _arenaRef.killFragmentIndices(indices);
      }
    }
  }
}

function fireProjectile(def: AbilityDef, critter: Critter, _all: Critter[], scene: THREE.Scene): void {
  // 2026-04-29 — Kowalski Snowball offline. Spawn a single forward
  // projectile from the caster's facing. The projectile module
  // owns its lifecycle (integration + sweep + despawn).
  const speed = def.projectileSpeed ?? 16;
  const angle = critter.mesh.rotation.y;
  spawnLocalProjectile(scene, {
    ownerCritterName: critter.config.name,
    x: critter.x + Math.sin(angle) * 0.6,
    z: critter.z + Math.cos(angle) * 0.6,
    vx: Math.sin(angle) * speed,
    vz: Math.cos(angle) * speed,
    ttl: def.projectileTtl ?? 1.2,
    radius: def.projectileRadius ?? 0.55,
    impulse: def.projectileImpulse ?? 22,
    slowDuration: def.projectileSlowDuration ?? 2.0,
  });
  applyDashFeedback(critter);
}

const EFFECT_MAP: Record<AbilityType, (def: AbilityDef, critter: Critter, all: Critter[], scene: THREE.Scene) => void> = {
  charge_rush: fireChargeRush,
  ground_pound: fireGroundPound,
  frenzy: fireFrenzy,
  blink: fireBlink,
  projectile: fireProjectile,
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
      // Dash trail — for charge_rush only, drop a directional dust-
      // puff every DASH_TRAIL_INTERVAL seconds. Each puff:
      //   · Spawns OFFSET behind the critter (opposite to its current
      //     velocity vector), not under the feet — so the trail reads
      //     as a streak of receding rings instead of a radial
      //     explosion at the critter's centre.
      //   · Carries a backward drift velocity so it slides further
      //     behind as it expands and fades.
      // Reuses the existing dust-puff pool — cost is bounded (a
      // typical 0.30 s dash drops ~6 puffs).
      if (s.def.type === 'charge_rush') {
        s.trailTimer -= dt;
        if (s.trailTimer <= 0) {
          const vMag = Math.sqrt(critter.vx * critter.vx + critter.vz * critter.vz);
          if (vMag > 0.5) {
            const dirX = critter.vx / vMag;
            const dirZ = critter.vz / vMag;
            const spawnX = critter.x - dirX * DASH_TRAIL_OFFSET;
            const spawnZ = critter.z - dirZ * DASH_TRAIL_OFFSET;
            const driftMag = vMag * DASH_TRAIL_DRIFT_FRACTION;
            spawnDustPuff(scene, spawnX, 0, spawnZ, {
              x: -dirX * driftMag,
              z: -dirZ * driftMag,
            });
          } else {
            // Critter is mostly stationary (rare during a dash but
            // possible at the very tail of the duration). Fall back
            // to a centred radial puff so we don't show a stuck
            // streak in a wrong direction.
            spawnDustPuff(scene, critter.x, 0, critter.z);
          }
          s.trailTimer = DASH_TRAIL_INTERVAL;
        }
      }
      // Drain active duration
      s.durationLeft -= dt;
      if (s.durationLeft <= 0) {
        // 2026-04-30 final-L — All-in resolution edge. When the
        // frenzy with `allInL: true` finishes its rooted windup
        // window, fire the lateral dash + hit/miss path.
        if (s.def.allInL) {
          fireAllInResolution(s.def, critter, allCritters, scene);
        }
        s.active = false;
        s.cooldownLeft = s.def.cooldown;
      }
    } else if (s.cooldownLeft > 0) {
      s.cooldownLeft -= dt;
    }
  }
}

/**
 * 2026-04-30 final-L — Sebastian All-in offline resolution.
 * Mirror of the server `simulatePlaying` step 2.g resolution
 * branch: lateral dash from the caster's current position +
 * orientation, sweep for any enemy capsule, on hit huge
 * knockback to target / on miss self-knockback toward the
 * dash direction.
 */
function fireAllInResolution(def: AbilityDef, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  // BLOQUE FINAL micropass — All-in commits FORWARD (facing actual).
  // The previous version auto-picked a lateral edge which read
  // confusingly: same press, different side trip-by-trip. Now the
  // dash direction is exactly the telegraph direction, exactly the
  // facing arrow. Hit = brutal forward strike + Sebastian para; miss
  // = Sebastian sigue hacia delante y cae al void.
  const range = def.allInDashRange ?? 5.5;
  const ry = critter.mesh.rotation.y;
  const dirX = Math.sin(ry);
  const dirZ = Math.cos(ry);

  // Sweep along the dash path and find the FIRST hit point + its
  // distance along the line. The previous version only flagged "hit
  // yes/no" — Sebastian never actually moved. Now we use the hitT
  // distance to TELEPORT him into the resolution, so the slash reads
  // as a real lateral commit instead of a magic effect-from-afar.
  // 2026-05-01 last-minute (Rafa: "muy difícil acertar"): SAMPLES
  // 12 → 18 + reach widened with a `+ 0.55` margin so a target
  // dancing just outside the perfect dash line still gets caught.
  // Combined with the trajectory preview painted at activation, the
  // L is now readable AND hittable while keeping the miss = void
  // punishment.
  let hit: Critter | null = null;
  let hitT = 0;
  const SAMPLES = 18;
  for (let i = 1; i <= SAMPLES && !hit; i++) {
    const t = (i / SAMPLES) * range;
    const sx = critter.x + dirX * t;
    const sz = critter.z + dirZ * t;
    for (const other of allCritters) {
      if (other === critter || !other.alive || other.falling) continue;
      if (other.isImmune) continue;
      const odx = other.x - sx;
      const odz = other.z - sz;
      const reach = critter.radius + other.radius + 0.55;
      if (odx * odx + odz * odz <= reach * reach) {
        hit = other;
        hitT = t;
        break;
      }
    }
  }
  const palette = CRITTER_VFX_PALETTE[critter.config.name]?.frenzy;
  if (hit) {
    // HIT — teleport Sebastian to just-before the victim along the
    // dash line so the slash reads as "I sprinted there and caught
    // you", not "I hit you from across the arena". Zero velocity for
    // a clean control return.
    const arrivalT = Math.max(0, hitT - critter.radius * 0.7);
    critter.x += dirX * arrivalT;
    critter.z += dirZ * arrivalT;
    critter.mesh.position.x = critter.x;
    critter.mesh.position.z = critter.z;
    critter.vx = 0;
    critter.vz = 0;
    // BLOQUE FINAL micropass v2 — Rafa: "si choca con alguien debe
    // echarlo fuera directamente". Bumped force, SET (not add) so the
    // velocity doesn't get diluted by the victim's prior momentum,
    // teleport the victim past the dash endpoint AND call
    // startFalling() so the all-in semantic is "guaranteed
    // elimination on contact". The maxSpeed clamp + idle friction
    // would otherwise eat the knockback before the target reached
    // the rim; explicit fall removes any doubt.
    const force = def.allInHitForce ?? 100;
    hit.vx = dirX * force;
    hit.vz = dirZ * force;
    hit.x += dirX * (range * 0.8);
    hit.z += dirZ * (range * 0.8);
    hit.mesh.position.x = hit.x;
    hit.mesh.position.z = hit.z;
    if (!hit.falling && hit.alive) hit.startFalling();
    applyImpactFeedback(hit);
    triggerHitStop(FEEL.hitStop.headbutt);
    // Crimson side-slash burst at the contact point.
    spawnShockwaveRing(scene, hit.x, hit.z, 1.8, palette);
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.headbutt * 1.6);
    playSound('headbuttHit');
  } else {
    // MISS — Sebastian commits all the way past the rim. Teleport
    // him to the dash endpoint (which is already chosen to be the
    // far side of arena radius) and set a high outward velocity so
    // physics carries him further still. `checkFalloff` next frame
    // sees him outside any alive fragment → `startFalling` fires →
    // void.
    // 1.5× ensures the endpoint clears the arena maxRadius (12)
    // even if Sebastian started somewhere inside the inner half.
    critter.x += dirX * range * 1.5;
    critter.z += dirZ * range * 1.5;
    critter.mesh.position.x = critter.x;
    critter.mesh.position.z = critter.z;
    const sf = def.allInMissSelfForce ?? 130;
    critter.vx = dirX * sf;
    critter.vz = dirZ * sf;
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.headbutt * 0.9);
    playSound('abilityFire');
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
      continue;
    }
    // Active phase. charge_rush + frenzy use their full speedMultiplier
    // (the dash boost / buff). ground_pound + blink keep speedMultiplier
    // at 1.0 from the factory and instead read `slowDuringActive` (0 by
    // default for those types — fully rooted during the active window
    // so the slam/blink reads as a committed pose). Older configs that
    // never set slowDuringActive still resolve to `speedMultiplier`
    // (which is 1.0 for those types) → no behavioural change.
    if (s.def.slowDuringActive !== undefined &&
        (s.def.type === 'ground_pound' || s.def.type === 'blink')) {
      m *= s.def.slowDuringActive;
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
      // 2026-04-29 K-refinement — Shelly Steel Shell anchor.
      // Multiply by an absurd mass while the self-buff is active
      // so collision knockback shoves the OTHER critter and
      // Shelly stays put. The selfBuffOnly + selfAnchorWhileBuffed
      // pair is unique to Shelly's K right now.
      if (s.def.selfBuffOnly && s.def.selfAnchorWhileBuffed) {
        m *= 9999;
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Sebastian All-in hold-to-fire helpers (offline)
// ---------------------------------------------------------------------------

/**
 * Direction the All-in dash commits to. Always FORWARD relative to
 * Sebastian's current facing — no lateral auto-pick. Rafa's micro-
 * pass: "toda la habilidad L de Sebastian debe ir SIEMPRE hacia
 * delante respecto al facing actual". The player aligns their facing
 * before pressing L; the telegraph + dash use that direction.
 */
function pickAllInDir(critter: Critter, _range: number): [number, number] {
  const ry = critter.mesh.rotation.y;
  return [Math.sin(ry), Math.cos(ry)];
}

function spawnAllInPreview(scene: THREE.Scene, critter: Critter, range: number, ttl: number): void {
  const dir = pickAllInDir(critter, range);
  spawnAllInTrajectoryPreview(scene, critter.x, critter.z, dir[0], dir[1], range, ttl);
}

/**
 * Local-player Sebastian started holding the L. Roots the caster,
 * spawns the trajectory preview, and starts the auto-release timer.
 * Idempotent: calling while already charging is a no-op.
 */
export function startSebastianAllInCharge(critter: Critter, scene: THREE.Scene): void {
  if (critter.lHoldCharging) return;
  const lState = critter.abilityStates[2];
  if (!lState || lState.cooldownLeft > 0 || lState.active) return;
  if (!lState.def.allInL || !lState.def.holdToFireL) return;
  critter.lHoldCharging = true;
  critter.lHoldChargeTime = 0;
  spawnAllInPreview(scene, critter, lState.def.allInDashRange ?? 9, (lState.def.holdToFireMaxMs ?? 3000) / 1000);
  applyImpactFeedback(critter); // small "charging" pulse
  triggerCameraShake(FEEL.shake.groundPound * 0.15);
}

/**
 * Local-player Sebastian released the L (or auto-release timer
 * fired). Clears the charging flag, runs the dash resolution at
 * the current facing, and starts the cooldown.
 */
export function releaseSebastianAllInCharge(
  critter: Critter,
  allCritters: Critter[],
  scene: THREE.Scene,
): void {
  if (!critter.lHoldCharging) return;
  const lState = critter.abilityStates[2];
  critter.lHoldCharging = false;
  critter.lHoldChargeTime = 0;
  if (!lState) return;
  fireAllInResolution(lState.def, critter, allCritters, scene);
  lState.cooldownLeft = lState.def.cooldown;
}

/**
 * Per-frame hold-to-fire driver for the local Sebastian. Called
 * from `updatePlayer` each tick. Reads the live `ultimate` input
 * via the `held` parameter (player.ts already has access to
 * isHeld). Handles auto-release timeout.
 */
export function tickSebastianHoldToFire(
  critter: Critter,
  held: boolean,
  dt: number,
  allCritters: Critter[],
  scene: THREE.Scene,
): void {
  const lState = critter.abilityStates[2];
  if (!lState || !lState.def.holdToFireL) return;
  if (critter.lHoldCharging) {
    critter.lHoldChargeTime += dt;
    const maxSec = (lState.def.holdToFireMaxMs ?? 3000) / 1000;
    if (!held || critter.lHoldChargeTime >= maxSec) {
      releaseSebastianAllInCharge(critter, allCritters, scene);
    }
  } else if (held && lState.cooldownLeft <= 0 && !lState.active) {
    startSebastianAllInCharge(critter, scene);
  }
}
