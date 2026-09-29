// ---------------------------------------------------------------------------
// Headbutt clash, client vs server (Rafa, 2026-09-29: «los dos salen
// despedidos»). The server tests (server-physics.test.ts) pin the numbers;
// this pins the client's headbuttClash (src/physics.ts) to the same ones,
// with real Critters under plain node (the GLB load fails quietly and the
// critter keeps its procedural mesh; audio and VFX are no-ops headless).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSchema } from '../../server/src/state/PlayerSchema.js';
import { resolveCollisions as serverResolve } from '../../server/src/sim/physics.js';
import { Critter, CRITTER_PRESETS } from '../../src/critter';
import { resolveCollisions as clientResolve } from '../../src/physics';

const preset = (name: string) => CRITTER_PRESETS.find((c) => c.name === name)!;

function clientClash(first: string, second: string, stunSecond = 0) {
  const scene = new THREE.Scene();
  const a = new Critter(preset(first), scene);
  const b = new Critter(preset(second), scene);
  a.x = 0; a.z = 0; b.x = 1.0; b.z = 0;
  a.isHeadbutting = true;
  b.isHeadbutting = true;
  b.stunTimer = stunSecond;
  clientResolve([a, b]);
  return { a: a.vx, b: b.vx };
}

function serverClash(first: string, second: string, stunSecond = 0) {
  const mk = (name: string, x: number, stunTimer: number) => ({
    sessionId: name, critterName: name, x, z: 0, vx: 0, vz: 0, alive: true, falling: false,
    immunityTimer: 0, isHeadbutting: true, stunTimer, lastHitTargetCritter: '', abilities: [],
  }) as unknown as PlayerSchema;
  const a = mk(first, 0, 0);
  const b = mk(second, 1.0, stunSecond);
  serverResolve([a, b]);
  return { a: a.vx, b: b.vx };
}

describe('headbutt clash: the client mirrors the server', () => {
  it.each([
    ['Trunk', 'Kowalski', 0],
    ['Kowalski', 'Trunk', 0],
    ['Sergei', 'Sihans', 0],
    ['Sergei', 'Kowalski', 0.5],
    ['Kermit', 'Shelly', 0],
  ])('%s vs %s (stun on the second: %s)', (first, second, stun) => {
    const c = clientClash(first, second, stun);
    const s = serverClash(first, second, stun);
    expect(c.a).toBeCloseTo(s.a, 10);
    expect(c.b).toBeCloseTo(s.b, 10);
  });

  it('Trunk vs Kowalski lands on the server\'s pinned numbers: hit + own recoil', () => {
    const c = clientClash('Trunk', 'Kowalski');
    expect(c.b).toBeCloseTo(124.32, 10);
    expect(c.a).toBeCloseTo(-85.68, 10);
  });
});
