// ---------------------------------------------------------------------------
// abilities.ts — CONFIG layer of the abilities system.
// 2026-08-24 ROADMAP H4 split: "Split de abilities.ts (config/runtime/vfx)".
//
// This file keeps ONLY data + types: the AbilityDef/AbilityState types,
// the make* factories, the per-critter VFX palette and CRITTER_ABILITIES.
// Gameplay logic (activation, effect dispatch, zones, tick update) lives
// in ./abilities-runtime.ts; THREE-only visual spawners live in
// ./abilities-vfx.ts.
//
// Import rule (no cycles): this module imports NOTHING from
// abilities-runtime or abilities-vfx — only FEEL from ./gamefeel.
//
// DO NOT move or rename this file, and keep CRITTER_ABILITIES here:
// the ability-patch applier (scripts/tool-patch-core.mjs, targetByTool)
// and the parity scraper (scripts/verify-ability-parity.mjs) locate the
// exported CRITTER_ABILITIES declaration in src/abilities.ts by text.
// (Do not spell out its exact declaration text in comments above the
// real one — the applier anchors on the first occurrence.)
// ---------------------------------------------------------------------------

import { FEEL } from './gamefeel';

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

export const CRITTER_VFX_PALETTE: Record<string, CritterVfxPalette> = {
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
      // 2026-05-01 final block + micropasses — slam stun:
      //   1.0 → 2.0 (final block, ×2 ask)
      //   2.0 → 1.7 (micropass 1, -15 %)
      //   1.7 → 1.5 (micropass 2, otro -12 %)
      // Sigue habilitando el combo Slam → headbutt ×4, pero la
      // ventana de escape ya es razonable.
      slamStunDuration: 1.5,
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
      // BLOQUE FINAL micropasses — gripStunDuration:
      //   5.0 → 4.25 (-15 %, micropass 1)
      //   4.25 → 3.80 (-11 %, micropass 2)
      // Sigue siendo CC dominante con la "vulnerable ×4" rule, pero la
      // víctima ya no queda casi 5 s sin opciones.
      description: 'Trunk pulls a target close — they take ×4 from any hit for 3.8 s',
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
      gripStunDuration: 3.80,
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
      // 2026-08-21 balance v2 it3: retag aoe_push → defensive. Heredaba
      // el tag del factory y el bot lo quemaba con la condición de AoE
      // (radius 0 + force 0 = cast desperdiciado). Con el tag correcto
      // entra en el trigger defensivo reactivo del cerebro (bot.ts).
      tags: ['defensive'],
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
      // BLOQUE FINAL micropass v2 — hit force bumped 110 → 220 to
      // shake the victim's momentum even when maxSpeed clamps. Combined
      // with the explicit startFalling() in fireAllInResolution, the
      // contact reads as "yeeted to void". Miss self-force unchanged.
      allInHitForce: 220,
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
