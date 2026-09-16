# Sesiones por carril — cómo trabajar en paralelo sin pisarnos

> Decisión de Rafa, **2026-09-16**: *"vamos a usar la estrategia de separar
> en diferentes sesiones dentro del proyecto los diferentes aspectos que
> estemos trabajando… lo único que hay que tener cuidado es en no
> pisarnos"*. El motivo es el coste: una sesión que lo toca todo arrastra
> un contexto enorme; cuatro sesiones temáticas arrastran contextos
> pequeños.

**Si abres una sesión en este repo, lee esto antes de tocar nada.** Tu
carril te dice qué ficheros son tuyos, cuáles son de otro y cuáles hay que
pedir. Las reglas de `CLAUDE.md` (ramas, merges, zonas hard-stop, doble
superficie, instancias mudas) siguen mandando por encima de este
documento; esto solo reparte el territorio.

---

## La regla de oro

**Una sola sesión activa a la vez sobre esta carpeta.**

No es una preferencia, es física: todas las sesiones que abras en
`R:\...\bichitos-rumble` comparten **el mismo checkout de git y los mismos
ficheros en disco**. Dos sesiones a la vez no producen un conflicto de
merge que se resuelve; producen que una cambie de rama mientras la otra
edita, o que las dos escriban el mismo fichero sin enterarse. Ninguna
convención de nombres arregla eso.

Tener cuatro sesiones ABIERTAS en la barra lateral es perfecto y es justo
lo que buscamos: cada una conserva su contexto pequeño y puede pasar días
dormida. Lo que no puede haber es dos **trabajando** a la vez.

**¿Y si quiero dos de verdad en paralelo?** Entonces la segunda va en su
propio *worktree* (carpeta hermana con su rama). Medido el 2026-09-16:

| | Coste real |
|---|---|
| Ficheros versionados | 375 · **170 MB** (barato) |
| `node_modules` | **304 MB y un `npm install` propio** por worktree |
| `resources/` (5,4 GB de arte de Rafa) | **NO existe en el worktree** (está en .gitignore); hay que leerla por ruta absoluta de la carpeta principal |
| `.tmp/` (capturas, goldens de trabajo) | Tampoco existe |
| Puerto 5173 del dev server | Es de quien esté activo; el segundo arranca en otro puerto |

O sea: viable, pero con fricción. Por turnos no hay ninguna.

---

## Los cuatro carriles

### 🏝️ 1. ARENA — terreno, dioramas, fondo, colapso y la física de las cosas

**Tuyo:**
- `src/arena.ts` · `src/arena-look.ts` · `src/arena-backdrop.ts` ·
  `src/arena-scatter{,-types,-geometry,-recipes}.ts` ·
  `src/arena-decorations.ts` · `src/arena-decor-layouts.ts` ·
  `src/blob-shadows.ts` · `src/dust-puff.ts` · `src/scene-atmosphere.ts` ·
  `src/camera.ts`
- **El espejo del sim de la arena, siempre los dos lados en el mismo
  commit**: `src/arena-fragments.ts` ↔ `server/src/sim/arena-fragments.ts`
  y `server/src/sim/arena.ts` (lo vigila `scripts/check-sim-parity.mjs`
  dentro de `npm run check`).
- `scripts/arena-*.mjs` · `scripts/optimize-arena-props.mjs` ·
  `scripts/write-arena-layout-golden.mjs` · `scripts/compress-arena-textures.mjs`
- `public/models/arenas/**` · las texturas de suelo y skybox de `public/images/`
- `docs/ARENA_V2.md` · `docs/DIORAMAS.md` · `ARENA_PROMPTS.md`
- `tests/sim/arena-*.test.ts` + `tests/sim/arena-layout-golden.json`
- Tu checklist: [`docs/carriles/arena.md`](carriles/arena.md)

**No tuyo:** critters, HUD, servidor (salvo los espejos de arriba).

---

### 🦔 2. PERSONAJES — modelos, animaciones, texturas, habilidades y feeling

**Tuyo:**
- `src/critter.ts` · `src/critter-animation.ts` · `src/critter-parts.ts` ·
  `src/critter-skeletal.ts` · `src/animation-overrides.ts` ·
  `src/animation-personality-overrides.ts` · `src/roster.ts` ·
  `src/player.ts` · `src/bot.ts` · `src/physics.ts` · `src/gamefeel.ts` ·
  `src/abilities{,-runtime,-vfx}.ts` · `src/projectiles.ts` ·
  `src/model-loader.ts` · `src/preview.ts`
- Los labs: `src/animlab/` · `src/calibrate/`
- **Espejos del sim**: `server/src/sim/{abilities,bot,physics,config}.ts`
- `public/models/critters/**` y el pipeline `scripts/{import-critter,verify-critter-glbs,compress-critter-glbs,rename-glb-clips,inspect-*}.mjs`
- `CHARACTER_DESIGN.md` · `ULTI_DESIGN.md` · `ABILITY_QA_CHECKLIST.md` ·
  `PROCEDURAL_PARTS.md` · `STYLE_LOCK.md` · `ASSET_PIPELINE.md`
- El repo hermano `bichitos-mesh2motion` (animación) — se comunica por
  `BICHITOS_GAME_ROOT`.
- Tu checklist: [`docs/carriles/personajes.md`](carriles/personajes.md)

**Ojo:** es el carril que más toca **gameplay protegido por golden**
(física, habilidades, bots). Por defecto **el testigo del golden es suyo**
(ver abajo).

---

### 🖥️ 3. INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

**Tuyo:**
- `src/hud/**` · `src/hud.ts` · `src/i18n.ts` ·
  `src/input{,-gamepad,-touch,-glyphs}.ts` · `src/audio.ts` ·
  `src/badges.ts` · `src/badge-toast.ts` · `src/belt-*.ts` ·
  `src/hall-of-belts.ts` · `src/slot-thumbnail.ts` ·
  `src/online-belt-toast.ts` · `src/status-*` · `src/portal.ts`
- `index.html`, hojas de estilo, sprites de HUD y
  `scripts/rebuild-hud-sheet.mjs`
- `BADGES_DESIGN.md`
- Tu checklist: [`docs/carriles/interfaz.md`](carriles/interfaz.md)

**Ojo:** si cambias las claves de silencio de `src/audio.ts`
(`bichitos.sfxMuted` / `bichitos.musicMuted`), avisa — las lee
`scripts/lib/headless-browser.mjs` y se rompen las capturas mudas de
todos los carriles.

---

### 📦 4. DISTRIBUCIÓN Y DATOS — servidor, red, despliegue, payload, estadísticas y tienda

**Tuyo:**
- `server/**` **excepto `server/src/sim/`** (esos son espejos de otros
  carriles) · `src/network.ts` · `src/network-events.ts` ·
  `src/online-identity.ts` · `src/observability*.ts` · `src/stats.ts` ·
  `src/pws-stats.ts` (+ su espejo `server/src/sim/pws-stats.ts`)
- Build y despliegue: `vite.config.ts`, `vercel.json`, `Dockerfile`,
  `.github/`, `scripts/check-payload-budget.mjs`, `scripts/doctor.mjs`, SEO/OG
- `ONLINE.md` · `STACK.md` · `SUBMISSION_CHECKLIST.md` ·
  `ASSET_LICENSES.md`
- itch.io, Steam, monetización, analítica
- Tu checklist: [`docs/carriles/distribucion.md`](carriles/distribucion.md)

---

## Tierra de nadie (permiso explícito, nunca dos carriles el mismo día)

Estos ficheros los quieren todos. Quien los toque: **diff mínimo, dicho en
el commit, y nunca a medias entre sesiones.**

- `src/game.ts` — 2.410 líneas, el orquestador. Es el punto de integración
  de los cuatro carriles y el sitio donde más fácil es pisarse.
- `src/main.ts` · `src/frame-ticks.ts` · `src/match-rng.ts` · `src/globals.d.ts`
- `src/tools/dev-api.ts` — 1.290 líneas; la directiva de doble superficie
  hace que **todos** quieran añadir métodos aquí. Añade al final, no
  reordenes.
- `package.json` · `tsconfig*.json` · `playwright.config.ts` ·
  `scripts/lib/headless-browser.mjs` · `scripts/tool-patch-core.mjs`
- Docs troncales: `CLAUDE.md` / `AGENTS.md` (espejos, se tocan a la vez),
  `BUILD_LOG.md`, `NEXT_STEPS.md`, `ROADMAP.md`, `MEMORY.md`,
  `ERROR_LOG.md`, `DEV_TOOLS.md`, `GAME_DESIGN.md`, `RULES.md`

### El testigo del golden

`scripts/golden/sim-golden.json` y `tests/sim/arena-layout-golden.json`
son la memoria del balance. Si dos carriles los regeneran, el segundo
borra la prueba del primero.

- **Solo regenera el carril que tenga el testigo** (por defecto,
  PERSONAJES).
- Para pedirlo, se deja nota en el fichero del otro carril, §Buzón.
- Tras `npm run golden:write`, **siempre** `npm run golden` y ver 3/3 antes
  de commitear (lección del 2026-09-07, ERROR_LOG).

---

## Protocolo de cada sesión

**Al abrir:**
1. `git checkout dev && git pull --ff-only` — si eso falla, hay algo sin
   cerrar de otro carril: arréglalo antes de empezar.
2. Lee tu fichero de carril (`docs/carriles/<carril>.md`) y su §Buzón.
3. Rama nueva: `claude/<tipo>/<carril>-<slug>` — p. ej.
   `claude/feature/arena-slice2`, `claude/fix/hud-toast-mobile`.

**Al cerrar (innegociable, es lo que permite que el siguiente carril
empiece a ciegas):**
1. Todo mergeado a `dev` (squash) y **empujado**; árbol limpio; rama
   borrada. Nada de ramas vivas entre sesiones.
2. Tu fichero de carril actualizado con "cómo retomar" y lo que dejas
   abierto.
3. Entrada en `BUILD_LOG.md` si has decidido algo, con la etiqueta del
   carril al principio del título.
4. Si has dejado una tanda de agentes viva, **mátala**: su caché no
   sobrevive a la sesión (lección del 2026-09-07; se perdió un
   diagnóstico entero de 9 agentes).

**Entre carriles:** no edites lo que no es tuyo. Deja la nota en
`docs/carriles/<el-otro>.md` §Buzón y sigue con lo tuyo. El carril dueño lo
aplica cuando le toque — es el mismo patrón de buzones que ya funciona en
el nexo.

---

## Cómo abrir cada sesión

Abre una sesión nueva del app **en esta misma carpeta** y pégale su
encargo. No hace falta nada más: el encargo la manda leer lo que necesita.

**🏝️ Arena**
> Eres la sesión del carril ARENA de Bichitos Rumble. Lee `docs/SESIONES.md`
> (tu territorio y las reglas), `docs/carriles/arena.md` (tu checklist y tu
> buzón) y `CLAUDE.md`. No toques ficheros de otros carriles. Empieza por lo
> primero pendiente de tu checklist.

**🦔 Personajes**
> Eres la sesión del carril PERSONAJES de Bichitos Rumble. Lee
> `docs/SESIONES.md`, `docs/carriles/personajes.md` y `CLAUDE.md`. Tienes el
> testigo del golden: eres el único que puede regenerarlo, y siempre con
> `npm run golden` detrás. Empieza por lo primero pendiente de tu checklist.

**🖥️ Interfaz**
> Eres la sesión del carril INTERFAZ de Bichitos Rumble. Lee
> `docs/SESIONES.md`, `docs/carriles/interfaz.md` y `CLAUDE.md`. No toques
> gameplay ni arena. Empieza por lo primero pendiente de tu checklist.

**📦 Distribución y datos**
> Eres la sesión del carril DISTRIBUCIÓN de Bichitos Rumble. Lee
> `docs/SESIONES.md`, `docs/carriles/distribucion.md` y `CLAUDE.md`. El
> servidor y el build son zonas hard-stop: plan antes de tocar. Empieza por
> lo primero pendiente de tu checklist.
