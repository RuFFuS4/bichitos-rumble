// ---------------------------------------------------------------------------
// Skeletal animation layer — Three.js AnimationMixer wrapper per critter
// ---------------------------------------------------------------------------
//
// Lives on TOP of the procedural layer (`critter-animation.ts`). When a
// critter's GLB ships with AnimationClips (Mixamo, Tripo Animate, etc.),
// this module:
//
//   1. Binds a per-instance AnimationMixer to the critter's cloned skeleton.
//   2. Resolves "logical states" (idle, run, victory, …) to actual clip
//      names via fuzzy keyword matching — so Mixamo's "Breathing Idle",
//      Tripo's "Animation_01_idle", and a handcrafted "idle" clip all
//      resolve to the same logical state without per-rig configuration.
//   3. Crossfades between states with a short 0.15s blend so swaps feel
//      smooth (not snap-cuts).
//   4. Plays loop states (idle, run) continuously and one-shot states
//      (headbutt_lunge, victory, ability_1, …) once, optionally falling
//      back to idle when the one-shot finishes.
//
// The procedural layer keeps running in parallel and remains responsible
// for:
//   - Root-level lean (rotation.x) when running
//   - Sway (rotation.z)
//   - Scale squash/stretch (charge_rush, headbutt, ground_pound crouch)
//   - Vertical bob (fallback when no idle clip is playing)
//
// When a "heavy" one-shot clip is active (victory, defeat, ability_1/2/3,
// headbutt_lunge, fall), the procedural layer SILENCES its root writes so
// the clip's pose reads cleanly. See `isHeavyClipActive()`.
//
// Works with arbitrary GLBs — if the critter has no clips, `SkeletalAnimator`
// is simply not instantiated and the procedural layer takes 100% of the
// presentation duty like before. Zero breakage for non-animated models.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getClipOverride } from './animation-overrides';

/**
 * Logical animation states the game can request. Not every GLB needs every
 * state — the resolver falls back gracefully (missing `idle` means "no
 * skeletal baseline", missing `victory` means "use defeat fallback or
 * nothing", etc.).
 */
export type SkeletalState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'headbutt_anticip'
  | 'headbutt_lunge'
  | 'ability_1'
  | 'ability_2'
  | 'ability_3'
  | 'victory'
  | 'defeat'
  | 'fall'
  | 'hit'
  | 'respawn';

/**
 * Keywords per state. First clip whose name (lowercased) contains any of
 * these substrings wins. Order within the array matters for ambiguous
 * cases — more specific keywords first.
 *
 * Mixamo default names use title case with spaces ("Breathing Idle",
 * "Victory Idle", "Standing Melee Attack Horizontal"). Tripo Animate uses
 * snake_case or Animation_NN. Both are covered.
 */
const STATE_KEYWORDS: Record<SkeletalState, string[]> = {
  idle:              ['idle', 'breathing', 'standing', 'breath'],
  walk:              ['walk'],
  run:               ['run', 'sprint', 'gallop'],
  headbutt_anticip:  ['anticip', 'windup', 'prepare', 'charge_up'],
  headbutt_lunge:    ['headbutt', 'head_butt', 'lunge', 'punch', 'strike', 'attack', 'melee'],
  ability_1:         ['ability1', 'ability_1', 'skill1', 'dash', 'charge', 'rush', 'leap', 'pounce'],
  ability_2:         ['ability2', 'ability_2', 'skill2', 'slam', 'special', 'grip', 'shield', 'cloud', 'tunnel', 'snowball', 'shadow_step', 'shadow', 'sweep', 'mirror'],
  ability_3:         ['ability3', 'ability_3', 'ultimate', 'ulti', 'frenzy', 'pound', 'mega', 'hypno', 'diggy', 'ice_age', 'tiger_roar', 'roar', 'crab_slash'],
  victory:           ['victory', 'win', 'celebrat', 'cheer', 'dance'],
  defeat:            ['defeat', 'lose', 'dying', 'death', 'ko', 'loss'],
  fall:              ['fall', 'drop', 'falling'],
  hit:               ['hit', 'damage', 'react', 'stagger', 'flinch'],
  respawn:           ['respawn', 'revive', 'spawn', 'appear'],
};

/**
 * Looping states play on repeat; one-shot states play once and (optionally)
 * return to idle. This shapes default Action config.
 */
const LOOPING_STATES = new Set<SkeletalState>(['idle', 'walk', 'run']);

/**
 * "Heavy" states suppress the procedural root motion so the clip's pose
 * reads clearly. Non-heavy states (idle, walk, run) coexist with
 * procedural lean/sway/scale.
 */
const HEAVY_STATES = new Set<SkeletalState>([
  'headbutt_lunge',
  'ability_1', 'ability_2', 'ability_3',
  'victory', 'defeat', 'fall',
  'hit',
]);

/** How long (seconds) a state swap takes to blend. Short but not snap. */
const DEFAULT_CROSSFADE = 0.15;

/**
 * How a logical state resolved to its clip. Used by the anim lab to show
 * WHY each state picked the clip it did.
 *
 *   'override'  — ANIMATION_OVERRIDES hit; clip chosen by hand.
 *   'exact'     — Tier 1 of findClipForState (exact name match).
 *   'prefix'    — Tier 2 (keyword at start of clip name).
 *   'contains'  — Tier 3 (keyword anywhere in clip name).
 *   'missing'   — no clip resolved.
 */
export type ResolveSource = 'override' | 'exact' | 'prefix' | 'contains' | 'missing';

export class SkeletalAnimator {
  private readonly mixer: THREE.AnimationMixer;
  /** Map from logical state → resolved Action (or null if no clip matched). */
  private readonly actions: Partial<Record<SkeletalState, THREE.AnimationAction>> = {};
  /** Map from logical state → how the clip was resolved. Exposed for the
   *  anim lab so we can show "override vs auto" per row. */
  private readonly resolveSources: Partial<Record<SkeletalState, ResolveSource>> = {};
  /** Which state is currently the "dominant" one being played. */
  private currentState: SkeletalState | null = null;
  /** If the current state is a one-shot, what to fall back to when it finishes. */
  private fallbackAfterOneShot: SkeletalState | null = null;
  /** Cached list of clip names for debug output. */
  readonly availableClipNames: string[];
  /** Raw clip list kept so the dev lab can play arbitrary clips by name,
   *  not just ones that resolved to a logical state. */
  private readonly clips: THREE.AnimationClip[];
  /** Lazy-created Actions keyed by exact clip name — for playClipByName. */
  private readonly clipActionsByName = new Map<string, THREE.AnimationAction>();
  /** True while /anim-lab.html is previewing a clip via playClipByName.
   *  Flips `isHeavyClipActive()` on so the procedural layer suppresses
   *  its `glbMesh.{position,rotation,scale}` writes — without this, the
   *  clip's bone pose mixes with idle bob + lean + squash stacked on the
   *  root, which is exactly the "movimientos raros" users see when
   *  previewing clips in the lab. Cleared by stopAll() and by the next
   *  play(state) call so the state machine regains full ownership. */
  private manualClipActive = false;
  /** Original loop / clampWhenFinished per AnimationAction touched by
   *  playClipByName. `mixer.clipAction(clip)` returns the SAME action
   *  instance the constructor cached in `this.actions[state]`, so mutating
   *  `loop` / `clampWhenFinished` in a preview silently re-configures the
   *  resolver's action. This map lets stopAll() / play() restore the
   *  shape the action had at construction, so the next `play('victory')`
   *  after a loop=true preview doesn't loop Victory forever. */
  private preservedActionConfig = new Map<
    THREE.AnimationAction,
    { loop: THREE.AnimationActionLoopStyles; clamp: boolean }
  >();
  /** Critter id (e.g. 'sergei', 'trunk') used to look up
   *  per-critter overrides in `animation-overrides.ts`. null when the
   *  animator is instantiated outside a roster context (tests, lab). */
  private readonly critterId: string | null;

  /**
   * @param root         the scene-graph node the mixer binds to.
   * @param clips        all AnimationClips attached to the GLB.
   * @param critterId    optional roster id (lowercase — 'sergei' etc.).
   *                     When supplied, `ANIMATION_OVERRIDES[critterId]`
   *                     is consulted first for each state (Tier 0). If
   *                     the override points to a clip that exists in
   *                     the GLB, it wins over the 3-tier resolver. If
   *                     the override is missing or points to a clip
   *                     not in this GLB, the resolver runs normally.
   */
  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], critterId: string | null = null) {
    this.mixer = new THREE.AnimationMixer(root);
    this.critterId = critterId;

    // Filter out clips where every track has zero variance — these are
    // bind-pose snapshots, commonly auto-generated when a Blender action
    // slot exists with no real keyframes. Playing one forces every bone
    // back to rest pose for the clip's duration, rendering as a T-pose
    // snap mid-gameplay (the symptom we hit on Sergei's first rigging
    // pass: Idle/Run animated, headbutt/abilities snapped to T-pose).
    // Dropping them lets the resolver fall back to "no clip" — the
    // current loop (idle/run) keeps playing instead of being clobbered.
    const liveClips: THREE.AnimationClip[] = [];
    const deadClipNames: string[] = [];
    for (const c of clips) {
      if (isClipEffectivelyStatic(c)) {
        deadClipNames.push(c.name);
      } else {
        liveClips.push(c);
      }
    }
    if (deadClipNames.length > 0) {
      console.debug(
        '[SkeletalAnimator] dropped',
        deadClipNames.length,
        'static (bind-pose) clip(s):',
        deadClipNames.join(', '),
      );
    }

    this.availableClipNames = liveClips.map(c => c.name);
    this.clips = liveClips;

    // Resolve each logical state to an actual clip.
    //
    // Priority:
    //   Tier 0 — per-critter override in animation-overrides.ts (only
    //            consulted when critterId is supplied + the override
    //            points to a clip name actually present in this GLB).
    //   Tier 1 — exact match on the state name after delimiter strip.
    //   Tier 2 — prefix match on a keyword (starts-with).
    //   Tier 3 — substring match (contains anywhere).
    //
    // The 3 tier fallback runs inside findClipForState. Tier 0 is
    // resolved here because it needs the critterId.
    //
    // Some states may end up unresolved → actions[state] === undefined.
    const states: SkeletalState[] = [
      'idle', 'walk', 'run',
      'headbutt_anticip', 'headbutt_lunge',
      'ability_1', 'ability_2', 'ability_3',
      'victory', 'defeat', 'fall', 'hit', 'respawn',
    ];
    for (const state of states) {
      let clip: THREE.AnimationClip | null = null;
      let source: ResolveSource = 'missing';

      const overrideName = getClipOverride(this.critterId, state);
      if (overrideName) {
        const found = liveClips.find(c => c.name === overrideName);
        if (found) {
          clip = found;
          source = 'override';
        } else {
          console.debug(
            `[SkeletalAnimator] override for ${this.critterId}.${state} points to`,
            `"${overrideName}" which is not in the GLB clip list — falling back to resolver.`,
          );
        }
      }

      if (!clip) {
        const result = findClipForStateTiered(liveClips, state);
        clip = result.clip;
        source = result.source;
      }

      if (!clip) {
        this.resolveSources[state] = 'missing';
        continue;
      }

      const action = this.mixer.clipAction(clip);
      if (!LOOPING_STATES.has(state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[state] = action;
      this.resolveSources[state] = source;
    }

    // Fire a fallback when one-shot actions end, so the critter doesn't
    // freeze in the final pose mid-match (the pose is fine on end-screen
    // via the clampWhenFinished flag above, which keeps it locked).
    this.mixer.addEventListener('finished', (e: THREE.Event & { action: THREE.AnimationAction; direction: number }) => {
      const finished = e.action;
      // Which state was this action? Reverse lookup.
      for (const [state, act] of Object.entries(this.actions)) {
        if (act === finished && this.fallbackAfterOneShot) {
          const fallback = this.fallbackAfterOneShot;
          this.fallbackAfterOneShot = null;
          // Only swap back if the finished action is still the current one.
          // If another play() already cut in, let that one be.
          if (this.currentState === (state as SkeletalState)) {
            this.play(fallback);
          }
          break;
        }
      }
    });
  }

  /**
   * Start (or crossfade to) a given logical state. If there's no clip for
   * that state, this is a silent no-op — callers can request any state
   * without guarding.
   *
   * @param state          logical animation state
   * @param fallback       after a one-shot finishes, auto-play this state
   *                       (defaults to 'idle' if unspecified for one-shots).
   * @param crossfadeSec   blend time with the previous action
   * @param timeScale      playback speed multiplier for this state's clip.
   *                       1.0 = authored speed. Used by ability code to align
   *                       a long clip with a short ability active window
   *                       (e.g. Sergei's 1.03s Gorilla Rush at 2.3× plays
   *                       in ~0.45s so the strike pose lands on time).
   *                       Loop states default to 1.0 each time; one-shots
   *                       keep the last-set timeScale for the duration.
   */
  play(
    state: SkeletalState,
    opts: { fallback?: SkeletalState; crossfade?: number; force?: boolean; timeScale?: number } = {},
  ): boolean {
    // Taking a state-machine step means we're no longer previewing in
    // the lab. Release the manual mode + restore any loop/clamp edits a
    // preview had made so the resolver sees clean actions.
    if (this.manualClipActive) {
      this.manualClipActive = false;
      this.restorePreservedActionConfigs();
    }
    const action = this.actions[state];
    if (!action) {
      // Requested state has no clip on this critter. If a fallback was
      // supplied, try it — otherwise we'd leave the mixer clamped on
      // whatever heavy clip was running (the canonical symptom: critter
      // falls, clip `fall` clamps at the final pose, respawn requests
      // `respawn` which doesn't exist, state stays at 'fall' forever
      // even though respawnAt has reset position + lives + vels).
      if (opts.fallback && opts.fallback !== state) {
        return this.play(opts.fallback, {
          crossfade: opts.crossfade,
          force: opts.force,
          timeScale: opts.timeScale,
          // Clear fallback on the recursive call so we don't recurse past
          // one level (the fallback chain is intentionally shallow).
        });
      }
      return false;
    }

    // Skip re-triggering loops unless force=true — otherwise idle↔idle
    // every frame would reset the animation head.
    if (!opts.force && this.currentState === state && LOOPING_STATES.has(state)) {
      return true;
    }

    const crossfade = opts.crossfade ?? DEFAULT_CROSSFADE;
    const prevState = this.currentState;
    const prevAction = prevState ? this.actions[prevState] : undefined;

    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(opts.timeScale ?? 1);
    action.play();

    if (prevAction && prevAction !== action) {
      prevAction.crossFadeTo(action, crossfade, false);
      // Three.js bug workaround: crossFadeTo sometimes leaves the incoming
      // action's weight scaled — re-assert.
      action.setEffectiveWeight(1);
    }

    this.currentState = state;
    this.fallbackAfterOneShot = LOOPING_STATES.has(state)
      ? null
      : (opts.fallback ?? 'idle');
    return true;
  }

  /** Advance the mixer. Call every frame from Critter.update(). */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /**
   * List every clip that came with the GLB, along with which logical
   * state (if any) our fuzzy resolver maps it to, plus the tier that
   * won the mapping (`override | exact | prefix | contains`). Used by
   * the /tools.html lab AND the dedicated /anim-lab.html to inspect
   * and override clip assignments.
   */
  listClips(): Array<{
    name: string;
    duration: number;
    state: SkeletalState | null;
    source: ResolveSource | null;
  }> {
    return this.clips.map(clip => {
      let matchedState: SkeletalState | null = null;
      for (const [state, action] of Object.entries(this.actions)) {
        if (action.getClip() === clip) {
          matchedState = state as SkeletalState;
          break;
        }
      }
      return {
        name: clip.name,
        duration: clip.duration,
        state: matchedState,
        source: matchedState ? (this.resolveSources[matchedState] ?? null) : null,
      };
    });
  }

  /**
   * Per-state mapping report — what clip (by name) each logical state
   * resolved to, and which tier won. Used by /anim-lab.html for the
   * "mapping" panel that shows every state and its resolver decision.
   *
   * States with no resolution come back as { clipName: null, source:
   * 'missing' }. Never returns undefined — lab UI can render a full
   * table without guarding.
   */
  getResolveReport(): Array<{
    state: SkeletalState;
    clipName: string | null;
    source: ResolveSource;
  }> {
    const states: SkeletalState[] = [
      'idle', 'walk', 'run',
      'headbutt_anticip', 'headbutt_lunge',
      'ability_1', 'ability_2', 'ability_3',
      'victory', 'defeat', 'fall', 'hit', 'respawn',
    ];
    return states.map(state => {
      const action = this.actions[state];
      const clipName = action ? action.getClip().name : null;
      const source = this.resolveSources[state] ?? 'missing';
      return { state, clipName, source };
    });
  }

  /** Raw clip list — exposes the internal array without mutation rights.
   *  Lab uses this to let the user pick ANY clip by name in dropdowns. */
  getRawClipNames(): string[] {
    return [...this.availableClipNames];
  }

  /**
   * Play a specific clip by its exact name — bypassing the state resolver.
   * Used by the dev lab to preview clips and confirm the GLB rigged cleanly.
   *
   * Intentionally DOES NOT update currentState or trigger fallbacks — the
   * caller is in debug mode and wants raw playback. The next call to
   * `play(state)` (e.g. from the auto idle/run loop) will take over
   * cleanly via crossFadeTo on the previous action.
   *
   * Returns true if the clip was found and started, false otherwise.
   */
  playClipByName(clipName: string, loop = true, speed = 1): boolean {
    const clip = this.clips.find(c => c.name === clipName);
    if (!clip) return false;

    let action = this.clipActionsByName.get(clipName);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.clipActionsByName.set(clipName, action);
    }

    // Snapshot loop / clampWhenFinished BEFORE we mutate them so the
    // resolver's copy of this action (which lives in `this.actions[state]`
    // for state-mapped clips) can be restored by stopAll() / next
    // play(state). Only capture on first touch; leave the snapshot
    // untouched on repeated previews of the same clip so we never lose
    // the original shape.
    if (!this.preservedActionConfig.has(action)) {
      this.preservedActionConfig.set(action, {
        loop: action.loop,
        clamp: action.clampWhenFinished,
      });
    }

    // Fade out every other currently-playing action so the chosen clip
    // reads clean. The mixer handles the cleanup; we just drop weights.
    for (const a of [...Object.values(this.actions), ...this.clipActionsByName.values()]) {
      if (a === action || !a.isRunning()) continue;
      a.fadeOut(DEFAULT_CROSSFADE);
    }

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.setEffectiveWeight(1);
    // `speed` defaults to 1 so existing callers (game runtime via
    // resolver, /tools.html, prior anim-lab versions) keep their
    // current behaviour. /anim-lab.html v2 passes per-state speed for
    // preview tuning.
    action.setEffectiveTimeScale(speed);
    action.enabled = true;
    action.fadeIn(DEFAULT_CROSSFADE);
    action.play();

    // Mark state as "unknown" — the normal state machine will pick up
    // again on the next play() call. `manualClipActive` tells the
    // procedural layer (via isHeavyClipActive) to stop writing to
    // glbMesh.{position,rotation,scale} for the duration of the preview,
    // so the clip's pose reads clean without the idle bob / lean /
    // squash mixed on top.
    this.currentState = null;
    this.fallbackAfterOneShot = null;
    this.manualClipActive = true;
    return true;
  }

  /**
   * Live-update the playback speed of an already-running clip without
   * resetting its time. Used by /anim-lab.html so dragging or typing
   * the per-row speed input doesn't cause the clip to snap back to
   * t=0 on every keystroke — an `input` event fires per character,
   * and calling `playClipByName` again would do `action.reset()` + a
   * fresh `fadeIn(0.15)`, which visibly re-flickers the bone pose
   * and looks like the animation is "broken".
   *
   * Returns true if the clip's action was found, false otherwise.
   * The lab falls back to `playClipByName` when this returns false
   * (usually because no preview is active yet).
   */
  setRunningClipTimeScale(clipName: string, speed: number): boolean {
    const action = this.clipActionsByName.get(clipName);
    if (!action) return false;
    action.setEffectiveTimeScale(speed);
    return true;
  }

  /** Restore every AnimationAction this preview session mutated back to
   *  its authored (constructor-time) loop + clampWhenFinished. Called
   *  when manual mode releases (stopAll / next play(state)). */
  private restorePreservedActionConfigs(): void {
    for (const [act, cfg] of this.preservedActionConfig) {
      act.setLoop(cfg.loop, Infinity);
      act.clampWhenFinished = cfg.clamp;
    }
    this.preservedActionConfig.clear();
  }

  /** Stop everything. Used by the lab's "Stop clip" button. */
  stopAll(): void {
    this.mixer.stopAllAction();
    this.currentState = null;
    this.fallbackAfterOneShot = null;
    this.manualClipActive = false;
    this.restorePreservedActionConfigs();
  }

  hasClip(state: SkeletalState): boolean {
    return !!this.actions[state];
  }

  /**
   * True when the current state is a "heavy" one (victory, defeat, ability,
   * headbutt_lunge, fall, hit). The procedural layer reads this to suppress
   * root-level writes that would clash with the clip's pose.
   *
   * Also true while a /anim-lab.html preview is running (manualClipActive):
   * during a manual preview we don't know what the clip is authored to do,
   * so the safe assumption is "treat it as heavy, let the clip own the
   * root pose, keep procedural quiet". Without this, previewing a clip
   * in the lab stacks idle bob / lean / scale squash on top of the bone
   * animation — the exact rareness users saw.
   */
  isHeavyClipActive(): boolean {
    if (this.manualClipActive) return true;
    if (!this.currentState) return false;
    return HEAVY_STATES.has(this.currentState);
  }

  /**
   * True when a LOOPING clip (idle / walk / run) is actually playing —
   * i.e. the state is a loop AND we have a resolved clip for it. The
   * procedural layer reads this to suppress the vertical bob/bounce it
   * would otherwise stack on top of the clip's own breathing / footfalls.
   *
   * Critical for the character-select preview: without this, critters
   * with skeletal Idle look like they're jumping in place because the
   * clip's spine animation + the procedural bob play at the same time.
   *
   * Returns false for critters without clips (procedural owns the look),
   * and false during one-shot / heavy states (those have their own
   * suppression path in `isHeavyClipActive`).
   */
  isLoopingClipActive(): boolean {
    if (!this.currentState) return false;
    if (!LOOPING_STATES.has(this.currentState)) return false;
    return !!this.actions[this.currentState];
  }

  getCurrentState(): SkeletalState | null {
    return this.currentState;
  }

  /** Release the mixer's actions. Call from Critter.dispose(). */
  dispose(): void {
    this.mixer.stopAllAction();
    for (const state of Object.keys(this.actions) as SkeletalState[]) {
      this.actions[state]?.getClip(); // no-op, just keeps TS happy
      delete this.actions[state];
    }
    this.currentState = null;
  }
}

// ---------------------------------------------------------------------------
// Clip name resolver
// ---------------------------------------------------------------------------

/**
 * Returns true when every track in the clip has zero variance across its
 * keyframes — i.e., bone values never move from the rest pose. Such clips
 * are bind-pose snapshots (a Blender action slot exported with no real
 * keyframes ends up like this: 1-2 identical keys per bone per channel).
 * Playing them forces the rig to T-pose for the clip's duration, creating
 * the visible snap we want to avoid.
 *
 * Detection is per-component within each keyframe so Vec3/Quaternion
 * tracks are handled correctly (a flat min/max would alias cross-component
 * differences as variance and miss truly-static channels).
 *
 * eps bumped from 1e-4 to 1e-3 in the 2026-04-24 pass so idle clips that
 * ship with real but tiny breath micro-motion (e.g. Meshy idles with
 * 0.5mm rib translation) aren't accidentally dropped as "dead", leaving
 * the critter visibly T-posed in the preview while its ability clips
 * play fine.
 */
function isClipEffectivelyStatic(clip: THREE.AnimationClip, eps = 1e-3): boolean {
  for (const track of clip.tracks) {
    if (track.times.length < 2) continue;
    const stride = track.values.length / track.times.length;
    for (let k = 1; k < track.times.length; k++) {
      for (let c = 0; c < stride; c++) {
        if (Math.abs(track.values[k * stride + c] - track.values[c]) > eps) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Same matcher as the legacy `findClipForState` but also reports WHICH
 * tier won. Exposed for the anim lab so each resolved state can show
 * its origin (exact / prefix / contains / missing). The old
 * `findClipForState` wrapper was removed once its only consumer (the
 * constructor loop) started needing the tier info.
 */
export function findClipForStateTiered(
  clips: THREE.AnimationClip[],
  state: SkeletalState,
): { clip: THREE.AnimationClip | null; source: ResolveSource } {
  if (clips.length === 0) return { clip: null, source: 'missing' };
  const keywords = STATE_KEYWORDS[state];
  const lowered = clips.map(c => ({ clip: c, name: c.name.toLowerCase() }));

  // Tier 1 — exact match on the state name (or snake_case variant).
  // Wins immediately. "Run" beats "Running" for state='run' because
  // only "run" strips to 'run'. Idempotent order: if two clips both
  // exact-match the first one in the GLB order takes it.
  const snake = state.replace(/_/g, '');
  for (const { clip, name } of lowered) {
    const n = name.replace(/[_\s-]/g, '');
    if (n === state || n === snake) return { clip, source: 'exact' };
  }

  // Tier 2 — prefix match: clip name starts with the keyword (ignoring
  // delimiters). Catches canonical Mixamo-ish names like "Run_InPlace",
  // "Idle_Alert" where the logical state is at the head of the clip. We
  // prefer prefix over substring so "Running" (prefix match on 'run')
  // beats a hypothetical "AbilityRunnySlam" (substring match).
  for (const kw of keywords) {
    for (const { clip, name } of lowered) {
      const normalised = name.replace(/[_\s-]/g, '');
      if (normalised.startsWith(kw.replace(/[_\s-]/g, ''))) return { clip, source: 'prefix' };
    }
  }

  // Tier 3 — substring match (original behaviour). Last-resort catch-all
  // for authored names where the keyword lives somewhere in the middle.
  for (const kw of keywords) {
    for (const { clip, name } of lowered) {
      if (name.includes(kw)) return { clip, source: 'contains' };
    }
  }

  return { clip: null, source: 'missing' };
}
