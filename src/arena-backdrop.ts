// ---------------------------------------------------------------------------
// Backdrop — el suelo lejano sobre el que flota la isla
// ---------------------------------------------------------------------------
//
// Terreno v2, fase de fondo (docs/DIORAMAS.md §2-3). Sustituye al papel
// pintado por MUNDO.
//
// El porqué, medido (docs/DIORAMAS.md §1): la cámara de juego mira 46°
// hacia abajo y NO rota nunca, así que el horizonte queda 22° por encima
// del borde superior del cuadro — en escritorio y en móvil, en los cinco
// packs, el 100 % de los frames. Todo lo que se ve "de fondo" es, por
// geometría, TERRENO LEJANO VISTO EN PICADO. Una panorámica pintada no
// puede dar eso: no tiene perspectiva. De ahí la lectura de "foto mal
// puesta". Encima solo se veía el 7,7 % de cada imagen (una ventana fija
// de 555×218 px de 1774×887) ampliada hasta ×8 en móvil.
//
// La solución es geometría: un plano enorme muy por debajo del disco, con
// la rampa de color de su bioma HORNEADA en los vértices. Con eso:
//   - el fondo deja de ser más claro que la arena (hoy lo es en los cinco
//     packs, de +38 a +70 de luminancia: jerarquía invertida),
//   - el canto del acantilado tiene contra qué recortarse (en jungle y
//     kitsune había tramos del borde con ΔL de 0,4 — el borde del vacío,
//     que es la información crítica del juego, no se veía), y
//   - la niebla por fin sirve: `scene.fog` sí tiñe geometría, mientras que
//     al skybox NUNCA lo tocaba (three crea su material con `fog:false`).
//
// Coste: 0 bytes de payload, 1 draw call, 6.912 triángulos (96×36×2; el
// "1.344" que decía aquí era del prototipo de 96×7).
//
// 2026-09-21: Rafa rechaza este mar («quiero cielo, no suelo»). Queda
// solo para el A/B (`BACKDROP_LOOK.mode = 'sea'`) y se borra en la F4 del
// fondo v2; lo nuevo va al final del fichero.
//
// Separación de capas: esto es DECORADO. No colisiona, no entra en
// `isOnArena`, no toca el layout ni el colapso. Se puede borrar entero y
// el juego funciona igual.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BACKDROP_LOOK, SALT_BACKDROP, type CliffRamp, type PackSky, type SeaRamp } from './arena-look';
import { FRAG } from './arena-fragments';
import { GAMEPLAY_CAM_FOV, GAMEPLAY_CAM_LOOKAT, GAMEPLAY_CAM_POSITION } from './camera';
import { layoutSky, type SkyCamera, type SkyInstance, type SkyLayout } from './arena-sky-layout';

/**
 * Anillo del mar. Va de `innerR` (justo bajo el disco) a `outerR`, con
 * suficientes anillos concéntricos para que la rampa de color se
 * interpole suave.
 *
 * Va casi hasta el eje (innerR pequeño, no 11): con un agujero grande, la
 * cámara —que mira desde arriba y desde +Z— veía por él justo por debajo
 * de la isla, y aparecía un óvalo de color de fondo bajo el disco.
 */
function buildSeaGeometry(): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(
    BACKDROP_LOOK.seaInnerR,
    BACKDROP_LOOK.seaOuterR,
    BACKDROP_LOOK.seaSegments,
    BACKDROP_LOOK.seaRings,
  );
  // RingGeometry reparte los anillos LINEALMENTE entre inner y outer. Con
  // outer = 300 eso deja apenas 4 anillos en la franja que la cámara ve de
  // verdad (r 40-120), y el degradado se interpola en cuatro pasos: plano.
  // Se remapean los radios con una potencia para concentrar la resolución
  // cerca de la isla, que es donde se mira.
  const pos = geo.getAttribute('position');
  const inner = BACKDROP_LOOK.seaInnerR;
  const outer = BACKDROP_LOOK.seaOuterR;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < 1e-6) continue;
    // clamp obligatorio: los vértices del borde interior salen con un r
    // una micra por debajo de `inner` por precisión de coma flotante, y
    // una base negativa elevada a 2,2 da NaN — que se propaga al
    // boundingSphere y deja la malla sin volumen calculable.
    const u = Math.min(1, Math.max(0, (r - inner) / (outer - inner)));
    const rNew = inner + (outer - inner) * u ** BACKDROP_LOOK.ringDistribution;
    pos.setXY(i, (x / r) * rNew, (y / r) * rNew);
  }
  pos.needsUpdate = true;
  return geo;
}

/** Interpola una rampa de paradas [t, color] en t ∈ [0,1]. */
function sampleRamp(ramp: SeaRamp, t: number, out: THREE.Color): THREE.Color {
  const stops = ramp.stops;
  if (stops.length === 0) return out.setHex(0x808080);
  if (t <= stops[0]![0]) return out.setHex(stops[0]![1]);
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    if (t <= t1) {
      const [t0, c0] = stops[i - 1]!;
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return out.setHex(c0).lerp(new THREE.Color(c1), k);
    }
  }
  return out.setHex(stops[stops.length - 1]![1]);
}

/**
 * Pinta la rampa del bioma en el color por vértice, junto con dos cosas
 * que en un fondo real vienen de la luz y que aquí salen gratis:
 *
 *  1. PERSPECTIVA AÉREA al revés de lo intuitivo: OSCURO cerca del disco
 *     y CLARO lejos. Es lo que hace que el canto se recorte y que el ojo
 *     lea distancia. (La niebla de escena añade lo suyo por encima, pero
 *     no puede hacer sola este trabajo: con density 0,008 todo lo que
 *     pasa de r≈100 se funde a color liso.)
 *  2. SOMBRA DE LA ISLA: una mancha más oscura pegada al disco, más
 *     intensa en el lado opuesto a la luz key. Es lo que ancla la isla en
 *     el sitio en lugar de dejarla recortada.
 */
function paintSeaColors(geo: THREE.RingGeometry, ramp: SeaRamp, fogColor: number): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const FOG_TMP = new THREE.Color();
  const inner = BACKDROP_LOOK.seaInnerR;
  // Dirección de la luz key proyectada en el plano (src/scene-atmosphere.ts).
  const lightX = BACKDROP_LOOK.keyDirX;
  const lightZ = BACKDROP_LOOK.keyDirZ;
  const lightLen = Math.hypot(lightX, lightZ) || 1;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);   // RingGeometry vive en XY antes de tumbarla
    const r = Math.hypot(x, y);
    // t: 0 pegado al disco, 1 en el borde exterior. Curva para que la
    // mayor parte del degradado ocurra cerca, que es donde se mira.
    // El degradado se agota en `rampSpanR`, no en el borde del plano: la
    // cámara solo ve de r≈40 (bajo la isla) a r≈120 (esquinas superiores),
    // así que repartir la rampa hasta 300 dejaba TODO el bioma en el
    // primer tercio de la escala y el resultado era un color liso.
    // La rampa arranca en `rampInnerR`, no en el borde interior del
    // plano: lo primero que asoma del mar por detrás de la isla ya está a
    // r≈20-25, así que empezar en 0 gastaba los tonos oscuros —los que
    // recortan el canto— en geometría que la isla tapa.
    const rampInner = BACKDROP_LOOK.rampInnerR;
    const span = Math.max(1, BACKDROP_LOOK.rampSpanR - rampInner);
    const t = Math.min(1, Math.max(0, (r - rampInner) / span));
    sampleRamp(ramp, t ** BACKDROP_LOOK.rampCurve, c);

    // Perspectiva aérea HORNEADA hacia el color de niebla del pack. No se
    // delega en `scene.fog`: con density 0,008 todo lo que pasa de r≈100
    // se funde a un color liso, que es exactamente el defecto que veníamos
    // a arreglar (un plano de color uniforme llenando la pantalla). Aquí
    // la curva se controla y se corta antes del blanco total.
    const haze = Math.min(BACKDROP_LOOK.hazeMax, t ** BACKDROP_LOOK.hazeCurve * BACKDROP_LOOK.hazeMax);
    c.lerp(FOG_TMP.setHex(fogColor), haze);

    // Sombra proyectada de la isla: se desvanece con la distancia y es
    // más fuerte en el lado contrario a la luz.
    const shadowFalloff = Math.max(0, 1 - (r - inner) / BACKDROP_LOOK.islandShadowReach);
    const dirDot = r > 0.001 ? (x * lightX + y * lightZ) / (r * lightLen) : 0;
    const shadowSide = 0.5 - 0.5 * dirDot;   // 1 en el lado opuesto a la luz
    const shadow = shadowFalloff ** 1.6 * (0.45 + 0.55 * shadowSide) * BACKDROP_LOOK.islandShadow;
    c.multiplyScalar(1 - shadow);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------------------
// Fondo v2 — la isla en el cielo (docs/DIORAMAS.md §«Fondo v2»)
// ---------------------------------------------------------------------------
//
// El mar de arriba se queda para el A/B (`BACKDROP_LOOK.mode = 'sea'`) hasta
// la F4. Esto es lo que lo sustituye: una cúpula pegada a la cámara con
// color por latitud (cielo, horizonte, pozo), un mar de nubes abierto en
// cráter alrededor de la isla, un cuello de nubes en sombra bajo la punta
// del cono, nubes lejanas que se funden con el horizonte e islotes
// hermanos más abajo. Dónde va cada cosa lo decide `arena-sky-layout.ts`
// (módulo hoja, determinista); aquí solo se hacen las mallas.
//
// Coste: 0 bytes, 4 draw calls (cúpula, cercanas+cuello, lejanas e
// islotes), ~30-37k triángulos según la cobertura del bioma. Todo es geometría con
// color de vértice e `InstancedMesh`, sin textura (lección de 9047031:
// `clouds.png` en un plano 18 u bajo el disco tapó el cuadro de blanco) y
// sin UV en la cúpula (lección de b054e96: costuras según la GPU).

/** Pose de juego vista como proyector del pasillo del canto. */
const GAMEPLAY_SKY_CAMERA: SkyCamera = {
  position: [GAMEPLAY_CAM_POSITION.x, GAMEPLAY_CAM_POSITION.y, GAMEPLAY_CAM_POSITION.z],
  lookAt: [GAMEPLAY_CAM_LOOKAT.x, GAMEPLAY_CAM_LOOKAT.y, GAMEPLAY_CAM_LOOKAT.z],
  fovDeg: GAMEPLAY_CAM_FOV,
  aspect: 16 / 9,
};

/** Paradas [elevación °, color] ordenadas de +90 a −90 → color. */
function sampleElevation(stops: Array<[number, number]>, elevDeg: number, out: THREE.Color): THREE.Color {
  if (elevDeg >= stops[0]![0]) return out.setHex(stops[0]![1]);
  for (let i = 1; i < stops.length; i++) {
    const [e1, c1] = stops[i]!;
    if (elevDeg >= e1) {
      const [e0, c0] = stops[i - 1]!;
      const k = e0 === e1 ? 0 : (e0 - elevDeg) / (e0 - e1);
      return out.setHex(c0).lerp(new THREE.Color(c1), k);
    }
  }
  return out.setHex(stops[stops.length - 1]![1]);
}

/**
 * Cúpula latitud-longitud SIN UV. Las filas van en cada parada de color
 * (para que el pozo empiece exactamente donde toca), cada 2,5° en la
 * franja del horizonte al pozo y cada 7,5° en el resto. Se ve desde dentro.
 */
function buildDomeGeometry(stops: Array<[number, number]>): THREE.BufferGeometry {
  const lats = new Set<number>();
  for (let e = 90; e >= -90; e -= 7.5) lats.add(e);
  // Más filas donde cambia el color de verdad (horizonte → pozo).
  for (let e = 0; e >= -35; e -= 2.5) lats.add(e);
  for (const [e] of stops) lats.add(e);
  const rows = [...lats].sort((a, b) => b - a);
  const cols = BACKDROP_LOOK.domeColumns;
  const R = BACKDROP_LOOK.domeRadius;
  const positions: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  for (const e of rows) {
    const phi = (e * Math.PI) / 180;
    sampleElevation(stops, e, c);
    for (let j = 0; j <= cols; j++) {
      const lam = (j / cols) * Math.PI * 2;
      positions.push(R * Math.cos(phi) * Math.cos(lam), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(lam));
      colors.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  return geo;
}

/**
 * Bulto de nube: media esfera de base plana, 0,75 de alto. Con `belly` < 1
 * la panza sale más oscura que la cima (cercanas); con 1, color plano
 * (lejanas: `instanceColor` es entonces el color final exacto y se puede
 * fundir al 100 % con el horizonte — multiplicar solo oscurece).
 */
function buildBumpGeometry(width: number, height: number, belly: number, shade: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, width, height, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1, 0.75, 1);
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  // Luz key horneada: lado claro y lado en sombra. Las instancias no giran
  // (`rotY` 0 en el layout), así que la dirección vale en el espacio del
  // bulto. Es la misma key de scene-atmosphere (BACKDROP_LOOK.keyDir*).
  const L = new THREE.Vector3(BACKDROP_LOOK.keyDirX, BACKDROP_LOOK.keyDirY, BACKDROP_LOOK.keyDirZ).normalize();
  const n = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const lit = Math.max(0, n.fromBufferAttribute(nrm, i).dot(L));
    const k = (belly + (1 - belly) * (pos.getY(i) / 0.75)) * (1 - shade * 0.45 * (1 - lit));
    colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Islote: minicono de 16 lados con tapa. Unidad: tapa en y=0 con radio 1,
 * punta en y=−1. La tapa lleva el color de islote del pack y la panza la
 * rampa de estratos del bioma, para que se lean como hermanos de la isla.
 */
function buildIsletGeometry(top: number, cliff: CliffRamp): THREE.BufferGeometry {
  const SIDES = 16, ROWS = 3, TIP = 0.06;
  const positions: number[] = [];
  const colors: number[] = [];
  const cTop = new THREE.Color(top);
  const c0 = new THREE.Color(), c1 = new THREE.Color();
  const ring = (t: number, j: number): [number, number, number] => {
    const rr = 1 - (1 - TIP) * t;
    const a = (j / SIDES) * Math.PI * 2;
    return [Math.cos(a) * rr, -t, Math.sin(a) * rr];
  };
  const push = (p: [number, number, number], c: THREE.Color) => {
    positions.push(p[0], p[1], p[2]);
    colors.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < SIDES; j++) {
    push([0, 0, 0], cTop); push(ring(0, j + 1), cTop); push(ring(0, j), cTop);
    for (let k = 0; k < ROWS; k++) {
      const t0 = k / ROWS, t1 = (k + 1) / ROWS;
      sampleRamp(cliff, t0, c0);
      sampleRamp(cliff, t1, c1);
      push(ring(t0, j), c0); push(ring(t0, j + 1), c0); push(ring(t1, j + 1), c1);
      push(ring(t0, j), c0); push(ring(t1, j + 1), c1); push(ring(t1, j), c1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: SkyInstance[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  list.forEach((it, i) => {
    m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rotY), s.set(it.sx, it.sy, it.sz));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setRGB(it.r, it.g, it.b));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // El fondo cubre el cuadro entero desde cualquier pose: sin culling.
  mesh.frustumCulled = false;
  return mesh;
}

function triCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

/** Coste y control del cielo, para el lab, el CLI y los criterios del slice. */
export interface BackdropStats {
  mode: 'sky' | 'sea';
  draws: number;
  tris: number;
  layers: Record<string, { instances: number; tris: number }>;
  rejected: SkyLayout['rejected'] | null;
  isletsInFrame: number;
  corridorViolations: number;
  corridorDeg: [number, number] | null;
  maxExtent: number;
  buildMs: number;
  hash: string | null;
}

/**
 * Decorado de fondo de un bioma. Una instancia viva por partida; se
 * reconstruye al cambiar de pack y se libera en `dispose()`.
 */
export class ArenaBackdrop {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private lastStats: BackdropStats | null = null;

  constructor() {
    this.group.name = 'arena-backdrop';
  }

  /** Construye (o reconstruye) el mar con la rampa del bioma dado. */
  setRamp(ramp: SeaRamp, fogColor: number): void {
    this.dispose();
    const t0 = performance.now();
    // Modo mar: se pinta antes que nada, siempre detrás de todo.
    this.group.renderOrder = -10;
    const geo = buildSeaGeometry();
    paintSeaColors(geo, ramp, fogColor);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      // La niebla va HORNEADA en el vértice (ver paintSeaColors), no
      // delegada: `scene.fog` a la distancia de este plano lo aplana a un
      // color liso y se pierde toda la lectura de profundidad.
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = BACKDROP_LOOK.seaY;
    mesh.frustumCulled = false;   // r=300: su bounding sphere confunde al culling
    this.add(mesh);
    this.lastStats = {
      mode: 'sea', draws: 1, tris: triCount(geo),
      layers: { sea: { instances: 1, tris: triCount(geo) } },
      rejected: null, isletsInFrame: 0, corridorViolations: 0, corridorDeg: null,
      maxExtent: BACKDROP_LOOK.seaOuterR, buildMs: performance.now() - t0, hash: null,
    };
  }

  /** Construye el cielo del bioma (fondo v2). Determinista por semilla. */
  buildSky(sky: PackSky, horizon: number, cliff: CliffRamp, seed: number, lipRadius: number): void {
    this.dispose();
    const t0 = performance.now();
    // Modo cielo: se pinta DESPUÉS de lo opaco del juego, con la cúpula la
    // última, para que la GPU descarte por profundidad todo lo que tapan
    // el disco, las nubes y los islotes (el mar se pintaba entero debajo).
    this.group.renderOrder = 5;
    const layout = layoutSky({
      look: BACKDROP_LOOK, sky, horizon, seed, salt: SALT_BACKDROP, lipRadius,
      camera: GAMEPLAY_SKY_CAMERA,
    });

    const cloudMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const layers: BackdropStats['layers'] = {};
    const addLayer = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, list: SkyInstance[]) => {
      if (list.length === 0) { geo.dispose(); mat.dispose(); return; }
      this.add(instanced(geo, mat, list));
      layers[name] = { instances: list.length, tris: triCount(geo) * list.length };
    };
    // Cercanas y cuello comparten bulto con panza, material y MALLA: una
    // sola draw call (las cifras se reparten por capa para el lab).
    const bump = buildBumpGeometry(14, 3, BACKDROP_LOOK.cloudBelly, BACKDROP_LOOK.cloudShade);
    addLayer('near+neck', bump, cloudMat(), [...layout.near, ...layout.neck]);
    if (layers['near+neck']) {
      const per = triCount(bump);
      delete layers['near+neck'];
      layers.near = { instances: layout.near.length, tris: per * layout.near.length };
      layers.neck = { instances: layout.neck.length, tris: per * layout.neck.length };
    }
    // 12 lados y no 8: con 8, las lejanas (enormes y de color plano) se
    // recortaban como octógonos.
    addLayer('far', buildBumpGeometry(12, 2, 1, 0), cloudMat(), layout.far);
    // Islotes iluminados: son hermanos de la isla y reciben su misma luz.
    // Sin niebla: a 60-150 u la FogExp2 los lavaría hacia el horizonte
    // claro y competirían con la arena.
    addLayer('islets', buildIsletGeometry(sky.isletTop, cliff),
      new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), layout.islets);

    const domeGeo = buildDomeGeometry(layout.domeStops);
    // DoubleSide y no BackSide: el sentido de los triángulos de una esfera
    // hecha a mano depende del orden de filas y columnas, y con la cara
    // equivocada la cúpula no se pinta y lo que se ve es el color de
    // limpiado (pasó en la primera captura: pozo también encima del
    // horizonte). Desde dentro solo se ve una cara de todos modos.
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false, dithering: true,
    }));
    dome.name = 'sky-dome';
    dome.frustumCulled = false;
    dome.renderOrder = 10;
    // Pegada a la cámara. Hay que escribir la matrixWorld: la
    // modelViewMatrix se calcula justo después de este hook con ella, y
    // la matrixWorld ya se actualizó antes (mover `position` aquí no
    // llegaría a este frame). Es lo que hace el propio WebGLBackground.
    dome.onBeforeRender = (_r, _s, camera) => {
      dome.matrixWorld.copyPosition(camera.matrixWorld);
    };
    this.add(dome);
    layers.dome = { instances: 1, tris: triCount(domeGeo) };

    this.lastStats = {
      mode: 'sky',
      draws: this.meshes.length,
      tris: Object.values(layers).reduce((a, l) => a + l.tris, 0),
      layers,
      rejected: layout.rejected,
      isletsInFrame: layout.isletsInFrame,
      corridorViolations: layout.corridorViolations,
      corridorDeg: [layout.corridorTopDeg, layout.corridorBottomDeg],
      maxExtent: layout.maxExtent,
      buildMs: performance.now() - t0,
      hash: layout.hash,
    };
  }

  private add(mesh: THREE.Mesh): void {
    this.meshes.push(mesh);
    this.group.add(mesh);
  }

  /** Libera geometría y materiales. Seguro llamarlo varias veces. */
  dispose(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    this.meshes = [];
    this.lastStats = null;
  }

  /** true si hay fondo construido (para el lab y los tests visuales). */
  get isBuilt(): boolean { return this.meshes.length > 0; }

  /** Coste, rechazos, violaciones del pasillo y hash de lo construido. */
  stats(): BackdropStats | null { return this.lastStats; }
}

/** Radio del disco jugable, por si algún consumidor quiere derivar de él
 *  en vez de repetir el número (preparación del perfil 8P). */
export const ARENA_RADIUS_REF = FRAG.maxRadius;
