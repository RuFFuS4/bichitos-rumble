import * as THREE from 'three';

const ARENA_RADIUS = 12;
const ARENA_SEGMENTS = 64;
const ARENA_HEIGHT = 1.2;       // visible thickness from the side
const COLLAPSE_RINGS = 6;

// Warning before a ring actually disappears. During this window the ring
// is still standable (isOnArena stays true), but it blinks red with an
// accelerating rhythm so players have time to step off.
const WARNING_DURATION = 1.5;   // seconds
const WARNING_BASE_RATE = 4;    // blinks per second at start
const WARNING_PEAK_RATE = 16;   // blinks per second at the end

interface CollapseWarning {
  ring: THREE.Group;
  ringIndex: number;    // index in this.rings array
  timer: number;        // seconds remaining until disappear
}

export class Arena {
  currentRadius = ARENA_RADIUS;
  group: THREE.Group;

  private rings: THREE.Group[] = [];
  private collapseIndex = 0;
  private collapseTimer = 0;
  private warnings: CollapseWarning[] = [];
  // Online sync tracking — used to skip redundant material traversals
  private syncedRadius = -1;
  private syncedWarningIdx = -2; // -2 = never synced

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
    for (let i = 0; i < COLLAPSE_RINGS; i++) {
      const inner = i * ringWidth;
      const outer = (i + 1) * ringWidth;
      const ringGroup = new THREE.Group();

      const color = i % 2 === 0 ? 0x4a6741 : 0x5c8a50;

      // Top surface (flat ring)
      const topGeo = new THREE.RingGeometry(inner, outer, ARENA_SEGMENTS);
      const topMat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
      const topMesh = new THREE.Mesh(topGeo, topMat);
      topMesh.rotation.x = -Math.PI / 2;
      topMesh.position.y = 0;
      topMesh.receiveShadow = true;
      ringGroup.add(topMesh);

      // Side wall (outer edge cylinder, visible from camera angle)
      const sideGeo = new THREE.CylinderGeometry(outer, outer, ARENA_HEIGHT, ARENA_SEGMENTS, 1, true);
      const sideMat = new THREE.MeshStandardMaterial({
        color: 0x3a5331,
        side: THREE.DoubleSide,
      });
      const sideMesh = new THREE.Mesh(sideGeo, sideMat);
      sideMesh.position.y = -ARENA_HEIGHT / 2;
      ringGroup.add(sideMesh);

      // Bottom face (dark underside)
      const botGeo = new THREE.RingGeometry(inner, outer, ARENA_SEGMENTS);
      const botMat = new THREE.MeshStandardMaterial({ color: 0x2a3a22, side: THREE.DoubleSide });
      const botMesh = new THREE.Mesh(botGeo, botMat);
      botMesh.rotation.x = -Math.PI / 2;
      botMesh.position.y = -ARENA_HEIGHT;
      ringGroup.add(botMesh);

      this.rings.push(ringGroup);
      this.group.add(ringGroup);
    }

    // Rim edge — subtle warning line, not a glowing distraction
    const rimGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.10, 6, ARENA_SEGMENTS);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xcc3333,
      emissive: 0x881111,
      emissiveIntensity: 0.3,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    this.group.add(rim);

    // Void: vertical gradient cylinder fading to black (sells infinite depth)
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

  /**
   * Schedule the next outer ring for collapse.
   * The ring stays visible and standable until its warning runs out;
   * only then does it actually disappear and the currentRadius shrink.
   */
  collapseNext(): boolean {
    if (this.collapseIndex >= this.rings.length) return false;

    const outerIdx = this.rings.length - 1 - this.collapseIndex;
    const ring = this.rings[outerIdx];

    this.warnings.push({
      ring,
      ringIndex: outerIdx,
      timer: WARNING_DURATION,
    });

    this.collapseIndex++;
    return this.collapseIndex < this.rings.length;
  }

  update(dt: number, intervalSec: number): void {
    this.collapseTimer += dt;
    if (this.collapseTimer >= intervalSec) {
      this.collapseTimer = 0;
      this.collapseNext();
    }

    // Tick pending warnings: blink red with accelerating rate, then disappear
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.timer -= dt;

      if (w.timer <= 0) {
        // Actually disappear + shrink radius NOW
        w.ring.visible = false;
        const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
        this.currentRadius = Math.max(0, this.currentRadius - ringWidth);
        this.warnings.splice(i, 1);
        continue;
      }

      // t goes 0 → 1 across the warning duration
      const t = 1 - w.timer / WARNING_DURATION;
      // Blink rate ramps up as we approach disappear
      const rate = WARNING_BASE_RATE + (WARNING_PEAK_RATE - WARNING_BASE_RATE) * t;
      // Square wave blink (crisper than sine)
      const phase = (Date.now() * 0.001 * rate) % 1;
      const on = phase < 0.5;

      // Intensity ramps up too — starts subtle, ends loud
      const maxIntensity = 0.3 + t * 0.7;
      const intensity = on ? maxIntensity : 0.0;
      const color = on ? 0xff3333 : 0x5c2020;

      w.ring.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color.setHex(color);
          mat.emissive.setHex(on ? 0xff1111 : 0x000000);
          mat.emissiveIntensity = intensity;
        }
      });
    }
  }

  isOnArena(x: number, z: number): boolean {
    return Math.sqrt(x * x + z * z) <= this.currentRadius;
  }

  /**
   * Mirror authoritative collapse state from the server (online mode).
   * Drives visibility (collapsedRings) and warning blink (warningRingIndex).
   * The blink cadence stays client-local since it's pure visual noise —
   * both clients use Date.now() so they stay in near-lockstep anyway.
   *
   *   radius          — current standable radius (used for isOnArena)
   *   collapsedRings  — how many rings have fully disappeared (0..ringCount) [unused, kept for API compat]
   *   warningRingIndex — index of the ring currently blinking red, -1 if none
   */
  syncFromServer(radius: number, _collapsedRings: number, warningRingIndex: number): void {
    this.currentRadius = radius;

    const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
    const radiusChanged = Math.abs(radius - this.syncedRadius) > 0.01;
    const warningChanged = warningRingIndex !== this.syncedWarningIdx;

    // Update visibility whenever radius changes — this is the authoritative check.
    // We use a geometric comparison (ring outer edge vs current radius) rather than
    // counting collapsedRings. This is more robust: radius is the canonical physics
    // value (it already drives falloff correctly on both clients). If radius is right,
    // visibility will be right even if collapsedRings arrives late or out of sync.
    if (radiusChanged) {
      this.syncedRadius = radius;
      for (let i = 0; i < this.rings.length; i++) {
        const outerEdge = (i + 1) * ringWidth;
        // Small epsilon (0.1) keeps the outermost ring visible during warning
        // (when radius is still at max but the ring is blinking, not yet gone).
        this.rings[i].visible = outerEdge <= radius + 0.1;
      }
    }

    // Material updates: blink the warning ring every frame, restore others once on change.
    if (!warningChanged && warningRingIndex === -1) return; // nothing blinking, stable state

    if (warningChanged) this.syncedWarningIdx = warningRingIndex;

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (!ring.visible) continue;

      if (i === warningRingIndex) {
        // Apply the same blink pattern the offline path computes locally.
        // Server does NOT send timer; we approximate intensity at peak
        // (t≈1) since the warning only lasts 1.5s — close enough visually.
        const rate = WARNING_PEAK_RATE;
        const phase = (Date.now() * 0.001 * rate) % 1;
        const on = phase < 0.5;
        ring.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.color.setHex(on ? 0xff3333 : 0x5c2020);
            mat.emissive.setHex(on ? 0xff1111 : 0x000000);
            mat.emissiveIntensity = on ? 1.0 : 0.0;
          }
        });
      } else if (warningChanged) {
        // A different ring was previously warning — restore its base color once.
        const baseColor = i % 2 === 0 ? 0x4a6741 : 0x5c8a50;
        ring.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.color.setHex(child.position.y === 0 ? baseColor
              : child.position.y === -ARENA_HEIGHT ? 0x2a3a22
              : 0x3a5331);
            if (mat.emissiveIntensity !== 0) {
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
            }
          }
        });
      }
    }
  }

  reset(): void {
    this.collapseIndex = 0;
    this.collapseTimer = 0;
    this.currentRadius = ARENA_RADIUS;
    this.syncedRadius = -1;
    this.syncedWarningIdx = -2;
    this.warnings.length = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.visible = true;
      const color = i % 2 === 0 ? 0x4a6741 : 0x5c8a50;
      ring.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          // Top gets alternating color, sides/bottom keep their darker tones
          if (child.position.y === 0) {
            mat.color.set(color);
          } else if (child.position.y === -ARENA_HEIGHT) {
            mat.color.set(0x2a3a22);
          } else {
            mat.color.set(0x3a5331);
          }
          mat.emissive.set(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    }
  }
}
