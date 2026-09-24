// Steel Shell on the server sim (Rafa, 2026-09-24): it stops Shelly's own motion
// dead, and a self-buff (shell, Mirror Trick) doesn't hold anyone over the void —
// only the respawn grace does. Mirror of src/abilities-runtime.ts / src/physics.ts.
import { expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { createAbilityStates, tickPlayerAbilities } from '../../server/src/sim/abilities.js';
import { checkFalloff } from '../../server/src/sim/physics.js';

function player(sessionId: string, critterName: string, x: number, z: number, rotationY = Math.PI / 2): PlayerSchema {
  return {
    sessionId, critterName, x, z, vx: 0, vz: 0, rotationY, lives: 3,
    alive: true, falling: false, immunityTimer: 0, isHeadbutting: false, stunTimer: 0,
    lastHitTargetCritter: '', abilities: createAbilityStates(critterName),
  } as unknown as PlayerSchema;
}
const idle = { ability1: false, ability2: false, ultimate: false };
const DT = 1 / 30;
const hole = () => false;
const internal = () => new Map([['s', { respawnTimer: 0 }], ['k', { respawnTimer: 0 }]]);

function log(label: string, row: object) { console.log(label, JSON.stringify(row)); }

it('running Shelly presses K: stopped on the press, still stopped when the shell locks', () => {
  const s = player('s', 'Shelly', 0, 0);
  s.vx = 2.0;
  tickPlayerAbilities(s, [s], DT, { ...idle, ability2: true });
  const afterPress = s.vx;
  s.vx = 3.0; // a push during the wind-up
  for (let i = 0; i < 7; i++) tickPlayerAbilities(s, [s], DT, idle);
  log('run+K', { afterPress, afterLock: s.vx, windUp: s.abilities[1].windUpLeft, immunity: s.immunityTimer });
  expect(afterPress).toBe(0);
  expect(s.vx).toBe(0);
  expect(s.immunityTimer).toBeGreaterThan(3.5);
});

it('Shelly mid-J presses K: the J ends on the press and she stops', () => {
  const s = player('s', 'Shelly', 0, 0);
  tickPlayerAbilities(s, [s], DT, { ...idle, ability1: true });
  for (let i = 0; i < 3; i++) tickPlayerAbilities(s, [s], DT, idle);
  const vDash = Math.hypot(s.vx, s.vz);
  tickPlayerAbilities(s, [s], DT, { ...idle, ability2: true });
  log('J+K', { vDash, vAfterPress: s.vx, jActive: s.abilities[0].active, jCooldown: s.abilities[0].cooldownLeft });
  expect(vDash).toBeGreaterThan(10);
  expect(s.vx).toBe(0);
  expect(s.abilities[0].active).toBe(false);
});

it('anchored Shelly over a vanished tile falls', () => {
  const s = player('s', 'Shelly', 6.5, 2);
  tickPlayerAbilities(s, [s], DT, { ...idle, ability2: true });
  for (let i = 0; i < 8; i++) tickPlayerAbilities(s, [s], DT, idle);
  checkFalloff([s], internal(), hole);
  log('shell+hole', { immunity: s.immunityTimer, falling: s.falling, lives: s.lives });
  expect(s.falling).toBe(true);
});

it('fresh respawn over a vanished tile does not fall (grace)', () => {
  const s = player('s', 'Shelly', 6.5, 2);
  s.immunityTimer = 1.5;
  checkFalloff([s], internal(), hole);
  expect(s.falling).toBe(false);
});

it('respawn grace + K still in its wind-up: the grace holds; once the shell locks it falls', () => {
  const s = player('s', 'Shelly', 6.5, 2);
  s.immunityTimer = 1.5;
  tickPlayerAbilities(s, [s], DT, { ...idle, ability2: true });
  checkFalloff([s], internal(), hole);
  const inWindUp = s.falling;
  for (let i = 0; i < 8; i++) tickPlayerAbilities(s, [s], DT, idle);
  checkFalloff([s], internal(), hole);
  log('grace+K', { inWindUp, afterLock: s.falling });
  expect(inWindUp).toBe(false);
  expect(s.falling).toBe(true);
});

it('Kurama in Mirror Trick over a vanished tile falls', () => {
  const k = player('k', 'Kurama', -2, 6.5);
  tickPlayerAbilities(k, [k], DT, { ...idle, ability2: true });
  for (let i = 0; i < 5; i++) tickPlayerAbilities(k, [k], DT, idle);
  const immunity = k.immunityTimer;
  checkFalloff([k], internal(), hole);
  log('trick+hole', { immunity, falling: k.falling });
  expect(immunity).toBeGreaterThan(2);
  expect(k.falling).toBe(true);
});
