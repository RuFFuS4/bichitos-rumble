// ---------------------------------------------------------------------------
// The offline bot's All-in fails like a person (Rafa, 2026-09-29)
// ---------------------------------------------------------------------------
//
// src/bot.ts imports three, Critter and abilities-runtime, all of which load
// under plain node (no renderer; the GLB load fails quietly and the critter
// keeps its procedural mesh). A Sebastian bot and a Trunk dummy, no arena
// (the whole disc is floor) and no Critter.simulate: nobody moves unless the
// test moves them, so the lane is exactly what the test says.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { updateBot } from '../../src/bot';
import { Critter, CRITTER_PRESETS } from '../../src/critter';
import { FEEL } from '../../src/gamefeel';
import { seedMatchRng } from '../../src/match-rng';
import { tickSebastianHoldToFire } from '../../src/abilities-runtime';

// The trajectory preview animates itself on requestAnimationFrame (VFX only).
vi.stubGlobal('requestAnimationFrame', () => 0);

const DT = 1 / 60;
const preset = (name: string) => CRITTER_PRESETS.find((c) => c.name === name)!;

/** The charge age at which the bot looks: its clock adds DT per step, like
 *  advanceAllInCharge, so the look lands on the first step past the mark. */
let LOOK = 0;
while (LOOK < FEEL.bots.allInLookSec) LOOK += DT;

/** Sebastian at the origin facing +z, Trunk 7.5 u ahead: in the lane, past
 *  the J's 3-6 u and the K's cone, so the L is the only thing he can do. */
function setup(seed: number) {
  seedMatchRng(seed);
  const scene = new THREE.Scene();
  const seb = new Critter(preset('Sebastian'), scene);
  const dummy = new Critter(preset('Trunk'), scene);
  seb.x = 0; seb.z = 0; seb.mesh.rotation.y = 0;
  dummy.x = 0; dummy.z = 7.5;
  return { seb, dummy, all: [seb, dummy] };
}

/** Runs the bot until it starts charging (the risky roll is per second). */
function untilCharging(seb: Critter, all: Critter[]): void {
  for (let i = 0; i < 60 * 30 && !seb.lHoldCharging; i++) updateBot(seb, all, DT);
  expect(seb.lHoldCharging).toBe(true);
}

/** Steps the charge to its end; `each(age)` runs before every step with the
 *  age the charge will have after it. */
function hold(seb: Critter, all: Critter[], each: (age: number) => void = () => {}) {
  let lastAge = 0;
  for (let i = 0; i < 60 * 5 && seb.lHoldCharging; i++) {
    lastAge = seb.lHoldChargeTime + DT;
    each(lastAge);
    updateBot(seb, all, DT);
  }
  expect(seb.lHoldCharging).toBe(false);
  return { endAge: lastAge, spent: seb.abilityStates[2].cooldownLeft > 0 };
}

/** Holds with the dummy in the lane through the look, then parks it out of
 *  range so the release is a miss and nothing teleports Sebastian: the
 *  facing at the end is the dash's. Returns it, and the facing at the look. */
function holdAndDodge(seb: Critter, all: Critter[]) {
  let atLook = NaN;
  hold(seb, all, (age) => {
    if (age > LOOK + 1e-9 && Number.isNaN(atLook)) { atLook = seb.mesh.rotation.y; all[1].z = 50; }
  });
  return { atLook, final: seb.mesh.rotation.y };
}

describe('offline bot All-in: fails like a person', () => {
  it('commits at the look: a target that walks out afterwards is a miss, and Sebastian falls', () => {
    const { seb, dummy, all } = setup(11);
    untilCharging(seb, all);
    const { spent } = hold(seb, all, (age) => {
      if (age > LOOK + 1e-9) dummy.x = 6; // gone, after the look
    });
    expect(spent).toBe(true);
    expect(seb.falling).toBe(true);
    expect(dummy.falling).toBe(false);
  });

  it('an empty lane at the look drops the charge unspent', () => {
    const { seb, dummy, all } = setup(12);
    untilCharging(seb, all);
    dummy.x = 6;
    const { spent, endAge } = hold(seb, all);
    expect(spent).toBe(false);
    expect(seb.falling).toBe(false);
    expect(endAge).toBeCloseTo(LOOK, 9);
  });

  it('looks where it MEANT to aim: its own drift does not make it drop a good charge', () => {
    // Every seed keeps the dummy on the intended line; some errors swing the
    // real aim off it (7.5 u × tan 20° ≈ 2.7 u > the lane). None may cancel.
    for (let seed = 1; seed <= 20; seed++) {
      const { seb, all } = setup(seed);
      untilCharging(seb, all);
      const { spent } = hold(seb, all);
      expect(spent).toBe(true);
    }
  });

  it('lets go a human reaction time after the look, never before the minimum hold', () => {
    const minHold = (seb0().abilityStates[2].def.holdToFireMinMs ?? 0) / 1000;
    for (let seed = 1; seed <= 20; seed++) {
      const { seb, all } = setup(seed);
      untilCharging(seb, all);
      const { endAge } = hold(seb, all);
      expect(endAge).toBeGreaterThanOrEqual(Math.max(minHold, LOOK + FEEL.bots.allInReactionMinSec) - 1e-9);
      expect(endAge).toBeLessThanOrEqual(Math.max(minHold, LOOK + FEEL.bots.allInReactionMaxSec) + DT + 1e-9);
    }
  });

  it('the aim error stays within ±allInAimErrorDeg, both sides, set by the look, and replays with the seed', () => {
    const errs: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { seb, all } = setup(seed);
      untilCharging(seb, all);
      const { atLook, final } = holdAndDodge(seb, all);
      // The drift is done well before the look: no swerve after it, no snap.
      expect(final).toBe(atLook);
      errs.push(THREE.MathUtils.radToDeg(final));
    }
    for (const e of errs) expect(Math.abs(e)).toBeLessThanOrEqual(FEEL.bots.allInAimErrorDeg + 1e-9);
    expect(errs.some((e) => e > 1)).toBe(true);
    expect(errs.some((e) => e < -1)).toBe(true);
    const again = setup(7);
    untilCharging(again.seb, again.all);
    expect(THREE.MathUtils.radToDeg(holdAndDodge(again.seb, again.all).final)).toBe(errs[6]);
  });

  it('the drift turns at the aim rate, from the start of the charge', () => {
    const { seb, all } = setup(5);
    untilCharging(seb, all);
    const { final } = holdAndDodge(seb, all);
    const again = setup(5);
    untilCharging(again.seb, again.all);
    updateBot(again.seb, again.all, DT); // one step into the charge
    const step = THREE.MathUtils.degToRad(FEEL.allIn.aimTurnDegPerSec) * DT;
    expect(Math.abs(again.seb.mesh.rotation.y)).toBeCloseTo(Math.min(Math.abs(final), step), 12);
    expect(Math.sign(again.seb.mesh.rotation.y)).toBe(Math.sign(final));
  });

  it("the player's hold has no flaw: it fires on the key-up, along the aim it had", () => {
    const { seb, dummy, all } = setup(3);
    const scene = seb.mesh.parent as THREE.Scene;
    tickSebastianHoldToFire(seb, true, DT, all, scene);
    expect(seb.lHoldCharging).toBe(true);
    for (let i = 0; i < 30; i++) tickSebastianHoldToFire(seb, true, DT, all, scene); // 0.5 s held
    tickSebastianHoldToFire(seb, false, DT, all, scene);
    expect(seb.lHoldCharging).toBe(false);
    expect(seb.mesh.rotation.y).toBe(0);
    expect(dummy.falling).toBe(true);
  });
});

/** A throwaway Sebastian, to read his def. */
function seb0(): Critter {
  return new Critter(preset('Sebastian'), new THREE.Scene());
}
