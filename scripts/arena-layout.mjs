// ---------------------------------------------------------------------------
// arena-layout — inspector del generador de arena SIN navegador
// ---------------------------------------------------------------------------
//
// Por qué existe (docs/ARENA_V2.md §3, fase 0): hasta ahora la única forma
// de ver un terreno era arrancar el juego, jugar hasta el segundo 28 y
// mirar. Un agente no puede hacer eso. Este CLI importa el generador REAL
// del cliente (`src/arena-fragments.ts`, espejado en el servidor) y lo
// vuelca en formatos que se leen en una terminal o se pegan en un doc.
//
// Superficie programática de la directiva dual-surface (2026-08-20): es el
// hermano de línea de comandos de lo que la fase 1 dará en `/tools.html`.
//
// Ejecutar (Node ≥22.18 no necesita el flag, va por compatibilidad):
//   node --experimental-strip-types scripts/arena-layout.mjs --help
//   node --experimental-strip-types scripts/arena-layout.mjs --seed 501 --ascii
//
// SOLO LECTURA: no escribe en el repo salvo el `--svg <ruta>` que le pidas.
// Determinista de punta a punta: ni un `Math.random` (el barrido recorre
// semillas 1..K, así que dos ejecuciones dan cifras idénticas).
//
// Hermano histórico: `scripts/research/arena-stats.mts` es la medición que
// respalda §1.2 del doc y se deja intacta como registro; los helpers que
// este CLI necesita (patrón, contigüidad, área viva) viven aquí.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  generateArenaLayout,
  pointInFragment,
  FRAG,
} from '../src/arena-fragments.ts';

// --- Config del CLI (nada de literales sueltos, CLAUDE.md) ---------------

const CLI = {
  /** Ancho por defecto del ráster ASCII, en caracteres. Impar → hay
   *  columna central, que ayuda a ver la simetría del disco. */
  asciiCols: 61,
  /** Una celda de terminal es ~2× más alta que ancha: sin esta corrección
   *  el disco sale como un óvalo tumbado. */
  asciiCellAspect: 0.5,
  /** Índice = banda del fragmento (0 = centro inmune). */
  asciiBandChars: ['@', '#', '=', '-'],
  asciiWarnChar: '!',
  /** Suelo que YA cayó: conserva la silueta del disco, así se lee de un
   *  vistazo qué se ha comido el colapso. */
  asciiFallenChar: '·',
  /** Fuera de todo fragmento: nunca hubo suelo ahí. */
  asciiVoidChar: ' ',
  /** Segundos que muestrea `--curve` (los 8 del doc, §1.2 #11). */
  curveSamples: [15, 30, 45, 60, 75, 90, 105, 120],
  sweepDefault: 2000,
  /** Mismos colores por banda que `BAND_COLORS` en `src/arena.ts:60-65`,
   *  para que el SVG y el juego hablen el mismo idioma. */
  svgBandColors: ['#6fa35f', '#5c8a50', '#4a6741', '#3a5331'],
  svgDeadColor: '#15161c',
  svgWarnStroke: '#ff7733',
  svgSize: 720,
  svgMargin: 16,
  svgHeaderHeight: 34,
};

const TAG = '[arena-layout]';
const TWO_PI = Math.PI * 2;

// --- Argumentos ----------------------------------------------------------

const FLAGS = new Set([
  'help', 'seed', 'json', 'ascii', 'svg', 'timeline', 'curve', 'sweep',
  'cols', 'at-batch', 'at-seconds',
]);

/** `--clave valor` y `--clave=valor`; los booleanos van sin valor. */
function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) fail(`argumento suelto "${token}" (usa --clave valor)`);
    const eq = token.indexOf('=');
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (!FLAGS.has(key)) fail(`flag desconocido "--${key}" (--help lista los válidos)`);
    if (eq >= 0) { out.set(key, token.slice(eq + 1)); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out.set(key, next); i++; }
    else out.set(key, true);
  }
  return out;
}

function fail(msg) {
  console.error(`${TAG} error: ${msg}`);
  process.exit(1);
}

function asInt(args, key, { min = -Infinity, max = Infinity } = {}) {
  const raw = args.get(key);
  if (raw === undefined) return undefined;
  if (raw === true) fail(`--${key} necesita un valor`);
  const n = Number(raw);
  if (!Number.isInteger(n)) fail(`--${key} debe ser un entero, no "${raw}"`);
  if (n < min || n > max) fail(`--${key} fuera de rango [${min}, ${max}]: ${n}`);
  return n;
}

function asNumber(args, key, { min = -Infinity, max = Infinity } = {}) {
  const raw = args.get(key);
  if (raw === undefined) return undefined;
  if (raw === true) fail(`--${key} necesita un valor`);
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`--${key} debe ser un número, no "${raw}"`);
  if (n < min || n > max) fail(`--${key} fuera de rango [${min}, ${max}]: ${n}`);
  return n;
}

const HELP = `${TAG} inspector del generador de arena (docs/ARENA_V2.md fase 0)

  node --experimental-strip-types scripts/arena-layout.mjs --seed N [modo]
  node --experimental-strip-types scripts/arena-layout.mjs --sweep K

Modos (uno por invocación; sin modo imprime el resumen de la semilla):
  --json               ArenaLayout completo en JSON puro (pipeable a jq).
  --ascii              rasteriza el disco con la MISMA pointInFragment de
                       la física. Un carácter por banda, '${CLI.asciiFallenChar}' lo caído.
  --timeline           lotes: retardo, segundo de aviso, de caída, bandas,
                       nº de fragmentos y área viva que queda.
  --curve              fracción de área viva a ${CLI.curveSamples.join(', ')} s.
  --svg <ruta>         escribe un SVG con los sectores (color por banda e
                       índice de cada fragmento).
  --sweep K            barrido determinista de las semillas 1..K con las
                       estadísticas agregadas (no necesita --seed).

Opciones:
  --seed N             semilla int32 (obligatoria salvo en --sweep).
  --cols N             ancho del ASCII en caracteres (def. ${CLI.asciiCols}).
  --at-batch K         estado tras K lotes caídos (--ascii y --svg).
  --at-seconds S       estado en el segundo S de partida (--ascii y --svg);
                       los lotes en aviso se marcan con '${CLI.asciiWarnChar}'.
  --help               esta ayuda.

Ejemplos:
  ... --seed 501 --json | jq '.batches[0]'
  ... --seed 501 --ascii --at-seconds 60
  ... --seed 1 --timeline
  ... --sweep 2000
  ... --seed 7 --svg /tmp/arena-7.svg --at-batch 2
`;

// --- Helpers de layout ---------------------------------------------------

const fragmentArea = (f) => 0.5 * (f.outerR ** 2 - f.innerR ** 2) * (f.endAngle - f.startAngle);

const totalArea = (layout) => Math.PI * layout.maxRadius ** 2;

/**
 * Calendario de lotes. Mismo modelo de tiempo que consume `Arena`: cada
 * lote avisa `delay` segundos después de que caiga el anterior y cae
 * `warningDuration` después de empezar a avisar.
 */
function schedule(layout) {
  let t = 0;
  return layout.batches.map((b, i) => {
    const warnAt = t + b.delay;
    const collapseAt = warnAt + FRAG.warningDuration;
    t = collapseAt;
    const bands = [...new Set(b.indices.map((idx) => layout.fragments[idx].band))].sort((x, y) => x - y);
    return { n: i, delay: b.delay, warnAt, collapseAt, bands, size: b.indices.length, indices: b.indices };
  });
}

/**
 * Patrón macro del colapso, derivado de la SECUENCIA DE BANDAS de los
 * lotes (no de cuántos lotes hay).
 *
 * El generador emite los grupos así:
 *   - Patrón A (barrido por bandas): 3, [3], 2, [2], 1, [1] → la secuencia
 *     de bandas NUNCA sube ("3321", "332211", "321"...).
 *   - Patrón B (eje partido): lado1(3,2,1) + lado2(3,2,1) → "321321", que
 *     vuelve a subir a 3 después de un 1.
 * Es decir: hay patrón B si y solo si la secuencia tiene alguna SUBIDA.
 *
 * Por eso la heurística `batches.length >= 6 → B` de `src/game.ts:2325-2328`
 * está rota: el patrón A con los tres splits también da 6 lotes ("332211")
 * y se clasifica mal en el 8,5 % de las semillas. Buscar la subida es
 * exacto y además sobrevive al descarte defensivo de grupos vacíos del
 * patrón B (`src/arena-fragments.ts:191-193`), que acorta la secuencia
 * pero no elimina la subida.
 */
function detectPattern(layout) {
  const bands = layout.batches.map((b) => layout.fragments[b.indices[0]].band);
  // Desde la fase 0.5 el generador lo dice él mismo (`layout.pattern`); la
  // derivación por bandas se conserva como comprobación cruzada y para
  // poder leer layouts viejos (JSON guardados antes del campo).
  const declared = layout.pattern === 'axis-split' ? 'B' : layout.pattern === 'sweep' ? 'A' : null;
  let derived = 'A';
  for (let i = 1; i < bands.length; i++) if (bands[i] > bands[i - 1]) { derived = 'B'; break; }
  return { pattern: declared ?? derived, bandSeq: bands.join(''), derived, declared };
}

/**
 * Tramos cíclicos de sectores consecutivos de la banda exterior dentro del
 * PRIMER lote. 1 = el lote es un frente continuo (lo legible); 3-4 = cae
 * en dientes de sierra por todo el anillo (lo de hoy en patrón A).
 * Los fragmentos se generan ya en orden angular, así que el índice sirve
 * de orden alrededor del disco.
 */
function firstBatchRuns(layout) {
  const ring = layout.fragments.filter((f) => f.band === 3).map((f) => f.index);
  const first = new Set(layout.batches[0].indices);
  let runs = 0;
  for (let i = 0; i < ring.length; i++) {
    const cur = first.has(ring[i]);
    const prev = first.has(ring[(i - 1 + ring.length) % ring.length]);
    if (cur && !prev) runs++;
  }
  // El lote se come el anillo entero: no hay "arranque" de tramo, pero es
  // un único tramo cerrado.
  if (runs === 0 && first.size > 0) runs = 1;
  return runs;
}

/**
 * Estado del disco en un instante. `atBatch` cuenta lotes ya caídos;
 * `atSeconds` usa el calendario. Sin ninguno de los dos, todo vivo.
 */
function stateAt(layout, { atBatch, atSeconds }) {
  const sched = schedule(layout);
  const dead = new Set();
  const warning = new Set();
  let fallen = 0;
  for (const b of sched) {
    const isDead = atBatch !== undefined ? b.n < atBatch : (atSeconds !== undefined ? b.collapseAt <= atSeconds : false);
    if (isDead) { for (const i of b.indices) dead.add(i); fallen++; continue; }
    if (atSeconds !== undefined && b.warnAt <= atSeconds && atSeconds < b.collapseAt) {
      for (const i of b.indices) warning.add(i);
    }
  }
  let alive = 0;
  for (const f of layout.fragments) if (!dead.has(f.index)) alive += fragmentArea(f);
  return { sched, dead, warning, fallen, aliveArea: alive, aliveFrac: alive / totalArea(layout) };
}

function summaryLine(layout, state) {
  const { pattern, bandSeq } = detectPattern(layout);
  const total = state.sched.length ? state.sched[state.sched.length - 1].collapseAt : 0;
  return `${TAG} seed ${layout.seed} · patrón ${pattern} (bandas ${bandSeq}) · `
    + `${layout.fragments.length} fragmentos · ${layout.batches.length} lotes · `
    + `colapso total ${total.toFixed(1)} s · R ${layout.maxRadius} / inmune ${layout.immuneRadius}`;
}

// --- Modo ASCII ----------------------------------------------------------

function renderAscii(layout, state, cols) {
  const rows = Math.max(3, Math.round(cols * CLI.asciiCellAspect));
  const R = layout.maxRadius;
  const lines = [];
  for (let ry = 0; ry < rows; ry++) {
    // Fila 0 = -z (fondo de la escena); última fila = +z (lado cámara).
    const z = (((ry + 0.5) / rows) * 2 - 1) * R;
    let line = '';
    for (let cx = 0; cx < cols; cx++) {
      const x = (((cx + 0.5) / cols) * 2 - 1) * R;
      let ch = CLI.asciiVoidChar;
      for (const f of layout.fragments) {
        if (!pointInFragment(x, z, f)) continue;
        if (state.dead.has(f.index)) { ch = CLI.asciiFallenChar; continue; }
        ch = state.warning.has(f.index) ? CLI.asciiWarnChar : CLI.asciiBandChars[f.band];
        break;
      }
      line += ch;
    }
    lines.push(line.replace(/ +$/, ''));
  }
  return lines;
}

function printAscii(layout, state, cols) {
  console.log(summaryLine(layout, state));
  console.log(`${TAG} ${state.fallen}/${layout.batches.length} lotes caídos · `
    + `área viva ${(state.aliveFrac * 100).toFixed(1)} % (${state.aliveArea.toFixed(1)} u²) · `
    + `ráster ${cols} col con pointInFragment real`);
  console.log('');
  for (const line of renderAscii(layout, state, cols)) console.log(line);
  console.log('');
  const legend = CLI.asciiBandChars
    .map((c, b) => `${c} ${b === 0 ? 'centro inmune' : `banda ${b}`}`)
    .join(' · ');
  console.log(`${TAG} ${legend} · '${CLI.asciiWarnChar}' avisando · '${CLI.asciiFallenChar}' caído · vacío = fuera del disco`);
  console.log(`${TAG} +x a la derecha, +z abajo (lado cámara); ${layout.maxRadius} u de radio`);
}

// --- Modo timeline -------------------------------------------------------

function printTimeline(layout) {
  const state = stateAt(layout, {});
  console.log(summaryLine(layout, state));
  console.log('');
  console.log('  lote  retardo    aviso    caída  banda  frags  área viva');
  let dead = new Set();
  for (const b of state.sched) {
    for (const i of b.indices) dead.add(i);
    let alive = 0;
    for (const f of layout.fragments) if (!dead.has(f.index)) alive += fragmentArea(f);
    const frac = (alive / totalArea(layout)) * 100;
    console.log(
      `  ${String(b.n + 1).padStart(4)}`
      + `  ${b.delay.toFixed(1).padStart(7)}`
      + `  ${b.warnAt.toFixed(1).padStart(7)}`
      + `  ${b.collapseAt.toFixed(1).padStart(7)}`
      + `  ${b.bands.join('+').padStart(5)}`
      + `  ${String(b.size).padStart(5)}`
      + `  ${(frac.toFixed(1) + ' %').padStart(9)}`,
    );
  }
  const runs = firstBatchRuns(layout);
  console.log('');
  console.log(`${TAG} primer lote: ${runs} tramo${runs === 1 ? '' : 's'} contiguo${runs === 1 ? '' : 's'} `
    + `en la banda exterior (1 = frente continuo)`);
}

// --- Modo curva ----------------------------------------------------------

function printCurve(layout) {
  console.log(summaryLine(layout, stateAt(layout, {})));
  console.log('');
  console.log('    t (s)  lotes caídos   área viva      u²');
  for (const t of CLI.curveSamples) {
    const s = stateAt(layout, { atSeconds: t });
    console.log(
      `  ${String(t).padStart(7)}`
      + `  ${String(`${s.fallen}/${layout.batches.length}`).padStart(12)}`
      + `  ${((s.aliveFrac * 100).toFixed(1) + ' %').padStart(10)}`
      + `  ${s.aliveArea.toFixed(1).padStart(6)}`,
    );
  }
}

// --- Modo SVG ------------------------------------------------------------

const r2 = (n) => Number(n.toFixed(2));

function sectorPath(f, cx, cy, scale) {
  const span = f.endAngle - f.startAngle;
  const large = span > Math.PI ? 1 : 0;
  const ro = f.outerR * scale;
  const ri = f.innerR * scale;
  const px = (r, a) => r2(cx + Math.cos(a) * r * scale);
  const py = (r, a) => r2(cy + Math.sin(a) * r * scale);
  return `M ${px(f.outerR, f.startAngle)} ${py(f.outerR, f.startAngle)}`
    + ` A ${r2(ro)} ${r2(ro)} 0 ${large} 1 ${px(f.outerR, f.endAngle)} ${py(f.outerR, f.endAngle)}`
    + ` L ${px(f.innerR, f.endAngle)} ${py(f.innerR, f.endAngle)}`
    + ` A ${r2(ri)} ${r2(ri)} 0 ${large} 0 ${px(f.innerR, f.startAngle)} ${py(f.innerR, f.startAngle)}`
    + ' Z';
}

function buildSvg(layout, state, label) {
  const { svgSize: S, svgMargin: M, svgHeaderHeight: H } = CLI;
  const scale = (S - 2 * M) / (2 * layout.maxRadius);
  const cx = S / 2;
  const cy = H + (S - H) / 2;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${H + S - 2 * M}" width="${S}" height="${H + S - 2 * M}">`);
  parts.push(`<rect width="100%" height="100%" fill="#0d0e13"/>`);
  parts.push(`<text x="${M}" y="22" fill="#dadada" font-family="monospace" font-size="14">${label}</text>`);
  for (const f of layout.fragments) {
    const isDead = state.dead.has(f.index);
    const isWarn = state.warning.has(f.index);
    const fill = isDead ? CLI.svgDeadColor : CLI.svgBandColors[f.band];
    const stroke = isWarn ? CLI.svgWarnStroke : '#0d0e13';
    const opacity = isDead ? 0.35 : 1;
    const shape = f.immune
      ? `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(f.outerR * scale)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${isWarn ? 3 : 1.5}"/>`
      : `<path d="${sectorPath(f, cx, cy, scale)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${isWarn ? 3 : 1.5}"/>`;
    parts.push(shape);
  }
  // Índices encima de las formas para que no los tape ningún sector vecino.
  for (const f of layout.fragments) {
    const midR = f.immune ? 0 : (f.innerR + f.outerR) / 2;
    const midA = (f.startAngle + f.endAngle) / 2;
    const tx = r2(cx + Math.cos(midA) * midR * scale);
    const ty = r2(cy + Math.sin(midA) * midR * scale + 4);
    const fillText = state.dead.has(f.index) ? '#5a5f6b' : '#f2f2f2';
    parts.push(`<text x="${tx}" y="${ty}" fill="${fillText}" font-family="monospace" font-size="12" text-anchor="middle">${f.index}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// --- Modo sweep ----------------------------------------------------------

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    min: s[0], p10: s[Math.floor(s.length * 0.1)], mean,
    p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1],
  };
}

const fmtStats = (s) => `min ${s.min.toFixed(1)} · p10 ${s.p10.toFixed(1)} · media ${s.mean.toFixed(1)} `
  + `· p90 ${s.p90.toFixed(1)} · max ${s.max.toFixed(1)}`;

function histLine(hist) {
  return Object.keys(hist)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `${k}:${hist[k]}`)
    .join(' ');
}

function printSweep(count) {
  const fragHist = {};
  const batchHist = {};
  const runsHistA = {};
  const runsHistB = {};
  const totals = [];
  const firsts = [];
  const aliveByT = CLI.curveSamples.map(() => []);
  let patternB = 0;
  let contiguous = 0;
  let heuristicMisses = 0;

  for (let seed = 1; seed <= count; seed++) {
    const layout = generateArenaLayout(seed);
    const { pattern } = detectPattern(layout);
    const isB = pattern === 'B';
    if (isB) patternB++;
    // Contraste con la heurística rota de src/game.ts:2325-2328: el patrón A
    // con los tres splits también da 6 lotes y se etiquetaría como B.
    if (!isB && layout.batches.length >= 6) heuristicMisses++;

    fragHist[layout.fragments.length] = (fragHist[layout.fragments.length] ?? 0) + 1;
    const key = `${pattern}:${layout.batches.length}`;
    batchHist[key] = (batchHist[key] ?? 0) + 1;

    const sched = schedule(layout);
    firsts.push(sched[0].collapseAt);
    totals.push(sched[sched.length - 1].collapseAt);

    const runs = firstBatchRuns(layout);
    const target = isB ? runsHistB : runsHistA;
    target[runs] = (target[runs] ?? 0) + 1;
    if (runs === 1) contiguous++;

    CLI.curveSamples.forEach((t, k) => { aliveByT[k].push(stateAt(layout, { atSeconds: t }).aliveFrac); });
  }

  const pct = (n) => `${((n / count) * 100).toFixed(1)} %`;
  const contiguousA = runsHistA[1] ?? 0;
  const contiguousB = runsHistB[1] ?? 0;
  const patternA = count - patternB;

  console.log(`${TAG} barrido determinista de las semillas 1..${count}`);
  console.log('');
  console.log(`  fragmentos por partida       ${histLine(fragHist)}`);
  console.log(`  patrón                       A ${pct(patternA)} · B ${pct(patternB)}`);
  console.log(`  lotes (patrón:nº=semillas)   ${histLine(batchHist).replace(/([AB]:\d+):/g, '$1=')}`);
  console.log(`  heurística ">=6 → B" rota    ${pct(heuristicMisses)} de las semillas (patrón A con 6 lotes)`);
  console.log(`  primer colapso (s)           ${fmtStats(stats(firsts))}`);
  console.log(`  colapso total (s)            ${fmtStats(stats(totals))}`);
  console.log('');
  // La cifra de docs/ARENA_V2.md §1.2 #10 se mide sobre TODAS las semillas:
  // solo el patrón A puede fallar (el B parte por un eje, así que su primer
  // lote es contiguo por construcción), pero el denominador es N.
  console.log(`  1er lote contiguo (patrón A) ${pct(contiguousA)} de las ${count} semillas  ← cifra de docs/ARENA_V2.md §1.2 #10`);
  console.log(`    · dentro del patrón A      ${contiguousA}/${patternA} = ${patternA ? ((contiguousA / patternA) * 100).toFixed(1) : '0.0'} % · tramos ${histLine(runsHistA)}`);
  console.log(`    · dentro del patrón B      ${contiguousB}/${patternB} · tramos ${histLine(runsHistB)} (contiguo por construcción: eje)`);
  console.log(`    · cualquier patrón         ${pct(contiguous)}  ← lo que ve el jugador (la fase 0.5 lo lleva al 100 %)`);
  console.log('');
  console.log('  área viva media por t');
  CLI.curveSamples.forEach((t, k) => {
    const m = aliveByT[k].reduce((a, b) => a + b, 0) / count;
    console.log(`    ${String(t).padStart(4)} s                    ${(m * 100).toFixed(1)} %`);
  });
}

// --- Main ----------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

if (args.has('help') || args.size === 0) {
  console.log(HELP);
  process.exit(0);
}

if (args.has('sweep')) {
  const raw = args.get('sweep');
  const count = raw === true ? CLI.sweepDefault : asInt(args, 'sweep', { min: 1, max: 1_000_000 });
  printSweep(count);
  process.exit(0);
}

const seed = asInt(args, 'seed');
if (seed === undefined) fail('falta --seed N (o usa --sweep K)');
if (seed === 0) console.error(`${TAG} aviso: la semilla 0 está reservada como "sin arena" (src/game.ts:1264)`);

const atBatch = asInt(args, 'at-batch', { min: 0 });
const atSeconds = asNumber(args, 'at-seconds', { min: 0 });
if (atBatch !== undefined && atSeconds !== undefined) fail('--at-batch y --at-seconds son excluyentes');

const layout = generateArenaLayout(seed);
if (atBatch !== undefined && atBatch > layout.batches.length) {
  fail(`--at-batch ${atBatch} pero la semilla ${seed} solo tiene ${layout.batches.length} lotes`);
}
const cols = asInt(args, 'cols', { min: 11, max: 400 }) ?? CLI.asciiCols;
const state = stateAt(layout, { atBatch, atSeconds });

if (args.has('json')) {
  // JSON puro: el ArenaLayout tal cual, sin cabeceras, para pipear a jq.
  console.log(JSON.stringify(layout, null, 2));
} else if (args.has('ascii')) {
  printAscii(layout, state, cols);
} else if (args.has('timeline')) {
  printTimeline(layout);
} else if (args.has('curve')) {
  printCurve(layout);
} else if (args.has('svg')) {
  const out = args.get('svg');
  if (out === true) fail('--svg necesita una ruta de salida');
  const at = atBatch !== undefined ? ` · tras ${atBatch} lote(s)`
    : atSeconds !== undefined ? ` · t=${atSeconds}s` : '';
  const { pattern } = detectPattern(layout);
  const label = `seed ${layout.seed} · patrón ${pattern} · ${layout.fragments.length} frags`
    + ` · ${(state.aliveFrac * 100).toFixed(1)} % vivo${at}`;
  const path = resolve(out);
  writeFileSync(path, buildSvg(layout, state, label), 'utf8');
  console.log(summaryLine(layout, state));
  console.log(`${TAG} SVG escrito en ${path} `
    + `(${layout.fragments.length - state.dead.size}/${layout.fragments.length} fragmentos vivos)`);
} else {
  console.log(summaryLine(layout, state));
  // Sin modo es un uso inválido, no un resumen: esta herramienta la invocan
  // agentes, y un exit 0 ante una invocación mal escrita es lo que convierte
  // un error de tecleo en una conclusión falsa.
  console.error(`${TAG} sin modo: usa --json | --ascii | --timeline | --curve | --svg <ruta> (--help para todo)`);
  process.exit(1);
}
