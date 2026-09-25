import * as THREE from 'three';
import { cancelAbility, cancelSebastianAllInCharge, createAbilityStates, getSpeedMultiplier, getMassMultiplier, getKnockbackTakenMultiplier, getFrictionMultiplier, getZoneSlowMultiplier, isInsideZoneOfKind, getSlipperyZone } from './abilities-runtime';
import type { AbilityState } from './abilities';
import { updateScaleFeedback, updateKnockbackTilt, updateHeadbuttRecovery, applyHeadbuttRecovery, tickHitFlash, updateYankVisual, cancelYankVisual, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { getRosterEntry, type RosterEntry } from './roster';
import { loadModelWithAnimations } from './model-loader';
import { SkeletalAnimator, type SkeletalState } from './critter-skeletal';
import { createCritterParts } from './critter-parts';
import { deriveAnimationPersonality, tickProceduralAnimation, runPlaybackRate, runShare, resetAccents, type AnimationPersonality } from './critter-animation';
import { deriveCritterStats } from './pws-stats';
import { measurePosedBox } from './posed-bounds';
import { attachOutline, normalizeCritterMaterials, setOutlineVisible, type CritterOutline } from './critter-look';
import { removeDecoy, tickDecoy } from './abilities-vfx';

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
    // 2026-04-29 final-K (Rafa: "más potencia headbutt"): 1.15 → 1.40.
    headbuttBoost: 1.40,
    role: 'Balanced',
    tagline: 'Strong and agile. No weakness.',
  },
  {
    ...deriveCritterStats('Trunk'),
    name: 'Trunk', color: 0x8c8c8c,
    // 2026-05-01 final block + micropasses — Trunk fantasy stays
    // (speed ×2, cabezazo amplio, Slam wide). Acumulado:
    //   headbuttBoost 3.0 → 2.55 (-15 %, micropass 1)
    //                   2.55 → 2.30 (-10 %, micropass 2)
    // K + L stuns recortados en abilities.ts en proporción similar.
    // Speed 16 y headbuttForce 48 sin tocar — el cabezazo se modula
    // vía boost y la sensación de "elefante que persigue" se preserva.
    // 2026-08-21 balance v2 (micropass 3, decisión de Rafa): boost
    // 2.30 → 1.0. Con el boost tasado en el presupuesto, la fuerza
    // efectiva era 110.4 (+50 pts cuando el roster vive en 0..+5).
    // A 48 sigue doblando al segundo más fuerte — elefante intacto.
    speed: 16,
    headbuttForce: 48,
    role: 'Bruiser',
    tagline: 'Huge and unstoppable.',
  },
  { // Trickster — fast, light, evasive. Uses Frenzy as ult.
    ...deriveCritterStats('Kurama'),
    name: 'Kurama', color: 0xff6633,
    // 2026-08-21 balance v2 (audit: 74 headbutts/partida para 2 wins —
    // mucho ruido, poco premio): algo más de castigo por golpe.
    headbuttBoost: 1.15,
    role: 'Trickster',
    tagline: 'Fast, sly, unpredictable.',
  },
  { // Tank — slow, heavy, crushing. Uses Frenzy as ult (berserk).
    ...deriveCritterStats('Shelly'),
    name: 'Shelly', color: 0x2d8659,
    // 2026-08-21 balance v2 (audit: 0/6 wins, 2.6 caídas/p): el tanque
    // que no devolvía el golpe. Boost dentro del cap 1.0-1.5 del marco.
    headbuttBoost: 1.30,
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
export const IN_GAME_TARGET_HEIGHT = 1.7;

export class Critter {
  mesh: THREE.Group;
  config: CritterConfig;

  vx = 0;
  vz = 0;
  alive = true;
  hasInput = false;
  /** Acceleration (u/s²) the controller pushed this frame — written by
   *  player.ts / bot.ts. The dead zone uses it to tell a real push from
   *  stick drift or a rooted critter (see update()). */
  moveAccel = 0;
  /** Direction the controller pushed this frame (any length; 0,0 = none)
   *  — written by player.ts / bot.ts. The facing follows the velocity only
   *  while it goes this way (see update()). */
  moveX = 0;
  moveZ = 0;
  /** Fraction of a player's acceleration this critter's controller uses:
   *  1 for a player, FEEL.bots.moveAccelFactor for an offline bot
   *  (written by bot.ts). Presentation only — the run pose normalises by
   *  the critter's REAL top speed, and a bot's is lower. */
  pace = 1;
  /** Ground speed actually covered (u/s) — what the legs should match.
   *  Measured from position deltas, so it is right offline (where the
   *  position moves BEFORE friction, ×1.155 the stored |v| at 60 Hz) and
   *  online (where the position arrives in server patches, and is smoothed
   *  to absorb their jumps). */
  groundSpeed = 0;
  /** Ground velocity (u/s) behind `groundSpeed`. */
  groundVX = 0;
  groundVZ = 0;
  /** Run share of the locomotion pose (0 idle … 1 run), eased. */
  private locoShare = 0;
  private groundX = NaN;
  private groundZ = NaN;
  /** Visual-only pivot between `mesh` (gameplay facing) and `glbMesh`.
   *  Its yaw lags the facing so the model turns over ~80 ms instead of
   *  snapping 180° in one frame (see critter-animation tickTurn). */
  visualPivot: THREE.Group | null = null;
  /** Visual-only rig between `mesh` and `visualPivot`: whole-model
   *  reactions (the knockback lean, gamefeel updateKnockbackTilt) turn it
   *  about the feet without fighting the clips, the procedural layer or
   *  the turn lag, which own the transforms below it. */
  reactionRig: THREE.Group | null = null;
  /** Yaw (rad) the model still trails the gameplay facing by. */
  visualYawLag = 0;
  /** Facing seen last frame, to catch the jumps the lag absorbs. NaN =
   *  not seen yet (the next frame adopts the facing without lag). */
  lastFacingY = NaN;
  lives = FEEL.lives.default;
  immunityTimer = 0;
  /** v0.11 — Kurama Mirror Trick: while > 0 the GLB mesh is
   *  rendered at FEEL.decoy.ghostAlpha ("ghost"; Sihans' burrow: 0).
   *  Independent of immunityTimer, and drawn over the immunity blink
   *  in updateVisuals. Decremented per update(dt). */
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
  /** Stun + vulnerable (Trunk Grip L, Trunk Slam K). While > 0 the
   *  critter cannot move (effectiveSpeed → 0) nor act: no headbutt,
   *  J, K, L or All-in charge starts (2026-09-24, Rafa), and a charge
   *  it was holding drops unreleased (abilities-runtime `stun`). Any
   *  knockback it receives is × FEEL.collision.stunnedVulnerability.
   *  Mirror of `PlayerSchema.stunTimer`. */
  stunTimer = 0;
  /** 2026-04-30 — Kermit Toxic Touch confused state. While > 0
   *  the local cliente inverts the movement input axes for this
   *  critter. Mirror of `PlayerSchema.confusedTimer`. Decremented
   *  in update(dt). */
  confusedTimer = 0;
  /** 2026-04-30 — Kurama Copycat last-hit target (critter name).
   *  Set by physics.resolveCollisions on a successful headbutt
   *  hit; consumed by Kurama L Copycat at fire time. */
  lastHitTargetCritter = '';
  /** 2026-05-01 final block — Sebastian hold-to-fire L charging
   *  state. While `lHoldCharging` is true the player is rooted
   *  (effectiveSpeed → 0), the move input aims the facing and the
   *  trajectory preview is painted on the ground along it. Set on
   *  press of the L input, cleared on release (where the dash
   *  actually fires, once holdToFireMinMs has passed). */
  lHoldCharging = false;
  lHoldChargeTime = 0;
  /** 2026-04-29 — local-only fog-of-war fade. Set by the Kermit
   *  Poison Cloud overlay driver each frame: when the local critter
   *  is inside the cloud and THIS critter is outside it, fadeAlpha
   *  is dialled to a low value (0.10) so the affected viewer can
   *  barely see them. Reset to null when the local critter exits
   *  the cloud. */
  fadeAlpha: number | null = null;
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
   * Base Y rotation applied to `glbMesh` at attach (mirror of
   * `rosterEntry.rotation`). Cached so Shelly's Saw Shell L can spin
   * the mesh and then restore the original facing without snapping
   * to 0 — which is wrong for Tripo critters (all 5 of them ship
   * with rotation: -π/2 because the source export faces +X). 0 for
   * procedural-only critters and for any critter that hasn't loaded
   * its GLB yet. Set inside attachGlbMesh.
   */
  private baseGlbRotationY = 0;
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

  /** Cartoon outline hulls (critter-look.ts), children of each GLB mesh —
   *  so hiding or scaling a part (Shelly's shell, Trunk's nose) takes its
   *  outline along. Null until the GLB attaches. */
  private outline: CritterOutline | null = null;

  /** Height of the GLB in BIND POSE world space, measured once at
   *  attach. Used by the character-select preview to apply a uniform
   *  scale synchronously (no pop), independent of idle-clip wiggle.
   *  Null until the async GLB load completes; 0 for procedural-only
   *  critters that have no GLB. */
  bindPoseHeight: number | null = null;

  /**
   * Uniform factor that makes the GLB's idle silhouette exactly
   * `IN_GAME_TARGET_HEIGHT` tall — the same height for the nine (Rafa,
   * 2026-09-21). Measured once at attach; `tickProceduralAnimation`
   * multiplies the roster (or lab-override) scale by it every frame.
   * Until then the procedural layer wrote the bare roster scale and
   * undid the fit at "GO!" (Trunk +64 %, Sebastian −21 %). 1 until the
   * GLB attaches.
   */
  glbFitFactor = 1;

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

  /** Bumped by markTeleported. Read by the fixed-step renderer only. */
  teleportSerial = 0;

  /** The sim moved this critter by assignment, not by velocity (blink,
   *  yank, respawn): the renderer draws it at the new spot instead of
   *  sliding it between the two sim poses (src/fixed-step.ts). */
  markTeleported(): void {
    this.teleportSerial++;
  }
  get radius(): number { return this.rosterEntry?.physicsRadius ?? HEAD_RADIUS; }

  get isImmune(): boolean {
    return this.immunityTimer > 0;
  }

  get effectiveSpeed(): number {
    // Stun (Trunk Grip K) overrides everything: rooted, can't move.
    if (this.stunTimer > 0) return 0;
    // 2026-05-01 final block — Sebastian holding the L to charge
    // the All-in dash is rooted while he aims. Released → dash
    // fires and this flag clears.
    if (this.lHoldCharging) return 0;
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

  /** × on every push this critter takes from others (Sergei's Frenzy:
   *  0.4) — the one point all knockback goes through: physics.ts
   *  collisions, the K / L effects in abilities-runtime.ts and the
   *  snowball (not the Grip, which brings him all the way). See
   *  AbilityDef.knockbackTakenMult. Server mirror:
   *  knockbackScale in server/src/sim/abilities.ts. */
  get knockbackScale(): number {
    return getKnockbackTakenMultiplier(this.abilityStates);
  }

  /** × on this critter's friction half-life from its own abilities (Ice
   *  Slide glides: AbilityDef.slideFrictionMult). Server mirror:
   *  frictionScale in server/src/sim/abilities.ts, read by BrawlRoom's
   *  integrate step. */
  get frictionScale(): number {
    return getFrictionMultiplier(this.abilityStates);
  }

  startHeadbutt(): void {
    if (this.headbuttCooldown > 0 || this.isHeadbutting || this.headbuttAnticipating || this.isImmune) return;
    // Stunned: no action starts. Server: BrawlRoom's headbutt trigger has
    // the same gate (since v1.9).
    if (this.stunTimer > 0) return;
    this.headbuttAnticipating = true;
    this.anticipationTimer = FEEL.headbutt.anticipation.duration;
    // Skeletal hook — if the critter has a wind-up clip, fire it now.
    // fallback: lunge clip takes over when anticip finishes (see update()).
    this.playSkeletal('headbutt_anticip', { fallback: 'headbutt_lunge' });
  }

  /**
   * One step and one frame at once: online (the server simulated; only the
   * per-step observers and the presentation run), the character preview,
   * animlab, calibrate, and Game.update (the lab, online). The offline live
   * loop calls simulate() per fixed step and present() per frame instead
   * (src/fixed-step.ts).
   */
  update(dt: number): void {
    this.simulate(dt);
    this.present(dt);
  }

  /**
   * One fixed step of this critter's gameplay (offline): timers, the
   * headbutt state machine, integration, friction, dead zone, speed cap and
   * facing; then the per-step observers. The skeletal play() calls in here
   * are presentation EVENTS the sim raises and never reads back. Online the
   * server is authoritative (position, velocity, flags are set from the
   * network state before this): only the observers run.
   */
  simulate(dt: number): void {
    if (this.skipPhysics) {
      this.observeStep(dt);
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
    // 2026-04-29 — Trunk Grip stun + vulnerable countdown.
    if (this.stunTimer > 0) this.stunTimer = Math.max(0, this.stunTimer - dt);
    // 2026-04-30 — Kermit Toxic Touch confused countdown.
    if (this.confusedTimer > 0) this.confusedTimer = Math.max(0, this.confusedTimer - dt);

    // Headbutt cooldown
    if (this.headbuttCooldown > 0) this.headbuttCooldown -= dt;

    // Headbutt anticipation phase (brief wind-up). The head pose is
    // presentation (applyHeadbuttPose).
    if (this.headbuttAnticipating) {
      this.anticipationTimer -= dt;
      if (this.anticipationTimer <= 0) {
        this.headbuttAnticipating = false;
        this.isHeadbutting = true;
        this.headbuttTimer = FEEL.headbutt.lunge.duration;
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

    // Friction: faster decay when no input (stops drift), normal decay
    // with input. 2026-04-30 final-L — slippery zones (Kowalski Frozen
    // Floor) multiply the half-life by the ice's `frictionMult`, so
    // velocity decays slower and the critter slides. So does a gliding
    // dash of its own (Ice Slide: frictionScale). Server: BrawlRoom's
    // integrate step, same order, both factors.
    let halfLife = this.hasInput ? FEEL.movement.frictionHalfLife : FEEL.movement.idleFrictionHalfLife;
    const ice = getSlipperyZone(this.x, this.z, this.config.name);
    if (ice) halfLife *= ice.frictionMult;
    halfLife *= this.frictionScale;
    const friction = Math.pow(0.5, dt / halfLife);
    this.vx *= friction;
    this.vz *= friction;

    // Dead zone: kill micro-drift (exponential decay never reaches true zero)
    // — only when coasting. With input held it zeroed the very velocity
    // the critter was building: at high refresh rates one frame's
    // acceleration stays under the threshold, so Shelly could not start
    // moving at ≥120 Hz, Sergei at ≥144 Hz, and the Shelly bot not even
    // at 60 Hz (docs/FEELING.md §7.4). "Coasting" also covers a push too
    // weak to ever clear the dead zone even at terminal velocity (a
    // gamepad stick drifting just past its own dead zone, a rooted or
    // stunned critter) — frame-rate independent, unlike the old test.
    const speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    const pushTerminal = (this.moveAccel * halfLife) / Math.LN2;
    const coasting = !this.hasInput || pushTerminal < FEEL.movement.velocityDeadZone;
    if (coasting && speed < FEEL.movement.velocityDeadZone) {
      this.vx = 0;
      this.vz = 0;
    } else if (speed > FEEL.movement.maxSpeed) {
      // Velocity cap
      this.vx = (this.vx / speed) * FEEL.movement.maxSpeed;
      this.vz = (this.vz / speed) * FEEL.movement.maxSpeed;
    }

    // Face the way the critter is moving ITSELF: the velocity, while it
    // goes where the controller pushes. A shove (knockback, the recoil of
    // its own headbutt, a pull) never turns it round — it used to spin
    // 180° in mid-flight, turn its back on whoever hit it and fire its next
    // headbutt the wrong way (FEELING §7.10). Coasting keeps the facing.
    // Charging the All-in, the aim owns the facing (advanceAllInCharge).
    // Mirror: BrawlRoom's integrate step, charging exception included.
    if (!this.lHoldCharging && (Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1) &&
        this.hasInput && this.vx * this.moveX + this.vz * this.moveZ > 0) {
      this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    }

    this.observeStep(dt);
  }

  /**
   * Presentation bookkeeping that must see EVERY step, even when a frame
   * runs 0 or several: the per-match stat edges, the ground velocity (the
   * position delta over the step — exact and frame-rate independent; it
   * drives the legs' cadence and the idle/run blend) and the ability-clip
   * edges (a window shorter than a frame would be missed per frame, and
   * cancelActiveAbilities resets their memory from the sim). Nothing in
   * the sim reads any of it.
   */
  private observeStep(dt: number): void {
    this.tickMatchStats();
    this.trackGroundSpeed(dt);
    this.tickAbilityClipEdges();
  }

  /**
   * Once per rendered frame: saw spin, headbutt head pose (offline),
   * skeleton, procedural pose, glow, feedback, decoy. `dt`: game time shown
   * since the last call (0 holds everything still). Runs inside the
   * pose.apply / restore window, so position reads get the drawn pose; it
   * must never write mesh.position (restore would undo it) nor anything the
   * sim reads.
   */
  present(dt: number): void {
    // Online too: the saw reads the L's active / windUpLeft, which
    // Game.updateOnline copies from the server before this runs.
    this.tickSawSpin(dt);
    // Offline only: the head comes back through applyHeadbuttRecovery,
    // which simulate()'s headbutt state machine raises and online never
    // runs, so the head would stay thrust out.
    if (!this.skipPhysics) this.applyHeadbuttPose();

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
    this.tickFeedback(dt);
    // Mirror Trick decoy: its life is game time, like everything here.
    tickDecoy(this, dt);
  }

  /**
   * Shelly's Saw Shell spin. While the frenzy slot (index 2) is active and
   * `sawL` is set, rotate the GLB sub-group rapidly on its Y axis. We rotate
   * the inner glbMesh (not the outer this.mesh) because this.mesh's
   * rotation.y is owned by the movement system (it follows velocity each
   * step). The glbMesh is a child group so the visual spin composes on top
   * without fighting the facing logic.
   *
   * 2026-04-29 hot-fix — gate to Shelly only AND reset to the cached
   * `baseGlbRotationY` (not 0). Earlier draft of this block ran for every
   * critter and reset to 0 every frame, which destroyed the entry.rotation
   * set in attachGlbMesh (Tripo critters ship with rotation: -π/2) —
   * Sergei, Shelly, Kermit, Kowalski and Cheeto were all rendering at the
   * wrong angle as a result.
   *
   * Online the flags are the server's and `def` is the client's kit, so the
   * spin follows the server's saw window (since 2026-09-25). A Copycat
   * Kurama carrying the saw doesn't spin: offline the name gate stops her,
   * and online the client never builds the copy (applyCopycat runs offline
   * only), so dropping the gate alone would spin her offline only.
   */
  private tickSawSpin(dt: number): void {
    if (this.config.name !== 'Shelly' || !this.glbMesh) return;
    const lState = this.abilityStates[2];
    if (lState?.active && lState.windUpLeft <= 0 && lState.def.sawL) {
      const rate = lState.def.sawSpinSpeed ?? 22;
      this.glbMesh.rotation.y += rate * dt;
    } else if (this.glbMesh.rotation.y !== this.baseGlbRotationY) {
      this.glbMesh.rotation.y = this.baseGlbRotationY;
    }
  }

  /** Head pulled back in the headbutt wind-up, thrust out in the lunge. */
  private applyHeadbuttPose(): void {
    if (this.headbuttAnticipating) this.head.position.z = FEEL.headbutt.anticipation.headRetract;
    else if (this.isHeadbutting) this.head.position.z = FEEL.headbutt.lunge.headExtend;
  }

  /** Game feel visual systems (visual-only, no gameplay logic). Runs AFTER
   *  updateVisuals: the hit flash overrides the state emissive briefly. */
  private tickFeedback(dt: number): void {
    const flashT = tickHitFlash(this, dt);
    if (flashT > 0) {
      for (const mat of this.getActiveMaterials()) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = flashT * 1.2;
      }
    }
    updateScaleFeedback(this, dt);
    updateKnockbackTilt(this, dt);
    updateYankVisual(this, dt);
    updateHeadbuttRecovery(this, dt);
  }

  /** Put the first frame of a just-applied impact on screen now. The hit
   *  stop freezes the game on the frame the blow lands, before this
   *  critter's next present(), so without this the freeze shows the victim
   *  untouched and the squash, flash and lean only start once time
   *  resumes. */
  showImpactFrame(): void {
    this.tickFeedback(0);
  }

  /** Visual-only: updates emissive, posture, and opacity based on current state. No gameplay logic. */
  private updateVisuals(): void {
    const G = FEEL.stateGlow;
    // A flag, not "colour differs from the critter's own": a def colour
    // equal to it must still glow.
    let glowing = false;
    let glowColor = 0x000000;
    let glowIntensity = 0;
    let bodyScaleY = 1.0;
    let headOffsetY = 0; // additional Y offset for head during states
    const glow = (hex: number, intensity: number): void => {
      glowing = true;
      glowColor = hex;
      glowIntensity = intensity;
    };

    // --- Headbutt states --- (not while falling: a fall freezes the flags
    // until the respawn clears them, here and on the server)
    if (!this.falling && this.headbuttAnticipating) {
      glow(G.headbuttWindUp.hex, G.headbuttWindUp.intensity);
    } else if (!this.falling && this.isHeadbutting) {
      glow(G.headbutt.hex, G.headbutt.intensity);
    }

    // --- Ability states (a def's own colours over FEEL.stateGlow) ---
    for (const s of this.abilityStates) {
      if (!s.active) continue;
      const def = s.def;
      const windingUp = s.windUpLeft > 0;

      if (def.type === 'charge_rush') {
        glow(def.activeGlowHex ?? G.dash.hex, def.activeGlowIntensity ?? G.dash.intensity);
        headOffsetY = -0.08;
      } else if (def.type === 'ground_pound') {
        if (windingUp) {
          bodyScaleY = FEEL.groundPound.windUpSquash;
          headOffsetY = FEEL.groundPound.windUpHeadDrop;
          glow(def.windUpGlowHex ?? G.kWindUp.hex, G.kWindUp.intensity);
        } else if (!def.selfBuffOnly) {
          // A self-buff K (Steel Shell, Mirror Trick) slams nothing: its
          // look is the tint or the ghost below, not the slam's red.
          glow(def.activeGlowHex ?? G.kActive.hex, def.activeGlowIntensity ?? G.kActive.intensity);
        }
      } else if (def.type === 'frenzy') {
        if (windingUp) {
          glow(def.windUpGlowHex ?? G.lWindUp.hex, pulsedGlow(G.lWindUp, G.lWindUp.intensity));
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
          glow(flicker > 0 ? 0xaa00ff : 0xff44cc, 0.9 + swing * 0.4);
          // Slight body scale pulse for "charging hypnosis"
          bodyScaleY = 1.0 + swing * 0.08;
        } else {
          // The L's pulse: red by default, the def's colour (Saw Shell
          // green, Frozen Floor ice, Sinkhole sand) when it has one.
          glow(def.activeGlowHex ?? G.lActive.hex, pulsedGlow(G.lActive, def.activeGlowIntensity ?? G.lActive.intensity));
        }
      } else if (windingUp && def.windUpGlowHex !== undefined) {
        // Projectile or blink: no wind-up glow of its own, only the def's
        // (Kowalski's snowball charging in ice blue).
        glow(def.windUpGlowHex, G.kWindUp.intensity);
      }
    }

    // --- Cooldown visual (muted) ---
    if (this.headbuttCooldown > 0 && !this.isHeadbutting && !this.headbuttAnticipating) {
      glowIntensity *= G.cooldownDim;
    }

    // --- Apply to active materials (GLB or procedural) ---
    const mats = this.getActiveMaterials();
    for (const mat of mats) {
      mat.emissive.setHex(glowing ? glowColor : 0x000000);
      mat.emissiveIntensity = glowing ? glowIntensity : 0;
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
    // The outline hides whenever the critter goes see-through (dim blink
    // frame, invisibility, fog fade): a solid contour around a ghost reads
    // as a hole.
    let translucent = this.fadeAlpha !== null;
    // Immunity a self-buff K grants (Steel Shell, Mirror Trick) is a
    // stance the critter chose, not a respawn: it keeps its own look
    // (tint, ghost). The respawn blink made the steel shell read as
    // intangible — the opposite of a wall you bounce off.
    const selfBuff = this.abilityStates.some((s) => s.active && s.windUpLeft <= 0 && s.def.selfBuffOnly);
    // Nor while falling: a fall cancels the self-buff but not the immunity
    // it granted, and the drop blinked "invulnerable" at 15 % opacity.
    if (this.invisibilityTimer > 0) {
      // v0.11 — Kurama Mirror Trick. Mesh ghosted while the decoy
      // tricks bots and other players.
      // 2026-04-29 K-session — Sihans Burrow Rush reuses the same
      // timer but collapses to alpha 0 (totally underground) for
      // its short 0.30 s window.
      // 2026-05-01 microfix (Rafa: "Kurama original debe estar
      // invisible o casi invisible mientras dura el clon"): alpha
      // dropped 0.25 → 0.08 (FEEL.decoy.ghostAlpha). Still leaves a
      // faint silhouette so a very attentive player can spot her if
      // they really look, but at glance the decoy is the only Kurama
      // on screen.
      // Checked BEFORE the immunity blink: Mirror Trick writes both
      // timers, and until 2026-09-24 the blink won, so the ghost was
      // never drawn (Kurama blinked white and opaque instead).
      const ghostAlpha = this.config.name === 'Sihans' ? 0.0 : FEEL.decoy.ghostAlpha;
      translucent = true;
      for (const mat of mats) {
        mat.transparent = true;
        mat.opacity = ghostAlpha;
        mat.depthWrite = false;
      }
    } else if (this.immunityTimer > 0 && !selfBuff && !this.falling) {
      const phase = (Date.now() * 0.001 * FEEL.lives.blinkRate) % 1;
      const visible = phase < 0.5;
      if (!visible) translucent = true;
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
    // freeze (cyan) or shells. Self-skip by zone owner, as the slow
    // itself does: the caster inside its own sand (Sihans, or a Kurama
    // that copied the Sinkhole) keeps its normal look and stays
    // distinguishable. Snowball freeze takes priority because slow
    // is more severe (50 %) than the quicksand 50 %, but both
    // happen rarely enough simultaneously that the cyan-over-amber
    // collision is acceptable.
    if (this.slowTimer === 0 &&
        getZoneSlowMultiplier(this.x, this.z, this.config.name) < 1 &&
        isInsideZoneOfKind(this.x, this.z, 'sand', this.config.name)) {
      const pulse = 0.50 + 0.30 * Math.sin(Date.now() * 0.006);
      for (const mat of mats) {
        mat.emissive.setHex(0xb98c54);
        mat.emissiveIntensity = pulse;
      }
    }
    // 2026-04-29 final-K — local fog-of-war fade for Kermit
    // Poison Cloud. When the local viewer is inside the cloud and
    // THIS critter is outside it, the per-frame driver sets
    // `fadeAlpha` low (~0.10) so the affected viewer can barely
    // see them. Pure local visual; doesn't affect other clients
    // and doesn't interact with knockback/collision.
    if (this.fadeAlpha !== null) {
      for (const mat of mats) {
        mat.transparent = true;
        mat.opacity = this.fadeAlpha;
        mat.depthWrite = false;
      }
    }
    setOutlineVisible(this.outline, !translucent);
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
    // XZY: the roster yaw is applied FIRST (innermost), then roll (z) and
    // pitch (x) about the critter's own axes. With the default XYZ, the
    // procedural sway on a rig turned -90° (the Tripo ones) rolled about
    // the model's z — which after the yaw is the lateral axis, so the
    // "side sway" was really a forward nod.
    group.rotation.order = 'XZY';
    group.rotation.y = entry.rotation;
    this.baseGlbRotationY = entry.rotation;
    group.position.set(...entry.offset);
    group.position.y += entry.pivotY;

    // Opaque, non-metallic, no emissive map (critter-look, shared with the
    // slot thumbnails). updateVisuals owns emissive and transparency from
    // here on.
    normalizeCritterMaterials(group);

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

    // The GLB hangs from a visual pivot so its yaw can trail the gameplay
    // facing (mesh.rotation.y, which headbutts and abilities fire along)
    // without touching it. World transforms of glbMesh include the pivot,
    // so anything that snapshots them (Kurama's decoy) copies what is seen.
    // Above the pivot sits the reaction rig (mesh → rig → pivot → GLB).
    const rig = new THREE.Group();
    const pivot = new THREE.Group();
    this.mesh.add(rig);
    rig.add(pivot);
    pivot.add(group);
    this.reactionRig = rig;
    this.visualPivot = pivot;
    this.visualYawLag = 0;
    this.lastFacingY = NaN;
    this.glbMesh = group;

    // Measure bind-pose silhouette FIRST, before the mixer touches the
    // skeleton. Used as the baseline for the sync auto-fit in the
    // preview (so swaps are pop-free — we don't wait for the idle clip
    // to tick before we know how big the critter is).
    let measuredHeight = measurePosedHeight(group);
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
      const idleHeight = measurePosedHeight(group);
      if (idleHeight > 0.1) measuredHeight = idleHeight;
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
      this.glbFitFactor = k;
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

    // Cartoon outline (critter-look.ts). Last on purpose: the height fit
    // and the parts index above must not see the hulls.
    this.outline = attachOutline(group);

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
   * Edge-detection memory for ability cast events, so
   * `tickAbilityClipEdges` can fire a `playSkeletal('ability_N')` exactly
   * once on the rising edge of each ability's `active` flag.
   */
  private lastAbilityActive: boolean[] = [false, false, false];

  /*
   * The skeletal layer: `tickAbilityClipEdges` (per step, observeStep)
   * fires ability_1 / ability_2 / ability_3 on the rising edge of each
   * ability's `active` flag; `tickSkeletal` (per frame, present(), before
   * procedural) auto-drives idle / run from the current velocity and
   * advances the mixer. Auto-logic is conservative:
   *   - Does nothing if the critter has no skeletal animator.
   *   - Skips idle/run switching while a HEAVY state is active (victory,
   *     defeat, ability, headbutt_lunge, fall, hit) — those clips own
   *     the pose.
   *   - Skips idle/run while headbutt anticip/lunge flags are set, so
   *     the pose stays crisp.
   */
  /**
   * Advance per-match counters by edge-detecting state transitions.
   * Called once per step (observeStep) in BOTH offline and online paths —
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

  /** Per step (observeStep): the ability clips' edges. */
  private tickAbilityClipEdges(): void {
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
        // Undefined unless the def sets a rate, so the clip's
        // ANIMATION_OVERRIDES speed (what anim-lab tunes) applies. A
        // `?? 1` here overrode it from 47728db to 2026-09-24: every
        // ability clip without clipPlaybackRate ran at 1× in a match.
        this.skeletal.play(slotState, {
          timeScale: state.def.clipPlaybackRate,
        });
      } else if (!active && prev && state.def.cancelAnimOnEnd && this.skeletal.getCurrentState() === slotState) {
        // Only cut this slot's own clip: a J that ends (or is cancelled
        // by Steel Shell) under the K must not snap the K's pose to idle.
        const vMag = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
        const moving = vMag > FEEL.movement.velocityDeadZone * 2;
        this.skeletal.play(moving ? 'run' : 'idle');
      }
      this.lastAbilityActive[i] = active;
    }
  }

  /** Per frame (present): idle/run, the locomotion pose and the mixer. */
  private tickSkeletal(dt: number): void {
    if (!this.skeletal) return;

    // Movement-driven idle/run, only if nothing "heavier" is playing and
    // we're not in a headbutt pose window.
    const heavy = this.skeletal.isHeavyClipActive();
    const inHeadbuttPose = this.headbuttAnticipating || this.isHeadbutting;
    if (this.alive && !heavy && !inHeadbuttPose) {
      const vMag = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
      const moving = vMag > FEEL.movement.velocityDeadZone * 2;
      this.skeletal.play(moving ? 'run' : 'idle');
    }
    // Locomotion pose, every frame (also while a heavy clip fades in or
    // out): the run share and the legs' rate follow the ground covered
    // forwards, so the feet stay planted as the critter speeds up, brakes
    // or gets shoved. The share moves no faster than runBlendTime (a burst
    // of speed would flip the pose in one frame) and holds through the
    // headbutt pose (the lunge is a strike, not a run). Visual only — see
    // runShare / runPlaybackRate.
    const forward = Math.max(0, this.forwardGroundSpeed());
    if (!inHeadbuttPose) {
      const maxStep = dt / FEEL.locomotion.runBlendTime;
      this.locoShare += Math.max(-maxStep, Math.min(maxStep, runShare(forward) - this.locoShare));
    }
    this.skeletal.setLocomotion(this.locoShare, runPlaybackRate(this, forward));

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
    this.cancelActiveAbilities();
    playSound('fall');
    // Skeletal fall clip — kept until respawn (one-shot with defeat
    // fallback so if there's no fall clip but there is defeat, it still
    // reads as "going down" instead of idle during the drop).
    this.playSkeletal('fall', { fallback: 'defeat' });
  }

  /**
   * A fall ends everything in flight: active abilities (cooldown started
   * as if they had run out), the All-in charge and the buffs' visual
   * timers. Abilities don't tick while falling, so they used to resume at
   * the respawn point (Cone Pulse firing at the centre, a K pressed
   * mid-fall going off there, a bot's All-in resolving from the spawn).
   * Server mirror: `startFalling` in server/src/sim/physics.ts.
   */
  private cancelActiveAbilities(): void {
    for (const s of this.abilityStates) {
      if (s.active) cancelAbility(s);
    }
    cancelSebastianAllInCharge(this); // and its line
    this.invisibilityTimer = 0;
    this.selfTintTimer = 0;
    this.selfTintHex = null;
    // The trick is over: its decoy goes too.
    removeDecoy(this);
    // No end edge for the skeletal layer: a cancelled slot must not cut
    // the respawn clip on the first update after the fall.
    this.lastAbilityActive.fill(false);
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
    this.markTeleported();
    this.vx = 0;
    this.vz = 0;
    // Face the arena centre — same rule as initial spawn, so a respawned
    // critter never looks toward the void.
    this.mesh.rotation.y = Math.atan2(-x, -z);
    this.mesh.position.y = 0;
    this.resetVisualMotion();
    this.immunityTimer = FEEL.lives.immunityDuration;
    // Control statuses die with the life they were put on: no stun,
    // confusion or snowball slow carries over to the respawn (they were
    // frozen during the fall). Server mirror: BrawlRoom's respawn block.
    this.stunTimer = 0;
    this.confusedTimer = 0;
    this.slowTimer = 0;
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
    // No crossfade: a teleport, so the fall pose doesn't linger at the
    // spawn point.
    this.playSkeletal('respawn', { fallback: 'idle', crossfade: 0 });
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
    removeDecoy(this);
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
    this.visualPivot = null;
    this.reactionRig = null;
    this.glbMaterials = [];
  }

  /** A teleport (respawn, new match) is neither a run nor a turn: drop
   *  the ground-speed history, the turn lag, the accents and the root's
   *  lean and sway, so the model doesn't sprint in place, spin, lurch or
   *  straighten up on the spot when it reappears. */
  private resetVisualMotion(): void {
    this.groundSpeed = 0;
    this.groundVX = 0;
    this.groundVZ = 0;
    this.locoShare = 0;
    this.groundX = NaN;
    this.groundZ = NaN;
    this.visualYawLag = 0;
    // NaN = "take whatever facing the next frame has" — the caller may set
    // the spawn facing after this (reset() is followed by game placement).
    this.lastFacingY = NaN;
    if (this.visualPivot) this.visualPivot.rotation.y = 0;
    if (this.glbMesh) {
      this.glbMesh.rotation.x = 0;
      this.glbMesh.rotation.z = 0;
    }
    cancelYankVisual(this);
    resetAccents(this);
  }

  /** Ground velocity from the position delta of this step. Jumps faster
   *  than any run (respawn, blink, a late network patch) are not running
   *  and are skipped. Smoothed online only: there the position arrives in
   *  server patches; offline it is exact, and smoothing it only made the
   *  legs lag the body — the foot slid ~8 cm at every stop (FEELING §7.11).
   *  Visual only. */
  /** Sim time of the latest ground-speed sample (one per step offline, one
   *  per frame online): the accents differentiate the forward speed over
   *  it (critter-animation tickAccents) — over the time shown instead, a
   *  step every 2 or 3 frames at 144 Hz made the lean zig-zag. Visual
   *  only. */
  groundSampleTime = 0;

  private trackGroundSpeed(dt: number): void {
    if (dt <= 0) return;
    this.groundSampleTime += dt;
    if (Number.isFinite(this.groundX)) {
      const vx = (this.x - this.groundX) / dt;
      const vz = (this.z - this.groundZ) / dt;
      if (Math.hypot(vx, vz) <= FEEL.movement.maxSpeed * 1.5) {
        const k = this.skipPhysics ? Math.min(1, dt / FEEL.locomotion.groundSpeedSmoothing) : 1;
        this.groundVX += (vx - this.groundVX) * k;
        this.groundVZ += (vz - this.groundVZ) * k;
        this.groundSpeed = Math.hypot(this.groundVX, this.groundVZ);
      }
    }
    this.groundX = this.x;
    this.groundZ = this.z;
  }

  /** Ground speed along the way the MODEL faces (gameplay facing + turn
   *  lag). What the run pose should show: sliding backwards (a knockback
   *  while facing the hitter) or sideways is not running. */
  forwardGroundSpeed(): number {
    const yaw = this.mesh.rotation.y + (this.visualPivot?.rotation.y ?? 0);
    return this.groundVX * Math.sin(yaw) + this.groundVZ * Math.cos(yaw);
  }

  reset(x: number, z: number): void {
    this.alive = true;
    this.mesh.visible = true;
    this.x = x;
    this.z = z;
    this.markTeleported();
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
    this.resetVisualMotion();
  }
}

/** Intensity of a pulsing state glow (FEEL.stateGlow): `peak` × (floor +
 *  (1 − floor) × wave), the wave 0..1 at `pulseHz` on the wall clock, as
 *  every emissive pulse here. Visual only. */
function pulsedGlow(p: { floor: number; pulseHz: number }, peak: number): number {
  const wave = 0.5 + 0.5 * Math.sin(Date.now() * 0.001 * Math.PI * 2 * p.pulseHz);
  return peak * (p.floor + (1 - p.floor) * wave);
}

/** Vertices sampled per mesh by `measurePosedHeight` — plenty for a
 *  silhouette height, and cheap on the 100k-vertex Meshy rigs. */
const POSED_HEIGHT_SAMPLES = 4000;
const posedBox = new THREE.Box3();

/**
 * Height of `root`'s visible meshes in their CURRENT pose. Skinned
 * vertices go through the live bones (see `measurePosedBox`) —
 * `Box3.setFromObject` reuses a skinned mesh's cached bind-pose box, which
 * misjudged the idle silhouette by up to ~20 % (Kurama "fitted" to 1.7
 * stood 2.08 tall).
 */
function measurePosedHeight(root: THREE.Object3D): number {
  if (!measurePosedBox(root, posedBox, POSED_HEIGHT_SAMPLES)) return 0;
  return posedBox.max.y - posedBox.min.y;
}
