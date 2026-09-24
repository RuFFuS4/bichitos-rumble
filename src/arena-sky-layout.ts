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
import type { BackdropLookConfig, PackSky } from './arena-look';

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

export interface SkyLayout {
  near: SkyInstance[];
  neck: SkyInstance[];
  far: SkyInstance[];
  islets: SkyInstance[];
  /** Paradas de la cúpula [elevación °, color hex sRGB], de +90 a −90. */
  domeStops: Array<[number, number]>;
  /** Límites del pasillo en elevación (°): lo que la cúpula pinta de pozo. */
  corridorTopDeg: number;
  corridorBottomDeg: number;
  rejected: { nearCorridor: number; nearSparse: number; far: number; islets: number };
  isletsInFrame: number;
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
      tmp.copy(abyss).multiplyScalar(0.88 + 0.12 * rand());
      if (touchesCorridor(x, topY - h / 2, z, bumpEnvelope(s * 1.3, s, s)) && breaksPit(tmp)) corridorViolations++;
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
  const islets: SkyInstance[] = [];
  let isletRejected = 0, isletsInFrame = 0;
  {
    const rand = layerRand('islets');
    const placed: Array<{ x: number; z: number; rad: number }> = [];
    for (let attempt = 0; attempt < 600 && islets.length < look.isletCount; attempt++) {
      const r = lerp(look.isletRMin, look.isletRMax, rand());
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const topY = lerp(look.isletTopYMin, look.isletTopYMax, rand());
      const rad = lerp(look.isletRadiusMin, look.isletRadiusMax, rand());
      const h = rad * look.isletDepthRatio;
      const rotY = rand() * Math.PI * 2;
      const visible = inFrame(x, topY - h / 2, z);
      // Primero se llenan los que tienen que verse en juego.
      if (isletsInFrame < look.isletMinInFrame && !visible) continue;
      if (touchesCorridor(x, topY - h / 2, z, Math.hypot(rad, h / 2))
        || placed.some(o => Math.hypot(o.x - x, o.z - z) < o.rad + rad + 4)) {
        isletRejected++;
        continue;
      }
      placed.push({ x, z, rad });
      if (visible) isletsInFrame++;
      const depthT = (look.isletTopYMax - topY) / (look.isletTopYMax - look.isletTopYMin);
      tmp.setScalar(1 - look.isletDepthDarken * depthT);
      push(islets, x, topY, z, rad, h, rad, rotY, tmp);
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
  let maxExtent = 0;
  let h = 0x811c9dc5 | 0;
  for (const list of [near, neck, far, islets]) {
    for (const it of list) {
      maxExtent = Math.max(maxExtent, Math.hypot(it.x, it.z) + Math.max(it.sx, it.sz));
      for (const n of [it.x, it.y, it.z, it.sx, it.sy, it.sz, it.rotY, it.r, it.g, it.b]) {
        h = Math.imul(h ^ Math.round(n * 1e4), 0x01000193);
      }
    }
  }

  return {
    near, neck, far, islets, domeStops,
    corridorTopDeg: topDeg,
    corridorBottomDeg: bottomDeg,
    rejected: { nearCorridor, nearSparse, far: farRejected, islets: isletRejected },
    isletsInFrame,
    corridorViolations,
    maxExtent,
    hash: (h >>> 0).toString(16).padStart(8, '0'),
  };
}
