# Character Design

## Gap entre kits temporales y habilidades definitivas (2026-04-17)

IMPORTANTE — lo que hay en el juego ahora **no** es todavía el set final de
habilidades diseñadas más abajo. Para cerrar el roster completo sin pararnos
en rediseño por personaje, todos los bichitos comparten 3 factories base:

- `charge_rush` — dash frontal con impulso + escala de masa/velocidad
- `ground_pound` — empuje radial con radio, fuerza y windup tunables
- `frenzy` — buff temporal de velocidad y masa (ultimate, opcional)

Cada personaje recibe un **kit temporal** reutilizando esas factories con
tuning distinto (impulse/radius/force/cooldown/multipliers) y un nombre
descriptivo. Solo Sergei coincide realmente con su diseño final.

El siguiente bloque de habilidades no debe hacerse a ciegas: esta tabla
marca exactamente qué sigue siendo placeholder.

### Tabla de estado real

| Personaje  | Rol temporal | Kit temporal actual (tipos `+ nombre`) | Hab 1 definitiva diseño | Hab 2 definitiva diseño | ULTI definitiva diseño | Gap real |
|------------|--------------|-----------------------------------------|-------------------------|--------------------------|--------------------------|----------|
| **Sergei** | Balanced     | CR `Gorilla Rush` + GP `Shockwave` + F `Frenzy` | Charge Rush (dash) | Shockwave (onda área, no stun) | Frenzy (buff velocidad + daño) | **Alineado**. Sergei es el único personaje donde el kit temporal coincide en tipo y sensación con el diseño. |
| **Trunk**  | Bruiser      | CR `Trunk Ram` + GP `Earthquake`        | Charge Rush (dash frontal) | **Trunk Grip** (agarra + lanza en dirección — targeted grab) | **Ground Pound** (pisotón con STUN de área) | H2 totalmente placeholder (grab/throw no existe). ULTI reusa GP pero sin stun — sólo knockback radial. Sin Frenzy. |
| **Kurama** | Trickster    | CR `Fox Dash` + GP `Mirror Burst` + F `Frenzy` | Charge Rush | **Mirror Trick** (deja copia 2s que absorbe daño) | **Copycat** (copia la ULTI del último enemigo golpeado) | H2 y ULTI totalmente placeholder. No hay sistema de ilusiones ni de copia de abilities; Frenzy se usa como relleno de ULTI. |
| **Shelly** | Tank         | CR `Shell Charge` + GP `Shell Slam` + F `Frenzy` | Charge Rush (caparazón rodando) | **Shell Shield** (invulnerable + inmóvil + refleja daño) | **Mega Shell** (roda gigante empujando todo) | H2 requiere sistema de invulnerabilidad + reflect. ULTI pide movimiento rodante continuo. Ambos placeholder. Frenzy rellena ULTI. |
| **Kermit** | Controller   | CR `Leap Forward` + GP `Poison Cloud`   | Charge Rush (salto con patas) | **Poison Cloud** (nube que oculta visión de los que están dentro) | **Hypnosapo** (invierte controles de enemigos tocados) | H2 comparte nombre pero el efecto real (zona bloqueadora de visión) no está — es solo knockback radial. ULTI totalmente placeholder (invertir inputs de otros). Sin Frenzy. |
| **Sihans** | Trapper      | CR `Burrow Rush` + GP `Tremor`          | Charge Rush (bajo tierra + emerge) | **Tunnel** (teleport con zonas lentas en entrada/salida) | **Diggy Diggy Hole** (crea hoyo permanente en el mapa) | H2 requiere teleport + efecto de terreno persistente. ULTI requiere modificar la mesh del arena en runtime. Ambos totalmente placeholder. Sin Frenzy. |
| **Kowalski** | Mage       | CR `Ice Slide` + GP `Arctic Burst`      | Charge Rush (deslizar panza) | **Snowball** (proyectil a distancia con slow 50%) | **Ice Age** (congela suelo área grande, enemigos resbalan) | Sin sistema de proyectiles (H2 es placeholder). Sin sistema de slipping surface (ULTI placeholder). Sin Frenzy. |
| **Cheeto** | Assassin     | CR `Pounce` + GP `Paw Stomp`            | Charge Rush (salto felino) | **Shadow Step** (teleport detrás del enemigo más cercano + golpe) | **Tiger Roar** (empuje cónico, no radial) | H2 requiere target-selection + teleport. ULTI pide cono direccional, ahora es radial. Ambos placeholder. Sin Frenzy. |
| **Sebastian** | Glass Cannon | CR `Claw Rush` + GP `Big Claw Slam`  | Charge Rush (desplazamiento lateral + pinza) | **Claw Sweep** (barrido en abanico frontal) | **Crab Slash** (carga lateral que mata o se cae del mapa) | H1 casi pero no es lateral. H2 pide cono direccional, ahora es radial. ULTI requiere detección "o mato o muero". Todo placeholder funcional. Sin Frenzy. |

### Cobertura skeletal (2026-04-21)

Estados esqueléticos target por bichito: 8 fijos — `idle`, `run`,
`ability_1`, `ability_2`, `ability_3` (ULTI), `victory`, `defeat`,
`fall`. El resto (`headbutt_*`, `hit`, `walk`, `respawn`) son
procedurales por política (ver `SUBMISSION_CHECKLIST.md`).

| Personaje  | Anim     | Fuente         | Notas                                          |
|------------|----------|----------------|------------------------------------------------|
| Cheeto     | **8 / 8**| Tripo Animate  | full kit (Pounce, ShadowStep, TigerRoar, …)    |
| Kermit     | **7 / 8**| Tripo Animate  | ab_3 Hypnosapo = flicker procedural (sin clip) |
| Kowalski   | **8 / 8**| Tripo Animate  | full kit (Ice Slide, Snowball, Ice Age)        |
| Trunk      | **8 / 8**| Tripo Animate  | full kit (Ram, Grip, Ground Pound). Nota: la animación de ab_2 incluye el giro+lanzamiento pero **no el estiramiento horizontal de la trompa** — cuando toquemos la ability, el estiramiento irá procedural (mesh stretch). |
| Shelly     | **6 / 8**| Tripo Animate  | idle / run / victory / defeat / fall + ab_3 Mega Shell. **Ab_1 Shell Charge** y **Ab_2 Shell Shield** van procedurales por diseño (spin rápido del mesh entero + hide head/hands/feet via bone scale, per `PROCEDURAL_PARTS.md`). |
| Sergei     | 1 / 8    | Mixamo (Idle)  | resto procedural                               |
| Kurama     | 0 / 8    | —              | pendiente Meshy / Tripo                        |
| Sebastian  | 0 / 8    | —              | pendiente Meshy / Tripo                        |
| Sihans     | 0 / 8    | —              | pendiente Meshy / Tripo                        |

Total: **38 / 72** estados (53%). La capa procedural de
`critter-animation.ts` cubre automáticamente lo que falta.

### Qué está realmente implementado hoy

- **3 factories base** (`charge_rush`, `ground_pound`, `frenzy`) con per-kit overrides cliente/servidor.
- **Stats distintivos** por personaje (speed/mass/headbuttForce + per-ability
  impulse/radius/force/multipliers/cooldown/windUp).
- **Sensación diferencial entre personajes** lograda por tuning, no por
  mecánicas únicas.

### Qué NO está implementado todavía

Sistemas mecánicos necesarios para las habilidades definitivas que aún no
existen en el motor:

- **Grab & throw** (Trunk H2): coger un enemigo específico y lanzarlo.
- **Ilusiones / decoys** (Kurama H2): spawnear copia que recibe daño.
- **Copia de ability ajena** (Kurama ULTI): instrospección del kit del otro.
- **Invulnerabilidad + damage reflect** (Shelly H2).
- **Movimiento continuo controlado** (Shelly ULTI — mega shell rodante).
- **Zonas de efecto persistente con visión bloqueada** (Kermit H2).
- **Input inversion** sobre otros jugadores (Kermit ULTI).
- **Teleport con marcador de terreno persistente** (Sihans H2).
- **Modificación del arena en runtime** para crear hoyos (Sihans ULTI).
- **Proyectiles con slow-on-hit** (Kowalski H2).
- **Superficies alteradas (hielo resbaladizo)** (Kowalski ULTI).
- **Teleport target-seleccionado** (Cheeto H2).
- **Conos direccionales** (Cheeto ULTI, Sebastian H2).
- **Detección de éxito/fallo direccional** (Sebastian ULTI).

Cada uno de estos es un bloque de trabajo no trivial. El plan actual es
NO abrirlos hasta después de animaciones procedurales + sonido/feedback +
balance real. Este documento debe consultarse antes de entrar a ese
bloque para no confundir "tengo algo con ese nombre" con "la mecánica
final está implementada".

### Qué hacer si la urgencia dicta avanzar antes

Priorización natural por complejidad (de menor a mayor coste de
ingeniería), útil si en algún momento queremos un "primer upgrade"
real por personaje sin abrir todo el frente:

1. **Sergei** — ya está.
2. **Trunk Ground Pound con stun** — añadir estado `stunned` + timer (pequeña extensión del sistema actual).
3. **Cono direccional** (Cheeto ULTI, Sebastian H2) — geometría + test
   angular, reusa el código de `ground_pound`.
4. **Proyectil simple** (Kowalski Snowball) — entidad cliente-servidor nueva.
5. **Teleport simple** (Cheeto H2, Sihans H2) — instantáneo, reusa respawn sin immunity.
6. **Invulnerabilidad + reflect** (Shelly Shell Shield) — flag + condición en physics.
7. **Ilusiones, copycat, input inversion, modificación de terreno, superficies resbaladizas** — sistemas nuevos grandes; dejar para el final o descartar para la jam.

---

## Plantilla para definir cada bichito
1. Nombre del bichito

Ejemplo: Elefante, Hormiga, Cerdo, Erizo, Cuervo...

2. Tipo de animal o criatura

Aquí solo dime qué es exactamente.

3. Fantasía principal

¿Qué debería sentir el jugador al usarlo?

Ejemplos:

“Quiero sentir que soy enorme e imparable”
“Quiero sentir que soy pequeño, rápido y muy molesto”
“Quiero sentir que aguanto bien y genero caos”
4. Rol base

Elige uno de estos, o dime uno nuevo si lo ves muy claro:

Balanced
Skirmisher
Tank
Glass Cannon
Controller
Trickster
Defender
5. Velocidad percibida

¿Cómo debería moverse?

Muy lenta
Lenta
Normal
Rápida
Muy rápida
6. Peso percibido

¿Cómo debería sentirse al chocar?

Muy ligero
Ligero
Medio
Pesado
Muy pesado
7. Estilo de juego

¿Cómo quieres que se juegue?

Ejemplos:

agresivo frontal
hit and run
control de zona
emboscada
desgaste
defensivo
caótico
8. Punto fuerte principal

Solo uno, el más importante.

Ejemplos:

daño
movilidad
supervivencia
control de área
empuje
utilidad
sorpresa
9. Debilidad principal

Obligatoria. Solo una clara.

Ejemplos:

lento
frágil
cooldowns largos
poco daño base
difícil de usar
depende mucho de acertar habilidades
10. Personalidad o identidad

¿Cómo es este bichito en una frase?

Ejemplos:

“un tanque noble y demoledor”
“un cabrón escurridizo”
“un loco impredecible”
“un cazador elegante y letal”
11. Habilidad 1

La habilidad rápida o simple.

Respóndeme así:

Nombre provisional:
Qué hace:
Para qué sirve:
Cómo debería sentirse:
12. Habilidad 2

La habilidad más táctica o más especial.

Respóndeme así:

Nombre provisional:
Qué hace:
Para qué sirve:
Cómo debería sentirse:
13. ULTI

La técnica especial potente.

Respóndeme así:

Nombre provisional:
Qué hace:
Cuándo se usaría:
Qué momento quiere crear:
Cómo debería sentirse:
14. Nivel de dificultad

¿Cómo de difícil quieres que sea llevarlo?

Fácil
Media
Alta
15. Prioridad visual

¿Qué debería destacar visualmente cuando luego hagamos el modelo?

Ejemplos:

colmillos enormes
patas diminutas y cuerpo grande
caparazón duro
ojos inquietantes
orejas gigantes
silueta muy reconocible
16. Idea de pedestal personalizado futuro

No hace falta currárselo mucho. Solo una idea rápida.

Ejemplos:

roca
barro
hoja
tronco
pedestal real
hielo
arena
17. Comentario libre

Aquí me pones cualquier cosa suelta:

comparaciones
dudas
ideas locas
“quiero que recuerde a...”
“no quiero que se parezca a...”

-------------------

1. Nombre del bichito

Trunk

2. Tipo de animal o criatura

Elefante

3. Fantasía principal

Quiero sentir que soy enorme e imparable.

4. Rol base

Bruiser

5. Velocidad percibida

Muy lenta

6. Peso percibido

Pesado

7. Estilo de juego

Agresivo frontal

8. Punto fuerte principal

Daño y resistencia sacrificando velocidad.

9. Debilidad principal

Lento

10. Personalidad o identidad

Un tanque noble y demoledor

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un ariete imparable, con mucho peso y velocidad.

12. Habilidad 2

Nombre provisional: Trunk Grip
Qué hace: Agarra a un enemigo con la trompa y lo lanza en una dirección.
Para qué sirve: Para alcanzar a enemigos que pueden estar fuera de tu alcance.
Cómo debería sentirse: Como un latigazo, con mucho impacto y caos.

13. ULTI

Nombre provisional: Ground Pound
Qué hace: Pega un pisotón con sus patas delanteras, stunneando a todos los enemigos a su alrededor.
Cuándo se usaría: Cuando estás rodeado o cuando quieres iniciar una pelea masiva.
Qué momento quiere crear: Un momento de caos controlado donde todos los enemigos están a tu merced.
Cómo debería sentirse: Como un terremoto, con mucho impacto y caos.

14. Nivel de dificultad

Medio

15. Prioridad visual

Orejas gigantes y trompa elástica.

16. Idea de pedestal personalizado futuro

Sabana

17. Comentario libre

Un elefante gris con un breve retardo al lanzar la habilidad 2 y la ULTI.

-------------------

1. Nombre del bichito

Kurama

2. Tipo de animal o criatura

Zorro

3. Fantasía principal

Quiero sentir que soy rápido y ágil.

4. Rol base

Trickster

5. Velocidad percibida

Muy rápida

6. Peso percibido

Ligero

7. Estilo de juego

Hit and run

8. Punto fuerte principal

Movilidad y engaño.

9. Debilidad principal

Frágil.

10. Personalidad o identidad

Un cabrón escurridizo.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un latigazo, con mucho impacto y caos.

12. Habilidad 2

Nombre provisional: Mirror Trick
Qué hace: Salta hacia atrás y deja una copia de sí mismo en su lugar durante dos segundos y permite que la copia pueda recibir ataques por él, para despistar.
Para qué sirve: Para confundir a los enemigos y evitar que te ataquen.
Cómo debería sentirse: Como un movimiento rápido y ágil, tramposo y satisfactorio.

13. ULTI

Nombre provisional: Copycat
Qué hace: Puede realizar la ULTI del último enemigo golpeado siga vivo o no.
Cuándo se usaría: Cuando quieres sorprender a los enemigos.
Qué momento quiere crear: Un momento de caos controlado donde los enemigos no saben qué esperar.
Cómo debería sentirse: Como algo sorpresivo y divertido.

14. Nivel de dificultad

Dificil

15. Prioridad visual

Colas múltiples.

16. Idea de pedestal personalizado futuro

Bosque japonés.

17. Comentario libre

Un zorro rojo con 9 colas.

-------------------

1. Nombre del bichito

Sergei

2. Tipo de animal o criatura

Gorila

3. Fantasía principal

Quiero sentir que soy fuerte y ágil.

4. Rol base

Balanced

5. Velocidad percibida

Normal

6. Peso percibido

Medio

7. Estilo de juego

Agresivo frontal

8. Punto fuerte principal

No tiene puntos flacos.

9. Debilidad principal

No tiene puntos fuertes.

10. Personalidad o identidad

Un gorila chulo y territorial.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un golpe con la palma de la mano.

12. Habilidad 2

Nombre provisional: Shockwave
Qué hace: Golpea el suelo con sus patas delanteras, creando una onda expansiva que empuja a los enemigos (no stun).
Para qué sirve: Para alejar a los enemigos y empujar a enemigos a las espaldas.
Cómo debería sentirse: Como un golpe con la palma de la mano, poderoso.

13. ULTI

Nombre provisional: Frenzy
Qué hace: Entra en un estado de frenesí, aumentando su velocidad y daño.
Cuándo se usaría: Cuando quieres decantar la balanza a tu favor.
Qué momento quiere crear: Un momento de locura total.
Cómo debería sentirse: Como un demonio.

14. Nivel de dificultad

Fácil

15. Prioridad visual

Brazos enormes.

16. Idea de pedestal personalizado futuro

Jungla.

17. Comentario libre

Un gorila que recuerde a Donkey Kong.

-------------------

1. Nombre del bichito

Shelly

2. Tipo de animal o criatura

Tortuga

3. Fantasía principal

Quiero sentir que soy una roca inamovible.

4. Rol base

Tank

5. Velocidad percibida

Muy lenta

6. Peso percibido

Muy pesado

7. Estilo de juego

Defensivo

8. Punto fuerte principal

Resistencia.

9. Debilidad principal

Lenta.

10. Personalidad o identidad

Una tortuga vieja y sabia.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un golpe con su caparazón rodando.

12. Habilidad 2

Nombre provisional: Shell Shield
Qué hace: Se esconde en su caparazón, volviéndose invulnerable pero incapaz de moverse y reflejando el daño recibido a los enemigos cercanos.
Para qué sirve: Para aguantar un ataque fuerte.
Cómo debería sentirse: Como un muro sólido e inamovible.

13. ULTI

Nombre provisional: Mega Shell
Qué hace: Se convierte en una roca gigante que rueda por el escenario, empujando a todos los enemigos a su paso.
Cuándo se usaría: Cuando quieres limpiar el escenario o empujar a los enemigos fuera del mapa.
Qué momento quiere crear: Un momento de caos controlado donde los enemigos no saben qué esperar.
Cómo debería sentirse: Como una avalancha.

14. Nivel de dificultad

Fácil

15. Prioridad visual

Caparazón grande y pesado.

16. Idea de pedestal personalizado futuro

Playa.

17. Comentario libre

Una tortuga con un caparazón que brilla con luz metálica.

-------------------

1. Nombre del bichito

Kermit

2. Tipo de animal o criatura

Sapo

3. Fantasía principal

Quiero sentir que soy un maestro del control.

4. Rol base

Controller

5. Velocidad percibida

Rápida

6. Peso percibido

Muy ligero.

7. Estilo de juego

Esquivo y estratégico

8. Punto fuerte principal

Control del campo de batalla y estados alterados a enemigos.

9. Debilidad principal

Frágil.

10. Personalidad o identidad

Un sapo con piel venenosa alucinógena.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un salto hacia delante impulsado con sus patas traseras.

12. Habilidad 2

Nombre provisional: Poison Cloud
Qué hace: Escupe una nube de veneno, los enemigos en su interior no pueden ver el exterior de la nube.
Para qué sirve: Para confundir a los enemigos y evitar que te ataquen.
Cómo debería sentirse: Como si estuvieras en una nube de veneno.

13. ULTI

Nombre provisional: Hypnosapo
Qué hace: Activa el veneno de su piel y los enemigos tocados aumenten su velocidad y se inviertan todos sus controles.
Cuándo se usaría: Cuando estás rodeado de enemigos.
Qué momento quiere crear: Un momento de desconcierto total.
Cómo debería sentirse: Como una alucinación.

14. Nivel de dificultad

Medio

15. Prioridad visual

Colores llamativos y patas largas.

16. Idea de pedestal personalizado futuro

Pantano.

17. Comentario libre

Un sapo que recuerde al hypnosapo de Futurama.

-------------------

1. Nombre del bichito

Sihans

2. Tipo de animal o criatura

Topo

3. Fantasía principal

Quiero sentir que soy un maestro del terreno.

4. Rol base

Trapper

5. Velocidad percibida

Muy rápida.

6. Peso percibido

Normal.

7. Estilo de juego

Táctico y disruptivo.

8. Punto fuerte principal

Control del espacio.

9. Debilidad principal

No potente en combate directo.

10. Personalidad o identidad

Un topo con gafas de sol.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un salto hacia delante impulsado por sus patas delanteras.

12. Habilidad 2

Nombre provisional: Tunnel
Qué hace: Se esconde bajo tierra y emerge en otro lugar, y en los puntos de entrada y salida deja terreno irregular donde los enemigos se ralentizan un 50%.
Para qué sirve: Para controlar el espacio y evitar que te ataquen.
Cómo debería sentirse: Como si fuera el Whack-a-mole.

13. ULTI

Nombre provisional: Diggy Diggy Hole
Qué hace: Cava un hoyo permanente en el suelo delante suya, por el cual los enemigos pueden caer.
Cuándo se usaría: Cuando se pueda.
Qué momento quiere crear: Un momento de trolleo.
Cómo debería sentirse: Como una excavación tras un breve retardo.

14. Nivel de dificultad

Difícil

15. Prioridad visual

Calvo, con gafas de sol y garras largas.

16. Idea de pedestal personalizado futuro

Desierto.

17. Comentario libre

Un topo que recuerde hombre topo Hans de los Simpsons.

-------------------

1. Nombre del bichito

Kowalski

2. Tipo de animal o criatura

Pingüino

3. Fantasía principal

Quiero sentir que soy dirijo el ritmo del combate.

4. Rol base

Mage

5. Velocidad percibida

Normal.

6. Peso percibido

Ligero.

7. Estilo de juego

Ligado a sus habilidades.

8. Punto fuerte principal

Sus habilidades.

9. Debilidad principal

Depende de la habilidad del jugador.

10. Personalidad o identidad

Un pingüino con cresta, como un pingüino real.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un salto hacia delante deslizándose con su panza.

12. Habilidad 2

Nombre provisional: Snowball
Qué hace: Lanza una bola de nieve que empuja a los enemigos y ralentiza su velocidad un 50% durante 2 segundos.
Para qué sirve: Para atacar desde la distancia y controlar su velocidad.
Cómo debería sentirse: Como un proyectil que se desliza por el suelo.

13. ULTI

Nombre provisional: Ice Age
Qué hace: Congela el suelo en un área grande, haciendo que los enemigos se resbalen y caigan (el pingüino es inmune a su propio efecto).
Cuándo se usaría: Cuando hay muchos enemigos cerca.
Qué momento quiere crear: Un momento de descontrol.
Cómo debería sentirse: Como una pista de hielo.

14. Nivel de dificultad

Difícil

15. Prioridad visual

Con crestas amarillas y colores azules.

16. Idea de pedestal personalizado futuro

Antártida.

17. Comentario libre

Un pingüino que recuerde a Kowalski de Madagascar.

-------------------

1. Nombre del bichito

Cheeto

2. Tipo de animal o criatura

Tigre

3. Fantasía principal

Quiero sentir que soy un cazador implacable.

4. Rol base

Assassin

5. Velocidad percibida

Rápida.

6. Peso percibido

Ligero.

7. Estilo de juego

Ofensivo y rápido.

8. Punto fuerte principal

Su movilidad.

9. Debilidad principal

Habilidades complejas.

10. Personalidad o identidad

Un tigre con colores anaranjados y negros y mirada asesina.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un salto felino hacia delante.

12. Habilidad 2

Nombre provisional: Shadow Step
Qué hace: Se teletransporta a la espalda del enemigo más cercano y le da un golpe con potencia aumentada.
Para qué sirve: Para acortar distancias y acechar a los enemigos.
Cómo debería sentirse: Como un flash del League of Legends.

13. ULTI

Nombre provisional: Tiger Roar
Qué hace: Ruge y empuja a todos los enemigos en un área cónica delante de él.
Cuándo se usaría: Cuando hay muchos enemigos cerca.
Qué momento quiere crear: Un momento de masacre.
Cómo debería sentirse: Como un rugido ensordecedor.

14. Nivel de dificultad

Medio

15. Prioridad visual

Con colores anaranjados y negros.

16. Idea de pedestal personalizado futuro

Jungla.

17. Comentario libre

Un tigre que recuerde a un asesino en serie.

-------------------

1. Nombre del bichito

Sebastian

2. Tipo de animal o criatura

Cangrejo

3. Fantasía principal

Quiero sentir que soy peligroso pero frágil.

4. Rol base

Glass cannon.

5. Velocidad percibida

Rápida.

6. Peso percibido

Muy ligero.

7. Estilo de juego

Muy potente y rápido pero cauteloso.

8. Punto fuerte principal

Gran capacidad ofensiva.

9. Debilidad principal

Muy frágil.

10. Personalidad o identidad

Un cangrejo risueño de color rojo con una gran pinza y una pequeña pinza.

11. Habilidad 1

Nombre provisional: Charge Rush
Qué hace: Un dash frontal rápido que empuja a los enemigos.
Para qué sirve: Para iniciar el combate, romper formaciones y castigar a los que se quedan quietos.
Cómo debería sentirse: Como un desplazamiento lateral rápido mientras golpea con su pinza.

12. Habilidad 2

Nombre provisional: Claw Sweep
Qué hace: Barre con su pinza en un abánico delante de él.
Para qué sirve: Para golpear a múltiples enemigos.
Cómo debería sentirse: Como un barrido poderoso.

13. ULTI

Nombre provisional: Crab Slash
Qué hace: Carga haciendo un desplazamiento lateral muy rápido que solo para si golpea a un enemigo (el enemigo es echado de la plataforma si o si), si no golpea a nadie el cangrejo caerá de la plataforma.
Cuándo se usaría: Cuando estés seguro de que vas a golpear a alguien.
Qué momento quiere crear: Un momento de tensión.
Cómo debería sentirse: Como un corte de katana ultrasónico.

14. Nivel de dificultad

Difícil

15. Prioridad visual

Una sola pinza enorme y otra pequeña.

16. Idea de pedestal personalizado futuro

Fondo marino.

17. Comentario libre

Un cangrejo que recuerde a Sebastian de la Sirenita.

-------------------
