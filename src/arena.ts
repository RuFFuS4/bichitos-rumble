import * as THREE from 'three';

const ARENA_RADIUS = 12;
const ARENA_SEGMENTS = 64;
const ARENA_THICKNESS = 0.5;
const COLLAPSE_RINGS = 6;

export class Arena {
  readonly initialRadius = ARENA_RADIUS;
  currentRadius = ARENA_RADIUS;
  group: THREE.Group;

  private rings: THREE.Mesh[] = [];
  private collapseIndex = 0;
  private collapseTimer = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // Build arena as concentric rings so we can collapse them one by one
    const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
    for (let i = 0; i < COLLAPSE_RINGS; i++) {
      const inner = i * ringWidth;
      const outer = (i + 1) * ringWidth;
      const geo = new THREE.RingGeometry(inner, outer, ARENA_SEGMENTS);
      const mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0x4a6741 : 0x5c8a50,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      this.rings.push(mesh);
      this.group.add(mesh);
    }

    // Rim edge glow
    const rimGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.15, 8, ARENA_SEGMENTS);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff2222,
      emissiveIntensity: 0.5,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    this.group.add(rim);

    // Void floor far below
    const voidGeo = new THREE.PlaneGeometry(80, 80);
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a1a });
    const voidFloor = new THREE.Mesh(voidGeo, voidMat);
    voidFloor.rotation.x = -Math.PI / 2;
    voidFloor.position.y = -20;
    this.group.add(voidFloor);

    scene.add(this.group);
  }

  /** Collapse the outermost remaining ring. Returns true if there are rings left. */
  collapseNext(): boolean {
    if (this.collapseIndex >= this.rings.length) return false;

    const outerIdx = this.rings.length - 1 - this.collapseIndex;
    const ring = this.rings[outerIdx];

    // Animate: turn red then hide
    (ring.material as THREE.MeshStandardMaterial).color.set(0xff3333);
    (ring.material as THREE.MeshStandardMaterial).emissive.set(0xff1111);
    (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;

    setTimeout(() => {
      ring.visible = false;
    }, 600);

    this.collapseIndex++;
    const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
    this.currentRadius = ARENA_RADIUS - this.collapseIndex * ringWidth;
    return this.collapseIndex < this.rings.length;
  }

  /** Call each frame. Collapses a ring every `intervalSec` seconds. */
  update(dt: number, intervalSec: number): void {
    this.collapseTimer += dt;
    if (this.collapseTimer >= intervalSec) {
      this.collapseTimer = 0;
      this.collapseNext();
    }
  }

  isOnArena(x: number, z: number): boolean {
    return Math.sqrt(x * x + z * z) <= this.currentRadius;
  }

  reset(): void {
    this.collapseIndex = 0;
    this.collapseTimer = 0;
    this.currentRadius = ARENA_RADIUS;
    for (const ring of this.rings) {
      ring.visible = true;
      (ring.material as THREE.MeshStandardMaterial).color.set(
        this.rings.indexOf(ring) % 2 === 0 ? 0x4a6741 : 0x5c8a50
      );
      (ring.material as THREE.MeshStandardMaterial).emissive.set(0x000000);
      (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    }
  }
}
