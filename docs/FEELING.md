# El *feeling* de los personajes — diagnóstico medido y plan

> Petición de Rafa (2026-09-07): *"se sienten pesados en vez de animalillos
> graciosos andando, corriendo y demás"*. Carril PERSONAJES
> ([`docs/carriles/personajes.md`](carriles/personajes.md)). Diagnóstico
> relanzado de cero y **medido** el 2026-09-21; el primer corte ya está
> hecho (§4). Lo que queda pendiente de tu decisión está en §6.

**Regla del trabajo** (`CLAUDE.md §Separation of concerns`): todo el
arreglo vive en la capa visual. El golden de partidas es el juez: si se
mueve, me he pasado de capa. Tras el primer corte sigue en **3/3**.

---

## 1. Cómo se ha medido

Nada de esto es a ojo. Tres herramientas, todas reproducibles:

| Qué | Cómo |
|---|---|
| Velocidad real, inclinación, balanceo, ritmo de patas, giros, altura | [`scripts/critter-motion.mjs`](../scripts/critter-motion.mjs): navegador de pruebas mudo, **paso fijo de 1/60 s**, ruta de teclas contada en pasos: quieto → arranca → suelta → arranca al revés (180°) → giro de 90° → suelta. Así la física se comporta como a 60 Hz aunque el headless vaya a 10 fps. |
| Zancada de cada clip Run | [`scripts/inspect-stride.mjs`](../scripts/inspect-stride.mjs): carga el GLB en node con el mismo `GLTFLoader` + `AnimationMixer` del juego y mide a qué velocidad barre el clip el pie apoyado hacia atrás. Sin navegador. Cuadra con lo medido en partida (Trunk 2,67 frente a 2,61; Cheeto 2,30 frente a 2,23; Sihans 1,18 frente a 1,23). |
| Tamaño real en partida | Caja de los vértices *skinned* del GLB ya en juego. |
| Vídeos antes/después | `critter-motion.mjs --video`: fotograma a fotograma a 1/60 s, montado con ffmpeg. Los del corte 1 están en `.tmp/feeling/v2/`: **`feeling-corte1-antes-despues.mp4`** (los seis seguidos) y un `cmp-<bicho>.mp4` por bicho, antes y después lado a lado sobre el mismo suelo. |

## 2. Lo que ya estaba medido (y se confirma)

- Los 9 GLB traen 6-10 clips (Idle, Run, Fall, Victory, Defeat y
  habilidades). Material no falta.
- El clip de Run iba a velocidad fija (`meta.speed ?? 1`).

## 3. Las causas, de más a menos peso

### 3.1 Son grandes y van despacio — el tamaño estaba roto — ARREGLADO (Rafa: «1», 2026-09-21)

`IN_GAME_TARGET_HEIGHT = 1.7` promete que los nueve miden lo mismo. **No
es verdad en partida.** Al acoplar el GLB se aplica el ajuste de altura,
pero `tickProceduralAnimation` reescribe cada frame
`glbMesh.scale = rosterEntry.scale` y lo borra. Durante la cuenta atrás
(cuando la capa procedural aún no corre) sí miden 1,7; **en el «¡YA!» cada
bicho cambia de tamaño de golpe**:

| | Sergei | Trunk | Kurama | Shelly | Kermit | Sihans | Kowalski | Cheeto | Sebastian |
|---|---|---|---|---|---|---|---|---|---|
| Altura en cuenta atrás | 1,67 | 1,75 | 2,08 | 1,75 | 1,80 | 1,61 | 1,78 | 1,67 | 1,83 |
| **Altura en partida** | **2,59** | **2,60** | **2,60** | **2,34** | **2,69** | **1,51** | **1,78** | **2,13** | **1,45** |
| Salto en el «¡YA!» | +55 % | +64 % | +41 % | +35 % | +49 % | −12 % | 0 % | +32 % | −21 % |

Y la velocidad real con el stick a fondo es **1,4-3,1 u/s** (no los 8-18
de `config.speed`, que es una aceleración). O sea: casi todos recorren
**menos de su propia altura por segundo** (Sergei 0,86 · Shelly 0,59 ·
Kermit 0,99). Un bicho grande que avanza despacio el ojo lo lee como
pesado — es el mismo truco que usa el cine para que una maqueta parezca
enorme. Con el ajuste de 1,7 funcionando, la mayoría serían un 30-55 %
más pequeños y, a la misma velocidad, se leerían bastante más ligeros.

Además, los comentarios de `roster.ts` no cuadran con ninguna de las dos
versiones («Cheeto, el más pequeño»; en partida Sebastian y Sihans son más
pequeños. «Kermit, mediano»; en partida es el más alto), y todos tienen la
misma `physicsRadius` 0,55 mida el bicho 1,45 o 2,69.

**Arreglo** (decisión de Rafa, opción 1: el 1,7 para todos):
`Critter.glbFitFactor` guarda el ajuste medido al acoplar el GLB y la capa
procedural multiplica por él en vez de pisarlo. De paso apareció un
segundo error: el ajuste medía la caja del *bind pose*, porque three.js
cachea la caja de las mallas *skinned* (`Box3.setFromObject`); por eso
Kurama «ajustado» a 1,7 medía 2,08 incluso en la cuenta atrás. Ahora se
mide la pose real, vértice a vértice (`measurePosedHeight`). Resultado en
partida: **1,66-1,71 los nueve**, sin salto en el «¡YA!». Golden 3/3.

Consecuencias que conviene saber:
- El `scale` del roster ya no decide el tamaño en partida (el ajuste lo
  anula). En `/calibrate` su deslizador queda de solo lectura, y «Re-fit»
  pasa a previsualizar otra altura objetivo sin exportar nada.
- Al encoger, la zancada de cada clip mide menos en el mundo y las patas
  van más deprisa con el pie apoyado. Ciclos de zancada por segundo, antes
  → después del tamaño: Sergei 2,3 → 3,5 · Trunk 0,8 → 1,3 · Kurama 2,3 →
  3,9 · Shelly 0,6 → 0,8 · Kermit 0,9 → 1,4 · Sihans 4,2 → 3,5 · Kowalski
  6 → 6 (techo) · Cheeto 1,3 → 1,7 · Sebastian 5,9 → 5,0.
- Los iconos de estado de la interfaz (`status-icons.ts`, carril
  INTERFAZ) se colocan a `bindPoseHeight + 0,4`, que ya era 1,7: ahora
  por fin coinciden con la cabeza.

### 3.2 La capa cartoon estaba apagada — ARREGLADO (corte 1)

La inclinación, el balanceo y el estiramiento se escalaban por
`velocidad / 15`. Con velocidades reales de 1,4-3,1 u/s eso daba una
intensidad del **9-21 %**: el diseño decía 12° de inclinación a tope y en
pantalla había **1,8-2,5°**; el balanceo, 0,1-0,7°. Invisible.

### 3.3 Patas a ritmo fijo: unos planeaban y otros iban en cinta — ARREGLADO (corte 1)

Proporción suelo ÷ barrido del pie (1 = pie apoyado; >1 el bicho patina
hacia delante, planea; <1 las patas van más rápido que el suelo):

| | Sergei | Trunk | Kurama | Shelly | Kermit | Sihans | Kowalski | Cheeto | Sebastian |
|---|---|---|---|---|---|---|---|---|---|
| Antes | 2,21 | 1,05 | 1,55 | 0,63 | 0,93 | 2,51 | 4,29 | 0,92 | 4,67 |
| Después | 1,35 | 1,11 | 1,05 | 0,68* | 0,80* | 0,99 | 1,21 | 0,71* | 1,17 |
| Ciclos de zancada/s, antes → después | 1,6 → 2,3 | 0,8 → 0,8 | 1,6 → 2,3 | 0,8 → 0,6 | 0,8 → 0,9 | 1,6 → 4,2 | 1,8 → 6 | 1,0 → 1,3 | 1,6 → 5,9 |

\* A propósito: patas algo más rápidas que el suelo (ver §3.5).

### 3.4 En 5 de los 9, el «balanceo lateral» era un cabeceo — ARREGLADO (corte 1)

El balanceo se escribe en `glbMesh.rotation.z`. Con el orden de Euler por
defecto (XYZ), esa rotación se aplica **antes** del giro que alinea el
modelo con el juego. En los rigs de Tripo, girados −90° (Trunk, Shelly,
Kermit, Kowalski, Cheeto), el eje z del modelo acaba siendo el lateral:
el bicho **cabeceaba adelante y atrás** en vez de bambolearse. Hoy no se
notaba porque la intensidad estaba al 15 %; al arreglar §3.2 se habría
visto. Verificado con three.js: con XYZ la punta de la cabeza se va a
z = −0,30 (hacia atrás); con XZY, a x = −0,30 (de lado) en los dos tipos
de rig.

### 3.5 Los clips largos de Tripo no dejan correr a un bicho ligero

Kermit, Cheeto, Trunk y Shelly traen un Run de **1,3 s** con zancada
larga. Con el pie bien apoyado a su velocidad real darían 0,5-0,9 ciclos de
zancada por segundo: perfecto para el elefante y la tortuga, fatal para la rana y
el guepardo. No hay velocidad de reproducción que dé a la vez pie apoyado
y ritmo de animalillo. Salidas: patas algo más rápidas que el suelo (es
lo que hace hoy `FEEL.runCadence`: Kermit 1,6, Cheeto 1,5, Shelly 1,3),
clips nuevos más cortos en `bichitos-mesh2motion`, o más velocidad de
suelo (§6-B).

### 3.6 Giros de robot — corte 2

`mesh.rotation.y = atan2(vx, vz)`: en una media vuelta el bicho gira
**180° en un solo frame** (medido: 5 pasos después de pulsar, cuando la
velocidad cruza cero, se da la vuelta entera de golpe; `critter-motion`
lo cuenta como `reverseFrames: 1`). En un giro de 90° sigue
a la velocidad en 333 ms, sin inclinarse hacia dentro. Ojo: `mesh.rotation.y`
es gameplay (el cabezazo sale en esa dirección), así que el suavizado
tiene que ir en el hijo visual, no ahí.

### 3.7 Arrancar y frenar no tienen acento — corte 2

El bicho alcanza el 90 % de su velocidad en 250 ms y frena en 117 ms, sin
nada que lo cuente: ni estirón al salir, ni aplastón o derrape al frenar.

### 3.8 Reacciones que se pintan en mallas invisibles — corte 2

La inclinación al recibir un golpe (`updateKnockbackTilt`), la
recuperación del cabezazo (`updateHeadbuttRecovery`) y el recogimiento de
la cabeza en la anticipación escriben en `critter.body` / `critter.head`:
las esferas procedurales, que **se ocultan al acoplar el GLB**. En los
nueve bichos reales no se ven.

### 3.9 La personalidad sale igual para 8 de 9 — corte 2

`deriveAnimationPersonality` recorta la velocidad a 6..13 (la escala de
los placeholders de la jam), pero el roster actual va de 8 a 18: ocho
bichos saturan a 13 y reciben la misma inclinación, el mismo ritmo de rebote
y el mismo estirón de carga. Solo la masa los distingue.

---

## 4. Corte 1 — hecho (2026-09-21, rama `claude/feature/personajes-feeling`)

Todo en la capa visual; golden 3/3 sin regenerar.

- **Las patas siguen al suelo**: `runPlaybackRate` (critter-animation.ts)
  fija cada frame el `timeScale` del Run a
  `velocidad real ÷ (zancada del clip × escala del GLB) × FEEL.runCadence[id]`,
  con suelo `FEEL.locomotion.runRateMin` y techo `runCadenceMaxHz`.
- **Zancada medida, no a ojo**: `src/critter-locomotion.ts` (`RUN_GAIT`),
  generado por `node scripts/inspect-stride.mjs --write`. Guarda la
  zancada en unidades de modelo, así que si arreglamos el tamaño (§3.1) la
  tabla sigue valiendo.
- **Intensidad de carrera sobre la velocidad real** (terminal de cada
  bicho, `FEEL.locomotion.topSpeedReach`): inclinación 1,8-2,5° → **12°**
  (Shelly 0,6° → 6,9°); balanceo 0,1-0,7° → **3,1-5,1°**.
- **El balanceo va al compás de las patas**: se engancha a la fase del
  clip de Run y se inclina sobre el pie que apoya (`leftPhase`, también
  medida). Verificado que en los 9 rigs el pie «izquierdo» está a la
  izquierda.
- **Orden de Euler XZY** en el GLB: el balanceo es de lado en los 9.
- **Doble superficie**: los mandos nuevos son secciones planas de `FEEL`
  (`locomotion`, `runCadence`), así que aparecen solos en el sintonizador
  «Game feel» del match lab y se escriben con `feel-patch`. La medida
  tiene su CLI (`inspect-stride.mjs`, con `--json`).
- En partida, el `run.speed` de `animation-overrides.ts` ya solo afecta al
  preview del anim-lab (anotado en el fichero).

## 5. Corte 2 — propuesto

Mismo principio (capa visual, golden quieto), en este orden:

1. **Giro con peso**: guiñada visual con retraso en el hijo (`glbMesh`),
   inclinación hacia dentro del giro y, en la media vuelta, un derrape.
2. **Acentos de arranque y frenada**: estirón y pose adelantada al
   acelerar, aplastón y pose hacia atrás al frenar (sale de la derivada de
   la velocidad, que ya tenemos).
3. **Reacciones visibles**: llevar el tilt del golpe, la recuperación del
   cabezazo y la anticipación al GLB.
4. **Personalidad con el rango del roster actual** (velocidad 8..18, masa
   0,6..1,4).

## 6. Decisiones

- **A. Tamaños** (§3.1) — **DECIDIDO el 2026-09-21: opción 1**, el 1,7
  para todos. Hecho (§3.1, «Arreglo»).
- **B. Velocidad de suelo** (§3.1, §3.5) — Rafa pide recomendación «para
  un resultado más profesional». Estudio en §7.
- **C. Ritmo por bicho** — Rafa, sobre el vídeo del corte 1: *"bastante
  mejor que antes"*. `FEEL.runCadence` se queda como está. Ojo: aquel
  vídeo es anterior al arreglo del tamaño, que aceleró las patas entre
  1,3 y 1,7 veces; conviene volver a mirarlo con el tamaño nuevo.

## 7. Velocidad de suelo — estudio (2026-09-21)

Rafa: *"¿qué velocidad del suelo me recomiendas para conseguir un
resultado más profesional?"*. Estudio con 9 agentes: referencias
externas, auditoría del código, **144 partidas solo-bots** (6
velocidades × 4 alineaciones × 6 semillas, `run-match-batch --feel`),
vídeos a ×1 / ×1,5 / ×2, síntesis y tres refutaciones (diseño, balance,
técnica). Ninguna tumbó la recomendación; las tres la afinaron. Datos
crudos y vídeos: `.tmp/velocidad/` del worktree de este carril (local).

### 7.1 Una corrección de medida

La posición avanza con la velocidad ANTES de la fricción
(`src/critter.ts:578-589`), y todo lo que medíamos leía `|v|` DESPUÉS.
A 60 Hz el suelo real avanza **×1,155** lo medido. Velocidad real hoy
(bichos de 1,7): Shelly 0,93 · Sergei/Kowalski 1,52 · Kermit/Cheeto/
Sebastian 1,81 · Trunk 1,87 · Kurama/Sihans 2,10 alturas/s (mediana
1,8). Los bots offline, al 0,55 de eso. El `runPlaybackRate` del corte 1
arrastra el mismo 15,5 % (pie a ~1,15 en vez de 1,00).

### 7.2 Referencias (alturas del personaje por segundo)

Brawl Stars ≈2,1 (1,8-2,85; conversión estimada) · Bomberman 2,8 ·
Minecraft andando 2,4 · plantillas Unity/UE5 2,8-3,0 · Splatoon 3,5.
Los plataformas (Mario 64 6,6, Celeste 8, Smash ≈10) no son objetivo.
Franja de brawler cenital: **2,0-3,2**, mediana objetivo ≈2,5. Todos
los referentes de calidad suavizan el giro (Mario 64 337°/s, UE5
500°/s, Unity 0,12 s); aquí salta en 1 fotograma.

### 7.3 Simulación

De ×1 a ×2 no se rompe nada: ninguna partida llega al tiempo límite,
enganche 25,7 % → 29,2 % a ×1,5, cabezazos/min +19 % (la mitad por
partidas más cortas). A ×2,5 los bots se tiran solos por el borde (39
caídas de borde sin rival frente a 17-25). **Pero** con 24 partidas por
celda y tras arreglar la zona muerta (§7.4), la simulación no distingue
×1,25 de ×2: la cifra la deciden las referencias, la animación y el
mando de Rafa, no los datos. (Caídas y eliminaciones por partida no
sirven de métrica: las fija la regla de fin de partida offline.)

### 7.4 Bug de producción: la zona muerta impide arrancar

`src/critter.ts:593` anula la velocidad si `|v| < 0,15` **aunque haya
input**. A más Hz, menos velocidad gana cada fotograma, y hay bichos que
no salen de parado. Medido con el bucle real (jugador, tecla W):

| | 60 Hz | 120 Hz | 144 Hz | 165 Hz | 240 Hz |
|---|---|---|---|---|---|
| Shelly | se mueve | NO arranca | NO arranca | NO arranca | NO arranca |
| Sergei | se mueve | se mueve | NO arranca | NO arranca | NO arranca |
| Trunk | se mueve | se mueve | se mueve | NO arranca | NO arranca |
| Kurama | se mueve | se mueve | se mueve | se mueve | NO arranca |

El bot Shelly ya no arranca a 60 Hz (0,55×). Subir la velocidad no lo
arregla (Shelly a ×1,5 sigue clavada desde 120 Hz). Arreglo: zona
muerta solo sin input. Cambia el golden (Shelly-bot y los wind-ups
«casi raíz» dejan de quedarse clavados).

### 7.5 Recomendación

- **`accelerationScale` 1,6 → 2,2 (×1,375)**: mediana 2,5 alturas/s,
  Kurama/Sihans 2,9 (bajo el techo de 3,2), Sergei 2,1. Alternativa
  **2,4 (×1,5)**. A ×1,5 cinco bichos rozan el techo de 6 ciclos/s de
  patas; a ×1,375 hay margen. Se decide jugando las dos.
- **No tocar** `frictionHalfLife`, `idleFrictionHalfLife` ni `maxSpeed`:
  marcan la distancia de todos los golpes y la arrancada (250 ms al 90
  %, ya buena). Solo cambia `accelerationScale`, en cliente y `SIM`.
- **Bots**: el 0,55 está escrito a mano (`src/bot.ts:147`) y online no
  existe (factor 1,0: un bot online corre 1,95× uno offline). Propuesta:
  `FEEL.bots.moveAccelFactor`, con el mismo valor (≈0,7) offline y
  online. Brecha humano/bot: offline 1,82× → 1,43×; online 1,0× → 1,43×.
- **Retoques acoplados**: `holeForce` del Sinkhole de Sihans ×f (el
  tirón es una aceleración: sin escalar, la trampa deja de atrapar);
  `collision.anchoredBounceFactor` ×f para que el caparazón anclado siga
  repeliendo (NO `normalPushForce`, que cambia todos los empujones);
  `headbutt.lunge.velocityBoost` ×√f dentro de la prueba, para no juzgar
  la velocidad con el cabezazo relativamente más flojo.
- **Visual** (golden intacto): giro suavizado ~80 ms en un pivote hijo
  (NUNCA en `mesh.rotation.y`: de ahí salen el cabezazo y las
  habilidades) que se endereza de golpe al empezar un golpe;
  `runTopSpeed` con el factor de bot (hoy el bot no pasa del 57 % de
  intensidad); `runPlaybackRate` con la velocidad real (+15,5 % de
  cadencia; revisar `FEEL.runCadence`, que era un parche para la poca
  velocidad).
- **Online**: el bicho local salta a la posición del servidor cada 50 ms
  sin suavizar (`src/game.ts:1303-1305`); con más velocidad, saltos
  mayores. Nota en el buzón de DISTRIBUCIÓN: condición de despliegue.
- **Controles que faltan**: nada vigila la paridad `FEEL` ↔ `SIM` de
  `movement`/`collision` (`check-sim-parity` solo cubre la arena); cada
  commit de física pasa también `npm run test:sim` y el `tsc` del
  servidor.

### 7.6 Plan (zona hard-stop: física — cada paso con aprobación de Rafa)

A. Zona muerta (cliente + espejo del servidor en el buzón de
DISTRIBUCIÓN), golden:write + golden 3/3, ERROR_LOG. Línea base limpia.
B. `0,55` → `FEEL.bots.moveAccelFactor`, bit-idéntico (golden sin
regenerar). C. Prueba de Rafa en el match lab (slider de FEEL): 2,2
frente a 2,4 con bots a 0,7, eligiendo Kurama, Sebastian, Kowalski y
Sihans en alguna partida. D. `accelerationScale` + retoques acoplados en
cliente y `server/src/sim/*` (espejos de este carril), golden:write.
E. Bots online (BrawlRoom.ts, DISTRIBUCIÓN). F. Capa visual. Despliegue
cliente + servidor a la vez, con el suavizado online hecho.
