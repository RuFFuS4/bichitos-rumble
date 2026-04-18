import * as THREE from 'three';
import { createAbilityStates, getSpeedMultiplier, getMassMultiplier } from './abilities';
import type { AbilityState } from './abilities';
import { updateScaleFeedback, updateKnockbackTilt, updateHeadbuttRecovery, applyHeadbuttRecovery, tickHitFlash, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { getRosterEntry, type RosterEntry } from './roster';
import { loadModel } from './model-loader';

export interface CritterConfig {
  name: string;
  color: number;
  speed: number;
  mass: number;
  headbuttForce: number;
  /** Seconds between consecutive headbutts. Falls back to FEEL.headbutt.cooldown. */
  headbuttCooldown?: number;
  role: string;           // short label for identity (e.g. "Balanced")
  tagline: string;        // one-line description for character select
}

export const CRITTER_PRESETS: CritterConfig[] = [
  {
    name: 'Rojo', color: 0xe74c3c,
    speed: 10, mass: 1.0, headbuttForce: 14,
    role: 'Balanced',
    tagline: 'All-rounder. Easy to use.',
  },
  {
    // Sprint tuning: speed 11 → 12 so Azul actually feels fastest.
    name: 'Azul', color: 0x3498db,
    speed: 12, mass: 0.85, headbuttForce: 12,
    role: 'Skirmisher',
    tagline: 'Fast and light. Hit and run.',
  },
  {
    name: 'Verde', color: 0x2ecc71,
    speed: 7, mass: 1.4, headbuttForce: 17,
    role: 'Crusher',
    tagline: 'Slow but devastating.',
  },
  {
    // Sprint tuning: headbutt 11 → 13 so baseline combat isn't a loss.
    // Morado is fragile (mass 0.75) but no longer a total punching bag.
    name: 'Morado', color: 0x9b59b6,
    speed: 10, mass: 0.75, headbuttForce: 13,
    role: 'Glass Cannon',
    tagline: 'High risk, high reward.',
  },
  // --- First real roster character ---
  {
    name: 'Sergei', color: 0xb5651d,
    speed: 10, mass: 1.1, headbuttForce: 15,
    role: 'Balanced',
    tagline: 'Strong and agile. No weakness.',
  },
  // --- Second real roster character: elephant Bruiser ---
  // Stats modelled after Verde (Crusher) — slow, heavy, devastating —
  // but with real identity + GLB + roster visibility.
  {
    name: 'Trunk', color: 0x8c8c8c,
    speed: 7, mass: 1.4, headbuttForce: 17,
    role: 'Bruiser',
    tagline: 'Huge and unstoppable.',
  },

  // --- Bloque C: 7 remaining playables ---
  // All share base ability factories (charge_rush / ground_pound / frenzy)
  // but each kit is tuned per-critter. Server-side CRITTER_ABILITY_KITS
  // carries the identical impulse/radius/force/multipliers so online play
  // feels identical to offline.

  { // Trickster — fast, light, evasive. Uses Frenzy as ult.
    name: 'Kurama', color: 0xff6633,
    speed: 12, mass: 0.8, headbuttForce: 12,
    role: 'Trickster',
    tagline: 'Fast, sly, unpredictable.',
  },
  { // Tank — slow, heavy, crushing. Uses Frenzy as ult (berserk).
    name: 'Shelly', color: 0x2d8659,
    speed: 6.5, mass: 1.5, headbuttForce: 16,
    role: 'Tank',
    tagline: 'Heavy and wise.',
  },
  { // Controller — standard stats, biggest AoE radius.
    name: 'Kermit', color: 0x44cc44,
    speed: 9, mass: 1.0, headbuttForce: 13,
    role: 'Controller',
    tagline: 'Venomous area denial.',
  },
  { // Trapper — grounded presence, highest windUp + force on AoE.
    name: 'Sihans', color: 0x8b6914,
    speed: 8, mass: 1.15, headbuttForce: 14,
    role: 'Trapper',
    tagline: 'Digs in. Controls ground.',
  },
  { // Mage — widest AoE radius, lowest force (area denial, not burst).
    name: 'Kowalski', color: 0x1a1a3e,
    speed: 10, mass: 0.9, headbuttForce: 11,
    role: 'Mage',
    tagline: 'Calculated ranged threat.',
  },
  { // Assassin — fastest dash, mini AoE, fragile.
    name: 'Cheeto', color: 0xffaa22,
    speed: 13, mass: 0.7, headbuttForce: 11,
    role: 'Assassin',
    tagline: 'Swift and lethal.',
  },
  { // Glass Cannon — tiny AoE with massive force, high headbutt.
    name: 'Sebastian', color: 0xcc3333,
    speed: 10.5, mass: 0.75, headbuttForce: 18,
    role: 'Glass Cannon',
    tagline: 'One giant claw. All in.',
  },
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

  /** Roster visual data (null for characters without a roster entry). */
  rosterEntry: RosterEntry | null = null;

  /**
   * If true, update() skips the local physics + headbutt state machine.
   * Used for online mode where the server is authoritative — position,
   * velocity, isHeadbutting, lives etc. are set from server state each
   * frame, and local update() only runs the visual animations.
   */
  skipPhysics = false;
  /** Loaded GLB scene graph (null while loading or if procedural-only). */
  glbMesh: THREE.Group | null = null;  // public for debug tuning (make private after)
  /** Pre-collected MeshStandardMaterials from the GLB for fast visual updates. */
  private glbMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(config: CritterConfig, scene: THREE.Scene) {
    this.config = config;
    this.mesh = new THREE.Group();
    this.abilityStates = createAbilityStates(config.name);

    // Body — small sphere
    // NOTE: transparent: true is set from the start so the immunity blink
    // actually works. Without it, Three.js would need needsUpdate=true to
    // recompile the shader when toggling transparency mid-frame.
    const bodyGeo = new THREE.SphereGeometry(BODY_RADIUS, 16, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: config.color,
      transparent: true,
      opacity: 1.0,
    });
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
      transparent: true,
      opacity: 1.0,
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

    // --- GLB model loading (async, non-blocking) ---
    this.rosterEntry = getRosterEntry(config.name);
    if (this.rosterEntry?.glbPath) {
      const entry = this.rosterEntry;
      const path = entry.glbPath!;
      loadModel(path)
        .then(group => this.attachGlbMesh(group, entry))
        .catch(() => {
          console.debug('[Critter] GLB load failed, keeping procedural:', config.name);
        });
    }
  }

  get x(): number { return this.mesh.position.x; }
  set x(v: number) { this.mesh.position.x = v; }
  get z(): number { return this.mesh.position.z; }
  set z(v: number) { this.mesh.position.z = v; }
  get radius(): number { return this.rosterEntry?.physicsRadius ?? HEAD_RADIUS; }

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
    // Online mode: server is authoritative. Run only visual animations.
    // Position/velocity/isHeadbutting/etc. are set externally before this
    // call from the network state. We still need bobbing, emissive, hit
    // flash, scale feedback, and knockback tilt for visual parity.
    if (this.skipPhysics) {
      this.body.position.y = BODY_RADIUS + Math.sin(Date.now() * 0.005) * 0.05;
      if (this.glbMesh) {
        this.glbMesh.position.y = (this.rosterEntry?.pivotY ?? 0) + Math.sin(Date.now() * 0.005) * 0.05;
      }
      this.updateVisuals();
      const flashT = tickHitFlash(this, dt);
      if (flashT > 0) {
        for (const mat of this.getActiveMaterials()) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = flashT * 1.2;
        }
      }
      updateScaleFeedback(this, dt);
      updateKnockbackTilt(this, dt);
      updateHeadbuttRecovery(this, dt);
      return;
    }

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
        this.headbuttCooldown = this.config.headbuttCooldown ?? FEEL.headbutt.cooldown;
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
    if (this.glbMesh) {
      this.glbMesh.position.y = (this.rosterEntry?.pivotY ?? 0) + Math.sin(Date.now() * 0.005) * 0.05;
    }

    // Visual feedback for ability states
    this.updateVisuals();

    // Hit flash overrides the state emissive briefly (applied AFTER updateVisuals)
    const flashT = tickHitFlash(this, dt);
    if (flashT > 0) {
      for (const mat of this.getActiveMaterials()) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = flashT * 1.2;
      }
    }

    // Game feel visual systems (all visual-only, no gameplay logic)
    updateScaleFeedback(this, dt);
    updateKnockbackTilt(this, dt);
    updateHeadbuttRecovery(this, dt);
  }

  /** Visual-only: updates emissive, posture, and opacity based on current state. No gameplay logic. */
  private updateVisuals(): void {
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
      } else if (s.def.type === 'frenzy') {
        if (s.windUpLeft > 0) {
          glowColor = 0xffff00;
          glowIntensity = 0.5;
          bodyScaleY = 0.85;
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008);
          glowColor = 0xff1100;
          glowIntensity = 0.6 + pulse * 0.4;
        }
      }
    }

    // --- Cooldown visual (muted) ---
    if (this.headbuttCooldown > 0 && !this.isHeadbutting && !this.headbuttAnticipating) {
      glowIntensity *= 0.5;
    }

    // --- Apply to active materials (GLB or procedural) ---
    const mats = this.getActiveMaterials();
    const isActive = glowColor !== this.config.color;
    for (const mat of mats) {
      mat.emissive.setHex(isActive ? glowColor : 0x000000);
      mat.emissiveIntensity = isActive ? glowIntensity : 0;
    }

    // Procedural-only posture changes (harmless on invisible meshes when GLB active)
    this.body.scale.y = bodyScaleY;
    this.head.position.y = BODY_RADIUS * 2 + HEAD_RADIUS * 0.6 + headOffsetY;

    // --- Immunity blink ---
    if (this.immunityTimer > 0) {
      const phase = (Date.now() * 0.001 * FEEL.lives.blinkRate) % 1;
      const visible = phase < 0.5;
      const opacity = visible ? 1.0 : 0.15;
      for (const mat of mats) {
        mat.opacity = opacity;
        if (visible) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.8;
        }
      }
    } else {
      for (const mat of mats) {
        mat.opacity = 1.0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // GLB model integration
  // ---------------------------------------------------------------------------

  /** Attach a loaded GLB scene graph, hiding the procedural mesh. */
  private attachGlbMesh(group: THREE.Group, entry: RosterEntry): void {
    // Guard: if critter was disposed/detached before GLB loaded, discard
    // the clone to prevent GPU resource leaks on rapid navigation.
    if (!this.mesh.parent) {
      group.traverse((node) => {
        const m = node as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) { for (const mm of mat) mm.dispose(); }
        else if (mat) { (mat as THREE.Material).dispose(); }
      });
      console.debug('[Critter] GLB discarded (critter already disposed):', this.config.name);
      return;
    }
    // Apply roster visual config
    group.scale.setScalar(entry.scale);
    group.rotation.y = entry.rotation;
    group.position.set(...entry.offset);
    group.position.y += entry.pivotY;

    // Ensure all GLB materials support transparency (needed for immunity blink)
    group.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) {
        mat.transparent = true;
        mat.opacity = 1.0;
      }
    });

    // Hide procedural geometry (keep body/head alive for harmless code paths)
    this.body.visible = false;
    this.head.visible = false;

    // Collect materials for fast updateVisuals() access
    this.glbMaterials = [];
    group.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material;
      if (Array.isArray(mat)) {
        for (const mm of mat) {
          if ((mm as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            this.glbMaterials.push(mm as THREE.MeshStandardMaterial);
          }
        }
      } else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        this.glbMaterials.push(mat as THREE.MeshStandardMaterial);
      }
    });

    this.mesh.add(group);
    this.glbMesh = group;
    console.debug('[Critter] GLB attached:', this.config.name, '| materials:', this.glbMaterials.length);
  }

  /**
   * Returns the materials that are currently visible. When a GLB is loaded,
   * returns its materials; otherwise falls back to the procedural body/head.
   */
  private getActiveMaterials(): THREE.MeshStandardMaterial[] {
    if (this.glbMaterials.length > 0) return this.glbMaterials;
    return [
      this.body.material as THREE.MeshStandardMaterial,
      this.head.material as THREE.MeshStandardMaterial,
    ];
  }

  /** True when the critter is rendering a real 3D model instead of spheres. */
  get hasGlb(): boolean {
    return this.glbMesh !== null;
  }

  // ---------------------------------------------------------------------------
  // Falling / respawn / elimination
  // ---------------------------------------------------------------------------

  /** Start falling off arena — will respawn or eliminate after delay. */
  startFalling(): void {
    if (this.falling) return;
    this.falling = true;
    this.lives--;
    this.respawnTimer = FEEL.lives.respawnDelay;
    playSound('fall');
  }

  /** Update falling state. Returns true if critter should respawn now. */
  updateFalling(dt: number): boolean {
    if (!this.falling) return false;
    this.mesh.position.y -= FEEL.lives.fallSpeed * dt;
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
    // Face the arena centre — same rule as initial spawn, so a respawned
    // critter never looks toward the void.
    this.mesh.rotation.y = Math.atan2(-x, -z);
    this.mesh.position.y = 0;
    this.immunityTimer = FEEL.lives.immunityDuration;
    playSound('respawn');
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

  /**
   * Release GPU resources and detach from the scene. Idempotent.
   * Call before dropping the reference to a Critter (e.g. on match
   * rebuild). Without this, every roster swap leaks 8 geometries +
   * materials per critter.
   */
  dispose(): void {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    // Dispose all GPU resources: procedural + GLB
    this.mesh.traverse((child) => {
      const m = child as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) {
        for (const mm of mat) mm.dispose();
      } else if (mat) {
        mat.dispose();
      }
    });
    this.glbMesh = null;
    this.glbMaterials = [];
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
