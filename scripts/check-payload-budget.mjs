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
// El límite per-file protege contra el regreso de un asset gordo
// individual (sebastian.glb, el mayor legítimo hoy, pesa 16 MB).
// ---------------------------------------------------------------------------

import { stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const TOTAL_BUDGET_MB = 115;
const FILE_BUDGET_MB = 17;

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
if (fail) process.exit(1);
console.log('[payload-budget] OK');
