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
import { triggerHitStop, triggerCameraShake, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, applyYankVisual, createFrozenFrameGate, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { spawnDustPuff } from './dust-puff';
import { spawnLocalProjectile } from './projectiles';
import { FRAG, pointInFragment, type ArenaLayout } from './arena-fragments';
import {
  COPYCAT_KEYS,
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
  spawnConeWedge,
  spawnDecoyAt,
  spawnAllInTrajectoryPreview,
  type AllInPreview,
} from './abilities-vfx';

// 2026-04-30 final-polish — Sihans Sinkhole opens a real arena hole.
// We need access to the live Arena (to query + kill fragments under
// the hole disc) without making this module depend on `./arena`
// directly (which imports DECOR_TYPES → THREE → cycles). Boot wires
// the arena via `setArenaForAbilities` from main.ts (and the lab from
// tools/main.ts) so the gameplay path can call
// `arena.killFragmentIndices(...)` without a static circular import.
interface ArenaForAbilities {
  getAliveFragmentsInDisc(cx: number, cz: number, r: number): number[];
  killFragmentIndices(indices: number[]): void;
  isOnArena(x: number, z: number): boolean;
  getLayout(): ArenaLayout | null;
}
let _arenaRef: ArenaForAbilities | null = null;
export function setArenaForAbilities(a: ArenaForAbilities | null): void {
  _arenaRef = a;
}

/** Live floor at (x, z): the wired arena's alive fragments, or the whole
 *  disc when no arena is wired. */
function isOnLiveFloor(x: number, z: number): boolean {
  return _arenaRef ? _arenaRef.isOnArena(x, z) : Math.hypot(x, z) <= FRAG.maxRadius;
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
    rammed: new Set(),
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

/** Dash and blink are the abilities that move the caster on purpose. */
function isMovementAbility(def: AbilityDef): boolean {
  return def.type === 'charge_rush' || def.type === 'blink';
}

/** True while another slot of the same critter holds a self-anchoring
 *  buff (Shelly Steel Shell), wind-up included: anchored means
 *  "invulnerable but can't move", so no dash or blink can start. Pure over
 *  the critter's ability states so the HUD can grey the key out with the
 *  very same rule (INTERFAZ, updateAbilityHUD). Server mirror:
 *  `blockedByAnchor` in server/src/sim/abilities.ts. */
export function isBlockedByAnchor(state: AbilityState, states: readonly AbilityState[]): boolean {
  if (!isMovementAbility(state.def)) return false;
  return states.some((s) => s !== state && s.active && s.def.selfAnchorWhileBuffed === true);
}

function blockedByAnchor(state: AbilityState, critter: Critter): boolean {
  return isBlockedByAnchor(state, critter.abilityStates);
}

/** A self-anchoring buff (Shelly Steel Shell) stops the caster's own
 *  motion dead (Rafa 2026-09-24: «frena en seco», asked about her own
 *  movement): the dash or blink still running ends, its cooldown started
 *  as if it had run out, and the velocity goes to 0 if it's no more than
 *  she makes herself — her run (`anchorBrakeMaxSpeed`), plus that dash's
 *  impulse and a headbutt lunge in progress. Faster than that, someone
 *  launched her: the flight carries on, as it did before the shell. Called
 *  on the key press, so the rooted wind-up doesn't skid on, and again when
 *  the shell locks, for a lunge that started in the wind-up. Server mirror:
 *  `anchorInPlace` in server/src/sim/abilities.ts. */
function anchorInPlace(critter: Critter, def: AbilityDef): void {
  let ownSpeed = def.anchorBrakeMaxSpeed ?? Infinity;
  if (critter.isHeadbutting) ownSpeed += FEEL.headbutt.lunge.velocityBoost;
  for (const s of critter.abilityStates) {
    if (s.active && isMovementAbility(s.def)) {
      ownSpeed += s.def.impulse;
      cancelAbility(s);
    }
  }
  if (Math.hypot(critter.vx, critter.vz) <= ownSpeed) {
    critter.vx = 0;
    critter.vz = 0;
  }
}

export function activateAbility(state: AbilityState, critter: Critter): boolean {
  if (!canActivateAbility(state)) return false;
  // Stunned: no J, K or L starts (Critter.stunTimer). What was already
  // cast before the stun runs its course. Server mirror: the stun gate
  // in tickPlayerAbilities.
  if (critter.stunTimer > 0) return false;
  if (blockedByAnchor(state, critter)) return false;
  state.active = true;
  state.effectFired = false;
  state.windUpLeft = state.def.windUp;
  state.durationLeft = state.def.duration;
  state.trailTimer = 0;
  if (state.def.selfAnchorWhileBuffed) anchorInPlace(critter, state.def);
  // Effect is fired from updateAbilities, which always has access to scene.
  // This avoids needing a null-scene placeholder and keeps the firing path unified.
  return true;
}

/** End an ability early: whatever it had left doesn't fire, and its
 *  cooldown starts as if it had run its course. */
export function cancelAbility(state: AbilityState): void {
  state.active = false;
  state.windUpLeft = 0;
  state.durationLeft = 0;
  state.cooldownLeft = state.def.cooldown;
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

/** Below this yank length (world units) the grip's victim barely moved,
 *  so its impact lean falls back to "toward Trunk" (-facing). */
const GRIP_MIN_YANK_FOR_LEAN = 0.05;

/**
 * Who a Trunk Grip would take right now: the closest valid enemy within
 * `gripFrontalRange` and ±`gripFrontalAngleDeg` of the caster's facing,
 * and how far it is. Shared by the grip itself and the bot AI's decision
 * to cast it (src/bot.ts), so both read the same geometry.
 */
export function findGripTarget(
  def: AbilityDef,
  critter: Critter,
  allCritters: readonly Critter[],
): { target: Critter; dist: number } | null {
  const range = def.gripFrontalRange ?? 6.0;
  const cosHalf = Math.cos(((def.gripFrontalAngleDeg ?? 50) * Math.PI) / 180);
  const facingX = Math.sin(critter.mesh.rotation.y);
  const facingZ = Math.cos(critter.mesh.rotation.y);
  let best: { target: Critter; dist: number } | null = null;
  for (const other of allCritters) {
    // Immune critters aren't candidates (server: same filter), so the
    // grip takes the next one instead of whiffing on a Steel Shell.
    if (other === critter || !other.alive || other.falling || other.isImmune) continue;
    const dx = other.x - critter.x;
    const dz = other.z - critter.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > range || d < 0.01) continue;
    if ((dx * facingX + dz * facingZ) / d < cosHalf) continue;
    // Closest wins.
    if (!best || d < best.dist) best = { target: other, dist: d };
  }
  return best;
}

/**
 * Stun `target` for at least `seconds` (a stun never shortens a longer
 * one). A stunned critter doesn't act (Critter.stunTimer), so an All-in
 * charge it was holding drops unreleased — no dash, no cooldown — as on a
 * fall. Server: the grip and slam write the same max; the charge lives in
 * BrawlRoom's hold-to-fire loop, where dropping it on the stun (and sending
 * `lChargeEnd` so the line goes) is pending (DISTRIBUCIÓN, buzón fase 2).
 */
function stun(target: Critter, seconds: number): void {
  target.stunTimer = Math.max(target.stunTimer, seconds);
  cancelSebastianAllInCharge(target);
}

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
    // The shell locks: a lunge of hers from the wind-up stops dead; a
    // push she took in it doesn't (anchorInPlace).
    if (def.selfAnchorWhileBuffed) anchorInPlace(critter, def);
    // The activation ring goes where the K was cast: under the shell, or
    // under Mirror Trick's decoy — not where Kurama reappears.
    const castX = critter.x;
    const castZ = critter.z;
    const dur = def.selfImmunityDuration ?? 0;
    const invisDur = def.invisibilityDuration ?? 0;
    const total = Math.max(dur, invisDur);
    if (total > 0) {
      // Extend the existing immunity window so the caster can't be
      // pushed during the buff. Bumping critter.immunityTimer is the
      // simplest path; the look is the buff's own (tint or ghost —
      // Critter.updateVisuals skips the respawn blink under a self-buff).
      critter.immunityTimer = Math.max(critter.immunityTimer, total);
    }
    if (invisDur > 0) {
      // 2026-04-29 final-K (Rafa: "lógica al revés — primero decoy
      // en posición original, después mover Kurama HACIA ATRÁS").
      // Order is now:
      //   1. snapshot original position
      //   2. spawn the decoy at that original spot (BEFORE moving)
      //   3. move Kurama backward by `decoyEscapeDistance`: away from
      //      the nearest enemy within `decoyThreatRange` (turned to
      //      face him), else opposite her facing; clamped to arena,
      //      landing on live floor (`decoyEscapeFallbacks`, else she
      //      stays)
      //   4. ghost her mesh + a couple of dust puffs at the arrival
      //      point (a hint, not a beacon: the ring marks the decoy)
      const originX = castX;
      const originZ = castZ;
      // 1+2 — decoy first.
      spawnDecoyAt(scene, critter, invisDur);
      const escDist = def.decoyEscapeDistance ?? 0;
      if (escDist > 0) {
        // 3 — retreat backward. Facing a chaser (turned toward him if
        // she was running away) the jump takes her away from him.
        const threat = nearestDecoyThreat(def, critter, allCritters);
        if (threat) critter.mesh.rotation.y = Math.atan2(threat.x - originX, threat.z - originZ);
        const backAngle = critter.mesh.rotation.y + Math.PI;
        let nx = originX + Math.sin(backAngle) * escDist;
        let nz = originZ + Math.cos(backAngle) * escDist;
        const r = Math.sqrt(nx * nx + nz * nz);
        if (r > ARENA_BLINK_RADIUS) {
          nx = (nx / r) * ARENA_BLINK_RADIUS;
          nz = (nz / r) * ARENA_BLINK_RADIUS;
        }
        [nx, nz] = pickSafeLanding(originX, originZ, nx, nz, def.decoyEscapeFallbacks ?? [1]);
        critter.x = nx;
        critter.z = nz;
        critter.mesh.position.x = nx;
        critter.mesh.position.z = nz;
        critter.markTeleported();
        critter.vx = 0;
        critter.vz = 0;
        // 4 — a little dust at arrival: whoever watches closely can
        // follow her; at a glance the decoy is the one on screen.
        const puffs = FEEL.decoy.arrivalPuffs;
        for (let i = 0; i < puffs; i++) {
          const a = (i / puffs) * Math.PI * 2;
          spawnDustPuff(scene, nx + Math.cos(a) * 0.4, 0, nz + Math.sin(a) * 0.4);
        }
      }
      // Ghost Kurama AFTER the move so the alpha layer applies to
      // the new position, not the origin (the decoy stays solid:
      // the clone owns its own materials).
      critter.invisibilityTimer = invisDur;
    }
    if (def.selfTintHex !== undefined) {
      critter.selfTintHex = def.selfTintHex;
      critter.selfTintTimer = total;
    }
    // Soft burst at the cast spot so the activation reads, but no
    // force is applied to anyone.
    const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
    spawnShockwaveRing(scene, castX, castZ, 1.6, palette);
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
    const facingX = Math.sin(critter.mesh.rotation.y);
    const facingZ = Math.cos(critter.mesh.rotation.y);
    const target = findGripTarget(def, critter, allCritters)?.target ?? null;
    const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.groundPound * (def.shakeBoost ?? 1.0));
    playSound('groundPound');
    if (target) {
      const pull = def.gripPullDistance ?? 1.6;
      // The yank is a push the target takes: it comes knockbackScale of
      // the way to the pull point (a Frenzy Sergei, 0.4), never past it.
      const k = Math.min(1, target.knockbackScale);
      const tx = target.x + (critter.x + facingX * pull - target.x) * k;
      const tz = target.z + (critter.z + facingZ * pull - target.z) * k;
      // The lean follows the real yank: a target already inside the pull
      // distance, or off to a side, isn't moved straight at Trunk.
      let yankX = tx - target.x;
      let yankZ = tz - target.z;
      if (Math.hypot(yankX, yankZ) < GRIP_MIN_YANK_FOR_LEAN) {
        yankX = -facingX;
        yankZ = -facingZ;
      }
      // Snap target to where the yank leaves it and zero its velocity:
      // the physics jump is one step. The model slides in behind it
      // (FEEL.grip.yankVisualTime) instead of teleporting on screen.
      const fromX = target.x;
      const fromZ = target.z;
      target.x = tx;
      target.z = tz;
      target.mesh.position.x = tx;
      target.mesh.position.z = tz;
      target.markTeleported(); // the slide is applyYankVisual's, not the renderer's
      target.vx = 0;
      target.vz = 0;
      stun(target, def.gripStunDuration ?? 2.0);
      // Burst where the trunk catches it: the hit stop freezes the model
      // there, before the slide.
      spawnShockwaveRing(scene, fromX, fromZ, 1.0, palette);
      applyYankVisual(target, fromX, fromZ);
      applyImpactFeedback(target, yankX, yankZ);
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
    // Immune (Steel Shell, Mirror Trick, respawn) and falling critters
    // take nothing: no push, no stun, no flash. Same filter as the
    // server's fireGroundPound.
    if (other === critter || !other.alive || other.falling || other.isImmune) continue;
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
      const f = def.force * (1 - dist / def.radius) * other.knockbackScale;
      other.vx += nx * f;
      other.vz += nz * f;
      applyImpactFeedback(other, nx, nz);
      // 2026-05-01 final — Trunk Slam K applies a brief stun on
      // every critter inside the AoE via `slamStunDuration`.
      // Stuns from this source compose with the global ×4
      // vulnerable rule in physics — Slam alone reads as a heavy
      // thump, Slam → headbutt deletes the target.
      if (def.slamStunDuration && def.slamStunDuration > 0) {
        stun(other, def.slamStunDuration);
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
    triggerHitStop(FEEL.hitStop[def.hitStopKey ?? 'groundPound']);
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
    const age = pushOfflineZone({
      x: critter.x, z: critter.z,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
      vfxKind: kind,
      ownerKey: critter.config.name,
    });
    spawnZoneRing(scene, critter.x, critter.z, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary, kind, age);
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
  /** 2026-04-30 final-L — Kowalski Frozen Floor. Present only on
   *  slippery zones, with what the ice does to anyone standing in
   *  it who doesn't own it (`getSlipperyZone`). */
  slippery?: SlipperyEffect;
  /** 2026-04-30 final-L — Sihans Sinkhole flag. Per-frame pull
   *  toward the centre is applied in `tickAbilityZones`. */
  sinkhole?: boolean;
  pullForce?: number;
}

const activeZones: ActiveZone[] = [];

/** Push an offline zone and return the clock its ring runs on
 *  (spawnZoneRing `age`): seconds of game time since it spawned, which
 *  stop with the zone on hit stop and pause, and read as its whole
 *  lifetime once it has left the list (expired or cleared). */
function pushOfflineZone(zone: ActiveZone): () => number {
  activeZones.push(zone);
  const lifetime = zone.ttl;
  return () => (activeZones.includes(zone) ? lifetime - zone.ttl : lifetime);
}

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
 *
 * Skipped on hit-stop frames, like the rest of the sim: it runs after
 * game.update with the raw dt, so during a freeze the saw kept adding
 * +90 u/s per frame to a victim that couldn't move (up to ~600 u/s)
 * and Cone Pulse kept counting pulses.
 */
interface ConePulseState { acc: number; count: number; lastActive: boolean; }
const _pulseStates = new WeakMap<Critter, ConePulseState>();
const lTickFrozen = createFrozenFrameGate();

/** Contact hits (Saw Shell, Stampede ram, Toxic Touch) land once per
 *  FEEL.abilities.contactRehitCooldown per caster→victim pair, not every
 *  frame the victim stays in reach. Remaining cooldown per victim, aged
 *  by tickLOffline. Server mirror: same helpers in sim/abilities.ts. */
const _contactRehit = new WeakMap<Critter, Map<Critter, number>>();

function ageContactRehit(c: Critter, dt: number): void {
  const left = _contactRehit.get(c);
  if (!left) return;
  for (const [victim, t] of left) {
    if (t <= dt) left.delete(victim);
    else left.set(victim, t - dt);
  }
}

/** True when `c` may contact-hit `victim` now; arms the pair's cooldown. */
function takeContactHit(c: Critter, victim: Critter): boolean {
  let left = _contactRehit.get(c);
  if (!left) {
    left = new Map();
    _contactRehit.set(c, left);
  }
  if (left.has(victim)) return false;
  left.set(victim, FEEL.abilities.contactRehitCooldown);
  return true;
}

export function tickLOffline(dt: number, critters: Critter[], scene?: THREE.Scene): void {
  if (lTickFrozen()) return;
  for (const c of critters) {
    if (!c.alive || c.falling) {
      // A fall ends any Cone Pulse channel: its edge detector must not
      // carry across the respawn and fire a leftover pulse there.
      _pulseStates.delete(c);
      continue;
    }
    ageContactRehit(c, dt);
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
      // updateAbilities drains the L's duration before this tick, so on
      // the frame it expires the L is already inactive here, yet that
      // frame's time was channel time: with duration = pulseCount ×
      // pulseInterval the last pulse is due exactly then. Counting it
      // (and capping at pulseCount) gives the same pulses at any dt.
      const channeling = isActive || state.lastActive;
      state.lastActive = isActive;
      if (channeling) {
        state.acc += dt;
        const def = lState.def;
        const interval = def.pulseInterval ?? 0.30;
        const maxPulses = def.pulseCount ?? Infinity;
        const halfCone = ((def.pulseAngleDeg ?? 45) * Math.PI) / 180;
        const cosCone = Math.cos(halfCone);
        const baseForce = def.pulseForce ?? 28;
        const facingX = Math.sin(c.mesh.rotation.y);
        const facingZ = Math.cos(c.mesh.rotation.y);
        while (state.acc >= interval && state.count < maxPulses) {
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
          const { waveStep, waveThickness } = FEEL.conePulse;
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
            const f = effectiveForce * fall * other.knockbackScale;
            other.vx += facingX * f;
            other.vz += facingZ * f;
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
        if (!takeContactHit(c, other)) continue;
        const d = Math.sqrt(d2);
        const v = impulse * other.knockbackScale;
        other.vx = (dx / d) * v;
        other.vz = (dz / d) * v;
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
        if (!takeContactHit(c, other)) continue;
        // SET the launch velocity instead of adding it: the hit is the
        // same whatever the victim was doing, and nothing stacks.
        const d = Math.sqrt(d2);
        const v = impulse * other.knockbackScale;
        other.vx = (dx / d) * v;
        other.vz = (dz / d) * v;
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
        if (!takeContactHit(c, other)) continue;
        other.confusedTimer = Math.max(other.confusedTimer, dur);
      }
    }
  }

  // Sinkhole pull — affects every critter inside any sinkhole zone
  // they don't own. Immune critters aren't pulled (server: same).
  for (const c of critters) {
    if (!c.alive || c.falling || c.isImmune) continue;
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

const zoneTickFrozen = createFrozenFrameGate();

/** Tick all live zones forward, removing expired entries. Called from
 *  the offline gameplay loop after physics update. Zones don't age on
 *  hit-stop frames: they last their duration in game time. */
export function tickAbilityZones(dt: number): void {
  if (zoneTickFrozen()) return;
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

/** What a slippery zone (Kowalski Frozen Floor) does to a critter
 *  standing on it. Written from the L def (`floorFrictionMult`,
 *  `floorAccelMult`) when the zone spawns. */
export interface SlipperyEffect {
  /** Multiplies the friction half-life (critter.ts friction loop). */
  frictionMult: number;
  /** Multiplies the movement acceleration (player.ts, bot.ts). */
  accelMult: number;
}

/** The ice under the given critter, if it stands inside a slippery
 *  zone (Kowalski Frozen Floor) it doesn't own. Overlapping ice
 *  doesn't stack: the first zone found wins. Mirror:
 *  server/src/sim/physics.ts getSlipperyZone. */
export function getSlipperyZone(x: number, z: number, ownerKey?: string): SlipperyEffect | undefined {
  for (const zone of activeZones) {
    if (!zone.slippery) continue;
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) return zone.slippery;
  }
  return undefined;
}

/** Iterate over every active sinkhole zone that the given owner
 *  doesn't own. Lets the caller apply the inward pull force per
 *  tick on each affected critter. */
export function forEachSinkhole(cb: (zone: { x: number; z: number; radius: number; pullForce: number }) => void, ownerKey?: string): void {
  for (const zone of activeZones) {
    if (!zone.sinkhole) continue;
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
    cb({ x: zone.x, z: zone.z, radius: zone.radius, pullForce: zone.pullForce ?? 19.25 }); // default = Sihans' holeForce since the 2026-09-21 speed-up
  }
}

/** True if the given world point is inside any active zone of the
 *  given vfxKind. Used by main.ts each frame to drive the local
 *  Kermit Poison Cloud screen-space overlay (`vfxKind: 'poison'`).
 *  `ownerKey`: skip zones owned by that critter name, as in
 *  getZoneSlowMultiplier (Critter.updateVisuals: the caster in its own
 *  sand isn't tinted as trapped).
 *  Cheap O(zones) — typically <= 4 zones alive at once. */
export function isInsideZoneOfKind(x: number, z: number, kind: ZoneVfxKind, ownerKey?: string): boolean {
  for (const zone of activeZones) {
    if (zone.vfxKind !== kind) continue;
    if (ownerKey !== undefined && zone.ownerKey === ownerKey) continue;
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
 *  margin keeps blink targets clear of the platform rim. It knows
 *  nothing of collapsed fragments: `pickSafeLanding` does. */
const ARENA_BLINK_RADIUS = 11.6;

/**
 * Where a teleport from (ox, oz) to (tx, tz) lands: the first point on
 * that line, at each of `fractions` of its length (best first), that
 * stands on live floor, or the origin itself when none does. The disc
 * clamp alone used to drop Sand Trap into collapsed sectors and let
 * Mirror Trick walk the void while immune. Server mirror: pickSafeLanding
 * in server/src/sim/abilities.ts.
 */
function pickSafeLanding(ox: number, oz: number, tx: number, tz: number, fractions: readonly number[]): [number, number] {
  for (const f of fractions) {
    const x = ox + (tx - ox) * f;
    const z = oz + (tz - oz) * f;
    if (isOnLiveFloor(x, z)) return [x, z];
  }
  return [ox, oz];
}

/** Mirror Trick: the live enemy nearest to the caster within
 *  `def.decoyThreatRange`, the one the escape jumps away from; null
 *  leaves it to her facing. Immune ones count: they still chase and
 *  headbutt. Server mirror: nearestDecoyThreat in server/src/sim/abilities.ts. */
function nearestDecoyThreat(def: AbilityDef, critter: Critter, allCritters: Critter[]): Critter | null {
  let best = def.decoyThreatRange ?? 0;
  let threat: Critter | null = null;
  for (const other of allCritters) {
    if (other === critter || !other.alive || other.falling) continue;
    const d = Math.hypot(other.x - critter.x, other.z - critter.z);
    if (d < best && d > 0.01) {
      best = d;
      threat = other;
    }
  }
  return threat;
}

/** Fractions of a line `len` long that step back from its end toward
 *  its start in `step` increments: 1, 1 − step/len, … while above 0. */
function stepBackFractions(len: number, step: number): number[] {
  const out: number[] = [];
  for (let d = len; d > 0; d -= step) out.push(d / len);
  return out;
}

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
  // Clamp to the arena disc, then make sure the landing is live floor:
  // step back toward the origin until it is, or stay put (the zone of a
  // zoneAtOrigin blink still drops).
  const r = Math.sqrt(targetX * targetX + targetZ * targetZ);
  if (r > ARENA_BLINK_RADIUS) {
    targetX = (targetX / r) * ARENA_BLINK_RADIUS;
    targetZ = (targetZ / r) * ARENA_BLINK_RADIUS;
  }
  const len = Math.hypot(targetX - originX, targetZ - originZ);
  [targetX, targetZ] = pickSafeLanding(originX, originZ, targetX, targetZ,
    stepBackFractions(len, FEEL.blink.landingProbeStep));
  const palette = CRITTER_VFX_PALETTE[critter.config.name]?.pound;
  spawnShockwaveRing(scene, originX, originZ, 1.2, palette);
  // Teleport
  critter.x = targetX;
  critter.z = targetZ;
  critter.mesh.position.x = targetX;
  critter.mesh.position.z = targetZ;
  critter.markTeleported();
  critter.vx = 0;
  critter.vz = 0;
  spawnShockwaveRing(scene, targetX, targetZ, 1.4, palette);
  // v0.11 — Cheeto Shadow Step impact: radial knockback at the
  // destination so reappearing next to an enemy reads as
  // offensive, not just a dodge. The caster is excluded from the
  // push (he's the one teleporting in).
  if (def.blinkImpactRadius && def.blinkImpactForce) {
    let hits = 0;
    for (const other of allCritters) {
      // Same filter as the server: immune and falling critters are skipped.
      if (other === critter || !other.alive || other.falling || other.isImmune) continue;
      const dx = other.x - targetX;
      const dz = other.z - targetZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < def.blinkImpactRadius && d > 0.01) {
        const fall = 1 - d / def.blinkImpactRadius;
        const f = def.blinkImpactForce * fall * other.knockbackScale;
        other.vx += (dx / d) * f;
        other.vz += (dz / d) * f;
        applyImpactFeedback(other, dx, dz);
        hits++;
      }
    }
    // Only a landing that hits shakes, freezes and thuds: the pose of the
    // impact used to last one frame, and an empty landing shook the same.
    if (hits > 0) {
      triggerHitStop(FEEL.hitStop[def.hitStopKey ?? 'ability']);
      triggerCameraShake(FEEL.shake.headbutt * FEEL.shake.blinkImpactFactor);
      playSound('headbuttHit');
    }
  }
  // v0.11 — zone-at-origin (Sihans Burrow): drop the slow zone
  // where the critter STARTED, not where they appear. Reads as
  // "se hundió aquí, salió allá, y dejó arenas movedizas atrás".
  if (def.zone) {
    const zx = def.zoneAtOrigin ? originX : targetX;
    const zz = def.zoneAtOrigin ? originZ : targetZ;
    const kind = deriveZoneVfxKind(critter.config.name);
    const age = pushOfflineZone({
      x: zx, z: zz,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
      vfxKind: kind,
      ownerKey: critter.config.name,
    });
    spawnZoneRing(scene, zx, zz, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary, kind, age);
  }
  // 2026-04-29 K-session — Burrow visual (Sihans). When the blink
  // is configured with `zoneAtOrigin: true` we treat it as the
  // Burrow Rush K (only Sihans uses that flag) and:
  //   · ghost the critter for 0.30 s (handled in critter.updateVisuals,
  //     where Sihans' invisibilityTimer collapses opacity to 0 instead
  //     of the FEEL.decoy.ghostAlpha ghost used by Kurama Mirror Trick),
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

/** How deep a Cone Pulse channel reaches: the far edge of its last wave
 *  (tickLOffline), 9.4 u for Cheeto's 6 pulses. */
function conePulseReach(def: AbilityDef): number {
  const pulses = def.pulseCount ?? Math.round(def.duration / (def.pulseInterval ?? 0.30));
  return pulses * FEEL.conePulse.waveStep + FEEL.conePulse.waveThickness * 0.5;
}

/**
 * The L's entry beat at (x, z), facing `yaw`, in the caster's frenzy
 * palette. Cone Pulse paints the wedge it is about to sweep (±pulseAngleDeg,
 * to its last wave): the round burst read as 360° for a frontal L (Rafa on
 * Claw Wave, «dice frontal y veo 360°»). Every other L keeps the burst. A
 * Copycat cast arrives with its copy in `def`, so a copied Cone Pulse gets
 * the wedge too. Exported for the online `abilityFired` handler (game.ts).
 */
export function spawnLEntryVfx(scene: THREE.Scene, def: AbilityDef, critterName: string, x: number, z: number, yaw: number): void {
  const palette = CRITTER_VFX_PALETTE[critterName]?.frenzy;
  if (def.conePulseL) {
    const halfCone = ((def.pulseAngleDeg ?? 45) * Math.PI) / 180;
    spawnConeWedge(scene, x, z, yaw, halfCone, conePulseReach(def), palette);
  } else {
    spawnFrenzyBurst(scene, x, z, palette);
  }
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
  // owned by each character (orange tiger rage, ice blizzard, etc.);
  // Cone Pulse paints its cone instead (spawnLEntryVfx).
  spawnLEntryVfx(scene, def, critter.config.name, critter.x, critter.z, critter.mesh.rotation.y);
  triggerCameraShake(FEEL.shake.groundPound * FEEL.shake.frenzyFactor);
  playSound('abilityFire');

  // 2026-04-30 final-L — flag-driven L spawns (offline mirror of
  // server abilities.ts/fireEffect). Server is authoritative for
  // online; this branch covers the offline gameplay path. A Copycat
  // cast arrives here with its copy already in `def` (fireEffect), so
  // a copied Frozen Floor or Sinkhole spawns through the same code.
  if (def.frozenFloorL) {
    const age = pushOfflineZone({
      x: critter.x, z: critter.z,
      radius: def.floorRadius ?? 6.0,
      slowMultiplier: 1.0,
      ttl: def.floorDuration ?? 5.0,
      vfxKind: 'ice',
      ownerKey: critter.config.name,
      slippery: {
        frictionMult: def.floorFrictionMult ?? 1,
        accelMult: def.floorAccelMult ?? 1,
      },
    });
    spawnZoneRing(scene, critter.x, critter.z,
      def.floorRadius ?? 6.0, def.floorDuration ?? 5.0,
      0x6cc9ff, 0xffffff, 'ice', age);
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
    const age = pushOfflineZone({
      x: cx, z: cz,
      radius: holeR,
      slowMultiplier: 0.55,
      ttl: def.holeDuration ?? 5.0,
      vfxKind: 'sand',
      ownerKey: critter.config.name,
      sinkhole: true,
      pullForce: def.holeForce ?? 19.25, // default = Sihans' holeForce since the 2026-09-21 speed-up
    });
    spawnZoneRing(scene, cx, cz,
      holeR, def.holeDuration ?? 5.0,
      0x4a3a26, 0x8b6914, 'sand', age);
    // 2026-04-30 final-polish (Rafa: "agujero real, los enemigos
    // pueden caer"): knock out arena fragments under the hole disc.
    // Immune centre is filtered server-side and inside Arena.
    // killFragmentIndices, so this never breaks the safe zone.
    // The fragment the caster stands on is spared: the disc test goes
    // by centroid, and a wide tile can reach 3 u under a hole cast 4 u
    // ahead — Sihans used to drop through her own hole (16.7 % of casts).
    // An enemy on that same tile keeps its floor too.
    if (_arenaRef) {
      const fragments = _arenaRef.getLayout()?.fragments ?? [];
      const indices = _arenaRef.getAliveFragmentsInDisc(cx, cz, holeR)
        .filter((i) => !pointInFragment(critter.x, critter.z, fragments[i]));
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
  // Here and not in activateAbility: the lab's forceAbility starts an
  // ability without it, and a dash's contact beat must still land again.
  if (state.def.type === 'charge_rush') state.rammed.clear();
  if (state.def.copycatL) applyCopycat(state, critter);
  EFFECT_MAP[state.def.type](state.def, critter, allCritters, scene);
}

// ---------------------------------------------------------------------------
// Copycat (Kurama L)
// ---------------------------------------------------------------------------

function copyKey<K extends keyof AbilityDef>(to: AbilityDef, from: AbilityDef, k: K): void {
  if (from[k] !== undefined) to[k] = from[k];
}

/**
 * Copycat fire: the L state's def becomes a copy of Kurama's own L with
 * the COPYCAT_KEYS of the last critter she headbutted, for this cast
 * only; with no target it's her plain L (the buff). The target is
 * consumed either way. The shared kit def is never written: it used to
 * be, so a copy stuck to every Kurama for the rest of the session.
 * Server mirror: `fireCopycat` in server/src/sim/abilities.ts.
 */
function applyCopycat(state: AbilityState, critter: Critter): void {
  const base = CRITTER_ABILITIES[critter.config.name]?.[2] ?? state.def;
  const src = critter.lastHitTargetCritter ? CRITTER_ABILITIES[critter.lastHitTargetCritter]?.[2] : undefined;
  critter.lastHitTargetCritter = '';
  if (!src) {
    state.def = base;
    return;
  }
  const copy: AbilityDef = { ...base };
  for (const k of COPYCAT_KEYS) copyKey(copy, src, k);
  state.def = copy;
}

/**
 * A Copycat copy lasts one cast. It goes back to the kit def on the first
 * tick the L is no longer active, not on the tick it ends, so the passes
 * that run after updateAbilities that frame (tickLOffline: Cone Pulse's
 * last pulse and its edge detector) still read the copy.
 */
function restoreCopycat(state: AbilityState, critter: Critter): void {
  if (state.active || !state.def.copycatL) return;
  const base = CRITTER_ABILITIES[critter.config.name]?.[2];
  if (base) state.def = base;
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
    restoreCopycat(s, critter);
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
 * Who the All-in would catch if it resolved now from the caster's facing,
 * and where along the dash line (`t`). Shared by the resolution and the
 * bot AI (src/bot.ts), so the bot reads the real hit geometry. `inset`
 * narrows the lane's reach; the resolution uses 0.
 *
 * The sweep samples the dash path and returns the FIRST hit, whose
 * distance the resolution uses to teleport Sebastian into the strike.
 * 2026-05-01 last-minute (Rafa: "muy difícil acertar"): SAMPLES 12 → 18
 * + reach widened with a margin (FEEL.allIn.hitMargin) so a target
 * dancing just outside the perfect dash line still gets caught.
 * Only targets ahead of Sebastian count: the first sample's reach used
 * to cover 1.15 u BEHIND him, so a tap erased whoever was touching his
 * back.
 */
export function findAllInTarget(
  def: AbilityDef,
  critter: Critter,
  allCritters: readonly Critter[],
  inset = 0,
): { target: Critter; t: number } | null {
  const range = def.allInDashRange ?? 5.5;
  const ry = critter.mesh.rotation.y;
  const dirX = Math.sin(ry);
  const dirZ = Math.cos(ry);
  const SAMPLES = 18;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * range;
    const sx = critter.x + dirX * t;
    const sz = critter.z + dirZ * t;
    for (const other of allCritters) {
      if (other === critter || !other.alive || other.falling) continue;
      if (other.isImmune) continue;
      if ((other.x - critter.x) * dirX + (other.z - critter.z) * dirZ < 0) continue;
      const odx = other.x - sx;
      const odz = other.z - sz;
      const reach = critter.radius + other.radius + FEEL.allIn.hitMargin - inset;
      if (odx * odx + odz * odz <= reach * reach) return { target: other, t };
    }
  }
  return null;
}

/**
 * 2026-04-30 final-L — Sebastian All-in offline resolution.
 * Mirror of the server `simulatePlaying` step 2.g resolution
 * branch: lateral dash from the caster's current position +
 * orientation, sweep for any enemy capsule ahead, on hit huge
 * knockback to target / on miss Sebastian falls at the first
 * point of the dash line off the arena.
 */
function fireAllInResolution(def: AbilityDef, critter: Critter, allCritters: Critter[], scene: THREE.Scene): void {
  // Safety net: startFalling already cancels the charge and the windup,
  // but nothing resolves from the void.
  if (critter.falling) return;
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

  const found = findAllInTarget(def, critter, allCritters);
  const hit = found?.target ?? null;
  const hitT = found?.t ?? 0;
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
    critter.markTeleported();
    critter.vx = 0;
    critter.vz = 0;
    // BLOQUE FINAL micropass v2 — Rafa: "si choca con alguien debe
    // echarlo fuera directamente". Bumped force, SET (not add) so the
    // velocity doesn't get diluted by the victim's prior momentum,
    // teleport the victim past the dash endpoint AND call
    // startFalling() so the all-in semantic is "guaranteed
    // elimination on contact". The maxSpeed clamp + idle friction
    // would otherwise eat the knockback before the target reached
    // the rim; explicit fall removes any doubt. So no knockbackScale
    // here: a Frenzy Sergei caught by it goes out too.
    const force = def.allInHitForce ?? 100;
    hit.vx = dirX * force;
    hit.vz = dirZ * force;
    hit.x += dirX * (range * 0.8);
    hit.z += dirZ * (range * 0.8);
    hit.mesh.position.x = hit.x;
    hit.mesh.position.z = hit.z;
    hit.markTeleported();
    if (!hit.falling && hit.alive) hit.startFalling();
    applyImpactFeedback(hit, dirX, dirZ);
    triggerHitStop(FEEL.hitStop.headbutt);
    // Crimson side-slash burst at the contact point.
    spawnShockwaveRing(scene, hit.x, hit.z, 1.8, palette);
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.headbutt * 1.6);
    playSound('headbuttHit');
  } else {
    // MISS — Sebastian commits along the line to the first point off
    // the arena and falls there, always (CHARACTER_DESIGN: miss = void).
    // The fall is explicit because checkFalloff skips immune critters:
    // a freshly respawned Sebastian used to float over the void. The
    // old fixed jump (range × 1.5) also landed back on the arena when
    // he fired from the rim towards the centre — a free escape.
    const [fx, fz] = firstPointOffArena(critter.x, critter.z, dirX, dirZ);
    critter.x = fx;
    critter.z = fz;
    critter.markTeleported();
    critter.startFalling();
    spawnShockwaveRing(scene, critter.x, critter.z, 1.4, palette);
    triggerCameraShake(FEEL.shake.headbutt * 0.9);
    playSound('abilityFire');
  }
}

/** First point along the line from (x, z), in FEEL.allIn.missProbeStep
 *  steps, that isn't on the arena (live fragments; the whole disc when no
 *  arena is wired, as in the lab). Server mirror: BrawlRoom's All-in miss. */
function firstPointOffArena(x: number, z: number, dirX: number, dirZ: number): [number, number] {
  const step = FEEL.allIn.missProbeStep;
  // No line from (x, z) stays on the disc longer than this; the bound
  // only guards the loop.
  const maxT = Math.hypot(x, z) + FRAG.maxRadius + step;
  let t = step;
  while (t < maxT && isOnLiveFloor(x + dirX * t, z + dirZ * t)) t += step;
  return [x + dirX * t, z + dirZ * t];
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

/** The share of any push from others the critter takes
 *  (Critter.knockbackScale): its active abilities' `knockbackTakenMult`,
 *  wind-up excluded like the mass buff. */
export function getKnockbackTakenMultiplier(states: AbilityState[]): number {
  let m = 1.0;
  for (const s of states) {
    if (s.active && s.windUpLeft <= 0) m *= s.def.knockbackTakenMult ?? 1;
  }
  return m;
}

/** × on the critter's own friction half-life (Critter.frictionScale): its
 *  active abilities' `slideFrictionMult` (Kowalski's Ice Slide), wind-up
 *  excluded. */
export function getFrictionMultiplier(states: AbilityState[]): number {
  let m = 1.0;
  for (const s of states) {
    if (s.active && s.windUpLeft <= 0) m *= s.def.slideFrictionMult ?? 1;
  }
  return m;
}

/** How many times farther a dash's impulse carries with its glide: the
 *  half-life × m (`slideFrictionMult`) for its active window T, then the
 *  normal friction h: m − (m − 1)·2^(−T/(h·m)). 1 without a glide; Ice
 *  Slide 2.16 (~4.7 u instead of ~2.2). The bot's edge probe (bot.ts)
 *  reaches that much farther. Server mirror: dashGlideFactor in
 *  server/src/sim/abilities.ts. */
export function dashGlideFactor(def: AbilityDef): number {
  const m = def.slideFrictionMult ?? 1;
  return m - (m - 1) * Math.pow(0.5, def.duration / (FEEL.movement.frictionHalfLife * m));
}

// ---------------------------------------------------------------------------
// Sebastian All-in hold-to-fire helpers (offline)
// ---------------------------------------------------------------------------

/**
 * Direction the All-in dash commits to. Always FORWARD relative to
 * Sebastian's current facing — no lateral auto-pick. Rafa's micro-
 * pass: "toda la habilidad L de Sebastian debe ir SIEMPRE hacia
 * delante respecto al facing actual". The player aims the facing while
 * holding L (advanceAllInCharge); the telegraph + dash use it.
 */
function pickAllInDir(critter: Critter): [number, number] {
  const ry = critter.mesh.rotation.y;
  return [Math.sin(ry), Math.cos(ry)];
}

function spawnAllInPreview(scene: THREE.Scene, critter: Critter, range: number, ttl: number): AllInPreview {
  const dir = pickAllInDir(critter);
  return spawnAllInTrajectoryPreview(scene, critter.x, critter.z, dir[0], dir[1], range, ttl);
}

/** The line each charging critter paints, from the start of its charge
 *  until it resolves or drops (release, cancel, stun, fall). */
const allInPreviews = new WeakMap<Critter, AllInPreview>();

function endAllInPreview(critter: Critter): void {
  allInPreviews.get(critter)?.end();
  allInPreviews.delete(critter);
}

/** `from` turned toward `to` by at most `maxStep` (radians), the short
 *  way round, wrapped to (-π, π] like the atan2 facings. */
function turnToward(from: number, to: number, maxStep: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const r = from + Math.max(-maxStep, Math.min(maxStep, diff));
  return Math.atan2(Math.sin(r), Math.cos(r));
}

/**
 * Sebastian started holding the L (the local player, or a bot in
 * src/bot.ts). Roots the caster and spawns the trajectory preview,
 * which follows his aim until the charge resolves or drops — at the
 * latest, the holdToFireMaxMs auto-release.
 * Idempotent: calling while already charging is a no-op.
 */
export function startSebastianAllInCharge(critter: Critter, scene: THREE.Scene): void {
  if (critter.lHoldCharging || critter.stunTimer > 0) return;
  const lState = critter.abilityStates[2];
  if (!lState || lState.cooldownLeft > 0 || lState.active) return;
  if (!lState.def.allInL || !lState.def.holdToFireL) return;
  critter.lHoldCharging = true;
  critter.lHoldChargeTime = 0;
  endAllInPreview(critter);
  allInPreviews.set(critter, spawnAllInPreview(scene, critter, lState.def.allInDashRange ?? 9,
    (lState.def.holdToFireMaxMs ?? 3000) / 1000));
  applyImpactFeedback(critter); // small "charging" pulse
  triggerCameraShake(FEEL.shake.groundPound * 0.15);
}

/**
 * One frame of an All-in charge, for the player and the bots alike:
 * ages it and aims it. The caster is rooted, so the facing rule of
 * Critter.update (follow the velocity) turns nothing; while charging it
 * stands aside and the move input turns the facing instead, toward the
 * pushed direction at FEEL.allIn.aimTurnDegPerSec, the short way round.
 * No input keeps the aim. The line follows the facing and the caster (a
 * shove moves him). Server: pending in BrawlRoom's integrate step, with
 * SIM.allIn.aimTurnDegPerSec (DISTRIBUCIÓN, buzón fase 2); online the
 * charge still keeps the facing it started with.
 */
export function advanceAllInCharge(critter: Critter, dt: number): void {
  critter.lHoldChargeTime += dt;
  if (critter.hasInput) {
    critter.mesh.rotation.y = turnToward(
      critter.mesh.rotation.y,
      Math.atan2(critter.moveX, critter.moveZ),
      THREE.MathUtils.degToRad(FEEL.allIn.aimTurnDegPerSec) * dt,
    );
  }
  const [dirX, dirZ] = pickAllInDir(critter);
  allInPreviews.get(critter)?.aim(critter.x, critter.z, dirX, dirZ);
}

/**
 * Drop an All-in charge without resolving it: no dash, no cooldown.
 * The bot AI's way out when its lane emptied while it held; a stun
 * or a fall drops it too.
 */
export function cancelSebastianAllInCharge(critter: Critter): void {
  critter.lHoldCharging = false;
  critter.lHoldChargeTime = 0;
  endAllInPreview(critter);
}

/**
 * Sebastian let go of the L (or the auto-release timer fired): runs
 * the dash resolution along the current facing and starts the
 * cooldown. A charge younger than the def's `holdToFireMinMs` doesn't
 * resolve yet: the call does nothing and the caller tries again next
 * frame, so a tap goes off exactly when the minimum is reached
 * (2026-09-24, Rafa: a tap used to erase someone in one ~33 ms step,
 * with no time to read the line).
 */
export function releaseSebastianAllInCharge(
  critter: Critter,
  allCritters: Critter[],
  scene: THREE.Scene,
): void {
  if (!critter.lHoldCharging) return;
  const lState = critter.abilityStates[2];
  if (lState && critter.lHoldChargeTime < (lState.def.holdToFireMinMs ?? 0) / 1000) return;
  critter.lHoldCharging = false;
  critter.lHoldChargeTime = 0;
  endAllInPreview(critter);
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
    advanceAllInCharge(critter, dt);
    const maxSec = (lState.def.holdToFireMaxMs ?? 3000) / 1000;
    // Let go before holdToFireMinMs and the release waits for the
    // minimum; press the L again by then and the charge simply goes on.
    if (!held || critter.lHoldChargeTime >= maxSec) {
      releaseSebastianAllInCharge(critter, allCritters, scene);
    }
  } else if (held && lState.cooldownLeft <= 0 && !lState.active) {
    startSebastianAllInCharge(critter, scene);
  }
}
