// ---------------------------------------------------------------------------
// Scatter — fábrica de primitivas (geometría pura, 0 bytes de payload)
// ---------------------------------------------------------------------------
//
// docs/DIORAMAS.md parte 2, decisión 1: la densidad del diorama sale de
// formas de 2 a 36 triángulos generadas en código, no de GLB. Aquí solo
// hay geometría: ni materiales, ni colores, ni colocación (eso es del motor
// en arena-scatter.ts, y los números de cada bioma van en las recetas).
//
// Contrato de cada primitiva (arena-scatter-types.ts):
//   - altura 1 u (base en y=0, cima en y=1), salvo `decal`, que es plana;
//   - centrada en el origen del plano XZ;
//   - estilo cartoon: a 20 px por unidad de mundo (cámara de juego) el
//     detalle fino no existe, así que formas limpias y gordas.
//
// Cada geometría se construye UNA vez y se comparte entre todos los
// InstancedMesh que la usen (y entre partidas). Por eso el motor NO las
// dispone al destruirse — y por eso ninguna instancia puede colgar de un
// fragmento: arena.ts hace `geometry.dispose()` recursivo al reconstruir.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { ScatterPrimitive } from './arena-scatter-types';

/** Proporciones de cada primitiva respecto a su altura de 1 u. Es la hoja
 *  de números de la forma; la de la colocación vive en las recetas. */
export const PRIMITIVE_SHAPE = {
  /** Dos hojas en cruz. Trapecio: ancho en la base y en la punta. */
  grassCross: { baseWidth: 0.55, tipWidth: 0.16 },
  /** Tres hojas en abanico (60° entre sí), más anchas: una mata. */
  tuft: { blades: 3, baseWidth: 0.7, tipWidth: 0.22 },
  /** Icosaedro achatado: ancho respecto al alto. */
  pebble: { widthScale: 1.5 },
  /** Semiesfera ensanchada. 12 × 2 segmentos = 36 tris exactos. */
  dome: { widthSegments: 12, heightSegments: 2, widthScale: 1.3 },
  /** Bipirámide de sección cuadrada: cintura a esta altura y semiancho. */
  shard: { waistY: 0.2, waistHalfWidth: 0.26 },
  /** Rombo plano: 1 u de largo por este ancho (pétalo, hoja, mancha). */
  decal: { width: 0.6 },
  /** Cilindro tumbado a lo largo de X: 1 u de alto (cara a cara), largo
   *  en unidades de alto. */
  log: { radialSegments: 6, lengthRatio: 3.2 },
  /** Disco de la sombra de contacto instanciada. */
  shadow: { segments: 16 },
} as const;

/** Lo que el motor necesita saber de cada primitiva y no puede deducir de
 *  la malla: si es un plano (DoubleSide, sin hundir) y su altura nominal
 *  (0 = rasante: nunca la recortan los techos de SCATTER_LIMITS). */
export const PRIMITIVE_META: Record<ScatterPrimitive, { flat: boolean; height: number }> = {
  grassCross: { flat: true,  height: 1 },
  tuft:       { flat: true,  height: 1 },
  pebble:     { flat: false, height: 1 },
  dome:       { flat: false, height: 1 },
  shard:      { flat: false, height: 1 },
  decal:      { flat: true,  height: 0 },
  log:        { flat: false, height: 1 },
};

const cache = new Map<ScatterPrimitive, THREE.BufferGeometry>();
let shadowDisc: THREE.BufferGeometry | null = null;

/** Geometría compartida de una primitiva (cacheada: no la dispongas). */
export function buildPrimitive(kind: ScatterPrimitive): THREE.BufferGeometry {
  let geo = cache.get(kind);
  if (!geo) {
    geo = BUILDERS[kind]();
    geo.name = `scatter-${kind}`;
    cache.set(kind, geo);
  }
  return geo;
}

/** Disco plano (normal +Y, radio 1) para las sombras de contacto. */
export function buildShadowDisc(): THREE.BufferGeometry {
  if (!shadowDisc) {
    shadowDisc = new THREE.CircleGeometry(1, PRIMITIVE_SHAPE.shadow.segments);
    shadowDisc.rotateX(-Math.PI / 2);
    shadowDisc.name = 'scatter-shadow';
  }
  return shadowDisc;
}

/** Triángulos de una geometría (indexada o no). */
export function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  return (index ? index.count : geo.getAttribute('position').count) / 3;
}

/** Radio de la huella en XZ (para escalar la sombra de contacto). */
export function footprintRadius(geo: THREE.BufferGeometry): number {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
}

// --- Constructores ---------------------------------------------------------

const BUILDERS: Record<ScatterPrimitive, () => THREE.BufferGeometry> = {
  grassCross: () => buildBlades(2, PRIMITIVE_SHAPE.grassCross.baseWidth, PRIMITIVE_SHAPE.grassCross.tipWidth),
  tuft: () => buildBlades(PRIMITIVE_SHAPE.tuft.blades, PRIMITIVE_SHAPE.tuft.baseWidth, PRIMITIVE_SHAPE.tuft.tipWidth),
  pebble: buildPebble,
  dome: buildDome,
  shard: buildShard,
  decal: buildDecal,
  log: buildLog,
};

/**
 * `n` trapecios verticales cruzados por el eje Y, repartidos en 180°
 * (2 hojas = cruz, 3 = abanico). Cada hoja son 2 triángulos. Sin UV: el
 * material no lleva mapa, el color lo pone la instancia.
 */
function buildBlades(n: number, baseWidth: number, tipWidth: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const yaw = (Math.PI * i) / n;
    const dx = Math.cos(yaw), dz = -Math.sin(yaw);   // dirección del plano de la hoja
    const nx = Math.sin(yaw), nz = Math.cos(yaw);    // su normal
    const base = positions.length / 3;
    const hb = baseWidth / 2, ht = tipWidth / 2;
    positions.push(
      -hb * dx, 0, -hb * dz,
       hb * dx, 0,  hb * dz,
       ht * dx, 1,  ht * dz,
      -ht * dx, 1, -ht * dz,
    );
    for (let v = 0; v < 4; v++) normals.push(nx, 0, nz);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Icosaedro (20 tris, normales planas) achatado y apoyado en y=0. El
 *  icosaedro no tiene vértices en el eje Y (su alto real es 0,85 × 2R),
 *  así que se ajusta a la caja medida en vez de al radio nominal. */
function buildPebble(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const h = b.max.y - b.min.y;
  geo.translate(0, -b.min.y, 0);
  geo.scale(PRIMITIVE_SHAPE.pebble.widthScale / h, 1 / h, PRIMITIVE_SHAPE.pebble.widthScale / h);
  return geo;
}

/** Semiesfera suave (arbusto, montón de nieve, coral bola). Sin fondo: la
 *  base apoya en el suelo y el motor la hunde un poco para que la
 *  inclinación no levante el borde. */
function buildDome(): THREE.BufferGeometry {
  const s = PRIMITIVE_SHAPE.dome;
  const geo = new THREE.SphereGeometry(1, s.widthSegments, s.heightSegments, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(s.widthScale, 1, s.widthScale);
  return geo;
}

/**
 * Bipirámide de sección cuadrada: punta en y=1, cintura ancha cerca del
 * suelo y vértice inferior en y=0. 8 triángulos con normales planas —
 * lee como cristal o roca afilada que brota del suelo.
 */
function buildShard(): THREE.BufferGeometry {
  const { waistY: y, waistHalfWidth: w } = PRIMITIVE_SHAPE.shard;
  const waist = [[w, y, 0], [0, y, w], [-w, y, 0], [0, y, -w]];
  const apex = [0, 1, 0], bottom = [0, 0, 0];
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = waist[i], b = waist[(i + 1) % 4];
    positions.push(...b, ...a, ...apex);      // cara superior (CCW desde fuera)
    positions.push(...a, ...b, ...bottom);    // cara inferior
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Rombo a ras del suelo (normal +Y), 1 u de largo en Z. */
function buildDecal(): THREE.BufferGeometry {
  const hw = PRIMITIVE_SHAPE.decal.width / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.5,
    hw, 0, 0,
    0, 0, 0.5,
    -hw, 0, 0,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  return geo;
}

/** Cilindro cerrado tumbado a lo largo de X, apoyado en y=0, caras planas.
 *  6 lados con tapas = 24 tris (el contrato apuntaba 16, que sería un tubo
 *  abierto: por los extremos se vería el interior).
 *  Tumbado, el hexágono apoya una CARA en el suelo (no un filo), así que
 *  su alto es la distancia entre caras: el radio se elige para que esa
 *  distancia sea exactamente 1 u (apotema 0,5 → circunradio 0,5/cos(π/n)). */
function buildLog(): THREE.BufferGeometry {
  const s = PRIMITIVE_SHAPE.log;
  const radius = 0.5 / Math.cos(Math.PI / s.radialSegments);
  const cyl = new THREE.CylinderGeometry(radius, radius, s.lengthRatio, s.radialSegments, 1, false);
  const geo = cyl.toNonIndexed();
  cyl.dispose();
  geo.deleteAttribute('uv');
  geo.rotateZ(Math.PI / 2);
  geo.translate(0, 0.5, 0);
  geo.computeVertexNormals();
  return geo;
}
