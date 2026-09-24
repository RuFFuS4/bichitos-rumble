# Carril INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`DEV_TOOLS.md`, `BADGES_DESIGN.md` y `NEXT_STEPS.md`.

## Pendiente (por orden)

0. **Sprites chibi del HUD con la paleta vieja — espera a Rafa.** Con la
   paleta de sus bocetos (PERSONAJES, 2026-09-24), el tile de **Sergei**
   es un gorila marrón (el bicho es carbón) y el de **Shelly** lleva el
   caparazón marrón (ahora es verde). Kowalski, Kermit, Cheeto y Sihans
   cuadran; Trunk, Kurama y Sebastian no cambiaron. Los sprites tapan la
   miniatura en la parrilla y en las esquinas de la partida, así que el
   choque se ve al elegir. Salen de `HUD_mejorado.png` (arte de Rafa) vía
   `scripts/rebuild-hud-sheet.mjs`. Opciones: que Rafa rehaga esos dos
   tiles, o un recoloreado por código de los dos tiles como apaño para que
   él lo juzgue. **Viaja con el despliegue de H4.5**: la paleta nueva sale
   con él.
1. **Reestructura del HUD en móvil** (diferido de la era jam: "la versión
   actual es correcta, no ideal"). Mide antes de rediseñar.
   Dato ya medido (2026-09-21): con el portal apagado
   (`body.portal-off`) la esquina de vidas TL sigue a `top: 118px`, que
   es "debajo de la leyenda del portal" — queda un hueco donde estaba la
   leyenda. Entra en esta reestructura, no merece parche suelto.
2. **Audio**: eres el dueño de `src/audio.ts`. Si cambias las claves
   `bichitos.sfxMuted` / `bichitos.musicMuted`, avisa a todos los
   carriles — las lee `scripts/lib/headless-browser.mjs` y de ellas
   depende que las instancias de prueba nazcan mudas (directiva de Rafa).
   El carril PERSONAJES tiene pendiente pedirte SFX por critter.

## Lo que no puedes romper

- **La lectura del borde y de los critters manda sobre la decoración del
  HUD**: es un juego de tirar al rival al vacío.
- El naranja del aviso de colapso es **información de gameplay**, no
  decorado; ningún elemento de UI compite con él.
- Los botones de audio tienen que ser alcanzables desde **todas** las
  pantallas (regla de Rafa; ya hubo un bug por ocultarlos fuera de
  partida).
- Nada de gameplay ni de arena desde aquí. Si el golden se mueve, algo va
  mal.

## Buzón

*(Notas que te dejan otros carriles.)*

- **De DISTRIBUCIÓN, 2026-09-21 — he tocado tu `src/i18n.ts`, con
  permiso de Rafa.** Son dos claves nuevas al final del bloque
  `connect-*`: `connect-client-outdated` (confirm "Hay una versión
  nueva… ¿Recargar?") y `connect-server-outdated` ("El servidor se está
  actualizando…"). Las usa el guard de versión cliente↔servidor desde
  `src/game.ts` (el catch de `connectOnlineWith`). Si quieres otro tono o
  convertir el confirm en un overlay propio, es tuyo: el contrato es que
  el mensaje del servidor lleva el token `client_outdated` /
  `server_outdated` (ver `ONLINE.md` → "Versión de protocolo"). Idea que
  queda para ti, opcional: sondear `GET /health` (`protocol`) al pulsar
  Online, para avisar de la versión nueva antes de elegir bicho.
- ~~De PERSONAJES, 2026-09-24 — contorno en las miniaturas~~ → hecho
  (ver §Hecho); respuesta sobre el brillo en su buzón.

## Hecho

- **2026-09-24 — Miniaturas 3D con contorno y encuadre por pose**
  (`src/slot-thumbnail.ts`, petición de PERSONAJES). Llevan el mismo
  contorno que `Critter` (`setOutlineVisible(attachOutline(glb), true)`,
  respeta `?look=plain`). Y cada bicho se encuadra con su silueta posada
  (`measurePosedBox`): el lado mayor mide `FRAME_FILL` = 1,95 u,
  centrado. Antes, con la escala cruda del roster, a Kurama se le
  cortaban orejas y cola, y Sebastian ocupaba un tercio del cuadro; con
  2,1 u, Sebastian rozaba el borde. Se ven sobre todo en la sala de
  espera online; en la parrilla y el HUD solo si no carga la hoja de
  sprites.
- **2026-09-21 — Portal del Vibe Jam apagado en itch y Steam** (decisión
  de Rafa: fuera de la web propia, en los dos). Todo en `src/portal.ts` +
  una regla CSS en `hud.partial.html`; `game.ts` sin tocar. Tres
  interruptores, cualquiera lo apaga (sin portales, sin leyenda, sin botón
  🌀 táctil, y un `?portal=true` entrante se ignora):
  - `?ref=itch` — lo que **ya** manda el wrapper publicado en itch
    (374 B, un iframe a `https://www.bichitosrumble.com/?ref=itch`,
    leído en vivo el 2026-09-21). Por eso **no hay que resubir el zip**.
  - `?portal=0` — manual, cualquier host (futuros portales tipo
    CrazyGames, QA).
  - `VITE_PORTAL=off` al compilar — el paquete de Steam; lo pone el carril
    DISTRIBUCIÓN (nota en su buzón).
  Cubierto por `tests/smoke.spec.ts` (el test base exige 1 portal en la
  web propia; los de `?portal=0` y `?ref=itch`, 0 y la leyenda oculta).
  **Llega a itch cuando `dev` salga a `main`** — itch embebe producción.

## Cómo retomar

**2026-09-24** — miniaturas con contorno y encuadre, en `dev`. Portal
cerrado en `dev`, pendiente solo del despliegue (lo lleva DISTRIBUCIÓN
junto con el de H4.5). Esperando a Rafa: los sprites de Sergei y Shelly
(punto 0). Siguiente trabajo propio: la reestructura del HUD en móvil;
empieza midiendo (capturas a 390×844 y 1280×720 con `body.touch-mode`)
antes de proponer nada.
