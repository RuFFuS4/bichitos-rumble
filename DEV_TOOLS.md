# Dev Tools — Bichitos Rumble Lab (`/tools.html`)

Documento vivo. **Actualízalo** cada vez que se añada/modifique un panel,
un método del `DevApi`, un `EventType`, etc. Si este `.md` se queda atrás,
el lab se vuelve ilegible para quien entre después.

---

> **Studio shell** — `/studio.html` (H3 slice 6) frames the four labs
> (Match Lab / Animations / Calibrate / Decor) in **lazy kept-alive
> iframes**: switching tabs preserves each lab's full state, `1-4`
> switches tab (forwarded from inside the iframes — the shell attaches
> its listener to each same-origin iframe document on load),
> `#<tab>` deep-links (e.g. `/studio.html#calibrate`; the hash wins
> over the remembered tab at boot), a `●` dot on a tab marks a lab
> with an **unapplied localStorage working copy** (keys under its tool
> prefix, `:ui` state excluded; live via the `storage` event), and
> `⟳ reload tab` reloads only the active iframe. The standalone pages
> below stay first-class — the studio just frames them.
>
> **Sibling tools** — all internal (`noindex`), accessible by URL only,
> linked from the bottom of this sidebar:
>
> 1. [`animations lab`](../../bichitos-mesh2motion/README-INTEGRATION.md) (repo hermano `bichitos-mesh2motion`, dev server `:5174`) —
>    mesh2motion-based lab for **CREATING** animation clips and
>    exporting GLBs. Upstream flows (Explore/Retarget) stripped;
>    only `create.html` ships.
> 2. `/anim-lab.html` — **animation VALIDATION + RUNTIME OVERRIDE**
>    lab (added 2026-04-24). Loads the game's real `SkeletalAnimator`
>    for any roster critter, lists every clip + resolved state + the
>    tier that won (override / exact / prefix / contains / missing),
>    lets the user play clips manually, override the mapping (clip +
>    speed + loop) via dropdowns, and export as TS snippet, JSON patch
>    or one-click **Apply to source** into
>    `src/animation-overrides.ts` (sparse merge, H3 slice 1). Session
>    working copy in `anim-lab:overrides`; selected critter persisted
>    in `anim-lab:ui`. Fills the gap between "generate clips in
>    /animations" and "run clips in the game".
> 3. `/calibrate.html` — per-critter scale / pivotY / rotation lab
>    (added 2026-04-24). Not related to animation; silhouette sizing.
>    Per-critter `localStorage` working copy (`calibrate:<critterId>`)
>    added 2026-04-26 — slider tweaks survive reloads, "Reset local
>    working copy" reverts the selected critter to authored
>    `roster.ts` values. Export emits TS snippet (manual paste) **or**
>    JSON patch (`npm run apply-tool-patch`).
> 4. `/decor-editor.html` — per-pack in-arena decoration placement
>    lab (added 2026-04-25, UX iteration 2026-04-25). Top-down ortho
>    view of the arena with band-radius wireframes. Click-to-place,
>    drag-to-move with offset + ring clamp, multi-select via list,
>    sliders, type swap, delete. Ctrl+Z / Ctrl+Y for undo/redo (50
>    snapshots). Per-pack auto-save in `localStorage`
>    (`decor-editor:<packId>`) with a "Reset local" button to wipe
>    the working copy and reload the code layout. Optional checkbox
>    to render real GLBs instead of placeholders (lazy + cached;
>    falls back to placeholders during a drag for snappy feedback).
>    Export emits a paste-ready TS snippet for
>    `src/arena-decor-layouts.ts`.
>
>    **Preview in game** (added 2026-04-25 final iteration): button
>    saves the current working copy to localStorage and opens the
>    game with `?arenaPack=<id>&decorPreview=1`. The game substitutes
>    your localStorage layout for `DECOR_LAYOUTS[<id>]` on the next
>    offline match (only for that pack, only with that flag); a
>    "← back to editor" banner stays pinned top-centre while preview
>    mode is active. Production URLs without those params are
>    unaffected. Export still defines the canonical layout — preview
>    is a working buffer.
>
>    **Scale model** (refactored 2026-04-25): each prop type carries
>    a `displayHeight` (world units); the loader auto-fits the GLB to
>    that height via bbox measurement. The slider's `placement.scale`
>    is now a relative multiplier (1.0 = author intent). The editor
>    header shows `≈ X u (n× critter)` so you see the final size and
>    its ratio against a critter (1.7 u). Same auto-fit runs in the
>    GLB preview AND in-game so what you see in the editor matches
>    what ships.
>
> **Shared infrastructure** (2026-04-25, extended 2026-04-26):
> `src/tools/tool-storage.ts` exposes:
>
>   - localStorage helpers — `loadFromStorage / saveToStorage /
>     clearStorage / hasStorageKey / storageDivergesFromCode` + key
>     builder. Consumed by `/decor-editor` (per-pack), `/calibrate`
>     (per-critter) and `/anim-lab` (whole session under
>     `anim-lab:overrides` — F5 restores the working copy; Reset clears
>     the current critter from storage too).
>   - **ToolPatch envelope** + helpers — `makeToolPatch /
>     copyPatchToClipboard / downloadPatch` and the `CalibratePatch /
>     AnimLabPatch / DecorEditorPatch` discriminated union. Every lab
>     emits the same `{ tool, version, generated, data }` shape so a
>     single Node script can apply the patch (see workflow below).
>
> New internal tools should consume this module from day one.

### Cabina de tuning (afilado slice B)

- **Hotkeys de tiempo** (match lab, fuera de inputs): `F7`/`.` step de
  un tick (implica pausa — revisar squash/hit-stop frame a frame),
  `F8` pausa/reanuda, `F9` slow-mo 0.3x toggle, `F10` restart con el
  mismo seed+lineup. Botón `Step ⏭` en Playback para lo mismo.
- **Game feel (FEEL)** — sección en Tuning con sliders auto-generados
  de TODAS las hojas numéricas de `FEEL` (gamefeel.ts, 2 niveles).
  Mutan el objeto en vivo (cada consumidor lo lee por frame — efecto
  inmediato sin reload), persisten divergencias en `match-lab:feel`, y
  exportan como **`feel-patch`** (4º tool type del pipeline): dot-paths
  `seccion.clave` → número. El apply reescribe SOLO el token numérico
  en src/gamefeel.ts — los comentarios de tuning sobreviven — y nunca
  crea claves. Reset FEEL vuelve al baseline autoral.

### Tuner de habilidades + hitbox visible (afilado slice C)

- **Calibrate**: anillo rojo a ras de suelo por critter = su
  `physicsRadius` real (el círculo de colisión que usa el juego).
  Toggle "Show hitbox rings", slider "Hitbox r" (0.2-1.2), persistencia
  por critter, y el campo entra en CalibratePatch/snippet SOLO al
  divergir (si no, se conserva la `R` compartida de roster.ts).
- **Match lab → Abilities (player)**: sliders auto-generados de todos
  los campos numéricos de las defs J/K/L del critter jugador. Mutan la
  def en vivo (aplica en el siguiente cast y sobrevive restarts — las
  defs son objetos compartidos de CRITTER_ABILITIES; baselines
  cacheados al primer avistamiento). Sin ToolPatch todavía
  (deliberado): "Copy JSON" agrupa lo tuneado por critter para portarlo
  a mano a los overrides de abilities.ts.

### Apply-patch workflow (2026-04-26, one-click desde H3 slice 4)

End-to-end loop for `/calibrate`, `/anim-lab` and `/decor-editor` JSON
patches (decor emits since H3 slice 3; its design notes live in the
pack HEADER comments of `DECOR_LAYOUTS` because the apply replaces each
pack's array wholesale) —
designed to remove the manual paste step.

#### Botón "Apply to source" (dev server — el flujo por defecto)

Con `npm run dev` corriendo, cada lab tiene un botón **⚡ Apply to
source** que cierra el círculo sin tocar ficheros a mano:

  1. El lab hace `POST /__tool-patch/preview` con el ToolPatch. El
     endpoint vive en `scripts/vite-tool-patch-plugin.mjs` (montado
     con `apply: 'serve'` — **solo existe en el dev server**), valida
     con el MISMO `validateToolPatch` del CLI y ejecuta los mutadores
     puros de `scripts/tool-patch-core.mjs`. Nunca escribe fuera de
     los tres ficheros target conocidos (el cliente no elige rutas).
  2. `src/tools/apply-ui.ts` muestra el diff devuelto en un modal
     BLOQUEANTE — nada se escribe hasta confirmar.
  3. Al confirmar: el lab limpia su working copy de localStorage
     ANTES del write (hook `onBeforeApply`; el write dispara un
     full-reload de Vite que compite con la respuesta HTTP — si el
     apply falla, `onApplyFailed` restaura la copia) y hace
     `POST /__tool-patch/apply`.
  4. El server escribe el fichero fuente en el **working tree** (commit
     sigue siendo acto humano: `git diff` + commit) y Vite recarga la
     página, que arranca ya desde el código recién aplicado.

En una build de producción los endpoints no existen (no hay server
code) — el fetch da 404 y el modal lo explica: usa el flujo CLI.

#### Flujo CLI (fallback / builds / batch)

  1. Tune in the lab. localStorage holds the working copy so reloads
     don't lose anything.
  2. Click **📦 Copy JSON patch** (clipboard) or **💾 Download
     patch.json** (file).
  3. Save the JSON to `tool-patch.json` at the repo root.
  4. Run:
     ```
     npm run apply-tool-patch              # writes the file
     npm run apply-tool-patch -- --dry-run # preview the diff first
     npm run apply-tool-patch -- --patch=path/to.json  # alt input
     ```
  5. The script (`scripts/apply-tool-patch.mjs`, thin CLI over
     `scripts/tool-patch-core.mjs` — tested by `npm run test:patch`)
     routes by `tool` field:
       - `calibrate`     → rewrites per-critter `scale / pivotY /
         rotation` in `src/roster.ts`. Sparse: only critters in the
         patch are touched. Field-like text inside comments is never
         rewritten.
       - `anim-lab`      → sparse MERGE into `ANIMATION_OVERRIDES` in
         `src/animation-overrides.ts` (H3 slice 1, 2026-08-19).
         Critters absent from the patch keep their blocks untouched;
         states absent from a patched critter survive; comments
         survive. The merge never DELETES an override — to remove
         one, edit the source by hand.
       - `decor-editor`  → rewrites the per-pack body in
         `src/arena-decor-layouts.ts`. Sparse: packs absent from the
         patch are left untouched.
  6. Coloured diff is printed before any write. With `--dry-run`,
     nothing is written. Without it, the file is rewritten and the
     script suggests `git diff <file>` for review.

The TS-snippet export buttons remain for manual-paste workflows and as
a fallback when clipboard / Node is unavailable.
>
> Full anim-lab design in BUILD_LOG.md §"2026-04-25 Animation
> Validation Lab". Decor system design in BUILD_LOG.md §"2026-04-25
> In-arena decor". Full mesh2motion integration notes:
> [`bichitos-mesh2motion/README-INTEGRATION.md`](../../bichitos-mesh2motion/README-INTEGRATION.md) (repo hermano desde H3 slice 8).

## Propósito

El lab es un entorno **interno** (no para jugadores) que reutiliza el
motor real del juego y expone una superficie de debug/balance densa. Está
pensado para:

- Reproducir bugs con semillas deterministas de arena.
- Aislar comportamiento de bots (modo por modo).
- Forzar habilidades, cooldowns, teleports, etc. sin jugar "de verdad".
- Medir FPS / drawcalls / triangles / geometría.
- Ver el input real (teclado + gamepad) en tiempo real.
- Grabar partidas completas (eventos + snapshots + acciones) para
  análisis offline.

**Acceso**: solo escribiendo `/tools.html` en la URL. **NUNCA** se enlaza
desde el juego (portada, menús, end-screen). Tiene `<meta name="robots"
content="noindex, nofollow">` para evitar indexación.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    tools.html  (entry)                      │
│                        ↓                                    │
│                src/tools/main.ts                            │
│                        │                                    │
│           creates Game + DevApi + Sidebar                   │
│                        │                                    │
│         ┌──────────────┴──────────────┐                     │
│         ↓                             ↓                     │
│    src/tools/dev-api.ts      src/tools/sidebar.ts           │
│    (single debug surface)    (plain DOM panels)             │
│         │                                                    │
│         └──────→  Game / Critter / Renderer                  │
└─────────────────────────────────────────────────────────────┘
```

### Regla clave

**La UI (sidebar) habla SOLO con `DevApi`.** No llama a `game.*`
directamente (salvo `devApi.game.player` para leer estado inmutable como
`animPersonality`). `Game` conserva únicamente 5 métodos `debug*`:

| Método                          | Rol                                |
|---------------------------------|------------------------------------|
| `debugSpeedScale` (campo)       | Multiplicador global de `dt`       |
| `debugStartOfflineMatch`        | Lanza partida con lineup concreto  |
| `debugForceArenaSeed`           | Regenera arena con seed dado       |
| `debugGetArenaInfo`             | Snapshot read-only de la arena     |
| `debugEndMatchImmediately`      | Mata la partida actual             |

**Todo lo nuevo va a `DevApi`.** Si necesitas tocar algo interno que no
expone `Game`, primero evalúa si extenderlo es la capa correcta. Si
añades un método debug más a `Game`, debe justificarse (nunca una
utilidad que podría vivir en DevApi).

### DevApi en detalle

Fichero: `src/tools/dev-api.ts` (~600 LOC).

Responsabilidades:

1. **Match control** (wrappers): `startMatch`, `endMatch`, `forceSeed`,
   `setSpeed`, `getSpeed`.
2. **Snapshots read-only**: `getArenaInfo`, `getPlayerSnapshot`,
   `getBotSnapshots`, `getPerf`, `getInputSnapshot`. Los snapshots
   **copian valores**, nunca exponen referencias mutables.
3. **Bot behaviour control**: `setBotBehaviour(index, tag)`,
   `setAllBotsBehaviour(tag)`. Escribe a `Critter.debugBotBehaviour`, que
   `bot.ts` lee cada frame. Default `'normal'` = producción.
4. **Gameplay helpers**: `resetPlayerCooldowns`, `forceAbility(slot)`,
   `teleportPlayer(x,z)`, `teleportBotsPreset(preset)`.
5. **Event log**: `pushEvent`, `getEventLog` (ring buffer de 60),
   `clearEventLog`. La captura es por **polling edge-detection** dentro
   de `tick(dt)`. Cero acoplamiento con el motor.
6. **Performance sampling**: `tick` mantiene una ventana de 30 muestras
   de FPS y lee `renderer.info`.
7. **Recording**: sesión de grabación exhaustiva (ver sección abajo).

**Regla de oro**: toda mutación queda registrada como `LabAction` en la
grabación en curso. Eso significa: cualquier método público que cambie
estado del juego debe llamar a `this.logAction(...)`.

### Sidebar

Fichero: `src/tools/sidebar.ts`. DOM plano, zero framework. Cada panel
tiene una función `refreshXxx` que se llama en dos intervalos:

- **Fast (~12 Hz, 80 ms)**: cooldowns, event log, perf, input.
- **Slow (~4 Hz, 250 ms)**: arena, info, bots, recording.

Split porque los paneles "fast" piden reactividad (un cooldown debe
sentirse en vivo) y los "slow" cambian de forma discreta.

**Importante**: los DOM dentro de un panel NO se recrean cada refresh.
En el panel Bots, por ejemplo, cada fila tiene un `<select>` que se crea
UNA vez y solo se actualiza el `value` (y solo si el select no está
focusseado). Esto evita el bug clásico: "los dropdowns no se abren
porque se destruyen cada 250 ms".

---

## Paneles actuales

Los paneles están agrupados en 4 bloques temáticos con una barra de color
propia. Cada panel es **colapsable** (click en el header). Los defaults
priorizan el flujo "arranca partida → observa → itera".

### Grupos y orden

```
┌─ MATCH SETUP ──────┐  (azul)    config previa a la partida
│  Matchup     [▸]   │
│  Arena       [▸]   │
└────────────────────┘
┌─ LIVE CONTROL ─────┐  (rojo)    acciones DURANTE la partida
│  Bots        [▾]   │  ← default expandido
│  Gameplay    [▾]   │  ← default expandido
│  Playback    [▸]   │
└────────────────────┘
┌─ OBSERVE ────────────┐  (verde)   paneles live read-only
│  Recording      [▾]  │  ← default expandido
│  Performance    [▾]  │  ← default expandido
│  Skeletal clips [▸]  │
│  Input          [▸]  │
│  Player info    [▸]  │
└──────────────────────┘
┌─ TUNING ─────────────┐  (amarillo) ajustes de grano fino
│  Animation      [▸]  │
│  Badges         [▸]  │
│  P/W/S stats    [▸]  │
│  Critter parts  [▸]  │
└──────────────────────┘
```

`[▾]` = expanded por defecto · `[▸]` = collapsed por defecto.

### Qué cubre cada panel

| Panel          | Contenido                                                              |
|----------------|------------------------------------------------------------------------|
| Matchup        | Player + 3 bots dropdown · Start / Restart same seed / Randomize / Mirror |
| Arena          | Seed · pattern · batches · Force Seed / Replay Last / Copy Seed       |
| Bots           | Dropdown por bot + dropdown bulk "All bots"                            |
| Gameplay       | Cooldowns live + Reset CDs + Force J/K/L + TP player/bots + event log  |
| Playback       | Speed slider · Pause / Slow 0.3× / Normal 1× / End Match               |
| Recording      | Estado + Stop / Download JSON / Download MD / Clear                    |
| Performance    | FPS · frameMs · drawCalls · triangles · geo · tex · critters · fragments |
| Skeletal clips | Clips del GLB del player, play por clip · Stop playback · Refresh — cierra el pipeline Mesh2Motion/Tripo: verifica que un GLB re-exportado riggea y que el resolver fuzzy asigna el estado correcto |
| Input          | Move vector · held actions · teclas activas · gamepads                 |
| Player info    | Readout verbose de stats del player actual                             |
| Animation (player) | 7 sliders sobre `animPersonality` + Reset Derived + Copy Values    |
| Badges         | Cinturones sin jugar 20 partidas: Unlock all / Lock all / Trigger toast demo / Clear ALL stats — opera sobre localStorage vía DevApi; lo que reescribe el blob recarga la página |
| P/W/S stats    | Tabla read-only de la tupla Power/Weight/Speed (-2..+2) por critter y los números derivados — se rebalancea editando `src/pws-stats.ts` |
| Critter parts  | Sliders live por hueso del critter elegido (a 0 = ocultar la parte, p.ej. "hide in shell" de Shelly) · Reset bones — solo con partida activa |

### Defaults y heurística de colapso

Reglas que usé al decidir qué va expandido:

- Lo que cambias **una vez** al inicio → colapsado (Matchup, Arena).
- Lo que tocas **durante** la partida de forma continua → expandido
  (Bots, Gameplay).
- Lo que **observas** en cada partida → expandido (Recording,
  Performance).
- Lo **verbose** o raramente usado → colapsado (Input, Player info,
  Animation, Playback).

El estado de colapso es **per-pageload** — no se persiste. Si refresc
as, vuelve a los defaults. Decisión intencional: una persistencia en
localStorage habría añadido complejidad sin ganancia real para un
lab interno.

---

## Event log (`EventType`)

Emitidos automáticamente vía polling edge-detection en `DevApi.tick`:

| Type              | Cuándo se emite                                    | Actor     |
|-------------------|----------------------------------------------------|-----------|
| `headbutt`        | `isHeadbutting` pasa de false → true               | critter   |
| `ability_cast`    | `abilityStates[i].active` pasa de false → true     | critter   |
| `ability_end`     | `abilityStates[i].active` pasa de true → false     | critter   |
| `fall`            | `falling` pasa de false → true                     | critter   |
| `respawn`         | `falling` pasa de true → false y sigue vivo        | critter   |
| `eliminate`       | `alive` pasa de true → false                       | critter   |
| `collapse_warn`   | `arena.warningBatch` cambia a un valor ≥ 0         | `arena`   |
| `collapse_batch`  | `arena.collapseLevel` cambia a un valor > 0        | `arena`   |
| `match_started`   | Explícito desde `startMatch`                       | `lab`     |
| `match_ended`     | Explícito desde `endMatch`                         | `lab`     |

**Añadir un nuevo tipo**:

1. Amplía la union `EventType` en `dev-api.ts`.
2. Si es automático (edge detection), añade la lógica a
   `pollGameplayEvents` o `pollArenaEvents` con una WeakMap para el
   "último valor visto".
3. Si es manual (emitido desde otro lugar del lab), llama a
   `devApi.pushEvent(type, actor, details)`.
4. Añade un color en el CSS del sidebar:
   `#lab-sidebar .evt-<type> .evt-type { color: #xxx; }`.
5. Si es relevante en el MD summary, agrégalo en
   `buildRecordingSummaryMD`.

---

## Recording

Ver `RecordingSession` en `src/tools/dev-api.ts` para el shape completo.

### Se auto-inicia con cada match

Llamar a `devApi.startMatch(...)` cierra la sesión previa (si había) y
abre una nueva con el seed + player + bots actuales.

### Contenido de una sesión

```ts
RecordingSession {
  version: 1,
  meta: {
    playerName, botNames, seed, arenaPattern,
    startedAt, startedAtIso,
    endedAt, endedAtIso, durationSec,
  },
  events: GameplayEvent[],     // TODOS los eventos, sin límite
  actions: LabAction[],        // cada mutación hecha desde el lab
  snapshots: RecordingSnapshot[], // sampled cada 200 ms
  outcome: { survivor, reason },
}
```

### Snapshots

Cada `RecordingSnapshot` captura, para TODOS los critters:

- índice, nombre, role, alive, lives
- posición + velocidad
- `falling`, `immunityLeft`, `headbuttCooldown`, `isHeadbutting`
- estado de cada habilidad (active, cooldownLeft, windUpLeft, durationLeft)
- `behaviour` (solo bots)

Más arena (`collapseLevel`, `warningBatch`, `radius`) y perf (fps,
frameMs, drawCalls, triangles).

A 200 ms y 4 critters, una partida de 90 s genera ~450 snapshots.
Tamaño JSON típico: **0.5–1.5 MB**. Sin problema para descarga ni
análisis offline.

### Lab actions

Cada mutación desde el lab (force_ability, teleport, cambio de bot
behaviour, reset cooldowns, force_seed, set_speed, end_match) se loguea
con tiempo relativo al inicio del recording **y** al inicio del match.
Eso permite reproducir la sesión paso a paso si hace falta.

### Descarga

- **JSON**: raw dump. Cómo consumir: `JSON.parse` y analizar.
- **MD**: resumen humano auto-generado con `buildRecordingSummaryMD` —
  setup, outcome, conteo de eventos, stats por critter, timeline de
  colapso, lab actions, stats de sampling.

Filename: `bichitos-<ISO-stamp>-<player>-<bot1>-<bot2>-<bot3>.<ext>`.

### Límites actuales

- Solo una sesión viva a la vez. Nueva partida sobrescribe la anterior si
  no la descargaste. El panel Recording muestra claramente si hay una
  grabación cerrada sin descargar aún (tiene `outcome` y `duration`).
- No hay replay automático del JSON (cargar un JSON y reproducirlo).
  Posible ampliación futura, por ahora es un dump pasivo.

---

## Cómo añadir una feature nueva al lab

Flujo canónico. Lee esto antes de tocar código:

### 1. Decide si es `DevApi` o no

**Sí** si:
- Muta estado del juego (posiciones, cooldowns, bots, arena, etc.).
- Lee estado que ya está en `game.*` pero que queremos exponer como
  snapshot.
- Graba algo en la sesión de recording.

**No** (se queda en el sidebar como helper DOM) si:
- Es presentación pura (animar una barra, formatear un número).
- Copy-to-clipboard de valores que ya salen del DevApi.

### 2. Si es DevApi, añade un método público

- **Mutaciones** siempre llaman a `logAction(type, details)` al final.
- **Lecturas** devuelven snapshots planos, nunca referencias mutables.
- Si la mutación emite un evento conceptual, llama a
  `pushEvent(type, actor, details)` para que aparezca en el event log y
  en la sesión de recording.

### 3. Si añades un `LabActionType`, actualiza:

- `src/tools/dev-api.ts`: union `LabActionType`.
- `buildRecordingSummaryMD`: se lista automático en la tabla de actions,
  pero revisa que el JSON.stringify de los details sea legible.

### 4. Enchúfalo al sidebar

- Elige el grupo temático donde encaja (SETUP / LIVE CONTROL / OBSERVE /
  TUNING) y añade la sección como hijo del wrapper del grupo:

  ```ts
  const observeGroup = group(root, 'Observe', 'observe');
  const mySec = section(observeGroup, 'My new panel');
  ```

  Si necesitas un grupo nuevo entero, añade una nueva `GroupKind` y
  define su color en el CSS (busca `.lab-group.*` y el border-left color
  del section para completar las 2 capas).

- **Decide el default collapsed**:
  - Expandido por defecto si el usuario lo mira **en cada partida**
    (core live panel).
  - Colapsado si es **setup**, **verbose**, o se usa ocasionalmente.
  - `section(parent, 'Title', { collapsed: true })` para colapsado.

- Si muestra estado live, escribe una función `refreshXxx()` y añádela:
  - al `refreshAll()` inicial.
  - al intervalo rápido (80 ms) o lento (250 ms) según cuánto cambie.

- **CANÓNICO — no recrees DOM interactivo en cada refresh**. Si tu panel
  tiene un `<select>`, `<input>`, botón con focus, etc., cachea el
  elemento y solo actualiza sus propiedades. Destruirlo y recrearlo
  cierra dropdowns abiertos, pierde focus, y te borra la selección del
  usuario mid-interaction. Mira cómo lo hace `refreshBotsPanel` con su
  `botRowEls: Map<number, BotRowEls>` y el guard
  `document.activeElement !== cached.sel`. Ese es el patrón.

### 5. Documenta aquí

Cualquier cambio del UI va en la tabla "Paneles actuales".

### 6. Actualiza el checklist de pruebas en `BUILD_LOG.md`

Al cerrar un bloque de cambios del lab, añade una entrada con un
checklist de verificación manual para futuras referencias.

---

## Seguridad y boundaries

`tools.html` es una página pública por URL. Medidas vigentes:

- `<meta name="robots" content="noindex, nofollow">`.
- `<meta name="googlebot" content="noindex, nofollow">`.
- Banner rojo "INTERNAL DEV TOOL" visible arriba del sidebar.
- Título del tab: "Bichitos Rumble — Lab (internal)".
- Cero links desde el juego normal.
- **Todas las mutaciones del `DevApi` apuntan al `Game` LOCAL**, nunca a
  estado de sala online / server. Ningún write path sensible queda
  expuesto.

### Si en el futuro se añaden herramientas de debug online:

Regla dura: deben ser **read-only por defecto**. Cualquier mutación
sobre estado de sala/servidor real requiere un toggle explícito
"connect as debug observer", con opt-in consciente. Esto está escrito
también en el comentario final de `src/tools/dev-api.ts` para que
quien entre a añadir hooks online lo vea.

---

## TODO / ideas pendientes (no implementar sin ROI claro)

- **Online / netcode debug panel**: pospuesto. Cuando entre, leer la
  sección anterior.
- **Replay de JSON**: cargar una sesión y reproducir posiciones +
  eventos en el motor. Útil para post-mortem en comunidad, no crítico.
- **Gráfico de FPS** a lo largo de la partida (sparkline) en el panel
  Perf.
- **Heatmap de posiciones** generado desde los snapshots del recording.
- **Reaction-speed** axis en bots (actualmente no modelado — descartado
  porque `aggressive/passive/ability_only` ya cubre los ejes que
  queríamos).
- **Control de gamepad real**: hoy el Input panel solo enumera
  gamepads. Cuando entre el backend de gamepad (`src/input-gamepad.ts`
  cuando exista), extender el panel con axes + buttons + deadzones.

---

## Índice rápido de ficheros

| Fichero                      | Rol                                          |
|------------------------------|----------------------------------------------|
| `tools.html`                 | Entry point del lab (noindex, internal)      |
| `studio.html`                | Shell con tabs (iframes kept-alive) de los 4 labs |
| `src/tools/main.ts`          | Bootstrap: escena, renderer, Game, DevApi    |
| `src/tools/dev-api.ts`       | Debug surface única (snapshots + mutaciones) |
| `src/tools/sidebar.ts`       | DOM de los paneles                           |
| `src/tools/tool-storage.ts`  | localStorage helpers + envelope ToolPatch    |
| `src/tools/apply-ui.ts`      | Modal de diff + POST a `/__tool-patch/*` (Apply to source) |
| `src/tools/ui/lab-kit.ts`    | Helpers compartidos de los labs (orbit cam, resize, escapeHtml) |
| `scripts/vite-tool-patch-plugin.mjs` | Endpoints dev-only `/__tool-patch/preview·apply` |
| `scripts/tool-patch-core.mjs`| Mutadores puros + validación (compartidos CLI/endpoint) |
| `scripts/apply-tool-patch.mjs` | CLI sobre tool-patch-core (`npm run apply-tool-patch`) |
| `src/bot.ts`                 | Lee `debugBotBehaviour` cada frame           |
| `src/critter.ts`             | Campo `debugBotBehaviour: BotBehaviourTag`   |
| `src/input.ts`               | Exports `getHeldKeyCodes` + `getHeldActionsSnapshot` |
| `DEV_TOOLS.md`               | Este fichero                                 |

---

## Consola del navegador

Expuesto en `window`:

- `__devApi` — instancia del `DevApi` (todo el control programático).
- `__game` — escape hatch al `Game` real. Úsalo solo si `__devApi` no
  cubre el caso; si te pasa, añade el método al `DevApi` en lugar de
  acoplarte al `__game`.
- `__lab` — atajos viejos (se mantienen por muscle memory).

Ejemplos:

```js
__devApi.setAllBotsBehaviour('idle')        // freeze todos los bots
__devApi.setBotBehaviour(1, 'aggressive')   // bot #1 con 3× fire rate
__devApi.forceAbility(0)                    // fuerza J ignorando CD
__devApi.resetPlayerCooldowns()
__devApi.teleportBotsPreset('corners')
__devApi.getEventLog()                      // últimos 60 events
__devApi.getPerf()                          // FPS/drawcalls/etc

// Recording
__devApi.isRecording()
__devApi.getRecording()                     // session actual (JSON puro)
__devApi.downloadRecordingJSON()
__devApi.downloadRecordingMD()
```
