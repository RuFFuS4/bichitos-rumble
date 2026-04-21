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

export class SkeletalAnimator {
  private readonly mixer: THREE.AnimationMixer;
  /** Map from logical state → resolved Action (or null if no clip matched). */
  private readonly actions: Partial<Record<SkeletalState, THREE.AnimationAction>> = {};
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

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);

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

    // Resolve each logical state to an actual clip (first keyword match).
    // Some states may end up unresolved → actions[state] === undefined.
    const states: SkeletalState[] = [
      'idle', 'walk', 'run',
      'headbutt_anticip', 'headbutt_lunge',
      'ability_1', 'ability_2', 'ability_3',
      'victory', 'defeat', 'fall', 'hit', 'respawn',
    ];
    for (const state of states) {
      const clip = findClipForState(liveClips, state);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (!LOOPING_STATES.has(state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[state] = action;
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
   */
  play(
    state: SkeletalState,
    opts: { fallback?: SkeletalState; crossfade?: number; force?: boolean } = {},
  ): boolean {
    const action = this.actions[state];
    if (!action) return false;

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
    action.setEffectiveTimeScale(1);
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
   * state (if any) our fuzzy resolver maps it to. Used by the /tools.html
   * lab Skeletal Clips panel to inspect whether an imported GLB's clip
   * names are being picked up correctly.
   */
  listClips(): Array<{ name: string; state: SkeletalState | null }> {
    return this.clips.map(clip => {
      let matchedState: SkeletalState | null = null;
      for (const [state, action] of Object.entries(this.actions)) {
        if (action.getClip() === clip) {
          matchedState = state as SkeletalState;
          break;
        }
      }
      return { name: clip.name, state: matchedState };
    });
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
  playClipByName(clipName: string, loop = true): boolean {
    const clip = this.clips.find(c => c.name === clipName);
    if (!clip) return false;

    let action = this.clipActionsByName.get(clipName);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.clipActionsByName.set(clipName, action);
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
    action.setEffectiveTimeScale(1);
    action.enabled = true;
    action.fadeIn(DEFAULT_CROSSFADE);
    action.play();

    // Mark state as "unknown" — the normal state machine will pick up
    // again on the next play() call.
    this.currentState = null;
    this.fallbackAfterOneShot = null;
    return true;
  }

  /** Stop everything. Used by the lab's "Stop clip" button. */
  stopAll(): void {
    this.mixer.stopAllAction();
    this.currentState = null;
    this.fallbackAfterOneShot = null;
  }

  hasClip(state: SkeletalState): boolean {
    return !!this.actions[state];
  }

  /**
   * True when the current state is a "heavy" one (victory, defeat, ability,
   * headbutt_lunge, fall, hit). The procedural layer reads this to suppress
   * root-level writes that would clash with the clip's pose.
   */
  isHeavyClipActive(): boolean {
    if (!this.currentState) return false;
    return HEAVY_STATES.has(this.currentState);
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
 */
function isClipEffectivelyStatic(clip: THREE.AnimationClip, eps = 1e-4): boolean {
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

function findClipForState(
  clips: THREE.AnimationClip[],
  state: SkeletalState,
): THREE.AnimationClip | null {
  if (clips.length === 0) return null;
  const keywords = STATE_KEYWORDS[state];
  const lowered = clips.map(c => ({ clip: c, name: c.name.toLowerCase() }));

  // 1) Exact match on the state name (or snake_case variant).
  const snake = state.replace(/_/g, '');
  for (const { clip, name } of lowered) {
    const n = name.replace(/[_\s-]/g, '');
    if (n === state || n === snake) return clip;
  }

  // 2) First keyword substring match.
  for (const kw of keywords) {
    for (const { clip, name } of lowered) {
      if (name.includes(kw)) return clip;
    }
  }

  return null;
}
