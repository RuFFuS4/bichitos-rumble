// ---------------------------------------------------------------------------
// Server-side ability system
// ---------------------------------------------------------------------------
//
// Generic architecture wiring all 3 ability types authoritatively. Each
// per-kit definition lives here (cooldown / duration / windUp / effect
// overrides); the client mirrors the timings via clientside prediction
// of cooldown bars but never decides whether an ability fires.
//
// Flow per tick:
//   1. Check input — if input flag set AND ability ready, activate
//   2. For each active ability: drain windUpLeft, then fire effect once,
//      then drain durationLeft. When duration expires, set cooldown.
//   3. Effect-fired events are broadcast via callback (for client VFX).
// ---------------------------------------------------------------------------

import type { PlayerSchema } from '../state/PlayerSchema.js';
import { AbilityStateSchema } from '../state/AbilityStateSchema.js';
import { SIM } from './config.js';
import { FRAG } from './arena-fragments.js';

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy' | 'blink' | 'projectile';

/**
 * Per-ability tuning. The simulation falls back to SIM.* defaults when a
 * field is omitted, but for character IDENTITY to read online, each kit
 * should override the relevant per-type fields so different critters
 * actually feel different on the server.
 */
export interface AbilityDef {
  type: AbilityType;
  cooldown: number;
  duration: number;
  windUp: number;
  // charge_rush per-kit tuning (falls back to SIM.chargeRush.*)
  impulse?: number;
  speedMultiplier?: number;
  massMultiplier?: number;
  // ground_pound per-kit tuning (falls back to SIM.groundPound.*)
  radius?: number;
  force?: number;
  // frenzy per-kit tuning (falls back to SIM.frenzy.*)
  frenzySpeedMult?: number;
  frenzyMassMult?: number;

  // --- 2026-04-29 final-abilities-candidate additions ---
  slowDuringWindUp?: number;
  slowDuringActive?: number;
  blinkDistance?: number;
  blinkImpactRadius?: number;
  blinkImpactForce?: number;
  coneAngleDeg?: number;
  zoneAtOrigin?: boolean;
  zone?: {
    radius: number;
    duration: number;
    slowMultiplier: number;
  };
  /** v0.11 — self-buff K (Shelly Steel Shell, Kurama Mirror Trick).
   *  Skips the outward knockback; instead writes
   *  `player.immunityTimer` for the duration so `physics.resolveCollisions`
   *  blocks knockback from any source. */
  selfBuffOnly?: boolean;
  /** Seconds of immunity to grant the caster on activation. */
  selfImmunityDuration?: number;
  /** 2026-04-29 K-refinement — Shelly Steel Shell physical anchor.
   *  When true + selfBuffOnly true, the caster's `effectiveMass`
   *  is multiplied by 9999 while the buff is active, so other
   *  critters running into her are shoved back and Shelly herself
   *  doesn't budge. */
  selfAnchorWhileBuffed?: boolean;
  /** 2026-04-29 K-refinement — Kurama Mirror Trick escape distance.
   *  When > 0 on a self-buff K, the caster teleports this many
   *  units AWAY from the closest enemy at activation. Fallback:
   *  along facing if no enemy. Pairs with `selfImmunityDuration`
   *  so the trick reads as "señuelo se queda, Kurama se va". */
  decoyEscapeDistance?: number;
  /** Fractions of the (disc-clamped) escape line tried in order until
   *  one lands on live floor; none = the caster stays put. Mirror of the
   *  client's `decoyEscapeFallbacks`. */
  decoyEscapeFallbacks?: readonly number[];

  // --- 2026-04-30 final-L flags (mirror of cliente AbilityDef) ---
  sawL?: boolean;
  sawContactImpulse?: number;
  sawSpinSpeed?: number;
  // 2026-05-01 — Trunk Stampede ramming (retired in the same-day
  // final pass when Trunk L was rebuilt as Grip; flags kept on the
  // interface for future reuse).
  rammingL?: boolean;
  ramContactImpulse?: number;
  // 2026-05-01 final — Trunk Slam K brief-stun on hit.
  slamStunDuration?: number;
  conePulseL?: boolean;
  pulseInterval?: number;
  pulseRadius?: number;
  pulseAngleDeg?: number;
  pulseForce?: number;
  /** Pulses per activation (mirror of the client field): the channel
   *  stops after this many, and the tick the L expires still counts as
   *  channel time so the last pulse can't be lost. */
  pulseCount?: number;
  allInL?: boolean;
  allInDashSpeed?: number;
  allInDashRange?: number;
  allInHitForce?: number;
  allInMissSelfForce?: number;
  // 2026-05-01 final block — Sebastian hold-to-fire flag.
  holdToFireL?: boolean;
  holdToFireMaxMs?: number;
  toxicTouchL?: boolean;
  confusedDuration?: number;
  frozenFloorL?: boolean;
  floorRadius?: number;
  floorDuration?: number;
  /** Frozen Floor: friction half-life and movement acceleration
   *  multipliers on the ice (mirror of the client fields). */
  floorFrictionMult?: number;
  floorAccelMult?: number;
  sinkholeL?: boolean;
  holeRadius?: number;
  holeDuration?: number;
  holeForce?: number;
  holeCastOffset?: number;
  copycatL?: boolean;

  /** 2026-04-29 final-K — Trunk Grip K. Authorial K replacement
   *  for the radial Earthquake. See client AbilityDef for full
   *  semantics; server mirror writes `target.stunTimer` on hit. */
  gripK?: boolean;
  gripFrontalRange?: number;
  gripFrontalAngleDeg?: number;
  gripPullDistance?: number;
  gripStunDuration?: number;

  /** Cheeto Shadow Step targeting (2026-04-29 K-refinement). When
   *  true, the blink seeks the nearest valid enemy and lands NEAR
   *  them (offset on the side opposite the caster's facing); when
   *  false, the blink uses the legacy `blinkDistance` along facing.
   *  Falls back to the legacy facing path when no target is found. */
  blinkSeekNearest?: boolean;
  /** Range cap for the seek-nearest path. Targets farther than this
   *  fall back to the facing-blink. Avoids cross-arena teleports. */
  blinkSeekRange?: number;
  /** When seeking, land this many units short of the target on the
   *  caster's side so the impact knockback connects but Cheeto
   *  doesn't overlap the target's capsule. Default 1.4 u. */
  blinkSeekOffset?: number;

  // --- 2026-04-29 K-session: projectile additions (Kowalski Snowball) ---
  /** World-space speed (units / second) of the projectile when fired. */
  projectileSpeed?: number;
  /** Lifetime in seconds before auto-despawn if the projectile hasn't
   *  hit anything yet. */
  projectileTtl?: number;
  /** Sphere radius used for both the visual scale and the sweep test
   *  against player capsules. */
  projectileRadius?: number;
  /** Knockback impulse applied to the victim's velocity along the
   *  projectile's facing direction at hit time. */
  projectileImpulse?: number;
  /** Status-slow duration applied to the victim on hit (seconds).
   *  The simulation writes `victim.slowTimer = Math.max(slowTimer,
   *  projectileSlowDuration)` so the slow stacks length-wise but
   *  doesn't compound multiplicatively. */
  projectileSlowDuration?: number;
}

/** Mirror of the client's COPYCAT_KEYS (src/abilities.ts): the L fields
 *  Kurama's Copycat takes from her target, each flag with the tuning its
 *  branch reads. Same list and same exclusion: Sebastian's All-in is not
 *  copied (it resolved when her 3.5 s ran out, wherever she was), so
 *  copying him gives the buff alone. */
export const COPYCAT_KEYS = [
  'sawL', 'sawContactImpulse', 'sawSpinSpeed',
  'conePulseL', 'pulseInterval', 'pulseRadius', 'pulseAngleDeg', 'pulseForce', 'pulseCount',
  'toxicTouchL', 'confusedDuration',
  'frozenFloorL', 'floorRadius', 'floorDuration', 'floorFrictionMult', 'floorAccelMult',
  'sinkholeL', 'holeRadius', 'holeDuration', 'holeForce', 'holeCastOffset',
] as const satisfies readonly (keyof AbilityDef)[];

// Per-critter ability kits. MUST stay in sync with client's CRITTER_ABILITIES.
// Tuning values (impulse/radius/force/multipliers) must match the client's
// factory overrides so offline and online feel identical per critter.
// Rooting profile shared by every K (ground_pound or blink). The
// player should be fully committed during both windup and active
// frames so the slam/blink reads as a planted pose rather than a
// drift. Default 0 (full root) — override per-critter only if a
// future K should explicitly allow drift. Mirrors what the client's
// `getSpeedMultiplier` does on the offline side.
const ROOTED_K = { slowDuringWindUp: 0, slowDuringActive: 0 } as const;

const CRITTER_ABILITY_KITS: Record<string, readonly AbilityDef[]> = {
  Sergei: [
    { type: 'charge_rush',  cooldown: 4.0, duration: 0.28, windUp: 0.04,
      impulse: 25, speedMultiplier: 2.6, massMultiplier: 2.2 },
    // 2026-04-29 final-K: force 34 → 68 (doblar potencia).
    { type: 'ground_pound', cooldown: 6.0, duration: 0.05, windUp: 0.30,
      radius: 3.5, force: 68, ...ROOTED_K },
    // 2026-04-30 final-polish — frenzy massMult 1.75 → 5.50 (near-
    // immovable berserk, Rafa "más resistencia"). speed unchanged.
    { type: 'frenzy',       cooldown: 15.0, duration: 2.5, windUp: 0.35,
      frenzySpeedMult: 1.55, frenzyMassMult: 5.50 },
  ],
  Trunk: [
    // 2026-04-30 final-polish (Rafa: "J debe recorrer más espacio"):
    // impulse 25 → 32, duration 0.42 → 0.55, speedMult 2.1 → 2.4.
    { type: 'charge_rush',  cooldown: 4.5, duration: 0.55, windUp: 0.08,
      impulse: 32, speedMultiplier: 2.4, massMultiplier: 4.0 },
    // 2026-05-01 final + micropasses — Trunk Slam K slamStun
    //   1.0 → 2.0 (final block) → 1.7 (m1) → 1.5 (m2). Combo
    //   Slam → headbutt sigue funcionando con ventana razonable.
    { type: 'ground_pound', cooldown: 7.0, duration: 0.05, windUp: 0.30,
      radius: 7.0, force: 50, ...ROOTED_K,
      slamStunDuration: 1.5 },
    // 2026-05-01 final — Trunk Grip. Micropasses gripStunDuration:
    //   5.0 → 4.25 (m1) → 3.80 (m2). CC dominante con margen.
    { type: 'ground_pound', cooldown: 18.0, duration: 0.05, windUp: 0.45,
      radius: 0, force: 0, ...ROOTED_K,
      gripK: true,
      gripFrontalRange: 28.0,
      gripFrontalAngleDeg: 35,
      gripPullDistance: 1.6,
      gripStunDuration: 3.80 },
  ],

  // --- Bloque C: 7 remaining playables ---

  // Kurama — Trickster: trades raw knockback for very fast K and an
  // agile, short-windowed Frenzy that rewards mobility plays.
  Kurama: [
    { type: 'charge_rush',  cooldown: 3.2, duration: 0.26, windUp: 0.05,
      impulse: 29, speedMultiplier: 2.8, massMultiplier: 1.3 },
    // 2026-04-29 K-refinement — Mirror Trick: duration 1.6 → 2.8,
    // cooldown 7 → 9, decoyEscapeDistance 7 (server teleports
    // Kurama away from the nearest enemy at fire time). Decoy
    // visual lives client-side; server only cares about the
    // physics teleport.
    { type: 'ground_pound', cooldown: 9.0, duration: 2.8, windUp: 0.10,
      radius: 0, force: 0, ...ROOTED_K,
      selfBuffOnly: true, selfImmunityDuration: 2.8,
      decoyEscapeDistance: 7.0, decoyEscapeFallbacks: [1, 0.7, 0.4] },
    // 2026-04-30 final-L — Copycat. At fire time takes the
    // COPYCAT_KEYS of the lastHitTarget's L, for that cast only.
    { type: 'frenzy',       cooldown: 16.0, duration: 3.5, windUp: 0.30,
      frenzySpeedMult: 1.50, frenzyMassMult: 1.20,
      copycatL: true },
  ],

  Shelly: [
    { type: 'charge_rush',  cooldown: 5.5, duration: 0.45, windUp: 0.08,
      impulse: 15, speedMultiplier: 1.8, massMultiplier: 3.2 },
    // v0.11 — Steel Shell. 2026-04-29 K-refinement: duration 5 → 4,
    // selfImmunityDuration mirrored, selfAnchorWhileBuffed:true
    // makes Shelly physically immovable during the buff (other
    // critters bounce off her).
    { type: 'ground_pound', cooldown: 12.0, duration: 4.0, windUp: 0.20,
      radius: 0, force: 0, ...ROOTED_K,
      selfBuffOnly: true, selfImmunityDuration: 4.0,
      selfAnchorWhileBuffed: true },
    // 2026-04-30 final-L — Saw Shell. Spin contact knockback.
    // 2026-04-30 final-polish — sawContactImpulse 32 → 90 (Rafa
    // "muchísimo más empuje"). Sentinel parity bumped.
    { type: 'frenzy',       cooldown: 18.0, duration: 3.5, windUp: 0.40,
      frenzySpeedMult: 1.40, frenzyMassMult: 1.65,
      sawL: true, sawContactImpulse: 90, sawSpinSpeed: 22 },
  ],

  // Kermit — Controller: K spawns a 2.0 s slow zone (60 % move speed
  // for anyone inside) on top of the wide low-force slam. The zone
  // is the actual identity piece; the slam itself just nudges.
  Kermit: [
    { type: 'charge_rush',  cooldown: 4.0, duration: 0.30, windUp: 0.06,
      impulse: 20, speedMultiplier: 2.3, massMultiplier: 1.7 },
    // 2026-04-29 K-refinement: zone duration 2.0 → 10.0, cooldown 7 → 16.
    { type: 'ground_pound', cooldown: 16.0, duration: 0.05, windUp: 0.15,
      radius: 5.0, force: 14, ...ROOTED_K,
      zone: { radius: 5.0, duration: 10.0, slowMultiplier: 0.60 } },
    // 2026-04-30 final-L — Toxic Touch. Confuses targets on contact.
    { type: 'frenzy',       cooldown: 18.0, duration: 4.0, windUp: 0.40,
      frenzySpeedMult: 1.30, frenzyMassMult: 1.30,
      toxicTouchL: true, confusedDuration: 3.0 },
  ],

  Sihans: [
    { type: 'charge_rush',  cooldown: 4.5, duration: 0.35, windUp: 0.08,
      impulse: 19, speedMultiplier: 2.1, massMultiplier: 2.0 },
    // v0.11 — Sand Trap: blink + zone-at-origin (quicksand)
    // 2026-04-29 K-refinement: blinkDistance 3.5 → 6.5 (más distancia
    // al emerger).
    { type: 'blink',        cooldown: 7.0, duration: 0.10, windUp: 0.20,
      blinkDistance: 6.5, ...ROOTED_K, zoneAtOrigin: true,
      zone: { radius: 3.5, duration: 2.5, slowMultiplier: 0.50 } },
    // 2026-04-30 final-L — Sinkhole. Hazard zone in front.
    { type: 'frenzy',       cooldown: 20.0, duration: 4.5, windUp: 0.40,
      frenzySpeedMult: 1.15, frenzyMassMult: 1.50,
      sinkholeL: true, holeRadius: 3.0, holeDuration: 5.0,
      holeForce: 19.25, holeCastOffset: 4.0 }, // 14 × 1.375 (2026-09-21 speed-up) — mirror of src/abilities.ts
  ],

  // Kowalski — Mage: K is now a real frontal SNOWBALL projectile
  // (v0.11 final-K, 2026-04-29). Travels along Kowalski's facing,
  // applies knockback + 2 s slow on hit, despawns on hit or TTL.
  // No more radial AoE — Rafa: "debe ser bola de nieve, no AoE".
  Kowalski: [
    { type: 'charge_rush',  cooldown: 4.2, duration: 0.30, windUp: 0.06,
      impulse: 19, speedMultiplier: 2.4, massMultiplier: 1.5 },
    // 2026-04-29 final-K: windUp 1.10 → 0.50 (cast más rápido),
    // slow 2.0 → 5.0 (frozen 5 s), cooldown 6.5 → 6.0.
    { type: 'projectile',   cooldown: 6.0, duration: 0.05, windUp: 0.50,
      ...ROOTED_K,
      projectileSpeed: 18,
      projectileTtl: 1.2,
      projectileRadius: 0.55,
      projectileImpulse: 22,
      projectileSlowDuration: 5.0 },
    // 2026-04-30 final-L — Frozen Floor slippery zone.
    // 2026-04-30 final-polish (Rafa "agrandar + +2s"): radius
    // 6.0 → 8.0, floorDuration 5.0 → 7.0.
    { type: 'frenzy',       cooldown: 17.0, duration: 3.0, windUp: 0.40,
      frenzySpeedMult: 1.10, frenzyMassMult: 1.10,
      frozenFloorL: true, floorRadius: 8.0, floorDuration: 7.0,
      floorFrictionMult: 5, floorAccelMult: 0.35 },
  ],

  // Cheeto — Assassin: K is now a real BLINK (4.5 u teleport along
  // facing) with a brief root window. The bot AI casts it by its shape
  // (blinkSeekNearest), see ./bot.ts.
  Cheeto: [
    { type: 'charge_rush',  cooldown: 2.8, duration: 0.24, windUp: 0.04,
      impulse: 33, speedMultiplier: 3.0, massMultiplier: 1.2 },
    // v0.11 — Shadow Step. 2026-04-29 K-refinement (Rafa: "se parece
    // demasiado a J + empuje débil"): blink ahora SEEK al enemigo
    // válido más cercano dentro de blinkSeekRange y aterriza al
    // lado del target. Si no hay target, fallback al facing-blink
    // legacy. Radius/force impact subidos otra vez (2.6→3.2, 36→48)
    // para que se sienta como entrada de asesino, no soft tap.
    { type: 'blink',        cooldown: 5.5, duration: 0.10, windUp: 0.06,
      blinkDistance: 4.5, ...ROOTED_K,
      blinkSeekNearest: true,
      blinkSeekRange: 9.0,
      blinkSeekOffset: 1.4,
      blinkImpactRadius: 3.2, blinkImpactForce: 48 },
    // 2026-05-01 microfix — pulseForce 40 → 36 base (ramp adds the
    // real punch: N=6 ≈ 3.5×), pulseRadius 5.5 → 6.5 (catches
    // targets the prior pulse pushed near cone exit).
    { type: 'frenzy',       cooldown: 14.0, duration: 1.8, windUp: 0.35,
      frenzySpeedMult: 0.0, frenzyMassMult: 4.0,
      conePulseL: true, pulseInterval: 0.30,
      pulseRadius: 6.5, pulseAngleDeg: 45, pulseForce: 36,
      pulseCount: 6 },
  ],

  Sebastian: [
    // v0.11 (Rafa: "más potencia y empuje"): impulse 28→33, mass 1.4→1.7
    { type: 'charge_rush',  cooldown: 3.5, duration: 0.28, windUp: 0.06,
      impulse: 33, speedMultiplier: 2.6, massMultiplier: 1.7 },
    // v0.11 — Claw Wave: cone-restricted ground_pound (frontal sweep,
    // 120° arc). 2026-04-29 final-K: force 38 → 76 (Rafa: "duplicar
    // potencia"). Cone gate intacto.
    { type: 'ground_pound', cooldown: 6.5, duration: 0.45, windUp: 0.30,
      radius: 3.5, force: 76, ...ROOTED_K, coneAngleDeg: 60 },
    // 2026-04-30 final-L — All-in Side Slash. Frenzy duration is the
    // 1.0 s rooted windup; the lateral dash + hit/miss resolution
    // fires when the duration ticks down.
    // 2026-05-01 final block — hold-to-fire: dash fires on RELEASE,
    // not press. Auto-release at 3000 ms. Mirrors offline.
    { type: 'frenzy',       cooldown: 15.0, duration: 1.0, windUp: 0.0,
      frenzySpeedMult: 0.0, frenzyMassMult: 1.20,
      allInL: true, allInDashSpeed: 28, allInDashRange: 9.0,
      // micropass v2 — hit force 110 → 220 to guarantee the visual
      // yeet on contact (BrawlRoom.ts paired with explicit fall flow).
      allInHitForce: 220, allInMissSelfForce: 130,
      holdToFireL: true, holdToFireMaxMs: 3000 },
  ],
};

const DEFAULT_KIT = CRITTER_ABILITY_KITS.Sergei;

/** Resolve the ability kit for a critter name (falls back to Sergei's). */
export function getAbilityKit(critterName: string): readonly AbilityDef[] {
  return CRITTER_ABILITY_KITS[critterName] ?? DEFAULT_KIT;
}

/** The Copycat def of the cast in flight, per player: Kurama's kit L plus
 *  the target's COPYCAT_KEYS. Keyed by the player object (like
 *  `contactRehit`), so it never crosses rooms and goes with the player.
 *  The kits are never written: they are module state that every room in
 *  the process shares. */
const copycatDefs = new WeakMap<PlayerSchema, AbilityDef>();

/** The L def the room's per-tick L passes must read for `player`: the
 *  Copycat copy while one is live, else the kit's. Mirror of the client's
 *  `abilityStates[2].def`. DEPLOY BLOCKER until BrawlRoom's passes 2.e/2.g
 *  read it instead of `getAbilityKit(...)[2]` (DISTRIBUCIÓN): without
 *  that, online, a Kurama copying Shelly, Cheeto or Kermit gets the buff
 *  alone. */
export function getLDef(player: PlayerSchema): AbilityDef | undefined {
  return copycatDefs.get(player) ?? getAbilityKit(player.critterName)[2];
}

/** Create initial ability state array for a new player by critter name. */
export function createAbilityStates(critterName: string): AbilityStateSchema[] {
  return getAbilityKit(critterName).map((def) => {
    const s = new AbilityStateSchema();
    s.abilityType = def.type;
    s.cooldownLeft = 0;
    s.durationLeft = 0;
    s.windUpLeft = 0;
    s.active = false;
    s.effectFired = false;
    return s;
  });
}

/**
 * Notification emitted when an ability effect fires this tick.
 * Rooms can use this to broadcast to clients for visual effects.
 */
export interface AbilityFiredEvent {
  sessionId: string;
  type: AbilityType;
  x: number;
  z: number;
  rotationY: number;
}

/** Dash and blink are the abilities that move the caster on purpose. */
function isMovementAbility(type: string): boolean {
  return type === 'charge_rush' || type === 'blink';
}

/** Mirror of the client's anchor gate (abilities-runtime.ts): no dash or
 *  blink can start while another slot holds a self-anchoring buff
 *  (Shelly Steel Shell), wind-up included. */
function blockedByAnchor(slot: number, player: PlayerSchema, kit: readonly AbilityDef[]): boolean {
  if (!isMovementAbility(kit[slot]?.type ?? '')) return false;
  for (let j = 0; j < player.abilities.length; j++) {
    if (j !== slot && player.abilities[j].active && kit[j]?.selfAnchorWhileBuffed) return true;
  }
  return false;
}

/** End slot `j` early: whatever it had left doesn't fire, and its
 *  cooldown starts as if it had run its course. Mirror of the client's
 *  `cancelAbility`. */
function cancelSlot(player: PlayerSchema, j: number, kit: readonly AbilityDef[]): void {
  const s = player.abilities[j];
  s.active = false;
  s.windUpLeft = 0;
  s.durationLeft = 0;
  s.cooldownLeft = kit[j]?.cooldown ?? 0;
}

/** Steel Shell anchoring ends a dash or blink still running. Mirror of
 *  the client. */
function cancelMovementAbilities(player: PlayerSchema): void {
  const kit = getAbilityKit(player.critterName);
  for (let j = 0; j < player.abilities.length; j++) {
    const s = player.abilities[j];
    if (s.active && isMovementAbility(s.abilityType)) cancelSlot(player, j, kit);
  }
}

/** A fall ends every ability in flight (the ability tick skips fallers,
 *  so they used to resume at the respawn point). Called by `startFalling`
 *  in ./physics.ts; mirror of the client's Critter.startFalling. */
export function cancelActiveAbilities(player: PlayerSchema): void {
  const kit = getAbilityKit(player.critterName);
  for (let j = 0; j < player.abilities.length; j++) {
    if (player.abilities[j].active) cancelSlot(player, j, kit);
  }
}

/** Contact hits of the L passes (Saw Shell, Stampede ram, Toxic Touch)
 *  land once per SIM.abilities.contactRehitCooldown per caster→victim
 *  pair, not every tick the victim stays in reach. Remaining cooldown per
 *  victim. Mirror of the client helpers in abilities-runtime.ts: the room
 *  ages each caster once per tick (`ageContactRehit`) and asks
 *  `takeContactHit` before applying a contact hit. Callers pending in
 *  BrawlRoom's contact passes (DISTRIBUCIÓN); until then online still
 *  hits every tick. */
const contactRehit = new WeakMap<PlayerSchema, Map<PlayerSchema, number>>();

export function ageContactRehit(caster: PlayerSchema, dt: number): void {
  const left = contactRehit.get(caster);
  if (!left) return;
  for (const [victim, t] of left) {
    if (t <= dt) left.delete(victim);
    else left.set(victim, t - dt);
  }
}

/** True when `caster` may contact-hit `victim` now; arms the pair's cooldown. */
export function takeContactHit(caster: PlayerSchema, victim: PlayerSchema): boolean {
  let left = contactRehit.get(caster);
  if (!left) {
    left = new Map();
    contactRehit.set(caster, left);
  }
  if (left.has(victim)) return false;
  left.set(victim, SIM.abilities.contactRehitCooldown);
  return true;
}

/** Try to activate an ability if input is held and it's ready. */
function tryActivate(state: AbilityStateSchema, def: AbilityDef): boolean {
  if (state.active) return false;
  if (state.cooldownLeft > 0) return false;
  state.active = true;
  state.windUpLeft = def.windUp;
  state.durationLeft = def.duration;
  state.effectFired = false;
  return true;
}

/**
 * Inputs passed in from the caller (BrawlRoom) since abilities are no longer
 * stored on the PlayerSchema (schema v3 anti-pattern to mix sync + non-sync).
 */
export interface AbilityInputs {
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
}

/**
 * Per-tick output from `tickPlayerAbilities`. `events` are the
 * abilityFired notifications (broadcast as before for client VFX).
 * `zoneSpawns` are the new lingering slow zones the room should
 * register + broadcast — emptied between ticks.
 * `projectileSpawns` are the new in-flight projectiles (Kowalski
 * Snowball) the room should track + broadcast.
 */
export interface AbilityTickOutput {
  events: AbilityFiredEvent[];
  zoneSpawns: ZoneSpawn[];
  projectileSpawns: ProjectileSpawn[];
}

/** Side-channel return value from the projectile dispatcher. The
 *  room reads these to instantiate authoritative projectile entities
 *  (position, velocity, ttl) and broadcast `projectileSpawned` to
 *  clients. */
export interface ProjectileSpawn {
  ownerSid: string;
  ownerCritter: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  ttl: number;
  radius: number;
  impulse: number;
  slowDuration: number;
}

/**
 * Tick all abilities for a player. Handles activation, wind-up,
 * effect firing, and cooldown. Returns the firing events plus any
 * slow zones the abilities just spawned.
 *
 * `isOnArena`: live-floor test for teleport landings (blink, Mirror
 * Trick) — the room passes its ArenaSim's. Without it the whole disc
 * counts as floor.
 */
export function tickPlayerAbilities(
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
  dt: number,
  inputs: AbilityInputs,
  isOnArena: IsOnArena = onWholeDisc,
): AbilityTickOutput {
  const events: AbilityFiredEvent[] = [];
  const zoneSpawns: ZoneSpawn[] = [];
  const projectileSpawns: ProjectileSpawn[] = [];
  const kit = getAbilityKit(player.critterName);

  // A Copycat copy lasts one cast. It is dropped on the first tick the L
  // is no longer active, not on the tick it ends, so the room's L passes
  // that run after this one still read it then (Cone Pulse's last pulse
  // and its edge). Mirror of the client's `restoreCopycat`.
  if (!player.abilities[2]?.active) copycatDefs.delete(player);

  // Activation attempts from input (one-shot: input flag consumed by handler)
  // Order must match PlayerSchema.abilities array order.
  const inputFlags = [
    inputs.ability1,
    inputs.ability2,
    inputs.ultimate,
  ];

  for (let i = 0; i < player.abilities.length; i++) {
    const state = player.abilities[i];
    const def = kit[i];
    if (!def) continue;

    if (inputFlags[i] && !state.active && !blockedByAnchor(i, player, kit)) {
      tryActivate(state, def);
    }

    if (state.active) {
      if (state.windUpLeft > 0) {
        state.windUpLeft -= dt;
        if (state.windUpLeft <= 0 && !state.effectFired) {
          const out = fireEffect(state, def, player, allPlayers, isOnArena);
          state.effectFired = true;
          events.push({
            sessionId: player.sessionId,
            type: state.abilityType as AbilityType,
            x: player.x,
            z: player.z,
            rotationY: player.rotationY,
          });
          if (out?.zone) zoneSpawns.push(out.zone);
          if (out?.projectile) projectileSpawns.push(out.projectile);
        }
        continue;
      }
      if (!state.effectFired) {
        const out = fireEffect(state, def, player, allPlayers, isOnArena);
        state.effectFired = true;
        events.push({
          sessionId: player.sessionId,
          type: state.abilityType as AbilityType,
          x: player.x,
          z: player.z,
          rotationY: player.rotationY,
        });
        if (out?.zone) zoneSpawns.push(out.zone);
        if (out?.projectile) projectileSpawns.push(out.projectile);
      }
      state.durationLeft -= dt;
      if (state.durationLeft <= 0) {
        state.active = false;
        state.cooldownLeft = def.cooldown;
      }
    } else if (state.cooldownLeft > 0) {
      state.cooldownLeft -= dt;
    }
  }

  return { events, zoneSpawns, projectileSpawns };
}

/** What a slippery zone (Kowalski Frozen Floor) does to a player
 *  standing on it. Written from the L def (`floorFrictionMult`,
 *  `floorAccelMult`) when the zone spawns. Mirror of the client's
 *  SlipperyEffect (src/abilities-runtime.ts). */
export interface SlipperyEffect {
  /** Multiplies the friction half-life. */
  frictionMult: number;
  /** Multiplies the input acceleration. */
  accelMult: number;
}

/**
 * Side-channel return value from `fireEffect` — when the ability is
 * a ground_pound with a `zone` config, the dispatcher computes the
 * spawn coordinates and pushes them up to `tickPlayerAbilities`,
 * which forwards them to BrawlRoom so the room can store + broadcast
 * the zone. Returning the data here keeps the BrawlRoom→sim
 * coupling minimal — the dispatcher knows about player coords, the
 * room knows about wall-clock zone tracking, and neither has to
 * import the other's internals.
 */
export interface ZoneSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
  slowMultiplier: number;
  ownerSid: string;
  /** 2026-04-30 final-L — Frozen Floor (Kowalski): present only on
   *  slippery zones, with what the ice does (`getSlipperyZone`). */
  slippery?: SlipperyEffect;
  /** 2026-04-30 final-L — Sinkhole flag (Sihans). */
  sinkhole?: boolean;
  pullForce?: number;
}

/** Dispatch: apply the actual effect of an ability that just fired.
 *  Returns the zone / projectile the room should track + broadcast,
 *  or `null` for abilities that don't spawn lingering entities. */
interface FireOutput {
  zone?: ZoneSpawn;
  projectile?: ProjectileSpawn;
}

function fireEffect(
  state: AbilityStateSchema,
  def: AbilityDef,
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
  isOnArena: IsOnArena,
): FireOutput | null {
  switch (state.abilityType) {
    case 'charge_rush':
      fireChargeRush(def, player);
      return null;
    case 'ground_pound': {
      fireGroundPound(def, player, allPlayers, isOnArena);
      if (def.zone) {
        return {
          zone: {
            x: player.x, z: player.z,
            radius: def.zone.radius,
            duration: def.zone.duration,
            slowMultiplier: def.zone.slowMultiplier,
            ownerSid: player.sessionId,
          },
        };
      }
      return null;
    }
    case 'blink': {
      const result = fireBlink(def, player, allPlayers, isOnArena);
      // v0.11 — Sihans Burrow: zone-at-origin. Drop the quicksand
      // where the player WAS, not where they appeared.
      if (def.zone) {
        const zx = def.zoneAtOrigin ? result.originX : result.targetX;
        const zz = def.zoneAtOrigin ? result.originZ : result.targetZ;
        return {
          zone: {
            x: zx, z: zz,
            radius: def.zone.radius,
            duration: def.zone.duration,
            slowMultiplier: def.zone.slowMultiplier,
            ownerSid: player.sessionId,
          },
        };
      }
      return null;
    }
    case 'projectile': {
      // 2026-04-29 K-session — Kowalski Snowball. Spawn a forward
      // projectile from the caster's facing. Movement, collision,
      // and damage are tracked authoritatively in BrawlRoom.
      const speed = def.projectileSpeed ?? 16;
      return {
        projectile: {
          ownerSid: player.sessionId,
          ownerCritter: player.critterName,
          x: player.x + Math.sin(player.rotationY) * 0.6, // small offset so it spawns in front of the caster
          z: player.z + Math.cos(player.rotationY) * 0.6,
          vx: Math.sin(player.rotationY) * speed,
          vz: Math.cos(player.rotationY) * speed,
          ttl: def.projectileTtl ?? 1.2,
          radius: def.projectileRadius ?? 0.55,
          impulse: def.projectileImpulse ?? 22,
          slowDuration: def.projectileSlowDuration ?? 2.0,
        },
      };
    }
    case 'frenzy': {
      // 2026-04-30 final-L — Kurama Copycat: the zone spawns below read
      // the cast's copy, so a copied Frozen Floor or Sinkhole goes
      // through the same code as the original.
      const lDef = def.copycatL ? fireCopycat(def, player) : def;
      if (lDef.frozenFloorL) {
        return {
          zone: {
            x: player.x, z: player.z,
            radius: lDef.floorRadius ?? 6.0,
            duration: lDef.floorDuration ?? 5.0,
            slowMultiplier: 1.0, // no slow — slippery handles its own movement effect
            ownerSid: player.sessionId,
            slippery: {
              frictionMult: lDef.floorFrictionMult ?? 1,
              accelMult: lDef.floorAccelMult ?? 1,
            },
          },
        };
      }
      if (lDef.sinkholeL) {
        const offset = lDef.holeCastOffset ?? 4.0;
        const cx = player.x + Math.sin(player.rotationY) * offset;
        const cz = player.z + Math.cos(player.rotationY) * offset;
        // Centre-clamp: never spawn the hole on the immune islet.
        const r = Math.sqrt(cx * cx + cz * cz);
        let fx = cx, fz = cz;
        if (r < 4.0) {
          // Shove the hole out to the 4-u ring along the caster→hole
          // direction so it doesn't engulf the protected centre.
          fx = (cx / Math.max(r, 0.01)) * 4.0;
          fz = (cz / Math.max(r, 0.01)) * 4.0;
        }
        return {
          zone: {
            x: fx, z: fz,
            radius: lDef.holeRadius ?? 3.0,
            duration: lDef.holeDuration ?? 5.0,
            slowMultiplier: 0.55,
            ownerSid: player.sessionId,
            sinkhole: true,
            pullForce: lDef.holeForce ?? 19.25, // default = Sihans' holeForce since the 2026-09-21 speed-up
          },
        };
      }
      return null;
    }
  }
  return null;
}

function copyKey<K extends keyof AbilityDef>(to: AbilityDef, from: AbilityDef, k: K): void {
  if (from[k] !== undefined) to[k] = from[k];
}

/** Copycat fire: a copy of Kurama's kit L with the COPYCAT_KEYS of the
 *  last critter she headbutted becomes her L def for this cast
 *  (`getLDef`); with no target it's her plain L (the buff). The target is
 *  consumed either way, zone copies included (they used to return before
 *  clearing it, so online she could copy Frozen Floor or Sinkhole again
 *  without a fresh hit). Mirror of the client's `applyCopycat`. */
function fireCopycat(base: AbilityDef, player: PlayerSchema): AbilityDef {
  const src = player.lastHitTargetCritter ? CRITTER_ABILITY_KITS[player.lastHitTargetCritter]?.[2] : undefined;
  player.lastHitTargetCritter = '';
  if (!src) {
    copycatDefs.delete(player);
    return base;
  }
  const copy: AbilityDef = { ...base };
  for (const k of COPYCAT_KEYS) copyKey(copy, src, k);
  copycatDefs.set(player, copy);
  return copy;
}

function fireChargeRush(def: AbilityDef, player: PlayerSchema): void {
  const impulse = def.impulse ?? SIM.chargeRush.impulse;
  const angle = player.rotationY;
  player.vx += Math.sin(angle) * impulse;
  player.vz += Math.cos(angle) * impulse;
}

/** Arena radius the blink target gets clamped to. Mirror of the
 *  client-side ARENA_BLINK_RADIUS — keep in sync. The 0.4 u margin
 *  inside the 12 u arena keeps the destination clear of the rim. It
 *  knows nothing of collapsed fragments: `pickSafeLanding` does. */
const BLINK_ARENA_RADIUS = 11.6;

/** Live-floor test for teleport landings (the room's ArenaSim.isOnArena). */
export type IsOnArena = (x: number, z: number) => boolean;

/** Fallback floor when no arena is passed: the whole disc. */
function onWholeDisc(x: number, z: number): boolean {
  return Math.hypot(x, z) <= FRAG.maxRadius;
}

/**
 * Where a teleport from (ox, oz) to (tx, tz) lands: the first point on
 * that line, at each of `fractions` of its length (best first), that
 * stands on live floor, or the origin itself when none does. Mirror of
 * the client's pickSafeLanding (src/abilities-runtime.ts).
 */
function pickSafeLanding(
  ox: number, oz: number, tx: number, tz: number,
  fractions: readonly number[], isOnArena: IsOnArena,
): [number, number] {
  for (const f of fractions) {
    const x = ox + (tx - ox) * f;
    const z = oz + (tz - oz) * f;
    if (isOnArena(x, z)) return [x, z];
  }
  return [ox, oz];
}

/** Fractions of a line `len` long that step back from its end toward
 *  its start in `step` increments: 1, 1 − step/len, … while above 0. */
function stepBackFractions(len: number, step: number): number[] {
  const out: number[] = [];
  for (let d = len; d > 0; d -= step) out.push(d / len);
  return out;
}

/**
 * Result of `fireBlink` so the dispatcher can read both the
 * destination (for events broadcast) and the origin (so a
 * zone-at-origin can be spawned at the right spot).
 */
interface BlinkResult {
  originX: number;
  originZ: number;
  targetX: number;
  targetZ: number;
}

function fireBlink(def: AbilityDef, player: PlayerSchema, allPlayers: PlayerSchema[], isOnArena: IsOnArena): BlinkResult {
  const originX = player.x;
  const originZ = player.z;
  let nx: number;
  let nz: number;

  // 2026-04-29 K-refinement — Cheeto Shadow Step seek-nearest.
  // Find the closest alive non-falling non-immune enemy within
  // `blinkSeekRange`. If found, land `blinkSeekOffset` units before
  // them on the caster→target line so the impact knockback connects.
  // If no target in range, fall back to the legacy facing-blink.
  let seekHit: PlayerSchema | null = null;
  if (def.blinkSeekNearest) {
    const range = def.blinkSeekRange ?? 9.0;
    let bestDist = range;
    for (const other of allPlayers) {
      if (other === player) continue;
      if (!other.alive || other.falling || other.immunityTimer > 0) continue;
      const dx = other.x - player.x;
      const dz = other.z - player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist && d > 0.01) {
        bestDist = d;
        seekHit = other;
      }
    }
  }

  if (seekHit) {
    const dx = seekHit.x - player.x;
    const dz = seekHit.z - player.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const nxDir = dx / d;
    const nzDir = dz / d;
    const offset = def.blinkSeekOffset ?? 1.4;
    nx = seekHit.x - nxDir * offset;
    nz = seekHit.z - nzDir * offset;
    // Face the target so subsequent attacks read correctly.
    player.rotationY = Math.atan2(dx, dz);
  } else {
    const dist = def.blinkDistance ?? 4.0;
    nx = player.x + Math.sin(player.rotationY) * dist;
    nz = player.z + Math.cos(player.rotationY) * dist;
  }
  // Clamp to the arena disc, then step back toward the origin until the
  // landing is live floor, or stay put (a zoneAtOrigin zone still drops).
  const r = Math.sqrt(nx * nx + nz * nz);
  if (r > BLINK_ARENA_RADIUS) {
    nx = (nx / r) * BLINK_ARENA_RADIUS;
    nz = (nz / r) * BLINK_ARENA_RADIUS;
  }
  const len = Math.hypot(nx - originX, nz - originZ);
  [nx, nz] = pickSafeLanding(originX, originZ, nx, nz,
    stepBackFractions(len, SIM.blink.landingProbeStep), isOnArena);
  player.x = nx;
  player.z = nz;
  player.vx = 0;
  player.vz = 0;
  // v0.11 — Cheeto Shadow Step impact. Radial knockback at the
  // destination so reappearing next to enemies reads offensive,
  // not just evasive. Caster is excluded.
  if (def.blinkImpactRadius && def.blinkImpactForce) {
    for (const other of allPlayers) {
      if (other === player) continue;
      if (!other.alive || other.falling || other.immunityTimer > 0) continue;
      const dx = other.x - nx;
      const dz = other.z - nz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < def.blinkImpactRadius && d > 0.01) {
        const fall = 1 - d / def.blinkImpactRadius;
        const f = def.blinkImpactForce * fall;
        other.vx += (dx / d) * f;
        other.vz += (dz / d) * f;
      }
    }
  }
  return { originX, originZ, targetX: nx, targetZ: nz };
}

/**
 * Ground pound: radial knockback on all nearby alive players within radius.
 * Immune players receive no knockback. Per-kit radius/force override the
 * global SIM defaults so each critter's AoE can feel different online.
 */
function fireGroundPound(def: AbilityDef, caster: PlayerSchema, allPlayers: PlayerSchema[], isOnArena: IsOnArena): void {
  // v0.11 — self-buff K (Shelly Steel Shell, Kurama Mirror Trick).
  // No outward force; just write the caster's immunity. The cliente
  // adds the visual layer (tint / decoy / alpha).
  if (def.selfBuffOnly) {
    if (def.selfAnchorWhileBuffed) cancelMovementAbilities(caster);
    if (def.selfImmunityDuration && def.selfImmunityDuration > 0) {
      caster.immunityTimer = Math.max(caster.immunityTimer, def.selfImmunityDuration);
    }
    // 2026-04-29 final-K (Rafa: "Kurama debe desplazarse HACIA
    // ATRÁS, no hacia delante, decoy se queda en posición de
    // activación"). Server moves Kurama by `decoyEscapeDistance`
    // along the direction OPPOSITE to her facing, landing on live
    // floor (`decoyEscapeFallbacks`, else she stays). Decoy is a
    // pure cliente concept (server doesn't track decoy entity).
    const escDist = def.decoyEscapeDistance ?? 0;
    if (escDist > 0) {
      const backAngle = caster.rotationY + Math.PI;
      let nx = caster.x + Math.sin(backAngle) * escDist;
      let nz = caster.z + Math.cos(backAngle) * escDist;
      const r = Math.sqrt(nx * nx + nz * nz);
      if (r > BLINK_ARENA_RADIUS) {
        nx = (nx / r) * BLINK_ARENA_RADIUS;
        nz = (nz / r) * BLINK_ARENA_RADIUS;
      }
      [nx, nz] = pickSafeLanding(caster.x, caster.z, nx, nz, def.decoyEscapeFallbacks ?? [1], isOnArena);
      caster.x = nx;
      caster.z = nz;
      caster.vx = 0;
      caster.vz = 0;
    }
    return;
  }
  // 2026-04-29 final-K — Trunk Grip K. Single frontal target,
  // pulled to `gripPullDistance` u in front of the caster, gets
  // `stunTimer = gripStunDuration`. No radial knockback.
  if (def.gripK) {
    const range = def.gripFrontalRange ?? 6.0;
    const halfCone = ((def.gripFrontalAngleDeg ?? 50) * Math.PI) / 180;
    const facingX = Math.sin(caster.rotationY);
    const facingZ = Math.cos(caster.rotationY);
    let target: PlayerSchema | null = null;
    let bestScore = Infinity;
    for (const other of allPlayers) {
      if (other === caster || !other.alive || other.falling) continue;
      if (other.immunityTimer > 0) continue;
      const dx = other.x - caster.x;
      const dz = other.z - caster.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > range || d < 0.01) continue;
      const nx = dx / d;
      const nz = dz / d;
      const dot = nx * facingX + nz * facingZ;
      if (dot < Math.cos(halfCone)) continue;
      if (d < bestScore) { bestScore = d; target = other; }
    }
    if (target) {
      const pull = def.gripPullDistance ?? 1.6;
      target.x = caster.x + facingX * pull;
      target.z = caster.z + facingZ * pull;
      target.vx = 0;
      target.vz = 0;
      target.stunTimer = Math.max(target.stunTimer, def.gripStunDuration ?? 2.0);
    }
    return;
  }
  const radius = def.radius ?? SIM.groundPound.radius;
  const force = def.force ?? SIM.groundPound.force;
  // v0.11 — cone gate (Sebastian Claw Wave). Pre-compute cos(angle)
  // so the inner loop is one dot product instead of acos().
  const coneCos = def.coneAngleDeg !== undefined ? Math.cos((def.coneAngleDeg * Math.PI) / 180) : null;
  const facingX = Math.sin(caster.rotationY);
  const facingZ = Math.cos(caster.rotationY);
  for (const other of allPlayers) {
    if (other === caster) continue;
    if (!other.alive || other.falling || other.immunityTimer > 0) continue;
    const dx = other.x - caster.x;
    const dz = other.z - caster.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= radius || dist < 0.01) continue;
    const nx = dx / dist;
    const nz = dz / dist;
    if (coneCos !== null) {
      const dot = nx * facingX + nz * facingZ;
      if (dot < coneCos) continue;
    }
    const falloff = 1 - dist / radius;
    other.vx += nx * force * falloff;
    other.vz += nz * force * falloff;
    // 2026-05-01 final — Trunk Slam K applies brief stun to every
    // critter inside the radial AoE via `slamStunDuration`. Stuns
    // compose with the ×4 vulnerable multiplier in physics.
    if (def.slamStunDuration && def.slamStunDuration > 0) {
      other.stunTimer = Math.max(other.stunTimer, def.slamStunDuration);
    }
  }
}
