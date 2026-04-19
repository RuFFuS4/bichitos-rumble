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

  // Online sync tracking
  private syncedLevel = -1;
  private syncedWarning = -2;
  private syncedSeed = -1;

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

  /** Build (or rebuild) the fragment floor from a deterministic seed. */
  buildFromSeed(seed: number): void {
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

    for (const f of this.layout.fragments) {
      const mesh = createFragmentMesh(f);
      this.fragmentGroups.push(mesh);
      this.group.add(mesh);
      // Store base color so we can restore it after a warning blink ends.
      this.baseColors.push(BAND_COLORS[f.band] ?? 0x4a6741);
    }
  }

  // --- Offline mode: self-driven collapse --------------------------------

  /** Advance the collapse timeline locally (offline matches only). */
  update(dt: number): void {
    if (!this.layout) return;
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

  /**
   * Mirror authoritative collapse state from the server.
   * @param seed - arena seed (triggers buildFromSeed on first call)
   * @param collapseLevel - completed batch count
   * @param warningBatch - batch index currently warning (-1 if none)
   */
  syncFromServer(seed: number, collapseLevel: number, warningBatch: number): void {
    if (!this.layout || seed !== this.syncedSeed) {
      this.buildFromSeed(seed);
    }

    // Apply any newly completed levels
    if (collapseLevel !== this.syncedLevel) {
      for (let l = this.syncedLevel < 0 ? 0 : this.syncedLevel; l < collapseLevel; l++) {
        const batch = this.layout!.batches[l];
        if (!batch) continue;
        for (const idx of batch.indices) {
          this.alive[idx] = false;
          this.fragmentGroups[idx].visible = false;
        }
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
  }

  // --- Internal ----------------------------------------------------------

  private collapseCurrentBatch(): void {
    if (!this.layout) return;
    const batch = this.layout.batches[this.level];
    // Restore the cosmetic state (position offset + emissive) BEFORE we
    // flip the visibility — otherwise the fragment disappears while still
    // wobbling and the emissive lingers if visibility is re-toggled later.
    this.restoreBatch(batch.indices);
    for (const idx of batch.indices) {
      this.alive[idx] = false;
      this.fragmentGroups[idx].visible = false;
    }
    this.level++;
    this.warningActive = false;
    this.timer = 0;
    this.warningStartedAt = null;
    this.updateRadius();
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
