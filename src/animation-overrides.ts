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
 */
export const ANIMATION_OVERRIDES: Record<string, ClipOverrideMap> = {
  // Example (commented — not currently needed because the resolver
  // already picks `Run` over `Running` via exact-match Tier 1):
  //
  // sergei: {
  //   run: 'Run',
  //   idle: 'Idle',
  // },
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
