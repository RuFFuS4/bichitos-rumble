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

### 3.1 Son grandes y van despacio — el tamaño está roto

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
misma `physicsRadius` 0,55 mida el bicho 1,45 o 2,69. **Es decisión tuya**
(§6-A): no lo toco sin ti porque cambia el aspecto que aprobaste.

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

## 6. Lo que necesito que decidas

- **A. Tamaños** (§3.1). (1) Que funcione el 1,7 para todos, como dice el
  código: la mayoría encoge un 30-55 %. (2) Quedarse con los tamaños de
  ahora y quitar solo el salto del «¡YA!». (3) Tamaños por bicho a
  propósito (Trunk grande, Cheeto pequeño…), escritos explícitos. Mi
  recomendación: **(1)**, y ver las capturas antes de afinar nada más,
  porque cambia cómo se lee todo lo demás.
- **B. Velocidad de suelo** (§3.1, §3.5). Es gameplay: toca balance,
  golden y el tamaño de arena. No la propongo ahora; solo dejo el dato de
  que casi todos avanzan menos de su altura por segundo.
- **C. Ritmo por bicho**: mira `.tmp/feeling/` y dime quién va demasiado
  rápido o lento. Es un número por bicho en `FEEL.runCadence`, tocable
  desde el sintonizador del match lab.
