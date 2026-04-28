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

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy' | 'blink';

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
  /** Speed multiplier applied during the WIND-UP phase. Default 1.0
   *  (no slow). Mirrors the client's `slowDuringWindUp` so K abilities
   *  feel committed in online matches too — without this the player
   *  could move at full speed during a windup server-side while the
   *  client predicted them rooted, producing a visible state-sync
   *  snap-back when the windup ended. */
  slowDuringWindUp?: number;
  /** Speed multiplier during the ACTIVE window (post-windUp, pre-
   *  cooldown). Only consulted for ground_pound / blink — the speedy
   *  types (charge_rush, frenzy) keep using their existing
   *  speedMultiplier / frenzySpeedMult so the boost behaviour is
   *  unchanged. Default 1.0 → no extra slow. K abilities use 0 here
   *  to fully root during the slam window. */
  slowDuringActive?: number;
  /** Blink-specific: world-units to teleport along the player's
   *  current facing. Server clamps to arena radius. */
  blinkDistance?: number;
  /** Ground-pound-specific: lingering slow zone left at the slam
   *  point. Server tracks the zones in BrawlRoom, applies the slow
   *  via effectiveSpeed, and broadcasts a single 'zoneSpawned' event
   *  per spawn so clients render the visual. */
  zone?: {
    radius: number;
    duration: number;
    slowMultiplier: number;
  };
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
    { type: 'frenzy',       cooldown: 15.0, duration: 2.5, windUp: 0.35,
      frenzySpeedMult: 1.45, frenzyMassMult: 1.5 },
  ],
  Trunk: [
    { type: 'charge_rush',  cooldown: 4.5, duration: 0.35, windUp: 0.08,
      impulse: 20, speedMultiplier: 2.1, massMultiplier: 3.5 },
    { type: 'ground_pound', cooldown: 7.5, duration: 0.05, windUp: 0.60,
      radius: 4.5, force: 40, ...ROOTED_K },
    { type: 'frenzy',       cooldown: 18.0, duration: 3.0, windUp: 0.45,
      frenzySpeedMult: 1.25, frenzyMassMult: 1.80 },
  ],

  // --- Bloque C: 7 remaining playables ---

  // Kurama — Trickster: trades raw knockback for very fast K and an
  // agile, short-windowed Frenzy that rewards mobility plays.
  Kurama: [
    { type: 'charge_rush',  cooldown: 3.2, duration: 0.26, windUp: 0.05,
      impulse: 29, speedMultiplier: 2.8, massMultiplier: 1.3 },
    { type: 'ground_pound', cooldown: 5.5, duration: 0.05, windUp: 0.10,
      radius: 3.5, force: 16, ...ROOTED_K },
    { type: 'frenzy',       cooldown: 16.0, duration: 3.5, windUp: 0.30,
      frenzySpeedMult: 1.50, frenzyMassMult: 1.20 },
  ],

  Shelly: [
    { type: 'charge_rush',  cooldown: 5.5, duration: 0.45, windUp: 0.08,
      impulse: 15, speedMultiplier: 1.8, massMultiplier: 3.2 },
    { type: 'ground_pound', cooldown: 7.5, duration: 0.05, windUp: 0.45,
      radius: 4.0, force: 32, ...ROOTED_K },
    { type: 'frenzy',       cooldown: 18.0, duration: 3.5, windUp: 0.40,
      frenzySpeedMult: 1.20, frenzyMassMult: 1.65 },
  ],

  // Kermit — Controller: K spawns a 2.0 s slow zone (60 % move speed
  // for anyone inside) on top of the wide low-force slam. The zone
  // is the actual identity piece; the slam itself just nudges.
  Kermit: [
    { type: 'charge_rush',  cooldown: 4.0, duration: 0.30, windUp: 0.06,
      impulse: 20, speedMultiplier: 2.3, massMultiplier: 1.7 },
    { type: 'ground_pound', cooldown: 7.0, duration: 0.05, windUp: 0.15,
      radius: 5.0, force: 14, ...ROOTED_K,
      zone: { radius: 5.0, duration: 2.0, slowMultiplier: 0.60 } },
    { type: 'frenzy',       cooldown: 18.0, duration: 4.0, windUp: 0.40,
      frenzySpeedMult: 1.10, frenzyMassMult: 1.80 },
  ],

  Sihans: [
    { type: 'charge_rush',  cooldown: 4.5, duration: 0.35, windUp: 0.08,
      impulse: 19, speedMultiplier: 2.1, massMultiplier: 2.0 },
    { type: 'ground_pound', cooldown: 7.5, duration: 0.05, windUp: 0.6,
      radius: 3.5, force: 38, ...ROOTED_K },
    { type: 'frenzy',       cooldown: 20.0, duration: 4.5, windUp: 0.40,
      frenzySpeedMult: 1.15, frenzyMassMult: 1.50 },
  ],

  // Kowalski — Mage: K leaves a 1.6 s icy patch (55 % move speed).
  // Shorter than Kermit's fog but a touch deeper slow.
  Kowalski: [
    { type: 'charge_rush',  cooldown: 4.2, duration: 0.30, windUp: 0.06,
      impulse: 19, speedMultiplier: 2.4, massMultiplier: 1.5 },
    { type: 'ground_pound', cooldown: 7.0, duration: 0.05, windUp: 0.4,
      radius: 5.0, force: 20, ...ROOTED_K,
      zone: { radius: 5.0, duration: 1.6, slowMultiplier: 0.55 } },
    { type: 'frenzy',       cooldown: 17.0, duration: 3.0, windUp: 0.40,
      frenzySpeedMult: 1.40, frenzyMassMult: 1.10 },
  ],

  // Cheeto — Assassin: K is now a real BLINK (4.5 u teleport along
  // facing) with a brief root window. Tag stays mobility so bot AI
  // uses it as a "close distance" tool just like charge_rush.
  Cheeto: [
    { type: 'charge_rush',  cooldown: 2.8, duration: 0.24, windUp: 0.04,
      impulse: 33, speedMultiplier: 3.0, massMultiplier: 1.2 },
    { type: 'blink',        cooldown: 5.5, duration: 0.10, windUp: 0.06,
      blinkDistance: 4.5, ...ROOTED_K },
    { type: 'frenzy',       cooldown: 14.0, duration: 2.0, windUp: 0.35,
      frenzySpeedMult: 1.55, frenzyMassMult: 1.05 },
  ],

  Sebastian: [
    { type: 'charge_rush',  cooldown: 3.5, duration: 0.28, windUp: 0.06,
      impulse: 28, speedMultiplier: 2.6, massMultiplier: 1.4 },
    { type: 'ground_pound', cooldown: 6.5, duration: 0.05, windUp: 0.3,
      radius: 2.8, force: 40, ...ROOTED_K },
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
 */
export interface AbilityTickOutput {
  events: AbilityFiredEvent[];
  zoneSpawns: ZoneSpawn[];
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
          const zone = fireEffect(state, def, player, allPlayers);
          state.effectFired = true;
          events.push({
            sessionId: player.sessionId,
            type: state.abilityType as AbilityType,
            x: player.x,
            z: player.z,
            rotationY: player.rotationY,
          });
          if (zone) zoneSpawns.push(zone);
        }
        continue;
      }
      if (!state.effectFired) {
        const zone = fireEffect(state, def, player, allPlayers);
        state.effectFired = true;
        events.push({
          sessionId: player.sessionId,
          type: state.abilityType as AbilityType,
          x: player.x,
          z: player.z,
          rotationY: player.rotationY,
        });
        if (zone) zoneSpawns.push(zone);
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

  return { events, zoneSpawns };
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
 *  Returns a ZoneSpawn when the ability spawns a slow zone, null
 *  otherwise. */
function fireEffect(
  state: AbilityStateSchema,
  def: AbilityDef,
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
): ZoneSpawn | null {
  switch (state.abilityType) {
    case 'charge_rush':
      fireChargeRush(def, player);
      return null;
    case 'ground_pound': {
      fireGroundPound(def, player, allPlayers);
      if (def.zone) {
        return {
          x: player.x, z: player.z,
          radius: def.zone.radius,
          duration: def.zone.duration,
          slowMultiplier: def.zone.slowMultiplier,
          ownerSid: player.sessionId,
        };
      }
      return null;
    }
    case 'blink':
      fireBlink(def, player);
      return null;
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

function fireBlink(def: AbilityDef, player: PlayerSchema): void {
  const dist = def.blinkDistance ?? 4.0;
  let nx = player.x + Math.sin(player.rotationY) * dist;
  let nz = player.z + Math.cos(player.rotationY) * dist;
  const r = Math.sqrt(nx * nx + nz * nz);
  if (r > BLINK_ARENA_RADIUS) {
    nx = (nx / r) * BLINK_ARENA_RADIUS;
    nz = (nz / r) * BLINK_ARENA_RADIUS;
  }
  player.x = nx;
  player.z = nz;
  // The blink is a commit, not a slide — clear horizontal velocity so
  // the player doesn't keep drifting after appearing.
  player.vx = 0;
  player.vz = 0;
}

/**
 * Ground pound: radial knockback on all nearby alive players within radius.
 * Immune players receive no knockback. Per-kit radius/force override the
 * global SIM defaults so each critter's AoE can feel different online.
 */
function fireGroundPound(def: AbilityDef, caster: PlayerSchema, allPlayers: PlayerSchema[]): void {
  const radius = def.radius ?? SIM.groundPound.radius;
  const force = def.force ?? SIM.groundPound.force;
  for (const other of allPlayers) {
    if (other === caster) continue;
    if (!other.alive || other.falling || other.immunityTimer > 0) continue;
    const dx = other.x - caster.x;
    const dz = other.z - caster.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= radius || dist < 0.01) continue;
    const nx = dx / dist;
    const nz = dz / dist;
    const falloff = 1 - dist / radius;
    other.vx += nx * force * falloff;
    other.vz += nz * force * falloff;
  }
}
