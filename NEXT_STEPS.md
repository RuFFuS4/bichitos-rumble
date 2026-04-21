# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC**
> **Game is LIVE on vibej.am** (user-confirmed submission 2026-04-18).
> Single source of truth for what to work on next. Dispatch sessions:
> read this first.

## Roadmap hasta la entrega

13 días restantes. Orden de trabajo decidido con scope honesto.
Si una fase se atasca >2h, se corta y sigue la siguiente. Los 3
innegociables (animaciones distintivas, habilidades finales, mejora
de destrucción) son prioritarios; si algo cae por tiempo, es el
último de los innegociables (destrucción iterada).

### Fase 1 · ESTA SEMANA (18-24 abril) — parcial
- [x] Branding firma `@RGomezR14` en portada (bottom-left, link a X)
- [x] SFX in-game (Web Audio API sintético) desde hace tiempo
- [x] 3 pistas Suno generadas y añadidas a `public/audio/`
      (intro / ingame / special)
- [x] API de música en `src/audio.ts` (musicGain, playMusic,
      crossfade, preload, mute persistente)
- [x] Hooks por phase en `game.ts` (title/countdown/ended + online
      waiting/countdown/ended + lab debug*). Lab hereda auto.

### Fase 2 — EN CURSO, adelantada
- [x] **4P online + bot-fill** — hecho
  - [x] maxClients 4 en server + client
  - [x] 60s waiting timeout → spawn de bots hasta llenar la sala
  - [x] Instant-start si entran 4 humanos antes del timeout
  - [x] Bot AI server-side (`server/src/sim/bot.ts`)
  - [x] Bot-takeover on disconnect (si alive ≥ 2)
  - [x] Waiting screen con contador + slots humano/bot/empty
  - [x] Badge 🤖 en HUD lives-row para bots
  - [x] End-screen distingue victoria de/contra bot
  - Documentación: `ONLINE.md` (living doc del flujo online completo)

### Fase 3 · EN CURSO — innegociables
- [x] **Capa de animación skeletal opcional** (`src/critter-skeletal.ts`)
      + loader GLB con clips + hooks por fase (idle/run/victory/defeat/
      ability/hit/fall) — listo desde hace días.
- [x] **Animation lab integrado** (`/animations`) con Mesh2Motion como
      base + roster picker propio (9 críttrs con rig sugerido por
      morfología) + banner INTERNAL + noindex. Exportas GLB animado →
      sustituyes en `public/models/critters/` → engine detecta los
      clips automáticamente. Tripo Animate para los no cubiertos
      (Shelly tortuga, Kermit sapo, Sihans topo).
- [x] **Warning visual de destrucción** renovado: sustituido red blink
      por per-fragment shake + warm emissive + seismic rumble SFX.
- [ ] **Animaciones reales por crítter** (INNEGOCIABLE — decisión 2026-04-20):
      - Estado a fecha: Sergei con Idle de Mixamo retargeado, el resto en
        procedural. La capa procedural cumple spec pero queremos skeletal
        distintivo antes de abrir habilidades.
      - **Plan en curso**: integrar auto-bind del rig Tripo existente
        en el lab `/animations` (Mesh2Motion). Al seleccionar el
        crítter, la herramienta debe saltarse el paso de rigging y
        aceptar el skeleton que ya trae el GLB (39 bones Tripo), con
        un mapping bone-a-bone a uno de los templates de MM (human).
        Así el usuario elige animaciones desde el catálogo de MM in-lab,
        las previsualiza y exporta directamente al GLB correcto.
        Estimado: 3-5 h de cirugía en `mesh2motion/src/`.
      - **Fallback si la integración de MM explota**: construir un
        `/preview.html` interno (1-2 h) donde el usuario dropea un FBX
        Mixamo y lo ve retargeted en vivo sobre el crítter elegido vía
        Three.js `AnimationMixer`. Más aislado, no toca MM.
      - **Fallback al fallback**: Mixamo + Blender MCP batch (ya
        validado con Sergei Idle) — funciona pero sin preview.
      - Pipeline limpio de retargeting ya documentado en este archivo
        y en `BLENDER_MCP.md` (mapping Mixamo→Tripo = 20 bones).
- [ ] **Repaso de código + docs + limpieza general** (antes de empezar
      habilidades, después de cerrar animaciones):
      - Revisar `src/` para dead code, funciones > responsabilidad,
        oportunidades de extracción común, constantes hardcoded que
        deben bajar a `FEEL` / config.
      - Pasar el lint, typecheck, y tamaño de bundles.
      - Consolidar `.md` — detectar redundancia (mucho ha ido creciendo
        orgánicamente en estos días), eliminar secciones obsoletas,
        arreglar referencias a archivos que ya no existen.
      - Candidatos sospechosos: `scripts/inspect-sergei-clips.mjs`
        (throwaway), `sergei.glb.bak`, `tools/sergei-pose-baseline.json`,
        `tools/sergei-views/`, `tools/sergei-views-cleared/` — ver si
        aún valen o se van al `.gitignore`.
      - Revisar `ONLINE.md` / `DEV_TOOLS.md` / `BUILD_LOG.md` (2400+
        líneas) y decidir si partes antiguas se archivan.
- [ ] **Top 4 habilidades distintivas** (8-12h, prioridad por impacto).
      Pospuestas hasta que el batch de validación del user termine.
  1. **Shelly Shell Shield** — invulnerability pose + reflect
     (la menos arriesgada técnicamente, reusa `immunityTimer`)
  2. **Trunk Grip** — grab + throw (signature Bruiser, más sistémica)
  3. **Kowalski Snowball** — introduce sistema proyectiles (reutilizable)
  4. **Cheeto Shadow Step** — introduce sistema teleport (reutilizable)

  Cada nuevo sistema base habilita otras Tier 2 abilities después.
- [ ] **Destrucción iterada Pattern C** (3-4h) — cortes no-radiales.
      Decidido: solo si sobra tiempo. El warning nuevo ya cumple.

### Fase 4 · Última semana (28 abril - 1 mayo)
- [x] Gamepad support + toast detección — adelantado al paralelizar
      animaciones externas (usuario en Mixamo/Tripo).
- [ ] Lighthouse pass + mejoras si hace falta (1-2h)
- [ ] Playtesting remoto en producción (2-3 sesiones cortas)
- [ ] Screenshots promocionales para jam listing
- [ ] **Freeze 24h** antes del deadline. Solo hotfix crítico.

### Gating / cortes si hay presión

- Si al **25 abril** no está cerrado el sonido → recortar Tier 1 abilities
  de 4 a 2-3.
- Si al **28 abril** no tenemos 4P estable → congelar a 2P.
- Si al **30 abril** no hay destrucción nueva → la actual queda.
- **Orden invariable**: branding → sonido → 4P → innegociables → polish → submission.
  Nunca saltar estas prioridades.

---

## Standby list — nada se descarta

Todo lo que hemos hablado sigue vivo. Si una fase acaba antes de tiempo,
cualquiera de estas puede rescatarse / avanzarse:

### Nivel 1 — rescatar si hay tiempo
- **Tier 2 habilidades distintivas** (reutilizan sistemas ya creados):
  - Kermit Poison Cloud (proyectil con zona AoE de slow)
  - Sihans Tunnel (teleport + zona lenta)
  - Cheeto Tiger Roar (cono direccional)
  - Sebastian Claw Sweep (cono direccional)
  - Kurama Mirror Trick (decoy, requiere sistema ilusión nuevo)
  - Kowalski Ice Age (superficie resbaladiza, requiere sistema nuevo)
- **Animaciones óseas via Tripo3D** para momentos específicos (victoria,
  ability ultimate dramática) — post-procedural
- **Frenzy VFX visual** exclusivo (Sergei/Kurama/Shelly tienen Frenzy
  pero sin feedback visual dramático)
- **Reconnect** (Colyseus `allowReconnection`) si aparecen quejas
- **Waiting screen polish visual** más allá del contador funcional
- **Victory poses** por personaje
- **Stats display en end screen**
- **Warp animation** en portal transitions

### Nivel 2 — post-jam (no prometer)
- Rediseño complejo del arena (fragmentos irregulares no-sectores)
- Client-side prediction + rollback
- Matchmaking / ranking / login / persistence
- Full 9-character unique ability kits (Tier 2 extendido)
- Pedestals por personaje (preview scene)
- HUD mobile restructure
- Selección ritualizada al estilo fighting game

---

## Estado cerrado — lo que ya funciona

### Bloques A/B/C cerrados en producción
- **A** — Multiplayer vertical slice (Colyseus 2P)
- **B** — Online kit completo + arena fragmentos + state-machine hardening +
  rotation-mirror fix (post-mortem en `ERROR_LOG.md`)
- **C** — Roster 9 playables con GLB + per-kit server tuning + transforms correctos
- **C follow-up** — 3D thumbnails en character select + per-critter glow
- **Speed bump ×1.3** — 9 base speeds escaladas preservando ratios

### Animación procedural shared (primera capa)
Ya implementada en `src/critter-animation.ts`:
- idle breath derivado de mass (más pesado = más lento + profundo)
- run bounce derivado de speed
- forward lean proporcional al speed durante carrera
- run sway lateral proporcional a mass
- headbutt pose (anticipación + lunge con squash/stretch)
- charge rush stretch forward
- ground pound crouch visible en GLB

Esta capa sigue vigente debajo de las animaciones distintivas por personaje
(Fase 3) — las distintivas se superponen.

### Lab tool `/tools.html` (v2 — 2026-04-18)
Herramienta interna accesible en producción tipeando `/tools.html`. No
linkada desde el juego, `<meta robots="noindex,nofollow">` aplicado.

Arquitectura: `DevApi` (`src/tools/dev-api.ts`) centraliza toda la
superficie de debug. El sidebar habla solo con DevApi y Game conserva
sus 5 métodos `debug*` originales sin crecer más.

Paneles:
- **Matchup** + **Arena inspector** (seed/pattern/batches)
- **Bots** — dropdown por bot (normal/idle/passive/aggressive/chase/
  ability_only) + aplicar a todos. Respaldado por
  `Critter.debugBotBehaviour`, leído cada frame en `bot.ts`.
- **Gameplay** — event log en vivo (headbutt/ability/fall/respawn/
  eliminate/collapse) + cooldowns del player + Reset CDs + Force J/K/L
  + teleport player/bots a presets.
- **Animation** (7 sliders) + **Playback** (speed/pause/slow) + **Info**
- **Performance** — FPS, frame ms, drawcalls, tris, geometries, textures,
  critters, fragments alive/total.
- **Input** — move vector, held actions, teclas activas, gamepad list.

Sticky-key fix aplicado (window.blur + sidebar pointerdown/focusin).
Consola: `__devApi` expuesto además de `__game`.

### Temporary-but-real roster identity
| Critter   | Role         | Kit          | Speed / Mass / HB |
|-----------|--------------|--------------|--------------------|
| Sergei    | Balanced     | CR + GP + F  | 13 / 1.1 / 15      |
| Trunk     | Bruiser      | CR + GP      | 9.1 / 1.4 / 17     |
| Kurama    | Trickster    | CR + GP + F  | 15.6 / 0.8 / 12    |
| Shelly    | Tank         | CR + GP + F  | 8.45 / 1.5 / 16    |
| Kermit    | Controller   | CR + GP      | 11.7 / 1.0 / 13    |
| Sihans    | Trapper      | CR + GP      | 10.4 / 1.15 / 14   |
| Kowalski  | Mage         | CR + GP      | 13 / 0.9 / 11      |
| Cheeto    | Assassin     | CR + GP      | 16.9 / 0.7 / 11    |
| Sebastian | Glass Cannon | CR + GP      | 13.65 / 0.75 / 18  |

Kits temporales reutilizan factories base. Mapping final en
`CHARACTER_DESIGN.md` — sección "Gap entre kits temporales y habilidades
definitivas".

---

## Deuda técnica aceptada para la jam

- **Fragment generator duplicado** client ↔ server (byte-identical via sed)
- **Arena collapse = 2 patrones macro** (A outer→inner, B axis-split)
- **Colyseus v3 state callbacks** via `getStateCallbacks()` — quirky pero funciona
- **Patch latency de ~33ms** en transiciones de colapso (warning de 3s compensa)
- **`BrawlRoom.internal` Map** para per-player non-synced data
- **Offline y online generan seeds independientes** — sin abstracción común

---

## Diagnostic tools (en producción, solo si los invocas)

Consola del browser en partida viva:

- `__arena.checkPlayer()` — primer probe si vuelve visible/física desync
- `__arena.check(x, z)` — check geométrico en un punto
- `__arena.compass()` — marcadores N/S/E/W mundo
- `__arena.dump()` — lista fragments con alive/visible
- `__arena.logCollapses()` — log por batch collapse/warning

Post-mortem del bug de rotación en `ERROR_LOG.md` entry 2026-04-17.

---

## Key architecture notes (dispatch sessions)

- Work on `dev`, merge to `main` for deploy. Vercel (client) y Railway
  (server) auto-deploy desde `main`.
- Server en `server/` — Colyseus 0.16, schema v3, multi-stage Dockerfile.
- Arena fragments generator DEBE estar byte-identical cliente ↔ servidor.
- NUNCA poner campos non-synced en clases Schema — usar `BrawlRoom.internal`.
- Match-end en server: siempre vía `BrawlRoom.endMatch()` (locka la room).
- Offline mode NO debe regresar con ningún cambio online.
- `/tools.html` = 2º entry de Vite, servido estático antes del SPA rewrite.
- **Lab debug API**: todo lo nuevo del lab va en `DevApi` (`src/tools/
  dev-api.ts`). `Game` no debe crecer más métodos `debug*` — los 5 que
  tiene (speedScale, startOfflineMatch, forceArenaSeed, getArenaInfo,
  endMatchImmediately) son los pilares, DevApi envuelve el resto.
- `Critter.debugBotBehaviour` es el único campo "debug-only" en la clase
  gameplay. Default `'normal'` = comportamiento de producción intacto.
- **Referencia viva del lab**: `DEV_TOOLS.md`. Contiene paneles,
  EventType, recording format, cómo añadir una feature nueva al lab sin
  romper nada (patrón de DOM caching para paneles con dropdowns live,
  etc). Actualizar cada vez que se toque el lab.
- **Animation lab** en `/animations` (Mesh2Motion adaptado). Subpackage
  `mesh2motion/` con su propio build. Para añadir una adaptación
  nueva tocar `src/BichitosRosterPicker.ts` sin modificar el engine
  de mesh2motion. Update upstream = diff manual contra
  `mesh2motion/README-INTEGRATION.md`.
- **Checklist vivo de validación**: `VALIDATION_CHECKLIST.md`. Todo
  lo pendiente de probar manualmente (gamepad, shake arena, 4P online,
  stats end-screen, Mesh2Motion, etc.) consolidado en un único lugar.
  Actualizar con cada feature sin validar.
