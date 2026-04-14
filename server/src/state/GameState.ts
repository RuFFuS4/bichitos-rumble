import { MapSchema, Schema, type } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';

export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'ended';

export class GameState extends Schema {
  @type('string') phase: MatchPhase = 'waiting';
  @type('number') countdownLeft: number = 0;
  @type('number') matchTimer: number = 0;
  @type('string') winnerSessionId: string = ''; // empty = no winner yet
  @type('string') endReason: string = ''; // 'eliminated' | 'timeout' | 'draw'

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
