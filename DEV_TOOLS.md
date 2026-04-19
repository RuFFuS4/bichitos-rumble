# Dev Tools — Bichitos Rumble Lab (`/tools.html`)

Documento vivo. **Actualízalo** cada vez que se añada/modifique un panel,
un método del `DevApi`, un `EventType`, etc. Si este `.md` se queda atrás,
el lab se vuelve ilegible para quien entre después.

---

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

Orden visual en el sidebar (top → bottom):

| # | Panel       | Qué cubre                                                              |
|---|-------------|------------------------------------------------------------------------|
| — | Banner      | "INTERNAL DEV TOOL · not for players"                                  |
| 1 | Matchup     | Player + 3 bots dropdown, Start / Restart same seed / Randomize / Mirror |
| 2 | Arena       | Seed · pattern · batches · Force Seed / Replay Last / Copy Seed       |
| 3 | Bots        | Dropdown por bot + dropdown bulk "All bots"                            |
| 4 | Recording   | Estado + Stop / Download JSON / Download MD / Clear                    |
| 5 | Gameplay    | Cooldowns live + Reset CDs + Force J/K/L + TP player/bots + event log  |
| 6 | Animation   | 7 sliders sobre `animPersonality` + Reset Derived + Copy Values       |
| 7 | Performance | FPS · frameMs · drawCalls · triangles · geo · tex · critters · fragments |
| 8 | Input       | Move vector · held actions · teclas activas · gamepads                 |
| 9 | Playback    | Speed slider · Pause / Slow 0.3× / Normal 1× / End Match               |
| 10| Player info | Readout de stats del player actual                                     |

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

- Añade el control en la sección correspondiente (o crea una nueva
  sección con `section(root, 'X')`).
- Si muestra estado live, escribe una función `refreshXxx()` y añádela:
  - al `refreshAll()` inicial.
  - al intervalo rápido (80 ms) o lento (250 ms) según cuánto cambie.
- **Si añades un `<select>` o `<input>` que se ve en el panel**, no lo
  recrees en el refresh. Cachea los elementos y actualiza propiedades.
  Si lo haces mal, se dispararán los bugs de "dropdowns que no se abren"
  o "inputs que pierden el focus cada 250 ms".

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
| `src/tools/main.ts`          | Bootstrap: escena, renderer, Game, DevApi    |
| `src/tools/dev-api.ts`       | Debug surface única (snapshots + mutaciones) |
| `src/tools/sidebar.ts`       | DOM de los paneles                           |
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
