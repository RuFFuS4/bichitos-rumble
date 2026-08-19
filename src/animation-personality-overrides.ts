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
};
