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
 * a TARGET DISPLAY HEIGHT in world units — the loader auto-fits the prop
 * to that height regardless of the GLB's native size. Reuses pack GLBs
 * already shipping in public/models/arenas/.
 *
 * Why displayHeight (world units), not scaleBase (raw multiplier)
 * ----------------------------------------------------------------
 * Tripo/Meshy AI exporters normalise meshes to ~1.9 u on the longest
 * axis. A flat scaleBase across all GLBs ignored each prop's actual
 * silhouette — short rocks, tall palms and medium totems all came out
 * around 0.5×–0.6× critter height (1.7 u). Auto-fit by bbox to a
 * per-type displayHeight produces the cartoon proportions players
 * actually expect (palms tower over critters, rocks knee-height, etc.).
 *
 * Same pattern Critter.attachGlbMesh already uses with
 * IN_GAME_TARGET_HEIGHT — consistent across the engine.
 *
 * Reference scale anchor (do NOT change without updating sites below):
 *   critters → 1.7 u  (Critter.attachGlbMesh auto-fit)
 *
 * displayHeight rule of thumb:
 *   0.6  – scatter / floor-level (skull pile, shipwreck piece)
 *   1.0  – knee-height props (rocks, low icebergs, boulders)
 *   1.5  – chest-height props (corals, bones, ice shards)
 *   2.0  – critter-height props (totems, lanterns, signposts, cacti)
 *   2.5  – tall props (small torii, mid icebergs, pines)
 *   3.0+ – trees, large gates, sakura, palms (tower over critters)
 *
 * placement.scale is now a RELATIVE fine-tune on top of displayHeight.
 *   1.0 → exactly displayHeight high
 *   1.2 → 20% taller
 *   0.8 → 20% shorter
 * Editor sliders + export TS still read this multiplier verbatim.
 */
export const DECOR_TYPES: Record<string, {
  glbPath: string;
  /** Target world-space height (Y-axis) for this prop, in arena units.
   *  The loader auto-fits the GLB to this height by measuring its bbox
   *  and applying a uniform scale. Multiplied by placement.scale at
   *  per-instance level. Critter reference height = 1.7 u. */
  displayHeight: number;
  /** Optional friendly label for the editor UI. Defaults to the key. */
  label?: string;
}> = {
  // --- jungle ---
  'rock_jungle':    { glbPath: './models/arenas/jungle/stone_ruin_block.glb', displayHeight: 1.0, label: 'Rock (jungle)' },
  'totem_jungle':   { glbPath: './models/arenas/jungle/totem_tiki.glb',       displayHeight: 2.2, label: 'Totem' },
  'palm_jungle':    { glbPath: './models/arenas/jungle/tree_palm_mid.glb',    displayHeight: 2.8, label: 'Palm (mid)' },
  'palmtall_jungle':{ glbPath: './models/arenas/jungle/tree_palm_tall.glb',   displayHeight: 3.5, label: 'Palm (tall)' },

  // --- frozen_tundra ---
  'iceshard_tundra':     { glbPath: './models/arenas/frozen_tundra/ice_shard.glb',     displayHeight: 1.4, label: 'Ice shard' },
  'iceberg_tundra':      { glbPath: './models/arenas/frozen_tundra/iceberg_low.glb',    displayHeight: 0.9, label: 'Iceberg (low)' },
  'icebergmid_tundra':   { glbPath: './models/arenas/frozen_tundra/iceberg_mid.glb',    displayHeight: 1.8, label: 'Iceberg (mid)' },
  'icebergtall_tundra':  { glbPath: './models/arenas/frozen_tundra/iceberg_tall.glb',   displayHeight: 2.5, label: 'Iceberg (tall)' },
  'pine_tundra':         { glbPath: './models/arenas/frozen_tundra/pine_snow.glb',      displayHeight: 2.5, label: 'Pine (snowy)' },
  'signpost_tundra':     { glbPath: './models/arenas/frozen_tundra/signpost_wood.glb',  displayHeight: 1.8, label: 'Signpost' },

  // --- desert_dunes ---
  'cactus_desert':       { glbPath: './models/arenas/desert_dunes/cactus_saguaro.glb',          displayHeight: 2.0, label: 'Cactus' },
  'spire_desert':        { glbPath: './models/arenas/desert_dunes/sandstone_spire_short.glb',   displayHeight: 1.8, label: 'Sandstone spire (short)' },
  'spiretall_desert':    { glbPath: './models/arenas/desert_dunes/sandstone_spire_tall.glb',    displayHeight: 2.8, label: 'Sandstone spire (tall)' },
  'bones_desert':        { glbPath: './models/arenas/desert_dunes/bones_skull_scatter.glb',     displayHeight: 0.6, label: 'Bones scatter' },
  'flag_desert':         { glbPath: './models/arenas/desert_dunes/cloth_flag_tattered.glb',     displayHeight: 2.0, label: 'Tattered flag' },
  'minecart_desert':     { glbPath: './models/arenas/desert_dunes/minecart_rusted.glb',         displayHeight: 1.0, label: 'Rusted minecart' },
  'palm_desert':         { glbPath: './models/arenas/desert_dunes/palm_desert.glb',             displayHeight: 2.6, label: 'Palm (desert)' },

  // --- coral_beach ---
  'coral_beach':         { glbPath: './models/arenas/coral_beach/coral_brain.glb',           displayHeight: 1.2, label: 'Coral brain' },
  'coralpink_beach':     { glbPath: './models/arenas/coral_beach/coral_stack_pink.glb',      displayHeight: 1.5, label: 'Coral stack (pink)' },
  'coralred_beach':      { glbPath: './models/arenas/coral_beach/coral_stack_red.glb',       displayHeight: 1.5, label: 'Coral stack (red)' },
  'shell_beach':         { glbPath: './models/arenas/coral_beach/seashell_scatter.glb',      displayHeight: 0.6, label: 'Shell scatter' },
  'starfish_beach':      { glbPath: './models/arenas/coral_beach/starfish_decor.glb',        displayHeight: 0.7, label: 'Starfish' },
  'boulder_beach':       { glbPath: './models/arenas/coral_beach/boulder_wet.glb',           displayHeight: 0.9, label: 'Wet boulder' },
  'shipwreck_beach':     { glbPath: './models/arenas/coral_beach/shipwreck_hull_piece.glb',  displayHeight: 1.0, label: 'Shipwreck hull piece' },
  // palm_beach_tilted.glb (5.8 MB) — heaviest in this pack. Included for
  // composition variety; if a future build is bandwidth-sensitive,
  // reconsider. Listed in BUILD_LOG audit as the largest beach prop.
  'palm_beach':          { glbPath: './models/arenas/coral_beach/palm_beach_tilted.glb',     displayHeight: 3.0, label: 'Palm (tilted, beach)' },

  // --- kitsune_shrine ---
  'lantern_shrine':       { glbPath: './models/arenas/kitsune_shrine/stone_lantern_small.glb',  displayHeight: 1.4, label: 'Stone lantern (small)' },
  'lanternlarge_shrine':  { glbPath: './models/arenas/kitsune_shrine/stone_lantern.glb',        displayHeight: 1.8, label: 'Stone lantern (large)' },
  'bamboo_shrine':        { glbPath: './models/arenas/kitsune_shrine/bamboo_cluster.glb',       displayHeight: 2.4, label: 'Bamboo cluster' },
  'sakura_shrine':        { glbPath: './models/arenas/kitsune_shrine/sakura_tree.glb',          displayHeight: 3.2, label: 'Sakura tree' },
  'toriismall_shrine':    { glbPath: './models/arenas/kitsune_shrine/torii_gate_small.glb',     displayHeight: 1.8, label: 'Torii gate (small)' },
  'toriilarge_shrine':    { glbPath: './models/arenas/kitsune_shrine/torii_gate_large.glb',     displayHeight: 2.6, label: 'Torii gate (large)' },
  'kitsunestatue_shrine': { glbPath: './models/arenas/kitsune_shrine/kitsune_statue_white.glb', displayHeight: 1.6, label: 'Kitsune statue' },
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
  // ---------------------------------------------------------------------------
  // 🌴 jungle — "Templo perdido devorado por la selva"
  //   - Identidad: ruinas, palmas, vegetación invasiva.
  //   - Hero focal: palmtall_jungle (NE).
  //   - Storytelling secundario: totem (SW), bosquecillo asimétrico (NW).
  //   - Densidad ALTA — vegetación masiva en borde, anillo central limpio.
  //   - 16 props (1 en anillo medio). Sprint final 2026-04-26: clusters x2
  //     en masa visual respecto al primer pase, manteniendo legibilidad.
  // ---------------------------------------------------------------------------
  jungle: [
    // Cluster A — "Palm overgrowth" (NE 1–2h, hero focal, 5 props)
    // Hero palmtall + palm_jungle de soporte + 3 rocks en distintos r.
    { r: 10.80, angle: 0.55, rotY:  0.30, scale: 1.00, type: 'palmtall_jungle' },
    { r: 11.10, angle: 0.70, rotY:  1.40, scale: 0.95, type: 'palm_jungle'     },
    { r: 11.20, angle: 0.40, rotY:  1.70, scale: 1.10, type: 'rock_jungle'     },
    { r: 10.40, angle: 0.85, rotY:  2.50, scale: 0.90, type: 'rock_jungle'     },
    { r: 10.60, angle: 0.30, rotY:  0.80, scale: 1.05, type: 'rock_jungle'     },

    // Cluster B — "Templo enterrado" (SW 7–8h, totem + sillares, 4 props)
    { r: 10.60, angle: 3.85, rotY: -0.40, scale: 1.00, type: 'totem_jungle'    },
    { r: 11.00, angle: 3.70, rotY:  0.80, scale: 1.00, type: 'rock_jungle'     },
    { r: 10.20, angle: 4.10, rotY:  2.10, scale: 0.95, type: 'rock_jungle'     },
    { r: 10.80, angle: 4.00, rotY:  1.50, scale: 1.10, type: 'rock_jungle'     },

    // Cluster C — "Mini bosquecillo asimétrico" (NW 10–11h, 3 props)
    // Las dos palmeras NO espejean: distintos r y angle apreciables. Rock
    // al pie da masa visual al cluster.
    { r: 10.50, angle: 2.30, rotY:  1.20, scale: 1.05, type: 'palm_jungle'     },
    { r: 11.00, angle: 2.65, rotY:  2.00, scale: 0.95, type: 'palm_jungle'     },
    { r: 10.20, angle: 2.50, rotY:  0.40, scale: 0.90, type: 'rock_jungle'     },

    // Cluster D — "Outpost SE" (5h, palm secundaria + 2 rocks reforzadas)
    { r: 10.80, angle: 5.30, rotY:  1.60, scale: 1.00, type: 'palm_jungle'     },
    { r: 11.30, angle: 5.10, rotY:  0.50, scale: 0.95, type: 'rock_jungle'     },
    { r: 10.70, angle: 5.45, rotY:  1.90, scale: 1.05, type: 'rock_jungle'     },

    // Anillo medio — único prop interior (regla: máx. 1–2 sueltos)
    { r:  7.80, angle: 1.55, rotY:  2.30, scale: 0.85, type: 'rock_jungle'     },
  ],

  // ---------------------------------------------------------------------------
  // ❄️ frozen_tundra — "Llanura helada con bosque disperso"
  //   - Identidad: silencio frío, vastedad. Mantener sensación de respiro.
  //   - Heros: pine + icebergtall (orgánico + mineral en cuadrantes opuestos).
  //   - 12 props (1 en anillo medio). Refuerzos del sprint final: low ice
  //     drift al pie del pinar, ice shard entre el iceberg field, low
  //     iceberg en cluster cristalino. Cluster B ahora tiene 4 capas
  //     escalonadas en lugar de 3 (more "field" feeling).
  // ---------------------------------------------------------------------------
  frozen_tundra: [
    // Cluster A — "Pinar nevado" (NW 10h, hero orgánico, 3 props con drift)
    { r: 10.70, angle: 2.10, rotY:  0.40, scale: 1.00, type: 'pine_tundra'         },
    { r: 11.00, angle: 2.40, rotY:  1.80, scale: 1.05, type: 'pine_tundra'         },
    { r: 10.30, angle: 2.25, rotY:  2.60, scale: 0.85, type: 'iceberg_tundra'      },

    // Cluster B — "Iceberg field escalonado" (SE 4–5h, 4 props, hero mineral)
    // tall + mid + low + ice shard intercalado.
    { r: 10.60, angle: 4.65, rotY:  0.80, scale: 1.00, type: 'icebergtall_tundra'  },
    { r: 11.10, angle: 4.85, rotY:  1.50, scale: 1.05, type: 'icebergmid_tundra'   },
    { r: 10.30, angle: 4.45, rotY:  2.70, scale: 0.95, type: 'iceberg_tundra'      },
    { r: 10.90, angle: 4.55, rotY:  0.30, scale: 1.00, type: 'iceshard_tundra'     },

    // Cluster C — "Cluster cristalino" (NE 1–2h, 3 props con base de hielo)
    { r: 11.20, angle: 0.95, rotY:  0.60, scale: 1.00, type: 'iceshard_tundra'     },
    { r: 10.60, angle: 1.20, rotY:  2.40, scale: 1.10, type: 'iceshard_tundra'     },
    { r: 10.40, angle: 1.05, rotY:  1.30, scale: 0.90, type: 'iceberg_tundra'      },

    // Accent — "Wayfinder solitario" (SW 8h, off-axis intencional)
    { r: 10.50, angle: 5.60, rotY: -1.20, scale: 1.00, type: 'signpost_tundra'     },

    // Cluster D — "Far iceberg pair" (12h ~N puro, dos low icebergs distantes)
    { r: 11.40, angle: 1.55, rotY:  0.50, scale: 0.85, type: 'iceberg_tundra'      },

    // Anillo medio — micro-scatter (low iceberg en zona vacía E)
    { r:  7.50, angle: 0.20, rotY:  1.30, scale: 0.90, type: 'iceberg_tundra'      },
  ],

  // ---------------------------------------------------------------------------
  // 🌵 desert_dunes — "Old west + civilización perdida"
  //   - Identidad: aridez, espacios largos, highlights con storytelling.
  //   - Densidad CONTROLADA — los huecos son la composición; refuerzos
  //     hechos solo dentro de los clusters existentes.
  //   - 3 clusters en triángulo casi equilátero (separación ≥ 90°).
  //   - 11 props totales. Cuadrantes vacíos: NE (~3h) y W (~9h).
  // ---------------------------------------------------------------------------
  desert_dunes: [
    // Cluster A — "Sandstone forest" (N 12h, 4 props, mini-monolitos)
    // 1 spiretall + 2 spires + bones (alguien intentó llegar y no volvió).
    { r: 11.00, angle: 1.55, rotY:  0.30, scale: 1.00, type: 'spiretall_desert' },
    { r: 11.40, angle: 1.30, rotY:  1.10, scale: 0.95, type: 'spire_desert'     },
    { r: 10.70, angle: 1.85, rotY:  2.40, scale: 1.05, type: 'spire_desert'     },
    { r: 10.40, angle: 1.55, rotY:  0.70, scale: 1.00, type: 'bones_desert'     },

    // Cluster B — "Oasis muerto" (SE 4h, 4 props, hero orgánico)
    // palm + cactus saguaro + cactus secundario + bones al pie.
    { r: 10.80, angle: 5.65, rotY: -0.50, scale: 1.00, type: 'palm_desert'      },
    { r: 11.20, angle: 5.95, rotY:  0.70, scale: 1.05, type: 'cactus_desert'    },
    { r: 11.10, angle: 5.40, rotY:  2.20, scale: 0.85, type: 'cactus_desert'    },
    { r: 10.40, angle: 5.45, rotY:  1.40, scale: 1.10, type: 'bones_desert'     },

    // Cluster C — "Wreckage" (SW 8h, 3 props, storytelling abandonado)
    // minecart + flag + bones del conductor → mini-escena clara.
    { r: 10.60, angle: 3.55, rotY:  2.00, scale: 1.10, type: 'minecart_desert'  },
    { r: 11.00, angle: 3.85, rotY: -1.20, scale: 1.05, type: 'flag_desert'      },
    { r: 10.40, angle: 3.70, rotY:  0.90, scale: 1.00, type: 'bones_desert'     },
  ],

  // ---------------------------------------------------------------------------
  // 🐠 coral_beach — "Playa coral con restos de naufragio"
  //   - Identidad: tropical vibrante, vida marina, naufragio.
  //   - Densidad ALTA orgánica. Tide line IRREGULAR (no arco perfecto).
  //   - Heros: palm_beach (S) + shipwreck (NW).
  //   - 17 props (1 en anillo medio). Sprint final: garden y tide
  //     reforzados con starfish + shells extras + coralpink/red en
  //     posiciones intermedias para "caos natural bonito".
  // ---------------------------------------------------------------------------
  coral_beach: [
    // Cluster A — "Wrecked coast" (NW 10h, 4 props, storytelling)
    { r: 10.70, angle: 2.00, rotY:  1.50, scale: 1.00, type: 'shipwreck_beach' },
    { r: 11.20, angle: 2.25, rotY:  0.40, scale: 1.10, type: 'boulder_beach'   },
    { r: 10.40, angle: 1.85, rotY:  2.70, scale: 1.00, type: 'shell_beach'     },
    { r: 11.00, angle: 1.95, rotY:  0.20, scale: 1.05, type: 'starfish_beach'  },

    // Cluster B — "Coral garden" (NE 2h, 5 props, vibrancia máxima)
    { r: 10.80, angle: 0.95, rotY:  0.60, scale: 1.00, type: 'coral_beach'     },
    { r: 11.10, angle: 1.15, rotY:  1.80, scale: 1.05, type: 'coralpink_beach' },
    { r: 10.50, angle: 0.70, rotY:  2.30, scale: 1.00, type: 'coralred_beach'  },
    { r: 11.40, angle: 1.30, rotY:  0.90, scale: 0.90, type: 'shell_beach'     },
    { r: 11.00, angle: 0.85, rotY:  1.40, scale: 1.10, type: 'starfish_beach'  },

    // Cluster C — "Palm + roca + estrella + shell" (S 6h, hero focal, 4 props)
    { r: 10.50, angle: 4.70, rotY:  0.20, scale: 1.00, type: 'palm_beach'      },
    { r: 11.00, angle: 4.45, rotY:  1.60, scale: 1.05, type: 'boulder_beach'   },
    { r: 10.30, angle: 4.95, rotY:  2.50, scale: 1.10, type: 'starfish_beach'  },
    { r: 10.80, angle: 4.85, rotY:  0.90, scale: 0.95, type: 'shell_beach'     },

    // Tide line IRREGULAR — 3 props dispersos, distintos r y angle dispar
    { r: 11.50, angle: 3.40, rotY:  1.00, scale: 0.90, type: 'starfish_beach'  },
    { r: 10.90, angle: 5.95, rotY:  2.20, scale: 1.00, type: 'shell_beach'     },
    { r: 11.30, angle: 2.80, rotY:  1.70, scale: 0.95, type: 'shell_beach'     },

    // Cluster D — "Coral accent" (SW outer 8h, mini-cluster del coral garden)
    // Pareja pequeña de pink+red corals para conectar visualmente con B.
    { r: 11.10, angle: 3.80, rotY:  0.30, scale: 0.90, type: 'coralpink_beach' },

    // Anillo medio — único accent (starfish en zona SW)
    { r:  7.00, angle: 3.20, rotY:  0.80, scale: 0.90, type: 'starfish_beach'  },
  ],

  // ---------------------------------------------------------------------------
  // ⛩️ kitsune_shrine — "Santuario ritual entre bambúes y cerezos"
  //   - Identidad: sereno, ritual, simetría parcial.
  //   - Heros: sakura (S) + toriilarge (N), eje N–S claro.
  //   - Bamboo groves espejean E/W. Toriis y kitsune miran al centro.
  //   - Asymmetry breaker: small torii rompe en RADIO (mid ring) y ángulo.
  //   - 15 props (2 en anillo medio). Sprint final: lanterns en ambos lados
  //     de la torii grande, lantern extra en altar sakura, lantern entre
  //     bambúes en cada grove (refuerza simetría parcial).
  // ---------------------------------------------------------------------------
  kitsune_shrine: [
    // Cluster A — "Ritual gate" (N 12h, 3 props, hero arquitectónico)
    // Torii grande mira al centro. Lanterns flanqueando como entrada ritual.
    { r: 11.00, angle: 1.55, rotY:  0.00, scale: 1.00, type: 'toriilarge_shrine'    },
    { r: 10.50, angle: 1.30, rotY:  0.50, scale: 1.05, type: 'lantern_shrine'       },
    { r: 10.50, angle: 1.80, rotY: -0.50, scale: 1.05, type: 'lantern_shrine'       },

    // Cluster B — "Sakura altar" (S 6h, 4 props, hero orgánico + ritual)
    // En S (angle≈4.71), rotY=π hace que las cosas miren hacia el centro.
    { r: 10.80, angle: 4.71, rotY:  0.00, scale: 1.00, type: 'sakura_shrine'        },
    { r: 11.00, angle: 4.55, rotY:  3.14, scale: 1.05, type: 'kitsunestatue_shrine' },
    { r: 10.50, angle: 4.95, rotY:  3.14, scale: 1.00, type: 'lanternlarge_shrine'  },
    { r: 10.40, angle: 4.55, rotY:  2.80, scale: 0.90, type: 'lantern_shrine'       },

    // Cluster C — "Bamboo grove E" (E 3h, 3 props con lantern interior)
    { r: 10.70, angle: -0.10, rotY:  1.20, scale: 1.00, type: 'bamboo_shrine'       },
    { r: 11.20, angle:  0.15, rotY:  2.50, scale: 1.05, type: 'bamboo_shrine'       },
    { r: 10.40, angle:  0.05, rotY:  1.50, scale: 0.95, type: 'lantern_shrine'      },

    // Cluster C' — "Bamboo grove W" (W 9h, 3 props, espejo angular de C)
    { r: 10.70, angle:  3.05, rotY:  0.70, scale: 1.00, type: 'bamboo_shrine'       },
    { r: 11.20, angle:  3.30, rotY:  2.00, scale: 1.05, type: 'bamboo_shrine'       },
    { r: 10.40, angle:  3.20, rotY:  0.80, scale: 0.95, type: 'lantern_shrine'      },

    // Asymmetry breaker — small torii rompe AMBOS ejes (radio + ángulo).
    { r:  8.50, angle: 2.40, rotY: -0.80, scale: 1.00, type: 'toriismall_shrine'    },

    // Anillo medio — lantern small en SW (más fuera del centro, off-axis sutil).
    { r:  7.80, angle: 5.50, rotY:  1.50, scale: 0.95, type: 'lantern_shrine'       },
  ],
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
