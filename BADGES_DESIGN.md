# Badges Design — Bichitos Rumble

> **Status**: design only. No implementation yet. This doc exists to
> lock the concept, the storage shape, and the prompts we'll feed to
> generative AI for the physical belt art, so when we actually build
> it we don't argue with ourselves.

## Concept

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
  - Solo offline por ahora — el flujo online (BrawlRoom) tiene su
    propio end-screen callback que aún NO dispara badges. Se
    añadirá cuando validemos el offline primero.
- **Fase 3** (pendiente) · UI overlay en end-screen — el toast "NEW
  BELT UNLOCKED" con animación de aparición, silueta del belt en
  plomo antes del reveal. Lee `stats.recentlyUnlocked` y llama a
  `clearRecentlyUnlocked()` al cerrarse.
- **Fase 4** · Grid "Hall of Belts" en character-select.
- **Fase 5** · Generar y colocar los 16 assets en `public/badges/`.
- **Fase 6** · Validación — jugar 5-10 partidas buscando cada logro,
  ajustar umbrales.

Total aproximado restante: **4-5 horas** de ingeniería + el tiempo
externo de generación de arte.

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
