// ---------------------------------------------------------------------------
// Server-side ability system
// ---------------------------------------------------------------------------
//
// Generic architecture ready for all 3 ability types. Bloque A wires only
// `charge_rush` end-to-end. `ground_pound` and `frenzy` have config and
// state slots but their fire effects are TODO for Bloque B.
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

export type AbilityType = 'charge_rush' | 'ground_pound' | 'frenzy';

export interface AbilityDef {
  type: AbilityType;
  cooldown: number;
  duration: number;
  windUp: number;
}

// Per-critter ability kits. MUST stay in sync with client's CRITTER_ABILITIES.
// Server-side kits include only the fields the simulation needs (type,
// cooldown, duration, windUp). Visual names/descriptions live on the client.
const CRITTER_ABILITY_KITS: Record<string, readonly AbilityDef[]> = {
  Sergei: [
    { type: 'charge_rush', cooldown: 4.5, duration: 0.32, windUp: 0.06 },
    { type: 'ground_pound', cooldown: 6.5, duration: 0.05, windUp: 0.35 },
    { type: 'frenzy', cooldown: SIM.frenzy.cooldown, duration: SIM.frenzy.duration, windUp: SIM.frenzy.windUp },
  ],
  Trunk: [
    { type: 'charge_rush', cooldown: 5.0, duration: 0.40, windUp: 0.06 },
    { type: 'ground_pound', cooldown: 8.5, duration: 0.05, windUp: 0.5 },
    // No ultimate yet for Trunk — 2 abilities only
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
 * Tick all abilities for a player. Handles activation, wind-up,
 * effect firing, and cooldown. Returns events fired this tick.
 */
export function tickPlayerAbilities(
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
  dt: number,
  inputs: AbilityInputs,
): AbilityFiredEvent[] {
  const events: AbilityFiredEvent[] = [];
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
          fireEffect(state, player, allPlayers);
          state.effectFired = true;
          events.push({
            sessionId: player.sessionId,
            type: state.abilityType as AbilityType,
            x: player.x,
            z: player.z,
            rotationY: player.rotationY,
          });
        }
        continue;
      }
      if (!state.effectFired) {
        fireEffect(state, player, allPlayers);
        state.effectFired = true;
        events.push({
          sessionId: player.sessionId,
          type: state.abilityType as AbilityType,
          x: player.x,
          z: player.z,
          rotationY: player.rotationY,
        });
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

  return events;
}

/** Dispatch: apply the actual effect of an ability that just fired. */
function fireEffect(
  state: AbilityStateSchema,
  player: PlayerSchema,
  allPlayers: PlayerSchema[],
): void {
  switch (state.abilityType) {
    case 'charge_rush':
      fireChargeRush(player);
      break;
    case 'ground_pound':
      fireGroundPound(player, allPlayers);
      break;
    case 'frenzy':
      // Bloque B: buff only — multipliers already handled in physics.ts
      // No direct effect at fire time
      break;
  }
}

function fireChargeRush(player: PlayerSchema): void {
  // Impulse in facing direction (same as client's fireChargeRush)
  const angle = player.rotationY;
  player.vx += Math.sin(angle) * SIM.chargeRush.impulse;
  player.vz += Math.cos(angle) * SIM.chargeRush.impulse;
}

/**
 * Ground pound: radial knockback on all nearby alive players within radius.
 * Same math as client's fireGroundPound: linear falloff by distance.
 * Immune players receive no knockback (server honors immunity timer).
 */
function fireGroundPound(caster: PlayerSchema, allPlayers: PlayerSchema[]): void {
  const radius = SIM.groundPound.radius;
  const force = SIM.groundPound.force;
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
