import type { Critter } from './critter';

// ---------------------------------------------------------------------------
// Tuning — ALL game feel values centralized here
// ---------------------------------------------------------------------------

export const FEEL = {
  // --- Movement ---
  movement: {
    frictionHalfLife: 0.08,   // seconds for velocity to halve (slightly less aggressive for higher top speed)
    idleFrictionHalfLife: 0.03, // much faster stop when no input is held
    maxSpeed: 20,             // raised to let Rojo actually feel fast
    accelerationScale: 1.6,   // snappy response
    velocityDeadZone: 0.15,   // below this speed → snap to 0 (kills micro-drift)
  },

  // --- Headbutt ---
  headbutt: {
    anticipation: {
      duration: 0.12,         // wind-up time (readable but quick)
      headRetract: -0.30,     // head pulls back (visible coil)
      bodySquash: 0.70,       // body compresses during wind-up
    },
    lunge: {
      duration: 0.15,         // snap forward (shorter = sharper)
      headExtend: 0.45,       // head reaches further
      velocityBoost: 4.0,     // micro-lunge: critter steps into the hit
    },
    cooldown: 0.45,           // recovery time
    recoilFactor: 0.35,       // attacker bounces back on connect
  },

  // --- Collision ---
  collision: {
    normalPushForce: 3.0,     // casual bumps are gentle nudges
    headbuttMultiplier: 3.5,  // headbutt = headbuttForce * this (Rojo: 14*3.5=49)
  },

  // --- Charge Rush ---
  chargeRush: {
    impulse: 16,              // directional velocity burst
    speedMultiplier: 2.5,     // speed during charge
    massMultiplier: 2.0,      // weight during charge (freight train)
    duration: 0.30,           // shorter but intense
    cooldown: 4.0,
    steerFactor: 0.15,        // input reduced to 15% during charge (commitment)
    windUp: 0.06,             // micro-anticipation before launch
  },

  // --- Ground Pound ---
  groundPound: {
    windUp: 0.35,             // visible charge-up
    slowDuringWindUp: 0.15,   // nearly rooted
    radius: 3.5,
    force: 28,                // strong radial knockback
    cooldown: 6.0,
    duration: 0.05,           // instant after wind-up
    windUpSquash: 0.50,       // extreme body compression during wind-up
    windUpHeadDrop: -0.15,    // head sinks during wind-up
  },

  // --- Match ---
  match: {
    duration: 120,            // seconds total (raised from 90 for 3-life matches)
    collapseInterval: 20,     // seconds between arena ring collapses (raised from 15)
    countdown: 3,             // seconds before match starts
  },

  // --- Lives & Respawn ---
  lives: {
    default: 3,               // lives per critter (may vary per critter later)
    immunityDuration: 1.5,    // seconds of invulnerability after respawn
    respawnDelay: 0.8,        // seconds before critter reappears after falling
    blinkRate: 8,             // blinks per second during immunity
    fallSpeed: 12,            // visual fall speed while descending into the void
  },

  // --- Hit Stop ---
  hitStop: {
    headbutt: 0.07,           // perceptible freeze on headbutt
    groundPound: 0.09,        // heavy slam
    ability: 0.04,            // generic ability hit
  },

  // --- Scale Feedback ---
  impact: {
    scaleX: 1.35,             // X/Z stretch on receiving hit
    scaleY: 0.6,              // Y squash on receiving hit
    duration: 0.2,
    bounceOvershoot: 1.08,    // slight overshoot before settling
  },

  dash: {
    scaleX: 0.75,             // compressed sideways during dash
    scaleY: 0.80,
    scaleZ: 1.5,              // stretched forward strongly
    duration: 0.2,
    bounceOvershoot: 1.05,
  },

  landing: {
    scaleX: 1.5,              // wide pancake spread
    scaleY: 0.4,              // extreme squash
    duration: 0.3,
    bounceOvershoot: 1.12,    // bouncy recovery
  },

  // --- Headbutt Recovery (visual-only) ---
  headbuttRecovery: {
    headOvershoot: -0.12,     // head bounces back briefly after lunge
    bodyStretch: 1.15,        // body stretches Y on recovery
    duration: 0.12,           // time of recovery pose before neutral
  },

  // --- Knockback Reaction (visual tilt when hit) ---
  knockbackReaction: {
    tiltAngle: 0.25,          // radians of backward lean when hit
    duration: 0.3,            // time to return to upright
  },
} as const;

// ---------------------------------------------------------------------------
// Hit Stop — global time scale pause
// ---------------------------------------------------------------------------

let hitStopTimer = 0;

export function triggerHitStop(duration: number): void {
  hitStopTimer = Math.max(hitStopTimer, duration);
}

export function applyHitStop(dt: number): number {
  if (hitStopTimer > 0) {
    hitStopTimer -= dt;
    return 0;
  }
  return dt;
}

// ---------------------------------------------------------------------------
// Scale Feedback — per-critter deformation state
// ---------------------------------------------------------------------------

interface ScaleEffect {
  targetX: number;
  targetY: number;
  targetZ: number;
  duration: number;
  elapsed: number;
  overshoot: number;
}

const activeEffects = new WeakMap<Critter, ScaleEffect>();

export function applyImpactFeedback(critter: Critter): void {
  activeEffects.set(critter, {
    targetX: FEEL.impact.scaleX,
    targetY: FEEL.impact.scaleY,
    targetZ: FEEL.impact.scaleX,
    duration: FEEL.impact.duration,
    elapsed: 0,
    overshoot: FEEL.impact.bounceOvershoot,
  });
  // Knockback tilt: lean backward from hit direction
  applyKnockbackTilt(critter);
}

export function applyDashFeedback(critter: Critter): void {
  activeEffects.set(critter, {
    targetX: FEEL.dash.scaleX,
    targetY: FEEL.dash.scaleY,
    targetZ: FEEL.dash.scaleZ,
    duration: FEEL.dash.duration,
    elapsed: 0,
    overshoot: FEEL.dash.bounceOvershoot,
  });
}

export function applyLandingFeedback(critter: Critter): void {
  activeEffects.set(critter, {
    targetX: FEEL.landing.scaleX,
    targetY: FEEL.landing.scaleY,
    targetZ: FEEL.landing.scaleX,
    duration: FEEL.landing.duration,
    elapsed: 0,
    overshoot: FEEL.landing.bounceOvershoot,
  });
}

/** Update scale deformation with bounce overshoot. */
export function updateScaleFeedback(critter: Critter, dt: number): void {
  const fx = activeEffects.get(critter);
  if (!fx) {
    lerpMeshScale(critter, 1, 1, 1, dt, 10);
    return;
  }

  fx.elapsed += dt;
  const t = Math.min(fx.elapsed / fx.duration, 1);

  // Ease with bounce overshoot: deform → return → slight overshoot → settle
  const ease = bounceEase(t, fx.overshoot);
  const sx = lerp(fx.targetX, 1, ease);
  const sy = lerp(fx.targetY, 1, ease);
  const sz = lerp(fx.targetZ, 1, ease);
  critter.mesh.scale.set(sx, sy, sz);

  if (t >= 1) {
    activeEffects.delete(critter);
  }
}

/** Ease out with overshoot: goes past 1.0 briefly then settles. */
function bounceEase(t: number, overshoot: number): number {
  if (t < 0.6) {
    // Quick return to normal
    const sub = t / 0.6;
    return sub * sub;
  } else if (t < 0.8) {
    // Overshoot past normal
    const sub = (t - 0.6) / 0.2;
    return 1.0 + (overshoot - 1.0) * Math.sin(sub * Math.PI);
  } else {
    // Settle back to 1.0
    const sub = (t - 0.8) / 0.2;
    return 1.0 + (overshoot - 1.0) * (1 - sub) * 0.3;
  }
}

// ---------------------------------------------------------------------------
// Knockback tilt — critter leans backward when hit
// ---------------------------------------------------------------------------

const activeTilts = new WeakMap<Critter, { elapsed: number }>();

export function applyKnockbackTilt(critter: Critter): void {
  activeTilts.set(critter, { elapsed: 0 });
}

/** Update tilt on the critter's body mesh (visual lean when hit). */
export function updateKnockbackTilt(critter: Critter, dt: number): void {
  const tilt = activeTilts.get(critter);
  if (!tilt) return;

  tilt.elapsed += dt;
  const t = Math.min(tilt.elapsed / FEEL.knockbackReaction.duration, 1);
  // Quick lean then return
  const angle = FEEL.knockbackReaction.tiltAngle * Math.sin(t * Math.PI);
  critter.body.rotation.x = angle;
  critter.head.rotation.x = angle * 0.5;

  if (t >= 1) {
    critter.body.rotation.x = 0;
    critter.head.rotation.x = 0;
    activeTilts.delete(critter);
  }
}

// ---------------------------------------------------------------------------
// Headbutt recovery pose
// ---------------------------------------------------------------------------

const activeRecoveries = new WeakMap<Critter, { elapsed: number }>();

export function applyHeadbuttRecovery(critter: Critter): void {
  activeRecoveries.set(critter, { elapsed: 0 });
}

export function updateHeadbuttRecovery(critter: Critter, dt: number): void {
  const rec = activeRecoveries.get(critter);
  if (!rec) return;

  rec.elapsed += dt;
  const t = Math.min(rec.elapsed / FEEL.headbuttRecovery.duration, 1);
  // Head bounces back, body stretches up
  critter.head.position.z = FEEL.headbuttRecovery.headOvershoot * (1 - t);
  critter.body.scale.y = lerp(FEEL.headbuttRecovery.bodyStretch, 1.0, t);

  if (t >= 1) {
    critter.head.position.z = 0;
    critter.body.scale.y = 1.0;
    activeRecoveries.delete(critter);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpMeshScale(critter: Critter, tx: number, ty: number, tz: number, dt: number, speed: number): void {
  const s = critter.mesh.scale;
  const f = Math.min(dt * speed, 1);
  s.x += (tx - s.x) * f;
  s.y += (ty - s.y) * f;
  s.z += (tz - s.z) * f;
}
