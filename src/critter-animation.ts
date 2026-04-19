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
//   - reads: vx, vz, abilityStates, isHeadbutting, headbuttAnticipating,
//            skipPhysics
//   - writes: body.position.y, glbMesh.position.y, glbMesh.rotation.x,
//             glbMesh.rotation.z, glbMesh.scale.{x,y,z}
//
// Works identically in online and offline. In online mode Critter.update()
// runs with skipPhysics=true; vx/vz/isHeadbutting are set from the server
// each tick, so the motion layer picks up the right signal without any
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
  /** Side-to-side sway amplitude while running (radians). */
  runSwayRadians: number;
  /** Multiplier on the charge_rush forward stretch. Faster → snappier. */
  chargeStretchMult: number;
}

/**
 * Derive animation parameters from a critter's gameplay stats. No new
 * config fields needed — personality is a pure function of (mass, speed).
 *
 * Heavy (mass ≥ 1.3): slow deep breathing, heavy footfalls, small lean, tiny sway.
 * Light (mass ≤ 0.85): fast shallow breathing, snappy bounce, big lean, lively sway.
 * Fast (speed ≥ 11): quicker run cadence, aggressive lean.
 * Slow (speed ≤ 8):  sedate cadence, minimal lean.
 */
export function deriveAnimationPersonality(
  config: { mass: number; speed: number },
): AnimationPersonality {
  const m = config.mass;
  const s = config.speed;

  const mRel = Math.max(0.7, Math.min(1.5, m));
  const sRel = Math.max(6, Math.min(13, s));

  const idleBobHz = 1.3 - (mRel - 0.85) * 0.8;
  const idleBobAmp = 0.03 + (mRel - 0.7) * 0.08;

  const runBounceHz = 1.8 + (sRel - 6) * 0.2;
  const runBounceAmp = 0.08 + (mRel - 0.7) * 0.10;

  const leanRadians = 0.12 + (sRel - 8) * 0.018;

  // Light critters sway their body noticeably while running; heavy ones
  // barely move laterally. Range ≈ 0.02..0.09 rad (1..5°).
  const runSwayRadians = 0.09 - (mRel - 0.7) * 0.07;

  const chargeStretchMult = 0.6 + (sRel - 6) * 0.09;

  return {
    idleBobHz,
    idleBobAmp,
    runBounceHz,
    runBounceAmp,
    leanRadians,
    runSwayRadians,
    chargeStretchMult,
  };
}

const BODY_BASE_Y = 0.5;
const SPEED_NORM = 15;       // velocity magnitude that maps to run intensity = 1
const SPEED_DEADZONE = 0.3;  // below this we still apply idle-only bob

// Headbutt motion targets — applied to glbMesh.rotation.x / scale.y / position.y
// Calibrated against FEEL.headbutt anticipation/lunge durations (0.12s + 0.15s)
// so the wind-up feels like a real coil and the lunge reads as a decisive thrust.
const HEADBUTT_ANTICIP_PITCH = -0.22;  // backward pitch during wind-up (rad)
const HEADBUTT_LUNGE_PITCH   = +0.38;  // forward pitch during lunge (rad)
const HEADBUTT_ANTICIP_SQUASH = 0.86;  // vertical squash during wind-up
const HEADBUTT_LUNGE_STRETCH  = 1.08;  // vertical stretch during lunge
const HEADBUTT_LUNGE_FORWARD  = 0.14;  // small forward Y drop + Z offset on lunge

// Lerp speeds (per second). Higher = snappier transitions.
const LEAN_LERP_RUN = 10;
const LEAN_LERP_HEADBUTT = 30;

/**
 * Main tick. Call every frame from Critter.update() BEFORE updateVisuals
 * (so visual feedback can stack emissive on top without us overwriting it).
 *
 * When a skeletal animator is playing a HEAVY clip (victory, defeat,
 * ability_N, headbutt_lunge, fall, hit), this function SKIPS writes to
 * the root transforms that the clip's pose would own (rotation.x/z,
 * scale.y). Scale.z (charge stretch) and body.position.y bob still
 * apply because neither Mixamo nor Tripo clips ever write those.
 */
export function tickProceduralAnimation(critter: Critter, dt: number): void {
  const p = critter.animPersonality;
  const t = performance.now() * 0.001;

  // Skeletal suppression: when a "heavy" clip is active the procedural
  // layer steps back from the root transforms it would otherwise fight
  // for. Light states (idle/walk/run) coexist with lean/sway/scale.
  const skeletalHeavy = critter.skeletal?.isHeavyClipActive() ?? false;

  const vMag = Math.sqrt(critter.vx * critter.vx + critter.vz * critter.vz);
  const moving = vMag > SPEED_DEADZONE;
  const runIntensity = moving ? Math.min(vMag / SPEED_NORM, 1) : 0;

  // --- Ability envelopes ---
  let chargeActive = 0;       // 0..1 triangular envelope during charge_rush active
  let groundPoundWindUp = 0;  // 0..1 while ground_pound is winding up (crouch)
  for (const s of critter.abilityStates) {
    if (!s.active) continue;
    if (s.def.type === 'charge_rush' && s.windUpLeft <= 0) {
      const total = s.def.duration || 0.0001;
      const elapsed = total - s.durationLeft;
      const halfway = total / 2;
      const env = 1 - Math.abs(elapsed - halfway) / halfway;
      chargeActive = Math.max(chargeActive, env);
    }
    if (s.def.type === 'ground_pound' && s.windUpLeft > 0) {
      const total = s.def.windUp || 0.0001;
      const prog = Math.min(1, 1 - s.windUpLeft / total);
      groundPoundWindUp = Math.max(groundPoundWindUp, prog);
    }
  }

  // --- Headbutt phase ---
  // critter.isHeadbutting and critter.headbuttAnticipating are public in
  // the Critter class; in online mode both are set from server state
  // before update() runs, so this reads correctly in both modes.
  const antBlend = critter.headbuttAnticipating ? 1 : 0;
  const lungeBlend = critter.isHeadbutting ? 1 : 0;
  const headbuttActive = antBlend + lungeBlend > 0;

  // --- Vertical bob (idle + run) + ability/headbutt offsets ---
  const idleBob = Math.sin(t * p.idleBobHz * Math.PI * 2) * p.idleBobAmp;
  const runBounce =
    Math.abs(Math.sin(t * p.runBounceHz * Math.PI)) *
    p.runBounceAmp *
    runIntensity;

  // Ground-pound wind-up drops the body (crouch before slam)
  const gpDrop = groundPoundWindUp * FEEL.groundPound.windUpHeadDrop; // negative
  // Headbutt: tiny drop as the critter steps into the lunge
  const headbuttDrop = -HEADBUTT_LUNGE_FORWARD * lungeBlend * 0.4;

  // When headbutting we want a clean pose, so dampen the idle/run bob
  const bobScale = headbuttActive ? 0.15 : 1;
  const yOffset =
    (idleBob * (1 - runIntensity * 0.6) + runBounce) * bobScale +
    gpDrop +
    headbuttDrop;

  critter.body.position.y = BODY_BASE_Y + yOffset;

  if (!critter.glbMesh) return;

  const pivotY = critter.rosterEntry?.pivotY ?? 0;
  critter.glbMesh.position.y = pivotY + yOffset;

  // --- Forward pitch (lean) ---
  // Priority: headbutt lunge > headbutt anticipation > run lean.
  // Skipped when a heavy skeletal clip is active — the clip's pose owns
  // the root rotation and we don't want to fight it with lerp drift.
  if (!skeletalHeavy) {
    const headbuttPitchTarget =
      HEADBUTT_ANTICIP_PITCH * antBlend + HEADBUTT_LUNGE_PITCH * lungeBlend;
    const runPitchTarget = runIntensity * p.leanRadians;
    const pitchTarget = headbuttActive ? headbuttPitchTarget : runPitchTarget;

    const pitchLerp = Math.min(
      1,
      dt * (headbuttActive ? LEAN_LERP_HEADBUTT : LEAN_LERP_RUN),
    );
    critter.glbMesh.rotation.x +=
      (pitchTarget - critter.glbMesh.rotation.x) * pitchLerp;

    // --- Side-to-side sway while running (rotation.z) ---
    // Subtle body roll at the run bounce cadence. Zero during headbutt so
    // the pose stays crisp.
    const swayTarget =
      Math.sin(t * p.runBounceHz * Math.PI * 2) *
      p.runSwayRadians *
      runIntensity *
      (1 - Math.min(1, antBlend + lungeBlend));
    const swayLerp = Math.min(1, dt * LEAN_LERP_RUN);
    critter.glbMesh.rotation.z +=
      (swayTarget - critter.glbMesh.rotation.z) * swayLerp;
  }

  // --- Scale (x, y, z) ---
  const baseScale = critter.rosterEntry!.scale;

  // Z stretch: charge_rush active envelope
  const stretchZ = 1 + chargeActive * 0.22 * p.chargeStretchMult;

  // Y squash/stretch: ground_pound windUp crouch + headbutt anticip/lunge.
  // Factors are multiplied so compound states work correctly:
  //   idle:              1   × 1    = 1.00
  //   anticip:           1   × 0.86 = 0.86
  //   lunge:             1   × 1.08 = 1.08
  //   gp windUp:         0.50× 1    = 0.50
  // Using Math.min instead of * would clip the >1 stretch at 1.
  const gpSquash = 1 - (1 - FEEL.groundPound.windUpSquash) * groundPoundWindUp;
  const headbuttY =
    1 -
    (1 - HEADBUTT_ANTICIP_SQUASH) * antBlend +
    (HEADBUTT_LUNGE_STRETCH - 1) * lungeBlend;
  const squashY = gpSquash * headbuttY;

  critter.glbMesh.scale.x = baseScale;
  // scale.y owns the squash/stretch channel — suppressed under heavy
  // skeletal clips so their pose reads with the intended proportions.
  critter.glbMesh.scale.y = skeletalHeavy ? baseScale : baseScale * squashY;
  // scale.z (charge stretch) stays — no known imported clip writes to it,
  // and the charge_rush visual boost still reads correctly.
  critter.glbMesh.scale.z = baseScale * stretchZ;
}
