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

// Lookup table for Sergei's kit. Same for all online players in Bloque A.
export const SERGEI_ABILITIES: readonly AbilityDef[] = [
  {
    type: 'charge_rush',
    cooldown: 4.5,
    duration: 0.32,
    windUp: 0.06,
  },
  {
    type: 'ground_pound',
    cooldown: 6.5,
    duration: 0.05,
    windUp: 0.35,
  },
  {
    type: 'frenzy',
    cooldown: SIM.frenzy.cooldown,
    duration: SIM.frenzy.duration,
    windUp: SIM.frenzy.windUp,
  },
] as const;

/** Create initial ability state array for a new player. */
export function createAbilityStates(): AbilityStateSchema[] {
  return SERGEI_ABILITIES.map((def) => {
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

  // Activation attempts from input (one-shot: input flag consumed by handler)
  // Order must match PlayerSchema.abilities array order.
  const inputFlags = [
    inputs.ability1,
    inputs.ability2,
    inputs.ultimate,
  ];

  for (let i = 0; i < player.abilities.length; i++) {
    const state = player.abilities[i];
    const def = SERGEI_ABILITIES[i];
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
      // Bloque B: radial knockback to nearby players
      fireGroundPoundStub(player, allPlayers);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fireGroundPoundStub(_player: PlayerSchema, _allPlayers: PlayerSchema[]): void {
  // Bloque B will implement radial force. Leaving stub so the dispatch
  // compiles and we can test activation → fire event round trip.
}
