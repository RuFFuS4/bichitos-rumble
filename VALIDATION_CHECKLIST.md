# Validation Checklist — Bichitos Rumble

Doc vivo. Aquí se consolidan **todas las pruebas manuales pendientes**
que no pude automatizar desde aquí (requieren navegador, mando físico,
partidas reales con varios clientes, archivos reales, etc).

Orden de los bloques = orden recomendado para hacer el batch. Cada
bloque se puede probar independientemente.

Última actualización: 2026-04-19 (tras integración Mesh2Motion).

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

## 9 · Skeletal animation loader (cuando llegue el primer GLB animado)

**Requisito**: primer GLB animado desde `/animations` (o Mixamo/Tripo)
reemplazando `public/models/critters/<id>.glb`.

- [ ] Recarga el juego. Consola debería decir:
      `[Critter] skeletal animator attached: <Name> | clips: Idle, Running, Victory, ...`
- [ ] Character select: el crítter respira con el clip de idle (no el
      bob procedural simple).
- [ ] En partida: mueves y ves el clip de run ciclar. Paras → idle.
- [ ] Haces headbutt → si hay clip `lunge` / `punch` / `attack` se
      reproduce.
- [ ] Ganas → clip `victory` se reproduce y se queda en la pose final.
- [ ] Pierdes → clip `defeat` / `death` se queda en la pose final.
- [ ] Falls → clip `fall` si existe.

**Si el clip no se reproduce**: revisa el mapping
`STATE_KEYWORDS` en `src/critter-skeletal.ts`. Posible que el nombre
del clip no caiga en ningún keyword.

---

## 10 · /animations (Mesh2Motion integrated)

- [ ] `https://www.bichitosrumble.com/animations` carga sin errores.
- [ ] Banner rojo arriba: `🎬 Bichitos Rumble · Animation Lab · INTERNAL`
      con link "← back to game".
- [ ] Título del tab: "Bichitos Rumble — Animation Lab (internal)".
- [ ] View source → `<meta name="robots" content="noindex, nofollow">`.
- [ ] En el tool panel, por encima del load-model tools, ves **Bichitos
      Rumble roster** con 9 cards (Sergei, Kurama, Cheeto, Kowalski,
      Trunk, Sebastian, Shelly, Kermit, Sihans).
- [ ] Click en Sergei → el GLB carga en la escena 3D. El dropdown
      `#model-selection` se ha expandido con la opción `Sergei (Bichitos)`.
- [ ] El tooltip de cada card da la razón del rig sugerido.
- [ ] Cuando el paso Skeleton se activa, el dropdown `#skeleton-selection`
      está preseleccionado en el rig sugerido (human para Sergei).
- [ ] El flujo completo: skeleton fit → elegir animaciones → export GLB
      funciona.
- [ ] Reemplazas `public/models/critters/sergei.glb` con el exportado
      → el skeletal loader del juego detecta los clips (punto 9).
- [ ] Enlace desde `/tools.html` sidebar footer: `🎬 /animations` abre
      nueva pestaña al lab.

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
