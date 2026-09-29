// ---------------------------------------------------------------------------
// arena-sky — el cielo de cada bioma SIN navegador (fondo v2, F4)
// ---------------------------------------------------------------------------
//
// Construye el fondo de verdad (`ArenaBackdrop.buildSky`, el mismo código
// que el juego) en node y devuelve sus cifras: draws, triángulos e
// instancias por capa, rechazos del pasillo del canto, violaciones del
// contrato del pozo, `maxExtent`, hash, la luz del bioma, el color de la
// cúpula por elevación y el ΔL previsto entre el labio y el pozo. Es la
// superficie programática del cielo para agentes: en segundos y sin GPU,
// frente a los minutos de `arena-shots` por software. Lo que no puede
// decir es cómo se VE: para eso, `arena-shots --metrics`.
//
// Uso:
//   node --experimental-strip-types --no-warnings scripts/arena-sky.mjs
//        [--packs a,b] [--seeds 1,7,42] [--json]
//        [--look '{"towerCount":10}'] [--sky '{"coverage":0.3}']
//
//   --look  parche de BACKDROP_LOOK (como __devApi.setBackdropLook)
//   --sky   parche del cielo de CADA pack pedido (como __devApi.setPackSky)
//   --json  todo en JSON por stdout (para otro script o un agente)
//
// Sale con código 1 si algún bioma incumple lo que se puede comprobar sin
// imagen: violaciones del pasillo, algo fuera de la cúpula (en horizontal,
// r − 16,5 u que se mueve la cámara de victoria; en 3D, r − 16,7) o el
// abismo fuera de su techo/suelo de luma. Con 2 si la llamada está mal
// (JSON roto, semilla que no es entera, pack desconocido o una clave de
// --look/--sky rechazada): el resultado no sería el que se pidió.
//
// Carga `src/` con `scripts/arena-sky-hooks.mjs`, que resuelve los imports
// relativos sin extensión que node no resuelve solo.
// ---------------------------------------------------------------------------

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(resolve(here, 'arena-sky-hooks.mjs')).href);
const src = (f) => pathToFileURL(resolve(here, '../src', f)).href;

const { ArenaBackdrop } = await import(src('arena-backdrop.ts'));
const deco = await import(src('arena-decorations.ts'));
const { BACKDROP_LOOK, keyIntensityOf, lightDirection, LEGACY_LIGHT } = await import(src('arena-look.ts'));
const { FRAG } = await import(src('arena-fragments.ts'));

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
}
const PACKS = args.get('packs') ? String(args.get('packs')).split(',') : [...deco.ARENA_PACK_IDS];
const usage = (msg) => { console.error(`arena-sky: ${msg}`); process.exit(2); };
const SEEDS = String(args.get('seeds') ?? '1,7,42').split(',').map(Number);
if (SEEDS.some((s) => !Number.isInteger(s))) usage(`--seeds tiene que ser una lista de enteros (${args.get('seeds')})`);
const JSON_OUT = args.has('json');
const parseJson = (name) => {
  if (!args.has(name)) return null;
  try { return JSON.parse(String(args.get(name))); } catch (e) { return usage(`--${name} no es JSON válido: ${e.message}`); }
};
const LOOK = parseJson('look');
const SKY = parseJson('sky');

const warnings = [];
if (LOOK) {
  // Mismas reglas que __devApi.setBackdropLook: clave conocida y del tipo.
  for (const [k, v] of Object.entries(LOOK)) {
    if (!(k in BACKDROP_LOOK) || typeof v !== typeof BACKDROP_LOOK[k]) warnings.push(`--look: ${k} rechazado`);
    else BACKDROP_LOOK[k] = v;
  }
}
for (const p of PACKS) {
  if (!deco.ARENA_PACK_IDS.includes(p)) usage(`pack desconocido: ${p}`);
  if (SKY) {
    const r = deco.patchPackSky(p, SKY);
    if (r.rejected.length) warnings.push(`--sky ${p}: ${r.rejected.join(', ')} rechazado`);
  }
}
if (warnings.length) usage(warnings.join('; '));

/** Límites de la cúpula, DESPUÉS del parche (--look puede cambiar su
 *  radio): en horizontal, r menos lo que se desplaza la cámara de victoria
 *  (16,5 u, plan §9); en 3D, r menos su distancia al origen (16,5 y 2,5). */
const EXTENT_LIMIT = BACKDROP_LOOK.domeRadius - 16.5;
const REACH_LIMIT = BACKDROP_LOOK.domeRadius - Math.hypot(16.5, 2.5);

const hex = (c) => `0x${c.toString(16).padStart(6, '0')}`;
const luma = (c) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
/** Color de la cúpula a una elevación, interpolado en sRGB entre paradas
 *  (la cúpula interpola en lineal: esto es una lectura, no el render). */
function domeAt(stops, e) {
  if (e >= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [e1, c1] = stops[i];
    if (e >= e1) {
      const [e0, c0] = stops[i - 1];
      const k = e0 === e1 ? 0 : (e0 - e) / (e0 - e1);
      const ch = (s) => Math.round(((c0 >> s) & 255) * (1 - k) + ((c1 >> s) & 255) * k);
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    }
  }
  return stops[stops.length - 1][1];
}

const results = [];
let bad = 0;
for (const pack of PACKS) {
  const sky = deco.getPackSky(pack);
  const cliff = deco.getPackCliff(pack);
  const light = BACKDROP_LOOK.legacyLight ? LEGACY_LIGHT : sky;
  const lipLuma = luma(cliff.stops[0][1]);
  const abyssLuma = luma(sky.abyss);
  for (const seed of SEEDS) {
    const b = new ArenaBackdrop();
    b.buildSky(sky, deco.getPackFogColor(pack), cliff, seed, FRAG.maxRadius);
    const st = b.stats();
    b.dispose();
    const [corrTop, corrBottom] = st.corridorDeg;
    const pitOk = sky.pit === 'dark' ? abyssLuma <= sky.abyssCeiling : abyssLuma >= sky.abyssFloor;
    const fails = [];
    if (st.corridorViolations > 0) fails.push(`${st.corridorViolations} violaciones del pasillo`);
    if (st.maxExtent > EXTENT_LIMIT) fails.push(`maxExtent ${st.maxExtent.toFixed(1)} > ${EXTENT_LIMIT}`);
    if (st.maxReach > REACH_LIMIT) fails.push(`alcance 3D ${st.maxReach.toFixed(1)} > ${REACH_LIMIT.toFixed(1)}`);
    if (!pitOk) fails.push(`abismo ${abyssLuma.toFixed(1)} fuera del ${sky.pit === 'dark' ? 'techo' : 'suelo'} del pozo`);
    if (fails.length) bad++;
    results.push({
      pack, seed, hash: st.hash, draws: st.draws, tris: st.tris,
      layers: st.layers, rejected: st.rejected,
      isletsInFrame: st.isletsInFrame, lifeInFrame: st.lifeInFrame, toriiPath: st.toriiPath,
      drifting: st.drifting, corridorViolations: st.corridorViolations,
      corridorDeg: [+corrTop.toFixed(1), +corrBottom.toFixed(1)],
      maxExtent: +st.maxExtent.toFixed(1), maxReach: +st.maxReach.toFixed(1), buildMs: +st.buildMs.toFixed(1),
      light: {
        legacy: BACKDROP_LOOK.legacyLight,
        keyDir: lightDirection(light.keyAzimuthDeg, light.keyElevationDeg).map((v) => +v.toFixed(3)),
        keyIntensity: +keyIntensityOf(light).toFixed(3),
        keyColor: hex(light.keyColor),
      },
      dome: Object.fromEntries([90, 45, 12, 0, -16, Math.round(corrTop), -45, Math.round(corrBottom), -90]
        .map((e) => [e, hex(domeAt(st.domeStops, e))])),
      // ΔL previsto del canto: el labio (la parada t=0 de su rampa) contra
      // el abismo, que es lo que pinta la cúpula detrás de él. Es una cota:
      // la captura mide el suelo de verdad, con su textura y su luz.
      predicted: { pit: sky.pit, lipLuma: +lipLuma.toFixed(1), abyssLuma: +abyssLuma.toFixed(1), deltaL: +Math.abs(lipLuma - abyssLuma).toFixed(1) },
      fails,
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const r of results) {
    const L = r.layers;
    console.log(`${r.pack.padEnd(15)} s${String(r.seed).padEnd(3)} ${r.hash} · ${r.draws} draws · ${(r.tris / 1000).toFixed(1)}k tris`
      + ` · nubes ${(L.near?.instances ?? 0)}+${(L.wisps?.instances ?? 0)} (deriva ${r.drifting}) · torres ${L.towers?.instances ?? 0}`
      + ` · vida ${L.life?.instances ?? 0} (${r.lifeInFrame} en cuadro) · islotes en cuadro ${r.isletsInFrame}`
      + ` · pasillo ${r.corridorViolations} · extent ${r.maxExtent} (3D ${r.maxReach}) · ΔL previsto ${r.predicted.deltaL}`
      + ` · key ×${r.light.keyIntensity} · ${r.buildMs} ms${r.fails.length ? `  ✗ ${r.fails.join('; ')}` : ''}`);
  }
  console.log(bad ? `\n${bad} construcciones incumplen el contrato.` : `\nTodo en contrato (${results.length} construcciones).`);
}
process.exit(bad ? 1 : 0);
