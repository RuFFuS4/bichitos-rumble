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
    // Fragment-specific tuning is in arena-fragments.ts (FRAG config)
    // shared identically between server and client.
  },
} as const;

// Per-critter config table. MUST stay in sync with client's CRITTER_PRESETS.
// Adding a new playable character = add an entry here + abilities entry below.
export interface CritterConfigServer {
  name: string;
  speed: number;
  mass: number;
  headbuttForce: number;
  radius: number;
}

export const CRITTER_CONFIGS: Record<string, CritterConfigServer> = {
  // All 9 base speeds scaled ×1.3 from their original tier tuning to lift
  // overall pace. Ratios preserved so roles keep their relative feel.
  Sergei:    { name: 'Sergei',    speed: 13,    mass: 1.1,  headbuttForce: 15, radius: 0.55 },
  Trunk:     { name: 'Trunk',     speed: 9.1,   mass: 1.4,  headbuttForce: 17, radius: 0.55 },

  // --- Bloque C: 7 remaining playables ---
  Kurama:    { name: 'Kurama',    speed: 15.6,  mass: 0.8,  headbuttForce: 12, radius: 0.55 }, // Trickster
  Shelly:    { name: 'Shelly',    speed: 8.45,  mass: 1.5,  headbuttForce: 16, radius: 0.55 }, // Tank
  Kermit:    { name: 'Kermit',    speed: 11.7,  mass: 1.0,  headbuttForce: 13, radius: 0.55 }, // Controller
  Sihans:    { name: 'Sihans',    speed: 10.4,  mass: 1.15, headbuttForce: 14, radius: 0.55 }, // Trapper
  Kowalski:  { name: 'Kowalski',  speed: 13,    mass: 0.9,  headbuttForce: 11, radius: 0.55 }, // Mage
  Cheeto:    { name: 'Cheeto',    speed: 16.9,  mass: 0.7,  headbuttForce: 11, radius: 0.55 }, // Assassin
  Sebastian: { name: 'Sebastian', speed: 13.65, mass: 0.75, headbuttForce: 18, radius: 0.55 }, // Glass Cannon
};

export const DEFAULT_CRITTER = 'Sergei';

/** Resolve a critter name to its config, falling back to Sergei. */
export function getCritterConfig(name: string): CritterConfigServer {
  return CRITTER_CONFIGS[name] ?? CRITTER_CONFIGS[DEFAULT_CRITTER];
}

/** True if name is a valid playable critter on this server. */
export function isPlayableCritter(name: string): boolean {
  return name in CRITTER_CONFIGS;
}

// Spawn positions for up to 4 players (we use first 2 in Bloque A)
export const SPAWN_POSITIONS: ReadonlyArray<[number, number]> = [
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];
