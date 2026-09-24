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
//            skipPhysics, the Run clip's phase, RUN_GAIT (measured stride),
//            FEEL.locomotion / FEEL.runCadence (taste) and whether the
//            knockback lean is playing (gamefeel isKnockbackLeaning)
//   - writes: body.position.y, glbMesh.position.y, glbMesh.rotation.x,
//             glbMesh.rotation.z, glbMesh.scale.{x,y,z},
//             visualPivot.rotation.y (the model's turn lag)
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
import { FEEL, isKnockbackLeaning } from './gamefeel';
import { PERSONALITY_OVERRIDES } from './animation-personality-overrides';
import { RUN_GAIT } from './critter-locomotion';

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
 * config fields needed — personality is a pure function of (mass, speed),
 * plus any hand-tuned exceptions from PERSONALITY_OVERRIDES (keyed by
 * `config.name`, sparse — see animation-personality-overrides.ts).
 *
 * Heavy (mass ≥ 1.3): slow deep breathing, heavy footfalls, small lean, tiny sway.
 * Light (mass ≤ 0.85): fast shallow breathing, snappy bounce, big lean, lively sway.
 * Fast (speed ≥ 11): quicker run cadence, aggressive lean.
 * Slow (speed ≤ 8):  sedate cadence, minimal lean.
 */
export function deriveAnimationPersonality(
  config: { mass: number; speed: number; name?: string },
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

  const derived: AnimationPersonality = {
    idleBobHz,
    idleBobAmp,
    runBounceHz,
    runBounceAmp,
    leanRadians,
    runSwayRadians,
    chargeStretchMult,
  };

  // Authored exceptions win over the formula (sparse per-field).
  const overrides = config.name ? PERSONALITY_OVERRIDES[config.name] : undefined;
  return overrides ? { ...derived, ...overrides } : derived;
}

const BODY_BASE_Y = 0.5;
const SPEED_DEADZONE = 0.3;  // below this we still apply idle-only bob

/**
 * The critter's real top speed with the stick held (u/s): the terminal
 * velocity of accelerating at `speed × accelerationScale` against a
 * friction of half-life `frictionHalfLife`. Measured in game: 1.4-3.1 u/s
 * across the roster. Run intensity used to be normalised by a fixed 15,
 * so the lean/sway designed for "full run" peaked at 9-21 % of their
 * value. Base `config.speed` on purpose: a slowing zone reads as a
 * smaller lean, a frenzy buff just saturates at 1.
 */
function runTopSpeed(critter: Critter): number {
  const m = FEEL.movement;
  // A bot runs at a fraction of a player's acceleration, so its top speed
  // is lower — without this a bot never passed ~57 % run intensity and
  // looked like it was strolling. Offline bots write `pace` (bot.ts);
  // online ones are flagged by the server (isBot) and use the same FEEL
  // value their SIM mirror is pinned to.
  const pace = critter.isBot ? FEEL.bots.moveAccelFactor : critter.pace;
  return (critter.config.speed * m.accelerationScale * pace * m.frictionHalfLife) / Math.LN2;
}

/**
 * Visual turn: the gameplay facing (mesh.rotation.y) still snaps to the
 * velocity every frame — headbutts and abilities fire along it — but the
 * model hangs from `visualPivot`, whose yaw absorbs each jump and decays
 * with FEEL.locomotion.turnHalfLife (≈90 % in 80 ms). A 180° reversal
 * reads as a quick turn instead of a one-frame flip. When a blow starts
 * (headbutt wind-up/lunge, any ability) the lag snaps to 0 so it comes
 * out of the critter's front.
 *
 * While the knockback lean lasts the lag does not decay: the push flips
 * the facing toward where the critter is flung, and turning its back on
 * the hitter mid-flight made the lean read as a sprint. It keeps facing
 * the blow and turns once the lean is over (or at once if it strikes).
 */
function tickTurn(critter: Critter, dt: number): void {
  const pivot = critter.visualPivot;
  if (!pivot) return;
  const facing = critter.mesh.rotation.y;
  if (!Number.isFinite(critter.lastFacingY)) critter.lastFacingY = facing;
  const jump = wrapAngle(facing - critter.lastFacingY);
  critter.lastFacingY = facing;
  const striking =
    critter.headbuttAnticipating ||
    critter.isHeadbutting ||
    critter.abilityStates.some((s) => s.active);
  if (striking) {
    critter.visualYawLag = 0;
  } else {
    critter.visualYawLag = wrapAngle(critter.visualYawLag - jump);
    if (!isKnockbackLeaning(critter)) {
      critter.visualYawLag *= Math.pow(0.5, dt / FEEL.locomotion.turnHalfLife);
    }
  }
  pivot.rotation.y = critter.visualYawLag;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Run share of the locomotion pose at this forward ground speed: 0 when
 * standing, 1 from `FEEL.locomotion.runBlendSpeed` up, smoothstep in
 * between. Presentation only.
 */
export function runShare(speed: number): number {
  const t = Math.min(1, Math.max(0, speed / FEEL.locomotion.runBlendSpeed));
  return t * t * (3 - 2 * t);
}

/**
 * Playback rate for the Run clip at the critter's current ground speed,
 * or null when there is no measured gait (the caller then keeps the
 * authored rate). `plant` is the rate at which the clip sweeps the feet
 * back exactly as fast as the ground passes under them; the per-critter
 * `FEEL.runCadence` bias and the clamps are taste. The floor
 * (`runRateMin`) only holds while the run fills the pose: as it blends
 * out towards idle the legs slow down with the ground to a stop, so a
 * braking foot stays planted instead of sweeping on. Presentation only.
 */
export function runPlaybackRate(critter: Critter, speed: number): number | null {
  const id = critter.rosterEntry?.id;
  const gait = id ? RUN_GAIT[id] : undefined;
  const duration = critter.skeletal?.getClipDuration('run');
  const scale = critter.glbMesh?.scale.x;
  if (!id || !gait || !duration || !scale) return null;
  const plant = speed / (gait.stride * scale);
  const bias = (FEEL.runCadence as Record<string, number>)[id] ?? 1;
  const loco = FEEL.locomotion;
  const floor = loco.runRateMin * runShare(speed);
  return Math.min(Math.max(plant * bias, floor), loco.runCadenceMaxHz * duration);
}

// Headbutt motion targets — applied to glbMesh.rotation.x / scale.y / position.y
// Calibrated against FEEL.headbutt anticipation/lunge durations (0.12s + 0.15s)
// so the wind-up feels like a real coil and the lunge reads as a decisive thrust.
const HEADBUTT_ANTICIP_PITCH = -0.22;  // backward pitch during wind-up (rad)
const HEADBUTT_LUNGE_PITCH   = +0.38;  // forward pitch during lunge (rad)
const HEADBUTT_ANTICIP_SQUASH = 0.86;  // vertical squash during wind-up
const HEADBUTT_LUNGE_STRETCH  = 1.08;  // vertical stretch during lunge
const HEADBUTT_LUNGE_FORWARD  = 0.14;  // small forward Y drop + Z offset on lunge

/** Per critter, visual state only: the smoothed forward acceleration, and
 *  the smoothed lean the accents ride on (so they keep their snap instead
 *  of being eased by the slow run-lean lerp). */
const accentState = new WeakMap<Critter, { prevForward: number; accel: number; pitch: number; start: number; stop: number }>();

/**
 * Start / stop accents, 0..1 each: how hard the MODEL is speeding up or
 * braking along the way it faces, in top speeds per second, against
 * FEEL.locomotion.accent{Start,Stop}Full. Silent while something else owns
 * the pose (a strike, a charge, the knockback lean) — being shoved is not
 * braking — and fading in and out over accentFade, so a strike starting
 * or ending doesn't snap the lean.
 */
function tickAccents(critter: Critter, dt: number, quiet: boolean): { start: number; stop: number; state: { pitch: number } } {
  const loco = FEEL.locomotion;
  const forward = critter.forwardGroundSpeed();
  let s = accentState.get(critter);
  if (!s) {
    s = { prevForward: forward, accel: 0, pitch: critter.glbMesh?.rotation.x ?? 0, start: 0, stop: 0 };
    accentState.set(critter, s);
  }
  const raw = dt > 0 ? (forward - s.prevForward) / dt : 0;
  s.prevForward = forward;
  s.accel += (raw - s.accel) * Math.min(1, dt / loco.accentSmoothing);
  const silent = quiet || isKnockbackLeaning(critter);
  const a = s.accel / Math.max(0.1, runTopSpeed(critter));
  const start = silent ? 0 : Math.min(1, Math.max(0, a / loco.accentStartFull));
  const stop = silent ? 0 : Math.min(1, Math.max(0, -a / loco.accentStopFull));
  const maxStep = dt / loco.accentFade;
  s.start += Math.max(-maxStep, Math.min(maxStep, start - s.start));
  s.stop += Math.max(-maxStep, Math.min(maxStep, stop - s.stop));
  return { start: s.start, stop: s.stop, state: s };
}

// Lerp speeds (per second). Higher = snappier transitions.
const LEAN_LERP_RUN = 10;
const LEAN_LERP_HEADBUTT = 30;
// Sway follows a wave that can run at 4-6 Hz on the small-stride rigs; at
// the old 10/s the lag ate half the amplitude and shifted it off the feet.
const SWAY_LERP = 25;

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

  tickTurn(critter, dt);

  // Skeletal suppression: when a "heavy" clip is active the procedural
  // layer steps back from the root transforms it would otherwise fight
  // for. Light states (idle/walk/run) coexist with lean/sway/scale.
  const skeletalHeavy = critter.skeletal?.isHeavyClipActive() ?? false;
  // Looping clip (idle/walk/run) is playing → the clip already owns the
  // breathing / footfall cadence, so we drop the procedural vertical
  // bob to avoid doubling it up (visible as "jumping" in the character
  // select preview before this guard). Lean / sway / scale still apply
  // because those channels are untouched by Tripo / Mixamo clips.
  const skeletalLoop = critter.skeletal?.isLoopingClipActive() ?? false;

  const vMag = Math.sqrt(critter.vx * critter.vx + critter.vz * critter.vz);
  const moving = vMag > SPEED_DEADZONE;
  const fullRunSpeed = runTopSpeed(critter) * FEEL.locomotion.topSpeedReach;
  const runIntensity = moving ? Math.min(vMag / fullRunSpeed, 1) : 0;

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
  // When a skeletal loop clip is playing, the bob/bounce are zeroed so
  // the clip's authored cadence reads cleanly. Critters without clips
  // keep the procedural baseline.
  const idleBob = skeletalLoop
    ? 0
    : Math.sin(t * p.idleBobHz * Math.PI * 2) * p.idleBobAmp;
  const runBounce = skeletalLoop
    ? 0
    : Math.abs(Math.sin(t * p.runBounceHz * Math.PI)) *
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

  // Prefer live tooling override (set by /calibrate.html sliders) over
  // the static roster value. Keeps the game path identical — override is
  // always undefined in-match.
  const pivotY =
    critter.rosterOverride?.pivotY ??
    critter.rosterEntry?.pivotY ??
    0;
  critter.glbMesh.position.y = pivotY + yOffset;

  const accent = tickAccents(critter, dt, headbuttActive || chargeActive > 0 || skeletalHeavy);
  const loco = FEEL.locomotion;

  // --- Forward pitch (lean) ---
  // Priority: headbutt lunge > headbutt anticipation > run lean. The start
  // / stop accents (pushed forward to get going, planted back to brake)
  // ride on top of the eased lean without being eased themselves — the
  // acceleration they come from is already smoothed, and easing them again
  // turned a stop into a slow 7° sag. Skipped when a heavy skeletal clip
  // is active — the clip's pose owns the root rotation and we don't want
  // to fight it with lerp drift.
  if (skeletalHeavy) {
    accent.state.pitch = critter.glbMesh.rotation.x;
  } else {
    const headbuttPitchTarget =
      HEADBUTT_ANTICIP_PITCH * antBlend + HEADBUTT_LUNGE_PITCH * lungeBlend;
    const runPitchTarget = runIntensity * p.leanRadians;
    const pitchTarget = headbuttActive ? headbuttPitchTarget : runPitchTarget;

    const pitchLerp = Math.min(
      1,
      dt * (headbuttActive ? LEAN_LERP_HEADBUTT : LEAN_LERP_RUN),
    );
    accent.state.pitch += (pitchTarget - accent.state.pitch) * pitchLerp;
    critter.glbMesh.rotation.x = accent.state.pitch +
      accent.start * loco.accentStartLean - accent.stop * loco.accentStopLean;

    // --- Side-to-side sway while running (rotation.z) ---
    // Body roll over the foot that is on the ground: rides the Run clip's
    // own phase when the gait is measured (so it follows the legs at any
    // speed), else the free-running bounce clock. At the middle of the
    // left foot's contact the top leans left (+X in mesh space → negative
    // roll; the GLB's Euler order is XZY so this is a true roll even on
    // the Tripo rigs turned -90°). Zero during headbutt so the pose stays
    // crisp.
    const gait = critter.rosterEntry ? RUN_GAIT[critter.rosterEntry.id] : undefined;
    const runPhase = gait ? (critter.skeletal?.getCurrentPhase('run') ?? null) : null;
    const swayWave = gait && runPhase !== null
      ? -Math.cos((runPhase - gait.leftPhase) * Math.PI * 2)
      : Math.sin(t * p.runBounceHz * Math.PI * 2);
    const swayTarget =
      swayWave *
      p.runSwayRadians *
      runIntensity *
      (1 - Math.min(1, antBlend + lungeBlend));
    const swayLerp = Math.min(1, dt * SWAY_LERP);
    critter.glbMesh.rotation.z +=
      (swayTarget - critter.glbMesh.rotation.z) * swayLerp;
    // The roll pivots on the model's origin, between the feet, so it
    // would push the planted foot into the floor (~3 cm on Kowalski's
    // waddle). Lift the body by that much: the roll turns about the
    // planted foot instead, and the other foot is in the air anyway.
    if (gait) {
      critter.glbMesh.position.y +=
        gait.halfWidth * critter.glbMesh.scale.x * Math.abs(Math.sin(critter.glbMesh.rotation.z));
    }
  }

  // --- Scale (x, y, z) ---
  // Roster (or /calibrate override) scale × the height fit measured at
  // attach, so every critter stands IN_GAME_TARGET_HEIGHT tall. Writing
  // the bare roster scale here is what used to undo the fit at "GO!".
  const baseScale =
    (critter.rosterOverride?.scale ?? critter.rosterEntry!.scale) *
    critter.glbFitFactor;

  // Z stretch: charge_rush active envelope. (No start-accent stretch: it
  // scaled the stride about the origin and slid the planted foot ~2.6 cm
  // per start for a change the game camera barely shows — FEELING §7.11.)
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
  const squashY = gpSquash * headbuttY * (1 - accent.stop * loco.accentStopSquash);

  critter.glbMesh.scale.x = baseScale;
  // scale.y owns the squash/stretch channel — suppressed under heavy
  // skeletal clips so their pose reads with the intended proportions.
  critter.glbMesh.scale.y = skeletalHeavy ? baseScale : baseScale * squashY;
  // scale.z (charge stretch) stays — no known imported clip writes to it,
  // and the charge_rush visual boost still reads correctly.
  critter.glbMesh.scale.z = baseScale * stretchZ;
}
