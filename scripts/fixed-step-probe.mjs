#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fixed-step-probe — does the live game simulate the same at any refresh rate?
// ---------------------------------------------------------------------------
//
// Drives the REAL game page (index.html, src/main.ts's loop — not the lab)
// with a virtual requestAnimationFrame clock at each --hz, so the refresh
// rate is exact and reproducible. Two measurements per rate:
//
//   carry   a critter pushed at --push u/s (stunned, so no input of its
//           own) — how far it slides until it stops. With the fixed step
//           (src/fixed-step.ts) it's the same at every rate; with the frame
//           dt fed to the physics it wasn't (−27 % at 144 Hz, +29 % at 30).
//   lag     frames from pressing D until the player's drawn position moves:
//           1 is the old per-frame loop; drawing the PAST sim step (textbook
//           interpolation) would make it 2 at 60 Hz.
//   smooth  the player walking with D held at steady speed — the position
//           actually DRAWN each frame (mesh.matrixWorld, written by the
//           render), and the CV of its per-frame moves. ~0 is smooth; fixed
//           steps drawn raw at 144 Hz give ~1.2.
//   steps   how many sim steps (game.simulate calls) each of those frames
//           ran. At 60 Hz it must be 1 every frame: a mix of 0 and 2 means
//           the sim jitters against the display.
//   presents / animCV / animRate  how many times the player's presentation
//           ran each frame (1 since the second cut; before, once per step:
//           0 or 1 at 144 Hz), and the per-frame advance of its animation
//           mixer: CV ~0 is smooth, and rate ~1 is real time.
//   leaks   frames where anything the sim owns (positions, velocities,
//           facing, timers, flags, abilities, match timer, phase) changed
//           after the frame's last sim step: presentation writing sim state.
//           Must be 0.
//
// --hitstop adds a second table: the player headbutts a stunned dummy, and
// per rate it measures the freeze (frames, ms) and the picture it holds
// (the victim's squash and flash, the attacker's scale and glow). It has to
// be the same picture at every rate, and hold still.
//
// --snowball adds a third: Kowalski throws his K and the ball's DRAWN
// position is read every frame (CV of its per-frame move: ~0 is smooth).
//
// --jitter=MS adds ± MS of noise to every frame timestamp and rounds it to
// 0.1 ms, like a real browser; without it the clock is exact.
//
// Usage (dev server running; muted browser like every test instance):
//   node scripts/fixed-step-probe.mjs --url=http://localhost:5181
//   node scripts/fixed-step-probe.mjs --hz=30,60,144,240 --push=25 --hitstop --json
//   node scripts/fixed-step-probe.mjs --hz=60 --jitter=0.2
// ---------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { launchMutedBrowser, newMutedPage } from './lib/headless-browser.mjs';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    hz: { type: 'string', default: '30,60,144,240' },
    push: { type: 'string', default: '25' },
    jitter: { type: 'string', default: '0' },
    json: { type: 'boolean', default: false },
    hitstop: { type: 'boolean', default: false },
    snowball: { type: 'boolean', default: false },
  },
});
const RATES = opt.hz.split(',').map(Number);
const PUSH = Number(opt.push);
const JITTER = Number(opt.jitter);

const browser = await launchMutedBrowser({ channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function openGame() {
  const page = await newMutedPage(browser, { viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  // The virtual clock: rAF callbacks only run when the probe ticks, and
  // performance.now() reads the same clock (main.ts seeds lastTime with it).
  await page.addInitScript((jitter) => {
    let ideal = 0;
    let now = 0;
    let queue = [];
    window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
    window.cancelAnimationFrame = () => {};
    Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
    window.__vclock = {
      tick(ms) {
        ideal += ms;
        now = jitter > 0 ? Math.round((ideal + (Math.random() * 2 - 1) * jitter) * 10) / 10 : ideal;
        const cbs = queue; queue = []; for (const cb of cbs) cb(now);
      },
    };
  }, JITTER);
  await page.goto(new URL('/', opt.url).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__game) && Boolean(window.__vclock), null, { polling: 100, timeout: 60000 });
  return page;
}

/** Ticks `n` frames of 1/hz s, letting real time pass so asset loads land. */
async function frames(page, hz, n) {
  await page.evaluate(({ ms, n }) => { for (let i = 0; i < n; i++) window.__vclock.tick(ms); }, { ms: 1000 / hz, n });
}

async function startMatch(page, hz) {
  await frames(page, 60, 30);
  await page.evaluate(() => window.__game.debugStartOfflineMatch('Sergei', ['Trunk', 'Kurama', 'Shelly'], { seed: 7, packId: 'kitsune_shrine' }));
  for (let i = 0; i < 600; i++) {
    await frames(page, hz, 10);
    if (await page.evaluate(() => window.__game.phase === 'playing' && window.__game.critters.every((c) => c.glbMesh))) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('la partida no arrancó');
}

async function measure(hz) {
  const page = await openGame();
  await startMatch(page, hz);
  // Everyone but the player stunned for good (no input, no actions) and
  // parked out of the way; the dummy slides along +x from x = −5.
  await page.evaluate(({ push }) => {
    const g = window.__game;
    const [p, dummy, a, b] = g.critters;
    for (const c of [dummy, a, b]) { c.stunTimer = 1e9; c.vx = 0; c.vz = 0; c.immunityTimer = 0; }
    p.x = -8; p.z = -4; p.vx = 0; p.vz = 0;
    a.x = 0; a.z = 7; b.x = 0; b.z = -7;
    dummy.x = -5; dummy.z = 3; dummy.vx = push; dummy.vz = 0;
    window.__probeStart = dummy.x;
  }, { push: PUSH });
  let carry = null;
  for (let f = 0; f < hz * 3; f++) {
    await frames(page, hz, 1);
    const s = await page.evaluate(() => { const d = window.__game.critters[1]; return { x: d.x, v: Math.hypot(d.vx, d.vz) }; });
    if (s.v < 0.01) { carry = s.x - (await page.evaluate(() => window.__probeStart)); break; }
  }

  // Lag: frames from pressing D until the player's DRAWN position moves
  // (1 = the very next frame, like the old per-frame loop).
  const drawnAt = () => page.evaluate(() => { const e = window.__game.critters[0].mesh.matrixWorld.elements; return [e[12], e[14]]; });
  await frames(page, hz, 1);
  const rest = await drawnAt();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })));
  let lagFrames = null;
  for (let f = 1; f <= 10; f++) {
    await frames(page, hz, 1);
    const q = await drawnAt();
    if (Math.hypot(q[0] - rest[0], q[1] - rest[1]) > 1e-6) { lagFrames = f; break; }
  }
  // Smoothness: keep D held, let the player reach its steady speed, then
  // for a second read, every frame: the drawn position, the sim steps, how
  // many times the player's presentation ran, how far its animation
  // advanced, and whether anything the sim owns changed after the sim
  // (the fingerprint: presentation must never write sim state). Hooks the
  // split names (simulate/present) and falls back to update() on a build
  // from before the fixed step's second cut.
  await frames(page, hz, hz);
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.critters[0];
    window.__fp = () => JSON.stringify([g.phase, g.matchTimer, ...g.critters.map((c) => [
      c.x, c.z, c.vx, c.vz, c.mesh.rotation.y, c.immunityTimer, c.stunTimer, c.slowTimer, c.confusedTimer,
      c.invisibilityTimer, c.selfTintTimer, c.headbuttCooldown, c.isHeadbutting, c.headbuttAnticipating,
      c.falling, c.alive, c.lives, c.abilityStates.map((s) => [s.active, s.windUpLeft, s.durationLeft, s.cooldownLeft]),
    ])]);
    const stepKey = typeof g.simulate === 'function' ? 'simulate' : 'update';
    const step = g[stepKey];
    window.__steps = 0;
    g[stepKey] = function (dt) { window.__steps++; const r = step.call(g, dt); window.__afterSim = window.__fp(); return r; };
    const presentKey = typeof p.present === 'function' ? 'present' : 'update';
    const present = p[presentKey];
    window.__presents = 0;
    p[presentKey] = function (dt) { window.__presents++; return present.call(p, dt); };
  });
  const drawn = [];
  const stepHist = {};
  const presentHist = {};
  const anim = [];
  let leaks = 0;
  for (let f = 0; f < hz; f++) {
    const s = await page.evaluate(({ ms }) => {
      window.__afterSim = window.__fp();
      const t0 = window.__game.critters[0].skeletal?.mixer?.time ?? 0;
      window.__vclock.tick(ms);
      const p = window.__game.critters[0];
      const e = p.mesh.matrixWorld.elements;
      const out = {
        drawn: [e[12], e[14]], steps: window.__steps, presents: window.__presents,
        anim: (p.skeletal?.mixer?.time ?? 0) - t0, leak: window.__afterSim !== window.__fp(),
      };
      window.__steps = 0; window.__presents = 0;
      return out;
    }, { ms: 1000 / hz });
    drawn.push(s.drawn);
    stepHist[s.steps] = (stepHist[s.steps] ?? 0) + 1;
    presentHist[s.presents] = (presentHist[s.presents] ?? 0) + 1;
    anim.push(s.anim);
    if (s.leak) leaks++;
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' })));
  await page.close();
  const d = drawn.slice(1).map((q, i) => Math.hypot(q[0] - drawn[i][0], q[1] - drawn[i][1]));
  const cv = (xs) => {
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
    return { mean, cv: mean > 0 ? sd / mean : NaN };
  };
  const hist = (h) => Object.entries(h).map(([n, c]) => `${n}×${c}`).join(' ');
  const move = cv(d);
  const a = cv(anim);
  return {
    hz, carry: carry === null ? null : +carry.toFixed(3), walkSpeed: +(move.mean * hz).toFixed(2),
    smoothCV: +move.cv.toFixed(4), lagFrames, steps: hist(stepHist), presents: hist(presentHist),
    animCV: +a.cv.toFixed(4), animRate: +(a.mean * hz).toFixed(3), leaks,
  };
}

/**
 * The hit stop: the player headbutts a stunned dummy standing 1.3 u ahead.
 * Per frame, the attacker's animation time, scale and glow and the
 * victim's squash and flash. The freeze starts on the frame the blow lands
 * and holds everything still; it has to show the same picture, for about
 * the same time, at every refresh rate.
 */
async function measureHitstop(hz) {
  const page = await openGame();
  await startMatch(page, hz);
  await page.evaluate(() => {
    const g = window.__game;
    const [p, v, a, b] = g.critters;
    for (const c of [v, a, b]) { c.stunTimer = 1e9; c.vx = 0; c.vz = 0; c.immunityTimer = 0; }
    p.immunityTimer = 0; p.vx = 0; p.vz = 0; p.headbuttCooldown = 0;
    p.x = -4; p.z = 0; p.mesh.rotation.y = Math.PI / 2; // facing +x
    v.x = -2.7; v.z = 0;
    a.x = 0; a.z = 7; b.x = 0; b.z = -7;
  });
  await frames(page, hz, Math.max(2, Math.round(hz * 0.3)));
  await page.evaluate(() => window.__game.critters[0].startHeadbutt());
  const rows = [];
  for (let f = 0; f < Math.round(hz * 0.6); f++) {
    rows.push(await page.evaluate(({ ms }) => {
      window.__vclock.tick(ms);
      const g = window.__game;
      const [p, v] = g.critters;
      const mat = (c) => c.getActiveMaterials()[0];
      return {
        frozen: g.lastStepFrozen === true, hit: v.vx !== 0 || v.vz !== 0,
        pMix: p.skeletal?.mixer?.time ?? 0, pSy: p.glbMesh?.scale.y ?? 0, pEm: mat(p)?.emissiveIntensity ?? 0,
        vSy: v.mesh.scale.y, vEm: mat(v)?.emissiveIntensity ?? 0,
      };
    }, { ms: 1000 / hz }));
  }
  await page.close();
  const hitAt = rows.findIndex((r) => r.hit);
  if (hitAt < 0) return { hz, error: 'no hit' };
  // The freeze: from the hit frame, the frames whose attacker animation
  // doesn't move.
  let n = 1;
  while (hitAt + n < rows.length && rows[hitAt + n].pMix === rows[hitAt].pMix) n++;
  const h = rows[hitAt];
  const still = rows.slice(hitAt, hitAt + n).every((r) => r.pSy === h.pSy && r.vSy === h.vSy && r.vEm === h.vEm && r.pEm === h.pEm);
  return {
    hz, freezeFrames: n, freezeMs: +(n * 1000 / hz).toFixed(1), stillDuringFreeze: still,
    victimScaleY: +h.vSy.toFixed(4), victimFlash: +h.vEm.toFixed(4),
    attackerScaleY: +h.pSy.toFixed(4), attackerGlow: +h.pEm.toFixed(4),
  };
}

/**
 * Kowalski throws his snowball (K); per frame, where the ball is DRAWN
 * (its mesh). A ball drawn at its sim positions moves 0 or 1 steps' worth
 * per frame at 144 Hz; drawn between them it moves evenly.
 */
async function measureSnowball(hz) {
  const page = await openGame();
  await frames(page, 60, 30);
  await page.evaluate(() => window.__game.debugStartOfflineMatch('Kowalski', ['Trunk', 'Kurama', 'Shelly'], { seed: 7, packId: 'kitsune_shrine' }));
  for (let i = 0; i < 600; i++) {
    await frames(page, hz, 10);
    if (await page.evaluate(() => window.__game.phase === 'playing' && window.__game.critters.every((c) => c.glbMesh))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await page.evaluate(() => {
    const g = window.__game;
    const [p, a, b, c] = g.critters;
    for (const o of [a, b, c]) { o.stunTimer = 1e9; o.vx = 0; o.vz = 0; }
    a.x = 0; a.z = 8; b.x = -8; b.z = -8; c.x = 8; c.z = -8;
    p.x = -8; p.z = 0; p.vx = 0; p.vz = 0; p.mesh.rotation.y = Math.PI / 2; // throws along +x
    for (const s of p.abilityStates) s.cooldownLeft = 0;
  });
  await frames(page, hz, Math.max(2, Math.round(hz * 0.2)));
  // A 50 ms tap, like a person's: the sim reads held keys once per step,
  // so a press shorter than a step (16.7 ms) can fall between two.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' })));
  await frames(page, hz, Math.max(2, Math.round(hz * 0.05)));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyK' })));
  const xs = [];
  for (let f = 0; f < Math.round(hz * 2.5); f++) {
    const x = await page.evaluate(({ ms }) => {
      window.__vclock.tick(ms);
      let ball = null;
      window.__game.scene.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.widthSegments === 12
          && o.geometry.parameters?.heightSegments === 8 && o.material?.color?.getHex() === 0xeaf6ff) ball = o;
      });
      return ball ? ball.position.x : null;
    }, { ms: 1000 / hz });
    if (x !== null) xs.push(x);
    else if (xs.length) break;
  }
  await page.close();
  const d = xs.slice(2, -1).map((x, i) => xs[i + 3] - x).filter((v) => Number.isFinite(v));
  if (d.length < 5) return { hz, error: `bola vista en ${xs.length} fotogramas` };
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
  return { hz, frames: xs.length, ballSpeed: +(mean * hz).toFixed(2), ballCV: +(sd / mean).toFixed(4) };
}

const rows = [];
for (const hz of RATES) rows.push(await measure(hz));
const ref = rows.find((r) => r.hz === 60)?.carry;
for (const r of rows) r.carryVs60 = ref && r.carry !== null ? `${(100 * (r.carry / ref - 1)).toFixed(1)} %` : '—';
const hitstop = [];
if (opt.hitstop) for (const hz of RATES) hitstop.push(await measureHitstop(hz));
const snowball = [];
if (opt.snowball) for (const hz of RATES) snowball.push(await measureSnowball(hz));
await browser.close();
if (opt.json) console.log(JSON.stringify({ rows, hitstop, snowball }, null, 2));
else {
  console.table(rows);
  if (hitstop.length) console.table(hitstop);
  if (snowball.length) console.table(snowball);
}
