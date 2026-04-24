// ---------------------------------------------------------------------------
// In-arena decoration layouts (data-only)
// ---------------------------------------------------------------------------
//
// Source of truth for the per-pack list of small decorative props that
// live INSIDE the playable arena (radius ≤ FRAG.maxRadius). Distinct from
// the deprecated outer ring of large props in arena-decorations.ts/PACKS
// — that ring is now empty by design (felt like extended-but-non-walkable
// terrain). Decor here is small, intentional, and parented to the arena
// fragment that contains it so the prop falls when the fragment collapses.
//
// SoT shape: a pure data array per pack. Generated/edited via
// /decor-editor.html (point-and-click MVP) which exports a paste-ready
// TypeScript snippet. No runtime mutation, no code-gen — copy/paste only.
//
// Coordinates:
//   - r      world units, distance from arena origin (0 = centre).
//   - angle  radians. 0 = +X axis, π/2 = +Z axis (Three.js convention).
//   - rotY   prop rotation around its own Y axis, radians.
//   - scale  multiplier on top of the type's `scaleBase`.
//   - type   key into DECOR_TYPES below.
//
// Determinism: layouts are static literals — the SAME placements ship to
// every client. No seed needed; online rooms stay pixel-synced because
// the data is identical pre-bundle.
// ---------------------------------------------------------------------------

import type { ArenaPackId } from './arena-decorations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecorPlacement {
  /** Distance from arena origin (world units). */
  r: number;
  /** Angle in radians. 0 = +X, π/2 = +Z. */
  angle: number;
  /** Rotation around the prop's own Y axis (radians). */
  rotY: number;
  /** Uniform scale on top of DECOR_TYPES[type].scaleBase. */
  scale: number;
  /** Prop type — must exist in DECOR_TYPES. Unknown keys are silently
   *  skipped at runtime (graceful degradation if catalog drifts). */
  type: string;
}

/**
 * Catalog of in-arena prop types. Each entry resolves to a GLB path and
 * a base scale tuned so the prop reads "decorative small, not arena-
 * dominating." Reuses pack GLBs already shipping in public/models/arenas/
 * — no new assets required by this system.
 *
 * scaleBase guidelines (rules of thumb for visual height inside the
 * arena ground at FRAG.arenaHeight = 0.3):
 *   ~0.30 → reaches knee-height of a critter (~0.5 u)
 *   ~0.45 → reaches chest height (~0.9 u)
 *   ~0.60 → roughly critter-height (~1.4 u). Use sparingly so they don't
 *           obscure gameplay.
 *
 * Tall trees (palm_tall) get smaller `scaleBase` so they don't loom.
 * Tree_jungle_broadleaf is intentionally NOT in the catalog: it's a 54 MB
 * GLB and lives only in the legacy outer ring (which is now empty), so
 * the broadleaf never ships in-arena.
 */
export const DECOR_TYPES: Record<string, {
  glbPath: string;
  scaleBase: number;
  /** Optional friendly label for the editor UI. Defaults to the key. */
  label?: string;
}> = {
  // --- jungle ---
  'rock_jungle':    { glbPath: './models/arenas/jungle/stone_ruin_block.glb', scaleBase: 0.45, label: 'Rock (jungle)' },
  'totem_jungle':   { glbPath: './models/arenas/jungle/totem_tiki.glb',       scaleBase: 0.50, label: 'Totem' },
  'palm_jungle':    { glbPath: './models/arenas/jungle/tree_palm_mid.glb',    scaleBase: 0.40, label: 'Palm (mid)' },
  'palmtall_jungle':{ glbPath: './models/arenas/jungle/tree_palm_tall.glb',   scaleBase: 0.30, label: 'Palm (tall)' },

  // --- frozen_tundra ---
  'iceshard_tundra':     { glbPath: './models/arenas/frozen_tundra/ice_shard.glb',     scaleBase: 0.50, label: 'Ice shard' },
  'iceberg_tundra':      { glbPath: './models/arenas/frozen_tundra/iceberg_low.glb',    scaleBase: 0.55, label: 'Iceberg (low)' },
  'icebergmid_tundra':   { glbPath: './models/arenas/frozen_tundra/iceberg_mid.glb',    scaleBase: 0.50, label: 'Iceberg (mid)' },
  'icebergtall_tundra':  { glbPath: './models/arenas/frozen_tundra/iceberg_tall.glb',   scaleBase: 0.40, label: 'Iceberg (tall)' },
  'pine_tundra':         { glbPath: './models/arenas/frozen_tundra/pine_snow.glb',      scaleBase: 0.40, label: 'Pine (snowy)' },
  'signpost_tundra':     { glbPath: './models/arenas/frozen_tundra/signpost_wood.glb',  scaleBase: 0.55, label: 'Signpost' },

  // --- desert_dunes ---
  'cactus_desert':       { glbPath: './models/arenas/desert_dunes/cactus_saguaro.glb',          scaleBase: 0.40, label: 'Cactus' },
  'spire_desert':        { glbPath: './models/arenas/desert_dunes/sandstone_spire_short.glb',   scaleBase: 0.50, label: 'Sandstone spire (short)' },
  'spiretall_desert':    { glbPath: './models/arenas/desert_dunes/sandstone_spire_tall.glb',    scaleBase: 0.35, label: 'Sandstone spire (tall)' },
  'bones_desert':        { glbPath: './models/arenas/desert_dunes/bones_skull_scatter.glb',     scaleBase: 0.55, label: 'Bones scatter' },
  'flag_desert':         { glbPath: './models/arenas/desert_dunes/cloth_flag_tattered.glb',     scaleBase: 0.55, label: 'Tattered flag' },
  'minecart_desert':     { glbPath: './models/arenas/desert_dunes/minecart_rusted.glb',         scaleBase: 0.45, label: 'Rusted minecart' },
  'palm_desert':         { glbPath: './models/arenas/desert_dunes/palm_desert.glb',             scaleBase: 0.40, label: 'Palm (desert)' },

  // --- coral_beach ---
  'coral_beach':         { glbPath: './models/arenas/coral_beach/coral_brain.glb',           scaleBase: 0.50, label: 'Coral brain' },
  'coralpink_beach':     { glbPath: './models/arenas/coral_beach/coral_stack_pink.glb',      scaleBase: 0.50, label: 'Coral stack (pink)' },
  'coralred_beach':      { glbPath: './models/arenas/coral_beach/coral_stack_red.glb',       scaleBase: 0.50, label: 'Coral stack (red)' },
  'shell_beach':         { glbPath: './models/arenas/coral_beach/seashell_scatter.glb',      scaleBase: 0.55, label: 'Shell scatter' },
  'starfish_beach':      { glbPath: './models/arenas/coral_beach/starfish_decor.glb',        scaleBase: 0.55, label: 'Starfish' },
  'boulder_beach':       { glbPath: './models/arenas/coral_beach/boulder_wet.glb',           scaleBase: 0.45, label: 'Wet boulder' },
  'shipwreck_beach':     { glbPath: './models/arenas/coral_beach/shipwreck_hull_piece.glb',  scaleBase: 0.45, label: 'Shipwreck hull piece' },
  // palm_beach_tilted.glb (5.8 MB) — heaviest in this pack. Included for
  // composition variety; if a future build is bandwidth-sensitive,
  // reconsider. Listed in BUILD_LOG audit as the largest beach prop.
  'palm_beach':          { glbPath: './models/arenas/coral_beach/palm_beach_tilted.glb',     scaleBase: 0.35, label: 'Palm (tilted, beach)' },

  // --- kitsune_shrine ---
  'lantern_shrine':       { glbPath: './models/arenas/kitsune_shrine/stone_lantern_small.glb',  scaleBase: 0.50, label: 'Stone lantern (small)' },
  'lanternlarge_shrine':  { glbPath: './models/arenas/kitsune_shrine/stone_lantern.glb',        scaleBase: 0.45, label: 'Stone lantern (large)' },
  'bamboo_shrine':        { glbPath: './models/arenas/kitsune_shrine/bamboo_cluster.glb',       scaleBase: 0.45, label: 'Bamboo cluster' },
  'sakura_shrine':        { glbPath: './models/arenas/kitsune_shrine/sakura_tree.glb',          scaleBase: 0.35, label: 'Sakura tree' },
  'toriismall_shrine':    { glbPath: './models/arenas/kitsune_shrine/torii_gate_small.glb',     scaleBase: 0.45, label: 'Torii gate (small)' },
  'toriilarge_shrine':    { glbPath: './models/arenas/kitsune_shrine/torii_gate_large.glb',     scaleBase: 0.40, label: 'Torii gate (large)' },
  'kitsunestatue_shrine': { glbPath: './models/arenas/kitsune_shrine/kitsune_statue_white.glb', scaleBase: 0.40, label: 'Kitsune statue' },
};

/**
 * Per-pack layout — array of placements consumed by Arena.applyPack().
 * Empty arrays mean "no in-arena decor for this pack yet" — the runtime
 * skips silently. Populate via /decor-editor.html → Export.
 *
 * `jungle` ships an authored seed layout so the system has visible output
 * the first time it runs. Other packs intentionally start empty and get
 * filled per-pack as the editor is used.
 */
export const DECOR_LAYOUTS: Record<ArenaPackId, DecorPlacement[]> = {
  jungle: [
    // North-east cluster (palms framing the upper-right edge)
    { r: 10.20, angle: 0.40, rotY: 0.80, scale: 1.00, type: 'palmtall_jungle' },
    { r: 10.80, angle: 0.65, rotY: 2.10, scale: 0.90, type: 'rock_jungle' },
    { r: 10.50, angle: 0.95, rotY: 1.30, scale: 1.10, type: 'palm_jungle' },

    // North cluster (a totem facing inward + a low rock companion)
    { r: 10.40, angle: 1.55, rotY: -0.30, scale: 1.00, type: 'totem_jungle' },
    { r: 10.90, angle: 1.85, rotY: 1.90, scale: 0.85, type: 'rock_jungle' },

    // West cluster (palm flanked by rocks)
    { r: 10.60, angle: 3.10, rotY: 0.00, scale: 1.00, type: 'palm_jungle' },
    { r: 11.00, angle: 2.85, rotY: 2.60, scale: 0.95, type: 'rock_jungle' },
    { r: 10.30, angle: 3.40, rotY: 1.10, scale: 1.05, type: 'rock_jungle' },

    // South cluster (single tall palm + totem to anchor the south)
    { r: 10.50, angle: 4.55, rotY: -1.20, scale: 1.00, type: 'palmtall_jungle' },
    { r: 10.80, angle: 4.85, rotY: 0.50, scale: 0.95, type: 'totem_jungle' },

    // South-east accent (a single rock to break symmetry)
    { r: 10.40, angle: 5.55, rotY: 1.70, scale: 0.90, type: 'rock_jungle' },
  ],
  frozen_tundra:  [],
  desert_dunes:   [],
  coral_beach:    [],
  kitsune_shrine: [],
};

// ---------------------------------------------------------------------------
// Preview-in-game support — query string + localStorage bridge
// ---------------------------------------------------------------------------
//
// The /decor-editor.html "Preview in game" button writes the current
// working copy to `localStorage[decor-editor:<packId>]` and redirects
// to `/?arenaPack=<id>&decorPreview=1`. When the game boots with that
// query string, this module captures the pack id and switches
// `getDecorLayout` to read from localStorage instead of the authored
// DECOR_LAYOUTS for THAT pack only.
//
// Lifecycle:
//   - Module load (boot, both /decor-editor.html and /index.html)
//     parses the URL once. If `decorPreview=1`, `previewPackId` is set
//     to the value of `arenaPack` (if it's a valid ArenaPackId).
//   - `getDecorLayout(packId)` checks: when `packId === previewPackId`,
//     it tries to load from localStorage; on any failure it falls back
//     to DECOR_LAYOUTS[packId]. Other packs are unaffected.
//   - Production (no query string) → `previewPackId` stays null →
//     getDecorLayout always returns DECOR_LAYOUTS[packId] (existing
//     behaviour). ZERO change for normal play.
//
// localStorage shape (mirrors what /decor-editor.html writes):
//   key:   "decor-editor:<packId>"
//   value: JSON of DecorPlacement[]

const PREVIEW_STORAGE_NS = 'decor-editor';

let previewPackId: ArenaPackId | null = null;

(function initPreviewFromUrl() {
  // Module-level side-effect: only runs in browser builds. SSR-safe
  // because we guard for `typeof window`. Reads URL once at import.
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('decorPreview') !== '1') return;
    const raw = params.get('arenaPack');
    if (!raw) return;
    const validIds: readonly string[] = [
      'jungle', 'frozen_tundra', 'desert_dunes', 'coral_beach', 'kitsune_shrine',
    ];
    if (validIds.includes(raw)) {
      previewPackId = raw as ArenaPackId;
      console.info('[arena-decor-layouts] preview mode active for pack:', previewPackId);
    }
  } catch {
    /* malformed URL — silently skip */
  }
})();

/** True when the URL asked for a decor preview that we can satisfy.
 *  Used by main.ts to surface a small "preview mode" indicator + a
 *  link back to the editor, and by game.ts to force the offline pack
 *  selection so the preview actually applies on the next match. */
export function getPreviewPackId(): ArenaPackId | null {
  return previewPackId;
}

/** Read the localStorage working copy for a pack, or null on miss /
 *  corrupt data. Reused by getDecorLayout when preview is active. */
function readLocalStorageLayout(packId: ArenaPackId): DecorPlacement[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PREVIEW_STORAGE_NS}:${packId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((p) => typeof p?.r === 'number' && typeof p?.angle === 'number'
                          && typeof p?.rotY === 'number' && typeof p?.scale === 'number'
                          && typeof p?.type === 'string')) return null;
    return parsed as DecorPlacement[];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up the decor layout for a pack. When the URL activated preview
 *  mode for THIS pack, returns the localStorage working copy instead
 *  of the authored layout. Falls back to DECOR_LAYOUTS on any miss so
 *  no pack ever crashes. */
export function getDecorLayout(packId: ArenaPackId): DecorPlacement[] {
  if (previewPackId === packId) {
    const local = readLocalStorageLayout(packId);
    if (local) {
      console.info('[arena-decor-layouts] using preview layout from localStorage:', packId, local.length, 'props');
      return local;
    }
  }
  return DECOR_LAYOUTS[packId] ?? [];
}

/** Friendly label for a type, falling back to the raw key if unset. */
export function decorTypeLabel(typeKey: string): string {
  return DECOR_TYPES[typeKey]?.label ?? typeKey;
}

/** Type keys filtered by pack (using a simple "<pack>" suffix convention).
 *  Used by the editor's type dropdown. Returns sorted alphabetically.
 *
 *  Convention: a type key ending in `_<packId-prefix>` belongs to that
 *  pack. We match the pack's first segment (`jungle`, `tundra`, `desert`,
 *  `beach`, `shrine`) to allow short suffixes. Anything that doesn't
 *  match any pack flows through to "all" (rare). */
export function decorTypesForPack(packId: ArenaPackId): string[] {
  const suffix = packSuffix(packId);
  const out: string[] = [];
  for (const key of Object.keys(DECOR_TYPES)) {
    if (key.endsWith('_' + suffix)) out.push(key);
  }
  out.sort();
  return out;
}

function packSuffix(packId: ArenaPackId): string {
  switch (packId) {
    case 'jungle':         return 'jungle';
    case 'frozen_tundra':  return 'tundra';
    case 'desert_dunes':   return 'desert';
    case 'coral_beach':    return 'beach';
    case 'kitsune_shrine': return 'shrine';
  }
}
