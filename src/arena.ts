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
  generateArenaLayout, isPointOnArena, FRAG,
  type ArenaLayout, type FragmentDef,
} from './arena-fragments';

const ARC_SEGMENTS = 12;       // arc resolution per fragment shape edge
const CENTER_SEGMENTS = 32;    // circle segments for the immune center

// --- Fragment mesh builder -----------------------------------------------

function createFragmentMesh(f: FragmentDef): THREE.Group {
  const group = new THREE.Group();
  const h = FRAG.arenaHeight;

  if (f.immune) {
    // Immune center: simple circle + cylinder side + bottom circle
    const topGeo = new THREE.CircleGeometry(f.outerR, CENTER_SEGMENTS);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x5c8a50, side: THREE.DoubleSide });
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    group.add(top);

    const sideGeo = new THREE.CylinderGeometry(f.outerR, f.outerR, h, CENTER_SEGMENTS, 1, true);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a5331, side: THREE.DoubleSide });
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
  // Alternating band colors
  const baseColor = f.band % 2 === 0 ? 0x5c8a50 : 0x4a6741;
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // ExtrudeGeometry: shape in XY, extruded +Z. Rotate so the shape
  // lies in XZ (horizontal) with thickness going DOWN (-Y).
  mesh.rotation.x = -Math.PI / 2;
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

  // Base colors for resetting after warning blink
  private baseColors: number[] = [];

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
    this.syncedLevel = -1;
    this.syncedWarning = -2;
    this.syncedSeed = seed;
    this.currentRadius = FRAG.maxRadius;

    for (const f of this.layout.fragments) {
      const mesh = createFragmentMesh(f);
      this.fragmentGroups.push(mesh);
      this.group.add(mesh);

      // Store base color for restoring after warning blink
      const baseColor = f.immune ? 0x5c8a50
        : f.band % 2 === 0 ? 0x5c8a50 : 0x4a6741;
      this.baseColors.push(baseColor);
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
        this.blinkBatch(this.layout.batches[this.level].indices);
      }
    } else {
      const batch = this.layout.batches[this.level];
      if (this.timer >= batch.delay) {
        this.warningActive = true;
        this.warningTimer = FRAG.warningDuration;
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
      }
      this.syncedLevel = collapseLevel;
      this.updateRadius();
    }

    // Warning blink
    if (warningBatch !== this.syncedWarning) {
      // Restore previously warned fragments to base color
      if (this.syncedWarning >= 0 && this.syncedWarning < (this.layout?.batches.length ?? 0)) {
        this.restoreBatch(this.layout!.batches[this.syncedWarning].indices);
      }
      this.syncedWarning = warningBatch;
    }

    if (warningBatch >= 0 && warningBatch < (this.layout?.batches.length ?? 0)) {
      this.blinkBatch(this.layout!.batches[warningBatch].indices);
    }
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
    this.syncedLevel = -1;
    this.syncedWarning = -2;
    this.syncedSeed = -1;
    this.currentRadius = FRAG.maxRadius;
  }

  // --- Internal ----------------------------------------------------------

  private collapseCurrentBatch(): void {
    if (!this.layout) return;
    const batch = this.layout.batches[this.level];
    for (const idx of batch.indices) {
      this.alive[idx] = false;
      this.fragmentGroups[idx].visible = false;
    }
    this.level++;
    this.warningActive = false;
    this.timer = 0;
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

  private blinkBatch(indices: number[]): void {
    const rate = FRAG.warningPeakRate;
    const phase = (Date.now() * 0.001 * rate) % 1;
    const on = phase < 0.5;

    for (const idx of indices) {
      const g = this.fragmentGroups[idx];
      if (!g || !g.visible) continue;
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color.setHex(on ? 0xff3333 : 0x5c2020);
          mat.emissive.setHex(on ? 0xff1111 : 0x000000);
          mat.emissiveIntensity = on ? 1.0 : 0.0;
        }
      });
    }
  }

  private restoreBatch(indices: number[]): void {
    for (const idx of indices) {
      const g = this.fragmentGroups[idx];
      if (!g || !g.visible) continue;
      const baseColor = this.baseColors[idx] ?? 0x4a6741;
      g.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color.setHex(baseColor);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    }
  }
}
