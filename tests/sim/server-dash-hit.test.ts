// Dash hit on the server sim (Rafa, 2026-09-24): a J with dashHitForce hits once
// per victim per activation (Sebastian only ahead of him), Kurama's feint phases,
// and the anchored/immune/stunned rules match the headbutt. Mirror of src/physics.ts.
import { describe, expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { resolveCollisions, type DashHitEvent, type ShellReflectEvent } from '../../server/src/sim/physics.js';
import { createAbilityStates, tickPlayerAbilities } from '../../server/src/sim/abilities.js';

function mk(sid: string, critterName: string, x: number, z: number, o: Partial<Record<string, unknown>> = {}): PlayerSchema {
  return {
    sessionId: sid, critterName, x, z, vx: 0, vz: 0, alive: true, falling: false,
    immunityTimer: 0, isHeadbutting: false, stunTimer: 0, lastHitTargetCritter: '',
    rotationY: Math.PI / 2, abilities: createAbilityStates(critterName), ...o,
  } as unknown as PlayerSchema;
}
function dashing(p: PlayerSchema): PlayerSchema {
  const s = p.abilities[0];
  s.active = true; s.windUpLeft = 0; s.durationLeft = 0.2; s.effectFired = true;
  return p;
}

describe('H1 dash hit (server sim)', () => {
  it('Sergei J hits Kermit once: (nudge + 22) × mass share, then the nudge alone', () => {
    const s = dashing(mk('s', 'Sergei', 0, 0));
    const k = mk('k', 'Kermit', 1.0, 0);
    const out: DashHitEvent[] = [];
    resolveCollisions([s, k], undefined, undefined, out);
    const share = 2.2 / (2.2 + 0.6);
    expect(k.vx).toBeCloseTo((3 + 22) * share, 10);
    expect(out).toEqual([{ rusherSid: 's', victimSid: 'k', nx: 1, nz: 0, force: 22 }]);
    k.vx = 0; k.x = 1.0; s.x = 0;
    resolveCollisions([s, k], undefined, undefined, out);
    expect(k.vx).toBeCloseTo(3 * share, 10);
    expect(out.length).toBe(1);
  });

  it('a new activation hits again (fireChargeRush clears the set)', () => {
    const s = dashing(mk('s', 'Sergei', 0, 0));
    const k = mk('k', 'Kermit', 1.0, 0);
    resolveCollisions([s, k]);
    // end the dash, fire it again through the real tick
    s.abilities[0].active = false; s.abilities[0].cooldownLeft = 0;
    tickPlayerAbilities(s, [s, k], 1 / 30, { ability1: true, ability2: false, ultimate: false });
    tickPlayerAbilities(s, [s, k], 1 / 30, { ability1: false, ability2: false, ultimate: false });
    expect(s.abilities[0].active).toBe(true);
    expect(s.abilities[0].windUpLeft).toBeLessThanOrEqual(0);
    s.x = 0; s.z = 0; s.vx = 0; s.vz = 0; k.x = 1.0; k.z = 0; k.vx = 0; k.vz = 0;
    resolveCollisions([s, k]);
    expect(k.vx).toBeCloseTo(25 * (2.2 / 2.8), 10);
  });

  it('Sebastian hits only ahead (±60°), a side contact is a nudge and is not used up', () => {
    const seb = dashing(mk('b', 'Sebastian', 0, 0)); // facing +x
    const side = mk('v', 'Kermit', 0, 1.0); // 90° off
    resolveCollisions([seb, side]);
    const share = (0.8 * 1.7) / (0.8 * 1.7 + 0.6);
    expect(side.vz).toBeCloseTo(3 * share, 10);
    side.x = 1.0; side.z = 0; side.vx = 0; side.vz = 0; seb.x = 0; seb.z = 0;
    resolveCollisions([seb, side]);
    expect(side.vx).toBeCloseTo((3 + 26) * share, 10);
  });

  it('Kurama phases: no separation, no push', () => {
    const ku = dashing(mk('q', 'Kurama', 0, 0));
    const k = mk('k', 'Kermit', 0.5, 0);
    resolveCollisions([ku, k]);
    expect(k.x).toBe(0.5); expect(ku.x).toBe(0); expect(k.vx).toBe(0); expect(ku.vx).toBe(0);
    // and a headbutt on her passes through too
    k.isHeadbutting = true;
    resolveCollisions([k, ku]);
    expect(ku.vx).toBe(0);
    // when the dash ends she collides again
    ku.abilities[0].active = false;
    resolveCollisions([ku, k]);
    expect(k.x).not.toBe(0.5);
  });

  it('stunned victim takes ×4, immune victim nothing', () => {
    const s = dashing(mk('s', 'Sergei', 0, 0));
    const k = mk('k', 'Kermit', 1.0, 0, { stunTimer: 1 });
    resolveCollisions([s, k]);
    expect(k.vx).toBeCloseTo(25 * (2.2 / 2.8) * 4, 10);
    const s2 = dashing(mk('s2', 'Sergei', 0, 0));
    const k2 = mk('k2', 'Kermit', 1.0, 0, { immunityTimer: 1 });
    const out: DashHitEvent[] = [];
    resolveCollisions([s2, k2], undefined, undefined, out);
    expect(k2.vx).toBe(0); expect(out).toEqual([]);
  });

  it('anchored Shelly reflects the dash hit × 0.85 once, then bounces', () => {
    const s = dashing(mk('s', 'Sergei', 0, 0));
    const sh = mk('sh', 'Shelly', 1.0, 0);
    sh.abilities[1].active = true; sh.abilities[1].windUpLeft = 0;
    const refl: ShellReflectEvent[] = [];
    resolveCollisions([s, sh], undefined, refl);
    expect(s.vx).toBeCloseTo(-22 * 0.85, 10);
    expect(refl).toEqual([{ attackerSid: 's', anchoredSid: 'sh' }]);
    s.vx = 0; s.x = 0; sh.x = 1.0;
    resolveCollisions([s, sh], undefined, refl);
    expect(s.vx).toBeCloseTo(-3 * 1.925, 10);
    expect(refl.length).toBe(1);
  });

  it('dash with no force (Trunk) keeps the nudge and still emits the event', () => {
    const t = dashing(mk('t', 'Trunk', 0, 0));
    const k = mk('k', 'Kermit', 1.0, 0);
    const out: DashHitEvent[] = [];
    resolveCollisions([t, k], undefined, undefined, out);
    const share = (1.2 * 4.0) / (1.2 * 4.0 + 0.6);
    expect(k.vx).toBeCloseTo(3 * share, 10);
    expect(out.length).toBe(1);
  });
});
