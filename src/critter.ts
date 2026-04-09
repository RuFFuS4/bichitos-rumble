import * as THREE from 'three';
import { createAbilityStates, getSpeedMultiplier, getMassMultiplier } from './abilities';
import type { AbilityState } from './abilities';
import { updateScaleFeedback, updateKnockbackTilt, updateHeadbuttRecovery, applyHeadbuttRecovery, FEEL } from './gamefeel';

export interface CritterConfig {
  name: string;
  color: number;
  speed: number;
  mass: number;
  headbuttForce: number;
}

export const CRITTER_PRESETS: CritterConfig[] = [
  { name: 'Rojo', color: 0xe74c3c, speed: 10, mass: 1.0, headbuttForce: 14 },
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
  hasInput = false;
  lives = FEEL.lives.default;
  immunityTimer = 0;
  falling = false;            // true while falling off arena (waiting to respawn)
  private respawnTimer = 0;
  headbuttCooldown = 0;
  isHeadbutting = false;
  private headbuttTimer = 0;
  private headbuttAnticipating = false;
  private anticipationTimer = 0;

  body: THREE.Mesh;
  head: THREE.Mesh;
  abilityStates: AbilityState[];

  constructor(config: CritterConfig, scene: THREE.Scene) {
    this.config = config;
    this.mesh = new THREE.Group();
    this.abilityStates = createAbilityStates(config.name);

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

  get isImmune(): boolean {
    return this.immunityTimer > 0;
  }

  get effectiveSpeed(): number {
    return this.config.speed * getSpeedMultiplier(this.abilityStates);
  }

  get effectiveMass(): number {
    return this.config.mass * getMassMultiplier(this.abilityStates);
  }

  startHeadbutt(): void {
    if (this.headbuttCooldown > 0 || this.isHeadbutting || this.headbuttAnticipating || this.isImmune) return;
    this.headbuttAnticipating = true;
    this.anticipationTimer = FEEL.headbutt.anticipation.duration;
  }

  update(dt: number): void {
    // Immunity countdown
    if (this.immunityTimer > 0) this.immunityTimer -= dt;

    // Headbutt cooldown
    if (this.headbuttCooldown > 0) this.headbuttCooldown -= dt;

    // Headbutt anticipation phase (brief wind-up)
    if (this.headbuttAnticipating) {
      this.anticipationTimer -= dt;
      this.head.position.z = FEEL.headbutt.anticipation.headRetract;
      this.body.scale.y = FEEL.headbutt.anticipation.bodySquash;
      if (this.anticipationTimer <= 0) {
        this.headbuttAnticipating = false;
        this.isHeadbutting = true;
        this.headbuttTimer = FEEL.headbutt.lunge.duration;
        this.body.scale.y = 1.0;
        // Micro-lunge: critter steps into the hit
        const angle = this.mesh.rotation.y;
        this.vx += Math.sin(angle) * FEEL.headbutt.lunge.velocityBoost;
        this.vz += Math.cos(angle) * FEEL.headbutt.lunge.velocityBoost;
      }
    }

    // Headbutt lunge phase
    if (this.isHeadbutting) {
      this.headbuttTimer -= dt;
      this.head.position.z = FEEL.headbutt.lunge.headExtend;
      if (this.headbuttTimer <= 0) {
        this.isHeadbutting = false;
        this.headbuttCooldown = FEEL.headbutt.cooldown;
        // Recovery pose: head bounces back instead of snapping to 0
        applyHeadbuttRecovery(this);
      }
    }

    // Apply velocity
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Friction: faster decay when no input (stops drift), normal decay with input
    const halfLife = this.hasInput ? FEEL.movement.frictionHalfLife : FEEL.movement.idleFrictionHalfLife;
    const friction = Math.pow(0.5, dt / halfLife);
    this.vx *= friction;
    this.vz *= friction;

    // Dead zone: kill micro-drift (exponential decay never reaches true zero)
    const speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (speed < FEEL.movement.velocityDeadZone) {
      this.vx = 0;
      this.vz = 0;
    } else if (speed > FEEL.movement.maxSpeed) {
      // Velocity cap
      this.vx = (this.vx / speed) * FEEL.movement.maxSpeed;
      this.vz = (this.vz / speed) * FEEL.movement.maxSpeed;
    }

    // Face direction of movement
    if (Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1) {
      this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    }

    // Bobbing animation
    this.body.position.y = BODY_RADIUS + Math.sin(Date.now() * 0.005) * 0.05;

    // Visual feedback for ability states
    this.updateVisuals();

    // Game feel visual systems (all visual-only, no gameplay logic)
    updateScaleFeedback(this, dt);
    updateKnockbackTilt(this, dt);
    updateHeadbuttRecovery(this, dt);
  }

  /** Visual-only: updates emissive, posture, and opacity based on current state. No gameplay logic. */
  private updateVisuals(): void {
    const bodyMat = this.body.material as THREE.MeshStandardMaterial;
    const headMat = this.head.material as THREE.MeshStandardMaterial;

    let glowColor = this.config.color;
    let glowIntensity = 0.15;
    let bodyScaleY = 1.0;
    let headOffsetY = 0; // additional Y offset for head during states

    // --- Headbutt states ---
    if (this.headbuttAnticipating) {
      glowColor = 0xffffff;
      glowIntensity = 0.4;
    } else if (this.isHeadbutting) {
      glowColor = 0xffcc00;
      glowIntensity = 0.8;
    }

    // --- Ability states ---
    for (const s of this.abilityStates) {
      if (!s.active) continue;

      if (s.def.type === 'charge_rush') {
        glowColor = 0xff8800;
        glowIntensity = 0.7;
        // Head tucks down during charge
        headOffsetY = -0.08;
      } else if (s.def.type === 'ground_pound') {
        if (s.windUpLeft > 0) {
          bodyScaleY = FEEL.groundPound.windUpSquash;
          headOffsetY = FEEL.groundPound.windUpHeadDrop;
          glowColor = 0xffff00;
          glowIntensity = 0.5;
        } else {
          glowColor = 0xff2200;
          glowIntensity = 0.7;
        }
      }
    }

    // --- Cooldown visual (muted) ---
    if (this.headbuttCooldown > 0 && !this.isHeadbutting && !this.headbuttAnticipating) {
      glowIntensity *= 0.5;
    }

    // Apply emissive
    headMat.emissive.setHex(glowColor);
    headMat.emissiveIntensity = glowIntensity;
    const isActive = glowColor !== this.config.color;
    bodyMat.emissive.setHex(isActive ? glowColor : 0x000000);
    bodyMat.emissiveIntensity = isActive ? glowIntensity * 0.4 : 0;

    // Apply body scale (only from ability wind-ups, not from scale feedback system)
    this.body.scale.y = bodyScaleY;

    // Apply head offset
    this.head.position.y = BODY_RADIUS * 2 + HEAD_RADIUS * 0.6 + headOffsetY;

    // --- Immunity blink ---
    if (this.immunityTimer > 0) {
      const blink = Math.sin(Date.now() * 0.001 * FEEL.lives.blinkRate * Math.PI * 2) > 0;
      headMat.opacity = blink ? 1.0 : 0.3;
      bodyMat.opacity = blink ? 1.0 : 0.3;
      headMat.transparent = true;
      bodyMat.transparent = true;
    } else {
      headMat.opacity = 1.0;
      bodyMat.opacity = 1.0;
      headMat.transparent = false;
      bodyMat.transparent = false;
    }
  }

  /** Start falling off arena — will respawn or eliminate after delay. */
  startFalling(): void {
    if (this.falling) return;
    this.falling = true;
    this.lives--;
    this.respawnTimer = FEEL.lives.respawnDelay;
  }

  /** Update falling state. Returns true if critter should respawn now. */
  updateFalling(dt: number): boolean {
    if (!this.falling) return false;
    this.mesh.position.y -= 12 * dt; // fall animation
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      if (this.lives > 0) {
        return true; // signal: ready to respawn
      } else {
        this.eliminate();
      }
    }
    return false;
  }

  /** Respawn at a position with immunity. */
  respawnAt(x: number, z: number): void {
    this.falling = false;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.mesh.position.y = 0;
    this.immunityTimer = FEEL.lives.immunityDuration;
    this.isHeadbutting = false;
    this.headbuttAnticipating = false;
    this.headbuttCooldown = 0;
    this.head.position.z = 0;
    this.body.rotation.x = 0;
    this.head.rotation.x = 0;
    this.mesh.visible = true;
    this.mesh.scale.set(1, 1, 1);
    this.body.scale.y = 1.0;
  }

  /** Permanently eliminated (no lives left). */
  eliminate(): void {
    this.alive = false;
    this.falling = false;
    this.mesh.visible = false;
  }

  reset(x: number, z: number): void {
    this.alive = true;
    this.mesh.visible = true;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.lives = FEEL.lives.default;
    this.immunityTimer = 0;
    this.falling = false;
    this.headbuttCooldown = 0;
    this.isHeadbutting = false;
    this.headbuttAnticipating = false;
    this.hasInput = false;
    this.anticipationTimer = 0;
    this.head.position.z = 0;
    this.body.rotation.x = 0;
    this.head.rotation.x = 0;
    this.mesh.position.y = 0;
    this.mesh.scale.set(1, 1, 1);
    this.body.scale.y = 1.0;
    this.abilityStates = createAbilityStates(this.config.name);
  }
}
