import * as THREE from 'three';
import { createAbilityStates, getSpeedMultiplier, getMassMultiplier } from './abilities';
import type { AbilityState } from './abilities';
import { updateScaleFeedback, updateKnockbackTilt, updateHeadbuttRecovery, applyHeadbuttRecovery, tickHitFlash, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { getRosterEntry, type RosterEntry } from './roster';
import { loadModelWithAnimations } from './model-loader';
import { SkeletalAnimator, type SkeletalState } from './critter-skeletal';
import { createCritterParts } from './critter-parts';
import { deriveAnimationPersonality, tickProceduralAnimation, type AnimationPersonality } from './critter-animation';
import { deriveCritterStats } from './pws-stats';

/**
 * Behaviour tag used ONLY by the /tools.html dev lab to isolate bot
 * behaviour during testing. Production bots always run with 'normal'.
 * See src/bot.ts for how each tag is interpreted.
 */
export type BotBehaviourTag =
  | 'normal'       // default — full AI (chase + headbutt + abilities)
  | 'idle'         // don't move, don't attack (freeze in place)
  | 'passive'      // chase only, NEVER headbutt or use abilities
  | 'aggressive'   // chase + much higher ability fire rate
  | 'chase'        // chase only, no headbutt, no abilities (movement dummy)
  | 'ability_only';// don't headbutt, only abilities

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
  // --- 9 playable critters (2026-04-23) -----------------------------------
  // speed / mass / headbuttForce now derive from CRITTER_PWS (P/W/S levels)
  // — edit src/pws-stats.ts to rebalance without touching this file.
  {
    ...deriveCritterStats('Sergei'),
    name: 'Sergei', color: 0xb5651d,
    role: 'Balanced',
    tagline: 'Strong and agile. No weakness.',
  },
  {
    ...deriveCritterStats('Trunk'),
    name: 'Trunk', color: 0x8c8c8c,
    role: 'Bruiser',
    tagline: 'Huge and unstoppable.',
  },
  { // Trickster — fast, light, evasive. Uses Frenzy as ult.
    ...deriveCritterStats('Kurama'),
    name: 'Kurama', color: 0xff6633,
    role: 'Trickster',
    tagline: 'Fast, sly, unpredictable.',
  },
  { // Tank — slow, heavy, crushing. Uses Frenzy as ult (berserk).
    ...deriveCritterStats('Shelly'),
    name: 'Shelly', color: 0x2d8659,
    role: 'Tank',
    tagline: 'Heavy and wise.',
  },
  { // Controller — standard stats, biggest AoE radius.
    ...deriveCritterStats('Kermit'),
    name: 'Kermit', color: 0x44cc44,
    role: 'Controller',
    tagline: 'Venomous area denial.',
  },
  { // Trapper — grounded presence, highest windUp + force on AoE.
    ...deriveCritterStats('Sihans'),
    name: 'Sihans', color: 0x8b6914,
    role: 'Trapper',
    tagline: 'Digs in. Controls ground.',
  },
  { // Mage — widest AoE radius, lowest force (area denial, not burst).
    ...deriveCritterStats('Kowalski'),
    name: 'Kowalski', color: 0x1a1a3e,
    role: 'Mage',
    tagline: 'Calculated ranged threat.',
  },
  { // Assassin — fastest dash, mini AoE, fragile.
    ...deriveCritterStats('Cheeto'),
    name: 'Cheeto', color: 0xffaa22,
    role: 'Assassin',
    tagline: 'Swift and lethal.',
  },
  { // Glass Cannon — tiny AoE with massive force, high headbutt.
    ...deriveCritterStats('Sebastian'),
    name: 'Sebastian', color: 0xcc3333,
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
  /** Public so the procedural animation layer can read it for pose drive. */
  headbuttAnticipating = false;
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
  /**
   * Procedural animation parameters derived from (mass, speed). Written
   * once in the constructor; read every frame by tickProceduralAnimation.
   */
  animPersonality: AnimationPersonality;

  /**
   * Dev-lab behaviour override for bots. Only checked inside bot.ts when
   * this critter is treated as a bot (i.e. NOT the local player).
   * Default 'normal' = production behaviour. See BotBehaviourTag.
   */
  debugBotBehaviour: BotBehaviourTag = 'normal';

  /**
   * True for server-controlled fill-in bots in online 4P matches. Set from
   * the PlayerSchema's isBot flag when the online critter is spawned.
   * Used by the HUD (bot badge) and the end-screen to distinguish them
   * from human opponents. Offline matches never set this — offline bots
   * are identified by being non-player critters (index != 0) instead.
   */
  isBot = false;

  /**
   * Per-match counters, reset on reset(). Used by the end-screen stats
   * block. Works in both offline and online: the edges are detected
   * from `isHeadbutting` / `falling` / `abilityStates[i].active` which
   * are set by the local sim in offline and by the sync loop in online
   * BEFORE Critter.update() runs, so both modes feed the same flags.
   */
  matchStats = {
    headbutts: 0,
    abilitiesUsed: 0,
    falls: 0,
    respawns: 0,
    /** Headbutts received from enemies this match. Bumped from physics.ts
     *  in the headbutt-impact branch. Feeds the Untouchable / Pain
     *  Tolerance badge evaluation via recordWin(). */
    hitsReceived: 0,
  };

  /** Edge-detection memory for matchStats counting. */
  private lastStatsHeadbutting = false;
  private lastStatsFalling = false;
  private lastStatsAbilityActive: boolean[] = [false, false, false];

  /**
   * Skeletal animation layer — non-null only when the GLB shipped clips.
   * Coexists with the procedural layer: for light states (idle/walk/run)
   * both run together; for heavy states (victory/defeat/ability/etc.) the
   * procedural layer silences its root writes (see tickProceduralAnimation).
   * Critters without clips keep `skeletal = null` and render 100% procedural
   * just like before — zero breakage for unanimated models.
   */
  skeletal: SkeletalAnimator | null = null;

  /**
   * Part manipulation handle — resolved when the GLB attaches. Lets
   * ability code hide bones (Shelly's head/limbs inside the shell),
   * target specific primitives (Trunk's nose mesh), or clone a tinted
   * decoy (Kurama Mirror Trick). Null for procedural-only critters.
   * See `PROCEDURAL_PARTS.md` + `src/critter-parts.ts`.
   */
  parts: ReturnType<typeof import('./critter-parts').createCritterParts> | null = null;

  constructor(config: CritterConfig, scene: THREE.Scene) {
    this.config = config;
    this.mesh = new THREE.Group();
    this.abilityStates = createAbilityStates(config.name);
    this.animPersonality = deriveAnimationPersonality(config);

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
      loadModelWithAnimations(path)
        .then(({ scene, animations }) => this.attachGlbMesh(scene, entry, animations))
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
    // Skeletal hook — if the critter has a wind-up clip, fire it now.
    // fallback: lunge clip takes over when anticip finishes (see update()).
    this.playSkeletal('headbutt_anticip', { fallback: 'headbutt_lunge' });
  }

  update(dt: number): void {
    // Online mode: server is authoritative. Run only visual animations.
    // Position/velocity/isHeadbutting/etc. are set externally before this
    // call from the network state. We still need bobbing, emissive, hit
    // flash, scale feedback, and knockback tilt for visual parity.
    if (this.skipPhysics) {
      // Online mode: server is authoritative. Procedural animation still
      // runs because it reads vx/vz/abilityStates (all set from server
      // each tick before update() is called).
      this.tickMatchStats();
      this.tickSkeletal(dt);
      tickProceduralAnimation(this, dt);
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
        // Skeletal hook for the lunge strike. Fallback to idle after the
        // one-shot so the critter doesn't freeze in the mid-lunge pose.
        this.playSkeletal('headbutt_lunge', { fallback: 'idle' });
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

    // Per-match stat edges (headbutt / fall / ability). Ordered before
    // skeletal/procedural so a same-frame stats read reflects this tick.
    this.tickMatchStats();

    // Skeletal animation layer (no-op if this critter has no clips). Runs
    // BEFORE procedural so procedural can read the skeletal state and
    // silence conflicting root writes.
    this.tickSkeletal(dt);

    // Procedural animation layer (idle bob + run bounce + lean + charge stretch).
    // Reads vx/vz/abilityStates; writes body.position.y / glbMesh.position.y /
    // glbMesh.rotation.x / glbMesh.scale.z only. Safe alongside updateVisuals.
    tickProceduralAnimation(this, dt);

    // Visual feedback for ability states (emissive, body scale, head offset)
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
        } else if (this.config.name === 'Kermit') {
          // Hypnosapo — Kermit's ulti runs a fast hypnotic flicker
          // between two pinks / purples instead of the default frenzy
          // red pulse. No skeletal clip ships for this state, so the
          // effect lives entirely in the emissive channel per the
          // gameplay-procedural separation rule.
          const t = Date.now() * 0.025;
          const flicker = Math.sin(t);
          const swing = Math.abs(Math.sin(t * 0.5));
          glowColor = flicker > 0 ? 0xaa00ff : 0xff44cc;
          glowIntensity = 0.9 + swing * 0.4;
          // Slight body scale pulse for "charging hypnosis"
          bodyScaleY = 1.0 + swing * 0.08;
        } else {
          // Default frenzy — red pulse (Sergei, Shelly, …).
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
  private attachGlbMesh(
    group: THREE.Group,
    entry: RosterEntry,
    animations: THREE.AnimationClip[] = [],
  ): void {
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

    // Normalise GLB materials for our shading pipeline:
    //   - transparent: true → needed for the immunity blink pass
    //   - metalness/roughness neutralised when the source exported a
    //     full-PBR rig (Meshy does `metalness: 1`), which reads as dark
    //     matte without an envMap and kills the saturated colours the
    //     base map actually contains. Forcing metalness=0 + roughness=0.7
    //     lets the diffuse map drive the look, matching the flat cartoon
    //     look from the source visor. Tripo exports already low-metal,
    //     so we only touch materials that came in with > 0.5.
    group.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh) return;
      const raw = m.material;
      const mats = Array.isArray(raw) ? raw : [raw];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        std.transparent = true;
        std.opacity = 1.0;
        if (std.metalness > 0.5) {
          std.metalness = 0;
          std.roughness = 0.7;
          std.needsUpdate = true;
        }
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

    // Skeletal animation setup — only if the GLB shipped clips. The mixer
    // binds to the cloned group so each Critter has its own animation state.
    // Clips themselves are shared across clones (immutable data — safe).
    if (animations.length > 0) {
      this.skeletal = new SkeletalAnimator(group, animations);
      // Kick off an idle loop so the critter breathes while we wait for
      // gameplay signals. Safe no-op if there's no idle clip resolved.
      this.skeletal.play('idle');
      console.debug(
        '[Critter] skeletal animator attached:',
        this.config.name,
        '| clips:',
        this.skeletal.availableClipNames.join(', '),
      );
    }

    // Parts handle — locates bones + primitives once so ability code can
    // manipulate them without repeatedly traversing the scene graph.
    // Finds the first SkinnedMesh skeleton under the clone (may be null
    // for non-rigged GLBs — the API degrades gracefully).
    let skeleton: THREE.Skeleton | null = null;
    group.traverse((child) => {
      if (!skeleton && (child as THREE.SkinnedMesh).isSkinnedMesh) {
        skeleton = (child as THREE.SkinnedMesh).skeleton;
      }
    });
    this.parts = createCritterParts(group, skeleton);

    console.debug(
      '[Critter] GLB attached:',
      this.config.name,
      '| materials:', this.glbMaterials.length,
      '| bones:',     this.parts.bones.size,
      '| primitives:', this.parts.primitives.length,
    );
  }

  /**
   * Convenience proxy: request a skeletal clip state. Safe to call whether
   * or not the critter has a skeletal animator — callers don't need to
   * guard. Returns true if the clip exists and is now playing.
   */
  playSkeletal(state: SkeletalState, opts?: { fallback?: SkeletalState; crossfade?: number; force?: boolean }): boolean {
    return this.skeletal?.play(state, opts) ?? false;
  }

  /**
   * Edge-detection memory for ability cast events, so `tickSkeletal` can
   * fire a `playSkeletal('ability_N')` exactly once on the rising edge of
   * each ability's `active` flag.
   */
  private lastAbilityActive: boolean[] = [false, false, false];

  /**
   * Advance the skeletal layer (if any) and auto-drive idle / run loops
   * from current velocity. Called every frame before procedural.
   *
   * Auto-logic is conservative:
   *   - Does nothing if the critter has no skeletal animator.
   *   - Skips idle/run switching while a HEAVY state is active (victory,
   *     defeat, ability, headbutt_lunge, fall, hit) — those clips own
   *     the pose.
   *   - Skips idle/run while headbutt anticip/lunge flags are set, so
   *     the pose stays crisp.
   *   - Fires ability_1 / ability_2 / ability_3 on the rising edge of
   *     each ability's `active` flag.
   */
  /**
   * Advance per-match counters by edge-detecting state transitions.
   * Called once per Critter.update() in BOTH offline and online paths —
   * the flags it watches (`isHeadbutting`, `falling`, `abilityStates[i].
   * active`) are set by the local sim in offline and by the online
   * sync loop before `update()` runs. So one detection path feeds both.
   */
  private tickMatchStats(): void {
    // Headbutt edge — count one "attempt" per lunge (not per anticipation
    // so a cancelled anticip wouldn't double-count).
    if (this.isHeadbutting && !this.lastStatsHeadbutting) {
      this.matchStats.headbutts++;
    }
    this.lastStatsHeadbutting = this.isHeadbutting;

    // Fall edge
    if (this.falling && !this.lastStatsFalling) {
      this.matchStats.falls++;
    }
    this.lastStatsFalling = this.falling;

    // Ability cast edges (per slot)
    for (let i = 0; i < this.abilityStates.length && i < 3; i++) {
      const active = this.abilityStates[i].active;
      if (active && !this.lastStatsAbilityActive[i]) {
        this.matchStats.abilitiesUsed++;
      }
      this.lastStatsAbilityActive[i] = active;
    }
  }

  private tickSkeletal(dt: number): void {
    if (!this.skeletal) return;

    // Ability cast edges — play the corresponding clip exactly once.
    for (let i = 0; i < this.abilityStates.length && i < 3; i++) {
      const active = this.abilityStates[i].active;
      const prev = this.lastAbilityActive[i];
      if (active && !prev) {
        const slotState: SkeletalState = (['ability_1', 'ability_2', 'ability_3'] as const)[i];
        this.skeletal.play(slotState);
      }
      this.lastAbilityActive[i] = active;
    }

    // Movement-driven idle/run, only if nothing "heavier" is playing and
    // we're not in a headbutt pose window.
    const heavy = this.skeletal.isHeavyClipActive();
    const inHeadbuttPose = this.headbuttAnticipating || this.isHeadbutting;
    if (this.alive && !heavy && !inHeadbuttPose) {
      const vMag = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
      const moving = vMag > FEEL.movement.velocityDeadZone * 2;
      this.skeletal.play(moving ? 'run' : 'idle');
    }

    this.skeletal.update(dt);
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
    // Skeletal fall clip — kept until respawn (one-shot with defeat
    // fallback so if there's no fall clip but there is defeat, it still
    // reads as "going down" instead of idle during the drop).
    this.playSkeletal('fall', { fallback: 'defeat' });
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
    // Play a respawn clip if present; falls back to idle automatically.
    this.playSkeletal('respawn', { fallback: 'idle' });
    this.matchStats.respawns++;
  }

  /** Permanently eliminated (no lives left). */
  eliminate(): void {
    this.alive = false;
    this.falling = false;
    this.mesh.visible = false;
    // Hold the defeat pose for the end-screen. clampWhenFinished keeps
    // the last frame visible instead of snapping back to idle.
    this.playSkeletal('defeat', { fallback: 'defeat' });
  }

  /**
   * Release GPU resources and detach from the scene. Idempotent.
   * Call before dropping the reference to a Critter (e.g. on match
   * rebuild). Without this, every roster swap leaks 8 geometries +
   * materials per critter.
   */
  dispose(): void {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    // Skeletal animator: release the mixer's actions first. The
    // underlying AnimationClip objects are SHARED across clones and must
    // not be disposed here — the model-loader cache owns them.
    this.skeletal?.dispose();
    this.skeletal = null;
    // Parts handle doesn't own GPU resources — it just holds references
    // into the already-disposed mesh tree. Null the handle so consumers
    // don't accidentally read stale bones.
    this.parts = null;
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
    // Fresh match → reset per-match counters and edge-detection memory.
    this.matchStats = { headbutts: 0, abilitiesUsed: 0, falls: 0, respawns: 0, hitsReceived: 0 };
    this.lastStatsHeadbutting = false;
    this.lastStatsFalling = false;
    this.lastStatsAbilityActive = [false, false, false];
  }
}
