import { ArraySchema, Schema, type } from '@colyseus/schema';
import { AbilityStateSchema } from './AbilityStateSchema.js';

/**
 * Per-player authoritative state. All simulation runs on server.
 * Client reads this (via automatic Colyseus patches) and renders.
 *
 * ONLY @type-decorated fields are allowed here. Mixing non-sync instance
 * fields with sync fields is an anti-pattern in Colyseus schema v3 that
 * can break binary patch propagation over real-world WebSocket proxies.
 * Non-sync internal state (inputs, timers) lives in BrawlRoom's private
 * Map<sessionId, InternalPlayerData>.
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

  // Headbutt (state visible to clients for VFX)
  @type('boolean') isHeadbutting: boolean = false;
  @type('boolean') headbuttAnticipating: boolean = false;
  @type('number') headbuttCooldown: number = 0;

  // Abilities (ordered: 0=charge_rush, 1=ground_pound, 2=frenzy)
  @type([AbilityStateSchema]) abilities = new ArraySchema<AbilityStateSchema>();
}
