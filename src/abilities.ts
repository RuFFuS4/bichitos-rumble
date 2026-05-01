import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerHitStop, triggerCameraShake, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { spawnDustPuff } from './dust-puff';
import { spawnLocalProjectile } from './projectiles';

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
// Types
// ---------------------------------------------------------------------------

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy' | 'blink' | 'projectile';

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
  | 'risky'
  | 'ranged';

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
  /**
   * Optional skeletal clip playback speed multiplier when this ability fires.
   * Used to align a clip's natural length to the ability's active window.
   * Example: Sergei's Gorilla Rush clip is 1.03s but the ability should
   * feel snappy (~0.3s); `clipPlaybackRate: 2.3` accelerates the clip to
   * ~0.45s so the punchy pose lands in time with the dash.
   * Undefined / 1.0 = clip plays at authored speed.
   */
  clipPlaybackRate?: number;

  /** Movement-speed multiplier applied while the ability is in its
   *  ACTIVE window (post-windUp, pre-cooldown). Defaults to 1.0 — only
   *  meaningful for ground_pound and blink, where the player should be
   *  rooted/slowed during the brief active window so the slam/blink
   *  reads as a committed action. charge_rush and frenzy ignore this:
   *  their `speedMultiplier` / `frenzySpeedMult` already governs active
   *  movement. */
  slowDuringActive?: number;

  /** When the ability ends (state.active flips false), force the
   *  skeletal animator back to idle/run. Useful for K abilities whose
   *  authored clip is much longer than the gameplay window — without
   *  this, Trunk's 1.5 s slam clip would tail well past his 0.65 s
   *  ability, leaving the elephant swinging in the air after the
   *  effect was already done. Defaults false (clip plays out). */
  cancelAnimOnEnd?: boolean;

  /** Multiply the camera shake amplitude when the K (ground_pound)
   *  effect fires. Defaults 1.0. Used by Trunk Earthquake (v0.11)
   *  to make the slam read as a real "terremoto" — the slam force
   *  was bumped from 40 → 48 but the shake didn't follow until this
   *  field landed. Pure feel knob; not synced to server. */
  shakeBoost?: number;

  /** Blink-specific: world-units to teleport along the critter's
   *  facing direction. Server clamps to arena bounds. */
  blinkDistance?: number;

  /** Blink-specific impact (v0.11): when set, a radial knockback is
   *  applied at the DESTINATION the moment the blink fires. Used by
   *  Cheeto Shadow Step so reappearing next to an enemy still
   *  feels offensive. Server + client compute the same impulse. */
  blinkImpactRadius?: number;
  blinkImpactForce?: number;

  /** 2026-04-29 K-refinement — Cheeto Shadow Step seek-nearest.
   *  When true, the blink targets the closest valid enemy within
   *  `blinkSeekRange` and lands `blinkSeekOffset` units short of
   *  them on the caster→target line. Falls back to the legacy
   *  `blinkDistance` facing-blink when no target is in range. */
  blinkSeekNearest?: boolean;
  blinkSeekRange?: number;
  blinkSeekOffset?: number;

  /** Cone-restricted ground_pound (v0.11): when set, the slam only
   *  pushes enemies whose direction from the caster falls within
   *  ±`coneAngleDeg` of the caster's facing. Used by Sebastian Claw
   *  Wave to read as a frontal sweep instead of a radial slam.
   *  Default undefined = full 360° (current behaviour). */
  coneAngleDeg?: number;

  /** Zone-at-origin override (v0.11): for blink + zone combos like
   *  Sihans Burrow, the slow zone should drop at the ORIGINAL
   *  position the critter left from, not the destination. Default
   *  false (zone follows the new position). */
  zoneAtOrigin?: boolean;

  /** Ground-pound-specific: when set, the slam ALSO drops a temporary
   *  slow zone at the impact point. Server is authoritative — it
   *  tracks the zone, applies the slowMultiplier to anyone inside via
   *  effectiveSpeed, and broadcasts a single 'zoneSpawned' event so
   *  clients can render the matching VFX. The zone does NO damage; it
   *  only debuffs movement. */
  zone?: {
    /** World-space radius for both the slow check and the VFX ring. */
    radius: number;
    /** Lifetime in seconds. */
    duration: number;
    /** Speed multiplier applied to any critter standing inside the
     *  zone. 0.6 ≈ 40 % slow. Stacks multiplicatively if a critter
     *  ends up in multiple zones, but no caster ever drops two zones
     *  at once because the K cooldown is longer than the zone lifetime. */
    slowMultiplier: number;
    /** VFX outer/inner colours. Same palette idea as the regular
     *  shockwave ring — falls back to the critter's pound palette
     *  when omitted at the call site. */
    color?: number;
    secondary?: number;
  };

  /** Self-buff K (v0.11): when true, the ground_pound skips its
   *  outward knockback and instead grants the caster a rooted
   *  immunity window. Used by Shelly Steel Shell — she doesn't
   *  slam, she becomes invulnerable. Pairs with `selfImmunityDuration`. */
  selfBuffOnly?: boolean;
  /** Seconds of immunity granted to the caster on activation. Used
   *  with `selfBuffOnly` for Shelly's defensive K (5.0 s steel
   *  mode) and `invisibilityDuration` for Kurama. The server
   *  writes `player.immunityTimer` so all clients see the buff. */
  selfImmunityDuration?: number;
  /** Cliente-only visual override on the caster while the immunity
   *  window from `selfImmunityDuration` is active. The mesh's
   *  emissive is tinted to this hex so the state reads (Shelly
   *  Steel Shell glows metallic gray). Default undefined = no
   *  visual override. */
  selfTintHex?: number;
  /** Seconds the caster becomes semi-transparent (alpha 0.25) and
   *  knockback-immune. Used by Kurama Mirror Trick. Server treats
   *  this as a regular `selfImmunityDuration`; cliente layers an
   *  alpha override on the mesh + spawns a static decoy clone at
   *  the origin position. */
  invisibilityDuration?: number;

  /** 2026-04-29 K-refinement — Shelly Steel Shell physical anchor.
   *  When true, while the buff is active the caster's effective
   *  mass is multiplied by `ANCHOR_MASS_MULT` (effectively
   *  immovable) so other critters bounce off her instead of
   *  shoving her around. Combined with the existing
   *  `selfImmunityDuration`-driven knockback skip, Shelly is
   *  100 % static during Steel Shell. Server mirrors via the
   *  `selfAnchorWhileBuffed` flag in `AbilityDef`. */
  selfAnchorWhileBuffed?: boolean;

  /** 2026-04-29 K-refinement — Kurama Mirror Trick escape teleport.
   *  When set on a self-buff K, the caster blinks this many units
   *  AWAY from the closest enemy at activation (fallback: along
   *  facing if no enemy exists). The decoy stays at the original
   *  spot. Pairs with `invisibilityDuration` so the engaño reads
   *  as "señuelo se queda, Kurama se va lejos". */
  decoyEscapeDistance?: number;

  /** 2026-04-29 final-K — Trunk Grip K. When true, the
   *  ground_pound dispatcher takes a single frontal target
   *  instead of doing radial knockback:
   *    1. find closest enemy in `gripFrontalRange` within
   *       ±`gripFrontalAngleDeg` of facing
   *    2. yank them to `gripPullDistance` units in front of Trunk
   *    3. write `target.stunTimer = gripStunDuration` (server +
   *       cliente). Stun roots them and grants ×2 incoming
   *       knockback via the vulnerability path in
   *       `resolveCollisions`.
   */
  gripK?: boolean;
  gripFrontalRange?: number;
  gripFrontalAngleDeg?: number;
  gripPullDistance?: number;
  gripStunDuration?: number;

  // ---------------------------------------------------------------------
  // 2026-04-30 final-L flags — added on the frenzy slot to give each L
  // its authorial behaviour without introducing a new AbilityType per
  // critter. The frenzy dispatcher checks the flag and runs the matching
  // per-tick logic in addition to (or instead of) the speed/mass buff.
  // ---------------------------------------------------------------------

  /** Shelly Saw Shell: during frenzy, any collision with Shelly
   *  applies a strong outward knockback to the OTHER critter
   *  regardless of headbutt state. Cliente also spins her mesh
   *  rapidly for the visual saw read. */
  sawL?: boolean;
  sawContactImpulse?: number;
  sawSpinSpeed?: number;

  /** Trunk Stampede ramming flag (legacy 2026-05-01 microfix —
   *  retired in the same-day final pass when Trunk's L was rebuilt
   *  around Grip. Kept on the interface so old kits can still set
   *  the flag without breaking the type, and so the client/server
   *  ramming branch can be reused if a future critter wants the
   *  same shape. Not set on any current critter.) */
  rammingL?: boolean;
  ramContactImpulse?: number;

  /** 2026-05-01 final — Trunk Slam K. When set on a ground_pound,
   *  every critter inside the radial AoE additionally receives a
   *  brief stun (`stunTimer = slamStunDuration`). Stuns from this
   *  source compose with the global "stunned takes ×4 incoming
   *  knockback" rule in physics — so Slam alone reads as a heavy
   *  thump, but a Slam followed by a headbutt deletes the target. */
  slamStunDuration?: number;

  /** Cheeto Cone Pulse: during frenzy, the caster is rooted
   *  (slowDuringActive 0). Every `pulseInterval` seconds the
   *  server emits a frontal cone knockback (radius
   *  `pulseRadius`, half-angle `pulseAngleDeg`, force
   *  `pulseForce`). Each pulse fires a `pulse` event for the
   *  cliente to render the matching VFX. */
  conePulseL?: boolean;
  pulseInterval?: number;
  pulseRadius?: number;
  pulseAngleDeg?: number;
  pulseForce?: number;

  /** Sebastian All-in Side Slash: a multi-phase L. The frenzy
   *  duration is the WINDUP only (rooted vibrate); when the
   *  windup ends the dispatcher fires a single fast lateral
   *  dash that hit-checks against enemies in front of Sebastian.
   *  On hit: huge knockback to target, frenzy ends. On miss:
   *  Sebastian receives a large self-knockback toward the
   *  arena edge as the "high-risk" punishment. */
  allInL?: boolean;
  allInDashSpeed?: number;
  allInDashRange?: number;
  allInHitForce?: number;
  allInMissSelfForce?: number;
  /** 2026-05-01 final block — Sebastian hold-to-charge / release-
   *  to-fire flag. When true, the L doesn't activate on press;
   *  instead the player goes into a charging state that paints
   *  the trajectory preview and roots Sebastian. The dash fires
   *  on the RELEASE of the L input (or after `holdToFireMaxMs`
   *  as a safety auto-release). Pairs with `allInL`. */
  holdToFireL?: boolean;
  holdToFireMaxMs?: number;

  /** Kermit Toxic Touch: during frenzy, contact with another
   *  critter writes `target.confusedTimer = confusedDuration`.
   *  Confused targets have their movement input inverted on
   *  the local cliente (and bot steering inverted server-side). */
  toxicTouchL?: boolean;
  confusedDuration?: number;

  /** Kowalski Frozen Floor: at frenzy fire time spawn a large
   *  slippery zone at the caster's position. The zone uses the
   *  existing zone system but with a `slippery: true` flag —
   *  critters inside have reduced control + reduced friction
   *  decay (`effectiveSpeed` and the friction loop both
   *  branch on the flag). */
  frozenFloorL?: boolean;
  floorRadius?: number;
  floorDuration?: number;

  /** Sihans Sinkhole: at frenzy fire time spawn a hazard zone
   *  in front of Sihans. Critters inside are continuously
   *  pulled toward the centre and slowed; Sihans is exempt by
   *  ownerKey. Zone duration `holeDuration`, radius
   *  `holeRadius`, pull force `holeForce`. */
  sinkholeL?: boolean;
  holeRadius?: number;
  holeDuration?: number;
  holeForce?: number;
  /** Cast offset for Sihans Sinkhole — units in front of the
   *  caster. Keeps the hole away from the immune islet at the
   *  arena centre (>= 4 u). */
  holeCastOffset?: number;

  /** Kurama Copycat: at frenzy fire time, look up the critter
   *  most recently hit by Kurama and copy a SAFE version of
   *  their L (the dispatch table maps each kit to a friendly
   *  reusable behaviour). If no last-hit target is set, the
   *  ability fizzles with feedback. */
  copycatL?: boolean;

  // --- 2026-04-29 K-session: projectile additions (Kowalski Snowball) ---
  /** Forward speed of the projectile (units / second). */
  projectileSpeed?: number;
  /** Lifetime in seconds before the projectile despawns if it hasn't
   *  hit anything yet. */
  projectileTtl?: number;
  /** Sphere radius for both visual scale and sweep collision against
   *  critter capsules. */
  projectileRadius?: number;
  /** Knockback impulse along the projectile's facing direction at
   *  impact. */
  projectileImpulse?: number;
  /** Status-slow duration applied to the victim on hit. */
  projectileSlowDuration?: number;
}

export interface AbilityState {
  def: AbilityDef;
  cooldownLeft: number;
  durationLeft: number;
  windUpLeft: number;
  active: boolean;
  effectFired: boolean;
  /** Per-frame accumulator that drives the dust-puff trail spawned
   *  during a charge_rush dash. Counts seconds since the last puff;
   *  the tick spawns a new one each `DASH_TRAIL_INTERVAL` and resets.
   *  Untouched for non-mobility ability types. */
  trailTimer: number;
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
    // v0.11: every J slot cuts its skeletal clip back to idle/run
    // when the dash window closes. Authored clips are usually 1–2 s
    // long but the gameplay dash is 0.24–0.45 s — without this the
    // critter kept swinging / leaping / scuttling well after the
    // physics was done.
    cancelAnimOnEnd: true,
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

/**
 * Blink — short-range teleport along the critter's facing direction.
 * Server-authoritative: server validates + clamps to arena bounds and
 * broadcasts an `abilityFired` event of type 'blink' so clients can
 * spawn the afterimage VFX. During wind-up + active the critter is
 * fully rooted (slowDuringWindUp/Active = 0). Tag stays `mobility`
 * so the bot AI uses it the same way it uses charge_rush.
 */
function makeBlink(overrides: Partial<AbilityDef> = {}): AbilityDef {
  return {
    type: 'blink',
    name: 'Blink',
    key: 'K',
    cooldown: 5.0,
    duration: 0.10,
    windUp: 0.04,
    speedMultiplier: 1.0,
    massMultiplier: 1.0,
    impulse: 0,
    slowDuringWindUp: 0,
    radius: 0,
    force: 0,
    blinkDistance: 4.0,
    slowDuringActive: 0,
    cancelAnimOnEnd: true,
    tags: ['mobility'],
    description: 'Short blink in facing direction',
    ...overrides,
  };
}

/**
 * Snowball — frontal projectile (Kowalski K, 2026-04-29).
 * Server-authoritative: server tracks position, sweeps collision,
 * applies knockback + slowTimer on hit, and broadcasts spawn / hit /
 * expired events. Offline mirror lives in `src/projectiles.ts` and
 * runs the same straight-line + sweep step.
 */
function makeProjectile(overrides: Partial<AbilityDef> = {}): AbilityDef {
  return {
    type: 'projectile',
    name: 'Snowball',
    key: 'K',
    cooldown: 5.5,
    duration: 0.05,
    windUp: 0.20,
    speedMultiplier: 1.0,
    massMultiplier: 1.0,
    impulse: 0,
    slowDuringWindUp: 0,
    slowDuringActive: 0,
    radius: 0,
    force: 0,
    projectileSpeed: 18,
    projectileTtl: 1.2,
    projectileRadius: 0.55,
    projectileImpulse: 22,
    projectileSlowDuration: 2.0,
    cancelAnimOnEnd: true,
    tags: ['ranged'],
    description: 'Throws a snowball that knocks back and slows on hit',
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
// Per-critter VFX palette
// ---------------------------------------------------------------------------
//
// Cosmetic-only tints applied at fire time. None of these values reach the
// server — gameplay (impulse, radius, force, multipliers) is fully driven
// by the kit numbers above; this map only colours the rings + bursts so
// each critter's signature reads at a glance instead of every shockwave
// looking like the same generic red ring.
//
// Each entry can override:
//   · `pound.color` / `pound.secondary`  — outer + inner ring of the
//                                           ground-pound shockwave.
//   · `pound.holdMs`                      — extends the ring's visible
//                                           lifetime past the default
//                                           450 ms (Kermit's "toxic
//                                           cloud" hangs longer on
//                                           screen).
//   · `frenzy.color` / `frenzy.secondary` — outer + inner ring on the
//                                           one-shot Frenzy entry burst.
//
// Keys missing from the map (e.g. internal bots Rojo/Azul/Verde/Morado)
// fall back to the original red shockwave + gold-red frenzy. Adding a
// new critter without an entry is safe — they just look "default".
interface CritterVfxPalette {
  pound?:  { color?: number; secondary?: number; holdMs?: number };
  frenzy?: { color?: number; secondary?: number };
}

/**
 * Palette lookup for a critter by display name. Returns `undefined`
 * for unknown critters (internal bots etc.); callers must treat that
 * as "use default colours" — the underlying VFX functions already
 * fall back gracefully when their `opts` are undefined.
 *
 * Exported so the online event handler in `game.ts` can apply the
 * same tint to the shockwave ring it spawns from server events,
 * keeping offline and online visually identical.
 */
export function getCritterVfxPalette(critterName: string): CritterVfxPalette | undefined {
  return CRITTER_VFX_PALETTE[critterName];
}

const CRITTER_VFX_PALETTE: Record<string, CritterVfxPalette> = {
  Trunk:     { pound: { color: 0xb8762a, secondary: 0xffd089 }, frenzy: { color: 0xffaa44, secondary: 0xff7722 } }, // brown earth
  Sergei:    { pound: { color: 0xff3322, secondary: 0xffaa44 }, frenzy: { color: 0xff5522, secondary: 0xffcc44 } }, // strong red/orange (close to default)
  Kurama:    { pound: { color: 0xc83cff, secondary: 0xff66ee }, frenzy: { color: 0xff7733, secondary: 0xffaa66 } }, // violet/magenta — illusion
  Shelly:    { pound: { color: 0x2dc66b, secondary: 0x6dffe2 }, frenzy: { color: 0x2d8659, secondary: 0x6ddfa9 } }, // green/cyan — shell
  Kermit:    { pound: { color: 0x66ff44, secondary: 0x9c3cee, holdMs: 800 }, frenzy: { color: 0x9c3cee, secondary: 0x66ff44 } }, // toxic green/violet, held longer
  Sihans:    { pound: { color: 0x9c7c3c, secondary: 0xd9c089 }, frenzy: { color: 0x8b6914, secondary: 0xc89a3c } }, // brown/sand — tremor
  Kowalski:  { pound: { color: 0x6cc9ff, secondary: 0xffffff }, frenzy: { color: 0x88c1ff, secondary: 0xeaf6ff } }, // ice blue/white
  Cheeto:    { pound: { color: 0xff7322, secondary: 0xffd944 }, frenzy: { color: 0xff3322, secondary: 0xffcc44 } }, // orange/red predator
  Sebastian: { pound: { color: 0x9b1c1c, secondary: 0xff5544 }, frenzy: { color: 0xcc3333, secondary: 0xff5555 } }, // crimson
};

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
      impulse: 28,
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
      impulse: 16,
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
      impulse: 28,
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
  //
  // Feel pass 2026-04-24 — values aligned with the 8-clip GLB kit:
  //   · Gorilla Rush clip is 1.03s; ability runs 0.32s active. We
  //     accelerate the clip to 2.3× so the gorilla palm strike lands
  //     in ~0.45s total (windUp 0.04 + active 0.28 + tail). Feels
  //     snappy, matches "strong AND agile" identity.
  //   · Shockwave clip is 0.80s; ability runs 0.30s windUp + 0.05s
  //     effect = 0.35s. Clip tail covers recovery naturally, no
  //     playback rate tweak needed. Radius/force nudged up so it
  //     reads as signature AoE without nerfing bruisers.
  //   · Frenzy clip is 2.43s; original buff ran 4.0s (clip ended mid
  //     buff, looked flat). Buff now matches clip length (2.5s) and
  //     multipliers bumped (speed 1.3→1.45, mass 1.35→1.5) to keep
  //     the burst-intensity × shorter-window roughly equivalent.
  //     Entry frame now spawns a frenzy burst ring + camera shake.
  Sergei: [
    makeChargeRush({
      name: 'Gorilla Rush',
      description: 'Heavy palm strike charge',
      impulse: 25,
      duration: 0.28,
      cooldown: 4.0,
      windUp: 0.04,
      speedMultiplier: 2.6,
      massMultiplier: 2.2,
      clipPlaybackRate: 2.3,
    }),
    makeGroundPound({
      // 2026-04-29 final-K (Rafa: "doblar potencia, apenas
      // empuja"): force 34 → 68. Sentinel parity also bumped.
      name: 'Shockwave',
      description: 'Slams ground with both fists — heavy radial knockback',
      radius: 3.5,
      force: 68,
      windUp: 0.30,
      cooldown: 6.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
    }),
    makeFrenzy({
      description: 'Enters berserk mode: +speed, +power, near-immovable',
      duration: 2.5,
      cooldown: 15.0,
      windUp: 0.35,
      // 2026-04-30 final-polish (Rafa: "en frenesí no parece verosímil
      // que otros lo muevan fácilmente a cabezazos — más resistencia"):
      // mass 1.75 → 5.50. Sergei sigue moviéndose y atacando, pero
      // los headbutts enemigos solo desplazan ~1/6 de lo normal
      // (massRatio en physics: 1.0 / (1.0 + 5.5) ≈ 15 %). No es
      // invulnerabilidad total (eso ya lo tiene Shelly Steel Shell
      // con anchor), es "el gorila berserk no se mueve fácil".
      // speed sin tocar — el rework es de aguante, no de movilidad.
      speedMultiplier: 1.55,
      massMultiplier: 5.50,
    }),
  ],

  // Trunk — elephant Bruiser: slow, heavy, devastating
  //
  // Feel pass 2026-04-25 (follows Sergei's template in CHARACTER_DESIGN.md
  // §"Feel pass log"). Clips measured via `scripts/inspect-clips.mjs`:
  //   · Ability1TrunkRam 4.58 s (LONG — clipPlaybackRate 5.0 → ~0.92 s).
  //   · Ability3GroundPound 1.96 s (mapped to ab_2 via override — see
  //     animation-overrides.ts; clipPlaybackRate 2.8 → ~0.70 s).
  //   · Idle 5.58 s, Run 1.29 s (untouched).
  //
  // Identity delta vs Sergei (Balanced): Trunk is HEAVIER in every axis.
  // Shorter dash but much higher mass multiplier (bulldozer, not agile
  // striker). Wider Earthquake radius + harder knockback than Sergei's
  // Shockwave. Longer buff window on Stampede but smaller speed uplift
  // (elephant doesn't sprint — it charges through).
  //
  // VFX reuses the existing spawnShockwaveRing + camera shake; the wider
  // `radius` + higher `force` make the ring bigger + the shake stronger
  // than Sergei's, which matches the bruiser identity without adding new
  // VFX code (kept out of scope for this pass).
  Trunk: [
    makeChargeRush({
      // 2026-04-30 final-polish (Rafa: "J debe recorrer más espacio"):
      // impulse 25 → 32, duration 0.42 → 0.55, speedMultiplier 2.1 →
      // 2.4. Distancia recorrida ≈ impulse × duration × speedMultiplier
      // sube de ~22 a ~42 — casi el doble. Mantenemos masa alta para
      // que siga sintiéndose pesado y no incontrolable.
      name: 'Trunk Ram',
      description: 'Unstoppable forward dash with tusks',
      impulse: 32,
      duration: 0.55,
      cooldown: 4.5,
      windUp: 0.08,
      speedMultiplier: 2.4,
      massMultiplier: 4.0,
      clipPlaybackRate: 4.5,
    }),
    makeGroundPound({
      // 2026-05-01 final REDESIGN (Rafa: "K = golpe amplio que
      // stunee, similar a la ulti de Kowalski"). Trunk K is now
      // a wide AoE slam: 7 u radius, 50 force, plus a brief 1 s
      // stun on every hit critter via `slamStunDuration`. Replaces
      // the previous Trunk Grip — that mechanic moved to L this
      // pass.
      name: 'Trunk Slam',
      description: 'Wide AoE thump — knocks back and stuns',
      radius: 7.0,
      force: 50,
      windUp: 0.30,
      cooldown: 7.0,
      clipPlaybackRate: 2.8,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      shakeBoost: 1.4,
      // 2026-05-01 final block + micropass — slam stun duración 1.0
      // → 2.0 (final block) → 1.7 (micropass, -15 %). Sigue habilitando
      // el combo Slam → headbutt ×4, pero con una ventana de escape
      // un poco más razonable.
      slamStunDuration: 1.7,
    }),
    makeGroundPound({
      // 2026-05-01 final — Trunk Grip moved here (was Trunk K).
      // Grabs the closest valid frontal enemy, snaps them to
      // 1.6 u in front of Trunk, locks them in `stunTimer = 5 s`.
      // While stunned, the global "vulnerable" rule in physics
      // applies × 4 incoming knockback so a follow-up headbutt
      // launches the target across the arena. Rafa's read: "I
      // grab them with the trunk, leave them helpless, then
      // finish them off."
      name: 'Trunk Grip',
      key: 'L',
      // BLOQUE FINAL micropass — gripStunDuration 5.0 → 4.25 (-15 %)
      // para alinear con el global Trunk -15 %. Sigue siendo CC
      // dominante pero con margen de respiración para el target.
      description: 'Trunk pulls a target close — they take ×4 from any hit for 4 s',
      radius: 0, force: 0,
      windUp: 0.45,
      cooldown: 18.0,
      duration: 0.05,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      shakeBoost: 1.0,
      gripK: true,
      gripFrontalRange: 28.0,
      gripFrontalAngleDeg: 35,
      gripPullDistance: 1.6,
      gripStunDuration: 4.25,
    }),
  ],

  // --- Bloque C: 7 remaining playables ---
  // Each kit mirrors server/src/sim/abilities.ts CRITTER_ABILITY_KITS
  // (same impulse/radius/force/cooldown) so offline == online.

  // Kurama — Trickster: fast feint dash + a quick illusion burst on
  // K (rebranded "Phantom Burst" — honest about not being a teleport)
  // and an agile short-windowed frenzy on L. Rooted briefly during
  // the K windup so the burst still reads as a committed pose.
  Kurama: [
    makeChargeRush({
      name: 'Fox Dash', description: 'Blink-fast feint forward',
      impulse: 29, duration: 0.26, cooldown: 3.2, windUp: 0.05,
      speedMultiplier: 2.8, massMultiplier: 1.3,
    }),
    // v0.11 — Mirror Trick: drops a static decoy clone where Kurama
    // is, ghosts her own mesh (alpha 0.25) for 1.6 s, and grants
    // immunity to knockback during that window. NO outward damage —
    // selfBuffOnly: true. Bot AI keeps targeting her by sessionId
    // (we don't redirect targeting to the decoy; documented in
    // ABILITY_QA_CHECKLIST.md as a recorte).
    // 2026-04-29 K-refinement (Rafa: "señuelo dura muy poco, Kurama
     // queda demasiado pegado al señuelo, debe alejarse muchísimo
     // más"): duration 1.6 → 2.8 s, ghost duration igualada,
     // cooldown 7 → 9. Y añadimos `decoyEscapeDistance: 7` para
     // que la fire-effect cliente teleport a Kurama lejos del
     // enemigo más cercano (fallback al facing si no hay enemigo).
    makeGroundPound({
      name: 'Mirror Trick',
      description: 'Leave a decoy, ghost away from danger for 2.8 s',
      radius: 0, force: 0,
      windUp: 0.10, cooldown: 9.0, duration: 2.8,
      // 2026-04-30 final-polish (Rafa: "durante el clon Kurama debe
      // poder moverse libremente"): slowDuringActive 0 → 1.0 para
      // que la Trickster no quede rooted mientras el señuelo está
      // en pie. Mantiene cancelAnimOnEnd para que el clip de pound
      // termine limpio.
      slowDuringActive: 1.0, cancelAnimOnEnd: true,
      selfBuffOnly: true,
      selfImmunityDuration: 2.8,
      invisibilityDuration: 2.8,
      decoyEscapeDistance: 7.0,
    }),
    makeFrenzy({
      // 2026-04-30 final-L — Copycat. Kurama's frenzy looks for
      // the critter she most recently hit and copies a SAFE
      // version of their L. The dispatch table lives in the
      // frenzy fire path: each entry maps a critter name to a
      // partial frenzy override (speed/mass tweaks + matching
      // L-flag). If no last-hit target exists, the L fizzles
      // with a soft burst + console feedback.
      name: 'Copycat',
      description: 'Mimics the L of the last enemy you hit',
      duration: 3.5, cooldown: 16.0, windUp: 0.30,
      speedMultiplier: 1.50, massMultiplier: 1.20,
      copycatL: true,
    }),
  ],

  // Shelly — Tank: K still wide-ish but tighter than Trunk's Earthquake;
  // L leans hard on mass so the player reads "harder to push" not "faster".
  Shelly: [
    makeChargeRush({
      name: 'Shell Charge', description: 'Slow rolling ram',
      impulse: 15, duration: 0.45, cooldown: 5.5, windUp: 0.08,
      speedMultiplier: 1.8, massMultiplier: 3.2,
    }),
    // v0.11 — Shell Slam REPLACED by Steel Shell. Defensive K:
    // skips the outward knockback, grants Shelly 5 s of immunity
    // (rooted via slowDuringActive: 0), tints her metallic gray.
    // Reads as "she's in her shell, you can't push her".
    makeGroundPound({
      // 2026-04-29 K-refinement (Rafa): duration 5.0 → 4.0,
      // selfImmunityDuration mirrored. Anclaje físico absoluto:
      // durante el shell, mass × 9999 (vía new field
      // `selfMassWhileBuffed`) — los demás rebotan al chocar pero
      // Shelly no se desplaza. Manejado tanto en cliente
      // (effectiveMass) como en server (effectiveMass).
      name: 'Steel Shell',
      description: 'Lock into the shell — invulnerable for 4 s',
      radius: 0, force: 0,
      windUp: 0.20, cooldown: 12.0, duration: 4.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      selfBuffOnly: true,
      selfImmunityDuration: 4.0,
      selfTintHex: 0xa8c0d0, // metallic blue-gray
      selfAnchorWhileBuffed: true,
    }),
    makeFrenzy({
      // 2026-04-30 final-L — Saw Shell. During frenzy Shelly's
      // mesh spins on Y rapidly (visual saw blade), and any
      // collision with another critter while the buff is up
      // applies a strong outward knockback regardless of
      // headbutt state. Speed/mass multipliers stay so she
      // can chase, but the contact damage is the headline.
      name: 'Saw Shell',
      description: 'Spin like a saw — every contact launches enemies hard',
      duration: 3.5, cooldown: 18.0, windUp: 0.4,
      speedMultiplier: 1.40, massMultiplier: 1.65,
      sawL: true,
      // 2026-04-30 final-polish (Rafa: "muchísimo más empuje al
      // tocar"): contactImpulse 32 → 90. Una sierra de caparazón
      // tiene que expulsar brutalmente, no nudgear. Sentinel
      // server-side mirrored.
      sawContactImpulse: 90,
      sawSpinSpeed: 22,
      // 2026-04-30 final-polish (Rafa: "al terminar de girar,
      // parece que empieza a reproducir la animación"): añadimos
      // cancelAnimOnEnd para que el clip de frenzy NO se reproduzca
      // en falling-edge del active flag — la base rotation ya se
      // restaura vía baseGlbRotationY en critter.ts.
      cancelAnimOnEnd: true,
    }),
  ],

  // Kermit — Controller: K is the WIDEST AoE in the roster (rad 5.0)
  // with the LOWEST knockback (frc 14) and the FASTEST windup (0.15) —
  // reads as a giant toxic puff that nudges everyone, not a slam. L is
  // the tankiest frenzy of all (mass × 1.80, slowest speed×).
  Kermit: [
    makeChargeRush({
      name: 'Leap Forward', description: 'Tongue-propelled lunge',
      impulse: 20, duration: 0.30, cooldown: 4.0,
      speedMultiplier: 2.3, massMultiplier: 1.7,
    }),
    makeGroundPound({
      // 2026-04-29 K-refinement: zone duration 2.0 → 10.0 s (Rafa:
      // "debe durar unos 10 segundos"). Cooldown 7.0 → 16.0 para
      // que la zona no quede solapada con la siguiente. Kermit es
      // immune to su propia nube (manejado en physics: el caster
      // se filtra del slow check via `ownerSid`).
      name: 'Poison Cloud',
      description: 'Toxic fog that lingers and slows enemies',
      radius: 5.0, force: 14, windUp: 0.15, cooldown: 16.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      zone: {
        radius: 5.0,
        duration: 10.0,
        slowMultiplier: 0.60,
        color: 0x66ff44,
        secondary: 0x9c3cee,
      },
    }),
    makeFrenzy({
      // 2026-04-30 final-L — Toxic Touch. While the buff is
      // active, contact with another critter writes their
      // `confusedTimer = confusedDuration`. Confused critters
      // have their movement input inverted on the local
      // cliente (and bot steering inverted server-side) so the
      // hypno read is real — Rafa: "controles invertidos". 3 s
      // confusion + 4 s frenzy gives Kermit a real window.
      name: 'Toxic Touch',
      description: 'Touch enemies to invert their controls',
      duration: 4.0, cooldown: 18.0, windUp: 0.4,
      speedMultiplier: 1.30, massMultiplier: 1.30,
      toxicTouchL: true,
      confusedDuration: 3.0,
    }),
  ],

  // Sihans — Trapper: longest L window in the roster + heavy mass —
  // signature is "sustained ground control" over burst speed.
  Sihans: [
    makeChargeRush({
      name: 'Burrow Rush', description: 'Underground charge resurfacing ahead',
      impulse: 19, duration: 0.35, cooldown: 4.5, windUp: 0.08,
      speedMultiplier: 2.1, massMultiplier: 2.0,
    }),
    // v0.11 — Sihans K REPLACED by Burrow Rush (blink + zone-at-origin).
    // Sihans desaparece donde estaba (suelta arenas movedizas) y
    // emerge 3.5 u en su facing. Da la lectura "se hundió aquí, salió
    // allá". El blink usa la misma mecánica que Cheeto pero con
    // distancia menor + zoneAtOrigin: true.
    makeBlink({
      // 2026-04-29 K-refinement (Rafa: "al salir debe aparecer
      // más adelante"): blinkDistance 3.5 → 6.5 (recorrido casi
      // doblado, todavía dentro del arena disc — radius 12, ARENA
      // BLINK clamp 11.6, así que un Sihans en el centro aparece
      // a 6.5u sin riesgo de void).
      name: 'Sand Trap',
      description: 'Burrow under, leave quicksand, surface ahead',
      blinkDistance: 6.5,
      cooldown: 7.0,
      windUp: 0.20,
      duration: 0.10,
      zoneAtOrigin: true,
      zone: {
        radius: 3.5,
        duration: 2.5,
        slowMultiplier: 0.50,
        color: 0x9c7c3c,
        secondary: 0xd9c089,
      },
    }),
    makeFrenzy({
      // 2026-04-30 final-L — Sinkhole. At fire time spawn a
      // hazard zone in front of Sihans (4 u offset along
      // facing) that lasts 5 s and continuously pulls critters
      // toward its centre. Sihans is exempt by ownerKey. The
      // L still grants a small speed/mass buff so the cast
      // doesn't leave her stuck.
      name: 'Sinkhole',
      description: 'Open a hazardous pit ahead — pulls enemies in',
      duration: 4.5, cooldown: 20.0, windUp: 0.4,
      speedMultiplier: 1.15, massMultiplier: 1.50,
      sinkholeL: true,
      holeRadius: 3.0,
      holeDuration: 5.0,
      holeForce: 14,
      holeCastOffset: 4.0,
    }),
  ],

  // Kowalski — Mage: K is a real frontal SNOWBALL projectile (v0.11
  // final-K, 2026-04-29). Travels along the facing direction, applies
  // 50 % slow + knockback on hit, despawns on hit or 1.2 s ttl.
  // Replaces the v0.10 Arctic Burst radial AoE — Rafa: "debe ser
  // bola de nieve, no AoE radial".
  Kowalski: [
    makeChargeRush({
      name: 'Ice Slide', description: 'Slides forward on an ice trail',
      impulse: 19, duration: 0.30, cooldown: 4.2,
      speedMultiplier: 2.4, massMultiplier: 1.5,
    }),
    makeProjectile({
      // 2026-04-29 final-K (Rafa: "el cast de 1.10 es demasiado
      // largo, bájalo a ~0.5"): windUp 1.10 → 0.50.
      // Slow al impactar 2.0 → 5.0 ("frozen 5 s con icono ❄️").
      // Cooldown 6.5 → 6.0 para mantener pace.
      name: 'Snowball',
      description: 'Frontal snowball — knocks back and freezes the target for 5 s',
      cooldown: 6.0,
      windUp: 0.50,
      duration: 0.05,
      projectileSpeed: 18,
      projectileTtl: 1.2,
      projectileRadius: 0.55,
      projectileImpulse: 22,
      projectileSlowDuration: 5.0,
    }),
    makeFrenzy({
      // 2026-04-30 final-L — Frozen Floor. Spawns a slippery
      // ice zone at the caster's position. While inside,
      // critters keep their velocity (low friction) and
      // their accel input is reduced — they slide a lot
      // and lose control near the edge. Kowalski herself is
      // exempt by ownerKey on the zone. Speed/mass buff
      // dropped to neutral since the zone IS the L.
      name: 'Frozen Floor',
      description: 'Coats the ground in ice — enemies slip and slide',
      duration: 3.0, cooldown: 17.0, windUp: 0.4,
      speedMultiplier: 1.10, massMultiplier: 1.10,
      frozenFloorL: true,
      // 2026-04-30 final-polish (Rafa: "agrandar tamaño/radio +
      // añadir +2s duración"). Radius 6.0 → 8.0 and floorDuration
      // 5.0 → 7.0 — sigue siendo divertida sin ser ruptora porque
      // el slippery solo escala friction, no crea void.
      floorRadius: 8.0,
      floorDuration: 7.0,
    }),
  ],

  // Cheeto — Assassin: L is the SHORTEST window (2.0 s) and FASTEST
  // speed× (1.55) on the lowest cooldown (14 s). Burst-window identity.
  Cheeto: [
    makeChargeRush({
      name: 'Pounce', description: 'Lightning-fast predator lunge',
      impulse: 33, duration: 0.24, cooldown: 2.8, windUp: 0.04,
      speedMultiplier: 3.0, massMultiplier: 1.2,
    }),
    makeBlink({
      // 2026-04-29 K-refinement — Cheeto Shadow Step ahora seek
      // al enemigo más cercano dentro de blinkSeekRange y aterriza
      // pegado al target. Empuja MUCHO más fuerte. Fallback al
      // facing-blink si no hay target en rango.
      name: 'Shadow Step',
      description: 'Teleport onto the nearest target — knock them out',
      blinkDistance: 4.5,
      cooldown: 5.5,
      windUp: 0.06,
      duration: 0.10,
      blinkSeekNearest: true,
      blinkSeekRange: 9.0,
      blinkSeekOffset: 1.4,
      blinkImpactRadius: 3.2,
      blinkImpactForce: 48,
    }),
    makeFrenzy({
      // 2026-05-01 microfix (Rafa: "solo el primer pulso empujaba"):
      //   - pulseRadius 5.5 → 6.5 (catches a target the prior pulse
      //     just shoved across the cone exit boundary)
      //   - pulseForce 40 → 36 BASE (the ramp adds the real punch:
      //     pulse N = base × (1 + (N - 1) × 0.5), so N=6 ≈ 3.5×)
      // The per-pulse force ramp + rising-edge state reset live in
      // tickLOffline / BrawlRoom — see 2026-05-01 microfix comments.
      name: 'Cone Pulse',
      description: 'Channels a roaring frontal pulse — escalating push',
      duration: 1.8, cooldown: 14.0, windUp: 0.35,
      speedMultiplier: 0.0, massMultiplier: 4.0,
      conePulseL: true,
      pulseInterval: 0.30,
      pulseRadius: 6.5,
      pulseAngleDeg: 45,
      pulseForce: 36,
    }),
  ],

  // Sebastian — Glass Cannon: L stays short and balanced — the real
  // identity is on J/K (vicious dash + brutal small slam). The buff
  // is a finisher window, not a tank mode.
  Sebastian: [
    makeChargeRush({
      // v0.11 (Rafa: "más potencia y empuje"): impulse 28 → 33,
      // mass 1.4 → 1.7. Glass Cannon — el dash es ahora una
      // amenaza real de un solo golpe.
      name: 'Claw Rush', description: 'Sideways scuttle charge',
      impulse: 33, duration: 0.28, cooldown: 3.5,
      speedMultiplier: 2.6, massMultiplier: 1.7,
    }),
    makeGroundPound({
      // v0.11 (Rafa: "onda expansiva frontal desde el bichito"):
      // ground_pound con coneAngleDeg 60° — solo empuja en el
      // arco frontal de 120°. Mismo radius/force pero direccional.
      // Identidad "Glass Cannon" se refuerza: Sebastian no protege
      // espalda con esta K.
      // 2026-04-29 final-K (Rafa: "duplicar potencia"): force 38
      // → 76. Lectura "el alacrán arrasa lo que tiene delante".
      // Sigue en cono frontal ±60° y solo afecta a quien está
      // delante; cancelAnimOnEnd intacto.
      name: 'Claw Wave', description: 'Frontal claw shockwave — heavy frontal knockback',
      radius: 3.5, force: 76, windUp: 0.30, cooldown: 6.5,
      duration: 0.45,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      coneAngleDeg: 60,
    }),
    makeFrenzy({
      // 2026-04-30 final-L — All-in Side Slash. The frenzy
      // duration is the WINDUP only (1.0 s rooted vibrate).
      // When duration ticks to ≤ 0 the dispatcher fires a
      // single fast lateral dash that hit-checks against
      // enemies in front of Sebastian. On hit: huge knockback
      // to target, ability ends. On miss: Sebastian receives
      // a large self-knockback toward the arena edge as the
      // high-risk punishment. Implemented as a frenzy because
      // the `active` flag handles the rooted windup naturally.
      name: 'All-in Side Slash',
      description: 'Charge then strike — devastating on hit, costly on miss',
      duration: 1.0, cooldown: 15.0, windUp: 0.0,
      speedMultiplier: 0.0, massMultiplier: 1.20,
      allInL: true,
      allInDashSpeed: 28,
      allInDashRange: 9.0,
      allInHitForce: 110,
      allInMissSelfForce: 130,
      // 2026-05-01 final block (Rafa: "PRESS+HOLD muestra preview,
      // RELEASE ejecuta"). The dash no longer fires on activation;
      // it fires on the release of the L input. Auto-release after
      // 3.0 s as a safety so a held-down ult never blocks a match.
      holdToFireL: true,
      holdToFireMaxMs: 3000,
    }),
  ],
};

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

/**
 * Cosmetic kind for a slow zone. Lets per-zone visual layers — like
 * the local Kermit Poison Cloud overlay — distinguish the K-source
 * without re-deriving from radius/slowMultiplier (which is fragile).
 *   · 'poison' — Kermit Poison Cloud (triggers screen-space toxic
 *                vignette overlay when the local critter is inside)
 *   · 'sand'   — Sihans Burrow quicksand
 *   · 'ice'    — Kowalski Arctic Burst
 *   · 'generic' — fallback for any other critter that drops a zone
 */
export type ZoneVfxKind = 'poison' | 'sand' | 'ice' | 'generic';

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
    const force = def.allInHitForce ?? 100;
    hit.vx += dirX * force;
    hit.vz += dirZ * force;
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
// VFX: frenzy activation burst
// ---------------------------------------------------------------------------

/**
 * Optional palette overrides for `spawnFrenzyBurst`. Both colours fall
 * back to the original gold-red battle-cry palette when omitted, so
 * existing call sites keep working without changes.
 */
export interface FrenzyBurstOpts {
  /** Outer ring colour. Default `0xffaa22` (warm gold). */
  color?: number;
  /** Inner flash colour. Default `0xff2200` (red pop). */
  secondary?: number;
}

/**
 * One-shot "battle cry" ring spawned at the moment Frenzy activates.
 * Smaller and more contained than a Shockwave ring — it's a self-centred
 * buff indicator, not an AoE hit. Two concentric tori (outer expanding
 * + inner fast flash) that scale ~2.5 m over 600 ms and fade. Runs in
 * addition to the pulsing emissive glow already handled in critter.ts.
 *
 * Optional `opts` lets the caller override the palette so each critter's
 * Frenzy reads as its own colour (Cheeto orange, Kowalski ice, Kurama
 * violet, etc.). Omitting `opts` keeps the legacy gold-red look.
 */
export function spawnFrenzyBurst(scene: THREE.Scene, x: number, z: number, opts?: FrenzyBurstOpts): void {
  const duration = 600; // ms
  const startTime = performance.now();
  const maxRadius = 2.5;
  const outerColor = opts?.color ?? 0xffaa22;
  const innerColor = opts?.secondary ?? 0xff2200;

  // Outer ring: critter palette colour, the "battle cry"
  const ringGeo = new THREE.TorusGeometry(0.2, 0.18, 10, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0.9,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.6, z);
  scene.add(ring);

  // Inner flash: critter palette accent — quick pop at the origin
  const flashGeo = new THREE.TorusGeometry(0.2, 0.12, 10, 32);
  const flashMat = new THREE.MeshBasicMaterial({
    color: innerColor,
    transparent: true,
    opacity: 1.0,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.rotation.x = Math.PI / 2;
  flash.position.set(x, 0.75, z);
  scene.add(flash);

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Outer: cubic ease-out to maxRadius
    const outerEase = 1 - Math.pow(1 - t, 3);
    const outerScale = 0.2 + outerEase * (maxRadius / 0.2);
    ring.scale.set(outerScale, outerScale, 1);
    ringMat.opacity = 0.9 * (1 - t);

    // Inner: peaks fast, fades in ~40% of total duration
    const innerT = Math.min(t * 2.5, 1);
    const innerScale = 0.2 + innerT * (maxRadius * 0.55 / 0.2);
    flash.scale.set(innerScale, innerScale, 1);
    flashMat.opacity = 1.0 * (1 - innerT);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(ring);
      scene.remove(flash);
      ringGeo.dispose();
      ringMat.dispose();
      flashGeo.dispose();
      flashMat.dispose();
    }
  }
  requestAnimationFrame(animate);
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

// ---------------------------------------------------------------------------
// VFX: Sebastian All-in trajectory preview
// ---------------------------------------------------------------------------

/**
 * 2026-05-01 last-minute — Sebastian All-in trajectory preview. A
 * crimson ground line drawn from Sebastian's origin to the chosen
 * lateral edge endpoint, used during the 1 s rooted windup so the
 * player can SEE which way the slash will commit before pressing
 * any input. Fades in fast (~120 ms), holds for the bulk of the
 * windup, fades out at resolution.
 *
 * Pure visual — pulled into `fireFrenzy` when `def.allInL` is true.
 * Cleans up after `ttl` seconds; no per-frame state hung off
 * Critter.
 */
export function spawnAllInTrajectoryPreview(
  scene: THREE.Scene,
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  range: number,
  ttl: number,
): void {
  // Plane sized to the dash. Width is ~0.7 u so it reads as a
  // committed strip, not a hairline. Depth (range) is the literal
  // dash length so the player can read distance.
  const width = 0.75;
  const length = range;
  const geo = new THREE.PlaneGeometry(width, length);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xcc3333,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lay on the ground
  // The plane's local +Y direction (after the -π/2 X-rotation) lines
  // up with WORLD +Z. We need it pointing along (dirX, dirZ), so
  // rotate around Z by the angle between (0, 1) and (dirX, dirZ).
  const angleZ = Math.atan2(dirX, dirZ);
  mesh.rotation.z = angleZ;
  mesh.position.set(
    originX + dirX * length * 0.5,
    0.02, // a hair above the ground to avoid z-fight
    originZ + dirZ * length * 0.5,
  );
  scene.add(mesh);

  // Inner accent — narrower bright stripe down the middle so the line
  // reads even against busy decor.
  const innerGeo = new THREE.PlaneGeometry(width * 0.35, length);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.rotation.x = -Math.PI / 2;
  innerMesh.rotation.z = angleZ;
  innerMesh.position.set(
    originX + dirX * length * 0.5,
    0.025,
    originZ + dirZ * length * 0.5,
  );
  scene.add(innerMesh);

  const startTime = performance.now();
  const totalMs = ttl * 1000;
  const fadeInMs = 120;
  const fadeOutMs = 200;
  function animate(): void {
    const elapsed = performance.now() - startTime;
    if (elapsed >= totalMs) {
      scene.remove(mesh);
      scene.remove(innerMesh);
      geo.dispose();
      mat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      return;
    }
    let alpha = 1.0;
    if (elapsed < fadeInMs) alpha = elapsed / fadeInMs;
    else if (elapsed > totalMs - fadeOutMs) alpha = (totalMs - elapsed) / fadeOutMs;
    mat.opacity = 0.55 * alpha;
    innerMat.opacity = 0.85 * alpha;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// VFX: shockwave ring
// ---------------------------------------------------------------------------

/**
 * Optional palette + lifetime overrides for `spawnShockwaveRing`. Every
 * field falls back to the original red/white shockwave look so existing
 * callers (dash entry burst, anything that doesn't pass `opts`) keep
 * working without changes.
 */
export interface ShockwaveRingOpts {
  /** Outer ring colour. Default `0xff3322` (red slam). */
  color?: number;
  /** Inner flash colour. Default `0xffffff` (white pop). */
  secondary?: number;
  /** Total visible lifetime in milliseconds. Default `450`. Larger
   *  values keep the ring on screen longer — used for Kermit's Poison
   *  Cloud (800 ms) so the wide AoE reads as a hanging toxic puff. */
  holdMs?: number;
}

/**
 * v0.11 — Static decoy clone of a critter at the current position.
 * Used by Kurama Mirror Trick: the visual ghost stays where she
 * was while she's semi-invisible elsewhere. Fire-and-forget clone
 * of her GLB scene graph (skeleton-cloned so it doesn't keep
 * tracking the live skeleton), tinted to alpha 0.4 + violet
 * emissive. No physics, no collision, no AI redirect — purely
 * visual.
 *
 * Lifecycle: ttl seconds, then dispose. Fade-out in the last 30 %.
 */
export function spawnDecoyAt(
  scene: THREE.Scene,
  critter: Critter,
  ttl: number,
  overrideX?: number,
  overrideZ?: number,
  overrideRotY?: number,
): void {
  if (!critter.glbMesh) return; // procedural-only critters: skip
  // 2026-04-30 final-polish — snapshot the GLB world transform NOW,
  // before the SkeletonUtils dynamic import resolves. Fire path:
  // the K dispatcher calls spawnDecoyAt and IMMEDIATELY moves
  // Kurama by `decoyEscapeDistance`. Without this snapshot the
  // async clone reads the post-move position and the decoy ends
  // up next to her instead of where she activated the K.
  // 2026-05-01 microfix — accept (x, z, rotY) override so the
  // online path can spawn the decoy at the broadcast position
  // (where Kurama WAS at cast time per server) instead of her
  // current local position (which has already been state-synced
  // to the escape spot).
  const snapPos = overrideX !== undefined && overrideZ !== undefined
    ? new THREE.Vector3(overrideX, critter.glbMesh.position.y, overrideZ)
    : critter.glbMesh.getWorldPosition(new THREE.Vector3());
  const snapRot = overrideRotY !== undefined
    ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), overrideRotY)
    : critter.glbMesh.getWorldQuaternion(new THREE.Quaternion());
  const snapScl = critter.glbMesh.getWorldScale(new THREE.Vector3());
  // SkeletonUtils.clone gives an independent skeleton so the clone
  // doesn't keep retargeting Kurama's live bones. Imported lazily
  // to avoid a top-level cycle.
  void (async () => {
    const SkeletonUtils = await import('three/examples/jsm/utils/SkeletonUtils.js');
    const decoy = SkeletonUtils.clone(critter.glbMesh!);
    decoy.position.copy(snapPos);
    decoy.quaternion.copy(snapRot);
    decoy.scale.copy(snapScl);
    const decoyMats: THREE.MeshStandardMaterial[] = [];
    decoy.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const clonedList: THREE.Material[] = [];
      for (const raw of mats) {
        const std = raw as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) {
          clonedList.push(raw as THREE.Material);
          continue;
        }
        const cloned = std.clone();
        cloned.transparent = true;
        cloned.opacity = 0.4;
        cloned.depthWrite = false;
        cloned.emissive.setHex(0xc83cff);
        cloned.emissiveIntensity = 0.6;
        decoyMats.push(cloned);
        clonedList.push(cloned);
      }
      m.material = Array.isArray(m.material) ? clonedList as THREE.Material[] : clonedList[0];
    });
    scene.add(decoy);
    const startTime = performance.now();
    const total = ttl * 1000;
    const fadeStart = total * 0.7;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed >= total) {
        scene.remove(decoy);
        decoy.traverse((n) => {
          const m = n as THREE.Mesh;
          if (m.isMesh) m.geometry?.dispose();
        });
        for (const mat of decoyMats) mat.dispose();
        return;
      }
      if (elapsed > fadeStart) {
        const t = (elapsed - fadeStart) / (total - fadeStart);
        for (const mat of decoyMats) mat.opacity = 0.4 * (1 - t);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();
}

/**
 * Persistent slow-zone disc — a flat translucent disc + a faint slow-
 * pulsing torus on top, both alive for the zone's full lifetime. Used
 * for Kermit's Poison Cloud and Kowalski's Arctic Burst. Differs from
 * `spawnShockwaveRing` in three ways:
 *
 *   1. It STAYS visible for the whole `durationSec`, not 450 ms.
 *   2. It draws a filled disc on the ground (the actual debuff zone)
 *      AND a torus boundary (so the player can read its edge).
 *   3. The pulse animation is gentle (sine-driven) so it reads as
 *      "this is a hazard that's still here", not "this just happened".
 *
 * Cleanup is automatic via the same `requestAnimationFrame` self-loop
 * used elsewhere — when t reaches 1 we remove + dispose. The mesh has
 * `depthWrite: false` so it never z-fights with the arena floor or
 * the critters standing inside it.
 */
export function spawnZoneRing(
  scene: THREE.Scene,
  x: number, z: number,
  radius: number,
  durationSec: number,
  color: number = 0x66ff44,
  secondary: number = 0xffffff,
  vfxKind?: ZoneVfxKind,
): void {
  const duration = durationSec * 1000;
  const startTime = performance.now();
  // Filled disc — the actual hazard surface
  const discGeo = new THREE.CircleGeometry(radius, 36);
  const discMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, 0.03, z);
  scene.add(disc);
  // Boundary torus — secondary colour, pulses gently
  const ringGeo = new THREE.TorusGeometry(radius, 0.18, 8, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: secondary, transparent: true, opacity: 0.65,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);

  // 2026-04-29 K-refinement — Kermit Poison Cloud body. Spawn
  // ~14 transparent green spheres at random positions inside the
  // disc, slowly bobbing. They live for the full zone duration
  // and read as a thick volumetric cloud from outside. Cheap:
  // shared geometry (small icosphere), per-instance material so
  // each can fade independently.
  const poisonPuffs: Array<{
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    geo: THREE.BufferGeometry; baseY: number; bobPhase: number;
    bobSpeed: number; baseOpacity: number;
  }> = [];
  if (vfxKind === 'poison') {
    const PUFF_COUNT = 14;
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < PUFF_COUNT; i++) {
      // Random position inside the disc, slightly raised.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (radius * 0.85);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const py = 0.6 + Math.random() * 1.6; // 0.6 .. 2.2 above ground
      const scale = 0.7 + Math.random() * 0.9;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? secondary : color,
        transparent: true,
        opacity: 0.0, // ramps up via fadeIn below
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(puffGeo, mat);
      mesh.scale.setScalar(scale);
      mesh.position.set(px, py, pz);
      scene.add(mesh);
      poisonPuffs.push({
        mesh, mat, geo: puffGeo, baseY: py,
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.6 + Math.random() * 0.5,
        baseOpacity: 0.45 + Math.random() * 0.18,
      });
    }
  }
  // 2026-04-29 K-refinement — Sihans Quicksand swirl. When the zone
  // is `vfxKind: 'sand'` we layer two additional inner discs that
  // rotate around Y at different speeds, producing a remolino /
  // whirlpool read instead of "another flat circle on the floor".
  // Polar UV would be nicer but a simple textured disc is overkill
  // for jam scope — the rotation alone communicates "the floor is
  // moving" against the static ring.
  const sandSwirls: Array<{
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    geo: THREE.BufferGeometry; speed: number; baseOpacity: number;
  }> = [];
  if (vfxKind === 'sand') {
    // Three stacked rings rotating at very different speeds → reads
    // as a heavy whirlpool, not a flat circle. 2026-04-29 final-K
    // (Rafa: "enfatizar más el vórtice/remolino").
    // Outer wide ring — slow, big arc
    {
      const geo = new THREE.RingGeometry(radius * 0.50, radius * 0.95, 36, 1);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.04, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: 1.5, baseOpacity: 0.45 });
    }
    // Mid ring — counter-rotation, crisp edges
    {
      const geo = new THREE.RingGeometry(radius * 0.25, radius * 0.65, 32, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: secondary, transparent: true, opacity: 0.55,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.05, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: -3.4, baseOpacity: 0.55 });
    }
    // Inner core — fast spin, small, dark sand "throat"
    {
      const geo = new THREE.RingGeometry(0.05, radius * 0.30, 24, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6b4a1f, transparent: true, opacity: 0.70,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.06, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: 5.5, baseOpacity: 0.70 });
    }
  }

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Gentle pulse on the torus, slow fade on both during the last 25 %
    const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.006);
    ring.scale.set(pulse, pulse, 1);
    const fadeIn = Math.min(elapsed / 200, 1);          // ramp in over 200 ms
    const fadeOut = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    discMat.opacity = 0.22 * fadeIn * fadeOut;
    ringMat.opacity = 0.65 * fadeIn * fadeOut;
    // Swirl rings rotate around their local Z axis (which after the
    // -PI/2 X rotation maps to world Y) at fixed angular velocities.
    for (const sw of sandSwirls) {
      sw.mesh.rotation.z = (elapsed / 1000) * sw.speed;
      sw.mat.opacity = sw.baseOpacity * fadeIn * fadeOut;
    }
    // Poison puffs bob gently and fade in/out with the same envelope.
    for (const p of poisonPuffs) {
      p.mesh.position.y = p.baseY + 0.18 * Math.sin((elapsed / 1000) * p.bobSpeed + p.bobPhase);
      p.mat.opacity = p.baseOpacity * fadeIn * fadeOut;
    }
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(disc); scene.remove(ring);
      discGeo.dispose(); discMat.dispose();
      ringGeo.dispose(); ringMat.dispose();
      for (const sw of sandSwirls) {
        scene.remove(sw.mesh);
        sw.geo.dispose();
        sw.mat.dispose();
      }
      // Puffs share the icosahedron geometry — dispose once after
      // the loop, not per-instance.
      let sharedPuffGeo: THREE.BufferGeometry | null = null;
      for (const p of poisonPuffs) {
        scene.remove(p.mesh);
        p.mat.dispose();
        sharedPuffGeo = p.geo;
      }
      sharedPuffGeo?.dispose();
    }
  }
  requestAnimationFrame(animate);
}

/**
 * Spawn a dramatic shockwave at (x, z). Two concentric rings:
 *  - inner flash that expands fast and fades quickly
 *  - outer torus that expands to maxRadius with a thicker tube
 *
 * Optional `opts` lets each critter tint the ring to its element + extend
 * the lifetime for visually heavier abilities. Omit `opts` for the
 * legacy red/white slam (still used by the dash entry burst).
 */
export function spawnShockwaveRing(
  scene: THREE.Scene,
  x: number,
  z: number,
  maxRadius: number,
  opts?: ShockwaveRingOpts,
): void {
  const duration = opts?.holdMs ?? 450; // ms
  const startTime = performance.now();
  const outerColor = opts?.color ?? 0xff3322;
  const innerColor = opts?.secondary ?? 0xffffff;

  // Outer torus (the "slam" ring) — tinted per critter when provided
  const outerGeo = new THREE.TorusGeometry(0.3, 0.28, 10, 40);
  const outerMat = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0.9,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = Math.PI / 2;
  outer.position.set(x, 0.35, z);
  scene.add(outer);

  // Inner flash (fades faster than the outer ring)
  const innerGeo = new THREE.TorusGeometry(0.3, 0.18, 10, 40);
  const innerMat = new THREE.MeshBasicMaterial({
    color: innerColor,
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
