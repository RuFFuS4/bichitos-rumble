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
// Coste: 0 bytes de payload, 1 draw call, 1.344 triángulos.
//
// Separación de capas: esto es DECORADO. No colisiona, no entra en
// `isOnArena`, no toca el layout ni el colapso. Se puede borrar entero y
// el juego funciona igual.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BACKDROP_LOOK, type SeaRamp } from './arena-look';
import { FRAG } from './arena-fragments';

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

/**
 * Decorado de fondo de un bioma. Una instancia viva por partida; se
 * reconstruye al cambiar de pack y se libera en `dispose()`.
 */
export class ArenaBackdrop {
  readonly group = new THREE.Group();
  private sea: THREE.Mesh | null = null;

  constructor() {
    this.group.name = 'arena-backdrop';
    // Se pinta antes que nada: siempre está detrás de todo.
    this.group.renderOrder = -10;
  }

  /** Construye (o reconstruye) el mar con la rampa del bioma dado. */
  setRamp(ramp: SeaRamp, fogColor: number): void {
    this.dispose();
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
    this.sea = mesh;
    this.group.add(mesh);
  }

  /** Libera geometría y materiales. Seguro llamarlo varias veces. */
  dispose(): void {
    if (!this.sea) return;
    this.group.remove(this.sea);
    this.sea.geometry.dispose();
    const mat = this.sea.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat.dispose();
    this.sea = null;
  }

  /** true si hay mar construido (para el lab y los tests visuales). */
  get isBuilt(): boolean { return this.sea !== null; }
}

/** Radio del disco jugable, por si algún consumidor quiere derivar de él
 *  en vez de repetir el número (preparación del perfil 8P). */
export const ARENA_RADIUS_REF = FRAG.maxRadius;
