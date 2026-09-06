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
import { DECOR_TYPES, type DecorPlacement } from './arena-decor-layouts';
import { ARENA_LOOK, type SeaRamp, type CliffRamp } from './arena-look';

/** Anisotropía máxima del dispositivo, cacheada. La fija el renderer al
 *  arrancar (`setArenaTextureAnisotropy`); sin renderer (tests, headless)
 *  se queda en 1 y las texturas se cargan igual. */
let maxAnisotropy = 1;
export function setArenaTextureAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, Math.floor(value));
  for (const tex of textureCache.values()) {
    if (tex.mapping !== THREE.EquirectangularReflectionMapping) {
      tex.anisotropy = maxAnisotropy;
      tex.needsUpdate = true;
    }
  }
}
function getMaxAnisotropy(): number { return maxAnisotropy; }

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
  /** Rampa del mar de fondo sobre el que flota la isla (fase de fondo,
   *  docs/DIORAMAS.md). Oscuro pegado al disco para que el canto se
   *  recorte, claro al alejarse para leer distancia. */
  backdrop: SeaRamp;
  /** Estratos del canto de la isla, de arriba (t = 0, el labio bajo la
   *  tapa) abajo (t = 1, la base). Es lo que convierte la pared del
   *  disco en acantilado DE ESTE bioma: roca apilada con musgo, bloques
   *  de hielo, roca roja estratificada (docs/DIORAMAS.md parte 2, fase
   *  "la isla tiene masa"). Va en vertex color; sin textura nueva. */
  cliff: CliffRamp;
  /** Per-prop uniform scale hint (default 1.0). Lets us pre-tune bulky
   *  props (the 5 MB palm, sakura tree, etc) without a second authoring
   *  pass on the GLB — applied on top of whatever the GLB ships with. */
  propScale?: Partial<Record<string, number>>;
}

// 2026-04-25: outer-ring props are intentionally EMPTY for every pack.
// The previous outer-ring system placed large props at radius 14.5–18.5
// (later tightened to 12.5–14) to "frame" the arena, but this read as
// "the playable terrain extends past where you can actually walk." All
// decoration now lives INSIDE the playable arena via DECOR_LAYOUTS in
// arena-decor-layouts.ts. The PackDef shape is kept (and `props` is
// retained) for two reasons:
//   1. Backward compat with code paths that still reference PACKS[id].props
//      (placement loops, tests). With an empty array those loops no-op.
//   2. We can still ship pack-only fogColor + propScale here without any
//      structural refactor.
// Side effect (intentional): tree_jungle_broadleaf.glb (54 MB) no longer
// loads — it was only referenced from this exterior ring.
const PACKS: Record<ArenaPackId, PackDef> = {
  jungle: {
    props: [],
    fogColor: 0xa6c68a, // warm green horizon
    // Mar de copas: verde profundo bajo la isla (la hierba del disco está
    // en L≈78, así que el dosel tiene que quedar POR DEBAJO — hoy la foto
    // estaba 44 puntos por encima) aclarando a bruma cálida al fondo.
    backdrop: { stops: [[0, 0x0c1a0f], [0.18, 0x182d1a], [0.5, 0x3f6137], [1, 0x93b483]] },
    // Labio de musgo → tierra oscura con raíces → sillares de piedra
    // tostada (los bloques de la referencia JUNGLE TROPIC) → base en
    // sombra. El verde del labio es lo que hace que la hierba parezca
    // colgar sobre el canto y no acabar en un corte.
    cliff: { stops: [[0, 0x5a6a2c], [0.14, 0x4e3620], [0.3, 0x6b4a2a], [0.5, 0x9a7a48], [0.8, 0x7e6238], [1, 0x4a3820]] },
  },
  frozen_tundra: {
    props: [],
    fogColor: 0xbcc8e0, // pale lavender ice horizon
    // Banquisa: azul frío cerca, casi blanco lejos. Es el pack más claro
    // del juego, así que su movimiento es de VALOR, no de tono; el hielo
    // va más oscuro que la tapa para que no se lea como pisable.
    backdrop: { stops: [[0, 0x152230], [0.2, 0x283d50], [0.55, 0x728ca0], [1, 0xd6e2ee]] },
    // Tapa de nieve → hielo claro → azul profundo. Es el bioma donde el
    // corte vertical cuenta más: lo que se rompe es hielo, y el azul
    // saturado bajo la nieve blanca es la firma de FROZEN TUNDRA.
    cliff: { stops: [[0, 0xf4f8fc], [0.1, 0xd6ecf8], [0.35, 0x8fd0f2], [0.65, 0x4fa4e0], [1, 0x2a6cb0]] },
  },
  desert_dunes: {
    props: [],
    fogColor: 0xeab88a, // dusty golden sunset horizon
    // Cañón de dunas: aquí el terreno CONTINÚA y la isla se lee como
    // meseta. Naranja quemado en la sombra del cañón, arena clara lejos.
    backdrop: { stops: [[0, 0x28160e], [0.16, 0x4b2d1a], [0.5, 0x9b6b3b], [1, 0xecc394]] },
    // Arena en el labio → roca roja → veta ocre → roja otra vez → base
    // oscura: la meseta estratificada de DESERT DUNES. Es la rampa con más
    // paradas porque el estrato ocre en medio es lo que la hace desierto
    // y no ladrillo.
    cliff: { stops: [[0, 0xe0aa5c], [0.1, 0xb84a2c], [0.4, 0xd48a46], [0.55, 0xa8402a], [0.8, 0xc4703e], [1, 0x74291a]] },
  },
  coral_beach: {
    props: [],
    fogColor: 0x9fd9e0, // cream-turquoise sea horizon
    // Laguna: bajío junto a la isla, turquesa somero y teal profundo al
    // alejarse. Es el peor caso de partida (57,7 % del cuadro era una
    // mancha turquesa sin un solo borde) y donde más gana lo generado.
    backdrop: { stops: [[0, 0x052126], [0.14, 0x0b3d44], [0.45, 0x25868b], [1, 0x8fdfe0]] },
    // Arena mojada → roca gris → verde-teal de algas hacia la línea de
    // agua: la roca de CORAL REEF BEACH se hunde en la laguna y la parte
    // baja del canto va del color del mar del backdrop, no del suelo.
    cliff: { stops: [[0, 0xe6d3a6], [0.12, 0x9a9a92], [0.45, 0x7a7e7a], [0.7, 0x5e8c80], [1, 0x3a5c58]] },
  },
  kitsune_shrine: {
    props: [],
    fogColor: 0xd4a8c0, // dusty pink mist
    // Mar de nubes: oscuras bajo el canto (ahí el borde del vacío llegaba
    // a tener ΔL de 1,1 — literalmente invisible) y retroiluminadas hacia
    // el ciruela del pack. A este bioma hay que SUBIRLE color, no bajarlo.
    backdrop: { stops: [[0, 0x1a141c], [0.18, 0x3a2b36], [0.5, 0x866578], [1, 0xdcc0cf]] },
    // Musgo en el labio → sillares grises apilados que se oscurecen hacia
    // la base: la muralla del patio de KITSUNE SHRINE. Sin color: aquí
    // el bermellón y los pétalos van encima, y el canto es piedra.
    cliff: { stops: [[0, 0x6b7d4a], [0.12, 0x8a877e], [0.45, 0x736f68], [0.75, 0x5e5a55], [1, 0x3f3c3a]] },
  },
};

// --- Placement -----------------------------------------------------------
//
// Props live in a ring JUST OUTSIDE the playable arena (FRAG.maxRadius
// = 12 u) so nothing collides with gameplay. An earlier pass placed
// them at 14.5–18.5 u which combined with the 12→18 skirt read as
// "extended terrain, most of which isn't walkable." We now hug the
// playable edge tightly so the props feel like they frame the arena,
// not push it out.
//
// Distribution: N angular slots equally spaced around the ring, each
// slot perturbed by a bigger wobble than the old clock-face pass, and
// a post-layout rejection-sampling pass nudges any pair of props that
// ended up uncomfortably close.

/** Inner ring radius (just outside the arena edge). */
const PROP_RING_INNER = 12.5;
/** Outer ring radius (keeps props inside the decorative skirt, which
 *  now caps at FRAG.maxRadius + 2 = 14). */
const PROP_RING_OUTER = 14.0;
/** Minimum world-space distance between any two prop centres. Enforced
 *  by a rejection pass after initial layout. Kept well below one arena
 *  band (3 u) so we still cover the ring densely enough when a pack
 *  has many props. */
const PROP_MIN_DIST = 2.4;
/** How aggressively each slot jitters around its clock position,
 *  as a fraction of the full slot width (2π / N). 0 = perfect clock,
 *  1 = can swap neighbour positions. 0.85 breaks the pattern without
 *  risking overlaps that the rejection pass can't recover from. */
const PROP_WOBBLE_FRACTION = 0.85;

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
    // Evenly spaced around the ring, with a random wobble up to
    // ±PROP_WOBBLE_FRACTION × half-slot so the composition feels natural
    // rather than clock-like. At 0.85 the wobble is almost as wide as
    // the slot itself but the rejection pass below prevents overlaps.
    const slotWidth = (Math.PI * 2) / N;
    const baseAngle = i * slotWidth;
    const wobble = (rng() - 0.5) * slotWidth * PROP_WOBBLE_FRACTION;
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
  // Rejection pass — if any two props landed within PROP_MIN_DIST of
  // each other, shift the later one along its own angular slot (small
  // step, bounded retries) to find a clean spot. Deterministic: the
  // same seed still produces the same final layout because we keep
  // using the already-seeded rng. Runs in O(N²) which is fine for
  // N ≤ 10 (every pack has 5–8 props today).
  const SHIFT_STEP = 0.08;     // ~4.6° per attempt
  const MAX_SHIFTS = 8;        // ±32° total swing worst case
  for (let i = 1; i < placements.length; i++) {
    for (let attempt = 0; attempt < MAX_SHIFTS; attempt++) {
      let tooClose = false;
      const p = placements[i]!;
      const px = Math.cos(p.angle) * p.radius;
      const pz = Math.sin(p.angle) * p.radius;
      for (let j = 0; j < i; j++) {
        const q = placements[j]!;
        const qx = Math.cos(q.angle) * q.radius;
        const qz = Math.sin(q.angle) * q.radius;
        const dx = px - qx;
        const dz = pz - qz;
        if (dx * dx + dz * dz < PROP_MIN_DIST * PROP_MIN_DIST) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      // Nudge in a deterministic direction (sign chosen from rng once
      // per retry chain so the whole sequence stays reproducible).
      const dir = rng() < 0.5 ? -1 : 1;
      p.angle += dir * SHIFT_STEP;
    }
  }
  return placements;
}

// --- Asset paths ---------------------------------------------------------

function groundTexturePath(packId: ArenaPackId): string {
  return `./images/arena-ground/${packId}.webp`;
}

function skyboxTexturePath(packId: ArenaPackId): string {
  return `./images/skyboxes/${packId}.webp`;
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
          // Tileable across the whole arena. TODAS las superficies de suelo
          // (tapas de sector, centro inmune y falda) llevan UV en
          // COORDENADAS DE MUNDO, así que un único repeat vale para las
          // tres y el tile mide `ARENA_LOOK.tileSize` unidades de mundo.
          //
          // 2026-09-06: antes era repeat 4×4 sobre UV de mundo = 4
          // repeticiones POR UNIDAD → un tile de 25 cm, ~96 en el diámetro.
          // El mipmap lo promediaba a color plano: de ahí la sensación de
          // "plato liso" pese a haber textura cargada.
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(1 / ARENA_LOOK.tileSize, 1 / ARENA_LOOK.tileSize);
          tex.anisotropy = getMaxAnisotropy();
          tex.colorSpace = THREE.SRGBColorSpace;
        } else {
          // Equirect skybox bound directly to `scene.background` via
          // setSceneSkyboxTexture. Three.js renders scene.background in
          // a built-in pre-pass that REQUIRES
          // `EquirectangularReflectionMapping` for 2:1 panoramic PNGs
          // (despite the "Reflection" name — the same mapping is used
          // for both envmaps and skybox backgrounds; Three.js dispatches
          // on the texture's role, not on the mapping flag).
          tex.mapping = THREE.EquirectangularReflectionMapping;
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
/** Rampa del mar de fondo del pack (fase de fondo, docs/DIORAMAS.md). */
export function getPackBackdrop(packId: ArenaPackId): SeaRamp {
  return PACKS[packId].backdrop;
}

export function getPackFogColor(packId: ArenaPackId): number {
  return PACKS[packId]?.fogColor ?? 0xb6d1e8;
}

/** Rampa de estratos del canto del pack (vertex color de la pared de cada
 *  fragmento, `src/arena.ts`). */
export function getPackCliff(packId: ArenaPackId): CliffRamp {
  return PACKS[packId].cliff;
}

// ---------------------------------------------------------------------------
// Per-pack decor scale — bumped 2026-04-29 for stronger pack identity
// ---------------------------------------------------------------------------
//
// Every prop in a pack is multiplied by the same factor. Picked so the
// LARGEST prop in each pack hits ≈ 4.25 u (≈ 2.5 × the unified critter
// reference height of 1.7 u — see IN_GAME_TARGET_HEIGHT in critter.ts).
// Smaller props in the pack scale proportionally so silhouettes stay
// internally consistent.
//
// Intentionally pack-scoped: each art set has different anchors (palms
// tower, tundra has horizon-flat icebergs, etc.), so a single global
// multiplier would either flatten the tundra or make the jungle absurd.
//
// Tuning anchors (target ≈ 4.25 u for the tallest prop):
//   jungle           palmtall_jungle 3.5 → 3.5 × 1.20 = 4.20  ✓
//   frozen_tundra    icebergtall/pine 2.5 → 2.5 × 1.65 = 4.13 ✓
//   desert_dunes     spiretall_desert 2.8 → 2.8 × 1.50 = 4.20 ✓
//   coral_beach      palm_beach       3.0 → 3.0 × 1.40 = 4.20 ✓
//   kitsune_shrine   sakura_shrine    3.2 → 3.2 × 1.30 = 4.16 ✓
//
// Footprint check: placements live at r 7.0–11.5; arena maxRadius is 12.
// Auto-fit scales uniformly (height + width + depth), so a prop with
// silhouette 1u wide before becomes ~1.65u wide on the heaviest pack.
// Most props sit at r ≥ 10.4 and have thin trunks (palms/totems/spires)
// so the inward extension is ≤ 0.4 u — well clear of the inner combat
// zone (r ≤ 8). Rocks/icebergs are wider but their placements were
// already authored with margin to the inner ring.
const PACK_DECOR_SCALE: Record<ArenaPackId, number> = {
  jungle:         1.20,
  frozen_tundra:  1.65,
  desert_dunes:   1.50,
  coral_beach:    1.40,
  kitsune_shrine: 1.30,
};

/**
 * Per-pack uniform multiplier on decoration silhouettes. Defaults to 1.0
 * for any pack not in the table (defensive — never breaks if a new pack
 * is added without an entry). Read by loadInArenaDecorations.
 */
export function getPackDecorScale(packId: ArenaPackId): number {
  return PACK_DECOR_SCALE[packId] ?? 1.0;
}

// ---------------------------------------------------------------------------
// In-arena decorations — small props authored in arena-decor-layouts.ts
// and parented to the fragment that contains them so they fall together.
// ---------------------------------------------------------------------------

/**
 * Result of loading one in-arena decor placement: the loaded mesh +
 * its source placement (the caller needs the placement to compute the
 * host fragment via pointInFragment).
 */
export interface InArenaDecor {
  mesh: THREE.Group;
  placement: DecorPlacement;
}

/**
 * Resolve every placement in the layout to a positioned + scaled mesh.
 * Failures (missing GLB, unknown type) silently drop that entry — a
 * match never breaks because of cosmetics.
 *
 * The mesh is pre-positioned in WORLD space (caller will reparent it to
 * the host fragment via THREE attach to preserve the world transform,
 * so the decor follows the fragment when it falls).
 */
export async function loadInArenaDecorations(
  placements: DecorPlacement[],
  packScale: number = 1.0,
): Promise<InArenaDecor[]> {
  if (placements.length === 0) return [];

  // 2026-09-07: precarga en PARALELO de los tipos únicos. El bucle de
  // abajo hacía `await loadModel(...)` DENTRO del for, así que los 16
  // props de jungle esperaban en fila por 4 GLB distintos: la arena
  // tardaba más de 20 s en poblarse y el jugador entraba a un disco
  // pelado (se ve en las capturas de línea base a t=0). Con el modelo ya
  // en la caché de model-loader, el await de dentro resuelve al instante
  // y el orden de inserción se conserva.
  const uniqueTypes = [...new Set(
    placements.map(p => DECOR_TYPES[p.type]?.glbPath).filter((v): v is string => !!v),
  )];
  await Promise.all(uniqueTypes.map(path =>
    loadModel(path).catch(err => {
      console.debug('[arena-decorations] preload failed:', path, err);
      return null;
    }),
  ));

  const out: InArenaDecor[] = [];
  for (const p of placements) {
    const type = DECOR_TYPES[p.type];
    if (!type) {
      console.debug('[arena-decorations] unknown decor type, skipping:', p.type);
      continue;
    }
    try {
      const mesh = await loadModel(type.glbPath);
      // Two-pass scaling: first measure bbox at unit scale, then auto-
      // fit to the type's displayHeight (world units), then apply the
      // per-instance placement.scale as a relative multiplier. This is
      // the same pattern Critter.attachGlbMesh uses for IN_GAME_TARGET_
      // HEIGHT — keeps the catalogue legible (per-prop heights instead
      // of opaque scale multipliers) and tolerates GLB exporters that
      // normalise to different sizes.
      // 2026-04-29 — `packScale` adds a per-pack uniform multiplier
      // (see PACK_DECOR_SCALE) so each pack hits the "≈ 2.5 × critter"
      // size target without authoring new displayHeights. Applied to
      // the fit factor so width + depth + height all scale uniformly.
      mesh.scale.setScalar(1);
      mesh.rotation.y = p.rotY;
      mesh.position.set(
        Math.cos(p.angle) * p.r,
        0,
        Math.sin(p.angle) * p.r,
      );
      mesh.updateMatrixWorld(true);
      const bboxRaw = new THREE.Box3().setFromObject(mesh);
      const measuredH = Number.isFinite(bboxRaw.max.y - bboxRaw.min.y)
        ? Math.max(0.001, bboxRaw.max.y - bboxRaw.min.y)
        : 1;
      const fitFactor = type.displayHeight / measuredH;
      mesh.scale.setScalar(fitFactor * p.scale * packScale);
      // Re-measure post-scale to ground the prop. Auto-grounding on
      // bbox.min.y matters because some IA-generated GLBs centre on
      // bbox instead of base; without this lift the prop sinks halfway
      // into the floor.
      mesh.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(mesh);
      if (Number.isFinite(bbox.min.y)) {
        mesh.position.y = -bbox.min.y;
      }
      out.push({ mesh, placement: p });
    } catch (err) {
      console.debug('[arena-decorations] in-arena decor failed to load:', p.type, err);
    }
  }
  return out;
}
