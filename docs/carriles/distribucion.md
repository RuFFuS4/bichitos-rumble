# Carril DISTRIBUCIÓN Y DATOS — servidor, red, despliegue, payload, estadísticas y tienda

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`ONLINE.md`, `STACK.md`, `ROADMAP.md` (H5 monetización, H6 Steam) y
`ASSET_LICENSES.md`.

## Pendiente (por orden)

1. **El despliegue de H4.5 — verificado; falta decidir cuándo.** En
   producción sigue `v1.7-h4-social` (main `f41fb7e`). El 2026-09-21 se
   verificó `dev` a fondo (ver "Verificación previa de H4.5" abajo):
   técnicamente puede salir.
   - **Qué ha pasado desde entonces.** Rafa pidió esperar al cono de
     ARENA, y el cono entró en `dev` ese mismo día (7d6c56c), junto con
     el corte 1 del feeling de PERSONAJES (ef3c857: capa visual, golden
     3/3 según su carril).
   - **Decisión de Rafa (2026-09-21): se espera al fondo v2.** En `dev`
     sigue el fondo del **mar**, que Rafa rechazó (ver
     `docs/carriles/arena.md`). H4.5 sale cuando ARENA cierre el slice
     F0 del cielo y Rafa lo apruebe. No sale un fondo rechazado. El corte
     1 del feeling de PERSONAJES viaja en el mismo despliegue: sus
     capturas también las ve Rafa.
   - **Antes de desplegar, sea cual sea el SHA:**
     - repetir la verificación: como mínimo `check`, `test:sim`, golden,
       smoke, la partida online de 2 clientes y los 5 biomas;
     - Rafa aprueba las capturas de ese SHA;
     - runbook de abajo, mergeando **el SHA exacto verificado**, no la
       rama `dev` a secas.

   El despliegue lleva también el apagado del portal en itch de INTERFAZ
   (ver Buzón): itch embebe producción.
2. **Presupuesto de payload**: ratchet 75 MB, dist **69,7 MB**
   (2026-09-21), margen 5,3 MB. Los crítters son el 62 % (sebastian
   15,2 + kermit 14,2 + kurama 13,8 MB; el tope por fichero es 17).
   H4.5 no añade ni un byte a `public/`: el fondo y los dioramas son
   procedurales. Cualquier carril que quiera meter assets nuevos choca
   contigo: eres quien dice sí o no, y quien mantiene
   `scripts/check-payload-budget.mjs`.
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
9. **`ws@8.20.0` con aviso alto** en las dependencias de producción del
   servidor (vía `@colyseus/ws-transport`). Ya está en producción y
   H4.5 no lo cambia. Arreglo: slice aparte con `npm audit fix` u
   override, más tsc, docker build y una sala local.
10. **Lo de `BrawlRoom.ts` que pide PERSONAJES** (Buzón, 2026-09-21):
    - suavizar el bicho local en online (extrapolar con `vx/vz` entre
      parches);
    - la zona muerta de velocidad con input;
    - el factor de aceleración de los bots online.

    **Espera a que Rafa apruebe su plan de velocidad** (`docs/FEELING.md`
    §7). Todo es zona hard-stop y sale con cliente y servidor a la vez.
    El suavizado vive en `src/game.ts` (tierra de nadie).

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
- Vercel termina antes (~20 s): en el log tiene que salir
  `[payload-budget] OK`.
- Railway tarda ~70 s (estimado por el uptime de `/health`; la vez
  anterior BUILD_LOG anotó ~30 s). En el log, `[server] listening`.
- El orden por defecto es el bueno: las partidas de un cliente nuevo
  contra el servidor viejo mueren con el reinicio antes del primer
  colapso (s. 28). No lo inviertas.
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
  - Opcional 2: meter `stamp-critter-glbs.mjs --check` e
    `inspect-stride.mjs --check` en `npm run check`. `package.json` es
    tierra de nadie; se lo he pedido a Rafa.
  - **Aviso de la F2 que viene**: la dieta de Kurama, Sebastian y Kermit
    baja el payload de ~70 a ~27 MB. Cuando entre en `dev` te dejo aquí
    la cifra medida por el build para que bajes el ratchet de
    `check-payload-budget`.

## Cómo retomar

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
