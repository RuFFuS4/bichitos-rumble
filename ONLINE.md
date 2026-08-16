# Online — Bichitos Rumble

Doc vivo. Actualízalo cuando cambie algo del flujo de sala / bot-fill /
sincronización cliente↔servidor.

---

## Estado del deploy (2026-08-16)

> **El modo online está CAÍDO en producción.** La app del servidor en
> Railway ya no existe — `wss://bichitos-rumble-production.up.railway.app`
> responde "Application not found". Pendiente de redeploy desde el
> dashboard de Railway (requiere a Rafa). La base de datos SQLite
> (players / belts online) vivía en el volumen de esa app y **puede
> haberse perdido** con él; hasta el redeploy no se puede confirmar.
>
> Para cuando vuelva: los scripts de admin del servidor siguen en el
> repo (`server/scripts/admin-players.mjs`, vía `npm run admin:*`
> desde `server/`): `admin:list-players`, `admin:player-stats`,
> `admin:delete-player` / `admin:delete-pattern` /
> `admin:delete-before` / `admin:delete-test`, `admin:reset-players`
> y el nuevo `admin:backup` (snapshot consistente vía la API
> `.backup()` de better-sqlite3, destino por defecto
> `$DATA_DIR/backups/br-online-<UTC>.sqlite`). Prioridad tras el
> redeploy: programar backups periódicos para no volver a depender de
> un único volumen.

---

## Qué soporta hoy

- **Salas de hasta 4 críttrs** (`MAX_PLAYERS = 4` en
  `server/src/BrawlRoom.ts`).
- **Bot-fill automático**: si la sala no se llena en 60 s desde que entra
  el primer humano, el servidor completa los slots vacíos con bots y
  arranca el countdown.
- **Arranque instantáneo** si entran 4 humanos antes de que el timer
  expire.
- **Bot-takeover** al desconectarse un humano mid-match: si al salir
  quedan ≥ 2 críttrs vivos (humanos o bots), el slot del que se fue se
  convierte en bot y la partida continúa. Sólo terminamos con
  `opponent_left` cuando los restantes vivos caen por debajo de 2.
- **Distinción humano / bot** visible en:
  - Sala de espera (`waiting-screen`): cada slot muestra un badge
    `HUMAN` / `🤖 BOT` / `OPEN`. Para humanos con identidad
    verificada, el slot muestra además su **nickname**
    (`src/hud/waiting.ts`, desde `PlayerSchema.nickname`).
  - HUD en partida: el indicador de vidas de cada bot lleva un 🤖
    pequeño al lado del corazón.
  - End-screen: si el ganador es un bot, el subtítulo lo dice.
- **Matchmaking**: el cliente llama a `joinOrCreate('brawl', ...)`; no
  hay salas con nombre ni filtros por región. La primera sala abierta
  con sitio libre recoge al jugador. Ninguna nueva sala se crea si hay
  una en `waiting` con hueco.
- **Identidad online (nickname)**: antes de entrar a matchmaking el
  cliente registra/reclama un nickname vía `POST /api/player` y lo
  pasa en el `joinOrCreate`. Ver "Identidad online (v2)" más abajo.
- **Persistencia y cinturones online**: SQLite en el servidor
  (`players` / `player_stats`) + 5 leaderboards de cinturones online
  con broadcast `beltChanged`. Ver "Persistencia y ranking (Online
  Belts)" más abajo.

---

## Flujo de sala

```
        (nadie)
           │
     cliente A joinOrCreate
           │
  ┌────────▼────────┐
  │  waiting        │  ── phase = 'waiting'
  │                 │  ── waitingTimeLeft = 60 (se decrementa cada tick)
  │  players: 1..3  │
  └────────┬────────┘
           │
  ┌────────┴───────────────────────────┐
  │                                    │
  │                       timer a 0    │
  │                       y ≥ 1 humano │
  │                       → fill bots  │
  │                                    │
  4 humanos                            │
  antes del timer                      │
  → instant start                      │
  │                                    │
  └────────┬───────────────┬───────────┘
           │               │
      transitionToCountdown()
           │
  ┌────────▼────────┐
  │  countdown      │  ── 3 s → 'playing'
  │                 │  ── room.lock() para bloquear nuevas sesiones
  └────────┬────────┘
           │
  ┌────────▼────────┐
  │  playing        │  ── matchTimer = 120 s
  │                 │  ── bots recogen input de sim/bot.ts cada tick
  └────────┬────────┘
           │
  ┌────────▼────────┐
  │  ended          │  ── room locked, nadie más puede entrar
  └─────────────────┘
```

### Edge cases cubiertos

| Caso | Comportamiento |
|---|---|
| Sala vacía con timer expirado | `waitingTimeLeft` se resetea a 60 y no arranca match (nadie la vería). |
| Burst de joins consecutivos | El timer se resetea **solo** con el primer humano. Joins posteriores no lo reinician — así el primero siempre tiene sus 60 s. |
| 4º humano entra a los 59 s | Arranque instantáneo, se salta el tick de timer. |
| 4º humano entra justo cuando el tick expira | El `onJoin` se procesa antes que `tick`, así que la entrada cuenta; si sube a 4, instant-start; si sube a 3 y el tick expira, fill con 1 bot. |
| Humano se desconecta en `waiting` | Simple delete. Timer sigue. |
| Humano se desconecta en `countdown`/`playing` y quedan ≥ 2 vivos | **Bot-takeover**: su `PlayerSchema` sigue vivo con `isBot=true`, la AI asume los inputs desde el siguiente tick. |
| Humano se desconecta y quedan < 2 vivos | `endMatch('opponent_left')` con el superviviente como ganador. |
| Cliente intenta unirse durante `countdown`/`playing` | `onJoin` detecta phase != `waiting` y llama `client.leave()`. Colyseus `maxClients` ya lo bloquea la mayoría de veces, pero esto es la belt-and-braces. |
| Victoria cuando el ganador es un bot | End-screen muestra `"Bot <NombreCrítter> won"`. |
| Ganas por abandono (`opponent_left`) | Subtítulo `"You won by default"`. |

---

## Arquitectura

### Esquema (Colyseus)

`GameState` (campos añadidos para 4P):
- `waitingTimeLeft: number` — segundos hasta el bot-fill. Sincronizado al
  cliente para renderizar el contador.

`PlayerSchema` (campos añadidos):
- `isBot: boolean` — distingue humanos de bots. El schema es idéntico
  entre los dos; sólo cambia quién aporta el input.
- `nickname: string` (2026-05-01) — nickname verificado del jugador.
  `BrawlRoom.onJoin` lo escribe desde `options.nickname` (trim, mín 3
  y máx 16 chars) tras validar la identidad. Vacío para bots y para
  humanos sin identidad. La sala de espera lo renderiza en el slot.

Phases: `'waiting' | 'countdown' | 'playing' | 'ended'` — **sin cambios**.
El sub-estado de waiting (esperando / rellenando con bots / arrancando)
es derivable en el cliente desde `waitingTimeLeft` + `players.size`.

### Bot AI (server)

`server/src/sim/bot.ts` → `computeBotInput(bot, allPlayers)` devuelve un
`BotInput` con el mismo shape que el `InputMessage` del cliente:
- Chase del enemigo vivo más cercano.
- Headbutt a < 2 unidades.
- `ability1` (mobility) a 3..6 u, prob 0.02 por tick (≈ 40 %/seg a 30 Hz).
- `ability2` (AoE) si ≥ 2 enemigos en 4 u, prob 0.015/tick.
- Sin ultimate (demasiado spam a las manos online).

En `BrawlRoom.simulatePlaying` se inyectan esos inputs en `internal.input*`
**antes** del loop de physics. Desde ahí, todo el pipeline trata a bots
y humanos idénticos (mismas físicas, abilities, respawn, falloff). **No
hay branches por `isBot` en la sim.**

### Cliente (waiting UX)

- `index.html`: nuevo `#waiting-screen` (`full-overlay`) con título,
  contador grande, 4 slots y hint.
- `src/hud.ts`: `showWaitingScreen` / `hideWaitingScreen` /
  `updateWaitingScreen(data)`. Cada slot rinde como `human` / `bot` /
  `empty` con badge correspondiente.
- `src/game.ts`: en `updateOnline` cuando `serverPhase === 'waiting'`,
  se llama a `updateWaitingScreen` cada frame con
  `buildWaitingScreenData(state)`. Al transicionar fuera de waiting, se
  oculta.
- `src/critter.ts`: nuevo campo `isBot: boolean = false`. El
  `spawnOnlineCritter` lo setea desde `playerState.isBot`; el loop de
  sincronización lo actualiza cada frame (bot-takeover live), y si
  cambia se rehace el lives-HUD para que aparezca/desaparezca el 🤖.
- End-screen: el subtítulo en caso de derrota distingue bot vs humano
  leyendo `winner.isBot` del state.

---

## Identidad online (v2 — sessionStorage por pestaña)

Implementada en `src/online-identity.ts` + `src/hud/nickname-modal.ts`
(refinada 2026-04-29 → 2026-05-01).

- **Registro**: la primera vez que el jugador toca "Online
  Multiplayer" se abre el modal de nickname. El cliente hace
  `POST /api/player` con `{ nickname, token, identityId }` y el
  servidor devuelve `{ id, nickname, isNew }`. El par
  (token, identityId) permite reclamar el mismo nickname desde el
  mismo dispositivo (incluso tras borrar cookies); desde otro
  dispositivo la reclamación falla con `nickname_taken`.
- **Dos capas de storage**:
  - `sessionStorage` = **identidad confirmada de ESTA pestaña**
    (playerId + nickname + shadow de token/identityId). Es lo único
    que lee `getCachedIdentity()`: si está vacío, se abre el modal.
  - `localStorage` = **nickname preferido del dispositivo**, usado
    SOLO para pre-rellenar el modal (aceptar es un tap). No otorga
    identidad por sí solo.
- **Multi-pestaña**: cada pestaña puede tener identidad distinta. Si
  una segunda pestaña se registra con un nickname DIFERENTE al
  preferido, "forkea" con token/identityId propios de sesión y no
  pisa el `localStorage`. Si dos pestañas intentan entrar a la misma
  sala con el MISMO nick, el servidor rechaza el join con
  `nickname_active_in_room` y el cliente muestra el aviso ("usa otro
  nickname o cierra la otra pestaña").
- **En sala**: `game.ts` pasa `nickname` + credenciales en el
  `joinOrCreate`; `BrawlRoom.onJoin` verifica al jugador y escribe el
  nickname verificado en `PlayerSchema.nickname` → visible en la sala
  de espera.

---

## Persistencia y ranking (Online Belts)

Desde 2026-04-23 el servidor tiene base de datos: **SQLite**
(better-sqlite3) en el volumen de Railway — `server/src/db.ts`.
(Estado actual del deploy: ver la nota fechada al principio del doc.)

- **Tablas**: `players` (id, nickname_norm / nickname_display,
  token_hash, identity_id, timestamps) y `player_stats` (wins online,
  fastest win, vidas restantes, kills vs humanos, rachas...).
- **5 leaderboards de cinturones online**: `throne-online`,
  `flash-online`, `ironclad-online`, `slayer-online`,
  `hot-streak-online`. El Hall of Belts (tab Online) los consulta y
  los muestra.
- **REST API** (`server/src/api.ts`, montada sobre el mismo http
  server que el transporte de Colyseus, sin Express):
  - `POST /api/player` — registro/reclamo de nickname (rate-limited
    ~10/min/IP).
  - `GET  /api/leaderboard` — top 10 de los 5 cinturones (batch).
  - `GET  /api/leaderboard/:beltId` — top 10 de un cinturón.
  - `GET  /api/player/:id/stats` — snapshot de stats de un jugador.
  - Los resultados de partida **no entran por HTTP**: `BrawlRoom`
    llama a `recordMatchResult` de `db.ts` directamente (anti-cheat).
    Ojo: el comentario de cabecera de `api.ts` aún lista un
    `POST /api/match/result` que **no existe** en el dispatcher —
    comentario stale, no un endpoint real.
- **`beltChanged`**: al registrar un resultado, la sala compara
  holders antes/después y broadcastea `beltChanged`
  (beltId + nickname del nuevo holder) → toast 3D en los clientes y
  refresco del Hall of Belts.
- **Sólo puntúan los verificados**: humanos con identidad validada en
  el join acumulan stats; invitados y bots no escriben en la DB.

---

## Limitaciones actuales / deuda aceptada

- **No hay reconnect (`allowReconnection`)**. Si un humano pierde
  conexión durante la partida, su slot pasa a bot-takeover pero el
  cliente original no puede volver a entrar en esa sala. Post-jam si se
  hace necesario.
- **Sin matchmaking por región/latencia**. Un único pool global. El
  servidor está en Railway (región fija); la latencia depende de dónde
  estén los jugadores.
- **Persistencia limitada a los belts online**. Sí hay base de datos
  (SQLite — ver "Persistencia y ranking (Online Belts)"), pero no hay
  historial de partidas ni ranking global tipo ELO: sólo stats
  agregadas por jugador y los 5 cinturones. La DB vive en un único
  volumen de Railway sin backups automáticos programados (existe
  `npm run admin:backup`, pero hay que invocarlo — ver "Estado del
  deploy").
- **Bot AI server-side simple**. Chase + HB + abilities ocasionales.
  Suficiente para relleno, no para "jugar contra bots como experiencia
  principal". El modo local (`/ vs Bots`) sigue usando
  `src/bot.ts`, que es ligeramente más elaborado.
- **`SIM.match.duration` duplicado**. Cliente usa `FEEL.match.duration`,
  server usa `SIM.match.duration`. Si divergen, el matchTimer no cuadra.
  Tenerlo presente al tocar tuning de duración.

---

## Parámetros (constantes)

| Constante | Valor | Archivo | Qué hace |
|---|---|---|---|
| `MAX_PLAYERS` | 4 | `server/src/BrawlRoom.ts` | Aforo hard de la sala (= `maxClients`). |
| `WAITING_TIMEOUT` | 60 s | `server/src/BrawlRoom.ts` | Timeout antes de bot-fill. |
| `ONLINE_MAX_PLAYERS` | 4 | `src/game.ts` | Mismo que arriba, cliente. |
| `SIM.match.countdown` | 3 s | `server/src/sim/config.ts` | Countdown previo a `playing`. |
| `SIM.match.duration` | 120 s | `server/src/sim/config.ts` | Duración del match. |

Si cambias `MAX_PLAYERS`, revisa también:
- `SPAWN_POSITIONS` en `server/src/sim/config.ts` (tiene 4 entradas).
- `ONLINE_MAX_PLAYERS` en `src/game.ts`.
- CSS del waiting screen (grid de 4 slots visual).

---

## Validación hecha

- [x] Typecheck cliente + server limpios.
- [x] Build cliente y server limpios.
- [x] Compatibilidad con flujo offline preservada (código offline no
      toca `isBot` ni `waitingTimeLeft`).
- [ ] Testing manual online end-to-end con 2+ clientes (pendiente de
      smoke test del usuario).
- [ ] Testing bot-takeover con desconexión forzada (pendiente).
- [ ] Testing timeout + bot-fill completo (pendiente — abrir 1 pestaña,
      esperar 60 s, ver que se suman 3 bots y arranca).

Lo que **no se puede validar desde aquí**: cualquier cosa que requiera
dos navegadores reales + red. Checklist para el usuario al final del
bloque.

---

## Música (estado y plan)

Los 3 tracks viven en `public/audio/`:
- `intro.mp3` — Arcade Morning Splash (title screen).
- `ingame.mp3` — Coconut Canyon Clash (countdown + playing).
- `special.mp3` — BICHITOS RUMBLE Special (victory end-screen).

API en `src/audio.ts`:
- `playMusic('intro' | 'ingame' | 'special')` — carga on-demand,
  loop, crossfade de 1.2 s si ya hay otra sonando.
- `stopMusic()` — fade out 1.2 s.
- `preloadMusic(track)` — fuerza la descarga + decode sin sonar.
- `setMusicMuted(bool)` — mute instantáneo del bus. Ya persistido a
  localStorage y cableado al botón 🎶 del HUD.
- Bus de música independiente del de SFX (`musicGain` vs `masterGain`).
  Volumen base: música 0.22, SFX 0.35.

**Hooks conectados en `game.ts`** (activos en prod y en `/tools.html`):

| Punto | Track |
|---|---|
| `enterTitle()` | `intro` + preload `ingame` |
| `enterCountdown()` (offline) | `ingame` (crossfade 1.2s desde intro) |
| `enterEnded(win)` | `special` |
| `enterEnded(lose/draw)` | `intro` |
| online `waiting` | `intro` + preload `ingame` |
| online `countdown` | `ingame` |
| online `ended` (win) | `special` |
| online `ended` (lose/draw) | `intro` |
| `debugStartOfflineMatch` (lab) | `ingame` |
| `debugEndMatchImmediately` (lab) | `intro` |

Autoplay: la música sólo empieza a sonar tras la primera interacción
del usuario (los browsers bloquean `AudioContext` hasta entonces — es
estándar W3C). Típicamente el primer click en "vs Bots" ya activa el
contexto, así que `intro` → `ingame` se oye desde la transición a
countdown. Si el usuario carga la página y no toca nada, el title
screen permanece en silencio hasta que haga click/tecla.

Mute: el botón 🎶 del HUD sigue funcionando. Estado persistido en
`localStorage` — si tienes música muteada entre sesiones, se queda
muteada al recargar.

Lab (`/tools.html`): **hereda automáticamente** estos hooks — nada que
configurar ahí. El lab arranca con `debugStartOfflineMatch` → suena
`ingame`. Si distrae al probar balance, un click al 🎶 del HUD lo
silencia. No hay una variante "lab-muted by default" porque la UX del
botón ya cubre el caso.
