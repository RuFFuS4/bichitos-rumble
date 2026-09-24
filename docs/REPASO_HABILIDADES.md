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
11. **Golpe de las J online** (opcional).
    - Evento nuevo `rushHit { attacker, victim, nx, nz }` en el roce
      normal, si el que embiste tiene un charge_rush activo y la víctima
      no está ya en el Set de esa activación.
    - Su manejador en `game.ts` llama a `applyImpactFeedback`, con sonido
      y shake.
12. **Despliegue**. `server/src/sim/*` cambia lo que deciden los bots
    online, sin tocar la firma de `computeBotInput`, y la compuerta del
    ancla de Shelly. Sale con este lote.

## Pendiente en tierra de nadie (con permiso de Rafa)

- `src/frame-ticks.ts`:
  - mientras un bicho cae no se pintan sus iconos de estado;
  - el 👻 de Mirror Trick solo para la Kurama local (hoy la delata);
  - `isInsideZoneOfKind(…, c.config.name)` en los iconos de veneno,
    arena y hielo.
- `src/main.ts:414`: `isInsideZoneOfKind(localPos.x, localPos.z,
  'poison', localPos.critterName)`. La nube de Kermit no le ciega a él.
- `src/game.ts`:
  - ~2099: mover `playerWasFalling` antes de `updatePlayer`, para que la
    caída por fallo del All-in cuente en las estadísticas;
  - opcional: pasar `scene` a `updateBot`;
  - opcional: `setArenaForAbilities` en el constructor de `Game`.
- `src/tools/dev-api.ts`: registrar el flanco de `lHoldCharging` como
  `ability_cast`/`ability_end`. Hoy el All-in no sale en las grabaciones
  ni en los usos/min.
- `src/tools/sidebar.ts:1424` («Reset defs»): leer el kit
  (`CRITTER_ABILITIES`) y no `state.def`, que durante un Copycat es la
  copia.

## Pendiente para INTERFAZ y ARENA

- **INTERFAZ**:
  - textos de estado: `status-vulnerable-desc` dice «el doble» y son ×4;
    `status-frozen-desc` debe cubrir la bola y el hielo;
  - opcional: la J de Shelly se pinta bloqueada mientras está anclada.
- **ARENA**: `getLayout()` de solo lectura en `ArenaSim`, para el punto 9
  de DISTRIBUCIÓN.
