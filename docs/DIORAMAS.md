# Dioramas y fondo — de adornos sueltos a un lugar

<!-- Origen: dos tandas de agentes del 2026-09-07 sobre dos peticiones de
     Rafa: "rehacer la generación de los dioramas… que se vea como algo
     denso, como un ambiente real" y "unificar el fondo para que no
     parezca una foto mal puesta". La sección del fondo está cerrada y
     verificada; la de dioramas llega cuando termine su tanda. -->

## Fondo — que deje de parecer una foto pegada

*Decisión tomada el 2026-09-07 sobre la petición literal de Rafa: «también el unificar el fondo de alguna forma para que no parezca una foto mal puesta». Tres análisis independientes (técnico, artístico, procedural) más un juicio comparado. Lo que sigue es la decisión, no el debate.*

---

### 1. Por qué falla hoy

El fondo no falla por resolución. Falla porque **no es fondo: es el suelo de al lado, fingido con una esfera pintada en el infinito**.

**La geometría, re-medida a mano sobre el código (no citada de nadie):**

- Cámara `GAMEPLAY_CAM_POSITION (0,23,25)` → `GAMEPLAY_CAM_LOOKAT (0,-3,0)`, `PerspectiveCamera(40, aspect, 0.1, 200)` — `src/camera.ts:25-26` y `:56`. Eje óptico a **−46,16°** de elevación.
- El cono visible en 16:9 va de **−22,10°** (esquinas superiores; el máximo NO está arriba-centro, sino en las esquinas, porque normalizar el rayo diagonal reduce su componente Y relativa) a −66,2°. En 21:9 el techo es −20,00°; en móvil retrato 390×844, −25,78°.
- **El horizonte (0°) queda fuera de cuadro por 22,1° en escritorio y 25,8° en móvil, siempre, en los cinco packs.** La cámara nunca rota (`updateCameraShake` solo traslada ≤0,45 u), así que esto no es "a veces": es el 100 % de los frames de partida.

Consecuencia directa: **todo rayo del fondo apunta hacia abajo**. Lo que llamamos cielo es terreno lejano visto en picado, y una equirect no puede darle perspectiva a un terreno. De ahí la lectura de "foto mal puesta": es una pintura frontal puesta donde el ojo espera un plano que se aleja.

**Los siete síntomas, con cifras:**

| # | Síntoma | Cifra |
|---|---|---|
| 1 | Se ve el **7,7 %** de cada panorámica | ventana fija de 555×218 px (col. 166-720, filas 552-769) de 1774×887 |
| 2 | Ampliación | ×3,5 a 720p · ×5,25 a 1080p · **×8,2 en móvil** · ×10,5 a 1080p dpr2 (fuente: 4,93 px/grado; pantalla 17,3-51,8) |
| 3 | Anamorfosis | el azimut aporta 7,09 px/grado y la elevación 4,93 → todo sale **1,44× más alto** de como se pintó |
| 4 | Jerarquía invertida | el fondo es **más claro que la arena en los cinco packs**, de +38 a +70 de L |
| 5 | Silueta del disco comida | ΔL mediana 35,2 (jungle) y 35,4 (kitsune) con **mínimos de 0,4 y 1,1** — verde sobre verde, gris sobre gris. Esto es gameplay, no estética |
| 6 | La niebla no puede unir nada | three crea el material del background con `fog:false`: `FogExp2` **jamás** toca el cielo. Sobre geometría mezcla 4,1 % en el borde cercano y 10,8 % en el lejano |
| 7 | Una luz para cinco mundos | `hemi`/`key`/`rim` son `const` **locales** en `src/scene-atmosphere.ts:69-90` — intocables desde fuera. El sol pintado está desfasado 9° (coral), 66° (tundra), 129° (kitsune), 136° (jungle), **164° (desert, opuesto)** |

**Línea base medida sobre `.tmp/shots-despues/*.png`** (congelar antes de tocar nada; ojo: las cinco capturas llevan el donut blanco del Shockwave encima, que contamina cualquier medida — hay que enmascararlo o capturar con VFX apagados):

| pack | % fondo | L fondo | L arena | sat fondo | sat arena | lapVar fondo | lapVar arena |
|---|---|---|---|---|---|---|---|
| jungle | 47,3 % | 121,9 | 77,6 | 0,374 | 0,618 | 9,1 | 407,2 |
| frozen_tundra | 43,3 % | 204,7 | 134,9 | 0,235 | 0,136 | 21,5 | 220,6 |
| desert_dunes | 43,9 % | 176,0 | 107,4 | 0,536 | 0,644 | 28,7 | 120,0 |
| coral_beach | 57,7 % | 182,2 | 114,6 | 0,595 | 0,449 | 14,1 | 209,8 |
| kitsune_shrine | 46,2 % | 140,9 | 102,4 | 0,079 | 0,283 | 20,6 | 721,4 |

**Y por qué la fase 1a lo destapó:** el void (cilindro r=40 al 90 % + disco a y=−30) se quitó el 2026-09-06 justo porque tapaba el skybox "en el cono que ve la cámara"; el anillo de sombra de contacto se probó y se descartó el mismo día por leerse como halo sucio sobre horizontes claros (`src/arena.ts:379-396`, la razón está escrita en el propio código). Quitar el tapón no rompió nada: **enseñó lo que ya estaba roto.**

**Un punto del brief está caducado:** el comentario "camera-attached backdrop" de `src/camera.ts` ya está corregido (líneas 19-24, marcado 2026-09-06).

---

### 2. El plan: **la isla flotante** (escenografía 3D en capas, 0 bytes de payload)

Se sustituye el papel pintado por **mundo**. La arena pasa a ser una isla que flota sobre un mar de su bioma (agua, mar de nubes, dosel, dunas, hielo) 32 u más abajo, con relieves a media distancia y una cresta de siluetas al fondo — todo con la misma luz, la misma paleta y el mismo lenguaje plano que los critters. La foto se conserva **solo** para la pantalla de fin de partida, que es el único encuadre donde la cámara ve el horizonte.

Por qué gana: es la única propuesta con prototipo ya ejecutado sobre el juego real, no mete GLSL en un repo que nunca ha tenido un `ShaderMaterial` (grep vacío en `src/`), cuesta **0 bytes** y hace que la niebla que hoy no sirve para nada empiece a funcionar por construcción — en cuanto el fondo es geometría, la misma `scene.fog` tiñe disco y mar.

**Verificaciones que he repetido yo antes de firmar:**
- Un plano a **y = −32** es alcanzado por todos los rayos de fondo a 146 u de cámara en 16:9 (radio 116 u desde el centro), 161 u en 21:9 (radio 134 u), 126 u en móvil retrato (radio 89 u). **Un mar de r=170 tapa la foto al 100 % en los tres aspectos durante la partida.**
- y=−32 está por debajo de `VOID_FLOOR = -30` (`src/arena.ts:755`) y de `FRAGMENT_KILL_Y = -25` (`src/arena.ts:1223`): nada del juego lo atraviesa nunca.
- **Corrección propia al injerto del juez:** propone subir el mar a r=400 para esconder su borde en la pantalla final. Con `far = 200` (`src/camera.ts:56`) eso se **recorta** y la foto asoma exactamente en la banda que se quería tapar. Lo correcto es **r = 300 + `far` 200→500 + `near` 0,1→0,5** (nada se dibuja a menos de 0,5 u ni en el plano corto, que está a 4,5 m). A 300 u la niebla mezcla el 99,7 % y el borde desaparece; a 170 u solo el 84,3 % y se ve una línea de horizonte falsa al 38 % de altura del cuadro final.

#### Fases

| Fase | Qué | Días | Payload | Ficheros |
|---|---|---|---|---|
| **0. Luz por bioma** *(va sola y primero)* | Sacar `hemi`/`key`/`rim` a refs del módulo y añadir `applyPackLighting(packId)`: azimut/elevación/color/intensidad por pack. Bajar la key de 45° a ~28° para que la sombra proyectada salga de debajo del bicho. Arregla la causa 7 sin depender de ninguna arquitectura de fondo. | 0,5 | 0 | `src/scene-atmosphere.ts:69-90`, `src/arena-decorations.ts` (`PackDef`) |
| **1. El mar** *(primer slice, §3)* | Anillo 96×7 a y=−32, r=300, `MeshBasicMaterial` + vertexColors + fog. Rampa de perspectiva aérea **horneada en el color de vértice** (no delegada al fog: con density 0,008 todo lo que pasa de r≈100 se funde a color liso, que es el fallo contrario al actual) y sombra de la isla horneada. `far`/`near` de cámara. | 0,5 | 0 | nuevo `src/arena-backdrop.ts`; `src/arena-look.ts` (+`BACKDROP_LOOK`, +`SALT_BACKDROP`); `src/arena-decorations.ts` (`PackDef.backdrop`); `src/arena.ts:493`, `:689`; `src/camera.ts:56` |
| **2. Contrato de silueta** | Banda `rim` de r=12 a 15 en los cinco packs, con el **signo** decidido por el valor de la arena de cada uno (clara en kitsune/tundra, oscura en coral/jungle) y la condición dura \|ΔL\| ≥ 45 contra el canto. Es la restricción 4 convertida en aserción. | 0,5 | 0 | `src/arena-backdrop.ts`, `PackDef.backdrop` |
| **3. Relieves, cresta y héroes** | `InstancedMesh` (hoy no se usa en ningún sitio: ~15 líneas nuevas) con 10-16 relieves a r 20-70 y 20-30 siluetas a r 45-90 — ahí la niebla deja entre 40 % y 57 %, que es donde una silueta se lee como lejana pero se lee. Héroes = GLB del pack **ya cacheados**, solo los de <10k tris (torii_gate_large 5,3k · kitsune_statue_white 5,4k · iceberg_* 5,1-5,4k · pine_snow 3,7k · sandstone_spire_* 5,1-6,6k · shipwreck_hull_piece 6,9k). Prohibidos hasta la dieta 1b: palm_beach_tilted 131k, tree_palm_mid 126k, bamboo_cluster 121k, sakura_tree 79k. | 1,5 | 0 | `src/arena-backdrop.ts`, `PackDef.backdrop` |
| **4. Lo que el mar destapa** | Fundido de opacidad en los últimos 0,3 s de la caída del critter y de los fragmentos: hoy un bicho cae 12 u/s durante 0,8 s (9,6 u) y **se esfuma en el aire a 22 u sobre el agua**. Hoy no se nota porque debajo no hay nada. Va en el mismo lote, no después. Más `dispose()` del pack saliente en `clearPack` (`src/arena.ts:689`): `textureCache` (`src/arena-decorations.ts:284`) no expulsa nunca y el cube RT de 6×887² vive mientras viva la fuente → 32 MB de VRAM por pack, 160 MB tras cinco partidas. Como conservamos la foto para el end-screen, **esta fuga no se cierra sola**. | 0,5 | 0 | `src/critter.ts`, `src/arena.ts:689`, `:755` |
| **5. Herramienta (dual surface, mismo día que la fase 1)** | `--viewport WxH` y `--pose gameplay\|end` en `scripts/arena-shots.mjs` (hoy clavado a 1280×720 en la línea 34, que es el caso **más favorable**), con VFX apagados o enmascarados. `setArenaLook` aceptando claves de backdrop y devolviendo `{applied, rebuilt, rejected}` — hoy **descarta en silencio** cualquier clave que no exista y su set `STRUCTURAL` es `{tileSize, bandTint, tintBase, fragmentTintJitter, cliffTint}` (`src/tools/dev-api.ts:627-641`), así que un agente que se equivoca de clave cree que aplicó. Nuevo `scripts/arena-metrics.mjs` como puerta. | 0,5 | 0 | `scripts/arena-shots.mjs`, `scripts/arena-metrics.mjs`, `src/tools/dev-api.ts` |

**Total: 3,5 días. Payload nuevo: 0 MB** (dist medido hoy: 70 MB contra el ratchet de 75 en `scripts/check-payload-budget.mjs:33`). Coste de render del prototipo: **+2 draw calls y +1.368 triángulos** sobre 88 draws / 1.102.851 tris; el plan completo estima +5 draws y ≤14k tris (+0,7 % de triángulos).

**Puertas numéricas** (`arena-metrics.mjs`, enganchado a `npm run check` como gate blando):
- `%foto` = 0,0 en los cinco, a 1280×720, 1920×1080 **y 390×844**.
- `L_fondo < L_arena − 20` (hoy los cinco están +38 a +70 por encima).
- `ΔL` de silueta del canto ≥ 45, mínimo local ≥ 15.
- Saturación **bidireccional**: banda 0,4-0,9 × la de la arena. Un techo simple es una trampa — kitsune ya está en 0,079/0,283 = 0,28 y aprobaría hoy siendo el peor pack del lote; tundra está en 1,73 y suspende siendo de los que menos cantan.

---

### 3. Primer slice: medio día, solo el mar

**Alcance, deliberadamente pelado:** `src/arena-backdrop.ts` con **únicamente** la capa del mar (anillo 96×7 a y=−32, r=300, Basic + vertexColors + fog), la rampa de color por pack y la sombra de la isla horneadas en los vértices; `BACKDROP_LOOK` + `PackDef.backdrop.seaRamp`; alta en `applyPack` (`src/arena.ts:493`) y baja en `clearPack` (`:689`); `far`/`near` de cámara; `setArenaLook` aceptando las claves nuevas; `arena-shots.mjs --viewport`; `arena-metrics.mjs` escrito **antes** de tocar nada, corrido contra las capturas actuales para congelar la línea base.

Nada de relieves, nada de siluetas, nada de animación. El valor entero del enfoque se demuestra con el plano y la niebla; meter lo demás antes de tener las cifras convierte una prueba limpia en una opinión.

**Criterio de éxito VISUAL** — lo que Rafa tiene que poder decir mirando las cinco capturas:

> **La isla ya no está recortada sobre una foto: está flotando sobre un sitio.**

Desglosado en lo que se ve, no en lo que se mide:
1. En **coral_beach**, donde hoy hay una mancha turquesa uniforme (lapVar 14,1 contra 209,8 de la arena: literalmente cero información), se ve **agua que se oscurece hacia dentro y se aclara hacia el fondo**, con el canto de arena recortándose contra ella.
2. En **kitsune_shrine** y **jungle**, el fondo **inmediatamente detrás del canto** es lo más oscuro del cuadro, y el borde del disco se sigue con el dedo en toda su vuelta — hoy hay tramos donde no existe (mínimos de 1,1 y 0,4).
3. En los cinco, la **arena es lo más claro y saturado de la pantalla**, no lo más oscuro.
4. En ninguno se ve una línea de horizonte dura ni un canto de "terreno que no se pisa".
5. El fondo tiene **gradiente de profundidad**, no lavado plano — el fallo que hay que vigilar en este slice no es el actual, es el contrario: que quede vacío.

**Y el número que lo acompaña:** `%foto = 0,0` en los cinco y en los tres viewports, `L_fondo < L_arena`, `ΔL` de silueta ≥ 40 en jungle y kitsune, `getPerf()` con ≤ +3 draw calls y ≤ +2k triángulos.

Si a ojo no convence, se borra **una línea** (`scene.add(backdrop)`) y no se ha perdido nada: cero payload, cero assets, cero cambios en gameplay, cero golden regenerado.

---

### 4. Qué se descarta, y por qué

**Subir las panorámicas a 4K.** Los master de `public/images/skyboxes/_raw/*.png` son **1774×887** — verificado, no existe original mayor. Cualquier reescalado es upscale puro: cero detalle nuevo. Y three convierte la equirect en un `WebGLCubeRenderTarget` de lado = `image.height`, así que la VRAM pasaría de 32 MB a **170,7 MB por pack** (853 MB los cinco). Cabe en payload (0,71 MB los cinco a q80) y es la peor relación coste/beneficio de la mesa. *Barato y compatible con todo: reencodear los cinco a q90 cuesta +0,21 MB y recupera entre el 13 % y el 42 % de micro-detalle que se está comiendo el q80 — pero es un parche, no una solución.*

**Regenerar las cinco panorámicas con IA.** Cabe en payload, pero: las herramientas que ya usa Rafa (Meshy, Tripo, Suno) no generan panorámicas → licencia comercial nueva que decidir; un modelo texto-imagen genérico produce una matte 2:1 que **no** es equirect, que es exactamente el defecto de las cinco actuales (horizonte pintado en v 0,537-0,594 en vez de 0,500); y aun saliendo perfecta, **el 93 % del fondo visible sigue siendo terreno a menos de 24 u, que una esfera en el infinito no puede representar**. Un día entero de arte para no atacar la causa. Va la última, si acaso.

**Subir la densidad de niebla.** Para mezclar un 50 % en el borde lejano del disco haría falta `density 0,0197` (×2,5), y el cielo seguiría intacto por el `fog:false` del background: solo se lavaría la arena. La niebla es la solución **después** de que el fondo sea geometría, nunca antes.

**El "delantal" de suelo a y=−4 con la textura del propio bioma.** Reabre una decisión matada dos veces (props exteriores 2026-04-25, falda en fase 1a) con la peor combinación posible: la misma textura de suelo del pack a 4 u por debajo de la tapa. La objeción histórica escrita en `src/arena.ts:380-396` no era "se ve un canto duro", era "parece que el terreno sigue donde no puedes andar" — y eso lo decide la banda interior, que es justo lo que ese diseño rellena. Además **no tapa la foto donde más canta**: un rayo de esquina superior (−22,10°) corta el plano y=−4 a 66,5 u de radio, fuera de un anillo que ya es transparente en r≈30. Las esquinas superiores seguirían siendo foto, solo que teñida.

**Fondo procedural en shader (analítico, sin geometría).** Es el mejor estado final de las tres propuestas y su lectura del problema es la más aguda — pero cuesta 4 días, sería el **primer GLSL del repo**, cambia el modelo de niebla de toda la escena, y su propio autor admite que el camino crítico es el arte, que ahí se escribe en shader en vez de pintarse. Se descarta **por ahora, no para siempre**: la fase 1 del diorama es su banco de pruebas, y si el mar horneado se queda corto de riqueza, la migración a shader es un reemplazo de una capa, no un rediseño.

**Activar ACES tone mapping como parche.** `WebGLBackground` fuerza `toneMapped = false` cuando el background es sRGB: hoy activarlo tocaría critters y suelo pero **no** el fondo, y la desincronía empeoraría. Solo tiene sentido cuando el fondo sea geometría.

---

### 5. Cómo afecta a cada bioma

Mismo esqueleto en los cinco (mar + relieves + cresta + héroe reutilizado). Lo que cambia son paleta, silueta y densidad — eso es lo que los hace hermanos y reconocibles a la vez: **cinco climas de un mundo de islas flotantes, no cinco cuadros de cinco sitios.**

**🐠 coral_beach — "la torre de coral en la laguna".** El peor caso de partida: **57,7 % del cuadro es foto**, L 182,2 contra 114,6 de la arena, saturación 0,595 contra 0,449, lapVar 14,1 contra 209,8 — un borrón turquesa sin un solo borde (se ve en la captura: no hay nada ahí). Y es donde lo generado gana por goleada, porque **el mar es una superficie procedural por naturaleza**. Mar a y=−32 con tres bandas concéntricas al disco: bajío de arena mojada en r 12-19, turquesa somero hasta r 33, teal profundo después; límites ondulados con una octava de ruido sobre el azimut. Agua **oscura cerca y clara lejos** (perspectiva aérea correcta): el canto de arena pasa a recortarse contra L 50-68 → ΔL 60-100. Espuma blanca (banda `rim`) pegada al acantilado: el mayor contraste del cuadro, exactamente donde el juego necesita que mires. Héroe: `shipwreck_hull_piece.glb` (6,9k tris, ya cargado) encallado a r 30. Bonus de gameplay: caer al vacío pasa a ser caer **al agua**, con salpicadura reutilizando `src/dust-puff.ts`.

**⛩️ kitsune_shrine — "el santuario sobre el mar de nubes".** El peor caso de **gameplay**: ΔL mediana 35,4 con mínimos de 1,1 — hay tramos del canto donde el borde del vacío, que es la información crítica del juego, no existe (piedra gris sobre bruma gris; se ve en la captura). Y ojo, aquí hay un matiz que casi todo el mundo se salta: **su banda visible no es lavado muerto** — tiene cedros, una pagoda y un torii identificables, y está pintada desde arriba, que es el único pack cuyo punto de vista casa con la cámara. Lo que falla es el idioma: sat 0,079 contra 0,283 de la arena. **A kitsune hay que subirle color y bajarle valor, no desaturarlo.** Mar de nubes a y=−30: oscuras cerca (con la sombra de la isla horneada encima → L≈42 justo bajo el canto), retroiluminadas lejos hacia el `fogColor` ciruela que ya existe. El ΔL del canto sube de 35 a ~65 **por construcción**. Cúmulos a r 20-70 que pasan por detrás del canto: cada uno es una ruptura de contraste. Héroes 0 bytes: `torii_gate_large.glb` ×10 sobre un banco de nubes a r 70 y `kitsune_statue_white.glb` ×6 a r 45 — los mismos objetos que el ilustrador pintó plano y a la altura del ojo, ahora en 3D, con la luz del juego y con escorzo.

**🌴 jungle.** El otro pack con el borde comido (ΔL 35,2, mín 0,4: verde sobre verde). Mar de copas a y=−32, verde profundo cerca (contra los 77,6 de L de la hierba del disco; hoy la foto está +44 **por encima**) aclarando al horizonte, con jirones de bruma horneados en los valles del ruido. La sombra de la isla oscurece el dosel justo detrás del canto y el disco soleado salta al frente. Todo procedural: los cuatro GLB de jungle van de 21k a 126k tris, ninguno entra. Es el pack más denso: la cresta sube a 30 instancias.

**❄️ frozen_tundra.** El menos roto en silueta (ΔL ~76) y el más claro de todos: L 204,7 contra 134,9. Su movimiento es de **valor**, no de tono — el `fogColor` ya casaba. Mar helado con placas y grietas horneadas, azul cerca → casi blanco lejos; témpanos a la deriva a r 22-60 y cordillera a r 55-90 reutilizando `iceberg_low/mid/tall` y `pine_snow` (2 draws, ~11k tris, 0 bytes). Riesgo de arte propio de este pack: el hielo **no** puede leerse como pisable — se resuelve con la profundidad (32 u), un tono más oscuro que la tapa y grietas de escala imposible.

**🌵 desert_dunes.** Aquí el terreno **continúa** y la isla se lee como meseta sobre un cañón. Mar de dunas con crestas horneadas como arcos de vértice, naranja quemado cerca → arena clara lejos; mesas y agujas a r 45-90 reutilizando `sandstone_spire_tall/short` y `cactus_saguaro`. Es el bioma con más filas muertas en la ventana visible actual (127 de 197): **el que más información gana por menos trabajo**. Y el de peor desfase de luz (sol pintado a 164° de la key, o sea justo al revés): la fase 0 lo arregla sola. Densidad baja a propósito — los huecos son la composición, igual que en el layout de decor interior.

---

### 6. Lo que necesita decidir Rafa (dos cosas)

**Decisión 1 — ¿El vacío deja de estar vacío?**
Poner un mar visible 32 u por debajo cambia la ficción del juego: hoy caes a la nada, mañana caes al agua / a las nubes / al dosel. Es la mecánica central, así que no lo decido yo. A favor: es la única forma de dar contacto, escala y jerarquía de valor (todos los referentes cenitales — Brawl Stars, Fall Guys, Stumble Guys — tienen algo debajo que toca la plataforma), y **darle destino a la caída puede reforzar el castigo en vez de debilitarlo**: una salpicadura se lee peor que una desaparición. En contra: si se lee como "ha aterrizado" en vez de "ha muerto", hemos roto lo importante para arreglar lo bonito.
**Recomendación: sí, con tres seguros** — profundidad de 32 u (nunca a la altura del canto), material y color distintos y más oscuros que la tapa, y el fundido de caída de la fase 4 en el mismo lote. Y se decide **mirando la captura del primer slice**, no antes. Si sale mal, se borra una línea.

**Decisión 2 — ¿Qué hacemos con las cinco fotos?**
Tras este cambio dejan de verse en partida y solo sirven para la pantalla final (la pose de victoria está a −16,11° con el techo del cuadro en **+3,89°**: es el único encuadre que ve el horizonte). Coste de conservarlas: 270 KB de dist y 32 MB de VRAM por pack (160 MB si se juegan los cinco), más el trabajo de que el borde del mar case en color con la banda baja de cada foto.
**Recomendación: conservarlas en esta tanda** con el `dispose()` de la fase 4 puesto, y **volver a mirarlo con la captura `--pose end` en la mano**. Si el remate de partida se sostiene sin ellas, se sustituyen por un gradiente procedural en un commit de una tarde y se ganan −0,27 MB de payload y −160 MB de VRAM por sesión. Es una decisión que se toma mejor con una imagen delante que ahora.

*(Lo que NO necesita decisión: subir `far` de 200 a 500 y `near` de 0,1 a 0,5 en `src/camera.ts:56` es un requisito técnico del mar de r=300, con impacto medido de un bit de precisión de profundidad y nada dibujándose a menos de 0,5 u ni en el plano corto.)*