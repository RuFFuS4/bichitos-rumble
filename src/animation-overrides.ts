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

export type ClipOverrideMap = Partial<Record<SkeletalState, string>>;

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
  // Trunk — placeholder kit vs final-design clip names mismatch.
  //
  // The GLB ships 3 ability clips named after the FINAL design (Ram /
  // Grip / GroundPound). The current temporary kit in `abilities.ts`
  // is [charge_rush, ground_pound, frenzy] — so:
  //   · Slot 0 (J, Trunk Ram, charge_rush)  → ab_1 → Ability1TrunkRam ✓
  //   · Slot 1 (K, Earthquake, ground_pound) → ab_2 → WOULD PICK
  //     Ability2TrunkGrip (a grab animation — wrong for a stomp).
  //   · Slot 2 (L, Stampede, frenzy)        → ab_3 → WOULD PICK
  //     Ability3GroundPound (a stomp — wrong for a buff).
  //
  // Until Trunk's final kit lands (`CHARACTER_DESIGN.md` has
  // `Trunk Grip` as the real Hab 2 and `Ground Pound with STUN` as
  // ULTI), override ab_2 to point at the stomp clip. The Stampede
  // slot stays procedural (frenzy is a pure-buff effect — no clip
  // needed, the existing emissive pulse in critter.ts does the job).
  //
  // Remove this override once the final Trunk Grip ability type
  // lands and the kit indexing matches the clip numbering.
  trunk: {
    ability_2: 'Ability3GroundPound',
  },
};

/**
 * Look up an override. Returns the authored clip name for a given
 * (critterId, state) pair, or null if no override is set.
 *
 * Consumers should treat a hit here as a strong hint (check the clip
 * exists in the GLB; if it doesn't, fall back to the resolver) rather
 * than an absolute mandate.
 */
export function getClipOverride(
  critterId: string | null | undefined,
  state: SkeletalState,
): string | null {
  if (!critterId) return null;
  const entry = ANIMATION_OVERRIDES[critterId];
  if (!entry) return null;
  return entry[state] ?? null;
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
