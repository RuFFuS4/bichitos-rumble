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

### 0. [CERRADO 2026-04-25] In-arena decor system + editor v2 + scale fix

`/decor-editor.html` operativo con drag, undo/redo, localStorage por
pack, preview GLB opcional y "Preview in game" (URL flag con
fallback automático a code layout). Sistema de decoración runtime
parentea props a fragments (caen con el fragment). Escala unificada
vía `displayHeight` per-type + bbox auto-fit (mismo patrón que
`Critter.attachGlbMesh`). `jungle` ya tiene 11 props authored; los
otros 4 packs (`frozen_tundra`, `desert_dunes`, `coral_beach`,
`kitsune_shrine`) están **vacíos a la espera de diseño visual desde
el editor**.

### 0.5. [PENDIENTE — accionable] Auto-apply patch para tools internas

Patrón actual: editor → `localStorage` → "Copy snippet" → pegar a
mano en source TS. Funciona pero el round-trip pega-edita es la
fricción principal.

Próximo paso natural (planteado pero NO implementado en 2026-04-25):
- Cada tool emite un `ToolPatch` JSON tipado
  (`{ tool: 'decor-editor', target: 'src/arena-decor-layouts.ts',
    pack: 'jungle', placements: [...] }` o similar).
- Nuevo script `scripts/apply-tool-patch.mjs` lee el patch y muta el
  archivo source en sitio (regex acotada por bloque, igual que la
  propuesta `apply-calibration` que aplazamos).
- Botón "Apply patch" en cada tool descarga el JSON; el usuario lo
  guarda en raíz, ejecuta `npm run apply-tool-patch`, revisa diff,
  commit.

Empezar por `/decor-editor` (más reciente, tipos más estables).
Después `/calibrate` y `/anim-lab` migrarían sus helpers locales a
`src/tools/tool-storage.ts` y añadirían su rama al script.

**Flujo de trabajo para poblar un pack**:
1. `npm run dev` → abrir `/decor-editor.html`.
2. Seleccionar pack en dropdown.
3. Click en zona vacía del arena = nuevo prop con tipo seleccionado.
4. Click en prop = seleccionar; sliders para fine-tune; drag para mover.
5. Ctrl+Z / Ctrl+Y para deshacer / rehacer.
6. Auto-save por sesión en localStorage (recargas no pierden trabajo).
7. Cuando quede bonito → "Copy TS snippet" → pegar dentro de
   `DECOR_LAYOUTS[pack]` en `src/arena-decor-layouts.ts`.
8. Recargar → ver props en partida.

Detalles técnicos completos en BUILD_LOG.md §"2026-04-25 In-arena
decor". Catálogo de props disponibles en `src/arena-decor-layouts.ts`
(`DECOR_TYPES`).

### 0.bis. [CERRADO 2026-04-24 noche] Animation Validation Lab

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

### 1. [PENDIENTE DE FIRMA POR PLAYTEST] Feel pass Trunk

Código aplicado 2026-04-25 pero **no cerrado ciegamente** — requiere
playtest visual del usuario antes de firmar como DONE.

Detalles completos en `CHARACTER_DESIGN.md §"Trunk — feel pass"`.
Resumen ejecutivo:

- `trunk.ability_2 → Ability3GroundPound` (override productivo).
- Ram clipPlaybackRate 5.0× / Earthquake 2.8× / Stampede procedural.
- Radius 4.5 y mass ×3.5 marcan identidad bruiser.

**Qué debería salir bien en el playtest**:
- J Ram se siente punchy (clip 4.58s → efectivo 0.92s + impulso ×16,
  mass ×3.5 = embestida pesada).
- K Earthquake reproduce el stomp correcto (override) con radio ancho
  4.5u y knockback 40 (shockwave ring más grande que Sergei por el
  parametro).
- L Stampede aguanta 3.0s con speed ×1.25 y mass ×1.80 — bulldozer
  doble, menos espeed que Sergei pero más peso (coherente con
  Bruiser).

**Puntos concretos a vigilar durante playtest**:
1. **Stomp previo al buff en L (Stampede)** — el clip
   `Ability3GroundPound` se reproduce 1.96s al inicio del frenzy. Lee
   como "planta patas antes de embestir" (aceptable) pero también
   puede leerse como "K y L hacen lo mismo visualmente al principio"
   (problemático). Si el usuario ve que confunde K con L: Plan B.
2. **Ram a 5× playback** — puede verse demasiado acelerado / cartoon.
   Si lo nota raro: bajar a 3.5–4.0×.
3. **Earthquake windUp 0.60s** — largo. Vale para telegraph bruiser
   pero puede frustrar en arena pequeña cuando todos colapsan.

**Plan B si ab_3 stomp molesta**:
- **Opción A (bajo coste)**: override `trunk.ability_3 → 'Idle'` — al
  activar L reproduce 1 frame de idle clampado + el buff emissive
  toma over inmediatamente. Cero animación "stomp" previa.
- **Opción B (modificación más quirúrgica)**: tocar
  `src/critter.ts tickSkeletal` para NO disparar clip cuando
  `state.def.type === 'frenzy' && !clip specific`. Un if. Afecta
  también a Kermit ab_3 (Hypnosapo, también procedural) y a cualquier
  futuro frenzy sin clip. Más correcto a nivel arquitectura pero no
  es scope estrecho.

### 2. Feel pass siguiente (ver §"Siguiente crítter recomendado" abajo)

---

## 🔬 BARRIDO DE MAPPING DEL ROSTER (2026-04-25)

Snapshot de `/anim-lab.html` contra los 9 playable critters. Se
capturó clips disponibles + resolver `source` tier por cada ab_1/ab_2/
ab_3 + idle/run/walk. Tabla abajo.

Leyenda veredicto:
- ✅ **correcto**: clip encaja semánticamente con el placeholder slot.
- 🟢 **aceptable**: clip es distinto del diseño del placeholder pero no
  crea incoherencia visual grave.
- 🟡 **dudoso**: clip no encaja del todo pero no hay mejor alternativa
  en el GLB.
- ❌ **incorrecto**: clip contradice el slot y hay alternativa mejor
  dentro del GLB — candidato a override.
- 📐 **by-design**: clip `missing` intencional; procedural
  (`PROCEDURAL_PARTS.md`).

| Crítter | #clips | ab_1 clip resolver | ab_2 clip resolver | ab_3 clip resolver | Veredicto / acción |
|---|---:|---|---|---|---|
| **Sergei** (Balanced) | 10 | Ability1GorillaRush · prefix ✅ | Ability2Shockwave · prefix ✅ | Ability3Frenzy · prefix ✅ | **✅ sano completo**. Único crítter 100% alineado diseño↔clips. Feel pass DONE. |
| **Trunk** (Bruiser) | 8 | Ability1TrunkRam · prefix ✅ | Ability3GroundPound · **override** ✅ | Ability3GroundPound · prefix 🟡 | **✅ arreglado vía override** (ab_2). ab_3 observado (stomp previo al buff). Feel pass en firma. |
| **Kurama** (Trickster) | 9 | Ability1FoxDash · prefix ✅ | Ability2MirrorTrick · prefix 🟢 | Ability3Copycat · prefix 🟢 | **🟢 sin override**. Clip MirrorTrick lee aceptable como "burst con efecto" para GP placeholder. Copycat puede leerse como "celebración dramática" al entrar en Frenzy. Sin mismatch grave. |
| **Shelly** (Tank) | 6 | — · missing 📐 | — · missing 📐 | Ability3MegaShell · prefix ✅ | **✅ sano**. ab_1 Shell Charge + ab_2 Shell Shield procedurales por diseño (mesh spin + hide parts). ab_3 Mega Shell encaja perfectamente con frenzy placeholder. |
| **Kermit** (Controller) | 7 | Ability1LeapForward · prefix ✅ | Ability2PoisonCloud · prefix 🟡 | — · missing 📐 | **🟡 sin override**. Poison Cloud clip no encaja con GP stomp pero no hay otro clip de impacto; dejarlo. ab_3 Hypnosapo procedural por diseño (emissive flicker). |
| **Sihans** (Trapper) | 9 | Ability1BurrowRush · prefix ✅ | Ability2Tunnel · prefix 🟢 | Ability3DiggyDiggyHole · prefix 🟢 | **🟢 sin override**. Todos los clips son "el topo cavando" en distintos modos → coherente con placeholder GP y Frenzy. |
| **Kowalski** (Mage) | 8 | Ability1IceSlide · prefix ✅ | Ability2Snowball · prefix 🟡 | Ability3IceAge · prefix 🟢 | **🟡 sin override**. Snowball clip muestra al pingüino lanzando proyectil — no es un stomp, pero tampoco contradice. Ice Age como entrada dramática al frenzy. |
| **Cheeto** (Assassin) | 8 | Ability1Pounce · prefix ✅ | Ability2ShadowStep · prefix ❌⚠️ | Ability3TigerRoar · prefix ✅ | **⚠️ mismatch parcial sin override viable**. ShadowStep es teleport visual — contradice "Paw Stomp" GP placeholder claramente. Pero NO hay otro clip de stomp en Cheeto. Único remedio sería cuando el kit definitivo de Cheeto llegue. Tiger Roar rugido encaja bien con Frenzy buff entry. |
| **Sebastian** (Glass Cannon) | 7 | — · missing 📐 | Ability2ClawSweep · prefix 🟡 | — · missing 📐 | **🟡 sin override**. ab_1 Claw Rush + ab_3 Crab Slash procedurales por diseño (dash lateral + mesh scale). ab_2 ClawSweep es arco horizontal — no encaja perfecto con GP radial pero no hay otro clip. |

### Candidatos a override tras barrido — ninguno

Cero overrides adicionales añadidos. Razones:

- **Mismatches que duelen pero no tienen remedio dentro del GLB**
  (Cheeto ShadowStep, Sebastian ClawSweep, Kowalski Snowball): los
  clips existentes son los únicos de su slot. Forzar un override
  a otro clip (p. ej. `Idle` como no-op) sería peor visualmente que
  aceptar el mismatch. Se resolverán cuando el kit definitivo de
  cada crítter reemplace el placeholder (post-jam).
- **Mismatches leves que el reviewer acepta** (Kurama MirrorTrick,
  Sihans Tunnel, Kermit PoisonCloud, Kowalski IceAge): no contradicen,
  solo divergen en intent. Esperar al kit definitivo.

La **única entrada del `ANIMATION_OVERRIDES` record** sigue siendo
Trunk (primer caso donde un clip del propio GLB encaja mejor en
OTRO slot del kit placeholder).

### Siguiente crítter recomendado: **Kurama (Trickster)**

**Por qué Kurama y no Cheeto** (que sería el orden del roadmap):

| Criterio | Kurama | Cheeto | Ganador |
|---|---|---|---|
| Overrides necesarios | 0 | 1 potencial pero sin clip alternativo viable | **Kurama** |
| Clips/diseño alineados | 3/3 nombres coherentes con el placeholder | 2/3 (ab_2 ShadowStep ≠ Paw Stomp) | **Kurama** |
| Riesgo de abrir melón | Muy bajo — solo tuning numérico | Alto — el mismatch ShadowStep no se puede resolver sin reescribir el kit o clip | **Kurama** |
| Impacto visual (identidad distintiva) | Alta — Trickster con 9 colas, dash ágil | Alta — Assassin felino | Empate |
| Diferenciación vs Sergei/Trunk | Trickster vs Balanced/Bruiser — tercera arquetipo | Assassin — también distinto | Empate |

Elijo **Kurama** por **menor riesgo, cero overrides, tuning limpio**.
Cheeto iría después — cuando tengamos más confianza en el patrón +
posiblemente el kit definitivo del Assassin habiendo resuelto el
problema de ShadowStep ≠ Paw Stomp (o decidido que ShadowStep se
queda como K real).

Receta para Kurama feel pass:
1. Smoke test en `/anim-lab.html` ya hecho (✅ sano, sin overrides).
2. Medir clips: `node scripts/inspect-clips.mjs public/models/critters/kurama.glb`.
3. Alinear `duration` / `windUp` / `cooldown` + `clipPlaybackRate`
   siguiendo patrón Sergei/Trunk. Identidad Trickster: speed alta
   (ya 15.6), mass baja (0.8), dashes cortos pero numerosos.
4. VFX: reusar shockwave ring con colores/tamaño coherentes con
   identidad kitsune (sin nuevo código).
5. Documentar en `CHARACTER_DESIGN.md §"Feel pass log"`.

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
