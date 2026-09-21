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
   - **Pendiente de Rafa.** En `dev` sigue el fondo del **mar**, y Rafa
     lo rechazó el 2026-09-21 (ver `docs/carriles/arena.md`). Su
     sustituto, el fondo v2 (la isla en el cielo), está en construcción.
     Hay que decidir si se despliega ya con el mar o se espera al fondo
     v2.
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
7. **Versión del sim en el join** — el riesgo que dejó a la vista H4.5.
   El servidor no comprueba la versión del cliente, y cada cliente
   deriva en local qué fragmentos caen. Cada cambio del generador de
   arena desincroniza a quien tenga una pestaña vieja abierta: se cae
   pisando suelo que ve entero. Plan antes de H5 o del próximo cambio
   del generador: una constante en los espejos del sim que vaya en las
   opciones de join, y que `BrawlRoom.onJoin` rechace con "hay versión
   nueva, recarga" si no coincide. Los clientes v1.7 ya pintan el
   mensaje del servidor (`connect-failed-server-said`). **Zona
   hard-stop, plan antes**; toca también `src/game.ts` (tierra de
   nadie) y los espejos de ARENA.
8. **Huecos del pipeline** (zona hard-stop, plan antes):
   - El CI nunca arranca la imagen del servidor ni prueba el bundle de
     producción. Faltan `docker run` + `curl /health`, y un smoke contra
     `vite build && vite preview`.
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
| **Cliente v1.7 contra servidor nuevo** | **54 % de las semillas colapsan distinto**: ver punto 7. Asumido para este despliegue porque el tráfico online es ≈0 (`/api/metrics/retention`: 0 partidas en 16 días) |

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
- `/health` con uptime de segundos y `/api/leaderboard` con 200 (el
  volumen de la DB sigue montado).
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

**Rollback**: siempre los dos lados a la vez, porque la
desincronización va en ambos sentidos. Los datos no corren riesgo: no
hay migraciones.
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
- **Lo siguiente** es el punto 1. El cono ya está en `dev`; falta que
  Rafa decida si sale con el fondo del mar o se espera al fondo v2.
  Después: repetir la verificación sobre ese SHA, capturas a Rafa y
  runbook.
- **Mientras tanto** se puede avanzar sin nadie: el plan del punto 7
  (versión del sim en el join), que conviene tener aprobado antes del
  siguiente cambio del generador, o el 8.
- **Cómo se trabajó:** este carril lo hizo en su propio worktree
  (`.claude/worktrees/distribucion`). Las cuatro sesiones se abrieron a
  la vez sobre el mismo checkout (ver `docs/SESIONES.md`, la regla de
  oro). Si repites el worktree, cuesta un `npm ci` en la raíz y otro en
  `server/`. Los tests necesitan puertos propios: 5173 y 2567 pueden ser
  de otra sesión, y `playwright.config.ts` reutiliza cualquier servidor
  que encuentre en 5173.
