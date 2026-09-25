// knockbackScale on the server sim (Rafa, 2026-09-24): Sergei's Frenzy takes ×0.4 of
// every push the sim applies (headbutt, recoil, nudge, K, grip), also when Kurama copies it.
import { expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { resolveCollisions } from '../../server/src/sim/physics.js';
import { createAbilityStates, knockbackScale, tickPlayerAbilities } from '../../server/src/sim/abilities.js';

function player(sessionId: string, critterName: string, x: number, extra: Partial<Record<string, unknown>> = {}): PlayerSchema {
  return {
    sessionId, critterName, x, z: 0, vx: 0, vz: 0, rotationY: -Math.PI / 2,
    alive: true, falling: false, immunityTimer: 0, isHeadbutting: false, stunTimer: 0,
    lastHitTargetCritter: '', abilities: createAbilityStates(critterName), ...extra,
  } as unknown as PlayerSchema;
}
const frenzy = (p: PlayerSchema) => { const s = p.abilities[2]; s.active = true; s.windUpLeft = 0; s.durationLeft = 2.5; s.effectFired = true; };

it('Trunk headbutt on Sergei: frenzy ×0.4 on the server', () => {
  const hit = (fr: boolean) => {
    const t = player('t', 'Trunk', 0, { isHeadbutting: true });
    const s = player('s', 'Sergei', 1.0);
    if (fr) frenzy(s);
    resolveCollisions([t, s]);
    return { sv: s.vx, tv: t.vx, kb: knockbackScale(s) };
  };
  const a = hit(false); const b = hit(true);
  console.log('server Trunk→Sergei vx normal', a, 'frenzy', b);
  expect(b.kb).toBe(0.4);
});

it('Sergei frenzy recoil on the server', () => {
  const hit = (fr: boolean) => {
    const s = player('s', 'Sergei', 0, { isHeadbutting: true });
    const t = player('t', 'Trunk', 1.0);
    if (fr) frenzy(s);
    resolveCollisions([s, t]);
    return { sv: s.vx, tv: t.vx };
  };
  console.log('server Sergei recoil normal', hit(false), 'frenzy', hit(true));
});

it('Grip on the server yanks a frenzied Sergei 0.4 of the way', () => {
  const run = (fr: boolean) => {
    const t = player('t', 'Trunk', 0, { rotationY: Math.PI / 2 });
    const s = player('s', 'Sergei', 8);
    if (fr) frenzy(s);
    const inputs = { ability1: false, ability2: false, ultimate: true };
    tickPlayerAbilities(t, [t, s], 1 / 30, inputs);
    for (let i = 0; i < 20; i++) tickPlayerAbilities(t, [t, s], 1 / 30, { ability1: false, ability2: false, ultimate: false });
    return s.x;
  };
  console.log('server grip Sergei x normal', run(false), 'frenzy', run(true));
});

it('Steel Shell reflect on a frenzied Sergei', () => {
  const run = (fr: boolean) => {
    const s = player('s', 'Sergei', 0, { isHeadbutting: true });
    const sh = player('sh', 'Shelly', 1.0);
    const k = sh.abilities[1]; k.active = true; k.windUpLeft = 0; k.durationLeft = 4;
    if (fr) frenzy(s);
    resolveCollisions([s, sh]);
    return s.vx;
  };
  console.log('server reflect on Sergei vx normal', run(false), 'frenzy', run(true));
});

it('Copycat of Sergei resists on the server', () => {
  const k = player('k', 'Kurama', 0);
  k.lastHitTargetCritter = 'Sergei';
  tickPlayerAbilities(k, [k], 1 / 30, { ability1: false, ability2: false, ultimate: true });
  const during: number[] = [];
  for (let i = 0; i < 12; i++) {
    tickPlayerAbilities(k, [k], 1 / 30, { ability1: false, ability2: false, ultimate: false });
    during.push(knockbackScale(k));
  }
  console.log('server Kurama copying Sergei knockbackScale per tick', during.join(' '));
  expect(during.at(-1)).toBe(0.4);
  const k2 = player('k2', 'Kurama', 0);
  tickPlayerAbilities(k2, [k2], 1 / 30, { ability1: false, ability2: false, ultimate: true });
  for (let i = 0; i < 12; i++) tickPlayerAbilities(k2, [k2], 1 / 30, { ability1: false, ability2: false, ultimate: false });
  expect(knockbackScale(k2)).toBe(1);
});
