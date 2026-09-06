// ---------------------------------------------------------------------------
// Hoja de contactos de las arenas (terreno v2 — docs/ARENA_V2.md fase 1)
// ---------------------------------------------------------------------------
//
// Captura los 5 packs con la cámara de juego para poder comparar el look
// antes/después de un cambio visual SIN abrir el navegador a mano. Es la
// superficie programática del trabajo de arte: un agente cambia
// ARENA_LOOK, corre esto y MIRA el resultado.
//
// Uso (con el dev server vivo):
//   node scripts/arena-shots.mjs [--out .tmp/shots] [--seed 1]
//                                [--at-seconds 0] [--packs a,b]
// ---------------------------------------------------------------------------

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
}
const OUT = args.get('out') ?? '.tmp/shots';
const SEED = Number(args.get('seed') ?? 1);
const AT = Number(args.get('at-seconds') ?? 0);
const URL = args.get('url') ?? 'http://localhost:5173';
const ALL = ['jungle', 'frozen_tundra', 'desert_dunes', 'coral_beach', 'kitsune_shrine'];
const PACKS = args.get('packs') ? String(args.get('packs')).split(',') : ALL;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
// --viewport WxH: 1280x720 es el caso MAS FAVORABLE (a mas resolucion, la
// panoramica se amplia mas). Los sets utiles son 1280x720, 1920x1080 y
// 390x844 (movil retrato), que es donde peor se porta todo.
const [VW, VH] = String(args.get('viewport') ?? '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: VW || 1280, height: VH || 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto(`${URL}/tools.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__devApi, null, { timeout: 30000 });
// El panel del lab tapa un tercio del encuadre: fuera para las capturas.
await page.addStyleTag({ content: '#lab-sidebar { display: none !important; }' });

for (const pack of PACKS) {
  await page.evaluate(([p, s]) => {
    window.__devApi.startMatch('Sergei', ['Trunk', 'Kurama', 'Shelly'], { seed: s, packId: p });
  }, [pack, SEED]);
  // Esperar a que el pack termine de poblar la escena: los GLB de decor
  // llegan bastante después que el suelo (16 props en jungle tardan ~6 s
  // en local). Se espera a que el recuento de meshes se ESTABILICE en vez
  // de a un sleep a ojo, que es lo que dejaba las capturas sin props.
  await page.waitForFunction(() => {
    const g = window.__game?.arena?.group;
    if (!g) return false;
    let n = 0; g.traverse((o) => { if (o.isMesh) n++; });
    const prev = window.__shotMeshes ?? -1;
    window.__shotMeshes = n;
    return n > 0 && n === prev;
  }, null, { timeout: 20000, polling: 1200 }).catch(() => {});
  // Saltar la cuenta atrás (el "3" gigante tapa el centro del disco) y
  // avanzar hasta el instante pedido.
  await page.evaluate(() => window.__devApi.setFixedStep(20));
  await page.waitForFunction((t) => (window.__devApi.snapshot?.()?.matchTime ?? 0) >= t,
    Math.max(AT, 1.5), { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => window.__devApi.setFixedStep(null));
  await sleep(700);
  const file = `${OUT}/${pack}${AT > 0 ? `_t${AT}` : ''}${VW !== 1280 ? `_${VW}x${VH}` : ''}.png`;
  await page.screenshot({ path: file });
  console.log(`  ${pack.padEnd(16)} → ${file}`);
}
console.log(errors.length ? `\nERRORES: ${errors.slice(0, 5).join(' | ')}` : '\nsin errores de consola');
await browser.close();
