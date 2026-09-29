// ---------------------------------------------------------------------------
// Animation personality overrides — authored per-critter divergences
// ---------------------------------------------------------------------------
//
// `deriveAnimationPersonality` computes every critter's procedural
// animation parameters as a pure function of (mass, speed). That keeps
// the roster coherent by default, but some critters earn hand-tuned
// exceptions (a snappier lean here, a deeper breath there). Those
// exceptions live HERE, not in the derivation math.
//
// Shape: sparse per-critter partials keyed by `CritterConfig.name`
// (e.g. 'Sergei'). Only the fields a critter overrides are present —
// everything else keeps its derived value. An empty table means "the
// formula speaks for the whole roster".
//
// This file is a ToolPatch TARGET: the match lab's Animation tuner
// exports an `anim-personality` patch and `npm run apply-tool-patch`
// (or the ⚡ Apply to source button) merges it here — entries are added
// or updated, NEVER deleted. Removing an override is a manual edit, on
// purpose (same never-delete contract as animation-overrides.ts).
// Tuning notes in comments survive patch application.
// ---------------------------------------------------------------------------

import type { AnimationPersonality } from './critter-animation';

export const PERSONALITY_OVERRIDES: Record<string, Partial<AnimationPersonality>> = {
  // 2026-09-23 — Rafa: Kowalski «derecho», a pasitos de pingüino. His Run
  // clip is already upright (scripts/critter-recipes/kowalski.json), so the
  // run lean drops from the formula's 12° to ~5°, and the side-to-side roll
  // over the planted foot grows from ~3.5° to ~9°: the waddle.
  Kowalski: { leanRadians: 0.09, runSwayRadians: 0.16 },
  // 2026-09-29 — Rafa: each Tripo runs its own way (scripts/critter-recipes/).
  // Kermit hops with both feet at once: rolling over "the planted foot"
  // would lean him to one side on every landing, so no sway.
  Kermit: {
    runSwayRadians: 0,
  },
  // Shelly waddles: upright clip, so the formula's ~7° run lean drops to ~3°,
  // and the roll over the planted foot grows from ~2° to ~9°, like Kowalski.
  Shelly: {
    leanRadians: 0.05,
    runSwayRadians: 0.16,
  },
  // Trunk stomps upright: at speed 16 the formula leans him 12°, which
  // folds the upright clip back into the old sprint. ~3.5°.
  Trunk: {
    leanRadians: 0.06,
  },
};
