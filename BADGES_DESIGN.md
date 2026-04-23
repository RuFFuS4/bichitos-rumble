# Badges Design — Bichitos Rumble

> **Status (2026-04-23)**: the **16 offline belts** (9 Champion + 7 Global)
> are fully shipped — Fases 0–4 completas en código, solo falta el arte
> final (Fase 5). Los **5 online belts** están en MVP funcional (backend
> SQLite + cliente nickname + captura de match-result); faltan la UI
> leaderboard y el toast de "has tomado el cinturón".

## Dos sets: Offline (local trophy room) + Online (leaderboard global)

| Set | Categoría | Cuenta | Dónde vive | Identidad |
|-----|-----------|--------|------------|-----------|
| **Offline** | Champion per-critter (9) + Global (7) | 16 | localStorage del navegador | Ninguna — anónimo |
| **Online**  | Global competitivo (5) | 5 | SQLite en Railway server | Nickname + device token |

Cada set es independiente. Los offline son "tu colección personal";
los online son "la tabla de honor". Los datos no se cruzan — puedes
ganar todos los offline sin tocar online, y viceversa.

## Concept (offline)

Tipo **cinturones de WWE** — no es un ranking global ni un leaderboard.
Son trofeos que el jugador **desbloquea en local** y se muestran como
"logros" con arte bonito. Zero backend: todo vive en `localStorage`
junto a los stats ya existentes (`src/stats.ts` → key `br-stats-v1`).

- **No requieren login ni backend** (la jam lo prohíbe explícito).
- **Solo métricas locales** — lo que el jugador ha hecho en esta
  máquina / este navegador.
- **Reset manual** desde una esquina del end-screen o el character
  select (por si alguien comparte portátil).
- Visibilidad: pequeños iconos en el end-screen cuando se **desbloquea
  uno nuevo** (notificación pulsante), y un grid completo en
  character-select o en un panel dedicado (por decidir).

## Categorías iniciales

Dos tipos:

### A. Títulos por crítter — "Champion of X"

Un cinturón por bichito → **9 en total**. Se desbloquea al alcanzar
un hito con ese crítter concreto. Propuesta inicial:

| Cinturón                       | Condición                                                  |
|--------------------------------|------------------------------------------------------------|
| Sergei — **Jungle Champion**   | 5 victorias con Sergei                                     |
| Trunk — **Savanna Champion**   | 5 victorias con Trunk                                      |
| Kurama — **Kitsune Champion**  | 5 victorias con Kurama                                     |
| Shelly — **Beachside Champion**| 5 victorias con Shelly                                     |
| Kermit — **Swamp Champion**    | 5 victorias con Kermit                                     |
| Sihans — **Desert Champion**   | 5 victorias con Sihans                                     |
| Kowalski — **Tundra Champion** | 5 victorias con Kowalski                                   |
| Cheeto — **Apex Champion**     | 5 victorias con Cheeto                                     |
| Sebastian — **Tide Champion**  | 5 victorias con Sebastian                                  |

> **Nota sobre el umbral**: 5 es una primera propuesta. Si al probarlo
> se siente farmable de golpe, lo subimos a 8-10. Si se siente lejano
> (los críters costosos de dominar no llegarán nunca), bajamos a 3.
> Gating por victorias (no por "picks", que sería trivial).

**¿Es mucho ponerle uno a cada bichito?** No, si mantenemos el arte
consistente: mismo molde de cinturón, mismo material central, sólo
cambia el medallón (silueta del crítter + paleta del habitat). 9 belts
con el mismo estilo base es una sesión de IA generativa, no 9 sesiones
independientes. Ver "Prompt para generación" más abajo.

### B. Trofeos globales — cross-crítter

Agregan toda la sesión de juego del jugador, sin diferenciar crítter.
Propuesta inicial:

| Cinturón            | Condición                                                 |
|---------------------|-----------------------------------------------------------|
| **Speedrun Belt**   | Ganar una partida en ≤ **30 s** desde el fin del countdown |
| **Iron Will**       | Ganar conservando **3 vidas** intactas (no morir ni una vez)|
| **Untouchable**     | Ganar sin recibir **ningún headbutt** enemigo              |
| **Survivor**        | Acumular **20 victorias** totales en el dispositivo        |
| **Globetrotter**    | Ganar al menos 1 vez con **los 9 crítters**                |
| **Arena Apex**      | Ganar una partida siendo el **último con 1 vida** (comeback)|
| **Pain Tolerance**  | Ganar tras haber sido **golpeado ≥ 10 veces** sin caer     |

(Dimensionar durante playtest; los números son colocables.)

### C. Ideas reserva para iteración (no en v1)

Para cuando empujemos badges post-jam o si sobra tiempo:

- **Perfect Kit** — usar las 3 abilities (J/K/L) en una misma partida
  y ganarla.
- **Void Toucher** — empujar a un enemigo al vacío con tu ULTI.
- **Last Bot Standing** — ganar una partida online siendo el único
  humano (todos los demás eran bots).
- **Critter Collector** — probar los 9 crítters al menos una vez
  (no requiere ganar).
- **Portal Tourist** — entrar al juego a través del portal de Vibe
  Jam y ganar esa partida.

## Storage

Extender `src/stats.ts` sin romper el schema actual. Versión nueva
detrás de una migración suave:

```ts
// Próxima iteración: bump STORAGE_KEY a 'br-stats-v2' y migrar desde v1.
export interface Stats {
  byCritter: Record<string, CritterStats>;
  totalMatches: number;
  totalWins: number;

  // NUEVO — solo si el cálculo no se puede derivar del histograma:
  fastestWinSecs: number | null;          // globo, todos crítters
  fastestWinByCritter: Record<string, number>;
  noHitWins: number;                      // partidas ganadas sin recibir HB
  noDeathWins: number;                    // partidas ganadas con 3 vidas
  comebackWins: number;                   // wins con 1 vida al final
  abilitiesLandedByKind: Record<string, number>;

  // Badge state (derivado pero cacheado para UI rápida):
  unlockedBadges: string[];               // ids estables: 'sergei-champion', 'speedrun-belt', …
  recentlyUnlocked: string | null;        // para overlay 1-shot en end-screen
}

export interface CritterStats {
  picks: number;
  wins: number;
  losses: number;
  falls: number;

  // NUEVO:
  fastestWinSecs: number | null;
  hitsReceived: number;                   // suma de todos los HB recibidos con este crítter
  livesLeftSum: number;                   // suma de vidas restantes al ganar (para media)
}
```

Ventajas del cacheado `unlockedBadges`:
- Render instant en end-screen sin recomputar 16 condiciones.
- `recentlyUnlocked` se resetea a `null` cuando la notificación se cierra.

## Integración runtime

Patrón "collector hook" — en los puntos donde ya grabamos stats
(`src/game.ts` match-end, `recordHeadbutt`, `recordFall`, …), tras
guardar añadimos:

```ts
import { checkBadgeUnlocks } from './badges';
// ...
const unlocked = checkBadgeUnlocks(getStats());
if (unlocked.length > 0) showBadgeToast(unlocked);
```

`checkBadgeUnlocks` es una función pura que lee Stats y devuelve la
lista de badges recién desbloqueados (diff contra `unlockedBadges`
cacheado). Sin side-effects gameplay. Totalmente aislable.

## UI — 3 touchpoints

1. **End-screen — badge pop**. Cuando desbloqueas uno nuevo al final
   de la partida, aparece un cartel tipo "🏆 NEW BELT UNLOCKED —
   Speedrun Belt" encima de los stats counters. Un click/tap lo cierra.

2. **Character select — hall of belts**. Debajo del critter-info o en
   un panel que se despliega (TBD), se muestra el grid de los 16 belts
   con los bloqueados en silueta (no spoiler total: sí muestra el
   título del logro, no el icono final). Los desbloqueados salen
   a todo color.

3. **Critter slot — mini-indicator**. En character-select, cada slot
   muestra una esquina con el belt del crítter si está conseguido
   (tipo 🏆 pequeño dorado). Zero ruido si no lo tienes.

No hay presión por mostrar esto en el HUD ingame — los belts son
meta, no feedback de combate.

## Prompt para generación de belts (IA — Midjourney / Tripo / etc.)

### Base para los 9 "Champion" belts

> **Prompt base** (reutilizable — cambia sólo `{CRITTER}`, `{HABITAT}`, `{COLOR_PALETTE}`):
>
> "Flat vector illustration of a cartoon wrestling championship belt,
> front view, symmetrical. Central round medallion features a stylised
> silhouette of a **{CRITTER}** (cute chibi proportions, big-head style,
> matching the Bichitos Rumble game aesthetic — same as the attached
> reference image). Medallion background: **{HABITAT}** scene (jungle
> canopy / savanna grass / kitsune shrine / beach sand / swamp
> lilies / desert dunes / antarctic ice / jungle moonlight / coral
> reef). Side plates with smaller gem-like accents. Leather strap with
> embossed pattern in **{COLOR_PALETTE}**. Chunky gold trim. Soft
> shadow, transparent background. Vibrant saturated colours, arcade
> trophy energy, no realism, no text on the belt, no watermark.
> Output square 1024×1024 PNG, lossless."
>
> **Reference image attached**: latest `public/models/critters/{critter}.glb`
> screenshot from character-select (3/4 angle).

Per-critter parameters:

| Crítter   | Habitat                      | Paleta primaria         |
|-----------|------------------------------|-------------------------|
| Sergei    | jungle canopy                | earth green + gold      |
| Trunk     | savanna grass / acacia       | sand + terracotta       |
| Kurama    | kitsune shrine / torii gates | crimson + white         |
| Shelly    | beach + coral                | turquoise + cream       |
| Kermit    | swamp lilies + mist          | chartreuse + violet     |
| Sihans    | desert dunes + sun           | ochre + burnt orange    |
| Kowalski  | antarctic ice / aurora       | ice blue + silver       |
| Cheeto    | jungle moonlight / foliage   | orange + black          |
| Sebastian | coral reef + bubbles         | coral red + aqua        |

### Base para los trofeos globales

> **Prompt base** (cambia `{CONCEPT}`, `{ICON}`, `{TONE}`):
>
> "Flat vector illustration of a cartoon achievement medal /
> championship belt, front view, symmetrical. Central medallion
> depicts **{CONCEPT}** with a stylised **{ICON}**. **{TONE}** palette.
> Chunky gold trim, leather strap with embossed pattern. Soft shadow,
> transparent background, vibrant saturated arcade colours, no text,
> no watermark. Square 1024×1024 PNG."

Por trofeo:

| Trofeo         | Concept                   | Icon                  | Tone          |
|----------------|---------------------------|-----------------------|---------------|
| Speedrun Belt  | lightning speed victory   | sprinting silhouette + chronometer | electric blue + yellow |
| Iron Will      | unbreakable defender       | shield emblem + 3 hearts            | steel grey + crimson     |
| Untouchable    | flawless dodge             | ghostly silhouette + dotted outline | lavender + silver        |
| Survivor       | long endurance             | mountain with flag on top           | forest green + bronze    |
| Globetrotter   | collector of all critters  | compass rose with 9 dots            | warm globe blue + gold   |
| Arena Apex     | last-stand comeback        | one life icon rising from ashes      | amber + deep red         |
| Pain Tolerance | bruised resilience         | bandaged fist raised                | rust + cream             |

### Reglas comunes

- **PNG transparente, 1024×1024** (oversized; downscale en build).
- **Sin texto dentro del arte** — el nombre se renderiza en HTML
  encima/debajo del sprite para soportar i18n / rebranding.
- **Silueta reconocible a 48×48**. Este es el sanity check antes de
  aceptar un resultado: si a tamaño thumbnail no distingues el belt,
  se descarta.
- **Misma base visual** (cinturón chunky dorado con correa y medallón
  central) para que los 16 lean como "un set", no como 16 sticker packs
  incompatibles.

## Implementación — plan por fases (post-animaciones, post-signature abilities)

- **Fase 0** · este doc (done).
- ✅ **Fase 1** (commit 2026-04-22) — Schema v2 + catálogo + checker:
  - `src/stats.ts` ampliado a v2 con migración suave desde v1
    (localStorage key `br-stats-v2`). Nuevos campos: `fastestWinSecs`
    (global + per-critter), `hitsReceived` (per-critter),
    `livesLeftSum` (per-critter), `noHitWins`, `noDeathWins`,
    `comebackWins`, `unlockedBadges[]`, `recentlyUnlocked`.
  - `src/stats.ts` nuevas funciones: `recordHitReceived(name)`,
    `recordWin(name, durationSecs, livesLeft, hits)`, `getStats()`,
    `addUnlockedBadges(ids)`, `clearRecentlyUnlocked()`.
  - `src/badges.ts` nuevo: catálogo de 16 belts (9 Champions + 7
    globals) con `BadgeDef` tipado y condiciones puras.
    `checkBadgeUnlocks(stats)` devuelve los ids nuevos desbloqueados.
    Helpers: `getBadgeById`, `getAllBadges`, `getUnlockedBadges`,
    `isUnlocked`.
  - Umbrales default: Champion = 5 wins; Speedrun ≤ 30 s;
    Survivor = 20 wins; Pain Tolerance ≥ 10 hits. Centralizados en
    constantes arriba del archivo.
- ✅ **Fase 2** (commit 2026-04-22) — Recolección desde gameplay:
  - `src/physics.ts` incrementa `matchStats.hitsReceived` del
    crítter golpeado en cada impacto de headbutt.
  - `src/critter.ts` `matchStats` ahora incluye `hitsReceived`
    (reset al iniciar match).
  - `src/game.ts` captura `matchStartMs = performance.now()` al
    entrar en `'playing'` y, al detectar `result === 'win'`, llama
    a `recordWin(…)` + `checkBadgeUnlocks(getStats())` +
    `addUnlockedBadges(newly)`. Log `[Badges] unlocked: …` en
    consola.
  - ✅ Online path también wired (commit 2026-04-22). `updateOnline`
    stampea `matchStartMs` en el `serverPhase === 'playing'` edge y,
    en el `'ended'` edge, ejecuta la misma secuencia
    `recordOutcome` → `recordWin` → `checkBadgeUnlocks` →
    `addUnlockedBadges` → `maybeShowBadgeToast`. Log
    `[Badges] unlocked (online): …` para distinguir de offline.
- ✅ **Fase 3** (commit 2026-04-22) — Toast end-screen:
  - `src/badge-toast.ts` nuevo módulo con `initBadgeToast`,
    `maybeShowBadgeToast`, `dismissBadgeToast`. Lee
    `stats.recentlyUnlocked` y llama a `clearRecentlyUnlocked()` al
    cerrarse (click o auto-dismiss a los 6 s).
  - `BadgeDef` ampliado con `icon` (emoji placeholder hasta Fase 5).
  - `index.html` añade `#badge-toast` node + CSS (radial glow
    dorado, shine sweep, enter animation scale+slide).
  - `src/game.ts` llama `maybeShowBadgeToast()` tras
    `addUnlockedBadges()` en el win path offline.
  - `src/main.ts` hace `initBadgeToast()` al boot.
- ✅ **Fase 4 light** (commit 2026-04-22) — Hall of Belts modal:
  - `src/hall-of-belts.ts` nuevo módulo con `initHallOfBelts`,
    `openHallOfBelts`, `closeHallOfBelts`, `isHallOfBeltsOpen`.
    Teclas: **B** en character-select abre/cierra; **Esc** siempre
    cierra.
  - Modal fullscreen con grid responsive (4/3/2 columnas según
    viewport), unlocked en dorado, locked con 🔒 + criterio visible,
    contador `X / 16`.
  - Botón dedicado **🏆 Belts** arriba-derecha del character-select.
  - El grid se recrea en cada open para reflejar stats frescas.
- **Fase 5** (pendiente) · Generar y colocar los 16 assets en
  `public/badges/`. Prompts + tabla per-critter ya listos en este
  mismo doc (sección "Prompt para generación de belts"). Cuando
  lleguen los PNG, swap el innerHTML de `.badge-toast-icon` y
  `.belt-icon` por un `<img src="/badges/<id>.png">`. El resto del
  CSS ya está preparado para esa forma.
- **Fase 6** · Validación — jugar 5-10 partidas buscando cada logro,
  ajustar umbrales. VALIDATION_CHECKLIST §21 lista los smoke tests
  manuales (toast / Hall of Belts / migración v1→v2 / edición
  directa de localStorage).

Total aproximado restante: **2 horas** de ingeniería (Fase 5 swap
de assets + Fase 6 tunado de thresholds) + el tiempo externo de
generación de arte.

## Decisiones pendientes (cuando retomemos)

- [ ] Umbral exacto de "Champion" — ¿5 / 8 / 10 wins?
- [ ] Posición final del "Hall of Belts" (modal vs panel embebido vs
      nueva pestaña en título).
- [ ] Estilo exacto del toast de unlock (ráfaga dorada / pop-up /
      slide desde abajo).
- [ ] Audio cue al desbloquear (bus SFX o reusar `special.mp3`).
- [ ] Reset de stats: ¿botón visible en settings o sólo desde consola?
- [ ] Si los trofeos globales deben persistir separados de stats
      (archivo aparte `br-badges-v1`) o compartir el mismo `br-stats-v2`.

---

# Online Belts — set competitivo (decisión 2026-04-23)

Segundo set de 5 cinturones **sólo ganables jugando online**. A
diferencia de los offline (trofeos personales), estos son un
**leaderboard global** — el holder actual es quien tiene la mejor
métrica en el server. El cinturón cambia de manos cuando alguien te
supera.

## Los 5 cinturones online

| Id | Cinturón | Condición | Métrica server |
|----|----------|-----------|-----------------|
| `throne-online` | **Throne Belt** 👑 | Más victorias online totales | `wins_online` DESC |
| `flash-online` | **Flash Belt** ⚡ | Partida online ganada más rápida | `MIN(fastest_win_ms)` |
| `ironclad-online` | **Ironclad Belt** 🛡️ | Mejor ratio de vidas conservadas por partida (requiere ≥5 partidas) | `lives_left_sum / matches_online` |
| `slayer-online` | **Slayer Belt** 🗡️ | Más kills contra humanos (NO bots) | `kills_vs_humans` DESC |
| `hot-streak-online` | **Hot Streak Belt** 🔥 | Racha más larga de victorias consecutivas | `longest_streak` DESC |

**Ironclad mín matches**: gating por 5 partidas jugadas para evitar
"1 partida perfecta = ratio 3.0 = líder eterno".

**Slayer (v1)**: el MVP envía `kills_vs_humans = 0` en el match result
porque no hay tracking del last-hitter. El cinturón queda "neutro"
hasta Fase 6 de belts (TODO: `BrawlRoom.physics` → marcar
`lastHitBy` en el defensor cuando recibe headbutt → al quedarse sin
vidas, sumar 1 al atacante si era humano). Post-jam o siguiente
ventana libre.

## Identidad sin login

- El primer tap en "Online Multiplayer" abre `#nickname-modal`.
- Nickname 3–16 chars, `[a-zA-Z0-9_\-]`, con lista mínima de reservados.
- Cliente genera un **token aleatorio 24-byte** (CSPRNG) y lo guarda en
  `localStorage` como `br-online-player-token` la primera vez.
- Cliente envía `{ nickname, token }` a `POST /api/player`.
  - Si el nickname es libre → crea registro, devuelve `{ id, nickname }`.
  - Si existe + el hash del token coincide → mismo jugador, reclaim OK.
  - Si existe pero el token no coincide → `error: nickname_taken`.
- Cliente guarda `{ playerId, nickname }` en localStorage para
  saltarse el modal en visitas futuras.
- Server guarda sólo el **sha256 del token** — un dump de la DB no
  expone las credenciales.

## Arquitectura

```
┌─────────────┐   fetch('/api/player')   ┌──────────────┐
│   Client    │ ───────────────────────> │  server HTTP │
│             │ <─────────────────────── │  /api/*      │
│ modal       │   { id, nickname }       │              │
│ localStorage│                          │  better-sqlite3
│ ws connect  │                          │              │
│             │   room.join({ playerId,  │  BrawlRoom   │
│             │     playerToken, ...})   │  verifyPlayer│
│             │ ───────────────────────> │  onJoin      │
│             │   game ticks...          │  tick loop   │
│             │   match ends             │  endMatch    │
│             │                          │  recordMatch │
└─────────────┘                          └──────────────┘
                                               │
                                               ▼
                                         SQLite (Railway volume)
```

**Endpoints REST** (mismo proceso que el Colyseus WS server):

- `POST /api/player` — register/claim nickname. Rate-limited 10/min/IP.
- `GET /api/leaderboard` — batch top-10 de los 5 belts.
- `GET /api/leaderboard/:beltId` — top-10 de un belt específico.
- `GET /api/player/:id/stats` — stats del jugador (para mostrar "tu rank" en UI).

No hay un `POST /api/match/result` público — el `endMatch` del
BrawlRoom llama `recordMatchResult` de `db.ts` directamente, sin
pasar por HTTP. Los clientes no pueden mandar resultados fake.

## Esquema SQLite

```sql
CREATE TABLE players (
  id               TEXT PRIMARY KEY,          -- UUID
  nickname_norm    TEXT NOT NULL UNIQUE,      -- lowercase, para lookup
  nickname_display TEXT NOT NULL,             -- con case original
  token_hash       TEXT NOT NULL,             -- sha256(token cliente)
  created_at       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL
);

CREATE TABLE player_stats (
  player_id         TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  wins_online       INTEGER NOT NULL DEFAULT 0,
  matches_online    INTEGER NOT NULL DEFAULT 0,
  fastest_win_ms    INTEGER,
  lives_left_sum    INTEGER NOT NULL DEFAULT 0,
  kills_vs_humans   INTEGER NOT NULL DEFAULT 0,
  current_streak    INTEGER NOT NULL DEFAULT 0,
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  critters_won_json TEXT NOT NULL DEFAULT '[]',
  updated_at        INTEGER NOT NULL
);

-- Índices para los 5 belts
CREATE INDEX idx_stats_wins        ON player_stats(wins_online DESC);
CREATE INDEX idx_stats_fastest     ON player_stats(fastest_win_ms ASC);
CREATE INDEX idx_stats_kills       ON player_stats(kills_vs_humans DESC);
CREATE INDEX idx_stats_long_streak ON player_stats(longest_streak DESC);
```

Railway SQLite con volumen persistente montado en `$DATA_DIR`
(default `./data`). Hobby plan: 5 GB volume + 3000 IOPS — sobrado
para un juego jam (10k jugadores = ~10 MB DB).

## Plan de implementación

- ✅ **Fase 1** (2026-04-23) — Backend: `server/src/db.ts` +
  `server/src/api.ts` + wiring en `index.ts`. Schema idempotente al
  boot (WAL + normal sync). Endpoints REST probados local.
- ✅ **Fase 2** (2026-04-23) — Cliente: `src/online-identity.ts` +
  `src/hud/nickname-modal.ts` + HTML/CSS modal. El `game.ts` gatea
  `enterOnlineCharacterSelect` con `ensureOnlineIdentity`.
- ✅ **Fase 3** (2026-04-23) — BrawlRoom: `verifyPlayer` en onJoin +
  `playingStartedAtMs` stamp + `recordOnlineBeltStats` en endMatch.
  Guests (sin nickname) juegan normal pero no puntúan.
- **Fase 4** (pendiente) — Leaderboard UI: tab "Online" en el modal
  Hall of Belts, mostrar top-10 por cada uno de los 5 belts + quién
  es el holder actual destacado.
- **Fase 5** (pendiente) — Toast "🏆 You took the Throne Belt!" al
  cambiar el holder. Server broadcast en endMatch con los ids de
  belts que cambiaron.
- **Fase 6** (post-MVP) — `kills_vs_humans` real via last-hitter
  tracking en `server/src/sim/physics.ts`. Hoy es 0.

## Moderación nickname

Sólo el mínimo viable para la jam — un filtro exhaustivo es futuro.

- Regex `/^[a-zA-Z0-9_\-]{3,16}$/` limita la superficie.
- Lista reservados: `admin`, `root`, `anonymous`, `null`, `undefined`, `guest`.
- Rate limit 10/min/IP en `POST /api/player`.
- TODO post-jam: lista de palabras prohibidas más amplia + flag-and-report.

## Reset / cambio de nickname

No hay flujo de "cambiar nickname" en v1. Si un usuario pierde
localStorage (modo incógnito, borrado de datos, cambio de dispositivo)
pierde acceso a su row y tendría que registrar uno nuevo. Para el
jam esto es aceptable — si se pide feature, puede añadirse como
"change nickname" con verificación vía token actual en post-jam.
