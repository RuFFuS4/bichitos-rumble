// ---------------------------------------------------------------------------
// Blob shadows — sombras de contacto instanciadas para critters y props
// ---------------------------------------------------------------------------
//
// Terreno v2, capa densa (docs/DIORAMAS.md parte 2, §1 causa 3 y fase 4).
//
// El porqué: hoy NADA proyecta sombra. `grep castShadow src/` da tres
// líneas — dos mallas procedurales que se ocultan al acoplar el GLB y la
// key light — y por eso critters y props se leen como pegatinas que
// flotan sobre el suelo. Encender `castShadow` de verdad es inviable: los
// critters gordos llegan a 1,9 M de triángulos y el shadow map los
// dibujaría dos veces por frame. La solución arcade es la sombra de
// contacto: un disco oscuro suave bajo cada objeto, que es lo que hace el
// 90 % de los juegos cartoon y lo que las cinco referencias de Rafa
// (resources/Terrenos/*) muestran bajo cada palmera, roca y linterna.
//
// Cómo: UN `InstancedMesh` para todas las sombras de la escena = 1 draw
// call. Disco plano de 24 segmentos y 2 anillos (72 tris, 49 vértices)
// con el degradado radial de opacidad HORNEADO en el alpha del color de
// vértice (itemSize 4): opaco en el centro, 0 en el borde. La opacidad
// por instancia viaja en `instanceColor.r` y un parche de una línea en el
// fragment shader la multiplica al alpha (`diffuseColor.a *= vColor.r`):
// el material es negro, así que el canal RGB de la instancia estaría
// muerto de todos modos. Blending normal → cada sombra MULTIPLICA lo que
// tiene debajo por (1 − opacidad × degradado), independiente del espacio
// de color de salida y del tone mapping (que solo tocan RGB).
//
// Coste: 0 bytes de payload, 1 draw call, 72 tris por slot ocupado (los
// libres van a escala 0: triángulos degenerados, gratis).
//
// Separación de capas: esto es VISUAL. No colisiona, no entra en
// `isOnArena`, no toca física ni colapso. Se puede quitar entero y el
// juego es el mismo.
//
// AVISO (docs/DIORAMAS.md §3, decisión 2): el mesh cuelga de la ESCENA,
// nunca de `arena.group` ni de un fragmento. `buildFromSeed` y `reset`
// hacen `traverse` + `geometry.dispose()` sobre cada fragmento, y un
// `InstancedMesh` es un `Mesh`: reparentarlo ahí destruye la geometría
// compartida y la partida siguiente renderiza vacío.
//
// Determinismo: aquí no hay azar. Las sombras siguen a lo que las llama.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { ARENA_LOOK } from './arena-look';

/** Hoja numérica de la sombra de contacto. Hermana de ARENA_LOOK (que ya
 *  aporta `critterShadowScale` y `critterShadowOpacity`): aquí solo vive
 *  lo que es de la primitiva, no del bioma ni del critter. */
export const BLOB_SHADOW = {
  /** Segmentos del disco. 24 basta para que a 34 px de ancho no se vea
   *  el polígono; más es gastar vértices en nada. */
  segments: 24,
  /** Anillos concéntricos del degradado. Con 1 el alpha cae lineal
   *  (borde duro); con 2 hay meseta oscura y cola suave. */
  rings: 2,
  /** Perfil radial: alpha(t) = (1 − t²)^power. >1 ensancha la meseta. */
  falloffPower: 1.5,
  /** Elevación sobre la tapa del disco (y=0). Junto con polygonOffset
   *  evita el z-fight con el suelo sin despegar visualmente la sombra. */
  yLift: 0.02,
  /** Empuja la sombra hacia la cámara en el depth test (negativo = más
   *  cerca) para que gane siempre al suelo coplanar. */
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -2,
  /** Primero entre los transparentes: los VFX y los critters que se
   *  desvanecen se componen ENCIMA de la sombra, no debajo. */
  renderOrder: -1,
  /** Slots por defecto: 9 critters de roster + los ~18 props del pack
   *  más cargado (coral_beach) con margen. */
  defaultCapacity: 64,
  /** Altura (u) a la que la sombra de un critter se ha desvanecido del
   *  todo: al saltar o caer se aleja de él y se apaga. */
  fadeHeight: 2,
  /** Radio de la sombra de un prop respecto a la media geométrica de su
   *  huella (√(ancho × fondo) / 2). 1 = la huella tal cual. */
  propRadiusScale: 1.0,
  /** Los props son estáticos y grandes: un poco menos densa que la del
   *  critter para no ensuciar el suelo bajo un torii. */
  propOpacityMul: 0.8,
} as const;

const SLOT_NONE = -1;

/** Disco plano en XZ (normal +Y), radio 1, con el degradado radial de
 *  opacidad en el alpha del color de vértice. Se escala por instancia. */
function buildDiscGeometry(): THREE.BufferGeometry {
  const { segments, rings, falloffPower } = BLOB_SHADOW;
  const vertexCount = 1 + segments * rings;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const indices: number[] = [];

  // Centro: opaco.
  colors[0] = 1; colors[1] = 1; colors[2] = 1; colors[3] = 1;

  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    // Borde exterior exactamente a 0 para que el disco no tenga corte.
    const alpha = ring === rings ? 0 : Math.pow(1 - t * t, falloffPower);
    for (let i = 0; i < segments; i++) {
      const v = 1 + (ring - 1) * segments + i;
      const angle = (i / segments) * Math.PI * 2;
      positions[v * 3] = Math.cos(angle) * t;
      positions[v * 3 + 1] = 0;
      positions[v * 3 + 2] = Math.sin(angle) * t;
      colors[v * 4] = 1; colors[v * 4 + 1] = 1; colors[v * 4 + 2] = 1;
      colors[v * 4 + 3] = alpha;
    }
  }

  // Abanico central. Orden (centro, i+1, i) para que la normal salga +Y.
  for (let i = 0; i < segments; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % segments);
    indices.push(0, b, a);
  }
  // Coronas entre anillos: dos triángulos por celda, mismo sentido.
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * segments;
    const outer = inner + segments;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      indices.push(inner + i, outer + j, outer + i);
      indices.push(inner + i, inner + j, outer + j);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geo.setIndex(indices);
  return geo;
}

function buildMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: BLOB_SHADOW.polygonOffsetFactor,
    polygonOffsetUnits: BLOB_SHADOW.polygonOffsetUnits,
    // Una sombra oscurece lo que tiene debajo, y eso ya viene con su
    // niebla: teñirla otra vez la convertiría en una mancha de color.
    fog: false,
  });
  // Opacidad por instancia: three no tiene alpha por instancia, pero
  // `instanceColor` (vec3) sí multiplica `vColor.rgb`. Con color negro el
  // RGB no aporta nada, así que usamos su canal R como alpha. Si un día el
  // chunk `color_fragment` cambiara de nombre, el replace no encuentra
  // nada y todas las sombras salen a opacidad de vértice (visible, no
  // roto).
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n\tdiffuseColor.a *= vColor.r;',
    );
  };
  return mat;
}

/**
 * Pool de sombras de contacto en un solo `InstancedMesh`.
 *
 * Ciclo de vida de un slot: `add()` lo reserva (escala 0, invisible),
 * `set()` lo coloca, `remove()` lo devuelve al pool. Los slots libres se
 * reciclan (LIFO). Con el pool lleno `add()` devuelve −1 y avisa UNA vez
 * por consola; `set`/`remove` con −1 o con un slot libre son no-ops, así
 * que el llamador puede pasar el resultado de `add()` sin comprobarlo.
 *
 * Un pool, varios dueños: Game reserva los slots de los critters y Arena
 * los de los props. Cada dueño guarda sus slots y los devuelve él mismo.
 * No hay `clear()` a propósito: vaciarlo todo desde un lado dejaría al
 * otro con slots que ya no son suyos y sus `set` se volverían no-ops.
 *
 * Critters (cada frame, game.ts → syncCritterShadows):
 *   shadows.set(slot, c.x, c.z,
 *     c.radius * ARENA_LOOK.critterShadowScale,
 *     ARENA_LOOK.critterShadowOpacity * max(0, 1 − max(0, y) / fadeHeight))
 *   con opacidad 0 si el critter está cayendo o eliminado. Lee ARENA_LOOK
 *   en vivo, así `setArenaLook` se aplica sin rebuild.
 *
 * Props estáticos (una vez, arena.ts, tras `host.attach(mesh)` y con la
 * bbox de MUNDO ya asentada por el auto-grounding de arena-decorations):
 *   const slot = shadows.add();
 *   shadows.setForBox(slot, new THREE.Box3().setFromObject(mesh));
 *   mesh.userData.shadowSlot = slot;
 * y `remove(mesh.userData.shadowSlot)` cuando su fragmento empieza a caer
 * (startFragmentFall) o el pack se desmonta (clearPack): si no se retira,
 * la sombra se queda pintada sobre el vacío donde estaba la tapa.
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;

  private readonly free: number[] = [];
  private readonly used: Uint8Array;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();
  private readonly scratchVec = new THREE.Vector3();
  private warnedFull = false;

  constructor(capacity: number = BLOB_SHADOW.defaultCapacity) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.used = new Uint8Array(this.capacity);
    this.mesh = new THREE.InstancedMesh(buildDiscGeometry(), buildMaterial(), this.capacity);
    this.mesh.name = 'blob-shadows';
    this.mesh.renderOrder = BLOB_SHADOW.renderOrder;
    // Las instancias se reparten por todo el disco y la bounding sphere
    // del InstancedMesh se calcula sobre el disco unitario en el origen:
    // sin esto el culling apaga todas las sombras en cuanto el origen
    // sale del cuadro.
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Todos los slots a escala 0 y opacidad 0 desde el primer frame. El
    // `setColorAt` inicial también crea `instanceColor`, que es lo que
    // hace que el programa compile con USE_INSTANCING_COLOR.
    this.scratchMatrix.makeScale(0, 0, 0);
    this.scratchColor.setRGB(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, this.scratchMatrix);
      this.mesh.setColorAt(i, this.scratchColor);
    }
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // Pila LIFO: el primer add() devuelve el 0.
    for (let i = this.capacity - 1; i >= 0; i--) this.free.push(i);
  }

  /** Slots ocupados ahora mismo. */
  get activeCount(): number {
    return this.capacity - this.free.length;
  }

  /** Reserva un slot (invisible hasta el primer `set`). −1 si el pool
   *  está lleno. */
  add(): number {
    const slot = this.free.pop();
    if (slot === undefined) {
      if (!this.warnedFull) {
        this.warnedFull = true;
        console.warn(`[BlobShadows] pool lleno (${this.capacity}): sombras extra omitidas`);
      }
      return SLOT_NONE;
    }
    this.used[slot] = 1;
    return slot;
  }

  /** Coloca una sombra: centro (x, z) sobre la tapa, radio en u de mundo
   *  y opacidad máxima en el centro (0..1). Radio u opacidad ≤ 0 la
   *  ocultan sin liberar el slot. */
  set(slot: number, x: number, z: number, radius: number, opacity: number): void {
    if (!this.isUsed(slot)) return;
    const visible = radius > 0 && opacity > 0;
    if (visible) {
      this.scratchMatrix.makeScale(radius, 1, radius);
      this.scratchMatrix.setPosition(x, BLOB_SHADOW.yLift, z);
    } else {
      this.scratchMatrix.makeScale(0, 0, 0);
    }
    this.mesh.setMatrixAt(slot, this.scratchMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    const a = visible ? Math.min(1, opacity) : 0;
    this.scratchColor.setRGB(a, a, a);
    this.mesh.setColorAt(slot, this.scratchColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Sombra de un prop estático a partir de su bbox de MUNDO (medida tras
   *  el auto-grounding, como hace arena-decorations). Radio = media
   *  geométrica de la huella / 2 × propRadiusScale: una palma de copa
   *  ancha y tronco fino queda con una sombra media, no con un plato. */
  setForBox(slot: number, box: THREE.Box3, opacityMul: number = BLOB_SHADOW.propOpacityMul): void {
    if (box.isEmpty()) return;
    const size = box.getSize(this.scratchVec);
    const radius = 0.5 * Math.sqrt(Math.max(0, size.x * size.z)) * BLOB_SHADOW.propRadiusScale;
    const center = box.getCenter(this.scratchVec);
    this.set(slot, center.x, center.z, radius, ARENA_LOOK.critterShadowOpacity * opacityMul);
  }

  /** Devuelve el slot al pool. Idempotente. */
  remove(slot: number): void {
    if (!this.isUsed(slot)) return;
    this.scratchMatrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(slot, this.scratchMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scratchColor.setRGB(0, 0, 0);
    this.mesh.setColorAt(slot, this.scratchColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.used[slot] = 0;
    this.free.push(slot);
  }

  private isUsed(slot: number): boolean {
    return slot >= 0 && slot < this.capacity && this.used[slot] === 1;
  }
}
