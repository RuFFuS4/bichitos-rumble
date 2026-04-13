// ---------------------------------------------------------------------------
// Roster registry — data-driven visual + status config for all characters
// ---------------------------------------------------------------------------
//
// Decouples visual representation and roster management from gameplay config
// (CritterConfig in critter.ts). The game reads this registry to decide what
// to show in character select, which characters are playable, and where to
// find their GLB models.
//
// Status semantics:
//   'playable' — has CritterConfig + abilities + can be selected in grid
//   'wip'      — visible in grid with preview, but not confirmable
//   'locked'   — visible as padlocked slot (future characters)
//   'internal' — hidden from grid, used only for bots / testing
// ---------------------------------------------------------------------------

export type RosterStatus = 'playable' | 'wip' | 'locked' | 'internal';

export interface RosterEntry {
  id: string;                            // lowercase, matches GLB filename
  displayName: string;                   // shown in UI
  glbPath: string | null;                // null = procedural mesh only
  baseColor: number;                     // fallback mesh + UI dot color
  scale: number;                         // uniform scale on GLB root
  offset: [number, number, number];      // position offset within the Group
  physicsRadius: number;                 // collision radius
  pivotY: number;                        // Y shift so feet touch ground
  status: RosterStatus;
  role: string;                          // info pane label
  tagline: string;                       // info pane one-liner
}

// ---------------------------------------------------------------------------
// Default physics radius — matches current HEAD_RADIUS in critter.ts.
// Per-character tuning comes later after playtesting with real models.
// ---------------------------------------------------------------------------
const R = 0.55;

// ---------------------------------------------------------------------------
// Full roster data
// ---------------------------------------------------------------------------

const ROSTER: RosterEntry[] = [
  // --- Real roster (visible in character select grid) ---
  {
    id: 'trunk',
    displayName: 'Trunk',
    glbPath: './models/critters/trunk.glb',
    baseColor: 0x8c8c8c,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Bruiser',
    tagline: 'Huge and unstoppable.',
  },
  {
    id: 'kurama',
    displayName: 'Kurama',
    glbPath: './models/critters/kurama.glb',
    baseColor: 0xff6633,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Trickster',
    tagline: 'Fast, sly, unpredictable.',
  },
  {
    id: 'sergei',
    displayName: 'Sergei',
    glbPath: './models/critters/sergei.glb',
    baseColor: 0xb5651d,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'playable',
    role: 'Balanced',
    tagline: 'Strong and agile. No weakness.',
  },
  {
    id: 'shelly',
    displayName: 'Shelly',
    glbPath: './models/critters/shelly.glb',
    baseColor: 0x2d8659,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Tank',
    tagline: 'Heavy and wise.',
  },
  {
    id: 'kermit',
    displayName: 'Kermit',
    glbPath: './models/critters/kermit.glb',
    baseColor: 0x44cc44,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Controller',
    tagline: 'Venomous area denial.',
  },
  {
    id: 'sihans',
    displayName: 'Sihans',
    glbPath: './models/critters/sihans.glb',
    baseColor: 0x8b6914,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Trapper',
    tagline: 'Digs in. Controls ground.',
  },
  {
    id: 'kowalski',
    displayName: 'Kowalski',
    glbPath: './models/critters/kowalski.glb',
    baseColor: 0x1a1a3e,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Mage',
    tagline: 'Calculated ranged threat.',
  },
  {
    id: 'cheeto',
    displayName: 'Cheeto',
    glbPath: './models/critters/cheeto.glb',
    baseColor: 0xffaa22,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Assassin',
    tagline: 'Swift and lethal.',
  },
  {
    id: 'sebastian',
    displayName: 'Sebastian',
    glbPath: './models/critters/sebastian.glb',
    baseColor: 0xcc3333,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'wip',
    role: 'Glass Cannon',
    tagline: 'One giant claw. All in.',
  },

  // --- Internal placeholders (not visible in grid, used for bots) ---
  {
    id: 'rojo',
    displayName: 'Rojo',
    glbPath: null,
    baseColor: 0xe74c3c,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'internal',
    role: 'Balanced',
    tagline: 'All-rounder. Easy to use.',
  },
  {
    id: 'azul',
    displayName: 'Azul',
    glbPath: null,
    baseColor: 0x3498db,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'internal',
    role: 'Skirmisher',
    tagline: 'Fast and light. Hit and run.',
  },
  {
    id: 'verde',
    displayName: 'Verde',
    glbPath: null,
    baseColor: 0x2ecc71,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'internal',
    role: 'Crusher',
    tagline: 'Slow but devastating.',
  },
  {
    id: 'morado',
    displayName: 'Morado',
    glbPath: null,
    baseColor: 0x9b59b6,
    scale: 1.0,
    offset: [0, 0, 0],
    physicsRadius: R,
    pivotY: 0,
    status: 'internal',
    role: 'Glass Cannon',
    tagline: 'High risk, high reward.',
  },
];

// ---------------------------------------------------------------------------
// Lookup index
// ---------------------------------------------------------------------------

const byName = new Map<string, RosterEntry>();
for (const e of ROSTER) byName.set(e.displayName, e);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up a roster entry by display name (matches CritterConfig.name). */
export function getRosterEntry(name: string): RosterEntry | null {
  return byName.get(name) ?? null;
}

/**
 * Entries visible in the character select grid, in display order.
 * Excludes 'internal' entries (placeholders).
 */
export function getDisplayRoster(): RosterEntry[] {
  return ROSTER.filter(e => e.status !== 'internal');
}

/** Names of characters that can be confirmed in character select. */
export function getPlayableNames(): string[] {
  return ROSTER
    .filter(e => e.status === 'playable')
    .map(e => e.displayName);
}
