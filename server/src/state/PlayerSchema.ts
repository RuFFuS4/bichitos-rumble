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
  @type('string') critterName: string = 'Sergei';
  /**
   * True when this "player" is a server-controlled bot. Bots use the same
   * PlayerSchema (identical physics/abilities/HUD path) — only the input
   * source differs: a bot's input comes from sim/bot.ts each tick, a
   * human's from the client's 'input' messages.
   * Clients read this flag to render bot badges and distinguish them in
   * waiting / end screens. No gameplay logic branches on it server-side.
   */
  @type('boolean') isBot: boolean = false;

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

  /**
   * Movement-slow countdown (seconds). Set by hit-driven status effects
   * (Kowalski Snowball impact: 2.0 s at 50 % move-speed). Decrements
   * server-side every tick and is read by `effectiveSpeed` to scale
   * the player's movement. Synced so remote clients render the same
   * slowed read on the affected critter (and a future visual layer
   * can paint a frost overlay on them while > 0).
   */
  @type('number') slowTimer: number = 0;

  // Headbutt (state visible to clients for VFX)
  @type('boolean') isHeadbutting: boolean = false;
  @type('boolean') headbuttAnticipating: boolean = false;
  @type('number') headbuttCooldown: number = 0;

  // Abilities (ordered: 0=charge_rush, 1=ground_pound, 2=frenzy)
  @type([AbilityStateSchema]) abilities = new ArraySchema<AbilityStateSchema>();
}
