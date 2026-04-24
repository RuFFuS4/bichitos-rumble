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

  /**
   * Seconds left before the room auto-fills with bots. Counted down every
   * tick while phase === 'waiting'. Reaches 0 → server fills the remaining
   * slots with bots and moves to 'countdown'. If the room reaches
   * maxClients humans before the timer expires, the countdown starts
   * immediately (and this timer becomes irrelevant).
   */
  @type('number') waitingTimeLeft: number = 0;

  // Arena (Bloque B 3b — irregular fragments)
  /** Deterministic seed — both clients generate identical layout from this. */
  @type('number') arenaSeed: number = 0;
  /** Approximate current playable radius (max outer edge of alive fragments). */
  @type('number') arenaRadius: number = SIM.arena.radius;
  /** Number of batches that have fully collapsed (0 .. totalBatches). */
  @type('number') arenaCollapseLevel: number = 0;
  /** Batch index currently blinking red (-1 if none). */
  @type('number') arenaWarningBatch: number = -1;
  /** Cosmetic pack ID: 'jungle' | 'frozen_tundra' | 'desert_dunes' |
   *  'coral_beach' | 'kitsune_shrine'. Chosen per match by the server;
   *  clients swap skybox + fog + ground texture + props based on it.
   *  Default 'jungle' so older clients missing the field still render
   *  a sensible arena (graceful degradation — the server never breaks
   *  an old client just by adding cosmetics). */
  @type('string') arenaPackId: string = 'jungle';

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
