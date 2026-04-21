// ---------------------------------------------------------------------------
// P/W/S (Power / Weight / Speed) stat system — single source of truth
// ---------------------------------------------------------------------------
//
// Every playable critter ships a tuple (P, W, S) in the range -2..+2:
//
//   -2  = minimum  (slowest / lightest / weakest)
//   -1  = below average
//    0  = baseline (Sergei)
//   +1  = above average
//   +2  = maximum  (fastest / heaviest / strongest)
//
// That tuple drives the HUD bars AND the numeric game values (speed /
// mass / headbuttForce) — a single place to rebalance every critter
// without touching combat code. The mapping is deliberately linear:
//
//   speed = 13.0 + S * 2.5   →  range [ 8.0 , 10.5 , 13.0 , 15.5 , 18.0 ]
//   mass  =  1.0 + W * 0.20  →  range [ 0.6 ,  0.8 ,  1.0 ,  1.2 ,  1.4 ]
//   force = 14.0 + P * 2.00  →  range [10.0 , 12.0 , 14.0 , 16.0 , 18.0 ]
//
// Sergei = (0,0,0) by design so the baseline sits in the middle of the
// numeric ranges; any knob tuning preserves this mid-point.
//
// IMPORTANT: `server/src/sim/pws-stats.ts` is a byte-identical copy of
// this file so the authoritative server derives the same numbers the
// client does. If you edit one, edit both (and run `npm run check`).
// ---------------------------------------------------------------------------

/** The 5 valid P/W/S levels. Keeping it as a literal union lets TS catch
 *  out-of-range typos at compile time. */
export type PWSLevel = -2 | -1 | 0 | 1 | 2;

export interface PWS {
  /** Power — headbutt force + implicit ability-force multiplier later. */
  p: PWSLevel;
  /** Weight — mass (used in collision knockback math). */
  w: PWSLevel;
  /** Speed — top movement speed, and via derivation also run bounce. */
  s: PWSLevel;
}

/** Derived numeric stats the engine actually reads. */
export interface DerivedStats {
  speed: number;
  mass: number;
  headbuttForce: number;
}

// ---------------------------------------------------------------------------
// Scalars — baseline + per-level step. Change here to shift the whole
// roster without touching every row in CRITTER_PWS.
// ---------------------------------------------------------------------------

const SPEED_BASE = 13.0;
const SPEED_STEP = 2.5;

const MASS_BASE = 1.0;
const MASS_STEP = 0.20;

const FORCE_BASE = 14.0;
const FORCE_STEP = 2.0;

/** Map a PWS tuple to the numeric stats the engine uses. Pure. */
export function toDerivedStats(pws: PWS): DerivedStats {
  return {
    speed:         SPEED_BASE + pws.s * SPEED_STEP,
    mass:          MASS_BASE  + pws.w * MASS_STEP,
    headbuttForce: FORCE_BASE + pws.p * FORCE_STEP,
  };
}

// ---------------------------------------------------------------------------
// Per-critter P/W/S — the canonical balance tuning (2026-04-23)
// ---------------------------------------------------------------------------
//
// Set by the user during the design pass. Rationale per row on the right.
// Kurama's third value was ambiguous in the original message ("-1-2"); we
// resolved to +2 (the obvious typo) because Kurama's role is Trickster —
// fast-and-sly. If playtesting says otherwise, flip to -2 and re-verify.

export const CRITTER_PWS: Record<string, PWS> = {
  Sergei:    { p:  0, w:  0, s:  0 }, // Balanced baseline
  Trunk:     { p:  1, w:  1, s: -2 }, // Bruiser — heavy, strong, slow
  Kurama:    { p: -1, w: -1, s:  2 }, // Trickster — fast, light, moderate hit
  Shelly:    { p:  0, w:  2, s: -2 }, // Tank — heaviest, slowest, average hit
  Kermit:    { p:  1, w: -2, s:  1 }, // Controller — very light but hits above avg
  Sihans:    { p: -2, w:  0, s:  2 }, // Trapper — fastest tier, weak hits
  Kowalski:  { p:  1, w: -1, s:  0 }, // Mage — average speed, light, solid punch
  Cheeto:    { p:  1, w: -1, s:  1 }, // Assassin — fast + light + solid punch
  Sebastian: { p:  2, w: -2, s:  1 }, // Glass Cannon — hardest hitter, lightest
};

/** Resolve a critter name to its derived stats. Falls back to Sergei's
 *  numbers if the name isn't in the table (used for roster-dev placeholders
 *  like the legacy Rojo/Azul colours). */
export function deriveCritterStats(name: string): DerivedStats {
  const pws = CRITTER_PWS[name] ?? CRITTER_PWS.Sergei;
  return toDerivedStats(pws);
}

/** Read-only: the full (p, w, s) tuple for a critter, or null if unknown. */
export function getCritterPWS(name: string): PWS | null {
  return CRITTER_PWS[name] ?? null;
}
