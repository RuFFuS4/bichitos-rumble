# Error Log — Bichitos Rumble

### [2026-09-25] El golden dio un «cambio de balance» en una partida idéntica
- **Where**: `scripts/run-match-batch.mjs` (espera del fin de partida) y
  `src/tools/dev-api.ts` `tickRecording`.
- **Symptom**: con un cambio solo visual del paso fijo, el golden falló
  dos veces seguidas en la seed 501: «evento #252: golden
  match_ended|arena|player_eliminated vs actual (fin)». La grabación era
  idéntica hasta el final, con los mismos eventos y las mismas
  posiciones; solo le faltaba el último evento y la última instantánea.
  Otra pasada del mismo código salió 3/3.
- **Cause**: carrera.
  - `dev-api` solo mira si la partida acabó cuando toca instantánea, cada
    200 ms de simulación. La fase pasa a `ended` hasta 12 pasos antes de
    que se registre `match_ended`.
  - El ejecutor sondea cada 500 ms de reloj de pared. Si veía `ended` en
    ese hueco, paraba la grabación a mano sin el evento.
- **Fix**: con la fase en `ended`, el ejecutor espera (hasta 5 s) a que la
  grabación tenga su motivo de fin.
- **Lección**: ante un «cambio de balance» en un cambio que no debería
  tocar la simulación, compara también las posiciones de las grabaciones
  antes de buscar la fuga. Si la simulación es idéntica hasta el final,
  el fallo está en la herramienta.

### [2026-09-25] Ventanas de tiempo medidas con el reloj de pared: culpé al Ice Slide sin motivo
- **Where**: análisis de las grabaciones de `run-match-batch.mjs
  --dump-recordings` (script de un día, no del repo). Conclusión
  publicada en dev (1cb22a8) y corregida el mismo día.
- **Symptom**: tras la segunda tanda, Kowalski sale eliminado más a
  menudo (49 → 65 %). Al contar sus caídas «≤ 1,2 s tras el Ice Slide»
  en las grabaciones, salía un 21 % de los deslizamientos, frente al 15,5
  % de antes, y casi siempre sin nadie cerca. La conclusión fue que se
  salía él solo deslizando, y el siguiente paso propuesto, enseñar al
  bot a no deslizar hacia el borde.
- **Cause**: `GameplayEvent.t` es `performance.now()`, reloj de pared.
  La tanda corre a `--speed 8`, así que 1,2 s de pared son varios
  segundos de partida: la ventana cogía casi cualquier caída. Una sonda
  que cuenta en pasos de simulación (`scripts/fall-probe.mjs`) da 4,2 →
  5,1 %, lo mismo. Lo que sube es la caída con contacto: 1,41 → 1,70
  por minuto, los golpes de dash nuevos de los demás.
- **Fix**: documentos corregidos (`REPASO_HABILIDADES.md` §«Medido»,
  BUILD_LOG, carril), y `fall-probe.mjs` al repo.
- **Lección**:
  - En las grabaciones, los tiempos entre eventos solo valen a
    velocidad 1. Para ventanas cortas, cuenta pasos de simulación.
  - Antes de proponer un arreglo, mide el mecanismo con un instrumento
    cuyo reloj conozcas.

### [2026-09-24] El repaso de habilidades destapa bugs de producción de hace meses
- **Where**: `src/abilities-runtime.ts`, `src/critter.ts` y
  `server/src/sim/abilities.ts`. Detalle en `docs/REPASO_HABILIDADES.md`.
- **Symptom / Cause**, de más a menos grave:
  - **Copycat escribía su copia en la definición compartida.** En el
    servidor ese objeto lo comparten todas las salas, así que una Kurama
    podía cambiar la L de otra partida. Además, copiar a Sebastian
    mataba a Kurama al fallar.
  - **Offline, las habilidades ignoraban la inmunidad.** El servidor sí la
    respeta. Trunk Slam lanzaba a Shelly anclada en Steel Shell a 20 u/s,
    y como `checkFalloff` no deja caer a un inmune, el empujado quedaba
    flotando sobre el vacío.
  - **Mirror Trick nunca se vio como se diseñó** (desde 69e7609). En
    `updateVisuals` la rama de inmunidad iba antes que la de
    invisibilidad, y el truco escribe los dos temporizadores: Kurama
    parpadeaba blanca y opaca, y el alfa 0,08 que pidió Rafa no se pintó
    nunca. El checklist lo daba por «confirmado».
  - **Las velocidades de clip de `ANIMATION_OVERRIDES` no llegaban a las
    habilidades** (desde 47728db). `clipPlaybackRate ?? 1` siempre tenía
    valor y ganaba al ajuste del laboratorio.
  - **La sierra de Shelly seguía empujando durante el hit stop**, que no
    congelaba los ticks de fuera de `game.update`: llegaba a 600-1260
    u/s.
  - **El Sinkhole se comía la baldosa de Sihans** en el 15,5 % de los
    lanzamientos.
  - **Al caer no se limpiaba nada.** El All-in podía lanzarse desde el
    vacío.
- **Fix**: rama `claude/fix/personajes-repaso-habilidades`. Cada arreglo
  se verificó antes y después contra un servidor «foto fija».
- **Lección**:
  - Un «confirmado» en un checklist no vale si no hay una captura que lo
    enseñe: filmar las habilidades (`ability-shots.mjs`) destapó en una
    tarde lo que meses de QA a ojo no vieron.
  - Una definición compartida no se muta nunca.

### [2026-09-24] El fundido entre clips saltaba a mitad de camino en un fotograma
- **Where**: `src/critter-skeletal.ts` `play()`, desde su primer commit
  (aed6695, 2026-04-19). Afectaba a producción, en cada cambio de clip.
- **Symptom**: al arrancar y al parar, el pie daba un salto de hasta
  ~25 cm en un solo fotograma (Sergei, Kurama y Sihans; medido con los
  vértices del pie en `critter-motion`). Se veía como un tirón de pose.
- **Cause**: tras `prevAction.crossFadeTo(action, 0.15)`, un «apaño»
  reponía `action.setEffectiveWeight(1)` («crossFadeTo sometimes leaves
  the incoming action's weight scaled»). Pero `setEffectiveWeight`
  cancela el fundido de entrada. Durante el primer fotograma, los dos
  clips pesaban 1 y el mezclador los promediaba, así que la pose saltaba
  a medio camino. Además, `crossFadeTo` arranca el clip saliente con peso
  1 aunque viniera a medio fundir.
- **Fix**: el animador lleva su propio fundido. Parte de los pesos que
  hay en pantalla, la suma se mantiene en 1 y un clip que ha terminado y
  está en pausa cuenta como visible. Reposo y carrera pasan a ser una
  sola pose mezclada por velocidad. Detalle en FEELING §7.11. Lección: un
  «workaround» sin fallo documentado detrás es una sospecha, no una
  garantía.

### [2026-09-24] Cuatro bichos destellaban su propio color al recibir un golpe, no blanco
- **Where**: `src/critter.ts` `attachGlbMesh`, en la normalización de
  materiales. Afectaba a producción desde que llegaron los rigs de Meshy.
- **Symptom**: el destello blanco del golpe dejaba a Sebastian rojo
  brillante, y a Sergei, Kurama y Sihans con su textura aclarada. Con los
  brillos de habilidad pasaba lo mismo: el color se mezclaba con su
  textura.
- **Cause**: los GLB de Meshy traen el albedo también como
  `emissiveTexture`, con factor 1. El juego escribe el emisivo como un
  tinte plano (`emissive = blanco`), y three.js lo multiplica por ese
  mapa. En reposo no se notaba, porque el emisivo es negro.
- **Fix**: al montar el GLB se quita el mapa emisivo y se deja el emisivo
  en negro. Verificado con capturas de golpe: Sebastian y Sergei
  destellan blanco. El golden 3/3 no cambia. Lección: un canal que el
  juego usa como tinte no puede llegar con mapa desde el exportador. Se
  mira el material del GLB, no solo la malla.

### [2026-09-23] Kermit llegó a `dev` con la textura rota (fallo intermitente de la receta)
- **Where**: `scripts/critter-recipe.mjs`, sección `textures.webp`. Commit
  cce77f4 (Run más vivos); no llegó a producción.
- **Symptom**: los primeros 22 bytes de la imagen WebP de Kermit estaban
  pisados (`78156700…` en vez de `RIFF…WEBP`). Repitiendo la misma
  receta, 2 ejecuciones de 3 lo rompían. Las demás pruebas (`--out`) y la
  F2 salieron bien por suerte.
- **Cause**: `textureCompress` (gltf-transform + sharp) devuelve el WebP
  como una VISTA dentro de un bloque de 16 MB que el proceso reutiliza.
  Leer después otro GLB grande (el donante de Blender, en la cadena de
  Kermit) sobrescribía el principio de la imagen dentro del documento
  antes de escribirlo.
- **Fix**:
  - `ownMemory()` copia cada imagen y accesor que sea vista de un bloque
    mayor a su propio búfer, justo tras la dieta y las texturas;
  - `checkImages()` comprueba la firma de cada imagen del GLB escrito y
    para la receta si alguna está rota;
  - Kermit rehecho.

  Verificado: las 8 recetas reproducen byte a byte los GLB del juego, y
  8 de 8 ejecuciones de la prueba de la carrera salen limpias. Lección:
  cualquier búfer que venga de un codificador nativo o WASM se copia
  antes de guardarlo en un documento que vive más que la llamada.

### [2026-09-23] El Run nuevo de Kowalski enterraba el pie apoyado 20-27 cm
- **Where**: `scripts/blender/critter-clip-edit.py`, IK de los pies de la
  receta de Kowalski (rama de la fase 1 gráfica; no llegó a `dev`).
- **Symptom**: con la cámara de partida no se veía, pero de cerca el pie
  palmeado quedaba reducido a una loncha o a una cúpula medio enterrada
  durante todo el apoyo. Las métricas del plan (pie 1,00, 4 ciclos/s)
  salían perfectas.
- **Cause**: el suelo del IK era el fotograma MÁS BAJO del Run de Tripo,
  que ya iba hundido, y el pie plano era el giro de ese mismo fotograma
  (48° respecto al Idle). El IK mantenía esa postura hundida todo el
  apoyo, porque medía que el pie no resbalaba, no que estuviera sobre el
  suelo. Además, la pantorrilla izquierda (el rig es asimétrico) tocaba
  su tope de plegado y daba un latigazo de 64°.
- **Fix**:
  - `groundFrom` (suelo, anchura y pie plano del Idle) y `swingFlat`;
  - IK suave en los dos topes y el límite de cada pierna en el registro;
  - el balanceo rueda sobre el pie apoyado.

  Lo cazó la revisión adversarial con una sonda de vértices del pie contra
  el suelo real. Lección: al tocar una animación, medir también dónde
  queda la malla respecto al suelo del Idle, no solo el ritmo y el
  patinaje.

### [2026-09-22] `--feel` cambiaba una copia de FEEL que el juego no leía
- **Where**: `scripts/run-match-batch.mjs` y `scripts/critter-motion.mjs`,
  opción `--feel`.
- **Symptom**: dos tandas de 48 partidas con los bots mirando el borde
  a 1,5 u y a 1,9 u dieron EXACTAMENTE los mismos resultados que sin
  tocar nada, partida a partida.
- **Cause**: los scripts hacían `import('/src/gamefeel.ts')` desde la
  página. Tras editar `gamefeel.ts` con el dev server vivo, Vite reescribe
  los imports del juego a `/src/gamefeel.ts?t=<sello>`: otro módulo, otro
  objeto `FEEL`. El cambio iba a una copia que nadie leía, sin error. (El
  estudio de velocidad del 2026-09-21 sí fue válido: aquel servidor no
  había recargado `gamefeel.ts`, y la velocidad medida escaló con el
  factor.)
- **Fix**: `src/tools/main.ts` expone `window.__feel` (el objeto que usa
  el juego) y los dos scripts lo usan o fallan en voz alta. Lección: toda
  herramienta de «qué pasaría si» tiene que comprobar que su cambio llega;
  un override que no puede fallar tampoco puede avisar de que no ha hecho
  nada.

### [2026-09-21] Con monitores rápidos había bichos que no podían arrancar
- **Where**: `src/critter.ts` → `update()`, la zona muerta de velocidad
  (`FEEL.movement.velocityDeadZone` 0,15). Espejo en
  `server/src/BrawlRoom.ts:1476`.
- **Symptom**: pulsando una dirección desde parado, Shelly no se movía a
  120 Hz o más, Sergei y Kowalski a 144, Trunk a 165 y Kurama a 240. El
  bot Shelly no arrancaba ni a 60 Hz, y cualquier bicho ralentizado
  (arena de Sihans, bola de nieve, wind-ups de ground pound y frenzy) se
  quedaba clavado. En producción desde que existe la zona muerta; nadie
  lo vio porque se juega a 60 Hz.
- **Cause**: la zona muerta anulaba la velocidad aunque hubiera input. A
  más Hz, menos velocidad gana cada fotograma (`speed × accel × dt`), y
  si tras la fricción queda por debajo de 0,15 se pone a cero antes de
  poder acumularse. La física era correcta a 60 Hz y rota a cualquier
  otra frecuencia.
- **Fix**: zona muerta solo sin input (`!this.hasInput`). Golden
  regenerado. Lo encontró la auditoría del estudio de velocidad
  (`docs/FEELING.md §7.4`) y se verificó con el bucle real a 60/120/144/
  165/240 Hz. Lección: todo umbral por fotograma sobre algo que crece
  con `dt` es un bug de frecuencia de refresco esperando a pasar; hay
  que probar la física a varios `dt`, no solo al de la máquina de
  desarrollo.

### [2026-09-07] Las capturas de arena mentían: 52 s de partida en vez de 0
- **Where**: `scripts/arena-shots.mjs` → espera previa a la captura.
- **Symptom**: todas las capturas de `.tmp/shots-despues/` —las que se
  usaron para juzgar la fase 1a— salían con el 95 % del decorado ya caído
  y el disco medio derruido. Se juzgó el aspecto del terreno sobre
  imágenes de una arena a punto de desaparecer.
- **Cause**: el script esperaba a `__devApi.snapshot()`, que **no
  existe**. El `?? 0` de la expresión hacía que la condición no se
  cumpliera nunca, el `waitForFunction` agotaba sus 60 s… **con el juego
  a 20× de velocidad**, y el `.catch(() => {})` se tragaba el timeout sin
  decir nada.
- **Fix**: esperar al reloj real del HUD (`#hud-timer`) y **gritar en
  consola** si la espera vence, en vez de tragarse el error. Lección
  general: un `catch` vacío alrededor de una espera convierte un bug en
  datos falsos, que es peor que un fallo.

### [2026-09-07] `golden:write` truncó el último evento y fingió un cambio de balance
- **Where**: flujo `npm run golden:write` → `npm run golden`.
- **Symptom**: tras un cambio grande, el golden regenerado salía sin el
  evento `match_ended` de la última partida, y la comparación siguiente
  gritaba "CAMBIO DE BALANCE" sobre un cambio que era puramente visual.
- **Cause**: la primera escritura tras un cambio grande cerró el fichero
  antes de volcar el último evento.
- **Fix**: regla operativa — **después de `golden:write`, correr siempre
  `npm run golden`** y comprobar que pasa 3/3 antes de commitear el JSON.
  Un golden a medio escribir es peor que no tener golden.

### [2026-04-23] Meshy models render as dark matte metal
- **Where**: `src/critter.ts` → `attachGlbMesh` material pass.
- **Symptom**: Kurama, Sergei, Sihans, Sebastian looked grey/metallic
  in the character-select preview, completely off from the flat cartoon
  colours the Meshy visor showed.
- **Cause**: Meshy exports GLBs with `metalness: 1` (`MeshPhysicalMaterial`)
  and **no environment map** in our scene. A fully metallic material
  without an envMap samples a black "environment" and comes out as
  dark grey regardless of the diffuse map. Tripo exports with low
  metalness and didn't show the bug.
- **Fix**: in `attachGlbMesh`, iterate every `MeshStandardMaterial` on
  the imported group and, when `metalness > 0.5`, force
  `metalness = 0` + `roughness = 0.7`. Diffuse map now drives the look
  and the flat-colour cartoon appearance is restored. Tripo materials
  stay untouched (their metalness is already low).

### [2026-04-23] SFX / Música buttons invisible outside match
- **Where**: `src/hud/dom-shared.ts` → `setMatchHudVisible`.
- **Symptom**: 🔊 / 🎶 buttons missing in title, character-select,
  waiting, end-screens. User explicitly said "we agreed these should be
  reachable from every screen".
- **Cause**: `setMatchHudVisible(false)` set
  `hudRoot.style.display = 'none'`, which hid `#hud-settings` (where
  the toggles live) along with everything else inside `#hud`. The CSS
  had already been written to gate only the match-only children via
  `body:not(.match-active)` selectors, but the JS display: none was
  overriding it.
- **Fix**: rewrote `setMatchHudVisible` so it only toggles the
  `body.match-active` class and forces `hudRoot.style.display =
  'block'`. Added `#ability-bar-container` and `#overlay` to the
  `body:not(.match-active) { display:none }` selector so they stay
  hidden out of matches. Settings cluster now visible on every screen.

### [2026-04-23] Character preview sizes wildly uneven
- **Where**: `src/preview.ts` + per-critter scales calibrated for
  gameplay, not for the podium.
- **Symptom**: Some critters in the character-select podium looked
  gigantic and overflowed the frame (Trunk Tripo 1.93u), others looked
  tiny and hugged the ring (Sebastian Meshy 0.56u in idle). User:
  "el selector de bichitos es un despropósito falla por todos lados".
- **Cause**: roster `scale` was tuned to gameplay hitbox feel (elephant
  bigger than crab on purpose). The preview camera couldn't work
  simultaneously for both extremes. Compounded by Meshy idle poses
  being humanoid clips applied to non-humanoid rigs (Sebastian's
  "Shrugging Shoulders" crouches the crab).
- **Fix**: added a `fitWrapper` group nested inside `holder` in
  `preview.ts`. A short polling pass (`setInterval` 60ms, 900ms
  window) samples `max(h, w, d)` from the live bone bounding box
  across the idle loop and applies `scale = TARGET (1.9u) / maxDim`
  to the wrapper. Gameplay scale unchanged; only the preview
  normalises. All 9 critters now read at ~1.9u max dimension while
  keeping their own proportions.

### [2026-04-09] Canvas renders at 0x0 — blue screen
- **Where**: `src/main.ts` → `renderer.setSize()`
- **Symptom**: Page loads, HUD visible, but only blue background — no 3D scene
- **Cause**: `window.innerWidth` returns 0 when module script runs before layout in some environments
- **Fix**: Extracted `syncSize()` in camera.ts with fallbacks. Added guard in game loop to re-sync if canvas.width is still 0.

### [2026-04-09] WebGL context creation fails — "Error creating WebGL context"
- **Where**: `src/main.ts` → `new THREE.WebGLRenderer()`
- **Symptom**: Red error banner or blue screen, Three.js throws at renderer creation
- **Cause**: Browser has Hardware Acceleration disabled, or GPU drivers are outdated/missing
- **Fix**: Not a code bug — environment issue. Added WebGL detection in main.ts with clear user-facing message and console diagnostics.
- **Status**: Edge case, gestionado. No workaround posible sin WebGL.
- **User checklist**:
  1. Chrome → `chrome://settings/system` → enable "Use hardware acceleration"
  2. Visit `chrome://gpu` → check "WebGL: Hardware accelerated"
  3. Try another browser (Firefox, Edge)
  4. Update GPU drivers
  5. Visit `https://get.webgl.org/` to test WebGL independently

### [2026-04-17] Arena fragment render MIRRORED vs physics — "visible but fall / invisible but walkable"
- **Where**: `src/arena.ts` → `createFragmentMesh()` `rotation.x`
- **Symptom (user remote test video on bichitosrumble.com)**:
  After some fragments collapsed, the local player reported:
  - walking onto a VISIBLE fragment → falling into the void
  - walking over empty-looking terrain → staying alive on arena
  Both problems happened in the SAME match, on opposite halves of the
  arena. Only became noticeable once partial collapse exposed the gap.
- **Cause**: `ExtrudeGeometry` places the Shape in XY and extrudes along +Z.
  To lay it flat on world XZ, the mesh was being rotated by `-π/2` around X.
  That rotation matrix is `(x,y,z) → (x, z, -y)`, which **mirrors shape-Y onto world `-Z`**.
  So a fragment stored with `startAngle = π/2` was rendered at world `-Z`
  (south), while the physics check `pointInFragment` uses `atan2(z, x)` without
  any mirror and still believed that fragment covered world `+Z` (north).
  Result: visual and physics diverged by a mirror across the X axis. While
  every shape-angle had SOME fragment alive (pre-collapse), the bug was
  invisible. After partial collapse it exposed both failure directions.
- **Fix** (commit `c4ad1c4`):
  - Changed `mesh.rotation.x` from `-Math.PI / 2` to `+Math.PI / 2`.
  - New rotation matrix: `(x,y,z) → (x, -z, y)`. Shape-Y now maps to world `+Z` (no mirror).
  - Removed the `mesh.position.y = -h` compensation — `+π/2` already extrudes downward naturally (back face at `y=-h`, top face at `y=0`).
  - Verified with pure-math script: shape point `(0, 5, 0)` → world `(0, 0, 5)`, `atan2(5, 0) = π/2` matches the fragment's stored startAngle.
- **Detection**: use `window.__arena` helpers in production console:
  - `__arena.checkPlayer()` — the fastest probe: reads the local
    player's world position and reports which fragment physics thinks
    covers it plus whether that mesh is rendered. Run right after a
    "visible but fall" / "invisible but walk" event to capture the
    state without guessing coordinates.
  - `__arena.check(x, z)` — same check at an arbitrary point.
  - `__arena.compass()` — toggles N/S/E/W world markers. Red (N) must be
    at `+Z`, blue (S) at `-Z`, green (E) at `+X`, yellow (W) at `-X`. If
    a fragment at stored angle `π/2` is not underneath the red marker,
    the rotation mirror has reappeared.
  - `__arena.dump()` — lists fragments grouped by band with alive vs
    visible flags. Any `MISMATCH(alive=X visible=Y)` row is evidence of
    a different sync bug.
  - `__arena.logCollapses()` — toggles per-batch log of collapse and
    warning transitions during a live match.
- **Lesson**: when mapping geometry between two coordinate conventions,
  add a compass debug helper from day one. The bug was invisible in unit
  tests because they only checked angles 0 and π (which are fixed points
  of the Z-mirror).

### [2026-04-20] Cloned SkinnedMesh — physics moves, vertices stay at origin
- **Where**: `src/model-loader.ts` → `deepCloneWithMaterials()`
- **Symptom**: After Sergei was re-exported with a rigged armature
  (first critter to ship with a real skeleton), the character-select
  thumbnail rendered as if the mesh were pinned to world origin while
  the carousel rotated the container around it. In-game the critter
  followed physics as an invisible ghost; visible geometry stayed
  stuck at origin.
- **Cause**: `source.clone(true)` on a `THREE.Group` containing a
  `SkinnedMesh` clones the mesh and the armature nodes but leaves
  `SkinnedMesh.skeleton.bones` pointing at the ORIGINAL armature's
  bones — the ones cached inside the loader. Translating/rotating
  the clone moves the empty parent, but vertices are still bound to
  the cached skeleton at world origin.
- **Fix**: Use `SkeletonUtils.clone()` from
  `three/examples/jsm/utils/SkeletonUtils.js` for any source that
  contains at least one `SkinnedMesh` — SkeletonUtils rebuilds the
  skeleton and reconnects bone references to the clone subtree.
  Detection: single `source.traverse` checking `node.isSkinnedMesh`.
  Plain `source.clone(true)` kept as fallback for non-skinned models
  (cheaper, still the majority today). Comment in the file documents
  the symptom so the next refactor doesn't revert it.
- **Lesson**: the moment any critter gets a real armature, SkeletonUtils
  cloning is mandatory. This bug only surfaces once a skinned model is
  added; all the critters shipped so far were static meshes, so the
  cheap clone path worked.

## Format
```
### [Date] Error Title
- **Where**: file/function
- **Symptom**: what happens
- **Cause**: why it happens
- **Fix**: how to resolve
```
