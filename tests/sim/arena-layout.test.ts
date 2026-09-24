// ---------------------------------------------------------------------------
// Invariantes del generador de arena + golden de layout por hash.
// Terreno v2, fase 0 (docs/ARENA_V2.md §3): la red de seguridad que va ANTES
// de tocar nada del terreno. Hasta ahora el generador tenía CERO tests.
//
// Importa la copia CLIENTE (src/arena-fragments.ts). La copia servidor
// (server/src/sim/arena-fragments.ts) debe ser byte-idéntica salvo la línea 2;
// eso lo garantiza el scraper de paridad de `npm run check`, no este fichero.
//
// Sin three, sin mocks: el generador es una función pura de la semilla.
//
// ALCANCE (medido con mutación, review 2026-09-06): estos invariantes
// protegen la ESTRUCTURA (cobertura, contigüidad, pertenencia a lotes,
// determinismo), no el TUNING del tempo: subir FRAG.delayJitter de 0.2 a
// 0.6 los pasa todos. Al tempo lo protege el golden de hashes de abajo —
// por eso `golden:layout:write` nunca se regenera "para que pase" sin
// explicar el diff en BUILD_LOG.md.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FRAG,
  generateArenaLayout,
  isPointOnArena,
  pointInFragment,
  type ArenaLayout,
  type FragmentDef,
} from '../../src/arena-fragments';
import { GOLDEN_SEEDS, GOLDEN_VERSION, hashLayout } from '../../scripts/write-arena-layout-golden.mjs';

const TWO_PI = Math.PI * 2;

/** Semillas de trabajo para las invariantes que se miden sobre varias. */
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/**
 * mulberry32 LOCAL para muestrear puntos. Deliberadamente NO se usa
 * Math.random: un test de cobertura que falla 1 de cada 500 ejecuciones es
 * peor que no tenerlo. Es la misma familia de PRNG que el generador, pero una
 * copia privada del test (el módulo no la exporta).
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distancia angular mínima entre dos ángulos, en [0, π]. */
function angularGap(a: number, b: number): number {
  const d = ((a - b) % TWO_PI + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

function fragmentsOfBand(layout: ArenaLayout, band: number): FragmentDef[] {
  return layout.fragments
    .filter((f) => f.band === band)
    .sort((a, b) => a.startAngle - b.startAngle);
}

describe('arena layout — determinismo', () => {
  it('la misma semilla produce un layout profundamente igual', () => {
    for (const seed of [1, 7, 42, 501, 502, 503, 2147483647, -12345]) {
      expect(generateArenaLayout(seed)).toEqual(generateArenaLayout(seed));
    }
  });

  it('no hay estado compartido entre llamadas (A, B, A vuelve a dar A)', () => {
    // Si alguien introdujera un PRNG a nivel de módulo o Math.random, esto
    // canta: la tercera llamada devolvería algo distinto de la primera.
    const first = generateArenaLayout(11);
    generateArenaLayout(12);
    expect(generateArenaLayout(11)).toEqual(first);
  });

  it('semillas distintas producen layouts distintos (el seed importa)', () => {
    const hashes = new Set(SEEDS.map((s) => hashLayout(generateArenaLayout(s))));
    // No exigimos 200/200 (32 bits, colisiones teóricas), pero un generador
    // que ignorase el seed daría 1.
    expect(hashes.size).toBeGreaterThan(SEEDS.length * 0.95);
  });
});

describe('arena layout — estructura', () => {
  it('fragments[i].index === i (las tandas indexan por posición)', () => {
    for (const seed of SEEDS) {
      const { fragments } = generateArenaLayout(seed);
      for (let i = 0; i < fragments.length; i++) {
        expect(fragments[i].index, `seed ${seed}`).toBe(i);
      }
    }
  });

  it('el fragmento 0 es el centro inmune: band 0, r 0→immuneRadius, círculo completo', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      const center = layout.fragments[0];
      expect(center.immune, `seed ${seed}`).toBe(true);
      expect(center.band, `seed ${seed}`).toBe(0);
      expect(center.innerR, `seed ${seed}`).toBe(0);
      expect(center.outerR, `seed ${seed}`).toBe(FRAG.immuneRadius);
      expect(layout.immuneRadius, `seed ${seed}`).toBe(FRAG.immuneRadius);
      // Es el ÚNICO inmune.
      expect(layout.fragments.filter((f) => f.immune).length, `seed ${seed}`).toBe(1);
    }
  });

  it('el centro inmune cubre el origen y su disco entero', () => {
    const layout = generateArenaLayout(3);
    const center = layout.fragments[0];
    const alive = layout.fragments.map(() => true);
    expect(pointInFragment(0, 0, center)).toBe(true);
    expect(isPointOnArena(0, 0, layout.fragments, alive)).toBe(true);
    // Un punto en el borde del disco inmune sigue dentro (r <= outerR).
    expect(pointInFragment(FRAG.immuneRadius - 1e-9, 0, center)).toBe(true);
  });

  it('el centro inmune NUNCA aparece en una tanda de colapso', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      const immuneIdx = new Set(layout.fragments.filter((f) => f.immune).map((f) => f.index));
      for (const [b, batch] of layout.batches.entries()) {
        for (const i of batch.indices) {
          expect(immuneIdx.has(i), `seed ${seed}: tanda ${b} incluye el inmune ${i}`).toBe(false);
        }
      }
    }
  });

  it('cada fragmento no inmune está en EXACTAMENTE una tanda', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      const seen = new Map<number, number>();
      for (const batch of layout.batches) {
        for (const i of batch.indices) seen.set(i, (seen.get(i) ?? 0) + 1);
      }
      const collapsible = layout.fragments.filter((f) => !f.immune).map((f) => f.index);
      const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([i]) => i);
      const missing = collapsible.filter((i) => !seen.has(i));
      expect(repeated, `seed ${seed}: índices repetidos en varias tandas`).toEqual([]);
      expect(missing, `seed ${seed}: fragmentos que no colapsan nunca`).toEqual([]);
      expect(seen.size, `seed ${seed}`).toBe(collapsible.length);
      // Ninguna tanda vacía: una tanda sin índices gasta warningDuration sin
      // que caiga nada (el generador ya filtra las de longitud 0).
      for (const [b, batch] of layout.batches.entries()) {
        expect(batch.indices.length, `seed ${seed}: tanda ${b} vacía`).toBeGreaterThan(0);
      }
    }
  });

  it('el número de fragmentos cae en 26..32 (rango medido, 200 semillas)', () => {
    // Derivado de FRAG.bands: sectorMin 7+9+9 = 25 y sectorMax 9+11+11 = 31,
    // más el centro inmune → [26, 32]. Coincide con lo medido en
    // scripts/research/arena-stats.mts sobre 5000 semillas.
    for (const seed of SEEDS) {
      const n = generateArenaLayout(seed).fragments.length;
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(26);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(32);
    }
  });
});

describe('arena layout — geometría', () => {
  it('los sectores de cada banda son contiguos y cubren el círculo entero', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      for (let band = 1; band <= FRAG.bands.length; band++) {
        const sectors = fragmentsOfBand(layout, band);
        expect(sectors.length, `seed ${seed} banda ${band}`).toBeGreaterThan(0);
        let span = 0;
        for (let i = 0; i < sectors.length; i++) {
          const cur = sectors[i];
          const next = sectors[(i + 1) % sectors.length];
          // endAngle de uno === startAngle del siguiente (módulo 2π).
          expect(
            angularGap(cur.endAngle, next.startAngle),
            `seed ${seed} banda ${band}: hueco/solape entre el sector ${cur.index} y el ${next.index}`,
          ).toBeLessThan(1e-9);
          expect(cur.endAngle, `seed ${seed} sector ${cur.index}`).toBeGreaterThan(cur.startAngle);
          span += cur.endAngle - cur.startAngle;
          // Radios de la banda, idénticos para todos sus sectores.
          expect(cur.innerR, `seed ${seed} sector ${cur.index}`).toBe(FRAG.bands[band - 1].inner);
          expect(cur.outerR, `seed ${seed} sector ${cur.index}`).toBe(FRAG.bands[band - 1].outer);
        }
        expect(span, `seed ${seed} banda ${band}: la suma de arcos no es 2π`).toBeCloseTo(TWO_PI, 9);
      }
    }
  });

  it('las bandas encajan en radio sin hueco (immune → 5.5 → 8.5 → 12)', () => {
    const layout = generateArenaLayout(5);
    expect(FRAG.bands[0].inner).toBe(FRAG.immuneRadius);
    for (let b = 1; b < FRAG.bands.length; b++) {
      expect(FRAG.bands[b].inner).toBe(FRAG.bands[b - 1].outer);
    }
    expect(FRAG.bands[FRAG.bands.length - 1].outer).toBe(FRAG.maxRadius);
    expect(layout.maxRadius).toBe(FRAG.maxRadius);
  });

  it('cobertura sin huecos: 20k puntos con r < maxRadius caen en algún fragmento', () => {
    // 40 semillas × 500 puntos. Muestreo con mulberry32 LOCAL de semilla fija
    // (r = sqrt(u)·R para que sean uniformes por ÁREA, no por radio). El
    // margen de 1e-6 en el radio evita el borde exacto r === outerR, donde el
    // error de cos/sin puede empujar el punto fuera por un ulp.
    const rand = mulberry32(0x5eed);
    const rMax = FRAG.maxRadius - 1e-6;
    let samples = 0;
    const misses: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const layout = generateArenaLayout(seed);
      const alive = layout.fragments.map(() => true);
      for (let k = 0; k < 500; k++) {
        const r = Math.sqrt(rand()) * rMax;
        const a = rand() * TWO_PI;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        samples++;
        if (!isPointOnArena(x, z, layout.fragments, alive)) {
          misses.push(`seed ${seed}: (${x.toFixed(4)}, ${z.toFixed(4)}) r=${r.toFixed(4)}`);
        }
      }
    }
    expect(samples).toBe(20000);
    expect(misses.slice(0, 10), `${misses.length}/20000 puntos sin fragmento`).toEqual([]);
  });
});

describe('arena layout — tempo del colapso', () => {
  it('la primera tanda avisa a firstBatchDelay y el resto respetan minBatchDelay', () => {
    for (const seed of SEEDS) {
      const { batches } = generateArenaLayout(seed);
      expect(batches.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(batches.length, `seed ${seed}`).toBeLessThanOrEqual(6);
      expect(batches[0].delay, `seed ${seed}`).toBe(FRAG.firstBatchDelay);
      for (let i = 1; i < batches.length; i++) {
        expect(batches[i].delay, `seed ${seed} tanda ${i}`).toBeGreaterThanOrEqual(FRAG.minBatchDelay);
      }
    }
  });

  it('la duración total cabe en targetTotalDuration ± el jitter del presupuesto', () => {
    // El comentario del generador dice "total ≈ targetTotalDuration", pero
    // NO es una cota superior dura: los retardos no primeros se multiplican
    // por (1 ± delayJitter) de forma independiente, así que el total se
    // desvía como mucho ±delayJitter × presupuesto de retardos.
    //
    //   presupuesto = target − firstBatchDelay − n·warningDuration
    //   total       = firstBatchDelay + n·warningDuration + Σ retardos ≥ 1
    //   Σ retardos  ∈ [0,8·presupuesto, 1,2·presupuesto]  (media = presupuesto)
    //
    // Con n ∈ [4,6] el presupuesto vale 53..59 s, luego el margen es ±10,6 a
    // ±11,8 s. Medido sobre 5000 semillas: total ∈ [85,45, 106,91] s, y la
    // peor desviación relativa es 0,947 del margen — o sea que la cota es
    // ajustada y no un cheque en blanco. El suelo minBatchDelay no llega a
    // morder nunca (mean·0,8 ≥ 8,48 s en el peor caso, n=6).
    for (const seed of SEEDS) {
      const { batches } = generateArenaLayout(seed);
      const n = batches.length;
      const warnings = n * FRAG.warningDuration;
      const budget = FRAG.targetTotalDuration - FRAG.firstBatchDelay - warnings;
      expect(budget, `seed ${seed}: presupuesto de retardos negativo`).toBeGreaterThan(0);
      const total = batches.reduce((acc, b) => acc + b.delay, 0) + warnings;
      const margin = FRAG.delayJitter * budget + 1e-9;
      expect(
        Math.abs(total - FRAG.targetTotalDuration),
        `seed ${seed}: colapso total ${total.toFixed(2)}s fuera de ${FRAG.targetTotalDuration}±${margin.toFixed(2)}s`,
      ).toBeLessThanOrEqual(margin);
    }
  });
});

// --- Golden por hash ------------------------------------------------------

interface LayoutGolden {
  version: number;
  quantum: number;
  note: string;
  generator: string;
  seeds: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Fase 0.5 — el colapso se lee (frentes contiguos + patrón explícito)
// ---------------------------------------------------------------------------

/**
 * Tramos de sectores CONSECUTIVOS (en orden angular, cíclico) de una banda
 * dentro de un lote. 1 = el lote es un arco continuo; 3-4 = cae en dientes
 * de sierra repartidos por todo el anillo, que es lo que hacía el generador
 * antes de la fase 0.5 (2,8 % de partidas con frente legible).
 */
function cyclicRuns(layout: ArenaLayout, band: number, batchIdx: number): number {
  const ring = fragmentsOfBand(layout, band)
    .sort((a, b) => a.startAngle - b.startAngle)
    .map(f => f.index);
  const inBatch = new Set(layout.batches[batchIdx].indices);
  let runs = 0;
  for (let i = 0; i < ring.length; i++) {
    const cur = inBatch.has(ring[i]);
    const prev = inBatch.has(ring[(i - 1 + ring.length) % ring.length]);
    if (cur && !prev) runs++;
  }
  return runs;
}

describe('arena layout — colapso legible (fase 0.5)', () => {
  it('cada lote parcial de una banda es UN arco contiguo, en las 200 semillas', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      for (let b = 0; b < layout.batches.length; b++) {
        const bands = [...new Set(layout.batches[b].indices.map(i => layout.fragments[i].band))];
        if (bands.length !== 1) continue; // lote mixto: no aplica
        const band = bands[0];
        const total = fragmentsOfBand(layout, band).length;
        if (layout.batches[b].indices.length === total) continue; // banda entera
        expect(
          cyclicRuns(layout, band, b),
          `seed ${seed}, lote ${b} (banda ${band}) cae en trozos sueltos: el `
          + 'jugador no puede leer el frente. Ver la nota de mitades contiguas '
          + 'en generateArenaLayout.',
        ).toBe(1);
      }
    }
  });

  it('el arco no empieza siempre en el mismo sitio (si no, el tempo se aprende)', () => {
    // Sin rotación por semilla, el primer lote empezaría SIEMPRE en el sector
    // de ángulo ~0 y caería siempre la misma mitad del disco: pasaríamos de
    // ilegible a predecible, que para el jugador es peor.
    const starts = new Set<number>();
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      if (layout.pattern !== 'sweep') continue;
      const first = layout.batches[0];
      const ring = fragmentsOfBand(layout, 3)
        .sort((a, b) => a.startAngle - b.startAngle)
        .map(f => f.index);
      if (first.indices.length === ring.length) continue; // sin split
      // Índice angular donde arranca el arco (el primero cuyo anterior no está).
      const inBatch = new Set(first.indices);
      const at = ring.findIndex((idx, i) => inBatch.has(idx) && !inBatch.has(ring[(i - 1 + ring.length) % ring.length]));
      starts.add(at);
    }
    expect(starts.size, 'el arranque del primer arco no varía con la semilla').toBeGreaterThan(3);
  });

  it('layout.pattern coincide con lo que dice la secuencia de bandas', () => {
    for (const seed of SEEDS) {
      const layout = generateArenaLayout(seed);
      const bands = layout.batches.map(b => layout.fragments[b.indices[0]].band);
      // El barrido sólo desciende de banda; cualquier subida es corte por eje.
      const derived = bands.some((b, i) => i > 0 && b > bands[i - 1]) ? 'axis-split' : 'sweep';
      expect(layout.pattern, `seed ${seed}: pattern declarado y secuencia de bandas discrepan`)
        .toBe(derived);
    }
  });
});

const golden = JSON.parse(
  readFileSync(new URL('./arena-layout-golden.json', import.meta.url), 'utf8'),
) as LayoutGolden;

const REGEN = 'Regenerar con: npm run golden:layout:write '
  + '(node --experimental-strip-types scripts/write-arena-layout-golden.mjs) '
  + 'EN EL MISMO COMMIT, y explicar el cambio de terreno en BUILD_LOG.md.';

describe('arena layout — golden por hash', () => {
  it('el fichero golden está en la versión y las semillas esperadas', () => {
    expect(golden.version, `formato del golden distinto del que sabe leer el test. ${REGEN}`)
      .toBe(GOLDEN_VERSION);
    expect(Object.keys(golden.seeds).map(Number)).toEqual(GOLDEN_SEEDS);
  });

  it(`el hash de fragments+batches coincide para las ${GOLDEN_SEEDS.length} semillas`, () => {
    const diverged: string[] = [];
    for (const seed of GOLDEN_SEEDS) {
      const layout = generateArenaLayout(seed);
      const actual = hashLayout(layout);
      const expected = golden.seeds[String(seed)];
      if (actual !== expected) {
        diverged.push(
          `seed ${seed}: esperado ${expected}, obtenido ${actual} `
          + `(${layout.fragments.length} fragmentos, ${layout.batches.length} tandas)`,
        );
      }
    }
    expect(
      diverged,
      `EL TERRENO HA CAMBIADO en ${diverged.length}/${GOLDEN_SEEDS.length} semillas:\n`
      + `${diverged.slice(0, 12).join('\n')}\n`
      + `Si el cambio es INTENCIONAL: ${REGEN}\n`
      + 'Si no lo es, algo ha tocado FRAG o generateArenaLayout sin querer.',
    ).toEqual([]);
  });
});
