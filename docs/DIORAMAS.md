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
>   horneada, niebla que tiñe, sombra de la isla). Siguen pendientes el
>   relieve, la cresta de siluetas y la **luz por bioma** — que en este
>   documento figura como "fase 0, va sola y primero" y aún no se ha
>   tocado.
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

> **Ojo (2026-09-07): esto es el plan, no lo que hace el código.** El
> slice 1 se implementó con techos más permisivos (`SCATTER_LIMITS` en
> `src/arena-scatter-types.ts`: interior 0,4 u · arco frontal 1,2 u ·
> trasero 2,6 u) y sin el validador de packs. Hay **una decisión abierta**
> —cuál de las dos tablas manda— anotada en `NEXT_STEPS.md`; hasta
> cerrarla, la referencia real es el contrato del código.

En `scripts/validate-arena-packs.mjs`, enganchado a `npm run check`, con los techos derivados de **mi** tabla de oclusión (§2), no de la fórmula errónea:

- **r < 2,5** (islote inmune, escenario de los últimos 24 s): solo decals y elementos ≤ **0,25 u** (roban 0,27 u, menos que el radio del critter). *El centro respira.*
- **r 2,5–8,5** (zona de combate, el 44 % del disco): techo **0,55 u** → roba 0,42–0,56 u, **menos de la mitad del diámetro del critter**.
- **r 8,5–11,2**: **1,15 u** en el arco lejano (donde la silueta recorta contra el mar y no tapa nada), **0,55 u** en el arco cercano ±55° de +Z.
- **r 11,2–12**: nada por encima de **0,6 u**, sin transparencia, sin animación y sin el color del fondo. El fleco **subraya** el borde; no lo disfraza. Nada cruza r=12.
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