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
//   steps   how many sim steps (game.update calls) each of those frames
//           ran. At 60 Hz it must be 1 every frame: a mix of 0 and 2 means
//           animations and everything not interpolated stutter.
//
// --jitter=MS adds ± MS of noise to every frame timestamp and rounds it to
// 0.1 ms, like a real browser; without it the clock is exact.
//
// Usage (dev server running; muted browser like every test instance):
//   node scripts/fixed-step-probe.mjs --url=http://localhost:5181
//   node scripts/fixed-step-probe.mjs --hz=30,60,144,240 --push=25 --json
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
  // read the drawn position and the sim steps of every frame for a second.
  await frames(page, hz, hz);
  await page.evaluate(() => {
    const g = window.__game;
    const update = g.update;
    window.__steps = 0;
    g.update = function (dt) { window.__steps++; return update.call(g, dt); };
  });
  const drawn = [];
  const stepHist = {};
  for (let f = 0; f < hz; f++) {
    await frames(page, hz, 1);
    drawn.push(await drawnAt());
    const n = await page.evaluate(() => { const n = window.__steps; window.__steps = 0; return n; });
    stepHist[n] = (stepHist[n] ?? 0) + 1;
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' })));
  await page.close();
  const d = drawn.slice(1).map((q, i) => Math.hypot(q[0] - drawn[i][0], q[1] - drawn[i][1]));
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
  const steps = Object.entries(stepHist).map(([n, c]) => `${n}×${c}`).join(' ');
  return { hz, carry: carry === null ? null : +carry.toFixed(3), walkSpeed: +(mean * hz).toFixed(2), smoothCV: +(sd / mean).toFixed(4), lagFrames, steps };
}

const rows = [];
for (const hz of RATES) rows.push(await measure(hz));
await browser.close();
const ref = rows.find((r) => r.hz === 60)?.carry;
for (const r of rows) r.carryVs60 = ref && r.carry !== null ? `${(100 * (r.carry / ref - 1)).toFixed(1)} %` : '—';
if (opt.json) console.log(JSON.stringify(rows, null, 2));
else console.table(rows);
