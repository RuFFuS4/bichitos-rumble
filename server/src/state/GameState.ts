import { MapSchema, Schema, type } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';
import { SIM } from '../sim/config.js';

export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'ended';

export class GameState extends Schema {
  @type('string') phase: MatchPhase = 'waiting';
  @type('number') countdownLeft: number = 0;
  @type('number') matchTimer: number = 0;
  @type('string') winnerSessionId: string = ''; // empty = no winner yet
  @type('string') endReason: string = ''; // 'eliminated' | 'timeout' | 'draw' | 'opponent_left'

  // Arena collapse (Bloque B 3a) — authoritative state mirrored by the client
  /** Current standable radius. Falloff uses this; client mirrors it. */
  @type('number') arenaRadius: number = SIM.arena.radius;
  /** Number of rings that have fully disappeared (0..collapseRings). */
  @type('number') arenaCollapsedRings: number = 0;
  /** Index of the ring currently warning red (-1 if none). */
  @type('number') warningRingIndex: number = -1;

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
