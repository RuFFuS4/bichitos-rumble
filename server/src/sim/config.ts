// ---------------------------------------------------------------------------
// Server-side physics & gameplay constants
// ---------------------------------------------------------------------------
//
// DUPLICATED from client's src/gamefeel.ts — only the numeric values that
// affect simulation. Visual values (hit stop, camera shake, scale feedback)
// stay client-only.
//
// If these drift from the client, physics feel will desync. Keep in sync
// manually during Bloque A. If this becomes painful, extract to a shared
// package in Bloque B.
// ---------------------------------------------------------------------------

export const SIM = {
  tickRate: 30, // server simulation Hz

  movement: {
    frictionHalfLife: 0.08,
    idleFrictionHalfLife: 0.03,
    maxSpeed: 20,
    accelerationScale: 1.6,
    velocityDeadZone: 0.15,
  },

  headbutt: {
    anticipation: 0.12,
    lunge: 0.15,
    cooldown: 0.45,
    velocityBoost: 4.0,
    recoilFactor: 0.35,
  },

  collision: {
    normalPushForce: 3.0,
    headbuttMultiplier: 3.5,
  },

  chargeRush: {
    impulse: 16,
    speedMultiplier: 2.5,
    massMultiplier: 2.0,
    duration: 0.30,
    cooldown: 4.0,
    windUp: 0.06,
  },

  // Reserved for Bloque B — not wired into simulation yet
  groundPound: {
    windUp: 0.35,
    slowDuringWindUp: 0.15,
    radius: 3.5,
    force: 28,
    cooldown: 6.0,
    duration: 0.05,
  },
  frenzy: {
    speedMultiplier: 1.3,
    massMultiplier: 1.35,
    duration: 4.0,
    windUp: 0.4,
    slowDuringWindUp: 0.1,
    cooldown: 18.0,
  },

  match: {
    duration: 120,
    countdown: 3,
  },

  lives: {
    default: 3,
    immunityDuration: 1.5,
    respawnDelay: 0.8,
    fallSpeed: 12,
  },

  arena: {
    radius: 12,
  },
} as const;

// Sergei preset (only playable character in Bloque A)
export const SERGEI_CONFIG = {
  name: 'Sergei',
  speed: 10,
  mass: 1.1,
  headbuttForce: 15,
  radius: 0.55,
} as const;

// Spawn positions for up to 4 players (we use first 2 in Bloque A)
export const SPAWN_POSITIONS: ReadonlyArray<[number, number]> = [
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];
