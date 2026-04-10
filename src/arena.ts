import * as THREE from 'three';

const ARENA_RADIUS = 12;
const ARENA_SEGMENTS = 64;
const ARENA_HEIGHT = 1.2;       // visible thickness from the side
const COLLAPSE_RINGS = 6;

export class Arena {
  currentRadius = ARENA_RADIUS;
  group: THREE.Group;

  private rings: THREE.Group[] = [];
  private collapseIndex = 0;
  private collapseTimer = 0;

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

  collapseNext(): boolean {
    if (this.collapseIndex >= this.rings.length) return false;

    const outerIdx = this.rings.length - 1 - this.collapseIndex;
    const ring = this.rings[outerIdx];

    // Flash red on all meshes in this ring group
    ring.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.color.set(0xff3333);
        mat.emissive.set(0xff1111);
        mat.emissiveIntensity = 0.6;
      }
    });

    setTimeout(() => {
      ring.visible = false;
    }, 600);

    this.collapseIndex++;
    const ringWidth = ARENA_RADIUS / COLLAPSE_RINGS;
    this.currentRadius = ARENA_RADIUS - this.collapseIndex * ringWidth;
    return this.collapseIndex < this.rings.length;
  }

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
