// ---------------------------------------------------------------------------
// fixed-step — the offline game simulates in steps of exactly 1/60 s
// ---------------------------------------------------------------------------
//
// Rafa, 2026-09-24 (decision 1 of the ability review): a push must carry
// the same whatever the monitor's refresh rate. With the frame's dt fed
// straight into the physics it didn't: the K pushed −27 % at 144 Hz and
// +29 % at 30 Hz (docs/REPASO_HABILIDADES_INFORME.md B1). The lab, the
// golden and the batch runner already simulate at a fixed 1/60 — the
// numbers everything is tuned at — so the live loop now does too.
//
// Two pieces, both pure (no three, no DOM):
//   - FixedStepClock turns real frame time into whole sim steps. The sim
//     runs up to one step AHEAD of the real clock, and alpha says where
//     "now" falls inside the last step.
//   - PoseInterpolator draws each critter between its last two sim poses
//     by that alpha, so at 144 Hz (0-1 steps per frame) motion stays
//     smooth instead of stepping every other frame. The sim pose lives on
//     mesh.position itself (Critter.x/z are getters on it), so the
//     interpolated pose is swapped in just for the render and restored
//     right after.
//
// Why ahead and not behind (the textbook "Fix your timestep" draws the
// PAST step): at 60 Hz that would show every frame one step late, 16.7 ms
// of extra input lag for most players. Ahead, a 60 Hz frame runs one step
// and draws it 1 ms short of its end (PHASE_MARGIN), like the old
// per-frame loop, and the input still applies from the step it was read
// in.
//
// Online doesn't use any of this: the server is authoritative and the
// client keeps its per-frame path (src/main.ts).
// ---------------------------------------------------------------------------

/** The sim step, s. Server mirror: SIM.tickRate × SIM.movement.integrationSubsteps. */
export const SIM_STEP = 1 / 60;
/** Most steps one frame may run; beyond that the game slows down instead
 *  of spiralling (below 15 fps with MAX_FRAME_DT). */
export const MAX_STEPS_PER_FRAME = 4;
/** Longest frame the clock accepts, s: a tab coming back from the
 *  background doesn't try to catch up seconds of play. */
export const MAX_FRAME_DT = 0.1;
/** A move longer than this in one step is drawn at the new spot instead of
 *  sliding through the arena, even if nobody flagged it as a teleport
 *  (PoseTarget.teleportSerial). */
export const SNAP_DISTANCE = 3.0;
/** The display is locked to the sim's cadence (60 Hz, 30 Hz…) when its
 *  last CADENCE_WINDOW frames sit, on average, within this of a whole
 *  number of steps, s; each locked frame then counts as exactly that many.
 *  ±0.15 ms is ±0.9 % at 60 Hz: 59.94 Hz locks, 59 Hz doesn't; 120 and
 *  144 Hz never do. Right at the band's edges (~59.5, ~60.5 Hz) the lock
 *  comes and goes and game time can stray up to ~1 %. */
export const CADENCE_SNAP = 0.00015;
/** Frames in that average. The average and not each frame: Safari and iOS
 *  floor rAF timestamps to 1 ms, so a 60 Hz display reports 16 and 17 ms
 *  frames, never near 16.67 on their own. Judged frame by frame it never
 *  locked: the phase never eased back (drawn up to a step late), and
 *  wherever it wandered within ~1 ms of a step's edge, frames ran 0 or 2
 *  steps (DISTRIBUCIÓN's review, 2026-09-25). Floored stamps telescope, so
 *  the average of 16 is off by < 1/16 ms, plus 2/16 of the stamps' own
 *  jitter: it holds up to ±0.7 ms of it. The window must be full to lock. */
const CADENCE_WINDOW = 16;
/** How far one frame may stray from a whole number of steps and still
 *  count as that many, s: a 1 ms timestamp tick plus jitter. Rates of
 *  ~54-68 Hz pass it; the average is what turns them down. */
const FRAME_TOLERANCE = 0.002;
/** The display sits this far behind the end of the newest step, s (and
 *  the clock starts there). A 60 Hz display left ON the step boundary
 *  flips between 2, 0 and 1 steps per frame with the rAF timestamps'
 *  jitter and rounding, and whatever isn't drawn between two steps
 *  stutters (review, 2026-09-25). 1 ms inside the step absorbs that
 *  jitter and costs 1 ms of display lag. */
const PHASE_MARGIN = 0.001;
/** While locked, how fast the phase eases back to PHASE_MARGIN after a
 *  hitch, s per frame: ~10 frames, the sim 5 % off meanwhile. Only once
 *  the lock has held more than a CADENCE_WINDOW: the resync credits the sim
 *  time it moves, and on frames that wander ±10 % around 60 Hz the lock
 *  comes and goes, so crediting after each unlocked frame ran the game
 *  ~1 % fast. */
const RESYNC_PER_FRAME = 0.05 * SIM_STEP;

/** Tolerance so 1/60-sized frames don't lose a step to float rounding. */
const STEP_EPSILON = 1e-6;

/**
 * Share of the way to its target that a `min(1, rate·dt)` lerp tuned at
 * one 1/60 step covers in `dt`, at any frame rate: the old value at
 * dt = SIM_STEP (to float rounding), n steps' worth over n·SIM_STEP, 0 at
 * dt = 0. For
 * presentation smoothing that now runs per frame instead of per step, so
 * its feel doesn't change with the refresh rate.
 */
export function lerpFactor(ratePerSec: number, dt: number): number {
  const perStep = Math.min(1, ratePerSec * SIM_STEP);
  return 1 - Math.pow(1 - perStep, dt / SIM_STEP);
}

export class FixedStepClock {
  /** Real time minus sim time, s: ≤ 0 after each frame (the sim is ahead). */
  private lag = -PHASE_MARGIN;
  /** How far the last frames within FRAME_TOLERANCE strayed from their
   *  whole steps, s (a ring, oldest overwritten). */
  private readonly residuals = new Float64Array(CADENCE_WINDOW);
  private residualCount = 0;
  private nextResidual = 0;
  /** Consecutive locked frames. */
  private lockedRun = 0;

  /**
   * Adds one frame of real time. Returns how many sim steps to run now so
   * the sim reaches or passes the real clock, and alpha ∈ (0, 1]: where the
   * real "now" falls inside the last step (1 = at its end). A backlog past
   * MAX_STEPS_PER_FRAME is dropped (slow motion, never a spiral).
   */
  advance(frameDt: number): { steps: number; alpha: number } {
    let dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    const whole = Math.round(dt / SIM_STEP);
    const locked = whole >= 1 && this.onCadence(dt - whole * SIM_STEP);
    this.lockedRun = locked ? this.lockedRun + 1 : 0;
    if (locked) dt = whole * SIM_STEP;
    this.lag += dt;
    let steps = Math.max(0, Math.ceil(this.lag / SIM_STEP - STEP_EPSILON));
    if (steps > MAX_STEPS_PER_FRAME) {
      // Dropped backlog: land at the phase margin, not on the step's edge
      // (a first frame that compiles shaders, before any lock can ease it).
      steps = MAX_STEPS_PER_FRAME;
      this.lag = SIM_STEP * steps - PHASE_MARGIN;
    }
    this.lag -= steps * SIM_STEP;
    if (this.lockedRun > CADENCE_WINDOW) {
      const toPhase = -PHASE_MARGIN - this.lag;
      this.lag += Math.max(-RESYNC_PER_FRAME, Math.min(RESYNC_PER_FRAME, toPhase));
    }
    return { steps, alpha: Math.min(1, Math.max(1 + this.lag / SIM_STEP, STEP_EPSILON)) };
  }

  reset(): void {
    this.lag = -PHASE_MARGIN;
    this.residualCount = 0;
    this.nextResidual = 0;
    this.lockedRun = 0;
  }

  /** Whether a frame `residual` s off its whole steps is on the display's
   *  cadence: near enough itself, and the last CADENCE_WINDOW such frames
   *  on average. */
  private onCadence(residual: number): boolean {
    if (Math.abs(residual) > FRAME_TOLERANCE) return false;
    this.residuals[this.nextResidual] = residual;
    this.nextResidual = (this.nextResidual + 1) % CADENCE_WINDOW;
    this.residualCount = Math.min(this.residualCount + 1, CADENCE_WINDOW);
    if (this.residualCount < CADENCE_WINDOW) return false;
    let sum = 0;
    for (const r of this.residuals) sum += r;
    return Math.abs(sum / CADENCE_WINDOW) <= CADENCE_SNAP;
  }
}

/**
 * Game time as presentation shows it. The sim reports the game time each
 * step covered (0 while the match is paused or a hit stop freezes it);
 * each frame asks how far the picture moves on: the game time at the drawn
 * instant (alpha inside the newest step) minus the last one shown. A
 * 0-step frame at 144 Hz moves it by its share of a step, a 4-step frame
 * (slow motion, the lab's fixed mode) by four steps, a freeze by nothing.
 * Never negative. Not the frame's real dt: presentation (clips tuned to
 * ability windows, the decoy's life) runs on game time.
 */
export class PresentClock {
  private stepStart = 0; // game time when the newest step began
  private stepEnd = 0;   // … and when it ended
  private shown = 0;     // game time of the last frame asked for

  /** Once per sim step (or per update online): the game time it covered. */
  onStep(gameDt: number): void {
    this.stepStart = this.stepEnd;
    this.stepEnd += gameDt;
  }

  /** Once per frame, with FixedStepClock's alpha (1 when not
   *  interpolating). Returns the game time to present. Consumed even if
   *  the caller then presents less (a freeze drops ≤ 1 step of animation,
   *  never adds). */
  onFrame(alpha: number): number {
    const t = this.stepStart + (this.stepEnd - this.stepStart) * alpha;
    const dt = Math.max(0, t - this.shown);
    this.shown += dt;
    return dt;
  }
}

/** Anything drawn at mesh.position whose sim pose lives there too. */
export interface PoseTarget {
  readonly mesh: { readonly position: { x: number; y: number; z: number } };
  /** Bumped by the sim when it moves the target by assignment instead of
   *  by velocity (Critter.markTeleported): drawn at the new spot, never in
   *  between. */
  readonly teleportSerial?: number;
}

interface Pose { x: number; y: number; z: number }

export class PoseInterpolator<T extends PoseTarget> {
  /** Pose (and teleport serial) of each target before the last sim step. */
  private readonly previous = new Map<T, Pose & { serial: number | undefined }>();
  /** Sim poses swapped out while an interpolated one is drawn. */
  private readonly swapped = new Map<T, Pose>();

  /** Call right before each sim step: remembers where everyone was. */
  capture(targets: readonly T[]): void {
    this.previous.clear();
    for (const t of targets) {
      const p = t.mesh.position;
      this.previous.set(t, { x: p.x, y: p.y, z: p.z, serial: t.teleportSerial });
    }
  }

  /**
   * Moves every target to lerp(previous, sim, alpha) for drawing. Targets
   * with no previous pose (new this step), teleported this step, or that
   * jumped more than SNAP_DISTANCE stay at their sim pose. Pair every
   * apply with restore.
   */
  apply(targets: readonly T[], alpha: number): void {
    this.swapped.clear();
    for (const t of targets) {
      const prev = this.previous.get(t);
      if (!prev || prev.serial !== t.teleportSerial) continue;
      const p = t.mesh.position;
      const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
      if (dx * dx + dy * dy + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE) continue;
      this.swapped.set(t, { x: p.x, y: p.y, z: p.z });
      p.x = prev.x + dx * alpha;
      p.y = prev.y + dy * alpha;
      p.z = prev.z + dz * alpha;
    }
  }

  /** Puts the sim poses back after drawing. */
  restore(): void {
    for (const [t, pose] of this.swapped) {
      const p = t.mesh.position;
      p.x = pose.x; p.y = pose.y; p.z = pose.z;
    }
    this.swapped.clear();
  }

  /** Forgets everything (entering online, leaving the offline path). */
  clear(): void {
    this.restore();
    this.previous.clear();
  }
}
