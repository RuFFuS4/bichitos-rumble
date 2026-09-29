// ---------------------------------------------------------------------------
// Server sim physics (server/src/sim/physics.ts) — the authoritative
// knockback math. three-free by design; PlayerSchema is only a TYPE import
// there, so plain objects with the fields the functions actually read are
// valid stand-ins (verified against the source before writing these).
//
// Golden forces are hardcoded on purpose: an accidental balance edit to
// SIM.collision, headbuttBoost, PWS force or SHELL_REFLECT breaks them.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { resolveCollisions, type HeadbuttHitEvent, type ShellReflectEvent } from '../../server/src/sim/physics.js';

interface AbilityLike {
  abilityType: string;
  active: boolean;
  windUpLeft: number;
}

/** Minimal PlayerSchema-like with every field resolveCollisions reads. */
function makePlayer(overrides: {
  sessionId: string;
  critterName: string;
  x: number;
  z: number;
  isHeadbutting?: boolean;
  stunTimer?: number;
  abilities?: AbilityLike[];
}): PlayerSchema {
  return {
    sessionId: overrides.sessionId,
    critterName: overrides.critterName,
    x: overrides.x,
    z: overrides.z,
    vx: 0,
    vz: 0,
    alive: true,
    falling: false,
    immunityTimer: 0,
    isHeadbutting: overrides.isHeadbutting ?? false,
    stunTimer: overrides.stunTimer ?? 0,
    lastHitTargetCritter: '',
    abilities: overrides.abilities ?? [],
  } as unknown as PlayerSchema;
}

/** Shelly with Steel Shell up: slot 1 (K) active, windup done. */
function makeAnchoredShelly(x: number, z: number): PlayerSchema {
  return makePlayer({
    sessionId: 'shelly',
    critterName: 'Shelly',
    x, z,
    abilities: [
      { abilityType: 'charge_rush', active: false, windUpLeft: 0 },
      { abilityType: 'ground_pound', active: true, windUpLeft: 0 }, // Steel Shell
      { abilityType: 'frenzy', active: false, windUpLeft: 0 },
    ],
  });
}

describe('server physics — resolveCollisions', () => {
  it('massRatio: the lighter defender flies further from the same headbutt', () => {
    // Sergei (mass 1.0, force 14, boost 1.40) headbutts → force = 14·3.5·1.40 = 68.6
    const hitBy = (defName: string): number => {
      const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
      const def = makePlayer({ sessionId: 'def', critterName: defName, x: 1.0, z: 0 });
      resolveCollisions([atk, def]);
      return def.vx;
    };
    const kermitDv = hitBy('Kermit'); // mass 0.6 → ratio 1/1.6 = 0.625
    const shellyDv = hitBy('Shelly'); // mass 1.4 → ratio 1/2.4
    expect(kermitDv).toBeGreaterThan(shellyDv);
    expect(kermitDv).toBeCloseTo(68.6 * 0.625, 10); // 42.875
    expect(shellyDv).toBeCloseTo(68.6 / 2.4, 10); // 28.5833…
  });

  it('attacker recoils on connect (recoilFactor 0.35)', () => {
    const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    resolveCollisions([atk, def]);
    expect(atk.vx).toBeCloseTo(-68.6 * 0.35, 10); // -24.01, opposite to the hit
  });

  it('shell reflect: headbutting an anchored Shelly returns the attacker\'s OWN force × 0.85, away from her', () => {
    // Sebastian: force 18, boost 1.45 → reflect = 18·3.5·1.45·0.85 = 77.6475
    const seb = makePlayer({ sessionId: 'seb', critterName: 'Sebastian', x: 0, z: 0, isHeadbutting: true });
    const shelly = makeAnchoredShelly(1.0, 0);
    const reflects: ShellReflectEvent[] = [];
    resolveCollisions([seb, shelly], undefined, reflects);
    expect(seb.vx).toBeCloseTo(-77.6475, 10); // pushed back along -x (away from Shelly)
    expect(seb.vz).toBeCloseTo(0, 12);
    expect(shelly.vx).toBe(0); // the anchored side takes nothing
    expect(shelly.vz).toBe(0);
    // mass ×9999 separation: Shelly barely moves, the attacker eats the overlap
    expect(shelly.x).toBeCloseTo(1.0, 3);
    expect(seb.x).toBeCloseTo(-0.1, 3);
    // The reflect emits its broadcast event (feedback online, 2026-08-24)
    expect(reflects).toEqual([{ attackerSid: 'seb', anchoredSid: 'shelly' }]);

    // Reflect scales with the ATTACKER: a weak hitter bounces off gently.
    // Sihans: force 10, boost default 1.0 → 10·3.5·1.0·0.85 = 29.75
    const sihans = makePlayer({ sessionId: 'sih', critterName: 'Sihans', x: 0, z: 0, isHeadbutting: true });
    const shelly2 = makeAnchoredShelly(1.0, 0);
    resolveCollisions([sihans, shelly2]);
    expect(sihans.vx).toBeCloseTo(-29.75, 10);
    expect(Math.abs(sihans.vx)).toBeLessThan(Math.abs(seb.vx));
  });

  it('anchored bounce without headbutt: running into Steel Shell rebounds at normalPush × 1.925', () => {
    const runner = makePlayer({ sessionId: 'run', critterName: 'Sergei', x: 0, z: 0 });
    const shelly = makeAnchoredShelly(1.0, 0);
    resolveCollisions([runner, shelly]);
    // 1.4 × 1.375 since the 2026-09-21 speed-up (SIM.collision.anchoredBounceFactor)
    expect(runner.vx).toBeCloseTo(-3.0 * 1.925, 10); // -5.775
    expect(shelly.vx).toBe(0);
  });

  it('stunnedVulnerability: a stunned defender takes exactly ×4 knockback', () => {
    const hitKermit = (stunTimer: number): number => {
      const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
      const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0, stunTimer });
      resolveCollisions([atk, def]);
      return def.vx;
    };
    const normal = hitKermit(0);
    const stunned = hitKermit(0.5);
    expect(stunned / normal).toBeCloseTo(4, 12);
    expect(stunned).toBeCloseTo(42.875 * 4, 10); // 171.5 — Trunk Grip follow-up yeet
  });

  it('headbutt connect records last-attacker credit on the defender (Slayer Belt)', () => {
    const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    const internal = new Map<
      string,
      { respawnTimer: number; lastAttackerSid?: string | null; lastAttackTimeMs?: number }
    >([
      ['atk', { respawnTimer: 0 }],
      ['def', { respawnTimer: 0 }],
    ]);
    resolveCollisions([atk, def], internal);
    const di = internal.get('def')!;
    expect(di.lastAttackerSid).toBe('atk');
    expect(di.lastAttackTimeMs).toBeTypeOf('number');
    expect(internal.get('atk')!.lastAttackerSid).toBeUndefined();
  });

  // Rafa 2026-09-29, «los dos salen despedidos»: before, the first in the
  // array hit and only recoiled, and the other's headbutt was ignored.
  type Credit = { respawnTimer: number; lastAttackerSid?: string | null; lastAttackTimeMs?: number };
  const clash = (first: string, second: string, stun: { first?: number; second?: number } = {}) => {
    const a = makePlayer({ sessionId: first, critterName: first, x: 0, z: 0, isHeadbutting: true, stunTimer: stun.first });
    const b = makePlayer({ sessionId: second, critterName: second, x: 1.0, z: 0, isHeadbutting: true, stunTimer: stun.second });
    const internal = new Map<string, Credit>([[first, { respawnTimer: 0 }], [second, { respawnTimer: 0 }]]);
    resolveCollisions([a, b], internal);
    return { a, b, internal };
  };

  it('headbutt clash: each takes the OTHER\'s hit with the victim\'s mass share, plus its own recoil', () => {
    // Trunk 48·3.5 = 168, mass 1.2 · Kowalski 16·3.5·1.20 = 67.2, mass 0.8
    const { a: trunk, b: kow, internal } = clash('Trunk', 'Kowalski');
    expect(kow.vx).toBeCloseTo(168 * 1.2 / 2.0 + 67.2 * 0.35, 10);    // +124.32 = 100.8 + 23.52
    expect(trunk.vx).toBeCloseTo(-(67.2 * 0.8 / 2.0 + 168 * 0.35), 10); // −85.68 = 26.88 + 58.8
    expect(kow.vz).toBe(0);
    expect(trunk.vz).toBe(0);
    // Each is the other's last attacker (Slayer credit either way).
    expect(internal.get('Trunk')!.lastAttackerSid).toBe('Kowalski');
    expect(internal.get('Kowalski')!.lastAttackerSid).toBe('Trunk');
  });

  it('headbutt clash: the array order no longer decides — swapping it mirrors the result', () => {
    for (const [x, y] of [['Trunk', 'Kowalski'], ['Sergei', 'Sihans'], ['Shelly', 'Sebastian']]) {
      const xy = clash(x, y);
      const yx = clash(y, x);
      expect(yx.a.vx).toBeCloseTo(-xy.b.vx, 10); // y's speed away from x, both orders
      expect(yx.b.vx).toBeCloseTo(-xy.a.vx, 10); // x's
    }
    // Equal masses, different forces: Sergei 68.6 vs Sihans 35, both 1.0.
    const { a: sergei, b: sihans } = clash('Sergei', 'Sihans');
    expect(sihans.vx).toBeCloseTo(34.3 + 35 * 0.35, 10);     // 46.55
    expect(sergei.vx).toBeCloseTo(-(17.5 + 68.6 * 0.35), 10); // −41.51
  });

  it('headbutt clash: same positions, reversed array → identical result', () => {
    const mk = () => ({
      t: makePlayer({ sessionId: 't', critterName: 'Trunk', x: 0, z: 0, isHeadbutting: true }),
      k: makePlayer({ sessionId: 'k', critterName: 'Kowalski', x: 1.0, z: 0, isHeadbutting: true }),
    });
    const p = mk(); resolveCollisions([p.t, p.k]);
    const q = mk(); resolveCollisions([q.k, q.t]);
    expect(q.t.vx).toBeCloseTo(p.t.vx, 10); // −85.68 both ways (before: −58.8 vs −26.88)
    expect(q.k.vx).toBeCloseTo(p.k.vx, 10); // +124.32 both ways (before: +100.8 vs +23.52)
    expect(q.t.x).toBeCloseTo(p.t.x, 10);
    expect(q.k.x).toBeCloseTo(p.k.x, 10);
  });

  // The room broadcasts these so the client replays the hit's feedback
  // (src/physics.ts headbuttHitFeedback / headbuttClashFeedback).
  const hitsOf = (players: PlayerSchema[]) => {
    const hits: HeadbuttHitEvent[] = [];
    resolveCollisions(players, undefined, undefined, undefined, hits);
    return hits;
  };

  it('headbutt hit event: one per connect, attacker → victim, pushed away from the attacker', () => {
    const atk = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    expect(hitsOf([atk, def])).toEqual([{ attackerSid: 'atk', victimSid: 'def', nx: 1, nz: 0, clash: false }]);
    // The headbutter second in the list: same event, same direction.
    const atk2 = makePlayer({ sessionId: 'atk', critterName: 'Sergei', x: 0, z: 0, isHeadbutting: true });
    const def2 = makePlayer({ sessionId: 'def', critterName: 'Kermit', x: 1.0, z: 0 });
    const [ev] = hitsOf([def2, atk2]);
    expect(ev).toMatchObject({ attackerSid: 'atk', victimSid: 'def', clash: false });
    expect(ev.nx).toBeCloseTo(1, 12);
    expect(ev.nz).toBeCloseTo(0, 12);
  });

  it('headbutt hit event: a clash is ONE event, flagged, from the first in the list', () => {
    const a = makePlayer({ sessionId: 'a', critterName: 'Trunk', x: 0, z: 0, isHeadbutting: true });
    const b = makePlayer({ sessionId: 'b', critterName: 'Kowalski', x: 0, z: 1.0, isHeadbutting: true });
    expect(hitsOf([a, b])).toEqual([{ attackerSid: 'a', victimSid: 'b', nx: 0, nz: 1, clash: true }]);
  });

  it('headbutt hit event: none for a plain nudge, nor for a Steel Shell reflect', () => {
    const p = makePlayer({ sessionId: 'p', critterName: 'Sergei', x: 0, z: 0 });
    const q = makePlayer({ sessionId: 'q', critterName: 'Kermit', x: 1.0, z: 0 });
    expect(hitsOf([p, q])).toEqual([]);
    const seb = makePlayer({ sessionId: 'seb', critterName: 'Sebastian', x: 0, z: 0, isHeadbutting: true });
    const shelly = makeAnchoredShelly(1.0, 0);
    const reflects: ShellReflectEvent[] = [];
    const hits: HeadbuttHitEvent[] = [];
    resolveCollisions([seb, shelly], undefined, reflects, undefined, hits);
    expect(hits).toEqual([]);
    expect(reflects).toHaveLength(1);
  });

  it('headbutt clash: each side keeps its own vulnerability (stun ×4 on the stunned one only)', () => {
    const { a: sergei, b: kow } = clash('Sergei', 'Kowalski', { second: 0.5 });
    expect(kow.vx).toBeCloseTo((68.6 * 1.0 / 1.8 + 67.2 * 0.35) * 4, 10);  // 246.53: hit and recoil, ×4
    expect(sergei.vx).toBeCloseTo(-(67.2 * 0.8 / 1.8 + 68.6 * 0.35), 10);  // −53.88, unstunned
  });
});
