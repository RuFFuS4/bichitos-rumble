import { ArraySchema, Schema, type } from '@colyseus/schema';
import { AbilityStateSchema } from './AbilityStateSchema.js';

/**
 * Per-player authoritative state. All simulation runs on server.
 * Client reads this (via automatic Colyseus patches) and renders.
 */
export class PlayerSchema extends Schema {
  @type('string') sessionId: string = '';
  @type('string') critterName: string = 'Sergei'; // fixed for Bloque A

  // Position / motion (XZ plane, Y is height for fall animation only)
  @type('number') x: number = 0;
  @type('number') z: number = 0;
  @type('number') vx: number = 0;
  @type('number') vz: number = 0;
  @type('number') rotationY: number = 0; // facing, atan2(vx, vz)

  // Lives / status
  @type('boolean') alive: boolean = true;
  @type('number') lives: number = 3;
  @type('boolean') falling: boolean = false;
  @type('number') fallY: number = 0; // descent offset (client renders)
  @type('number') immunityTimer: number = 0;

  // Headbutt
  @type('boolean') isHeadbutting: boolean = false;
  @type('boolean') headbuttAnticipating: boolean = false;
  @type('number') headbuttCooldown: number = 0;

  // Abilities (ordered: 0=charge_rush, 1=ground_pound, 2=frenzy)
  @type([AbilityStateSchema]) abilities = new ArraySchema<AbilityStateSchema>();

  // Client input (set via room.onMessage, read by sim)
  // NOT synced to clients — server internal only
  inputMoveX: number = 0;
  inputMoveZ: number = 0;
  inputHeadbutt: boolean = false;
  inputAbility1: boolean = false; // charge_rush
  inputAbility2: boolean = false; // ground_pound (Bloque B)
  inputUltimate: boolean = false; // frenzy (Bloque B)

  // Internal (not synced)
  respawnTimer: number = 0;
  anticipationTimer: number = 0;
  headbuttTimer: number = 0;
  hasInput: boolean = false;
}
