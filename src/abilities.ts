import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerHitStop, triggerCameraShake, applyDashFeedback, applyLandingFeedback, applyImpactFeedback, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { spawnDustPuff } from './dust-puff';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy' | 'blink';

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
      name: 'Shockwave',
      description: 'Slams ground with both fists',
      radius: 3.5,
      force: 34,
      windUp: 0.30,
      cooldown: 6.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
    }),
    makeFrenzy({
      description: 'Enters berserk mode: +speed, +power',
      duration: 2.5,
      cooldown: 15.0,
      windUp: 0.35,
      // v0.11 buff (Rafa: "darle más potencia"): speed 1.45 → 1.55,
      // mass 1.50 → 1.75. Sergei stays balanced but the gorilla's
      // berserk window now genuinely overpowers a mid-fight stalemate.
      speedMultiplier: 1.55,
      massMultiplier: 1.75,
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
      // v0.11 (Rafa: "más distancia y más potencia"): impulse 20 → 25,
      // duration 0.35 → 0.42, mass 3.5 → 4.0. Recorre ~30 % más
      // distancia y rompe paredes de tanques con más naturalidad.
      // clipPlaybackRate sube a 6.0 para que el clip sigue cuadrando
      // con la nueva duración.
      name: 'Trunk Ram',
      description: 'Unstoppable forward dash with tusks',
      impulse: 25,
      duration: 0.42,
      cooldown: 4.5,
      windUp: 0.08,
      speedMultiplier: 2.1,
      massMultiplier: 4.0,
      clipPlaybackRate: 6.0,
    }),
    makeGroundPound({
      // v0.11 (Rafa: "no hace lo que debe hacer"): radius 4.5 → 4.8,
      // force 40 → 48 + shakeBoost: true (camera shake × 1.4 al
      // disparar). El Earthquake ahora SE LEE como terremoto: ring
      // mucho más ancho que cualquier otro K, knockback brutal,
      // sacudida pantalla notable.
      name: 'Earthquake',
      description: 'Foot stomp that shakes the arena',
      radius: 4.8,
      force: 48,
      windUp: 0.60,
      cooldown: 7.5,
      clipPlaybackRate: 2.8,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      shakeBoost: 1.4,
    }),
    makeFrenzy({
      // v0.11 (Rafa: "bastante más fuerte" + "anim colgada"):
      // speed 1.25 → 1.35, mass 1.80 → 2.10, cancelAnimOnEnd: true
      // para cortar el clip de Ability3GroundPound al terminar el
      // buff (era el síntoma del "anim colgada").
      name: 'Stampede',
      description: 'Enraged charge: +speed, +mass',
      duration: 3.0,
      cooldown: 18.0,
      windUp: 0.45,
      speedMultiplier: 1.35,
      massMultiplier: 2.10,
      cancelAnimOnEnd: true,
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
    makeGroundPound({
      name: 'Mirror Trick',
      description: 'Leave a decoy and ghost step for 1.6 s',
      radius: 0, force: 0,
      windUp: 0.10, cooldown: 7.0, duration: 1.6,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      selfBuffOnly: true,
      selfImmunityDuration: 1.6,
      invisibilityDuration: 1.6,
    }),
    makeFrenzy({
      name: 'Nine-Tails Frenzy',
      description: 'A short agile frenzy with high speed',
      duration: 3.5, cooldown: 16.0, windUp: 0.30,
      speedMultiplier: 1.50, massMultiplier: 1.20,
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
      name: 'Steel Shell',
      description: 'Lock into the shell — invulnerable for 5 s',
      radius: 0, force: 0,
      windUp: 0.20, cooldown: 12.0, duration: 5.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      selfBuffOnly: true,
      selfImmunityDuration: 5.0,
      selfTintHex: 0xa8c0d0, // metallic blue-gray
    }),
    makeFrenzy({
      name: 'Berserker Shell',
      description: 'Become heavier and harder to push',
      duration: 3.5, cooldown: 18.0, windUp: 0.4,
      speedMultiplier: 1.20, massMultiplier: 1.65,
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
      name: 'Poison Cloud',
      description: 'Wide toxic burst — leaves a slowing fog',
      radius: 5.0, force: 14, windUp: 0.15, cooldown: 7.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      // Lingering toxic fog: 2.0 s on the ground, 60 % movement speed
      // for anyone standing inside. The slam itself still nudges
      // everyone with the same low force; the zone is the
      // controller-defining piece — Kermit forces the fight to
      // happen somewhere ELSE for two seconds.
      zone: {
        radius: 5.0,
        duration: 2.0,
        slowMultiplier: 0.60,
        color: 0x66ff44,
        secondary: 0x9c3cee,
      },
    }),
    makeFrenzy({
      name: 'Hypnosapo',
      description: 'Become slow, heavy and hard to move',
      duration: 4.0, cooldown: 18.0, windUp: 0.4,
      speedMultiplier: 1.10, massMultiplier: 1.80,
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
      name: 'Sand Trap',
      description: 'Burrow under, leave quicksand, surface ahead',
      blinkDistance: 3.5,
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
      name: 'Diggy Rush',
      description: 'Long earthy frenzy with extra mass',
      duration: 4.5, cooldown: 20.0, windUp: 0.4,
      speedMultiplier: 1.15, massMultiplier: 1.50,
    }),
  ],

  // Kowalski — Mage: L pushes the speed dial high while leaving mass
  // light, so the buff reads "ranged blitzer" not "tank". K (Arctic
  // Burst) keeps the widest-ring/lowest-force profile from before.
  Kowalski: [
    makeChargeRush({
      name: 'Ice Slide', description: 'Slides forward on an ice trail',
      impulse: 19, duration: 0.30, cooldown: 4.2,
      speedMultiplier: 2.4, massMultiplier: 1.5,
    }),
    makeGroundPound({
      name: 'Arctic Burst',
      description: 'Wide blast — leaves icy ground that slows',
      radius: 5.0, force: 20, windUp: 0.4, cooldown: 7.0,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      // Icy patch: shorter than Kermit's fog (1.6 s vs 2.0 s) but
      // a touch deeper slow (0.55 vs 0.60). Reads as "ranged zoner"
      // with ice instead of toxic.
      zone: {
        radius: 5.0,
        duration: 1.6,
        slowMultiplier: 0.55,
        color: 0x6cc9ff,
        secondary: 0xffffff,
      },
    }),
    makeFrenzy({
      name: 'Blizzard',
      description: 'Fast icy frenzy with light mass',
      duration: 3.0, cooldown: 17.0, windUp: 0.4,
      speedMultiplier: 1.40, massMultiplier: 1.10,
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
      // v0.11 (Rafa: "al aparecer debe provocar empuje fuerte"):
      // se mantiene blink + se añade impact knockback radial en
      // destino para los enemigos cercanos a donde aparece Cheeto.
      name: 'Shadow Step',
      description: 'Blink forward — burst pushes nearby enemies',
      blinkDistance: 4.5,
      cooldown: 5.5,
      windUp: 0.06,
      duration: 0.10,
      blinkImpactRadius: 2.2,
      blinkImpactForce: 28,
    }),
    makeFrenzy({
      name: 'Tiger Rage',
      description: 'Very short burst of extreme speed',
      duration: 2.0, cooldown: 14.0, windUp: 0.35,
      speedMultiplier: 1.55, massMultiplier: 1.05,
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
      name: 'Claw Wave', description: 'Frontal claw shockwave',
      radius: 3.5, force: 38, windUp: 0.30, cooldown: 6.5,
      slowDuringActive: 0, cancelAnimOnEnd: true,
      coneAngleDeg: 60,
    }),
    makeFrenzy({
      name: 'Red Claw',
      description: 'Short aggressive frenzy for finishing blows',
      duration: 2.5, cooldown: 15.0, windUp: 0.4,
      speedMultiplier: 1.20, massMultiplier: 1.20,
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
      // Cliente-only: spawn a static decoy clone at the current
      // position, then kick the caster's invisibility timer so the
      // visual layer (in updateVisuals / vfx) drops her alpha.
      spawnDecoyAt(scene, critter, invisDur);
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
  // Per-critter tint: each shockwave reads as the critter's element
  // (Trunk earth, Kurama violet illusion, Kowalski ice, etc.). When
  // no entry exists for the critter, `spawnShockwaveRing` falls back
  // to its original red palette.
  spawnShockwaveRing(scene, critter.x, critter.z, def.radius, CRITTER_VFX_PALETTE[critter.config.name]?.pound);
  playSound('groundPound');
  // Lingering zone (Kermit Poison Cloud, Kowalski Arctic Burst, …) —
  // pushes a slow-zone entry into the offline tracker and renders a
  // persistent ground ring so the area-debuff reads visually for the
  // full lifetime. Server-side mirror is in BrawlRoom; this branch
  // covers offline matches.
  if (def.zone) {
    activeZones.push({
      x: critter.x, z: critter.z,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
    });
    spawnZoneRing(scene, critter.x, critter.z, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary);
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
}

const activeZones: ActiveZone[] = [];

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

/** Compound slow multiplier from every active zone the point is inside.
 *  Returns 1.0 when not inside any zone. Multiplicative when overlapping. */
export function getZoneSlowMultiplier(x: number, z: number): number {
  let m = 1.0;
  for (const zone of activeZones) {
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
  const dist = def.blinkDistance ?? 4.0;
  // Capture origin for VFX + optional zone-at-origin (Sihans Burrow).
  const originX = critter.x;
  const originZ = critter.z;
  let targetX = critter.x + Math.sin(angle) * dist;
  let targetZ = critter.z + Math.cos(angle) * dist;
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
    activeZones.push({
      x: zx, z: zz,
      radius: def.zone.radius,
      slowMultiplier: def.zone.slowMultiplier,
      ttl: def.zone.duration,
    });
    spawnZoneRing(scene, zx, zz, def.zone.radius, def.zone.duration, def.zone.color, def.zone.secondary);
  }
  applyDashFeedback(critter);
  playSound('abilityFire');
}

function fireFrenzy(_def: AbilityDef, critter: Critter, _all: Critter[], scene: THREE.Scene): void {
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
}

const EFFECT_MAP: Record<AbilityType, (def: AbilityDef, critter: Critter, all: Critter[], scene: THREE.Scene) => void> = {
  charge_rush: fireChargeRush,
  ground_pound: fireGroundPound,
  frenzy: fireFrenzy,
  blink: fireBlink,
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
function spawnDecoyAt(scene: THREE.Scene, critter: Critter, ttl: number): void {
  if (!critter.glbMesh) return; // procedural-only critters: skip
  // SkeletonUtils.clone gives an independent skeleton so the clone
  // doesn't keep retargeting Kurama's live bones. Imported lazily
  // to avoid a top-level cycle.
  void (async () => {
    const SkeletonUtils = await import('three/examples/jsm/utils/SkeletonUtils.js');
    const decoy = SkeletonUtils.clone(critter.glbMesh!);
    decoy.position.copy(critter.glbMesh!.getWorldPosition(new THREE.Vector3()));
    decoy.quaternion.copy(critter.glbMesh!.getWorldQuaternion(new THREE.Quaternion()));
    decoy.scale.copy(critter.glbMesh!.getWorldScale(new THREE.Vector3()));
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
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(disc); scene.remove(ring);
      discGeo.dispose(); discMat.dispose();
      ringGeo.dispose(); ringMat.dispose();
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
