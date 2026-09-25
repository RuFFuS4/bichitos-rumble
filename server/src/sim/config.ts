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
    accelerationScale: 2.2, // 1.6 → 2.2 on 2026-09-21 (docs/FEELING.md §7) — mirror of FEEL
    velocityDeadZone: 0.15,
    // Integrations per tick: 30 Hz × 2 = one every 1/60 s, the step the
    // offline game is tuned at (lab, golden and batch run fixed 1/60; the
    // live loop too once the fixed step lands). A push that integrates at
    // 1/30 carries farther: the K 29 % more, Cone Pulse 10.8 u vs 5.8
    // (docs/REPASO_HABILIDADES_INFORME.md B1). Reader: BrawlRoom's
    // integrate step (wired 2026-09-25) and src/net-smoothing.ts via FEEL.
    // Mirror of FEEL.movement.integrationSubsteps, which net-smoothing reads.
    integrationSubsteps: 2,
  },

  headbutt: {
    anticipation: 0.12,
    lunge: 0.15,
    cooldown: 0.45,
    velocityBoost: 4.7, // 4.0 × √1.375 with the 2026-09-21 speed-up — mirror of FEEL.headbutt.lunge
    recoilFactor: 0.35,
  },

  collision: {
    normalPushForce: 3.0,
    headbuttMultiplier: 3.5,
    // × normalPushForce — rebound off an anchored critter (Shelly Steel
    // Shell). Was a hardcoded 1.4 in sim/physics.ts; 1.4 × 1.375 with the
    // 2026-09-21 speed-up. Mirror of FEEL.collision.anchoredBounceFactor.
    anchoredBounceFactor: 1.925,
    // Were hardcoded in sim/physics.ts; mirrors of FEEL.collision.
    shellReflectFactor: 0.85,
    stunnedVulnerability: 4,
  },

  bots: {
    // Deploy gate for the online bots' L (Rafa, 2026-09-24: «10 sí»). ON
    // since the BrawlRoom slice that runs every L the way this sim does
    // (rehit window on the saw/ram/touch contacts, set velocity,
    // knockbackScale on the room's own pushes — DISTRIBUCIÓN, 2026-09-25).
    // Rafa, pregunta 6: «encender para todos», aunque Kermit quede fuerte;
    // su balance va aparte. Client-only: offline bots always cast their L.
    ultimateOnline: true as boolean,
    // Fraction of the player's acceleration a bot runs with. Online bots
    // used to push at the full 1.0 while offline ones ran at 0.55; both
    // are 0.7 since 2026-09-21. Mirror of FEEL.bots.moveAccelFactor.
    moveAccelFactor: 0.7,
    // Edge awareness + decision rates — were inline constants in
    // sim/bot.ts. Mirrors of FEEL.bots (tests/sim/feel-sim-parity.test.ts).
    edgeMargin: 1.4,
    edgeSteer: 1.6,
    lookAhead: 1.1,
    defendRange: 2.8,
    // blinkSeek: Shadow Step, trap: Sand Trap, buff: the generic L, grip:
    // Trunk Grip. `risky` (Sebastian's All-in) stays client-only: BrawlRoom
    // has no way for a bot to hold and drop the charge (see ./bot.ts).
    fireRatesPerSec: {
      mobility: 0.702, radial: 0.596, cone: 0.839, ranged: 0.737, blinkSeek: 0.702, trap: 0.596,
      buff: 0.382, grip: 0.5,
    },
    // Slot-2 aim and the J's void probe (2026-09-24). Mirrors of FEEL.bots.
    nearbyRadius: 4.0,
    radialSoloFrac: 0.7,
    dashProbeNear: 1.0,
    dashProbeFar: 3.0,
    rangedAimDeg: 35,
    targetedMinRange: 3.0,
    trapRadiusFrac: 0.8,
    // The L, since online bots cast it (2026-09-24). Mirrors of FEEL.bots.
    buffRange: 3.5,
    gripMaxRange: 10,
    floorCastRadiusFrac: 0.6,
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
  // Sebastian's All-in resolution. Mirror of FEEL.allIn. Read by BrawlRoom's
  // All-in pass and hold-to-fire loop (since 2026-09-25).
  allIn: {
    hitMargin: 0.55,
    missProbeStep: 0.5,
    // Aiming while charging (2026-09-24). Online: BrawlRoom's hold-to-fire
    // loop turns the facing toward the input (since 2026-09-25).
    aimTurnDegPerSec: 360,
  },
  // Blink landing (Sand Trap, Shadow Step). Mirror of FEEL.blink.
  blink: {
    landingProbeStep: 0.5,
  },
  // Cone Pulse (Cheeto L) waves. Mirror of FEEL.conePulse. Read by
  // BrawlRoom's Cone Pulse pass (since 2026-09-25).
  conePulse: {
    waveStep: 1.4,
    waveThickness: 2.0,
  },
  // L contact passes (Saw Shell, Stampede ram, Toxic Touch). Mirror of
  // FEEL.abilities; read by takeContactHit in ./abilities.ts.
  abilities: {
    contactRehitCooldown: 0.3,
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
  /** Per-critter feedback boost on headbutt connect (v0.11). Mirrors
   *  the client's `CritterConfig.headbuttBoost`. Default 1.0. Server
   *  reads this in `physics.resolveCollisions` to scale the knockback
   *  force when this critter's headbutt connects, so online and
   *  offline match feel identical for the buffed cabezazos. */
  headbuttBoost?: number;
  radius: number;
}

// Per-critter configs derived from P/W/S tuples. To rebalance a critter,
// edit pws-stats.ts (both client + server copies) — this table just
// composes the derived speed/mass/headbuttForce with the per-critter
// collision radius.
function serverConfig(
  name: string,
  headbuttBoost?: number,
  overrides?: Partial<CritterConfigServer>,
): CritterConfigServer {
  const d = deriveCritterStats(name);
  return {
    name, speed: d.speed, mass: d.mass, headbuttForce: d.headbuttForce,
    headbuttBoost, radius: 0.55,
    ...overrides,
  };
}

export const CRITTER_CONFIGS: Record<string, CritterConfigServer> = {
  Sergei:    serverConfig('Sergei',    1.40), // 2026-04-29 final-K — Rafa: "más potencia headbutt". 1.15 → 1.40.
  // 2026-05-01 final block + micropasses — Trunk speed 8 → 16 +
  // headbuttForce 16 → 48 (bestia). Boost: 3.0 → 2.55 (micropass 1)
  // → 2.30 (micropass 2, otro -10 %).
  // 2026-08-21 balance v2 (micropass 3): boost 2.30 → default 1.0 — la
  // fuerza efectiva 110.4 era +50 pts de presupuesto; a 48 sigue
  // doblando al segundo. Elefante (speed 16) intacto.
  Trunk:     serverConfig('Trunk',     undefined, { speed: 16, headbuttForce: 48 }),
  Kurama:    serverConfig('Kurama', 1.15),  // Trickster — balance v2 2026-08-21
  Shelly:    serverConfig('Shelly', 1.30),  // Tank — balance v2 2026-08-21
  Kermit:    serverConfig('Kermit'),     // Controller
  Sihans:    serverConfig('Sihans'),     // Trapper
  Kowalski:  serverConfig('Kowalski',  1.20), // headbutt boosted
  Cheeto:    serverConfig('Cheeto',    1.30), // headbutt boosted (más rápido/evidente)
  Sebastian: serverConfig('Sebastian', 1.45), // Glass Cannon — headbutt firma
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
