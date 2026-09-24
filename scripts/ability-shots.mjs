#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ability-shots — each critter's J / K / L, filmed and measured
// ---------------------------------------------------------------------------
//
// For reviewing abilities on evidence instead of memory. In a real match in
// the /tools.html lab, the critter stands on the left facing +x with three
// idle dummies in front: NEAR (1.8 u ahead), FAR (4.2 u ahead) and SIDE
// (1.4 u ahead, 2.4 u off the line — clear of NEAR even for the two big
// ones). It fires one ability, and the sim runs
// in steps of exactly 1/60 s, so the physics behaves as at 60 Hz however
// slow the headless renderer is.
//
// Per ability it writes:
//   - <out>/<critter>-<slot>.png: a contact sheet, one frame every
//     --every steps, game camera;
//   - <out>/<critter>-<slot>.mp4 with --video (60 fps);
//   - a row in <out>/ability-shots.json: the ability's wind-up and active
//     window, where the caster ended up, and per dummy the peak knockback
//     speed, its direction, how far it was pushed, whether it fell, and
//     which statuses it got (stun / slow / confused / ...).
//
// Usage (dev server running):
//   node scripts/ability-shots.mjs                                  # 9 critters × J,K,L
//   node scripts/ability-shots.mjs --critters=Trunk --slots=K --video
//   node scripts/ability-shots.mjs --url=http://localhost:5181 --json
//
// Options: --url (def http://localhost:5173) · --critters=A,B · --slots=J,K,L
// · --steps (def 150 = 2.5 s) · --every (def 6) · --pack (def
// kitsune_shrine) · --out (def .tmp/ability-shots) · --video · --json.
// Sebastian's L is hold-to-fire: it's held --hold steps (def 45) before the
// release. The browser is muted like every test instance.
// ---------------------------------------------------------------------------

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchMutedBrowser, newMutedPage } from './lib/headless-browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ALL = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'];
const KEY = { J: 'KeyJ', K: 'KeyK', L: 'KeyL' };
const SLOT_INDEX = { J: 0, K: 1, L: 2 };
const CASTER = { x: -2.6, z: 1.2 };
// Dummies relative to the caster, facing +x.
const DUMMIES = [
  { tag: 'near', dx: 1.8, dz: 0 },
  { tag: 'far', dx: 4.2, dz: 0 },
  { tag: 'side', dx: 1.4, dz: 2.4 },
];
const FRAME = { x0: -4.6, x1: 3.4, z0: -1.2, z1: 3.8, yTop: 2.6 };
const FIRE_AT = 6;     // steps of calm before the key goes down

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    critters: { type: 'string', default: ALL.join(',') },
    slots: { type: 'string', default: 'J,K,L' },
    steps: { type: 'string', default: '150' },
    every: { type: 'string', default: '6' },
    hold: { type: 'string', default: '45' },
    pack: { type: 'string', default: 'kitsune_shrine' },
    out: { type: 'string', default: '.tmp/ability-shots' },
    video: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});
const STEPS = Number(opt.steps);
const EVERY = Number(opt.every);
const OUT = resolve(ROOT, opt.out);
mkdirSync(OUT, { recursive: true });

const browser = await launchMutedBrowser({ channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await newMutedPage(browser, { viewport: { width: 2400, height: 1540 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(new URL('/tools.html', opt.url).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__devApi) && Boolean(window.__game), null, { timeout: 60000 });
const key = (type, code) => page.evaluate(({ type, code }) => window.dispatchEvent(new KeyboardEvent(type, { code })), { type, code });

const rows = [];
for (const name of opt.critters.split(',')) {
  const dummies = ALL.filter((n) => n !== name).slice(0, 3);
  for (const slot of opt.slots.split(',')) {
    await page.evaluate(() => { window.__devApi.setFixedStep(null); window.__devApi.setSpeed(1); });
    await page.evaluate(({ name, dummies, pack }) => window.__devApi.startMatch(name, dummies, { seed: 501, packId: pack }), { name, dummies, pack: opt.pack });
    await page.waitForFunction(() => window.__game.phase === 'playing' && window.__game.critters.every((c) => c.glbMesh), null, { timeout: 120000 });
    // Let the «¡YA!» banner clear before the clock freezes.
    await page.waitForTimeout(1500);

    const setup = await page.evaluate(async ({ CASTER, DUMMIES, FRAME, idx }) => {
      const api = window.__devApi; const g = window.__game;
      api.setSpeed(0);
      api.setAllBotsBehaviour('idle');
      api.resetPlayerCooldowns();
      // The warm-up at speed 1 is a live match: a bot may have grabbed or
      // confused someone, and a stunned caster can't fire (since the
      // 2026-09-24 stun rule). Every take starts clean.
      for (const c of g.critters) { c.stunTimer = 0; c.confusedTimer = 0; c.slowTimer = 0; }
      // Idle stops new casts, not one in flight: a dummy's Slam or Grip
      // started in the warm-up used to land on the take and stun the near
      // dummy (every Kurama take). Same fields as cancelAbility.
      for (const b of g.critters.slice(1)) {
        for (const s of b.abilityStates) if (s.active) { s.active = false; s.windUpLeft = 0; s.durationLeft = 0; }
      }
      const p = g.critters[0];
      p.x = CASTER.x; p.z = CASTER.z; p.vx = 0; p.vz = 0; p.mesh.rotation.y = Math.PI / 2;
      p.visualYawLag = 0; p.lastFacingY = Number.NaN; p.immunityTimer = 0;
      DUMMIES.forEach((d, i) => {
        const b = g.critters[i + 1];
        b.x = CASTER.x + d.dx; b.z = CASTER.z + d.dz; b.vx = 0; b.vz = 0;
        b.mesh.rotation.y = -Math.PI / 2; b.immunityTimer = 0;
        b.visualYawLag = 0; b.lastFacingY = Number.NaN;
      });
      const st = p.abilityStates[idx];
      const V = p.mesh.position.constructor;
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
      return {
        ability: st ? { name: st.def.name, type: st.def.type, cooldown: st.def.cooldown, windUp: st.def.windUp ?? 0, duration: st.def.duration ?? 0, holdToFire: !!st.def.holdToFireL } : null,
        dummyNames: g.critters.slice(1, 4).map((c) => c.config.name),
        clip: { x: Math.round(x0), y: Math.round(y0), width: Math.round((x1 - x0) / 2) * 2, height: Math.round((y1 - y0) / 2) * 2 },
      };
    }, { CASTER, DUMMIES, FRAME, idx: SLOT_INDEX[slot] });
    if (!setup.ability) { console.error(`${name} ${slot}: sin habilidad`); continue; }

    const dir = join(OUT, `${name.toLowerCase()}-${slot}`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const releaseAt = FIRE_AT + (setup.ability.holdToFire ? Number(opt.hold) : 3);
    const log = [];
    for (let step = 0; step < STEPS; step++) {
      if (step === FIRE_AT) await key('keydown', KEY[slot]);
      if (step === releaseAt) await key('keyup', KEY[slot]);
      const s = await page.evaluate((idx) => new Promise((ok) => {
        window.__devApi.requestStep(1 / 60);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const g = window.__game; const p = g.critters[0]; const st = p.abilityStates[idx];
          ok({
            caster: { x: p.x, z: p.z, v: Math.hypot(p.vx, p.vz), active: !!st?.active, windUp: st?.windUpLeft ?? 0, clip: p.skeletal?.getCurrentState() ?? null },
            dummies: g.critters.slice(1, 4).map((b) => ({
              x: b.x, z: b.z, vx: b.vx, vz: b.vz, alive: b.alive, falling: b.falling,
              stun: b.stunTimer, slow: b.slowTimer, confused: b.confusedTimer, invis: b.invisibilityTimer,
            })),
          });
        }));
      }), SLOT_INDEX[slot]);
      log.push(s);
      await page.screenshot({ path: join(dir, `f${String(step).padStart(4, '0')}.png`), clip: setup.clip });
    }

    // Summary: ability window, caster travel, and what each dummy got.
    const activeSteps = log.map((s, i) => (s.caster.active ? i : -1)).filter((i) => i >= 0);
    const windUpSteps = log.filter((s) => s.caster.active && s.caster.windUp > 0).length;
    const summary = {
      critter: name, slot, ability: setup.ability.name, type: setup.ability.type,
      cooldown: setup.ability.cooldown,
      activeFrom: activeSteps.length ? activeSteps[0] - FIRE_AT : null,
      activeFrames: activeSteps.length, windUpFrames: windUpSteps,
      casterTravel: +Math.hypot(log.at(-1).caster.x - log[0].caster.x, log.at(-1).caster.z - log[0].caster.z).toFixed(2),
      casterPeakSpeed: +Math.max(...log.map((s) => s.caster.v)).toFixed(1),
      clips: [...new Set(log.map((s) => s.caster.clip))].join('>'),
      dummies: DUMMIES.map((d, i) => {
        const tr = log.map((s) => s.dummies[i]);
        let peak = 0, peakDir = null, hitAt = null;
        tr.forEach((q, k) => {
          if (k < FIRE_AT) return; // only what the ability did
          const sp = Math.hypot(q.vx, q.vz);
          if (sp > peak) { peak = sp; peakDir = Math.round(Math.atan2(q.vz, q.vx) * 180 / Math.PI); }
          if (hitAt === null && sp > 0.5) hitAt = k - FIRE_AT;
        });
        const status = ['stun', 'slow', 'confused', 'invis'].filter((k) => tr.some((q) => q[k] > 0));
        return {
          tag: d.tag, name: setup.dummyNames[i],
          hitAtFrame: hitAt, peakSpeed: +peak.toFixed(1), peakDirDeg: peakDir,
          pushed: +Math.hypot(tr.at(-1).x - tr[0].x, tr.at(-1).z - tr[0].z).toFixed(2),
          fell: tr.some((q) => q.falling || !q.alive),
          status,
        };
      }),
    };
    rows.push(summary);

    const sheet = join(OUT, `${name.toLowerCase()}-${slot}.png`);
    const tiles = Math.ceil(STEPS / EVERY);
    const cols = 5;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'f%04d.png'),
      // Each tile is labelled with its step since the key went down.
      '-vf', `select='not(mod(n\\,${EVERY}))',scale=480:-2,drawtext=text='%{eif\\:n*${EVERY}-${FIRE_AT}\\:d}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5,tile=${cols}x${Math.ceil(tiles / cols)}`,
      '-frames:v', '1', sheet]);
    if (opt.video) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.png'),
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(OUT, `${name.toLowerCase()}-${slot}.mp4`)]);
    }
    rmSync(dir, { recursive: true, force: true });
    if (!opt.json) console.error(`${name} ${slot} (${setup.ability.name}): listo`);
  }
}
await browser.close();

writeFileSync(join(OUT, 'ability-shots.json'), JSON.stringify(rows, null, 2));
if (opt.json) console.log(JSON.stringify(rows, null, 2));
else {
  for (const r of rows) {
    console.log(`${r.critter.padEnd(10)} ${r.slot} ${r.ability.padEnd(18)} activa ${r.activeFrames}f (wind-up ${r.windUpFrames}f) · se mueve ${r.casterTravel} u · ` +
      r.dummies.map((d) => {
        // A grab or a trap moves or statuses the dummy without speed.
        const touched = d.hitAtFrame !== null || d.status.length > 0 || d.pushed > 0.1 || d.fell;
        if (!touched) return `${d.tag}: —`;
        const hit = d.hitAtFrame === null ? '' : `f${d.hitAtFrame} ${d.peakSpeed}u/s ${d.peakDirDeg}° `;
        return `${d.tag}: ${hit}${d.pushed}u${d.fell ? ' CAE' : ''}${d.status.length ? ' [' + d.status.join(',') + ']' : ''}`;
      }).join(' · '));
  }
  console.log('Hojas y JSON →', OUT);
}
