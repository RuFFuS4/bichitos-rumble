// ---------------------------------------------------------------------------
// Ability kit fields client (src/abilities.ts) ↔ server (server/src/sim/
// abilities.ts) that scripts/verify-ability-parity.mjs does not scrape:
// the Copycat copy list and the tuning added with it. A key or a value
// changed on one side only fails here instead of desyncing online.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { COPYCAT_KEYS, CRITTER_ABILITIES } from '../../src/abilities';
import { COPYCAT_KEYS as SIM_COPYCAT_KEYS, getAbilityKit } from '../../server/src/sim/abilities.js';

const MIRRORED_FIELDS = [
  ['Cheeto', 2, 'pulseCount'],
  ['Kowalski', 2, 'floorFrictionMult'],
  ['Kowalski', 2, 'floorAccelMult'],
  ['Kurama', 1, 'decoyEscapeFallbacks'],
] as const;

describe('ability kit parity (client ↔ server)', () => {
  it('Copycat copies the same keys on both sides, and never the All-in', () => {
    expect([...SIM_COPYCAT_KEYS]).toEqual([...COPYCAT_KEYS]);
    expect(COPYCAT_KEYS.some((k) => k.startsWith('allIn'))).toBe(false);
  });

  it.each(MIRRORED_FIELDS)('%s[%i].%s', (critter, slot, key) => {
    const client = CRITTER_ABILITIES[critter][slot][key];
    expect(client).toBeDefined();
    expect(getAbilityKit(critter)[slot][key]).toEqual(client);
  });
});
