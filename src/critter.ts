import * as THREE from 'three';

export interface CritterConfig {
  name: string;
  color: number;
  speed: number;
  mass: number;
  headbuttForce: number;
}

export const CRITTER_PRESETS: CritterConfig[] = [
  { name: 'Rojo', color: 0xe74c3c, speed: 8, mass: 1.0, headbuttForce: 14 },
  { name: 'Azul', color: 0x3498db, speed: 9, mass: 0.9, headbuttForce: 12 },
  { name: 'Verde', color: 0x2ecc71, speed: 7, mass: 1.2, headbuttForce: 16 },
  { name: 'Morado', color: 0x9b59b6, speed: 10, mass: 0.8, headbuttForce: 11 },
];

const BODY_RADIUS = 0.5;
const HEAD_RADIUS = 0.55;

export class Critter {
  mesh: THREE.Group;
  config: CritterConfig;

  vx = 0;
  vz = 0;
  alive = true;
  headbuttCooldown = 0;
  isHeadbutting = false;
  private headbuttTimer = 0;

  private body: THREE.Mesh;
  private head: THREE.Mesh;

  constructor(config: CritterConfig, scene: THREE.Scene) {
    this.config = config;
    this.mesh = new THREE.Group();

    // Body — small sphere
    const bodyGeo = new THREE.SphereGeometry(BODY_RADIUS, 16, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: config.color });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.y = BODY_RADIUS;
    this.body.castShadow = true;
    this.mesh.add(this.body);

    // Head — bigger sphere (big-headed critter!)
    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({
      color: config.color,
      emissive: config.color,
      emissiveIntensity: 0.15,
    });
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.y = BODY_RADIUS * 2 + HEAD_RADIUS * 0.6;
    this.head.castShadow = true;
    this.mesh.add(this.head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.22, 0.1, HEAD_RADIUS * 0.85);
      this.head.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(0, 0, 0.06);
      eye.add(pupil);
    }

    scene.add(this.mesh);
  }

  get x(): number { return this.mesh.position.x; }
  set x(v: number) { this.mesh.position.x = v; }
  get z(): number { return this.mesh.position.z; }
  set z(v: number) { this.mesh.position.z = v; }
  get radius(): number { return HEAD_RADIUS; }

  startHeadbutt(): void {
    if (this.headbuttCooldown > 0 || this.isHeadbutting) return;
    this.isHeadbutting = true;
    this.headbuttTimer = 0.2; // duration of lunge
  }

  update(dt: number): void {
    // Headbutt cooldown
    if (this.headbuttCooldown > 0) this.headbuttCooldown -= dt;

    // Headbutt lunge animation
    if (this.isHeadbutting) {
      this.headbuttTimer -= dt;
      this.head.position.z = 0.3; // head thrust forward
      if (this.headbuttTimer <= 0) {
        this.isHeadbutting = false;
        this.headbuttCooldown = 0.5;
        this.head.position.z = 0;
      }
    }

    // Apply velocity with friction
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vx *= 0.92;
    this.vz *= 0.92;

    // Face direction of movement
    if (Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1) {
      this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    }

    // Bobbing animation
    this.body.position.y = BODY_RADIUS + Math.sin(Date.now() * 0.005) * 0.05;
  }

  eliminate(): void {
    this.alive = false;
    this.mesh.visible = false;
  }

  reset(x: number, z: number): void {
    this.alive = true;
    this.mesh.visible = true;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.headbuttCooldown = 0;
    this.isHeadbutting = false;
    this.head.position.z = 0;
    this.mesh.position.y = 0;
  }
}
