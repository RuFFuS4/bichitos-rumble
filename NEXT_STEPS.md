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

### Fase 3 · 28-30 abril — INNEGOCIABLES
- [ ] **Animaciones distintivas per-character** (5-6h)
  - NO bones, sí patrones procedurales divergentes por personaje
  - Shelly balanceo lateral amplio (tortuga waddle)
  - Trunk trompa que se eleva en anticipation
  - Cheeto burst-accelerate-decelerate
  - Kurama hint de múltiples colas procedurales
  - Kowalski slide de panza en charge rush
  - Sebastian desplazamiento lateral en charge rush
  - Sihans emerge-from-ground mini-efecto
  - Kermit pre-leap squash
- [ ] **Top 4 habilidades distintivas** (8-12h, prioridad por impacto)
  1. **Trunk Grip** — grab + throw (signature Bruiser)
  2. **Shelly Shell Shield** — invulnerability pose + reflect
  3. **Kowalski Snowball** — introduce sistema proyectiles (reutilizable)
  4. **Cheeto Shadow Step** — introduce sistema teleport (reutilizable)
  
  Cada nuevo sistema base habilita otras Tier 2 abilities después.
- [ ] **Destrucción iterada** (3-4h) — Pattern C con cortes no-radiales
      + warning visual más claro. Si no entra, la actual queda.

### Fase 4 · Última semana (28 abril - 1 mayo)
- [ ] Gamepad support + toast detección (2-3h)
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
