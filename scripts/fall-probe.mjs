#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fall-probe — why does a critter fall? Every fall, classified in SIM time
// ---------------------------------------------------------------------------
//
// run-match-batch says HOW OFTEN a critter falls; this says WHY. The batch
// recordings can't: their events carry performance.now() (wall clock), so
// at --speed 8 a "1.2 s after the cast" window is several seconds of match
// (the mistake behind ERROR_LOG 2026-09-25). Here a hook on game.update
// counts time in sim steps and keeps the critter's last 2 s.
//
// The critter plays as the autopilot player (the bot brain) against three
// seeded random opponents in the /tools.html lab, at a fixed 1/60 step. Per
// fall it records:
//   - cause: `floor` (the tile under its last on-floor spot died), `contact`
//     (an enemy within 1.3 u in the last 0.5 s), or `alone`;
//   - seconds since its own J, and whether the J was still active;
//   - speed, how radial the velocity was (1 = straight out), whether the
//     bot's input pointed out, and the ring it fell from.
//
// Usage (dev server running; muted browser like every test instance):
//   node scripts/fall-probe.mjs --critter=Kowalski --matches=40 --seed=4000
//   node scripts/fall-probe.mjs --url=http://localhost:5182 --out=.tmp/base.json
//   node scripts/fall-probe.mjs --feel=movement.frictionHalfLife=0.1
//
// Options: --url (def http://localhost:5173) · --critter (def Kowalski) ·
// --matches (def 40) · --seed (def 4000) · --out (def
// .tmp/fall-probe/<critter>.json) · --feel=sec.key=value,... (what-ifs on
// the live FEEL, like run-match-batch).
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchMutedBrowser, newMutedPage } from './lib/headless-browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ALL = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'];
const CONTACT = 1.3;       // u between centres: two 0.55 radii and a margin
const WINDOW_AFTER_J = 1.2; // s — "fell right after its own J"

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    critter: { type: 'string', default: 'Kowalski' },
    matches: { type: 'string', default: '40' },
    seed: { type: 'string', default: '4000' },
    out: { type: 'string' },
    feel: { type: 'string', default: '' },
  },
});
const CRITTER = opt.critter;
if (!ALL.includes(CRITTER)) throw new Error(`--critter: ${CRITTER} no es un bicho del roster`);
const OUT = resolve(ROOT, opt.out ?? `.tmp/fall-probe/${CRITTER.toLowerCase()}.json`);
const feel = Object.fromEntries(opt.feel.split(',').filter(Boolean).map((kv) => {
  const [k, v] = kv.split('=');
  return [k, Number(v)];
}));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const browser = await launchMutedBrowser({ channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await newMutedPage(browser, { viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(new URL('/tools.html', opt.url).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__devApi) && Boolean(window.__game) && Boolean(window.__feel), null, { timeout: 60000 });

// The hook: after every game.update, one sample of the critter; on its
// falling edge, classify the fall from the last samples.
await page.evaluate(({ CRITTER, feel, CONTACT }) => {
  // window.__feel is the instance the game reads (see run-match-batch --feel).
  for (const [p, v] of Object.entries(feel)) {
    const [s, k] = p.split('.');
    if (typeof window.__feel[s]?.[k] !== 'number') throw new Error(`--feel: FEEL.${p} no existe o no es numerico`);
    window.__feel[s][k] = v;
  }
  const g = window.__game;
  const P = (window.__fallProbe = { falls: [], casts: 0, steps: 0 });
  let buf = []; let t = 0; let lastCast = -1e9; let wasActive = false; let wasFalling = false; let me = null;
  P.reset = () => { buf = []; t = 0; lastCast = -1e9; wasActive = false; wasFalling = false; me = null; };
  const radial = (b, x, z) => { const r = Math.hypot(b.x, b.z) || 1; return (x * b.x + z * b.z) / r; };
  const update = g.update;
  g.update = function (dt) {
    update.call(g, dt);
    if (g.phase !== 'playing') return;
    t += dt; P.steps++;
    if (!me || !g.critters.includes(me)) me = g.critters.find((c) => c.config.name === CRITTER);
    if (!me) return;
    const j = me.abilityStates[0];
    if (j.active && !wasActive) { P.casts++; lastCast = t; }
    wasActive = j.active;
    let nearest = Infinity;
    for (const o of g.critters) if (o !== me && o.alive && !o.falling) nearest = Math.min(nearest, Math.hypot(o.x - me.x, o.z - me.z));
    buf.push({
      x: me.x, z: me.z, vx: me.vx, vz: me.vz, jActive: j.active && j.windUpLeft <= 0,
      onFloor: g.arena.isOnArena(me.x, me.z), nearest, mx: me.moveX, mz: me.moveZ, input: me.hasInput,
    });
    if (buf.length > 120) buf.shift();
    if (me.falling && !wasFalling && buf.length >= 2) {
      const prev = buf[buf.length - 2]; // last sample still on the floor
      const last30 = buf.slice(-30);    // 0.5 s
      const speed = Math.hypot(prev.vx, prev.vz);
      const floorGone = prev.onFloor && !g.arena.isOnArena(prev.x, prev.z);
      const minEnemy = Math.min(...last30.map((b) => b.nearest));
      const steer = buf.slice(-18).reduce((s, b) => s + (b.input ? radial(b, b.mx, b.mz) : 0), 0) / 18;
      P.falls.push({
        cause: floorGone ? 'floor' : minEnemy <= CONTACT ? 'contact' : 'alone',
        sinceJ: +(t - lastCast).toFixed(3),
        jActive: prev.jActive,
        ring: +Math.hypot(prev.x, prev.z).toFixed(2),
        speed: +speed.toFixed(2),
        radialV: +(radial(prev, prev.vx, prev.vz) / (speed || 1)).toFixed(2),
        steerOut: +steer.toFixed(2),
        minEnemy: +minEnemy.toFixed(2),
      });
    }
    wasFalling = me.falling;
  };
}, { CRITTER, feel, CONTACT });

const rnd = mulberry32(Number(opt.seed) * 7919);
const others = ALL.filter((n) => n !== CRITTER);
for (let m = 0; m < Number(opt.matches); m++) {
  const bots = [];
  while (bots.length < 3) {
    const n = others[Math.floor(rnd() * others.length)];
    if (!bots.includes(n)) bots.push(n);
  }
  const seed = Number(opt.seed) + m;
  await page.evaluate(({ CRITTER, bots, seed }) => {
    const api = window.__devApi;
    window.__fallProbe.reset();
    api.setAutopilot(true);
    api.setFixedStep(8);
    if (api.getSpeed() === 0) api.setSpeed(1);
    api.startMatch(CRITTER, bots, { seed });
  }, { CRITTER, bots, seed });
  const t0 = Date.now();
  while (!(await page.evaluate(() => window.__game.phase === 'ended'))) {
    if (Date.now() - t0 > 120_000) { console.error(`  partida ${seed}: sin terminar en 2 min, se corta`); break; }
    await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write(`\r${m + 1}/${opt.matches}`);
}
process.stdout.write('\n');

const res = await page.evaluate(() => ({ casts: window.__fallProbe.casts, steps: window.__fallProbe.steps, falls: window.__fallProbe.falls }));
await browser.close();

const min = res.steps / 3600;
const count = (list) => Object.fromEntries(['contact', 'alone', 'floor'].map((c) => [c, list.filter((f) => f.cause === c).length]));
const afterJ = res.falls.filter((f) => f.sinceJ <= WINDOW_AFTER_J);
const summary = {
  critter: CRITTER, matches: Number(opt.matches), seed: Number(opt.seed), feel,
  matchMinutes: +min.toFixed(1),
  jCasts: res.casts,
  falls: res.falls.length,
  fallsPerMin: +(res.falls.length / min).toFixed(2),
  byCausePerMin: Object.fromEntries(Object.entries(count(res.falls)).map(([k, v]) => [k, +(v / min).toFixed(2)])),
  afterOwnJ: { falls: afterJ.length, pctOfJ: +(100 * afterJ.length / (res.casts || 1)).toFixed(1), byCause: count(afterJ) },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...summary, fallList: res.falls }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`→ ${OUT}`);
