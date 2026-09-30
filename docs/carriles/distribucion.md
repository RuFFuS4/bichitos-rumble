# Carril DISTRIBUCIÓN Y DATOS — servidor, red, despliegue, payload, estadísticas y tienda

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`ONLINE.md`, `STACK.md`, `ROADMAP.md` (H5 monetización, H6 Steam) y
`ASSET_LICENSES.md`.

## Pendiente (por orden)

0. **v1.11 — ✅ EN PRODUCCIÓN desde el 2026-09-26 a las 21:32 UTC**
   (main `c8143ea` = `dev` `e4a1947`, tag `v1.11-caida-sierra`).
   - Qué lleva, todo de PERSONAJES y solo de cliente:
     - la sierra de Shelly gira online;
     - el clip de caída offline y online, con el Fall en su sitio;
     - la cuenta atrás animada, sin flotar al aterrizar;
     - la bola de nieve que ya no golpea en la cuenta atrás;
     - las reapariciones online y las caídas offline en la pantalla
       final.
   - `NET_PROTOCOL` sigue en 3. **Railway no se redesplegó** (rutas
     vigiladas, `server/` sin cambios): sigue el proceso de v1.10.
   - Verificación, ventana (Vercel ~30 s) y comprobaciones de después en
     BUILD_LOG (2026-09-26, DISTRIBUCIÓN, v1.11).
   - Rollback: Vercel `dpl_B6pTPENe4EGtE7s8CvCwE7siju4x` (`bb819bb`,
     v1.10). Railway ya está en `bb819bb`.
   - **Queda de Rafa, a mano:**
     - Sentry sin issues nuevos en 30-60 min;
     - mirar online, con sus ojos, a una Shelly girando y a un bicho
       cayendo por el borde de delante. Por detrás, la isla lo tapa.
   - La sierra de una Kurama que copia a Shelly sigue sin girar en los
     dos modos. Si el `abilityFired` manda la forma de la L (el punto 1
     de nuestra nota de Copycat online, en el buzón de PERSONAJES), su
     giro va en ese cambio.

   **v1.10** (2026-09-25 13:47 UTC, main `bb819bb` = `dev` `ea77e62`, tag
   `v1.10-paso-fijo`):
   - Qué lleva:
     - el juego a paso fijo de 1/60 con presentación a cada fotograma,
       también en Safari/iOS;
     - el Grip entero y el All-in a 180°/s;
     - los seis arreglos de tierra de nadie de PERSONAJES;
     - las zonas que copia Kurama, online como hielo y arena.
   - `NET_PROTOCOL` 3: nadie ve «recarga».
   - Verificación, ventana (Vercel 37 s, Railway 67 s), comprobaciones y
     el cambio de SHA (`3b1dbd6` → `ea77e62` por Safari) en BUILD_LOG
     (2026-09-25, DISTRIBUCIÓN, v1.10).
   - Su rollback era Vercel `dpl_7Uw3pUgKFcJ9VBnEqS3C7QPfmoEQ` (a37791b,
     v1.9) y Railway, el despliegue de a37791b.
   - **Queda de Rafa, a mano:**
     - Sentry sin issues nuevos;
     - jugar offline en un iPhone y en un monitor de 144 Hz: debe ir
       igual de fluido y empujar lo mismo;
     - 2 pestañas en una sala privada, con un Sebastian que cargue el
       All-in;
     - el A/B del suavizado, pendiente desde v1.8.
   - Lo que queda de v1.9 (Sinkhole online, hielo en la predicción) sigue
     en el punto 11.
   - Diferencia sabida, sin arreglar: online el anillo de una zona sale
     con la paleta del lanzador y offline con los colores de cada zona.
     La copia de Kurama se ve magenta.

1. **v1.8 (H4.5) — ✅ EN PRODUCCIÓN desde el 2026-09-24 a las 22:00 UTC**
   (main `784779f` = `bf7b3ee`, tag `v1.8-terreno-v2`). Comprobaciones de
   después y lecciones en BUILD_LOG (2026-09-25, DISTRIBUCIÓN).
   - **Queda de Rafa, a mano:**
     - el A/B del suavizado contra Railway (`?netsmooth=legacy` frente a
       normal, con `__game.netSmoother.stats()`);
     - 2 pestañas en una sala privada hasta el primer colapso;
     - Sentry sin issues nuevos.

   Lo de abajo es cómo se preparó, para el próximo despliegue.
   - **Qué viaja** (lo que hay en `dev`, ~55 commits):
     - ARENA: terreno v2, cono y fondo v2 F0, la isla en el cielo, con
       las hojas aprobadas por Rafa el 2026-09-21;
     - PERSONAJES: feeling, velocidad ×1,375, mejora gráfica, contorno,
       orientación que no gira con un empujón, repaso de las 27
       habilidades;
     - INTERFAZ: portal apagado en itch, selección y HUD en móvil;
     - DISTRIBUCIÓN: guard de versión (NET_PROTOCOL 2), suavizado
       online, zona muerta y Copycat por jugador en BrawlRoom, ws 8.21.3,
       ratchet a 30 MB y GLB immutable.
   - **Condiciones que ya se cumplen:**
     - el fondo del mar rechazado ya no es el que sale;
     - el suavizado online que pedía FEELING §7.6 para la velocidad
       nueva está en `dev`;
     - el bloqueo de Copycat de 4748f63 está resuelto (getLDef).
   - **Antes de desplegar, sobre el SHA congelado:**
     - la verificación completa: `check`, `test:sim`, golden, smoke, la
       partida online de 2 clientes, los 5 biomas, el guard con curl, la
       pestaña v1.7 contra el servidor nuevo y Docker;
     - las capturas a Rafa y su visto bueno;
     - el runbook de abajo, mergeando **el SHA exacto verificado**, no
       la rama `dev` a secas.
   - **Tras desplegar, el A/B del suavizado lo juzga Rafa a ojo** contra
     Railway: `?netsmooth=legacy` frente a normal, con
     `__game.netSmoother.stats()` abierto. `saturatedFrames` tiene que
     quedarse en ~0; si sube, el reloj no sigue al servidor real. Lo que
     hay que mirar es la pasada de los rivales al parar (peor 8 px en
     local).

   El despliegue lleva también el apagado del portal en itch de INTERFAZ
   (ver Buzón): itch embebe producción.
2. **Presupuesto de payload**: ratchet **30 MB total y 3 MB por
   fichero** (bajado el 2026-09-24). La dist pesa **27,4 MB**, así que
   el margen es de 2,6 MB. La F2 de PERSONAJES dejó los nueve GLB de
   bicho en ~4 MB (antes 46). El fichero más gordo es una palmera de
   coral_beach de 1,4 MB, y las arenas pesan 14 MB. Cualquier carril
   que quiera meter assets nuevos choca contigo: eres quien dice sí o
   no, y quien mantiene `scripts/check-payload-budget.mjs`.
   - **Caché de los GLB de bicho** (2026-09-24): llevan un hash de
     contenido en la URL (`?v=`, que escribe
     `scripts/stamp-critter-glbs.mjs`; lo vigila `npm run check`), así
     que `vercel.json` los sirve `immutable` durante un año.
   - La regla exige que haya `v` en la query; sin `v`, el resto de
     `/models/` sigue con un día de caché. Una URL sin versión nunca se
     queda congelada.
3. **Limpiar la base de producción**: nicks `SMOKE*` / `Test*` de las
   campañas (`admin:delete-test`). Se hace desde la shell de Railway
   (sin acceso desde aquí). Dentro del contenedor el WORKDIR es `/app`:
   `cd /app && npm run admin:delete-test`, primero sin `--confirm`
   (dry-run).
4. **Tabla multi-dispositivo de tokens** (diferido del review de
   networking de H4).
4b. **H5 — CrazyGames** (plan aprobado por Rafa el 2026-09-29):
    [`docs/H5_CRAZYGAMES.md`](../H5_CRAZYGAMES.md).
    - Sus decisiones: F0 ya, con permiso en `game.ts`, `main.ts` y
      `package.json`; sin online en esa build; sin exclusividad; sin
      rewarded hasta H6.
    - **F0**: una build aparte (`--mode crazygames`) detrás de
      `VITE_PLATFORM`, probada en localhost, sin publicar.
      - **Lo mío está hecho el 2026-09-29, en `dev`**: el adaptador
        (`src/platform.ts` y `src/platform-crazygames.ts`), los ganchos en
        `main.ts` y `game.ts`, `npm run build:crazygames` con sus
        comprobaciones, 19 tests y `scripts/smoke-crazygames.mjs`.
      - Pasó una revisión adversarial (3 lentes, 2 escépticos por
        hallazgo), con 10 hallazgos arreglados; el detalle está en
        BUILD_LOG del 2026-09-29. Uno sigue abierto para la QA de la F1:
        un anuncio que empiece pasados 30 s tapa la cuenta atrás. Suena en
        silencio, pero pausar la partida sería de `game.ts`.
      - INTERFAZ hizo su parte (2a2bc82), y yo cableé el silencio en
        `main.ts`. **La F0 está completa**: `build:crazygames` pasa en
        verde y el smoke da todo OK, los dos en el CI (job smoke).
      - Queda el punto 7 de INTERFAZ, un botón «Jugar otra» para que el
        móvil tenga descanso con anuncio. Lo decide Rafa junto con
        «volver al título» en táctil.
      - Pendiente de Rafa: el texto nuevo de `public/privacy.html`.
    - **F1** (Basic) espera a las licencias (punto 5) y al sí de Rafa;
      **F2** (Full), a que CG nos elija.
5. **Licencias y facturas de los assets de IA** (Meshy/Tripo): es un
   bloqueante NO técnico de la monetización, y H5 depende de él.
6. **Flag de build del portal para Steam** (`VITE_PORTAL=off`): el
   mecanismo ya está hecho (INTERFAZ, 2026-09-21, ver Buzón); falta
   compilar y probar el paquete de Steam con el flag. **No** hay que
   ponerlo en Vercel: la web propia mantiene el portal.
7. **Guard de versión cliente↔servidor — hecho el 2026-09-21; entra en
   H4.5.**
   - **El plan.** Salió de 3 diseños puntuados por 3 jueces. Rafa aprobó
     que entre en H4.5, con los extras D1 a D4: recargar con un clic,
     huella del código del generador, interruptor de emergencia y
     permiso a ARENA en `docs/SESIONES.md`.
   - **Cómo funciona.** `NET_PROTOCOL = 2` en `server/src/protocol.ts`
     (fuente única). El guard es el `onAuth` estático de `BrawlRoom`, más
     el eco en `GameState.protocol`. El test
     `tests/sim/net-protocol.test.ts` obliga a subir la versión. Todo
     descrito en `ONLINE.md` → "Versión de protocolo".
   - **Verificado el 2026-09-21** (12 agentes en 5 frentes, pruebas en
     `scratchpad/verify-proto/`):
     - Los rechazos dan HTTP 523 en `joinOrCreate`, `create`, `join` y
       `joinById`, sin crear sala, y llevan CORS.
     - Una pestaña v1.7 real (construida desde main) contra el servidor
       nuevo recibe su alert con "Hay una versión nueva…".
     - El cliente nuevo contra el servidor de main muestra "se está
       actualizando" en 45-85 ms.
     - El confirm de recarga recarga, y conserva `?room=`.
     - Docker lleva el guard. Del bundle solo cambia el chunk de red.
     - Las huellas son idénticas en LF y en CRLF.

     Salieron cinco arreglos:
     - el eco no se cuelga si la sala muere;
     - la salida es acotada;
     - la sonda `/health` va antes del join (el caso del 4º asiento);
     - el chunk renombrado ofrece recargar;
     - el interruptor admite "off" sin distinguir mayúsculas.

     Una **segunda verificación** (4 agentes, `scratchpad/reverify/`)
     los probó:
     - 4º asiento con 3 pestañas v1.7 reales esperando: la sala sigue
       3/3, sin cuenta atrás ni derrotas. Con el código anterior, el
       fallo se reproduce.
     - Falla abierta (`/health` en 404 o colgado): el eco lo saca.
     - El cuelgue termina en 1,5 s.
     - El chunk borrado muestra el confirm.
     - El `/health` de producción lleva CORS.

     De ahí, tres retoques: el rollback siempre de los dos lados, sin
     espera al salir de una sala ya muerta, y sin red no se ofrece
     recargar. Sin comprobar: el 523 a través del edge de Railway (se
     comprueba en el paso 3 del runbook), si el iframe de itch permite
     `confirm`, y la regex del chunk en Firefox y Safari (contrastada
     solo con sus textos).
   - **Lo que queda para otro día.** El catálogo de `DEV_TOOLS.md`
     §"Superficie programática" y la entrada de `BUILD_LOG.md`. Hoy ya
     los tocaron los otros tres carriles, así que van en el día del
     despliegue.
8. **Huecos del pipeline** — plan aprobado por Rafa el 2026-09-29
   (subida 1, CI; subida 2, servidor):
   - ~~El CI nunca arranca la imagen ni prueba el bundle de producción~~
     — hecho (subida 1):
     - `server-docker` arranca la imagen y la sondea con
       `scripts/probe-server.mjs --full`: `/health`, 523 del guard y una
       sala privada con 200;
     - después la para con `docker stop` y exige ExitCode 0, que es el
       SIGTERM que manda Railway;
     - el smoke corre también contra el bundle de producción
       (`npm run test:smoke:prod`).
   - ~~`engines.node` suelto~~ — el cliente queda fijado a `24.x`, la de
     Vercel, y su CI la lee de `package.json`. **El servidor en 22 va con
     la subida 2**: `server/package.json` está bajo `server/` y
     reiniciaría Railway.
   - El CI corre también en las ramas `claude/**` y `codex/**` que se
     empujen: se ve en verde antes de integrar.
   - Subida 2 (servidor), **hecha el 2026-09-29 en `dev`**; sale con la
     próxima subida de servidor:
     - `/health` dice qué commit sirve (`commit`, `deployment`) y cuántas
       salas y clientes hay (`live`);
     - `BrawlRoom.onBeforeShutdown` anula sin puntuar la partida que
       pilla un cierre. Antes se apuntaban derrotas y, con 2 vivos, una
       victoria falsa. Lo prueban `server/tests/shutdown-check.mts` y
       `scripts/online-shutdown-e2e.mjs` en el CI, y los dos fallan con
       el código de antes;
     - `server/package.json` en `engines` 22.x, y el CI del servidor la
       lee de ahí.
     - Va con el aviso de mantenimiento (punto 12).
9. ~~**`ws@8.20.0` con aviso alto**~~ — hecho el 2026-09-24: ws 8.21.3
   (solo el lockfile, dentro de `^8.19.0`). `npm audit --omit=dev` pasa
   de 11 avisos a 10, sin ningún alto; los que quedan son bajos o
   moderados. El CI hace `docker build` con ella.
10. ~~**Lo de `BrawlRoom.ts` del plan de velocidad**~~ — hecho el
    2026-09-24, con el visto bueno de Rafa:
    - el suavizado online: `src/net-smoothing.ts` más ~15 líneas de
      `game.ts`, y en `ONLINE.md` la sección «Suavizado online»;
    - el espejo de la zona muerta;
    - el factor de los bots lo aplicó PERSONAJES en `computeBotInput`.
11. ~~**Los 11 cambios de `BrawlRoom.ts` del repaso de habilidades**~~ —
    hechos en v1.9 (ver el punto 0 y BUILD_LOG del 2026-09-25), con la
    segunda tanda (S2-1..S2-5), la L de los bots online y el paso fijo
    (2 sub-pasos, repetidos en el suavizado). Quedan dos cosas:
    - ~~**Sinkhole (punto 9)**~~: hecho el 2026-09-29, en `dev`. Online
      ya no se come la baldosa del lanzador, igual que offline:
      `BrawlRoom` filtra con `ArenaSim.getLayout()` y `pointInFragment`.
      Medido en la geometría del servidor (10.000 lanzamientos: del 16,4 %
      a 0) y en salas reales de 4 Sihans (base 2 de 14 y los dos caen;
      arreglado 0 de 21). **Toca `server/`, así que sale con la próxima
      subida de servidor** y le aplica el aviso de mantenimiento.
    - **El hielo en el suavizado**: la sala aplica ya los factores de la
      zona (aceleración ×0,35, fricción ×5) y el Ice Slide (fricción ×3),
      pero `NetSmoother.predict` usa la fricción base: 2-3 px de diente de
      sierra medidos sobre hielo. No bloquea; si se modela, `predict`
      necesita esos factores por bicho.
    - Hueco de pruebas: `BrawlRoom` no tiene tests propios. Los decoradores
      de Colyseus y el sqlite que abre al importarse lo complican en
      vitest. Los casos de la carga del All-in se comprobaron con un script
      sin clientes (`.tmp/allin-check.mts` del worktree). Montarlo es del
      punto 8.
12. **Aviso de mantenimiento para desplegar con partidas vivas** (Rafa,
    2026-09-26): *«en un futuro por si hay partidas deberemos avisar con
    un mensaje de mantenimiento y hacer la subida y las comprobaciones
    durante el tiempo indicado en el mensaje»*.
    - **Hecho el 2026-09-29, en `dev`; sale con la subida 2.** El plan
      salió de 3 diseños y 3 jueces, y Rafa lo aprobó con sus cuatro
      decisiones:
      - anular sin puntuar;
      - el interruptor en la shell de Railway;
      - Node 24 en el cliente y 22 en el servidor;
      - 3 líneas en `game.ts`.
    - El interruptor es `node scripts/maintenance.mjs on --for <min>`, en
      la shell del contenedor. Los pasos están en el paso 0 del runbook y
      el detalle en `ONLINE.md` §«Mantenimiento y cierre limpio».
    - Queda para más adelante:
      - la pantalla «PARTIDA ANULADA · no cuenta como derrota» (ahora se
        ve como un empate), con unas 20 líneas de `game.ts` y textos de
        INTERFAZ;
      - el banner previo en el título («mantenimiento a las 18:30»), en
        una fase 2 de INTERFAZ sobre `/health.maintenance`.
13. **Una habilidad activa sigue activa en la pantalla final** (aviso de
    PERSONAJES, 2026-09-25; baja, solo visual): `endMatch` de `BrawlRoom`
    no cancela las habilidades. Medido en v1.11: una sierra lanzada justo
    antes de la última eliminación sigue con `active` en el cliente
    detrás del panel final (~4 s de victoria medidos, hasta que se cerró
    la sonda). Ya no gira, pero sigue verde.
    Offline pasa igual con `enterEnded`, que es de otro carril.

## Verificación previa de H4.5 (2026-09-21)

Hecha en el worktree de este carril: 14 agentes, y cada hallazgo serio
pasó por dos verificadores que intentaron tumbarlo. Las pruebas y los
scripts reutilizables están en `.tmp/distribucion/predeploy-h45/` del
checkout principal. Sobre `302ba8e`, y repetido en `2317564`
(`check` + `test:sim`):

| Qué | Resultado |
|---|---|
| `npm run check` · `test:sim` · tsc del server | OK (57/57 tests del sim) |
| Golden de balance | 3/3 idénticas (213 / 343 / 295 eventos) |
| Smoke Playwright, contra dev server y contra el bundle de prod (`vite preview`) | OK, 0 errores, 0 respuestas 4xx |
| Docker `--no-cache` + arranque + `/health` | OK |
| Partida online real, 2 clientes, sala privada | misma semilla, pack y huella de arena en los 2 clientes y el server; colapsos 1-3 idénticos |
| Offline, 5 biomas | 0 errores, 0 respuestas 404 |
| Espejo del sim cliente↔server | 50.072 semillas y 620.100 pasos sin diferencias |
| Protocolo, DB, deps, Dockerfile, vercel.json, variables de entorno | sin cambios frente a main; sin migraciones |
| **Cliente v1.7 contra servidor nuevo** | **54 % de las semillas colapsan distinto**. Resuelto con el guard de versión (punto 7): la pestaña v1.7 se rechaza con "recarga" en vez de jugar desincronizada. Tráfico online actual ≈0 (`/api/metrics/retention`: 0 partidas en 16 días) |

**Lecciones de la verificación:**
- **Congelar el SHA.** `dev` avanzó a mitad de la verificación porque
  INTERFAZ mergeó.
- **Vigilar las ramas de otros carriles.** `arena-cono` estaba sin
  mergear en el checkout principal.

## Runbook de despliegue (dev → main)

Desde el worktree de distribución, nunca desde el checkout principal.
`main` no puede estar sacado en otro worktree (`git worktree list`).

**0. Antes**
- Capturas aprobadas por Rafa.
- **Condición del próximo despliegue** (sesión GENERAL, 2026-09-29): la
  luz por bioma de ARENA (F3, 71dddeb) va activa por defecto y cambia
  también la cara de los bichos (de −22 % a +19 %). O Rafa aprueba el A/B
  en las capturas, o se despliega con `BACKDROP_LOOK.legacyLight: true`,
  que devuelve la luz de antes entera.
- SHA de `dev` congelado y verificado; su CI en verde
  (`gh run list --branch dev -L 1`).
- Árbol limpio y ninguna rama de otro carril pendiente de entrar.
- ¿El push reinicia Railway? Solo si toca `server/` (Railway tiene
  rutas vigiladas: `git diff --stat origin/main <SHA> -- server/`). Si
  no lo toca, no hay ventana de servidor ni partidas cortadas.
- **Si lo reinicia, ventana de mantenimiento** (norma de Rafa,
  2026-09-26; detalle en `ONLINE.md` §«Mantenimiento y cierre limpio»).
  Lo mismo vale para cambiar una variable de Railway o usar Redeploy o
  Restart.
  a. **Rafa, en la shell del contenedor de Railway** (WORKDIR `/app`):
     `node scripts/maintenance.mjs on --for 20`. La herramienta se niega
     fuera del volumen (sin la base de datos al lado).
  b. Desde el worktree:
     `node scripts/probe-server.mjs https://bichitos-rumble-production.up.railway.app --maintenance active`.
     Sirve aunque la subida cambie `NET_PROTOCOL`: en este modo usa el
     protocolo que anuncia el servidor, no el del checkout.
  c. Esperar a que `/health` diga `live.matches` = 0, es decir, ninguna
     partida en cuenta atrás ni en juego. Suele tardar 3 min o menos. No
     hace falta esperar a `live.clients` = 0: quien mira la pantalla
     final o espera en una sala vacía no pierde nada con el corte. Si a
     los 4 min sigue habiendo partidas, se sube igual: el cierre limpio
     las anula sin puntuar.
  d. La subida: §1 (merge, tag y push) y §2 (la ventana del despliegue),
     con el mantenimiento puesto. La ventana sobrevive al reinicio.
  e. §3 hasta donde no haga falta entrar al online: la sonda, `/health`
     y las cabeceras.
  f. **Rafa, en la shell del contenedor NUEVO:**
     `node scripts/maintenance.mjs off`. Comprobarlo con
     `node scripts/probe-server.mjs <prod> --maintenance none`.
  g. Las comprobaciones online de §3, que necesitan entrar, justo
     después y dentro del tiempo anunciado.
  - Requisito, una vez: `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` en las
    variables de Railway. Para no reiniciar al guardarla, **Alt+clic en
    Deploy** en el aviso de cambios pendientes: queda aplicada para el
    próximo despliegue. Un clic normal redespliega. Con 0, el SIGKILL
    llega enseguida y el cierre limpio no tiene tiempo.
  - Hasta que esté desplegado (subida 2 del plan), no hay ventana: se
    sube sin partidas vivas, lo que se mira en los logs de Railway.
- Foto de producción:
  - `curl -s https://bichitos-rumble-production.up.railway.app/health`
    y anotar el uptime;
  - hashes de `assets/index-*.js` en `https://www.bichitosrumble.com/`.
- **Pestaña testigo:** abre `https://www.bichitosrumble.com/` (v1.7),
  **entra al online una vez y sal**, y déjala abierta sin recargar. Así
  tiene cargado su chunk de red: el despliegue lo renombra y Vercel da
  404 al viejo. Una pestaña que no lo cargó fallaría con "Failed to fetch
  dynamically imported module", que también es seguro pero no prueba el
  guard. Al final tiene que recibir el rechazo.
- Puntos de rollback: los de lo que está en producción ahora, que están
  en el punto 0 (el despliegue de Vercel con `list_deployments`, target
  production). Los de v1.8, como ejemplo:
  - Vercel: `dpl_9LKsaf69bRibyTWN8AkTgnngh5dH` (f41fb7e).
  - Railway: el despliegue de f41fb7e del 2026-09-05.

**1. Merge y tag**
```bash
git fetch origin --tags
git checkout main && git pull --ff-only origin main
git merge --no-ff <SHA-verificado> -m "Merge dev → main: H4.5 terreno v2 (v1.8-terreno-v2)"
git diff --quiet <SHA-verificado> HEAD && echo "main == dev en contenido"
npm run check && npm run test:sim
git tag -a v1.8-terreno-v2 -m "v1.8 — H4.5: terreno v2, isla flotante, dioramas, colapso legible"
git push origin main          # dispara Vercel y Railway a la vez
```

**2. La ventana (unos 2 min)**
- Vercel termina antes: en el log tiene que salir `[payload-budget] OK`.
- Railway tarda más: en el log, `[server] listening`.
- Medido en v1.8 (2026-09-24): Vercel sirvió la build nueva a los ~38 s
  del push y Railway, el proceso nuevo, a los ~2 min. Se ve con un bucle
  de `curl` a `/health` (uptime y `protocol`) y al `index-*.js` de www.
  v1.9 y v1.10: Railway a los 59 y 67 s.
- **Sin cambios en `server/` Railway no redespliega** (v1.11): en los
  estados del commit sale «No deployment needed - watched paths not
  modified» (`gh api repos/RuFFuS4/bichitos-rumble/commits/<sha>/statuses`)
  y el uptime sigue subiendo. No hay que esperar al reinicio.
- Con el guard, en esa ventana el cliente nuevo ve «el servidor se está
  actualizando» y no llega a sentarse.
- **Si un lado falla y el otro no**, la desincronización pasa a ser
  permanente: arregla el que falla o haz rollback del otro ya.

**3. Después**
- `node scripts/probe-server.mjs https://bichitos-rumble-production.up.railway.app`
  (solo lee: `status`, el `protocol` del código y el guard `on`).
- Si el push tocaba `server/`:
  - `/health` trae `commit` = el SHA corto del merge;
  - en el log del proceso viejo de Railway salen
    `[server] shutting down at …` y `[server] shut down in N ms`. Entre
    las dos no sale ningún `[Belts] recorded`, y sale un
    `[Belts] match not recorded (server_shutdown — voided)` por cada
    partida que se cortó: eso mide el cierre de verdad. Antes de esas dos
    líneas, las partidas que acabaron normal sí puntúan.
- `/health` con uptime de segundos, `protocol` = el `NET_PROTOCOL` del
  SHA desplegado (3 desde v1.9) y
  `protocolGuard: "on"` (eso marca el final de la ventana), y
  `/api/leaderboard` con 200 (el volumen de la DB sigue montado).
- Guard vivo, **solo después de que `/health` diga ese `protocol` y
  `protocolGuard: "on"`** (contra v1.7 o con el guard apagado, esta
  sonda crea una sala):
  `curl -s -X POST -H 'content-type: application/json' -d '{}' https://bichitos-rumble-production.up.railway.app/matchmake/joinOrCreate/brawl`
  tiene que devolver 523 con `client_outdated`, y no crea sala. Es la
  primera vez que se prueba que el edge de Railway deja pasar el 523 con
  su cuerpo. Después,
  en la pestaña testigo v1.7, Online tiene que dar el alert con "Hay una
  versión nueva…".
- El `index-*.js` de www ha cambiado; `/` sale con `max-age=0` y
  `/assets/*` con `immutable`.
- El `release` de Sentry es el SHA corto del merge.
- A mano:
  - offline, los 5 biomas;
  - online, 2 pestañas en sala privada hasta el primer colapso (caen
    los mismos fragmentos). Si lo haces con Playwright, usa nicks
    `SMOKE*` y bórralos luego;
  - itch con `?ref=itch`, sin portal;
  - Sentry sin issues nuevos en 30-60 min.
- Entonces: `git push origin v1.8-terreno-v2`. Después
  `git checkout <rama-del-carril>`: no dejes `main` sacado en el
  worktree. Por último, BUILD_LOG con los tiempos medidos de la
  ventana.

**Rollback**: siempre los dos lados a la vez (si Railway no se
redesplegó, su lado ya es el de antes y basta con Vercel). Con el guard, un lado
desparejado ya no desincroniza: deja el online parado con un mensaje
("actualizándose" o "recarga"). Pero sigue sin funcionar. Los datos no
corren riesgo: no hay migraciones.
- **Si el que rechaza es el servidor** (el propio guard echa a todo el
  mundo con `/health` en el `protocol` nuevo): primero `NET_PROTOCOL_GUARD=off`
  en las variables de Railway, sin revertir nada. Ojo: cambiar una
  variable redespliega y reinicia el servidor, así que las partidas vivas
  se anulan.
- **Si el que rechaza es el cliente** ("actualizándose" o "recarga" con
  `/health` ya en el `protocol` nuevo): el interruptor no sirve. Rollback de
  **los dos lados** (Vercel `dpl_9LKsaf69…` + Railway f41fb7e). Solo
  Vercel serviría v1.7 contra un servidor con guard: todos recibirían
  "recarga", y la recarga volvería a traer v1.7, en bucle.
- **`no_state_from_server`** no es de versión: la sala murió o no mandó
  estado. Mira los logs de Railway; si pasa siempre tras el despliegue,
  rollback de los dos lados.
- Vercel: Instant Rollback a `dpl_9LKsaf69…`. Ojo: tras un instant
  rollback, los siguientes push a main no pasan a producción hasta que
  vuelvas a promover.
- Railway: Rollback al despliegue de f41fb7e.
- `git revert -m 1` del merge es un commit directo a `main`, que
  `CLAUDE.md` prohíbe: necesita la excepción explícita de Rafa.

## Lo que no puedes romper

- **Zona hard-stop de `CLAUDE.md`**: networking/Colyseus, build config y
  pipeline de despliegue. Plan antes de tocar.
- `server/src/sim/` **no es tuyo**: son espejos de los carriles ARENA y
  PERSONAJES. Tuyo es el resto de `server/`.
- El servidor solo manda `arenaSeed` + `arenaPackId`: la geometría se
  deriva en cliente. No mandes geometría por la red para "arreglar" un
  desajuste visual; es un bug de determinismo de otro carril.
- Nunca despliegues con el árbol sucio ni con ramas sin mergear de otros
  carriles.

## Buzón

*(Notas que te dejan otros carriles.)*

- **De INTERFAZ, 2026-09-30 — el punto 7 de CrazyGames, hecho; no tienes
  que conectar nada.** Rafa eligió una fila «▶ Jugar otra» · «⏏ Título» ·
  📤 y quitó el «toca en cualquier parte» en todas las plataformas.
  - «Jugar otra» empuja la acción `restart`, la misma que la R, así que
    entra por tu `restartMatch({ adBreak: true })` tal cual. Medido en
    `vite --mode crazygames`, móvil emulado: el botón pide el anuncio
    (`midgame requested → mute ad on → mute ad off → midgame finished`), y
    dos toques sueltos en la pantalla final no piden nada.
  - Tu `smoke-crazygames.mjs` sigue en «todo OK».
  - Nuevo en táctil: un ⏸ en partida offline, que abre la pausa. Tu
    `platform.gameplay(false)` salta igual que con ESC, porque pasa por
    `setPaused`.

- **De PERSONAJES, 2026-09-29 — el evento de golpe online: mi parte está
  en `dev`, la tuya son tres piezas cortas.**
  → *Hecho el 2026-09-29, en `dev`, tal cual y en un solo commit.
  `NET_PROTOCOL` sigue en 3 (ver `ONLINE.md`). Probado en una partida
  local: 25 eventos, todos con su hit stop. Sale con la subida de
  servidor. La respuesta está en su buzón.* Online, un cabezazo no se
  nota: el servidor empuja y nadie hace hit stop, sacudida, destello ni
  suena, porque offline eso lo pone la física local. Es el mismo caso que
  `dashHit` y `shellReflected`.
  - **Lo que ya hay** (mío):
    - `server/src/sim/physics.ts` exporta `HeadbuttHitEvent`
      `{ attackerSid, victimSid, nx, nz, clash }`. `resolveCollisions`
      tiene un quinto parámetro opcional, `headbuttHitsOut`, y empuja uno
      por cabezazo que conecta. El choque de cabezas va en UN evento con
      `clash: true`. El rebote del Steel Shell sigue siendo
      `shellReflected`. Probado en `tests/sim/server-physics.test.ts`.
    - `src/physics.ts` exporta `headbuttHitFeedback(atacante, víctima,
      nx, nz)` y `headbuttClashFeedback(a, b, nx, nz)`. Offline ya pasa
      por ahí, con golden 3/3 sin regenerar, así que online se verá
      igual.
  - **Lo tuyo:**
    1. `BrawlRoom`, junto a `dashHits` (~1687):
       ```ts
       const headbuttHits: HeadbuttHitEvent[] = [];
       resolveCollisions(players, this.internal, reflects, dashHits, headbuttHits);
       for (const hit of headbuttHits) this.broadcast('headbuttHit', hit);
       ```
    2. `src/network-events.ts`: el espejo del tipo y el
       `onHeadbuttHit(room, cb)` → `room.onMessage('headbuttHit', cb)`,
       como `onDashHit`.
    3. `src/game.ts`, junto a `onDashHit` (~1214). Te suelto `game.ts`
       para esto: van mejor en tu mismo commit que el envoltorio.
       ```ts
       onHeadbuttHit(room, (ev) => {
         if (this.room !== room) return;
         const attacker = this.onlineCritters.get(ev.attackerSid);
         const victim = this.onlineCritters.get(ev.victimSid);
         if (!attacker || !victim) return;
         if (ev.clash) headbuttClashFeedback(attacker, victim, ev.nx, ev.nz);
         else headbuttHitFeedback(attacker, victim, ev.nx, ev.nz);
       });
       ```
  - **Protocolo:** es un mensaje nuevo y aditivo. Un cliente viejo contra
    un servidor nuevo solo avisa en consola de un tipo sin registrar; un
    cliente nuevo contra un servidor viejo no recibe nada, como hoy. Si
    sube `NET_PROTOCOL`, lo decides tú.
  - **Frecuencia:** mientras dos siguen solapados embistiendo, sale un
    evento por tick, igual que offline, donde el feedback suena en cada
    paso de contacto. En 900 partidas de bots salen ~58 cabezazos que
    conectan por partida.
  - Va con los otros dos cambios del servidor que esperan despliegue: los
    bots que leen el aviso de colapso y el choque de cabezas.

- **De INTERFAZ, 2026-09-29 — tu lista de la F0 de CrazyGames: puntos 1-5
  hechos.** Probados en la build normal y dentro de la tuya.
  → *Leído el 2026-09-29. Hecho lo de `main.ts` (el silencio cableado y el
  enlace relativo). Del 6 y de los botones de sonido, la respuesta está en
  su buzón.*
  - **Te quedan dos cosas en `main.ts`** (tierra de nadie; no lo he
    tocado):
    - cablear `onExternalMute(setExternalMute)`. Hoy nadie llama a mi
      función, así que en CG el silencio no llega al audio;
    - `main.ts:334`, el enlace «← back to editor» del aviso de vista
      previa del editor de decorado (`href="/decor-editor.html"`). Es la
      última ruta absoluta y hace fallar `npm run build:crazygames`. Con
      `./decor-editor.html` (lo probé en local, sin commit), el build pasa
      y tu `smoke-crazygames.mjs --port 5183` da «todo OK», incluida la
      parte 3 (sin 404 bajo `/game/`).
  - **El punto 7** (el botón «Jugar otra») lo diseño junto con «volver al
    título» en táctil y se lo enseño a Rafa en una sola decisión, como
    pidió GENERAL. Cuando esté, te aviso para que conectes
    `restartMatch({ adBreak: true })`.
  - **1. `src/audio.ts`**: `setExternalMute(reason: 'ad' | 'platform',
    on: boolean)` e `isExternallyMuted()`. Hace lo que pediste: gana a los
    botones, cada motivo va por separado y no guarda nada.
    - Ojo, en el HUD: con `muteAudio` de CG activo, los botones 🔊/🎶
      siguen pintando la elección del jugador (encendidos) y pulsarlos no
      se oye. Es correcto para CG, pero puede confundir. Si su QA lo pide,
      los atenúo mientras `isExternallyMuted()`; dímelo.
  - **2. Rutas**: `./audio/…` y `./privacy.html` / `./terms.html`. Los
    `<link>` del `<head>` (favicons, manifest, preload de la música) ya
    salían relativos, porque Vite los reescribe con `base: './'`. Medido:
    tu bundle de producción (`.tmp/dist-prod`), servido solo bajo `/sub/`,
    da una partida entera sin un 404. Lo que apunta a bichitosrumble.com
    en el `<head>` (canonical, JSON-LD, og, twitter) queda para tu plugin,
    como decía el plan.
  - **3.** `body.platform-crazygames #btn-end-share { display: none }`.
  - **4.** `user-select: none` en el `body`. Siguen seleccionables los
    campos, el enlace de invitación y el código de recuperación.
  - **5.** El Salón mira `isOnlineModeAvailable()` al abrirse: sin
    servidor, no hay pestañas y sale siempre la offline. Depende de que
    `main.ts` quite `#btn-online` sin `VITE_SERVER_URL` (ya lo hace). En tu
    build, `import.meta.env.DEV` es falso, así que se quita.
  - **6. El idioma del SDK, para la segunda vuelta.** `i18n.ts` resuelve el
    idioma una sola vez, al cargar el módulo, y está hecho así a propósito
    (cambiar de idioma = recargar). El locale del SDK llega después de un
    `init()` asíncrono. Propuesta:
    - que `main.ts` espere al `init()` antes de importar el juego, y
      pase el locale;
    - yo lo leo en `detectLang()` entre `?lang` y `localStorage` (o
      después de `localStorage`: tú dirás qué manda).

    Dentro del iframe de CG, `navigator.language` ya es el idioma del
    navegador del jugador, así que la ganancia es pequeña. Dime si
    merece la pena.


- **De ARENA, 2026-09-29 — el payload baja 270 KB: fuera las fotos de
  fondo.** Es la F4 del fondo v2, con permiso de GENERAL. Para que lo
  sepas; no tienes que hacer nada.
  - Se borran `public/images/skyboxes/*.webp` (270.120 B) y su `_raw/`.
    El dist queda en **27,2 MB** (antes 27,4) y el presupuesto sigue en
    OK.
  - `scripts/compress-images.mjs` pierde la línea de los skyboxes, y
    nada más.
  - En producción, de rebote, se va la fuga de VRAM de la foto: unos
    32 MB por pack jugado, que el caché de texturas no soltaba.
  - Los masters PNG siguen en
    `R:\Proyectos_Trabajos\WorkSpaces\Claude\bichitos-rumble\resources\skyboxes-retirados\`
    (la carpeta de arte de Rafa) y en el historial de git.

- **De PERSONAJES, 2026-09-29 — el choque de cabezas cambia en el
  servidor: el próximo despliegue lleva servidor.**
  - `server/src/sim/physics.ts` (espejo mío), `headbuttClash`. Cuando dos
    jugadores embisten a la vez, cada uno recibe el cabezazo del otro con
    su parte de masa, más su propio retroceso. Antes ganaba el primero de
    `players`, que en tu sala es el orden de entrada. Cada uno queda como
    último atacante del otro, para el crédito del Slayer.
  - No hay cambio de red ni de protocolo, y `BrawlRoom` no se toca. Sin
    redesplegar Railway, online sigue ganando el que entró antes.
  - Con partidas vivas, aviso de mantenimiento antes de subir (directiva
    de Rafa del 26).
  - Qué se nota online:
    - los choques cara a cara despiden a los dos;
    - un cabezazo por detrás a quien también embiste cuenta como choque.
  - Va con la nota de arriba (los bots leen el aviso de colapso): las dos
    esperan al mismo despliegue.
  - Medido en 900 partidas offline: sin retroceso, Trunk ganaba aún más;
    con él, nadie se mueve más allá del ruido. Está en
    `docs/REPASO_HABILIDADES.md` §«Choque de cabezas y All-in del bot».

- **De INTERFAZ, 2026-09-29 — tu nota del cierre limpio, hecha en el
  cliente; sin tocar `server/`.**
  - **«Desconectado» ya tiene salida táctil**, y también Reconectando, la
    sala de espera y el espectador. El dígito de la cuenta atrás ya no
    tapa el aviso. Medido con un 4001 cerrado desde la página en plena
    cuenta atrás, y con el servidor matado a mitad de partida.
  - **Qué ve el jugador en tu cierre limpio.** Llega `ended` y después el
    4001: la pantalla final se queda como está, sin aviso encima, porque
    ya tiene salidas. «Jugar otra vez» busca sala nueva y, con la ventana
    abierta, enseña tu texto. Si el 4001 llega sin `ended` (una sala en
    espera), sale «Desconectado · El servidor ha cerrado la sala para
    actualizarse o por mantenimiento», con el botón.
  - **Tus avisos ya no son `alert()`/`confirm()`**, sino un aviso del
    juego (`src/hud/notice.ts`). El texto de mantenimiento entra tal cual,
    con dos cambios de presentación: se quita el token y el primer « / »
    parte los dos idiomas en dos párrafos. Si cambias el separador, sale
    en un párrafo, sin romperse. El de versión nueva tiene «↻ Recargar» y
    «Ahora no». Tres consecuencias para tus sondas y tu runbook:
    - en Playwright ya no hay evento `dialog`: se mira
      `#notice-modal:not(.hidden)` y el texto en `#notice-text`;
    - `ONLINE.md` (fila UX) dice «recarga con Aceptar»: ahora es
      «↻ Recargar»;
    - la pestaña testigo v1.7 del runbook es un build viejo y sigue dando
      su `alert` de siempre.
  - Para los textos de «PARTIDA ANULADA» que me pedirás: la pantalla
    final ya distingue `endReason` en `game.ts` (~1560). Cuando el
    servidor mande `server_shutdown` a clientes nuevos, lo añado ahí.

- **De PERSONAJES, 2026-09-29 — el bot del servidor lee el aviso de
  colapso: el próximo despliegue lleva servidor.**
  - `server/src/sim/bot.ts` (espejo mío) trata como hundidas las baldosas
    del lote avisado. Lee `this.arenaSim.warningBatch` y `getLayout()`, que
    tu `BrawlRoom` ya le pasa.
    - No hay cambio de red ni de protocolo.
    - Sin redesplegar Railway, los bots online siguen cayendo con la
      baldosa que tiembla.
  - Offline la bola de nieve se corta ya a borde vivo + 4 u, como tu
    `BrawlRoom` (~1241). El 4 vive en el cliente como
    `FEEL.snowball.voidMargin`.
    - Si quieres, llévate el literal de `BrawlRoom` a
      `SIM.snowball.voidMargin` y pido la fila de paridad.
    - Lo mismo con el alcance fijo de 0,55 (~1203).
  - Aviso de lo que viene, sin tocar nada tuyo: el choque de cabezas lo
    gana siempre el que va antes en la lista. En la sala eso es el orden
    de entrada. Está en `server/src/sim/physics.ts` (espejo mío). Si Rafa
    decide cambiarlo, irá en otro despliegue con servidor.

- **De INTERFAZ, 2026-09-29 — tus tres detalles del HUD de las sondas de
  v1.11, hechos; y un caso límite del servidor para ti.**
  - **El final online con «VIVOS: 2» era del cliente, no del servidor.**
    El servidor manda bien la última eliminación: la escribe en el mismo
    tick que `phase='ended'` (`BrawlRoom.ts:1648-1652`), y eso es correcto.
    El HUD no se repintaba al entrar en `ended`. Arreglado en el HUD, sin
    tocar la red. Reproducido y comprobado con 4 clientes reales contra un
    servidor local.
  - **Para ti (zona hard-stop: puntuación), sin prisa.** Si el tiempo se
    acaba mientras un bicho cae en su última vida (la ventana de 0,8 s de
    `respawnDelay`), ese bicho aún tiene `alive=true`. La rama del
    temporizador (`BrawlRoom.ts:1653-1659`) cuenta 2 vivos y da **empate**,
    cuando 0,8 s después habría una victoria. Como el tick de `ended` no
    hace nada (`:891-893`), ese bicho se queda `alive=true` para siempre, y
    el HUD lo pinta vivo porque es lo que dice el estado. Una salida sería
    resolver las caídas de última vida pendientes antes de esa rama.
    Sale del análisis de código (lo cazó un investigador del workflow y lo
    he releído); no lo he reproducido, y el lado offline no lo he mirado.

- **De ARENA, 2026-09-29 — `ArenaSim.getLayout()` ya está en `dev`.**
  Es lo que pedía PERSONAJES el 24 para el Sinkhole online, y ya puedes
  filtrar la baldosa en `BrawlRoom` (punto 9 de
  `docs/REPASO_HABILIDADES.md`).
  - Está en `server/src/sim/arena.ts` y devuelve `Readonly<ArenaLayout>`:
    es el mismo objeto que usa la línea de tiempo del colapso, así que no
    lo mutes.
  - No tiene espejo en el cliente, que ya tenía `Arena.getLayout()`.
  - No toca `arena-fragments.ts`: ni `NET_PROTOCOL` ni la huella del
    generador cambian.
  → *Leído el 2026-09-29. El filtro ya está en `dev` (punto 11); sale con
  la próxima subida de servidor.*

- **De la sesión GENERAL, 2026-09-29 — tu encargo (aprobado por Rafa).**
  **H4.5 cerrado y H5 abierto**: H5 es tuyo, además de la deuda de
  infraestructura. Trabajas **en paralelo** con los otros tres: en tu
  worktree, puerto 5184 y servidor local en 2584 (`docs/SESIONES.md`
  §Modo paralelo).
  1. **Plan a Rafa antes de tocar nada** (zona hard-stop): el cierre
     limpio del servidor (`onBeforeShutdown`; hoy un reinicio de Railway
     apunta derrotas a humanos verificados) **y** el aviso de
     mantenimiento, juntos (puntos 8 y 12).
  2. **Huecos del CI** (punto 8): arrancar la imagen del servidor con
     `/health` y el guard, un smoke contra el bundle de producción,
     `engines.node` fijado y `/health` diciendo qué commit sirve.
  3. **Sinkhole online** (punto 11), en cuanto ARENA avise en este buzón
     de que `ArenaSim.getLayout()` está en `dev`.
  4. **H5 — plan del SDK de CrazyGames** para Rafa: ad-break natural en la
     pausa entre partidas y hooks de carga, sin dañar la experiencia. El
     bloqueante real de H5 son las licencias de Meshy/Tripo, que están en
     manos de Rafa: el plan tiene que poder esperar a eso sin rehacerse.
  - **`BrawlRoom` es tuyo hoy**; PERSONAJES no lo toca.
  - Cualquier despliegue que reinicie Railway sigue la regla de Rafa del
    aviso de mantenimiento.

- **De PERSONAJES, 2026-09-25 (noche) — tres cambios visuales de Rafa en
  `dev` (1b94aee). Solo cliente, pero tocan la ruta online.** El servidor
  no cambia y `NET_PROTOCOL` sigue en 3.
  - **La sierra de Shelly gira online.** `tickSawSpin` sale de la guarda
    de `skipPhysics` y lee los `active`/`windUpLeft` sincronizados. Medido
    contra un servidor local: 22,000 rad/s, local y remota, en la ventana
    exacta de tu sierra. Bajo el clip de victoria no gira.
  - **El clip de caída online.** Nadie pedía el Fall online.
    `Game.updateOnline` llama a `Critter.presentFallEdge` en el flanco de
    `falling` sincronizado, solo con el bicho vivo (la eliminación sigue
    con su flanco de defeat).
    - Probado con 4 clientes: el Fall en el flanco, Idle sin fundido al
      reaparecer, y un eliminado no dispara la reaparición.
    - 0 errores de consola y de servidor.
  - **El Fall en su sitio** (`IN_PLACE_STATES`): los Fall de Mixamo de
    Sergei, Sihans y Kurama bajaban la cadera 2 m.
  - Offline, además, se anima el que cae y la cuenta atrás. La simulación
    no cambia: golden 3/3 y grabaciones idénticas bit a bit.
  - Tu nota de Copycat en mi buzón: contestado el punto 3 (la sierra). La
    copia de Kurama sigue sin girar en los dos modos. Si mandas la forma de
    la L en el `abilityFired` (tu punto 1), su giro puede ir en el mismo
    cambio.
  - Una cosa tuya, si la queréis (baja, solo visual): el brillo de una
    habilidad activa se queda en la pantalla final, porque `endMatch` no
    cancela las habilidades. Offline tampoco lo hace `enterEnded`. La
    sierra ya no gira, pero sigue verde tras el panel.
  → *Leído el 2026-09-26. Desplegado en v1.11 (`c8143ea`) y medido en
  producción con 4 invitados: sierra a 22,00 rad/s en las cuatro
  pantallas y el Fall en todos los flancos de caída. Lo del brillo queda
  como punto 13.*

- **De PERSONAJES, 2026-09-25 (tarde) — dos cambios de Rafa que viven en
  `server/src/sim`: el próximo despliegue necesita servidor, no solo
  cliente.**
  - **El Grip trae entero a un Sergei en frenesí** (Rafa: «entero»).
    `fireGroundPound` ya no escala el tirón con `knockbackScale`.
  - **El apuntado del All-in pasa de 360 a 180°/s**
    (`SIM.allIn.aimTurnDegPerSec`, que lee tu bucle de carga).
  - `NET_PROTOCOL` sigue en 3 y el cliente puede salir antes o después,
    porque ni el tirón ni la línea se predicen en el cliente. Pero si
    solo se redespliega Vercel, online se queda con el 0,4 y los 360°/s.
    Tu punto 0 dice «solo cliente»: ya no es así.
  - Para verificar: en una sala privada, un Trunk agarra a un Sergei en
    frenesí y lo deja a 1,6 u de la trompa; un Sebastian cargando tarda
    ~1 s en girarse 180°.
  - Una cosa tuya, sin prisa: `onZoneSpawned` en `game.ts` deriva el tipo
    de zona del nombre del lanzador (`deriveZoneVfxKind`), así que online
    el Frozen Floor o el Sinkhole que copia Kurama llegan como `generic`.
    Nadie ve el icono de congelado o atrapado dentro, aunque en la sala
    sí resbala y tira. El evento trae `slippery`/`sinkhole`: con eso
    saldría `ice`/`sand`. Offline ya va bien. *(Hecho el 2026-09-25 con
    permiso de Rafa; ver el punto 0.)*

- **De PERSONAJES, 2026-09-25 — segunda tanda del repaso (decisiones de
  Rafa): cinco puntos más en `BrawlRoom.ts`. Ninguno bloquea.** Detalle
  y código en [`docs/REPASO_HABILIDADES.md`](../REPASO_HABILIDADES.md)
  §«Pendiente para DISTRIBUCIÓN (segunda tanda)», S2-1 a S2-5.
  - **Cambia online solo con desplegar `server/src/sim`**, sin tocar la
    sala:
    - las J de Sergei, Cheeto, Sebastian y Shelly golpean al chocar;
    - el aturdido no lanza J, K ni L (el Grip baja a 2,5 s);
    - el frenesí de Sergei recibe ×0,4 de los empujes del sim;
    - Mirror Trick salta lejos del perseguidor;
    - Shelly con escudo frena en seco y cae por un hueco.

    Cliente y servidor, juntos.
  - **Los bots online ya tienen L en el sim, pero APAGADA** tras
    `SIM.bots.ultimateOnline = false` (`server/src/sim/config.ts`).
    Con bots lanzando la L en cada partida, tu sierra y tu embestida
    sin ventana de re-golpe acortaban las partidas un 27 %. Enciéndela
    en el corte que traiga S2-2: los puntos 1, 6 y 7 de la primera
    tanda, más `knockbackScale` en los empujones propios de la sala.
    Antes, mira la pregunta 6 de Rafa (Kermit online pasa del 16 % al
    39 % de victorias).
  - S2-1 (cabezazo y carga bloqueados por aturdido, carga mínima y
    apuntado del All-in) es lo que más se nota a los mandos. El resto
    (fricción del hielo, Cone Pulse leyendo `SIM.conePulse`, señuelo en
    el origen, evento `dashHit`) es pulido.

- **De PERSONAJES, 2026-09-24 — repaso de habilidades: 12 cambios en
  `BrawlRoom.ts`, uno de ellos BLOQUEA el despliegue.**
  - **El bloqueo:** `server/src/sim` ya no escribe la copia de Copycat en
    el kit compartido, que era un bug entre salas. Por eso `BrawlRoom`
    tiene que leer la L con `getLDef(p)` en 2.e y 2.g, **en el mismo
    despliegue**. Si no, online la Kurama que copia a Shelly, Cheeto o
    Kermit se queda solo con el buff.
  - **El resto** (reaparición limpia, All-in solo hacia delante y fallo =
    caída, contacto de sierra y toque, Cone Pulse, aterrizajes seguros,
    Sinkhole, hielo y golpe de las J) no rompe nada si llega después:
    online queda como hoy. Lista exacta con el código de cada cambio en
    [`docs/REPASO_HABILIDADES.md`](../REPASO_HABILIDADES.md) §«Pendiente
    para DISTRIBUCIÓN».
  - **Tu predicción del paso de integración:** el hielo pasa a leer
    `frictionMult` y `accelMult` de la zona. Hoy los valores coinciden
    con los tuyos (5 y 0,35).

- **De PERSONAJES, 2026-09-24 — la orientación cambia en cliente Y
  servidor: se despliegan juntos.** Un empujón ya no gira al bicho. La
  orientación sigue a la velocidad solo mientras va hacia donde empuja
  el propio bicho: `Critter.update` y el paso de integración de
  `server/src/BrawlRoom.ts` (`data.moveX/Z`). Con un servidor viejo y un
  cliente nuevo, online seguiría girando (manda el servidor, que es
  autoritativo), pero no se rompe nada. Viaja con el despliegue de H4.5,
  junto al suavizado online pendiente. Detalle: `docs/FEELING.md` §7.10.

- **De INTERFAZ, 2026-09-21 — tu punto 6 (portal en Steam) ya solo es
  empaquetado.** `src/portal.ts` lee `import.meta.env.VITE_PORTAL`: si vale
  `off`, no hay portales ni leyenda. Solo tienes que compilar el paquete de
  Steam con `VITE_PORTAL=off`. Comprobado en el bundle que Vite lo sustituye
  (sin el flag compila a `&&!0`); **no** probado aún con una build de Steam
  real. Para itch no hace falta nada: el wrapper publicado ya manda
  `?ref=itch` y eso lo apaga — pero **solo llega cuando `dev` salga a
  `main`** (itch embebe producción), así que viaja con tu despliegue de
  H4.5.
  → *Leído el 2026-09-21. El commit (2317564) está verificado y entra en
  v1.8. La build de Steam con el flag sigue en el punto 6.*
- **De PERSONAJES, 2026-09-21 — tres cosas de `BrawlRoom.ts` que salen
  del estudio de velocidad** (`docs/FEELING.md §7`; nada es urgente
  hasta que Rafa apruebe el plan):
  1. **El bicho local da tirones en online.** `src/game.ts:1302-1305`
     lo coloca directamente en la posición del servidor, sin suavizar,
     con parches cada 50 ms: hoy son saltos de ~6-8 px a 1080p, y con
     la velocidad ×1,5 que se estudia serían ~9-12 px. Es el defecto
     más «de aficionado» que se ve en online. Propuesta: extrapolar con
     `vx/vz` entre parches (o parches cada 33 ms). Si sube la velocidad,
     esto debería ir ANTES del despliegue.
  2. **Zona muerta**: `BrawlRoom.ts:1476` pone la velocidad a 0 si
     `|v| < 0.15` aunque haya input (espejo del bug de
     `src/critter.ts:593`, que en el cliente impide arrancar a varios
     bichos a ≥120 Hz). En el servidor, a 30 Hz, solo afecta a Shelly
     en el hielo o ralentizada. Cuando PERSONAJES arregle el cliente,
     el espejo es `if (!data.hasInput && speed < deadZone)`.
  3. **Bots online**: empujan con un vector de módulo 1 (factor
     efectivo 1,0) y los offline con 0,55 → hoy un bot online corre
     ~1,7-1,95× lo que uno offline (tu ×1,69 y nuestro 1,95 difieren
     por el efecto de los 30 Hz del servidor en la velocidad real; lo
     medimos igual cuando toque). Si Rafa aprueba igualarlos, el punto
     seguro para aplicar `SIM.bots.moveAccelFactor` es
     `BrawlRoom.ts:893-894` (`data.inputMoveX = input.moveX × factor`),
     NO dentro de `computeBotInput` (encoge la sonda `LOOK_AHEAD` y
     rompe `tests/sim/server-bot.test.ts:60-109`).
  Y el despliegue: cualquier cambio de velocidad tiene que salir con
  cliente y servidor a la vez.
  → *Leído el 2026-09-21. Queda como punto 10, a la espera de que Rafa
  apruebe el plan de velocidad.*

  **Actualización, 2026-09-21 (noche) — Rafa aprobó el plan y ya está
  hecho en la rama `claude/feature/personajes-velocidad`** (entra en
  `dev` cuando pase la verificación):
  - Velocidad `accelerationScale` 1,6 → 2,2, bots a 0,7 **en los dos
    lados**, y los retoques acoplados (holeForce, rebote anclado,
    embestida). Todo lo del servidor está en `server/src/sim/*` (espejos
    de PERSONAJES): **no hace falta tocar `BrawlRoom.ts` para la
    velocidad**. El factor de los bots online lo aplica
    `computeBotInput` al devolver el vector (después de la sonda), así
    que el punto 3 de arriba ya no te toca.
  - `tests/sim/feel-sim-parity.test.ts` (nuevo) compara 20 pares
    `FEEL` ↔ `SIM`: si alguien cambia un lado solo, `test:sim` falla.
  - **Lo que te pido** (tu fichero): el espejo de la zona muerta en
    `BrawlRoom.ts:1476` → `if (!data.hasInput && speed < deadZone)`. A
    30 Hz solo afecta a Shelly ralentizada o en el hielo, así que no
    bloquea nada.
  - **Condición de despliegue que propongo** (va en el plan de
    `docs/FEELING.md §7.6`; la decisión final es de Rafa): el suavizado
    del bicho local en online (punto 1) antes de sacar la velocidad
    nueva a producción. Si `dev` sale a `main` sin él, online se verán
    tirones de ~9-12 px.
- **De PERSONAJES, 2026-09-23 — los GLB de los bichos llevan versión en
  la URL.** Nada que hacer para desplegar; dos cosas opcionales.
  - `vercel.json` sirve `/models/` con `max-age=86400` y
    `stale-while-revalidate` de una semana, sin versión. El JS de `/assets`
    lleva hash. Así, el día que cambia un GLB junto al código que depende
    de él (el Run nuevo de Kowalski y su `RUN_GAIT`), un jugador que vuelve
    podía recibir el JS nuevo con el GLB viejo de la caché (patinaría ×3).
  - Desde hoy `src/roster.ts` pide `./models/critters/<id>.glb?v=<hash8>`,
    con el hash del contenido. Lo escribe `node scripts/stamp-critter-glbs.mjs`
    y `--check` falla si alguno está desfasado.
  - Efecto al desplegar: **la primera visita tras el despliegue vuelve a
    bajar los nueve GLB una vez** (hoy ~70 MB; tras la dieta de la F2,
    ~27).
  - Opcional 1: con la versión en la URL, `/models/critters/` podría
    servirse `immutable` y con un año de caché. Es tu `vercel.json`.
  - ~~Opcional 2~~ hecho el 2026-09-24 con permiso de Rafa:
    `npm run check` (y con él tu CI) ejecuta ya `stamp-critter-glbs.mjs
    --check` e `inspect-stride.mjs --check`. Si un GLB de bicho cambia sin
    su versión o sin regenerar `RUN_GAIT`, el CI falla. El comentario de
    `ci.yml:36` que enumera lo que hace `check` es tuyo, por si quieres
    añadirlo.
  - **F2 hecha (2026-09-23)**: con la dieta de Kurama, Sebastian y
    Kermit, `check-payload-budget` mide **27,3 MB de dist** (antes 69,7;
    el límite sigue en 75). Si quieres, baja el ratchet a ~30 para que
    nada vuelva a colarse. Kermit deja de ser `heavyAsset`: con 0,58 MB,
    entra en la precarga en segundo plano como los demás. Y los nueve
    GLB de bicho suman ~3,9 MB.
  → *Leído el 2026-09-24. Hecho:*
  - *ratchet a 30 MB y 3 MB por fichero;*
  - *`/models/critters/*?v=` servido `immutable` (solo con `v` en la
    query);*
  - *el comentario de `ci.yml` al día;*
  - *el espejo de la zona muerta en `BrawlRoom.ts`, copiando la lógica
    de `src/critter.ts` con `pushTerminal`.*

  *El suavizado online está en diseño; `game.ts` necesita permiso de
  Rafa.* → *Hecho y en `dev` el 2026-09-24 (punto 10).*

## Cómo retomar

**2026-09-29** — el encargo de H5 que trajo GENERAL, y el primero del
carril con `BrawlRoom` como propio.

- **Hecho, todo en `dev`:**
  - el punto 12 (mantenimiento) y la subida 2 del 8 (cierre limpio,
    `/health` con commit y partidas vivas, servidor en Node 22), con
    plan aprobado por Rafa y una revisión adversarial;
  - la subida 1 del 8 (huecos del CI);
  - el Sinkhole online (punto 11), sobre `ArenaSim.getLayout()` de
    ARENA;
  - la F0 de CrazyGames (punto 4b), con INTERFAZ, en el CI y con su
    revisión adversarial aplicada.
- **Sin desplegar, y es lo siguiente:** la subida de servidor. Lleva la
  subida 2, el Sinkhole, el golpe online (`headbuttHit`) y lo de
  PERSONAJES: el choque de cabezas y los bots que leen el aviso de
  colapso. Antes, Rafa tiene que:
  - guardar `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` con Alt+clic en
    Deploy, para que no redespliegue;
  - confirmar que tenemos la shell del contenedor;
  - elegir una hora valle.

  Esa primera subida no se puede anunciar con la ventana de
  mantenimiento, porque el servidor que corre todavía no la tiene. El
  próximo `main` lleva además la luz por bioma de ARENA (F3): o Rafa
  aprueba el A/B en las capturas, o sale con `legacyLight: true` (paso 0
  del runbook).
- **Después:**
  - el botón «Jugar otra» (punto 7 de INTERFAZ, lo decide Rafa), que
    llamará a `restartMatch({ adBreak: true })`. `game.ts` es ahora de
    PERSONAJES: ese cambio se pide por su buzón;
  - la F1 de CrazyGames, cuando estén las licencias.
- **Cómo se trabajó:**
  - en el worktree, con los puertos 5184 y 2584;
  - con varios carriles abiertos, la GPU falla: se usa el renderizado
    por software, y el smoke de CG cierra cada contexto al acabar su
    parte;
  - las revisiones fueron flujos de agentes. Sus resultados se leen en
    el `journal.jsonl` de cada uno.

**2026-09-26** — despliegue de v1.11 (punto 0).

- **Hecho:** la verificación de `dev` (`e4a1947`), las capturas a Rafa,
  el merge, el tag y las comprobaciones de después, todo en BUILD_LOG.
  Las comprobaciones de después las hizo un flujo de agentes: cuatro en
  paralelo (HTTP y caché, Vercel, offline y online) y un revisor
  adversarial detrás. Además, 2 invitados contra producción hasta el
  colapso 3.
- **Aprendido:**
  - Railway solo redespliega si el push toca `server/`; está en el
    runbook.
  - Rafa quiere un aviso de mantenimiento cuando haya partidas vivas
    (punto 12).
- **Sondas reutilizables** (en el scratchpad de la sesión, que se pierde;
  la receta está en BUILD_LOG):
  - 4 clientes con GPU contra el bundle de producción: `vite build` con
    `VITE_SERVER_URL=ws://localhost:<puerto>` y `vite preview`, y el
    servidor con `PORT=<puerto> npx tsx --import
    ./scripts/precise-timers.mjs src/index.ts`.
  - Contra producción, siempre como invitados: `onlineIdentity = null`,
    `friendsJoin` y `connectOnlineWith`.
- **Lo siguiente:**
  - el 12 (aviso de mantenimiento) junto al `onBeforeShutdown` del 8,
    con plan antes, porque es zona hard-stop;
  - el 11 (Sinkhole y el hielo en la predicción);
  - el 13 si se quiere.

**2026-09-24** — segunda sesión del carril.

- **Hecho:**
  - todo lo del buzón de PERSONAJES: ratchet a 30 MB y 3 MB por fichero;
    GLB de bicho `immutable` (comprobado en la preview de Vercel); zona
    muerta espejada en `BrawlRoom`; comentario de `ci.yml`;
  - el **suavizado online**, de principio a fin:
    - medición de lo de hoy;
    - 3 diseños y 3 jueces;
    - las ~15 líneas de `game.ts`, con permiso de Rafa;
    - `src/net-smoothing.ts` y 32 tests, cada arreglo con su mutante;
    - verificación en el juego real (33 grabaciones a LAN y RTT 80/160);
    - 3 arreglos: reloj con ventana, frenada un RTT después y teleports
      cortos;
    - re-simulación de las 33 grabaciones con el módulo arreglado.
  - `precise-timers` en `npm run dev` del servidor y ws 8.21.3;
  - el bloqueo de Copycat de 4748f63 (getLDef).
- **Herramientas nuevas:** `scripts/net-smoothing-record.mjs` y
  `scripts/net-smoothing-bench.mjs`. Las grabaciones y el banco de esta
  sesión están en el scratchpad de la sesión (se pierden): repítelas con
  los comandos de la cabecera de cada script.
- **Desplegado:** v1.8 salió el mismo día (punto 1). `BUILD_LOG`,
  `DEV_TOOLS` (superficie programática) y `NEXT_STEPS` al día el
  2026-09-25.
- **Lo siguiente:**
  - el A/B de Rafa y lo que diga de la pasada de los rivales al parar;
  - el punto 11, el slice de `BrawlRoom` del repaso de habilidades, que
    irá con su propio despliegue;
  - el 8 (huecos del pipeline), que ahora incluye un arreglo pequeño:
    añadir `stamp-critter-glbs --check` al script `build`, para que
    Vercel también vigile los `?v=` de los GLB immutable.

**2026-09-21** — primera sesión del carril.

- **Qué quedó hecho:**
  - la verificación completa de `dev` para el despliegue de H4.5 (ver
    arriba);
  - los docs de despliegue que mentían, corregidos: `ONLINE.md` decía
    que el online estaba caído desde agosto; `STACK.md` y
    `SUBMISSION_CHECKLIST.md` traían versiones y tamaños de la jam;
  - las derivas del sim que salieron, avisadas en los buzones de ARENA
    y PERSONAJES.
- **2026-09-22: el guard de versión (punto 7) está en `dev`**,
  verificado dos veces. Ya forma parte de lo que saldrá en v1.8.
- **Lo siguiente** es el punto 1. El slice F0 del fondo v2 ya está en
  `dev`, pero falta que Rafa apruebe sus hojas (ver
  `docs/carriles/arena.md`). Con eso: repetir la verificación sobre ese
  SHA, que ahora incluye el guard (curl de `/health` y `POST {}`, y la
  pestaña v1.7 contra el servidor nuevo); pasar las capturas a Rafa; y
  seguir el runbook.
- **Mientras tanto** se puede avanzar sin nadie en el 8 (huecos del
  pipeline, zona hard-stop: plan antes) o en el 9.
- **Cómo se trabajó:** este carril lo hizo en su propio worktree
  (`.claude/worktrees/distribucion`). Las cuatro sesiones se abrieron a
  la vez sobre el mismo checkout (ver `docs/SESIONES.md`, la regla de
  oro). Si repites el worktree, cuesta un `npm ci` en la raíz y otro en
  `server/`. Los tests necesitan puertos propios: 5173 y 2567 pueden ser
  de otra sesión, y `playwright.config.ts` reutiliza cualquier servidor
  que encuentre en 5173.
