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
//                                [--viewport 1280x720]
//                                [--pose game,victory,wide,defeat,low]
//                                [--backdrop sky|sea] [--scatter 0]
//                                [--no-hud] [--metrics]
//                                [--critters A,B,C,D] [--sky-patch '{json}']
//
// Fondo v2 (docs/DIORAMAS.md §«Fondo v2», §12):
//   --pose      una o varias poses por pack. Las de fin de partida replican
//               las fórmulas de game.ts con el bicho en el centro; `low` es
//               la cámara baja de las hojas del cono (src/camera.ts).
//   --backdrop  A/B del fondo: `sky` (la isla en el cielo) o `sea` (el mar
//               con la foto de antes).
//   --scatter 0 quita la capa densa del diorama para juzgar solo el fondo.
//   --no-hud    captura solo el canvas (hojas de contactos).
//   --metrics   ΔL del canto y jerarquía fondo/arena en la pose de juego,
//               a un .json junto a los PNG (scripts/lib/arena-metrics.mjs).
//               Mide el FONDO: su captura va sin HUD, sin scatter y sin
//               props (los oculta solo para ella y los devuelve).
//   --critters  jugador y tres bots (por defecto Sergei, Trunk, Kurama,
//               Shelly): el A/B del roster necesita a los nueve.
//   --sky-patch parche del cielo de cada pack antes de empezar
//               (__devApi.setPackSky), p. ej. el pozo claro de la decisión 2.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launchMutedBrowser, muteGameAudio } from './lib/headless-browser.mjs';
import { measureBackdrop } from './lib/arena-metrics.mjs';

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
const POSES = String(args.get('pose') ?? 'game').split(',');
const BACKDROP = args.get('backdrop');
const SCATTER = args.has('scatter') ? Number(args.get('scatter')) : null;
const NO_HUD = args.has('no-hud');
const METRICS = args.has('metrics');
const CRITTERS = String(args.get('critters') ?? 'Sergei,Trunk,Kurama,Shelly').split(',');
const SKY_PATCH = args.has('sky-patch') ? JSON.parse(String(args.get('sky-patch'))) : null;
const HIDE_HUD_CSS = 'body > *:not(canvas) { visibility: hidden !important; }';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await launchMutedBrowser();
// --viewport WxH: 1280x720 es el caso MAS FAVORABLE (a mas resolucion, la
// panoramica se amplia mas). Los sets utiles son 1280x720, 1920x1080 y
// 390x844 (movil retrato), que es donde peor se porta todo.
const [VW, VH] = String(args.get('viewport') ?? '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: VW || 1280, height: VH || 720 } });
await muteGameAudio(page);   // silencio también dentro del juego (directiva de Rafa)
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto(`${URL}/tools.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__devApi, null, { timeout: 30000 });
// El panel del lab tapa un tercio del encuadre: fuera para las capturas.
await page.addStyleTag({ content: '#lab-sidebar { display: none !important; }' });

if (BACKDROP) {
  const r = await page.evaluate((mode) => window.__devApi.setBackdropLook({ mode }), BACKDROP);
  if (r.rejected.length) console.warn(`  --backdrop ${BACKDROP}: rechazado (${r.rejected})`);
}
const allMetrics = {};

for (const pack of PACKS) {
  await page.evaluate(() => { window.__shotHist = []; });
  if (SKY_PATCH) {
    const r = await page.evaluate(([p, patch]) => window.__devApi.setPackSky(p, patch), [pack, SKY_PATCH]);
    if (r.rejected.length) console.warn(`  ${pack}: --sky-patch rechazado (${r.rejected})`);
  }
  await page.evaluate(([p, s, c]) => {
    window.__devApi.startMatch(c[0], c.slice(1), { seed: s, packId: p });
  }, [pack, SEED, CRITTERS]);
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
  //
  // 2026-09-21: con varios packs y --at-seconds, del segundo pack en
  // adelante las capturas salían en la cuenta atrás (disco entero) con el
  // reloj marcando el t pedido. El HUD NO reinicia el reloj al empezar la
  // cuenta atrás de una partida nueva: sigue enseñando el de la anterior
  // hasta que la fase pasa a `playing`. Así que el reloj solo vale como
  // medida EN `playing`; antes se mira la fase.
  const fresh = await page.waitForFunction(() => window.__game?.phase === 'countdown', null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  if (!fresh) console.warn(`  ${pack}: la partida nueva no llega a la cuenta atrás`);
  if (AT > 0) {
    await page.evaluate(() => window.__devApi.setFixedStep(20));
    const ok = await page.waitForFunction((target) => {
      if (window.__game?.phase !== 'playing') return false;
      const el = document.getElementById('hud-timer');
      const m = el?.textContent?.match(/(\d+):(\d\d)/);
      if (!m) return false;
      const left = Number(m[1]) * 60 + Number(m[2]);
      return (120 - left) >= target;
    }, AT, { timeout: 60000 }).then(() => true).catch(() => false);
    await page.evaluate(() => window.__devApi.setFixedStep(null));
    if (!ok) console.warn(`  ${pack}: no se alcanzó t=${AT}s`);
  }
  // Congelado: varias poses del MISMO instante, y nada cae entre ellas.
  await page.evaluate(() => window.__devApi.setSpeed(0));
  if (SCATTER !== null) await page.evaluate((d) => window.__devApi.setScatterDensity(d), SCATTER);
  for (const pose of POSES) {
    await page.evaluate((p) => window.__devApi.setCameraPose(p), pose);
    await sleep(700);
    const suffix = `${AT > 0 ? `_t${AT}` : ''}${pose !== 'game' ? `_${pose}` : ''}${VW !== 1280 ? `_${VW}x${VH}` : ''}`;
    const file = `${OUT}/${pack}${suffix}.png`;
    const hud = NO_HUD ? await page.addStyleTag({ content: HIDE_HUD_CSS }) : null;
    await page.screenshot({ path: file });
    if (METRICS && pose === 'game') {
      // La métrica siempre sin HUD: la cuenta atrás y los paneles contarían
      // como fondo.
      const tmp = hud ?? await page.addStyleTag({ content: HIDE_HUD_CSS });
      // Y sin el decorado de ENCIMA del disco: la métrica es el contrato del
      // FONDO. Los props (palmeras, ruinas) y el fleco del scatter asoman por
      // el labio y contaban como "fondo claro" o hundían el mínimo del canto
      // (jungle daba 8,2 % solo por las palmeras). Los props cuelgan de los
      // fragmentos sin `groundRole`; el scatter son los InstancedMesh que
      // cuelgan (a través de su grupo) de arena.group. Todo vuelve justo después de la captura.
      await page.evaluate(() => {
        const hidden = [];
        const hide = (c) => { if (c.visible) { c.visible = false; hidden.push(c); } };
        for (const g of window.__game.arena.fragmentGroups ?? []) {
          for (const c of g.children) if (!c.userData?.groundRole) hide(c);
        }
        window.__game.arena.group.traverse((c) => { if (c.isInstancedMesh) hide(c); });
        window.__metricsHidden = hidden;
      });
      await sleep(300);
      const png = await page.screenshot();
      await page.evaluate(() => { for (const c of window.__metricsHidden ?? []) c.visible = true; });
      if (!hud) await tmp.evaluate((el) => el.remove());
      const { fragments, falling } = await page.evaluate(() => {
        const arena = window.__game.arena;
        const layout = arena.getLayout();
        const alive = new Set(arena.getAliveFragmentsInDisc(0, 0, 1e3));
        const shape = (f) => ({
          innerR: f.innerR, outerR: f.outerR, startAngle: f.startAngle, endAngle: f.endAngle, immune: !!f.immune,
        });
        // getAliveFragmentsInDisc es de knock-out y salta el centro inmune a
        // propósito; aquí hace falta, o el labio pierde los azimuts donde
        // solo queda el centro.
        return {
          fragments: layout.fragments.filter((f, i) => f.immune || alive.has(i)).map(shape),
          // Privado en TS, legible en tiempo de ejecución: los sectores que
          // aún están cayendo (se excluyen de la métrica del canto).
          falling: (arena.fallingFragments ?? []).map((ff) => shape(layout.fragments[ff.idx])),
        };
      });
      const m = await measureBackdrop(png, fragments, falling);
      const stats = await page.evaluate(() => window.__devApi.getBackdropStats());
      allMetrics[`${pack}${suffix}`] = { ...m, backdrop: stats && {
        mode: stats.mode, draws: stats.draws, tris: stats.tris, corridorViolations: stats.corridorViolations,
        isletsInFrame: stats.isletsInFrame, maxExtent: Math.round(stats.maxExtent),
        buildMs: Math.round(stats.buildMs * 10) / 10, hash: stats.hash,
      } };
      console.log(`  ${pack.padEnd(16)} ΔL canto mediana ${m.lip.median} · p10 ${m.lip.p10} · min ${m.lip.min} (${m.lip.azimuths} az, ${m.lip.fallingSkipped} cayendo) · fondo ${m.bgMean} / arena ${m.arenaMean} · fondo>p75 ${m.bgAboveArenaP75} %`);
    }
    if (hud) await hud.evaluate((el) => el.remove());
    console.log(`  ${pack.padEnd(16)} → ${file}`);
  }
  await page.evaluate(() => { window.__devApi.setCameraPose(null); window.__devApi.setSpeed(1); });
}
if (METRICS) {
  const file = `${OUT}/metrics${AT > 0 ? `_t${AT}` : ''}${VW !== 1280 ? `_${VW}x${VH}` : ''}.json`;
  // Se ACUMULA con lo que ya hubiera: lanzar bioma a bioma (un navegador
  // por bioma, ver docs/carriles/arena.md) no debe pisar las cifras.
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  writeFileSync(file, JSON.stringify({ ...prev, ...allMetrics }, null, 2));
  console.log(`\nmétricas → ${file}`);
}
console.log(errors.length ? `\nERRORES: ${errors.slice(0, 5).join(' | ')}` : '\nsin errores de consola');
await browser.close();
