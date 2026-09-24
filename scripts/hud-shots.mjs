// ---------------------------------------------------------------------------
// Hoja y medidas del HUD por viewport (carril INTERFAZ)
// ---------------------------------------------------------------------------
//
// La superficie programática del trabajo de HUD: un agente cambia CSS, corre
// esto y MIDE en vez de mirar a ojo. Por cada viewport (móviles en apaisado
// con toque y DPR 2, tablet y escritorio) captura título, selección y
// partida, y escribe report.json con:
//   · touchMode      — si el juego arrancó con joystick (src/input.ts)
//   · arenaCoveredPct — % del disco de la arena, proyectado con la cámara de
//                      juego (camera.ts), que tapa el HUD: la regla del
//                      carril es que la lectura del borde manda
//   · coveredBy      — ese % por pieza del HUD
//   · overlaps       — solapes entre piezas del HUD
//   · selectOverflow — alto del contenido de la selección vs pantalla
//
// Uso (con el dev server vivo):
//   node scripts/hud-shots.mjs [--out .tmp/hud-shots] [--url http://localhost:5173]
//                              [--viewports 667x375,844x390,1280x720]
//
// Navegador mudo (directiva de Rafa) y con GPU: por software, cada captura
// tarda ~18 s (ver reference de operar desde worktree).
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { launchMutedBrowser, muteGameAudio } from './lib/headless-browser.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
}
const OUT = args.get('out') ?? '.tmp/hud-shots';
const BASE = args.get('url') ?? 'http://localhost:5173';
const DEFAULT_VIEWPORTS = '667x375,740x360,844x390,915x412,932x430,1024x768,1280x720';
// Todo lo < 1280 de ancho se emula como dispositivo táctil (móvil/tablet).
const VIEWPORTS = String(args.get('viewports') ?? DEFAULT_VIEWPORTS).split(',').map((vp) => {
  const [w, h] = vp.split('x').map(Number);
  return { name: vp, w, h, touch: w < 1280 };
});
mkdirSync(OUT, { recursive: true });

const browser = await launchMutedBrowser({
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

const report = [];
for (const { name, w, h, touch } of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch,
  });
  await muteGameAudio(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  await page.goto(BASE + '/?portal=0', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-1-title.png` });

  await page.keyboard.press('Enter');
  await page.locator('#character-select').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}-2-select.png` });
  const selectOverflow = await page.evaluate(() => {
    const el = document.getElementById('character-select');
    return { contentH: el.scrollHeight, viewportH: innerHeight };
  });

  await page.keyboard.press('Space');
  // En táctil la barra de habilidades está oculta: esperar a que exista, no a que se vea.
  await page.locator('#ability-bar-container .ability-slot').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-3-match.png` });

  const m = await page.evaluate(async () => {
    const { createCamera } = await import('/src/camera.ts');
    const vw = innerWidth, vh = innerHeight;
    const pick = {
      'top-center': '#hud-top-center', 'settings': '#hud-settings',
      'life-tl': '#player-life-0', 'life-tr': '#player-life-1', 'life-bl': '#player-life-2', 'life-br': '#player-life-3',
      'abilities': '#ability-bar-container', 'joystick': '#touch-joystick', 'actions': '#touch-actions',
    };
    const rects = {};
    for (const [k, sel] of Object.entries(pick)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      rects[k] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
    // Borde de la arena proyectado con la cámara de juego (camera.ts es la fuente única).
    const R = window.__game.arena?.currentRadius ?? 12;
    const cam = createCamera();
    cam.updateMatrixWorld();
    const V = cam.position.constructor;
    const poly = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const v = new V(Math.cos(a) * R, 0, Math.sin(a) * R).project(cam);
      poly.push([(v.x + 1) / 2 * vw, (1 - v.y) / 2 * vh]);
    }
    const inPoly = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const STEP = 4;
    let arenaPts = 0, arenaCovered = 0;
    const coveredBy = {};
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y += STEP) {
      for (let x = Math.min(...xs); x < Math.max(...xs); x += STEP) {
        if (!inPoly(x, y) || x < 0 || y < 0 || x > vw || y > vh) continue;
        arenaPts++;
        let hit = false;
        for (const [k, r] of Object.entries(rects)) {
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { coveredBy[k] = (coveredBy[k] ?? 0) + 1; hit = true; }
        }
        if (hit) arenaCovered++;
      }
    }
    const keys = Object.keys(rects), overlaps = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = rects[keys[i]], b = rects[keys[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) overlaps.push(`${keys[i]}×${keys[j]} ${ox}×${oy}px`);
    }
    const pct = (n) => (arenaPts ? +(100 * n / arenaPts).toFixed(1) : null);
    return {
      touchMode: document.body.classList.contains('touch-mode'),
      arenaCoveredPct: pct(arenaCovered),
      coveredBy: Object.fromEntries(Object.entries(coveredBy).map(([k, n]) => [k, pct(n)])),
      overlaps, rects,
    };
  });
  report.push({ name, ...m, selectOverflow, errors });
  console.log(`${name.padEnd(10)} touch=${m.touchMode} arena tapada ${m.arenaCoveredPct}% · selección ${selectOverflow.contentH}/${selectOverflow.viewportH} px · solapes: ${m.overlaps.join(', ') || '—'}${errors.length ? ' · ERRORES ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`[hud-shots] ${report.length} viewports → ${OUT}`);
