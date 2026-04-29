import * as THREE from 'three';
import { createAbilityStates, getSpeedMultiplier, getMassMultiplier, getZoneSlowMultiplier, isInsideZoneOfKind } from './abilities';
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
  /** v0.11: per-critter feedback boost on the headbutt connect. The
   *  headbuttForce above already governs the raw knockback delta;
   *  `headbuttBoost` is a secondary modifier that scales the FEEL
   *  shake amplitude + a small impulse bonus when this critter's
   *  headbutt LANDS. Default 1.0 (no bonus). Used to differentiate
   *  characters whose cabezazo Rafa marked as "needs more punch":
   *  Sebastian gets the loudest bonus, Cheeto a quick-hit bonus,
   *  Sergei + Kowalski a moderate one. Trunk / Kurama / Shelly /
   *  Kermit / Sihans stay at 1.0 — Rafa marked them OK or perfect. */
  headbuttBoost?: number;
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
    headbuttBoost: 1.15,
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
    name: 'Kermit', color: 0x9c3cee,
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
    headbuttBoost: 1.20,
    role: 'Mage',
    tagline: 'Calculated ranged threat.',
  },
  { // Assassin — fastest dash, mini AoE, fragile.
    ...deriveCritterStats('Cheeto'),
    name: 'Cheeto', color: 0xffaa22,
    headbuttBoost: 1.30,
    role: 'Assassin',
    tagline: 'Swift and lethal.',
  },
  { // Glass Cannon — tiny AoE with massive force, high headbutt.
    ...deriveCritterStats('Sebastian'),
    name: 'Sebastian', color: 0xcc3333,
    headbuttBoost: 1.45,
    role: 'Glass Cannon',
    tagline: 'One giant claw. All in.',
  },
];

const BODY_RADIUS = 0.5;
const HEAD_RADIUS = 0.55;

/**
 * Target silhouette height (world units) for the GLB mesh inside a Critter.
 * Applied after the per-roster `scale` so all 9 critters read the same size
 * in the arena, regardless of source mesh conventions (Tripo ~0.6u, Meshy
 * ~2.4u, etc.). Picked to split the difference between the shortest (Cheeto
 * at ~1.4u pre-fit) and tallest (Trunk ~2.0u pre-fit). Tweakable if the
 * arena starts feeling too crowded or too tiny.
 *
 * Physics-agnostic: this scales the visible mesh only. Hitboxes come from
 * `physicsRadius` on the roster entry and aren't affected.
 */
const IN_GAME_TARGET_HEIGHT = 1.7;

export class Critter {
  mesh: THREE.Group;
  config: CritterConfig;

  vx = 0;
  vz = 0;
  alive = true;
  hasInput = false;
  lives = FEEL.lives.default;
  immunityTimer = 0;
  /** v0.11 — Kurama Mirror Trick: while > 0 the GLB mesh is
   *  rendered at alpha 0.25 ("ghost"). Independent of immunityTimer
   *  so the immunity blink and the invisibility don't collide
   *  visually. Decremented per update(dt). */
  invisibilityTimer = 0;
  /** v0.11 — Shelly Steel Shell: while > 0 the GLB materials get
   *  emissive tinted to `selfTintHex`. Provides a "metallic mode"
   *  read for the defensive K. */
  selfTintTimer = 0;
  selfTintHex: number | null = null;
  /** 2026-04-29 — Kowalski Snowball hit-status. While > 0 the
   *  critter moves at 50 % speed. Decremented in update(dt). Mirror
   *  of `PlayerSchema.slowTimer` so offline + online behave the
   *  same. Set by `tickProjectiles` on hit (offline) or by the
   *  online state patch (server is authoritative there). */
  slowTimer = 0;
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
  /**
   * Per-instance live override of roster visual params. Read by
   * `tickProceduralAnimation` so tooling (the /calibrate.html lab) can
   * mutate `scale` / `pivotY` on the live critter and see the change
   * hot — otherwise procedural re-writes `glbMesh.scale.{x,y,z}` and
   * `glbMesh.position.y` back to the static roster values every frame,
   * making the sliders look dead.
   *
   * `rotation` is carried for symmetry but is currently NOT read by
   * procedural (it writes `rotation.x` / `rotation.z` only, never `.y`,
   * which is what the rotation slider touches directly on `glbMesh`).
   *
   * Undefined in the game path — the match never sets this, so
   * procedural falls back to `rosterEntry.*` exactly as before. Zero
   * gameplay change by design.
   */
  rosterOverride?: Partial<Pick<RosterEntry, 'scale' | 'pivotY' | 'rotation'>>;
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

  /** Height of the GLB in BIND POSE world space, measured once at
   *  attach. Used by the character-select preview to apply a uniform
   *  scale synchronously (no pop), independent of idle-clip wiggle.
   *  Null until the async GLB load completes; 0 for procedural-only
   *  critters that have no GLB. */
  bindPoseHeight: number | null = null;

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
    // Active abilities (charge_rush boost, frenzy buff, K root, blink
    // root) × any slow zones the critter is currently standing inside
    // (Kermit Poison Cloud, Sihans Quicksand) × the Snowball hit-slow
    // status (50 % while > 0). The zone check passes the critter name
    // as `ownerKey` so a caster doesn't get slowed by their own zone.
    // Online matches normalise `ownerKey` to the critter name on the
    // pushNetworkZone path so a remote Kermit isn't slowed by their
    // own cloud either.
    let s = this.config.speed *
      getSpeedMultiplier(this.abilityStates) *
      getZoneSlowMultiplier(this.x, this.z, this.config.name);
    if (this.slowTimer > 0) s *= 0.5;
    return s;
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
    // v0.11 — invisibility (Kurama Mirror Trick) + self-tint (Shelly
    // Steel Shell) timers. Both decrement on the same path; the
    // visual layer in `updateVisuals` reads the timers each frame
    // to decide alpha + emissive tint.
    if (this.invisibilityTimer > 0) this.invisibilityTimer -= dt;
    if (this.selfTintTimer > 0) {
      this.selfTintTimer -= dt;
      if (this.selfTintTimer <= 0) this.selfTintHex = null;
    }
    // 2026-04-29 — Snowball hit-slow status countdown.
    if (this.slowTimer > 0) this.slowTimer = Math.max(0, this.slowTimer - dt);

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
    // v0.11 Sergei mesh-bug fix: toggle `material.transparent`
    // dynamically. Forcing every GLB material to `transparent: true`
    // at attach time (so the blink can fade them) leaves the alpha-
    // sort path active even when opacity == 1.0; on multi-submesh
    // skinned models like Sergei this caused random parts to render
    // behind/through each other ("the gorilla becomes see-through in
    // patches"). Keeping `transparent` opaque except during the
    // actual blink window avoids the sort entirely the rest of the
    // time and costs nothing — the blink path still flips it back to
    // transparent for as long as opacity < 1.
    if (this.immunityTimer > 0) {
      const phase = (Date.now() * 0.001 * FEEL.lives.blinkRate) % 1;
      const visible = phase < 0.5;
      const opacity = visible ? 1.0 : 0.15;
      for (const mat of mats) {
        mat.transparent = !visible;     // opaque on the bright frame, transparent on the dim frame
        mat.opacity = opacity;
        mat.depthWrite = visible;       // skinned-mesh sort safety: keep depth writes on for the opaque frame
        if (visible) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.8;
        }
      }
    } else if (this.invisibilityTimer > 0) {
      // v0.11 — Kurama Mirror Trick. Mesh ghosted to alpha 0.25.
      // 2026-04-29 K-session — Sihans Burrow Rush reuses the same
      // timer but collapses to alpha 0 (totally underground) for
      // its short 0.30 s window. Distinguishing per-critter keeps
      // both abilities authorial without adding a second timer
      // field to Critter.
      const ghostAlpha = this.config.name === 'Sihans' ? 0.0 : 0.25;
      for (const mat of mats) {
        mat.transparent = true;
        mat.opacity = ghostAlpha;
        mat.depthWrite = false;
      }
    } else {
      for (const mat of mats) {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      }
    }
    // v0.11 — Shelly Steel Shell self-tint. Independent of immunity
    // blink: while `selfTintTimer > 0`, override emissive on every
    // material to read as "metallic mode". Cleared on next update
    // when the timer expires.
    if (this.selfTintTimer > 0 && this.selfTintHex !== null) {
      const tint = this.selfTintHex;
      for (const mat of mats) {
        mat.emissive.setHex(tint);
        mat.emissiveIntensity = 0.85;
      }
    }
    // 2026-04-29 K-refinement — Snowball "frozen" visual on the
    // affected target. When `slowTimer > 0` (set on snowball impact
    // server-side and synced via PlayerSchema), tint the GLB
    // materials icy cyan so the read is "this critter is frozen,
    // not just slow". Pulse every ~0.6 s so it doesn't blend into
    // the regular silhouette. Bypasses Steel-Shell tint by
    // running AFTER it — slow status overrides defensive look,
    // intentionally: a frozen Shelly should still look frozen.
    if (this.slowTimer > 0) {
      // Pulse 0..1 with a 1.6 Hz triangle wave so the chill
      // reads alive without competing with the cooldown blink.
      const pulse = 0.55 + 0.25 * Math.sin(Date.now() * 0.005);
      for (const mat of mats) {
        mat.emissive.setHex(0x88c1ff);
        mat.emissiveIntensity = pulse;
      }
    }
    // 2026-04-29 K-refinement — Sihans Quicksand "trapped" visual
    // on enemies standing inside a sand zone. Subtle warm-brown
    // emissive pulse so a critter caught in the swirl reads as
    // "ralentizado por arena" without competing with the snowball
    // freeze (cyan) or shells. Self-skip: Sihans inside her own
    // quicksand keeps her normal look so the caster stays
    // distinguishable. Snowball freeze takes priority because slow
    // is more severe (50 %) than the quicksand 50 %, but both
    // happen rarely enough simultaneously that the cyan-over-amber
    // collision is acceptable.
    if (this.slowTimer === 0 && this.config.name !== 'Sihans' &&
        getZoneSlowMultiplier(this.x, this.z) < 1 &&
        isInsideZoneOfKind(this.x, this.z, 'sand')) {
      const pulse = 0.50 + 0.30 * Math.sin(Date.now() * 0.006);
      for (const mat of mats) {
        mat.emissive.setHex(0xb98c54);
        mat.emissiveIntensity = pulse;
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
    //   - transparent: FALSE at attach time (was `true` until 2026-04-29) —
    //     keeping it `true` permanently kept the alpha-sort path active for
    //     every skinned submesh forever, which on multi-mesh GLBs (Sergei
    //     is the worst case: gorilla body + arms + face split across
    //     submeshes) produced "patches becoming see-through" because alpha
    //     sort can't reliably order intersecting skinned-mesh triangles.
    //     `updateVisuals` flips `transparent: true` ONLY for the few frames
    //     of immunity blink / invisibility — outside those windows the
    //     material stays fully opaque with depth-write enabled, so the
    //     skinned mesh sorts via the depth buffer like every other solid
    //     mesh.
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
        std.transparent = false;
        std.opacity = 1.0;
        std.depthWrite = true;
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

    // Measure bind-pose silhouette FIRST, before the mixer touches the
    // skeleton. Used as the baseline for the sync auto-fit in the
    // preview (so swaps are pop-free — we don't wait for the idle clip
    // to tick before we know how big the critter is).
    let measuredHeight = 0;
    {
      group.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(group);
      if (!bbox.isEmpty()) measuredHeight = bbox.max.y - bbox.min.y;
    }
    this.bindPoseHeight = measuredHeight > 0.1 ? measuredHeight : null;

    // Skeletal animation setup — only if the GLB shipped clips. The mixer
    // binds to the cloned group so each Critter has its own animation
    // state. Clips themselves are shared across clones (immutable data).
    // Passing the roster id lets the animator consult
    // `ANIMATION_OVERRIDES[entry.id]` as Tier 0 before the 3-tier
    // auto-resolver — necessary for the rare critter that ships
    // ambiguous clip names the heuristic can't disambiguate.
    if (animations.length > 0) {
      this.skeletal = new SkeletalAnimator(group, animations, entry.id);
      this.skeletal.play('idle');

      // Re-measure the bbox once the idle clip has had a moment to pose
      // the skeleton. Bind pose is often the T-pose or a neutral export
      // frame that doesn't match the silhouette players actually see —
      // Mixamo idles commonly shift the spine by 5-10cm, Tripo idles can
      // compress a mesh by 15% on the first keyframe. Using the idle-
      // pose height for the in-game fit means all critters land at the
      // same APPARENT height in both the selector and the arena, not the
      // same "bind" height (which can be wildly off).
      this.skeletal.update(0.033); // ~1 frame at 30fps
      group.updateMatrixWorld(true);
      const idleBbox = new THREE.Box3().setFromObject(group);
      if (!idleBbox.isEmpty()) {
        const idleHeight = idleBbox.max.y - idleBbox.min.y;
        if (idleHeight > 0.1) measuredHeight = idleHeight;
      }
      this.bindPoseHeight = measuredHeight > 0.1 ? measuredHeight : null;
    }

    // In-game auto-fit: unify silhouette height across the roster so
    // Sergei (Meshy scale 0.66) doesn't read "giant" next to Kowalski
    // (Tripo scale 2.5 on a shorter mesh) and vice-versa. Mirrors the
    // character-select preview's fitWrapper pattern so the selector and
    // the arena read the same size.
    //
    // VISUAL ONLY — physics (`physicsRadius`, mesh position, headbutt
    // cone) lives on `this.mesh`, not the inner `group`, so scaling the
    // group doesn't affect hitboxes, knockback, or collision resolution.
    // Feel stays tied to mass/speed; silhouette is normalised independent.
    if (measuredHeight > 0.1) {
      const k = IN_GAME_TARGET_HEIGHT / measuredHeight;
      group.scale.multiplyScalar(k);
      this.bindPoseHeight = IN_GAME_TARGET_HEIGHT;
    }

    if (animations.length > 0) {
      console.debug(
        '[Critter] skeletal animator attached:',
        this.config.name,
        '| clips:',
        this.skeletal?.availableClipNames.join(', '),
        '| idle-pose height (pre-fit):',
        measuredHeight.toFixed(3),
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

    // Ability cast edges — play the corresponding clip exactly once
    // on the rising edge. If `cancelAnimOnEnd` is set on the def, also
    // detect the FALLING edge (state.active flipped from true to false)
    // and force-play the appropriate idle/run state so the heavy clip
    // doesn't tail past the gameplay window. This matters most for K
    // abilities whose authored clip is much longer than the actual
    // slam window (Trunk's Earthquake clip is 1.5 s at 2.8×, the
    // gameplay slam ends after ~0.65 s — without this cancel the
    // elephant kept swinging in the air for almost a second after
    // the effect was already done).
    for (let i = 0; i < this.abilityStates.length && i < 3; i++) {
      const state = this.abilityStates[i];
      const active = state.active;
      const prev = this.lastAbilityActive[i];
      const slotState: SkeletalState = (['ability_1', 'ability_2', 'ability_3'] as const)[i];
      if (active && !prev) {
        this.skeletal.play(slotState, {
          timeScale: state.def.clipPlaybackRate ?? 1,
        });
      } else if (!active && prev && state.def.cancelAnimOnEnd) {
        const vMag = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
        const moving = vMag > FEEL.movement.velocityDeadZone * 2;
        this.skeletal.play(moving ? 'run' : 'idle');
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
