// ---------------------------------------------------------------------------
// Animation overrides — per-critter explicit clip assignment
// ---------------------------------------------------------------------------
//
// The SkeletalAnimator ships with a 3-tier resolver
// (exact → prefix → contains) in `critter-skeletal.ts`. That resolver is
// general and handles 95 % of cases on its own. This file is the escape
// hatch for the remaining 5 %: when a critter ships clip names that the
// heuristic can't disambiguate, or when we want to FORCE a specific clip
// for a logical state regardless of what the resolver would pick.
//
// Source of truth: this file. The `/anim-lab.html` validation tool reads
// + writes this record. No other code should hard-code per-critter clip
// choices. If you find yourself wanting to override something here,
// first check whether the resolver's 3-tier priority already handles it
// (exact name match wins over prefix, prefix wins over contains).
//
// Known case study — Sergei: the GLB ships BOTH `Run` and `Running`
// clips. The resolver's exact-match tier correctly picks `Run` for
// state `'run'` because only `Run` matches `'run'` after stripping
// delimiters. No override needed. Kept the example as comment below so
// the next engineer sees the first real mental model.
//
// Shape
// -----
// ```ts
// ANIMATION_OVERRIDES[critterId]?.[state] = 'ExactClipName';
// ```
// The key `critterId` matches `RosterEntry.id` (lowercase, e.g. 'sergei',
// 'trunk', 'kurama'). The inner key is a `SkeletalState` from
// `critter-skeletal.ts`. The value is the EXACT clip name as shipped in
// the GLB (case sensitive, no normalisation).
//
// Lookup is "strict name match". If the override points to a clip name
// that doesn't exist in the GLB, the resolver falls through to the
// 3-tier heuristic — overrides are best-effort, not a hard contract.
// This makes the file safe to leave partial or slightly stale.
// ---------------------------------------------------------------------------

import type { SkeletalState } from './critter-skeletal';

/**
 * Per-state override entry. Two equivalent forms accepted in source:
 *
 *   1. Shorthand string (back-compat with v1 lab patches and existing
 *      authored entries — most overrides only need a clip name):
 *
 *        ability_2: 'Ability3GroundPound'
 *
 *   2. Object form (lab v2 patches — when speed or loop matter):
 *
 *        idle: { clip: 'Idle', speed: 1.15, loop: true }
 *
 * Both forms ship in the same `ANIMATION_OVERRIDES` record without any
 * migration. Resolver helpers below normalise on read so callers don't
 * need to switch on the shape.
 *
 * Runtime behaviour (2026-04-27 promotion): speed and loop are now
 * applied IN GAME, not just in /anim-lab. The resolver in
 * `SkeletalAnimator`:
 *   · honours `meta.loop` at action setup time (overrides the
 *     `LOOPING_STATES.has(state)` default for idle/walk/run vs the
 *     rest);
 *   · applies `meta.speed` on every `play(state)` call as a fallback
 *     when the caller didn't pass `opts.timeScale` (so a per-ability
 *     `clipPlaybackRate` still wins over a global override speed).
 * Tools still use `playClipByName(name, loop, speed)` directly for
 * preview — same numbers reach the runtime path now.
 */
export interface ClipOverrideEntry {
  clip: string;
  /** Playback speed multiplier (1 = real-time). Applied in-game via
   *  `SkeletalAnimator.play(state)` and in /anim-lab preview via
   *  `playClipByName(name, loop, speed)`. */
  speed?: number;
  /** Loop flag. If omitted the resolver's per-state default applies
   *  (idle/walk/run loop, others are one-shot). Applied in-game at
   *  action setup time and in /anim-lab preview. */
  loop?: boolean;
}

/** A single override slot — string shorthand or full object. */
export type ClipOverrideValue = string | ClipOverrideEntry;

export type ClipOverrideMap = Partial<Record<SkeletalState, ClipOverrideValue>>;

/**
 * Sparse per-critter overrides. Empty map = pure resolver. Each entry
 * overrides ONLY the states that need a fixed choice for that critter.
 *
 * Authored by hand or exported by `/anim-lab.html`. Edits here take
 * effect on next page reload — no codegen, no build step.
 *
 * WHEN to add an override
 * -----------------------
 * Only when the 3-tier auto-resolver (exact → prefix → contains) picks
 * a wrong clip for a critter and the wrong clip is visually distracting
 * in-game. Concretely:
 *
 *   ✓ Two clips both match a keyword and the resolver picks the wrong
 *     one. Example kept as reference (currently NOT needed — Sergei
 *     ships both `Run` and `Running`, and the exact-match Tier 1
 *     already picks `Run` correctly for state `run`).
 *   ✓ A state resolves via Tier 3 (contains) to a clip that doesn't
 *     actually match the semantic (e.g. "ability_2" lands on a clip
 *     whose name accidentally contains "grip" but isn't a grab anim).
 *     See anim-lab source badge — anything showing `contains` is a
 *     candidate to inspect.
 *
 * WHEN NOT to add an override
 * ---------------------------
 * Some states are `missing` BY DESIGN — the engine renders them via
 * the procedural animation layer (`critter-animation.ts`), not a
 * skeletal clip. Forcing a clip override in these slots is actively
 * harmful: activating the ability would play the wrong clip and
 * suppress the intended procedural motion.
 *
 * Known procedural-by-design states (do NOT override):
 *
 *   ✗ Shelly `ability_1` (Shell Charge)    — mesh spin + hide parts
 *   ✗ Shelly `ability_2` (Shell Shield)    — mesh scale + hide parts
 *   ✗ Sebastian `ability_1` (Claw Rush)    — lateral dash + scale.z
 *   ✗ Sebastian `ability_3` (Crab Slash)   — lateral dash with tell
 *   ✗ Kermit `ability_3` (Hypnosapo)       — emissive flicker loop
 *
 * If a state appears `missing` in `/anim-lab.html` for one of these
 * critters, that's the correct state. Leave it empty here. See
 * `PROCEDURAL_PARTS.md` and `CHARACTER_DESIGN.md §"Cobertura skeletal"`
 * for the authoritative list.
 *
 * States that SHOULD always be resolved by the auto-resolver (don't
 * expect overrides here): `idle`, `run`, `walk`, `victory`, `defeat`,
 * `fall`, `ability_1/2/3` except the procedural cases above.
 *
 * States typically `missing` for EVERY critter (no clips shipped):
 *   `headbutt_anticip`, `headbutt_lunge` — handled by procedural
 *   anticipation pose + lunge squash in `critter-animation.ts`.
 *   `hit`, `respawn` — no dedicated clip authored; visual fallback via
 *   emissive blink + scale punch.
 */
export const ANIMATION_OVERRIDES: Record<string, ClipOverrideMap> = {
  sergei: {
    ability_1: { clip: "Fall", speed: 1.8 },
    ability_2: { clip: "Defeat", speed: 1.5 },
    ability_3: { clip: "Running", speed: 2 },
    defeat: "Ability3Frenzy",
    fall: { clip: "Ability2Shockwave", loop: true },
    idle: "Run",
    run: { clip: "Victory", speed: 1.3 },
    victory: { clip: "Idle", loop: true },
  },
  trunk: {
    ability_1: { clip: "Ability1TrunkRam", speed: 3 },
    // ability_2 stays at Ability3GroundPound (placeholder for the
    // current temporary kit); user is parking it until the rest of
    // Trunk's animations are stable. See CHARACTER_DESIGN.md for the
    // final design intent.
    ability_2: "Ability3GroundPound",
    ability_3: { clip: "Ability3GroundPound", speed: 3 },
    fall: { clip: "Fall", speed: 2, loop: true },
    victory: { clip: "Victory", loop: true },
  },
  // Kurama — clip names in this GLB are crossed against their
  // semantic state (the rig was authored against an in-progress
  // taxonomy). Mappings reflect what the user picked visually in
  // /anim-lab, not what the clip names suggest. Naming cleanup is
  // tracked as deuda técnica — fix the GLB rather than the
  // overrides when there's time.
  kurama: {
    ability_1: { clip: "Idle", speed: 1.9 },
    ability_2: { clip: "Victory", speed: 1.3 },
    ability_3: { clip: "Ability2MirrorTrick", speed: 1.5 },
    defeat: "Walking",
    fall: { clip: "Ability3Copycat", loop: true },
    idle: "Fall",
    run: "Defeat",
    victory: { clip: "Run", loop: true },
  },
  // Shelly — partial mapping. Only entries the user adjusted in
  // /anim-lab; the rest fall through to the auto-resolver. The Mega
  // Shell ulti is intentionally cranked to speed 10 so the spin
  // reads "frenetic" — that's the design intent, not a typo.
  shelly: {
    ability_3: { clip: "Ability3MegaShell", speed: 10, loop: true },
    fall: { clip: "Fall", speed: 0.5 },
    victory: { clip: "Victory", loop: true },
  },
  // Sihans — clip names crossed (similar issue to Kurama). User
  // selected by visual match in /anim-lab.
  sihans: {
    ability_1: { clip: "Defeat", speed: 3 },
    ability_3: { clip: "Walking", speed: 1.5 },
    defeat: "Fall",
    fall: { clip: "Idle", loop: true },
    idle: "Victory",
    run: "Ability1BurrowRush",
    victory: { clip: "Run", loop: true },
  },
  // Cheeto — clean naming + speed bumps to match the predator-fast
  // identity. All three abilities have dedicated clips in the GLB
  // and resolve cleanly; the speed bumps reinforce the "lightning
  // strike" feel above the resolver default of 1.0.
  cheeto: {
    ability_1: { clip: "Ability1Pounce", speed: 2.3 },
    ability_2: { clip: "Ability2ShadowStep", speed: 2 },
    ability_3: { clip: "Ability3TigerRoar", speed: 1.7 },
    fall: { clip: "Fall", loop: true },
    run: { clip: "Run", speed: 1.3 },
    victory: { clip: "Victory", loop: true },
  },
  // Kowalski — Mage identity with fast slide + looping ulti. Ice Age
  // (ability_3) explicitly loops so the freeze-aura reads as a
  // sustained area-control beat rather than a one-shot animation.
  kowalski: {
    ability_1: { clip: "Ability1IceSlide", speed: 3.5 },
    ability_2: { clip: "Ability2Snowball", speed: 2 },
    ability_3: { clip: "Ability3IceAge", speed: 1.8, loop: true },
    fall: { clip: "Fall", speed: 1.8, loop: true },
    run: { clip: "Run", speed: 1.4 },
    victory: { clip: "Victory", loop: true },
  },
  // Sebastian — partial mapping. The GLB only ships `Ability2ClawSweep`
  // for abilities (no ability_1 or ability_3 clips), so those slots
  // intentionally fall through to procedural-only feedback (dash
  // squash + frenzy emissive). Only the states the user could
  // visually verify in /anim-lab are mapped here. Note `idle` and
  // `run` are intentionally crossed against their semantic clip
  // names — the rig was authored with mismatched naming.
  sebastian: {
    ability_2: { clip: "Walking", speed: 1.3 },
    defeat: { clip: "Idle", loop: true },
    fall: { clip: "Defeat", loop: true },
    idle: "Run",
    run: "Victory",
    victory: "Ability2ClawSweep",
  },
  // Kermit — re-imported GLB (2026-04-27). Blender's NLA export named
  // every clip `NlaTrack`/`NlaTrack.NNN` instead of preserving the
  // semantic Action names. The duration-to-state mapping below is
  // NOT speculation: each NlaTrack.NNN duration matches 1:1 with the
  // previous GLB's named clip durations (verified via inspect-clips
  // diff before swap), so the assignment is mechanical, not creative.
  // Plan: when the cross-roster rename pass runs, this whole block
  // disappears (GLB clip names become semantic) and Kermit's auto-
  // resolver matches by exact name like the simpler critters do.
  kermit: {
    idle: "NlaTrack.004",         // 15.38s
    run: "NlaTrack.006",          //  1.29s
    victory: "NlaTrack.002",      //  2.88s
    defeat: "NlaTrack",           //  3.50s
    fall: "NlaTrack.003",         //  3.67s
    ability_1: "NlaTrack.001",    //  3.71s — LeapForward
    ability_2: "NlaTrack.005",    //  0.79s — PoisonCloud
    // ability_3 (Hypnosapo) is procedural in critter.ts — no clip.
  },
};

/**
 * Look up an override clip name. Normalises both override shapes
 * (string shorthand and object form) so existing call sites that
 * only need the clip name continue to work without changes.
 *
 * Consumers should treat a hit here as a strong hint (check the clip
 * exists in the GLB; if it doesn't, fall back to the resolver) rather
 * than an absolute mandate.
 */
export function getClipOverride(
  critterId: string | null | undefined,
  state: SkeletalState,
): string | null {
  const entry = getClipOverrideMeta(critterId, state);
  return entry?.clip ?? null;
}

/**
 * Look up the FULL override metadata (clip + optional speed/loop) for
 * a state. Always returns a normalised object shape — callers don't
 * need to switch on whether the source used the shorthand or object
 * form. Returns null when no override exists.
 *
 * Currently used by /anim-lab.html for display + preview-time speed.
 * The runtime resolver doesn't consume speed/loop yet — see header
 * docstring for the Phase-2 migration plan.
 */
export function getClipOverrideMeta(
  critterId: string | null | undefined,
  state: SkeletalState,
): ClipOverrideEntry | null {
  if (!critterId) return null;
  const entry = ANIMATION_OVERRIDES[critterId];
  if (!entry) return null;
  const v = entry[state];
  if (v == null) return null;
  if (typeof v === 'string') return { clip: v };
  return v;
}

/**
 * List all states that have an override for a given critter. Used by
 * the lab UI to highlight which rows are "forced vs resolver".
 */
export function listOverriddenStates(critterId: string | null | undefined): SkeletalState[] {
  if (!critterId) return [];
  const entry = ANIMATION_OVERRIDES[critterId];
  if (!entry) return [];
  return Object.keys(entry) as SkeletalState[];
}
