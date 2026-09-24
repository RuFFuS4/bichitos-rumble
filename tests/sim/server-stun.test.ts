// The stun blocks every action on the server sim (Rafa, 2026-09-24): with stunTimer > 0
// no slot activates in tickPlayerAbilities; without it, all three do. Mirror of the client gate.
import { describe, expect, it } from 'vitest';
import { createAbilityStates, tickPlayerAbilities } from '../../server/src/sim/abilities.js';

function player(name: string, stun: number, x = 0) {
  return {
    sessionId: name + x, critterName: name, x, z: 0, vx: 0, vz: 0, rotationY: Math.PI / 2,
    alive: true, falling: false, immunityTimer: 0, stunTimer: stun, confusedTimer: 0, slowTimer: 0,
    isHeadbutting: false, headbuttAnticipating: false, abilities: createAbilityStates(name),
  } as any;
}

describe('server stun gate', () => {
  for (const name of ['Sergei', 'Kurama', 'Shelly', 'Trunk']) {
    it(`${name}: stunned presses of J/K/L start nothing; unstunned they do`, () => {
      const dummy = player('Kermit', 0, 5);
      const s = player(name, 1.0);
      tickPlayerAbilities(s, [s, dummy], 1 / 30, { ability1: true, ability2: true, ultimate: true });
      const stunnedActive = s.abilities.map((a: any) => a.active);
      const f = player(name, 0);
      tickPlayerAbilities(f, [f, dummy], 1 / 30, { ability1: true, ability2: false, ultimate: false });
      const g = player(name, 0);
      tickPlayerAbilities(g, [g, dummy], 1 / 30, { ability1: false, ability2: true, ultimate: false });
      const h = player(name, 0);
      tickPlayerAbilities(h, [h, dummy], 1 / 30, { ability1: false, ability2: false, ultimate: true });
      console.log(name, 'stunned', JSON.stringify(stunnedActive), 'free J/K/L', f.abilities[0].active, g.abilities[1].active, h.abilities[2].active);
      expect(stunnedActive).toEqual([false, false, false]);
      expect([f.abilities[0].active, g.abilities[1].active, h.abilities[2].active]).toEqual([true, true, true]);
    });
  }
});
