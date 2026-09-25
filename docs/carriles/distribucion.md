# Carril DISTRIBUCIÓN Y DATOS — servidor, red, despliegue, payload, estadísticas y tienda

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`ONLINE.md`, `STACK.md`, `ROADMAP.md` (H5 monetización, H6 Steam) y
`ASSET_LICENSES.md`.

## Pendiente (por orden)

0. **v1.9 — ✅ EN PRODUCCIÓN desde el 2026-09-25 a las 02:10 UTC**
   (main `a37791b` = `dev` `a09ec8a`, tag `v1.9-habilidades-online`).
   `BrawlRoom` ejecuta las habilidades como el sim (repaso de PERSONAJES
   menos el Sinkhole), la L de los bots online, el paso fijo con 2
   sub-pasos y `NET_PROTOCOL` 3.
   - Verificación, ventana (Vercel 32 s, Railway 59 s) y comprobaciones
     de después en BUILD_LOG (2026-09-25, DISTRIBUCIÓN, v1.9).
   - Rollback: Vercel `dpl_AozQKczWU5Zn3pCZBBT6eH1VYeDq` (784779f) y
     Railway, el despliegue de 784779f. Siempre los dos lados.
   - **Queda de Rafa, a mano:**
     - una pestaña v1.8 abierta tiene que recibir «recarga»;
     - 2 pestañas en sala privada, con un Sebastian que cargue el
       All-in;
     - Sentry sin issues nuevos;
     - el A/B del suavizado del punto 1.
   - Las cifras de balance online cambian (sub-pasos + L de los bots):
     Kermit queda fuerte, decisión de Rafa.
   - **Ya en `dev` para el próximo despliegue** (avisos de PERSONAJES,
     2026-09-25). **Van cliente Y servidor**: si solo sale Vercel, online
     se queda como hoy. `NET_PROTOCOL` sigue en 3, así que no hay
     «recarga».
     - `5f8c9d9` (cliente): el juego offline simula a paso fijo de 1/60,
       como los 2 sub-pasos del servidor. La ruta online de `main.ts` no
       cambia (`game.update(dt)` por frame, con el reloj del paso fijo
       reiniciado), así que el suavizado tampoco. Comprobado: 278 tests
       y el tsc del servidor en verde.
     - `f22d8ca` (servidor, `server/src/sim`), respuestas de Rafa:
       - el Grip trae entero a un Sergei en frenesí (`fireGroundPound`
         ya no escala el tirón con `knockbackScale`);
       - el All-in apunta a 180°/s (`SIM.allIn.aimTurnDegPerSec`, que lee
         el bucle de carga de `BrawlRoom`).
     - Verificación al desplegar:
       - una partida offline a 60 Hz y otra a 144 Hz;
       - una sala online de 4 clientes (`.tmp/ability-live.mjs` del
         worktree), donde Trunk agarra a un Sergei en frenesí y lo deja a
         1,6 u de la trompa;
       - un Sebastian que carga tarda ~1 s en girarse 180°.
   - **Pendiente, de otro día y con permiso de Rafa** (`game.ts` es
     tierra de nadie y PERSONAJES ya lo tocó el 2026-09-25): el Frozen
     Floor o el Sinkhole que copia Kurama llegan online como `generic`,
     sin icono de congelado o atrapado (nota en el Buzón). Arreglo de una
     línea en `onZoneSpawned`: `ev.slippery ? 'ice' : ev.sinkhole ?
     'sand' : deriveZoneVfxKind(...)`, como el offline.

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
8. **Huecos del pipeline** (zona hard-stop, plan antes):
   - El CI nunca arranca la imagen del servidor ni prueba el bundle de
     producción. Faltan dos cosas:
     - `docker run` + `curl /health`, con el guard: que `/health` traiga
       `protocol`, que `POST {}` dé 523 `client_outdated` y que con el
       número correcto dé 200;
     - un smoke contra `vite build && vite preview`.
   - `engines.node` es `>=20.19`: Vercel compila con 24.x y sube de
     major solo, mientras CI y Docker usan 22. Hay que fijarlo.
   - `/health` no dice qué commit sirve.
   - `onBeforeShutdown` en `BrawlRoom`: hoy un reinicio de Railway en
     mitad de una partida pública apunta derrota a los humanos
     verificados.
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
    - **Sinkhole (punto 9)**: espera a que ARENA exponga el layout en
      `ArenaSim` (nota en su buzón).
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
- SHA de `dev` congelado y verificado; su CI en verde
  (`gh run list --branch dev -L 1`).
- Árbol limpio y ninguna rama de otro carril pendiente de entrar.
- Que no haya partidas online vivas. Un reinicio de Railway las corta y
  apunta derrotas; solo se ve en los logs de Railway, así que lo mira
  Rafa.
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
- Puntos de rollback (anotados el 2026-09-21):
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
- Con el guard, en esa ventana el cliente nuevo ve «el servidor se está
  actualizando» y no llega a sentarse.
- **Si un lado falla y el otro no**, la desincronización pasa a ser
  permanente: arregla el que falla o haz rollback del otro ya.

**3. Después**
- `/health` con uptime de segundos, `protocol: 2` y
  `protocolGuard: "on"` (eso marca el final de la ventana), y
  `/api/leaderboard` con 200 (el volumen de la DB sigue montado).
- Guard vivo, **solo después de que `/health` diga `protocol: 2` y
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

**Rollback**: siempre los dos lados a la vez. Con el guard, un lado
desparejado ya no desincroniza: deja el online parado con un mensaje
("actualizándose" o "recarga"). Pero sigue sin funcionar. Los datos no
corren riesgo: no hay migraciones.
- **Si el que rechaza es el servidor** (el propio guard echa a todo el
  mundo con `/health` en `protocol: 2`): primero `NET_PROTOCOL_GUARD=off`
  en las variables de Railway, sin revertir nada.
- **Si el que rechaza es el cliente** ("actualizándose" o "recarga" con
  `/health` ya en `protocol: 2`): el interruptor no sirve. Rollback de
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
    saldría `ice`/`sand`. Offline ya va bien.

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
