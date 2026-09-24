// ---------------------------------------------------------------------------
// Golden de layout de arena por hash (terreno v2 fase 0 — docs/ARENA_V2.md §3)
// ---------------------------------------------------------------------------
//
// Escribe tests/sim/arena-layout-golden.json: un hash FNV-1a de 32 bits por
// semilla que resume el layout que devuelve generateArenaLayout().
//
// Por qué un hash y no el layout entero: el golden de partidas
// (scripts/golden/sim-golden.json) tarda minutos y usa Playwright, y cualquier
// cambio del terreno lo mueve entero. Este golden corre en milisegundos dentro
// de Vitest y separa "cambió el terreno" de "cambió el balance".
//
// Qué se hashea y qué NO (decisión, no detalle):
//   - SOLO layout.fragments y layout.batches. Nada de seed/immuneRadius/
//     maxRadius: son constantes de FRAG y ya las cubren los tests de
//     invariantes; meterlas aquí solo añadiría ruido al diff.
//   - Floats CUANTIZADOS a QUANTUM (1e-6). El generador es aritmética IEEE
//     pura (mulberry32, Math.floor, Math.PI, sort numérico), así que sería
//     estable bit a bit, pero la cuantización protege del último ulp si
//     alguna vez se toca el orden de operaciones.
//   - NUNCA salidas de pointInFragment(): usa Math.atan2 y Math.sqrt, que no
//     están garantizados bit a bit entre versiones de V8 ni entre Node y
//     navegador. Un golden basado en eso sería un test intermitente.
//
// Uso:
//   node --experimental-strip-types scripts/write-arena-layout-golden.mjs
//   (el flag hace falta porque importa src/arena-fragments.ts directamente;
//    en Node >= 22.18 el type stripping ya va sin flag, pero pasarlo es
//    compatible con ambos. Node 20 NO puede ejecutar este script.)
//
// Verificación: tests/sim/arena-layout.test.ts importa hashLayout() de aquí
// (una sola implementación del hash) y compara contra el JSON.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { generateArenaLayout } from '../src/arena-fragments.ts';

/** Sube cuando cambie el FORMATO del golden (no cuando cambien los hashes). */
export const GOLDEN_VERSION = 1;

/** Resolución de la cuantización de floats antes de hashear. */
export const QUANTUM = 1e-6;

/**
 * Semillas del golden: 1..64 (barrido corto que ya toca los dos patrones
 * macro y las 4-6 tandas) + 501/502/503, las tres del golden de partidas
 * (GOLDEN_MATRIX en scripts/run-match-batch.mjs), para poder atribuir un
 * diff de sim-golden.json a "el terreno cambió" o "el balance cambió".
 */
export const GOLDEN_SEEDS = [
  ...Array.from({ length: 64 }, (_, i) => i + 1),
  501, 502, 503,
];

export const GOLDEN_PATH = new URL('../tests/sim/arena-layout-golden.json', import.meta.url);

const NOTE =
  'FNV-1a 32-bit sobre layout.fragments + layout.batches, floats cuantizados a 1e-6. '
  + 'No se hashea seed/immuneRadius/maxRadius ni ninguna salida de pointInFragment '
  + '(atan2/sqrt no son bit-estables entre runtimes). Regenerar: '
  + 'npm run golden:layout:write';

/** Float → entero estable. -0 y 0 dan la misma cadena ("0"). */
function q(value) {
  if (!Number.isFinite(value)) throw new Error(`valor no finito en el layout: ${value}`);
  return String(Math.round(value / QUANTUM));
}

/**
 * Serialización canónica de un layout. Una línea por fragmento y por tanda,
 * en el orden en que las genera el generador (que es parte del contrato:
 * fragments[i].index === i y las tandas van en orden de colapso).
 */
export function layoutSignature(layout) {
  const lines = [`v${GOLDEN_VERSION}`, `f=${layout.fragments.length}`, `b=${layout.batches.length}`];
  for (const f of layout.fragments) {
    lines.push(
      `F${f.index}:${f.band}:${f.immune ? 1 : 0}`
      + `:${q(f.innerR)}:${q(f.outerR)}:${q(f.startAngle)}:${q(f.endAngle)}`,
    );
  }
  for (let i = 0; i < layout.batches.length; i++) {
    const batch = layout.batches[i];
    lines.push(`B${i}:${q(batch.delay)}:${batch.indices.join(',')}`);
  }
  return lines.join('\n');
}

/** FNV-1a de 32 bits, inline y sin dependencias. La firma es ASCII pura. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashLayout(layout) {
  return fnv1a(layoutSignature(layout));
}

/** { seed → hash } para GOLDEN_SEEDS, en orden ascendente de semilla. */
export function buildGoldenSeeds() {
  const seeds = {};
  for (const seed of GOLDEN_SEEDS) seeds[String(seed)] = hashLayout(generateArenaLayout(seed));
  return seeds;
}

export function buildGoldenDoc() {
  return {
    version: GOLDEN_VERSION,
    quantum: QUANTUM,
    note: NOTE,
    generator: 'scripts/write-arena-layout-golden.mjs',
    seeds: buildGoldenSeeds(),
  };
}

// --- CLI ------------------------------------------------------------------
// Solo escribe cuando se ejecuta como script; importado (por el test) no hace
// nada. import.meta.main no existe en Node 22, de ahí la comparación de rutas.
const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const doc = buildGoldenDoc();
  // LF a propósito: es lo que hace writeJson() en run-match-batch.mjs para
  // sim-golden.json; con core.autocrlf el checkout lo deja en CRLF y el
  // índice de git no ve diff al regenerar.
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  const n = Object.keys(doc.seeds).length;
  console.log(`golden de layout escrito: tests/sim/arena-layout-golden.json (${n} semillas, v${GOLDEN_VERSION})`);
}
