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
import {
  type ArenaPackId,
  layoutPackProps,
  loadPackGroundTexture,
  loadPackSkyboxTexture,
  loadPackPropMeshes,
  getPackFogColor,
  loadInArenaDecorations,
} from './arena-decorations';
import { getDecorLayout } from './arena-decor-layouts';
import { setSceneSkyboxTexture, setSceneFogColor } from './main';

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
const CENTER_SEGMENTS = 32;    // circle segments for the immune center

// Outer ring "skirt" — kept as a tiny anti-gap with the skybox lower
// hemisphere. Decoration now lives INSIDE the arena (see
// arena-decor-layouts.ts) so the skirt has no other purpose; we keep
// it only as a 0.5 u trim so there's no visible seam between the
// fragment edge and the void / sky horizon.
//
// History:
//   18 → 14   (first tighten pass — felt like extended-but-not-walkable terrain)
//   14 → 12.5 (now — decoration moved inside the arena)
const OUTER_RING_INNER_R = FRAG.maxRadius - 0.1;        //  11.9
const OUTER_RING_OUTER_R = FRAG.maxRadius + 0.5;        //  12.5  (was 14)
const OUTER_RING_SEGMENTS = 48;

// Per-band base colors. Distinct enough that the user can SEE where one
// band ends and the next begins (even when bands are concentric rings of
// the same green family). Immune center is the brightest.
const BAND_COLORS: Record<number, number> = {
  0: 0x6fa35f, // immune center — brightest green
  1: 0x5c8a50, // inner band
  2: 0x4a6741, // mid band
  3: 0x3a5331, // outer band — darkest
};
// Only the immune center uses a dedicated side-wall color. Extruded
// sectors use a single material for top + sides (lighting + DoubleSide
// gives enough visual variation).
const IMMUNE_SIDE_COLOR = 0x46704b;

/**
 * Recursively dispose geometry + materials of every mesh under a group,
 * then clear children. Used both for fragment rebuilds and for
 * decorations teardown — same mechanics in both places.
 *
 * Note: material maps (ground texture, skybox) are NOT disposed — they
 * live in the texture cache in arena-decorations and are reused across
 * matches. Disposing them would force a re-decode on every reload.
 */
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

function createFragmentMesh(f: FragmentDef): THREE.Group {
  const group = new THREE.Group();
  const h = FRAG.arenaHeight;

  if (f.immune) {
    // Immune center: simple circle + cylinder side + bottom circle
    const topGeo = new THREE.CircleGeometry(f.outerR, CENTER_SEGMENTS);
    const topMat = new THREE.MeshStandardMaterial({ color: BAND_COLORS[0], side: THREE.DoubleSide });
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    group.add(top);

    const sideGeo = new THREE.CylinderGeometry(f.outerR, f.outerR, h, CENTER_SEGMENTS, 1, true);
    const sideMat = new THREE.MeshStandardMaterial({ color: IMMUNE_SIDE_COLOR, side: THREE.DoubleSide });
    const side = new THREE.Mesh(sideGeo, sideMat);
    side.position.y = -h / 2;
    group.add(side);

    const botGeo = new THREE.CircleGeometry(f.outerR, CENTER_SEGMENTS);
    const botMat = new THREE.MeshStandardMaterial({ color: 0x2a3a22, side: THREE.DoubleSide });
    const bot = new THREE.Mesh(botGeo, botMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.y = -h;
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
  // Per-band distinct colors — important for visual legibility when
  // a middle band collapses and the user needs to tell inner from outer
  // alive fragments at a glance.
  const baseColor = BAND_COLORS[f.band] ?? 0x4a6741;
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
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
  private sceneRef: THREE.Scene;
  /** Decorative "skirt" ring just outside the playable arena. Displays the
   *  pack's ground texture and gives props a surface to sit on — without it
   *  props appear to float above the skybox's lower hemisphere. Falls as a
   *  single piece when the last fragment batch collapses. */
  private outerRingMesh: THREE.Mesh | null = null;
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

    // Void: vertical gradient cylinder fading to black
    const voidGeo = new THREE.CylinderGeometry(40, 40, 30, 32, 1, true);
    const voidMat = new THREE.MeshBasicMaterial({
      color: 0x050510,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.9,
    });
    const voidCyl = new THREE.Mesh(voidGeo, voidMat);
    voidCyl.position.y = -15;
    this.group.add(voidCyl);

    // Dark floor at bottom of void
    const floorGeo = new THREE.CircleGeometry(40, 32);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x020208 });
    const voidFloor = new THREE.Mesh(floorGeo, floorMat);
    voidFloor.rotation.x = -Math.PI / 2;
    voidFloor.position.y = -30;
    this.group.add(voidFloor);

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
    this.currentRadius = FRAG.maxRadius;
    this.fallingFragments = [];

    for (const f of this.layout.fragments) {
      const mesh = createFragmentMesh(f);
      this.fragmentGroups.push(mesh);
      this.group.add(mesh);
      // Store base color so we can restore it after a warning blink ends.
      this.baseColors.push(BAND_COLORS[f.band] ?? 0x4a6741);
    }

    // Apply pack cosmetics (async — fragments are already up, props drift
    // in a few frames later). Skipping packId keeps the legacy look.
    if (packId) {
      void this.applyPack(packId, seed);
    } else {
      this.clearPack();
    }
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
  private async applyPack(packId: ArenaPackId, seed: number): Promise<void> {
    // Token guards against a stale loader overwriting a newer pack.
    const myToken = ++this.packApplyToken;

    this.clearDecorations();
    this.appliedPackId = packId;

    // Fog + clear colour update immediately (synchronous) so the player
    // doesn't see a "wrong horizon" frame while textures load.
    setSceneFogColor(getPackFogColor(packId));

    // Ground texture — fire the load; apply to fragments AND build the
    // outer ring "skirt" when it resolves (both share the same texture).
    loadPackGroundTexture(packId)
      .then((tex) => {
        if (myToken !== this.packApplyToken) return; // superseded
        this.applyGroundTexture(tex);
        this.buildOuterRing(tex);
      })
      .catch((err) => {
        console.debug('[Arena] ground texture load failed:', packId, err);
      });

    // Skybox — swap the main.ts sky dome. Fallback shader stays as-is if
    // the load fails.
    loadPackSkyboxTexture(packId)
      .then((tex) => {
        if (myToken !== this.packApplyToken) return;
        setSceneSkyboxTexture(tex);
      })
      .catch((err) => {
        console.debug('[Arena] skybox load failed:', packId, err);
      });

    // Outer ring props — historically a ring of large GLBs at radius
    // 14.5–18.5 outside the arena. Now empty by design (every PACKS[id]
    // .props is []), so this loop is a no-op for every pack. Kept
    // structurally in case we re-introduce outer ornaments in the
    // future; today it does nothing visually.
    const placements = layoutPackProps(packId, seed);
    try {
      const meshes = await loadPackPropMeshes(packId, placements);
      if (myToken !== this.packApplyToken) {
        // Another applyPack ran while we were awaiting. Dispose the
        // meshes we just built so nothing leaks into the scene.
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
      console.debug('[Arena] pack props load failed:', packId, err);
    }

    // In-arena decor — small props that live INSIDE the playable arena,
    // each parented to the fragment that contains it so it falls when
    // that fragment collapses. Layouts are static per pack (data-only,
    // see arena-decor-layouts.ts) so every client sees the same layout
    // without seed sync.
    try {
      const inArena = await loadInArenaDecorations(getDecorLayout(packId));
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
      console.debug('[Arena] in-arena decor load failed:', packId, err);
    }
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
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (f && pointInFragment(x, z, f)) return i;
    }
    return -1;
  }

  /**
   * Create the decorative "skirt" ring just outside the playable arena.
   * A flat ring (top surface) + a cylindrical outer wall, both textured
   * with the pack's ground tile. Sits at arena height so the transition
   * from fragment floor to skirt reads as one continuous surface.
   */
  private buildOuterRing(tex: THREE.Texture): void {
    // If a previous ring exists from a rebuild-without-reset, dispose it.
    if (this.outerRingMesh) {
      this.group.remove(this.outerRingMesh);
      disposeGroupMeshes(this.outerRingMesh);
      this.outerRingMesh = null;
    }

    // Top ring: the visible surface under the props. RingGeometry's UVs
    // are radial by default; we manually rewrite them to tiled UVs so
    // the texture reads as a tileable floor, not a bullseye stretch.
    const topGeo = new THREE.RingGeometry(
      OUTER_RING_INNER_R,
      OUTER_RING_OUTER_R,
      OUTER_RING_SEGMENTS,
      1,
    );
    // Rewrite UVs to world-space tiling so the texture doesn't fan out
    // from the centre (default RingGeometry UVs are polar).
    const posAttr = topGeo.getAttribute('position');
    const uvAttr = topGeo.getAttribute('uv');
    const tileRepeat = 3; // same visual density as the fragment tops
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // RingGeometry is in XY plane pre-rotation; x/y map to world x/z.
      uvAttr.setXY(
        i,
        (x / OUTER_RING_OUTER_R + 1) * 0.5 * tileRepeat,
        (y / OUTER_RING_OUTER_R + 1) * 0.5 * tileRepeat,
      );
    }
    uvAttr.needsUpdate = true;

    const ringMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xdadada,
      side: THREE.DoubleSide,
    });
    const topRing = new THREE.Mesh(topGeo, ringMat);
    topRing.rotation.x = -Math.PI / 2;
    topRing.receiveShadow = true;

    // Outer cylindrical wall — same texture, gives the ring visible
    // thickness matching the fragment height.
    const wallGeo = new THREE.CylinderGeometry(
      OUTER_RING_OUTER_R,
      OUTER_RING_OUTER_R,
      FRAG.arenaHeight,
      OUTER_RING_SEGMENTS,
      1,
      true,
    );
    // Reuse the same material; the cylinder's default cylindrical UVs
    // are fine (the texture wraps around the wall with natural seam).
    const wall = new THREE.Mesh(wallGeo, ringMat);
    wall.position.y = -FRAG.arenaHeight / 2;

    // Bundle top + wall into a single Object3D so it falls as one piece.
    const container = new THREE.Group();
    container.add(topRing);
    container.add(wall);
    // Render order behind the playable fragments so there's no overdraw
    // flicker at the seam.
    topRing.renderOrder = -0.5;

    this.group.add(container);
    // outerRingMesh is typed as Mesh for convenience but we keep a Group
    // here — only use it via this.group add/remove, never as a Mesh
    // directly. Cast is purely so TS doesn't widen the field; Three.js
    // treats all Object3D uniformly for scene-graph operations.
    this.outerRingMesh = container as unknown as THREE.Mesh;
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
    // Dispose outer ring decorative skirt
    if (this.outerRingMesh) {
      this.group.remove(this.outerRingMesh);
      disposeGroupMeshes(this.outerRingMesh);
      this.outerRingMesh = null;
    }
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
   * The outer ring "skirt" falls as a single piece with the final batch.
   * Players see it drop after the last fragment crumbles, closing the
   * visual beat of the arena being destroyed.
   */
  private collapseOuterRing(): void {
    if (!this.outerRingMesh) return;
    this.fallingDecorations.push({
      object: this.outerRingMesh,
      vy: -0.8,
      rotX: (Math.random() - 0.5) * 0.6,
      rotZ: (Math.random() - 0.5) * 0.6,
      startY: this.outerRingMesh.position.y,
    });
    // Null out the reference — next clearPack will not try to dispose
    // the still-falling mesh (it stays in fallingDecorations until it
    // exits the scene and the tick disposes it there).
    this.outerRingMesh = null;
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

  /** Tint every collapsible fragment's top surface with the pack's
   *  ground texture. Leaves the immune center + bottom / side faces
   *  alone so the arena's band structure still reads clearly. */
  private applyGroundTexture(tex: THREE.Texture): void {
    for (const g of this.fragmentGroups) {
      g.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const mat = child.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.isMeshStandardMaterial) return;
        // Only tint the "top" mesh — the big flat face players see. On
        // collapsible sectors that's the first mesh in the group
        // (ExtrudeGeometry); on the immune center it's the top circle.
        // Pragmatic heuristic: meshes with receiveShadow===true are the
        // tops, sides/bottoms don't have it set.
        if (!child.receiveShadow) return;
        mat.map = tex;
        // Lighten the tint so the texture reads clear instead of murky
        // against the dark band colour baked into the material.
        mat.color.setHex(0xdadada);
        mat.needsUpdate = true;
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
        const mat = child.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.isMeshStandardMaterial) return;
        if (mat.map) {
          mat.map = null;
          mat.needsUpdate = true;
        }
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
      void this.applyPack(packId, seed);
    }

    // Apply any newly completed levels
    if (collapseLevel !== this.syncedLevel) {
      const totalBatches = this.layout!.batches.length;
      for (let l = this.syncedLevel < 0 ? 0 : this.syncedLevel; l < collapseLevel; l++) {
        const batch = this.layout!.batches[l];
        if (!batch) continue;
        this.restoreBatch(batch.indices); // clear any residual shake offset
        for (const idx of batch.indices) {
          this.alive[idx] = false;
          this.startFragmentFall(idx);
        }
        // Decoration cascade: props assigned to this batch drop with it,
        // outer ring drops with the last batch (matches offline path).
        this.collapsePropBatch(l);
        if (l >= totalBatches - 1) this.collapseOuterRing();
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
    console.log(`[Arena] seed=${this.syncedSeed} radius=${this.currentRadius.toFixed(2)} syncedLevel=${this.syncedLevel} syncedWarn=${this.syncedWarning}`);
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
    // outer ring is kept standing until the LAST batch collapses, at
    // which point it falls as a single piece.
    this.collapsePropBatch(this.level);
    if (this.level >= this.layout.batches.length - 1) {
      this.collapseOuterRing();
    }
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
    const emissiveVal = intensity * 0.65;

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
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(WARNING_EMISSIVE_COLOR);
          mat.emissiveIntensity = emissiveVal;
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
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    }
  }
}
