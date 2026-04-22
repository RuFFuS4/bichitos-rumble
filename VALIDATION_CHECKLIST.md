# Validation Checklist — Bichitos Rumble

Doc vivo. Aquí se consolidan **todas las pruebas manuales pendientes**
que no pude automatizar desde aquí (requieren navegador, mando físico,
partidas reales con varios clientes, archivos reales, etc).

Orden de los bloques = orden recomendado para hacer el batch. Cada
bloque se puede probar independientemente.

Última actualización: 2026-04-20 (Blender MCP activo + Sergei primer rig).

---

## 0 · Pre-flight

- [ ] `git pull` de `main` local (o usar directo producción
      [bichitosrumble.com](https://www.bichitosrumble.com)).
- [ ] `npm install` si toca.
- [ ] `npm run dev` levanta sin errores en http://localhost:5173.

---

## 1 · Input: Gamepad (Xbox / PS / W3C standard)

Mando físico con perfil estándar de la Gamepad API.

- [ ] Enchufar → toast `🎮 <id del mando>` abajo derecha durante ~2s.
- [ ] Título: stick izq o D-Pad navega entre "vs Bots" y "Online". A confirma.
- [ ] Character select: stick / D-Pad izquierda-derecha cambia crítter. A confirma.
- [ ] En partida: stick izq mueve (con deadzone radial, sin drift).
- [ ] A = headbutt · X = ability J · Y = ability K · RB = ultimate L.
- [ ] Start = restart al terminar.
- [ ] Desenchufar → toast "Gamepad disconnected" + el crítter para (no queda moviéndose).
- [ ] En `/tools.html` → grupo OBSERVE → panel Input: ejes + botones live.

---

## 2 · Arena: shake + rumble (sustituye red blink)

- [ ] Arranca una partida contra bots (offline) o online con bots de relleno.
- [ ] Tras ~20s, el primer batch de fragments entra en warning:
  - [ ] Tiemblan en el sitio (movimiento pseudo-aleatorio XZ, ~8 cm, fase
        distinta por fragmento — NO sincronizados).
  - [ ] Emissive naranja cálido crece de 0 a ~65% durante los 3s.
  - [ ] Suena rumble (sub + ruido filtrado + 3 "cracks" aleatorios).
- [ ] **Crítico**: puedes caminar encima del fragment temblando sin caer.
      El shake es solo visual.
- [ ] El color base verde del fragment NO se sustituye por rojo (solo se
      le suma el glow).
- [ ] Al cumplirse los 3s, los fragments caen limpios (sin offset raro).
- [ ] En Pattern B (axis-split) verás medio arena temblando a la vez.
- [ ] Forzar seeds con `/tools.html` (Arena panel → Force Seed) para
      reproducir el mismo comportamiento.

---

## 3 · Respawn fix (zonas sin suelo)

- [ ] Fuerza una seed pattern B (axis-split) desde `/tools.html`.
- [ ] Juega hasta que colapse el primer lado. Intenta caer deliberadamente
      estando cerca del borde del lado colapsado.
- [ ] Al respawnear: el bichito NO aparece en el vacío. Aparece en tierra
      firme o, como fallback, en el centro (islote inmune).
- [ ] Repetir con bots en aggressive behaviour para forzar caídas rápidas.
- [ ] En online: igual que offline (mismo `pickRespawnPos` en server).

---

## 4 · Online 4P + bot-fill + waiting UX

Necesita 2-4 browsers abiertos contra el server (Railway) o local.

### 4.1 Solo 1 humano en sala
- [ ] Click "Online Multiplayer". Llegas al waiting screen.
- [ ] Contador bajando desde 60s visible, grande.
- [ ] Los 3 slots restantes muestran borde pulsante amarillo-gris, spinner
      conic girando en el avatar, "Open" con puntos animados.
- [ ] A los 10s restantes el contador pulsa (clase `urgent`).
- [ ] A 0s se añaden 3 bots. Sus slots pasan de `empty` a `bot` (avatar
      con thumbnail del crítter + badge 🤖 BOT).
- [ ] Arranca countdown → playing normal. Los bots persiguen + HB + abilities.

### 4.2 4 humanos → instant start
- [ ] 4 browsers, cada uno click "Online Multiplayer".
- [ ] Cuando entra el 4º, el countdown arranca **inmediato**, no espera.

### 4.3 Bot-takeover al desconectarse
- [ ] 2 humanos + 2 bots en match.
- [ ] Cerrar uno de los browsers.
- [ ] El crítter del que se fue sigue vivo en la arena, ahora con 🤖 en
      el HUD de vidas.
- [ ] El bot que ha tomado se comporta (chase + HB).

### 4.4 Victoria por abandono
- [ ] 2 humanos, uno cierra. El otro ve end-screen tipo "opponent_left /
      You won by default".

### 4.5 T para salir del waiting room
- [ ] En waiting screen pulsas T (keyboard) o B (gamepad) → vuelves al
      título. El overlay de waiting se oculta limpio. Puedes clicar
      "vs Bots" u "Online" de nuevo (antes se quedaba bloqueado).

### 4.6 Spectator prompt al morir mid-match online
- [ ] En un match online, muere tu crítter (0 vidas).
- [ ] En el centro-bajo aparece la pill: `💀 You're out · Press T to leave`.
- [ ] Pulsa T → vuelves a título sin esperar a que acabe el match.

### 4.7 End-screen distingue bot vs humano
- [ ] Gana un bot → subtítulo dice "Bot <NombreCrítter> won".
- [ ] Gana un humano → "<NombreCrítter> won".
- [ ] Ganas tú → "You won".

---

## 5 · Stats en end-screen

- [ ] Juega una partida completa (offline o online).
- [ ] Al terminar, en el end-screen (entre subtítulo y prompts) ves 4
      counters en fila: `Headbutts · Abilities · Falls · Respawns`.
- [ ] Los números corresponden a tu partida actual (no acumulados).
- [ ] Reinicias (R) y empiezas otra → los counters salen a 0.
- [ ] En online se comportan igual que offline.

---

## 6 · Audio: crossfade suave

- [ ] Arranca una partida contra bots.
- [ ] Transición de `intro` (menú) → `ingame` (countdown): no suena "doble
      track overlapped fuerte". La mezcla queda limpia.
- [ ] Ganas → transición a `special` suave, sin click audible.
- [ ] Pierdes → vuelve a `intro`, también limpio.
- [ ] Mutas con 🎶 → corta sin cola.
- [ ] Mutas con 🔊 (SFX) → no afecta a la música (bus independiente).
- [ ] Abre `/tools.html` antes de que cargue música → 🔊 / 🎶 visibles
      arriba derecha desde el título, ANTES de entrar al match.

---

## 7 · Bots panel dropdowns (fix de hace varias sesiones)

- [ ] Abre `/tools.html`. Arranca un match (Matchup → Start Match).
- [ ] En el panel Bots, cada fila tiene un dropdown individual.
- [ ] Click en un dropdown → **se abre** (esto antes no funcionaba).
- [ ] Selecciona "aggressive" → ese bot cambia de comportamiento live.
- [ ] "All bots" (bulk) sigue funcionando.

---

## 8 · Match recorder (export JSON + MD)

- [ ] En `/tools.html`, juega una partida corta (que termine rápido).
- [ ] En el panel Recording (grupo OBSERVE):
  - [ ] `status` pasa de "RECORDING" a "closed" al terminar.
  - [ ] `outcome` muestra "<survivor> (last_standing / match_timeout)".
  - [ ] `duration`, `events`, `actions`, `samples` son números > 0.
- [ ] Click "Download JSON". Abre el archivo descargado:
  - [ ] Es un JSON válido con `meta`, `events`, `actions`, `snapshots`,
        `outcome`.
  - [ ] `meta.endedAtIso` NO está vacío (antes era `(still recording)`).
- [ ] Click "Download MD". Abre el archivo:
  - [ ] Lee las tablas (events summary, per-critter stats, arena timeline).

---

## 9 · Skeletal animations por crítter (validación progresiva)

Estado actual del roster — 8 estados skeletal target por bichito
(`idle`, `run`, `ability_1`, `ability_2`, `ability_3`, `victory`,
`defeat`, `fall`). Los demás estados son procedurales por política
(ver `SUBMISSION_CHECKLIST.md`).

| Bichito    | Cobertura | Notas                                         |
|------------|-----------|-----------------------------------------------|
| Cheeto     | 8 / 8     | Tripo Animate, full kit                       |
| Kermit     | 7 / 8     | ab_3 Hypnosapo = flicker procedural (sin clip)|
| Kowalski   | 8 / 8     | Tripo Animate, full kit (Ice Slide/Snowball/Ice Age) |
| Trunk      | 8 / 8     | Tripo Animate, full kit (Ram/Grip/Ground Pound) |
| Shelly     | 6 / 8     | Tripo Animate, idle/run/ULTI MegaShell/vic/def/fall. Ab_1 Shell Charge + Ab_2 Shell Shield procedurales (spin + hide limbs via bones) |
| Kurama     | 8 / 8     | **Meshy AI** (primer import via-gltfpack), full kit (Fox Dash/Mirror Trick/Copycat ULTI). 14 MB (meshopt-compressed) |
| Sebastian  | 6 / 8     | **Meshy AI** via-gltfpack. Ab_1 Claw Rush + ULTI Crab Slash procedurales (dash lateral + glbMesh.scale.z stretch). 15 MB |
| Sergei     | 1 / 8     | solo Idle                                     |
| Sihans     | 0 / 8     | pendiente Meshy/Tripo                         |

### 9.1 Por cada bichito animado — checklist común

Para Cheeto y Kermit hoy (y cada bichito nuevo conforme entre):

- [ ] Consola al cargar el juego con ese crítter:
      `[Critter] skeletal animator attached: <Name> | clips: Idle, Run, ...`
- [ ] Character select: el crítter respira con su clip de `Idle` (no con
      el bob procedural genérico).
- [ ] En partida: al moverte cicla `Run`; al pararte vuelve a `Idle`.
- [ ] Al ejecutar `J` (ability_1) se reproduce el clip correspondiente.
- [ ] Al ejecutar `K` (ability_2) se reproduce el clip correspondiente.
- [ ] Al ejecutar `L` (ability_3 / ULTI) se reproduce su clip — **excepto
      Kermit**, que usa el efecto emissivo Hypnosapo (procedural).
- [ ] Al ganar → `Victory` se queda en la pose final.
- [ ] Al perder → `Defeat` se queda en la pose final.
- [ ] Al caer al vacío → `Fall` mientras dura la animación de caída.
- [ ] Headbutt y hit siguen siendo procedurales (squash/stretch + tilt).
- [ ] Console **NO** muestra `[SkeletalAnimator] dropped N static` para
      ese crítter (indica clips muertos → hay que reimportar).

### 9.2 Si un clip no se reproduce

1. `node scripts/verify-critter-glbs.mjs public/models/critters/<id>.glb`
   → mira qué estados quedan sin resolver.
2. Si es un clip esperado, revisa el mapping en
   `scripts/mappings/<id>.json` y re-importa con
   `node scripts/import-critter.mjs <id> <source.glb>`.
3. Si el nombre del clip es raro, amplía keywords en
   `STATE_KEYWORDS` (`src/critter-skeletal.ts`) o renombra en el mapping.

---

## 10 · /animations (Mesh2Motion integrated)

### 10.1 La página carga correctamente
- [ ] `https://www.bichitosrumble.com/animations` carga **el flow de
      trabajo** (no la página Explore/marketing). El centro de la pantalla
      muestra el roster picker + el tool panel de mesh2motion.
- [ ] Banner rojo arriba: `🎬 Bichitos Rumble · Animation Lab · INTERNAL`
      con link "← back to game".
- [ ] Título del tab: "Bichitos Rumble — Animation Lab (internal)".
- [ ] View source → `<meta name="robots" content="noindex, nofollow">`.

### 10.2 UI limpiada (no hay elementos upstream visibles)
- [ ] Arriba en el nav NO ves "Explore / Use Your Model / Use Your
      Rigged Model / Learn / Contributors / 💗 / GitHub".
- [ ] Sí ves el pseudo-heading amarillo: `🎬 Animation Lab —
      exclusive for Bichitos Rumble`.
- [ ] Sí ves el botón de ⚙️ Settings a la derecha (theme + luz).
- [ ] En el tool panel NO ves el botón "Upload".
- [ ] NO ves el dropdown "Reference model" con Human/Fox/Bird/Dragon/Kaiju.

### 10.3 Roster picker funcional
- [ ] Ves el panel "Choose a critter" con 9 cards (Sergei, Kurama,
      Cheeto, Kowalski, Trunk, Sebastian, Shelly, Kermit, Sihans).
- [ ] Cada card muestra: dot de color + nombre + flecha + rig sugerido
      (ej. "→ human").
- [ ] Tooltip al hover de cada card explica la razón del rig.
- [ ] Click en Sergei → el GLB carga. La card queda resaltada con glow
      amarillo (`is-active`).
- [ ] Cuando mesh2motion llega al paso Skeleton, el dropdown
      `#skeleton-selection` está preseleccionado al rig correcto (human).

### 10.4 Flow completo del export
- [ ] Ajustas el skeleton dentro del mesh.
- [ ] Eliges animaciones del panel derecho.
- [ ] Click en "Download" (el botón con el contador de seleccionadas).
- [ ] El archivo descargado se llama **`sergei.glb`** (no
      `exported_model.glb`).
- [ ] Aparece un toast amarillo abajo centro diciendo:
      `Sergei exported. Save this file as public/models/critters/sergei.glb
       in the game repo.`
- [ ] El toast auto-oculta a los 6s.

### 10.5 Integración con el juego
- [ ] Sustituyes `public/models/critters/sergei.glb` con el exportado.
- [ ] Reinicias `npm run dev`.
- [ ] La consola del navegador dice
      `[Critter] skeletal animator attached: Sergei | clips: ...`
- [ ] En el juego, Sergei usa los clips (idle/run/etc).
- [ ] En `/tools.html` → OBSERVE → Skeletal clips, los clips aparecen
      listados con su state resuelto.

### 10.6 Discoverability
- [ ] En `/tools.html` sidebar footer hay un enlace
      `🎬 /animations (mesh2motion-based animation lab)`.
- [ ] En `/animations`, el link "← back to game" en el banner rojo
      vuelve al juego.

---

## 11 · Gameplay en offline (regresión del core)

Nada aquí debería haber cambiado, pero es bueno confirmar que ninguna
feature nueva ha roto el path principal.

- [ ] Title → "vs Bots" → character select → Sergei → match.
- [ ] WASD se mueve, SPACE headbutt, J/K abilities, L ultimate si aplica.
- [ ] R reinicia al terminar. T vuelve a título.
- [ ] Arena colapsa correctamente (con el shake nuevo).
- [ ] Ganas / pierdes, ves stats.

---

## 12 · Settings persistence

- [ ] Mutea SFX y música con los botones 🔊 / 🎶.
- [ ] Recarga la página → ambos siguen muteados.
- [ ] Reactiva, recarga → vuelven activos.

---

## 13 · Portals (Vibe Jam)

Si hay tiempo, revisar que la integración sigue funcionando.

- [ ] En partida, pulsa P → portales se expanden.
- [ ] Camina hacia el verde (exit portal) → redirige a vibej.am/portal/2026
      con params del player.
- [ ] Entrada por `?portal=true&ref=...` → salta title/select, entra
      directo a match, portal naranja (return) disponible.
- [ ] End-screen con portales: P = next game, B = return to previous.

### 13.1 Warp transition (2026-04-22)

El redirect del portal ya no es un hard-cut — corre un overlay warp
de ~700 ms con el color del portal antes de navegar.

- [ ] Cruzar el portal verde (exit): pantalla muestra **radial burst
      verde** desde el centro, zoom + blur, canvas del juego se lava
      (satura + desatura + blur). A los ~650 ms navega a vibej.am.
- [ ] Cruzar el portal naranja (return): misma transición pero en
      **naranja**, redirige al `?ref=` original.
- [ ] El overlay NO bloquea clicks del HUD antes de dispararse
      (`pointer-events: none`).
- [ ] Si se cruza por accidente durante un knockback con portales
      minimizados (< 0.7 expansion), **no pasa nada** — el trigger
      solo se arma con `isUsable = true`.

---

## 14 · Blender MCP — Sergei rigged (pendiente validación ingame)

Estado al cierre 2026-04-20: Sergei re-exportado con armature desde
Blender vía MCP. El GLB pesa 1.06 MB (antes 434 KB). No tiene clips
todavía — sólo skeleton + weights. Validación manual que falta:

### 14.1 Render en character select

- [ ] `npm run dev` arranca sin errores.
- [ ] Character select carga, Sergei visible en la tercera card.
- [ ] Al seleccionar Sergei, el preview rota sin deformarse. **Crítico**:
      el mesh debe seguir a la rotación del carrusel (bug previo: la
      malla se quedaba estática en el origen mientras el group rotaba).
- [ ] Silueta de Sergei en el podio es comparable en tamaño a los
      demás críters (el bump `scale 2.0 → 2.3` + `pivotY 1.0` debería
      igualar las sombras al suelo).
- [ ] Los pies no flotan ni se clipean bajo el podio.

### 14.2 Render en partida

- [ ] "vs Bots" → Sergei → arena carga.
- [ ] Sergei idle: respira con el bob procedural (`critter-animation.ts`).
      No debería haber clip skeletal (aún no hay).
- [ ] Sergei corre: movimiento, lean, sway — procedural layer intacto.
- [ ] Headbutt: anticipación + lunge procedural.
- [ ] Abilities J/K/L (Gorilla Rush / Shockwave / Frenzy): ejecutan
      sin deformaciones extrañas.
- [ ] Caída al vacío + respawn OK.

### 14.3 Consola

- [ ] **NO** debe aparecer
      `[Critter] skeletal animator attached: Sergei | clips: ...` —
      no hemos metido clips todavía. Si aparece, el GLB incluyó
      animaciones por accidente o el loader detectó basura.
- [ ] **Sí** puede aparecer el log normal de `GLTFLoader` de Three
      indicando que cargó animaciones = 0.
- [ ] **Cero** errores rojos relacionados con `SkinnedMesh`,
      `SkeletonUtils`, `bones`, `weights`.

### 14.4 Verifier audit

- [ ] `node tools/verify-critter-glbs.mjs` (o `npm run verify:glbs`
      si existe) termina sin errores críticos sobre `sergei.glb`.
- [ ] Reporte muestra skinned mesh presente + bone count > 0.

### 14.5 Regresión de otros críters

Los 8 críters restantes (Kurama, Trunk, Shelly, Kermit, Sihans,
Kowalski, Cheeto, Sebastian) siguen sin rig. El fix de
`SkeletonUtils` en `model-loader.ts` no debería afectarles porque
el `source.traverse` detecta ausencia de `SkinnedMesh` y usa el
clone plain. Verificar:

- [ ] Seleccionar cada uno de los 8 restantes en character select →
      rota correctamente (igual que antes del cambio).
- [ ] Al menos 2 críters no-Sergei jugados ingame: todo normal.

### 14.6 Próximo paso si 14.1–14.5 pasa

Añadir primer clip (idle) al GLB de Sergei. Opciones:
1. Bajar idle humanoide de Mixamo → importar en Blender → retarget
   al armature actual → export.
2. Claude + bpy genera keyframes idle sintéticos.

Tras añadir clip, repetir esta sección — esta vez SÍ debe salir
el log `skeletal animator attached: Sergei | clips: idle` y el
panel Skeletal clips del lab debe listarlo.

### 14.7 Pose state limpio (importante post-cleanup 2026-04-20)

Sergei.glb ya pasó por la limpieza de pose state. Verificar que sigue
limpio:

- [ ] Cargar `public/models/critters/sergei.glb` en Blender:
      `File > Import > glTF 2.0` (o open the .blend si lo tienes).
- [ ] Modo Object, frame 0, sin action activa: el mesh debe verse
      en T-pose limpio (cuerpo vertical, brazos horizontales).
      NO debe verse acuclillado / hunched.
- [ ] Edit Mode → Pose Mode: ambos deben coincidir
      (rest pose == pose state).
- [ ] Si se ve torcido, correr `tools/blender-mcp/critter-cleanup.py`
      con `CRITTER_ID = "sergei"`.

### 14.8 Filtro runtime defensivo

Aunque el GLB esté limpio, el filtro de `SkeletalAnimator` debe seguir
operativo para futuros crítters. Verificar:

- [ ] Console del navegador en partida con cualquier crítter:
      NO debe haber log `[SkeletalAnimator] dropped N static`
      (ni para Sergei ni para los demás).
- [ ] Si en algún crítter futuro aparece, indica que su GLB tiene
      placeholders y hay que correr `critter-cleanup.py` para
      limpiar el source.

---

## 15 · Title screen polish (2026-04-21)

Tres cambios visibles al cargar la web:

### 15.1 Firma `@RGomezR14`
- [ ] Visible en la esquina inferior-izquierda de la pantalla de
      título. Debe verse como un pill con fondo semi-transparente y
      borde dorado sutil (no como texto plano casi-invisible).
- [ ] El handle `@RGomezR14` aparece destacado en **dorado sólido**.
- [ ] Hover: eleva 2px, borde dorado brillante, handle pasa a blanco.
- [ ] Click abre `x.com/RGomezR14` en pestaña nueva.

### 15.2 Controles en la pantalla de título
- [ ] Bajo los botones de modo se ve una fila de bindings con
      `<kbd>` pills (WASD move · SPACE headbutt · J K abilities ·
      L ultimate · R restart). Cada tecla en su propia pill dorada.
- [ ] Debajo de esa fila, en tipo más chico, aparece una línea
      `🎮 Gamepad auto-detected — left stick · A headbutt · X/Y
      abilities · RB ultimate`.
- [ ] En touch mode (móvil): solo ves "Joystick to move · on-screen
      buttons for headbutt, abilities and ultimate".

### 15.3 Responsive breakpoints nuevos
Probar que el title + character-select no rompen en:
- [ ] Desktop 1080p (baseline): layout horizontal intacto.
- [ ] Tablet landscape ~900×600: stacks funcionan, controles legibles.
- [ ] Phone landscape ~820×390: character-select stackea vertical,
      controles-hint no se sale, título + botones caben.
- [ ] Phone landscape ~520×360: versión comprimida, nada overflow.

---

## 16 · Social card OG (2026-04-21)

Pegado: `public/og-image.png` — 1200×628, top-anchored. Validar
cuando la URL deploye en Vercel (dev preview o prod).

- [ ] Pegar la URL del juego (`bichitosrumble.com` o el preview de
      Vercel) en [cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator).
      Debe renderizar la card con el título "Bichitos Rumble", la
      descripción y la imagen hero. Cover amarillo legible.
- [ ] Pegar la misma URL en un chat de Discord — el embed debe
      mostrar la imagen + título + descripción.
- [ ] Si el crop no convence, regenerar con
      `npm run og -- <source> --position centre` (o `bottom`/`left`/etc.)
      y redeploy. X cachea la card hasta 7 días: para forzar refresh,
      bumpear el query param en `index.html` (`og-image.png?v=2`).

---

## 17 · Character-select preview polish (2026-04-21)

Dos issues reportados + arreglados. Validar:

### 17.1 No double bob en críttrs con Idle skeletal
- [ ] Seleccionar **Cheeto**: el critter respira con el clip Idle.
      NO se ve como si saltara en el sitio (antes: procedural bob
      + clip bob se doblaban).
- [ ] Lo mismo con **Kermit**, **Kowalski**, **Trunk**, **Sergei**.
- [ ] Críttrs sin skeletal (Kurama, Sebastian, Shelly, Sihans):
      mantienen su bob procedural normal, no parecen congelados.

### 17.2 Modelo + pedestal más prominente
- [ ] Canvas del preview visiblemente más grande (antes 320×280,
      ahora 380×340).
- [ ] Pedestal más alto + más ancho, con **rim dorado** en el borde
      superior, glow suave en el suelo detrás.
- [ ] Tres puntos de luz (key cálida + rim fría + fill desde abajo) —
      el chin del bichito no queda en sombra total.
- [ ] Halo radial dorado suave detrás del canvas (CSS ::before), el
      modelo no flota en un campo oscuro.
- [ ] Drag-to-rotate sigue funcionando (hover cursor grab, pointer
      capture al arrastrar).

---

## 18 · End-screen stats polish (2026-04-21)

Bloque de contadores de partida reestilizado.

- [ ] Jugar una partida completa offline. En el end-screen ver 4 stats
      en fila: **⚡ Headbutts · ✨ Abilities · 💀 Falls · 🔁 Respawns**.
- [ ] Cada stat tiene ICONO ARRIBA + VALOR grande dorado + LABEL
      pequeño en mayúsculas debajo.
- [ ] Al aparecer el end-screen los números **cuentan desde 0**
      hasta su valor final en ~700 ms (easeOutCubic). No saltan al
      valor directo.
- [ ] El panel entero **se desliza hacia arriba + fade** durante la
      aparición (350 ms).
- [ ] Separadores verticales sutiles entre stats, borde dorado tenue
      en el panel, glow dorado en los valores.
- [ ] Funciona igual en partidas online (BrawlRoom end callback).

---

## 19 · Dev tooling nuevo (2026-04-21)

Solo para tu verificación cuando toque. No gameplay:

- [ ] `npm run verify:glbs` — lista los 9 GLBs con clips resolved
      contra los **8 estados target** (política post-2026-04-22).
      Pasa `--all-states` para el scan legacy de 13 estados.
- [ ] `npm run inspect:clips public/models/critters/<id>.glb` —
      reporta per-clip (duración, channels, alive, max_var, verdict).
- [ ] `npm run import:critter <id> <source.glb>` — import via
      `scripts/mappings/<id>.json` si existe, o `--map` inline.
- [ ] `npm run og -- <source>` — genera `public/og-image.png`
      1200×628 (flags `--position` y `--fit` disponibles).
- [ ] `npm run compress:audio` — re-encoda MP3s de `public/audio/`
      con ffmpeg-static. Por defecto VBR 4 (~128 kbps); `--quality 5..7`
      para ahorrar más si la pérdida audible no molesta. `--dry-run`
      muestra plan.
- [ ] `npm run test:smoke` — Playwright chromium headless, recorre
      title → vs Bots → match starts en ~15 s. Primera vez:
      `npx playwright install chromium` (~120 MB, one-off).
- [ ] `npm run check` — `tsc + verify:glbs + build` todo seguido.
      Gate obvio antes de merge `dev → main`.

---

## 21 · Badges — WWE-belt achievement system (Phase 3+4)

Scaffolding completo sin Phase 5 (arte real). Los iconos son emojis
placeholder hasta que lleguen las PNGs finales.

### 21.1 End-screen toast (Phase 3)
- [ ] Juega una partida offline hasta ganar. Al llegar al end-screen,
      si desbloqueaste badges, aparece un toast arriba-centro con:
      icono placeholder + "NEW BELT UNLOCKED" + nombre + descripción.
- [ ] El toast tiene entrada animada (slide + scale pulse), shine
      sweep dorado y se auto-dismisea tras 6 s.
- [ ] Click sobre el toast lo cierra antes del auto-dismiss.
- [ ] Tras cerrarse, `localStorage.getItem('br-stats-v2')` ya NO tiene
      `recentlyUnlocked` (debería ser `null`).
- [ ] Si sigues ganando partidas y NO hay nuevos unlocks, el toast
      NO aparece (silencio correcto).

### 21.2 Hall of Belts (Phase 4 light)
- [ ] En character-select, arriba-derecha hay un botón pill **🏆 Belts**.
      Click (o tecla **B**) abre el modal.
- [ ] El modal muestra los 16 belts en grid (desktop: 4 columnas; tablet:
      3 columnas; móvil: 2 columnas).
- [ ] Belts **desbloqueados** en amarillo/dorado con icono a color.
      Belts **bloqueados** en gris con candado 🔒.
- [ ] Hover sobre cada slot muestra tooltip nativo (desktop) con
      nombre + descripción. En touch, la descripción ya está debajo
      del nombre siempre visible.
- [ ] Arriba del grid: contador `X / 16 UNLOCKED`.
- [ ] Cerrar con: **Esc**, **B**, click en el ✕, o click en el
      backdrop semi-transparente.
- [ ] Al reabrir tras ganar una partida nueva, los counters y
      unlocks reflejan el cambio (no queda cacheado).

### 21.3 Test de condiciones (manual, localStorage editor)
Ruta rápida sin jugar 20 partidas:

1. DevTools → Application → localStorage → key `br-stats-v2`.
2. Edit el JSON — p.ej. set `totalWins: 20` y cualquier bichito con
   `wins: 5`.
3. Recarga y juega 1 partida completa ganando: los badges que
   cumplan condición quedarán en `unlockedBadges` + toast el último.

### 21.4 Migración v1 → v2
- [ ] Si tienes un `br-stats-v1` en localStorage (usuario pre-2026-04-22),
      al cargar el juego los contadores v1 migran a v2 sin pérdida.
      Verificable limpiando v2 primero: `localStorage.removeItem(
      'br-stats-v2')` y recargando — los picks/wins viejos siguen
      visibles en la UI de stats del end-screen.

### 21.5 Badges en modo online
- [ ] Ganar una partida en Online Multiplayer (puede ser contra bots
      de bot-fill tras el waiting timer). Consola debe mostrar
      `[Badges] unlocked (online): <ids>` si cumpliste condiciones.
- [ ] El toast aparece en el end-screen online, igual que offline.
- [ ] Los contadores que requieren timing (Speedrun Belt) usan la
      ventana `serverPhase transitioned to 'playing'` → `'ended'`
      — no cuentan el tiempo de waiting ni de countdown.

### 21.6 Lab panel — trigger + reset
- [ ] `/tools.html` → Tuning → **Badges** (colapsado por defecto).
      Aparece la lista de 16 badges con columna `Lock/Unlock` en
      cada fila + contador `X / 16 unlocked` arriba.
- [ ] Botón `Trigger toast demo` dispara el toast con el primer
      badge locked. Usa el mismo code path que producción.
- [ ] `Unlock all` → los 16 se marcan unlocked en la lista. Hall of
      Belts al abrirlo muestra los 16 desbloqueados.
- [ ] `Lock all (reload)` → recarga la página, los 16 quedan locked.
- [ ] `Clear ALL stats (reload)` → confirm() dialog, y al aceptar
      recarga con localStorage de stats limpio (picks + wins + badges
      a 0).

### 21.7 Pain Tolerance — verificación del fix
Regresión cubierta tras el fix 2026-04-23:
- [ ] Jugar varias partidas **ganando cada una** mientras acumulas
      headbutts recibidos. A los 10+ totales la consola debe mostrar
      `[Badges] unlocked: pain-tolerance`.
- [ ] Verificable en DevTools:
      `JSON.parse(localStorage['br-stats-v2']).byCritter.<name>.hitsReceived`
      crece tras cada win. Antes del fix se quedaba en 0 para siempre.

---

## 22 · Parts inspector (2026-04-22)

- [ ] `npm run inspect:parts` lista mesh + node names de los 9 GLBs.
      El reporte debe mostrar:
  - Cheeto / Kowalski / Trunk con meshes segmentados
    (`Mesh_0.001`..`Mesh_N.001`) — la segmentación sobrevivió al
    export de Tripo Animate.
  - Kurama / Sebastian / Shelly / Sihans / Sergei / Kermit con mesh
    único mergeado (`<id>_Mesh_Data`).
  - Bones con nombres semánticos (`Head`, `L_Hand`, etc.) en todos.
  - Sebastian con bones crab-específicos (`L_Claw`, `R_Leg1..4`, …).
- [ ] `PROCEDURAL_PARTS.md` documenta qué se puede manipular por
      crítter cuando toque abrir signature abilities.
- [ ] `/tools.html` → Tuning → **Critter parts** (colapsado).
      Seleccionar un crítter (start match first) → aparece la lista
      de bones con slider (0.01..1.5). Arrastrar `Head` a 0.01 de
      Shelly → la cabeza "desaparece" dentro del caparazón. `Reset
      bones` → vuelve al estado original.

---

## 23 · Visual polish pass (2026-04-23)

Los cambios cosméticos / presentación de la sesión 2026-04-23.
Pruebas rápidas de una pasada al final del QA.

### 23.1 Favicon
- [ ] La pestaña del navegador muestra el SVG (chibi en chip navy
      con gradient gold→red, speed lines). NO el default blanco de
      Vite.
- [ ] En Safari < 18 (fallback): la pestaña se ve sin favicon pero
      la página carga sin errores de consola (`favicon.svg` devuelve
      200 OK).

### 23.2 Countdown 3-2-1 con gradiente
- [ ] Arrancar una partida offline. El overlay `3` aparece con
      gradiente rojo pop → `2` ámbar → `1` amarillo → `GO!` verde
      con radial burst tras el 1.
- [ ] Los dígitos se dimensionan con `clamp(140px, 22vw, 260px)`.
      Visibles en desktop + tablet landscape sin overflow.
- [ ] La animación `pop` (scale-down + slight overshoot) se dispara
      cada vez que cambia el dígito, no cuando el DOM se setea al
      mismo valor.

### 23.3 Drop-from-sky + dust puff
- [ ] Al pasar `Get Ready!` → `3`, los críters empiezan elevados
      a 12-15 unidades del suelo y caen con gravedad.
- [ ] Cada crítter al tocar suelo (y=0) dispara un **dust puff**
      (ring dorado expansivo) + un thud (SFX `headbuttHit`). Los
      tiempos de landing están staggered (~1 s tras el countdown).
- [ ] Al llegar a `GO!`, todos ya están en suelo. Ninguno queda
      flotando (safety snap a y=0 en la transición).

### 23.4 Skydome + sensación de plataforma flotando
- [ ] El fondo ingame es una gradiente vertical (cielo alto cyan →
      medio más claro → horizonte cálido → dusk-blue abajo). NO el
      flat dark blue anterior.
- [ ] Las nubes distantes (disco plano) se ven debajo de la arena al
      cámara normal. Contribuyen al efecto "altura".
- [ ] Iluminación: hemisphere + key cálido + rim azul. Los críters
      tienen tono cyan arriba y tono cálido abajo (no un single
      directional flat).

### 23.5 Fragmentos caen al vacío
- [ ] Cuando un batch colapsa (offline + online) los fragmentos caen
      con gravedad + rotación. Desaparecen al pasar y=-25.
- [ ] Mientras caen, el player puede caminar por encima de fragmentos
      vivos (los que no están en caída) sin colisión fantasma.
- [ ] Nada queda flotando tras un reset de seed. `buildFromSeed`
      limpia el pool de `fallingFragments`.

### 23.6 Resource preloads
- [ ] Network tab: al primer load aparecen las 9 entries de
      `/models/critters/<id>.glb` como `prefetch` (low priority) y
      `/audio/intro.mp3` como `preload` (high priority).
- [ ] La música `intro` arranca sin gap perceptible al primer clic
      en "vs Bots" (vs 200-400ms de gap antes del preload).
- [ ] El primer match arranca sin el "loading critter X…" porque
      los GLBs ya están en caché (network tab muestra `from prefetch
      cache`).

### 23.7 Lab P/W/S read-only
- [ ] `/tools.html` → Tuning → **P/W/S stats**. Tabla de 9 filas
      + header. Cada fila muestra nombre, (P, W, S) con colores
      (verde +, rojo -, gris 0), y las columnas `spd / mass / hb`
      derivadas.
- [ ] Sergei en (0, 0, 0) → 13.0 / 1.00 / 14.
- [ ] Sebastian en (2, -2, 1) → 15.5 / 0.60 / 18.
- [ ] Shelly en (0, 2, -2) → 8.0 / 1.40 / 14.

---

## Cosas que NO están validables todavía

Estas están implementadas pero requieren contenido que aún no tenemos:

- **Clips skeletal de crítters específicos** — depende de que generes
  los GLBs con Mesh2Motion / Tripo Animate. Entonces aplica punto 9.
- **Signature abilities** (Trunk Grip, Shell Shield, Shadow Step…) —
  aún no implementadas. Se implementarán en el bloque de Fase 3 con
  sync cliente+server dedicado.
- **Lighthouse performance score** — tarea de Fase 4, antes del freeze.
- **Cross-device playtest** — sesión dedicada en los últimos días.

---

## Cómo reportar problemas

Si algo falla durante la validación:

1. **Screenshot / vídeo corto** si es visual.
2. **Consola del browser** (F12 → Console) — copiar logs relevantes,
   especialmente errores rojos.
3. **Si es de gameplay**, en `/tools.html` usa el recorder (Download
   JSON) para capturar la partida completa.
4. **Paso a paso para reproducir** — muy importante.

Me lo pasas y lo ataco con datos.
