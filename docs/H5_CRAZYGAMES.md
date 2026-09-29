# H5 — CrazyGames: el plan del SDK

Carril DISTRIBUCIÓN. Plan del 2026-09-29, aprobado por Rafa ese mismo día
(ver «Decisiones»). Salió de 3 lectores (SDK y requisitos, el juego, el
roadmap y las licencias), dos enfoques (básico y completo), un crítico
adversarial y una síntesis. Todo lo marcado [DOC] está en la documentación
oficial; lo marcado [MEDIDO], comprobado a mano; lo demás es inferencia.

## Qué es CrazyGames y qué nos exige

CrazyGames (CG) aloja una copia del juego y reparte con nosotros lo que dan
sus anuncios. Dos fases [DOC, https://docs.crazygames.com/#launching-on-crazygames]:

- **Basic Launch**: 7-21 días con público limitado, sin anuncios ni
  ingresos. El SDK es opcional. Termina con 7 días y 500 partidas, o a los
  21 días.
- **Full Launch**: solo si CG lo elige, por tiempo de juego, conversión y
  retención. El SDK pasa a ser obligatorio, se encienden los anuncios y se
  cobra.

Lo verificado:

- **El SDK** es un script del CDN (`https://sdk.crazygames.com/crazygames-sdk-v3.js`,
  28,7 KB en gzip, v3.8.0 el 2026-09-28) [MEDIDO]. No hay paquete npm ni
  tipos oficiales. CG lo actualiza sin avisar, así que no se copia al repo.
  - `await CrazyGames.SDK.init()` es obligatorio.
  - `environment` vale:
    - `local` en localhost o con `?useLocalSdk=true`: anuncios de demo y
      logs en consola;
    - `crazygames` en sus dominios;
    - `disabled` en cualquier otro dominio.
- **Nunca en la web propia ni en itch**: fuera de sus dominios, `init()`
  espera hasta 7 s antes de rendirse [MEDIDO en el código del SDK].
- **Los anuncios** [DOC, https://docs.crazygames.com/requirements/ads/]:
  - nunca durante la partida ni en botones de navegación, solo en
    transiciones (entre rondas);
  - la UI queda bloqueada desde que se pide hasta `adFinished`/`adError`;
  - se silencia solo en `adStarted`;
  - si no hay anuncio (`unfilled`, `adblock`, `adCooldown`,
    `adsDisabledBasicLaunch`), el juego sigue normal;
  - CG limita los midgame a uno cada 3 min y recomienda esperar 3-5 min de
    juego antes del primero.
- **Silencio**: en Full hay que respetar `settings.muteAudio` y su listener;
  el botón de sonido del juego no puede saltárselo.
- **Límites**: 50 MB de descarga inicial, 250 MB en total y 1500 ficheros.
  La dist pesa 28 MB en 113 ficheros. Con ≤ 20 MB hasta la primera partida
  se entra en la home móvil (lo nuestro, estimado en 10-12 MB, sin medir).
- **El servidor ya admite su iframe**: CORS y wss desde
  `games.crazygames.com` probados contra Railway [MEDIDO]. No se usa en la
  v1 (sin online).
- **El contrato** (`developer_terms_20250818.pdf`):
  - no es exclusivo por defecto; la exclusividad da +50 % durante 2 meses
    (art. 5.5);
  - solo se cobra en Full y con el SDK;
  - las garantías de propiedad intelectual se dan AL ENVIAR, también en
    Basic (arts. 7.1 y 9.1);
  - prohíbe promocionar webs propias sin permiso (art. 10.2(b)).
- **El reparto de ingresos no está publicado**: el «50-80 %» del ROADMAP no
  tiene fuente.

Dos cosas del juego que hoy romperían dentro de CG, porque sirve el juego
bajo una subruta:

- la música se pide con rutas absolutas (`src/audio.ts`, `MUSIC_FILES`) y
  se quedaría muda sin ningún error;
- los enlaces a privacidad y términos también son absolutos (`index.html`).

## Decisiones de Rafa (2026-09-29)

- **La F0 arranca ya**, sin licencias, sin cuenta y sin publicar nada. Con
  permiso para los ganchos en la tierra de nadie: unas 15 líneas en
  `src/game.ts`, unas 5 en `src/main.ts` y el script `build:crazygames` en
  `package.json`.
- **Sin online** en la build de CG en la v1. Así desaparecen varios
  problemas:
  - los enlaces de invitación a URLs de CG;
  - los `alert()` en el iframe;
  - los nicks sin filtro, de los que responde el desarrollador (art. 4.5);
  - la rotura de la build congelada con cada cambio de `NET_PROTOCOL`.
- **Sin exclusividad**: CG, itch y la web propia a la vez.
- **Sin rewarded en H5**: se replantean en H6, con los cosméticos.
- Con la recomendación (Rafa no pidió cambiarlas):
  - el anuncio sale **solo con R o el botón «Jugar otra»** de la pantalla
    final, nunca con cualquier toque (un toque residual del táctil lo
    lanzaría por sorpresa);
  - el primero, tras **3 min de partida acumulada**
    (`FIRST_MIDGAME_AFTER_GAMEPLAY_MS`), dentro de la franja de 3-5 que
    recomienda CG;
  - Sentry fuera de la build de CG en la v1;
  - ninguna donación ni enlace a la web jugable en esa build;
  - nada se sube a CG, ni al preview, hasta cerrar las licencias.

## Las fases

**F0 — ahora, en localhost.** Todo detrás del modo de build `crazygames`,
con el mismo patrón que `VITE_PORTAL=off` para Steam. La web de Vercel e
itch no cargan ni un byte del SDK, y una comprobación de build lo vigila.

1. DISTRIBUCIÓN:
   - `.env.crazygames`: `VITE_PLATFORM=crazygames`, `VITE_PORTAL=off`, y
     `VITE_SERVER_URL` y `VITE_SENTRY_DSN` declarados vacíos a propósito;
   - `vite.config.ts` inyecta el script del SDK y quita lo que apunta a
     bichitosrumble.com y los assets de licencia pendiente (og-image,
     manifest, sitemap);
   - `src/platform.ts`, un adaptador neutro que en la web no hace nada;
   - `src/platform-crazygames.ts`, el envoltorio del SDK;
   - las comprobaciones de build;
   - `scripts/build-crazygames.mjs`, que compila a `.tmp/crazygames/`.
2. INTERFAZ, por su buzón:
   - rutas relativas de la música y de privacidad/términos;
   - un silencio externo que no guarda preferencias;
   - ocultar Compartir y la pestaña online del Salón sin servidor;
   - `user-select` en el body;
   - el idioma del SDK.
3. Los ganchos en `src/main.ts` (carga) y `src/game.ts` (juego/pausa, y el
   anuncio dentro de `restartMatch`, solo desde la pantalla final).
4. Pruebas:
   - vitest con un SDK falso;
   - un smoke mudo sobre el build de CG servido con `vite preview` (el SDK
     entra en modo `local`);
   - la dist servida bajo una subruta, para cazar 404.

**F1 — Basic Launch** (cuando las licencias estén en verde y Rafa lo
decida): la cuenta, el zip al preview de CG, la checklist de QA y el envío
sin exclusividad. En Basic los anuncios responden «desactivados» y el juego
sigue.

**F2 — Full Launch** (solo si CG nos elige): los anuncios se encienden con
la misma build. El resto de requisitos de Full van en slices aparte (1 clic
hasta jugar, guardado en la nube de CG y, si algún día hay online en CG,
cuentas de CG verificadas en el servidor).

### Estado de la F0 (2026-09-29)

- **DISTRIBUCIÓN, hecho y en `dev`:**
  - `src/platform.ts` y `src/platform-crazygames.ts`;
  - los ganchos de `main.ts` (carga) y `game.ts` (juego, pausa y el
    anuncio con R en la pantalla final offline);
  - `.env.crazygames` y el modo de build en `vite.config.ts`;
  - `npm run build:crazygames`;
  - las comprobaciones de `check-payload-budget`;
  - `tests/sim/platform.test.ts` (19 casos, con un SDK falso);
  - `scripts/smoke-crazygames.mjs`.
- **Medido en localhost, con el SDK en modo local:**
  - carga avisada en orden;
  - ni online ni peticiones a Railway o Sentry;
  - la pausa avisa de parar y seguir sin pedir anuncio;
  - R pide el anuncio y después arranca la partida siguiente; T se
    ignora mientras tanto;
  - el silencio del anuncio llega al audio: el smoke lee
    `isExternallyMuted()` de `audio.ts`, que se enciende con `adStarted`
    y se apaga al acabar (el estado del juego, no la ganancia del bus);
  - en la web, ni el SDK ni el chunk de la plataforma.
- **INTERFAZ, hecho** (2a2bc82):
  - silencio externo, cableado en `main.ts`;
  - rutas relativas;
  - Compartir oculto;
  - `user-select`;
  - el Salón sin pestañas si no hay servidor.

  Con eso, `build:crazygames` pasa en verde y el smoke da todo OK, sin
  404 bajo la subruta; los dos corren en el CI.
- **Falta, de INTERFAZ y Rafa:** el botón «Jugar otra», para que el
  móvil tenga descanso con anuncio. Va junto a «volver al título» en
  táctil.
- **Falta, de Rafa:** el texto de `privacy.html`.

## Qué ve el jugador

- **En la web y en itch**: nada cambia.
- **En CG, en Basic**: sin anuncios, sin portales, sin Compartir y solo
  contra bots. El silencio de CG manda sobre el botón de sonido.
- **En Full**, al pulsar R o «Jugar otra» en la pantalla final, y solo
  tras 3 min de partida acumulada (como mucho uno cada 3 min, por el tope
  de CG):
  - «Preparando arena…» y la entrada bloqueada;
  - silencio cuando empieza el vídeo;
  - al acabar, vuelve el sonido y arranca la cuenta atrás;
  - si no hay anuncio, sigue al momento.
- **Nunca**: en partida, en la cuenta atrás, en la pausa ni al reiniciar
  desde ella, en el título, la selección o el Salón, al volver con T, al
  morir, ni en la primera partida.

## Lo que tiene que hacer Rafa

- **Licencias (camino crítico, bloquean F1 entera, también Basic).**
  `ASSET_LICENSES.md` tiene 10 filas ⚠️ (cinturones, iconos, favicon,
  og-image, 5 skyboxes, 5 suelos, 33 props). Hace falta:
  - archivar las facturas de abril (Meshy, Tripo, Suno) en
    `docs/licencias-evidencia/`, que hoy no existe;
  - saber qué generó los assets 2D;
  - confirmar el origen de los cinturones y los props.
- **Aclarar el bloqueante «licencias Meshy/Tripo» de NEXT_STEPS**: los 9
  bichitos están en ✅ desde el 2026-08-17.
- **Aprobar el texto nuevo de `public/privacy.html`.** Hoy dice «No ads» y
  «no trackers», y ya es falso en la web por Sentry y Vercel Analytics;
  además, en CG los anuncios los sirve CG.
- **En F1**:
  - crear la cuenta en developer.crazygames.com y meter los datos de
    facturación (Tipalti);
  - preparar 3 portadas (1920x1080, 800x1200 y 800x800) y 2 vídeos de
    15-20 s (horizontal a 1080p y vertical 2:3), solo con assets
    licenciados.
- **Opcional**: preguntar a CG el porcentaje de reparto.

## Sin verificar (se mide en F1, en el preview de CG)

- Si el iframe deja pasar `alert()`/`confirm()` y si aplica una CSP hacia
  Railway o Sentry.
- Si `window.focus()` recupera el teclado después de un anuncio real.
- La latencia real de `requestAd` en Basic: si `adsDisabledBasicLaunch`
  llega al instante. De eso depende el tope de seguridad de la petición.
- Si un anuncio llega a empezar pasado ese tope de 30 s. El juego ya ha
  seguido, así que el anuncio tapa la cuenta atrás.
  - Hoy se ve en silencio y suelta el silencio al acabar; el log de
    `__platform` lo marca como `adStarted late`.
  - Si se da en la QA, el remedio es pausar la partida mientras dure, y
    eso es de `game.ts` (PERSONAJES).
- Los bytes hasta la primera partida (la home móvil pide ≤ 20 MB).
- Si subir al preview sin enviar ya cuenta como envío (art. 7.1).
