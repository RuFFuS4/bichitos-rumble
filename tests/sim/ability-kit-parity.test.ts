// ---------------------------------------------------------------------------
// Ability kit fields client (src/abilities.ts) ↔ server (server/src/sim/
// abilities.ts) that scripts/verify-ability-parity.mjs does not scrape:
// the Copycat copy list and the tuning added with it. A key or a value
// changed on one side only fails here instead of desyncing online.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { COPYCAT_KEYS, CRITTER_ABILITIES } from '../../src/abilities';
import { COPYCAT_KEYS as SIM_COPYCAT_KEYS, frictionScale, getAbilityKit } from '../../server/src/sim/abilities.js';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';

const MIRRORED_FIELDS = [
  // The J's dash hit (2026-09-24): resolveCollisions reads it on both sides.
  ['Sergei', 0, 'dashHitForce'],
  ['Shelly', 0, 'dashHitForce'],
  ['Cheeto', 0, 'dashHitForce'],
  ['Sebastian', 0, 'dashHitForce'],
  ['Sebastian', 0, 'dashHitArcDeg'],
  ['Kurama', 0, 'dashPhaseThrough'],
  // Ice Slide glides: friction half-life ×3 while it lasts (2026-09-24).
  // Value only: BrawlRoom doesn't call frictionScale yet (DISTRIBUCIÓN).
  ['Kowalski', 0, 'slideFrictionMult'],
  // Sergei's Frenzy takes 0.4 of every push (2026-09-24).
  ['Sergei', 2, 'knockbackTakenMult'],
  // The Grip's stun, 2.5 s since it blocks every action (2026-09-24).
  ['Trunk', 2, 'gripStunDuration'],
  ['Cheeto', 2, 'pulseCount'],
  ['Kowalski', 2, 'floorFrictionMult'],
  ['Kowalski', 2, 'floorAccelMult'],
  // Steel Shell stops dead: rooted through its wind-up too (2026-09-24).
  ['Shelly', 1, 'slowDuringWindUp'],
  // ...her own motion only: a push above her run carries on (anchorInPlace).
  ['Shelly', 1, 'anchorBrakeMaxSpeed'],
  ['Kurama', 1, 'decoyEscapeFallbacks'],
  // Mirror Trick flees the nearest enemy this close (2026-09-24).
  ['Kurama', 1, 'decoyEscapeDistance'],
  ['Kurama', 1, 'decoyThreatRange'],
  // The All-in's hold window: a tap fires at the minimum (2026-09-24).
  // The minimum is value only: BrawlRoom's hold loop doesn't read it yet
  // (DISTRIBUCIÓN).
  ['Sebastian', 2, 'holdToFireMinMs'],
  ['Sebastian', 2, 'holdToFireMaxMs'],
] as const;

const PLAYABLE = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'] as const;
const DASH_FIELDS = ['dashHitForce', 'dashHitArcDeg', 'dashPhaseThrough', 'slideFrictionMult'] as const;

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

  // Unset counts too: a dash hit given on one side only is a desync.
  it.each(PLAYABLE)('%s J: same dash hit, phase-through and glide on both sides', (critter) => {
    for (const key of DASH_FIELDS) {
      expect(getAbilityKit(critter)[0][key], key).toEqual(CRITTER_ABILITIES[critter][0][key]);
    }
  });

  // Every slot: a resistance given on one side only is a desync.
  it.each(PLAYABLE)('%s: same knockbackTakenMult on every slot', (critter) => {
    CRITTER_ABILITIES[critter].forEach((def, slot) => {
      expect(getAbilityKit(critter)[slot].knockbackTakenMult, `slot ${slot}`).toEqual(def.knockbackTakenMult);
    });
  });

  // The glide is the J's active window only: not its wind-up, not after.
  // (The helper; BrawlRoom's integrate step doesn't call it yet.)
  it('Kowalski J: the server glides × slideFrictionMult only while the slide is active', () => {
    const kowalski = (active: boolean, windUpLeft: number) => ({
      critterName: 'Kowalski',
      abilities: [{ active, windUpLeft }, { active: false, windUpLeft: 0 }, { active: false, windUpLeft: 0 }],
    }) as unknown as PlayerSchema;
    expect(frictionScale(kowalski(true, 0))).toBe(CRITTER_ABILITIES.Kowalski[0].slideFrictionMult);
    expect(frictionScale(kowalski(true, 0.03))).toBe(1);
    expect(frictionScale(kowalski(false, 0))).toBe(1);
  });
});
