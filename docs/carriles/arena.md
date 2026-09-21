# Carril ARENA — terreno, dioramas, fondo, colapso y la física de las cosas

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). El detalle de
cada punto vive en [`docs/ARENA_V2.md`](../ARENA_V2.md),
[`docs/DIORAMAS.md`](../DIORAMAS.md) y `NEXT_STEPS.md §H4.5`; aquí solo está
el orden de trabajo.

## Pendiente (por orden)

1. **Fondo v2 — la isla en el cielo.** Rafa rechazó el fondo del mar el
   2026-09-21 y aprobó el plan que lo sustituye el mismo día, con este por
   delante de los dioramas. Plan completo en
   [`docs/DIORAMAS.md` §«Fondo v2»](../DIORAMAS.md): §12 es el slice,
   §11 las fases.
   - **F0, el slice (1 día)**: cúpula generada, nubes C2 con cuello, C3,
     islotes genéricos, pasillo del canto, rebote del hemisferio por pack,
     `mode: 'sky' | 'sea'` para el A/B, métodos de dev-api, y
     `arena-shots --pose/--scatter/--metrics`. Entregables:
     `.tmp/shots-cielo/_hoja.png`, `_roster_ab.png` y `_pozo_ab.png`.
   - **Pendiente de Rafa sobre esas hojas**: la decisión 2 (pozo oscuro o
     claro, sobre todo en jungle) y el visto bueno al rebote de luz en los
     bichos.
   - **Buzón de PERSONAJES**: la nota del §7 del plan se deja **cuando
     exista `_roster_ab.png`**, no antes (la cita).
   - F1 firmas por bioma · F2 torres, fondo del pozo, deriva y vida · F3
     luz por bioma (absorbe la antigua «fase 3, rig de luz») · F4 caída,
     CLI `arena-sky.mjs`, `look-patch`, test de determinismo y borrado del
     mar y de las fotos.
2. **Dioramas slice 2**: afinar recetas sobre capturas (grietas de hielo,
   escala de acentos), fleco del borde que se regenera al caer un sector,
   viento animado barato, recomponer los 73 props autorados,
   `SCATTER_DENSITY` en el studio y applier ToolPatch `scatter-patch`
   (doble superficie). **Los techos ya están decididos**: manda
   `SCATTER_LIMITS` (DIORAMAS §3).
3. **Cohesión de los elementos** (Rafa, 2026-09-07: *"no parecen muy
   cohesionados"*): paleta compartida entre scatter, props GLB y suelo;
   que los elementos se toquen y se agrupen en vez de flotar sueltos;
   sombras de contacto también en los props.
4. **Fase 2 — el colapso que se lee y se siente**: grietas, hundimiento,
   escombros, polvo, shake. Es literalmente *"las físicas de las cosas"*
   que pidió Rafa: lo que le pasa al decorado cuando su sector cae.
5. **Fase 1b**: bisel de junta, applier `look-patch` (lo comparte con el
   F4 del fondo), panel del studio y dieta de props (palmas, bambú y
   sakura: 112-131k → ≤20k tris).
6. **Fase 4**: props que pertenecen al suelo, y sacar de git el GLB crudo
   de 54 MB de `public/models/arenas/jungle/_raw/`.
7. **Fase 5**: todo lo visual derivado del radio (deja la capa lista para
   las arenas de 8 jugadores de H6).

## Hecho

- **2026-09-21 — decisiones de Rafa y cono en punta.**
  - Los techos del scatter los manda el código.
  - La isla es un **cono en punta**: `cliffTaper` 0,08, 9 u de alto y
    10 estratos. En la cámara de juego no se nota.
  - El fondo del mar **no vale**, y se aprueba el fondo v2.
  - Capturas A/B en `.tmp/shots-cono*/`.

## Lo que no puedes romper

- **Golden de partidas**: todo lo de este carril debería pasar
  `npm run golden` 3/3 **sin regenerar**. Si se mueve, has tocado
  gameplay sin querer. El testigo del golden es del carril PERSONAJES.
- **Espejos del sim**: `src/arena-fragments.ts` ↔
  `server/src/sim/arena-fragments.ts`, idénticos salvo cabecera; los dos
  en el mismo commit (`npm run check` lo verifica).
- **Determinismo**: cada sistema visual con su propio stream
  `mulberry32(seed ^ SALT_<feature>)`. Nunca el del generador de layout.
- Nada de este carril colisiona ni entra en `isOnArena`.
- **Capturas**: `node scripts/arena-shots.mjs --out .tmp/shots-<algo>` con
  el dev server vivo. Nacen mudas. No las des por buenas sin mirar el
  reloj **y** que no salga la cuenta atrás. Hay dos precedentes:
  - el 2026-09-07 se juzgó el terreno sobre capturas del segundo 52;
  - el 2026-09-21, con varios packs y `--at-seconds`, del segundo pack en
    adelante salía la cuenta atrás. El reloj del HUD no se reinicia hasta
    `playing`; ya está arreglado.
- **Capturas con la escena girada** (`scene.rotation.x`, el truco de la
  pose baja): el fondo pintado no gira con ella, así que la foto asoma. El
  encuadre equivale a la cámara en (0; 7,54; 33,12) mirando a
  (0; −2,60; −1,49).
- **El headless se cae** tras varias reconstrucciones de arena en la misma
  página: «Unable to capture screenshot», visto el 2026-09-21. Lo más
  probable es la fuga de VRAM de las fotos (`textureCache` no expulsa
  nunca). Usa un navegador por bioma hasta que F4 borre las fotos.

## Buzón

*(Notas que te dejan otros carriles.)*

- **De DISTRIBUCIÓN, 2026-09-21 — lo que vio la verificación previa al
  despliegue de H4.5 en tu espejo del sim.** Nada bloquea. Hoy cliente y
  servidor están en sync: 50.072 semillas sin diferencias en el
  generador, y 620.100 pasos de `Arena` frente a `ArenaSim` sin una
  discrepancia. Tres cosas quedan para cuando te toque:
  1. **Corte de proyectiles solo online** (fase 0.5 a medias).
     `server/src/BrawlRoom.ts:1162-1163` expira la bola si
     `r > radiusAt(dir) + 4`. El camino offline (`src/projectiles.ts:175-240`)
     solo tiene ttl, así que offline una bola cruza la mitad caída y
     puede dar al otro lado. Además el servidor fija el alcance a mano
     (`pr.radius + 0.55`, `BrawlRoom.ts:1135`) frente al
     `pr.radius + c.radius` del cliente. Hoy da igual porque R = 0,55,
     pero R se puede editar en calibrate.
  2. **Los gates de paridad solo miran `arena-fragments`.**
     `check-sim-parity.mjs` tiene un solo par. `radiusAt`,
     `currentRadius` y el tick del colapso se espejan a mano (lo dice el
     propio comentario de `server/src/sim/arena.ts:66-67`). Ningún test
     instancia `ArenaSim`, y el golden de layout importa solo la copia
     cliente y no mete `pattern` en el hash. Los dos scripts que lo
     midieron, `arena-parity.mjs` y `frag-determinism.mjs`, están en
     `.tmp/distribucion/predeploy-h45/` (del checkout principal) por si
     quieres convertirlos en tests de Vitest.
  3. **Aviso de protocolo.** El servidor no comprueba la versión del
     cliente, y cada cliente deriva en local qué fragmentos caen. Por
     eso **cualquier cambio del generador** desincroniza a quien tenga
     una pestaña vieja abierta. H4.5 lo hace en el 54 % de las
     semillas; lo asumimos para este despliegue porque el tráfico
     online es ≈0. Voy a planificar una versión del sim en el join (lo
     verás en `ONLINE.md` → Limitaciones). Cuando exista, subirla será
     parte de tocar el generador, igual que los dos lados del espejo.
- **De PERSONAJES, 2026-09-21 — los bots se caen por los agujeros del
  colapso.** En 144 partidas solo-bots (estudio de velocidad,
  `docs/FEELING.md §7`), entre el 40 y el 55 % de las caídas sin rival a
  menos de 2 u fueron en el INTERIOR del disco: fragmentos que caen y
  que los bots no esquivan, porque su sonda (`FEEL.bots.lookAhead`)
  solo ve lo que ya ha caído, no los avisos de lote. No es cosa de la
  velocidad; lo dejo por si quieres que el aviso del colapso también
  lo lean los bots. Aparte: si subimos la velocidad de suelo ×1,4-1,5,
  los 3 s de aviso del colapso sobran para un humano; valóralo tras el
  playtest, sin prisa.

## Cómo retomar

**2026-09-21**. Las tres decisiones que bloqueaban el carril están
tomadas. El cono ya está en `dev`. Lo siguiente es el **slice F0 del fondo
v2** (§12 del plan en DIORAMAS), en la rama
`claude/feature/arena-fondo-v2-cielo`. Si esa rama existe al abrir la
sesión, es que se quedó a medias: mira su último commit antes de nada.
