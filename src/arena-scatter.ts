// ---------------------------------------------------------------------------
// Scatter — motor de la capa densa del diorama (InstancedMesh por capa)
// ---------------------------------------------------------------------------
//
// docs/DIORAMAS.md parte 2 §3. Convierte una ScatterRecipe (hoja de
// números por bioma) en UN THREE.InstancedMesh por capa —más uno de
// sombras de contacto si la capa lo pide— colocado sobre el layout real
// de fragmentos. Es decorado: nada de aquí colisiona ni entra en
// isOnArena; los techos de altura de SCATTER_LIMITS se hacen cumplir aquí.
//
// Las tres decisiones de arquitectura, medidas en el plan:
//
//   1. Un stream aleatorio POR CAPA: mulberry32(seed ^ SALT_SCATTER ^
//      hash(layer.id)). Tocar el `count` de una capa no reorganiza las
//      demás, y subir SCATTER_DENSITY AÑADE instancias sin mover las que
//      ya estaban (el stream se consume en orden de instancia). Nunca
//      Math.random, y nunca el mulberry32 de arena-fragments.ts: ese es
//      gameplay y está blindado por golden.
//
//   2. Los InstancedMesh cuelgan de `group` y `group` va en arena.group —
//      JAMÁS de un fragmento. buildFromSeed/reset en arena.ts hacen
//      traverse + geometry.dispose() sobre todo descendiente de un
//      fragmento, e InstancedMesh es un Mesh: reparentar una capa "para
//      que caiga mejor" destruye la geometría compartida y la partida
//      siguiente renderiza vacío.
//
//   3. Las instancias se ORDENAN por fragmento anfitrión, así que cada
//      fragmento posee un rango contiguo [start, count) en cada capa.
//      Cuando un sector cae, el orquestador llama applyFragmentTransform
//      con la matriz del grupo del fragmento y solo se recompone y se
//      sube ese rango (addUpdateRange). Es lo que hace que la hierba se
//      vaya CON el suelo en vez de flotar sobre el vacío.
//
//   4. El fleco se REGENERA (dioramas slice 2): cada capa 'fringe' lleva,
//      en la misma malla, instancias LATENTES a lo largo del arco exterior
//      de los anillos interiores (r 8,5, 5,5 y 2,5), cada una atada al
//      sector que tiene justo por fuera (su `gate`). Nacen ocultas y
//      `revealEdges` las enseña cuando ese sector cae: cada colapso
//      descubre un borde ya vestido. Se construyen al empezar con su
//      propio stream (`<id>#edge`), así que el fleco exterior no se mueve y
//      todos los clientes ven lo mismo, online incluido: solo dependen de
//      qué ha caído.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { ArenaLayout, FragmentDef } from './arena-fragments';
import {
  SALT_SCATTER,
  SCATTER_LIMITS,
  type ScatterLayer,
  type ScatterRecipe,
} from './arena-scatter-types';
import {
  PRIMITIVE_META,
  buildPrimitive,
  buildShadowDisc,
  footprintRadius,
  triangleCount,
} from './arena-scatter-geometry';

/** Números del motor que no pertenecen a ninguna receta. */
export const SCATTER_ENGINE = {
  /** Altura de los decals sobre la tapa (evita z-fighting con el suelo). */
  decalLift: 0.02,
  /** Altura del disco de sombra: por debajo de los decals, sobre el suelo. */
  shadowLift: 0.01,
  shadowOpacity: 0.35,
  shadowColor: 0x000000,
  /** Radio de la sombra respecto a la huella real de la instancia. */
  shadowRadiusScale: 0.9,
  /** Las primitivas con volumen se hunden esta fracción de su altura para
   *  que la inclinación no levante el borde de la base y deje ver debajo. */
  sinkFraction: 0.06,
  /** Desviación (rad) alrededor del eje de viento en yaw:'wind' y en la
   *  dirección de la inclinación de esas capas. Sin esto, hierba clonada. */
  windJitter: 0.35,
  /** Intentos de colocar una instancia dentro de su racimo Y dentro de la
   *  banda radial antes de caer a un reparto uniforme. */
  clusterTries: 8,
  /** Profundidad mínima del fleco desde el arco exterior: r = outerR
   *  exacto cae fuera de pointInFragment por redondeo. */
  fringeMinDepth: 0.02,
  /** Cuánto por fuera del arco se busca el sector vecino que tapa el
   *  fleco latente (el que, al caer, lo destapa). */
  fringeGateProbe: 0.05,
  roughness: 0.9,
} as const;

export interface ScatterBuildArgs {
  layout: ArenaLayout;
  recipe: ScatterRecipe;
  seed: number;
  /** Multiplicador global de `layer.count` (SCATTER_DENSITY o el slider). */
  density: number;
  /** Fragmento que hospeda un punto del disco (índice en layout.fragments)
   *  o null si ninguno: la instancia se descarta. */
  hostOf: (x: number, z: number) => number | null;
}

export interface ScatterLayerStats {
  id: string;
  instances: number;
  triangles: number;
  drawCalls: number;
  /** Instancias cuya escala se recortó a los techos de SCATTER_LIMITS. */
  clipped: number;
  /** Fleco latente que aún no ha destapado ningún colapso. */
  latent: number;
}

export interface ScatterStats {
  layers: ScatterLayerStats[];
  instances: number;
  drawCalls: number;
  triangles: number;
}

/** Una capa construida: mallas, matrices locales originales y rangos. */
interface LayerRuntime {
  id: string;
  mesh: THREE.InstancedMesh;
  shadow: THREE.InstancedMesh | null;
  /** Matrices locales originales (16 floats por instancia): la fuente de
   *  verdad que applyFragmentTransform recompone; instanceMatrix es el
   *  resultado y se sobreescribe. */
  local: Float32Array;
  shadowLocal: Float32Array | null;
  /** [start, count] por índice de fragmento, aplanado (2 × fragmentos). */
  ranges: Int32Array;
  /** Fleco latente (null si la capa no tiene): por instancia, el sector
   *  que la destapa al caer (−1 = visible desde el principio), su
   *  anfitrión, si ya se destapó, y el índice gate → instancias. */
  gates: Int32Array | null;
  hosts: Int32Array | null;
  revealed: Uint8Array | null;
  byGate: Map<number, number[]> | null;
  triangles: number;
  clipped: number;
}

/** Instancia candidata: todo lo que decide el stream, antes de filtrar. */
interface Candidate {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  tiltDir: number;
  tiltMag: number;
  r: number;
  g: number;
  b: number;
  host: number;
  /** Sector que la destapa al caer; −1 = visible desde el principio. */
  gate: number;
}

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// --- Determinismo ------------------------------------------------------------

/** mulberry32 con la semilla ya salada por quien llama. Copia del
 *  `visualRand` de arena.ts, no del de arena-fragments.ts (gameplay). */
function scatterRand(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a de 32 bits sobre el id de la capa: sub-sal del stream. */
function hashLayerId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

// --- Reglas de gameplay --------------------------------------------------------

/** Techo de altura en un punto: interior bajo, y en el borde depende de
 *  si el arco da a la cámara (+Z, angle en [0, π]) o al fondo. */
function heightCeiling(r: number, z: number): number {
  if (r < SCATTER_LIMITS.innerR) return SCATTER_LIMITS.innerMaxH;
  return z >= 0 ? SCATTER_LIMITS.frontMaxH : SCATTER_LIMITS.backMaxH;
}

/**
 * Fragmentos con el arco exterior al descubierto: hoy, la banda exterior
 * entera (a t=0 nadie ha caído).
 *
 * GANCHO (fase 4 del plan): cuando el fleco se regenere en caliente, esta
 * función recibirá `alive: boolean[]` y devolverá también cualquier
 * fragmento vivo cuyo vecino radial exterior (misma cobertura angular,
 * banda + 1) haya caído — así cada colapso descubre un borde ya vestido.
 */
function fringeHosts(layout: ArenaLayout): FragmentDef[] {
  const outerBand = maxBand(layout);
  return layout.fragments.filter(f => !f.immune && f.band === outerBand);
}

/** Anfitriones del fleco LATENTE: todo lo que queda por dentro de la banda
 *  exterior, centro inmune incluido. Su arco exterior está tapado por el
 *  anillo de fuera hasta que este cae. */
function edgeHosts(layout: ArenaLayout): FragmentDef[] {
  const outerBand = maxBand(layout);
  return layout.fragments.filter(f => f.immune || f.band < outerBand);
}

function maxBand(layout: ArenaLayout): number {
  let outerBand = 0;
  for (const f of layout.fragments) outerBand = Math.max(outerBand, f.band);
  return outerBand;
}

/** Longitud total de los arcos exteriores de unos anfitriones. */
function arcLength(hosts: FragmentDef[]): number {
  let total = 0;
  for (const f of hosts) total += f.outerR * (f.endAngle - f.startAngle);
  return total;
}

// --- Muestreo ------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Punto uniforme en área dentro de la corona [lo, hi]; con `back`, solo
 *  en la mitad trasera (z < 0 ⇔ ángulo en (π, 2π)). Mismas dos tiradas del
 *  stream en ambos casos: `arc` no desplaza el resto de la capa. */
function sampleAnnulus(rand: () => number, lo: number, hi: number, back = false): [number, number] {
  const r = Math.sqrt(lerp(lo * lo, hi * hi, rand()));
  const a = back ? Math.PI + rand() * Math.PI : rand() * TWO_PI;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Índice elegido por peso acumulado (`cum` creciente, último = total). */
function pickWeighted(cum: number[], u: number): number {
  const target = u * cum[cum.length - 1];
  for (let i = 0; i < cum.length; i++) if (target < cum[i]) return i;
  return cum.length - 1;
}

/**
 * Muestreador de posiciones de una capa: cada llamada consume del stream
 * SOLO las tiradas de una instancia. Los centros de racimo (que no
 * dependen de `count`) se tiran al crearlo. Así el stream se consume en
 * orden de instancia —posición y luego atributos— y subir `density` añade
 * instancias al final sin mover ninguna de las anteriores.
 * Devuelve null si la banda es vacía en este layout.
 */
type PositionSampler = () => [number, number];

/**
 * Capa 'disc': corona [max(rMin, clearCenterR), rMax], uniforme o en
 * racimos alrededor de `clusterCount` centros.
 */
function discSampler(layer: ScatterLayer, layout: ArenaLayout, rand: () => number): PositionSampler | null {
  const lo = Math.max(layer.rMin, layer.clearCenterR);
  const hi = Math.min(layer.rMax, layout.maxRadius);
  if (hi <= lo) return null;
  // Review M1: los acentos altos van SOLO a la mitad trasera (arc:'back')
  // en vez de recortarse al techo frontal y quedar como arbustos enanos.
  const back = layer.arc === 'back';
  const centers: Array<[number, number]> = [];
  for (let k = 0; k < layer.clusterCount; k++) centers.push(sampleAnnulus(rand, lo, hi, back));
  if (centers.length === 0) return () => sampleAnnulus(rand, lo, hi, back);

  return () => {
    const [cx, cz] = centers[Math.floor(rand() * centers.length)];
    for (let t = 0; t < SCATTER_ENGINE.clusterTries; t++) {
      const rho = layer.clusterRadius * Math.sqrt(rand());
      const phi = rand() * TWO_PI;
      const x = cx + Math.cos(phi) * rho, z = cz + Math.sin(phi) * rho;
      const r = Math.hypot(x, z);
      if (r >= lo && r <= hi && (!back || z < 0)) return [x, z];
    }
    return sampleAnnulus(rand, lo, hi, back);
  };
}

/**
 * Capa 'fringe': a lo largo del arco exterior de cada fragmento anfitrión,
 * a profundidad [rMin, rMax] hacia dentro desde SU outerR. El reparto
 * entre fragmentos es proporcional a la longitud del arco; los racimos
 * son centros angulares y pueden desbordar al sector vecino (hostOf
 * decide el anfitrión real).
 */
function fringeSampler(
  layer: ScatterLayer, layout: ArenaLayout, rand: () => number, hosts = fringeHosts(layout),
): PositionSampler | null {
  if (hosts.length === 0) return null;
  const cum: number[] = [];
  let total = 0;
  for (const f of hosts) { total += f.outerR * (f.endAngle - f.startAngle); cum.push(total); }
  const dLo = Math.max(layer.rMin, SCATTER_ENGINE.fringeMinDepth);
  const dHi = Math.max(dLo, layer.rMax);

  const pickArc = (): [FragmentDef, number] => {
    const f = hosts[pickWeighted(cum, rand())];
    return [f, lerp(f.startAngle, f.endAngle, rand())];
  };
  const centers: Array<[FragmentDef, number]> = [];
  for (let k = 0; k < layer.clusterCount; k++) centers.push(pickArc());

  return () => {
    let f: FragmentDef, angle: number;
    if (centers.length === 0) {
      [f, angle] = pickArc();
    } else {
      const [cf, ca] = centers[Math.floor(rand() * centers.length)];
      f = cf;
      angle = ca + (rand() - 0.5) * 2 * (layer.clusterRadius / cf.outerR);
    }
    const r = f.outerR - lerp(dLo, dHi, rand());
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  };
}

// --- Motor ---------------------------------------------------------------------

export class ArenaScatter {
  /** Cuélgalo de arena.group (nunca de un fragmento, ver cabecera). */
  readonly group = new THREE.Group();

  private layers: LayerRuntime[] = [];
  private shadowMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly tmpMatrix = new THREE.Matrix4();
  /** Fragmentos ya ocultados (pasaron el plano de muerte o los hundió el
   *  Sinkhole). `applyFragmentTransform` los ignora: si el orquestador
   *  vuelve a "hacer caer" un sector hundido, sus instancias no vuelven
   *  (review A1). */
  private hidden = new Set<number>();

  constructor() {
    this.group.name = 'arena-scatter';
  }

  /** Construye todas las capas de la receta. Idempotente: destruye lo
   *  anterior primero. Dos llamadas con los mismos argumentos producen
   *  instanceMatrix idénticos byte a byte. */
  build(args: ScatterBuildArgs): void {
    this.dispose();
    this.hidden.clear();
    for (const layer of args.recipe.layers) {
      const built = this.buildLayer(layer, args);
      if (built) this.layers.push(built);
    }
  }

  /**
   * Recompone las instancias del fragmento `fragmentIndex` como
   * `matrix × local` y sube solo ese rango. `matrix` es la del GRUPO del
   * fragmento relativa a arena.group (`g.matrix` tras `g.updateMatrix()`):
   * el scatter cuelga del mismo padre, así que no hace falta matrixWorld.
   * Llamar cada frame mientras el sector cae (y, si se quiere, mientras
   * tiembla en el aviso; con la identidad lo devuelve a su sitio).
   */
  applyFragmentTransform(fragmentIndex: number, matrix: THREE.Matrix4): void {
    if (this.hidden.has(fragmentIndex)) return;
    for (const layer of this.layers) {
      const start = layer.ranges[fragmentIndex * 2] ?? 0;
      const count = layer.ranges[fragmentIndex * 2 + 1] ?? 0;
      if (count === 0) continue;
      this.recompose(layer.mesh, layer.local, start, count, matrix, layer);
      if (layer.shadow && layer.shadowLocal) {
        this.recompose(layer.shadow, layer.shadowLocal, start, count, matrix, layer);
      }
    }
  }

  /**
   * El sector `fallen` ha caído: enseña el fleco latente que tapaba (el de
   * los sectores de dentro, a lo largo de su arco). `hostMatrix(h)` es la
   * matriz del grupo del anfitrión h, o null si ese anfitrión ya no está
   * en pie: entonces su fleco sigue oculto (se iría con él).
   */
  revealEdges(fallen: number, hostMatrix: (host: number) => THREE.Matrix4 | null): void {
    for (const layer of this.layers) {
      const list = layer.byGate?.get(fallen);
      if (!list || !layer.revealed || !layer.hosts) continue;
      for (const k of list) {
        if (layer.revealed[k]) continue;
        const host = layer.hosts[k]!;
        if (this.hidden.has(host)) continue;
        const m = hostMatrix(host);
        if (!m) continue;
        layer.revealed[k] = 1;
        this.recompose(layer.mesh, layer.local, k, 1, m, null);
        if (layer.shadow && layer.shadowLocal) this.recompose(layer.shadow, layer.shadowLocal, k, 1, m, null);
      }
    }
  }

  /** Escala 0 en el rango del fragmento: para cuando el sector se descarta
   *  bajo el plano de muerte y su grupo deja de moverse. */
  hideFragment(fragmentIndex: number): void {
    this.hidden.add(fragmentIndex);
    for (const layer of this.layers) {
      const start = layer.ranges[fragmentIndex * 2] ?? 0;
      const count = layer.ranges[fragmentIndex * 2 + 1] ?? 0;
      if (count === 0) continue;
      zeroRange(layer.mesh.instanceMatrix, start, count);
      if (layer.shadow) zeroRange(layer.shadow.instanceMatrix, start, count);
    }
  }

  /** Libera mallas y materiales. Las geometrías NO: son la caché
   *  compartida de arena-scatter-geometry.ts y sobreviven a la partida. */
  dispose(): void {
    for (const layer of this.layers) {
      this.group.remove(layer.mesh);
      layer.mesh.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      if (layer.shadow) {
        this.group.remove(layer.shadow);
        layer.shadow.dispose();
      }
    }
    this.layers = [];
    if (this.shadowMaterial) {
      this.shadowMaterial.dispose();
      this.shadowMaterial = null;
    }
  }

  /** Coste por capa para el lab y el CLI. */
  stats(): ScatterStats {
    const layers = this.layers.map((l): ScatterLayerStats => ({
      id: l.id,
      instances: l.mesh.count,
      triangles: l.triangles,
      drawCalls: l.shadow ? 2 : 1,
      clipped: l.clipped,
      latent: l.revealed && l.gates ? l.gates.reduce((a, g, k) => a + (g >= 0 && !l.revealed![k] ? 1 : 0), 0) : 0,
    }));
    return {
      layers,
      instances: layers.reduce((a, l) => a + l.instances, 0),
      drawCalls: layers.reduce((a, l) => a + l.drawCalls, 0),
      triangles: layers.reduce((a, l) => a + l.triangles, 0),
    };
  }

  // --- Interno -------------------------------------------------------------

  private buildLayer(layer: ScatterLayer, args: ScatterBuildArgs): LayerRuntime | null {
    const { layout } = args;
    const n = Math.round(layer.count * args.density);
    if (n <= 0) return null;

    const rand = scatterRand(args.seed ^ SALT_SCATTER ^ hashLayerId(layer.id));
    const meta = PRIMITIVE_META[layer.primitive];
    const palette = layer.colors.map(c => new THREE.Color(c));
    const sample = layer.anchor === 'fringe'
      ? fringeSampler(layer, layout, rand)
      : discSampler(layer, layout, rand);
    if (!sample) return null;

    // Cada instancia consume TODAS sus tiradas (posición y luego
    // atributos) antes de decidir si se descarta, en orden de instancia:
    // el resultado no depende de hostOf ni de los techos, y la instancia
    // i es la misma para cualquier density que la incluya.
    let clipped = 0;
    const kept: Candidate[] = [];
    const take = (sampler: PositionSampler, count: number, rnd: () => number, latent: boolean) => {
      for (let i = 0; i < count; i++) {
        const [x, z] = sampler();
        const r = Math.hypot(x, z);
        let scale = lerp(layer.scale[0], layer.scale[1], rnd());
        const height = scale * meta.height;
        const ceiling = heightCeiling(r, z);
        // El fleco latente vive en el interior (r < 8,5) y se recorta al
        // techo POR DISEÑO: allí es escombro bajo. No cuenta como aviso.
        if (height > ceiling) { scale = ceiling / meta.height; if (!latent) clipped++; }

        const u = rnd();
        let yaw: number;
        if (layer.yaw === 'toCenter') yaw = Math.atan2(-x, -z);
        else if (layer.yaw === 'wind') yaw = Math.PI / 2 - args.recipe.wind + (u - 0.5) * 2 * SCATTER_ENGINE.windJitter;
        else yaw = u * TWO_PI;

        const tiltMag = layer.tilt * DEG * rnd();
        const v = rnd();
        const tiltDir = layer.yaw === 'wind'
          ? args.recipe.wind + (v - 0.5) * 2 * SCATTER_ENGINE.windJitter
          : v * TWO_PI;

        const base = palette[Math.floor(rnd() * palette.length)];
        const mul = 1 + (rnd() - 0.5) * 2 * layer.colorJitter;

        if (r < layer.clearCenterR || r > layout.maxRadius) continue;
        // null es el contrato; -1 es la convención de findFragmentAt en
        // arena.ts. Las dos significan "sin fragmento": se descarta.
        const host = args.hostOf(x, z);
        if (host === null || host < 0 || host >= layout.fragments.length) continue;
        // Fleco latente: el sector que tiene justo por fuera de su arco. Si
        // no hay ninguno (vacío), está al descubierto desde el principio.
        let gate = -1;
        if (latent) {
          const f = layout.fragments[host]!;
          const a = Math.atan2(z, x);
          const probeR = f.outerR + SCATTER_ENGINE.fringeGateProbe;
          const outside = args.hostOf(Math.cos(a) * probeR, Math.sin(a) * probeR);
          gate = outside === null || outside < 0 || outside === host ? -1 : outside;
        }
        kept.push({
          x, z, scale, yaw, tiltDir, tiltMag, host, gate,
          r: base ? clamp01(base.r * mul) : 1,
          g: base ? clamp01(base.g * mul) : 1,
          b: base ? clamp01(base.b * mul) : 1,
        });
      }
    };
    take(sample, n, rand, false);
    // Fleco latente: su propio stream, así que no mueve el exterior. La
    // cantidad sigue a la longitud de arco, como el fleco de fuera.
    let hasEdges = false;
    if (layer.anchor === 'fringe') {
      const inner = edgeHosts(layout);
      const outerArc = arcLength(fringeHosts(layout));
      const nEdge = outerArc > 0 ? Math.round((n * arcLength(inner)) / outerArc) : 0;
      const edgeRand = scatterRand(args.seed ^ SALT_SCATTER ^ hashLayerId(`${layer.id}#edge`));
      const edgeSample = nEdge > 0 ? fringeSampler(layer, layout, edgeRand, inner) : null;
      if (edgeSample) { take(edgeSample, nEdge, edgeRand, true); hasEdges = true; }
    }
    if (clipped > 0) {
      console.warn(`[scatter] ${layer.id}: ${clipped}/${n} instancias recortadas a los techos de SCATTER_LIMITS (revisa scale)`);
    }
    if (kept.length === 0) return null;

    // Orden por fragmento anfitrión (empate: orden de generación, para
    // que el sort sea determinista aunque el motor de JS no lo fuera).
    const order = kept.map((_, i) => i).sort((i, j) => kept[i].host - kept[j].host || i - j);
    const ranges = new Int32Array(layout.fragments.length * 2);
    for (let k = 0; k < order.length; k++) {
      const host = kept[order[k]].host;
      if (ranges[host * 2 + 1] === 0) ranges[host * 2] = k;
      ranges[host * 2 + 1]++;
    }
    const gates = hasEdges ? Int32Array.from(order, (i) => kept[i].gate) : null;
    const hosts = hasEdges ? Int32Array.from(order, (i) => kept[i].host) : null;
    const byGate = hasEdges ? new Map<number, number[]>() : null;
    if (gates && byGate) {
      gates.forEach((g, k) => { if (g >= 0) (byGate.get(g) ?? byGate.set(g, []).get(g)!).push(k); });
    }

    const geometry = buildPrimitive(layer.primitive);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: SCATTER_ENGINE.roughness,
      metalness: 0,
      vertexColors: false,
      side: meta.flat ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, order.length);
    mesh.name = `scatter:${layer.id}`;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const shadow = layer.blobShadow ? this.createShadowMesh(layer.id, order.length) : null;
    const footprint = footprintRadius(geometry) * SCATTER_ENGINE.shadowRadiusScale;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const qYaw = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();
    const m = this.tmpMatrix;

    for (let k = 0; k < order.length; k++) {
      const c = kept[order[k]];
      const height = c.scale * meta.height;
      const y = meta.height === 0
        ? SCATTER_ENGINE.decalLift
        : meta.flat ? 0 : -height * SCATTER_ENGINE.sinkFraction;
      qYaw.setFromAxisAngle(Y_AXIS, c.yaw);
      // Inclinación hacia (cos dir, sin dir) en XZ: eje perpendicular.
      axis.set(Math.sin(c.tiltDir), 0, -Math.cos(c.tiltDir));
      qTilt.setFromAxisAngle(axis, c.tiltMag);
      quat.copy(qTilt).multiply(qYaw);
      pos.set(c.x, y, c.z);
      scl.setScalar(c.scale);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(k, m);
      color.setRGB(c.r, c.g, c.b);
      mesh.setColorAt(k, color);

      if (shadow) {
        const sr = c.scale * footprint;
        pos.set(c.x, SCATTER_ENGINE.shadowLift, c.z);
        scl.set(sr, 1, sr);
        m.compose(pos, quat.identity(), scl);
        shadow.setMatrixAt(k, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    if (shadow) {
      shadow.instanceMatrix.needsUpdate = true;
      this.group.add(shadow);
    }

    const shadowTris = shadow ? triangleCount(shadow.geometry) : 0;
    const local = Float32Array.from(mesh.instanceMatrix.array);
    const shadowLocal = shadow ? Float32Array.from(shadow.instanceMatrix.array) : null;
    // El fleco latente nace oculto: `local` guarda su matriz de verdad.
    if (gates) {
      gates.forEach((g, k) => {
        if (g < 0) return;
        mesh.instanceMatrix.array.fill(0, k * 16, k * 16 + 16);
        if (shadow) shadow.instanceMatrix.array.fill(0, k * 16, k * 16 + 16);
      });
    }
    return {
      id: layer.id,
      mesh,
      shadow,
      local,
      shadowLocal,
      ranges,
      gates,
      hosts,
      revealed: gates ? new Uint8Array(gates.length) : null,
      byGate,
      triangles: order.length * (triangleCount(geometry) + shadowTris),
      clipped,
    };
  }

  private createShadowMesh(layerId: string, count: number): THREE.InstancedMesh {
    if (!this.shadowMaterial) {
      this.shadowMaterial = new THREE.MeshBasicMaterial({
        color: SCATTER_ENGINE.shadowColor,
        transparent: true,
        opacity: SCATTER_ENGINE.shadowOpacity,
        depthWrite: false,
      });
    }
    const shadow = new THREE.InstancedMesh(buildShadowDisc(), this.shadowMaterial, count);
    shadow.name = `scatter:${layerId}#shadow`;
    shadow.frustumCulled = false;
    shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return shadow;
  }

  /** `matrix × local` en el rango. Con `layer`, el fleco latente que aún
   *  no se ha destapado se queda a escala 0. */
  private recompose(
    mesh: THREE.InstancedMesh, local: Float32Array,
    start: number, count: number, matrix: THREE.Matrix4,
    layer: LayerRuntime | null,
  ): void {
    const attr = mesh.instanceMatrix;
    const m = this.tmpMatrix;
    const gates = layer?.gates, revealed = layer?.revealed;
    for (let i = start; i < start + count; i++) {
      const off = i * 16;
      if (gates && revealed && gates[i]! >= 0 && !revealed[i]) { attr.array.fill(0, off, off + 16); continue; }
      m.fromArray(local, off).premultiply(matrix).toArray(attr.array, off);
    }
    markRange(attr, start, count);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function zeroRange(attr: THREE.InstancedBufferAttribute, start: number, count: number): void {
  attr.array.fill(0, start * 16, (start + count) * 16);
  markRange(attr, start, count);
}

/** Sube solo el rango tocado. Si el rango es el búfer entero (el
 *  fragmento posee todas las instancias) se deja sin rangos: three sube
 *  todo, que es lo mismo y más barato de gestionar. */
function markRange(attr: THREE.InstancedBufferAttribute, start: number, count: number): void {
  if (count * 16 >= attr.array.length) attr.clearUpdateRanges();
  else attr.addUpdateRange(start * 16, count * 16);
  attr.needsUpdate = true;
}
