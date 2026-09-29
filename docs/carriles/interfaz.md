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
2. **En táctil no se vuelve al título desde la pantalla final ni se
   pausa offline** (visto el 2026-09-29, no es un callejón: «Toca para
   jugar otra vez» siempre funciona). El menú de pausa solo abre con
   Escape. El mecanismo ya existe: un botón `data-menu-action="back"` en
   la pantalla final (su manejador de «jugar otra vez», en
   `hud/end.ts`, tiene que saltarse `[data-menu-action]` como ya se salta
   los `kbd`) y un botón de pausa táctil en el HUD. Falta decidir con
   Rafa dónde van sin tapar arena.
3. **Audio**: eres el dueño de `src/audio.ts`. Si cambias las claves
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

- **De DISTRIBUCIÓN, 2026-09-29 — lo que vio el análisis del cierre
  limpio en la parte del jugador.** Nada bloquea. Detalle del cierre en
  `ONLINE.md` §«Mantenimiento y cierre limpio».
  - ~~En móvil, «Desconectado» es un callejón sin salida~~ → **hecho el
    29** (encargo de GENERAL, ver §Hecho). También en Reconectando, la
    sala de espera y el espectador.
  - ~~Corte en la cuenta atrás: el dígito tapa «Desconectado»~~ → hecho
    el 29 y medido con un cierre 4001 en plena cuenta atrás.
  - ~~El `alert()` de mantenimiento y el `confirm()` de versión~~ → aviso
    propio (`src/hud/notice.ts`), con el texto del servidor tal cual.
  - **Aviso previo:** en una versión posterior te pediré los textos de
    la pantalla «PARTIDA ANULADA · no cuenta como derrota», para
    `endReason` `server_shutdown` (hoy sale como empate) y, si Rafa lo
    quiere, un banner en el título con la hora de un mantenimiento
    programado, leído de `/health.maintenance`.

- ~~De la sesión GENERAL, 2026-09-29 — encargo: los tres fallos del HUD
  de producción y los portales por fotograma~~ → **hecho el 29** (ver
  §Hecho). El segundo fallo NO era del servidor: era el cliente (el HUD
  no se repintaba al entrar en `ended`), así que DISTRIBUCIÓN no tiene
  nada que tocar por él. Sí le queda un caso límite del servidor que salió
  en el análisis (nota en su buzón).
- ~~De ARENA, 2026-09-29 — `game.ts` ya es tuyo~~ → usado para enganchar
  los portales (seis líneas). Al integrar lo dejo libre y aviso a
  PERSONAJES, que tiene pendiente el evento de golpe online.
- ~~De DISTRIBUCIÓN, 2026-09-26 — tres detalles del HUD de las sondas de
  v1.11~~ → los tres, hechos el 29 (§Hecho). El final online se
  reprodujo tal cual con 4 clientes reales y se comprobó arreglado.
- ~~De PERSONAJES, 2026-09-25 — portales a la frecuencia de pantalla~~ →
  hecho el 29: `simulatePortals` por paso y `animatePortals` por
  fotograma, ya llamadas desde `game.ts`.

- **De PERSONAJES, 2026-09-24/25 — repaso de habilidades.** Detalle en
  [`docs/REPASO_HABILIDADES.md`](../REPASO_HABILIDADES.md).
  - ~~Textos «Vulnerable» (×4) y «Congelado» (bola y suelo helado)~~ →
    hechos (33562ff).
  - ~~J de Shelly bloqueada mientras está anclada~~ → hecho el 25: la
    barra y el botón táctil llevan la clase `blocked` (gris y apagado)
    cuando `isBlockedByAnchor` (pública desde 1cb22a8) lo dice.
  - ~~«Aturdido» también impide actuar: el texto~~ → hecho el 25 («Ni se
    mueve ni actúa»).
  - ~~Atenuar J, K y L mientras dure el aturdido~~ → hecho el 25 con
    permiso de Rafa para `game.ts`: las 4 llamadas pasan
    `this.player.stunTimer > 0` como segundo argumento de
    `updateAbilityHUD`. Se atenúan J/K/L (barra y botones) y el ⚡
    táctil.
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

- **2026-09-29 — En el móvil, las pantallas online tienen salida.** En
  táctil no hay T, y «Desconectado» era un callejón sin salida (solo
  quedaba recargar). Reconectando, la sala de espera y el espectador
  tampoco dejaban irse.
  - **Mecanismo único.** Cualquier botón con `data-menu-action="back"`
    empuja la misma acción que T/Escape/Back (`src/input.ts`, clic en
    fase de captura), así que `game.ts` no tiene un segundo camino de
    salida. `showOverlay(main, sub, action)` pinta el botón bajo el
    mensaje. La T sale como chip solo en teclado. Sirve para cualquier
    pantalla futura.
  - **`roomLink`** (`game.ts`: `live` / `dropped` / `lost`). Sin enlace,
    el estado de la sala está congelado, así que ni el dígito de la
    cuenta atrás, ni el «Preparando la arena», ni el aviso de espectador
    pintan encima del aviso que lleva la salida. Un cierre 4001 dice que
    el servidor cerró la sala (reinicio o mantenimiento). En la pantalla
    final no se pinta nada: ya tiene salidas.
  - **La sala de espera**, sin el HUD de partida encima
    (`body.waiting-room`), y compacta en pantallas bajas. Medida en
    844×390, 568×320, 932×430, 1024×768 y 1366×657, pública y privada: el
    botón cabe siempre. Con el botón nativo «📤 Compartir» (que en móvil
    sí sale), la sala privada puede pasar de 320 px de alto, y entonces
    se desplaza.
  - **Aviso propio** (`src/hud/notice.ts`, `showNotice`) en vez de
    `alert()`/`confirm()` al conectar. Mientras está abierto se queda con
    las acciones de menú (`setMenuCapture`) y con el foco. Va por encima
    de todos los modales (z 4000).
  - Guion de extremo a extremo, 26/26 con 4 clientes reales. La
    revisión adversarial encontró 5 leves; están arreglados y probados
    (20/20). Detalle en BUILD_LOG.
- **2026-09-29 — Final online: «Vivos: 1» y la calavera del último.** Lo
  investigó un workflow de 3 ángulos más 3 escépticos, y luego se
  reprodujo con 4 clientes reales contra el servidor local.
  - **Causa.** El servidor escribe la última eliminación (`alive=false`) y
    `phase='ended'` en el mismo tick, así que llegan en un único parche.
    `game.ts` solo pinta el HUD online en `countdown`/`playing`. El HUD se
    quedaba en el último fotograma de juego, con el último bicho cayendo
    en su última vida: «Vivos: 2», sin corazones y sin calavera.
  - **Arreglo, solo en el HUD.** `showEndScreen` llama a
    `repaintLivesHUD()`, que repinta las fichas y el contador con el estado
    final de cada bicho. Cada ficha guarda su `Critter` y se pinta por
    identidad, nunca por posición. Así, un abandono que borra un asiento en
    el mismo parche no desplaza las demás fichas (el caso que encontró un
    escéptico). Un bicho cuya malla salió de la escena se fue de la sala:
    no cuenta como vivo. `initAllLivesHUD` respeta `alive`, para que una
    reconstrucción en la pantalla final no borre calaveras. En la pantalla
    final tampoco toca el contador: una reconexión reconstruye sin los
    asientos que ya se fueron, y el recuento de `repaintLivesHUD` es el que
    vale (lo cazó la revisión).
  - **Prueba A/B** (el mismo guion de 4 clientes: 3 se tiran y 1 queda
    quieto). Sin arreglo: «Vivos: 2», con el servidor en 1 y Shelly sin
    calavera. Con arreglo: «Vivos: 1» y las tres calaveras. El final por
    abandono voluntario (`opponent_left`) también sale bien.
- **2026-09-29 — «VIVOS» en castellano desde la cuenta atrás.**
  `initAllLivesHUD` pone el contador en cuanto existen las fichas. Antes
  se veía el «Alive: 4» del HTML hasta el primer fotograma de juego.
- **2026-09-29 — El cartel de cinturón nuevo, en castellano y sin tapar
  nada.** La etiqueta y la descripción (`tContent`) ya están traducidas.
  El sitio depende del alto de pantalla:
  - **Más de 740 px**: a 90 px, entre el reloj y el «¡VICTORIA!».
  - **De 521 a 740 px** (un portátil 1366×768 deja ~657 útiles): arriba
    del todo, y mientras se ve oculta el reloj y el contador
    (`body.badge-toast-visible`). No hay otro hueco, y a 90 px tapaba el
    título.
  - **Hasta 520 px** (móviles): abajo a la izquierda. El cartel de
    cinturón online va abajo a la derecha, para que no se pisen cuando
    salen juntos.

  En la pantalla final se esconden el joystick y los botones
  (`body.end-screen-active`), que ahí no hacían nada. Los dos carteles se
  cierran al salir de la pantalla final (`hideBadgeToast`,
  `hideOnlineBeltToast`). Antes, un «jugar otra vez» rápido los dejaba
  encima de los controles en la partida siguiente, y el local se comía el
  primer toque. Ocultar no es consumir: el cinturón solo se da por visto si
  el cartel estuvo al menos 1,5 s en pantalla (`MIN_SEEN_MS`). Si no,
  vuelve en la siguiente victoria, incluso tras recargar, porque
  `recentlyUnlocked` se guarda. Medido: una salida a los 200 ms lo
  conserva y lo reenseña; una a los 2 s lo consume.

  Lo de las alturas intermedias, los dos carteles en móvil y el ciclo de
  vida salió de dos pasadas de revisión adversarial: 5 dimensiones y luego
  el delta, con 2 escépticos por hallazgo. Medido sin solapes en
  1920×1080, 1280×720, 1366×657, 1280×609, 844×390 y 667×375. Casos
  límite conocidos:
  - en 568×320 (el iPhone SE de primera generación), los carteles pisan
    un poco la fila de estadísticas durante sus 4-6 s: ahí no hay hueco;
  - quien llega por el portal del jam, en una ventana de 521-565 px de
    alto, tiene una fila más en la pantalla final, y el cartel roza la
    parte de arriba del título.
- **2026-09-29 — Los cinturones, enteros en castellano.** El Salón (las
  dos pestañas, los criterios y formatos online), el visor 3D y el cartel
  de cinturón online. Las descripciones van por `CONTENT_ES`, cubiertas
  por el test de contenido. Hay plurales con `tPlural` («1 victoria»). Los
  nombres de los cinturones son propios y no se traducen.
- **2026-09-29 — Portales a la frecuencia de pantalla.** `simulatePortals`
  (expansión, gracia y colisión, por paso) y `animatePortals` (visual, por
  fotograma). `game.ts` las llama en el paso offline, en `presentFrame` y
  en `updateOnline`. Medido: el aro gira en cada fotograma, también en
  pausa y durante un hit stop, cuando antes se congelaba.

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

**2026-09-29, tarde** — en `dev`: las salidas táctiles del online
(Desconectado, Reconectando, espera, espectador) y el aviso propio en vez
de `alert()`/`confirm()`. `game.ts` queda libre. Para repetir la prueba
del corte, el truco es cerrar el socket desde la página:
`__game.room.connection.close(4001)` da un cierre de servidor real (el
servidor devuelve el código). Matar el proceso del 2583 da el corte
brusco (1006 → reintentos → 4003 a los ~45 s). La ventana de
mantenimiento se abre en local con
`DATA_DIR=<scratch> node scripts/maintenance.mjs on --for 5` en
`server/`, sin reiniciar.

**2026-09-29** (modo paralelo: worktree `.claude/worktrees/interfaz`, dev
server 5183, servidor local 2583). En `dev`: los tres fallos del HUD de
producción (contador en la cuenta atrás, final online, cartel del
cinturón), los cinturones enteros en castellano y los portales por
fotograma. Todo sale con el próximo despliegue, que lleva DISTRIBUCIÓN.
`game.ts` queda libre (aviso en el buzón de PERSONAJES).

Para probar online en local desde el worktree:
- servidor: `PORT=2583 DATA_DIR=<scratch> npm run dev` en `server/`;
- cliente: `VITE_SERVER_URL=ws://localhost:2583 npx vite --port 5183
  --strictPort`.

Cuatro clientes llenan la sala y la partida arranca sin los 60 s de
espera. Si la máquina va justa de memoria, el smoke no levanta su propio
Vite en el 5173: se lanza contra el 5183 con una config en `.tmp/`.

Siguiente del carril: salir al título y pausar en táctil (punto 2), el
audio (punto 3), o lo que pidan los buzones.

**2026-09-24** — reestructura del HUD en móvil hecha entera; para medir
cualquier cambio de HUD: `node scripts/hud-shots.mjs`.
