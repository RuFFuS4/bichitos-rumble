# Build Log — Bichitos Rumble

> **Active entries from 2026-04-20 onward.** The first two weeks of
> development (prototype → roster → first public deploy → online 4P →
> gamepad → skeletal loader → /animations lab → arena shake) are
> archived verbatim in
> [`docs/archive/BUILD_LOG-pre-launch-2026.md`](docs/archive/BUILD_LOG-pre-launch-2026.md).
> If you need context for a decision older than 2026-04-20, look there.

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
