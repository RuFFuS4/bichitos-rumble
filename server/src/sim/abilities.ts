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
    { type: 'ground_pound', cooldown: 6.0, duration: 0.05, windUp: 0.30,
      radius: 3.5, force: 34, ...ROOTED_K },
    // v0.11 buff (Rafa: "darle más potencia"): 1.45/1.5 → 1.55/1.75
    { type: 'frenzy',       cooldown: 15.0, duration: 2.5, windUp: 0.35,
      frenzySpeedMult: 1.55, frenzyMassMult: 1.75 },
  ],
  Trunk: [
    // v0.11 (Rafa: "más distancia + más potencia"): impulse 20→25,
    // duration 0.35→0.42, mass 3.5→4.0
    { type: 'charge_rush',  cooldown: 4.5, duration: 0.42, windUp: 0.08,
      impulse: 25, speedMultiplier: 2.1, massMultiplier: 4.0 },
    // v0.11 (Rafa: "Earthquake real"): radius 4.5→4.8, force 40→48
    { type: 'ground_pound', cooldown: 7.5, duration: 0.05, windUp: 0.60,
      radius: 4.8, force: 48, ...ROOTED_K },
    // v0.11 (Rafa: "bastante más fuerte"): speed 1.25→1.35, mass 1.80→2.10
    { type: 'frenzy',       cooldown: 18.0, duration: 3.0, windUp: 0.45,
      frenzySpeedMult: 1.35, frenzyMassMult: 2.10 },
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
      decoyEscapeDistance: 7.0 },
    { type: 'frenzy',       cooldown: 16.0, duration: 3.5, windUp: 0.30,
      frenzySpeedMult: 1.50, frenzyMassMult: 1.20 },
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
    { type: 'frenzy',       cooldown: 18.0, duration: 3.5, windUp: 0.40,
      frenzySpeedMult: 1.20, frenzyMassMult: 1.65 },
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
    { type: 'frenzy',       cooldown: 18.0, duration: 4.0, windUp: 0.40,
      frenzySpeedMult: 1.10, frenzyMassMult: 1.80 },
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
    { type: 'frenzy',       cooldown: 20.0, duration: 4.5, windUp: 0.40,
      frenzySpeedMult: 1.15, frenzyMassMult: 1.50 },
  ],

  // Kowalski — Mage: K is now a real frontal SNOWBALL projectile
  // (v0.11 final-K, 2026-04-29). Travels along Kowalski's facing,
  // applies knockback + 2 s slow on hit, despawns on hit or TTL.
  // No more radial AoE — Rafa: "debe ser bola de nieve, no AoE".
  Kowalski: [
    { type: 'charge_rush',  cooldown: 4.2, duration: 0.30, windUp: 0.06,
      impulse: 19, speedMultiplier: 2.4, massMultiplier: 1.5 },
    // 2026-04-29 K-refinement: windUp 0.20 → 1.10 (cast feel),
    // cooldown 5.5 → 6.5 (compensate). ROOTED_K keeps Kowalski
    // glued to the spot during the cast.
    { type: 'projectile',   cooldown: 6.5, duration: 0.05, windUp: 1.10,
      ...ROOTED_K,
      projectileSpeed: 18,
      projectileTtl: 1.2,
      projectileRadius: 0.55,
      projectileImpulse: 22,
      projectileSlowDuration: 2.0 },
    { type: 'frenzy',       cooldown: 17.0, duration: 3.0, windUp: 0.40,
      frenzySpeedMult: 1.40, frenzyMassMult: 1.10 },
  ],

  // Cheeto — Assassin: K is now a real BLINK (4.5 u teleport along
  // facing) with a brief root window. Tag stays mobility so bot AI
  // uses it as a "close distance" tool just like charge_rush.
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
    { type: 'frenzy',       cooldown: 14.0, duration: 2.0, windUp: 0.35,
      frenzySpeedMult: 1.55, frenzyMassMult: 1.05 },
  ],

  Sebastian: [
    // v0.11 (Rafa: "más potencia y empuje"): impulse 28→33, mass 1.4→1.7
    { type: 'charge_rush',  cooldown: 3.5, duration: 0.28, windUp: 0.06,
      impulse: 33, speedMultiplier: 2.6, massMultiplier: 1.7 },
    // v0.11 — Claw Wave: cone-restricted ground_pound (frontal sweep,
    // 120° arc). Same radius/force as v0.10 but no longer radial.
    // 2026-04-29 K-refinement: duration 0.05 → 0.45 so the clip plays.
    { type: 'ground_pound', cooldown: 6.5, duration: 0.45, windUp: 0.30,
      radius: 3.5, force: 38, ...ROOTED_K, coneAngleDeg: 60 },
    { type: 'frenzy',       cooldown: 15.0, duration: 2.5, windUp: 0.40,
      frenzySpeedMult: 1.20, frenzyMassMult: 1.20 },
  ],
};

const DEFAULT_KIT = CRITTER_ABILITY_KITS.Sergei;

/** Resolve the ability kit for a critter name (falls back to Sergei's). */
export function getAbilityKit(critterName: string): readonly AbilityDef[] {
  return CRITTER_ABILITY_KITS[critterName] ?? DEFAULT_KIT;
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
 */
export function tickPlayerAbilities(
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
  dt: number,
  inputs: AbilityInputs,
): AbilityTickOutput {
  const events: AbilityFiredEvent[] = [];
  const zoneSpawns: ZoneSpawn[] = [];
  const projectileSpawns: ProjectileSpawn[] = [];
  const kit = getAbilityKit(player.critterName);

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

    if (inputFlags[i] && !state.active) {
      tryActivate(state, def);
    }

    if (state.active) {
      if (state.windUpLeft > 0) {
        state.windUpLeft -= dt;
        if (state.windUpLeft <= 0 && !state.effectFired) {
          const out = fireEffect(state, def, player, allPlayers);
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
        const out = fireEffect(state, def, player, allPlayers);
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
): FireOutput | null {
  switch (state.abilityType) {
    case 'charge_rush':
      fireChargeRush(def, player);
      return null;
    case 'ground_pound': {
      fireGroundPound(def, player, allPlayers);
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
      const result = fireBlink(def, player, allPlayers);
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
    case 'frenzy':
      // Buff only — multipliers handled in physics.ts via effectiveSpeed/Mass
      return null;
  }
  return null;
}

function fireChargeRush(def: AbilityDef, player: PlayerSchema): void {
  const impulse = def.impulse ?? SIM.chargeRush.impulse;
  const angle = player.rotationY;
  player.vx += Math.sin(angle) * impulse;
  player.vz += Math.cos(angle) * impulse;
}

/** Arena radius the blink target gets clamped to. Mirror of the
 *  client-side ARENA_BLINK_RADIUS — keep in sync. The 0.4 u margin
 *  inside the 12 u arena keeps the destination clear of fragments
 *  that are about to collapse during late-match. */
const BLINK_ARENA_RADIUS = 11.6;

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

function fireBlink(def: AbilityDef, player: PlayerSchema, allPlayers: PlayerSchema[]): BlinkResult {
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
  const r = Math.sqrt(nx * nx + nz * nz);
  if (r > BLINK_ARENA_RADIUS) {
    nx = (nx / r) * BLINK_ARENA_RADIUS;
    nz = (nz / r) * BLINK_ARENA_RADIUS;
  }
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
function fireGroundPound(def: AbilityDef, caster: PlayerSchema, allPlayers: PlayerSchema[]): void {
  // v0.11 — self-buff K (Shelly Steel Shell, Kurama Mirror Trick).
  // No outward force; just write the caster's immunity. The cliente
  // adds the visual layer (tint / decoy / alpha).
  if (def.selfBuffOnly) {
    if (def.selfImmunityDuration && def.selfImmunityDuration > 0) {
      caster.immunityTimer = Math.max(caster.immunityTimer, def.selfImmunityDuration);
    }
    // 2026-04-29 K-refinement — Kurama Mirror Trick escape teleport.
    // Kurama teleports away from the nearest alive enemy by
    // `decoyEscapeDistance`. Fallback: facing direction.
    const escDist = def.decoyEscapeDistance ?? 0;
    if (escDist > 0) {
      let nearest: PlayerSchema | null = null;
      let bestDist = Infinity;
      for (const other of allPlayers) {
        if (other === caster || !other.alive || other.falling) continue;
        const dx = other.x - caster.x;
        const dz = other.z - caster.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < bestDist) { bestDist = d; nearest = other; }
      }
      let escAngle = caster.rotationY;
      if (nearest) {
        const dx = caster.x - nearest.x;
        const dz = caster.z - nearest.z;
        escAngle = Math.atan2(dx, dz);
      }
      let nx = caster.x + Math.sin(escAngle) * escDist;
      let nz = caster.z + Math.cos(escAngle) * escDist;
      const r = Math.sqrt(nx * nx + nz * nz);
      if (r > BLINK_ARENA_RADIUS) {
        nx = (nx / r) * BLINK_ARENA_RADIUS;
        nz = (nz / r) * BLINK_ARENA_RADIUS;
      }
      caster.x = nx;
      caster.z = nz;
      caster.vx = 0;
      caster.vz = 0;
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
  }
}
