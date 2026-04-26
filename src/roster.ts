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

export interface AbilityPreview {
  name: string;
  key: string;
  description: string;
}

export interface RosterEntry {
  id: string;                            // lowercase, matches GLB filename
  displayName: string;                   // shown in UI
  glbPath: string | null;                // null = procedural mesh only
  baseColor: number;                     // fallback mesh + UI dot color
  scale: number;                         // uniform scale on GLB root
  rotation: number;                      // Y-axis rotation in radians
  offset: [number, number, number];      // position offset within the Group
  physicsRadius: number;                 // collision radius
  pivotY: number;                        // Y shift so feet touch ground
  status: RosterStatus;
  role: string;                          // info pane label
  tagline: string;                       // info pane one-liner
  plannedAbilities?: AbilityPreview[];   // for WIP characters without gameplay
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
    // Bruiser — largest silhouette (mass 1.4). Tripo Animate meshes have
    // their origin at the feet (minY=0 in GLB space), so pivotY=0 lands
    // feet on floor regardless of scale — different from Sergei whose
    // mesh is centered (pivotY=1.335).
    scale: 2.84, rotation: -Math.PI / 2, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Bruiser',
    tagline: 'Huge and unstoppable.',
  },
  {
    id: 'kurama',
    displayName: 'Kurama',
    glbPath: './models/critters/kurama.glb',
    baseColor: 0xff6633,
    // Trickster — Meshy AI mesh, imported 2026-04-24. Source bounds
    // Y [0, 2.95], height 2.95u, feet-at-origin (Mixamo convention).
    // scale 0.54 matches the ~1.6u chibi target the roster aims for;
    // Tripo models were already ~1u tall so they used scale 2-3.
    // rotation 0: Meshy/Mixamo character faces -Z (standard "forward"
    // in three.js), so no rotation needed to line up with game forward.
    // If playtest shows Kurama facing away from the camera in
    // character-select, flip to Math.PI.
    scale: 0.81, rotation: 0, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Trickster',
    tagline: 'Fast, sly, unpredictable.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Quick agile dash through enemies' },
      { name: 'Mirror Trick', key: 'K', description: 'Leaves a decoy that confuses bots' },
      { name: 'Copycat', key: 'L', description: 'Copies the last ability used nearby' },
    ],
  },
  {
    id: 'sergei',
    displayName: 'Sergei',
    glbPath: './models/critters/sergei.glb',
    baseColor: 0xb5651d,
    // Meshy AI regen landed 2026-04-24, full 8-clip kit (Gorilla Rush /
    // Shockwave / Frenzy / Idle / Run / Victory / Defeat / Fall).
    // Source bounds Y [0, 2.414], feet-at-origin (Mixamo convention).
    // scale 0.66 targets the in-game ~1.6u chibi baseline; pivotY back
    // to 0 (previous 1.335 was for the old Tripo centered mesh).
    // rotation 0: Mixamo characters face -Z, same as every other
    // Meshy import in the roster.
    scale: 1.09, rotation: 0, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Balanced',
    tagline: 'Strong and agile. No weakness.',
  },
  {
    id: 'shelly',
    displayName: 'Shelly',
    glbPath: './models/critters/shelly.glb',
    baseColor: 0x2d8659,
    // Tank turtle (mass 1.5) — second largest silhouette after Trunk.
    // New Tripo Animate rig aligns her forward axis with the others.
    // Tripo mesh origin at feet, pivotY=0.
    scale: 2.6, rotation: -Math.PI / 2, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Tank',
    tagline: 'Heavy and wise.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Slow but heavy frontal charge' },
      { name: 'Shell Shield', key: 'K', description: 'Retreats into shell, blocks knockback' },
      { name: 'Mega Shell', key: 'L', description: 'Spins in shell dealing area damage' },
    ],
  },
  {
    id: 'kermit',
    displayName: 'Kermit',
    glbPath: './models/critters/kermit.glb',
    baseColor: 0x9c3cee,
    // Controller frog (mass 1.0) — medium size. Tripo mesh origin at feet.
    scale: 2.6, rotation: -Math.PI / 2, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Controller',
    tagline: 'Venomous area denial.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Tongue-propelled leap forward' },
      { name: 'Poison Cloud', key: 'K', description: 'Drops a toxic zone that slows enemies' },
      { name: 'Hypnosapo', key: 'L', description: 'Mesmerizes nearby enemies briefly' },
    ],
  },
  {
    id: 'sihans',
    displayName: 'Sihans',
    glbPath: './models/critters/sihans.glb',
    baseColor: 0x8b6914,
    // Trapper mole (mass 1.15). Meshy AI mesh imported 2026-04-24.
    // Source bounds Y [0, 1.044], feet-at-origin (Mixamo convention).
    // scale 1.53 matches the in-game ~1.6u chibi target (was 2.7 for
    // the Tripo mesh at ~0.6u tall). rotation 0 (Mixamo faces -Z).
    scale: 1.44, rotation: 0, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Trapper',
    tagline: 'Digs in. Controls ground.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Burrows forward underground' },
      { name: 'Tunnel', key: 'K', description: 'Creates a trap hole in the arena' },
      { name: 'Diggy Diggy Hole', key: 'L', description: 'Collapses terrain around self' },
    ],
  },
  {
    id: 'kowalski',
    displayName: 'Kowalski',
    glbPath: './models/critters/kowalski.glb',
    baseColor: 0x1a1a3e,
    // Mage penguin (mass 0.9) — compact. Tripo mesh origin at feet.
    scale: 2.5, rotation: -Math.PI / 2, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Mage',
    tagline: 'Calculated ranged threat.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Slides forward on ice trail' },
      { name: 'Snowball', key: 'K', description: 'Launches a ranged projectile' },
      { name: 'Ice Age', key: 'L', description: 'Freezes the arena surface briefly' },
    ],
  },
  {
    id: 'cheeto',
    displayName: 'Cheeto',
    glbPath: './models/critters/cheeto.glb',
    baseColor: 0xffaa22,
    // Assassin tiger (mass 0.7) — smallest + sleek. Tripo mesh origin at feet.
    scale: 2.3, rotation: -Math.PI / 2, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Assassin',
    tagline: 'Swift and lethal.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Lightning-fast pounce' },
      { name: 'Shadow Step', key: 'K', description: 'Teleports behind nearest enemy' },
      { name: 'Tiger Roar', key: 'L', description: 'Fear roar that pushes all enemies back' },
    ],
  },
  {
    id: 'sebastian',
    displayName: 'Sebastian',
    glbPath: './models/critters/sebastian.glb',
    baseColor: 0xcc3333,
    // Glass Cannon crab (mass 0.75). Meshy AI mesh imported 2026-04-24.
    // Source bounds Y [0, 1.147] height 1.147u, feet-at-origin (Mixamo
    // convention — the crab is now a biped humanoid rig; the 8-legs
    // morphology is collapsed to 2 generic legs, see PROCEDURAL_PARTS).
    // scale 1.40 matches the in-game ~1.6u chibi target (was 2.3 for
    // the Tripo mesh which was ~0.7u tall).
    // rotation 0: Meshy/Mixamo character faces -Z, same as Kurama.
    scale: 1.17, rotation: 0, offset: [0, 0, 0],
    physicsRadius: R, pivotY: 0,
    status: 'playable',
    role: 'Glass Cannon',
    tagline: 'One giant claw. All in.',
    plannedAbilities: [
      { name: 'Charge Rush', key: 'J', description: 'Sideways scuttle charge' },
      { name: 'Claw Sweep', key: 'K', description: 'Wide arc slash with the big pincer' },
      { name: 'Crab Slash', key: 'L', description: 'Devastating single-target claw strike' },
    ],
  },

  // --- Internal placeholders (not visible in grid, used for bots) ---
  {
    id: 'rojo', displayName: 'Rojo', glbPath: null, baseColor: 0xe74c3c,
    scale: 1.0, rotation: 0, offset: [0, 0, 0], physicsRadius: R, pivotY: 0,
    status: 'internal', role: 'Balanced', tagline: 'All-rounder. Easy to use.',
  },
  {
    id: 'azul', displayName: 'Azul', glbPath: null, baseColor: 0x3498db,
    scale: 1.0, rotation: 0, offset: [0, 0, 0], physicsRadius: R, pivotY: 0,
    status: 'internal', role: 'Skirmisher', tagline: 'Fast and light. Hit and run.',
  },
  {
    id: 'verde', displayName: 'Verde', glbPath: null, baseColor: 0x2ecc71,
    scale: 1.0, rotation: 0, offset: [0, 0, 0], physicsRadius: R, pivotY: 0,
    status: 'internal', role: 'Crusher', tagline: 'Slow but devastating.',
  },
  {
    id: 'morado', displayName: 'Morado', glbPath: null, baseColor: 0x9b59b6,
    scale: 1.0, rotation: 0, offset: [0, 0, 0], physicsRadius: R, pivotY: 0,
    status: 'internal', role: 'Glass Cannon', tagline: 'High risk, high reward.',
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
