// Mirror Trick's escape on the server sim (Rafa, 2026-09-24: the back-jump is to get
// away from the pursuer): away from the nearest enemy within decoyThreatRange, else
// back from the facing, with the live-floor fallbacks.
import { expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { createAbilityStates, tickPlayerAbilities } from '../../server/src/sim/abilities.js';

const E = Math.PI / 2, W = -Math.PI / 2, N = 0;
function player(sessionId: string, critterName: string, x: number, z: number, rotationY = 0): PlayerSchema {
  return {
    sessionId, critterName, x, z, vx: 0, vz: 0, rotationY,
    alive: true, falling: false, immunityTimer: 0, isHeadbutting: false, stunTimer: 0,
    lastHitTargetCritter: '', abilities: createAbilityStates(critterName),
  } as unknown as PlayerSchema;
}
const idle = { ability1: false, ability2: false, ultimate: false };

function trick(face: number, enemies: [string, number, number][], isOnArena?: (x: number, z: number) => boolean) {
  const k = player('k', 'Kurama', 0, 0, face);
  const others = enemies.map(([n, x, z], i) => player(`e${i}`, n, x, z));
  const all = [k, ...others];
  tickPlayerAbilities(k, all, 1 / 30, { ...idle, ability2: true }, isOnArena);
  for (let i = 0; i < 5; i++) tickPlayerAbilities(k, all, 1 / 30, idle, isOnArena);
  const row = {
    to: [+k.x.toFixed(2) + 0, +k.z.toFixed(2) + 0],
    faceDeg: Math.round((k.rotationY * 180) / Math.PI),
    dist: others.map((o) => +Math.hypot(o.x - k.x, o.z - k.z).toFixed(2)),
  };
  console.log(JSON.stringify(row));
  return row;
}

it('(a) facing her chaser: backward, away from him', () => {
  expect(trick(E, [['Sergei', 2, 0]]).to).toEqual([-7, 0]);
});
it('(b) fleeing, chaser 2 u behind: away from him, turned to face him', () => {
  const r = trick(W, [['Sergei', 2, 0]]);
  expect(r.to).toEqual([-7, 0]);
  expect(r.faceDeg).toBe(90);
});
it('(c1) two enemies: flees the nearest (east), not the one behind', () => {
  expect(trick(N, [['Sergei', 2, 0], ['Trunk', 0, -4]]).to).toEqual([-7, 0]);
});
it('(c2) two enemies: flees the nearest (behind)', () => {
  expect(trick(N, [['Sergei', 4.5, 0], ['Trunk', 0, -3]]).to).toEqual([0, 7]);
});
it('(d) fleeing, chaser 8 u behind: still away from him', () => {
  expect(trick(W, [['Sergei', 8, 0]]).to).toEqual([-7, 0]);
});
it('(e) nobody within 10 u: straight back from her facing', () => {
  const r = trick(W, [['Sergei', 0, 11]]);
  expect(r.to).toEqual([7, 0]);
  expect(r.faceDeg).toBe(-90);
});
it('(f) fallbacks kept: away line off the floor lands at 70 %', () => {
  expect(trick(W, [['Sergei', 2, 0]], (x) => x > -5).to).toEqual([-4.9, 0]);
});
it('(g) no fallback on floor: stays on the decoy spot', () => {
  expect(trick(W, [['Sergei', 2, 0]], (x) => x > -2).to).toEqual([0, 0]);
});
it('(h) a falling enemy is no threat', () => {
  const k = player('k', 'Kurama', 0, 0, W);
  const s = player('s', 'Sergei', 2, 0);
  (s as unknown as { falling: boolean }).falling = true;
  tickPlayerAbilities(k, [k, s], 1 / 30, { ...idle, ability2: true });
  for (let i = 0; i < 5; i++) tickPlayerAbilities(k, [k, s], 1 / 30, idle);
  expect([+k.x.toFixed(2) + 0, +k.z.toFixed(2) + 0]).toEqual([7, 0]);
});
