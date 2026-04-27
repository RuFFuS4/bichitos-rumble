// ---------------------------------------------------------------------------
// Server-side physics & gameplay constants
// ---------------------------------------------------------------------------
//
// DUPLICATED from client's src/gamefeel.ts — only the numeric values that
// affect simulation. Visual values (hit stop, camera shake, scale feedback)
// stay client-only.

import { deriveCritterStats } from './pws-stats.js';
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
    impulse: 20, // +25% sync with FEEL.chargeRush.impulse 2026-04-27 (dash reach pass)
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

// Per-critter configs derived from P/W/S tuples. To rebalance a critter,
// edit pws-stats.ts (both client + server copies) — this table just
// composes the derived speed/mass/headbuttForce with the per-critter
// collision radius.
function serverConfig(name: string): CritterConfigServer {
  const d = deriveCritterStats(name);
  return { name, speed: d.speed, mass: d.mass, headbuttForce: d.headbuttForce, radius: 0.55 };
}

export const CRITTER_CONFIGS: Record<string, CritterConfigServer> = {
  Sergei:    serverConfig('Sergei'),
  Trunk:     serverConfig('Trunk'),
  Kurama:    serverConfig('Kurama'),     // Trickster
  Shelly:    serverConfig('Shelly'),     // Tank
  Kermit:    serverConfig('Kermit'),     // Controller
  Sihans:    serverConfig('Sihans'),     // Trapper
  Kowalski:  serverConfig('Kowalski'),   // Mage
  Cheeto:    serverConfig('Cheeto'),     // Assassin
  Sebastian: serverConfig('Sebastian'),  // Glass Cannon
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
