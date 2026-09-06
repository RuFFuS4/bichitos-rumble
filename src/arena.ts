// ---------------------------------------------------------------------------
// Arena — visual representation of the irregular fragment floor
// ---------------------------------------------------------------------------
// Bloque B 3b: replaces the uniform ring system with seed-deterministic
// sectors that collapse in batches. Both offline and online modes use the
// same fragment layout — the difference is WHO drives the collapse:
//   - Offline: Arena.update(dt) ticks its own timers.
//   - Online:  Arena.syncFromServer(level, warningBatch) mirrors the server.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  generateArenaLayout, isPointOnArena, pointInFragment, FRAG,
  type ArenaLayout, type FragmentDef,
} from './arena-fragments';
import { playArenaWarning } from './audio';
import { ARENA_LOOK, SALT_VISUAL } from './arena-look';
import {
  type ArenaPackId,
  layoutPackProps,
  loadPackGroundTexture,
  loadPackSkyboxTexture,
  loadPackPropMeshes,
  getPackFogColor,
  getPackDecorScale,
  loadInArenaDecorations,
} from './arena-decorations';
import { getDecorLayout } from './arena-decor-layouts';
import { setSceneSkyboxTexture, setSceneFogColor } from './scene-atmosphere';

// Visual parameters for the pre-collapse shake effect. Applied to
// `fragmentGroup.position.x/z` ONLY — collisions and `isOnArena` use the
// static layout geometry, so wobbling the mesh doesn't make the floor
// untrustworthy. Amplitudes are tiny (8cm in world space) so the player
// can still stand on it comfortably.
const SHAKE_AMP_MAX    = 0.08;  // world units
const SHAKE_FREQ_HIGH  = 28;    // Hz, tight chatter
const SHAKE_FREQ_MID   = 13;    // Hz, mid wobble
const SHAKE_FREQ_LOW   = 7;     // Hz, slow ground heave
const WARNING_EMISSIVE_COLOR = 0xff7733;   // warm orange, NOT red flash

const ARC_SEGMENTS = 16;       // arc resolution per fragment shape edge
// Resolución del círculo del centro inmune. Subida de 32 a 96 en la
// fase 1: a 32 el borde del islote se veía poligonal desde la cámara
// de juego, y es la pieza que más mira el jugador en el endgame.
const CENTER_SEGMENTS = 96;


// Per-band base colors. Distinct enough that the user can SEE where one
// band ends and the next begins (even when bands are concentric rings of
// the same green family). Immune center is the brightest.
const BAND_COLORS: Record<number, number> = {
  0: 0x6fa35f, // immune center — brightest green
  1: 0x5c8a50, // inner band
  2: 0x4a6741, // mid band
  3: 0x3a5331, // outer band — darkest
};
// 2026-09-06 (fase 1): fuera IMMUNE_SIDE_COLOR. El canto del centro ya no
// es un verde fijo que desentonaba en los 5 biomas: sale del mismo tinte
// que su tapa multiplicado por ARENA_LOOK.cliffTint, igual que el resto
// de acantilados del disco.

/**
 * Rol visual de cada mesh del suelo. Sustituye a la heurística vieja
 * ("si tiene receiveShadow es una tapa"), que tiñó de gris hasta el
 * centro inmune y mató los colores de banda.
 */
type GroundRole = 'top' | 'cliff' | 'bottom';

/** mulberry32 local para lo VISUAL — stream propio (seed ^ SALT_VISUAL) para
 *  no desplazar la salida del generador de terreno, que es gameplay. */
function visualRand(seed: number): () => number {
  let t = (seed ^ SALT_VISUAL) | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tinte final de un fragmento: base × banda × jitter. El resultado
 * MULTIPLICA la textura del pack, así que se mantiene cerca del blanco
 * (la textura pone el color; esto solo modula el brillo).
 */
function tintForBand(band: number, jitter: number): THREE.Color {
  const c = new THREE.Color(ARENA_LOOK.tintBase);
  const bandMul = ARENA_LOOK.bandTint[Math.min(band, 3)] ?? 1;
  c.multiplyScalar(bandMul * jitter);
  return c;
}

/**
 * Reescribe las UV de una geometría a COORDENADAS DE MUNDO (el plano XY
 * del shape antes de tumbarlo). ExtrudeGeometry ya las genera así; el
 * centro (CircleGeometry, UV 0..1) y la falda (UV polares) no, y por eso
 * las tres superficies tenían densidades de tile distintas — hasta 8×.
 */
function worldUvs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (!pos || !uv) return;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  uv.needsUpdate = true;
}

/**
 * Recursively dispose geometry + materials of every mesh under a group,
 * then clear children. Used both for fragment rebuilds and for
 * decorations teardown — same mechanics in both places.
 *
 * Note: material maps (ground texture, skybox) are NOT disposed — they
 * live in the texture cache in arena-decorations and are reused across
 * matches. Disposing them would force a re-decode on every reload.
 */
/**
 * Recorre los materiales de un mesh, sea uno o un array. Desde que los
 * sectores llevan [tapa, acantilado] (fase 1), castear `child.material` a
 * un único MeshStandardMaterial revienta en el primer aviso de colapso.
 */
function forEachMaterial(
  child: THREE.Mesh,
  fn: (mat: THREE.MeshStandardMaterial) => void,
): void {
  const mat = child.material;
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      fn(m as THREE.MeshStandardMaterial);
    }
  }
}

function disposeGroupMeshes(root: THREE.Object3D): void {
  root.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else if (mat instanceof THREE.Material) {
        mat.dispose();
      }
    }
  });
  while (root.children.length > 0) root.remove(root.children[0]!);
}

// --- Fragment mesh builder -----------------------------------------------

function createFragmentMesh(f: FragmentDef, jitterRand = 0.5): THREE.Group {
  const group = new THREE.Group();
  const h = FRAG.arenaHeight;

  if (f.immune) {
    // Immune center: circle + cylinder side + bottom circle. Es la ZONA
    // SEGURA (nunca cae): tiene que distinguirse del resto del disco de
    // un vistazo, así que va con el tinte más claro de la tabla.
    const topGeo = new THREE.CircleGeometry(f.outerR, CENTER_SEGMENTS);
    worldUvs(topGeo);
    const topMat = new THREE.MeshStandardMaterial({
      color: tintForBand(0, 1), side: THREE.DoubleSide,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    top.userData.groundRole = 'top' as GroundRole;
    group.add(top);

    const sideGeo = new THREE.CylinderGeometry(f.outerR, f.outerR, h, CENTER_SEGMENTS, 1, true);
    const sideMat = new THREE.MeshStandardMaterial({
      color: tintForBand(0, ARENA_LOOK.cliffTint), side: THREE.DoubleSide,
    });
    const side = new THREE.Mesh(sideGeo, sideMat);
    side.position.y = -h / 2;
    side.userData.groundRole = 'cliff' as GroundRole;
    group.add(side);

    const botGeo = new THREE.CircleGeometry(f.outerR, CENTER_SEGMENTS);
    const botMat = new THREE.MeshStandardMaterial({ color: 0x2a3a22, side: THREE.DoubleSide });
    const bot = new THREE.Mesh(botGeo, botMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.y = -h;
    bot.userData.groundRole = 'bottom' as GroundRole;
    group.add(bot);
    return group;
  }

  // Collapsible sector: Shape → ExtrudeGeometry
  const shape = new THREE.Shape();
  const { innerR, outerR, startAngle, endAngle } = f;
  const span = endAngle - startAngle;

  // Trace outline: inner-start → outer-start → outer arc → inner-end → inner arc (close)
  shape.moveTo(
    Math.cos(startAngle) * innerR,
    Math.sin(startAngle) * innerR,
  );
  shape.lineTo(
    Math.cos(startAngle) * outerR,
    Math.sin(startAngle) * outerR,
  );
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const a = startAngle + (span * i) / ARC_SEGMENTS;
    shape.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
  }
  shape.lineTo(
    Math.cos(endAngle) * innerR,
    Math.sin(endAngle) * innerR,
  );
  for (let i = ARC_SEGMENTS - 1; i >= 0; i--) {
    const a = startAngle + (span * i) / ARC_SEGMENTS;
    shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: false,
  });
  // ExtrudeGeometry emite DOS grupos: 0 = tapas (arriba y abajo), 1 = pared
  // lateral. Con un solo material la pared llevaba la textura del suelo
  // estirada y el canto no se leía; con dos, el acantilado se oscurece y
  // la losa gana volumen. `jitter` rompe la uniformidad dentro de la banda.
  const jitter = 1 + (jitterRand - 0.5) * 2 * ARENA_LOOK.fragmentTintJitter;
  const topMat = new THREE.MeshStandardMaterial({
    color: tintForBand(f.band, jitter), side: THREE.DoubleSide,
  });
  const cliffMat = new THREE.MeshStandardMaterial({
    color: tintForBand(f.band, jitter * ARENA_LOOK.cliffTint), side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, [topMat, cliffMat]);
  mesh.userData.groundRole = 'top' as GroundRole;
  // CRITICAL: rotation direction matters here.
  //
  // ExtrudeGeometry places the shape in XY and extrudes along +Z. To lay
  // it flat on XZ we rotate around X, but the SIGN of that rotation
  // decides how shape-angle maps to world-angle:
  //
  //   rot X by -π/2:  (x, y, z) → (x, z, -y)   ← MIRRORS shape Y onto -Z
  //   rot X by +π/2:  (x, y, z) → (x, -z, y)   ← shape Y → world +Z
  //
  // The physics `pointInFragment` uses atan2(z, x) without mirroring, so
  // it expects shape-angle π/2 to be at world +Z. With -π/2 rotation the
  // mesh is drawn at world -Z — visual and physics diverge. Bug reported
  // as "visible terrain not walkable / invisible terrain walkable".
  // Fix: use +π/2. That also extrudes DOWN naturally (back face at y=-h,
  // front face at y=0), so no position offset is needed.
  mesh.rotation.x = Math.PI / 2;
  mesh.receiveShadow = true;
  group.add(mesh);

  return group;
}

// --- Arena class ---------------------------------------------------------

/**
 * Read-only snapshot of the collapse timeline, valid in BOTH modes.
 *
 * The collapse has two drivers (offline `update()` vs online
 * `syncFromServer()`) writing to two different sets of fields. Consumers
 * (lab panels, dev-api events, match recordings) must not care which one
 * is running, so `getCollapseState()` is the single source they read.
 *
 * Historia: hasta 2026-09-06 los consumidores leían `syncedLevel` /
 * `syncedWarning` por un cast a privados, y offline esos campos se
 * quedan en −1 / −2 para siempre → nivel "−1/N" en el lab, contadores de
 * fragmentos equivocados y cero eventos `collapse_*` en el golden
 * (docs/ARENA_V2.md §1.3 punto 15).
 */
export interface ArenaCollapseState {
  /** Batches that have ALREADY collapsed (0 before the first one falls). */
  level: number;
  /** Batch currently inside its warning window; -1 when none is warning. */
  warningBatch: number;
  /** Total batches in the layout (0 when there is no layout yet). */
  batchCount: number;
  /** Fragments still standing, immune center included. */
  fragmentsAlive: number;
  /** Fragments in the layout, immune center included. */
  fragmentsTotal: number;
}

export class Arena {
  currentRadius = FRAG.maxRadius;
  group: THREE.Group;

  // Fragment state
  private layout: ArenaLayout | null = null;
  private alive: boolean[] = [];
  private fragmentGroups: THREE.Group[] = [];

  // Offline collapse driver
  private level = 0;
  private timer = 0;
  private warningActive = false;
  private warningTimer = 0;

  // Falling fragments — entries are pushed when a batch collapses (in
  // either offline `collapseCurrentBatch` or online `syncFromServer`),
  // and advanced each frame in `update()` until they drop past the void
  // floor, at which point the mesh is hidden and the entry dropped.
  // Visual-only: gameplay still treats the fragment as gone the instant
  // `alive[idx] = false` (the physics path runs from that array, not
  // from visibility).
  private fallingFragments: Array<{
    idx: number;
    vy: number;              // downward velocity (world units / s)
    rotX: number;            // tumbling angular velocity (rad / s)
    rotZ: number;
    startY: number;          // initial Y so we can decide when to stop
  }> = [];

  // Online sync tracking
  private syncedLevel = -1;
  private syncedWarning = -2;
  private syncedSeed = -1;
  /** True once `syncFromServer` has run for the current layout: the
   *  server owns the timeline and `level` / `warningActive` stay frozen.
   *  Read ONLY by `getCollapseState()` to pick which pair of fields is
   *  the live one — an explicit flag instead of testing `syncedLevel >= 0`,
   *  which is the sentinel that made offline observability lie. */
  private serverDriven = false;

  // Decorations (arena pack cosmetics) — skybox + fog + ground texture +
  // prop meshes scattered in a ring outside the playable radius. Separate
  // group so collapse logic (which iterates fragmentGroups) never touches
  // it. Async-loaded; if a pack asset 404s the group silently stays empty.
  private decorationsGroup: THREE.Group | null = null;
  private appliedPackId: ArenaPackId | null = null;
  /** Sequence counter — bumped on every applyPack call so older in-flight
   *  async loaders can tell they've been superseded and bail out without
   *  writing stale meshes into the live scene. */
  private packApplyToken = 0;
  /**
   * Resolves when the most recent applyPack() has finished loading every
   * asset (ground texture, skybox, outer props, in-arena decor) — or has
   * given up because of a fetch error. Used by `waitForPack()` so the
   * countdown can wait for visible decor before "GO!" instead of starting
   * with an empty arena while textures pop in mid-match.
   * Initialised to a resolved promise so callers can `waitForPack()` even
   * before any pack has been applied.
   */
  private currentPackPromise: Promise<void> = Promise.resolve();
  private sceneRef: THREE.Scene;
  /** Per-prop batch association. When batch `N` collapses, every prop
   *  with `batchIndex === N` enters the falling-decoration queue. */
  private propBatchIndex: number[] = [];
  /** Which decoration meshes are currently falling. Separate from
   *  `fallingFragments` so the prop tumble has its own cadence + the
   *  outerRing (single large piece) can fall with a different profile. */
  private fallingDecorations: Array<{
    object: THREE.Object3D;
    vy: number;
    rotX: number;
    rotZ: number;
    startY: number;
  }> = [];

  // Base colors for resetting after the warning effect clears. Kept even
  // though the shake effect no longer tints the base color — the field
  // stays useful if we re-introduce colour shifts later and avoids a
  // breaking API change.
  private baseColors: number[] = [];

  // Wallclock timestamp (s) when the current warning visual started. Used
  // to drive the shake `progress` curve in both offline and online paths
  // from a single source of truth. null when no warning is active.
  private warningStartedAt: number | null = null;

  // Diagnostic helpers — null unless toggled on via the window.__arena API
  private debugCompass: THREE.Group | null = null;
  private debugLogCollapses: boolean = false;

  constructor(scene: THREE.Scene) {
    this.sceneRef = scene;
    this.group = new THREE.Group();

    // 2026-09-06 (terreno v2 fase 1, decisión de Rafa): FUERA el void.
    // Eran dos mallas —un cilindro r=40 negro al 90 % de opacidad y un
    // disco opaco a y=−30— que tapaban el skybox del pack justo en el
    // cono que ve la cámara (de −26° a −66°). Ese "borrón oscuro"
    // alrededor del disco no era el cielo: era esto. Sin ellas, cada
    // bioma asoma su propio horizonte bajo el borde de la arena.
    //
    // En su lugar, un anillo de sombra de contacto: da peso a la losa
    // contra el fondo y marca el borde del vacío, que es la información
    // más importante de la pantalla en un juego de tirar al rival fuera.
    // Sombra de contacto: PROBADA Y DESCARTADA (2026-09-06). Un anillo
    // oscuro con degradado bajo el disco funciona sobre fondos oscuros,
    // pero los cinco biomas tienen horizontes CLAROS (agua turquesa,
    // nieve, dunas) y ahí se lee como un halo sucio alrededor de la isla,
    // no como peso. El canto del acantilado —material propio, más oscuro
    // que la tapa— ya asienta la losa contra el fondo sin añadir geometría.
    // Si vuelve, que sea por bioma (PackDef.look, fase 3), no global.

    scene.add(this.group);
  }

  // --- Seed-based layout build -------------------------------------------

  /**
   * Build (or rebuild) the fragment floor from a deterministic seed. When
   * a `packId` is supplied, also swap in the pack's skybox, fog colour,
   * ground texture, and decorative props (async, non-blocking — the
   * fragment geometry is created immediately). If `packId` is omitted the
   * arena uses the procedural sky + flat band colours, same look as the
   * legacy (pre-decorations) behaviour.
   */
  buildFromSeed(seed: number, packId?: ArenaPackId): void {
    // Dispose previous fragment meshes
    for (const g of this.fragmentGroups) {
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      this.group.remove(g);
    }

    this.layout = generateArenaLayout(seed);
    this.alive = this.layout.fragments.map(() => true);
    this.fragmentGroups = [];
    this.baseColors = [];
    this.level = 0;
    this.timer = 0;
    this.warningActive = false;
    this.warningTimer = 0;
    this.warningStartedAt = null;
    this.syncedLevel = -1;
    this.syncedWarning = -2;
    this.syncedSeed = seed;
    this.serverDriven = false;
    this.currentRadius = FRAG.maxRadius;
    this.fallingFragments = [];

    // Jitter de brillo por fragmento: stream visual propio (seed ^ SALT),
    // así que es igual en todos los clientes de una sala y NO desplaza la
    // secuencia de `rand()` del generador de terreno (que es gameplay).
    const vRand = visualRand(seed);
    for (const f of this.layout.fragments) {
      const mesh = createFragmentMesh(f, vRand());
      this.fragmentGroups.push(mesh);
      this.group.add(mesh);
      // Store base color so we can restore it after a warning blink ends.
      this.baseColors.push(BAND_COLORS[f.band] ?? 0x4a6741);
    }

    // Apply pack cosmetics (async — fragments are already up, decor
    // settles in a few frames later). The promise is captured on
    // `currentPackPromise` so callers can `waitForPack()` before
    // showing "GO!" instead of starting a match against an empty arena.
    if (packId) {
      this.currentPackPromise = this.applyPack(packId, seed);
    } else {
      this.clearPack();
      this.currentPackPromise = Promise.resolve();
    }
  }

  /**
   * Resolve when the in-flight pack load has finished, or when the
   * timeout elapses — whichever comes first. Used by the countdown gate
   * so the match doesn't start with bare fragments while textures and
   * decor GLBs are still in flight. Always resolves; the timeout exists
   * so a slow / failed asset can't block "GO!" forever.
   */
  waitForPack(timeoutMs = 2500): Promise<void> {
    const inFlight = this.currentPackPromise;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      inFlight.then(done, done);
      setTimeout(done, timeoutMs);
    });
  }

  // --- Pack (decorations) --------------------------------------------------

  /**
   * Swap in a cosmetic arena pack: skybox texture, fog colour, ground
   * texture tinted across every fragment, and decorative GLB props
   * scattered in a ring outside the playable radius. Deterministic:
   * given the same (packId, seed), every client places the props in
   * the same slots.
   *
   * Idempotent per (packId, seed): if the caller reapplies the same
   * pack on the same seed we still rebuild — rare, and it's cheap
   * thanks to the texture + model caches.
   */
  private applyPack(packId: ArenaPackId, seed: number): Promise<void> {
    // Token guards against a stale loader overwriting a newer pack.
    const myToken = ++this.packApplyToken;

    this.clearDecorations();
    this.appliedPackId = packId;

    // Fog + clear colour update immediately (synchronous) so the player
    // doesn't see a "wrong horizon" frame while textures load.
    setSceneFogColor(getPackFogColor(packId));

    // Each load runs in parallel; we await them all together so the
    // returned promise only resolves when every visible decor element
    // is up. Failures are logged + tolerated — a missing texture or
    // 404'd GLB does not block the countdown gate.
    const groundLoad = loadPackGroundTexture(packId)
      .then((tex) => {
        if (myToken !== this.packApplyToken) return; // superseded
        this.applyGroundTexture(tex);
      })
      .catch((err) => {
        console.warn('[Arena] ground texture load failed:', packId, err);
      });

    const skyboxLoad = loadPackSkyboxTexture(packId)
      .then((tex) => {
        if (myToken !== this.packApplyToken) return;
        setSceneSkyboxTexture(tex);
      })
      .catch((err) => {
        console.warn('[Arena] skybox load failed:', packId, err);
      });

    // Outer ring props — historically a ring of large GLBs at radius
    // 14.5–18.5 outside the arena. Now empty by design (every PACKS[id]
    // .props is []), so this loop is a no-op for every pack. Kept
    // structurally in case we re-introduce outer ornaments in the
    // future; today it does nothing visually.
    const propsLoad = (async () => {
      try {
        const placements = layoutPackProps(packId, seed);
        const meshes = await loadPackPropMeshes(packId, placements);
        if (myToken !== this.packApplyToken) {
          // Superseded — dispose so nothing leaks into the scene.
          for (const m of meshes) disposeGroupMeshes(m);
          return;
        }
        if (meshes.length > 0) {
          const deco = new THREE.Group();
          deco.name = `arena-decorations-${packId}`;
          for (const m of meshes) deco.add(m);
          this.decorationsGroup = deco;
          this.sceneRef.add(deco);
          this.propBatchIndex = this.computePropBatchIndex(placements);
        }
      } catch (err) {
        console.warn('[Arena] pack props load failed:', packId, err);
      }
    })();

    // In-arena decor — small props that live INSIDE the playable arena,
    // each parented to the fragment that contains it so it falls when
    // that fragment collapses. Layouts are static per pack (data-only,
    // see arena-decor-layouts.ts) so every client sees the same layout
    // without seed sync.
    const inArenaLoad = (async () => {
      try {
        const inArena = await loadInArenaDecorations(
          getDecorLayout(packId),
          getPackDecorScale(packId),
        );
        if (myToken !== this.packApplyToken) {
          for (const d of inArena) disposeGroupMeshes(d.mesh);
          return;
        }
        for (const { mesh, placement } of inArena) {
          const wx = Math.cos(placement.angle) * placement.r;
          const wz = Math.sin(placement.angle) * placement.r;
          const hostIdx = this.findFragmentAt(wx, wz);
          if (hostIdx < 0) {
            // Outside any fragment (e.g. between sectors due to jitter).
            // Drop the mesh so we don't leak; cosmetic only.
            disposeGroupMeshes(mesh);
            continue;
          }
          // Reparent to the host fragment group. Three.js' Object3D.attach
          // preserves the world transform across the parent change, which
          // is what we want — the mesh keeps its world (x,z) but later
          // when the fragment falls (group rotates + drops), the mesh
          // inherits the motion gratis.
          const host = this.fragmentGroups[hostIdx];
          if (!host) {
            disposeGroupMeshes(mesh);
            continue;
          }
          host.attach(mesh);
        }
      } catch (err) {
        console.warn('[Arena] in-arena decor load failed:', packId, err);
      }
    })();

    return Promise.allSettled([groundLoad, skyboxLoad, propsLoad, inArenaLoad])
      .then(() => undefined);
  }

  /**
   * Find the fragment index that contains the given world (x, z) point.
   * Returns -1 if no fragment hits — caller should treat that as "the
   * point is outside the arena" and skip whatever it was about to do.
   *
   * Used by in-arena decor placement to decide which fragment a prop
   * should be reparented to (so it falls together when that fragment
   * collapses).
   */
  private findFragmentAt(x: number, z: number): number {
    if (!this.layout) return -1;
    // Pass 1: strict containment — point lies inside the fragment shape.
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (f && pointInFragment(x, z, f)) return i;
    }
    // Pass 2: tolerant fallback for points OUTSIDE the fragment disc.
    //
    // Corrección 2026-09-06 (docs/ARENA_V2.md §1.3 punto 16): este
    // comentario decía que el generador deja huecos angulares entre
    // sectores por el `sectorJitter` y que por eso se perdían props. Es
    // falso: los sectores son contiguos por construcción (los ángulos se
    // ordenan y el final de cada sector ES el principio del siguiente,
    // src/arena-fragments.ts), y las bandas cubren 0..12 sin saltos de
    // radio. Medido: 0 fallos de cobertura en 100.000 puntos con r<12
    // (scripts/research/arena-stats.mts) y los 73 props autorizados
    // están todos en r≤11,5, así que hoy el pase 1 los coge todos.
    // Lo que este pase salva de verdad es un punto fuera del disco
    // (r>maxRadius, o r exactamente en el borde tras un cambio de
    // radios): el prop es visual, solo necesita ALGÚN grupo anfitrión
    // del que heredar la caída, así que lo colgamos del sector
    // angularmente más cercano en vez de descartarlo.
    const ang = Math.atan2(z, x);
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!f) continue;
      const mid = (f.startAngle + f.endAngle) * 0.5;
      // Wrap angular delta into [0, π] so 359°-vs-1° ≈ 2°, not 358°.
      let d = Math.abs(ang - mid);
      while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    }
    return bestIdx;
  }


  /**
   * Build an array that maps prop index → batch index. The association
   * is angular: for each prop, find the batch whose member fragments'
   * average angle is closest to the prop's angle. That way the fall
   * cascade reads as a ring "peeling" in sync with the arena collapse.
   * Immune-center fragments (single piece) are skipped — props never
   * associate with them. If there's no layout yet we return an empty
   * array (props will simply not fall; outerRing still drops at end).
   */
  private computePropBatchIndex(placements: Array<{ angle: number }>): number[] {
    if (!this.layout) return placements.map(() => 0);
    const batchMeanAngle = this.layout.batches.map((b) => {
      let sx = 0, sy = 0, count = 0;
      for (const idx of b.indices) {
        const f = this.layout!.fragments[idx];
        if (!f || f.immune) continue;
        const mid = (f.startAngle + f.endAngle) * 0.5;
        sx += Math.cos(mid);
        sy += Math.sin(mid);
        count++;
      }
      if (count === 0) return null;
      return Math.atan2(sy / count, sx / count);
    });
    return placements.map((p) => {
      let bestIdx = 0;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (let i = 0; i < batchMeanAngle.length; i++) {
        const a = batchMeanAngle[i];
        if (a === null || a === undefined) continue;
        // Wrap angular difference into [0, π].
        let d = Math.abs(p.angle - a);
        while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
        if (d < bestDelta) { bestDelta = d; bestIdx = i; }
      }
      return bestIdx;
    });
  }

  /** Undo whatever the last `applyPack` did: skybox + fog back to menu
   *  defaults, decorations disposed. Called from reset() and when the
   *  arena rebuilds without a packId. */
  private clearPack(): void {
    this.packApplyToken++;
    this.appliedPackId = null;
    setSceneSkyboxTexture(null);
    setSceneFogColor(null);
    this.clearDecorations();
    // Discard any in-flight falling decoration tumbles — remove them
    // from the scene graph and drop references.
    for (const f of this.fallingDecorations) {
      if (f.object.parent) f.object.parent.remove(f.object);
      disposeGroupMeshes(f.object);
    }
    this.fallingDecorations = [];
    this.propBatchIndex = [];
    // Also clear the ground texture we may have baked into fragments on
    // the previous pack — fresh fragments use the flat band colour again.
    this.clearGroundTexture();
  }

  /** Drop every prop mesh from the scene and dispose GPU resources. */
  private clearDecorations(): void {
    if (!this.decorationsGroup) return;
    this.sceneRef.remove(this.decorationsGroup);
    disposeGroupMeshes(this.decorationsGroup);
    this.decorationsGroup = null;
  }

  /**
   * Move every prop associated with `batchIdx` from the decorations
   * group to the falling-decorations queue. Each prop picks up some
   * downward velocity + a small tumble so the cascade reads as props
   * being shaken off the edge as the arena crumbles under them.
   *
   * Props are removed from `decorationsGroup` (so no further collapses
   * re-target them) and re-parented to `this.group` so `tickVisuals`
   * can advance their Y uniformly with the arena void.
   */
  private collapsePropBatch(batchIdx: number): void {
    if (!this.decorationsGroup || this.propBatchIndex.length === 0) return;
    const children = [...this.decorationsGroup.children];
    for (let i = 0; i < children.length; i++) {
      const propMesh = children[i]!;
      const assigned = this.propBatchIndex[i];
      if (assigned !== batchIdx) continue;
      this.decorationsGroup.remove(propMesh);
      this.sceneRef.add(propMesh); // keep world position; sceneRef is already the mesh's ancestor
      this.fallingDecorations.push({
        object: propMesh,
        vy: -1.5 + Math.random() * 0.6,            // slight initial drop
        rotX: (Math.random() - 0.5) * 1.6,          // tumble pitch
        rotZ: (Math.random() - 0.5) * 1.6,          // tumble roll
        startY: propMesh.position.y,
      });
    }
  }


  /**
   * Advance falling props + outer ring. Called from `tickVisuals` so
   * both offline and online paths share the same cadence. When a prop
   * drops below the void floor it's removed + disposed so the scene
   * doesn't keep invisible geometry around.
   */
  private tickFallingDecorations(dt: number): void {
    if (this.fallingDecorations.length === 0) return;
    const GRAVITY = 22;
    const VOID_FLOOR = -30;
    for (let i = this.fallingDecorations.length - 1; i >= 0; i--) {
      const f = this.fallingDecorations[i]!;
      f.vy -= GRAVITY * dt;
      f.object.position.y += f.vy * dt;
      f.object.rotation.x += f.rotX * dt;
      f.object.rotation.z += f.rotZ * dt;
      if (f.object.position.y < VOID_FLOOR) {
        if (f.object.parent) f.object.parent.remove(f.object);
        disposeGroupMeshes(f.object);
        this.fallingDecorations.splice(i, 1);
      }
    }
  }

  /**
   * Map the pack's ground texture onto every fragment TOP surface.
   *
   * Corrección 2026-09-06 (docs/ARENA_V2.md §1.3 punto 16): este
   * comentario decía "leaves the immune center alone". Es falso. El
   * filtro es `receiveShadow === true`, y la tapa del centro inmune
   * también lo lleva (`createFragmentMesh`), así que el centro recibe el
   * mismo mapa y el mismo `color = 0xdadada` que los sectores. Efecto
   * medido: con pack aplicado (siempre, en partida) los BAND_COLORS y el
   * verde del centro no se ven, y la zona segura no se distingue.
   * Se documenta, no se arregla aquí: el tinte por banda es de la fase 1
   * del plan (`ARENA_LOOK.bandTint` + `userData.role` en vez de la
   * heurística de `receiveShadow`). Lo único que queda fuera hoy son las
   * caras laterales e inferiores, que no llevan `receiveShadow`.
   */
  private applyGroundTexture(tex: THREE.Texture): void {
    // Solo pone el MAPA. El color ya lo decidió `createFragmentMesh`
    // (banda × pack × jitter, ARENA_LOOK) y multiplica la textura.
    //
    // 2026-09-06: antes esta función machacaba el color de TODO mesh con
    // `receiveShadow` a 0xdadada — incluido el centro inmune, pese a que
    // el comentario juraba lo contrario. Como en partida siempre hay pack,
    // los colores de banda no se veían JAMÁS y la zona segura no se
    // distinguía del resto del disco.
    for (const g of this.fragmentGroups) {
      g.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const role = child.userData.groundRole as GroundRole | undefined;
        if (role !== 'top' && role !== 'cliff') return;
        forEachMaterial(child, mat => {
          mat.map = tex;
          mat.needsUpdate = true;
        });
      });
    }
  }

  /** Remove ground textures from every fragment top. Called by
   *  `clearPack()` so the next rebuild without a pack shows the flat
   *  band colours again. */
  private clearGroundTexture(): void {
    for (const g of this.fragmentGroups) {
      g.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        forEachMaterial(child, mat => {
          if (mat.map) {
            mat.map = null;
            mat.needsUpdate = true;
          }
        });
      });
    }
  }

  // --- Offline mode: self-driven collapse --------------------------------

  /**
   * Advance visual-only animations that must run every frame in BOTH
   * offline + online paths — currently just the falling-fragment
   * tumble. Offline's `update()` calls this itself; online callers
   * (where `update()` would wrongly drive the collapse timeline) invoke
   * this directly via the game loop.
   */
  tickVisuals(dt: number): void {
    this.tickFallingFragments(dt);
    this.tickFallingDecorations(dt);
  }

  /** Advance the collapse timeline locally (offline matches only). */
  update(dt: number): void {
    if (!this.layout) return;
    this.tickVisuals(dt);
    if (this.level >= this.layout.batches.length) return;

    this.timer += dt;

    if (this.warningActive) {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0) {
        this.collapseCurrentBatch();
      } else {
        const progress = 1 - this.warningTimer / FRAG.warningDuration;
        const t = performance.now() * 0.001;
        this.shakeBatch(this.layout.batches[this.level].indices, progress, t);
      }
    } else {
      const batch = this.layout.batches[this.level];
      if (this.timer >= batch.delay) {
        this.warningActive = true;
        this.warningTimer = FRAG.warningDuration;
        this.warningStartedAt = performance.now() * 0.001;
        // Seismic rumble SFX — syncs with the visual shake; auto-stops
        // when the warning window ends.
        playArenaWarning(FRAG.warningDuration);
      }
    }
  }

  // --- Online mode: server-driven sync -----------------------------------

  /** Currently-applied arena pack (null when using the default look). */
  /** Semilla del layout construido, o null si aún no hay arena. Lo usa
   *  `rebuildArenaVisuals()` del lab para rehacer las mallas sin cambiar
   *  la partida en curso. */
  get currentSeed(): number | null {
    return this.layout ? this.layout.seed : null;
  }

  getCurrentPackId(): ArenaPackId | null {
    return this.appliedPackId;
  }

  /**
   * Mirror authoritative collapse state from the server.
   * @param seed - arena seed (triggers buildFromSeed on first call)
   * @param collapseLevel - completed batch count
   * @param warningBatch - batch index currently warning (-1 if none)
   * @param packId - arena pack cosmetics; undefined keeps the legacy look
   */
  syncFromServer(seed: number, collapseLevel: number, warningBatch: number, packId?: ArenaPackId): void {
    if (!this.layout || seed !== this.syncedSeed) {
      this.buildFromSeed(seed, packId);
    } else if (packId && packId !== this.appliedPackId) {
      // Server switched packs without re-seeding (unusual but supported).
      this.currentPackPromise = this.applyPack(packId, seed);
    }
    // From here on the server owns the timeline. Set AFTER the build above,
    // which resets the flag as part of starting a fresh layout.
    this.serverDriven = true;

    // Apply any newly completed levels
    if (collapseLevel !== this.syncedLevel) {
      for (let l = this.syncedLevel < 0 ? 0 : this.syncedLevel; l < collapseLevel; l++) {
        const batch = this.layout!.batches[l];
        if (!batch) continue;
        this.restoreBatch(batch.indices); // clear any residual shake offset
        for (const idx of batch.indices) {
          this.alive[idx] = false;
          this.startFragmentFall(idx);
        }
        // Decoration cascade: props assigned to this batch drop with it.
        this.collapsePropBatch(l);
        if (this.debugLogCollapses) {
          console.log(`[Arena] collapse level=${l + 1}  batch indices=[${batch.indices.join(',')}]  radius→${this.currentRadius.toFixed(2)}`);
        }
      }
      this.syncedLevel = collapseLevel;
      this.updateRadius();
    }

    // Warning state change (edge-detected): reset the previous batch's
    // visuals, then fire the seismic SFX for the new one.
    if (warningBatch !== this.syncedWarning) {
      if (this.syncedWarning >= 0 && this.syncedWarning < (this.layout?.batches.length ?? 0)) {
        this.restoreBatch(this.layout!.batches[this.syncedWarning].indices);
      }
      if (this.debugLogCollapses) {
        console.log(`[Arena] warning ${this.syncedWarning} → ${warningBatch}`);
      }
      this.syncedWarning = warningBatch;
      if (warningBatch >= 0) {
        this.warningStartedAt = performance.now() * 0.001;
        playArenaWarning(FRAG.warningDuration);
      } else {
        this.warningStartedAt = null;
      }
    }

    if (
      warningBatch >= 0 &&
      warningBatch < (this.layout?.batches.length ?? 0) &&
      this.warningStartedAt !== null
    ) {
      const now = performance.now() * 0.001;
      const progress = Math.min(1, (now - this.warningStartedAt) / FRAG.warningDuration);
      this.shakeBatch(this.layout!.batches[warningBatch].indices, progress, now);
    }
  }

  // --- Diagnostic helpers (toggled via window.__arena / window.__game.arena)

  /**
   * Add/remove visible N/S/E/W axis markers on the arena.
   * Used to VERIFY render and physics agree on orientation:
   *  +X = East (green box)   -X = West (yellow box)
   *  +Z = North (red box)    -Z = South (blue box)
   * Physics uses atan2(z, x), so angle 0 must point east (+X) and angle
   * +π/2 must point north (+Z). If the markers end up swapped after a
   * geometric change, the rotation bug is back.
   */
  toggleDebugCompass(): boolean {
    if (this.debugCompass) {
      this.group.remove(this.debugCompass);
      this.debugCompass.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (c.material instanceof THREE.Material) c.material.dispose();
        }
      });
      this.debugCompass = null;
      return false;
    }
    const g = new THREE.Group();
    const r = FRAG.maxRadius + 1.2;
    const markers: Array<[string, number, number, number]> = [
      ['E', +r, 0, 0x00ff00],
      ['W', -r, 0, 0xffff00],
      ['N', 0, +r, 0xff0000],
      ['S', 0, -r, 0x00aaff],
    ];
    for (const [_label, x, z, color] of markers) {
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat);
      mesh.position.set(x, 0.6, z);
      g.add(mesh);
    }
    this.debugCompass = g;
    this.group.add(g);
    return true;
  }

  /** Dump fragment state to console. */
  dumpFragments(): void {
    if (!this.layout) { console.log('[Arena] no layout (not in a match)'); return; }
    // Print the driver-agnostic state: the synced* fields stay at their
    // sentinels in offline matches, which is why this line used to say
    // "syncedLevel=-1" in every single-player dump.
    const cs = this.getCollapseState();
    console.log(`[Arena] seed=${this.syncedSeed} radius=${this.currentRadius.toFixed(2)} level=${cs.level}/${cs.batchCount} warning=${cs.warningBatch} alive=${cs.fragmentsAlive}/${cs.fragmentsTotal} driver=${this.serverDriven ? 'server' : 'local'}`);
    const byBand = new Map<number, string[]>();
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      const alive = this.alive[i];
      const visible = this.fragmentGroups[i]?.visible ?? false;
      const start = (f.startAngle * 180 / Math.PI).toFixed(0);
      const end = (f.endAngle * 180 / Math.PI).toFixed(0);
      const marker = alive === visible
        ? (alive ? '✓' : '·')
        : `MISMATCH(alive=${alive} visible=${visible})`;
      const line = `[${i}] ${marker} ${start}°→${end}°`;
      if (!byBand.has(f.band)) byBand.set(f.band, []);
      byBand.get(f.band)!.push(line);
    }
    for (const band of [...byBand.keys()].sort()) {
      const prefix = band === 0 ? 'band 0 (immune)' : `band ${band}`;
      console.log(`  ${prefix}:`);
      for (const l of byBand.get(band)!) console.log(`    ${l}`);
    }
  }

  /**
   * Given a world point, report whether physics AND visual agree.
   * Prints the fragment the physics selects, and confirms its mesh
   * is actually rendered there. If they disagree the rotation bug
   * would reappear silently — this catches it.
   */
  checkPoint(x: number, z: number): void {
    if (!this.layout) { console.log('[Arena] no layout'); return; }
    const r = Math.sqrt(x * x + z * z);
    const angleDeg = Math.atan2(z, x) * 180 / Math.PI;
    console.log(`[Arena] check point (${x.toFixed(2)}, ${z.toFixed(2)})  r=${r.toFixed(2)}  angle=${angleDeg.toFixed(1)}°`);
    let anyFound = false;
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!pointInFragment(x, z, f)) continue;
      anyFound = true;
      const alive = this.alive[i];
      const visible = this.fragmentGroups[i]?.visible ?? false;
      const tag = alive === visible ? 'OK' : '*** VISUAL/PHYSICS MISMATCH ***';
      console.log(`  fragment ${i} band=${f.band} alive=${alive} visible=${visible} ${tag}`);
    }
    if (!anyFound) console.log('  no fragment contains this point (void)');
    console.log(`  isOnArena: ${this.isOnArena(x, z)}`);
  }

  /** Toggle per-collapse console log. Off by default. */
  toggleCollapseLog(): boolean {
    this.debugLogCollapses = !this.debugLogCollapses;
    console.log(`[Arena] collapse log ${this.debugLogCollapses ? 'ON' : 'OFF'}`);
    return this.debugLogCollapses;
  }

  // --- Shared helpers ----------------------------------------------------

  isOnArena(x: number, z: number): boolean {
    if (!this.layout) return Math.sqrt(x * x + z * z) <= FRAG.maxRadius;
    return isPointOnArena(x, z, this.layout.fragments, this.alive);
  }

  /**
   * The generated layout for the current match, or null before the first
   * `buildFromSeed` / `syncFromServer`. Read-only by contract: it is the
   * very object the collapse logic reads every frame, so callers must not
   * mutate it. Exists so tooling (lab panels, dev-api) can report seed,
   * batches and bands without casting to private fields.
   */
  getLayout(): ArenaLayout | null {
    return this.layout;
  }

  /**
   * Collapse timeline snapshot that reads the SAME in both modes.
   * Offline the live fields are `level` / `warningActive` (driven by
   * `update()`); online they are `syncedLevel` / `syncedWarning` (driven
   * by `syncFromServer`). Fragment counts come from `alive[]`, the same
   * array the physics reads, so they can't drift from the truth.
   */
  getCollapseState(): ArenaCollapseState {
    let fragmentsAlive = 0;
    for (const a of this.alive) if (a) fragmentsAlive++;

    // syncedWarning starts at -2 (a "never synced" sentinel) — normalise
    // every "no batch warning" case to -1 so consumers have one contract.
    const level = this.serverDriven ? Math.max(0, this.syncedLevel) : this.level;
    const rawWarning = this.serverDriven
      ? this.syncedWarning
      : (this.warningActive ? this.level : -1);

    return {
      level,
      warningBatch: rawWarning < 0 ? -1 : rawWarning,
      batchCount: this.layout?.batches.length ?? 0,
      fragmentsAlive,
      fragmentsTotal: this.alive.length,
    };
  }

  reset(): void {
    // Called before buildFromSeed or on phase transition
    for (const g of this.fragmentGroups) {
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      this.group.remove(g);
    }
    this.fragmentGroups = [];
    this.alive = [];
    this.layout = null;
    this.level = 0;
    this.timer = 0;
    this.warningActive = false;
    this.warningTimer = 0;
    this.warningStartedAt = null;
    this.syncedLevel = -1;
    this.syncedWarning = -2;
    this.syncedSeed = -1;
    this.serverDriven = false;
    this.currentRadius = FRAG.maxRadius;
    // Drop any decorations + revert skybox / fog so the menu screens
    // that follow (title, character select) paint the procedural sky.
    this.clearPack();
  }

  // --- Internal ----------------------------------------------------------

  private collapseCurrentBatch(): void {
    if (!this.layout) return;
    const batch = this.layout.batches[this.level];
    // Restore the cosmetic state (position offset + emissive) BEFORE we
    // start the fall — otherwise the initial fall position would include
    // any residual shake offset and the emissive would linger on the
    // tumbling piece.
    this.restoreBatch(batch.indices);
    for (const idx of batch.indices) {
      this.alive[idx] = false;
      this.startFragmentFall(idx);
    }
    // Decorations: every prop assigned to this batch drops now. The
    this.collapsePropBatch(this.level);
    this.level++;
    this.warningActive = false;
    this.timer = 0;
    this.warningStartedAt = null;
    this.updateRadius();
  }

  /**
   * Kick off the free-fall animation for a single fragment. Called when
   * a batch collapses (offline + online). Visual-only: the `alive[idx]`
   * flag is already false by the time we get here so the physics layer
   * treats the fragment as gone immediately.
   */
  /**
   * 2026-04-30 final-polish — Sihans Sinkhole real-hole support.
   * Find every alive non-immune fragment whose centroid lies inside
   * the (cx, cz, r) disc. Used to pre-select knock-out candidates
   * before calling `killFragmentIndices`. Centroid check (not strict
   * containment) is the safer pick: it errs toward only knocking out
   * fragments fully under the hole, never the immune islet.
   */
  public getAliveFragmentsInDisc(cx: number, cz: number, r: number): number[] {
    if (!this.layout) return [];
    const r2 = r * r;
    const out: number[] = [];
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!f || f.immune) continue;
      if (!this.alive[i]) continue;
      // Approx centroid: midpoint of (band, sectorAngle) — for the
      // jagged sector shape this is roughly the visual middle.
      const midR = (f.innerR + f.outerR) * 0.5;
      const midA = (f.startAngle + f.endAngle) * 0.5;
      const fx = Math.cos(midA) * midR;
      const fz = Math.sin(midA) * midR;
      const dx = fx - cx;
      const dz = fz - cz;
      if (dx * dx + dz * dz <= r2) out.push(i);
    }
    return out;
  }

  /**
   * 2026-04-30 final-polish — knock specific fragments out of the
   * arena. Used by Sihans Sinkhole to open a real hole players can
   * fall through. Skips already-dead fragments and the immune
   * centre (defensive — callers should already filter, but the
   * extra check protects the safe zone).
   */
  public killFragmentIndices(indices: number[]): void {
    if (!this.layout) return;
    for (const idx of indices) {
      const f = this.layout.fragments[idx];
      if (!f || f.immune) continue;
      if (!this.alive[idx]) continue;
      this.alive[idx] = false;
      this.startFragmentFall(idx);
    }
    this.updateRadius();
  }

  private startFragmentFall(idx: number): void {
    const g = this.fragmentGroups[idx];
    if (!g) return;
    // Deterministic-ish randomness from the fragment index so a given
    // seed yields the same tumble pattern per fragment. Not critical —
    // fall is purely cosmetic — but cheap and debuggable.
    const rand = (k: number) => {
      const x = Math.sin((idx + 1) * 73.1 + k * 11.3) * 43758.5453;
      return x - Math.floor(x);
    };
    this.fallingFragments.push({
      idx,
      vy: 0.8 + rand(0) * 1.2,             // 0.8..2.0 initial downward nudge
      rotX: (rand(1) * 2 - 1) * 1.6,       // ±1.6 rad/s tumble
      rotZ: (rand(2) * 2 - 1) * 1.6,
      startY: g.position.y,
    });
  }

  private readonly FRAGMENT_GRAVITY = 18;    // world units / s²
  private readonly FRAGMENT_KILL_Y = -25;     // below this we hide + drop entry

  /**
   * Advance every falling fragment one frame. Called from update() (offline
   * self-driven) and once at the end of syncFromServer (online). Shared
   * code path so the visual is identical in both modes.
   */
  private tickFallingFragments(dt: number): void {
    if (this.fallingFragments.length === 0) return;
    const keep: typeof this.fallingFragments = [];
    for (const ff of this.fallingFragments) {
      const g = this.fragmentGroups[ff.idx];
      if (!g) continue; // fragment was disposed between build + tick
      ff.vy += this.FRAGMENT_GRAVITY * dt;
      g.position.y = ff.startY - 0; // baseline
      // Integrate downward: we simulate in "delta Y" space so the shake
      // restore leaves position.y at 0 and we apply the offset directly.
      // Easiest: just subtract the accumulated drop from startY.
      ff.startY -= ff.vy * dt;        // startY drifts down with gravity
      g.position.y = ff.startY;
      g.rotation.x += ff.rotX * dt;
      g.rotation.z += ff.rotZ * dt;
      if (g.position.y > this.FRAGMENT_KILL_Y) {
        keep.push(ff);
      } else {
        // Past the death plane — hide + reset transforms so a future
        // seed rebuild starts from a clean slate.
        g.visible = false;
        g.position.y = 0;
        g.rotation.x = 0;
        g.rotation.z = 0;
      }
    }
    this.fallingFragments = keep;
  }

  private updateRadius(): void {
    if (!this.layout) return;
    let maxR = FRAG.immuneRadius;
    for (let i = 0; i < this.layout.fragments.length; i++) {
      if (this.alive[i] && !this.layout.fragments[i].immune) {
        maxR = Math.max(maxR, this.layout.fragments[i].outerR);
      }
    }
    this.currentRadius = maxR;
  }

  /**
   * Playable radius IN ONE DIRECTION — max outer edge of the alive
   * non-immune fragments whose arc contains `angle` (radians, world atan2
   * convention: 0 = +X).
   *
   * 2026-09-06 (terreno v2 fase 0.5): `currentRadius` es el máximo GLOBAL,
   * así que en un colapso por eje se queda en 12 mientras siga vivo un
   * solo sector exterior, aunque medio disco haya desaparecido. Quien
   * pregunta "¿cuánto suelo me queda?" desde una posición concreta —los
   * bots— necesita el radio de SU dirección.
   *
   * Espejo de `ArenaSim.radiusAt` (server/src/sim/arena.ts): misma lógica,
   * mismos resultados; el cliente no puede importar del servidor.
   */
  radiusAt(angle: number): number {
    if (!this.layout) return FRAG.maxRadius;
    let maxR = FRAG.immuneRadius;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!this.alive[i] || f.immune) continue;
      if (maxR >= f.outerR) continue;
      const probe = f.outerR - 0.001;
      if (pointInFragment(x * probe, z * probe, f)) maxR = f.outerR;
    }
    return maxR;
  }

  /**
   * Apply the pre-collapse shake effect to a batch.
   *
   * Writes to `fragmentGroup.position.x/z` (visual only — physics uses the
   * static layout so the floor stays trustworthy) and to the material's
   * emissive (warm orange glow that ramps up with `progress`).
   *
   * Each fragment gets a phase offset so the pieces don't shake in sync —
   * reads as distributed ground tremor, not a rigid block.
   *
   * @param indices  batch fragment indices
   * @param progress 0 at warning start → 1 right before collapse
   * @param t        shared time in seconds (performance.now * 0.001)
   */
  private shakeBatch(indices: number[], progress: number, t: number): void {
    // Intensity: starts at 0.3 (visible from frame 1) and ramps to 1.0.
    // Non-zero baseline prevents the "nothing's happening yet" feel in
    // the first 100ms of the warning.
    const intensity = 0.3 + Math.min(1, progress) * 0.7;
    const amp = SHAKE_AMP_MAX * intensity;
    // 2026-09-06 (fase 1): el mismo 0.65 de siempre, sobre el suelo CLARO
    // de ahora, tapaba la textura con un naranja plano. Con el tinte real
    // el aviso se lee igual con la mitad de emisivo, y la losa sigue
    // pareciendo losa mientras tiembla.
    const emissiveVal = intensity * ARENA_LOOK.warningEmissive;

    for (const idx of indices) {
      const g = this.fragmentGroups[idx];
      if (!g || !g.visible) continue;

      // Per-fragment phase — using the index as seed. Irrational constant
      // multiplier so adjacent indices feel uncorrelated.
      const phase = idx * 1.73;
      const sx =
        Math.sin(t * SHAKE_FREQ_HIGH + phase) * 0.55 +
        Math.sin(t * SHAKE_FREQ_MID  + phase * 2.1) * 0.30 +
        Math.sin(t * SHAKE_FREQ_LOW  + phase * 0.7) * 0.15;
      const sz =
        Math.cos(t * SHAKE_FREQ_HIGH + phase * 1.3) * 0.55 +
        Math.cos(t * SHAKE_FREQ_MID  + phase * 0.8) * 0.30 +
        Math.cos(t * SHAKE_FREQ_LOW  + phase * 1.7) * 0.15;
      g.position.set(sx * amp, 0, sz * amp);

      // Warm orange emissive pulse — not red alarm flash. Suggests
      // "heating / cracking" rather than "DANGER" button blink.
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          forEachMaterial(child, mat => {
            mat.emissive.setHex(WARNING_EMISSIVE_COLOR);
            mat.emissiveIntensity = emissiveVal;
          });
        }
      });
    }
  }

  private restoreBatch(indices: number[]): void {
    for (const idx of indices) {
      const g = this.fragmentGroups[idx];
      if (!g) continue;
      // Reset the shake offset even if the group is now invisible — if it
      // ever comes back (debug, restart), it must render at its original
      // position, not at the last shake offset frame.
      g.position.set(0, 0, 0);
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          forEachMaterial(child, mat => {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          });
        }
      });
    }
  }
}
