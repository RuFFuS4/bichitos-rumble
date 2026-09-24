# Carril INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`DEV_TOOLS.md`, `BADGES_DESIGN.md` y `NEXT_STEPS.md`.

## Pendiente (por orden)

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

- **2026-09-24 — Sprites chibi de Sergei y Shelly a la paleta nueva**
  (aprobado por Rafa sobre la hoja antes/después/3D). Con la paleta de sus
  bocetos, el tile de Sergei era un gorila marrón (el bicho es carbón) y
  el de Shelly llevaba el caparazón marrón (ahora es oliva). Los sprites
  tapan la miniatura en la parrilla y en las esquinas, así que se elegía
  un bicho y se jugaba con otro. `scripts/recolor-hud-tiles.mjs` mueve
  solo los píxeles marrón oscuro de esos dos tiles, fundidos por peso:
  cara, aros, tripa y contorno quedan intactos. Las muñequeras de Sergei
  (s ≥ 0,9) se conservan, porque el 3D también las lleva. Reescribe el
  máster `_raw/hud-icons.png` y regenera el `.webp`. Es idempotente por
  guarda: un tile con menos de 1.000 px marrones se da por hecho, porque
  el fundido suave hacía que una segunda pasada moviera 240 px más. **Si
  algún día se rehace la hoja desde `HUD_mejorado.png`** (que sigue con la
  paleta del jam): `rebuild-hud-sheet` → `compress-images` →
  `recolor-hud-tiles`. Kowalski, Kermit, Cheeto y Sihans ya cuadraban;
  Trunk, Kurama y Sebastian no cambiaron.
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

**2026-09-24** — en `dev`: miniaturas con contorno y encuadre, y sprites
de Sergei y Shelly a la paleta nueva. El portal, cerrado en `dev`, sale
con el despliegue de H4.5 (lo lleva DISTRIBUCIÓN). Queda abierto con
PERSONAJES: la normalización de materiales de los rigs de Meshy en la
miniatura, a la espera de que la saquen como función compartida a
`critter-look.ts` (ver su buzón). Siguiente trabajo propio: la
reestructura del HUD en móvil; empieza midiendo (capturas a 390×844 y
1280×720 con `body.touch-mode`) antes de proponer nada.
