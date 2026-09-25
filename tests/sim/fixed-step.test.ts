// src/fixed-step.ts: the live offline loop simulates in steps of 1/60 s
// (Rafa, decision 1 of the ability review) and draws the critters between
// their last two sim poses.

import { describe, expect, it } from 'vitest';
import {
  FixedStepClock, PoseInterpolator, PresentClock, SIM_STEP, MAX_STEPS_PER_FRAME, SNAP_DISTANCE, lerpFactor,
  type PoseTarget,
} from '../../src/fixed-step';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const body = (x = 0): PoseTarget => ({ mesh: { position: { x, y: 0, z: 0 } } });

/** Frame durations as a browser reports them: rAF timestamps of a `hz`
 *  display with ± `jitterMs` of noise, rounded to 0.1 ms. */
function realFrames(hz: number, seconds: number, jitterMs: number, seed = 1): number[] {
  const rnd = mulberry32(seed);
  const stamp = (i: number) => Math.round((i * 1000 / hz + (rnd() * 2 - 1) * jitterMs) * 10) / 10;
  const out: number[] = [];
  let prev = stamp(0);
  for (let i = 1; i <= hz * seconds; i++) {
    const s = stamp(i);
    out.push((s - prev) / 1000);
    prev = s;
  }
  return out;
}

describe('FixedStepClock', () => {
  it.each([30, 60, 75, 120, 144, 165, 240])('%i Hz with ±10 %% jitter: game time tracks real time (10 s ≈ 600 steps)', (hz) => {
    const clock = new FixedStepClock();
    const rnd = mulberry32(hz);
    let steps = 0;
    let t = 0;
    while (t < 10 - 1e-9) {
      const dt = Math.min((1 / hz) * (0.9 + 0.2 * rnd()), 10 - t);
      t += dt;
      const tick = clock.advance(dt);
      expect(tick.alpha).toBeGreaterThan(0);
      expect(tick.alpha).toBeLessThanOrEqual(1);
      steps += tick.steps;
    }
    expect(Math.abs(steps - 600)).toBeLessThanOrEqual(6); // 1 %
  });

  // The review's catch (2026-09-25): a 60 Hz display sits on the step
  // boundary, and real timestamps are noisy and rounded, so frames ran
  // 2, 0, 1 steps — animations and everything not interpolated stuttered.
  it.each([
    ['60 Hz, ±0.2 ms noise', 60, 0.2, 1],
    ['59.94 Hz', 59.94, 0.1, 1],
    ['60.02 Hz', 60.02, 0.1, 1],
    ['30 Hz', 30, 0.2, 2],
  ])('%s, real timestamps: every frame runs the same whole steps, drawn (almost) whole', (_label, hz, jitter, perFrame) => {
    const clock = new FixedStepClock();
    const ticks = realFrames(hz as number, 20, jitter as number).map((dt) => clock.advance(dt));
    expect(new Set(ticks.map((t) => t.steps))).toEqual(new Set([perFrame]));
    // The display sits ~1 ms (PHASE_MARGIN) behind the newest step, give
    // or take the jitter: never more than ~2 ms of added lag.
    expect(Math.min(...ticks.map((t) => t.alpha))).toBeGreaterThan(0.85);
  });

  it('after a hitch at 60 Hz it eases back to ~1 ms behind the newest step', () => {
    const clock = new FixedStepClock();
    for (let i = 0; i < 10; i++) clock.advance(1 / 60);
    const hitch = clock.advance(0.025); // a 25 ms frame: the display lands mid-step
    expect(hitch.alpha).toBeLessThan(0.7);
    let last = hitch;
    for (let i = 0; i < 25; i++) {
      last = clock.advance(1 / 60);
      expect(last.steps).toBe(1);
    }
    expect(last.alpha).toBeCloseTo(1 - 0.001 / SIM_STEP, 6);
  });

  it('60 Hz: one step per frame, drawn ~1 ms short of its end (no real lag), no float drift', () => {
    const clock = new FixedStepClock();
    for (let i = 0; i < 6000; i++) {
      const tick = clock.advance(1 / 60);
      expect(tick.steps).toBe(1);
      expect(tick.alpha).toBeGreaterThan(0.9);
    }
  });

  it('a long frame runs at most MAX_STEPS_PER_FRAME and drops the backlog', () => {
    const clock = new FixedStepClock();
    const hitch = clock.advance(2.0);
    expect(hitch.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(hitch.alpha).toBeGreaterThan(0.9);
    // The next normal frame is normal: no catch-up burst.
    expect(clock.advance(1 / 60).steps).toBe(1);
  });

  it('a negative frame (clock hiccup) runs nothing', () => {
    const clock = new FixedStepClock();
    expect(clock.advance(-0.5)).toEqual({ steps: 0, alpha: 1 });
  });
});

describe('PoseInterpolator', () => {
  /** Drives one body at constant speed through the fixed-step loop at `hz`
   *  and returns the drawn x of every frame. */
  function drawnPath(hz: number, interpolate: boolean): number[] {
    const clock = new FixedStepClock();
    const pose = new PoseInterpolator<PoseTarget>();
    const b = body();
    const speed = 6; // u/s
    const drawn: number[] = [];
    for (let f = 0; f < hz * 5; f++) {
      const tick = clock.advance(1 / hz);
      for (let i = 0; i < tick.steps; i++) {
        pose.capture([b]);
        b.mesh.position.x += speed * SIM_STEP;
      }
      if (interpolate) pose.apply([b], tick.alpha);
      drawn.push(b.mesh.position.x);
      pose.restore();
    }
    return drawn;
  }

  function cvOfFrameMoves(xs: number[]): number {
    const d = xs.slice(61).map((x, i) => x - xs[60 + i]); // after the first second
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
    return sd / mean;
  }

  it('at 144 Hz the drawn motion is even; without it, it steps', () => {
    expect(cvOfFrameMoves(drawnPath(144, true))).toBeLessThan(1e-4);
    // The regression this guards: fixed steps drawn raw jerk at 144 Hz.
    expect(cvOfFrameMoves(drawnPath(144, false))).toBeGreaterThan(0.5);
  });

  it('restore puts the sim pose back exactly', () => {
    const pose = new PoseInterpolator<PoseTarget>();
    const b = body(1);
    pose.capture([b]);
    b.mesh.position.x = 2;
    pose.apply([b], 0.25);
    expect(b.mesh.position.x).toBeCloseTo(1.25, 12);
    pose.restore();
    expect(b.mesh.position.x).toBe(2);
  });

  it('a teleport is drawn at the new spot, never in between', () => {
    const pose = new PoseInterpolator<PoseTarget>();
    const b = body(0);
    pose.capture([b]);
    b.mesh.position.x = SNAP_DISTANCE + 0.5; // respawn, restart, blink
    pose.apply([b], 0.5);
    expect(b.mesh.position.x).toBe(SNAP_DISTANCE + 0.5);
    pose.restore();
  });

  it('a short teleport the sim flagged (blink, yank) is drawn at the new spot', () => {
    const pose = new PoseInterpolator<PoseTarget & { teleportSerial: number }>();
    const b = { mesh: { position: { x: 0, y: 0, z: 0 } }, teleportSerial: 0 };
    pose.capture([b]);
    b.mesh.position.x = 1.5; // well under SNAP_DISTANCE
    b.teleportSerial++;
    pose.apply([b], 0.5);
    expect(b.mesh.position.x).toBe(1.5);
    pose.restore();
  });

  it('a body new this step is drawn at its sim pose', () => {
    const pose = new PoseInterpolator<PoseTarget>();
    pose.capture([]);
    const b = body(4);
    pose.apply([b], 0.5);
    expect(b.mesh.position.x).toBe(4);
    pose.restore();
    expect(b.mesh.position.x).toBe(4);
  });
});

describe('lerpFactor (presentation smoothing per frame, tuned per 1/60 step)', () => {
  it('one 1/60 step gives the old min(1, rate·dt)', () => {
    for (const rate of [1, 10, 20, 25, 30, 59]) expect(lerpFactor(rate, SIM_STEP)).toBeCloseTo(Math.min(1, rate * SIM_STEP), 12);
  });

  it('two half steps compose into one step, and 0 s moves nothing', () => {
    const half = lerpFactor(10, SIM_STEP / 2);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(lerpFactor(10, SIM_STEP), 12);
    expect(lerpFactor(10, 0)).toBe(0);
  });

  it('a rate that closes the gap in one step closes it at any dt > 0', () => {
    expect(lerpFactor(60, SIM_STEP / 3)).toBe(1);
    expect(lerpFactor(120, 0.001)).toBe(1);
  });
});

describe('PresentClock (game time shown per frame)', () => {
  it.each([30, 60, 75, 120, 144, 165, 240])('%i Hz with jitter: never negative, and it adds up to the sim time', (hz) => {
    const clock = new FixedStepClock();
    const shown = new PresentClock();
    const rnd = mulberry32(hz + 7);
    let sim = 0;
    let total = 0;
    for (let f = 0; f < hz * 10; f++) {
      const tick = clock.advance((1 / hz) * (0.9 + 0.2 * rnd()));
      for (let i = 0; i < tick.steps; i++) { shown.onStep(SIM_STEP); sim += SIM_STEP; }
      const dt = shown.onFrame(tick.alpha);
      expect(dt).toBeGreaterThanOrEqual(0);
      total += dt;
    }
    expect(Math.abs(total - sim)).toBeLessThanOrEqual(SIM_STEP + 1e-9);
  });

  it('at a steady 60 Hz every frame shows one step; at 30 Hz, two', () => {
    for (const [hz, perFrame] of [[60, 1], [30, 2]]) {
      const clock = new FixedStepClock();
      const shown = new PresentClock();
      const dts: number[] = [];
      for (let f = 0; f < 120; f++) {
        const tick = clock.advance(1 / hz);
        for (let i = 0; i < tick.steps; i++) shown.onStep(SIM_STEP);
        dts.push(shown.onFrame(tick.alpha));
      }
      for (const dt of dts.slice(10)) expect(dt).toBeCloseTo(perFrame * SIM_STEP, 9);
    }
  });

  it('a freeze shows nothing new; the resume moves by alpha of a step', () => {
    const shown = new PresentClock();
    shown.onStep(SIM_STEP);
    shown.onFrame(1);
    for (let i = 0; i < 5; i++) { shown.onStep(0); expect(shown.onFrame(1)).toBe(0); }
    shown.onStep(SIM_STEP);
    expect(shown.onFrame(0.25)).toBeCloseTo(0.25 * SIM_STEP, 12);
  });

  it('slow motion: 0.1 s frames show the 4 steps they ran', () => {
    const clock = new FixedStepClock();
    const shown = new PresentClock();
    for (let f = 0; f < 10; f++) {
      const tick = clock.advance(0.1);
      for (let i = 0; i < tick.steps; i++) shown.onStep(SIM_STEP);
      const dt = shown.onFrame(tick.alpha);
      if (f > 0) expect(dt).toBeCloseTo(4 * SIM_STEP, 9);
    }
  });

  it('the one-step-one-frame path (Game.update) shows exactly its dt', () => {
    const shown = new PresentClock();
    for (const dt of [0.016, 0.02, 0.05, 0.001]) {
      shown.onStep(dt);
      expect(shown.onFrame(1)).toBeCloseTo(dt, 12);
    }
  });
});
