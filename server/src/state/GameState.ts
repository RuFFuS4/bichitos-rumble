import { MapSchema, Schema, type } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';
import { SIM } from '../sim/config.js';

export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'ended';

export class GameState extends Schema {
  @type('string') phase: MatchPhase = 'waiting';
  @type('number') countdownLeft: number = 0;
  @type('number') matchTimer: number = 0;
  @type('string') winnerSessionId: string = '';
  @type('string') endReason: string = '';

  // Arena (Bloque B 3b — irregular fragments)
  /** Deterministic seed — both clients generate identical layout from this. */
  @type('number') arenaSeed: number = 0;
  /** Approximate current playable radius (max outer edge of alive fragments). */
  @type('number') arenaRadius: number = SIM.arena.radius;
  /** Number of batches that have fully collapsed (0 .. totalBatches). */
  @type('number') arenaCollapseLevel: number = 0;
  /** Batch index currently blinking red (-1 if none). */
  @type('number') arenaWarningBatch: number = -1;

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
