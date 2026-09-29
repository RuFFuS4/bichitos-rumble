// ---------------------------------------------------------------------------
// check-payload-budget — falla el build si dist/ engorda por encima del
// presupuesto del hito H2
// ---------------------------------------------------------------------------
//
// Por qué existe: el modo de fallo "un asset de 50 MB aterriza en el
// deploy sin que nadie lo note" ya ocurrió DOS veces (kermit.glb crudo
// de 75 MB; tree_jungle_broadleaf.glb muerto de 52 MB = 22 % del dist).
// Este assert corre al final de `npm run check` (y por tanto en CI):
// imprime el top-10 de contribuyentes y revienta si se supera el
// presupuesto.
//
// RATCHET del hito H2 (bajar el número al cerrar cada slice, nunca
// subirlo sin decisión explícita en el ROADMAP):
//   slice 1 (quick-wins):    TOTAL 135 MB  (medido ~130 tras el slice)
//   slice 2 (imágenes WebP): ~115 MB
//   slice 3 (GLB meshopt):   ~90 MB
//   objetivo de cierre H2:   ≤ 50 MB inicial-viable (ver ROADMAP §H2)
//   2026-08-24 dieta:        75 MB (medido 69,7)
//   2026-09-24 dieta F2:     30 MB (medido 27,4) — objetivo H2 superado
// El límite per-file protege contra el regreso de un asset gordo
// individual: hoy el mayor pesa 1,4 MB (una palmera de coral_beach) y
// los nueve GLB de bicho suman ~3,9 MB. Un asset nuevo entra ya dietado
// (ASSET_PIPELINE.md §«Recetas post-import») o no entra: quien quiera
// más margen lo pide al carril DISTRIBUCIÓN (docs/carriles/distribucion.md).
//
// H5 (docs/H5_CRAZYGAMES.md), sobre el mismo recorrido:
//   - como mucho 1500 ficheros, el tope de CrazyGames;
//   - la build web (la de siempre) no puede llevar el SDK de CrazyGames
//     (sdk.crazygames.com): fuera de sus dominios espera 7 s antes de
//     rendirse;
//   - con --crazygames (scripts/build-crazygames.mjs, que pasa su carpeta):
//     ninguna ruta absoluta a la raíz (CG sirve el juego bajo una subruta
//     y darían 404: la música saldría muda sin error), y ni el servidor
//     online ni Sentry, que esa build no lleva (Rafa, 2026-09-29).
//
//   node scripts/check-payload-budget.mjs [carpeta] [--crazygames]
// ---------------------------------------------------------------------------

import { stat, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const DIST = args.find((a) => !a.startsWith('--')) ?? 'dist';
const CRAZYGAMES = args.includes('--crazygames');
const MAX_FILES = 1500;
// 2026-08-24 dieta de payload: 96.9 → 69.7 MB (gltfpack de 53 GLBs de
// arenas/belts −26 MB, belts PNG→WebP, audio -vn VBR5). Ratchet a 75.
// 2026-09-24 (PERSONAJES, F2): Kurama, Sebastian y Kermit por receta
// (44 MB en 3 GLB → ~2 MB) y los Tripo a WebP: 69.7 → 27.4 MB. Ratchet a
// 30 y 3 por fichero, para que el margen no se rellene solo.
const TOTAL_BUDGET_MB = 30;
const FILE_BUDGET_MB = 3;

if (!existsSync(DIST)) {
  console.error(`[payload-budget] no ${DIST}/ — run after vite build`);
  process.exit(1);
}

const files = [];
const stack = [DIST];
while (stack.length) {
  const p = stack.pop();
  const entries = await readdir(p, { withFileTypes: true });
  for (const e of entries) {
    const child = join(p, e.name);
    if (e.isDirectory()) stack.push(child);
    else files.push({ path: child, size: (await stat(child)).size });
  }
}

const totalMb = files.reduce((a, f) => a + f.size, 0) / (1024 * 1024);
const top = [...files].sort((a, b) => b.size - a.size).slice(0, 10);
const overFile = files.filter((f) => f.size / (1024 * 1024) > FILE_BUDGET_MB);

console.log(`[payload-budget] dist total: ${totalMb.toFixed(1)} MB (budget ${TOTAL_BUDGET_MB} MB)`);
console.log('[payload-budget] top-10:');
for (const f of top) {
  console.log(`  ${(f.size / (1024 * 1024)).toFixed(1).padStart(6)} MB  ${f.path}`);
}

let fail = false;
if (totalMb > TOTAL_BUDGET_MB) {
  console.error(`[payload-budget] FAIL: total ${totalMb.toFixed(1)} MB > ${TOTAL_BUDGET_MB} MB`);
  fail = true;
}
for (const f of overFile) {
  console.error(`[payload-budget] FAIL: ${f.path} (${(f.size / (1024 * 1024)).toFixed(1)} MB) > ${FILE_BUDGET_MB} MB per-file`);
  fail = true;
}
if (files.length > MAX_FILES) {
  console.error(`[payload-budget] FAIL: ${files.length} ficheros > ${MAX_FILES} (tope de CrazyGames)`);
  fail = true;
}

// Lo que dicen el HTML y el JS (el resto son assets binarios).
const texts = await Promise.all(files
  .filter((f) => /\.(html|js|css)$/.test(f.path))
  .map(async (f) => ({ path: f.path, text: await readFile(f.path, 'utf8') })));
const where = (re) => texts.filter((t) => re.test(t.text)).map((t) => t.path);
if (!CRAZYGAMES) {
  for (const p of where(/sdk\.crazygames\.com/)) {
    console.error(`[payload-budget] FAIL: ${p} lleva el SDK de CrazyGames, que solo va en su build`);
    fail = true;
  }
} else {
  // Rutas absolutas a la raíz en atributos HTML y en literales de JS
  // ("/audio/...", 'href="/'), sin contar las de protocolo (//host).
  const rootUrl = /(?:\b(?:href|src)=["']\/(?!\/)|["'`]\/(?:audio|images|models|privacy|terms)\b)/;
  for (const p of where(rootUrl)) {
    console.error(`[payload-budget] FAIL: ${p} usa rutas absolutas a la raíz: en CrazyGames darían 404`);
    fail = true;
  }
  for (const p of where(/railway\.app|\.sentry\.io|ingest\.[a-z.]*sentry/)) {
    console.error(`[payload-budget] FAIL: ${p} lleva el servidor online o Sentry, que la build de CrazyGames no lleva`);
    fail = true;
  }
}
console.log(`[payload-budget] ${files.length} ficheros (tope ${MAX_FILES})`);

if (fail) process.exit(1);
console.log('[payload-budget] OK');
