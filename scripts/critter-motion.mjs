#!/usr/bin/env node
// ---------------------------------------------------------------------------
// critter-motion — how a critter actually moves, measured (and filmed)
// ---------------------------------------------------------------------------
//
// The feeling pass (docs/FEELING.md) is judged on numbers first and on
// video second. This drives a real match in the /tools.html lab through a
// FIXED route — stand, run away from camera, let go, run back, reverse
// 180°, turn 90°, let go — one sim step of exactly 1/60 s per frame, so
// the physics behaves as at 60 Hz however slow the headless renderer is.
//
// Per critter it reports: real top speed, the run clip's live rate and
// cycles/s, foot slip against the measured stride (1 = planted), body lean
// and sway at full run, how many frames a 180° reversal takes, and the
// critter's real height in the match. With --video it also screenshots
// every step and assembles an MP4 (60 fps) with ffmpeg.
//
// It also tracks the real feet (skinned vertices of the foot/toe bones, both
// rig naming schemes) and adds up how far the foot on the ground slides, in
// cm (1 u = 1 m): while starting to run, while braking after letting go, and
// per second of steady run. Stride ratios can't see the transitions (the
// clip rate, the smoothing and the run→idle crossfade all play there); the
// feet can. 0 = planted.
//
// Usage (dev server running):
//   node scripts/critter-motion.mjs                              # 9 critters, table
//   node scripts/critter-motion.mjs --critters=Kermit,Cheeto --video --label=antes
//   node scripts/critter-motion.mjs --url=http://localhost:5181 --json
//
// Options: --url (def http://localhost:5173) · --critters=A,B · --pack
// (def kitsune_shrine, so before/after videos share a floor) · --out (def
// .tmp/critter-motion) · --label (file prefix, def "motion") · --video ·
// --json · --no-gpu (software render: ~18 s per frame at video size) ·
// --feel=movement.accelerationScale=2.4 (what-if on the live FEEL).
//
// The browser is muted (scripts/lib/headless-browser.mjs), as every test
// instance must be. GPU mode only adds ANGLE/D3D11 flags on top.
// ---------------------------------------------------------------------------

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchMutedBrowser, newMutedPage } from './lib/headless-browser.mjs';
import { RUN_GAIT } from '../src/critter-locomotion.ts';

const ROOT = resolve(import.meta.dirname, '..');
const ALL = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'];
// Route in 1/60 s steps: [first step, keys held]; null ends the run.
const ROUTE = [[0, []], [20, ['KeyW']], [100, []], [125, ['KeyS']], [175, ['KeyD']], [225, []], [260, null]];
const STEADY = [80, 100];     // steps of steady run towards -z (for speed/lean/rate)
const REVERSE_AT = 125;       // W released at 100, S pressed here: the 180° reversal
// Foot-slide windows (steps): standing still (floor reference), the start
// from rest (W at 20), and the stop after letting go (W up at 100).
const STAND = [5, 20];
const START_RUN = [20, 50];
const STOP = [100, 125];
const FOOT_BAND = 0.02;       // u: vertices this close to the foot's lowest point bear the weight
const FOOT_CONTACT = 0.03;    // u above the standing floor: the foot counts as on the ground
const START = { x: 0, z: 4.5 };
// Covers the whole route at the 2026-09-21 speed (the fastest critter
// travels ~6 u on the long leg); the old box cropped Kurama out.
const FRAME = { x0: -2.6, x1: 4.8, z0: -3.2, z1: 5.8, yTop: 2.9 };

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    critters: { type: 'string', default: ALL.join(',') },
    pack: { type: 'string', default: 'kitsune_shrine' },
    out: { type: 'string', default: '.tmp/critter-motion' },
    label: { type: 'string', default: 'motion' },
    video: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'no-gpu': { type: 'boolean', default: false },
    feel: { type: 'string' },
  },
});
// --feel=movement.accelerationScale=2.4[,S.K=N]: what-if on the page's live
// FEEL (same format as feel-patch / run-match-batch). Never touches source.
const FEEL_OVERRIDES = {};
for (const part of (opt.feel ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const m = /^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)=(-?\d+(?:\.\d+)?)$/.exec(part);
  if (!m) { console.error(`--feel: "${part}" no es seccion.clave=numero`); process.exit(1); }
  FEEL_OVERRIDES[m[1]] = Number(m[2]);
}
const OUT = resolve(ROOT, opt.out);
mkdirSync(OUT, { recursive: true });

const gpu = opt['no-gpu'] ? {} : { channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await launchMutedBrowser(gpu);
const page = await newMutedPage(browser, { viewport: opt.video ? { width: 2400, height: 1540 } : { width: 960, height: 600 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(new URL('/tools.html', opt.url).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__devApi) && Boolean(window.__game), null, { timeout: 60000 });

const key = (type, code) => page.evaluate(({ type, code }) => window.dispatchEvent(new KeyboardEvent(type, { code })), { type, code });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const rows = [];
for (const name of opt.critters.split(',')) {
  const bot = name === 'Sergei' ? 'Trunk' : 'Sergei';
  await page.evaluate(() => { window.__devApi.setFixedStep(null); window.__devApi.setSpeed(1); });
  if (Object.keys(FEEL_OVERRIDES).length > 0) {
    await page.evaluate((over) => {
      // The instance the game reads (see run-match-batch.mjs for why a
      // page-side import of gamefeel.ts is not good enough).
      const FEEL = window.__feel;
      if (!FEEL) throw new Error('--feel: la pagina no expone window.__feel (¿tools.html antiguo?)');
      for (const [p, v] of Object.entries(over)) {
        const [sec, key] = p.split('.');
        if (typeof FEEL[sec]?.[key] !== 'number') throw new Error(`--feel: FEEL.${p} no existe o no es numerico`);
        FEEL[sec][key] = v;
      }
    }, FEEL_OVERRIDES);
  }
  await page.evaluate(({ name, bot, pack }) => window.__devApi.startMatch(name, [bot], { seed: 501, packId: pack }), { name, bot, pack: opt.pack });
  await page.waitForFunction(() => window.__game.phase === 'playing' && window.__game.critters.every((c) => c.glbMesh), null, { timeout: 120000 });
  await page.waitForTimeout(300);

  // Park the bot out of the way, place the critter, freeze the clock and
  // (for video) work out the screen rectangle that covers the route.
  const setup = await page.evaluate(async ({ START, FRAME, video }) => {
    const api = window.__devApi; const g = window.__game;
    api.setSpeed(0);
    api.setAllBotsBehaviour('idle');
    const p = g.critters[0];
    p.x = START.x; p.z = START.z; p.vx = 0; p.vz = 0; p.mesh.rotation.y = Math.PI;
    // The placement is a teleport, not a turn: no model lag to start with.
    p.visualYawLag = 0; p.lastFacingY = Number.NaN;
    const b = g.critters[1]; b.x = -9; b.z = -6; b.vx = 0; b.vz = 0;
    // Real height: skinned vertices, not the bind-pose box.
    const V = p.mesh.position.constructor;
    p.mesh.updateMatrixWorld(true);
    let lo = Infinity, hi = -Infinity; const v = new V();
    p.glbMesh.traverse((n) => {
      if (!n.isMesh) return;
      const pos = n.geometry.attributes.position; const stepV = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += stepV) {
        v.fromBufferAttribute(pos, i);
        if (n.isSkinnedMesh) n.applyBoneTransform(i, v);
        v.applyMatrix4(n.matrixWorld); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
      }
    });
    // Foot vertices: those whose heaviest bone is a foot or toe (Tripo
    // `L_Foot`, Meshy/Mixamo `LeftFoot` + `LeftToeBase`). Outline hulls
    // share the geometry: skipped.
    const FOOT = { L: /^(L_Foot|LeftFoot|LeftToeBase)$/, R: /^(R_Foot|RightFoot|RightToeBase)$/ };
    const feet = { L: [], R: [] };
    p.glbMesh.traverse((m) => {
      if (!m.isSkinnedMesh || m.userData.critterOutline) return;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < si.count; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        const bone = m.skeleton.bones[best].name;
        if (FOOT.L.test(bone)) feet.L.push([m, i]);
        else if (FOOT.R.test(bone)) feet.R.push([m, i]);
      }
    });
    const thin = (a) => { const s = Math.max(1, Math.floor(a.length / 150)); return a.filter((_, i) => i % s === 0); };
    window.__motionFeet = { L: thin(feet.L), R: thin(feet.R), prev: null };
    let clip = null;
    if (video) {
      const { createCamera } = await import('/src/camera.ts');
      const cam = createCamera();
      const rect = document.querySelector('canvas').getBoundingClientRect();
      cam.aspect = rect.width / rect.height; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const X of [FRAME.x0, FRAME.x1]) for (const Z of [FRAME.z0, FRAME.z1]) for (const Y of [0, FRAME.yTop]) {
        const s = new V(X, Y, Z).project(cam);
        const sx = rect.left + (s.x + 1) / 2 * rect.width, sy = rect.top + (1 - s.y) / 2 * rect.height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      clip = { x: Math.round(x0), y: Math.round(y0), width: Math.round((x1 - x0) / 2) * 2, height: Math.round((y1 - y0) / 2) * 2 };
    }
    return { id: p.rosterEntry.id, height: hi - lo, scale: p.glbMesh.scale.x, runDur: p.skeletal?.getClipDuration('run') ?? null, clip, feet: [feet.L.length, feet.R.length] };
  }, { START, FRAME, video: opt.video });
  if (!setup.feet[0] || !setup.feet[1]) console.error(`${name}: sin vértices de pie (${setup.feet}) — no se mide el deslizamiento`);

  const dir = join(OUT, `${opt.label}-${name.toLowerCase()}`);
  if (opt.video) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  const frames = [];
  const held = new Set();
  let ri = 0;
  for (let step = 0; ; step++) {
    if (ri < ROUTE.length && ROUTE[ri][0] <= step) {
      const keys = ROUTE[ri][1];
      if (keys === null) break;
      for (const k of [...held]) if (!keys.includes(k)) { await key('keyup', k); held.delete(k); }
      for (const k of keys) if (!held.has(k)) { await key('keydown', k); held.add(k); }
      ri++;
    }
    const f = await page.evaluate((BAND) => new Promise((ok) => {
      window.__devApi.requestStep(1 / 60);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const p = window.__game.critters[0];
        const run = p.skeletal?.actions?.run;
        // Per foot: its lowest point last frame and how far its lowest
        // vertices travelled horizontally since (median). The caller keeps
        // the stillest foot on the ground: one planted foot is enough; if
        // even that one travels, the critter is skating.
        const F = window.__motionFeet;
        p.mesh.updateMatrixWorld(true);
        const v = new p.mesh.position.constructor();
        const world = (arr) => arr.map(([m, i]) => { v.fromBufferAttribute(m.geometry.attributes.position, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); return [v.x, v.y, v.z]; });
        const cur = { L: world(F.L), R: world(F.R) };
        let foot = null;
        if (F.prev && cur.L.length && cur.R.length) {
          foot = {};
          for (const side of ['L', 'R']) {
            const minY = Math.min(...F.prev[side].map((q) => q[1]));
            const d = [];
            F.prev[side].forEach((q, k) => {
              if (q[1] > minY + BAND) return;
              d.push(Math.hypot(cur[side][k][0] - q[0], cur[side][k][2] - q[2]));
            });
            d.sort((a, b) => a - b);
            foot[side] = { minY, slide: d[Math.floor(d.length / 2)] };
          }
        }
        F.prev = cur;
        ok({
          foot,
          v: Math.hypot(p.vx, p.vz), ground: p.groundSpeed ?? Math.hypot(p.vx, p.vz),
          // what is SEEN: gameplay facing + the model's turn lag
          ry: p.mesh.rotation.y + (p.visualPivot ? p.visualPivot.rotation.y : 0),
          state: p.skeletal?.getCurrentState() ?? null,
          rate: run ? run.getEffectiveTimeScale() : null,
          lean: p.glbMesh.rotation.x, sway: p.glbMesh.rotation.z,
        });
      }));
    }), FOOT_BAND);
    frames.push(f);
    if (opt.video) await page.screenshot({ path: join(dir, `f${String(step).padStart(4, '0')}.png`), clip: setup.clip });
  }
  for (const k of held) await key('keyup', k);

  const steady = frames.slice(STEADY[0], STEADY[1]);
  const vTop = median(steady.map((f) => f.v));
  // Ground actually covered: the position moves BEFORE friction, so it is
  // ×1.155 the stored |v| at 60 Hz — this is what the legs must match.
  const groundTop = median(steady.map((f) => f.ground));
  const rate = median(steady.map((f) => f.rate ?? 0));
  const gait = RUN_GAIT[setup.id];
  // 180° reversal: frames from the first change of heading until it
  // settles on the new one (1 = it snaps in a single frame).
  const r0 = frames[REVERSE_AT - 1].ry, rEnd = frames[REVERSE_AT + 45].ry;
  const turnStart = frames.findIndex((f, i) => i >= REVERSE_AT && Math.abs(f.ry - r0) > 0.05);
  const turnEnd = frames.findIndex((f, i) => i >= REVERSE_AT && Math.abs(f.ry - rEnd) < 0.05);
  // Foot slide (cm): per frame, the stillest foot among those on the
  // ground; frames with both feet in the air don't count.
  const floor = median(frames.slice(...STAND).filter((f) => f.foot)
    .map((f) => Math.min(f.foot.L.minY, f.foot.R.minY)));
  for (const f of frames) {
    const onGround = f.foot ? [f.foot.L, f.foot.R].filter((s) => s.minY < floor + FOOT_CONTACT) : [];
    f.slide = onGround.length ? Math.min(...onGround.map((s) => s.slide)) : null;
  }
  const slideCm = ([a, b], keep = () => true) => frames.slice(a, b).filter(keep).reduce((s, f) => s + (f.slide ?? 0), 0) * 100;
  const popCm = ([a, b]) => Math.max(0, ...frames.slice(a, b).map((f) => f.slide ?? 0)) * 100;
  const row = {
    critter: name,
    heightInMatch: +setup.height.toFixed(2),
    vTop: +vTop.toFixed(2),
    runRate: +rate.toFixed(2),
    cyclesPerSec: setup.runDur ? +(rate / setup.runDur).toFixed(2) : null,
    groundTop: +groundTop.toFixed(2),
    heightsPerSec: +(groundTop / setup.height).toFixed(2),
    footSlip: gait ? +(groundTop / (gait.stride * setup.scale * rate)).toFixed(2) : null,
    leanDeg: +(median(steady.map((f) => f.lean)) * 180 / Math.PI).toFixed(1),
    swayDeg: +(Math.max(...steady.map((f) => Math.abs(f.sway))) * 180 / Math.PI).toFixed(1),
    reverseFrames: turnEnd >= 0 && turnStart >= 0 ? turnEnd - turnStart + 1 : null,
    // Feet on the ground while starting / braking (a run has flight
    // frames, so these are never 0; compare before/after), what the feet
    // still travel once the body has STOPPED (should be ~0), and the
    // biggest single-frame jump in either transition (a pose pop).
    startSlideCm: Number.isFinite(floor) ? +slideCm(START_RUN).toFixed(1) : null,
    stopSlideCm: Number.isFinite(floor) ? +slideCm(STOP).toFixed(1) : null,
    stoppedSlideCm: Number.isFinite(floor) ? +slideCm(STOP, (f) => f.v < 0.01).toFixed(1) : null,
    popCm: Number.isFinite(floor) ? +Math.max(popCm([START_RUN[0], START_RUN[0] + 10]), popCm(STOP)).toFixed(1) : null,
  };
  rows.push(row);
  writeFileSync(join(OUT, `${opt.label}-${name.toLowerCase()}-frames.json`), JSON.stringify(frames));
  if (opt.video) {
    const mp4 = join(OUT, `${opt.label}-${name.toLowerCase()}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.png'),
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4]);
    rmSync(dir, { recursive: true, force: true });
    row.video = mp4;
  }
  if (!opt.json) console.error(`${name}: listo`);
}
await browser.close();

writeFileSync(join(OUT, `${opt.label}.json`), JSON.stringify(rows, null, 2));
if (opt.json) console.log(JSON.stringify(rows, null, 2));
else {
  console.table(rows.map(({ video, ...r }) => r));
  console.log('footSlip: 1 = pie apoyado · >1 planea · <1 patas más rápidas que el suelo');
  console.log('startSlideCm / stopSlideCm: pie en el suelo al arrancar / frenar (cm) · stoppedSlideCm: lo que aún se mueve con el cuerpo parado · popCm: mayor salto en un fotograma');
  console.log('JSON →', join(OUT, `${opt.label}.json`));
}
