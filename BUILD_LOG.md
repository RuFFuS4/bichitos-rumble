# Build Log — Bichitos Rumble

> **Active entries from 2026-04-20 onward.** The first two weeks of
> development (prototype → roster → first public deploy → online 4P →
> gamepad → skeletal loader → /animations lab → arena shake) are
> archived verbatim in
> [`docs/archive/BUILD_LOG-pre-launch-2026.md`](docs/archive/BUILD_LOG-pre-launch-2026.md).
> If you need context for a decision older than 2026-04-20, look there.

---

## 2026-04-25 — Decor scale fix (scaleBase → displayHeight) + tool-storage shared

Two follow-ups on top of the Preview-in-game iteration. Both surfaced
during visual validation: props rendered ridiculously small next to
critters, and the editor / game / future tools were all carrying
duplicated localStorage helpers.

### Scale diagnosis (root cause)

Native bbox audit of all 33 decor GLBs:
- 30 of 33 export at ~1.9 u on the longest axis (Tripo / Meshy AI's
  default normalisation). 4 jungle assets ship as KHR_mesh_quantized
  (raw int16 = 16383 in the buffer), but Three.js dequantises them
  back to ~1.9 u at load — same target.
- The previous catalog used `scaleBase: 0.30..0.55` directly as a
  multiplier of the native size. With ~1.9 u native, that produced
  final heights of 0.57–1.05 u. Critters auto-fit to 1.7 u (see
  Critter.attachGlbMesh / IN_GAME_TARGET_HEIGHT).
- Result: every prop landed at 33–60% of critter height. Palms and
  trees came out shorter than the critters that should walk past them.

### Solution: `displayHeight` (target world units) + bbox auto-fit

Mirrors the pattern Critter.attachGlbMesh already uses (auto-fit to
IN_GAME_TARGET_HEIGHT). Same approach for decor:

- `DECOR_TYPES[<key>].scaleBase` → renamed to `displayHeight`. New
  value is the TARGET silhouette height in arena units.
- `loadInArenaDecorations` (arena-decorations.ts) and
  `rebuildPreviewGroup` (decoreditor/main.ts) both now run a
  two-pass scale: measure bbox at unit-scale → factor = displayHeight
  / measuredHeight → final scale = factor × placement.scale.
- `placement.scale` keeps its semantic but now means "relative
  multiplier on top of the type's authored displayHeight" (1.0 = the
  intended size, 1.5 = 50% taller). Slider range tightened to
  0.5..1.6 to reflect the new meaning.

Authored displayHeights, by silhouette tier:
  scatter / floor      0.6     skull pile, shipwreck piece
  knee-height          0.9–1.0 rocks, low icebergs, boulders
  chest-height         1.4–1.5 ice shards, bones, corals
  critter-height       1.6–2.0 totems, lanterns, signposts, cacti
  tall                 2.4–2.8 small torii, mid icebergs, bamboo, palms (mid)
  tower-over           3.0–3.5 large torii, sakura, palms (tall)

Editor UX:
- Selected-prop header now reads e.g. `Palm (tall) ≈ 3.50 u (2.1×
  critter)` so the operator sees both the absolute height and the
  ratio against a critter (1.7 u reference). Updates live as the
  scale slider moves.
- Hint paragraph under the slider explains that `1.00 = author intent`
  and that the badge above is the resulting world-space height.
- GLB preview toggle now matches what the game renders (same auto-fit
  formula); calibrating in the editor and seeing the result in-game
  no longer drift.

Smoke validated in dev: all 11 jungle props reparent correctly, scale
factors land at 1.844 / 0.733 / 1.627 / 1.159 / ... — visually palms
tower over critters, rocks read knee-height, totems sit at critter
height. Cartoon proportions match the design intent.

### tool-storage shared helper

New module: `src/tools/tool-storage.ts`. Five helpers + a key builder:

  toolStorageKey(toolName, entityId)
  loadFromStorage<T>(key, validator?)
  saveToStorage(key, value)
  clearStorage(key)
  hasStorageKey(key)
  storageDivergesFromCode(key, codeRef)

SSR-safe (guards on `typeof window`), silently degrades on quota /
disabled / Safari-private-mode failures, validators are optional.
Code-divergence comparison is JSON-stringify based — cheap and the
editor payloads are <1 KB.

Migrated /decor-editor.html to use it. /calibrate.html and /anim-lab
.html were intentionally LEFT UNTOUCHED — both work today and the
goal is "establish the contract", not "force-migrate everything in
one PR". When either of those gets its next iteration, the lift is
trivial (drop the inline helpers, import the module). Doc note left
in tool-storage.ts.

### Files touched

- src/arena-decor-layouts.ts   (DECOR_TYPES scaleBase → displayHeight)
- src/arena-decorations.ts     (loadInArenaDecorations bbox auto-fit)
- src/decoreditor/main.ts      (preview auto-fit + UX hint + tool-storage)
- decor-editor.html            (slider hint + range tightened)
- src/tools/tool-storage.ts    (NEW shared module)
- BUILD_LOG.md / DEV_TOOLS.md / MEMORY.md / NEXT_STEPS.md

Preflight green: tsc client + server clean, vite build 6.34s, manual
smoke validated drag → preview → match render with correct cartoon
proportions.

Limitations / deferred:
- /calibrate and /anim-lab still embed their own inline localStorage
  helpers. Comment in tool-storage.ts marks them as candidates for the
  next iteration.
- "Export patch + apply script" workflow (auto-write to source files
  from a tool's localStorage state) is the natural next step but
  deliberately not in this commit. Plan: emit a typed JSON patch +
  ship `scripts/apply-tool-patch.mjs` that consumes it. Tracked in
  NEXT_STEPS.

---

## 2026-04-25 — Decor editor: Preview in game + DECOR_TYPES audit (+12 props)

Two small but consequential additions on top of the v2 UX iteration.

### Preview in game

New "Preview in game" button in /decor-editor.html. Saves the current
working copy to `localStorage[decor-editor:<packId>]` (the same key
the editor already uses) and opens the game in a new tab with
`/?arenaPack=<id>&decorPreview=1`. The game side honours that combo
and substitutes the localStorage layout for `DECOR_LAYOUTS[packId]`
on the next offline match — only for that pack, only when the flag
is on. Production builds without those query params are unchanged.

Wiring (3 small touches):
- `src/arena-decor-layouts.ts`
  - Captures `previewPackId` once at module load by parsing
    `window.location.search`. Validates against the pack id whitelist
    so a typo or stale URL just falls through to normal play.
  - `getDecorLayout(packId)` checks: when `packId === previewPackId`
    AND the localStorage entry is structurally valid, returns it.
    Otherwise returns `DECOR_LAYOUTS[packId]` exactly like before.
  - New export `getPreviewPackId()` lets callers know which pack is
    pinned (or `null` if normal mode).
- `src/game.ts`
  - The offline match path that used to call `getRandomPackId()`
    unconditionally now does `getPreviewPackId() ?? getRandomPackId()`.
    Online path untouched — server is authoritative there.
- `src/main.ts`
  - When `getPreviewPackId()` returns non-null at boot, paints a small
    fixed banner top-centre: "🎨 Preview: <pack> ← back to editor".
    The link href is `/decor-editor.html`. Banner is HTML+inline CSS
    only; no new module, no new asset.

`SoT remains the export`. localStorage is the working buffer; only
copy-paste into `arena-decor-layouts.ts` actually ships. The preview
exists so the user can iterate visually without that round-trip.

End-to-end smoke confirmed: drag a prop → click "Preview in game" →
new tab opens at `/?arenaPack=jungle&decorPreview=1` → banner
visible → start match → arena.appliedPackId = "jungle" + 12 props
reparented (the 11 authored + 1 dragged), not the 11 from code.

### DECOR_TYPES audit + expansion (+12 props)

Cross-checked `public/models/arenas/<pack>/*.glb` (33 GLBs total)
against the catalog. Found 12 valid props that the prior catalog
missed. Conservative: the 54 MB `tree_jungle_broadleaf.glb` stays
deliberately excluded; the 5.8 MB `palm_beach_tilted.glb` is included
but called out as the heaviest entry.

Props added (with file size + new key):

  frozen_tundra (+2):
    icebergmid_tundra      iceberg_mid.glb         248 KB
    icebergtall_tundra     iceberg_tall.glb        319 KB

  desert_dunes (+3):
    spiretall_desert       sandstone_spire_tall.glb  361 KB
    minecart_desert        minecart_rusted.glb       830 KB
    palm_desert            palm_desert.glb           829 KB

  coral_beach (+4):
    coralpink_beach        coral_stack_pink.glb       743 KB
    coralred_beach         coral_stack_red.glb        877 KB
    shipwreck_beach        shipwreck_hull_piece.glb   629 KB
    palm_beach             palm_beach_tilted.glb    5 858 KB ⚠ heaviest

  kitsune_shrine (+3):
    lanternlarge_shrine    stone_lantern.glb          719 KB
    sakura_shrine          sakura_tree.glb          2 720 KB
    toriilarge_shrine      torii_gate_large.glb       257 KB

Excluded (and why):

  jungle:
    tree_jungle_broadleaf.glb  53 982 KB — single asset is ~half the
                                pre-launch payload. Not catalog-worthy
                                until a re-export trims it, even at
                                small scale; the loader still pulls
                                the full 54 MB to decode.

Result: catalog grew from 20 → 32 entries. Editor type dropdown now
shows 4 / 6 / 7 / 8 / 7 props per pack (was 4 / 4 / 4 / 4 / 4).

Files touched:
- src/arena-decor-layouts.ts  (DECOR_TYPES expanded + preview support)
- src/game.ts                 (+1 import, +1 helper call)
- src/main.ts                 (+1 import, +banner block)
- src/decoreditor/main.ts     (+button ref + handler)
- decor-editor.html           (+Preview section + button)
- BUILD_LOG.md / DEV_TOOLS.md / MEMORY.md (docs)

Preflight all green: tsc (client + server), verify-glbs 8/8, vite
build 4.42s, manual smoke validated drag → preview → match render
+ 12 reparented props from localStorage.

Limitations / deferred:
- localStorage layer not yet unified across editors (calibrate /
  anim-lab still each define their own helpers). Comment in code
  notes the lift, but scope is intentionally tight here.
- "Preview in game" opens a new tab; if the user has popups blocked
  the editor falls back to in-tab navigation. Either way the back-
  to-editor link covers the round trip.
- No "preview is stale" warning when the user re-edits the source TS
  while the preview tab is open. Not worth the complexity now —
  manual reload of the preview tab is enough.

---

## 2026-04-25 — In-arena decor system + decor-editor + skybox fix

Three interlocking moves to stabilise the arena visual layer.

### 1. Skybox no longer clipped

`skyDome` had radius 200 and `camera.far` was also 200 — the dome's
far hemisphere reached ~370 u from the camera's offset position
(0, 23, 25), so a chunk of any pack-textured equirect got clipped by
the projection. Reduced `SKYDOME_RADIUS` to 150 (+ shader normalisation
constant updated to match) so the dome stays safely inside the
frustum. Validated in all 5 packs — full sky horizons render, no
black gaps.

### 2. In-arena decor system

Replaces the legacy outer-ring of large props with **small props
INSIDE the playable arena**, parented to the fragment that contains
each prop so the prop falls together when that sector collapses. No
new falling-state machine — Three.js parent transforms do it for free
once the mesh is reparented via `Object3D.attach`.

- New SoT: `src/arena-decor-layouts.ts`
  - `DECOR_TYPES` catalog: 20 entries (4 per pack), all reusing GLBs
    already shipped under `public/models/arenas/<pack>/` — no new
    assets. Tree_jungle_broadleaf.glb (54 MB) intentionally OMITTED
    from the catalog and the legacy outer ring is now empty for every
    pack, so that GLB no longer loads at runtime.
  - `DECOR_LAYOUTS[packId]`: array literal per pack. `jungle` ships
    an authored 11-prop seed; the other 4 packs start empty.
- Runtime path:
  - `loadInArenaDecorations(placements)` in `arena-decorations.ts` —
    async loader, auto-grounds via bbox.min.y (Meshy/Tripo origin
    inconsistencies fixed at load).
  - `Arena.findFragmentAt(x, z)` — uses `pointInFragment` to resolve
    a prop to its host fragment. -1 = skip (out of arena).
  - `Arena.applyPack()` reparents each prop via `host.attach(mesh)`
    after the pack's outer-ring + skybox + ground texture finish.
- Skirt outer radius reduced 14 → 12.5 (FRAG.maxRadius + 0.5). The
  skirt is now just a 0.5 u anti-gap with the skybox lower hemisphere
  — no longer reads as extended-but-non-walkable terrain.

Validated: 11 jungle props reparent correctly (`decorReparented: 11`
in scene-graph crawl). Reparenting math verified by moving a host
fragment to (0, -5, 0) with rotation X = π/6 — children inherit the
transform. The collapse cascade therefore drags decor along for free.

### 3. /decor-editor.html visual placement tool — v2 (UX iteration)

MVP shipped 2026-04-25 morning (top-down ortho, click-to-place,
sliders, export). Same-day iteration adds production-ready UX:

- **Drag & drop** — pointerdown / pointermove / pointerup with offset
  capture (no snap to cursor) and clamp to the playable ring so a
  drag never produces an invalid export.
- **Undo / Redo** — Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z. Snapshot history
  (deep clone) with 50-entry cap. Pushes on place / delete / drag-end
  / slider-release / type-change. Slider `input` doesn't push so a
  slow drag-as-you-tune doesn't spam the stack — only `change` (on
  release) does.
- **localStorage per-pack** — `decor-editor:<packId>` JSON. Auto-save
  on every push / undo / redo. Auto-load on boot + on pack switch.
  "Reset local" button (with confirm dialog) wipes the working copy
  and reloads from `arena-decor-layouts.ts`. Indicator shows whether
  the current state matches code, diverges, or has no local entry.
- **Optional GLB preview toggle** — checkbox in the View section.
  Off = fast coloured discs (default); On = real arena GLBs lazy-
  loaded via the existing `model-loader` cache. Drag falls back to
  placeholders for snappy movement, then rebuilds the preview on
  pointerup. Async rebuild guarded by a token so rapid edits don't
  stack stale GLBs.

Export still emits a paste-ready TS snippet — that's the canonical
SoT in `arena-decor-layouts.ts`. localStorage is the working copy
between exports.

Helper fix during validation: `debugForceArenaSeed(seed)` now also
accepts an optional `packId` arg for manual QA from the console
(`window.__game.debugForceArenaSeed(42, 'jungle')`). Was rebuilding
with the previous pack only; now any pack from the lab.

Files touched (totals across the morning + UX iteration commits):
- new: `src/arena-decor-layouts.ts` (SoT data layer)
- new: `decor-editor.html` (page entry)
- new: `src/decoreditor/main.ts` (editor logic)
- modified: `src/arena.ts`, `src/arena-decorations.ts`, `src/main.ts`,
  `src/game.ts`, `src/tools/sidebar.ts`, `vite.config.ts`,
  `DEV_TOOLS.md`, `MEMORY.md`, `NEXT_STEPS.md`

Preflight all passed (typecheck client + server, verify-glbs 8/8,
vite build green). Validated visually in dev — drag, undo/redo,
local persistence, reset, GLB preview toggle, jungle in-game render
with 11 props, 4 empty packs load clean, all 5 skyboxes render full.

Limitations (deliberate, documented):
- Editor is per-pack — switching packs without "Export" or "Reset
  local" leaves the old pack's working copy in localStorage. That's
  by design (you can come back to it next session).
- Real-GLB preview during drag falls back to discs (movement was
  choppy with full meshes). Acceptable trade-off.
- The localStorage shape is intentionally narrow so we can lift it
  into a tiny shared module later for /calibrate and /anim-lab.
  Not done yet — scope kept tight.

---

## 2026-04-24 — Server ability kit sync for Sergei + Trunk

Codex pass para desbloquear playtest online/offline coherente.

Durante el barrido inicial detecté que `src/abilities.ts` ya tenía los
valores del feel pass de Sergei y Trunk, pero
`server/src/sim/abilities.ts` seguía con tuning anterior. Eso hacía que
los cooldowns, windUp, duración, impulso, radio/fuerza y multipliers de
frenzy no coincidieran entre partida local y simulación online.

Fix aplicado:
- **Sergei** server kit sincronizado con el cliente: Gorilla Rush
  `4.0s / 0.28s / windUp 0.04 / impulse 20`, Shockwave
  `radius 3.5 / force 34 / cooldown 6.0`, Frenzy
  `duration 2.5 / cooldown 15.0 / speed ×1.45 / mass ×1.5`.
- **Trunk** server kit sincronizado con el cliente: Trunk Ram
  `cooldown 4.5 / duration 0.35 / windUp 0.08 / impulse 16 / mass ×3.5`,
  Earthquake `radius 4.5 / force 40 / windUp 0.60 / cooldown 7.5`,
  Stampede `duration 3.0 / speed ×1.25 / mass ×1.80`.

No se toca gameplay nuevo ni UI. Es una corrección de consistencia para
que el siguiente playtest no dé resultados distintos según modo.

---

## 2026-04-25 — Smoke test anim-lab + Feel pass Trunk (first override use)

Primera sesión productiva usando `/anim-lab.html` para validar el estado
del mapping de clips antes de un feel pass.

### Smoke test (Fase 1)

Recorrido por Sergei / Trunk / Shelly en el lab:

- **Sergei** (10 clips Meshy): idle/run/abilities todos exact o prefix,
  sin ambigüedad. El caso frágil `Run` vs `Running` lo gana `Run` por
  Tier 1 — confirmado.
- **Trunk** (8 clips Tripo): mapping problemático detectado — el GLB
  lleva clip names del diseño FINAL (Ram/Grip/GroundPound) pero el
  kit placeholder del código es `[charge_rush, ground_pound, frenzy]`,
  así que slot K reproduce el clip de Grip (agarre) y slot L el clip
  de GroundPound (pisotón). Visualmente equivocado.
- **Shelly** (6 clips Tripo): ab_1 y ab_2 `missing` — pero por DISEÑO
  (procedural Shell Charge + Shell Shield). Documentado en
  `PROCEDURAL_PARTS.md` + `CHARACTER_DESIGN.md §"Cobertura skeletal"`.

### Override productivo (Fase 2)

Entra la primera entrada real al `ANIMATION_OVERRIDES` record:

```ts
trunk: { ability_2: 'Ability3GroundPound' }
```

El slot K (Earthquake = ground_pound) ahora reproduce el clip de
pisotón correcto. Slot L (Stampede = frenzy) queda en su auto
(Ability3GroundPound via prefix) — observación menor documentada:
el elefante hace un pisotón breve antes del buff, visualmente lee
como "planta patas antes de embestir". Si tras playtest molesta,
opciones discutidas en `CHARACTER_DESIGN.md §"Trunk — feel pass"`.

### Policy de overrides documentada

`src/animation-overrides.ts` cabecera ampliada con:
- Cuándo añadir override (dos criterios explícitos).
- Cuándo NO añadir (lista de estados procedurales-by-design:
  Shelly ab_1/ab_2, Sebastian ab_1/ab_3, Kermit ab_3).
- Qué estados son `missing` en todos los críttrs por default
  (headbutt_*, hit, respawn) y no necesitan override.

### Bug fix del anim-lab

El lab mutaba `ANIMATION_OVERRIDES[entryId]` en cada `loadCritter()`,
lo que **destruía** entradas authored al cargar un crítter sin
session override. Fix: snapshot `AUTHORED_BASELINE` al boot + merge
de session sobre baseline en cada load. Descubierto al primer QA
real (el override de Trunk no se aplicaba porque el lab lo nuke-aba
al clickar la card).

### Feel pass Trunk (Fase 3)

Siguiendo la plantilla de Sergei:

- **Trunk Ram (J, charge_rush)**: impulse 14→16, duration 0.40→0.35,
  cooldown 5.0→4.5, windUp 0.08 explícito, speedMult 2.0→2.1,
  massMult 3.0→3.5 (máximo del roster — bulldozer), `clipPlaybackRate
  5.0×` para que el clip de 4.58s se vea en ~0.92s.
- **Earthquake (K, ground_pound)**: radius 4.2→4.5 (más ancho que
  Sergei 3.5), force 34→40, windUp 0.5→0.60 (telegraph), cooldown
  8.5→7.5, `clipPlaybackRate 2.8×` para clip de 1.96s (override
  activo).
- **Stampede (L, frenzy)**: duration 4.0→3.0 (frente a Sergei 2.5 —
  Trunk bruiser aguanta más), speedMult 1.3→1.25 (menos que Sergei
  1.45 — ya era lento), massMult 1.35→1.80 (bulldozer ×2),
  cooldown 18.0, windUp 0.40→0.45.

VFX: ninguno nuevo. `spawnShockwaveRing` reutilizado — el `radius:
4.5` y `force: 40` generan un ring más grande + shake más fuerte que
Sergei sin tocar código.

Typecheck + build limpios. Feel pass log actualizado en
`CHARACTER_DESIGN.md`.

---

## 2026-04-25 — Animation Validation Lab + overrides system

Sesión de control: antes de meterme en feel pass de Trunk (siguiente
crítter del roster), construyo una herramienta para evitar repetir el
bug "Sergei Running vs Run" por otra vía, y para que los próximos
feel-passes arranquen con visibilidad total de qué clip va a cada
state.

### Qué había ya

Investigado antes de tocar:
- **`/animations` (mesh2motion)**: editor de animaciones para
  PRODUCIR clips. No es validador runtime. Descartado para este scope.
- **Panel "Skeletal clips" en `/tools.html`**: colapsado por defecto,
  sólo muestra los clips del crítter "player" de una partida activa,
  no permite cambiar crítter fluido, no explica el tier del resolver,
  no permite overrides, no exporta. Insuficiente.

Conclusión: crear herramienta nueva.

### Nuevo: `/anim-lab.html` (cuarto entry Vite)

Estructura paralela a `/calibrate.html`:
- **Panel izquierdo** — roster picker (9 críttrs clickables).
- **Viewport** — Three.js scene, orbit camera, lit, solo el critter.
- **Panel derecho**:
  - Playback: Play/Pause/Restart/Stop/Loop + speed slider.
  - Clips in GLB: lista de todos los clips con duración, state
    resuelto, y botón Play individual.
  - Resolved mapping: los 13 logical states con dropdown de override
    por state + badge del tier resolver (exact/prefix/contains/
    override/missing con colores distintos).
  - Export overrides: dumpa al clipboard un snippet pasteable para
    `src/animation-overrides.ts`.

Archivos nuevos:
- `anim-lab.html` (HTML entry).
- `src/animlab/main.ts` (lógica — 380 LOC).

Build: el nuevo chunk `animLab-*.js` pesa 7.4 KB gzipped.

### Arquitectura del mapping — decisión

**SoT del mapping de clips**: `src/animation-overrides.ts` (nuevo).
Record sparse:
```ts
export const ANIMATION_OVERRIDES: Record<string, Partial<Record<SkeletalState, string>>> = {
  // sergei: { run: 'Run' },  // example (not currently needed)
};
```

Hoy el record está **vacío** — el resolver automático ya maneja
todos los casos del roster actual. El file existe como escape hatch
documentado para el primer crítter futuro cuyos clip names
confundan al resolver.

**Resolver ampliado a 4 tiers**:
- **Tier 0 — override** (nuevo): `ANIMATION_OVERRIDES[critterId]?.[state]`.
  Consultado primero si el `SkeletalAnimator` recibe `critterId`. Si
  el override apunta a un clip presente en el GLB, gana. Si no
  existe, fallback al resolver automático (best-effort, no hard
  contract).
- **Tiers 1-3** (existían): exact → prefix → contains, sin cambios.

`SkeletalAnimator` ahora acepta `critterId` opcional en el
constructor. Propagado desde `Critter.attachGlbMesh` con
`entry.id`. `listClips()` amplía su shape para incluir `duration` +
`source` (el tier que ganó). Nuevo getter `getResolveReport()`
devuelve el estado completo de los 13 logical states — usado tanto
por la tabla del lab como potencialmente por cualquier futuro
debug/telemetría.

### Integración en `/tools.html`

El sidebar del dev lab gana 3 links al final (reemplaza el único que
tenía a `/animations`):
- `🎬 /animations` — mesh2motion (create clips).
- `🎞️ /anim-lab` — validate + override runtime mapping.
- `📏 /calibrate` — roster scale/pivot/rotation.

Consistencia de navegación interna sin linkar ninguna desde la
portada del juego (las tres con `noindex` meta).

### Cero regresiones

- Typecheck cliente + servidor limpios.
- `npx vite build` OK: 4 HTML entries (index/tools/calibrate/anim-lab),
  6.62 s.
- No se toca el resolver de los 3 tiers existentes — se AÑADE el
  Tier 0 como capa opcional sobre lo que ya había.
- Overrides vacíos por default → comportamiento idéntico al anterior
  para los críttrs actuales. Sergei `run → Run` sigue resolviendo
  por Tier 1 (exact), verificado en el lab.

### Commit + push

Rama: `dev`. Commit próximo con todos los cambios acumulados desde el
último push (handoff de ayer noche quedó sin commit en el remote —
esta sesión cierra el backlog).

---

## 2026-04-24 noche tardía — Closing handoff (fin de sesión larga)

Sesión maratón. El usuario cierra para reenganchar desde móvil en la
próxima, así que el foco fue **dejar todo bien atado** en docs +
confirmar cero regresiones por QA visual real (screenshots MCP).

### Descubierto y corregido vía screenshots reales

Descubrí que la QA por DOM que hice antes (`preview_eval` + DOM
inspection) daba pase verde pero **escondía dos bugs visuales** que
sólo se ven con screenshot real:

1. **Specificity de sprites 2D** — `.sprite-hud { width: 24px }`
   ganaba a `.slot-avatar-sprite { width: 100% }` por orden de
   declaración. Resultado: sprites pintando 24×24 en la esquina del
   slot (y del lives-dot), dejando ver el baseColor detrás. DOM
   reportaba `spriteVisible: true`, pero visualmente era un desastre.
   Fix: compound selectors `.sprite-hud.slot-avatar-sprite` y
   `.sprite-hud.lives-avatar-sprite` suben specificity a (0,0,2).

2. **Labels de debug en `hud-icons.png`** — la sheet v1 llevaba
   captions ("5. ELEPHANT", "6. FOX 9-TAILS", …) bajo cada icon
   pensados como referencia para el artist pass. Con el fix del
   specificity los sprites pasaron a cubrir el slot entero y los
   labels se empezaron a ver. Intenté limpiarlos con
   `trim-hud-sheet.mjs` (alpha=0 en la zona del label). El usuario
   pasó poco después `HUD_mejorado.png` — sheet v2 authored limpia
   en grid 4×6 (antes 4×7). Creé
   `scripts/rebuild-hud-sheet.mjs` que extrae cells del authored y
   recompone un grid uniforme de 256×256 sin margen. CSS actualizado
   a `background-size: 400% 600%` y positions recalibrados.

### Handoff — documentación reorganizada

- **`NEXT_STEPS.md`** reescrito con estructura priorizada:
  - 🟢 AHORA MISMO (unblocked) — Trunk feel pass en cabeza.
  - 🟡 Bloqueado por asset del usuario (ability-icons v2 mejorado).
  - 🔵 Bloqueado por QA manual (lista remitida a
    `VALIDATION_CHECKLIST.md`).
  - 🟣 Post-jam / backlog.
  - 🚫 NO TOCAR salvo bug real — zonas cerradas del proyecto.
  - ✅ Snapshot del proyecto: scripts activos vs obsoletos, docs al
    día, etc.
  - 📚 Guía de MCP screenshots (viewport portrait / rAF pausado /
    browser cache).
- **`MEMORY.md`** gana una sección nueva al tope "Fuentes de verdad"
  con:
  - Escala visual (IN_GAME_TARGET_HEIGHT = 1.7, roster.scale ya no
    es la SoT visible).
  - Sheet HUD canónica (HUD_mejorado.png → rebuild-hud-sheet.mjs →
    hud-icons.png).
  - Specificity de sprites (lección aprendida).
  - Clip resolver 3-tier + eps 1e-3.
  - Arena packs aleatorios + sync.
  - MCP Preview limitaciones + workarounds.
  - Scripts activos vs obsoletos.
- **`VALIDATION_CHECKLIST.md`** añade sección "Tanda 2026-04-24"
  con la checklist específica para la próxima ronda de QA visual
  manual (selector, HUD, calibrate, escala in-game, Trunk feel pass
  cuando llegue, HUD de abilities cuando llegue).

### Trunk feel pass — decisión de NO avanzar ahora

El usuario explicitó "si no ves seguro avanzar sin QA manual seria,
entonces no fuerces código". Trunk feel pass requiere verificación
visual del timing + impact + recovery — algo que no puedo validar sin
que él juegue la partida. Como va a estar en móvil en la próxima
sesión y no puede hacer playtesting cómodo, **opto por no tocar
código de gameplay**. Dejo la receta completamente detallada en
`NEXT_STEPS.md §"AHORA MISMO"` con scope estrecho para que cuando
pueda hacer QA, la ejecute sin replanteamientos.

### Estado del repo tras este handoff

- Sheet HUD: v2 integrada y verificada (selector + HUD in-match +
  calibrate lab).
- Typecheck cliente + servidor limpios.
- `npx vite build` limpia (3 HTML entries, 5-7s).
- Docs actualizadas y consistentes entre sí.
- 0 cambios de gameplay respecto a la sesión anterior — sólo assets
  + CSS + docs.

---

## 2026-04-24 noche — Arena pack visual fixes + character selector polish

Intervención en dos frentes tras captures del usuario:

### Arena pack visual fixes (A + B + C)

**A · props fuera del terreno**: los props flotaban sobre el skybox
hemisferio inferior porque no había superficie bajo ellos (arena
jugable acaba en r=12). Fix: nuevo `outerRing` decorativo (radius
11.9–18 u, altura `FRAG.arenaHeight`) texturizado con el ground
tile del pack — se renderiza entre el arena jugable y el void,
dando piso visual a los props. Además `loadPackPropMeshes` mide
bbox tras scale y desplaza Y para que `bbox.min.y === 0`: los GLB
con origin en el centro del mesh ya no se hunden por debajo del
arena. Se ve como un suelo continuo desde r=0 hasta r=18.

**B · skybox equivocado**: `tex.mapping =
EquirectangularReflectionMapping` estaba mal aplicado (ese mapping
es para reflejos PBR, no para pintar sphere inside-out). Fix:
`tex.mapping = UVMapping` (default) + `ClampToEdgeWrapping` —
la sphere ya tiene UVs equirect naturales. Los skyboxes
generados por IA (sunset desert, aurora tundra, dusk kitsune)
ahora se ven en toda su resolución.

**C · decoración cae con el arena**: nuevo queue
`fallingDecorations` + asociación determinística prop→batch via
proximidad angular (`computePropBatchIndex`). Cuando un batch
colapsa (offline `collapseCurrentBatch` + online `syncFromServer`)
los props con `batchIdx === N` entran en caída con gravedad +
tumble. El `outerRing` cae como pieza única cuando colapsa el
último batch. Mecánica independiente de `fallingFragments` —
misma cadencia de tick pero colas separadas.

### Character selector — intervención estructural (4 sub-bugs)

**2.1 Miniaturas 3D → 2D sprite-hud**. `buildSlotAvatar` ahora
añade un `<span class="sprite-hud sprite-hud-{id}
slot-avatar-sprite">` superpuesto al slot. Si
`body.has-hud-sprites` está activa (sheet cargado), el chibi 2D
cubre el slot. Thumbnail 3D se queda SOLO como fallback cuando
el sheet no carga — cuando sí carga, ni se genera (ahorro de
GPU cycles). CSS nuevo `.slot-avatar-sprite` con inset absoluto.
Mismo patrón que el HUD in-match, consistencia garantizada.

**2.3 Clip resolver → 3 tiers**. Antes: exact + contains. Ahora:
exact → prefix → contains. "Run" gana sobre "Running" en tier 1
(exact); "Idle_Alert" gana sobre "MyAbilityIdleSlam" en tier 2
(prefix) cuando no hay exact. `isClipEffectivelyStatic` eps
subido 1e-4 → 1e-3: idles con breath micro-motion (~0.5 mm) ya
no caen en la criba de "clip efectivamente estático" y se drop
accidentalmente. Causa real de "Sergei reproduce desordenado":
era un idle que se descartaba como static y caía a un clip
fallback inapropiado.

**2.4 Info pane stats alignment**. Grid CSS con columnas fijas
`grid-template-columns: 70px auto` + `width: fit-content`
centrado. Labels (SPEED / WEIGHT / POWER) alineados a la derecha
en columna 1, pips a la izquierda en columna 2, sin stretching.
Antes un flex libre hacía que rows se alineasen distinto según
cuántos pips estaban on.

**2.2a Auto-fit sobre idle-pose height**. `attachGlbMesh`
reordenado: mide bind pose → crea skeletal → `play('idle')` +
`update(0.033)` (1 frame) → re-mide bbox en idle pose → aplica
`IN_GAME_TARGET_HEIGHT = 1.7 u` sobre esa medida. La bind pose
(T-pose-ish export) era mala referencia porque los idles suelen
diferir hasta 15% en silhouette — ahora cada crítter termina
realmente a 1.7 u en idle real, no en T-pose teórica.

**2.2b Roster calibration lab**. Tercer entry point Vite:
`/calibrate.html`. Página dedicada con los 9 playable críttrs en
grid 3x3, cámara orbit con drag + wheel zoom, labels flotantes.
Click selecciona un crítter → sidebar con sliders `scale`,
`pivotY`, `rotationY` que mutan la transform en vivo. Botón
"Re-fit all to target" recompone el auto-fit a una altura
custom (permite probar 1.5, 1.7, 1.9 u sin recompilar). Botón
"Export roster.ts snippet" dumpa el diff al clipboard + consola
como comentarios pasteables. Sin Colyseus, sin HUD, sin match:
puro Three.js + DOM controls, 6 KB gzipped. URL: `/calibrate.html`
en dev, también en producción (con `noindex` meta por si acaso).

Archivos tocados:
- `src/arena.ts` — outerRing, fallingDecorations, collapseOuterRing,
  collapsePropBatch, computePropBatchIndex, tickFallingDecorations
- `src/arena-decorations.ts` — mapping UVMapping, Y-offset por prop
- `src/main.ts` — refactored `setSceneSkyboxTexture` + `setSceneFogColor`
- `src/critter.ts` — auto-fit sobre idle pose post-mixer
- `src/critter-skeletal.ts` — 3-tier clip resolver + eps 1e-3
- `src/hud/character-select.ts` — sprite 2D en slots
- `index.html` — CSS `.slot-avatar-sprite`, stats-row grid
- `calibrate.html` + `src/calibrate/main.ts` — lab nuevo
- `vite.config.ts` — entry `calibrate`

Typecheck + vite build limpios en ambos frentes.

---

## 2026-04-24 tarde — Arena decorations loader: packs aleatorios por partida

Cerrado el bloque B del post-jam ahead of schedule. Cada partida ahora
rolea un `packId` distinto entre los 5 biomas (jungle / frozen_tundra /
desert_dunes / coral_beach / kitsune_shrine) y aplica skybox +
fog + ground texture + props al arena sin tocar una sola línea de la
lógica de colapso.

### Nuevo módulo: `src/arena-decorations.ts`

Catálogo único de los 5 packs. Por cada uno:
- Lista de GLB filenames (5-8 props).
- `fogColor` sintonizado con el horizonte del skybox.
- Override opcional `propScale` per-prop (usado para encoger el
  `tree_jungle_broadleaf` de 54 MB que aplastaba la composición).

**Layout determinístico**: `layoutPackProps(packId, seed)` usa
`mulberry32(seed ^ packIdHash)` para distribuir los props en un anillo
fuera del radio jugable (r 14.5–18.5). Cliente y servidor calculan el
mismo layout a partir de los mismos inputs → 0 bytes de sincronización
extra en la wire. Cada prop tiene jitter de ángulo, radio, rotY y
escala (0.9–1.15×) sobre la base del pack.

**Loaders**: `loadPackGroundTexture`, `loadPackSkyboxTexture`,
`loadPackPropMeshes`. Cache de texturas propia + reutiliza el cache de
`model-loader` para GLBs.

**Failure mode**: si un asset 404s, el prop se vuelve un `THREE.Group`
vacío y un console.debug. La partida nunca rompe por falta de
cosmética.

### Sincronización cliente ↔ servidor

- `server/src/state/GameState.ts`: campo nuevo
  `@type('string') arenaPackId: string = 'jungle'`. Default 'jungle' →
  graceful degradation para builds viejos.
- `server/src/BrawlRoom.transitionToCountdown`: rolea `packId` uniforme
  y lo asigna al state. Lista de pack IDs duplicada inline en el
  server (pequeña, estable, evita dependencia client→server).
- `src/game.ts update()` online: lee `state.arenaPackId`, verifica con
  `isArenaPackId()` (guard contra valores no válidos) y lo pasa a
  `arena.syncFromServer(seed, level, warn, packId)`.

### Cambios en `src/arena.ts`

- `buildFromSeed(seed, packId?)`: packId opcional → acepta la llamada
  legacy (sin pack) y la nueva. Si se pasa, dispara `applyPack()`
  async; si no, usa `clearPack()` para mantener el look default.
- Nueva propiedad privada `decorationsGroup: THREE.Group | null`.
  Se añade a `scene` directamente, NO a `this.group` (fragments), así
  que NUNCA entra en el iterador de collapse.
- `applyPack(packId, seed)`:
  1. Bump de `packApplyToken` — loaders async más viejos detectan
     que están obsoletos y bailan sin tocar la escena.
  2. Fog + clearColor sincrónico (evita 1 frame con horizonte erróneo).
  3. Ground texture async → aplica map a los materials de los fragment
     "top" meshes (heurística: el flag `receiveShadow` lo identifica).
  4. Skybox async → `setSceneSkyboxTexture()` en main.ts swapea el
     material del `skyDome` (shader → MeshBasicMaterial textured).
  5. Props: `layoutPackProps()` + `loadPackPropMeshes()` → nuevo group
     con los 5-8 meshes posicionados → add a scene.
- `clearPack()`: revierte skybox al shader default, fog al color
  original, drop decorationsGroup, `clearGroundTexture()` limpia el
  `.map` de todos los fragments.
- `syncFromServer(..., packId?)`: si packId cambia sin re-seed,
  `applyPack()` se llama sin rebuild de fragments. Caso raro pero
  soportado.
- `getCurrentPackId()`: getter público usado por `debugForceArenaSeed`
  para no perder el pack al recalcular layout en el lab.

### Cambios en `src/main.ts`

Export nuevo:
- `setSceneSkyboxTexture(tex | null)`: swap del material del skyDome.
  Null → vuelve al shader procedural (menús, title).
- `setSceneFogColor(color | null)`: mutación in-place del color de
  `scene.fog` + clearColor del renderer. Null → defaults original.

El mesh del skyDome se anota ahora como
`THREE.Mesh<SphereGeometry, Material>` para que TS acepte la
reasignación entre ShaderMaterial y MeshBasicMaterial.

### Game flow offline / online

- **Offline** (`enterCountdown` + `debugStartOfflineMatch`): rolea
  `getRandomPackId()` por partida. `debugStartOfflineMatch` acepta
  `options.packId?: string` si el lab quiere forzar un pack.
  `debugForceArenaSeed` preserva el pack del partido en curso.
- **Online**: lee del state, pasa al syncFromServer.

### Typecheck

Cliente y servidor limpios post-cambios. No se tocó ninguna lógica de
física / collapse / síntesis de audio / skeletal, solo la capa visual.

---

## 2026-04-24 tarde — Arena packs ×2 más (Kitsune Shrine + Coral Reef Beach)

Con los otros 2 packs generados, cerramos el set de 5 packs cosméticos
para el loader de decoraciones (pendiente por implementar, es el
siguiente bloque B del post-jam roadmap).

- **Kitsune Shrine**: 7 props, **12 MB**. `bamboo_cluster.glb`
  (5.6 MB, 127k verts) y `sakura_tree.glb` (2.7 MB, 65k verts) son
  los problemáticos — IA modeló tallos/blossoms individualmente
  pese al prompt restringido. Aggressive-simplify + compress-textures
  probados; ninguno recupera (el peso es ~100% geometría).
  Aceptados por política `tree_jungle_broadleaf`: valen la pena por
  identidad visual del pack. Los otros 5 props (torii×2,
  stone_lantern×2, kitsune_statue) bajo 1.5 MB cada uno.
- **Coral Reef Beach**: 8 props finales, **12 MB**. De los 9 raws,
  el usuario entregó 2 variantes de starfish (`lying_flat` y
  `lying_ground`); la primera bajó a 274 KB / 5393 verts, la
  segunda a 720 KB / 11k verts — promovida la `lying_flat` como
  canónica `starfish_decor.glb`. `palm_beach_tilted.glb` (5.9 MB,
  130k verts) y `coral_brain.glb` (2.5 MB, 62k verts) son los
  problemáticos (fronds / grooves modelados en geom pese al
  prompt retry ultra-estricto). Corales branching y la shipwreck
  entraron limpios bajo 1 MB cada uno.
- Los prompts retry de Beach (reescritos esta mañana con wording
  "blob / dome / wedge / clump" + referencias a Minecraft / Lego)
  redujeron muchísimo el problema original (1M+ caras) pero no
  lo eliminaron del todo en los 2 props más orgánicos.
- Bug menor del pipeline: el usuario entregó `seashell_scatter.glb.glb`
  (doble extensión). Renombrado al copiar — no afecta al optimize.
- Lección actualizada en `ARENA_PROMPTS.md` para el siguiente pack
  que alguien genere: incluso con el prompt ultra-estricto,
  palmeras y árboles con canopy siguen saliendo con cientos de
  miles de verts. La regla definitiva: "árbol = 1 trunk + 1
  canopy dome, ZERO detail extra". Cualquier cosa más delicada
  colapsa el optimizer.

Estado final de packs para el loader (pendiente implementar):
Jungle (5), Tundra (6), Desert (7), Shrine (7), Beach (8) →
33 props repartidos en 5 biomas.

---

## 2026-04-24 — Arena packs ×2, HUD/tamaños fixes, feel pass Sergei

Mañana de integración tras cerrar los cinturones. Cuatro bloques
independientes que caen uno detrás de otro; ninguno toca mecánica
core, todo es polish + assets.

### Frozen Tundra + Desert Dunes integrados

Mismo pipeline que Jungle:
1. El usuario genera props con la IA + skybox + ground texture.
2. Copio raws a `public/models/arenas/_raw/<pack>/` (gitignored).
3. `scripts/optimize-arena-props.mjs --pack <name>` (meshopt +
   gltf-transform simplify + sharp texture pass).
4. Si algún prop sale monstruoso (>5 MB o >100k verts), aggressive
   simplify o prompt retry.

- **Frozen Tundra**: 6 props, **2.3 MB**. El `pine_snow.glb` falló
  al primer intento (4.2M verts por per-needle geometry, insalvable
  — misma patología que el `bush_tropical` de Jungle). Prompt de
  "retry" más estricto ("low-poly Christmas tree stacked cones,
  NO needles") generó dos opciones; option1 bajó a 4527 verts /
  420 KB, adoptada como principal. Lección burned-in en
  `ARENA_PROMPTS.md` como patrón canónico para formas naturales
  delicadas.
- **Desert Dunes**: 7 props, **3.6 MB**. `palm_desert.glb` original
  (910k verts, 53 MB raw) fue el prop problemático del pack.
  Recuperado con la 2ª variante `palm_desert_optional.glb` que el
  usuario había generado como backup (790 KB, 14k verts) —
  adoptada como principal; la primera va al limbo de los raws.
- Los **prompts del Coral Reef Beach** se reescribieron por
  completo con wording ultra-estricto anti-multi-mesh: formas
  delicadas ("branches", "fronds", "planks", "shells") sustituidas
  por sólidas ("blob", "dome", "wedge", "clump") + referencias
  explícitas a Minecraft/Lego/Fall Guys/Fortnite.

Estado de packs: Jungle (5 props, ships), Tundra (6, ships), Desert
(7, ships). Faltan Beach (prompts listos, pendiente regen usuario)
y Kitsune (prompts originales, no empezado).

### Bug #1: HUD avatar incoherente entre bichitos

Síntoma reportado el 23 abril por el usuario: en la misma partida
Sergei/Sebastian pintaban correctamente su cabeza chibi del sprite
`hud-icons.png`, pero Shelly/Kowalski caían al thumbnail 3D
renderizado como si el sprite no hubiese cargado.

**Diagnóstico**: el sprite sheet tiene padding transparente
alrededor de cada cabeza. El thumbnail 3D del `.lives-dot` se
cargaba como `background-image` del padre **en todos los casos**;
se filtraba por los bordes transparentes del sprite overlay. Los
sprites con silueta ancha (Sergei gorila, Sebastian cangrejo)
tapaban más el thumbnail → invisible; los de silueta estrecha
(Shelly tortuga baja, Kowalski pingüino esbelto) dejaban ver el
thumbnail por los lados → confusión visual.

**Fix** (`src/hud/runtime.ts initAllLivesHUD`): saltar la carga
del thumbnail 3D si `body.has-hud-sprites` está activa. El
`.lives-dot` queda con el `baseColor` sólido bajo el sprite,
coherencia total entre los 4 corners. Thumbnail se mantiene como
fallback degradado cuando el sprite sheet no carga (tablet con
asset fallido, etc.).

### Bug #2: tamaños in-game no uniformes

Alturas post-scale del roster varían de 1.38u (Cheeto) a ~2.0u
(Trunk) porque cada `scale` se calibró a ojo sobre meshes con
distintas alturas raw (Tripo ~0.6u, Meshy ~1–2.4u). Usuario
reporta que Sergei se ve "grande" y Shelly "pequeña" cuando el
design dice lo contrario.

**Fix** (`src/critter.ts attachGlbMesh`): auto-fit visual análogo
al del preview. Nueva constante `IN_GAME_TARGET_HEIGHT = 1.7` u;
tras medir `bindPoseHeight`, se escala el `group` GLB con
`k = 1.7/bindPoseHeight`. Física 100% intacta — el auto-fit
toca `group.scale` (inner mesh visible), no `this.mesh` (parent
que lleva `physicsRadius`, position, headbutt cone).

### Feel pass Sergei (primero del roster, plantilla para los demás)

El feel pass queda "parked" desde hace una semana por la prioridad
de cinturones + arenas. Hoy se cierra sobre Sergei; los otros 8
heredan la plantilla.

**Clip durations reales** (`scripts/inspect-clips.mjs`):
- `Ability1GorillaRush` 1.03 s
- `Ability2Shockwave` 0.80 s
- `Ability3Frenzy` 2.43 s

**Gaps identificados**:
- Gorilla Rush: clip 1.03 s vs ability active 0.32 s → strike pose
  llegaba tarde, se sentía torpe en vez de ágil. Fix: **acelerar el
  clip a 2.3×** (clip efectivo 0.45 s, alineado con windUp 0.04 +
  active 0.28 + tail). Además ajustar los valores numéricos
  aguas abajo (impulse 18→20, speedMult 2.4→2.6, cooldown 4.5→4.0).
- Shockwave: clip 0.80 s vs 0.35 total → alineado, sin cambio de
  playback. Bumps de signature: radius 3.2→3.5, force 30→34.
- Frenzy: clip 2.43 s vs buff 4.0 s → clip terminaba mid-buff,
  falta impacto. Fix: **acortar buff a 2.5 s matching clip** y
  subir multiplicadores (speed 1.3→1.45, mass 1.35→1.5) para que
  la ventana corta sea más intensa. Cooldown 18→15 s porque dura
  menos tiempo.

**Infra reutilizable añadida**:
- `AbilityDef.clipPlaybackRate?: number` — campo opcional. Si
  está, al disparar la ability se pasa al `skeletal.play()` como
  `timeScale`. Any ability de cualquier crítter puede reutilizarlo.
- `SkeletalAnimator.play()` ahora acepta `opts.timeScale` que
  setea `action.setEffectiveTimeScale()`.

**VFX añadido**:
- `spawnFrenzyBurst()` en `abilities.ts` — battle-cry ring dorado
  + flash rojo central, 600 ms, radio 2.5 u. Se dispara al activar
  Frenzy. Complementa el emissive pulse rojo ya existente.
- Camera shake en el frame de activación de Frenzy (0.55× de la
  del Ground Pound).

**SFX**: pendiente. Por ahora Frenzy + charge_rush comparten el
mismo `'abilityFire'` sintetizado. Plan: SFX signature por crítter
via Suno + Web Audio. Post-jam probablemente, mencionado en
`NEXT_STEPS.md`.

Plantilla numérica completa en `CHARACTER_DESIGN.md` §"Feel pass
log" para los próximos 8 críttrs. Orden acordado:
Sergei → Trunk → Cheeto → Kurama → Shelly → Kermit → Sihans →
Kowalski → Sebastian.

---

## 2026-04-23 — UI pass: selector polish + HUD rework + 6 ULTIs + sprite system

Tanda grande de pulido visual/UX. El roster ya está cerrado (9/9 skeletal
+ 68/72 states, 2026-04-22), y el submit al Vibe Jam Google Form está
enviado — a partir de aquí todo es polish y depth dentro de sistemas
existentes, sin tocar la mecánica core.

### Character-select presentable

**Problema**: el preview 3D del podio tenía discrepancias fuertes entre
los bichitos Tripo (Trunk 1.93u, Shelly 1.86u) y los Meshy
(Sebastian 0.56u en pose idle agazapada, Sihans 0.74u tumbado).
Escalas de roster calibradas para gameplay no funcionaban para el
preview del menu. Además los modelos Meshy se veían mate/oscuros
porque llegaban con `metalness: 1` y la escena no tiene envMap.

**Fix**:
- `preview.ts` gana un `fitWrapper` anidado dentro del `holder` que
  aplica una escala uniforme per-critter. Se mide el `max(h, w, d)`
  del bounding box de los bones durante ~900ms del idle loop (para
  capturar el wiggle del ciclo) y se escala a `TARGET_SILHOUETTE_MAX
  = 1.9u`. Preserva proporciones individuales (Trunk sigue siendo
  alto y delgado, Sebastian sigue siendo ancho y bajo).
- Max dims post-fit: Trunk 1.90 / Kurama 1.56 / Sergei 1.62 /
  Shelly 1.92 / Kermit 1.90 / Sihans 1.38 / Kowalski 1.49 /
  Cheeto 1.80 / Sebastian 1.62. Antes el rango era 0.56–1.93
  (factor 3.4×), ahora 1.38–1.92 (factor 1.4×).
- `Critter.attachGlbMesh` ahora normaliza materiales PBR: si
  `metalness > 0.5` (caso Meshy), lo fuerza a `metalness=0 +
  roughness=0.7` para que el diffuse map conduzca el look. Tripo
  sin tocar. Con eso, Kurama/Sergei/Sihans/Sebastian dejan de
  verse mate y muestran el color plano del source.
- Canvas del preview 380×340 → 500×440 (+31% área), pedestal
  radius 1.45→1.55 + height 0.50→0.55, cámara FOV 32°→30° y
  distance 4.8→5.2u, halo radial más intenso (opacity 0.10→0.15).
- Info pane del selector con panel oscuro + blur + border. Role
  label en gold letter-spaced, stats bars 10px con glow, keybind
  `J`/`K`/`L` ahora son chips gold-outlined en vez de texto
  monospace gris.

### HUD in-match reorganizado

**Problema**: las vidas de los 4 jugadores iban en una columna central
arriba del timer. Poco protagonismo, difícil distinguir al local player.

**Fix**:
- Cuatro contenedores `.player-life-corner` en TL/TR/BL/BR.
  Avatar 70×70px (antes 22), nombre del crítter, hearts 16px,
  highlight gold para el local player (`is-local`), opacity 0.35
  cuando muere.
- Margins dodgeadores: TL top 118px (baja del portal-legend), TR
  top 72px (baja de settings), BL bottom 24px, BR bottom 62px
  (arriba del Vibe Jam widget). Nada se pisa.
- Top-center hero cluster: timer **44px bold gold** (antes 18px)
  + Alive count **uppercase letter-spaced** debajo. Se lee desde
  la otra punta del monitor.
- Vibe Jam badge overridde vía `!important`: 14px→17px, padding
  7/14→11/20, hover translateY + fondo gold.

### Bugfix crítico: botones SFX/Música invisibles en title/select

`setMatchHudVisible(false)` estaba haciendo `hudRoot.style.display =
'none'`, ocultando también `#hud-settings` donde viven 🔊 / 🎶.
Violaba el contrato del submission checklist ("reachable on every
screen"). Refactor: la función solo togglea `body.match-active`; el
CSS ya gatea los hijos match-only (`#hud-top-center`, `#hud-lives`,
`#ability-bar-container`, `#overlay`). El `#hud` root queda siempre
visible para los settings.

### Sistema de sprites + favicon AI-generados

Los prompts de AI_PROMPTS.md ahora tienen arte. Tres assets:

- `public/images/hud-icons.png` (4×7 grid, 26 iconos: corazones,
  inmunidad, cabezas de los 9 crítters, bot-mask, timer/skull/
  trophy/crown, sfx/music on/off, scoreboard, belts)
- `public/images/ability-icons.png` (3×9 grid, 27 iconos: 9
  crítters × 3 habilidades J/K/L)
- `public/favicon-br.png` (marca BR cartoon)

Sistema CSS `.sprite-hud` + `.sprite-ability` con positions en
porcentaje (no pixels, resiliente a cambios de tamaño del asset).
`main.ts` preloadea las imágenes y añade `body.has-hud-sprites` /
`body.has-ability-sprites` solo si cargan sin error; si faltan, el
emoji fallback mantiene el juego funcional.

Primera integración: **abilities en el info pane del character
select** y **abilities en el HUD de cooldowns in-match**. Los hearts,
bot-badge, belts-trophy y otros quedan para siguiente tanda.

Favicon PNG añadido en index.html y tools.html como primero en la
cascada, SVG anterior queda como fallback.

### Gap cerrado de ULTIs

Los 6 crítters que no tenían slot L (Trunk, Kermit, Sihans, Kowalski,
Cheeto, Sebastian) reciben ahora un `frenzy` placeholder con nombre
temático: Stampede / Hypnosapo / Diggy Rush / Blizzard / Tiger Rage /
Red Claw. Mecánica placeholder (+speed +mass), nombres correctos. Los
9 bichitos muestran las 3 abilities en el info pane. Cliente + server
espejados.

### Feel: countdown drop desincronizado + clip fall

- `initCountdownDrops` ahora reparte un `delay` escalonado por índice:
  player (i=0) cae al instante; los bots i=1..3 retardan
  `i * (0.15..0.35s)` + jitter. Alturas entre 10–16u.
- `updateCountdownDrops` espera el `delay` de cada critter (hover en
  altura), dispara `playSkeletal('fall')` cuando la gravedad toma, y
  fuerza `playSkeletal('idle', { force: true })` al aterrizar para
  cancelar el `clampWhenFinished` del clip fall.

### UX: pausa offline + hint "Press P" sobre portal

- Menú pause offline (vs bots): **ESC** durante `phase === 'playing'`
  muestra card central con Resume / Restart match / Quit to title.
  `this.paused` cortocircuita input + bots + física dentro del
  case `'playing'`. Online no se ve afectado (authoritative server).
- Cada portal gana un sprite 3D **"PRESS P"** (o "TAP 🌀" en touch)
  flotando encima del label principal. Opacidad **inversa** al
  expansion state: visible cuando el portal está minimizado (dice
  cómo abrirlo), invisible cuando ya está expandido. Bob suave para
  atraer la vista, contra-escala para lectura consistente.

### Archivo "Google Form submit"

`SUBMISSION_CHECKLIST.md` marcado: submit enviado 2026-04-23, ocho
días antes del deadline. A partir de ahora el repo es ABSOLUTAMENTE
sólo polish — el jam ya está registrado.

### Pendientes inmediatos post-tanda

- Validar visualmente en preview deploy (screenshots → iterar).
- Completar integración de sprites HUD (hearts, bot-mask, belts,
  sfx/music icons, critter-head fallbacks en corners).
- Refinar character selector antes de pasar a abilities/timings.
- Feel pass per-critter empezando por Sergei.
- Actualizar el resto de .md (este log, character design, validation)
  tras esta tanda.

---

## 2026-04-20 — Blender MCP online + Sergei first rigging pass

Segundo carril del animation pipeline activado. Hasta hoy solo teníamos
`/animations` (Mesh2Motion) como ruta de rigging. Los no-humanoides
(Shelly, Sebastian, Kermit, Sihans) salían demasiado deformados del lab
y Tripo Animate externo tiene coste/tiempo impredecibles. Con
[`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp) ahora
podemos pedirle a Claude que edite la escena de Blender via scripts `bpy`
sin salir del IDE, y Blender actúa como motor visual de verificación.

### Instalación (una sola vez)

- `uv` package manager ya presente en el PATH (winget dejó `uvx.exe`).
- Addon `tools/blender-mcp/addon.py` descargado del repo upstream
  (v1.2, compat Blender 3.0+).
- `.mcp.json` en la raíz define el servidor `blender` que arranca con
  `uvx blender-mcp`.
- `.claude/settings.local.json` autoriza el servidor vía
  `enabledMcpjsonServers: ["blender"]` (per-user, gitignored).
- Addon instalado dentro de Blender (`Edit > Preferences > Add-ons >
  Install` apuntando al addon.py) y activado.
- Viewport 3D → sidebar (`N`) → pestaña BlenderMCP → **Connect**.
- Reinicio de Claude Code → tools `mcp__blender__*` disponibles.

Playbook completo en `BLENDER_MCP.md` (setup + workflow por crítter +
troubleshooting). `STACK.md` ya menciona el servidor como tooling
opcional de animación.

### Primer crítter rigged: Sergei (gorila)

Sergei elegido como sanity check del flujo MCP porque es humanoide
(el caso "fácil") antes de meterse con los raros. Estado al cierre:

- Mesh importado en Blender desde `public/models/critters/sergei.glb`.
- Armature creado y pesado a cuerpo/brazos/piernas — bones visibles
  en el viewport.
- Re-exportado sobrescribiendo `public/models/critters/sergei.glb`
  (434 KB → 1.06 MB, el salto corresponde a skeleton + weights).
- `src/roster.ts` tunea Sergei: `scale 2.0 → 2.3`, `pivotY 0.98 → 1.0`.
  La versión rigged se lee un 15% más pequeña visualmente comparada
  con los demás críters procedurales; el bump iguala silueta.
- Clips de animación **aún no añadidos** — primero validamos que el
  mesh con rig se renderiza bien en runtime; después aplicamos clips.

### Bug colateral: cloned SkinnedMesh → physics moves, vertices stay

Al cargar Sergei rigged, el thumbnail del character select aparecía
como una malla plana centrada en el origen mientras el carrusel
intentaba rotarlo — la transform del `Group` se movía, los vértices
no seguían.

Causa: `deepCloneWithMaterials` en `src/model-loader.ts` usaba
`source.clone(true)`. Para un `SkinnedMesh`, `clone(true)` NO rebuilda
el skeleton; el `SkinnedMesh.skeleton.bones` del clon sigue apuntando
a los bones del `Armature` ORIGINAL cacheado en el loader. Al rotar
el clon, el nodo empty se mueve pero los vértices permanecen bound
al skeleton fuente. `SkeletonUtils.clone()` de Three.js está hecho
para exactamente este caso (rebuild de bones re-escaneando la jerarquía
del clon).

Fix:
- Detectar con un `traverse` si el source contiene `SkinnedMesh`.
- Si sí → `SkeletonUtils.clone(source)`.
- Si no → fallback a `source.clone(true)` (sigue siendo más barato
  para modelos no rigged, que siguen siendo la mayoría hoy).
- Comentario en `src/model-loader.ts` explica el síntoma y la razón
  para que nadie regresione el código.

Entrada paralela en `ERROR_LOG.md` (`[2026-04-20]`) con Where/Symptom/
Cause/Fix/Lesson.

### Observación pendiente (para mañana)

En Blender el modelo se ve orientado con el front facing +X (no +Z
como sería natural), por eso aparece "lying down" al hacer el
viewport. El juego compensa con `rotation: -Math.PI / 2` en `roster.ts`
y por eso el character select renderiza el gorila correctamente
(validado en pantalla). Idea del usuario: añadir un plane de
referencia de suelo en Blender (collection `_reference` o similar
con export-exclude) para validar visualmente la orientación antes de
cada re-export. Apuntado como primera tarea de mañana.

### Files changed

- `.mcp.json` (new) — servidor `blender` vía `uvx blender-mcp`.
- `.claude/settings.local.json` — `enabledMcpjsonServers: ["blender"]`.
- `tools/blender-mcp/addon.py` (new) — addon upstream (v1.2).
- `BLENDER_MCP.md` (new) — setup + workflow + troubleshooting.
- `STACK.md` — sección Blender MCP bajo animation tooling.
- `public/models/critters/sergei.glb` — export con armature + weights.
- `src/model-loader.ts` — `SkeletonUtils.clone()` para skinned meshes.
- `src/roster.ts` — Sergei transform tuning (scale, pivotY).
- `VALIDATION_CHECKLIST.md` — sección 14 (Blender-rigged validation).
- `ERROR_LOG.md` — entrada SkinnedMesh clone bug.
- `NEXT_STEPS.md` — Fase 3 refleja los dos carriles activos.
- `BUILD_LOG.md` — esta entrada.

### Verification (pendiente mañana)

- Typecheck + build local — no corrido aún (se pospone a la primera
  sesión de mañana).
- Recarga del juego y character select: Sergei rigged debería
  renderizar igual que antes (sin el rig se veía bien, con el rig
  debe verse idéntico hasta que se añadan clips).
- In-game: movimiento, headbutt, abilities, fall — todos los estados
  del engine deben seguir funcionando porque los clips aún no están
  attachados; el procedural layer (`critter-animation.ts`) sigue
  activo.
- Consola: no debe aparecer el mensaje
  `[Critter] skeletal animator attached: Sergei | clips: ...` todavía
  porque no hay clips en el GLB — si aparece es un bug.
- `npm run verify:glbs` (tool de 2e8b1eb) debería seguir pasando.

### Estado al cierre de la sesión (sleep point 2026-04-20)

- Blender MCP: instalado + addon activo + conexión Claude ↔ Blender
  verificada (tools `mcp__blender__*` disponibles).
- Sergei: rigged + exportado + `SkeletonUtils` fix en loader.
- No commit todavía — todo sigue uncommitted en `dev`. `git status`:
  `M STACK.md`, `M public/models/critters/sergei.glb`, `M src/model-loader.ts`,
  `M src/roster.ts`, `?? .mcp.json`, `?? BLENDER_MCP.md`, `?? tools/`.

### Plan para mañana (continuación)

1. Levantar dev server y validar visualmente que Sergei rigged
   renderiza correctamente en character select + partida.
2. Añadir plane de referencia de suelo en Blender (excluir del
   export) para cross-check de orientación.
3. Si Sergei OK → añadir primer clip (idle) via Mixamo download
   o bpy keyframes, re-exportar, verificar que `SkeletalAnimator`
   lo engancha (console log + `/tools.html` → OBSERVE → Skeletal
   clips).
4. Si el flujo se confirma fluido → repetir con **Shelly** (tortuga):
   el verdict real del MCP está en los no-humanoides.
5. Commit de todo el bloque una vez validado.

---

## 2026-04-20 (sesión 2) — Pose-state cleanup + dead-clip filter + cleanup template

Sesión de mañana: validación visual de Sergei + descubrimiento del
verdadero bug "T-pose en headbutt" + protocolo reutilizable para
futuros crítters.

### Bug 1: T-pose snap en headbutt/abilities (resuelto)

Síntoma reportado por usuario: con Sergei en partida, idle/run se ven
bien pero al hacer headbutt o ability la malla salta a T-pose durante
toda la duración de la action y luego vuelve a idle.

**Diagnóstico** (vía `mcp__blender__execute_blender_code`, inspeccionando
fcurves):
- Idle y Run = 51 fcurves cada uno (16 bones de 39 keyed con 5 keyframes).
  Animaciones reales con `value_range > 0`.
- Las otras 11 actions (Ability1Rush, Ability2Shockwave, Ability3Frenzy,
  Anticip, Defeat, Fall, HeadbuttLunge, Hit, Respawn, Victory, Walk) =
  **390 fcurves cada una = 39 bones × 10 channels**, con 2 keyframes
  por fcurve y `value_range = 0.00000`. Snapshots auto-generados del
  bind pose. Cada action al reproducirse fuerza todos los bones al
  rest pose → T-pose snap visible.

**Fix en dos capas**:

(a) **Filtro runtime defensivo** (`src/critter-skeletal.ts`):
añadido `isClipEffectivelyStatic(clip, eps=1e-4)` que verifica
que cada track tenga variance > eps entre keyframes (per-component
para Vec3/Quat). Llamado en el constructor del `SkeletalAnimator`
antes de registrar las actions; descarta clips muertos y logea
`[SkeletalAnimator] dropped N static (bind-pose) clip(s): <names>`
en consola. Permite que el resolver caiga al fallback "no clip"
para esos states → la action previa (idle/run) sigue corriendo en
vez de ser clobbered.

(b) **Limpieza source** (Blender + re-export): borradas las 11
actions placeholder vía bpy. Sergei.glb resultante ahora ship sólo
Idle + Run reales. Verifier confirma `2/13 covered` (el resto
queda como `—`, sin matching, lo cual está OK).

Validado end-to-end con preview server: durante un headbutt,
`skeletal.getCurrentState()` se mantiene en `'idle'` y
`isHeavyClipActive()` queda `false` toda la ventana → idle sigue
corriendo, no hay T-pose snap. Misma cosa para abilities.

### Bug 2: pose state pegado (vista en Blender + en juego "torcido")

Tras validar el fix anterior, el usuario reportó que Sergei se sigue
viendo torcido / acuclillado en Object Mode de Blender y en juego, aun
en el bind pose / frame 0 / sin action activa. Pero en Edit Mode el
armature aparece en T-pose limpio (cuerpo vertical, brazos
horizontales).

**Diagnóstico**: el rest pose del armature es T-pose limpio, pero los
`pose_bone.rotation_quaternion` no estaban en identidad. Tripo3D (o
algún paso intermedio) exportó el rig con un pose state baked: aunque
Edit Mode muestra los huesos en sus posiciones rest, Pose/Object Mode
muestra el resultado de aplicar las rotaciones de pose acumuladas.

**Fix**: limpiar los pose transforms de cada bone a identidad:
```python
for pb in arm_obj.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.scale = (1, 1, 1)
```
+ detach action + frame_set(0). Los renders ortográficos confirman
T-pose limpio en RIGHT/FRONT/TOP. La leve forward-lean residual de
+6.27° en spine es del rest pose mismo (gorila ligeramente hunched
por diseño), aceptable.

Re-exportado sergei.glb con el pose state limpio → en juego el bind
pose ahora ES T-pose, y al cargar Idle action se ve la pose authored
encima del T-pose (V de brazos del character select).

### Otros ajustes Blender hechos en esta sesión

- `_reference` collection con `_REFERENCE_FLOOR` (plane 5×5 a z=feet
  level, wireframe) y `_REFERENCE_FORWARD` (cono a +X). Ambos con
  `hide_render=True`. Sirven como referencia visual sin contaminar el
  export gracias a `use_selection=True`.
- ParentNode rotation reset (-3° de yaw → 0°).

### Template + checklist documentado

Para no repetir todo este diagnóstico con cada crítter futuro:

- **`tools/blender-mcp/critter-cleanup.py`** — script Python con
  pipeline completo (force OBJECT mode → clear pose → reset parent
  rotation → detect+remove placeholder actions → snapshot metrics
  → render 3 vistas → opcional re-export). Edita `CRITTER_ID` al
  inicio y corre. Idempotente, no destructivo si `do_export=False`
  (default).
- **`BLENDER_MCP.md`** — sección "Per-critter sanity checklist
  (post-import)" con los 7 pasos + descripción del fallback runtime.

### Files changed

- `src/critter-skeletal.ts` — filtro `isClipEffectivelyStatic` +
  filtrado en constructor + log de drops.
- `tools/blender-mcp/critter-cleanup.py` (new) — pipeline reutilizable.
- `BLENDER_MCP.md` — checklist de 7 pasos + reference floor + runtime
  fallback.
- `public/models/critters/sergei.glb` — re-exportado dos veces:
  primero sin placeholders (1064 KB → 811 KB), luego con pose state
  limpio (811 → 778 KB). Backup en `sergei.glb.bak` por si revertir.
- `scripts/inspect-sergei-clips.mjs` (new, throwaway) — diagnóstico
  ad-hoc de duración/variance por clip vía `@gltf-transform`.
- `tools/sergei-pose-baseline.json` (new) — snapshot de bones y
  métricas para diff posterior.
- `tools/sergei-views/` y `tools/sergei-views-cleared/` (new) —
  renders OpenGL de los 3 ejes ortográficos.

### Verification

- Typecheck (`npx tsc --noEmit`) — clean.
- `node scripts/verify-critter-glbs.mjs public/models/critters/sergei.glb`
  → `2 clips, 2/13 covered` (Idle + Run resuelven, resto sin
  placeholders sucios).
- `node scripts/inspect-sergei-clips.mjs` → variance > 0 en ambos
  clips reales.
- Preview dev server `npm run dev` → consola muestra
  `[Critter] skeletal animator attached: Sergei | clips: Idle, Run`.
  Headbutt eval test: state se mantiene en `'idle'` toda la duración
  (anticip + lunge + recovery), `isHeavyClipActive()` siempre `false`.
- Validación visual final pendiente del usuario en su navegador
  (preview cerrado para evitar interferencia con su test).

### Estado al cierre

- Sergei: rigged + clean T-pose bind + Idle/Run reales + transform
  tuning estable. Listo para autoring de animaciones distintivas
  cuando llegue el momento.
- Pipeline para futuros crítters documentado y scripteado.
- Próximo crítter sugerido: Shelly (tortuga) — primer no-humanoide
  para validar el flujo Blender MCP en un caso difícil. El template
  necesitará ajustes (los nombres de bones cambian por morfología).

## 2026-04-21 — Cheeto animated (8 clips) + skeletal policy + tooling cleanup

Primera integración completa post-decisión "Blender MCP en standby" —
Cheeto entra con 8 clips de Tripo Animate por el camino rápido
`gltf-transform` (sin roundtrip a Blender). Además, política definitiva
de estados esqueléticos para el resto del roster y limpieza general
de herramientas / residuos.

### Cheeto — 8 clips integrados

Source: Tripo Animate exportando con clips en NLA tracks
(`NlaTrack`, `NlaTrack.001`, …). 71.4 MB / 1.03 M verts.

Pipeline aplicado:
1. Rename por duración — las 8 durations del source matchean exacto
   con la tabla pasada por el usuario (tolerance 0.01 s).
2. `dedup + weld + simplify` (meshoptimizer, ratio 0.0048) → 31 966
   verts / 2.66 MB.
3. Write a `public/models/critters/cheeto.glb`.

Mapeo final:

| Source NLA     | Dur (s) | Nombre final          | Estado runtime |
|----------------|---------|-----------------------|----------------|
| NlaTrack.005   | 1.292   | `Run`                 | run            |
| NlaTrack.007   | 2.750   | `Ability1Pounce`      | ability_1      |
| NlaTrack.001   | 3.583   | `Ability3TigerRoar`   | ability_3      |
| NlaTrack.006   | 3.667   | `Fall`                | fall           |
| NlaTrack.004   | 3.875   | `Ability2ShadowStep`  | ability_2      |
| NlaTrack.003   | 6.000   | `Idle`                | idle           |
| NlaTrack.002   | 6.292   | `Defeat`              | defeat         |
| NlaTrack       | 10.792  | `Victory`             | victory        |

Los 8 clips pasan `isClipEffectivelyStatic` (max_var entre 0.068 y
1.998). Ninguno sufrió el flatten a 2-keyframes que afectó a Kermit
en el roundtrip por Blender — confirma que cuando el source ya está
limpio, saltarse Blender es la ruta correcta.

### Política skeletal definitiva (decisión 2026-04-21)

Tras discutir el perfil de cada bichito, se congelan 8 estados
esqueléticos como target universal y se descarta todo lo demás del
pipeline de clips. La capa procedural de `critter-animation.ts`
cubre el resto sin regresión.

Estados skeletal target (los 8):
`idle`, `run`, `ability_1`, `ability_2`, `ability_3` (ULTI),
`victory`, `defeat`, `fall`.

Estados procedurales / descartados:
- `walk` — **eliminado** (todos usan `run`; el procedural sway+bob
  cubre el intermedio).
- `headbutt_anticip` + `headbutt_lunge` — **procedurales para todos**
  (squash/stretch existente). Excepción por bichito solo si el
  usuario lo pide explícito.
- `respawn` — **sin clip**. La inmunidad corta + parpadeo actual
  cubre el feedback de aparición.
- `hit` — **procedural para todos**. No parece justificar clip
  esqueletal distinto al tilt/shake ya implementado.

Este bloque se aplicará a `STATE_KEYWORDS` + `SkeletalState` en
`src/critter-skeletal.ts` **después** de tener los 9 bichitos
integrados, para evitar tocar el resolver mientras el contenido
sigue entrando. El cambio es compatible: hoy el resolver ya tolera
los 13 estados y sólo resuelve lo que encuentra.

### Cobertura skeletal al cierre

| Bichito    | Cobertura | Detalle                                       |
|------------|-----------|-----------------------------------------------|
| Cheeto     | **8 / 8** | full kit desde Tripo Animate                  |
| Kermit     | **7 / 8** | ability_3 Hypnosapo = flicker procedural      |
| Sergei     | 1 / 8     | solo Idle por ahora                           |
| Kowalski   | 0 / 8     | pendiente                                     |
| Kurama     | 0 / 8     | pendiente                                     |
| Sebastian  | 0 / 8     | pendiente                                     |
| Shelly     | 0 / 8     | pendiente                                     |
| Sihans     | 0 / 8     | pendiente                                     |
| Trunk      | 0 / 8     | pendiente                                     |

Global: **16 / 72** estados (22%). El usuario está generando los
restantes vía Meshy AI + Tripo.

### Tooling — pipeline genérico + limpieza

**`scripts/import-critter.mjs`** (new) — reemplaza el throwaway
`import-cheeto.mjs` con un CLI reutilizable:

```
node scripts/import-critter.mjs <id> <source.glb> [flags]

Flags:
  --map <file|json>     mapping (default: scripts/mappings/<id>.json)
  --target-verts <N>    vertex budget (default 5000)
  --tolerance <S>       duration-match tolerance (default 0.01 s)
  --dry-run             print plan + ratio, don't write
```

**`scripts/mappings/<id>.json`** es la convención: array de
`{ dur, name }` con las durations en segundos y los nombres que
queremos en el GLB final (deben matchear los keywords de
`STATE_KEYWORDS`).

Fixture de referencia: `scripts/mappings/cheeto.json`.

**Borrados en esta sesión**:
- `scripts/import-cheeto.mjs` (sustituido por genérico).
- `scripts/inspect-cheeto-source.mjs`, `scripts/inspect-cheeto-clips.mjs`,
  `scripts/inspect-sergei-clips.mjs` (diagnósticos ad-hoc).
- `public/models/critters/sergei.glb.bak`,
  `public/animations/models/critters/sergei.glb.bak` (backups
  obsoletos — el GLB actual lleva días estable).
- `tools/sergei-pose-baseline.json`, `tools/sergei-views/`,
  `tools/sergei-views-cleared/` (renders de diagnóstico del
  cleanup de Sergei, ya no necesarios).

**`package.json`** — añadidos dos scripts npm:
- `npm run verify:glbs` → `node scripts/verify-critter-glbs.mjs`
- `npm run import:critter` → `node scripts/import-critter.mjs`

### Docs sincronizadas

- `BUILD_LOG.md` — esta entrada.
- `SUBMISSION_CHECKLIST.md` — cobertura skeletal (2/9) +
  política de estados.
- `VALIDATION_CHECKLIST.md` — sección 9 actualizada con la tabla
  de 9 bichitos y los 8 estados target.
- `CHARACTER_DESIGN.md` — columna "Anim" en la tabla de estado.

### Files changed

- `scripts/import-critter.mjs` (new) — pipeline genérico.
- `scripts/mappings/cheeto.json` (new) — fixture.
- `scripts/import-cheeto.mjs` (removed).
- `scripts/inspect-cheeto-source.mjs` (removed).
- `scripts/inspect-cheeto-clips.mjs` (removed).
- `scripts/inspect-sergei-clips.mjs` (removed).
- `public/models/critters/cheeto.glb` — 2.66 MB / 8 clips.
- `public/models/critters/sergei.glb.bak` (removed).
- `public/animations/models/critters/sergei.glb.bak` (removed).
- `tools/sergei-pose-baseline.json` (removed).
- `tools/sergei-views/` (removed).
- `tools/sergei-views-cleared/` (removed).
- `package.json` — npm scripts `verify:glbs` + `import:critter`.
- `BUILD_LOG.md` — esta entrada.
- `SUBMISSION_CHECKLIST.md` — progreso skeletal.
- `VALIDATION_CHECKLIST.md` — tabla de 9 bichitos.
- `CHARACTER_DESIGN.md` — columna Anim.

### Verification

- `node scripts/verify-critter-glbs.mjs public/models/critters/cheeto.glb`
  → `8 clips, 8/13 covered` (los 5 restantes caen a procedural por
  política, no son fallos de naming).
- `node scripts/import-critter.mjs cheeto <source> --dry-run` →
  mapping OK, ratio 0.0048 / target 5000.
- `npx tsc --noEmit` — clean.
- Build (`npm run build`) — ok, sin regresión de tamaño.

### Estado al cierre

- Roster animado: **2/9** al full (Cheeto 8/8, Kermit 7/8 + 1
  procedural), resto pendiente.
- Pipeline de import listo para Meshy / Tripo en cadena: un único
  `import-critter.mjs` + un JSON de mapping por bichito.
- Todo lo obsoleto del cleanup de Sergei fuera del repo.
- **Nada de gameplay tocado** — la capa skeletal sigue opcional y
  la procedural intacta.

## 2026-04-21 (sesión 2) — Kowalski animado (8/8) + title polish + OG tags + BADGES_DESIGN

Sesión larga pero cómoda. Un bichito nuevo importado por el pipeline
nuevo, UI del title screen repulida, y documento de diseño para los
cinturones de logros.

### Kowalski — 8 clips integrados

Tripo Animate source (71.1 MB, 1.03 M verts), pipeline genérico
`scripts/import-critter.mjs`:

| NLA         | Dur (s) | Nombre final          | Estado runtime |
|-------------|---------|-----------------------|----------------|
| NlaTrack.007| 0.792   | `Run`                 | run            |
| NlaTrack.002| 2.250   | `Ability3IceAge`      | ability_3      |
| NlaTrack.004| 3.667   | `Ability1IceSlide`    | ability_1      |
| NlaTrack.006| 3.792   | `Ability2Snowball`    | ability_2      |
| NlaTrack.005| 5.708   | `Fall`                | fall           |
| NlaTrack.001| 6.000   | `Defeat`              | defeat         |
| NlaTrack.003| 13.500  | `Victory`             | victory        |
| NlaTrack    | 15.583  | `Idle`                | idle           |

Resultado: **1645 KB / 10 683 verts** — más ligero que Cheeto
(2665 KB) porque la malla de Kowalski es menos compleja. 8/8 clips
pasan el runtime-static filter con margen amplio (max_var entre
0.53 y 1.99).

`STATE_KEYWORDS` ya cubría `ice_age`, así que 0 ajustes en el
resolver.

### inspect-clips.mjs — utilidad permanente

Para evitar volver a crear throwaways ad-hoc cada vez que queremos
confirmar que un GLB sobrevive al filtro runtime, añadido
`scripts/inspect-clips.mjs` — toma cualquier GLB y reporta per-clip:
duración, channels, alive tracks, max_var, verdict (KEEP / DROP).
Reusable, idempotente, sin side-effects.

Npm alias: `npm run inspect:clips public/models/critters/<id>.glb`.

### Title screen polish

- **Meta OG / Twitter Cards** en el `<head>` siguiendo la receta
  de @s13k para #vibejam. TODO bien visible para `public/og-image.png`
  (1200×628) — mientras no exista la imagen, el preview cae a "no
  image" sin romper nada.
- **Firma `@RGomezR14`** — rediseñada como pill con blur + borde
  dorado, handle en dorado sólido, hover eleva + brilla. Antes era
  casi invisible (opacity 0.45).
- **`.controls-hint`** — cada binding en un `<kbd>` pill, añadida la
  `L` (ultimate) que faltaba + línea separada de
  "🎮 Gamepad auto-detected — A/X/Y/RB". Opacity 0.82 (era 0.45).
- **Responsive** — tres breakpoints (`max-width 820`, `max-width 520`,
  `max-height 520`) que stackean character-select vertical en móvil,
  ajustan tamaños de slots y buttons, aprietan vertical en landscape
  corto. Sin rediseño, solo cobertura.

### BADGES_DESIGN.md — plan sin implementación

Documento de diseño para los cinturones tipo WWE que el usuario
planteó como sistema de trofeos (en vez de ranking global):

- **9 Champion belts** (uno por crítter, desbloqueo por N victorias).
- **7 trofeos globales** (Speedrun, Iron Will, Untouchable,
  Survivor, Globetrotter, Arena Apex, Pain Tolerance).
- Storage extension a `br-stats-v2` con migración suave.
- Prompts base para generación IA (consistencia entre los 16 assets,
  tabla de habitat/paleta por crítter).
- Plan por fases post-animaciones / post-signatures. Decisiones
  abiertas tracked al final del doc.

### `npm run check` preflight

`tsc --noEmit && verify:glbs && vite build` en un comando. Gate
obvio antes de merge `dev → main`.

### Files changed

- `scripts/inspect-clips.mjs` (new) — utility permanente.
- `scripts/mappings/kowalski.json` (new) — fixture.
- `public/models/critters/kowalski.glb` — 1.65 MB, 8 clips.
- `BADGES_DESIGN.md` (new) — diseño de logros tipo cinturón.
- `index.html` — meta OG/Twitter + signature + controls + responsive.
- `package.json` — `inspect:clips` + `check` npm scripts.
- `SUBMISSION_CHECKLIST.md`, `VALIDATION_CHECKLIST.md`,
  `CHARACTER_DESIGN.md`, `BUILD_LOG.md` — cobertura 3/9.

### Verification

- `node scripts/inspect-clips.mjs public/models/critters/kowalski.glb`
  → 8/8 clips alive.
- `node scripts/verify-critter-glbs.mjs public/models/critters/kowalski.glb`
  → 8 clips, 8/13 covered.
- `npm run check` — tsc + verify + build todos clean.
- Bundle: index.html 37 kB → 45 kB (+8 kB por meta tags + CSS nuevo).

### Estado al cierre

- Roster animado: **3/9** al full (Cheeto, Kermit, Kowalski) +
  Sergei idle-only. 5 pendientes: Kurama, Sebastian, Shelly,
  Sihans, Trunk.
- UI del title screen visualmente más profesional, firma del autor
  respira, social cards listas para cuando llegue la imagen hero.
- Badges congelados en diseño; no implementados aún.

## 2026-04-21 (sesión 3) — Trunk animado + OG image live + cleanup + stats polish

Sesión tarde. Cuatro tareas pequeñas y un bichito más.

### Trunk — 8 clips integrados

Tripo Animate, pipeline estándar:

| NLA         | Dur (s) | Nombre final            | Estado runtime |
|-------------|---------|-------------------------|----------------|
| NlaTrack.005| 1.292   | `Run`                   | run            |
| NlaTrack.007| 1.958   | `Ability3GroundPound`   | ability_3      |
| NlaTrack.001| 3.875   | `Ability2TrunkGrip`     | ability_2      |
| NlaTrack.006| 4.583   | `Ability1TrunkRam`      | ability_1      |
| NlaTrack.002| 5.542   | `Defeat`                | defeat         |
| NlaTrack    | 5.583   | `Idle`                  | idle           |
| NlaTrack.003| 5.708   | `Fall`                  | fall           |
| NlaTrack.004| 12.792  | `Victory`               | victory        |

Resultado: 1.58 MB, 10 762 verts, 8/8 clips alive (max_var 0.78–2.00).
`STATE_KEYWORDS` ya resolvía `pound` y `grip`, 0 cambios en el
resolver.

**Nota de diseño**: la animación `Ability2TrunkGrip` incluye el giro
de 180° + lanzamiento, pero NO incluye el estiramiento horizontal de
la trompa (el "latigazo"). Cuando toquemos el comportamiento de
Trunk Grip, el stretch irá procedural vía `glbMesh.scale` similar
al `chargeStretch` existente. Anotado en `CHARACTER_DESIGN.md` para
no olvidarlo cuando se abra la ability.

### OG image live

- `public/og-image.png` — 1200×628 top-anchored desde
  `Portada/BichitosRumble_Horizontal.png` (1536×1024). 1.92 MB.
- `scripts/make-og-image.mjs` gana `--position` flag para recrop
  (default centre; usé top por el título arriba).
- Meta tags ya apuntan a `/og-image.png`, así que X / Discord /
  WhatsApp pickear la card en cuanto deploye.

### Preview polish (character-select)

- `SkeletalAnimator.isLoopingClipActive()` nuevo. Cuando un clip
  idle/walk/run está activo, el procedural bob/bounce se zeroan
  para no doblar la animación del clip. Fix visible de "brinco"
  en Cheeto/Kermit/Kowalski/Trunk en character-select.
- Preview canvas 320×280 → 380×340, pedestal más alto/ancho con
  rim dorado + glow suelo, tres puntos de luz en vez de dos,
  cámara más apretada (FOV 35→32, z 5.5→4.8), halo radial CSS
  detrás del canvas.

### End-screen stats polish

- ⚡ Headbutts · ✨ Abilities · 💀 Falls · 🔁 Respawns con iconos.
- Count-up animado 0 → target en 700 ms easeOutCubic.
- Panel eleva con slide+fade 350 ms, borde dorado, separadores
  verticales entre stats, value 22→26 px con glow.
- Signature `setEndMatchStats(stats)` sin cambios — zero refactor
  downstream.

### Dead-code audit

Con el gate `noUnusedLocals + noUnusedParameters` ahora on en
`tsconfig.json`. Removed: `stopMusic`, `isMusicPlaying`, `getStats`
(re-add cuando BADGES Phase 1), `hasGamepadConnected`,
`isPortalExpanded`, `GRID_SLOTS`, + 4 unused locals (portalLegendEl,
RosterEntry/CRITTER_PRESETS imports, lastServerPhase). Privatizados:
setSfxMuted/setMusicMuted, applyKnockbackTilt/applyHitFlash,
hasTouchSupport/isNarrowViewport. Bundle net neutral (minifier ya
tree-shook).

### Title screen polish

- Firma `@RGomezR14` ahora pill con borde dorado + blur, handle en
  dorado sólido, hover eleva.
- `.controls-hint` con kbd-pills por binding, añadido L (ultimate)
  + línea de gamepad auto-detected.
- Meta OG + Twitter tags completos en `<head>`.
- Tres breakpoints responsive nuevos (820 / 520 / 520-height).

### Tooling nuevo

- `scripts/inspect-clips.mjs` — per-clip variance report reusable
  (sustituye throwaways ad-hoc).
- `scripts/make-og-image.mjs` — 1200×628 generator con sharp.
- `scripts/import-critter.mjs` (sesión 1) — pipeline genérico con
  `scripts/mappings/<id>.json` convention.
- `npm run` aliases: `verify:glbs`, `inspect:clips`, `import:critter`,
  `og`, `check`.

### Cobertura al cierre

**4/9 bichitos full** (Cheeto 8/8, Kermit 7/8 + Hypnosapo procedural,
Kowalski 8/8, Trunk 8/8). **Sergei** 1/8 (solo Idle). Pendientes
**5/9**: Kurama, Sebastian, Shelly, Sihans.

Total skeletal: **32 / 72** estados (44%).

### Validation adds

Añadidas al `VALIDATION_CHECKLIST.md`:
- §15 Title screen polish (firma / controles / responsive)
- §16 Social card OG (X / Discord / validator)
- §17 Preview polish (no double bob / model + pedestal prominence)
- §18 End-screen stats polish (icons / count-up / panel lift)
- §19 Dev tooling nuevo (npm scripts)
