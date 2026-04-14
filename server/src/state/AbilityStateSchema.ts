import { Schema, type } from '@colyseus/schema';

/**
 * Per-player per-ability state. Generic — works for any ability type.
 * Bloque A supports: 'charge_rush'. Bloque B adds: 'ground_pound', 'frenzy'.
 */
export class AbilityStateSchema extends Schema {
  @type('string') abilityType: string = 'charge_rush';
  @type('number') cooldownLeft: number = 0;
  @type('number') durationLeft: number = 0;
  @type('number') windUpLeft: number = 0;
  @type('boolean') active: boolean = false;
  @type('boolean') effectFired: boolean = false;
}
