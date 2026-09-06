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
  await page.evaluate(() => { window.__shotHist = []; });
  await page.evaluate(([p, s]) => {
    window.__devApi.startMatch('Sergei', ['Trunk', 'Kurama', 'Shelly'], { seed: s, packId: p });
  }, [pack, SEED]);
  // Esperar a que el pack termine de poblar la escena: los GLB de decor
  // llegan bastante después que el suelo (16 props en jungle tardan ~6 s
  // en local). Se espera a que el recuento de meshes se ESTABILICE en vez
  // de a un sleep a ojo, que es lo que dejaba las capturas sin props.
  // Espera a que la escena se ESTABILICE: tres lecturas iguales seguidas,
  // no dos. Con dos, el recuento del suelo (que llega antes que los props)
  // se repetía y el script disparaba la foto con la arena aún vacía — así
  // salieron las capturas de jungle sin un solo árbol.
  await page.waitForFunction(() => {
    const g = window.__game?.arena?.group;
    if (!g) return false;
    let n = 0; g.traverse((o) => { if (o.isMesh) n++; });
    const hist = (window.__shotHist ??= []);
    hist.push(n);
    if (hist.length > 3) hist.shift();
    return hist.length === 3 && hist[0] === hist[1] && hist[1] === hist[2];
  }, null, { timeout: 25000, polling: 1000 }).catch(() => console.warn(`  ${pack}: la escena no se estabilizó`));
  // Saltar la cuenta atrás y avanzar hasta el instante pedido.
  //
  // 2026-09-07: esta espera estaba ROTA y contaminó todas las capturas
  // anteriores. Preguntaba por `__devApi.snapshot()`, que NO EXISTE (la
  // superficie pública es getArenaInfo/getPerf/getPlayerSnapshot...), y
  // el `?? 0` hacía que la condición no se cumpliera nunca: el
  // waitForFunction agotaba sus 60 s CON EL JUEGO A 20x y el `.catch`
  // mudo se lo tragaba. Resultado: cada captura salía a ~52 s de partida,
  // con un jugador eliminado y el 95 % del decor ya caído — y sobre esas
  // imágenes se juzgó el diorama. Ahora se lee el reloj del HUD, que es
  // lo que ve el jugador, y si falla se dice en voz alta.
  const readClock = () => {
    const el = document.getElementById('hud-timer');
    const m = el?.textContent?.match(/(\d+):(\d\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  await page.waitForFunction(readClock, null, { timeout: 20000 })
    .catch(() => { console.warn(`  ${pack}: no aparece el reloj del HUD`); });
  if (AT > 0) {
    await page.evaluate(() => window.__devApi.setFixedStep(20));
    const ok = await page.waitForFunction((target) => {
      const el = document.getElementById('hud-timer');
      const m = el?.textContent?.match(/(\d+):(\d\d)/);
      if (!m) return false;
      const left = Number(m[1]) * 60 + Number(m[2]);
      return (120 - left) >= target;
    }, AT, { timeout: 60000 }).then(() => true).catch(() => false);
    await page.evaluate(() => window.__devApi.setFixedStep(null));
    if (!ok) console.warn(`  ${pack}: no se alcanzó t=${AT}s`);
  }
  await sleep(700);
  const file = `${OUT}/${pack}${AT > 0 ? `_t${AT}` : ''}${VW !== 1280 ? `_${VW}x${VH}` : ''}.png`;
  await page.screenshot({ path: file });
  console.log(`  ${pack.padEnd(16)} → ${file}`);
}
console.log(errors.length ? `\nERRORES: ${errors.slice(0, 5).join(' | ')}` : '\nsin errores de consola');
await browser.close();
