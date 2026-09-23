// ---------------------------------------------------------------------------
// Critter locomotion data — measured from each GLB's Run clip
// ---------------------------------------------------------------------------
//
// PRESENTATION ONLY. Nothing here touches physics: the run clip's playback
// rate and the body sway are derived from the critter's REAL velocity so the
// feet stay (roughly) planted and the rhythm follows the legs. See
// `runPlaybackRate` in critter-animation.ts.
//
// `stride`    — how fast the Run clip sweeps a planted foot backwards, in
//               MODEL units per second at timeScale 1 (roster scale 1).
//               The runtime multiplies it by the live GLB scale, so a
//               future size change does not invalidate this table.
// `leftPhase` — phase (0..1) of the Run clip at the middle of the LEFT
//               foot's contact. Drives the body sway so it leans over the
//               foot that is on the ground.
//
// MEASURED, not tuned: regenerate with
//   node scripts/inspect-stride.mjs --write
// after re-exporting or renaming any critter's Run clip. Taste lives in
// `FEEL.runCadence` / `FEEL.locomotion` (gamefeel.ts), not here.
// ---------------------------------------------------------------------------

export interface RunGait {
  stride: number;
  leftPhase: number;
}

export const RUN_GAIT: Record<string, RunGait> = {
  sergei: { stride: 1.129, leftPhase: 0.50 }, // Run 0.80 s · LeftFoot + RightFoot
  trunk: { stride: 0.940, leftPhase: 0.52 }, // Run 1.30 s · L_Foot + R_Foot
  kurama: { stride: 2.664, leftPhase: 0.34 }, // Run 0.63 s · LeftFoot + RightFoot
  shelly: { stride: 0.893, leftPhase: 0.54 }, // Run 1.30 s · L_Foot + R_Foot
  kermit: { stride: 1.471, leftPhase: 0.54 }, // Run 1.29 s · L_Foot + R_Foot
  sihans: { stride: 0.817, leftPhase: 0.27 }, // Run 0.63 s · LeftFoot + RightFoot
  kowalski: { stride: 0.457, leftPhase: 0.14 }, // Run 0.80 s · L_Foot + R_Foot
  cheeto: { stride: 0.999, leftPhase: 0.49 }, // Run 1.30 s · L_Foot + R_Foot
  sebastian: { stride: 0.608, leftPhase: 0.25 }, // Run 0.63 s · LeftFoot + RightFoot
};
