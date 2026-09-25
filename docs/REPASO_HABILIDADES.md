# Repaso de habilidades — 2026-09-24

Rafa: *«repasa también las habilidades de cada uno por si necesitan
retoques o mejoras»*.

## Cómo se hizo

- **Pruebas**:
  - las 27 habilidades filmadas y medidas contra tres muñecos con
    `scripts/ability-shots.mjs`;
  - una tanda de bots de 8 partidas por bicho con grabaciones de eventos.
- **Repaso**: un revisor por bicho, un escéptico que intenta tumbar cada
  hallazgo y una síntesis. El informe completo, con la tabla de ajustes y
  las propuestas de diseño, está en
  [`REPASO_HABILIDADES_INFORME.md`](REPASO_HABILIDADES_INFORME.md).
- **Arreglos**:
  - ocho grupos en secuencia sobre la misma rama, cada uno con su
    verificación antes y después, contra un servidor «foto fija» del
    `dev` anterior;
  - después, dos revisores adversariales del diff completo y una pasada
    de corrección.

Solo se ha tocado el carril PERSONAJES. Lo que falta en otros ficheros
está abajo, por dueño.

## Qué se arregla (rama `claude/fix/personajes-repaso-habilidades`)

**Bugs de producción**

- **Inmunidad offline.** Las K radiales y de cono, el Grip, el impacto
  del blink y el tirón del Sinkhole empujaban a inmunes. Eso rompía el
  Steel Shell (Trunk Slam lanzaba a Shelly anclada a 20 u/s) y el Mirror
  Trick. Ahora a los inmunes y a los que caen se les salta, igual que en
  el servidor.
- **Caer lo corta todo.** Las habilidades activas se cancelan con su
  enfriamiento y el aturdido, la confusión y la ralentización se limpian
  al reaparecer. El jugador no puede armar nada mientras cae. Antes, el
  Cone Pulse seguía al reaparecer (en 9 de 58 usos) y Sebastian podía
  lanzar el All-in desde el vacío.
- **All-in de Sebastian.**
  - Solo cuenta a quien está por delante: antes eliminaba a quien tenía
    pegado a la espalda.
  - Fallar es caída garantizada, en el primer punto fuera de la arena y
    aunque sea inmune. Antes desde el borde era un escape de unas 17 u.
- **Hit stop.** Congela ahora también las L canalizadas, los proyectiles
  y las zonas. La sierra de Shelly sumaba impulso en cada fotograma
  congelado y llegaba a 600-1260 u/s. Ahora la sierra, la embestida y el
  toque golpean una vez por contacto (enfriamiento 0,3 s), y la sierra
  fija la velocidad en vez de sumarla.
- **Copycat.** Ya no escribe la copia en la definición compartida (en el
  servidor la compartían todas las salas). La copia es por lanzamiento
  con `COPYCAT_KEYS`, sin los campos del All-in. Copiar a Sebastian
  mataba a Kurama al fallar.
- **Sinkhole.** No se come la baldosa de Sihans (antes en el 15,5 % de
  los lanzamientos). El laboratorio conecta el arena, así que el golden
  y las tandas ven ya los agujeros.
- **Aterrizajes.** Sand Trap, Shadow Step y Mirror Trick retroceden por
  su línea hasta encontrar suelo vivo. Antes caían en el vacío en 408 de
  2730 lanzamientos.
- **Hielo de Kowalski.** Offline no reducía la aceleración a ×0,35, como
  sí hacía el servidor. Los dos factores viven ahora en la zona.
- **Mirror Trick nunca se vio como se diseñó.** Kurama parpadeaba blanca
  y opaca en vez de quedarse al 8 %. El señuelo es ahora sólido, con
  contorno, en el origen y con vida en tiempo de juego. El Steel Shell ya
  no parpadea como un fantasma.
- **Velocidades de clip.** Las de `ANIMATION_OVERRIDES` (lo que se afina
  en anim-lab) no llegaban nunca a las habilidades desde 47728db. Ahora
  sí, en 17 clips.
- **Menores.**
  - Cone Pulse dispara siempre sus 6 pulsos, a cualquier frecuencia.
  - Frozen Floor vuelve a idle.
  - Shelly no embiste anclada, y al sacar el escudo cancela la
    embestida.
  - Una J que acaba no corta la pose de la K.
  - El Grip se inclina hacia donde tira.
  - El anillo de las zonas usa el mismo reloj que la zona.

**IA de los bots**

- **Tres habilidades que nunca se lanzaban** (0 usos en 72 partidas), por
  elegir la primera de cada etiqueta:
  - Trunk Grip, ahora a 2,7 usos/min;
  - Sand Trap, 3,9;
  - Shadow Step, 5,0.
- **All-in de Sebastian**: la misma carga y suelta que el jugador, con el
  pasillo real de acierto. Sus autocaídas pasan de 13 a 0.
- **Sonda del dash** por la mirada antes de cualquier J.
- **Puertas de puntería**: Snowball, Claw Wave, Cone Pulse, Frozen Floor
  y las reglas de escudo y sierra de Shelly.
- **Radiales**: con 2 enemigos dentro o 1 cerca. Shockwave pasa de 2,0 a
  4,6 usos/min.

**Sensación**

- Las J dan feedback de golpe al embestir (destello, inclinación,
  sonido y shake), una vez por víctima. Sin fuerza extra: la fuerza del
  golpe de dash la decidió Rafa y va aparte.

**Tests**: paridad FEEL↔SIM de los valores nuevos, paridad de kits y de
`COPYCAT_KEYS` entre cliente y servidor
(`tests/sim/ability-kit-parity.test.ts`), y casos nuevos en
`server-bot.test.ts`.

## Medido (tanda de bots, mismas semillas, 24-48 partidas por bicho)

| | Antes | Después |
|---|---|---|
| Dispersión del «eliminado» entre bichos | 17,9 puntos | **13,0** (más igualado) |
| Sebastian eliminado | 72 % | **53 %** |
| Kurama eliminado | 28 % | 44 % |
| Caídas por minuto (media) | 2,25 | 2,52 |
| Trunk Grip · Sand Trap · Shadow Step | 0 · 0 · 0 usos/min | 2,7 · 3,9 · 4,5 |
| Shockwave · Trunk Slam | 2,3 · 2,5 usos/min | 4,6 · 4,4 |

- **Caídas**: suben porque el laboratorio ve ya los agujeros del
  Sinkhole y los bots usan más habilidades.
- **All-in**: no aparece en los usos, porque la vía de cargar y soltar no
  genera `ability_cast`; está pendiente en `dev-api`.
- **Ruido**: con estas muestras, cada cifra suelta de un bicho tiene
  mucho; el agregado es lo fiable.

## Pendiente para DISTRIBUCIÓN (`server/src/BrawlRoom.ts`)

> **Estado (DISTRIBUCIÓN, 2026-09-25):** hechos el 1 (en v1.8), del 2 al 8,
> el 10 en la sala y el 11 (por S2-5), en la rama
> `claude/feature/distribucion-brawlroom-v19` (v1.9, `NET_PROTOCOL` 3).
> Queda:
> - **el 9 (Sinkhole)**, a la espera de que ARENA dé el getter del layout
>   en `ArenaSim`;
> - del 10, la predicción online, que sigue sin modelar el hielo (2-3 px
>   de diente de sierra medidos; no bloquea).
>
> Verificación en BUILD_LOG (entrada de v1.9).

> **BLOQUEO DE DESPLIEGUE.** El `server/src/sim` de esta rama ya no
> escribe la copia de Copycat en el kit compartido. `BrawlRoom` tiene que
> leer la L por jugador **en el mismo despliegue**. Si no, online la
> Kurama que copia a Shelly, Cheeto o Kermit se queda solo con el buff.

1. **Copycat (bloqueo).** En el import de `./sim/abilities.js`, añadir
   `getLDef`. En la pasada 2.e (~1212) y en la 2.g (~1401), cambiar
   `const kit = getAbilityKit(p.critterName); const lDef = kit[2];` por
   `const lDef = getLDef(p);`.
2. **Reaparición.** Tras `p.immunityTimer = SIM.lives.immunityDuration;`
   (~1566): `p.stunTimer = 0; p.confusedTimer = 0; p.slowTimer = 0;`.
3. **Caída de la víctima del All-in** (~1457). Sustituir el bloque
   `hitVictim.falling = true; hitVictim.lives = …; vData.respawnTimer = …`
   por `startFalling(hitVictim, this.internal.get(hitVictim.sessionId));`,
   importando `startFalling` de `./sim/physics.js`. Cancela sus
   habilidades y banderas, como ya hace `checkFalloff`.
4. **All-in, barrido** (~1421). Tras `if (other.immunityTimer > 0)
   continue;`, añadir `if ((other.x - p.x) * dx + (other.z - p.z) * dz <
   0) continue;`. El alcance pasa a `0.55 + 0.55 + SIM.allIn.hitMargin`.
5. **All-in, fallo** (~1464). Sustituir
   `p.x += dx*range*1.5; …; p.vx = dx*sf; p.vz = dz*sf;` por:

   ```ts
   const step = SIM.allIn.missProbeStep;
   const maxT = Math.hypot(p.x, p.z) + FRAG.maxRadius + step;
   let t = step;
   while (t < maxT && this.arenaSim.isOnArena(p.x + dx * t, p.z + dz * t)) t += step;
   p.x += dx * t; p.z += dz * t;
   startFalling(p, data);
   ```

   `FRAG` viene de `./sim/arena-fragments.js`. Después, PERSONAJES
   quita `allInMissSelfForce` del kit.
6. **Pasadas de contacto de la L** (sierra, embestida, toque).
   - Importar `ageContactRehit, takeContactHit`.
   - En 2.e, tras el descuento de `stunTimer` (~1221):
     `ageContactRehit(p, dt);`.
   - En rammingL, sawL y toxicTouchL, tras el filtro de alcance:
     `if (!takeContactHit(p, other)) continue;`.
   - En sawL y rammingL, **fijar** la velocidad:
     `other.vx = (dx / d) * impulse; other.vz = (dz / d) * impulse;`.
7. **Cone Pulse** (2.e, ~1227-1290). Unir los dos bloques `conePulseL` en
   uno solo ANTES de `if (!lState.active || lState.windUpLeft > 0)
   continue;`:

   ```ts
   const data = this.internal.get(p.sessionId);
   if (lDef.conePulseL && data) {
     const isActive = lState.active && lState.windUpLeft <= 0;
     if (isActive && !data.pulseLastActive) { data.pulseAccum = 0; data.pulseCount = 0; }
     const channeling = isActive || !!data.pulseLastActive;
     data.pulseLastActive = isActive;
     if (channeling) {
       const interval = lDef.pulseInterval ?? 0.30;
       const maxPulses = lDef.pulseCount ?? Infinity;
       data.pulseAccum = (data.pulseAccum ?? 0) + dt;
       while (data.pulseAccum >= interval && (data.pulseCount ?? 0) < maxPulses) {
         data.pulseAccum -= interval;
         data.pulseCount = (data.pulseCount ?? 0) + 1;
         /* cuerpo actual: rampa, onda, empujón, broadcast('lPulse') */
       }
     }
   }
   ```

   A 30 Hz ya salen 6. Lo que cambia es el tope de la Kurama que copia,
   que hoy da 11.
8. **Aterrizajes seguros** (~1070). Quinto argumento de
   `tickPlayerAbilities`: `(x, z) => this.arenaSim.isOnArena(x, z)`.
9. **Sinkhole** (~1109, `if (z.sinkhole)`, con `p` el lanzador). Hace
   falta que ARENA añada `getLayout()` a `ArenaSim`. Después:

   ```ts
   const frags = this.arenaSim.getLayout().fragments;
   const candidates = this.arenaSim.getAliveFragmentsInDisc(z.x, z.z, z.radius)
     .filter((i) => !pointInFragment(p.x, p.z, frags[i]));
   ```

10. **Hielo** (no urgente: hoy los valores coinciden).
    - `getSlipperyZone` en vez de `isOnSlipperyZone`.
    - En la entrada: `accelMul = ice?.accelMult ?? 1`.
    - En la fricción: `if (ice) halfLife *= ice.frictionMult`.
    - Tu predicción online debe leer esos dos factores de la zona.
11. **Golpe de las J online.** Lo sustituye el punto S2-5 de la segunda
    tanda (evento `dashHit` con fuerza, que ya devuelve el sim).
12. **Despliegue**. `server/src/sim/*` cambia lo que deciden los bots
    online, sin tocar la firma de `computeBotInput`, y la compuerta del
    ancla de Shelly. Sale con este lote.

## Pendiente en tierra de nadie (con permiso de Rafa)

**Hechas por PERSONAJES el 2026-09-25**, con permiso de Rafa:
- `src/frame-ticks.ts`:
  - ningún icono sobre el bicho invisible de otro (Mirror Trick, la
    madriguera): el 👻 solo lo ve la Kurama local, y los demás iconos
    (frenesí, veneno…) también la delataban;
  - zonas por dueño (`isInsideZoneOfKind(…, nombre)`): offline, una
    Kurama que copia Frozen Floor no se ve congelada en su hielo y
    Kowalski sí. Online, una zona copiada llega como `generic` y no pinta
    icono: aviso a DISTRIBUCIÓN;
  - «sin iconos mientras cae» ya lo hacía `status-icons.ts` desde
    6817ce5: no hacía falta.
- `src/main.ts`: la nube de Kermit no le ciega a él.
- `src/game.ts`: `playerWasFalling` se toma antes de la entrada. Así
  cuentan en las estadísticas las caídas del All-in: el fallo propio y el
  de un bot que echa al jugador.
- `src/tools/dev-api.ts`: el All-in sale en las grabaciones.
  - Su `ability_cast` es la suelta que dispara, y va antes de las caídas
    que provoca.
  - Una carga soltada sin disparar deja un `ability_end` «(dropped)», sin
    `ability_cast`.

Quedan, opcionales y sin pedir: `scene` en `updateBot`,
`setArenaForAbilities` en el constructor de `Game` y el «Reset defs» del
laboratorio (`src/tools/sidebar.ts:1424`, que debería leer el kit y no
`state.def`, que durante un Copycat es la copia).

## Pendiente para INTERFAZ y ARENA

- **INTERFAZ**:
  - textos de estado: `status-vulnerable-desc` dice «el doble» y son ×4;
    `status-frozen-desc` debe cubrir la bola y el hielo;
  - opcional: la J de Shelly se pinta bloqueada mientras está anclada.
- **ARENA**: `getLayout()` de solo lectura en `ArenaSim`, para el punto 9
  de DISTRIBUCIÓN.

---

# Segunda tanda — decisiones de Rafa (2026-09-25)

Rafa, sobre las propuestas de diseño del informe: *«1 sí, 2 sí, 3 sí, 4
sí, 5 sí, 6 hay que tener cuidado porque el salto para atrás es
precisamente para alejarse del perseguidor, míralo bien, 7 frena en seco,
se cae si la baldosa desaparece, la embestida debe golpear sí, 8 sí, no,
la bola la lanza con la mano y tiene una animación para ello, revísalo;
el buff como consideres mejor, 9 la intención de la habilidad es que al
tocarlos los controles en general se inviertan, 10 sí»*.

El punto 1 (paso fijo de simulación) va aparte. El 9 no cambia nada.

Método: nueve grupos en secuencia, cada uno verificado antes y después
contra la foto fija de `dev`, y revisión adversarial del diff.

## Qué se aplica

- **Golpe de dash (2 y 7).** Campo `dashHitForce` en la J: Sergei 22,
  Cheeto 30, Sebastian 26 y Shelly 30.
  - Pega una vez por víctima y activación, con el reparto por masas y el
    ×4 al aturdido, como un cabezazo, más un hit stop corto.
  - Sebastian solo golpea por delante (±60°, el cono de su Claw Wave).
  - Contra el escudo de Shelly, el golpe se devuelve como el cabezazo.
  - Kurama **atraviesa** (`dashPhaseThrough`). Si el dash acaba encima
    de un rival, la separación normal los aparta ~0,4 u, sin golpe.
  - Muñeco cercano, antes → después: Sergei 0,42 → 0,84 u, Cheeto
    0,29 → 0,93 y Shelly 0,13 → 1,31. El cabezazo sigue empujando más
    (Sergei 1,62 u).
- **El aturdido no actúa (3).** Con `stunTimer > 0` no se cabecea ni se
  lanza J, K ni L; moverse ya estaba bloqueado.
  - El Grip baja de 3,8 a 2,5 s.
  - Un aturdido suelta la carga del All-in sin disparar.
  - Afecta también al Slam de Trunk, que comparte el aturdido.
- **Frenesí de Sergei (4).** `knockbackTakenMult` 0,4, aplicado en un
  punto central (`knockbackScale`) a todos los empujes. También lo tiene
  la Kurama que lo copia.
  - Cabezazo de Trunk sobre Sergei en frenesí: 1,54 → 0,62 u.
  - El golpe del All-in y el tirón del Sinkhole quedan fuera a propósito,
    y desde el 2026-09-25 también el Grip, que lo trae entero (pregunta
    4).
- **All-in (5).** Carga mínima de 0,35 s: un toque dispara al cumplirse.
  Mientras carga, el mando gira el apuntado (360°/s; 180°/s desde el
  2026-09-25, pregunta 5), y la línea sigue la puntería y se apaga al
  acabar. Los bots respetan el mínimo.
- **Mirror Trick (6).** Se aleja del enemigo vivo más cercano a menos de
  10 u, girándose hacia él para que el salto hacia atrás se lea. Sin
  nadie cerca, salta hacia atrás como antes. Probado en los tres casos:
  - encarando al perseguidor: igual que antes;
  - huyendo con el perseguidor detrás: antes aparecía al otro lado de él,
    ahora a 9 u;
  - con dos enemigos: se aleja del más cercano.
- **Shelly (7).**
  - El escudo frena en seco su propio movimiento; un empujón recibido
    sigue su vuelo.
  - La carga del escudo queda enraizada del todo.
  - La inmunidad del escudo protege del empujón, pero no de la caída:
    si la baldosa desaparece, cae. La gracia de reaparición sigue
    sosteniendo.
- **Kowalski (8).**
  - El Ice Slide desliza de verdad: 4,7 u más que correr, frente a 1,6.
    La sonda del bot mira más lejos para no tirarse por el borde.
  - La bola sale cuando la aleta la suelta: clip a 3,5×, medido hueso a
    hueso.
  - El buff de Frozen Floor se queda en ×1,10, porque la medida no lo
    distingue de 1,0; el comentario ya no dice «neutro».
- **Bots online con L (10).** Espejo de las reglas de L del cliente en
  `server/src/sim/bot.ts`, menos el All-in, que online no tiene cómo
  cargar un bot.
  - **Queda apagado tras `SIM.bots.ultimateOnline = false`**: con bots
    lanzando la L en cada partida, la sala tiene que ejecutar antes las L
    como el sim (punto S2-2).
- **Pulido visual.**
  - Brillo de estado por habilidad, en vez del amarillo y el rojo
    genéricos.
  - Hit stop y sonido en el Shadow Step y la bola.
  - Menos shake en la nube de Kermit.
  - Anillo de nieve en el impacto de la bola.
  - El Cone Pulse se pinta como la cuña del cono, no como un disco de
    360°.
  - El tirón del Grip se ve deslizar en 0,15 s, sin teletransporte.

Tests nuevos del sim del servidor: `server-dash-hit`,
`server-steel-shell`, `server-mirror-trick`, `server-knockback-scale` y
`server-stun` (31 casos), más filas en `ability-kit-parity` y
`feel-sim-parity`.

## Medido (tanda de bots)

Dos juegos de semillas (700-860 y 1000-1160), con 8 partidas por bicho
como jugador: 40-80 apariciones por bicho y lado. Los dos juegos dicen
lo mismo.

| Bicho | Eliminado antes → después | Caídas/min |
|---|---|---|
| Sebastian | 57 → 47 % | 2,58 → 2,27 |
| Cheeto | 68 → 57 % | 2,56 → 2,70 |
| Kurama | 42 → 35 % | 1,96 → 2,11 |
| Kermit | 49 → 44 % | 2,37 → 2,39 |
| Sihans | 69 → 64 % | 3,02 → 2,99 |
| Shelly | 70 → 69 % | 2,39 → 2,59 |
| Trunk | 43 → 48 % | 2,37 → 2,57 |
| **Kowalski** | **49 → 65 %** | **2,05 → 2,57** |
| **Sergei** | **70 → 78 %** | 2,59 → 2,79 |

- La dispersión del «eliminado» sube de 11,5 a 13,0 puntos.
- Ganan los dashes que ahora golpean fuerte: Sebastian y Cheeto. Todo el
  que se queda quieto cargando algo queda más expuesto a esos golpes.
- **Kowalski pierde por los golpes de los demás, no por su Ice Slide.**
  Lo midió una sonda paso a paso en tiempo de simulación: 40 partidas
  por lado, Kowalski como jugador, con cada caída clasificada.
  - Caídas en los 1,2 s tras su Ice Slide: 4,2 → 5,1 % de los
    deslizamientos. Es lo mismo; el deslizamiento largo no lo tira.
  - Caídas con un rival a menos de 1,3 u: de 1,41 a 1,70 por minuto
    (+20 %). Son los golpes de dash nuevos.
  - Caídas solo: de 0,90 a 1,09 por minuto. Caídas por suelo hundido:
    de 0,28 a 0,09.
  - *Corregido el mismo día*: la primera versión de esta nota culpaba
    al deslizamiento. Medía ventanas de 1,2 s sobre las grabaciones de
    la tanda, pero sus eventos llevan el reloj de pared
    (`performance.now()`): a velocidad 8×, esa ventana cubría varios
    segundos de partida (ERROR_LOG, 2026-09-25).
  - **Siguiente paso de PERSONAJES**: un pase de balance de los golpes
    de dash, que castigan al que se queda quieto. Kowalski lanza la
    bola y Sergei el Shockwave con carga previa, y ninguno de los dos
    tiene un dash que golpee fuerte.
- **Sergei** ya era de los más débiles con bots (70 %) y queda el peor
  (78 %). Su golpe de dash (22) es el más flojo. Queda para un pase de
  balance con más partidas: hoy la tanda tiene ±8 puntos de ruido.
- Las 27 habilidades, filmadas de nuevo (`.tmp/fase2/despues`). Se ven
  los cambios buscados:
  - golpe de las J;
  - Ice Slide: 0,80 → 1,33 u en la ventana activa.

  Lo demás queda igual. Las diferencias restantes vienen de dos arreglos
  de `ability-shots.mjs`:
  - el estado se limpia antes de cada toma;
  - una acción del calentamiento ya no cae dentro de la toma. Antes
    aturdía al muñeco cercano en todas las tomas de Kurama.

## Paso fijo de simulación (decisión 1), hecho el 2026-09-25

El juego offline simula en pasos de 1/60 s, como el laboratorio, el
golden y la tanda. Así, un empujón llega igual de lejos se juegue a la
frecuencia que se juegue.

- **Permiso**: Rafa aprobó `main.ts` y, el 25, unas 6 líneas de
  `game.ts`: `isOnlinePhase()` y `syncCritterShadows` pública.
- **Cómo funciona** (`src/fixed-step.ts`, puro, con sus tests):
  - Cada fotograma ejecuta los pasos que llevan la simulación hasta el
    reloj real o un poco más allá.
  - Los bichos se dibujan en el instante real, entre sus dos últimas
    poses de simulación. La pose interpolada solo se pone para pintar.
  - Las sombras y los iconos de estado siguen a la pose dibujada.
  - Se simula por delante del reloj, no por detrás como en el libro:
    dibujar el paso pasado añadiría 16,7 ms de retraso a 60 Hz.
  - Cuando la pantalla va a 60 o a 30 Hz (±0,25 ms por fotograma), el
    reloj se engancha a su ritmo y se sienta 1 ms dentro del paso.
    - Sentado justo en el límite, el ruido de las marcas de tiempo del
      navegador (redondeadas a 0,1 ms) hacía fotogramas de 2, 0 y 1
      pasos. Animaciones, giros, bolas y polvo, que no se interpolan,
      iban a trompicones. Lo vio la revisión adversarial.
    - Con ±0,2 ms de ruido, 60 Hz da ahora 1 paso en cada fotograma, y
      30 Hz, 2.
  - El código que teletransporta a un bicho lo marca
    (`Critter.markTeleported`): blink, señuelo, tirón del Grip, All-in,
    reaparición y reinicio. Se dibuja en el sitio nuevo, sin
    deslizarse, y el tirón del Grip no se corrige dos veces.
- **Online no cambia**: sigue por fotograma y manda el servidor.
- **Medido en el juego real** (`scripts/fixed-step-probe.mjs`, reloj de
  fotogramas virtual):

  | | 30 Hz | 60 Hz | 144 Hz | 240 Hz |
  |---|---|---|---|---|
  | Deslizamiento tras un empujón, antes | +15 % | 2,877 u | +74 % | −15 % |
  | Deslizamiento, ahora | igual | 2,877 u | igual | igual |
  | Velocidad al andar, antes → ahora (u/s) | 3,80 → 3,54 | 3,54 → 3,54 | 3,40 → 3,54 | 3,05 → 3,54 |

  - A 60 Hz el juego es idéntico al de antes: mismo recorrido, y el
    bicho se mueve en el fotograma siguiente a la tecla (se dibuja 1 ms
    por detrás del último paso).
  - A 240 Hz la entrada se lee cada paso, así que puede tardar hasta
    16,7 ms en notarse. Es el precio de simular a 60 Hz.
  - El movimiento dibujado es uniforme a cualquier frecuencia.
- **Queda para un segundo corte** (tierra de nadie, con permiso aparte):
  - separar simular de presentar en `Critter`, `Game` y `frame-ticks`,
    para que animaciones, polvo y bolas de nieve se pinten a 144 Hz
    (hoy van a 60 Hz a cualquier frecuencia);
  - que el reloj del laboratorio use `FixedStepClock`.

## Preguntas a Rafa — respondidas el 2026-09-25

1. **Steel Shell**: si a Shelly la lanzan y saca el escudo en pleno
   vuelo, ¿se queda clavada o sigue volando? Rafa: **sigue volando**. El
   escudo frena en seco lo que ella hace por sí misma, no un golpe ya
   recibido; premia sacarlo antes del golpe. Sin cambios.
2. **Mirror Trick cae sobre el vacío** durante el truco. Rafa: **sí, debe
   caer**. Sin cambios.
3. **El Slam de Trunk deja sin actuar** 1,5 s a los que pilla. Rafa:
   **sin actuar, tampoco habilidades**. Sin cambios.
4. **El Grip a un Sergei en frenesí.** Rafa: **entero**. Hecho: el tirón
   ya no pasa por `knockbackScale`, en el cliente y en `server/src/sim`
   (test en `server-knockback-scale`). El frenesí solo resiste los
   golpes.
5. **Velocidad de apuntado del All-in.** Rafa: «como consideres mejor y
   más coherente». **180°/s** (antes 360), en `FEEL` y `SIM`.
   - A un rival que corre la puntería lo sigue igual: de lado, a 5 u,
     gira 25-60°/s visto desde Sebastian.
   - Lo que cambia es el giro por sorpresa. A 360°/s, Sebastian cargando
     de espaldas se giraba 180° en 0,5 s, antes de que la víctima leyera
     la línea: reaccionar lleva ~0,25 s y salir del pasillo ~0,5 s. A
     180°/s tarda 1 s, y 90° en 0,5 s. La línea avisa, que es para lo
     que está, y apuntar sigue siendo ágil.
   - Los bots no apuntan mientras cargan: disparan con el rival ya en la
     línea. Una tanda de 24 partidas da los mismos 62 All-in a 360, 180 y
     120°/s. Solo cambia el juego humano, también online (`BrawlRoom` lee
     el espejo).
6. ~~**Kermit online**: con la L, su bot pasa de ganar el 16 % al 39 %
   en la sala simulada.~~ **Respondida** (Rafa, 2026-09-25, vía
   DISTRIBUCIÓN): la L de los bots online se enciende para todos. El
   balance de Kermit, si hace falta, va en un pase aparte. El interruptor
   lo enciende DISTRIBUCIÓN con S2-2.

## Pendiente para DISTRIBUCIÓN (segunda tanda)

> **Estado (DISTRIBUCIÓN, 2026-09-25):** hechos del S2-1 al S2-5 en la
> misma rama, más los 2 sub-pasos de integración
> (`SIM.movement.integrationSubsteps`), repetidos en el suavizado online.
> - **S2-1:** la carga arranca mientras la L está mantenida, como
>   `tickSebastianHoldToFire`. En el flanco, mantenerla mientras acababa
>   el cooldown o un aturdido metía la L por la activación estándar: un
>   All-in instantáneo, que ya estaba en producción.
> - **S2-2:** `ultimateOnline = true`. La tanda online sobre la sala nueva
>   (216 partidas, semillas 9000) da 0 errores y 0 L fuera de su
>   condición; Kermit gana el 37 % de sus partidas.

- **S2-1. Bucle del hold-to-fire unido, cabezazo y apuntado** (decisiones
  3 y 5).
  - Arranque del cabezazo (~959): añadir `&& p.stunTimer <= 0`.
  - Arranque de la carga (`risingEdge`): también `p.stunTimer <= 0`.
  - Rama `if (data.lHoldCharging)`:

    ```ts
    if (data.lHoldCharging) {
      const drop = p.stunTimer > 0 || data.inputUltimateCancel;
      if (drop) {
        data.lHoldCharging = false; data.lHoldChargeTime = 0;
        data.inputUltimate = false; data.inputUltimateCancel = false;
        this.broadcast('lChargeEnd', { sessionId: p.sessionId });
        continue;
      }
      data.lHoldChargeTime = (data.lHoldChargeTime ?? 0) + dt;
      const minSec = (lDef.holdToFireMinMs ?? 0) / 1000;
      const maxSec = (lDef.holdToFireMaxMs ?? 3000) / 1000;
      if ((!ultDown || data.lHoldChargeTime >= maxSec) && data.lHoldChargeTime >= minSec) {
        data.lHoldCharging = false; data.lHoldChargeTime = 0;
        data.allInActive = true;
        data.allInDirX = Math.sin(p.rotationY); // the aim is the facing NOW
        data.allInDirZ = Math.cos(p.rotationY);
        lState.cooldownLeft = lDef.cooldown;
        this.broadcast('lChargeEnd', { sessionId: p.sessionId });
      }
      data.inputUltimate = false;
    }
    ```

  - Se usa `!ultDown` y no el flanco de bajada, para que soltar antes del
    mínimo dispare al cumplirlo.
  - `inputUltimateCancel?: boolean` en `InternalPlayerData`. Hoy no lo
    escribe nadie; es la salida para cuando los bots online usen el
    All-in.
  - **Apuntado.** Mientras `data.lHoldCharging && data.hasInput`, girar
    `p.rotationY` hacia `Math.atan2(data.moveX, data.moveZ)` por el lado
    corto, como mucho `SIM.allIn.aimTurnDegPerSec · π/180 · dt`. En la
    regla de orientación del paso de integración, añadir
    `!data.lHoldCharging &&`.
- **S2-2. Condición para encender `SIM.bots.ultimateOnline`** (decisión
  10). Hacen falta los puntos 1, 6 y 7 de la primera tanda, más:
  - `knockbackScale(victim)` (de `./sim/abilities.js`) multiplicando los
    empujones propios de la sala:
    - bola (~1173): `pr.impulse * knockbackScale(hitVictim)`;
    - Cone Pulse (~1281);
    - embestida (~1311) y sierra (~1329), que además **fijan** la
      velocidad.
  - Después, repetir la sala simulada (`.tmp/fase2/h8/online-sim.mts` en
    el worktree de PERSONAJES) y comparar victorias por bicho, no solo
    caídas. Mira antes la pregunta 6 de Rafa.
- **S2-3. Lectores de los espejos.**
  - Integración (~1500): `halfLife *= frictionScale(p);` (Ice Slide).
  - Cone Pulse (~1266): `const { waveStep, waveThickness } =
    SIM.conePulse;` en vez de 1.4 y 2.0.

  Sin esto, las filas de paridad en verde fijan el valor, no la paridad
  online.
- **S2-4. Señuelo online en el origen.** El evento `abilityFired` toma la
  posición y la orientación DESPUÉS del efecto. Guardarlas antes y
  mandarlas como `originX/Z/RotY`; `game.ts` (tierra de nadie) pinta el
  señuelo ahí.
- **S2-5. Feedback online del golpe de dash.**
  - Pasar un `DashHitEvent[]` como cuarto argumento de
    `resolveCollisions` y, por cada evento,
    `this.broadcast('dashHit', { rusherSid, victimSid, nx, nz, force })`.
  - Registrarlo en `network-events.ts`.
  - Su manejador en `game.ts` es tierra de nadie. El empuje en sí ya lo
    hace el sim.
- **Despliegue.** Varias cosas cambian online solo con desplegar
  `server/src/sim`, sin tocar la sala:
  - el golpe de dash;
  - el aturdido bloquea J, K y L;
  - el frenesí resiste los empujes del sim;
  - Mirror Trick se aleja del perseguidor;
  - Shelly frena en seco y cae por un hueco.

  Cliente y servidor, juntos.

## Pendiente en tierra de nadie (segunda tanda)

- `src/game.ts`:
  - manejadores de `dashHit` y `lChargeEnd` (este apaga la línea del
    All-in);
  - el señuelo en el origen;
  - la cuña del Cone Pulse, el shake y el hit stop de las K radiales y
    el golpe del Shadow Step también online;
  - el deslizamiento del tirón del Grip para el jugador local.
- `src/network-events.ts`: `onLChargeEnd`.

## Pendiente para INTERFAZ y ARENA (segunda tanda)

- **INTERFAZ**:
  - `isBlockedByAnchor(state, states)` ya está exportada en
    `abilities-runtime.ts`: la J de Shelly se puede pintar bloqueada;
  - «Aturdido» debe decir que no se mueve **ni actúa**;
  - opcional: atenuar J, K y L mientras `stunTimer > 0`.
- **ARENA** (si Rafa quiere que el bot de Shelly no se encierre sobre una
  baldosa que ya tiembla): `isWarningAt(x, z)` en `Arena` y en `ArenaSim`.
