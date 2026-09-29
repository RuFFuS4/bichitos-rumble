// ---------------------------------------------------------------------------
// Fondo v2 — colocación del cielo (módulo HOJA, sin DOM ni escena)
// ---------------------------------------------------------------------------
//
// Plan: docs/DIORAMAS.md §«Fondo v2 — la isla en el cielo». Aquí se decide
// DÓNDE va cada nube e islote y de qué color; `arena-backdrop.ts` solo lo
// convierte en mallas. Separado a propósito:
//
//   · Es una HOJA: importa `three` y tipos, nada relativo en tiempo de
//     ejecución. Node no resuelve imports relativos sin extensión, así que
//     es la única forma de que la CLI sin navegador (F4, `arena-sky.mjs`,
//     `node --experimental-strip-types`) pueda cargarlo tal cual. Por eso
//     la sal y la cámara llegan por parámetro y mulberry32 va copiado.
//   · Es determinista: mismo (seed, look, sky) → mismas instancias y mismo
//     hash en todos los clientes. Un stream por capa (seed ^ salt ^ capa),
//     nunca el del generador de layout (gameplay, golden).
//
// EL PASILLO DEL CANTO. La cámara de juego no rota nunca, así que se sabe
// de antemano qué parte del cuadro ocupa el disco: se proyecta su labio
// desde la pose de juego y se ensancha un margen. Todo lo CLARO que toque
// ese pasillo se descarta: detrás del canto solo puede haber cúpula
// (color de pozo) o nubes oscuras. Aguanta el colapso por construcción:
// caer un sector solo encoge la silueta y destapa pasillo.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { BackdropLookConfig, PackSky, SkyFirma } from './arena-look';

/**
 * Altura de la corona de cada firma, en radios del islote (fondo v2, F1).
 * Es la ÚNICA fuente: la colocación la usa para que la esfera del pasillo
 * envuelva islote + corona, y los constructores de `arena-backdrop.ts`
 * escalan su geometría a esta altura.
 */
export const FIRMA_CROWN_HEIGHT: Record<SkyFirma, number> = {
  atoll: 1.5,     // palmera
  canopy: 1.25,   // copas apiladas
  iceberg: 0.55,  // tapa de nieve y agujas de hielo
  mesa: 0.35,     // hito de piedras
  torii: 1.35,    // torii
};

/** Cuánto oscurece la luz horneada la cara en sombra de un bulto de nube,
 *  por unidad de `cloudShade`. La comparten el constructor del bulto
 *  (arena-backdrop) y el contrato del pozo, que necesita saber lo más
 *  oscuro que llega a pintar un bulto. */
export const BUMP_SHADE_SPAN = 0.45;

/** Vida (F2) por firma: si vuela en órbita o cae, y si planea (buitres:
 *  mayores y con poco aleteo). */
export const LIFE_BY_FIRMA: Record<SkyFirma, { kind: 'orbit' | 'fall'; glide: boolean }> = {
  atoll: { kind: 'orbit', glide: false },   // gaviotas
  mesa: { kind: 'orbit', glide: true },     // buitres
  canopy: { kind: 'fall', glide: false },   // hojas
  iceberg: { kind: 'fall', glide: false },  // nieve
  torii: { kind: 'fall', glide: false },    // pétalos
};
/** Semieje Z del balanceo de lo que cae, en fracción de su radio (el X es
 *  el radio entero). */
export const LIFE_SWAY_Z = 0.7;
/** Radio de la esfera que envuelve cualquier geometría de vida, en
 *  unidades de `lifeSize`: media envergadura de la uve (1) con las puntas
 *  a 0,3 de alto. Los rombos y el octaedro caben dentro. */
export const LIFE_ELEMENT_RADIUS = 1.05;

/** Cota (fracción del alto de la panza) a la que nacen las lianas de la
 *  maceta. La comparten la colocación y el constructor, que las pone en la
 *  pared del islote a esa cota y no dentro. */
export const LIANA_ATTACH_T = 0.35;

/** Pose de cámara para el pasillo y la prueba de encuadre. */
export interface SkyCamera {
  position: readonly [number, number, number];
  lookAt: readonly [number, number, number];
  fovDeg: number;
  /** Aspecto de referencia para "dentro del cuadro" (16:9). */
  aspect: number;
}

/** Una instancia: posición, escala, giro en Y y color LINEAL (el espacio
 *  de trabajo de three: `instanceColor` se multiplica tal cual). */
export interface SkyInstance {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rotY: number;
  r: number; g: number; b: number;
}

/**
 * F2: un elemento de vida. Solo su trayectoria; la posición de cada
 * fotograma la calcula `arena-backdrop` con el reloj de la partida.
 *  · `orbit`: planea en un círculo de radio `radius` alrededor de
 *    (x, y, z); el signo de `speed` es el sentido de giro.
 *  · `fall`: cae de `y` a `y − span` por la columna (x, z), balanceándose
 *    `radius`, y vuelve a empezar arriba.
 */
export interface SkyLife {
  kind: 'orbit' | 'fall';
  x: number; y: number; z: number;
  radius: number;
  span: number;
  /** Fase inicial (rad) y multiplicador de la velocidad del look. */
  phase: number;
  speed: number;
}

export interface SkyLayout {
  near: SkyInstance[];
  neck: SkyInstance[];
  far: SkyInstance[];
  islets: SkyInstance[];
  /** F1: la corona de cada islote (su posición es la tapa del islote) y lo
   *  que cuelga (cascada, liana o carámbanos), y los jirones de C1. */
  coronas: SkyInstance[];
  hangs: SkyInstance[];
  wisps: SkyInstance[];
  /** F2: torres de cúmulo (malla propia, gira entera) y fondo del pozo. */
  towers: SkyInstance[];
  pitFloor: SkyInstance[];
  /** F2: la malla de bultos con panza (cercanas, cuello, jirones y fondo
   *  del pozo) partida en dos: lo que gira con la deriva y lo que no. Son
   *  las mismas instancias que las listas de arriba, repartidas. */
  cloudsStill: SkyInstance[];
  cloudsDrift: SkyInstance[];
  life: SkyLife[];
  /** Rocas del camino de toriis (kitsune); 0 si no cupo ningún rumbo. */
  toriiPath: number;
  /** Paradas de la cúpula [elevación °, color hex sRGB], de +90 a −90. */
  domeStops: Array<[number, number]>;
  /** Límites del pasillo en elevación (°): lo que la cúpula pinta de pozo. */
  corridorTopDeg: number;
  corridorBottomDeg: number;
  rejected: {
    nearCorridor: number; nearSparse: number; far: number; islets: number;
    wisps: number; hangsShortened: number; hangsDropped: number;
    /** F2: torres en el cuadro de juego, nubes que se quedan quietas porque
     *  su arco de deriva toca el pasillo, y trayectorias de vida que lo
     *  tocan (o atraviesan un islote). */
    towers: number; driftHeld: number; life: number;
  };
  isletsInFrame: number;
  /** F2: elementos de vida dentro del cuadro de juego. */
  lifeInFrame: number;
  /** Lo que rompe el contrato del pozo detrás del canto (plan §4/§8): el
   *  propio `abyss` fuera de su techo (pozo oscuro) o de su suelo (pozo
   *  claro), y cada nube del cuello que toque el pasillo y lo incumpla.
   *  Tiene que ser 0. Las claras que tocan el pasillo ni se colocan. */
  corridorViolations: number;
  /** Radio horizontal más lejano que alcanza una instancia (u). Tiene que
   *  quedar dentro de la cúpula con margen para la cámara de victoria. */
  maxExtent: number;
  hash: string;
}

export interface SkyLayoutParams {
  look: BackdropLookConfig;
  sky: PackSky;
  /** Color del horizonte = fogColor del pack. */
  horizon: number;
  seed: number;
  salt: number;
  /** Radio del labio del disco (FRAG.maxRadius). */
  lipRadius: number;
  camera: SkyCamera;
}

// --- Utilidades puras -------------------------------------------------------

function mulberry32(a: number): () => number {
  let t = a | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Ruido de valor 2D en [0,1], suave, con la red hasheada por semilla. */
function valueNoise(seed: number): (x: number, z: number) => number {
  const cell = (i: number, j: number) => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z);
    const fx = x - i, fz = z - j;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = lerp(cell(i, j), cell(i + 1, j), ux);
    const b = lerp(cell(i, j + 1), cell(i + 1, j + 1), ux);
    return lerp(a, b, uz);
  };
}

/** Luma Rec.601 en sRGB 0-255 de un color lineal: la misma escala que las
 *  medidas de luminancia del plan (L de la arena, techos del pozo). */
export function srgbLuma(c: THREE.Color): number {
  const tmp = c.clone().convertLinearToSRGB();
  return 255 * (0.299 * tmp.r + 0.587 * tmp.g + 0.114 * tmp.b);
}

// --- La cámara de juego como proyector --------------------------------------

interface Projector {
  /** Posición de la cámara. */
  P: THREE.Vector3;
  /** Coordenadas gnómicas (x/z, y/z en espacio de cámara) y profundidad. */
  project(x: number, y: number, z: number): { u: number; v: number; depth: number };
  distanceTo(x: number, y: number, z: number): number;
  /** Elevación (°) del rayo desde la cámara a un punto. */
  elevationDeg(x: number, y: number, z: number): number;
}

function makeProjector(cam: SkyCamera): Projector {
  const P = new THREE.Vector3(...cam.position);
  const f = new THREE.Vector3(...cam.lookAt).sub(P).normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  const v = new THREE.Vector3();
  return {
    P,
    project(x, y, z) {
      v.set(x - P.x, y - P.y, z - P.z);
      const depth = v.dot(f);
      return { u: v.dot(r) / depth, v: v.dot(u) / depth, depth };
    },
    distanceTo(x, y, z) { return Math.hypot(x - P.x, y - P.y, z - P.z); },
    elevationDeg(x, y, z) {
      const dx = x - P.x, dy = y - P.y, dz = z - P.z;
      return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    },
  };
}

/** Silueta del labio vista desde la cámara: el polígono en el plano de
 *  imagen (para saber si un punto cae DENTRO del disco), los rayos
 *  unitarios del labio (para medir la distancia al canto EN ÁNGULO) y sus
 *  elevaciones extremas (para la cúpula). */
function lipSilhouette(proj: Projector, lipRadius: number) {
  const N = 256;
  const poly: Array<[number, number]> = [];
  const rays = new Float64Array(N * 3);
  const center = new THREE.Vector3().sub(proj.P).normalize();   // hacia el eje del disco
  let top = -90, bottom = 90, maxAngle = 0;
  const d = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * lipRadius, z = Math.sin(a) * lipRadius;
    const q = proj.project(x, 0, z);
    poly.push([q.u, q.v]);
    d.set(x, 0, z).sub(proj.P).normalize();
    rays[i * 3] = d.x; rays[i * 3 + 1] = d.y; rays[i * 3 + 2] = d.z;
    maxAngle = Math.max(maxAngle, d.angleTo(center));
    const e = proj.elevationDeg(x, 0, z);
    top = Math.max(top, e);
    bottom = Math.min(bottom, e);
  }
  return { poly, rays, center, maxAngle, topDeg: top, bottomDeg: bottom };
}

function pointInPolygon(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Centro y seis puntos extremos de una esfera unidad: la prueba de si una
 *  esfera cae entera dentro o fuera del cuadro (deriva, F2). */
const SPHERE_PROBES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Radio de la esfera que envuelve un bulto de nube (media esfera de
 *  base plana, alto 0,75·sy), centrada a media altura. */
const bumpEnvelope = (sx: number, sy: number, sz: number) => Math.hypot(Math.max(sx, sz), 0.375 * sy);

// --- Colocación ---------------------------------------------------------------

export function layoutSky(p: SkyLayoutParams): SkyLayout {
  const { look, sky, seed, salt, lipRadius } = p;
  const proj = makeProjector(p.camera);
  const sil = lipSilhouette(proj, lipRadius);
  const marginRad = (look.corridorMarginDeg * Math.PI) / 180;
  const tanHalf = Math.tan((p.camera.fovDeg * Math.PI) / 360);
  const dir = new THREE.Vector3();

  /**
   * ¿Toca la esfera (centro, radio) el pasillo del canto? En ÁNGULO: la
   * distancia angular mínima entre el rayo al centro y los rayos del labio,
   * menos el radio angular de la esfera, contra el margen δ. (Medirlo en
   * el plano de imagen, como se hizo primero, estrechaba el pasillo fuera
   * del eje: bultos a 1,6° del labio con δ = 2,5°.)
   */
  const touchesCorridor = (x: number, y: number, z: number, rad: number): boolean => {
    dir.set(x, y, z).sub(proj.P);
    const dist = dir.length();
    dir.divideScalar(dist);
    const alpha = Math.asin(Math.min(1, rad / dist));
    // Descarte barato: más lejos del eje del disco que cualquier punto del labio.
    if (dir.angleTo(sil.center) > sil.maxAngle + alpha + marginRad) return false;
    const q = proj.project(x, y, z);
    if (q.depth > 0.1 && pointInPolygon(q.u, q.v, sil.poly)) return true;   // detrás del disco
    let best = -1;
    for (let i = 0; i < sil.rays.length; i += 3) {
      best = Math.max(best, dir.x * sil.rays[i]! + dir.y * sil.rays[i + 1]! + dir.z * sil.rays[i + 2]!);
    }
    return Math.acos(Math.min(1, best)) < alpha + marginRad;
  };
  const inFrame = (x: number, y: number, z: number): boolean => {
    const q = proj.project(x, y, z);
    return q.depth > 0.1 && Math.abs(q.u) < tanHalf * p.camera.aspect && Math.abs(q.v) < tanHalf;
  };
  const layerRand = (id: string) => mulberry32(seed ^ salt ^ hashStr(id));

  const horizon = new THREE.Color(p.horizon);
  const abyss = new THREE.Color(sky.abyss);
  const haze = (r: number) => smoothstep(look.hazeStartR, look.hazeEndR, r);
  const tmp = new THREE.Color();
  const push = (out: SkyInstance[], x: number, y: number, z: number,
    sx: number, sy: number, sz: number, rotY: number, c: THREE.Color) => {
    out.push({ x, y, z, sx, sy, sz, rotY, r: c.r, g: c.g, b: c.b });
  };

  // Contrato del pozo (plan §4/§8): con pozo oscuro, lo que hay detrás del
  // canto no pasa del TECHO de luma del pack; con pozo claro, no baja del
  // SUELO. `corridorViolations` cuenta lo que lo incumple.
  let corridorViolations = 0;
  const breaksPit = (c: THREE.Color) => sky.pit === 'dark'
    ? srgbLuma(c) > sky.abyssCeiling
    : srgbLuma(c) < sky.abyssFloor;
  if (breaksPit(abyss)) corridorViolations++;   // la cúpula pinta `abyss` en todo el pasillo
  // Un BULTO con panza pinta entre su instanceColor (cima al sol: techo del
  // pozo oscuro) y ese color por `minShade` (panza en sombra: suelo del pozo
  // claro). Contar solo el instanceColor dejaba el cuello y el fondo del
  // pozo de jungle por debajo de su suelo sin contarlo (revisión F2).
  const minShade = look.cloudBelly * (1 - look.cloudShade * BUMP_SHADE_SPAN);
  const shaded = new THREE.Color();
  const bumpBreaksPit = (c: THREE.Color) => sky.pit === 'dark'
    ? breaksPit(c)
    : breaksPit(shaded.copy(c).multiplyScalar(minShade));
  // En pozo claro, los bultos oscuros de color de pozo salen de `abyss` por
  // este factor: el menor que deja su panza en sombra sobre el suelo.
  let lightK = 1;
  if (sky.pit === 'light') {
    while (lightK < 2 && bumpBreaksPit(tmp.copy(abyss).multiplyScalar(lightK))) lightK += 0.01;
  }

  // --- C2: mar de nubes cercano, abierto en cráter por el pasillo --------
  // Cada candidato es un CÚMULO: un bulto principal y 2-3 satélites más
  // bajos a su alrededor (con bultos sueltos, vistos desde arriba, se leían
  // como discos). Se generan todos y se conservan EXACTAMENTE
  // round(coverage·N), los de más ruido: la cobertura es la misma en todas
  // las semillas y el ruido sigue haciendo bancos y claros. El pasillo se
  // comprueba bulto a bulto.
  const near: SkyInstance[] = [];
  let nearCorridor = 0, nearSparse = 0;
  {
    const rand = layerRand('near');
    const noise = valueNoise(seed ^ salt ^ hashStr('near-noise'));
    const cloudTop = new THREE.Color(sky.cloudTop);
    const candidates: Array<{ n: number; r: number; bright: number; bumps: Array<[number, number, number, number]> }> = [];
    for (let i = 0; i < look.nearCount; i++) {
      const r = Math.sqrt(lerp(look.nearRMin ** 2, look.nearRMax ** 2, rand()));
      const a = rand() * Math.PI * 2;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const grow = (r - look.nearRMin) / (look.nearRMax - look.nearRMin);
      const main = lerp(look.nearSizeMin, look.nearSizeMax, grow) * (0.8 + 0.4 * rand());
      // Jitter solo hacia abajo: las cimas nunca suben de nearTopYOut (−48).
      const topY = lerp(look.nearTopYIn, look.nearTopYOut, smoothstep(look.nearRMin, look.nearRiseR, r))
        - rand() * 6;
      const bright = 0.94 + 0.06 * rand();
      const sats = 2 + Math.floor(rand() * 2);
      const bumps: Array<[number, number, number, number]> = [[cx, topY, cz, main]];
      for (let k = 0; k < sats; k++) {
        const sa = rand() * Math.PI * 2;
        const ss = main * (0.5 + 0.25 * rand());
        const sd = main * (0.6 + 0.3 * rand());
        bumps.push([cx + Math.cos(sa) * sd, topY - main * (0.1 + 0.15 * rand()), cz + Math.sin(sa) * sd, ss]);
      }
      candidates.push({ n: noise(cx / look.nearClusterScale, cz / look.nearClusterScale), r, bright, bumps });
    }
    const keep = Math.round(Math.min(1, Math.max(0, sky.coverage)) * candidates.length);
    const order = candidates.map((_, i) => i).sort((i, j) => candidates[j]!.n - candidates[i]!.n || i - j);
    for (let rank = 0; rank < order.length; rank++) {
      const c = candidates[order[rank]!]!;
      if (rank >= keep) { nearSparse += c.bumps.length; continue; }
      tmp.copy(cloudTop).multiplyScalar(c.bright).lerp(horizon, haze(c.r));
      for (const [x, ty, z, s] of c.bumps) {
        const h = 0.75 * s;
        if (touchesCorridor(x, ty - h / 2, z, bumpEnvelope(s, s, s))) { nearCorridor++; continue; }
        // Sin giro: la luz de la key va horneada en el bulto (arena-backdrop).
        push(near, x, ty - h, z, s, s, s, 0, tmp);
      }
    }
  }

  // --- Cuello: nubes en sombra alrededor de la punta del cono -------------
  // Color de pozo: pueden estar dentro del pasillo, pero cuentan como
  // violación si rompen el contrato del pozo. En juego asoman bajo el labio
  // frontal y por los lados, al pie del cuadro (lo prevé el plan §5).
  const neck: SkyInstance[] = [];
  {
    const rand = layerRand('neck');
    for (let i = 0; i < look.neckCount; i++) {
      const r = Math.sqrt(lerp(look.neckRMin ** 2, look.neckRMax ** 2, rand()));
      const a = rand() * Math.PI * 2;
      // `topY` es la CIMA: el cuello entero queda entre neckYMin y neckYMax.
      const topY = lerp(look.neckYMin, look.neckYMax, rand());
      const s = lerp(look.neckSizeMin, look.neckSizeMax, rand());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = 0.75 * s;
      // En sombra en pozo oscuro; en pozo claro, algo más claros que él.
      const k = rand();
      tmp.copy(abyss).multiplyScalar(sky.pit === 'dark' ? 0.88 + 0.12 * k : lightK * (1 + 0.12 * k));
      if (touchesCorridor(x, topY - h / 2, z, bumpEnvelope(s * 1.3, s, s)) && bumpBreaksPit(tmp)) corridorViolations++;
      push(neck, x, topY - h, z, s * 1.3, s, s, 0, tmp);
    }
  }

  // --- C3: nubes lejanas, color plano que acaba siendo horizonte puro -----
  // No se ven en juego (plan §5): se descarta todo bulto cuyo contorno caiga
  // en el cuadro 16:9 de juego.
  const far: SkyInstance[] = [];
  let farRejected = 0;
  {
    const rand = layerRand('far');
    const cloudFar = new THREE.Color(sky.cloudFar);
    for (let i = 0; i < look.farCount; i++) {
      const r = Math.sqrt(lerp(look.farRMin ** 2, look.farRMax ** 2, rand()));
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = lerp(look.farSizeMin, look.farSizeMax, rand());
      const topY = lerp(look.farTopYMin, look.farTopYMax, rand());
      const squash = 0.7 + 0.6 * rand();
      const rotY = rand() * Math.PI * 2;
      // El estiramiento no puede pasar de farSizeMax en ningún semieje.
      const k = Math.min(1, look.farSizeMax / (s * Math.max(squash, 1 / squash)));
      const sx = s * k * squash, sz = (s * k) / squash;
      // Aplastadas: un bulto lejano entero colgaba 20-34 u por debajo de su
      // cima, hasta donde la cúpula ya es pozo, y su color de horizonte se
      // recortaba ahí como una losa clara (visto con la cámara baja).
      const sy = s * look.farFlatten;
      const h = 0.75 * sy;
      const baseY = topY - h;
      let visibleInGame = inFrame(x, topY, z);
      for (let j = 0; j < 12 && !visibleInGame; j++) {
        const t = (j / 12) * Math.PI * 2;
        const lx = Math.cos(t) * sx, lz = Math.sin(t) * sz;
        visibleInGame = inFrame(
          x + lx * Math.cos(rotY) + lz * Math.sin(rotY), baseY,
          z - lx * Math.sin(rotY) + lz * Math.cos(rotY));
      }
      if (visibleInGame || touchesCorridor(x, baseY + h / 2, z, bumpEnvelope(sx, sy, sz))) { farRejected++; continue; }
      tmp.copy(cloudFar).lerp(horizon, haze(r));
      push(far, x, baseY, z, sx, sy, sz, rotY, tmp);
    }
  }

  // --- Islotes hermanos: la escala del mundo -------------------------------
  // F1: cada islote lleva la FIRMA de su bioma — una corona encima y lo que
  // cuelga debajo — y su forma (lados, punta, alto) es la del bioma. La
  // esfera del pasillo envuelve islote + corona; lo que cuelga se comprueba
  // aparte porque llega mucho más abajo.
  const islets: SkyInstance[] = [];
  const coronas: SkyInstance[] = [];
  const hangs: SkyInstance[] = [];
  let isletRejected = 0, isletsInFrame = 0, hangsShortened = 0, hangsDropped = 0;
  const crown = FIRMA_CROWN_HEIGHT[sky.firma];
  const placed: Array<{ x: number; z: number; rad: number }> = [];
  const isletEnvelope = (topY: number, rad: number, h: number) => {
    const top = topY + crown * rad, bottom = topY - h;
    return { cy: (top + bottom) / 2, r: Math.hypot(rad, (top - bottom) / 2) };
  };
  /** Colgante de un islote ya colocado. Cascadas y lianas se prueban contra
   *  el pasillo como una CÁPSULA (esferas del semiancho real a lo largo de
   *  la cinta; una sola esfera que envolviera 26 u de cinta quitaba la
   *  mitad sin que tocaran nada). Si la tocan se prueba a media longitud, y
   *  si aun así, se quitan. Los carámbanos quedan dentro de la esfera del
   *  islote. */
  const ribbonTouches = (px: number, py: number, pz: number, halfW: number, len: number) => {
    const step = Math.max(0.5, halfW);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      if (touchesCorridor(px, py - (k / n) * len, pz, halfW * Math.SQRT2)) return true;
    }
    return false;
  };
  const addHang = (x: number, topY: number, z: number, rad: number, h: number, rotY: number, rand: () => number, c: THREE.Color) => {
    if (sky.firma === 'torii') return;
    if (sky.firma === 'iceberg') { push(hangs, x, topY, z, rad, rad, rad, rotY, c); return; }
    let len = sky.firma === 'canopy' ? look.lianaLen * (0.7 + 0.6 * rand()) : look.cascadeLen * (0.8 + 0.4 * rand());
    let px = x, pz = z, py = topY;
    let w = rad;            // escala X/Z de la instancia
    let halfW = rad;        // semiancho real de lo que cuelga
    if (sky.firma === 'canopy') {
      py = topY - h * LIANA_ATTACH_T;          // de la pared de la maceta
      halfW = rad * 0.9;
    } else {
      // Cascada: sale del borde de la tapa, hacia fuera del islote.
      const phi = rand() * Math.PI * 2;
      px = x + Math.cos(phi) * rad * 0.78;
      pz = z + Math.sin(phi) * rad * 0.78;
      py = topY - 0.02;
      w = rad * 0.7;
      halfW = w * 0.5;
    }
    if (!ribbonTouches(px, py, pz, halfW, len)) { push(hangs, px, py, pz, w, len, w, rotY, c); return; }
    len /= 2;
    if (!ribbonTouches(px, py, pz, halfW, len)) {
      hangsShortened++;
      push(hangs, px, py, pz, w, len, w, rotY, c);
      return;
    }
    hangsDropped++;
  };
  // --- Camino de toriis (kitsune): el elemento propio del santuario -------
  // Rocas con torii que bajan en fila hacia el abismo, cada vez más hondas
  // y más pequeñas. Se busca un rumbo en el que el camino entero quede
  // fuera del pasillo y con al menos tres rocas dentro del cuadro de juego;
  // si ninguno cabe, no hay camino (se cuenta en `toriiPath`). Va ANTES que
  // los islotes normales, que son los que lo esquivan: al revés, le
  // quitaban su única ventana y faltaba en la mitad de las semillas.
  let toriiPath = 0;
  if (sky.firma === 'torii' && look.toriiPathCount > 1) {
    const rand = layerRand('torii-path');
    const start = rand() * Math.PI * 2;
    const N = look.toriiPathCount;
    for (let k = 0; k < 36 && toriiPath === 0; k++) {
      const a0 = start + (k / 36) * Math.PI * 2;
      const steps: Array<{ x: number; y: number; z: number; rad: number; h: number }> = [];
      let inView = 0;
      let ok = true;
      for (let i = 0; i < N && ok; i++) {
        const t = i / (N - 1);
        const a = a0 + Math.sin(t * Math.PI) * 0.12;           // una leve curva
        const r = lerp(look.toriiPathR0, look.toriiPathR1, t);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y = lerp(look.toriiPathY0, look.toriiPathY1, t);
        const rad = look.toriiRockRadius * (1 - 0.35 * t);
        const h = rad * sky.isletDepth;
        const env = isletEnvelope(y, rad, h);
        if (touchesCorridor(x, env.cy, z, env.r)) { ok = false; break; }
        if (inFrame(x, env.cy, z)) inView++;
        steps.push({ x, y, z, rad, h });
      }
      if (!ok || inView < 3) continue;
      steps.forEach((st, i) => {
        placed.push({ x: st.x, z: st.z, rad: st.rad });
        const depthT = Math.min(1, Math.max(0, (look.isletTopYMax - st.y) / (look.isletTopYMax - look.isletTopYMin)));
        tmp.setScalar(1 - look.isletDepthDarken * depthT);
        // Cada puerta CRUZA su tramo del camino: el paso del torii (su Z
        // local) apunta al rumbo local, que se curva. Ry(θ) lleva Z a
        // (sen θ, 0, cos θ), así que θ = atan2(dx, dz).
        const prev = steps[Math.max(0, i - 1)]!, next = steps[Math.min(steps.length - 1, i + 1)]!;
        const rotY = Math.atan2(next.x - prev.x, next.z - prev.z);
        push(islets, st.x, st.y, st.z, st.rad, st.h, st.rad, rotY, tmp);
        push(coronas, st.x, st.y, st.z, st.rad, st.rad, st.rad, rotY, tmp);
      });
      toriiPath = steps.length;
    }
  }

  {
    const rand = layerRand('islets');
    for (let attempt = 0; attempt < 600 && islets.length < look.isletCount; attempt++) {
      const r = lerp(look.isletRMin, look.isletRMax, rand());
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const topY = lerp(look.isletTopYMin, look.isletTopYMax, rand());
      const rad = lerp(look.isletRadiusMin, look.isletRadiusMax, rand());
      const h = rad * sky.isletDepth;
      const rotY = rand() * Math.PI * 2;
      const env = isletEnvelope(topY, rad, h);
      const visible = inFrame(x, env.cy, z);
      // Primero se llenan los que tienen que verse en juego.
      if (isletsInFrame < look.isletMinInFrame && !visible) continue;
      if (touchesCorridor(x, env.cy, z, env.r)
        || placed.some(o => Math.hypot(o.x - x, o.z - z) < o.rad + rad + 4)) {
        isletRejected++;
        continue;
      }
      placed.push({ x, z, rad });
      if (visible) isletsInFrame++;
      const depthT = (look.isletTopYMax - topY) / (look.isletTopYMax - look.isletTopYMin);
      tmp.setScalar(1 - look.isletDepthDarken * depthT);
      push(islets, x, topY, z, rad, h, rad, rotY, tmp);
      if (crown > 0) push(coronas, x, topY, z, rad, rad, rad, rotY, tmp);
      addHang(x, topY, z, rad, h, rotY, rand, tmp);
    }
  }

  // --- Jirones (C1): el aire entre la isla y el mar -----------------------
  // Bultos pequeños a media profundidad; el pasillo los deja solo en las
  // alas y las esquinas del cuadro. Misma malla que C2 (0 draw calls).
  const wisps: SkyInstance[] = [];
  let wispCorridor = 0;
  {
    const rand = layerRand('wisps');
    const cloudTop = new THREE.Color(sky.cloudTop);
    for (let i = 0; i < look.wispCount; i++) {
      const r = Math.sqrt(lerp(look.wispRMin ** 2, look.wispRMax ** 2, rand()));
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const topY = lerp(look.wispYMin, look.wispYMax, rand());
      const s = lerp(look.wispSizeMin, look.wispSizeMax, rand());
      const stretch = 1.4 + 0.8 * rand();                          // alargados: jirón, no bola
      const bright = 0.9 + 0.1 * rand();
      const h = 0.75 * s * 0.6;
      if (touchesCorridor(x, topY - h / 2, z, bumpEnvelope(s * stretch, s * 0.6, s))) { wispCorridor++; continue; }
      tmp.copy(cloudTop).multiplyScalar(bright).lerp(abyss, look.wispFade);
      push(wisps, x, topY - h, z, s * stretch, s * 0.6, s, 0, tmp);
    }
  }

  // --- F2: torres de cúmulo en el horizonte --------------------------------
  // Pilas de bultos que se estrechan hacia arriba. Desde la cámara de juego
  // quedan por encima del techo del cuadro; se ven con la cámara baja y en
  // la pantalla final, donde el cielo era plano. Se funden con el horizonte
  // solo hasta `towerHaze`: del todo, no se verían.
  const towers: SkyInstance[] = [];
  let towerRejected = 0;
  {
    const rand = layerRand('towers');
    const cloudTop = new THREE.Color(sky.cloudTop);
    // Un rumbo por sector (con holgura de medio sector), no al azar: la
    // victoria mira hacia donde mire el ganador (≈71° de ancho), y con
    // rumbos al azar podía no caer ninguna torre en el cuadro.
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < look.towerCount; i++) {
      const r = lerp(look.towerRMin, look.towerRMax, rand());
      const a = a0 + ((i + 0.5 + (rand() - 0.5) * 0.5) / look.towerCount) * Math.PI * 2;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const H = lerp(look.towerHeightMin, look.towerHeightMax, rand());
      const levels = 5 + Math.floor(rand() * 2);
      const topSize = look.towerBaseSize * 0.45;
      const bumps: Array<[number, number, number, number]> = [];
      for (let k = 0; k < levels; k++) {
        const f = k / (levels - 1);
        const s = look.towerBaseSize * (1 - 0.55 * f);
        const y = look.towerBaseY + f * (H - 0.75 * topSize);
        // Dos bultos por piso, a lados opuestos del eje y de tamaño
        // distinto: la silueta sale en coliflor y no en pisos.
        const phi = rand() * Math.PI * 2;
        const d = 0.4 * s;
        bumps.push([cx + Math.cos(phi) * d, y, cz + Math.sin(phi) * d, s * (0.8 + 0.2 * rand())]);
        const phi2 = phi + Math.PI + (rand() - 0.5) * 1.2;
        bumps.push([cx + Math.cos(phi2) * d, y - 0.15 * s, cz + Math.sin(phi2) * d, s * (0.6 + 0.2 * rand())]);
      }
      // Ningún bulto en el cuadro de juego (ni con la deriva: ver la nota de
      // `towerCount`, es por geometría) ni en el pasillo.
      if (bumps.some(([x, y, z, s]) => inFrame(x, y, z) || inFrame(x, y + 0.75 * s, z)
        || touchesCorridor(x, y + 0.375 * s, z, bumpEnvelope(s, s, s)))) {
        towerRejected++;
        continue;
      }
      tmp.copy(cloudTop).lerp(horizon, look.towerHaze);
      for (const [x, y, z, s] of bumps) push(towers, x, y, z, s, s, s, 0, tmp);
    }
  }

  // --- F2: fondo del pozo ---------------------------------------------------
  // Bultos del color del abismo muy abajo, bajo la isla y alrededor: el pozo
  // deja de ser un color liso (riesgo 2). Se separan del `abyss` solo hacia
  // el lado seguro del contrato, así que detrás del canto lo cumplen por
  // construcción (y si no, se cuenta).
  const pitFloor: SkyInstance[] = [];
  {
    const rand = layerRand('pit-floor');
    for (let i = 0; i < look.pitFloorCount; i++) {
      const r = Math.sqrt(rand()) * look.pitFloorRMax;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const topY = lerp(look.pitFloorYMin, look.pitFloorYMax, rand());
      const s = lerp(look.pitFloorSizeMin, look.pitFloorSizeMax, rand());
      const k = look.pitFloorVary * rand();
      tmp.copy(abyss).multiplyScalar(sky.pit === 'dark' ? 1 - k : lightK * (1 + k));
      const h = 0.75 * s;
      if (touchesCorridor(x, topY - h / 2, z, bumpEnvelope(s * 1.2, s, s)) && bumpBreaksPit(tmp)) corridorViolations++;
      push(pitFloor, x, topY - h, z, s * 1.2, s, s, 0, tmp);
    }
  }

  // --- F2: deriva ------------------------------------------------------------
  // Qué bultos de la malla con panza giran alrededor del eje durante la
  // partida. Los CLAROS (cercanas y jirones) solo si en ningún punto del
  // arco en el que van y vienen (`driftCheckDeg`: la deriva es una onda
  // triangular dentro de él; se prueba cada grado)
  //   · tocan el pasillo, ni
  //   · cruzan el borde del cuadro de juego: o están enteros dentro todo el
  //     arco o enteros fuera. Si no, la deriva mete y saca nubes claras del
  //     cuadro y la cantidad de fondo claro deja de ser la medida: con la
  //     semilla 7 a 15° entraban cúmulos por la derecha y el fondo claro
  //     pasaba del 7,8 al 10,7 % (decisión 1: ≤8 %).
  // Comprobar la órbita entera
  // dejaría quieto casi todo C2. El fondo del pozo gira siempre: es oscuro
  // y puede estar en el pasillo. El cuello no: abraza el cono, y la isla no
  // se mueve.
  const driftSteps = Math.max(1, Math.ceil(look.driftCheckDeg));
  /** 1 si la esfera cae entera dentro del cuadro, −1 si entera fuera, 0 si
   *  cruza el borde (centro y seis puntos extremos). */
  const frameSide = (x: number, y: number, z: number, rad: number) => {
    let inside = 0;
    for (const [dx, dy, dz] of SPHERE_PROBES) if (inFrame(x + dx * rad, y + dy * rad, z + dz * rad)) inside++;
    return inside === SPHERE_PROBES.length ? 1 : inside === 0 ? -1 : 0;
  };
  const canDrift = (it: SkyInstance) => {
    const cy = it.y + 0.375 * it.sy;
    const env = bumpEnvelope(it.sx, it.sy, it.sz);
    const side = frameSide(it.x, cy, it.z, env);
    if (side === 0) return false;
    for (let k = 1; k <= driftSteps; k++) {
      const th = ((k / driftSteps) * look.driftCheckDeg * Math.PI) / 180;
      const c = Math.cos(th), sn = Math.sin(th);
      // Mismo sentido que el giro de la malla en arena-backdrop (rotation.y = +θ).
      const x = it.x * c + it.z * sn, z = -it.x * sn + it.z * c;
      if (touchesCorridor(x, cy, z, env) || frameSide(x, cy, z, env) !== side) return false;
    }
    return true;
  };
  const cloudsStill: SkyInstance[] = [...neck];
  const cloudsDrift: SkyInstance[] = [...pitFloor];
  let driftHeld = 0;
  for (const it of [...near, ...wisps]) {
    if (canDrift(it)) cloudsDrift.push(it);
    else { cloudsStill.push(it); driftHeld++; }
  }

  // --- F2: vida ---------------------------------------------------------------
  // Lo que se mueve en el aire, según la firma: aves que planean en círculo
  // por debajo de la isla (gaviotas en coral, buitres en el desierto) o
  // cosas que caen al vacío (hojas, nieve, pétalos). Toda trayectoria se
  // prueba entera contra el pasillo —la vida nunca pasa por detrás del
  // canto— y contra los islotes, que no atraviesa.
  const life: SkyLife[] = [];
  let lifeRejected = 0, lifeInFrame = 0;
  {
    const rand = layerRand('life');
    const { kind, glide } = LIFE_BY_FIRMA[sky.firma];
    // La esfera que envuelve el elemento, a su tamaño real.
    const elemR = look.lifeSize * (glide ? look.lifeGlideScale : 1) * LIFE_ELEMENT_RADIUS;
    const ORBIT_SAMPLES = 32;
    const clearOfIslets = (x: number, z: number, pad: number) =>
      placed.every(o => Math.hypot(o.x - x, o.z - z) > o.rad + pad);
    for (let attempt = 0; attempt < 1000 && life.length < look.lifeCount; attempt++) {
      const r = lerp(look.lifeRMin, look.lifeRMax, rand());
      const a = rand() * Math.PI * 2;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const phase = rand() * Math.PI * 2;
      const speed = 0.7 + 0.6 * rand();
      if (kind === 'orbit') {
        const radius = lerp(look.lifeOrbitRMin, look.lifeOrbitRMax, rand());
        const cy = lerp(look.lifeBottomY, look.lifeTopY - 6, rand());
        // Primero se llenan los que se ven en juego (como los islotes).
        const visible = inFrame(cx, cy, cz);
        if (lifeInFrame < look.lifeMinInFrame && !visible) continue;
        // Envolvente: el elemento, el vaivén vertical y lo que el arco se
        // separa de la cuerda entre dos muestras.
        const halfGap = 2 * radius * Math.sin(Math.PI / ORBIT_SAMPLES / 2);
        const pad = elemR + look.lifeBob + halfGap;
        let ok = true;
        for (let k = 0; k < ORBIT_SAMPLES && ok; k++) {
          const t = (k / ORBIT_SAMPLES) * Math.PI * 2;
          const px = cx + Math.cos(t) * radius, pz = cz + Math.sin(t) * radius;
          ok = !touchesCorridor(px, cy, pz, pad) && clearOfIslets(px, pz, elemR + halfGap);
        }
        if (!ok) { lifeRejected++; continue; }
        if (visible) lifeInFrame++;
        life.push({ kind: 'orbit', x: cx, y: cy, z: cz, radius, span: 0, phase, speed: rand() < 0.5 ? speed : -speed });
      } else {
        const y0 = lerp(look.lifeTopY - 6, look.lifeTopY, rand());
        const span = lerp(look.lifeFallSpanMin, look.lifeFallSpanMax, rand());
        const visible = inFrame(cx, y0 - span / 2, cz);
        if (lifeInFrame < look.lifeMinInFrame && !visible) continue;
        // Envolvente: el balanceo (elipse de semiejes sway y sway·0,7), el
        // elemento y media separación entre muestras de la columna.
        const n = Math.ceil(span / 2);
        const pad = look.lifeSway * Math.hypot(1, LIFE_SWAY_Z) + elemR + span / n / 2;
        let ok = clearOfIslets(cx, cz, pad);
        for (let k = 0; k <= n && ok; k++) ok = !touchesCorridor(cx, y0 - (k / n) * span, cz, pad);
        if (!ok) { lifeRejected++; continue; }
        if (visible) lifeInFrame++;
        life.push({ kind: 'fall', x: cx, y: y0, z: cz, radius: look.lifeSway, span, phase, speed });
      }
    }
  }

  // --- Cúpula: color por latitud ------------------------------------------
  const zenith = new THREE.Color(sky.zenith);
  const skyLow = zenith.clone().lerp(horizon, 0.55);
  const topDeg = sil.topDeg + look.corridorMarginDeg;
  const bottomDeg = sil.bottomDeg - look.corridorMarginDeg;
  const domeStops: Array<[number, number]> = [
    [90, sky.zenith],
    [12, skyLow.getHex()],
    [0, p.horizon],
    [look.horizonHoldDeg, p.horizon],
    [Math.max(look.abyssStartDeg, topDeg), sky.abyss],
    [bottomDeg, sky.abyss],
    [-90, sky.abyssDeep],
  ];

  // --- Cifras -----------------------------------------------------------------
  // Se hashea lo que se DIBUJA, por malla: el reparto quieto/deriva cuenta.
  let maxExtent = 0;
  let h = 0x811c9dc5 | 0;
  const mix = (n: number) => { h = Math.imul(h ^ Math.round(n * 1e4), 0x01000193); };
  for (const list of [cloudsStill, cloudsDrift, far, islets, coronas, hangs, towers]) {
    mix(list.length);
    for (const it of list) {
      maxExtent = Math.max(maxExtent, Math.hypot(it.x, it.z) + Math.max(it.sx, it.sz));
      for (const n of [it.x, it.y, it.z, it.sx, it.sy, it.sz, it.rotY, it.r, it.g, it.b]) mix(n);
    }
  }
  for (const it of life) {
    maxExtent = Math.max(maxExtent, Math.hypot(it.x, it.z) + it.radius);
    for (const n of [it.kind === 'orbit' ? 1 : 2, it.x, it.y, it.z, it.radius, it.span, it.phase, it.speed]) mix(n);
  }

  return {
    near, neck, far, islets, coronas, hangs, wisps, towers, pitFloor, cloudsStill, cloudsDrift, life,
    toriiPath, domeStops,
    corridorTopDeg: topDeg,
    corridorBottomDeg: bottomDeg,
    rejected: {
      nearCorridor, nearSparse, far: farRejected, islets: isletRejected,
      wisps: wispCorridor, hangsShortened, hangsDropped,
      towers: towerRejected, driftHeld, life: lifeRejected,
    },
    isletsInFrame,
    lifeInFrame,
    corridorViolations,
    maxExtent,
    hash: (h >>> 0).toString(16).padStart(8, '0'),
  };
}
