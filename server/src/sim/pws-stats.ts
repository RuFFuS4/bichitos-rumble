// ---------------------------------------------------------------------------
// P/W/S stat system — server mirror of src/pws-stats.ts (CLIENT COPY)
// ---------------------------------------------------------------------------
//
// Byte-identical logic to src/pws-stats.ts so the authoritative server
// derives the exact same numbers the client's HUD + physics work against.
// If you edit this file, edit the client copy too (and run `npm run check`
// at the repo root — the typecheck catches shape drift).
// ---------------------------------------------------------------------------

export type PWSLevel = -2 | -1 | 0 | 1 | 2;

export interface PWS {
  p: PWSLevel;
  w: PWSLevel;
  s: PWSLevel;
}

export interface DerivedStats {
  speed: number;
  mass: number;
  headbuttForce: number;
}

const SPEED_BASE = 13.0;
const SPEED_STEP = 2.5;

const MASS_BASE = 1.0;
const MASS_STEP = 0.20;

const FORCE_BASE = 14.0;
const FORCE_STEP = 2.0;

export function toDerivedStats(pws: PWS): DerivedStats {
  return {
    speed:         SPEED_BASE + pws.s * SPEED_STEP,
    mass:          MASS_BASE  + pws.w * MASS_STEP,
    headbuttForce: FORCE_BASE + pws.p * FORCE_STEP,
  };
}

export const CRITTER_PWS: Record<string, PWS> = {
  Sergei:    { p:  0, w:  0, s:  0 },
  Trunk:     { p:  1, w:  1, s: -2 },
  Kurama:    { p: -1, w: -1, s:  2 },
  Shelly:    { p:  0, w:  2, s: -2 },
  Kermit:    { p:  1, w: -2, s:  1 },
  Sihans:    { p: -2, w:  0, s:  2 },
  Kowalski:  { p:  1, w: -1, s:  0 },
  Cheeto:    { p:  1, w: -1, s:  1 },
  Sebastian: { p:  2, w: -2, s:  1 },
};

export function deriveCritterStats(name: string): DerivedStats {
  const pws = CRITTER_PWS[name] ?? CRITTER_PWS.Sergei;
  return toDerivedStats(pws);
}

export function getCritterPWS(name: string): PWS | null {
  return CRITTER_PWS[name] ?? null;
}
