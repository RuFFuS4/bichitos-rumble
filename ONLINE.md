# Online — Bichitos Rumble

Doc vivo. Actualízalo cuando cambie algo del flujo de sala / bot-fill /
sincronización cliente↔servidor.

---

## Estado del deploy (comprobado el 2026-09-25)

> **El online está VIVO en producción** con `v1.8-terreno-v2` (main
> `784779f`, desplegado el 2026-09-24 a las 22:00 UTC; antes,
> `v1.7-h4-social`). Comprobado tras desplegar:
> - `https://bichitos-rumble-production.up.railway.app/health` responde
>   `protocol: 2` y `protocolGuard: "on"`;
> - `/api/leaderboard` devuelve los 5 cinturones (el volumen de la DB
>   está montado);
> - el bundle de `www.bichitosrumble.com` apunta a ese `wss://`.
>
> Detalle en BUILD_LOG (2026-09-25). **v1.9** (protocolo 3, el repaso de
> habilidades en `BrawlRoom`) está en verificación en la rama
> `claude/feature/distribucion-brawlroom-v19`.
>
> - **Cómo se despliega**: Railway construye `server/Dockerfile`
>   (multi-stage `node:22-alpine`) y Vercel `npm run build`, **los dos
>   solos desde `main`**. Cliente y servidor salen a la vez, pero no en
>   el mismo instante — ver "Versiones cliente↔servidor" en
>   Limitaciones. El runbook del despliegue vive en
>   [`docs/carriles/distribucion.md`](docs/carriles/distribucion.md).
> - **Admin de la DB** (`server/scripts/admin-players.mjs`, vía
>   `npm run admin:*` desde `server/` en local, o
>   `node scripts/admin-players.mjs <cmd>` dentro del contenedor, donde
>   el WORKDIR es `/app`): `admin:list-players`, `admin:player-stats`,
>   `admin:delete-player` / `admin:delete-pattern` /
>   `admin:delete-before` / `admin:delete-test`, `admin:reset-players`
>   y `admin:backup` (snapshot consistente vía `.backup()` de
>   better-sqlite3, destino por defecto
>   `$DATA_DIR/backups/br-online-<UTC>.sqlite`).
> - **Pendiente**: la DB vive en un único volumen **sin backups
>   programados** (`admin:backup` hay que invocarlo a mano), y quedan 2
>   nicks `SMOKE*` de las campañas de humo por borrar.
>
> *(Hasta el 2026-09-21 aquí decía que el online estaba caído — era la
> foto del 2026-08-16, antes del redeploy de H0. Llevaba un mes siendo
> falso.)*

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
- **Salas privadas** (H4, "Play with Friends"): la sala se crea con
  `{ private: true }` y queda fuera del matchmaking público
  (`BrawlRoom.isPrivateRoom`); se entra por el enlace `?room=<id>` que
  enseña la sala de espera (`src/hud/waiting.ts`).
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
(Estado del deploy y admin de la DB: ver la nota fechada al principio
del doc.)

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

- **Reconnect con gracia de 30 s** (H4, 2026-08-24):
  `allowReconnection(client, RECONNECT_GRACE_SEC)` en
  `BrawlRoom.onLeave` y `room.reconnection.maxRetries = 8` en
  `src/network.ts`. Pasada la gracia, el slot queda en bot-takeover.
  **Lo que no sobrevive es un reinicio del servidor** (cada despliegue
  de Railway): la sala vive en memoria, Colyseus la cierra y las
  reconexiones se rechazan. Si era una partida pública con humanos
  verificados, hoy se les apunta derrota (deducido del código,
  `BrawlRoom.ts` `recordOnlineBeltStats`): **desplegar sin partidas
  vivas**. Arreglo futuro, zona hard-stop: `onBeforeShutdown` que cierre
  con un `endReason` propio sin tocar cinturones.
- **Versiones cliente↔servidor: guard desde v1.8** — ver "Versión de
  protocolo" abajo. Hasta v1.7 no había ninguno. Lo que sigue sin
  cubrir: una pestaña vieja no se entera de que hay versión nueva hasta
  que intenta entrar al online (no hay service worker ni sondeo).
- **Sin matchmaking por región/latencia**. Un único pool global. El
  servidor está en Railway (región fija); la latencia depende de dónde
  estén los jugadores.
- **Persistencia limitada a los belts online**. Sí hay base de datos
  (SQLite — ver "Persistencia y ranking (Online Belts)"), pero no hay
  historial de partidas ni ranking global tipo ELO: sólo stats
  agregadas por jugador y los 5 cinturones. La DB vive en un único
  volumen de Railway sin backups automáticos programados (existe
  `admin:backup`, pero hay que invocarlo — ver "Estado del deploy").
- **Bot AI server-side simple**. Chase + HB + abilities ocasionales.
  Suficiente para relleno, no para "jugar contra bots como experiencia
  principal". El modo local (`/ vs Bots`) sigue usando
  `src/bot.ts`, que es ligeramente más elaborado.
- **`SIM.match.duration` duplicado**. Cliente usa `FEEL.match.duration`,
  server usa `SIM.match.duration`. Si divergen, el matchTimer no cuadra.
  Tenerlo presente al tocar tuning de duración.

---

## Versión de protocolo (guard cliente↔servidor, desde v1.8)

**El problema.** El servidor solo manda `arenaSeed`, `arenaPackId`,
nivel y lote del colapso: **cada cliente deriva en local qué fragmentos
caen**. Si una versión cambia el generador de la arena (H4.5 lo cambia:
el 54 % de las semillas reparten distinto los lotes), un cliente de una
versión contra un servidor de otra pinta suelo donde la física ya lo
tiró. Pasa en la ventana del despliegue (Vercel termina ~20 s tras el
push, Railway ~70 s) y en cualquier pestaña vieja abierta. **Nunca**
mandar geometría por la red para taparlo.

**La pieza.** Un entero, `NET_PROTOCOL`, en `server/src/protocol.ts`:
fuente única, sin imports. El servidor lo compila y el cliente lo
importa con `../server/src/protocol`. v1.7 no manda nada y cuenta como
1; v1.8 (H4.5) es la 2; v1.9 (el repaso de habilidades en `BrawlRoom`)
es la **3**.
- **Por qué la 3:** mensajes nuevos que un cliente v1.8 no sabe pintar:
  - `dashHit`: una J que golpea, con su hit stop y su sacudida;
  - `lChargeEnd`: se apaga la línea del All-in, al disparar o porque
    un aturdido suelta la carga;
  - `abilityFired` con `originX/originZ/originRotY`: el señuelo de
    Kurama y el origen de los blinks.
- El suelo no cambia: la fila 3 de `LAYOUT_BY_PROTOCOL` lleva la misma
  huella que la 2.

| Paso | Dónde | Qué pasa |
|---|---|---|
| Sonda | `src/network.ts` | Antes del join, `GET /health` (tope 2 s; cuesta ~1 RTT). Si anuncia otro número, o no trae `protocol` (servidor v1.7), no se entra: `server_outdated`/`client_outdated`. Así nadie ocupa asiento en una sala de otra versión: como 4º humano le arrancaría la cuenta atrás y se llevaría una derrota. Falla **abierta**: si `/health` no responde, decide el eco, y en ese caso raro el hueco del 4º asiento vuelve a existir. `/health` lleva CORS (lo pone el router de Colyseus). |
| Ida | `src/network.ts` | `protocol: NET_PROTOCOL` en las opciones de `create`, `joinById` y `joinOrCreate` (el único sitio del repo que hace join). |
| Guard | `BrawlRoom.onAuth` (estático) + `server/src/net-protocol-guard.ts` | Colyseus 0.17 lo llama en `joinOrCreate`, `create` y `join` **antes** de buscar o crear sala; en `joinById`, después de encontrarla y ver que no está cerrada (una sala inexistente da antes un 522 "not found"). En todos, antes de reservar asiento. Si no coincide lanza un `Error` que llega al cliente como `MatchMakeError` **HTTP 523**: texto bilingüe (español primero si la primera etiqueta de `Accept-Language` es `es`) acabado en `(client_outdated 1<2)` o `(server_outdated 3>2)`. Las reconexiones no pasan por aquí. |
| Eco | `GameState.protocol` (último campo) | El cliente espera el primer estado (tope 8 s, o antes si la sala muere) y, si no trae su mismo número, sale de la sala sin reconexión y lanza `server_outdated`/`client_outdated` (o `no_state_from_server`). Es la red de seguridad contra un servidor **viejo**, que no tiene guard, si la sonda no llegó a saberlo. |
| UX | `src/game.ts` + `src/i18n.ts` | `client_outdated` → "Hay una versión nueva… ¿Recargar?" y recarga con Aceptar. Lo mismo si el chunk de red ya no existe, porque cada despliegue lo renombra y Vercel da 404 al viejo; sin red, en cambio, no se ofrece recargar. `server_outdated` → "El servidor se está actualizando, prueba en un minuto". `no_state_from_server` → el "no se ha podido conectar" de siempre. |

**Qué ve cada uno:**
- **Pestaña v1.7 contra servidor v1.8.** Su código no se puede tocar, así
  que cae en su alert genérico con uno de estos dos textos:
  - Si ya había cargado el chunk de red (había entrado al online antes):
    "No se ha podido conectar… El servidor dice: Hay una versión nueva
    del juego: recarga la página para jugar online. / A new version…".
  - Si no lo había cargado: "…El servidor dice: Failed to fetch
    dynamically imported module…". Su chunk ya no existe en Vercel. Es
    un fallo seguro: tampoco llega a jugar.

  En los dos casos el offline sigue funcionando.
- **Cliente v1.8 contra servidor v1.7** (la ventana, o si falla el build
  de Railway): la sonda ve un `/health` sin `protocol` y no llega a
  entrar: "El servidor se está actualizando". Si la sonda falla, entra
  un instante, lee el eco (no hay campo) y sale con el mismo aviso.

**Cuándo subir `NET_PROTOCOL`** (y AÑADIR su fila en
`LAYOUT_BY_PROTOCOL`):
- **Automático:** `tests/sim/net-protocol.test.ts` (dentro de
  `npm run test:sim`, que corre en el CI) compara dos huellas:
  - la del golden de layout: si el reparto del suelo cambia, falla y
    dice qué número y qué fila poner;
  - la del código de `server/src/sim/arena-fragments.ts`: si cambia sin
    mover el golden, obliga a decidir entre subir o actualizar solo
    `GENERATOR_FINGERPRINT`.
- **A mano:** quitar o renombrar un campo del estado, cambiar la forma
  de un mensaje, cambiar el significado de una opción de join, o añadir
  algo que un cliente viejo no sepa pintar (un bicho nuevo).
- **No hace falta** por balance y física (manda el servidor), campos
  nuevos al final del estado, packs (el cliente degrada a `jungle`) ni
  cambios solo de cliente.
- **Steam:** un cliente empaquetado no puede recargar, así que cada
  subida exigirá sacar a la vez la actualización del paquete.

**Superficie programática:**
- `GET /health` → `protocol`, `protocolGuard` (`on`/`off`) y
  `rejectedJoins` desde el arranque.
- `POST /matchmake/joinOrCreate/brawl` con cuerpo `{}` → 523 con
  `client_outdated`. No crea sala, **pero solo si el guard está vivo**.
  Contra un servidor v1.7 o con el guard apagado, crea una sala y
  reserva un asiento. Así que primero `GET /health` y confirmar que
  `protocol` es el número de `NET_PROTOCOL` del código desplegado (3
  desde v1.9) y `protocolGuard: "on"`; solo entonces sirve contra
  producción.
- `npx vitest run tests/sim/net-protocol.test.ts` imprime las huellas
  nuevas cuando algo cambia.

**Emergencia:** `NET_PROTOCOL_GUARD=off` en las variables de Railway
apaga el rechazo **del servidor** sin revertir `main`. El arranque lo
avisa en el log y `/health` dice `off`; acepta "off" sin distinguir
mayúsculas.
- **Sirve para** un fallo del propio guard (rechaza a todo el mundo con
  los dos lados en el mismo número) y para dejar jugar a las pestañas
  v1.7, que vuelven a jugar desincronizadas: solo en un apuro.
- **No sirve para** un desparejo de versiones: un cliente v1.8 o
  posterior de otro número se va solo con la sonda o el eco. Eso se
  arregla con rollback de los dos lados.

---

## Suavizado online (desde v1.8)

**El problema.** El servidor simula a 30 Hz y manda el estado a 20 Hz (un
parche cada 50 ms, con 1 o 2 ticks). Hasta v1.7, tu bicho se colocaba en
la última posición recibida: se quedaba quieto en 2 de cada 3 frames a
60 Hz y avanzaba a saltos de 6-12 px (Sebastian) o hasta 16 (Sihans). Los
rivales iban con un lerp que los dejaba ~80 ms detrás y pulsando entre
0,55× y 1,5× de su velocidad. Con la velocidad ×1,375 de PERSONAJES era la
condición de despliegue de `docs/FEELING.md` §7.6.

**La pieza.** `src/net-smoothing.ts` (módulo puro, sin imports) le da a
cada bicho online una posición **visual** propia; el enganche son ~15
líneas en `src/game.ts` (`updateOnline`). Solo visual: el servidor sigue
siendo la autoridad, y no cambia ni el protocolo ni el golden.
- **Predicción.** Repite el paso de integración de `BrawlRoom` tick a tick
  y en su orden (empuje → mover → fricción → zona muerta → tope) hasta la
  hora de servidor de "ahora".
  - **Sub-pasos (desde v1.9).** El servidor integra en
    `SIM.movement.integrationSubsteps` sub-pasos por tick (2: una
    integración cada 1/60 s, como el juego offline), con el empuje del
    mando una vez por tick. La predicción los repite
    (`FEEL.movement.integrationSubsteps`, espejo).
  - Los sub-pasos solo dan dónde **acaba** cada tick. Dentro del tick se
    interpola en línea recta: pintar su forma metía un diente de sierra
    de velocidad del 13 % a 30 Hz, porque el servidor solo existe en los
    ticks.
  - Una grabación sin el campo (anterior a v1.9) se reproduce con 1. El reloj sale de `matchTimer` (baja 1/30
  por tick y solo en `playing`) con el mínimo de (llegada − hora de
  servidor) en una ventana de 1 s. El empuje por tick se deduce de dos
  estados seguidos.
- **Corrección suave.** El error se reparte con una constante de 60 ms en
  vez de pintarse de golpe.
- **Paradas.** Al local se le sabe el mando: se usa el de hace un RTT
  (`room.ping` cada segundo), que es el que el servidor ya ha visto. A un
  rival se le deduce: un empuje contra su marcha es una frenada, con la
  fricción de parada.
- **Saltos directos:** al reaparecer; en un teleport (se aleja > 0,75 u
  de donde el paso lo tenía que llevar y está casi parado: blink, decoy,
  Grip ponen v = 0); a más de 3,5 u; o con un frame de más de 0,25 s.
- **Caída al vacío:** la altura baja lisa (12 u/s extrapolados) y x/z se
  quedan donde se le ve caer.

**Medido** (33 grabaciones, LAN y RTT 80/160 inyectado, re-simuladas con
el módulo real a 60 y 144 Hz; 2026-09-24):

| | `legacy` (v1.7) | suavizado |
|---|---|---|
| Frames parados del local | 60-86 % | 0 % en crucero (solo se para en un hueco de red > 150 ms) |
| Tirón p95 del local en crucero | 5,5-14,4 px | ≤ 0,77 px (RTT 160) |
| Retraso del local en LAN | 28-34 ms | 0-1 ms |
| Ratio de velocidad por frame del local (p5-p95) | 0-9,6 | 0,94-1,20 (los bots rivales con habilidades y RTT salen de ese rango sin que se note: tirón ≤ 0,7 px) |
| Coherencia local↔rivales p95 | 10-20 px | 2,6-12,5 px menos que `legacy` |
| Pasada de largo al parar, local (p99) | 0 | ≤ 2,6 px en las 33 grabaciones de la verificación; en 2 de las 4 de `bf7b3ee`, 3,6-6,9 px, siempre por una sola frenada |
| Pasada de largo al parar, rivales (p99) | ≤ 1,1 px | mediana 1,9, peor 8,3 px |

La pasada de los rivales es el precio conocido: si un parche llega tarde,
el rival se extrapola a su velocidad durante ≤ 150 ms. Se juzga a ojo en
el A/B.

**Interruptores** (en la URL, se leen al cargar):
- `?netsmooth=legacy` → todo como en v1.7.
- `?netsmooth=localonly` → solo tu bicho; los rivales con el lerp de
  v1.7. **Ojo:** la coherencia local↔rivales queda PEOR que con
  `legacy` (19-32 px frente a 11-20), porque tu bicho va al día y los
  rivales 80 ms detrás. Solo para A/B.

**Superficie programática:**
- `__game.netSmoother.config.<clave> = valor` en vivo; los parámetros
  están en `NET_SMOOTHING` (`src/net-smoothing.ts`).
- `__game.netSmoother.stats()`: desfase del reloj, RTT, edad de los
  estados (p50/p95), frames con la edad saturada (si suben contra
  Railway, el reloj no sigue al servidor), tamaño de las correcciones y
  saltos por motivo.
- `scripts/net-smoothing-record.mjs`: graba una partida real (navegador
  mudo, `--rtt`/`--jitter` inyectados, `--netsmooth=`).
- `scripts/net-smoothing-bench.mjs`: re-simula las grabaciones con el
  módulo real a otras tasas y con `--set clave=valor`, sin tocar el
  juego. Imprime los umbrales del plan.
- `tests/sim/net-smoothing.test.ts`: servidor de mentira que integra como
  `BrawlRoom`.

**Para probar online en local en Windows**, arranca el servidor con
`npm run dev` (en `server/`). Carga `server/scripts/precise-timers.mjs`,
porque el `setInterval` de Node en Windows va a saltos de 15,6 ms y el
servidor corría a 0,72×; con el shim va a 1,00×. Cuesta ~44 % de un
núcleo por sala; `PRECISE_TIMERS=off` lo apaga. **Nunca** se juzga el
suavizado contra un servidor local sin él.

**Si cambias el paso de integración de `BrawlRoom`** (orden, fórmula de
fricción, zona muerta, tope, sub-pasos) o el ritmo de `matchTimer`, la predicción
empeora sin romper nada: avisa a DISTRIBUCIÓN. Valores de FEEL/SIM los
sigue sola (se inyectan).

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
- [x] Online end-to-end con varios clientes: en v1.9 (2026-09-25),
      salas de 4 navegadores mudos contra un servidor local pulsando
      J/K/L de los 9 bichos (arranque instantáneo con 4 humanos).
- [ ] Testing bot-takeover con desconexión forzada (pendiente en
      navegador; el caso de soltar la carga del All-in al pasar a bot
      está comprobado sin clientes contra `BrawlRoom`).
- [x] Timeout + bot-fill completo: cada grabación de
      `scripts/net-smoothing-record.mjs` espera los 60 s y juega con
      los 3 bots de relleno.

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
