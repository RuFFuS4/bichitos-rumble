# Carril INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`DEV_TOOLS.md`, `BADGES_DESIGN.md` y `NEXT_STEPS.md`.

## Pendiente (por orden)

1. **Reestructura del HUD en móvil** (diferido de la era jam: "la versión
   actual es correcta, no ideal"). **Medido el 2026-09-24**: 7 viewports
   (667×375 a 1280×720, móviles en apaisado con toque y DPR 2) × título,
   selección y partida. Se midió la cobertura del HUD sobre el disco de
   la arena proyectado con la cámara de juego, y los solapes entre
   piezas. Medidor: `scripts/hud-shots.mjs` (DEV_TOOLS §Superficie
   programática).
   - **La arena está bien servida**: el HUD tapa 0-1 % del disco en
     todos los móviles (el botón L roza el borde derecho en 667×375). No
     hay que ganarle sitio a la arena.
   - **Las cuatro cosas que eligió Rafa están hechas** (2026-09-24, ver
     §Hecho): enfriamiento en los botones táctiles, las cuatro vidas, la
     ficha en castellano y la selección compacta en móvil.
   - La selección en escritorio y en iPad, que también desbordaba, quedó
     arreglada el mismo día (ver §Hecho).
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

- **De PERSONAJES, 2026-09-24/25 — repaso de habilidades.** Detalle en
  [`docs/REPASO_HABILIDADES.md`](../REPASO_HABILIDADES.md).
  - ~~Textos «Vulnerable» (×4) y «Congelado» (bola y suelo helado)~~ →
    hechos (33562ff).
  - ~~J de Shelly bloqueada mientras está anclada~~ → hecho el 25: la
    barra y el botón táctil llevan la clase `blocked` (gris y apagado)
    cuando `isBlockedByAnchor` (pública desde 1cb22a8) lo dice.
  - ~~«Aturdido» también impide actuar: el texto~~ → hecho el 25 («Ni se
    mueve ni actúa»).
  - **Opcional, pendiente de Rafa: atenuar J, K y L mientras dure el
    aturdido.** El HUD solo recibe las habilidades
    (`updateAbilityHUD(this.player.abilityStates)`, 4 llamadas en
    `game.ts`, tierra de nadie), y el `Critter` no marca cuál es el
    local. Hace falta pasarle `stunTimer > 0` desde `game.ts`.
  - Sus tres retoques de `CONTENT_ES` (Grip, Fox Dash, Ice Slide) están
    bien; el test de contenido sigue verde.
  - ~~Contorno~~ → en `dev` (4748f63), las miniaturas lo reciben solas.

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

- **2026-09-24 — La selección cabe entera también en escritorio y en
  iPad** (opción de Rafa: encoger el 3D con el alto, sin cambiar el
  diseño). Lo destapó `hud-shots`. A 1280×720 el contenido medía 806 px:
  el título se salía por arriba (`justify-content: center` repartía el
  sobrante hacia arriba) y la ficha se cortaba por abajo. Ahora el lienzo
  3D mide `clamp(190px, 100vh − 460px, 440px)`, donde 460 px es el resto
  medido (título 54 + ficha 351 + aviso 46). La pantalla usa
  `safe center` y se desplaza como último recurso. Medido: cabe justo en
  1280×720, 1366×650 (portátil), 1440×800 e iPad; 1920×1080 no cambia
  (440 px). Si la ficha crece, sube el 460.
- **2026-09-24 — La selección cabe entera en móvil.** En apaisado
  (`max-height: 520px`) la ficha iba debajo de la vista 3D y se quedaba
  bajo el pliegue: 682 px de contenido en 360-430. Ahora hay tres
  columnas, parrilla | vista 3D | ficha. El lienzo toma lo que sobra
  (`preview.ts` dimensiona su renderer por la caja CSS del lienzo) y la
  ficha se compacta. «Cinturones» sube para no montar sobre la ficha.
  Medido: el contenido mide exactamente el alto de pantalla en 667×375,
  740×360, 844×390, 915×412 y 932×430, aviso de abajo incluido.
- **2026-09-24 — La ficha del bicho, en castellano.** Con la interfaz en
  castellano, el rol, el lema, las etiquetas de stats y las descripciones
  de habilidad salían en inglés. Las etiquetas son claves de DICT
  (`select-stat-*`). Rol, lema y descripciones viven en inglés en el
  código de PERSONAJES (`roster.ts`, `abilities.ts`), así que no se
  copian: `CONTENT_ES` en `i18n.ts` las traduce **por el propio texto
  inglés** (`tContent`), como un msgid de gettext. Si PERSONAJES cambia
  una frase, se ve el inglés nuevo y no una traducción que ya no
  corresponde. `tests/sim/i18n-content.test.ts` caza en las dos
  direcciones: frases sin traducir y traducciones sin texto fuente. Los
  nombres propios (bichos, habilidades) no se traducen, por contrato de
  `i18n.ts`, y los lemas en castellano evitan el género.
- **2026-09-24 — Las cuatro vidas en móvil.** En el bloque compacto
  (`max-height: 520px`) BL y BR iban ocultas, porque abajo mandan el
  joystick y los botones: de dos rivales no se veían las vidas. Ahora
  las cuatro fichas compactas (70 px de ancho fijo) van en la franja de
  arriba, en dos parejas alrededor del reloj: TL y BL bajo los botones
  de sonido, TR y BR a la derecha, todas a 56 px. Medido en los 6
  viewports táctiles: sin solapes y sin tapar arena. De paso, con el
  portal apagado la TL de escritorio sube a 72 px, alineada con la TR:
  era el hueco de la leyenda medido el 2026-09-21. Ojo de especificidad
  al tocarlo: las reglas compactas llevan también la variante
  `body.touch-mode` / `body.portal-off` para ganar a la de tablet
  (`bottom: 240px`) y a la del portal.
- **2026-09-24 — Los botones táctiles llevan icono y enfriamiento.** En
  móvil la barra de habilidades se oculta y los botones solo decían
  J/K/L: no había ninguna indicación de enfriamiento. Ahora
  `initAbilityHUD` (`hud/runtime.ts`) mete en cada botón el mismo
  medallón de la barra (`.ability-slot-icon`: icono del bicho, barrido
  cónico con `--cd-progress`, destello de «listo»), y `updateAbilityHUD`
  le pone los mismos estados (`active`, `on-cooldown`, `unavailable`).
  Las reglas de estado del partial se amplían a `.touch-button`, sin
  duplicarlas. La letra queda como plan B (`.sprite-fallback-ability`)
  si no carga la hoja de iconos. Al cambiar de bicho se limpian los tres
  botones, para que uno con menos habilidades no herede iconos. Nota
  para probarlo: los botones son estado «mantenido» muestreado por
  fotograma, así que un toque sintético que suelta en el mismo fotograma
  no dispara nada; hay que mantenerlo unos 200 ms.
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
comparten materiales con `Critter`. La reestructura del HUD en móvil está
hecha entera: modo táctil en móviles grandes y tablets, enfriamiento en
los botones, cuatro vidas, ficha en castellano y selección compacta. La
selección cabe también en escritorio (portátil incluido) y en iPad. Para
medir cualquier cambio de HUD: `node scripts/hud-shots.mjs`. Siguiente del
carril: audio (punto 2), o lo que pidan los buzones.
