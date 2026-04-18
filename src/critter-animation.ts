// ---------------------------------------------------------------------------
// Procedural animation — shared across the full roster
// ---------------------------------------------------------------------------
//
// First pass: give the 9 critters life through pure procedural motion.
// No bones, no clips, no per-character rigging. Parameters (bob freq/amp,
// run bounce, lean amount) are DERIVED from stats (mass, speed) so heavier
// critters breathe slower and deeper while lighter/faster ones bounce
// more and lean harder.
//
// This layer is PRESENTATION ONLY. It never writes to fields that drive
// gameplay or networking:
//   - reads: vx, vz, abilityStates, skipPhysics
//   - writes: body.position.y, glbMesh.position.y, glbMesh.rotation.x
//
// Works identically in online and offline. In online mode Critter.update()
// runs with skipPhysics=true; vx/vz are set from the server each tick, so
// the motion layer picks up the right "is running" signal without any
// extra code.
//
// Future (Tripo3D, skeletal clips, etc.) can layer on TOP of this:
//   - an idle pose clip could replace the breath-bob baseline for GLB meshes,
//     and this layer's lean/bounce would still apply on top.
//   - a celebratory skeletal clip could fire on victory while this layer
//     stays passive (zero amp) during the ended phase.
// No dependency added now.
// ---------------------------------------------------------------------------

import type { Critter } from './critter';
import { FEEL } from './gamefeel';

export interface AnimationPersonality {
  /** Idle breathing rate (Hz). Heavier critters breathe slower. */
  idleBobHz: number;
  /** Idle breathing amplitude (world units). Heavier → deeper. */
  idleBobAmp: number;
  /** Run bounce rate (Hz). Faster critters bounce quicker. */
  runBounceHz: number;
  /** Run bounce amplitude (world units). Heavier → bigger footfall bob. */
  runBounceAmp: number;
  /** Forward pitch at full-speed run (radians). Faster → lean harder. */
  leanRadians: number;
  /** Multiplier on the charge_rush forward stretch. Faster → snappier. */
  chargeStretchMult: number;
}

/**
 * Derive animation parameters from a critter's gameplay stats. No new
 * config fields needed — personality is a pure function of (mass, speed).
 *
 * Heavy (mass ≥ 1.3): slow deep breathing, heavy footfalls, small lean.
 * Light (mass ≤ 0.85): fast shallow breathing, snappy bounce, big lean.
 * Fast (speed ≥ 11): quicker run cadence, aggressive lean.
 * Slow (speed ≤ 8):  sedate cadence, minimal lean.
 */
export function deriveAnimationPersonality(
  config: { mass: number; speed: number },
): AnimationPersonality {
  const m = config.mass;
  const s = config.speed;

  // Map mass 0.7..1.5 → relative factor 0.7..1.5, clamp-safe
  const mRel = Math.max(0.7, Math.min(1.5, m));
  const sRel = Math.max(6, Math.min(13, s));

  // Heavier → slower breath (down to 0.7 Hz), lighter → faster (up to 1.3 Hz)
  const idleBobHz = 1.3 - (mRel - 0.85) * 0.8;
  // Heavier → deeper bob (0.06..0.09), lighter → shallower (0.03..0.05)
  const idleBobAmp = 0.03 + (mRel - 0.7) * 0.08;

  // Faster → quicker footfalls
  const runBounceHz = 1.8 + (sRel - 6) * 0.2;
  // Heavier → bigger bounce on each step
  const runBounceAmp = 0.08 + (mRel - 0.7) * 0.10;

  // Faster → deeper forward lean (8°..18°)
  const leanRadians = 0.12 + (sRel - 8) * 0.018;

  // Charge stretch scales with speed stat — Cheeto/Kurama stretch snappily,
  // Shelly/Trunk barely flex.
  const chargeStretchMult = 0.6 + (sRel - 6) * 0.09;

  return {
    idleBobHz,
    idleBobAmp,
    runBounceHz,
    runBounceAmp,
    leanRadians,
    chargeStretchMult,
  };
}

// Body sphere is centred at y=BODY_RADIUS (see Critter). Constant kept in
// sync with critter.ts; if that constant ever moves we'll notice because
// the procedural fallback will visibly float or clip.
const BODY_BASE_Y = 0.5;
const SPEED_NORM = 15;       // velocity magnitude that maps to run intensity = 1
const SPEED_DEADZONE = 0.3;  // below this we still apply idle-only bob

// Cached lean target per critter, interpolated smoothly
const LEAN_LERP_PER_SEC = 10;

/**
 * Main tick. Call every frame from Critter.update() BEFORE updateVisuals
 * (so visual feedback can stack emissive on top without us overwriting it).
 */
export function tickProceduralAnimation(critter: Critter, dt: number): void {
  const p = critter.animPersonality;
  const t = performance.now() * 0.001;

  const vMag = Math.sqrt(critter.vx * critter.vx + critter.vz * critter.vz);
  const moving = vMag > SPEED_DEADZONE;
  const runIntensity = moving ? Math.min(vMag / SPEED_NORM, 1) : 0;

  // Idle breath — always present, softened (not eliminated) while moving
  const idleBob = Math.sin(t * p.idleBobHz * Math.PI * 2) * p.idleBobAmp;

  // Run bounce — asymmetric, using |sin| so it's a series of footfalls
  // rather than a symmetric wave. Only contributes while actually moving.
  const runBounce =
    Math.abs(Math.sin(t * p.runBounceHz * Math.PI)) *
    p.runBounceAmp *
    runIntensity;

  const yOffset = idleBob * (1 - runIntensity * 0.6) + runBounce;

  // Procedural body (always present as fallback). Body radius defines
  // the base y; the animation offsets on top of it.
  critter.body.position.y = BODY_BASE_Y + yOffset;

  if (!critter.glbMesh) return;

  const pivotY = critter.rosterEntry?.pivotY ?? 0;
  critter.glbMesh.position.y = pivotY + yOffset;

  // Forward lean while running. Smoothly interpolate to avoid snapping
  // on direction change. Applied as rotation.x of the GLB mesh.
  // The outer Critter mesh rotates around Y based on velocity heading,
  // so rotation.x on the inner glbMesh tilts "forward" in that heading.
  const leanTarget = runIntensity * p.leanRadians;
  const k = Math.min(1, dt * LEAN_LERP_PER_SEC);
  critter.glbMesh.rotation.x += (leanTarget - critter.glbMesh.rotation.x) * k;

  // Charge-rush stretch: during the active phase (not wind-up), scale
  // along Z forward. Reads the ability state the same way updateVisuals
  // does, so the timing stays locked to the real gameplay state.
  let chargeActive = 0;
  for (const s of critter.abilityStates) {
    if (!s.active || s.windUpLeft > 0 || s.def.type !== 'charge_rush') continue;
    // Fade in/out based on how much of the duration has elapsed
    const total = s.def.duration;
    const elapsed = total - s.durationLeft;
    const halfway = total / 2;
    // Triangular envelope: 0 → 1 → 0
    const env = 1 - Math.abs(elapsed - halfway) / halfway;
    chargeActive = Math.max(chargeActive, env);
  }
  const stretch = 1 + chargeActive * 0.22 * p.chargeStretchMult;
  critter.glbMesh.scale.z = critter.rosterEntry!.scale * stretch;
  // X/Y stay at the entry.scale — no lateral distortion, only forward stretch.

  // Safety: chargeStretchMult comes from FEEL-adjacent tuning; if FEEL is
  // ever hot-swapped at runtime we don't rebuild personality. Deliberate
  // acceptance for jam scope — it's a constant at construction time.
  void FEEL; // keep import tethered so tree-shaking respects the guarantee
}
