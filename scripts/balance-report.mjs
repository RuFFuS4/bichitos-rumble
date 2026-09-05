// ---------------------------------------------------------------------------
// balance-report — presupuesto efectivo por critter + cruce con el batch
// ---------------------------------------------------------------------------
//
// Marco v2 (Rafa, 2026-08-21): "cero potencia fuera de presupuesto". El
// sistema P/W/S (-2..+2, suma≈0) era el presupuesto NOMINAL, pero la
// física real multiplica headbuttForce × headbuttBoost (physics.ts:86),
// así que el boost es potencia no puntuada. Este informe calcula el
// presupuesto EFECTIVO de cada critter en puntos P/W/S:
//
//   S_pts = (speed − SPEED_BASE) / SPEED_STEP
//   W_pts = (mass  − MASS_BASE)  / MASS_STEP
//   P_pts = (force × boost − FORCE_BASE) / FORCE_STEP   ← boost tasado
//   R_pts = 0 mientras physicsRadius no diverja de la R compartida
//           (roster.ts); cuando diverja: (R_shared − radius) / 0.10
//           (hitbox chica = esquivas gratis = poder).
//
//   presupuesto = S + W + P (+ R)
//
// El presupuesto es descriptivo, no normativo: la referencia útil es la
// MEDIA del roster (no el cero), y el juicio final lo da el batch
// runner. Si hay .tmp/audit-*.json (npm run batch --out=...), el
// informe cruza wins/caídas/headbutts observados por critter.
//
// Limitación conocida v1: el kit de habilidades (J/K/L) no puntúa aún —
// se lista aparte como recordatorio. Los ejes tampoco pesan igual en la
// práctica (el audit 2026-08-21 sugiere que W protege más de lo lineal
// y S convierte en volumen de headbutts); los pesos se calibrarán
// empíricamente batch a batch, no en este script.
//
// Uso:  npm run balance   (alias de: node scripts/balance-report.mjs)
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// --- P/W/S nominal + escalares (src/pws-stats.ts) --------------------------
const pwsSrc = read('src/pws-stats.ts');
const scalar = (name) => {
  const m = pwsSrc.match(new RegExp(`const ${name} = ([\\d.]+)`));
  if (!m) throw new Error(`No encuentro el escalar ${name} en pws-stats.ts`);
  return +m[1];
};
const SPEED_BASE = scalar('SPEED_BASE'), SPEED_STEP = scalar('SPEED_STEP');
const MASS_BASE = scalar('MASS_BASE'), MASS_STEP = scalar('MASS_STEP');
const FORCE_BASE = scalar('FORCE_BASE'), FORCE_STEP = scalar('FORCE_STEP');

const pws = {};
for (const m of pwsSrc.matchAll(/^ {2}(\w+): *\{ *p: *(-?\d+), *w: *(-?\d+), *s: *(-?\d+) *\}/gm)) {
  pws[m[1]] = { p: +m[2], w: +m[3], s: +m[4] };
}
if (!Object.keys(pws).length) throw new Error('CRITTER_PWS no parseado');

// --- boosts (src/critter.ts) — bloque por critter --------------------------
const critterSrc = read('src/critter.ts');
const boosts = {};
const overrides = {};
{
  // Trocear por fronteras de entrada (name: 'X') para que los bloques
  // con comentarios largos (Trunk y su historial de micropasses) no se
  // coman el campo del critter siguiente.
  const parts = critterSrc.split(/name: '(\w+)'/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    if (!(name in pws)) continue;
    // Cortar en el spread del siguiente critter para no leer sus campos.
    const seg = parts[i + 1].split('...deriveCritterStats')[0];
    const m = seg.match(/headbuttBoost: ([\d.]+)/);
    boosts[name] = m ? +m[1] : 1.0;
    // Overrides explícitos DESPUÉS del spread (p.ej. Trunk speed/force):
    // pisan la derivación P/W/S — exactamente la clase de potencia fuera
    // de presupuesto que este informe existe para cazar.
    overrides[name] = {};
    for (const k of ['speed', 'mass', 'headbuttForce']) {
      const om = seg.match(new RegExp(`\\b${k}: ([\\d.]+)`));
      if (om) overrides[name][k] = +om[1];
    }
  }
  for (const name of Object.keys(pws)) { boosts[name] ??= 1.0; overrides[name] ??= {}; }
}

// --- physicsRadius (src/roster.ts) — literal vs R compartida ---------------
const rosterSrc = read('src/roster.ts');
const R_SHARED = +(rosterSrc.match(/const R = ([\d.]+)/)?.[1] ?? 0.55);
const radii = {};
for (const name of Object.keys(pws)) {
  const block = rosterSrc.split(`'${name.toLowerCase()}'`)[1]?.slice(0, 500) ?? '';
  const m = block.match(/physicsRadius: ([\d.]+)/);
  radii[name] = m ? +m[1] : R_SHARED;
}

// --- audit del batch runner (.tmp/audit-*.json), si existe -----------------
const audit = {};
const tmpDir = path.join(ROOT, '.tmp');
if (fs.existsSync(tmpDir)) {
  for (const f of fs.readdirSync(tmpDir).filter((f) => f.startsWith('audit-') && f.endsWith('.json'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8'));
      for (const [name, s] of Object.entries(d.aggregates?.byCritter ?? {})) {
        const a = (audit[name] ??= { pWins: 0, pMatches: 0, bWins: 0, bMatches: 0, falls: 0, hb: 0, m: 0 });
        if (s.isPlayer) { a.pWins += s.wins; a.pMatches += s.matches; }
        else { a.bWins += s.wins; a.bMatches += s.matches; }
        a.falls += s.falls; a.hb += s.headbutts; a.m += s.matches;
      }
    } catch { /* fichero a medias de un batch en curso: se ignora */ }
  }
}

// --- presupuesto efectivo ---------------------------------------------------
const rows = Object.entries(pws).map(([name, t]) => {
  const ov = overrides[name];
  const speed = ov.speed ?? SPEED_BASE + t.s * SPEED_STEP;
  const mass = ov.mass ?? MASS_BASE + t.w * MASS_STEP;
  const force = ov.headbuttForce ?? FORCE_BASE + t.p * FORCE_STEP;
  const boost = boosts[name];
  const hasOverride = Object.keys(ov).length > 0;
  const effForce = force * boost;
  const sPts = (speed - SPEED_BASE) / SPEED_STEP;
  const wPts = (mass - MASS_BASE) / MASS_STEP;
  const pPts = (effForce - FORCE_BASE) / FORCE_STEP;
  const rPts = (R_SHARED - radii[name]) / 0.10;
  const budget = sPts + wPts + pPts + rPts;
  const a = audit[name];
  return {
    name: hasOverride ? name + '*' : name,
    speed, mass, force, boost, effForce, sPts, wPts, pPts, rPts, budget,
    wins: a ? `${a.pWins}/${a.pMatches}` : '—',
    botWr: a && a.bMatches ? Math.round((a.bWins / a.bMatches) * 100) + '%' : '—',
    fallsP: a && a.m ? (a.falls / a.m).toFixed(1) : '—',
    hbP: a && a.m ? (a.hb / a.m).toFixed(0) : '—',
  };
});
rows.sort((a, b) => b.budget - a.budget);
const mean = rows.reduce((s, r) => s + r.budget, 0) / rows.length;

const f1 = (n) => (n >= 0 ? '+' : '') + n.toFixed(1);
console.log('== Presupuesto efectivo P/W/S (marco v2 — boost tasado) ==\n');
console.log('critter     P_eff  W     S     R     TOTAL  vs media | wins  wr-bot  falls/p  hb/p');
for (const r of rows) {
  const dev = r.budget - mean;
  const flag = Math.abs(dev) > 1.5 ? (dev > 0 ? ' ▲' : ' ▼') : '';
  console.log(
    r.name.padEnd(11),
    f1(r.pPts).padEnd(6), f1(r.wPts).padEnd(5), f1(r.sPts).padEnd(5), f1(r.rPts).padEnd(5),
    f1(r.budget).padEnd(6), (f1(dev) + flag).padEnd(8), '|',
    String(r.wins).padEnd(5), String(r.botWr).padEnd(7), String(r.fallsP).padEnd(8), r.hbP,
  );
}
console.log(`\nmedia del roster: ${f1(mean)} · banda sana: ±1.5 · ▲/▼ = desviado`);
console.log('boosts actuales:', rows.map((r) => `${r.name} ${r.boost}`).join(' · '));
console.log('\n(recordatorio v1: el kit J/K/L aún no puntúa — pendiente de pesos empíricos)');
