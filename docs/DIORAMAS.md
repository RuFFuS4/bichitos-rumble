# Dioramas y fondo — de adornos sueltos a un lugar

<!-- Origen: dos tandas de agentes del 2026-09-07 sobre dos peticiones de
     Rafa: "rehacer la generación de los dioramas… que se vea como algo
     denso, como un ambiente real" y "unificar el fondo para que no
     parezca una foto mal puesta". La sección del fondo está cerrada y
     verificada; la de dioramas llega cuando termine su tanda. -->

> **Estado de ejecución al 2026-09-07.** Esto es el PLAN, no el
> inventario de lo hecho (eso vive en `NEXT_STEPS.md` §H4.5 y en
> `BUILD_LOG.md`). Para que nadie rehaga trabajo ni dé por escrito lo que
> no existe:
>
> - **Fondo**: hecho el slice del mar (plano con la rampa del bioma
>   horneada, niebla que tiñe, sombra de la isla). **Rafa lo rechazó el
>   2026-09-21** con cuatro quejas («no se lee qué hay abajo», «está
>   vacío», «quiero cielo, no suelo», «fuera la foto del final»). El plan
>   que lo sustituye es **«Fondo v2 — la isla en el cielo»**, más abajo, y
>   anula las §2-§6 de esta parte en lo que las contradiga. La luz por
>   bioma pasa a ser su F3.
> - **Dioramas**: hechas la fase 0 (medición honesta) y el slice 1 (motor
>   instanciado, 7 primitivas, recetas de los 5 biomas, canto con masa y
>   sombras de contacto). El resto, pendiente.
> - **No existen** `scripts/arena-metrics.mjs` ni
>   `scripts/validate-arena-packs.mjs`, que el texto da por escritos y
>   enganchados a `npm run check`. Quien los necesite, que los escriba.
> - Donde el diagnóstico dice "cero instancing en el proyecto", léase
>   "antes del slice 1": hoy hay dos (`arena-scatter.ts`,
>   `blob-shadows.ts`).

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

---

## Fondo v2: la isla en el cielo (plan del 2026-09-21)

*Esto responde al veredicto de Rafa del 2026-09-21 sobre el fondo actual: marcó las cuatro quejas. Hubo cuatro propuestas (geometría, textura de Rafa, shader y escenografía) y dos juicios independientes. Los dos eligieron la de geometría, con 46,5 y 48,5 sobre 60, así que no hay empate que deshacer.*

*Lo que sigue es esa propuesta con lo mejor de las otras tres injertado. Todas las cifras están rehechas sobre el código de `1865521`. Es la decisión, no el debate.*

*Después, un verificador adversarial revisó 62 afirmaciones contra el código. Encontró 8 errores y 13 huecos, y están corregidos aquí. El que más pesa: `bandTint` multiplica en espacio lineal, así que el techo de jungle es ≈25 y no 18,6, y desaparece la decisión del «abismo casi negro».*

*Qué se tomó de cada una:*
- *De textura-rafa: los pisos de nubes y el sitio que le toca a `clouds.png`.*
- *De shader: el reloj de `tickVisuals`, el color de limpiado, la CLI sin navegador y una única dirección de key.*
- *De escenografía: el cuello de nubes, los islotes dentro del slice, la vida y la hoja de contactos ampliada.*

***Este plan anula las §2-§6 de arriba en todo lo que las contradiga.** Ya no hay mar bajo la isla, y la foto también se va de la pantalla final.*

---

### 1. Qué cambia respecto al plan anterior, y por qué

| Queja de Rafa | Qué había | Qué cambia |
|---|---|---|
| 1. «No se lee qué hay abajo» | Un anillo a y=−32 con un degradado horneado (`src/arena-backdrop.ts:47-159`). De lejos, un color liso. | Cada bioma tiene su «abajo»: un abismo de su color, islotes a varias profundidades y, desde F1, lo que cuelga de ellos (lianas, carámbanos, cascadas). |
| 2. «Está vacío, falta mundo» | Los relieves y la cresta del plan anterior (§2, fase 3) no se llegaron a hacer. | Islotes hermanos entre r 45 y 200 u (6-8 genéricos ya en el slice), nubes en tres pisos, torres de cúmulo y una firma por bioma. |
| 3. «Quiero cielo, no suelo» | El concepto era «isla sobre un mar a y=−32» (§2, línea 77): un plano bajo la isla, que se lee como suelo lejano. | **Cambia el concepto.** Bajo la isla no hay nada continuo. Justo debajo hay un pozo de cielo. El mar de nubes empieza entre 48 y 64 u por debajo del disco y se abre en cráter alrededor del pozo. |
| 4. «La foto, el horizonte del final» | Dos cosas: `scene.background` con la panorámica (`src/arena.ts:678-685`), que asoma con cámara baja, y el borde del mar de r=300, que la cámara de victoria ve como una raya entre −6,2° y −6,9°. | Todo generado. Una cúpula con color por latitud que sigue a la cámara, y nubes lejanas que se funden al 100 % con el color del horizonte. Cero fotos, también en la pantalla final. |

**Por qué falló abril** (autopsia hecha en el historial):

- **`0f4788e`**: una cúpula `ShaderMaterial` de r=200 centrada en el origen, con el degradado calculado por `vWorldPos.y/200`. Como la cámara mira 46° hacia abajo, solo se veía la banda baja.
- **`9047031`**, revertido 22 min 23 s después en `9b33e99` con el mensaje «covered the visible frame in white»:
  - Montaje: `clouds.png` (el mismo fichero que hoy está en `resources/Terrenos/`, 837.335 B) repetida 4×4 en un plano de 140×140 a y=−18, con opacidad 0,85 y `fog:false`. Encima, un cartel vertical de 90×25 en (0,−25,−50).
  - Por qué tapó el cuadro: todos los rayos de juego van hacia abajo, así que un plano 18 u por debajo del disco llena el fondo entero.
  - Por qué de blanco: los píxeles opacos de `clouds.png` tienen L de 205 a 255 (mediana 250, medido), más claros que cualquier arena (L 78-135).
  - Por qué se leía como foto: un cartel frontal visto desde 32-46° por encima es la «foto mal puesta».
  - Fueron 6,5 MB de PNG y no se hizo ninguna captura antes.
- **`b054e96`**: quitó las esferas texturizadas por las costuras («vertical seams… depending on the GPU»). También quitó el plano de nubes de 80×80 porque dejaba «a visible step where it ended».

**Reglas que salen de ahí:**
1. Nada con textura sobre un plano.
2. Nada claro pegado al canto.
3. El color del cielo sale de la dirección del rayo: una cúpula pegada a la cámara, con color por latitud y sin UV. Sin UV no hay costura.
4. Ninguna capa termina dentro del cuadro. Lo que llega al horizonte se funde al 100 % con su color.
5. Cada capa se juzga con capturas de todas las poses antes del merge.

**Cifras corregidas.** Tres de las cuatro propuestas arrastraban estos errores:
- **El mar tiene 6.912 triángulos**, no 1.344: 96×36×2, con `seaRings: 36` en `src/arena-look.ts:189`. El comentario de `src/arena-backdrop.ts:27` es del prototipo 96×7 (§2, línea 91).
- **Banda de −10° en la victoria.** Desde la cámara de victoria (y=2,5), un rayo a −10° corta y=−50 a 298 u, no a 360. Los 360 u corresponden a −8,3°. Por eso la banda de −8,3° a −12° sí toca geometría si hay nubes hasta r 340.
- **`scripts/arena-shots.mjs` tiene 111 líneas.** No tiene ni `pose` ni `camera`.
- **`FRAGMENT_KILL_Y` está en `src/arena.ts:1439`.**
- **El `visible=false` de `src/critter.ts:1182` solo corre en `eliminate()`.** Con vidas, el bicho no se oculta: `respawnAt` lo teletransporta arriba.

---

### 2. Concepto

**La isla cuelga sobre un pozo de cielo.** Justo debajo hay un abismo del color de su bioma. Alrededor, un mar de nubes con relieve se abre en cráter en torno a ella. Entre medias flotan islotes hermanos a varias alturas: si ves islas más abajo que tú, estás alto. Al fondo, que solo se ve con cámara baja, hay torres de cúmulo y un horizonte de bruma sin línea.

Todo es geometría con color de vértice: 0 bytes, sin GLSL, y con `InstancedMesh` como el scatter.

**Lo que lo hace barato y seguro es que la cámara de juego no rota nunca** (§1). Todo lo que depende de la vista se calcula una vez al construir:
- dónde no puede haber nada claro (el pasillo del canto, §8);
- cuánta bruma lleva cada nube;
- qué queda tapado por el disco.

**Tres profundidades:**
1. el cuello de nubes en sombra que abraza la punta del cono;
2. el mar de nubes y los islotes;
3. el abismo, que es la cúpula y no un suelo.

---

### 3. Capas

| Capa | Qué es | Técnica | Dónde | Draws | Tris | Fase |
|---|---|---|---|---|---|---|
| **Cúpula** | Cielo arriba, bruma en el horizonte, abismo abajo. | Esfera de 48 columnas. Las filas de latitud van en las elevaciones de las paradas, no repartidas por igual, para que el techo del abismo empiece justo donde toca. `BackSide`, `MeshBasicMaterial` (`vertexColors`, `fog:false`, `depthWrite:false`, `dithering:true`). Sigue a la cámara en su `onBeforeRender` con `this.matrixWorld.copyPosition(camera.matrixWorld)`, como hace `WebGLBackground.js:116`. Mover `position` no basta: la `modelViewMatrix` (`WebGLRenderer.js:2128`) usa `matrixWorld`, que ya se calculó en `:1635`. | r 420 (`far` 500) | 1 | ≈2,2k | F0 |
| **Nubes cercanas (C2) + cuello** | Mar de nubes, pared del pozo y cuello en sombra alrededor de la punta. | `InstancedMesh` de un bulto: semiesfera 14×3 = 70 tris, con base plana y alto 0,75 del radio. Rampa vertical en el color de vértice (cima 1,0, panza `cloudBelly` 0,8). Tinte y bruma en `instanceColor`. | **Nubes, 330 instancias:** cimas a y −64 en el borde del pozo, que suben a −48 desde r 190. Van del borde del pozo (r ≈95-165, lo fija el pasillo) a r 220. **Cuello, 30 instancias:** y −7…−16, r 5-19, teñidas al techo del abismo. | 1 | 25,2k | F0 |
| **Nubes lejanas (C3)** | La banda que se funde con el horizonte. | Otro `InstancedMesh` con un bulto de 8×2 = 24 tris y **color de vértice plano**. | Centros en r 225-340 (ningún bulto de 25-45 u baja de r 180, que es lo que alcanza el cuadro 16:9 en las esquinas a y≈−56), **cimas** en y ≈ −48…−56, 160 instancias | 1 | 3,8k | F0 |
| **Islotes genéricos** | Dan la escala: la isla es una de muchas. | `InstancedMesh` de un minicono de 16 lados (112 tris). La tapa lleva `PackDef.sky.isletTop`, un campo nuevo (el suelo del pack es una textura y no tiene un color que leer), **más oscuro y desaturado que la arena** para que no parezca una plataforma a la que saltar. La panza lleva su `CliffRamp`. `MeshLambertMaterial` iluminado, `fog:false`, con bruma hacia el abismo en `instanceColor`. | 6-8 islotes, al menos 3 dentro del cuadro de juego. r 45-110, cima en y −28…−60, radio 1,5-6 u. | 1 | ≤0,9k | F0 |
| Jirones (C1) | El aire entre la isla y el mar. | Bultos pequeños en la malla de C2. | y −20…−30, r 25-70, solo en las alas y las esquinas | 0 | +2,8k | F1 |
| Firmas | Corona y colgante de cada bioma (§4). | Primitivas del scatter (`dome` 36 tris, `shard` 8, `log` 24) más una cinta vertical opaca para las cascadas. | Sobre y bajo los islotes | 2 | ~2k | F1 |
| Torres de cúmulo | Rompen el horizonte de la victoria. | Pilas de bultos en la malla de C2. | r 260-360, y −48…+45. Desde la cámara de juego quedan entre +5° y −17°, por encima del techo del cuadro. | 0 | +4,9k | F2 |
| Fondo del pozo | Profundidad del «abajo». | Bultos en la malla de C2 con el tinte del abismo: por debajo del techo dentro del pasillo, ±15 de L fuera. | y −150…−175, r 0-160, 60 instancias | 0 | +4,2k | F2 |
| Deriva | Las nubes se mueven y la isla no. | Las instancias que no tocan el pasillo **en el arco que recorren en una partida** (≈12° en 120 s) pasan a una malla gemela que gira. Comprobar la órbita entera dejaría quieto casi todo C2 entre r 95 y 165, porque la huella del pasillo va de r≈15 por delante a r≈100-130 por detrás. | 0,1°/s, ≤0,35 u/s en lo que se ve en juego (r 193) | 1 | 0 | F2 |
| Vida | Aves por debajo de la isla; nieve, pétalos o polvo cayendo al vacío. | Un `InstancedMesh` con matrices calculadas en CPU. Órbitas y columnas de caída se comprueban contra el pasillo al construir. | Por debajo de y −12 | 1 | ≤0,3k | F2 |
| **Sale el mar** | Anillo a y=−32, r=300 | — | — | −1 | −6,9k | F0 (A/B), se borra en F4 |
| **Sale la foto** | El pase de `scene.background`: una caja de 12 tris que va primera en la lista opaca (`WebGLBackground.js:168`) y sobrepinta el cuadro entero. | — | — | −1 | −12 | F0 (A/B), se borra en F4 |

Todas las capas cuestan 0 bytes. Cada cifra de la tabla es una clave de `BACKDROP_LOOK` o de `PackDef.sky` (§9).

**Por qué hay una malla plana para las nubes lejanas.**
- `instanceColor` **multiplica** el color de vértice: `vColor.rgb *= instanceColor.rgb` en `color_vertex.glsl.js`.
- Con la rampa, una nube al 100 % de bruma sigue teniendo la panza un 20 % más oscura que el horizonte. Eso devuelve la raya del §1 entre −10° y −13° desde la cámara de victoria.
- Con color de vértice plano, `instanceColor` es el color final exacto. A r ≥ 280 vale lo mismo que el horizonte de la cúpula, y la nube desaparece sin borde.
- **Regla general:** lo que se funde con el abismo oscuro puede llevar rampa, porque oscurecer sí se puede multiplicando. Lo que se funde con el horizonte claro va en malla plana.

**Bruma.** Sigue `smoothstep(120, 280, r)` hacia el color del horizonte.
- En juego, lo visible llega a r 154-193 en 16:9, así que la bruma se queda en 0,12-0,43. Es lo mismo que el `hazeMax` 0,42 del mar de hoy.
- Desde la victoria, a r 280 la bruma es del 100 %.

**Relleno de píxeles.**
- El grupo del fondo pasa de `renderOrder` −10 a +5. Hoy (`src/arena-backdrop.ts:172`) se pinta el primero y todo lo demás lo sobrepinta.
- Dentro del grupo, la cúpula es la última de los opacos.
- Así la GPU descarta por profundidad lo que tapan el disco, las nubes y los islotes. La cúpula, que es `MeshBasic` sin luz, solo sombrea el cielo que de verdad se ve.
- Hoy la foto y el mar se pintan enteros por debajo del disco.

**Forma de los bultos.** Sale de `clouds.png` como referencia medida, no como textura: base plana, relación ancho/alto 1,32, tamaños en razón 1:8 y dos o tres tintas planas.

---

### 4. Los cinco biomas

Lo que hay detrás del canto tiene que separarse de la banda exterior del disco en |ΔL| ≥ 45. Eso deja dos salidas por bioma: un **pozo oscuro**, por debajo de un techo, o un **pozo claro**, por encima de un suelo:

> techo = L_arena × 0,906 − 45 · suelo = L_arena × 0,906 + 45

- 0,906 es lo que la banda exterior (`bandTint` 0,82, `src/arena-look.ts:84`) oscurece **medido en sRGB**. El 0,82 multiplica en espacio lineal (`tintForBand`, `src/arena.ts:94-98`: `new THREE.Color(hex)` pasa a lineal, `multiplyScalar` y la salida se codifica a sRGB). Comprobado: sRGB 78 → 70,7.
- L_arena sale de la línea base del §1. Esa línea se midió sobre `.tmp/shots-despues/`, que estaban contaminadas (segundo ~52 y donut del Shockwave). Por eso los techos y los suelos son de partida: manda la medida del canto (`--metrics`, §12).

| Bioma | Abajo (techo del pozo oscuro · suelo del claro) | Alrededor | Elemento único |
|---|---|---|---|
| **coral_beach** | Laguna del cielo: turquesa profundo que baja a azul marino, sin verde, porque no es agua. **Techo 58,8** · suelo 148,8. | Atolones con charca turquesa y palmera hechas con primitivas. Cúmulos crema con panza aguamarina, cobertura 35 %. | Cascadas: cintas blancas que caen de los atolones y se funden al color del abismo. Salen de las charcas de `CORAL REEF BEACH.png`. |
| **jungle** | Sima verde húmeda con bruma. Oscura, se queda en L ≤25 y se lee como un agujero. Clara, es una bruma verde-blanca de L ≥115 detrás de un canto oscuro, que se lee como cielo con niebla. **Techo 25,3** · suelo 115,3 (**decisión 2**). | Islotes-maceta con copas apiladas (`dome`). Jirones de bruma. | Raíces y lianas que cuelgan de los islotes y de la punta del cono. |
| **frozen_tundra** | Abismo azul frío, de `0x152230` a `0x283d50`. **Techo 77,2**, el más holgado · suelo 167,2. | Icebergs invertidos (un `shard` grande con tapa nevada y la punta azul hacia abajo) a todas las profundidades. Nubes finas blanco-lavanda, 30 %. | Carámbanos. En F2, nieve que cae y marca la profundidad. |
| **desert_dunes** | Cañón de polvo naranja quemado. **Techo 52,3** · suelo 142,3. | Mesas voladoras con la misma `CliffRamp` estratificada que la isla, para que se lean como hermanas. Calima ocre plana, con poca rampa. | Cascadas de arena. En F2, buitres dando vueltas **por debajo** de la isla. |
| **kitsune_shrine** | Mar de nubes ciruela al anochecer, el más cerrado (70 %). Es la bruma violeta que hay bajo la isla en `KITSUNE SHRINE.png`. **Techo 47,8** · suelo 137,8. | Rocas con torii bermellón (un torii de primitivas, ~50 tris). | Un camino de 5-7 toriis sobre rocas que baja hacia el abismo. En F2, pétalos cayendo. |

**Punto de partida del color.** El abismo oscuro arranca con la parada t=0 de cada `SeaRamp` actual (`src/arena-decorations.ts:135-188`). Esa parada (L de 22 a 32) **ya cumple el techo en los cinco packs**, jungle incluido (22,2 ≤ 25,3). Donde un techo holgado lo permita, el abismo sube hacia él: cuanto más claro y saturado, más se lee como cielo y menos como agujero (riesgo 6).

**Cobertura.** Ningún bioma pasa del 70 %: por encima, el mar de nubes se lee como moqueta (riesgo 1).

**Modelos GLB.** Los héroes de §2 (`torii_gate_large`, `iceberg_*`, de 5-7k tris cada uno) quedan como opción de F1, solo si las primitivas no dan la firma.

---

### 5. Pose de juego y pose de victoria

**Juego.** La cámara está en (0,23,25) mirando a (0,−3,0), con fov 40 (`src/camera.ts:24-25` y `:57`). Todos los rayos van hacia abajo; el borde inferior del cuadro está siempre en −66,0°. Simulación de rayos propia:

| Formato | Techo del cuadro | Disco en pantalla | Radio visible a y=−28 | a y=−48 | a y=−64 |
|---|---|---|---|---|---|
| 16:9 | −22,1° | 31 % | r ≤105 | r ≤154 | r ≤193 |
| 21:9 | −20,2° | 23 % | ≤122 | ≤176 | ≤219 |
| 390×844 | −25,9° | 68 % | ≤81 | ≤122 | ≤155 |

**Qué se ve en juego:**
- **Franja de arriba:** la pared del pozo y el mar de nubes (C2).
- **Alas:** islotes y, desde F1, jirones (C1).
- **Bajo el labio frontal (−60,5° a −66°):** el pozo, el cuello y, desde F2, el fondo del pozo.
- **Lo que el disco tapa:** a y=−56, la silueta del labio r=12 es un círculo de radio 41,2 u (12·79/23) centrado en z=−60,9. Va de z≈−102 por detrás a z≈−20 por delante, con **±41 u de semianchura** por los lados (el punto lateral queda a 73,5 u del eje, que no es lo mismo). Es el pozo. Los islotes de r 45-73 caben por los lados.
- **No se ven:** la panza del cono (sus caras quedan de espaldas a la cámara); C3 (a y=−56 el cuadro llega como mucho a r≈174 en las esquinas 16:9, y ningún bulto de C3 baja de r 180); las torres; el horizonte.
- **En móvil retrato** el disco se sale del cuadro por los lados, así que el fondo son solo dos franjas, arriba y abajo.

**Victoria** (`src/game.ts:1793-1808`). La cámara se pone 4,5 u delante del bicho, a 2,5 de alto, mirando a su pecho (y=1,2). Eso da una inclinación de −16,11°, techo del cuadro en +3,89°, borde inferior en −36,11° y el horizonte al 10,3 % del borde superior. Es la única pose con cielo. Por bandas:

| Banda | Qué se ve |
|---|---|
| +3,9° a 0° | Degradado de cielo de la cúpula. Desde F2, torres de cúmulo. |
| 0° a −8,3° | Bruma del horizonte (`fogColor`). Los rayos cortan y=−50 más allá de 360 u, así que ahí solo hay cúpula. |
| −8,3° a −12° | C3 plana, que llega al 100 % del color del horizonte a r 280. A −10° el rayo corta y=−50 a 298 u y las cimas (y=−48) a 286 u. Si la raya vuelve, vuelve aquí: C3 existe para esto. **Condición en la cúpula:** tiene que seguir exactamente del color del horizonte (`fogColor`) desde 0° hasta −13°, con una fila de latitud en −13°. Si se oscurece antes, C3 al 100 % de bruma deja de coincidir con lo que tiene detrás y la raya vuelve. |
| −12° a −36° | C2 con rampa, islotes, cuello, y la panza si la cámara queda sobre el vacío. |

**Plano general y derrota.** El plano general (`src/game.ts:1837`) tiene el techo en −2,59° (−2,21° en las esquinas). La derrota (`src/game.ts:1813`), en −9,74° (−8,31° en las esquinas). En los dos, el techo cae en la banda de bruma o en C3, y ninguno ve cielo.

**El paso de una pose a otra.** Es un lerp de `dt·2,5` (`src/main.ts:458`). La cúpula sigue a la cámara en cada frame y las nubes son 3D, así que el lerp da paralaje gratis. Lo único que depende de la vista es la cúpula, más el plan B de la decisión 3, que se reorienta en `onBeforeRender`.

**La pantalla final offline está congelada.** La rama `'ended'` (`src/game.ts:2156-2160`) solo llama a `updateFalling` y `c.update`, no a `arena.tickVisuals`. Online sí sigue, porque `tickVisuals` va en cada sync (`src/game.ts:1291`). Justo la pose que ve el horizonte se queda sin deriva ni vida. F2 añade esa llamada con una línea en `game.ts`: tierra de nadie, diff mínimo.

---

### 6. Luz (panza del cono incluida)

**Por qué la panza sale negra.** Medido sobre el cono de `cliffTaper` 0,08 y 9 u (`src/arena-look.ts:91-92`):
- La pared tiene normal (0,632 hacia fuera; −0,775): mira 50,8° hacia abajo.
- La key está en (−11,17,13), con 44,9° de elevación (`src/scene-atmosphere.ts:75-76`). Sobre la panza da n·L ≤ −0,10 en cualquier azimut.
- La rim, en (−10,14,−14) (`:89-90`), da como mucho +0,001.
- Ninguna direccional la toca. Solo le llega el hemisferio, y con un peso de 0,89 del lado del suelo: `0x4a3a26` × 0,55 (`:69`). Sale marrón casi negro.

**F0, en el slice y detrás del flag:**
- `hemi` pasa a ser una referencia de módulo. Su `groundColor` es, por pack, el rebote del mar de nubes:

  | Pack | `groundColor` |
  |---|---|
  | coral | `0x6fb3b5` |
  | jungle | `0x5f7a55` |
  | tundra | `0x8a9cc0` |
  | desert | `0xa8784a` |
  | kitsune | `0x9a7890` |

  La intensidad pasa de 0,55 a 0,7. Es la ficción del concepto: debajo hay cielo iluminado, no tierra.
- **El rebote se probó en vivo, pero no con estos colores:** columna `c2_rebote` de `.tmp/shots-cono2/_hoja_bajo.png`, solo en jungle, kitsune y tundra, con un único `groundColor` `0xc8d8e0` a intensidad 0,8 para los tres. Los colores por pack de esta tabla están sin probar. Se prueban en la hoja del slice.
- **Objetivo con la pose `low`:** panza con L entre 70 y 110, y siempre al menos 30 por debajo del labio.
- **Afecta también a la parte de abajo de los 9 bichos.** Va la nota a PERSONAJES (§7) y una hoja A/B del roster.
- **Plan B que no toca a nadie:** un emisivo de rebote de 0,12-0,2 solo en el material del canto (`cliffMaterial`, `src/arena.ts:281`), dejando el hemisferio como estaba.

**F3:**
- **Rig completo por bioma.** Es la «fase 0» de §2, que sigue sin hacer. `PackDef.sky.light` lleva azimut, elevación, color e intensidad de key y rim, y se aplica con `applyPackLighting()`. Elevaciones de la key para empezar: coral 50°, jungle 35°, desert 35°, kitsune 30°, tundra 25°.
- **Una sola dirección de key por pack alimenta tres cosas:** la luz, el lado claro de las nubes y el halo de sol de la cúpula.
  - El halo es ancho (±20°), para que a 7,5° por celda se interpole sin facetas.
  - `BACKDROP_LOOK.keyDirX/Z` (`src/arena-look.ts:198-199`), que hoy se copian a mano, pasan a derivarse de esa dirección.
  - Así el sol y el cielo no pueden desfasarse. Hoy desert está desfasado 164° (§1, síntoma 7).
- **La punta de cada `CliffRamp`** no baja del 55 % de la L del labio.
- **No se añade una cuarta direccional de rebote.** Encarece cada fragmento de los 9 bichos, que ya se llevan el 75-85 % del frame.
- **F3 cambia a los bichos bastante más que el rebote del hemisferio.** Una key de 25-50° de elevación les cambia el modelado y les alarga la sombra, y el frustum de sombra es de ±18 u (`src/scene-atmosphere.ts:81-84`). F3 lleva su propio A/B del roster y su propia nota en el buzón de PERSONAJES, antes del merge.

**Qué lleva luz.**
- La cúpula y las nubes son `MeshBasic` con el sombreado horneado.
- Los islotes sí van iluminados, con Lambert: son hermanos de la isla y reciben la misma luz.
- Los islotes van con `fog:false`. La `FogExp2` a 60-150 u los lavaría entre un 20 % y un 76 % hacia el `fogColor` claro, y competirían con la arena.

**Tone mapping.** Sin la foto, nada escapa del tone mapping: `WebGLBackground.js:151` lo apagaba para el fondo sRGB. `ARENA_LOOK.toneMapping` pasa a ser coherente en toda la escena. Se sigue activando con el roster delante.

---

### 7. La caída

**Hoy.**
- El bicho cae a 12 u/s durante 0,8 s: 9,6 u en total (`src/gamefeel.ts:111-113`; `updateFalling` en `src/critter.ts:1137-1149`).
- Si le quedan vidas, `respawnAt` lo teletransporta arriba. En la última, `eliminate()` pone `visible=false` (`src/critter.ts:1182`).
- En los dos casos desaparece en el aire, a la altura de la punta del cono.

**Qué se ve de verdad.** Medido con rayos desde la pose de juego, con el bicho cayendo desde r=12,8:
- Por la mitad trasera del borde, el disco lo tapa cuando lleva 0,6-2 u de caída.
- Por el frente, sale del cuadro por abajo a y −4,6.
- Solo en los arcos delanteros-laterales, entre ~45° y 70° del frente a cada lado, se le ve llegar a −9,6.
- En móvil retrato sale del cuadro casi al instante, salvo por el frente.

Conclusión: la caída se cuenta en sus primeros 5 u y en el instante en que el bicho desaparece. Nada que se ponga a y≈−60 bajo el borde se ve desde ningún azimut: queda fuera de cuadro o pegado al borde inferior. Por eso el destello va en el punto donde desaparece.

**Ficción:** el cielo se lo traga. Sin destino ni salpicadura.

**Lo que hace ARENA:**
- **F0:** el cuello (y −7…−16, r 5-19) rodea la punta. En los arcos donde se ve desaparecer, el bicho desaparece dentro de una nube en sombra.
- **F4, destello:** `dust-puff.ts` se generaliza a `spawnVanishPuff(pos, tinte)`, en el punto exacto de la desaparición y con el tinte de nube del pack.
  - **No basta con una línea en `src/game.ts:2100`** (antes de `c.respawnAt`). Eso solo cubre el respawn offline. Se quedan fuera la última vida (`eliminate()` se llama dentro de `Critter.updateFalling`, `src/critter.ts:1145`, y nunca vuelve por `game.ts:2098-2101`), la rama `'ended'` y el online, donde el respawn lo decide el servidor.
  - **Cómo sí:** se detecta el flanco «cayendo → no cayendo o invisible» de cada bicho en el tick de visuales, igual que hace `pollGameplayEvents` en `src/tools/dev-api.ts`. Cubre offline, online y última vida sin tocar `critter.ts`. El sitio del enganche (`game.ts`, tierra de nadie) se decide en F4, con diff mínimo y dicho en el commit.
- **F4, fragmentos:** encogen a la mitad entre y −15 y −25, dentro de `tickFallingFragments` (`src/arena.ts:1446`), antes de `FRAGMENT_KILL_Y` (`src/arena.ts:1439`).

**Nota para el buzón de PERSONAJES** (`docs/carriles/personajes.md` §Buzón, para pegar tal cual):

> **De ARENA, 2026-09-21: fondo v2 (docs/DIORAMAS.md, «Fondo v2»).** La isla pasa a flotar en el cielo, y caer es «que te trague el abismo». Hay tres cosas en vuestro terreno; ninguna es urgente.
>
> 1. **Caída.** En `updateFalling` (critter.ts:1137-1149): que la escala baje de 1 a 0,2 en los últimos 0,3 s y, si os gusta, que la caída acelere en vez de ir a 12 u/s constantes.
>    - **Sin tocar la opacidad.** `fadeAlpha` fuerza `transparent` y `depthWrite=false` (critter.ts:806-812), y ese es el camino de ordenación del bug de Sergei (critter.ts:704-716).
>    - Los valores nuevos, en `FEEL.lives` (gamefeel.ts:108-114). `respawnDelay` sigue en 0,8 s.
>    - Comprobad `npm run golden` 3/3.
> 2. **Eliminación.** El mismo encogido antes del `visible=false` de `eliminate()` (critter.ts:1182).
> 3. **Rebote de luz.** El suelo del hemisferio pasa de `0x4a3a26` a un color por bioma, y eso aclara la parte de abajo de los 9 bichos.
>    - Mirad `.tmp/shots-cielo/_roster_ab.png`.
>    - Si no os convence, decídnoslo: ARENA tiene un plan B que no os toca (emisivo solo en el canto).

---

### 8. Legibilidad

**El pasillo del canto.**
- **Qué es.** Como la cámara de juego es fija, el generador conoce la silueta del disco vista desde ella: 256 direcciones del labio r=12 vistas desde (0,23,25). Los rayos que rozan el labio bajan a 31,9° por detrás, 39,7° por los lados y 60,5° por delante (verificado).
- **Cómo se construye.** El pasillo es esa silueta **entera**, incluido todo lo que el disco tapa, ensanchada un margen δ de 2,5° (≈45 px a 720p):
  - 1,0° de margen visual;
  - 1,5° por el temblor de cámara, en el peor caso. No son los 0,45 u base: Trunk Slam lleva `shakeBoost` 1,4, así que `triggerCameraShake(0,45·1,4)` da **0,63 u** (`src/gamefeel.ts:125`, `src/abilities.ts:724`, `src/abilities-runtime.ts:254` y `:318`), y x e y tiemblan por separado (`src/gamefeel.ts:402-403`). Sobre el labio frontal, a 26,4 u, son 1,4-1,5°. (`DIORAMAS.md:43` arrastra el mismo 0,45.)
- **Qué se rechaza.** Toda instancia **clara** (nubes, islotes, firmas, vida) cuya esfera envolvente toque el pasillo.
- **Qué se permite.** Las instancias **oscuras** (cuello, fondo del pozo) pueden quedar dentro, pero solo si su color máximo no supera el techo del abismo del pack. `getBackdropStats().corridorViolations` tiene que dar 0.
- **La cúpula** pinta el techo del abismo entre −29,4° (el labio trasero, −31,9°, más δ) y −63,0° (el labio frontal, −60,5°, menos δ). Lleva filas de latitud justo en esas dos elevaciones.

**Aguanta el colapso por construcción.**
- El colapso solo quita disco: la silueta encoge, y lo que queda al descubierto estaba dentro del pasillo, donde solo hay cúpula o nubes oscuras.
- No hace falta una tabla por azimut que se actualice en `startFragmentFall` (`src/arena.ts:1419`).
- Vale igual en 16:9, 21:9 y retrato, porque el pasillo depende de la cámara, no del formato.
- Aun así se mide a t=0, 29 y 50 s.

**Contrato de luminancia y saturación:**
- ΔL del canto: mediana ≥45 y mínimo local ≥15 (§2).
- La arena es lo más claro de media: L del fondo < L de la arena − 20.
- Saturación del fondo entre 0,4 y 0,9 veces la de la arena. Es el gate que funciona en los dos sentidos, de §2.
- Como mucho, el 8 % del fondo por encima del percentil 75 de la arena (decisión 1).

**Nada que se lea como suelo pisable:**
- Bajo la isla no hay nada continuo: está el pozo.
- Las nubes están al menos 48 u por debajo del disco y tienen huecos (cobertura ≤70 %).
- Los islotes tienen la cima a y ≤ −28, quedan a ≥33 u en horizontal del labio y miden ≤6 u de radio.
- Nada del fondo sube por encima de y=−5 dentro de r<25.

**Los bichos, siempre por encima:** el fondo no lleva emisivo, la deriva es ≤0,35 u/s y la vida nunca se dibuja sobre el disco (el pasillo la rechaza).

**Pozo claro (decisión 2).** Si un bioma va con pozo claro, el contrato de arriba se invierte solo para ese pack: |ΔL| ≥ 45 con el fondo **por encima**, y la regla «L del fondo < L de la arena − 20» deja de aplicarse. Esa regla la puso el plan anterior, no Rafa, y choca de frente con «quiero cielo» en un pack de arena oscura. Lo que no cambia es que los bichos sean lo más saturado de la pantalla.

---

### 9. Doble superficie y determinismo

**Las hojas de valores:**
- **`BACKDROP_LOOK`** (`src/arena-look.ts`) guarda lo global y lo estructural:
  - `mode: 'sky' | 'sea'`;
  - cúpula, pisos de nubes, cuello e islotes;
  - `corridorDeg`;
  - bruma: `hazeStartR` 120, `hazeEndR` 280;
  - `cloudBelly` 0,8, `driftDegPerSec` y `mobileDensity`.
- **`PackDef.sky`** (`src/arena-decorations.ts`) guarda lo de cada bioma:
  - las paradas de la cúpula por elevación;
  - los tintes de cima y panza de las nubes y la cobertura;
  - `hemiGround` con su intensidad;
  - desde F3, `light`; desde F1, la receta de la firma.

**En vivo.** Métodos nuevos al final de `src/tools/dev-api.ts`, con diff mínimo:
- `getBackdropLook()`.
- `setBackdropLook(patch)` y `setPackSky(id, patch)`. Devuelven `{applied, rebuilt, rejected}`. Hoy `setArenaLook` no avisa de las claves que no conoce (`src/tools/dev-api.ts:639`). Devuelve `applied`, así que quien compare lo ve, pero un agente que no compare cree que la aplicó.
- `getBackdropStats()`: draws, tris e instancias por capa, rechazos y violaciones del pasillo, `buildMs`, `hash` y `maxExtent`. Este último es el radio más lejano que alcanza cualquier geometría del fondo, y tiene que quedar dentro de la cúpula con margen: r 420 − 16,5 u, que es lo que se desplaza la cámara de victoria. C3 llega hasta 340 + 45 y las torres hasta 360 más su bulto: están a ~20 u del límite, y si algo pasa de ahí la cúpula lo recorta.
- `setCameraPose(nombre | pose | null)`.

**Desde la CLI:**
- Desde el slice: `arena-shots.mjs --pose … --scatter 0 --metrics`.
- En F4:
  - **`scripts/arena-sky.mjs --json`, sin navegador.** Corre con `node --experimental-strip-types`, como `golden:layout:write` (`package.json:34`). Importa el módulo de colocación y la rampa de la cúpula, que son TS puro, y devuelve instancias, rechazos, tris, draws, color por elevación, el ΔL previsto contra la banda exterior y el hash.
  - **Esto condiciona el slice desde el primer día.** Node no resuelve imports relativos sin extensión, y el tsconfig no tiene `allowImportingTsExtensions`. `arena-backdrop.ts` importa `./arena-look` y `./arena-fragments`. Así que la colocación va en un módulo **hoja**, que solo importa `three` e `import type`, y recibe `BACKDROP_LOOK` y la sky del pack por parámetro.
  - **El applier `look-patch`** en `tool-patch-core.mjs`, que es tierra de nadie.
  - **La entrada en `DEV_TOOLS.md`**, §«Superficie programática» (línea 95).

**Determinismo:**
- Cada capa usa `mulberry32(seed ^ SALT_BACKDROP ^ hash(capa))`. `SALT_BACKDROP` va junto a `SALT_VISUAL` (`src/arena-look.ts:107`) y sigue el mismo patrón que `visualRand` (`src/arena.ts:77-86`). Nunca se usa el generador de layout.
- La deriva va con el reloj de la partida, a través de `Arena.tickVisuals` (`src/arena.ts:1009`), no con `performance.now()`. A t=0 el ángulo es 0, la pausa la congela y las capturas se pueden reproducir.
- Nada colisiona ni entra en `isOnArena`.
- `npm run golden` da 3/3 y `golden:layout` pasa, los dos sin regenerar.
- En F4 se añade `tests/sim/arena-backdrop.test.ts`: dos construcciones con la semilla 1 tienen que dar `instanceMatrix` e `instanceColor` idénticos byte a byte. El mismo test comprueba `maxExtent`.
- **`mobileDensity` cambia el número de instancias, y con él el hash.** La aceptación «mismo hash con la misma semilla» se mide siempre con la misma clase de dispositivo, y el test fija la de escritorio. Dos jugadores en una sala pueden ver fondos distintos si uno va en móvil; es cosmético, y se anota.

---

### 10. Qué se retira y qué se reutiliza

**Se retira.** En F0 queda detrás de `mode: 'sea'` para el A/B; se borra en F4.

- **La foto:**
  - la carga en `applyPack` (`src/arena.ts:678-685`) y la limpieza en `clearPack` (`:853`);
  - `setSceneSkyboxTexture` (`src/scene-atmosphere.ts:104-115`);
  - `skyboxTexturePath` y `loadPackSkyboxTexture` (`src/arena-decorations.ts:333-334` y `:407-409`), junto con la rama `skybox` de `loadTexture` (`:374-386`).

  Al quitarla se cierra la fuga del `textureCache` (`:348`): unos 32 MB de VRAM por pack jugado, 160 MB después de jugar los cinco.
- **Los ficheros:** `public/images/skyboxes/*.webp`, que son 270.120 B del dist, y `_raw/`, con 7,1 MB en disco. `_raw/` ya queda fuera del dist gracias a `clean-dist-raw.mjs`.
- **Dos consumidores sin carril asignado en SESIONES.md.** Hace falta pedir permiso para tocarlos:
  - el segundo cargador de la foto, en `src/decoreditor/main.ts:418`;
  - la línea 30 de `scripts/compress-images.mjs`.
- **El mar:**
  - `buildSeaGeometry` y `paintSeaColors` (`src/arena-backdrop.ts:47-77` y `:108-159`);
  - las claves del mar en `BACKDROP_LOOK` (`src/arena-look.ts:133-200`);
  - `PackDef.backdrop` y `getPackBackdrop` (`src/arena-decorations.ts:101`, `:135-188` y `:451`).
- **Comentarios que ya mienten:**
  - `src/arena-backdrop.ts:27` dice 1.344 tris; son 6.912.
  - `src/camera.ts:14-23` dice que el cielo es la foto.
  - `src/camera.ts:52-56` justifica el `far` con el mar. El `far` se queda en 500, porque la cúpula tiene r 420 y va pegada a la cámara.

**Se reutiliza:**
- **Color:**
  - `sampleRamp` (`src/arena-backdrop.ts:80-93`) para las paradas de la cúpula y los tintes;
  - el `fogColor` de cada pack, que pasa a ser la banda de bruma del horizonte (la `FogExp2` no cambia);
  - la parada t=0 de cada `SeaRamp`, como semilla del abismo;
  - `CliffRamp` y el color de suelo, para los islotes.
- **Geometría:** el patrón `InstancedMesh` + `instanceColor` de `arena-scatter.ts` y `blob-shadows.ts`, y las primitivas del scatter para las firmas.
- **Luz y efectos:** `keyDirX/Z` desde F3; `dust-puff.ts` para el destello.
- **Herramientas:** `arena-shots.mjs`, con `--viewport`, `--at-seconds`, `--packs` y el navegador mudo.

---

### 11. Fases

| Fase | Qué | Días | Bytes (dist) | Draws | Tris |
|---|---|---|---|---|---|
| F0 | El slice (§12) | 1 | 0 | +2 | +25,2k |
| F1 | Jirones (C1) y las firmas de los cinco biomas: corona, colgante y elemento único | 1 | 0 | +2 | +4,8k |
| F2 | Torres del horizonte, fondo del pozo, deriva (malla gemela que gira) y vida. Plan B de `clouds.png` si la decisión 3 lo pide. | 1 | 0 (+11,6 KB con plan B) | +2 (+3) | +9,4k |
| F3 | Luz por bioma: key, rim, halo del sol y rampa de la punta | 0,5 | 0 | 0 | 0 |
| F4 | Caída (destello, fragmentos y nota enviada a PERSONAJES), `arena-sky.mjs`, `look-patch`, test de determinismo, métricas de jerarquía, y borrar el mar, las fotos y los cargadores | 1 | −270.120 | 0 | 0 |
| **Total** | | **4,5** | **−270.120 B** (−0,26 MB con plan B) | **+6 (+7)** | **≈+39,4k** |

**Cuánto pesa el total:**
- **Triángulos:** los ≈39k extra son un 3,6 % sobre 1,10 M (§2, línea 97).
- **Coste de GPU:** con la pendiente medida (40.000 conos de 12 tris = +0,9 ms, línea 234), unos +0,07 ms. Con los 6 draws, ≈+0,1 ms sobre los 1,29-1,55 ms de escritorio.
- **VRAM:** −32 MB por pack.
- **Móvil:** sin medir. `mobileDensity` 0,5 (media densidad cuando `isLikelyMobile()`, `src/input.ts:157`) queda preparada, pero no se activa sin una cifra.

---

### 12. Primer slice (1 día)

**Rama:** `claude/feature/arena-fondo-v2-cielo`, sacada de `dev` (`docs/SESIONES.md`, protocolo, paso 3).

**Alcance exacto:**
1. **`src/arena-backdrop.ts`.** Un modo `sky` que convive con el `sea` actual. Contiene:
   - cúpula, C2 con el cuello, C3 plana e islotes genéricos;
   - el pasillo del canto: rechazo de las instancias claras y comprobación de las oscuras;
   - bruma por radio y `stats()` con hash.

   La construcción pasa a `build(sky, fogColor, seed)`.
2. **`src/arena-look.ts`.** Las claves nuevas de `BACKDROP_LOOK` (§9) y `SALT_BACKDROP`.
3. **`src/arena-decorations.ts`.** `PackDef.sky` en los cinco packs, más `getPackSky()`. Los colores de primera pasada salen de `fogColor` y de la parada t=0 del mar.
4. **`src/arena.ts`.** `applyPack` (`:652-656`) construye con la semilla. En modo `sky` no carga la foto (`:678-685`) y pone el color de limpiado al del abismo: así, un frame sin fondo nunca sale claro. **Orden:** `setSceneFogColor` reescribe el color de limpiado con el `fogColor` (`src/scene-atmosphere.ts:129`) en cada `applyPack` (`src/arena.ts:663`) y en `clearPack`, así que `setSceneClearColor` va **después**, o se pisa.
5. **`src/scene-atmosphere.ts`:**
   - `hemi` como referencia de módulo, con `setSceneHemiGround(color, intensidad)`;
   - `setSceneClearColor`;
   - una pose forzada para las capturas, `setCameraPoseOverride(pose | null)`. Se aplica en `scene.onBeforeRender`, que three llama antes de calcular el frustum (`WebGLRenderer.js:1650` frente a `:1658`), y **termina con `camera.updateMatrixWorld()`**. Sin eso no se aplica en ese frame: `scene.updateMatrixWorld` (`:1635`) y `camera.updateMatrixWorld` (`:1639`) ya corrieron, y la cámara es hija de la escena (`src/main.ts:161`). Además, `main.ts` reescribe la `position` en cada frame (`updateCameraShake`, `src/gamefeel.ts:395`), así que el override pone posición **y** orientación. Así `main.ts` no se toca.
6. **`src/tools/dev-api.ts`.** Los seis métodos del §9, al final del fichero.
7. **`scripts/arena-shots.mjs`:**
   - `--pose game|victory|wide|defeat|low`. Las tres del medio replican las fórmulas de `src/game.ts:1793`, `:1813` y `:1837` con el bicho en el centro. `low` es la cámara de juego girada 0,52 rad en X: posición (0; 7,54; 33,12) mirando a (0; −2,60; −1,49), con −16,3° de inclinación. Es exactamente el encuadre de `.tmp/shots-cono*/*__bajo.png`, que se hizo girando la escena −0,52 rad, y ahora se puede reproducir.
   - `--scatter 0`.
   - `--metrics`: el ΔL del canto en 64 azimuts, proyectando el labio con la cámara conocida. Toma una muestra 6 px dentro y otra 6 px fuera, y lo guarda en un JSON junto a los PNG. **El labio sale del contorno vivo**: los fragmentos que siguen en pie, vía `getArenaInfo()`, y no un r=12 fijo. Si no, a t=29/50 las muestras de «dentro» caen en fondo, en los azimuts de los sectores caídos. Se descartan los azimuts que quedan fuera de cuadro (en 390×844 los labios laterales salen del cuadro) y los tapados por props o bichos.

**Fuera del slice:** C1, firmas, torres, fondo del pozo, deriva, vida, la key por bioma, la caída, la CLI sin navegador, el applier, el test de vitest y el borrado de ficheros. `src/game.ts` y `src/main.ts` no se tocan.

**Criterio visual para Rafa.** Se mira sobre la hoja `.tmp/shots-cielo/_hoja.png`, que junta:
- los 5 packs en seis poses: juego 16:9 a t=0, juego 390×844, victoria, plano general, derrota y baja;
- jungle y kitsune en juego a t=29 y t=50;
- la misma hoja en modo `sea`, para comparar.

Aparte van dos hojas más:
- `_roster_ab.png`: tres partidas de cuatro bichos cubren a los nueve, en `sky` y en `sea`.
- `_pozo_ab.png`: jungle y kitsune con pozo oscuro y con pozo claro (decisión 2), en juego y en victoria. Se hace en vivo con `setPackSky`, sin código extra.

> **«La isla flota en el aire: debajo hay un pozo de cielo y nubes que se alejan, alrededor hay otras islas, el borde se sigue con el dedo y en la pantalla final no hay foto ni raya de horizonte.»**

Desglosado en lo que tiene que verse:
1. En juego, tapando el disco con la mano quedan nubes con huecos, no una moqueta ni un suelo.
2. El borde del disco se sigue con el dedo en toda la vuelta, también a t=50 con medio disco caído.
3. En la victoria hay cielo arriba, bruma en el horizonte y nubes que se alejan, sin línea y sin foto.
4. Con la cámara baja, la panza se lee como roca iluminada desde abajo, encima de un cuello de nubes en sombra, y no como una mancha negra.
5. En los cinco packs hay algo a media distancia (los islotes), no solo un degradado. En 16:9 se ven al menos 3 islotes; en 390×844, al menos 2.

**Lo que este slice NO demuestra, y cuándo se demuestra.** Así nadie da por resuelta una queja que no lo está:
- **Queja 1 («qué hay abajo»):** el slice solo entrega el color del abismo y los islotes genéricos. Lo que hace reconocible cada bioma (lianas, carámbanos, cascadas, toriis) llega en **F1**. Su criterio es: tapando el disco con la mano, Rafa dice el bioma sin ver el suelo.
- **Queja 2 («falta mundo»):** en juego, la media distancia descansa en los islotes (slice) y en C1 y las firmas (F1). Las torres (F2) solo se ven en la victoria.
- **Queja 3 («cielo»):** en la pose de juego nunca se ve cielo; todos los rayos bajan, de −22° a −66°. El «aire» se lee por el mar de nubes visto desde arriba, los islotes más abajo y el color del pozo. Por eso el slice lleva el A/B de pozo oscuro y claro (decisión 2, riesgo 6).

**Cifras de aceptación:**

| Qué | Umbral | Cómo se mide |
|---|---|---|
| Foto | 0 % | `scene.background === null` en modo `sky` |
| ΔL del canto | Mediana ≥45 y mínimo local ≥15, en 5 packs × 3 viewports (1280×720, 1920×1080, 390×844) × t 0/29/50 | `--metrics` |
| Pasillo | 0 instancias claras dentro, 0 oscuras por encima del techo | `getBackdropStats().corridorViolations` |
| Coste | +2 draws y +25,2k tris netos (±10 %) | `getBackdropStats()` y `getPerf()` (`src/tools/dev-api.ts:603`) |
| GPU | **Sin medir en el slice.** `getPerf().frameMs` es `dt·1000`, el intervalo de rAF atado al vsync (`src/tools/dev-api.ts:592`), no tiempo de GPU. Los 1,29-1,55 ms del §2 salieron de una timer query (`.tmp/measure/gputime.mjs`) que no está en el repo. Estimación: ≈+0,1 ms. Medirlo exige recuperar ese script. | — |
| Construcción | ≤5 ms por pack (*fast restart*) | `buildMs` |
| Bytes | 0 en el dist | `npm run check` |
| Determinismo | Mismo hash con la misma semilla, hash distinto con otra | `getBackdropStats().hash` |
| Gameplay | `golden` 3/3 y `golden:layout`, sin regenerar | npm |

**Cómo se deshace:**
- En vivo: `__devApi.setBackdropLook({ mode: 'sea' })`. Vuelven el mar, la foto y el hemisferio de siempre.
- En el código: `BACKDROP_LOOK.mode = 'sea'`.
- O no se mergea la rama.

Los `.webp` siguen en disco hasta F4. Fuera del carril solo hay que deshacer los seis métodos añadidos al final de `src/tools/dev-api.ts`.

---

### 13. Riesgos

| # | Riesgo | Se ve en la captura si… | Arreglo |
|---|---|---|---|
| 1 | Moqueta de algodón: el mar de nubes se lee como nieve pisable, sobre todo en tundra y en la victoria. | Tapando el disco queda una superficie continua; hay bultos iguales hasta el horizonte; o en tundra la franja de nubes tiene ΔL < 20 contra el disco. | Cobertura ≤70 %, bultos que crecen con la distancia, tres pisos (C1 en F1), deriva (F2) y huecos que enseñen al menos un 30 % de abismo. |
| 2 | Vacío otra vez: un tercio del cuadro es abismo oscuro. | Más del 50 % del fondo con lapVar < 15 (el fondo actual está entre 9 y 29, §1). | Islotes ya en el slice; firmas y C1 en F1; fondo del pozo y vida en F2. |
| 3 | Segundo horizonte, o nubes facetadas en la victoria. | Una fila con un salto de ΔL > 8 en al menos el 50 % del ancho, entre −3° y −25°; o tramos rectos de más de 12 px en el contorno de una nube a 1080p. | C3 plana al 100 % del horizonte antes de r 280; panza de C2 suave (`cloudBelly`); torres de 20 lados; plan B de `clouds.png` (decisión 3). |
| 4 | El rebote de luz cambia el aspecto de los bichos. | En `_roster_ab.png`, las barrigas cambian de tono. | Ajustar la intensidad por pack. Si PERSONAJES o Rafa lo rechazan, emisivo solo en el canto (`src/arena.ts:281`). |
| 5 | Móvil sin medir. | — | Instanciado y pocas draws; `mobileDensity` 0,5 lista. Medir con un teléfono antes de subir las cifras. |
| 6 | **El pozo se lee como agujero o como noche, no como cielo.** Es el riesgo de la queja 3. En la pose de juego la mayor parte del fondo es el color del pozo, y en jungle ese color es casi negro (L ≤25). | Tapando el disco con la mano, el fondo parece un hueco negro con nubes alrededor, no aire. Se mira en `_pozo_ab.png`. | Subir el abismo hasta su techo en los packs holgados (tundra, coral, desert). En jungle, y en kitsune si hace falta, pozo claro (decisión 2). |
| 7 | **Un islote se lee como plataforma a la que saltar.** | Un islote con la tapa del color de la arena, iluminado por la key, cerca del borde del cuadro. | Tapa `isletTop` más oscura y desaturada que la arena, cima a y ≤ −28, a ≥33 u en horizontal del labio y bruma hacia el abismo. Si aun así engaña, más profundidad antes que más distancia. |

---

### 14. Decisiones para Rafa

> **Rafa aprobó el plan el 2026-09-21, con el fondo v2 antes que el slice 2 de dioramas.** La decisión 1 queda en **sí, con las tres condiciones**. La 3 queda en **`clouds.png` solo si hace falta, en F2, y nunca en juego**. La 2 se decide sobre `_pozo_ab.png` del slice.

1. **¿Pueden las nubes de la franja alta ser más claras que la arena?**
   - Por qué importa: en juego, el «cielo» son nubes vistas desde arriba con el sol encima, y lo que se lee como nube es una nube clara.
   - Si todo el fondo tiene que quedar 20 puntos de L por debajo de la arena (§2), en jungle (arena L 77,6) las nubes no pueden pasar de L 58, y entonces parecen rocas o moqueta.
   - **Recomendación: sí**, con tres condiciones:
     - fuera del pasillo del canto, así que el ΔL ≥45 no se toca;
     - la media del fondo sigue 20 puntos por debajo de la arena;
     - como mucho, el 8 % del fondo por encima del percentil 75 de la arena.
2. **¿Pozo oscuro o pozo claro?**
   - *(Sustituye a la decisión que planteaba la síntesis, «jungle: ¿abismo casi negro, L ≤18,6?». Esa venía de aplicar `bandTint` en sRGB. Bien hecha la cuenta, el techo de jungle es 25,3 y la parada actual ya cumple.)*
   - Por qué importa: el contraste del canto se puede conseguir con el fondo más oscuro que la arena o más claro. Con el pozo oscuro, en jungle queda casi negro (L ≤25) y se puede leer como un agujero en vez de como cielo (riesgo 6). Con el pozo claro, jungle tiene una bruma verde-blanca de L ≥115 detrás de un canto oscuro, y la arena se recorta a contraluz. Eso rompe la regla «la arena es lo más claro de la pantalla», pero esa regla la puso el plan anterior, no tú.
   - **Recomendación: decidirlo mirando `_pozo_ab.png`**, que el slice ya incluye: jungle y kitsune con las dos versiones, en juego y en victoria. Por defecto, pozo oscuro en los cinco, subido hasta su techo, que en tundra, coral y desert es holgado. Si jungle se lee como agujero, jungle pasa a claro.
3. **¿Se usa `clouds.png`?**
   - **En el slice, no.** Hay tres motivos:
     - sobre un plano ya falló (`9047031`);
     - son nubes de perfil, que no pintan nada en una cámara de juego que siempre mira hacia abajo;
     - en RGBA, el 59 % de los texels tiene alfa 0 con RGB negro, lo que deja halos grises con el mipmap, y hay un damero de transparencia horneado en la cola de una nube (x ≈1060-1215, y ≈530-600, comprobado).
   - **Su sitio** es la banda del horizonte de las poses bajas: billboards cilíndricos con `alphaTest`, usando solo el canal alfa (WebP 512² q85 = 11,6 KB) y teñidos por vértice.
   - **Recomendación: autorizarlo con condición.** Entra en F2 solo si en la hoja de victoria del slice las nubes planas se ven facetadas o recortadas. En la pose de juego, nunca.

---

# Parte 2 — Lo que hay ENCIMA del disco

<!-- Esta es la segunda mitad de docs/DIORAMAS.md: la sección del fondo (arriba)
     se cerró y se mergeó el 2026-09-06 (a6a4d99, claude/feature/arena-backdrop).
     Lo que sigue es la decisión sobre lo que hay ENCIMA del disco, sobre la
     petición literal de Rafa del 2026-09-07: "hay que mejorar muy mucho o
     directamente rehacer la generación de los dioramas… interesa que se vea
     como algo denso, como un ambiente real". Cuatro análisis independientes
     (assets, runtime, arte, escenografía), cuatro propuestas y dos juicios.
     Aquí está la decisión, no el debate. -->

---

## 1. Por qué hoy parece "un círculo con 4 cosas sueltas"

No es una impresión: es geometría de datos. **El decor vive en un collar pegado al canto y el 75 % del disco está vacío.**

**Distribución radial** (parseado por mí de `src/arena-decor-layouts.ts`; disco R=12 → 452,4 u²):

| pack | props | r<6 | 6–8,5 | 8,5–10 | ≥10 | r mín |
|---|---|---|---|---|---|---|
| jungle | 16 | **0** | 1 | 0 | 15 | 7,8 |
| frozen_tundra | 13 | **0** | 1 | 0 | 12 | 7,5 |
| desert_dunes | 11 | **0** | 0 | 0 | 11 | **10,4** |
| coral_beach | 18 | **0** | 1 | 0 | 17 | 7,0 |
| kitsune_shrine | 14* | **0** | 1 | 1 | 12 | 7,8 |

*(\*73 registros en total; uno de kitsune tiene otro orden de campos y mi parser no lo coge. La conclusión no cambia.)*

- **Cero props por debajo de r=6 en los cinco packs.** Esa circunferencia encierra el **25 % de la superficie** (113 u²).
- El **44 %** del disco (r<8,5, 227 u²) contiene **4 props entre los cinco biomas**.
- Densidad actual: 2,4–4,0 props/100 u² → **un objeto cada 28–41 u²**, es decir un círculo vacío de 3 u de radio por objeto. El critter mide 1,7 u.

**Y se ve exactamente así.** En `.tmp/esc/t0/kitsune_shrine.png` (captura a t=0, disco entero, la que sirve de línea base honesta) el patio es un embaldosado plano con un collar de bambús, linternas y toriis en el borde: el ojo cuenta 5 siluetas y clasifica el resto como suelo. En `.tmp/shots-despues/desert_dunes.png` hay literalmente **dos cactus, una palmera y una roca** sobre 452 u².

Las otras cinco causas, todas verificadas en el código de hoy:

2. **No hay clase de prop rasante.** Altura real = `displayHeight × scale × PACK_DECOR_SCALE` (`src/arena-decorations.ts:443`). El prop más bajo del catálogo entero es `shell_beach` con 0,76 u. No existe hierba, ni hojarasca, ni guijarro: **nada que pueda ir en el centro sin tapar**.
3. **Nada tiene sombra de contacto.** `grep castShadow src/*.ts` da **tres líneas**: `src/critter.ts:371` y `:385` (mallas procedurales que se ocultan al acoplar el GLB) y `src/scene-atmosphere.ts:77` (la key light). Ningún prop proyecta ni recibe sombra → todo se lee como pegatina. Y `ARENA_LOOK` ya tiene `critterShadowScale: 1.15` y `critterShadowOpacity: 0.34` (`src/arena-look.ts:61-62`) **sin un solo consumidor** desde la fase 1a.
4. **Repetición sin variación.** El bucle de colocación (`src/arena-decorations.ts:484`) aplica solo `rotation.y` y una escala uniforme; los datos van de 0,85 a 1,10 (±12 %). Jungle repite **el mismo `stone_ruin_block` diez veces** y kitsune la misma linterna seis.
5. **El diorama se borra a mitad de partida.** `node --experimental-strip-types scripts/arena-layout.mjs --seed 1 --timeline`, ejecutado hoy: lote 1 (banda 3) cae a **28,0 s**, lote 2 a **54,1 s**. Con el 95 % de los props en la banda 3, **a los 54 segundos el diorama ya no existe** y quedan ~60 s de partida sobre un plato liso.
6. **La brújula de los comentarios está girada 180°.** `angle 1.55` (+Z) es la parte **baja** de la pantalla, la más cercana a la cámara; los comentarios de `DECOR_LAYOUTS` lo llaman "N 12h". Por eso el torii grande de kitsune y la aguja de 4,2 u de desert están plantados justo delante de la acción.

**Y un aviso sobre la línea base:** `scripts/arena-shots.mjs:73` espera a `window.__devApi.snapshot?.()?.matchTime`, y **`DevApi` no tiene ningún método público `snapshot()`** (la superficie es `getArenaInfo`/`getPerf`/`getPlayerSnapshot`…; `buildSnapshot` es privado del grabador). El `?? 0` hace que la condición no se cumpla nunca, el `waitForFunction` agota sus 60 s con `setFixedStep(20)` corriendo y el `.catch(() => {})` se lo traga. Resultado: las cinco capturas de `.tmp/shots-despues/` marcan **1:08 y VIVOS: 3** — están tomadas a ~52 s, con media banda exterior ya caída y el donut blanco del Shockwave encima. **Todo el mundo, Rafa incluido, ha estado juzgando el diorama sobre imágenes en las que falta la mitad.** Arreglar eso es la fase 0 y no es negociable.

---

## 2. Lo que manda (presupuesto, rendimiento, determinismo, gameplay)

**Payload — 5,3 MB, prestados.** `node scripts/check-payload-budget.mjs`, ejecutado hoy: `dist total: 69.7 MB (budget 75 MB)`. El top-3 son critters (`sebastian` 15,2 + `kermit` 14,2 + `kurama` 13,8 = **43,2 MB, el 62 %**); los props de arena son 14,09 MB en 32 GLB. Un GLB de árbol cuesta 1,2–1,4 MB → **caben tres o cuatro modelos nuevos en todo el proyecto**. El objetivo declarado de H2 es ≤50 MB, así que ese margen no es nuestro. **Corolario duro: la densidad tiene que costar 0 bytes o no existe.**

**Triángulos — el techo con el catálogo actual.** Medido por la tanda (dos agentes coincidiendo al triángulo): jungle renderiza **900.815 tris de decor con 16 objetos**, kitsune 774.122 con 15, coral 339.396, desert 78.218, tundra 68.792. Una roca a la altura de la rodilla (`stone_ruin_block`) son 26.369 tris; la palma alta, 112.809. En comparación, **el suelo entero son 3.700–4.500 tris**: en jungle el decor es el 99,5 % de la geometría de la arena.

**Rendimiento — el decor NO es el problema hoy, pero el vehículo importa.** Medido en escritorio (RTX 4090, 1280×720, GPU timer query): frame completo **1,29–1,55 ms** sobre 16,6 ms; los critters se comen 1,12–1,28 ms (75–85 %) y el decor entero 0,03–0,20 ms. El frame está limitado por **geometría, no por fill** (×9 píxeles = +14 % de tiempo). Las dos pendientes medidas que deciden la arquitectura:

| vía | coste medido |
|---|---|
| props sueltos de alto poly | ~5,5 µs de GPU **y +1 draw call por prop** (368 props = +2,0 ms, 488 draws) |
| instancias de geometría barata | **40.000 conos de 12 tris = +0,9 ms y 0 draw calls extra** |

Y `grep -rn "InstancedMesh\|BatchedMesh\|mergeGeometries" src/` → **cero resultados**. Hoy cada prop es un `Mesh` con material clonado: 1 draw call cada uno. El suelo ya gasta 59–61 (`new THREE.Mesh(geo, [topMat, cliffMat])` en `src/arena.ts:234` son **dos** draws por sector × 29 fragmentos + 3 mallas del centro). **Móvil: sin medir.** No hay teléfono en la sesión y los dos proxies intentados se descartaron (SwiftShader da 550 ms de frame; el throttling de CDP solo modela CPU). Lo único defendible con datos propios es la forma del coste, y por eso el plan es instanciado.

**Determinismo.** El servidor manda **solo `seed` + `packId`**. `mulberry32` está definido en tres sitios y **ninguno lo exporta**: `src/arena-fragments.ts:15` (gameplay), su espejo `server/src/sim/arena-fragments.ts:14` y `src/arena-decorations.ts:195` (visual). La capa nueva deriva de `mulberry32(seed ^ SAL_PROPIA ^ hash(capa))` reusando el visual, **nunca** el de fragments: `scripts/check-sim-parity.mjs` compara **byte a byte** ese par dentro de `npm run check`, y el layout está blindado por `npm run golden` y `npm run golden:layout`. El precedente exacto ya existe: `SALT_VISUAL` en `src/arena-look.ts`. No hay handshake de versión cliente↔servidor: cliente y servidor se despliegan a la vez o dos jugadores ven dioramas distintos (cosmético, pero se anota en la release).

**Gameplay — la cámara, recalculada por mí (no la fórmula que circula).** Pose fija `(0,23,25) → (0,-3,0)`, fov 40 (`src/camera.ts`). Escala en pantalla: **1 u de alto ≈ 20,2 px**; el critter (1,7 u) mide 34 px. La fórmula "un prop de altura H tapa H×0,962 u" que usaban los cuatro análisis **es falsa como constante**; trazando el rayo cámara→cima→suelo:

| altura | r=0 | r=5 | r=8 | r=11 | fórmula |
|---|---|---|---|---|---|
| 0,25 u | 0,27 | 0,22 | 0,19 | 0,15 | 0,24 |
| 0,55 u | 0,61 | 0,49 | 0,42 | 0,34 | 0,53 |
| 1,20 u | 1,38 | 1,10 | 0,94 | 0,77 | 1,15 |
| 4,20 u (en r=11) | — | — | — | **3,13** | 4,04 |

La fórmula **subestima en el centro y sobreestima un 26–56 % hacia fuera**. Y el arco peligroso depende de la altura, al revés de lo que se dijo: para un prop en r=11, el punto ocultado sale del disco a partir de **63°** desde +Z si H=4,2, pero a **~110°** si H=1,2 (los props altos lanzan su oclusión más lejos y la tiran fuera). Lo que manda no es "dentro o fuera" sino **cuánto suelo roba**. De ahí salen los techos del §3.

Tres restricciones más, no negociables: **los props no colisionan** (nada de esto entra en `isOnArena` ni en la física); **todo lo que se ponga debe caer con su fragmento** (`findFragmentAt` en `src/arena.ts:584` + `host.attach` en `:601`, con rotX/rotZ propios por índice en `:1221`); y **el formato de `DECOR_LAYOUTS` no se toca** porque está anclado al applier `decor-editor` (`scripts/tool-patch-core.mjs:77` target, `:215` validador, `:1089` mutador) y a sus tests dentro de `npm run check`.

---

## 3. Plan elegido

**Ganadora: la capa procedural instanciada** — de las cuatro propuestas, las dos que la defienden (motor medido + reglas de ecología) empataron a un punto en los dos juicios, y son gemelas arquitectónicas. Se funden. Se le injerta entera la escenografía (masa del canto y suelo pintado) como fase previa, y la autoría de héroes como fase final.

**El razonamiento en una línea:** con props sueltos reutilizados se llega a ~×3 objetos y se gasta el presupuesto entero de triángulos y +33 draw calls; con geometría generada en código e instanciada, **860–1.700 elementos cuestan ~9.000–16.000 triángulos (el 1–1,8 % de lo que jungle ya gasta en 16 objetos), 6–8 draw calls y 0 bytes**. El ambiente denso solo puede venir de ahí; los props existentes son el acompañamiento.

### Arquitectura, en tres decisiones

1. **Fichero nuevo, no campo nuevo.** `src/arena-scatter-recipes.ts` (hoja plana de números, hermana de `ARENA_LOOK`/`BACKDROP_LOOK`) + `src/arena-scatter-geometry.ts` (fábrica de primitivas puras: mata en cruz 12 tris, guijarro icosaédrico 20, domo 36, decal 2, colgante 6) + `src/arena-scatter.ts` (motor). `DecorPlacement` y `DECOR_LAYOUTS` conservan su forma **exacta**: `decor-editor`, `/decor-editor.html` y sus tests siguen verdes sin tocarse.
2. **Los `InstancedMesh` cuelgan de `arena.group`, jamás de un fragmento.** Un `InstancedMesh` tiene un padre y hay 29 fragmentos que caen con rotaciones individuales. Las instancias se **ordenan por fragmento anfitrión** (calculado con el `findFragmentAt` que ya existe) de modo que cada fragmento posee un rango contiguo; mientras un lote cae se recomponen solo esas matrices (`M_fragmento × offset_local`) y se sube el rango con `instanceMatrix.addUpdateRange()` (existe en three 0.185.1, verificado). Coste medido por la tanda: **10–24 µs/frame**, durante ~1,6 s, 4 veces por partida. Ruido. *Aviso obligatorio en el código:* `buildFromSeed` (`src/arena.ts:421`) y `reset` (`:1120`) hacen `traverse` + `geometry.dispose()` sobre **todo** descendiente de un fragmento, e `InstancedMesh` es subclase de `Mesh`; el día que alguien reparente una instancia a un fragmento "para que caiga mejor", la geometría compartida se destruye y la partida siguiente renderiza vacío.
3. **Un stream por capa.** `mulberry32(seed ^ SALT_SCATTER ^ hash(layerId))`. La sub-sal por capa es lo que permite tocar el `count` de una especie sin reorganizar el diorama entero a cada slider.

### Fases

| # | Nombre | Alcance | Ficheros | Días | Payload | Render |
|---|---|---|---|---|---|---|
| **0** | **Ojo limpio** *(bloqueante, va primero)* | Arreglar la espera de `arena-shots.mjs` (usar `getArenaInfo()`, borrar el `.catch` mudo, `--at-seconds 0,55,95`, VFX apagados). Deduplicar la carga: `Promise.all` sobre **tipos únicos** antes del bucle (hoy `await loadModel` está dentro del `for`, `src/arena-decorations.ts:497` → 16 esperas para 4 GLB, 20–22 s hasta que jungle se puebla) y mover el guard de token dentro del bucle. `scripts/validate-arena-packs.mjs` **naciendo fallando** con el techo de 250k tri/pack. Borrar el anillo exterior inerte (`PACKS[*].props` es `[]` en los cinco desde 2026-04-25; `collapsePropBatch`, `src/arena.ts:744`, hace early-return siempre) **rescatando `computePropBatchIndex`**. | `scripts/arena-shots.mjs`, `scripts/validate-arena-packs.mjs`, `src/arena-decorations.ts`, `src/arena.ts` | 0,5 | 0 | 0 |
| **1** | **La isla tiene masa** | `arenaHeight` 1,2 → 2,4–2,6 (relación 20:1 hoy sobre un disco de 24 u; el canto son ~25 px de un color plano y ahora recorta contra el mar de la fase de fondo). `ExtrudeGeometry({steps:3})` → sector de 132 a 268 tris, con 4 filas de vértices para una **rampa de estratos por bioma en vertex color** que sustituye al `cliffTint: 0.62` global. **Ojo:** `arenaHeight` vive en `src/arena-fragments.ts:103` **y en su espejo del servidor** (`server/src/sim/arena-fragments.ts:102`), byte-comparados por `check-sim-parity` — la edición va en los dos o se mueve a `ARENA_LOOK`. | `src/arena-fragments.ts` (+espejo), `src/arena.ts:219-234`, `src/arena-look.ts` | 0,5 | 0 | +3.944 tris, **+0 draws** |
| **2** | **El suelo es un sitio** *(primer slice, abajo)* | Motor completo + **una** capa (`hierba_alta`) en **un** pack (jungle). | `src/arena-scatter*.ts`, 3 enganches en `src/arena.ts`, dev-api | 1 | 0 | +1 draw, ~6.500 tris |
| **3** | **La alfombra** | Capas `decal` (2 tris) y `pebble` (20), **inclinación ±8-16° y tinte por instancia** (`instanceColor`) — lo que más rompe la sensación de clonado —, ruido de racimo para claros y espesuras, y `SCATTER_DENSITY` como válvula global. | `src/arena-scatter*.ts` | 1 | 0 | +2 draws, ~4.000 tris |
| **4** | **Borde y canto** | Capa `fringe` anclada al **arco exterior de cada fragmento** (no a r=12 fijo): cada colapso descubre un borde **ya vestido** en vez del corte pelado de hoy. Capa `cliff`: cinturón que **cuelga por debajo de y=0** (lianas, raíces, carámbanos, repisa de coral) — la única forma de "algo fuera del disco" que no puede violar el veto del 2026-04-25 ("*read as the playable terrain extends past where you can actually walk*", escrito en `src/arena-decorations.ts:97`). Y **blob shadows instanciadas** para props y critters en 1 draw call, consumiendo por fin `critterShadowScale/Opacity`. | `src/arena-scatter.ts`, `src/arena.ts` | 1 | 0 | +3 draws, ~5.000 tris |
| **5** | **Los cinco biomas** | Recetas de los otros 4 packs + capa `mid` (acento, 20–30 instancias) + **reglas de asociación** (`near`: helechos al pie de la palma, nieve a sotavento, musgo en las juntas) y **eje de viento único** por bioma. | `src/arena-scatter-recipes.ts` | 1,5 | 0 | ~igual ×5 |
| **6** | **Doble superficie** | `__devApi.getScatterRecipe/setScatterRecipe` (calcados de `getArenaLook`/`setArenaLook`, `src/tools/dev-api.ts:613-645`, devolviendo también `rejected`), applier ToolPatch `scatter-patch` + su test, CLI headless `scripts/arena-scatter.mjs --json` (instancias, tris, draws, ocupación de celdas, supervivencia a 54 s, hash) y panel en `/tools.html`. Más el **test de determinismo**: construir con seed 1 dos veces y comparar `instanceMatrix` byte a byte, más 25 hashes golden (5 packs × 5 semillas). | `src/tools/dev-api.ts`, `scripts/tool-patch-core.mjs`, `scripts/tests/`, `tests/sim/` | 1 | 0 | 0 |
| **7** | **Recomponer los héroes** | Con el applier `decor-editor` **que ya existe**: sacar los altos del arco cercano, escalonar r 4–11,5, convertir los 10 sillares idénticos de jungle en un muro caído + una escalinata, corregir la brújula de los comentarios. | `src/arena-decor-layouts.ts` (por patch) | 1 | 0 | **negativo** (−250k tris en jungle) |

**Total ≈ 7,5 días · payload 0 MB · +6-8 draw calls · +15-20k triángulos por pack.** La dieta de polígonos de los 32 props (−4,45 MB y −65 % de tris medidos, iterando 3 pases del optimizador ya existente) **va en rama aparte**: no es prerrequisito de nada de esto, es prerrequisito de encender `castShadow` en héroes y de recuperar margen de payload, y su riesgo (siluetas degradadas) necesita el ojo de Rafa sobre un A/B prop a prop.

### El primer slice: 1 día, jungle, una sola capa

**Qué se escribe:** `makeTuft()` (3 quads cruzados, 12 tris, vertex color base oscura → punta clara, ~40 líneas); `SCATTER_RECIPES.jungle` con **una** entrada y los otros cuatro packs a `[]`; `buildScatter()` (rejilla jitterada + ruido de racimo + `pointInFragment` + orden por fragmento + `InstancedMesh`), `tickScatterFall()` y `disposeScatter()` (~180 líneas); tres enganches en `src/arena.ts` (construir tras `generateArenaLayout` en `buildFromSeed`, tickear dentro de `tickFallingFragments` en `:1248`, liberar en `:421` y `:1120`); y los getters de dev-api reusando `rebuildArenaVisuals()`.

**Criterio de éxito VISUAL** — Rafa pone `.tmp/shots-scatter/jungle.png` al lado de `.tmp/esc/t0/jungle.png` y tiene que poder decir:

> **"Eso ya no es una alfombra verde: es suelo de selva."**

Desglosado en lo que se ve, no en lo que se mide:
1. La hierba llega **desde r=2 hasta el labio**, y por primera vez el 25 % central tiene algo encima.
2. Se ven **claros y espesuras**, no moqueta uniforme (si sale moqueta, el `clusterGain` está mal y se ve en la propia captura).
3. Las palmeras que ya existían **dejan de flotar**, porque tienen maleza a los pies y un anillo limpio de 0,38 u alrededor del tronco.
4. La captura a `--at-seconds 40` demuestra lo arriesgado el **día 1, no el día 5**: la hierba del sector caído **se fue con él**; no flota sobre el vacío ni desaparece en el sitio.

**Y los números que lo acompañan:** `getPerf()` con **+1 draw call y ~+6.500 triángulos**; `npm run golden`, `golden:layout` y `test:sim` a **diff cero**; `npm run check` verde con `dist total: 69.7 MB` sin mover un decimal.

**Si a ojo no convence** (riesgo nº1, y es estético, no técnico: hierba de geometría pura a 11 px de alto puede leerse como pinchos de plástico), el fallback está identificado y acotado a **medio día**: `alphaMap` de canvas 128² sobre el quad cruzado — 1 textura procedural, 0 bytes de payload, ~0,09 MB de VRAM. Y si sobra, se borra una línea.

### Las reglas duras que se convierten en assert

> **Decidido por Rafa el 2026-09-21: manda el contrato del código.** La
> tabla de techos que proponía este plan (0,25 u en el islote, 0,55 u en
> la zona de combate y en el arco cercano ±55°, 1,15 u en el lejano, nada
> cruzando r=12) queda **retirada**. Se eligió mirando `.tmp/shots-cierre/`:
> el fleco que asoma por fuera del labio es justo lo que enseñan las
> referencias de `resources/Terrenos/`, y la tabla del plan lo prohibía.
> Lo de abajo es lo que el código hace cumplir hoy.

**Techos de altura** — `SCATTER_LIMITS` en `src/arena-scatter-types.ts`. Los aplica el motor (`src/arena-scatter.ts`, recorta la escala de la instancia que se pase y avisa por consola) y los comprueba `tests/sim/arena-scatter.test.ts`, que recalcula la altura real de cada instancia desde su matriz:

- **r < 8,5** (islote y zona de combate): **0,4 u**. Es más estricto que la tabla retirada: roba menos de la mitad del diámetro del critter en todo el interior.
- **r ≥ 8,5, arco frontal** (z ≥ 0: ±90° de +Z, la mitad que da a la cámara): **1,2 u**.
- **r ≥ 8,5, arco trasero**: **2,6 u**. Ahí la silueta se recorta contra el fondo y no tapa acción.
- **El fleco puede asomar por fuera del labio**: los centros quedan siempre dentro de `layout.maxRadius`, pero la geometría de las capas de borde sobresale hasta ~0,6 u (`src/arena-scatter-recipes.ts`, cabecera). Nada de eso colisiona ni entra en `isOnArena`.
- Estos techos solo gobiernan el **scatter**. Los props GLB autorados (`DECOR_LAYOUTS`) no pasan por aquí: el torii grande de kitsune y la aguja de desert siguen plantados en el arco frontal, y eso se arregla en la recomposición de héroes (fase 7), no con un techo.

**Sigue siendo objetivo, sin validador escrito** (`scripts/validate-arena-packs.mjs` no existe):

- **Presupuestos:** ≤25.000 tris de scatter por pack, ≤2.200 instancias, ≤10 `InstancedMesh`, y **≤250.000 tris de decor total por pack** — que hoy falla con jungle (900.815) y kitsune (774.122). *Que falle es la señal, no el problema.*
- **Cero emisivo y saturación tope por debajo de la de los critters:** el naranja del aviso de colapso es **información**, y los bichos tienen que ser lo único saturado en pantalla.

---

## 4. La receta de cada bioma

Mismo motor, mismas capas, distinta **estructura** — que es lo que separa "cinco discos con otra paleta" de cinco sitios. Cada bioma tiene una postal y **un** elemento que solo tiene él.

**🌴 jungle — "la cima de un templo tragado por la selva".**
Capas: `decal` hojarasca ×378 · `tuft` hierba ×538 · `frond` helecho ×149 · `pebble` guijarro con musgo ×138 · `dome` arbusto ×31 · `fringe` ×273 · `cliff` liana ×175 → **~1.680 elementos, ~15.800 tris, 7 draws.** Héroes recompuestos: **3 palmas** (de 5) solo en el arco lejano a escalas 0,8/1,0/1,3, y los diez sillares idénticos convertidos en **un muro caído de 4 bloques a distintas alturas e inclinaciones + una escalinata hundida de 3**. Asociación: helechos a 0,8–2,2 u de la base de cada palma; musgo en las juntas de los sillares.
**Lo único:** la vegetación **desborda el borde** — helechos que asoman por el labio y lianas colgando sobre el mar de copas. Eso es lo que hace que el disco sea un trozo de selva y no una alfombra.

**⛩️ kitsune_shrine — "el patio de un santuario en la niebla, con pétalos cayendo".**
El bioma con el suelo más fuerte y los assets más baratos (los toriis son 5–9k tris). Aquí la densidad se construye con **ritual**, no con vegetación: grava rastrillada en círculos concéntricos en el centro inmune (decals planos, altura 0 — respeta que el centro respire), musgo instanciado en las juntas de las losas, **200 pétalos caídos agrupados a sotavento de la sakura**, y una **senda de 4-5 toriis pequeños en escala decreciente** marcando un eje (postal instantánea, ~30k tris). El torii grande **se mueve** del arco cercano (`angle 1.55`, donde hoy tapa 75 px de acción) al lejano.
**Lo único:** el bermellón sobre piedra gris y niebla, y los pétalos. Mejor relación impacto/trabajo de los cinco.

**❄️ frozen_tundra — "una placa de hielo a la deriva".**
El pack más barato del catálogo (68.792 tris totales): aquí **sobra presupuesto para triplicar props reales** además del scatter. `pine_snow` cuesta 3.724 tris, así que un pinar de verdad (8–10 pinos solapando troncos, 36k tris = el 29 % de **una** palmera de jungle) es gratis comparado con lo que ya se gasta. Scatter: **200 montículos de nieve acumulados CONTRA la base de cada prop y contra el labio** (domos achatados de 0,15–0,4 u), 150 decals de placas de hielo agrietado, 60 cristales de 8 tris en racimos. Cliff: carámbanos. Témpanos existentes a escalas 0,7–1,5 e **inclinaciones distintas** — un témpano torcido lee "hielo a la deriva"; uno recto lee "cubo".
**Lo único:** el acantilado es **hielo azul translúcido bajo una tapa de nieve blanca**. El corte vertical cuenta el bioma y además da lectura de gameplay: lo que se rompe es hielo.

**🐠 coral_beach — "un banco de arena en marea baja".**
La protagonista no son los props: es la **línea de marea**. Anillo de arena mojada en r 9,5–12 con contorno **festoneado** (jamás un arco perfecto), 250 conchas y guijarros **acumulados en esa línea, no repartidos** — la marea *ordena* los restos, y esa es la diferencia entre "playa" y "arena con cosas encima". Más 3–4 charcas de marea como decals con algas dentro, 120 decals de ondulación, y un festón de espuma en el labio. Los dos corales existentes se juntan en **un jardín denso con siluetas solapadas** en vez de repartidos de uno en uno.
**Lo único:** el borde es **agua**. Es el único bioma donde el vacío tiene explicación diegética y hay que explotarlo.

**🌵 desert_dunes — "una meseta partida en un cañón".**
El más vacío hoy (11 props, ninguno dentro de r=10,4) y el que más gana. Todo se alinea en **un solo eje de viento**: ondulaciones de arena **en relieve** (cuñas de 0,05–0,15 u, todas paralelas — el ground texture ya tiene ondas pintadas, esto les da volumen y dirección), arena arrastrada acumulada a sotavento de cada prop, costra de sal, 10–14 rodadoras (icosaedros huecos de 20 tris). El minecart y la bandera son buen storytelling y **se mueven a r 7–9** para que sobrevivan más de 40 s; la aguja de 4,2 u sale del arco cercano.
**Lo único:** **el viento**. Un eje, la bandera ondeando, la arena corriendo y un cordel de postes medio enterrados cruzando el disco.

**Densidad por banda que produce esto** (jungle, seed 1, simulado contra el generador real): r 0–2,5 → 79 elementos (hoy 0) · r 2,5–5,5 → 263 (hoy 0) · r 5,5–8,5 → 495 (hoy 1) · r 8,5–11,2 → 493 (hoy 15) · fleco → 352. Un elemento cada ~0,28 u², frente a uno cada 28 u² hoy. **Y el 55 % vive en r<8,5**, así que a los 54 segundos —cuando hoy no queda nada— sigue habiendo diorama. Métrica bloqueante: **≥45 % de elementos vivos a t=50 s**.

---

## 5. Lo que descartamos y por qué

**Añadir GLB nuevos.** 5,3 MB de margen prestado, 1,2–1,4 MB por árbol, y **117–149 MB de VRAM de texturas ya gastados por pack** (cada prop trae 4 mapas). Caben tres modelos en todo el proyecto. Muerto antes de empezar.

**Densificar poniendo más placements en `/decor-editor.html`.** Cada uno es +1 draw call y entre 5k y 131k triángulos. 600 props sueltos = +600 draw calls; la pendiente medida es +2,0 ms con 368. Es exactamente lo que parece la solución obvia y es la trampa.

**Hornear el scatter por fragmento con `mergeGeometries` en vez de instanciar.** Es la única alternativa que caía "gratis" (la malla es hija del fragmento, cero código de colapso nuevo), y por eso hubo que medirla: fusionar 750 elementos en 29 mallas cuesta **40,9 ms en caliente y 86,6 ms en frío de hilo principal bloqueado**, contra **1,23 ms** de los 750 `setMatrixAt` equivalentes — **33× más caro**, pagado en cada `buildFromSeed` (arranque, reset, cada rebuild del tuner) contra la restricción *fast restart* de CLAUDE.md, y +29 draw calls. Descartada por medición, no por gusto.

**Meter el scatter dentro de `DECOR_LAYOUTS`, o añadir campos a `DecorPlacement`.** Rompería a la vez el applier `decor-editor`, el editor web y sus tests, que corren en `npm run check`. Fichero nuevo con applier hermano: cero regresión.

**Un estudio de autoría nuevo que absorba `/decor-editor.html`.** Cinco días de herramienta que no se ven en pantalla, sobre un tool que funciona y tiene sus tests verdes. Choca con "protect working code" y "smallest working solution first". La autoría se hace por CLI con el applier que ya existe (fase 7).

**Props altos en el arco cercano y volumen en el centro.** Un prop de 4,2 u en +Z roba 3,13 u de suelo (95 px) contra los 34 px del critter; el centro es el escenario del endgame. Se convierten en assert, no en costumbre.

**Colisión en props, y cualquier cosa que toque `arena-fragments.ts`.** Movería el golden y es zona hard-stop.

**Reabrir el fondo.** Ya está hecho y mergeado (`a6a4d99`): mar a y=−32, r=300, `far` 200→500, 1 draw call. Cualquier plan que presupueste días de fondo cuenta dos veces. Y sigue descartado lo que su propia sección descartó: skybox 4K, regenerar panorámicas con IA, subir la niebla, el delantal a y=−4.

**Un multiplicador de densidad al pie de los props (`anchorBoost`).** Se midió y **no hace nada**: 1215 → 1214 instancias, porque a 1 elemento cada 0,27 u² la probabilidad ya está saturada. La influencia del ancla tiene que ser **cualitativa** (mezcla de especies + anillo limpio de 0,38 u), nunca cuantitativa. Quien lo implemente como número pierde el día.

---

## 6. Encaje en la ruta

Esta campaña es una **fase 1c interpolada dentro de H4.5**, entre lo ya cerrado y lo que queda de `docs/ARENA_V2.md`:

- **Hecho:** fase 0 (red de seguridad, CLI, golden de layout), fase 0.5 (el colapso se lee), fase 1a (el disco se convierte en un lugar), fondo (la isla flota sobre su bioma).
- **Esta campaña (≈7,5 d)** se coloca **antes** de las fases 2/3, porque son las que más ganan si el suelo ya está poblado, y **absorbe** trozos de otras: de la **fase 4** se lleva las blob shadows instanciadas, `validate-arena-packs.mjs`, la carga `Promise.all` deduplicada y el borrado del anillo exterior inerte; de la **fase 3** se lleva la mitad del "cada bioma es un sitio distinto", que pasa a resolverse con recetas de scatter en vez de con partículas y assets.
- **Fase 1b (dieta de polígonos)** deja de ser prerrequisito de la densidad y pasa a ser prerrequisito de **encender `castShadow` en héroes** y de recuperar payload (−4,45 MB medidos). **Rama aparte, en paralelo**, para no juzgar dos cambios a la vez.
- **Fase 2 (colapso con espectáculo)** hereda un regalo: con la capa `fringe` anclada al arco de cada fragmento, lo que cae es un trozo de suelo **poblado** y el borde que queda detrás aparece **ya vestido**. Refuerzo directo de la fase 0.5.
- **Fase 5 (todo en función del radio)** no cambia y gana un consumidor más: los `radial` de las recetas se expresan como fracción de `layout.maxRadius`, igual que `tileSize = R/3`.
- **Salida de H4.5:** `dev → main` con merge commit; `DEV_TOOLS.md §Superficie programática` con `scatter-patch`, `setScatterRecipe` y `arena-scatter.mjs`.
- **H5 (monetización)** no toca terreno: se monetiza el producto de H4.5, y por eso el look va antes.
- **Se lleva H6:** recetas por perfil de arena (el `'8p'` con r 16–17 reusa las mismas capas con los radios escalados por `maxRadius`, sin reautorar nada — esa es la ventaja de que la densidad sea reglas y no posiciones), decor por receta + semilla, hazards de bioma como zonas, y el handshake de versión para salas 8p que también cierra la única grieta de determinismo que esta capa deja abierta.

---

## 7. Decisiones que necesita Rafa

**1 — ¿Geometría generada en código, o mini-modelos?**
La densidad sale de primitivas de 2 a 36 triángulos hechas con código (0 bytes). El riesgo es estético y no lo puedo medir: hierba de geometría pura a 11 px de alto puede leerse como pinchos de plástico en vez de como naturaleza cartoon. La palanca que más lo arregla no es la forma, es la **inclinación ±8-16° y el tinte por instancia**.
**Recomendación: sí, procedural, y se decide mirando la captura del día 1.** Fallback identificado y acotado a medio día (`alphaMap` de canvas 128²: 1 textura procedural, 0 bytes). Si ni así, el plan B cuesta payload y assets nuevos, que es justo lo que no hay.

**2 — ¿Cuánta densidad?**
No es una decisión de ingeniería: 1.700 elementos cuestan el 1,8 % de los triángulos que jungle ya gasta hoy en 16 objetos. Es una decisión de ojo, y el riesgo real es el contrario del actual: que el suelo deje de leerse como suelo y ensucie la lectura de los critters.
**Recomendación: arrancar en ×0,35–0,5 y subir mirando cuatro capturas del mismo barrido.** `SCATTER_DENSITY` es **un solo número** que afina toda la capa sin tocar siete recetas ni recompilar, y llega en la fase 3.

**3 — ¿Recomponemos los 73 props autorados?**
Sacar los altos del arco que tapa, escalonarlos de r 4 a 11,5 y convertir los diez sillares idénticos de jungle en un muro caído y una escalinata **es un cambio de criterio artístico sobre composición que alguien autoró a mano** (los comentarios del fichero documentan clusters con nombre e intención). Cuesta 0 bytes, 0 código nuevo, se hace entero con el applier `decor-editor` que ya existe, y devuelve ~250k triángulos en jungle — 25 veces lo que cuesta toda la capa densa.
**Recomendación: sí, pero en la fase 7, DESPUÉS de que el scatter esté en pantalla**, con un A/B delante. Si se mueven los props a la vez que aparece la alfombra, se juzgan dos cambios en una sola imagen y no se sabe cuál funcionó.