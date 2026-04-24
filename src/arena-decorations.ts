// ---------------------------------------------------------------------------
// Arena decorations — cosmetic pack swap per match (jungle / tundra / desert /
// beach / shrine). Chosen randomly offline, server-picked in online rooms.
// ---------------------------------------------------------------------------
//
// What a "pack" does:
//   1. Swaps the sky dome material for the pack's equirect skybox texture.
//   2. Swaps scene.fog colour so the horizon blends with the new sky.
//   3. Tints the arena fragments' top material with the pack's ground
//      texture (tileable PNG). Fragment geometry / collapse is untouched.
//   4. Scatters the pack's GLB props around the arena in a ring outside
//      the playable radius (r 14–18). Placement is deterministic from the
//      match seed so every client sees the same layout.
//
// Non-goals for this first cut:
//   - Ambient audio per pack (future item, signals can be added on top).
//   - Animated props (all static meshes — cheap and well-optimised).
//   - Per-pack lighting rig tweaks (relying on the existing global
//     three-point lighting in main.ts).
//
// Failure mode: if any asset of a pack 404s (GLB, skybox, ground tile),
// we swallow the error and fall back to the "jungle" defaults — a match
// never breaks because of missing cosmetics. Logs at debug level.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loadModel } from './model-loader';

// --- Public API ----------------------------------------------------------

export const ARENA_PACK_IDS = [
  'jungle',
  'frozen_tundra',
  'desert_dunes',
  'coral_beach',
  'kitsune_shrine',
] as const;

export type ArenaPackId = (typeof ARENA_PACK_IDS)[number];

/**
 * Runtime check that a string coming from the network (or URL) is one of
 * the supported packs. Used at both client and server boundary to reject
 * garbage without crashing.
 */
export function isArenaPackId(v: unknown): v is ArenaPackId {
  return typeof v === 'string'
    && (ARENA_PACK_IDS as readonly string[]).includes(v);
}

/**
 * Pick a pack uniformly at random. Used in offline matches and as the
 * server's source of truth when a new online match starts.
 */
export function getRandomPackId(): ArenaPackId {
  const i = Math.floor(Math.random() * ARENA_PACK_IDS.length);
  return ARENA_PACK_IDS[i]!;
}

// --- Pack catalog --------------------------------------------------------
//
// Each entry lists: the GLB filenames in public/models/arenas/<id>/, the
// fog colour that blends with the pack's skybox, and any per-prop scale
// hints. Placement (angle / radius / rotY) is computed at runtime from
// the arena seed so two clients in the same room see identical layouts.

interface PackDef {
  /** Relative GLB filenames in public/models/arenas/<id>/. */
  props: string[];
  /** Fog colour (hex). Picked to match the horizon band of the skybox. */
  fogColor: number;
  /** Per-prop uniform scale hint (default 1.0). Lets us pre-tune bulky
   *  props (the 5 MB palm, sakura tree, etc) without a second authoring
   *  pass on the GLB — applied on top of whatever the GLB ships with. */
  propScale?: Partial<Record<string, number>>;
}

const PACKS: Record<ArenaPackId, PackDef> = {
  jungle: {
    props: [
      'tree_palm_tall.glb',
      'tree_palm_mid.glb',
      'tree_jungle_broadleaf.glb',
      'totem_tiki.glb',
      'stone_ruin_block.glb',
    ],
    fogColor: 0xa6c68a, // warm green horizon
    propScale: {
      // broadleaf is the beast of the pack (54 MB, 1M+ tris). Shrink so
      // it doesn't loom unnaturally over the arena.
      'tree_jungle_broadleaf.glb': 0.7,
    },
  },
  frozen_tundra: {
    props: [
      'iceberg_tall.glb',
      'iceberg_mid.glb',
      'iceberg_low.glb',
      'ice_shard.glb',
      'pine_snow.glb',
      'signpost_wood.glb',
    ],
    fogColor: 0xbcc8e0, // pale lavender ice horizon
  },
  desert_dunes: {
    props: [
      'sandstone_spire_tall.glb',
      'sandstone_spire_short.glb',
      'cactus_saguaro.glb',
      'palm_desert.glb',
      'minecart_rusted.glb',
      'bones_skull_scatter.glb',
      'cloth_flag_tattered.glb',
    ],
    fogColor: 0xeab88a, // dusty golden sunset horizon
  },
  coral_beach: {
    props: [
      'coral_stack_red.glb',
      'coral_stack_pink.glb',
      'coral_brain.glb',
      'palm_beach_tilted.glb',
      'shipwreck_hull_piece.glb',
      'boulder_wet.glb',
      'seashell_scatter.glb',
      'starfish_decor.glb',
    ],
    fogColor: 0x9fd9e0, // cream-turquoise sea horizon
  },
  kitsune_shrine: {
    props: [
      'torii_gate_large.glb',
      'torii_gate_small.glb',
      'stone_lantern.glb',
      'stone_lantern_small.glb',
      'bamboo_cluster.glb',
      'sakura_tree.glb',
      'kitsune_statue_white.glb',
    ],
    fogColor: 0xd4a8c0, // dusty pink mist
  },
};

// --- Placement -----------------------------------------------------------
//
// Props live in a ring OUTSIDE the playable arena (FRAG.maxRadius = 12 u)
// so nothing collides with gameplay. Given the seed, we distribute props
// equidistantly around the ring and jitter each slot a tiny bit so the
// result doesn't look like a clock face.

/** Inner ring radius (just outside the arena edge). */
const PROP_RING_INNER = 14.5;
/** Outer ring radius (visible but not clipping the skybox). */
const PROP_RING_OUTER = 18.5;

export interface PropPlacement {
  /** Relative filename in public/models/arenas/<packId>/. */
  glbName: string;
  angle: number;
  radius: number;
  rotY: number;
  scale: number;
}

/** Deterministic PRNG so seed + packId map to identical placements on
 *  every client (required for online rooms). */
function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a placement list for the given pack. The layout is deterministic
 * in (seed, packId): both clients of an online match compute the exact
 * same list, so the props line up even though nothing about placement is
 * sent over the wire (it's all derived from the already-synced arenaSeed
 * + arenaPackId fields).
 */
export function layoutPackProps(packId: ArenaPackId, seed: number): PropPlacement[] {
  const pack = PACKS[packId];
  if (!pack) return [];
  // Mix seed with a per-pack hash so two packs with the same seed still
  // look different in placements (shouldn't happen in practice since the
  // pack is fixed per match, but it keeps the function properly scoped).
  const hash = packId
    .split('')
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const rng = mulberry32(seed ^ hash);
  const N = pack.props.length;
  const placements: PropPlacement[] = [];
  for (let i = 0; i < N; i++) {
    const glbName = pack.props[i]!;
    // Evenly spaced around the ring, with a small random wobble so the
    // composition feels natural rather than clock-like.
    const baseAngle = (i / N) * Math.PI * 2;
    const wobble = (rng() - 0.5) * (Math.PI / N) * 0.6;
    const angle = baseAngle + wobble;
    const radius = PROP_RING_INNER + rng() * (PROP_RING_OUTER - PROP_RING_INNER);
    const rotY = rng() * Math.PI * 2;
    // Props come in wildly different scales (0.4 m starfish vs 5.5 m
    // torii). The GLB ships with its intended size; we add a small
    // per-instance variation (0.9..1.15) plus an optional pack-level
    // override for trouble props.
    const baseScale = pack.propScale?.[glbName] ?? 1.0;
    const jitter = 0.9 + rng() * 0.25;
    placements.push({
      glbName,
      angle,
      radius,
      rotY,
      scale: baseScale * jitter,
    });
  }
  return placements;
}

// --- Asset paths ---------------------------------------------------------

function groundTexturePath(packId: ArenaPackId): string {
  return `./images/arena-ground/${packId}.png`;
}

function skyboxTexturePath(packId: ArenaPackId): string {
  return `./images/skyboxes/${packId}.png`;
}

function propGlbPath(packId: ArenaPackId, glbName: string): string {
  return `./models/arenas/${packId}/${glbName}`;
}

// --- Texture cache -------------------------------------------------------
//
// Both ground and skybox textures are reused every time the same pack
// plays, so cache them per-session. GLBs are cached by model-loader's
// own layer — no need to replicate that here.

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function loadTexture(path: string, mode: 'ground' | 'skybox'): Promise<THREE.Texture> {
  const cached = textureCache.get(path);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      (tex) => {
        if (mode === 'ground') {
          // Tileable across the whole arena. The ground shader uses UV
          // coords from ExtrudeGeometry so a single repeat is enough for
          // each fragment — the pattern loops naturally between sectors.
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(4, 4);
          tex.colorSpace = THREE.SRGBColorSpace;
        } else {
          // Equirect skybox painted on the inside of a sphere (MeshBasic +
          // BackSide in main.ts). The sphere's built-in UVs already map a
          // 2:1 equirect texture correctly (u = longitude, v = latitude),
          // so we leave `mapping` at its default (UVMapping) — the
          // EquirectangularReflectionMapping flag is for environment
          // reflection lookups on PBR materials, NOT for flat "paint the
          // inside of a sphere" skyboxes. Using it here was the cause of
          // the flat-colour skyboxes reported after first pack integration.
          tex.mapping = THREE.UVMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        textureCache.set(path, tex);
        resolve(tex);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

// --- Public loaders ------------------------------------------------------

/**
 * Asynchronously load the ground texture for a pack. Resolves to the
 * shared cached Texture on subsequent calls. Rejects if the asset 404s;
 * callers should fall back to a vanilla MeshStandardMaterial on error.
 */
export function loadPackGroundTexture(packId: ArenaPackId): Promise<THREE.Texture> {
  return loadTexture(groundTexturePath(packId), 'ground');
}

/** Equirectangular skybox texture for the pack. */
export function loadPackSkyboxTexture(packId: ArenaPackId): Promise<THREE.Texture> {
  return loadTexture(skyboxTexturePath(packId), 'skybox');
}

/**
 * Resolve the GLB scenes for each prop in the pack. Uses the shared
 * model-loader cache so a repeated pack in the same session doesn't
 * re-download. Returns same-order array as `placement`.
 */
export async function loadPackPropMeshes(
  packId: ArenaPackId,
  placements: PropPlacement[],
): Promise<THREE.Group[]> {
  const loads = placements.map(async (p) => {
    try {
      const model = await loadModel(propGlbPath(packId, p.glbName));
      // Apply scale FIRST so the bbox we measure next is in world units.
      model.scale.setScalar(p.scale);
      // Some IA-generated GLBs ship with their origin NOT at the base —
      // the mesh is centred on its bounding box instead. If we placed
      // them at Y=0 as-is the prop would sink by half its height and
      // look like it's cut by the floor. Measure the bbox and offset
      // Y so the MIN of the bbox lands on Y=0 (the arena floor level).
      model.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(model);
      const groundOffset = -bbox.min.y; // lift the mesh so min.y becomes 0
      model.position.set(
        Math.cos(p.angle) * p.radius,
        Number.isFinite(groundOffset) ? groundOffset : 0,
        Math.sin(p.angle) * p.radius,
      );
      model.rotation.y = p.rotY;
      return model;
    } catch (e) {
      console.debug('[arena-decorations] prop failed to load:', packId, p.glbName, e);
      return new THREE.Group(); // empty placeholder; no visual, no crash
    }
  });
  return Promise.all(loads);
}

/** Fog colour for the pack, used to tint scene.fog when the pack loads. */
export function getPackFogColor(packId: ArenaPackId): number {
  return PACKS[packId]?.fogColor ?? 0xb6d1e8;
}
