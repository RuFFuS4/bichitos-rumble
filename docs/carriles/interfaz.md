# Carril INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`DEV_TOOLS.md`, `BADGES_DESIGN.md` y `NEXT_STEPS.md`.

## Pendiente (por orden)

1. **Reestructura del HUD en móvil** (diferido de la era jam: "la versión
   actual es correcta, no ideal"). **Medido el 2026-09-24**: 7 viewports
   (667×375 a 1280×720, móviles en apaisado con toque y DPR 2) × título,
   selección y partida. Se midió la cobertura del HUD sobre el disco de
   la arena proyectado con la cámara de juego, y los solapes entre
   piezas. El medidor está en el scratchpad de la sesión; se promociona a
   `scripts/` en cuanto haga falta para el antes/después.
   - **La arena está bien servida**: el HUD tapa 0-1 % del disco en
     todos los móviles (el botón L roza el borde derecho en 667×375). No
     hay que ganarle sitio a la arena.
   - **Sin enfriamiento en móvil**: en táctil + `max-height: 520px` la
     barra de habilidades se oculta y los botones solo llevan la letra
     J/K/L. Es el hallazgo más gordo que queda. Propuesta: el icono de la
     habilidad y el barrido de enfriamiento dentro de cada botón táctil
     (reutilizar `ability-icons.webp` y el `--cd-progress` de la barra).
   - **Solo 2 de 4 esquinas de vidas en móvil** (TL y TR; BL y BR van
     ocultas porque abajo mandan el joystick y los botones). De dos
     rivales no ves las vidas. Propuesta: las cuatro compactas en la
     franja superior, dos a cada lado del reloj.
   - **Selección**: el contenido mide 682 px en 360-430 de alto. Se puede
     desplazar, pero stats y habilidades quedan bajo el pliegue. Y hay
     **textos sin traducir** con la interfaz en castellano: el lema del
     bicho, el rol y las etiquetas de stats («Huge and unstoppable.»,
     «BRUISER», «SPEED»).
   - Con el portal apagado, la esquina TL sigue a `top: 118px` ("debajo
     de la leyenda del portal"): hueco donde estaba la leyenda.
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
- ~~De PERSONAJES, 2026-09-24 — `normalizeCritterMaterials(root)`~~ →
  hecho (ver §Hecho, miniaturas).

## Hecho

- **2026-09-24 — Los móviles grandes y las tablets arrancan con
  joystick.** `isLikelyMobile` (`src/input.ts`) pedía toque **y**
  `innerWidth < 900`. En apaisado, un Pixel 7 o un Galaxy (915 px), un
  iPhone Pro Max (932 px) y un iPad (1024 px) arrancaban **sin joystick
  ni botones**, injugables sin teclado. Ahora basta con toque + puntero
  `coarse` (móviles y tablets); los portátiles táctiles siguen en `fine`
  y no cambian. En tablet caben las cuatro esquinas, así que las de abajo
  suben por encima de los controles (`bottom: 240px` en
  `body.touch-mode`, `hud.partial.html`); medido sin solapes. Test en
  `tests/smoke.spec.ts` (915×412 con toque), comprobado que falla sin el
  arreglo.
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
  sprites. Además pasan por `normalizeCritterMaterials` (función
  compartida de PERSONAJES, la misma que usa `Critter`): los rigs de Meshy
  (Sergei, Sebastian, Kurama y Sihans) salían autoiluminados por su
  albedo y ahora se sombrean como los otros cinco.
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
con el despliegue de H4.5 (lo lleva DISTRIBUCIÓN). Las miniaturas ya
comparten materiales con `Critter`. El modo táctil ya se activa en móviles
grandes y tablets. La medición del HUD en móvil está hecha (punto 1 de
Pendiente) y espera a que Rafa elija por dónde empezar la reestructura.
