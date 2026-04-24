# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC** · **Submitted to Vibe Jam** 2026-04-23
> Live: https://www.bichitosrumble.com · **Single source of truth for what's next.**
>
> Reorganizado 2026-04-24 noche (sesión de handoff). Las secciones al
> principio se leen en 30 segundos: qué hacer ya, qué está parado y por
> qué, qué NO tocar. El roadmap histórico (Fases 1-4 del jam) queda al
> final como referencia.

---

## 🟢 AHORA MISMO — UNBLOCKED

Lo que puedes retomar sin esperar a nadie ni nada. En orden.

### 0. [CERRADO 2026-04-24 noche] Animation Validation Lab

`/anim-lab.html` operativo. 9 críttrs × 13 logical states inspeccionables
visualmente. Resolver ampliado a **4 tiers** (override > exact > prefix
> contains). Fuente de verdad del mapping: `src/animation-overrides.ts`.

**Cuándo usarlo**:
- Nuevo crítter importado con clips ambiguos → abrir lab, ver qué
  tier resuelve cada state, si algo sale raro añadir override.
- Debug de clip seleccionado mal → ver `source` badge.
- Pre-flight de feel pass: antes de Trunk/Cheeto/etc, verificar en
  el lab que todos los clips críticos (idle/run/abilities) están
  resolviendo bien. Si algún clip clave sale "missing" o "contains"
  (último recurso), resolver con override antes de pasar al feel.

### 1. Feel pass Trunk (Bruiser)

Siguiente en el orden acordado tras cerrar Sergei el 2026-04-24 mediodía.
Plantilla aplicada sobre Sergei disponible en
`CHARACTER_DESIGN.md §"Feel pass log"`. Receta resumida:

1. Medir clips reales con `scripts/inspect-clips.mjs` →
   `public/models/critters/trunk.glb`.
2. Alinear `duration` / `windUp` / `cooldown` del kit Trunk
   (`src/abilities.ts CRITTER_ABILITIES.Trunk`) con las duraciones de
   clip. Añadir `clipPlaybackRate` si el gap clip↔ability es grande
   (Gorilla Rush usó 2.3× como referencia).
3. Identificar el "frame de impacto" del clip (el momento que el mesh
   golpea). Ahí disparar VFX: shockwave ring / dust burst /
   squash-stretch. Sergei reusó `spawnShockwaveRing` y estrenó
   `spawnFrenzyBurst` — Trunk probablemente amplía el radius del
   shockwave (es un elefante) y añade stomp dust.
4. Documentar en `CHARACTER_DESIGN.md §"Feel pass log"` una tabla
   idéntica a la de Sergei con el delta de valores.
5. QA offline + online: partida con Trunk como player + bot,
   verificar que las 3 abilities se sienten punchy y el clip lee bien.

**Scope estrecho**: sólo Trunk. No reabrir selector / HUD / escala
base. No refactors. No features nuevas.

### 2. Polish del info pane (si queda tiempo tras Trunk)

El info pane stats ya tiene grid CSS alineado pero hay margen para
ajustes finos (ver `CHARACTER_DESIGN.md §"Slot transitions"` ideas
de transiciones + stat bounce que no son bloqueantes).

### 3. Sprites HUD residuales

Hoy usamos sprites 2D en selector + lives-dots. Quedan iconos por
integrar desde la misma sheet (`hearts`, `bot-mask`, `belts-trophy`,
`sfx/music`) en los sitios específicos del HUD donde todavía se ven
emojis. Ver `AI_PROMPTS.md §8`. Tarea cosmética, no toca lógica.

---

## 🟡 BLOQUEADO POR ASSET DEL USUARIO

No empezar hasta que llegue el archivo. Cuando llegue, aplicar
directamente — los tickets están detallados para ejecución sin
re-diseñar.

### A. `ability-icons.png` mejorado

El usuario va a pasar una v2 del sprite sheet de abilities, análoga
a `HUD_mejorado.png` que ya se integró. Al recibirlo, ejecutar **tres
cambios en una misma pasada**:

1. **Integrar la sheet**: si viene con márgenes/gutters análogos al
   HUD principal (20 px margen + 20 px gutter en grid), clonar el
   approach de `scripts/rebuild-hud-sheet.mjs` creando un
   `scripts/rebuild-ability-sheet.mjs`. Output a
   `public/images/ability-icons.png`. Ajustar `background-size` del
   CSS `.sprite-ability` al nuevo grid (hoy 300% × 900% para 3×9).

2. **Ampliar el tamaño de los iconos en el HUD de abilities**: hoy
   `.ability-slot` muestra un icon pequeño + `[J]` + nombre + barra
   horizontal. Rediseño: icon grande en círculo (~64 px), keybind en
   chip pegado al círculo, nombre debajo. Estilo MOBA moderno.

3. **Cooldown radial sobre el icon**: reemplazar la barra horizontal
   `.ability-fill` por un sweep circular pintado ENCIMA del icon y
   que se retrae mientras recupera. Estilo League of Legends /
   Overwatch. Implementación recomendada:
   ```css
   .ability-cooldown-mask {
     position: absolute; inset: 0; border-radius: 50%;
     background: conic-gradient(
       from 0deg,
       rgba(0,0,0,0.7) 0deg,
       rgba(0,0,0,0.7) var(--cd-angle, 0deg),
       transparent   var(--cd-angle, 0deg)
     );
     pointer-events: none;
   }
   ```
   `updateAbilityHUD` setea `--cd-angle = (cooldownLeft/cooldown)*360deg`
   cada frame. Al completar, flash dorado corto.

**Archivos a tocar**: `index.html` (CSS `.ability-slot` +
`.ability-fill`), `src/hud/runtime.ts` (`initAbilityHUD` +
`updateAbilityHUD`), y el script nuevo de sheet si aplica.

---

## 🔵 BLOQUEADO POR QA MANUAL

No son bugs; son cosas que necesitan verificación visual con navegador
real (desktop + móvil). El usuario tiene que hacerlo — yo puedo QA por
DOM pero no puedo juzgar sensación visual en 4P online.

Ver `VALIDATION_CHECKLIST.md §"Tanda 2026-04-24"` para la lista
completa con checkboxes. Resumen:

- **Selector**: miniaturas 2D correctas, sensación de tamaño uniforme,
  fallback sin sprite sheet, drag rotación preview, confirm / refresh.
- **`/calibrate.html`**: carga, sliders funcionan, export al
  portapapeles, re-fit global.
- **Escala in-game**: 4 críttrs distintos en partida se perciben
  consistentes. Ningún pivot hace que floten o se hundan.
- **HUD in-match**: 4 avatares 2D nítidos, no pisan Vibe Jam / portal.
- **Partidas online 4P**: consistencia entre clientes (especialmente
  pack cosmético compartido + auto-fit visible igual).
- **Cross-device**: desktop + móvil touch + gamepad.

Si algo de eso sale mal, anotar en `ERROR_LOG.md` y convertir a ticket
de `AHORA MISMO — UNBLOCKED`. Mientras no salga, es post-jam polish.

---

## 🟣 POST-JAM / BACKLOG / NO TOCAR AHORA

No abrir estos melones sin motivo (bug real en producción que no
tenga otra salida). Registrados para que no se pierdan, pero fuera
de scope del jam.

- **Signature abilities definitivas** — 6 de los 9 ULTIs son
  placeholder `frenzy`. Detalles en `CHARACTER_DESIGN.md
  §"Qué hacer si la urgencia dicta avanzar antes"` + arquitectura en
  `ULTI_DESIGN.md`. Nuevos sistemas requeridos: grab-throw (Trunk),
  ilusiones (Kurama), input-inversion (Kermit), terreno persistente
  (Sihans), proyectiles (Kowalski), teleport target (Cheeto), conos
  direccionales (Cheeto ULTI / Sebastian H2), damage reflect
  (Shelly H2). Cada uno es >4h.
- **Reconnect online** (Colyseus `allowReconnection`).
- **Matchmaking por región / ranking / login / persistence**.
- **Pedestales temáticos por crítter** en `/preview.ts`.
- **Arena packs 6-10** (Savanna, Moonlight Jungle, Swamp, …) siguiendo
  la receta de `ARENA_PROMPTS.md`.
- **Pattern C de collapse** (cortes no-radiales).
- **Lighthouse deep optimization** — más allá del pass cosmético.
- **Sonidos signature por crítter** (Suno, para reemplazar los Web
  Audio sintetizados actuales).
- **HUD mobile restructure** más allá del layout actual.
- **Voz para el countdown 3-2-1-GO!** (ElevenLabs o equivalente).
- **Arena loader decorations — picker manual** en `/tools.html`
  (`debugStartOfflineMatch` ya acepta `options.packId`, sólo falta
  widget). Mejora de descubribilidad, cero bloqueo.
- **Link `/calibrate.html` desde `/tools.html`** (propuesta
  pendiente — hay hueco en la sidebar para un botón "↗ Roster Cal").
- **`pine_snow_option2` / palm_desert 2ª variante** — packs Tundra
  y Desert tienen una segunda variante de árbol/palmera descartada;
  si se regenera mejor, integrar como alternativa para arena layout.

---

## 🚫 NO TOCAR SALVO BUG REAL

Las siguientes zonas están estables y **no se reabren** en trabajo
normal. Si aparece un bug concreto, sí — pero no refactors ni
"limpieza preventiva":

- **Sistema del selector de personajes** (sprites 2D + fallback + info
  pane). Cerrado 2026-04-24 noche tras ciclo de QA visual real.
- **Auto-fit de tamaño visual** (`IN_GAME_TARGET_HEIGHT = 1.7` en
  `src/critter.ts attachGlbMesh`). El roster calibra `scale` pero la
  SoT visible es el auto-fit.
- **Clip resolver de animaciones** (ahora **4-tier**: override >
  exact > prefix > contains en `src/critter-skeletal.ts`). Sergei
  Run/Running resuelto. Overrides explícitos en
  `src/animation-overrides.ts` — hoy vacío por defecto.
- **`/anim-lab.html`** (cuarto entry Vite, 2026-04-24 noche). Lab
  dedicado para validar + overridear clip mappings por crítter. No
  reescribirlo sin motivo; si falta algo, extender el panel
  existente.
- **Sheet `hud-icons.png`** generada desde `HUD_mejorado.png` via
  `scripts/rebuild-hud-sheet.mjs`. No editar el PNG final a mano —
  siempre regenerar desde la fuente autored.
- **Arena decorations loader + packs** — 5 packs integrados + sync
  online funcionando. Ver `BUILD_LOG.md §"2026-04-24"`.
- **Feel pass Sergei** (valores + clipPlaybackRate + VFX
  `spawnFrenzyBurst`). Cerrado.
- **Online identity / cinturones offline + online** — 16 belts
  integrados, 21 assets optimizados. Cerrado.

---

## ✅ ESTADO DEL PROYECTO (snapshot 2026-04-24)

Qué está vivo, qué es pura referencia, qué ya no se usa.

### Scripts activos (seguir usando)

- `scripts/rebuild-hud-sheet.mjs` — regenera `public/images/hud-icons.png`
  desde `HUD_mejorado.png` (4×6 grid con márgenes). **Ejecutar cada
  vez que el PNG authored cambie.**
- `scripts/optimize-arena-props.mjs` — pipeline de props de arena.
- `scripts/aggressive-simplify.mjs` — last-resort para props monstruosos.
- `scripts/compress-arena-textures.mjs` — compresión de textures post-simplify.
- `scripts/inspect-clips.mjs` — medir duraciones de clips de un GLB.
- `scripts/import-belts.mjs` — pipeline de cinturones.
- `scripts/import-critter.mjs` — pipeline de críttrs.
- `scripts/verify-critter-glbs.mjs` — sanity check en `npm run check`.

### Scripts históricos / obsoletos (no borrar aún, pero no usar)

- `scripts/trim-hud-sheet.mjs` — **OBSOLETO**. Se usó durante el fix
  de labels visibles antes de que el usuario pasara `HUD_mejorado.png`
  con iconos ya limpios. `rebuild-hud-sheet.mjs` cubre el mismo rol
  de forma correcta. No borrar todavía por si vuelve a aparecer algún
  sheet con labels que limpiar; marcado como obsoleto en su comentario
  cabecera. Candidate a limpieza post-jam.
- `scripts/inspect-bounds.mjs` / `inspect-parts.mjs` / `doctor.mjs` —
  utilities one-off. Mantener.

### Documentación — estado

| Doc | Rol | Estado |
|---|---|---|
| `NEXT_STEPS.md` | SoT de "qué hacer" | Reorganizado este handoff |
| `MEMORY.md` | Decisiones clave + valores | Sección nueva 2026-04-24 al tope |
| `BUILD_LOG.md` | Changelog narrativo | Entrada "Closing handoff" añadida |
| `VALIDATION_CHECKLIST.md` | QA manual pendiente | Sección "Tanda 2026-04-24" añadida |
| `CHARACTER_DESIGN.md` | Design + Feel pass log | Sergei cerrado, Trunk siguiente |
| `ARENA_PROMPTS.md` | Prompts IA + notas | 5 packs integrados |
| `BADGES_DESIGN.md` | Sistema de cinturones | Cerrado |
| `ONLINE.md` | Flujo online | Al día |
| `DEV_TOOLS.md` | Lab `/tools.html` | Al día |
| `ERROR_LOG.md` | Post-mortems | Histórico |

---

## 📚 REPRODUCIR SCREENSHOTS con MCP Claude Preview

Aprendizaje del 2026-04-24: el MCP arranca Chromium con viewport
**portrait** (~452×1600 px). El juego tiene overlay anti-portrait que
oculta el canvas → screenshots devolvían buffer vacío. Fix obligatorio:

```js
mcp__Claude_Preview__preview_resize({
  serverId: "<id>",
  width: 1280, height: 800,
});
```

**ANTES** de cualquier screenshot. Ojo: los presets `desktop` /
`tablet` no redimensionan (reset a native size). Siempre width/height
explícitos.

Otras limitaciones importantes:

- **rAF pausado sin foco**: `requestAnimationFrame` no corre cuando el
  tab MCP no tiene foco. El game loop se congela. Workaround:
  `preview_eval` con `window.__game.update(0.016)` manualmente en un
  bucle for, luego screenshot.
- **Browser cache de PNG tras soft reload**: `location.reload()` no
  invalida assets estáticos. Para forzar fresh fetch: usar
  `location.href = '/?_t=' + Date.now()` o fetch con `?t=` manual.
- **Screenshot sin sincronizar con update manual**: `await
  requestAnimationFrame` dos veces tras un update antes de capturar
  o el compositor no repintará.

QA por DOM (`preview_eval` con DOM queries) sigue siendo válida y a
menudo más rápida, pero **el screenshot real revela bugs visuales
que el DOM no** — ejemplo: el specificity bug que pintaba sprites
24×24 en la esquina, invisible en DOM (`spriteVisible: true`) pero
obvio en captura.

---

## 📜 Roadmap histórico (referencia — ya casi todo cerrado)

Conservado abajo tal cual estaba. Los items con `[x]` son histórico
confirmado; los `[ ]` sin sección explícita arriba ya no aplican al
scope del jam. No borrar por ahora — sirve de referencia si alguna
fase se quiere relanzar post-jam.

### Fase 1 · Branding + audio (18-24 abril) — cerrada
- [x] Firma `@RGomezR14` en portada
- [x] SFX sintéticos in-game
- [x] 3 pistas Suno
- [x] API música + crossfade + mute persistente
- [x] Hooks de música por phase

### Fase 2 · Online 4P — cerrada
- [x] maxClients 4 + bot-fill 60s + waiting screen
- [x] Bot-takeover on disconnect
- [x] Badge 🤖 + end-screen distingue bots

### Fase 3 · Skeletal + lab — parcial
- [x] Capa skeletal + loader GLB
- [x] Lab `/animations` (Mesh2Motion)
- [x] Warning visual shake + rumble
- [x] Sergei feel pass (2026-04-24)
- [ ] Top 4 habilidades distintivas — post-jam
- [ ] Pattern C collapse — post-jam (no bloquea)

### Fase 4 · Última semana — en progreso
- [x] Gamepad + toast
- [ ] Lighthouse pass — pendiente
- [ ] Playtesting 4P producción — pendiente (QA manual)
- [ ] Screenshots promocionales — pendiente
- [ ] **Freeze 24h antes deadline**: solo hotfix crítico

---

## 🗂️ Key architecture notes (dispatch sessions)

Copiado del viejo NEXT_STEPS para evitar perderlo:

- Work on `dev`, merge to `main` for deploy. Vercel (client) + Railway
  (server) auto-deploy from `main`.
- Server en `server/`: Colyseus 0.16, schema v3, multi-stage Dockerfile.
- Arena fragments generator DEBE estar byte-identical cliente ↔ servidor.
- NUNCA poner campos non-synced en clases Schema — usar `BrawlRoom.internal`.
- Match-end en server: siempre vía `BrawlRoom.endMatch()` (locka la room).
- Offline mode NO debe regresar con ningún cambio online.
- `/tools.html` = 2º entry de Vite. `/calibrate.html` = 3º entry
  (añadido 2026-04-24).
- **Lab debug API**: `DevApi` (`src/tools/dev-api.ts`) centraliza
  todo. Game solo expone 5 métodos `debug*`.
- `Critter.debugBotBehaviour` es el único campo "debug-only" en la
  clase gameplay. Default `'normal'` = producción intacto.
- Live tool reference: `DEV_TOOLS.md`.
- Validation live reference: `VALIDATION_CHECKLIST.md`.
