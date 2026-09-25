# Ability QA Checklist — Candidate Final v0.11

Status legend:
- `[ ]` pendiente — sin implementar
- `[~]` implementado, falta validación de Rafa
- `[x]` validado por Rafa
- `[!]` problema detectado / requiere ajuste / NO se cierra antes de la entrega
- `[~⚠]` implementado con simplificación documentada (versión fiel al espíritu, no idéntica al diseño)

Last updated: v0.11 + K-session 1 + K-refinement + final-K-polish + 2026-04-30 final-L + 2026-04-30 final-polish + 2026-05-01 microfixes + 2026-05-01 BLOQUE FINAL (deadline-day) + 2026-08-16 H0 doc-sync.
Use `git log --grep abilities` to see the commit trail behind each item.

> **2026-08-16 — consolidated during H0 doc-sync; body statuses reconciled with header passes.**
> Las secciones per-critter de abajo se escribieron en la era v0.11 y varios items `[!] NO implementado` SÍ se implementaron después, en los passes de 2026-04-30 (final-L / final-polish) y 2026-05-01 (microfixes / BLOQUE FINAL) descritos en el header. Esos items pasan a `[~]`/`[~⚠]` con nota "(shipped … — see header)"; su texto histórico se conserva tal cual. La lista final "Pending [!]" se ha reescrito para reflejar solo lo genuinamente abierto.

> **2026-09-24 — repaso de habilidades, grupo G1 (inmunidad y arreglos pequeños). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Inmunidad offline = servidor.** Las K radiales y de cono, el Grip (ahora agarra al siguiente no inmune), el impacto de Shadow Step y el tirón del Sinkhole saltan a los inmunes y a los que caen. Steel Shell, Mirror Trick y la inmunidad de reaparición ya no se empujan offline (Shockwave sobre un inmune: 1,59 u → 0; Trunk Slam sobre Steel Shell: 1,63 u → 0).
> - **Trunk Grip**: el aturdido usa `Math.max` (no acorta uno más largo) y la inclinación del impacto sigue el desplazamiento real del tirón, con −facing de respaldo si apenas se mueve.
> - **Shelly**: con Steel Shell activo o cargando no arranca ninguna J ni blink, y al disparar el escudo se cancela la J en curso (cliente y `server/src/sim`). *(Desde el grupo H6 de la fase 2, la J se corta ya al pulsar K, y Shelly frena en seco.)*
> - **Cheeto Cone Pulse**: `pulseCount: 6`. El fotograma en que expira la L cuenta como tiempo de canal, así que el sexto pulso (×8) sale a cualquier dt (antes se perdía a 75 y 95 Hz). Copycat copia el campo: la Kurama que copia queda en 6 pulsos (antes 11).
> - **Kowalski Frozen Floor**: `cancelAnimOnEnd`. Ya no se queda con la pose de la ulti en bucle.
> - **Animación**: el final de una ranura con `cancelAnimOnEnd` solo corta su propio clip. Una J que acaba bajo la K ya no le corta la pose a la K.
> - Online falta la mitad de Cone Pulse en `BrawlRoom` (tope de `pulseCount` + tick de expiración), aviso a DISTRIBUCIÓN.

> **2026-09-24 — repaso de habilidades, grupo G2 (caída, reaparición y All-in). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Caer corta todo lo que estaba en marcha** (`Critter.startFalling` y `startFalling` de `server/src/sim/physics.ts`): las habilidades activas acaban con su cooldown empezado, la carga del All-in se suelta sin gastar cooldown, y se apagan el fantasma de Mirror Trick y el tinte de Steel Shell. Antes Cone Pulse seguía activa al reaparecer y el All-in del bot se resolvía desde el punto de reaparición.
> - **Mientras cae, el jugador no manda nada**: una K pulsada en el vacío ya no se dispara al reaparecer, y Sebastian ya no puede lanzar el All-in cayendo (antes eliminaba al que lo tiró).
> - **Reaparecer limpia aturdido, confusión y ralentización** (antes sobrevivían: 3 s de aturdido o de controles invertidos seguían al volver).
> - **All-in**: solo cuenta a quien está por delante (antes eliminaba al que tocaba su espalda). El pasillo sigue igual de ancho (`FEEL.allIn.hitMargin` 0,55). Si falla, Sebastian recorre su línea en pasos de `FEEL.allIn.missProbeStep` (0,5 u) hasta el primer punto fuera de la arena y cae allí, aunque sea inmune. Antes, disparando desde el borde hacia el centro, aterrizaba dentro (escape gratis), y recién reaparecido flotaba 1,45 s sobre el vacío. Ya no hay ×1,5 ni `allInMissSelfForce` en el cliente.
> - Online, la reaparición, el golpe del All-in y su fallo viven en `BrawlRoom`: aviso a DISTRIBUCIÓN (valores ya en `SIM.allIn`).

> **2026-09-24 — repaso de habilidades, grupo G3 (hit stop y sierra). `[~]`, pendiente de golden y de validación de Rafa:**
> - **El hit stop congela también lo que corre fuera de `game.update`**: las mecánicas de la L (sierra, toque, embestida, Cone Pulse, tirón del Sinkhole), las bolas de nieve y la vida de las zonas. `gamefeel.applyHitStop` marca el paso congelado y cada tick lee la marca con su `createFrozenFrameGate()`; la marca no se queda pegada al pausar, en el título ni online, donde esos ticks siguen corriendo. Medido: la bola ya no avanza en los 7 pasos de un hit stop de 0,1 s (antes avanzaba en los 7), la nube de Kermit dura 600 pasos de juego (antes perdía los 31 congelados) y un pulso de Cone Pulse ya no sale con el mundo parado.
> - **Sierra, embestida y toque tóxico golpean una vez por contacto**: enfriamiento por pareja atacante→víctima de `FEEL.abilities.contactRehitCooldown` (0,3 s; en FEEL y no en la definición por el Copycat). La sierra FIJA la velocidad de lanzamiento en vez de sumarla. Antes una víctima pegada recibía +90 u/s en cada fotograma y, con un hit stop de otro golpe, llegaba a 1260 u/s y a un salto de 21 u en un paso; ahora sale a 90 u/s y el salto máximo es 1,5 u. Con la víctima pegada, 4 golpes por segundo en vez de 60, y la confusión del toque se renueva cada 0,3 s (mínimo 2,7 s) en vez de cada fotograma.
> - Online, las pasadas de contacto viven en `BrawlRoom`: aviso a DISTRIBUCIÓN (helpers `ageContactRehit`/`takeContactHit` y `SIM.abilities` ya en `server/src/sim`). El servidor no tiene hit stop.
> - **El anillo de cada zona va con el reloj de su zona** (revisión del diff). `spawnZoneRing` recibe la edad de la zona (`pushOfflineZone` en `abilities-runtime.ts`): el hit stop y la pausa paran los dos, y el anillo se va cuando la zona caduca o se limpia. Antes seguía con `performance.now()` y, con un hit stop cada 0,4 s, la nube de Kermit envenenaba 3,2 s sin anillo visible (sonda `.tmp/abil-fix/review/zone-ring.mjs`: +3179 ms, ahora −18 ms, un fotograma). Lo mismo con las arenas de Sihans, el Sinkhole y el hielo (−18 a −21 ms, `.tmp/abil-fix/review-fix/zone-ring-all.mjs`). Al reiniciar, el anillo se va en el fotograma siguiente; antes se quedaba. Online no cambia: el anillo de una zona del servidor sigue con el reloj de pared.

> **2026-09-24 — repaso de habilidades, grupo G4 (Copycat). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Copycat ya no escribe en la definición compartida.** Antes el `Object.assign` caía sobre `CRITTER_ABILITIES.Kurama[2]` (y en el servidor sobre el kit del módulo, compartido por todas las salas): lo último copiado se quedaba para siempre, también en partidas nuevas y sin objetivo. Ahora cada lanzamiento usa su propia copia (`{ ...L de Kurama, ...COPYCAT_KEYS del objetivo }`) y la definición del kit vuelve en el primer tick en que la L ya no está activa, un tick tarde a propósito para que Cone Pulse cierre su último pulso y su detector de flanco. El afinador de la barra lateral sigue editando el objeto del kit y lo afinado llega a la siguiente copia.
> - **Lista única `COPYCAT_KEYS`** (`src/abilities.ts`, espejo en `server/src/sim/abilities.ts`). Un campo nuevo de una L que deba copiarse va ahí; si no debe copiarse, en FEEL/SIM.
> - **Copiar a Sebastian da solo el buff.** El All-in copiado se resolvía al acabar los 3,5 s de Kurama desde donde estuviera: si fallaba, Kurama caía (x −2,6 → 13,07, una vida menos); si acertaba, echaba seguro al objetivo (Sergei a x 6,4 cayendo). Choca con la hoja («realizar la ULTI del último enemigo»): la variante segura la decide Rafa.
> - **El objetivo se consume siempre.** En el servidor, copiar Frozen Floor o Sinkhole salía antes de vaciar `lastHitTargetCritter` y se podía repetir sin golpe nuevo.
> - Medido (sonda `.tmp/abil-fix/g4`): copia de Sebastian sin nadie delante 0 u de desplazamiento y 0 caídas (antes 15,7 u y una vida); partida nueva sin objetivo, igual; dos Cone Pulse copiados seguidos, los dos con 5 empujones y 10,03 u. Emulando la copia antigua sobre el código nuevo salen los mismos números de Cone Pulse y sierra, así que solo cambia de dónde sale la copia.
> - Online, las pasadas de la L en `BrawlRoom` tienen que leer `getLDef(p)` en vez de `getAbilityKit(p.critterName)[2]`: aviso a DISTRIBUCIÓN. Hasta entonces, online, copiar a Shelly, Cheeto o Kermit da solo el buff (las zonas de Kowalski y Sihans sí salen). **Bloquea el despliegue**: el `server/src/sim` de esta rama no puede salir sin ese cambio de `BrawlRoom` en el mismo despliegue (en HEAD el sim escribía la copia en el kit y `BrawlRoom` la leía de ahí; ahora ya no la escribe).

> **2026-09-24 — repaso de habilidades, grupo G5 (suelo: Sinkhole, aterrizajes y nube). `[~]`, pendiente de golden y de validación de Rafa:**
> - **El laboratorio conecta la arena** (`setArenaForAbilities(game.arena)` en `src/tools/main.ts`, como `main.ts`). Hasta ahora el Sinkhole no abría agujero en ninguna hoja, tanda ni golden. Medido: la L desde (−2,6, 1,2) deja 28 fragmentos de 30 y Sergei cae (antes 30 → 30). El golden cambia por esto.
> - **El Sinkhole ya no se come la baldosa de Sihans.** Se salvan los fragmentos que contienen su posición (`pointInFragment` sobre `getLayout()`, que se añade a `ArenaForAbilities`). En 1000 poses aleatorias por el camino real, su propia baldosa desaparecía en el 15,5 % y ahora en el 0 %. Efecto secundario: un enemigo que pise esa baldosa tampoco cae, y en el 6,5 % de los lanzamientos la única baldosa candidata era la suya, así que no se abre agujero (863 → 798 de 1000). Copycat sigue el mismo camino.
> - **Aterrizajes sobre suelo vivo** (`pickSafeLanding`, cliente y `server/src/sim`). Sand Trap y Shadow Step: tras el recorte a 11,6 u, el destino retrocede hacia el origen en pasos de `FEEL.blink.landingProbeStep` (0,5 u) hasta pisar suelo; si no lo hay, se queda en el origen y la zona de arenas se suelta igual. Mirror Trick prueba `decoyEscapeFallbacks: [1, 0.7, 0.4]` de la línea de huida y, si nada vale, se queda junto al señuelo. Medido: Sand Trap hacia un sector hundido acaba en x 1,9 sobre suelo (antes caía en x 3,9 y perdía una vida); Mirror Trick sobre un hueco acaba al 40 % y no cae al acabar la inmunidad (antes anduvo sobre el vacío y cayó a los 2,8 s). En el servidor, con una ArenaSim real, 408 de 2730 aterrizajes caían en el vacío y ahora 0.
> - **La nube de Kermit no ciega a Kermit**: `isInsideZoneOfKind(x, z, kind, ownerKey?)` se salta las zonas del dueño, como `getZoneSlowMultiplier`. Falta la línea de `main.ts` que le pasa `localPos.critterName` (tierra de nadie); hasta entonces la viñeta sigue saliendo. `Critter.updateVisuals` ya la usa: el tinte ámbar de «atrapado en arena» se salta por dueño de la zona y no por el nombre `'Sihans'`. Una Kurama con el Sinkhole copiado ya no se tiñe en su propio agujero, y una Sihans dentro del de Kurama sí (sonda `.tmp/abil-fix/review-fix/sand-tint.mjs`, 60 fotogramas: Kurama teñida en 60 → 0 y Sihans en 0 → 59).
> - Online: `BrawlRoom` tiene que pasar `(x, z) => this.arenaSim.isOnArena(x, z)` a `tickPlayerAbilities` y filtrar la baldosa del lanzador en el Sinkhole (esto último necesita que `ArenaSim` exponga el layout). Aviso a DISTRIBUCIÓN y ARENA. Sin eso, online todo sigue como antes.

> **2026-09-24 — repaso de habilidades, grupo G6 (hielo de Kowalski). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Offline el hielo ya quita agarre, como online.** El cliente solo multiplicaba la fricción (×5); la aceleración ×0,35 que piden el diseño y el servidor no existía offline. Los dos valores pasan a la definición de Frozen Floor (`floorFrictionMult: 5`, `floorAccelMult: 0.35`, cliente y kit de `server/src/sim`) y a `COPYCAT_KEYS`, así que la Kurama que copia el hielo lo copia igual. La zona los lleva (`slippery: { frictionMult, accelMult }`) y `getSlipperyZone()` sustituye a `isOnSlipperyZone`: `critter.ts` multiplica la vida media de la fricción y `player.ts`/`bot.ts` la aceleración, antes de calcular `moveAccel`.
> - Medido paso a paso (`.tmp/abil-fix/G6/ice-probe.mjs`): en el hielo, el jugador que arranca desde parado va a 1,43 u/s a los 10 pasos (antes 4,08; fuera del hielo 2,34) y el bot a 1,23 (antes 3,52). Al soltar sigue deslizando igual (0,33 u/s a los 30 pasos). El dueño no resbala y la copia de Kurama sale con 5 / 0,35.
> - Tanda A/B con el mismo código y solo `floorAccelMult` 1 frente a 0,35 (16 partidas, semillas 900-915, `.tmp/abil-fix/G6/ab-probe.mjs`): Kowalski cae 2,31/min frente a 2,68 y gana 11 de 16 frente a 8. Los enemigos van más lentos en el hielo (mediana 3,6 u/s frente a 6,6; p90 igual, ~16, porque eso son golpes), pero no caen menos: 10,7 caídas por minuto de enemigo en el hielo frente a 9,6. Como dijo el revisor: la ulti no queda más floja; Kowalski sale más fuerte porque ya no le persiguen patinando. No hay que subir `floorAccelMult` por esto.
> - Online no cambia: `BrawlRoom` sigue con su ×0,35 y su ×5 escritos a mano (los mismos valores). Aviso a DISTRIBUCIÓN para que lea `getSlipperyZone()`; hasta entonces `isOnSlipperyZone` queda en `server/src/sim/physics.ts` como puente.

> **2026-09-24 — repaso de habilidades, grupo G7 (lo visual: Mirror Trick, velocidades de clip y contacto de las J). `[~]`, pendiente de golden y de validación de Rafa. Solo cambia lo que se ve: las 27 filas de `ability-shots` (empujones, distancias, estados) salen idénticas antes y después.**
> - **Mirror Trick se ve como pidió Rafa.** En `Critter.updateVisuals` la invisibilidad va antes que el parpadeo de inmunidad. El truco escribe los dos temporizadores y desde 69e7609 ganaba el parpadeo: la Kurama real salía blanca y opaca, y el alfa 0,08 del 2026-05-01 no se llegó a pintar nunca. Ahora se queda en `FEEL.decoy.ghostAlpha` (0,08). El señuelo es un clon opaco, sin brillo y con contorno, hasta el 70 % de su vida (`FEEL.decoy.fadeFrom`), y en el resto se funde; antes era violeta, al 0,4 y sin contorno. Su vida va con el reloj del juego (la avanza `Critter.update`, así que la pausa, el hit stop y el paso fijo la paran) y se va con Kurama si cae o se destruye; antes iba por `performance.now()`. El anillo de activación sale donde se lanzó el truco, bajo el señuelo, y no en la llegada. En la llegada quedan 2 nubes de polvo (`FEEL.decoy.arrivalPuffs`) en vez de 6.
> - **Steel Shell ya no parece un fantasma.** Con un K de autobuff activo (`selfBuffOnly`) no se aplica el parpadeo de la reaparición: Shelly se queda opaca, con contorno y con el tinte metálico. Ningún K de autobuff pinta ya el rojo del golpe de ground_pound.
> - Medido con `.tmp/abil-fix/g7/mirror-probe.mjs` (pasos de 1/60 s). Kurama: su opacidad era {1; 0,15} con emisivo blanco o rojo; ahora es 0,08 fija los 168 pasos del truco. El señuelo: antes 70 pasos translúcido, ahora 167 (116 opaco con contorno y el resto fundiéndose). El anillo: antes en (−9,6; 1,2), la llegada; ahora en (−2,6; 1,2), el sitio del señuelo. Shelly: su opacidad era {1; 0,15}; ahora es 1 en los 187 pasos del escudo, con el contorno puesto.
> - **Las velocidades de clip de `ANIMATION_OVERRIDES` llegan al juego.** `critter.ts` pasa `timeScale: def.clipPlaybackRate` sin `?? 1`, así que manda la velocidad del override (la que se afina en anim-lab) salvo que la definición fije una. Desde 47728db todas corrían a 1× en partida. Cambian 17 clips de los 9 bichos (sonda `.tmp/abil-fix/g7/clip-probe.mjs`, velocidad efectiva): Sergei K 1,5 y L 2; Trunk L 3; Kurama J 1,9, K 1,3 y L 1,5; Shelly L 10 (en bucle); Kermit J 2; Sihans J 3 y L 1,5; Kowalski J 3,5, K 2 y L 1,8 (en bucle); Cheeto J 2,3, K 2 y L 1,7; Sebastian K 1,3. No cambian los que fijan `clipPlaybackRate` (Sergei J 2,3, Trunk J 4,5 y K 2,8) ni los que no tienen `speed`. Las ventanas de las habilidades son las mismas y ningún clip se queda enganchado: 1 s después de cada habilidad, todos están en reposo. Antes, la L de Cheeto seguía en su clip.
> - **Las J golpean en pantalla** (`rushContactFeedback` en `src/physics.ts`). En el primer contacto de cada víctima por activación (`AbilityState.rammed`) salen `applyImpactFeedback` con dirección, el sonido `headbuttHit` y el shake `FEEL.shake.chargeRush`. No hay hit stop y el empujón sigue siendo el roce normal. Con `.tmp/abil-fix/g7/rush-probe.mjs` y dos J seguidas: 2 destellos en el muñeco cercano en los 9 bichos (antes 0) y las mismas posiciones finales. `rammed` se vacía cuando la J dispara (`fireEffect`) y no al activarla, así que la J que fuerza el laboratorio (`forceAbility`, que no pasa por `activateAbility`) también se nota la segunda vez (sonda `.tmp/abil-fix/review/rush-force.mjs`: destellos [8] → [8, 73]).
> - Hojas y vídeos de antes y después de las 27 habilidades en `.tmp/abil-fix/g7/pre` y `.tmp/abil-fix/g7/post`.
> - **Para Rafa:**
>   - La L de Shelly a 10× en bucle, sumada al giro de 22 rad/s, se ve como un aleteo frenético (`.tmp/abil-fix/g7/strips/shelly-L-post.png`, 16 fotogramas seguidos). Hay que juzgarlo en `post/shelly-L.mp4`.
>   - La L de Sergei a 2× (su ajuste del lab) acaba el clip a 1,3 s y pasa el resto del frenesí en reposo; a 1× el clip llenaba la ventana. Las dos capturas están en `pre/` y `post/sergei-L.mp4`.
>   - La Kowalski L a 1,8× se ve bien.
> - Online no cambia (el servidor resuelve los choques y el evento del truco). Pendientes: el contacto de las J online (DISTRIBUCIÓN) y el 👻 de `decoy-ghost`, que hoy delata a la Kurama real ante todos (`frame-ticks.ts`, tierra de nadie).

> **2026-09-24 — repaso de habilidades, grupo G8 (IA de los bots). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Los bots lanzan las tres habilidades que nunca salían.** `src/bot.ts` se queda con la primera habilidad de cada etiqueta: Trunk Grip heredaba `'aoe_push'` y la tapaba Trunk Slam; Sand Trap y Shadow Step llevaban `'mobility'` y las tapaba la J (0 lanzamientos en 72 grabaciones). Ahora llevan etiqueta propia y, dentro de ella, el bot mira la forma de la definición:
>   - Trunk Grip (`'targeted'`, `gripK`): alguien a quien el agarre cogería ya (`findGripTarget`, la misma geometría que la habilidad), a más de `FEEL.bots.targetedMinRange` (3 u) y a menos de `gripMaxRange` (10 u; la definición llega a 28, más que el diámetro de la arena). Tasa `grip` 0,5/s.
>   - Shadow Step (`'targeted'`, `blinkSeekNearest`): el enemigo más cercano, no inmune, entre 3 u y `blinkSeekRange`, y solo si el empujón al aterrizar (lanzador → objetivo) apunta hacia fuera en el objetivo. Tasa `blinkSeek` 0,702/s.
>   - Sand Trap (`'utility'`, `zoneAtOrigin`): el enemigo más cercano dentro de `zone.radius × trapRadiusFrac` (2,8 u) y el aterrizaje por la mirada sobre suelo vivo. Tasa `trap` 0,596/s.
>   - Ninguna J ni ningún blink empieza con otra J o blink activa: el segundo saldría desde donde lo deja el primero, no desde donde miró el bot.
> - **All-in de Sebastian** (`'risky'`; como `'buff'` se lanzaba con alguien a 3,5 u en cualquier dirección y se resolvía a ciegas al segundo). El bot usa la carga y suelta del jugador (`startSebastianAllInCharge` / `releaseSebastianAllInCharge`). Carga solo si la geometría real de acierto (`findAllInTarget`, compartida con la resolución) ya pilla a alguien con el pasillo estrechado `allInLaneInset` (0,4 u), y nunca encima de otra habilidad activa. Mantiene `allInReactionSec` (0,5 s: lo que dura la línea roja) y al soltar vuelve a mirar el pasillo entero: si hay alguien, resuelve; si no, suelta la carga sin gastar el cooldown (`cancelSebastianAllInCharge`).
> - **Sonda del dash por la mirada**: antes de cualquier J, los puntos a `dashProbeNear` (1 u) y `dashProbeFar` (3 u) por la mirada tienen que ser suelo vivo.
> - **Puntería**: Snowball solo con el objetivo a ±`rangedAimDeg` (35°) de la mirada; Claw Wave dentro de su cono (±60°); Cone Pulse dentro del suyo (±45°); Frozen Floor con al menos min(2, rivales vivos) a menos de `floorRadius × floorCastRadiusFrac` (4,8 u); Shelly no se encierra ante una carga con su L activa (sí por presión de borde) ni lanza la L anclada o cargando el escudo.
> - **Radiales que empujan** (radio y fuerza, sin autobuff): dos enemigos empujables (no inmunes) dentro de min(radio, `nearbyRadius` 4 u), o uno solo, empujable, a menos de `radialSoloFrac` (0,7) de ese radio. Mirror Trick sigue con «rodeado» (≥ 2 a 4 u).
> - Todo en `FEEL.bots`; lo que existe online (J y K) tiene espejo en `SIM.bots` y `server/src/sim/bot.ts`, con filas nuevas en `feel-sim-parity` y casos en `server-bot.test.ts`. Lo de las L es solo offline: online los bots no lanzan ninguna L (`ultimate = false`).
> - Medido con 8 partidas × 5 bichos (Sergei, Trunk, Sihans, Cheeto y Sebastian, semillas de `.tmp/facing-audit`), antes con el código de G1-G7 (`.tmp/abil-fix/g8/pre`) y después (`post2`), resumen con `.tmp/abil-fix/g8/summarize.mjs`:
>   - Trunk Grip 0 → 2,67 usos/min; Sand Trap 0 → 3,93; Shadow Step 0 → 5,00.
>   - All-in: 34 resoluciones (21 aciertos y 13 autocaídas) → 40 (40 aciertos y 0 autocaídas). Sebastian cae 3,51 → 2,78/min y queda eliminado en el 94 % → 69 %.
>   - Shockwave 2,01 → 4,59/min. Snowball 6,13 → 4,95/min.
>   - Caídas en los 0,25 s tras la propia J, por cada 100 J: Sihans 2,8 → 0, Sergei 3 → 1,4, Trunk 2 → 1,5, Cheeto 2 → 1, Sebastian 2,1 → 0.
> - Sonda de lo que ve cada bot al lanzar (`.tmp/abil-fix/g8/gates-probe.mjs`, 12 partidas, antes en 5182 y después en 5181): Snowball a más de 35° 6/50 → 0/41 (de espaldas 4 → 0); Claw Wave fuera del cono 8/37 → 0/48; Cone Pulse 1/13 → 0/9; Frozen Floor sin min(2, …) 13/20 → 0/13; sierra encerrada 3/10 → 0/7; escudo con la sierra puesta 3/15 → 0/13; Shockwave en 1v1 0/20 → 5/31, y ninguna con cero empujables dentro; J con la sonda en el vacío 6/388 → 0/316; Sand Trap y Shadow Step sin ningún caso fuera de su regla; All-in: 26 cargas, 23 sueltas (todas aciertan) y 3 canceladas.
> - `findAllInTarget` y `findGripTarget` salen tal cual de `fireAllInResolution` y de la rama del agarre: en 20 000 disposiciones aleatorias dan el mismo objetivo que los bucles antiguos (`.tmp/abil-fix/g8/refactor-equiv.mjs`), y `ability-shots` de Trunk L sale idéntica a la de G7.
> - **Para Rafa:**
>   - El bot de Sebastian ya no se suicida, pero ahora cada All-in que suelta es una eliminación (40 de 40), unas 2,8 por minuto. Se afina con `FEEL.bots.allInReactionSec`, `allInLaneInset` y `fireRatesPerSec.risky`. Va con la decisión pendiente de la carga mínima del All-in.
>   - Trunk Slam entra en la regla radial genérica y sale con un solo rival a menos de 2,8 u: 2,16 → 4,39 usos/min. Trunk cae 2,07 → 2,29/min y sigue eliminado en el 42 %. La regla propia del Slam (radio entre 4 y 5,6 u, basta un rival porque aturde) queda para cuando se vuelva a medir a Trunk.
>   - Sihans cae algo más (2,72 → 3,05/min). Las caídas en los 2 s siguientes a Sand Trap (11 de 83) están en su tasa base.
>   - Los bots confundidos por Toxic Touch no se han tocado: esa propuesta revisa la decisión del 2026-08-21.
> - Online: los cambios de J y K viven en `server/src/sim/bot.ts` y salen con el despliegue del servidor; `BrawlRoom` no cambia. La grabación del laboratorio solo ve el flanco de `active`, y el All-in por carga no lo tiene: desaparece de `ability_cast` (y del golden) hasta que `dev-api.ts` registre `lHoldCharging` (tierra de nadie).

> **2026-09-24 — repaso de habilidades, fase 2, grupo H1 (golpe de dash en las J; decisiones 2 y 7 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Las J golpean** (`dashHitForce` en la definición de la J; sin él, el roce de siempre). En el primer contacto de cada víctima por activación (el mismo `AbilityState.rammed` del feedback de G7, ahora `rushContact` en `src/physics.ts`) la víctima recibe el golpe encima del roce, repartido por masas y ×4 si está aturdida, como un cabezazo; el que embiste no retrocede. Hit stop corto solo si hay fuerza (`FEEL.hitStop.dashHit` 0,03 s, frente a los 0,07 del cabezazo). Valores:
>   - Sergei 22 (rango 22-25): la víctima sale a 19,6 u/s como mucho, aunque sea Kermit, por debajo del tope de 20 u/s al que llega cualquier cabezazo. Con 24, contra Kermit pasaba a 21,2.
>   - Shelly 30 (Shell Charge, decisión 7) y Cheeto 30.
>   - Sebastian 26, solo a quien tiene a ±60° de su mirada (`dashHitArcDeg`, el cono de su Claw Wave). Fuera del cono es el roce y la víctima no se gasta.
>   - Trunk, Kermit, Sihans y Kowalski siguen sin fuerza (solo el feedback de G7).
> - **Kurama atraviesa** (`dashPhaseThrough`): mientras dura Fox Dash no hay separación, empujón ni golpe con ningún bicho, en ninguno de los dos sentidos (un cabezazo tampoco la toca). La descripción pasa a «Blink-fast feint through enemies» / «Finta relámpago que atraviesa a los rivales».
> - **Inmunes y anclados**: a un inmune no le hace nada. Contra Steel Shell, el golpe vuelve al que embiste × `shellReflectFactor` (0,85), una vez por activación, como el cabezazo; después, el rebote de siempre.
> - **Online**: el espejo está en `server/src/sim/physics.ts` (`resolveCollisions`) y en `takeDashContact` / `activeDashDef` de `server/src/sim/abilities.ts`, con los mismos valores en el kit y filas en `ability-kit-parity` (las 9 J comparan los tres campos, también cuando no están). El empujón sale con el despliegue del servidor. El feedback online necesita `BrawlRoom` (DISTRIBUCIÓN: `resolveCollisions` ya devuelve los golpes en `dashHitsOut`) y su manejador en `game.ts` (tierra de nadie).
> - Medido con pasos de 1/60 s, muñeco quieto a 1,8 u (Sihans, masa 1), sin mover el stick (`.tmp/fase2/h1/probe-*.txt`; el cabezazo, a 1,25 u, es la referencia). Velocidad de salida y distancia, antes → después:
>   - Sergei: 4,4 u/s y 0,45 u → 17,2 u/s y 0,89 u. Su cabezazo: 34,3 u/s y 1,62 u. Contra Kermit, 19,6 u/s y 1,02 u frente a 42,9 u/s y 1,76 u.
>   - Cheeto: 3,1 u/s y 0,43 u → 16,2 u/s y 0,93 u (cabezazo: 1,58 u).
>   - Sebastian: 3,7 u/s y 0,51 u → 16,7 u/s y 0,97 u (cabezazo: 1,72 u). Con el muñeco a 58° de su línea golpea (16,7 u/s); a 75°, roce (1,7 u/s). Cheeto, sin cono, golpea a 73°.
>   - Shelly: 2,5 u/s y 0,13 u → 27 u/s y 1,40 u (cabezazo: 1,67 u).
>   - Kurama, corriendo: el muñeco se movía 1,61 u y ahora 0,07 u; ella recorre 6,39 u en vez de 2,88.
>   - Contra Steel Shell, lo que avanza el que embiste: Sergei 0,61 → 0,33 u, Cheeto 0,68 → 0,09 u. Contra un aturdido, la J de Sergei: 13,9 → 68,8 u/s.
>   - `ability-shots` (muñeco cercano): Sergei 0,42 → 0,84 u, Cheeto 0,29 → 0,93, Sebastian 0,34 → 0,97, Shelly 0,13 → 1,31. Hojas en `.tmp/fase2/h1/antes` y `despues` (con vídeo).
> - Tanda de bots, 8 partidas por bicho con las semillas de referencia (la de 5182 reproduce exacta la de `.tmp/fix-audit`; resumen en `.tmp/fase2/h1/batch-summary.txt`). Caídas de los rivales por minuto, antes → después: Sergei 6,53 → 7,23; Sebastian 6,28 → 7,14; Shelly 6,31 → 6,07 (ella cae menos: 3,36 → 2,73); Cheeto 8,50 → 8,20 (él cae más: 2,47 → 3,13); Kurama 6,21 → 6,09 (ella igual, 2,00). Ninguna partida falla. Con 8 partidas por bicho es una tendencia, no una medida del equilibrio.
> - **Para Rafa:**
>   - Shelly empuja con la J el 84 % de lo que empuja con su cabezazo (1,40 frente a 1,67 u): con 30 y su masa de carga (×3,2), las dos pasan del tope de 20 u/s. Con 20 se quedaría por debajo contra un rival de masa 1 (18,8 u/s).
>   - Si Kurama acaba el dash encima de alguien (sin mover el stick recorre 1 u), al terminar se separan de golpe: el muñeco sale a 5,3 u/s y 0,27 u.
>   - Atravesar también la hace intocable los 0,26 s del dash: un cabezazo que la pille entonces la atraviesa.
>   - Lo de si el golpe alimenta Copycat no aplica: Kurama atraviesa, así que su J no golpea nunca. El golpe de dash tampoco cuenta como cabezazo recibido (el cinturón Pain Tolerance habla de cabezazos) ni da el crédito de la eliminación online, como el resto de habilidades.

> **2026-09-24 — repaso de habilidades, fase 2, grupo H2 (el aturdido no actúa; decisión 3 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Mientras `stunTimer > 0` no arranca ninguna acción:** ni cabezazo (`Critter.startHeadbutt`), ni J, K o L (`activateAbility` en el cliente; `tickPlayerAbilities` en `server/src/sim`), ni la carga del All-in (`startSebastianAllInCharge`). Moverse ya estaba bloqueado (`effectiveSpeed` 0) y no cambia. Vale para los dos aturdidos, el del Grip y el del Slam (1,5 s en radio 7).
> - **Lo lanzado antes del aturdido sigue su curso:** una K que estaba cargando dispara aunque ya esté aturdido, una L en marcha sigue (Saw Shell sierra, el frenesí dura) y un dash en vuelo acaba.
> - **La carga del All-in es la excepción:** soltarla es la acción, así que el aturdido la suelta sin dash ni cooldown, como una caída. Lo hace `stun()` de `abilities-runtime.ts`, que usan el Grip y el Slam. Con la tecla aún pulsada, la carga vuelve a empezar cuando acaba el aturdido.
> - **Bots:** el offline (`src/bot.ts`) y el online (`server/src/sim/bot.ts`) no tiran dados ni pulsan nada mientras están aturdidos; siguen orientados al objetivo. Test nuevo en `server-bot.test.ts`.
> - **Grip: aturdido 3,8 → 2,5 s** en el cliente y en el kit del servidor (fila en `ability-kit-parity`; centinela de `verify-ability-parity` a 2,5). Descripción: «Trunk pulls and stuns a target for 2.5 s — it takes ×4 from any hit» / «La trompa atrae y aturde a un rival 2,5 s — recibe ×4 de cualquier golpe», con la misma longitud en castellano que antes.
> - Medido con pasos de 1/60 s: Trunk a 4,2 u agarra al muñeco, que intenta actuar durante el aturdido (`.tmp/fase2/h2/probe-antes.txt` y `probe-despues.txt`). Antes → después:
>   - Jugador Sergei pulsando cabezazo, J, K y L: antes salen las cuatro y empuja a Trunk 2,25 u (pico 20 u/s); después ninguna, 0 u. El aturdido pasa de 4,0 a 2,6 s de juego (lo que sobra de 3,8 y 2,5 son los hit stops, que congelan el reloj).
>   - Jugador Kurama: antes Mirror Trick la sacaba 7 u de un paso; después se queda agarrada.
>   - Jugador Sebastian cargando el All-in desde antes del tirón y soltando ya aturdido: antes lanzaba a Trunk al vacío (220 u/s, cae); después la carga se suelta en el paso del tirón y Trunk no se mueve.
>   - Bots en modo agresivo pegados a Trunk: antes Sergei lanzaba la L y Shelly cabeceaba estando aturdidos; después, nada.
>   - Al acabar el aturdido todo responde (cabezazo, J y K en los pasos 280-310).
>   - Servidor: `tickPlayerAbilities` con las tres teclas pulsadas y aturdido no activa ninguna ranura en Sergei, Kurama, Shelly y Trunk; sin aturdido, las tres (`.tmp/fase2/h2/server-stun.test.ts`).
> - Tanda de Trunk, 8 partidas con la semilla 720. Para separar este grupo de H1 se repitió con las puertas del aturdido quitadas a mano (`.tmp/fase2/h2/solo-h1-batch-Trunk.json`). Solo H1 → H1 + H2: Trunk gana 5 → 4 de 8, cae 2,58 → 2,82/min; los rivales caen 9,17 → 8,78/min, cabecean 93,8 → 87,3/min y lanzan habilidades 35,1 → 30,4/min. Ninguna partida falla. Con 8 partidas es una tendencia: el bloqueo no hace más fuerte a Trunk, porque el Grip pierde 1,3 s.
> - Online faltan dos trozos en `BrawlRoom`: el arranque del cabezazo y el bucle del hold-to-fire (DISTRIBUCIÓN). Al soltar la carga por aturdido, la sala tiene que mandar también `lChargeEnd` (el mismo mensaje que la cancelación del bot de H8), y `game.ts` apagar la línea al recibirlo (tierra de nadie); sin eso, la línea se queda pintada hasta los 3 s de su vida. Hasta que llegue, un jugador aturdido online sigue cabeceando y cargando el All-in. El texto del estado «Aturdido» (i18n `status-stunned-desc`, hoy «No puede moverse durante un instante») es de INTERFAZ.
> - **Para Rafa:**
>   - El Slam también bloquea acciones 1,5 s a todos los que pilla en radio 7. Si resulta demasiado control, se puede bajar `slamStunDuration` o limitar el bloqueo al Grip (haría falta un campo aparte).
>   - Las L ya en marcha siguen durante el aturdido: en la prueba, la Saw Shell de Shelly, lanzada justo antes del tirón, empuja a Trunk 1,36 u (pico 26 u/s) estando ella aturdida. ¿Debe el aturdido cortarlas?

> **2026-09-24 — repaso de habilidades, fase 2, grupo H3 (frenesí de Sergei casi inamovible; decisión 4 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Campo `knockbackTakenMult` en la definición** (Sergei L: 0,4). Mientras la habilidad está activa (sin contar la carga, como la masa), todo empujón que recibe el bicho de otro va × ese valor. Un solo punto: `Critter.knockbackScale` en el cliente y `knockbackScale(player)` en `server/src/sim/abilities.ts`. La masa ×5,5 sigue: reparte el choque; el multiplicador llega a lo que la masa no tocaba y a lo que el tope de 20 u/s aplanaba.
> - **Lo que pasa por él:** cabezazo recibido y el retroceso del propio cabezazo, roce, golpe de dash (H1), reflejo y rebote de Steel Shell, las K radiales y de cono, el impacto de Shadow Step, el tirón del Grip (recorre 0,4 del camino, y el aturdido entra igual), la bola de nieve, Saw Shell, la embestida, Cone Pulse. **No pasan:** el golpe del All-in (echa fuera a quien pilla, decisión de Rafa del 2026-05-01) ni el tirón del Sinkhole (es una zona, no un golpe; tampoco la masa lo toca). El aturdido ×4 y el 0,4 se multiplican: ×1,6.
> - **Copycat lo copia** (`COPYCAT_KEYS` en los dos lados): la Kurama que copia a Sergei recibe × 0,4, con su propia velocidad y masa (×1,2).
> - Medido con pasos de 1/60 s en el laboratorio, 60 pasos, sin tocar el stick (`.tmp/fase2/h3/probe.mjs`; `antes.json` en 5182 y `despues.json` en 5181). Sin frenesí nada cambia. Con frenesí, antes → después:
>   - Cabezazo de Trunk: 1,54 → 0,62 u (sin frenesí, 2,57).
>   - Slam de Trunk a 2,5 u: 1,57 → 0,66 u. Claw Wave a 1,8 u: 1,65 → 0,76 u. Bola de Kowalski: 1,14 → 0,45 u. Saw Shell pegado: 2,54 → 1,64 u. Cone Pulse (1 s): 3,00 → 1,05 u.
>   - Grip desde 8 u: lo traía 6,4 u, hasta 1,6 u de Trunk; ahora 2,56 u y se queda a 5,44 u, aturdido.
>   - Su propio cabezazo a Trunk: retrocede 1,00 → 0,25 u (Trunk sale igual, 1,98 u).
>   - Kurama copiando a Sergei, cabezazo de Trunk: 2,60 → 1,66 u (copiando a nadie, 2,60).
>   - Servidor, con el mismo choque: Sergei sale a 30,1 → 12,0 u/s, su retroceso 24,0 → 9,6 u/s, el Grip lo deja a 5,44 u y la Kurama que lo copia pasa a × 0,4 al acabar la carga (`.tmp/fase2/h3/server-kb.test.ts`).
> - Tanda de Sergei, 8 partidas con la semilla 700, repetida con el multiplicador a 1 para aislar este grupo de H1 y H2 (`.tmp/fase2/h3/batch-Sergei-mult1.json` → `batch-Sergei.json`): Sergei cae 4,04 → 3,88/min, los rivales caen 6,23 → 7,43/min y eliminan 5 → 8; gana 0 de 8 en las dos. Ninguna partida falla. Tendencia, no medida.
> - Online, los empujones que viven en `BrawlRoom` (bola de nieve, Cone Pulse, sierra, embestida) necesitan leer `knockbackScale`: aviso a DISTRIBUCIÓN.
> - **Para Rafa:** el Grip a un Sergei en frenesí lo deja a medio camino (aturdido, pero lejos de la trompa). Si prefieres que el Grip lo traiga entero y solo resista los golpes, es quitar una línea.

> **2026-09-24 — repaso de habilidades, fase 2, grupo H4 (All-in con carga mínima y apuntando; decisión 5 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Carga mínima de 0,35 s** (`holdToFireMinMs: 350` en la definición de la L, junto a `holdToFireMaxMs`; el mismo valor en el kit del servidor, con fila en `ability-kit-parity`). Soltar antes no dispara al instante: el tajo sale en el paso en que se cumple el mínimo. Si se vuelve a pulsar L antes de eso, la carga sigue. La espera vive en `releaseSebastianAllInCharge`, que usan el jugador y el bot, así que nadie se la salta.
> - **Apuntar mientras carga.** Sebastian sigue enraizado, y la regla de «el facing sigue a la velocidad» no giraba nada. Ahora, mientras carga, `Critter.update` no toca el facing y `advanceAllInCharge` lo gira hacia el stick a `FEEL.allIn.aimTurnDegPerSec` (360°/s: 90° en 0,25 s, media vuelta en 0,5 s), por el lado corto. Sin stick mantiene la puntería. Confundido, el stick sale invertido, como todo lo demás.
> - **Por qué con tope de giro y no instantáneo:** la línea barre en vez de saltar, así que los demás la ven venir. Un giro instantáneo en el último paso dejaría la carga mínima sin tiempo de reacción. Con 360°/s, un toque con el stick girado 90° ya sale en la nueva dirección a los 0,35 s.
> - **La línea sigue la puntería**, y a Sebastian si lo empujan: `spawnAllInTrajectoryPreview` devuelve un handle con `aim` y `end`. Se apaga en 0,2 s al soltar, cancelar, aturdir o caer. Antes se quedaba pintada hasta 3 s después del tajo, y una carga empezada con el stick pulsado pintaba la línea hacia un lado y tajaba hacia otro.
> - **Bots:** misma vía, y respetan el mínimo por construcción. Hoy sueltan a los 0,5 s (`allInReactionSec`), por encima del mínimo, y no mueven el stick mientras cargan: sus partidas no cambian.
> - Medido con pasos de 1/60 s en el laboratorio (`.tmp/fase2/h4/allin-probe.mjs`: `antes.json` en 5182 y `despues.json` en 5181). Sebastian en el centro mirando a +X y un muñeco a 5 u. Antes → después:
>   - Toque de 2 pasos (33 ms), muñeco delante: se resolvía a los 0,033 s; ahora a los 0,35 s (paso 21). Elimina igual.
>   - Stick girado 90° y L soltada a los 0,75 s, muñeco a 90°: el facing se quedaba en +X, fallaba y Sebastian caía. Ahora el facing y la línea van juntos 90° → 66° → 36° → 6° → 0° (cada 5 pasos), el tajo sale hacia +Z y el muñeco cae.
>   - Toque con el stick girado 90° a la vez: la línea apuntaba a +X y el tajo salía hacia +Z. Ahora línea y tajo a 0°, a los 0,35 s.
>   - Media vuelta (stick 180°, muñeco detrás): fallaba y caía; ahora gira 180° en 0,5 s y lo elimina.
>   - L mantenida 1 s sin stick: igual antes y después (sale en el paso de soltar).
>   - La línea desaparece a los 0,19 s del tajo (antes, entre 0,6 y 2,9 s).
>   - Bot con `allInReactionSec` forzado a 0,1 s (`bot-probe.mjs`): resolvía a los 0,117 s; ahora a los 0,35 s. Con el 0,5 real, 0,517 s en los dos.
>   - `ability-shots` de Sebastian L con la L mantenida 45 pasos: idéntica. Con `--hold=2`: el muñeco cercano caía en el paso 2 y ahora en el 21. Hojas y vídeo en `.tmp/fase2/h4/{antes,despues}{,-tap}`.
> - Tanda de Sebastian, 8 partidas con la semilla 860 (`.tmp/fase2/h4/batch.json`): Sebastian cae 2,77/min y queda eliminado en 6 de 8; los rivales caen 6,79/min. No cambia nada respecto a H1-H3: los bots no giran ni sueltan antes de 0,35 s, así que la partida es la misma paso a paso.
> - Online, la máquina de carga está en `BrawlRoom`: aviso a DISTRIBUCIÓN (el mínimo con `lDef.holdToFireMinMs`, el giro con `SIM.allIn.aimTurnDegPerSec` y la dirección leída al soltar, no al empezar). Que la línea de los demás jugadores siga la puntería es de `game.ts` (tierra de nadie). Hasta entonces `holdToFireMinMs` del kit y `SIM.allIn.aimTurnDegPerSec` no tienen lector en la sala: sus filas de `ability-kit-parity` y `feel-sim-parity` fijan el valor, no la paridad online. Lo mismo `SIM.conePulse` (la sala escribe 1,4 y 2,0 a mano) y `frictionScale` (grupo H7).
> - **Para Rafa:**
>   - Apuntando, el All-in casi no falla. El roster corre a 2,3-5,3 u/s (Shelly a Kurama y Sihans; `.tmp/fase2/h4/speeds.mjs`), así que un rival que corre de lado a 5 u gira, visto desde Sebastian, 25-60°/s, muy por debajo de los 360°/s de la puntería. Solo lo salvan la distancia (más de ~10 u) o la inmunidad. Si se queda corto de riesgo, los mandos son `aimTurnDegPerSec` y `holdToFireMinMs`.
>   - Los bots no apuntan: si el pasillo se vacía, sueltan la carga sin gastarla. Hacer que sigan a su objetivo sería la misma vía que el jugador, pero su All-in acertaría casi siempre. ¿Lo quieres?

> **2026-09-24 — repaso de habilidades, fase 2, grupo H5 (Mirror Trick lejos del perseguidor; decisión 6 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **El salto de 7 u se aleja del enemigo vivo más cercano a menos de `decoyThreatRange` (10 u)**, campo nuevo en la definición de la K y en el kit del servidor, con fila en `ability-kit-parity` (junto con `decoyEscapeDistance`). Cuenta a los inmunes, porque siguen persiguiendo y cabeceando, y no a los que caen. Sin nadie a 10 u, salta hacia atrás de su facing, como antes. Se mantienen el recorte a 11,6 u y `decoyEscapeFallbacks` con `pickSafeLanding`. `nearestDecoyThreat` está en `abilities-runtime.ts` y en `server/src/sim/abilities.ts`.
> - **Se gira hacia el perseguidor y salta de espaldas.** Así las dos órdenes de Rafa se cumplen a la vez: la del 2026-04-29 («HACIA ATRÁS, no hacia delante», y el clip es Back_Jump) y la de hoy («para alejarse del perseguidor»). El señuelo se crea antes del giro y conserva la pose de huida. Si el jugador sigue con el stick pulsado, el facing vuelve a la huida en el paso siguiente, porque sigue al movimiento.
> - **Por qué 10 u y no 6:** el salto mide 7 u. Con un alcance menor, un perseguidor justo por fuera y a su espalda recibe a Kurama encima: con 8 u de distancia, el salto la dejaba a 1,1 u de él, con alcance 6 y también antes del cambio. Con 10, quien queda para el facing acaba a 3 u como mínimo.
> - Medido con pasos de 1/60 s en el laboratorio, Kurama en el centro (`.tmp/fase2/h5/probe.mjs`; `antes.json` en 5182 y `despues.json` en 5181). Dónde reaparece y a qué distancia queda del perseguidor, antes → después:
>   - (a) Encarando a Sergei, a 2 u delante: (−7, 0) y 9 u en los dos casos.
>   - (b) Huyendo con Sergei 2 u detrás: antes (7, 0), cruzándolo y a 5 u al otro lado. Ahora (−7, 0), a 9 u y girada hacia él.
>   - (c1) Sergei 2 u al este (el más cercano) y Trunk 4 u detrás: antes saltaba hacia Trunk y quedaba a 3 u. Ahora se aleja de Sergei (9 u) y Trunk queda a 8,1 u.
>   - (c2) Sergei 4,5 u al este y Trunk 3 u detrás (el más cercano): antes pasaba por encima de Trunk y quedaba a 4 u. Ahora (0, 7), con Trunk a 10 u y Sergei a 8,3 u.
>   - (d) Huyendo con Sergei 8 u detrás: antes quedaba a 1,1 u de él. Ahora a 15 u. Con el alcance forzado a 6, 1,1 u.
>   - (e) Nadie a menos de 10 u: (7, 0), atrás del facing, igual que antes.
>   - Jugador huyendo con A pulsada y Sergei 2 u detrás (`flee-probe.mjs`): antes reaparecía en x 6,61, al otro lado de Sergei, y seguía corriendo hacia él. Ahora reaparece en x −7,39 y el facing vuelve a −90° en el paso siguiente.
>   - Servidor (`.tmp/fase2/h5/server-mirror.test.ts`, 9 casos): los mismos puntos. Si la línea de huida sale del suelo, aterriza al 70 % (−4,9), y si no hay suelo en ninguna fracción, se queda junto al señuelo. Un enemigo que cae no cuenta.
>   - `ability-shots` de Kurama K: idéntica (el laboratorio la pone encarando al muñeco, caso a).
> - En partida, con Kurama en autopiloto contra Shelly, Kowalski y Sergei, 8 partidas con la semilla 740 (`casts.mjs`). Para aislar el cambio se repitió con el alcance a 0, que es la lógica anterior. Alcance 0 → 10:
>   - 31 → 25 K lanzadas. El bot lanza la K encarando a su objetivo, así que casi siempre es el caso (a). Con alcance 0 hubo 4 con el más cercano a la espalda, y ganaban 3,3 u de media, frente a 5,7 u con él delante.
>   - Distancia ganada al más cercano: +5,4 → +6,2 u de media. Ninguna K acaba más cerca de él.
>   - Tanda (`batch-range0.json` → `batch.json`): Kurama cae 2,10 → 2,10/min, los rivales 5,79 → 5,53/min, gana 3 → 2 de 8. Las 8 partidas salen bien en los dos casos. Es ruido: el cambio se nota al huir, y los bots no huyen.
>   - **El golden cambia también por H5.** Su partida 1 (Sergei contra Trunk, Kurama y Shelly, semilla 501) lleva a Kurama de bot. Con el código actual lanza 3 K, y en 2 el enemigo más cercano a menos de 10 u no estaba justo delante (a 4,7° y a 77° de su facing), así que H5 la gira y aterriza en otro sitio (`.tmp/fase2/rev/golden501-kurama.mjs`). Hay que contarlo en la nota del `golden:write` junto con los demás grupos.
> - Online: el giro y el salto viven en `server/src/sim` y salen con el despliegue. El evento `abilityFired` lleva la posición y el `rotationY` de después del efecto (punto 7 del informe), así que el señuelo online aparece en el destino y, ahora, mirando al perseguidor. Cuando el evento lleve el origen, que lleve también el `rotationY` de antes del giro.
> - **Para Rafa:** el mando es `decoyThreatRange`. Con 10 u, casi siempre salta lejos de alguien y el «atrás del facing» queda para cuando nadie está cerca. Si prefieres que el jugador decida la dirección más a menudo, bajarlo por debajo de 7 vuelve a abrir el caso (d).

> **2026-09-24 — repaso de habilidades, fase 2, grupo H6 (Steel Shell frena en seco y no flota sobre el vacío; decisión 7 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Frena en seco al pulsar K.** `anchorInPlace` (`abilities-runtime.ts` y `server/src/sim/abilities.ts`) corta la J o el blink en curso, con su enfriamiento, y pone la velocidad a 0. Se llama al activar la K (así la carga de 0,2 s no patina) y otra vez al cerrarse el escudo, por si la estocada de un cabezazo la movió durante la carga. Antes la J solo se cortaba al cerrarse, y la velocidad seguía hasta que la frenaba el rozamiento.
> - **Solo frena lo que se mueve ella** (corrección tras la revisión). La primera versión ponía a 0 toda la velocidad, también la de un empujón recibido: pulsar K justo después de un cabezazo le quitaba casi todo el vuelo, y la segunda puesta a 0, al cerrarse, borraba los empujones de la carga, que era su ventana vulnerable. Rafa respondió «frena en seco» a una pregunta sobre su propio movimiento; lo de anular empujones no se le había planteado. Ahora la velocidad va a 0 solo si no pasa de lo que ella misma se da: `anchorBrakeMaxSpeed` (3,5 u/s, campo nuevo de Steel Shell; su carrera llega a 1,89, a 2,65 con Saw Shell y a 3,31 sobre el hielo de Frozen Floor), más el impulso de la J que corta (15) y la estocada de un cabezazo en curso (4,7). Si va más rápido, alguien la ha lanzado, y el vuelo sigue como antes de H6. Mismo valor en el kit del servidor, con fila en `ability-kit-parity`.
> - **La carga de Steel Shell queda enraizada del todo** (`slowDuringWindUp: 0` en su definición). Con el 0,15 genérico de las K y el stick pulsado, Shelly se arrastraba 0,04 u en la carga. El kit del servidor ya la enraizaba (`ROOTED_K`), así que en esta K cliente y servidor coinciden. El resto de las K sigue a la espera del punto 2 del buzón (C5 del informe).
> - **Por qué no caía:** `checkFalloff` (cliente y `server/src/sim/physics.ts`) se salta a todo inmune, y Steel Shell y Mirror Trick escriben la inmunidad. El anclaje (masa ×9999) no intervenía. Ahora la inmunidad solo sostiene sobre el vacío como gracia de reaparición. Con una K de autobuff pasada su carga (`selfBuffOnly`: Steel Shell y Mirror Trick), el bicho cae como cualquiera. La inmunidad los sigue librando de empujones. Si se lanza la K durante la gracia de reaparición, la gracia vale durante la carga, y al cerrarse la K manda ella.
> - **Mirror Trick también cae** (pendiente de Rafa: la decisión 7 habla solo de Shelly). La regla mira `selfBuffOnly`, así que vale para Steel Shell y para Mirror Trick. Offline, Kurama anda durante el truco: si se sale del disco o se hunde la baldosa, cae en el acto. Antes flotaba hasta 2,8 s, inmune, y podía volver al suelo.
> - Medido con pasos de 1/60 s en el laboratorio (`.tmp/fase2/h6/probe-shell.mjs`; `probe-antes.txt` en 5182 y `probe-despues.txt` en 5181):
>   - Andando a tope (1,89 u/s) + K: desliza 0,32 u (0,27 en la carga y 0,05 tras cerrarse, parada 10 pasos después) → 0 u.
>   - Con la J en curso (8,57 u/s) + K: 1,07 u (0,92 + 0,15, parada 16 pasos después) → 0 u, y la J acaba al pulsar.
>   - Tras la corrección (`.tmp/fase2/rev/r1-probe.mjs`; `r1-antes-5182.txt`, `r1-antes-5181.txt` con la puesta a 0 total, `r1-despues-5181.txt`), antes de H6 → puesta a 0 total → ahora:
>     - Lanzada a 20 u/s (un cabezazo) y K al paso siguiente: recorre 1,04 → 0 → 1,03 u. A los 3 pasos: 1,04 → 0,33 → 1,04 u. A los 6 (va a 4,3 u/s): 1,04 → 0,82 → 1,04 u. Sin K, 1,04 u.
>     - Empujón de 20 u/s 9 pasos dentro de la carga (le llega al cierre a 6,3 u/s): 1,04 → 0,56 → 1,04 u. A 6 pasos (al cierre va a 2 u/s, por debajo del umbral): 1,04 → 0,89 → 0,89 u.
>     - Andando a tope y con la J en curso: 0 u, igual que con la puesta a 0 total. Cabezazo y K durante la estocada: 0,24 u en los tres casos (la estocada sale en la carga, antes del cierre).
>   - Se hunde la baldosa (`killFragmentIndices`) bajo Shelly anclada: no caía en 2,5 s → cae en el paso siguiente. Igual Kurama con el truco.
>   - Recién reaparecida (1,5 s de inmunidad): cae a los 1,55 s antes y después. La gracia se mantiene.
>   - Reaparecida y con el escudo ya cerrado: no caía → cae en el paso siguiente.
>   - `ability-shots` de Shelly K y Kurama K: idénticas, porque desde parada no cambia nada.
> - Servidor (`.tmp/fase2/h6/server-shell.test.ts`, 6 casos):
>   - 2 u/s → 0 al pulsar;
>   - un empujón de 3 u/s en la carga → 0 al cerrarse;
>   - J a 15 u/s → 0, con la J cancelada y 5,5 s de enfriamiento;
>   - anclada sobre un hueco: cae y pierde una vida;
>   - reaparecida sin K: no cae;
>   - gracia de reaparición con la K en carga: no cae; al cerrarse, sí;
>   - Kurama con el truco: cae.
>   - Tras la corrección (`.tmp/fase2/rev/server-anchor.test.ts`, 6 casos): lanzada a 20 u/s y K, sigue a 20; empujón de 20 u/s en la carga, sigue a 20 al cerrarse; un roce de 3 u/s en la carga, 0 al cerrarse; estocada de 6,5 u/s y K, 0; corriendo y con la J, 0. Los 6 casos de H6 siguen en verde.
> - Tandas en 5181. El «antes» es el mismo código con estas líneas revertidas, así que aísla el grupo.
>   - Shelly, 24 partidas (semillas 760-783; `antes-batch-Shelly*.json` → `batch-Shelly*.json`): cae 2,87 → 2,79/min (71 → 72); los rivales, 6,11 → 5,74/min; 84 → 88 escudos; gana 1 → 0.
>     - Antes, 3 caídas llegaron justo al acabarse el escudo, entre 4,1 y 4,4 s después de lanzarlo: flotaba sobre una baldosa hundida hasta que se le acababa la inmunidad.
>     - Después, 2 caídas a mitad de escudo (a 2,9 y 3,85 s), que son la regla nueva, y ninguna flotando.
>   - Kurama, 8 partidas (semilla 740): cae 2,10 → 2,54/min (18 → 21); 25 → 22 trucos; gana 3 → 3. Una caída a mitad de truco (a 1,40 s): el lote 2 se hundió bajo ella y bajo Shelly a la vez. El resto es divergencia de las partidas.
>   - Tras la corrección, Shelly contra Trunk, Sebastian y Kermit, semillas 760-767, el mismo código con y sin `anchorBrakeMaxSpeed` (`.tmp/fase2/rev/batch-Shelly-fullzero.json` → `batch-Shelly-fix.json`): la partida dura 69,2 → 48,5 s de media y Shelly cae en las 8 en los dos casos (3 vidas: 2,6 → 3,7 caídas/min). En el «antes» de H6 duraba 55,8 s. El bot lanza el escudo justo cuando un rival cabecea a su lado (`shelly-k-speed.txt`): de 22 escudos, en 10 le llega un empujón que la puesta a 0 total borraba, 1 al pulsar (iba a 16,8 u/s) y 9 durante la carga (al cerrarse iba a 4,6-14,3 u/s). Con la puesta a 0 total, el escudo del bot funcionaba como una parada del cabezazo incluso en la carga.
> - Online: `checkFalloff` y `tickPlayerAbilities` viven en `server/src/sim`, y `BrawlRoom` solo las llama. Sale con el despliegue sin tocar la sala.
> - **Para Rafa:**
>   - ¿Quieres que Steel Shell anule también los empujones? Hoy no: si la lanzan y pulsa K, o la empujan durante la carga de 0,2 s, el vuelo sigue y el escudo se cierra donde aterriza. Si sí, basta con quitar `anchorBrakeMaxSpeed` de su definición en los dos kits: frena desde cualquier velocidad, pulsar K justo después de un cabezazo le ahorra casi todo el vuelo (1,04 → 0 u), y el bot de Shelly aguanta bastante más (partidas de 48,5 → 69,2 s en las semillas 760-767).
>   - ¿Mirror Trick también debe caer sobre el vacío? La decisión 7 era de Shelly, y la regla se extendió al truco porque los dos escriben la inmunidad. Si prefieres que Kurama siga flotando durante el truco, se limita a Shelly filtrando por `selfAnchorWhileBuffed` en vez de `selfBuffOnly` en `hasSelfBuffActive` (`src/physics.ts` y `server/src/sim/physics.ts`).
>   - El bot de Shelly se encierra en el borde cuando lo aprietan (regla de presión de borde), y el borde es lo que se hunde. Sobre una baldosa que ya tiembla, eso es ahora una caída segura: pasó en 2 de 88 escudos. Evitarlo pide que el bot sepa si la baldosa que pisa está avisando, y la arena hoy no lo expone (aviso a ARENA). ¿Lo hacemos?
>   - Si Shelly lanza el escudo en su gracia de reaparición, al cerrarse el escudo ya puede caer. Es coherente con «el escudo no te sostiene», pero si prefieres que la gracia de 1,5 s valga siempre, hay que llevar un temporizador de gracia aparte en cliente y servidor (el del servidor lo escribe `BrawlRoom` al reaparecer).

> **2026-09-24 — repaso de habilidades, fase 2, grupo H7 (Kowalski: Ice Slide, bola y buff; decisión 8 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **Ice Slide desliza de verdad.** `slideFrictionMult: 3` en la definición de la J (cliente y kit de `server/src/sim`, con fila en `ability-kit-parity`): mientras dura la J, la vida media de su rozamiento va ×3. Lo leen `Critter.frictionScale` en el bucle de rozamiento de `critter.ts` y, en el servidor, `frictionScale(p)` de `server/src/sim/abilities.ts`, que `BrawlRoom` aún tiene que multiplicar en su paso de integración (DISTRIBUCIÓN). La descripción decía «on an ice trail» y ese rastro no existe: pasa a «Belly-slides forward and keeps gliding» / «Se lanza de panza y sigue deslizándose».
> - Medido con pasos de 1/60 s, Kowalski sola y parada, 1,5 s desde que pulsa (`.tmp/fase2/h7/probe-j.mjs`; `probe-j-antes.txt` en 5182 y `probe-j-despues.txt` en 5181). Antes → después:
>   - Con el stick: la J la lleva 1,64 → 4,73 u más lejos que correr (6,57 → 9,66 u, frente a 4,93 corriendo). En la ventana activa recorre 2,68 → 4,78 u y sale de ella a 2,3 → 10,3 u/s; vuelve a su velocidad de carrera a los 0,8 s en vez de a los 0,35.
>   - Sin el stick: 0,98 → 2,48 u.
>   - `ability-shots` (con el muñeco cercano a 1,8 u en medio): recorre 0,80 → 1,33 u y lo empuja 0,22 → 0,75 u.
> - **El bot mira hasta donde llega el deslizamiento.** Con la sonda del borde a 3 u, 5 de sus 43 J acababan en caída antes de 1 s y ganaba 0 de 8 partidas (5 de 8 sin el cambio). La sonda lejana se multiplica ahora por `dashGlideFactor(def)` = m − (m − 1)·2^(−T/(h·m)), la distancia de más que da el deslizamiento: 2,16 en Ice Slide (sonda a 6,5 u) y 1 en las otras ocho J, que no cambian. Está en `src/bot.ts` y en `server/src/sim/bot.ts`, con test nuevo en `server-bot.test.ts`.
> - **Snowball: el lanzamiento casa con el clip.** Trazado hueso a hueso (`.tmp/fase2/h7/bones.mjs`): en Ability2 (3,8 s) la aleta que lanza (R_Hand) llega a su máxima velocidad hacia delante a 1,80-1,82 s y a su máximo alcance a 1,85 s. El clip arranca en el paso en que se pulsa, así que en el paso en que nace la bola va por `rate` × 31/60 s. Con `clipPlaybackRate: 3.5` va por 1,81 s y la aleta está sobre la bola. Con el 3,6 del informe va por 1,86 s: la aleta ya ha pasado la bola y va hacia abajo, un fotograma tarde. Antes, con el 2 de `ANIMATION_OVERRIDES`, iba por 1,03 s: el pingüino aún estaba girándose y la bola salía de la nada. Hojas fotograma a fotograma (pasos 20-39): `.tmp/fase2/h7/k-antes`, `k-3.5`, `k-3.6` y `k-despues/release-sheet.png`. El 3,5 va atado al windUp de 0,50: si cambia uno, hay que recalcular el otro.
> - **Buff de Frozen Floor: se queda en ×1,10 de velocidad y de masa**, y el comentario, que decía «neutro», ya cuenta lo que hace. Tanda de 24 partidas con 1,10 y otras 24 con 1,0, mismo código y semillas 820-843 (`ab-glide.json` y `ab-neutral.json`). Con 1,10 → con 1,0:
>   - Kowalski gana 6 → 10 y cae 2,95 → 2,65/min.
>   - Caídas rivales por L: 0,88 → 0,87; durante el hielo: 1,63 → 1,52.
>   - Caídas de Kowalski en su L: 8 de 48 → 7 de 46.
>   - Nada se sale del ruido. Se queda así porque el 🔥 y el brillo de frenesí de la L no mienten, y no hay que tocar nada fuera del carril. Si Rafa lo prefiere neutro, hacen falta 1,0/1,0 en los dos kits, la tabla de `verify-ability-parity`, que `frame-ticks.ts` no ponga 'frenzy' con `frozenFloorL` y otro brillo en `updateVisuals`.
> - Tanda de Kowalski, 8 partidas con la semilla 820 (`antes-batch.json` en 5182, que reproduce `.tmp/fix-audit`; `batch.json` en 5181, con los grupos H1-H6 dentro):
>   - gana 5 → 2;
>   - cae 2,05 → 3,15/min;
>   - caídas en el segundo siguiente a una J: 0 de 62 → 2 de 48;
>   - los rivales caen 8,70 → 7,01/min.
> - Para separar el deslizamiento del resto de la fase 2 se repitió con `slideFrictionMult` a 1. En 8 partidas, sin deslizamiento gana 5 de 8. En 24 partidas (semillas 820-843), con → sin deslizamiento:
>   - gana 6 → 9;
>   - cae 2,95 → 2,55/min;
>   - caídas en el segundo siguiente a una J: 5 de 163 → 4 de 185;
>   - los rivales caen 7,36 → 7,59/min.
>   - Es una tendencia: al bot le cuesta algo más de una caída cada 2,5 minutos.
> - **Para Rafa:**
>   - El deslizamiento hace a Kowalski un poco peor en manos del bot, aunque ya no se tira por el borde. Si el jugador lo nota igual, la palanca es `slideFrictionMult` (con 2 serían unas 3,8 u).
>   - `scripts/ability-shots.mjs` no borra el aturdido del lanzador. Con la semilla 501, un Grip de Trunk en el primer segundo y medio deja a Kowalski aturdida, y desde H2 eso bloquea la J, la K y la L («activa 0f»). Las hojas de este grupo salen de una copia que lo borra (`.tmp/fase2/h7/ability-shots-h7.mjs`). El arreglo de verdad es de tierra de nadie y hay que aplicarlo antes de la tanda final de `ability-shots`: en el `evaluate` del setup, tras `resetPlayerCooldowns()`, `for (const c of g.critters) { c.stunTimer = 0; c.confusedTimer = 0; c.slowTimer = 0; }`.

> **2026-09-24 — repaso de habilidades, fase 2, grupo H8 (los bots online lanzan la L; decisión 10 de Rafa). `[~]`, pendiente de golden y de validación de Rafa:**
> - **`server/src/sim/bot.ts` pulsa la L** (antes, `ultimate = false`). `lFires` espeja las reglas de `src/bot.ts` y decide por la forma de la definición:
>   - Trunk Grip (`gripK`): alguien a quien el agarre cogería ya, a más de `targetedMinRange` (3 u) y a menos de `gripMaxRange` (10 u). Tasa `grip` 0,5/s. `findGripTarget` sale de la rama del agarre de `server/src/sim/abilities.ts` y la usan el agarre y el bot, como en el cliente.
>   - Las L de tipo buff (Frenzy, Copycat, Saw Shell, Toxic Touch, Sinkhole): el enemigo más cercano a menos de `buffRange` (3,5 u), en cualquier dirección. Tasa `buff` 0,382/s.
>   - Frozen Floor: min(2, rivales vivos) a menos de `floorRadius × floorCastRadiusFrac` (4,8 u).
>   - Cone Pulse: el más cercano a menos de 3,5 u y dentro de su cono (±45°).
>   - Shelly: ni con el escudo puesto ni en el tick en que lo levanta. En la sala la K arranca antes que la L, y la sierra saldría anclada. El escudo solo cuenta si la K está lista, porque si no, pulsarla no hace nada.
>   - Siempre con la L lista (ni activa ni en enfriamiento) y nunca aturdido.
> - **All-in de Sebastian: excluido online.** El bucle de carga de `BrawlRoom` empieza la carga al pulsar y dispara al soltar. Pero el bot no ve su carga (`lHoldCharging` vive en los datos internos de la sala, no en `PlayerSchema`), y la sala no le da forma de dejarla sin gastarla. Si la mantuviera a ciegas, soltaría con el pasillo vacío, y esas sueltas a ciegas eran la mitad de las caídas de Sebastian offline. El cambio exacto que falta en la sala queda para DISTRIBUCIÓN. Offline sigue como estaba.
> - Valores: `SIM.bots` gana `fireRatesPerSec.buff` y `.grip`, `buffRange`, `gripMaxRange` y `floorCastRadiusFrac`, con sus 5 filas en `feel-sim-parity`. El 3,5 que `buffFires` llevaba escrito a mano en `src/bot.ts` pasa a `FEEL.bots.buffRange`, con el mismo valor.
> - Tests: 7 casos nuevos en `server-bot.test.ts`:
>   - buff con alcance, enfriamiento, activa y aturdido;
>   - la tasa convertida a 30 Hz;
>   - Grip;
>   - Frozen Floor;
>   - Cone Pulse;
>   - Shelly;
>   - Sebastian.
>
>   Si se quita la regla del escudo en el mismo tick, falla el de Shelly.
> - Medido:
>   - **Offline no cambia.** La tanda de Kowalski (semilla 820, 8 partidas, `.tmp/fase2/h8/batch-Kowalski.json`) sale idéntica, partida a partida, a la última de H7 (`.tmp/fase2/h7/ab-glide.json`).
>   - **Online, con la sala de verdad y sin clientes.** `.tmp/fase2/h8/online-sim.mts` ejecuta `BrawlRoom.simulatePlaying` a 30 Hz con 4 bots: 24 partidas por bicho, 216 en total, con `Math.random` sembrado. El «antes» es la L aparcada en enfriamiento, que equivale al `false` de antes. Resultados:
>     - 1441 L, entre 2,2 y 3,4 por minuto vivo según el bicho. Offline, en `.tmp/fix-audit`, entre 2,0 y 3,0.
>     - Ninguna L fuera de su regla (comprobado con el estado del tick en que el bot decidió).
>     - Sebastian: 0 cargas.
>     - Ningún error en la sala.
>   - La partida media baja de 65,7 a 48,2 s. Las caídas por minuto suben en los nueve, por ejemplo Trunk 1,73 → 2,93, Sergei 2,73 → 4,38 y Sihans 2,79 → 5,58.
>   - Caídas de rivales mientras dura la L o en el segundo siguiente, por cada L: entre 0,65 y 1,69 online, frente a 0,30-1,31 offline. Online las L empujan más. No lo he aislado, pero las pasadas de L de `BrawlRoom` aún van con sus propios números: la sierra golpea cada tick sin `contactRehitCooldown`, Cone Pulse lleva su rampa, `knockbackScale` no se lee y Copycat usa el kit y no `getLDef`. Todo eso ya está en el buzón de DISTRIBUCIÓN.
>   - Victorias y eliminaciones por bicho, mismas 216 partidas y semillas; la única diferencia es que los bots lanzan la L (`online-sim-antes.txt` → `online-sim-despues.txt`):
>
>     | Bicho | Apariciones | Victorias | % | Eliminado | Sus caídas/min | Caídas rivales por L |
>     |---|---|---|---|---|---|---|
>     | Sergei | 101 | 23 → 17 | 23 → 17 % | 77 → 83 % | 2,73 → 4,38 | 0,75 |
>     | Trunk | 89 | 67 → 52 | 75 → 58 % | 25 → 42 % | 1,73 → 2,93 | 0,65 |
>     | Kurama | 99 | 7 → 9 | 7 → 9 % | 93 → 91 % | 3,25 → 4,54 | 0,77 |
>     | Shelly | 99 | 6 → 15 | 6 → 15 % | 94 → 85 % | 3,00 → 3,72 | 0,89 |
>     | **Kermit** | 90 | **14 → 35** | **16 → 39 %** | **84 → 61 %** | 2,93 → 3,42 | **1,69** |
>     | Sihans | 98 | 24 → 19 | 24 → 19 % | 76 → 81 % | **2,79 → 5,58** | 1,59 |
>     | Kowalski | 96 | 22 → 28 | 23 → 29 % | 77 → 71 % | 2,62 → 3,70 | 1,11 |
>     | Cheeto | 113 | 39 → 25 | 35 → 22 % | 65 → 78 % | 2,70 → 4,56 | 0,76 |
>     | Sebastian | 79 | 9 → 9 | 11 → 11 % | 89 → 89 % | 3,16 → 4,44 | — (no la lanza) |
>
>   - **Kermit es efecto directo de lanzar la L, no de lo que falta en `BrawlRoom`.** Toxic Touch no empuja: solo escribe `confusedTimer = max(confusedTimer, dur)`, igual online (`BrawlRoom.ts`, pasada de Toxic Touch) que offline, y la puerta de repetición no cambia nada sobre un `max`. La sala invierte todo lo que pulsa el bot confundido, también su huida del borde (decisión 9 de Rafa), y contra bots eso vale caídas. Offline ya era la L que más caídas provoca (1,31 por L; `.tmp/fase2/h8/offline-lrates.txt`). Los arreglos pendientes de DISTRIBUCIÓN no lo corrigen.
>   - **Sihans** dobla sus propias caídas por minuto (el resto sube ×1,2-1,7). Offline también era el que más caía (3,80/min). No lo he aislado: puede ser su propio Sinkhole.
> - **Condición de despliegue.** Desde H8 los bots lanzan la L en todas las partidas online, así que las pasadas de L de `BrawlRoom` que siguen rotas salen en todas las partidas con bots, no solo con humanos que usan la L. El servidor con H8 no se despliega sin que DISTRIBUCIÓN aplique antes, en la misma sala: `getLDef(p)` en vez de `kit[2]` en las pasadas 2.e y 2.g; `takeContactHit` y `ageContactRehit` en la sierra y la embestida (hoy suman el impulso en cada tick de contacto); `knockbackScale` en la bola, Cone Pulse, la sierra y la embestida. Tras esos parches, repetir `.tmp/fase2/h8/online-sim.mts` y comparar victorias, no solo caídas por minuto. El All-in necesita además el cambio de la sala descrito arriba.
> - **Para Rafa:**
>   - En partidas solo de bots, con la L duran un 27 % menos. Si las quieres más largas, las palancas son `fireRatesPerSec.buff` y `.grip`, que comparten offline y online, y que las L de `BrawlRoom` empujen como las de offline.
>   - Kermit pasa de ganar el 16 % de sus partidas online al 39 %, y eso no lo cambian los arreglos de la sala. ¿Lo aceptas, o bajamos cuánto lanza el bot esa L? Sería una tasa propia por definición en `lFires`/`buffFires` (`server/src/sim/bot.ts` y `src/bot.ts`), con su fila de paridad. Afectaría también offline.

> **2026-09-24 — repaso de habilidades, fase 2, grupo H9 (pulido visual de la tabla de ajustes). `[~]`, pendiente de golden y de validación de Rafa. Solo cambia lo que se ve y cuánto dura cada pausa: ningún empujón, distancia ni estado cambia.**
> - **Brillo de estado por habilidad.** Los colores de `Critter.updateVisuals` pasan a `FEEL.stateGlow`, y cada definición puede traer los suyos: `activeGlowHex`, `activeGlowIntensity` (el pico; la L sigue latiendo por debajo) y `windUpGlowHex`. Son solo visuales: no van al servidor ni los copia Copycat. Además, el brillo se pinta con un indicador y no comparando el color con el del bicho, así que un color de definición igual al del bicho ya no se apaga. Medido con `.tmp/fase2/h9/probe.mjs` (pasos de 1/60 s; `probe-antes.json` → `probe-despues.json`):
>   - La carga de toda L: amarillo 0xffff00 a 0,5 → latido rojo oscuro 0xb01000, entre 0,25 y 1,0 a 5 Hz. La carga de la K sigue en amarillo («apártate»).
>   - Kowalski: J 0xff8800 → 0x9fe3ff; la carga de la bola, sin brillo → 0x88c1ff a 0,5; Frozen Floor, pulso rojo → 0xcfeeff.
>   - Saw Shell: pulso rojo → 0x6ddfa9. Sinkhole: pulso rojo de 0,6-1,0 → arena 0xc89a3c de 0,24-0,4.
>   - Sergei (las tres por defecto) y el parpadeo de Toxic Touch no cambian.
> - **Shadow Step (Cheeto K)**: si el aterrizaje golpea a alguien, hit stop de habilidad (`FEEL.hitStop.ability`, 0,04 s), sonido `headbuttHit` y shake (`FEEL.shake.blinkImpactFactor` 0,7, antes escrito a mano). Si no golpea, ni shake ni pausa; antes sacudía siempre. Pasos congelados con un golpe: 0 → 3.
> - **Poison Cloud (Kermit K)**: `shakeBoost: 0.5` y `hitStopKey: 'ability'`. Empuja a 6,1 u/s y sacudía y congelaba como la Shockwave de Sergei (20 u/s). Pasos congelados: 6 → 3. `hitStopKey` es un campo nuevo de la definición: por defecto `'groundPound'` en una K radial o de cono, `'ability'` en el aterrizaje de un blink.
> - **Snowball (Kowalski K)**: al impactar, un anillo de nieve (`CRITTER_VFX_PALETTE.Kowalski.projectile`, 0xeaf6ff y blanco) en vez de 6 manchas de polvo beige. Al derretirse, uno más pequeño. Es el mismo helper offline y online (`spawnProjectileBurst` en `projectiles.ts`), y offline hay hit stop de habilidad (pasos congelados: 0 → 3). El polvo en color nieve y la estela 0xdff4ff de Ice Slide esperan a que `spawnDustPuff` acepte color (`dust-puff.ts` es de ARENA).
> - **Cone Pulse (Cheeto L)**: al arrancar pinta en el suelo la cuña que va a barrer (`spawnConeWedge`: ±45°, 9,4 u, el borde de su última onda) en vez del anillo de 360° de las demás L (`spawnLEntryVfx` en `abilities-runtime.ts`). Rafa ya había rechazado lo mismo en Claw Wave: «dice frontal y veo 360°». La Kurama que copia Cone Pulse también la pinta. Los 1,4 y 2,0 de las ondas pasan a `FEEL.conePulse`, con espejo en `SIM.conePulse` y dos filas en `feel-sim-parity`. En la sala, `BrawlRoom` aún los escribe a mano (aviso a DISTRIBUCIÓN).
> - **Trunk Grip**: la víctima sigue llegando a la trompa en un paso, pero su modelo se desliza hasta ella en `FEEL.grip.yankVisualTime` (0,15 s): primero rápido y frenando al llegar, por el `reactionRig` (`applyYankVisual` en `gamefeel.ts`). El anillo del agarre sale donde la trompa la atrapa, no donde llega. Sonda con la víctima a 7 u (un tirón de 5,4 u): antes el modelo estaba en el destino en el mismo paso. Ahora, durante los 6 pasos congelados del hit stop, se queda a 4,27 u (ya ha recorrido el 21 %, porque la víctima se actualiza en el mismo paso, después de Trunk). Luego baja a 3,27 · 2,40 · 1,67 · 1,07 · 0,60 · 0,27 · 0,07 · 0 u. Si la víctima se actualiza antes que Trunk, la pausa la enseña en el sitio exacto del agarre. La reaparición y el reinicio cortan el deslizamiento (`cancelYankVisual`). **Solo offline:** `applyYankVisual` se llama desde el Grip local. Online, el jugador agarrado sigue saltando hasta 7 u en un paso, porque `game.ts` coloca al jugador local tal cual llega del parche (a los remotos ya los suaviza su interpolación). Falta en `game.ts` (tierra de nadie): al ver en el parche del jugador local que `stunTimer` sube desde 0 y su posición salta, llamar a `applyYankVisual(c, xAnterior, zAnterior)`.
> - **Sin cambios de física.** `ability-shots` en 11 filas (`.tmp/fase2/h9/antes*` → `despues*`, con la copia que borra el aturdido, `.tmp/fase2/h7/ability-shots-h7.mjs`): Kowalski J/K/L, Cheeto K/L, Kermit K/L y la L de Trunk, Shelly, Sihans y Sergei.
>   - Empujones, picos, direcciones y estados salen idénticos.
>   - Solo cambian los fotogramas activos, por las pausas: Cheeto K 10 → 13, Kowalski K 34 → 37 y Kermit K 19 → 16. El muñeco lejano de Shadow Step recibe en el paso 12 en vez del 9.
>   - La velocidad inicial del muñeco lateral en Kowalski J (1,5 → 1,0) es ruido del segundo y medio de calentamiento con reloj de pared: dos repeticiones dan 1,5.
> - Tandas: Kowalski con la semilla 820, 8 partidas, frente a la de H8. Mismo ganador, caídas y lanzamientos en cada partida; cada una dura 0,2-0,6 s más de simulación, que son las pausas nuevas. Trunk con la semilla 720: 8/8 sin errores.
> - Grabaciones: `.tmp/fase2/h9/{antes,despues}*/*.mp4` y las hojas. `grip7-{antes,despues}` es el Grip con el muñeco a 4,2 u (`ability-shots-grip7.mjs`).
> - **Para Rafa:**
>   - La carga de la bola a 0,5 pinta al pingüino de azul claro entero. Si tapa demasiado su silueta, la palanca es `FEEL.stateGlow.kWindUp.intensity`, que es la de todas las K.
>   - Sinkhole a 0,4 se lee como arena suave. La palanca es `activeGlowIntensity`.
>   - Kowalski: además de lo que pedía el resumen, lleva el hit stop de habilidad al impactar, que venía en la fila de la tabla del informe.

> **BLOQUE FINAL pass (2026-05-01 — deadline-day). Todos `[~]` pendientes de validación de Rafa:**
>
> Rafa pidió que NO se reinterpretasen las habilidades — texto literal del brief
> aplicado tal cual.
>
> - **A1 Sebastian L (hold-to-fire All-in)** — antes el L disparaba al pulsar.
>   Ahora:
>   1. **Press+hold** del L → Sebastian entra en windup-charge **rooted** (`lHoldCharging = true` → `effectiveSpeed = 0`) Y se pinta la **trajectory preview** en el suelo (línea crimson + acento amarillo) hacia el borde escogido. NO ejecuta dash todavía.
>   2. **Release** del L → dash lateral resuelve. Hit → enemy mandado lejos + Sebastian PARADO + control vuelve. Miss → endpoint × 1.5 más allá del rim → cae al void.
>   3. **Auto-release seguro** a `holdToFireMaxMs = 3000` ms para que un hold infinito no bloquee la partida.
>   - Server-authoritative: `BrawlRoom` añade pre-tick block que detecta rising/falling edge sobre `inputUltimate` y broadcastea `lChargeStart` (cliente offline + remoto pintan la línea idéntica).
>   - Cliente: nuevo `tickSebastianHoldToFire` en `src/abilities.ts` orquesta el preview + mantiene el critter rooted.
> - **A2 Cheeto L (semicírculo / cono frontal con ondas que escalan)** — antes era un anillo radial 360° con ramp uniforme. Ahora:
>   - **Visual**: NO hay anillo 360°. Cada pulso spawnea **arco de 5 dust-puffs** sobre la onda + accent ring centrado en `waveCenter` (escalado al ancho de la onda actual). Lectura: "Cheeto ruge ondas hacia delante".
>   - **Hit detection**: el knockback aplica solo a críters cuyo `d` (distancia 2D) cae en `[waveMin, waveMax]` Y dentro del cono frontal (`dot(facing, dir) ≥ cos(half-cone)`). El frente real se EXPANDE — el primer pulso afecta cosas pegadas, el último golpea solo a 6-7 u.
>   - **Ramp doubling**: pulso N usa `min(2^(N-1), 8)` → 1, 2, 4, 8, 8, 8 sobre 6 pulsos. Cada pulso siente el doble que el anterior; capped a 8× para no superar el clamp `maxSpeed`.
>   - **Push direction**: ya no radial. Ahora `facingX/Z * effectiveForce * fall` — el rugido empuja hacia DELANTE consistentemente, no en dirección al caster.
>   - Cliente offline + server replican la geometría exacta. `lPulse` event payload añade `waveCenter, waveThickness, count` para que online viewers pinten el mismo arco.
> - **A3 Trunk (mucho más bestia)** — texto literal de Rafa: "K stun ×2 duration, headbutt force ×3, movement speed ×2".
>   - **K Trunk Slam**: `slamStunDuration 1.0 → 2.0` (×2). Stun afecta a TODOS los críters dentro del AoE radius 7 u. Combinado con la regla global "stunned recibe ×4 knockback", un Slam seguido de cabezazo elimina al objetivo.
>   - **Headbutt**: `headbuttForce` 16 → 48 (sobreescribe PWS), `headbuttBoost 1.0 → 3.0`. EFFECTIVE force ≈ 48 × 2.5 × 3.0 = 360 unidades vs 16 × 2.5 × 1.0 = 40 anteriores → ×9 sensación de cabezazo.
>   - **Speed**: `speed 8 → 16` (×2). Trunk ya no es el yunque lento; puede perseguir.
>   - **L Trunk Grip** sigue como en el microfix pass anterior (range 28, cone 35°, gripStun 5.0). Stampede / `rammingL` retirados.
> - **A4 Kurama** — verify-only, no tocar:
>   - K Mirror Trick: alpha 0.08 confirmado en `updateVisuals` *(no era cierto: la rama de inmunidad iba antes y el 0,08 no se pintó hasta el grupo G7 del 2026-09-24)*; online sync via `handleAbilityFired` ya operativo desde el microfix pass; force-zero `invisibilityTimer` cuando el K slot pierde `active` evita el bug de invisibilidad permanente.
>   - L Copycat: chip de color con la inicial del bichito target sigue intacto en el slot HUD.
>
> **Online identity rebuild (2026-05-01 BLOQUE FINAL)**:
> - **Modelo nuevo**: `sessionStorage = identidad confirmada de ESTA pestaña`; `localStorage = nickname preferido del device, sólo prefill`.
> - **Una pestaña + refresh** → recuperación silenciosa via sessionStorage. Sin prompts.
> - **DOS pestañas mismo browser** → la segunda NO autologa. Modal de nickname aparece prefilled con el preferred. Si entras nick distinto → server crea row independiente. Si entras MISMO nick activo → error claro `nickname_active_in_room`.
> - **Otro browser / incógnito** → no hay sessionStorage compartido. Entra al flow normal de prompt.
> - **PlayerSchema.nickname** sincronizado: `@type('string') nickname` añadido al PlayerSchema; BrawlRoom escribe el nick al join. Cliente waiting room lee `p.nickname` y lo muestra como línea principal con `.waiting-slot-subtitle` para el critter.
>
> **3D Belts (2026-05-01 BLOQUE FINAL — NO post-jam)**:
> - **`src/belt-thumbnail.ts` (NEW)**: shared offscreen WebGLRenderer 144×144 con auto-fit, key + rim lighting, slight 3/4 angle. Cache per beltId. `getBeltThumbnail(id) → Promise<dataURL | null>`. Loads `./models/belts/<beltId>.glb` lazy.
> - **`src/belt-viewer.ts` (NEW)**: full-screen modal 640×640 con drag-to-rotate (mouse + touch), idle auto-rotation, ESC + backdrop + close button. `openBeltViewer(beltId, displayName, description?)` API. Lazy-init renderer/scene → cero overhead hasta que el user clickea.
> - **`src/hall-of-belts.ts`**: slots unlocked ahora `.belt-slot-clickable`, click/Enter abre el viewer. Async `getBeltThumbnail(badge.id)` upgrade el `<img>` del slot al render 3D mientras la 2D PNG queda como fallback. Mismo patrón en la online tab via `.belt-online-icon-clickable`.
>
> **Gamepad audit (2026-05-01 BLOQUE FINAL)**:
> - Wiring confirmado en `src/input.ts` (left-stick movement, A=headbutt, X=J, Y=K, RB=L, Start=pause/menu). Title screen muestra "🎮 Gamepad auto-detected" cuando hay un mando enchufado y el viewport no es touch.
> - Smoke test plan: documentado en `FINAL_JAM_QA_CHECKLIST.md` sección 8 (Rafa lo prueba con su mando antes del submit).
>
> Sentinels actualizados: Trunk K slamStun 2.0, speed 16, headbuttForce 48. Sebastian L holdToFireL true / holdToFireMaxMs 3000. Cheeto L wave model (waveStep 1.4 / waveThickness 2.0 / cap 8×).
> Parity: ALL PASSED.

> **Last-minute pass (2026-05-01 — submit-night). Todos `[~]` pendientes de validación de Rafa:**
>
> - **Sebastian L**: trajectory preview en el suelo durante el 1 s windup (línea crimson + acento amarillo) + hitbox más generosa (SAMPLES 12 → 18, reach +0.55 u). Sigue siendo high-risk pero ahora ACERTABLE.
> - **Cheeto L**: ramp DOUBLING `min(2^(N-1), 8)` → 1, 2, 4, 8, 8, 8 sobre 6 pulsos. Cada pulso pega claramente más fuerte que el anterior; el cap a 8× evita que el último sea absurdo dado el clamp de maxSpeed.
> - **Trunk K/L REDISEÑO TOTAL**:
>   - K → **Trunk Slam**: ground_pound radius 7 + force 50 + brief stun 1.0 s (`slamStunDuration` flag). Golpe amplio similar a Kowalski Frozen Floor footprint.
>   - L → **Trunk Grip** (movido desde K): yank al enemigo más cercano frontal (range 28, cone 35°) + stun 5.0 s.
>   - **Vulnerable multiplier 2× → 4×** global (sólo Trunk escribe stunTimer así que no afecta a otros). Un cabezazo a un target stunned manda ×4 más fuerte.
>   - Stampede / rammingL retirado.
> - **Kurama online invisibility cleanup**: cuando el K slot pierde `active`, force-zero `invisibilityTimer` en cada tick para todos los critters Kurama (mismo patrón que Sihans Burrow).
> - **Multi-tab nicknames**: sessionStorage fork. Si la pestaña pide un nick distinto del cached en localStorage, registra con tokens session-only → server crea row independiente, no colisión. Misma pestaña refresh = persiste vía sessionStorage. Mismo nick en dos pestañas sigue dando "nickname_active_in_room" error claro.
> - **Mobile landscape character select**: media query `max-height: 520` ahora pone preview + grid + info side-by-side compactos + overflow scroll fallback + anchor top.
>
> Sentinels: Trunk reshape K rad/force/slamStun + L gripStun.

> **Microfix pass (2026-05-01 — submit-day). Todos `[~]` pendientes de validación de Rafa:**
>
> - **Sebastian L** All-in ahora teleporta de verdad: HIT → posición justo antes de la víctima + velocidad cero (control vuelve limpio); MISS → endpoint × 1.5 más allá del rim + velocidad outward 130 (cae al void). Range 7 → 9, hitForce 100 → 110, missSelfForce 110 → 130. Cliente + server.
> - **Cheeto L** Cone Pulse ramp: pulso N usa `base × (1 + (N - 1) × 0.5)` — primero 1.0×, último 3.5×. Rising-edge reset del contador en cada activación (antes el segundo cast heredaba count stale). Radius 5.5 → 6.5 (catches escapees), force base 40 → 36. Cliente + server.
> - **Kurama K** alpha de invisibilidad 0.25 → 0.08 (casi invisible). Online sync nuevo: `handleAbilityFired` ahora spawnea decoy + setea `invisibilityTimer` en remotos cuando se detecta Kurama K. Pre-fix la invisibilidad era caster-local-only.
> - **Kurama L** Copycat UI: portrait swap → disco de color con la inicial del bichito target + tooltip. Más legible que el sprite-mini.
> - **Trunk K** range 6 → 28 u (4.7×) + cone half-angle 50° → 35° (frontal preciso largo, no global magnet). Cliente + server.
> - **Trunk L** Stampede ahora ramming: nuevo flag `rammingL: true` con `ramContactImpulse: 55` (simétrico a sawL). Cualquier contacto durante Stampede aplica impulso outward al otro critter. Mass 4.50 → 6.00, speed 1.65 → 1.85. Cliente + server.
> - **HUD sprites** activados (no afectan gameplay): SFX/music toggle, lives hearts (con skull para eliminados), bot-mask badge en lives HUD + waiting room, end screen crown/skull/trophy. Todos con emoji fallback si la sheet 404a.
>
> Sentinels actualizados: Trunk L spd 1.85 / mass 6.00. Sergei sin cambios.
> Parity: ALL PASSED.

> **Final polish pass (2026-04-30 — pre-deadline). Todos `[~]` pendientes de validación de Rafa:**
>
> Cambios per-personaje:
> - **Trunk** — headbuttBoost 1.0 → **3.0** (×3 sensación de cabezazo). J Ram: impulse 25→32, dur 0.42→0.55, speedMult 2.1→2.4 (recorre ~el doble). K Grip: stunDuration 2.0→**4.0** (+2 s). L Stampede: dur 3.0→4.0, speed 1.35→1.65, **mass 2.10 → 4.50** (battering ram), CD 18→20.
> - **Sergei** — L mass **1.75 → 5.50** (casi inamovible bajo frenzy, mass-ratio en physics ≈ 15 % del knockback recibido). No es invuln, es aguante.
> - **Shelly L Saw Shell** — sawContactImpulse **32 → 90** (expulsa brutalmente). Añadido `cancelAnimOnEnd: true` para cortar clip al terminar el spin. Base rotation ya restaurada vía `baseGlbRotationY` (fix anterior).
> - **Kowalski L Frozen Floor** — floorRadius **6 → 8**, floorDuration **5 → 7** (área mayor + 2 s).
> - **Kurama K Mirror Trick** — `slowDuringActive` 0 → **1.0** (Kurama puede moverse durante el clon). Decoy ahora snapshot world transform SYNC antes del teleport — el clon aterriza en la posición de cast aunque el clone async resuelva después.
> - **Kurama L Copycat HUD** — `setCopycatTarget(critterName)` agrega un sub-icono circular en el slot L cuando el local player es Kurama y `lastHitTargetCritter` es válido. Reusa sprite-hud-{critter} del selector.
> - **Cheeto L Cone Pulse** — pulseForce 28→40, pulseRadius 4.5→5.5, frenzyMassMult 1.05→**4.0** (anclado durante el channel). Cada pulso ahora spawnea VFX (shockwave ring + camera shake + sound), antes era invisible.
> - **Sebastian L All-in** — dirección lateral ahora elige el lado (right/left of facing) que LLEVA AL BORDE más cercano. Hit: force 60→**100** + Sebastian hard-stop (vx/vz=0). Miss: dashRange 5.5→7.0 + missSelfForce 38→**110** SET (no add) — sobrepasa el cap de maxSpeed → cae al void.
> - **Sihans L Sinkhole REAL HOLE** — al disparar, `arena.killFragmentIndices(getAliveFragmentsInDisc(...))` rompe los fragmentos bajo el disco del agujero. Centro inmune protegido a 3 capas (offset clamp + immune flag check + secondary check). Server picks indices, broadcasts via nuevo `arenaFragmentsKilled` event; cliente mirrors via `onArenaFragmentsKilled`.
>
> Cambios sistémicos:
> - **Status icons cleanup** — emparejado `disposeCritterStatus(c)` con cada `c.dispose()` en game.ts (8 sites). `clearAllCritterStatus()` añadido a `enterCharacterSelect` y `enterEnded`. Loop principal en main.ts skipea `setCritterStatus`/`updateAllStatusPositions` cuando `!game.isMatchPlaying()` — sin re-add post-end-screen.
> - **Online waiting room thumbnails** — `getCritterThumbnail` ahora carga animations + tickea idle clip 0.5 s antes del PNG snapshot, para que las miniaturas no salgan en T-pose.
>
> Sentinels actualizados:
> - Trunk: gripStun 4.0, L spd 1.65, mass 4.50.
> - Sergei: L mass 5.50.
> - Cheeto: L mass 4.0.
> Parity script pasa todos los checks.

> **Out-of-scope but cerrado entre tomas (no es habilidad pero estaba bloqueando QA visual):**
> - **Skybox 360 final** (`b054e96`). Cuatro iteraciones (camera-parented sphere → world-anchored sphere PBR → backdrop toggle hacks → cortes verticales en bordes) fallaron por interacciones entre depth/transparency/grazing-angle. Solución definitiva: `scene.background = equirectTexture` con `EquirectangularReflectionMapping` — pre-pass built-in de Three.js, full-screen guaranteed, sin meshes ni z-buffer involucrado. Eliminados: skydome esférico, backdrop screen-space, cloudsBelow plano. Las 5 panorámicas en `public/images/skyboxes/<id>.png` se enchufan vía `setSceneSkyboxTexture`.

> **Final L pass (2026-04-30 — deadline candidate). Todos `[~]` pendientes de validación de Rafa.**
>
> Schema additions:
> - `PlayerSchema.confusedTimer: number` (synced) — Toxic Touch status.
> - `PlayerSchema.lastHitTargetCritter: string` (synced) — Copycat last-hit tracker.
> - `ActiveZone.slippery / sinkhole / pullForce` flags + `isOnSlipperyZone(p, zones)` helper.
>
> Per-personaje:
> - **Shelly L Saw Shell** — frenzy 1.40/1.65 + flag `sawL`. Cliente: spin del `glbMesh.rotation.y` a 22 rad/s. Server + cliente offline: durante L active, contacto con cualquier alive non-immune empuja con impulse 32. Status icon 🔥 vía frenzy.
> - **Cheeto L Cone Pulse** — frenzy ROOTED (spd 0.0) 1.8 s + flag `conePulseL`. Cada `pulseInterval = 0.30 s` el server emite `lPulse` event y aplica knockback radial-en-cono (radius 4.5, half-angle 45°, force 28). Cliente offline + server lo replican. 🔥 frenzy icon.
> - **Sebastian L All-in Side Slash** — frenzy ROOTED 1.0 s windup. Al expirar, dash lateral (range 5.5, dirección perpendicular al facing). Hit → 60 force al target. Miss → self-knockback 38. Server + cliente offline. Broadcast `lAllInResolve` event.
> - **Kermit L Toxic Touch** — frenzy 1.30/1.30 + flag `toxicTouchL` + `confusedDuration: 3.0`. Contacto durante L active → set `target.confusedTimer = 3.0`. Server-side: invierte `data.inputMoveX/Z` mientras `confusedTimer > 0` (afecta humanos via input recv y bots via la misma ruta). Cliente offline: invierte input en `player.ts` y `bot.ts`. 🔁 status: `confusedTimer` añade icon ☠️ poisoned.
> - **Kowalski L Frozen Floor** — frenzy 1.10/1.10 + flag `frozenFloorL`. Spawn slippery zone radius 6, duración 5 s. Server + cliente offline: friction halfLife × 5 + accel × 0.35 cuando dentro *(el cliente offline solo tenía la fricción hasta 2026-09-24: ver grupo G6 en el header)*. Owner exempt. Status icon ❄️ frozen sobre afectados.
> - **Sihans L Sinkhole** — frenzy 1.15/1.50 + flag `sinkholeL`. Spawn hazard zone (radius 3, duración 5 s, pullForce 14) en `holeCastOffset = 4 u` delante. Centre-clamp a 4 u del origen. Pull continuo hacia centro + slow 0.55. Server tick + cliente `forEachSinkhole` aplican el pull. Owner exempt. 🐌 status icon.
> - **Kurama L Copycat** — frenzy 1.50/1.20 + flag `copycatL`. Lee `lastHitTargetCritter` (lo actualiza `resolveCollisions` en cliente y server). Si hay target, copia los flags L del kit del target en la def in-place + spawn zones si aplica. Si no hay target, fizzle silencioso (sigue dando el frenzy buff). Cooldown 16 s + fresh-hit requirement gate.
>
> Nota técnica importante:
> - El "AbilityType nuevo" se evitó: TODAS las L siguen siendo `frenzy` con flags. El dispatcher (`fireFrenzy`/`fireEffect`) se ramifica por flag. Mantenido por simplicidad y para evitar schema migration online.
> - All-in resolution offline detecta el edge `was active → not active` en `updateAbilities` y dispara `fireAllInResolution`.
> - Confused: server invierte input. Cliente invierte SOLO en offline path; en online el cliente envía raw input y deja que el server haga la inversión (evita double-flip).

> **Final K polish (2026-04-29 — Rafa QA #2). Todos `[~]` pendientes de re-validación de Rafa:**
> - **Sistema visual de estados (NEW)** — `src/hud/status-icons.ts`: DOM overlay billboard (no Three.js sprite). Catálogo de estados: `frozen ❄️` / `slowed 🐌` / `poisoned ☠️` / `stunned 💫` / `vulnerable 💥` / `frenzy 🔥` / `steel-shell 🛡️` / `decoy-ghost 👻`. Top-3 por prioridad. Driver en `main.ts` calcula el set por critter cada frame y proyecta posición a screen.
> - **Kowalski K**: cast 1.10 → 0.50 s. Slow al impactar 2 → 5 s. Cooldown 6.5 → 6.0. Frozen visual + ❄️ icon synced online via `slowTimer`.
> - **Sihans K (visual + bug)**: vortex remolino reforzado (3 inner rings ahora: ancho lento, medio counter, núcleo rápido). Bug invisibility online: `invisibilityTimer` se limpia en cada state-sync cuando el blink slot deja de estar activo (cap conservador 0.30 s en el handler también). Iconos slowed sobre afectados via zone detection.
> - **Kermit K (fog of war local)**: cuando el local critter está dentro de una zona poison, todos los OTROS critters fuera de la nube reciben `fadeAlpha = 0.10` (cliente-only). Critters dentro de la misma nube siguen visibles. Driver reset every frame en main loop.
> - **Cheeto K**: sin tocar (Rafa: "perfecta").
> - **Sebastian K**: force `38 → 76` (Rafa: "duplicar potencia"). Cono frontal y VFX intactos.
> - **Shelly K**: sin tocar (Rafa: "perfecta").
> - **Kurama K (lógica corregida)**: orden ahora correcto — primero spawnDecoy en posición original, después move backward (rotación + 180°) por `decoyEscapeDistance = 7 u`. NO más facing-forward / nearest-enemy seek. Server mirror. *(2026-09-24, grupo H5: vuelve a huir del enemigo más cercano, a menos de 10 u, pero girándose hacia él y saltando de espaldas; con el facing que sigue al movimiento, «atrás» llevaba a la Kurama que huía hacia su perseguidor)*
> - **Sergei**: K force `34 → 68` (Rafa: "doblar"). Headbutt boost `1.15 → 1.40` cliente + server.
> - **Trunk K REDESIGN — Trunk Grip** (Rafa: rediseño oficial):
>   - Nuevo flag `gripK: true` en AbilityDef. Al disparar:
>     1. busca enemigo más cercano en cono frontal (range 6 u, half-angle 50°)
>     2. lo arrastra a 1.6 u en frente de Trunk (snap, no lerp)
>     3. set `target.stunTimer = 2.0`. Mientras stunned: `effectiveSpeed → 0` (rooted, no input) + cualquier knockback recibido se duplica (vía `stunTimer > 0` checks en `resolveCollisions` cliente y server).
>   - Nombre actualizado en HUD a "Trunk Grip". Description: "Yank a frontal target close — stuns and exposes them".
>   - Server-authoritative end-to-end. Reusa `ground_pound` AbilityType con flag, sin AbilityType nuevo.

> **K-refinement (2026-04-29 — Rafa QA pass). Todos `[~]` pendientes de re-validación de Rafa:**
> - **Kowalski K**: cast 0.20 → 1.10 s ("1s más antes de lanzar"), cooldown 5.5 → 6.5. Frozen visual sobre target afectado (cyan emissive pulse en `Critter.updateVisuals` mientras `slowTimer > 0`).
> - **Sihans K**: distancia 3.5 → 6.5. Visual quicksand: 2 inner rings rotando en sentidos opuestos (1.2 / -2.6 rad/s) sobre el disc base. Tint amber sobre enemigos atrapados.
> - **Kermit K**: zone duration 2 → 10 s, cooldown 7 → 16 s. 14 puff-spheres flotantes en la nube (icospheres transparentes con bobbing). Kermit immune a su propia nube via `ownerKey` en zone (offline + server). Overlay screen-space duplicado: layer interna (tint verde sutil, screen blend) + layer externa (vignette denso multiply blend) → fuera de la nube se oscurece a casi negro.
> - **Cheeto K**: blink ahora seek nearest enemy en `blinkSeekRange = 9 u`, aterriza `blinkSeekOffset = 1.4 u` antes del target. Fallback al facing-blink si no hay target. Impact rad 2.6 → 3.2, force 36 → 48.
> - **Sebastian K**: duration 0.05 → 0.45 (clip Ability2 puede reproducirse). VFX frontal nuevo: half-radius palette ring + 9-puff dust fan distribuidos en el cono frontal. No más shockwave 360° cuando hay coneAngleDeg.
> - **Shelly K**: duration 5 → 4 s. Nuevo `selfAnchorWhileBuffed: true` → `effectiveMass × 9999` cliente y server. `resolveCollisions` cambiado a separar por mass-ratio (Shelly anchored = 0 % displacement, atacante = 100 %). Anchored bounce: incluso con eitherImmune skip, el atacante recibe velocity bounce de `normalPushForce × 1.4` para que rebote.
> - **Kurama K**: duration 1.6 → 2.8 s, cooldown 7 → 9 s. Nuevo `decoyEscapeDistance: 7.0` → Kurama teleporta 7 u alejándose del enemigo más cercano (fallback facing). Decoy se queda en posición original. 6 puffs en posición de aparición.
> - **Trunk K + Sergei K**: sin tocar (Rafa OK). Sentinels parity verifican que NO han driftado.

> **K-session 1 (2026-04-29) — autorial K por personaje. Todo `[~]` pendiente de validación de Rafa.**
> - **Kowalski K Snowball PROYECTIL** — sistema de proyectiles real (cliente + server + parity). Server-authoritative: `BrawlRoom.activeProjectiles` integra posición, hace sweep collision contra críters no-owner, aplica knockback + `slowTimer = 2 s` + 50 % move-speed slow. Eventos `projectileSpawned` / `projectileHit` / `projectileExpired` broadcasted al cliente. Nuevo `AbilityType: 'projectile'`, nuevo módulo `src/projectiles.ts` con `spawnLocalProjectile` / `pushNetworkProjectile` / `removeProjectile` / `tickProjectiles`. Schema online: `PlayerSchema.slowTimer` añadido. Bot AI: tag `'ranged'` con condición 4..14 u y 0.022 prob/tick.
> - **Kermit K Poison Cloud + visión local** — overlay screen-space CSS (no shader, evita issues de z-fighting que tuvo el skybox). `ZoneVfxKind` discriminator (`poison`/`sand`/`ice`/`generic`) en `ActiveZone`. `setPoisonOverlayIntensity(t)` en main.ts gestiona un `<div>` radial-gradient toxic-green con `mixBlendMode: multiply` y CSS `transition: 200ms`. main.ts loop comprueba `isInsideZoneOfKind(localX, localZ, 'poison')` cada frame.
> - **Sihans K Burrow visual** — fade total (alpha 0) durante 0.30 s + 8 dust-puffs en origen + 8 en destino. Cliente only — server gameplay (blink + zone-at-origin) no cambia. Online viewers reciben mismo beat desde `abilityFired` event filtrado por `c.config.name === 'Sihans'`.
> - **Cheeto K bump** — `blinkImpactRadius 2.2 → 2.6`, `blinkImpactForce 28 → 36` (Rafa: "ajustar si se siente débil").
> - **Sebastian K Claw Wave** — validado: el cone (`coneAngleDeg: 60`) filtra knockback a ±60° del facing en cliente y server. Lectura visual sigue como ring radial — VFX semicircular es scope creep documentado en versión `[~⚠]`.
> - **Shelly K Steel Shell** — invulnerabilidad 5 s ya en su sitio desde v0.11. **GLB inspeccionado**: 11 submeshes nombrados `Mesh_0.001` … `Mesh_10.001` (genéricos), joints sí semánticos (`Head`, `L_Hand`, etc.). Ocultar cabeza/patas selectivamente requiere mapping bone→mesh (no trivial; weight inspection offline) — sigue `[!]` con causa demostrada.
> - **Kurama K Mirror Trick + bot confuse** — bots offline + server ahora **skipean a Kurama como target** mientras `immunityTimer > 0` (la misma flag que escribe Mirror Trick via `selfImmunityDuration: 1.6`). Otros críters mantienen targeting normal en su immunity post-respawn — solo Kurama tiene la "lost-the-scent" treatment.

---

## Arreglos transversales

- [~] **J/dash anim sync**: `cancelAnimOnEnd: true` añadido a TODAS las charge_rush. La animación se corta a idle/run cuando el dash termina. Cubre Trunk, Sergei, Kurama, Shelly, Kermit, Sihans, Kowalski, Cheeto, Sebastian.
- [~] **Headbutt feedback per-critter**: nuevo campo `headbuttBoost` en `CritterConfig` (multiplicador local del impulso de cabezazo + shake escalado). Aplicado a Sergei (1.15×), Kowalski (1.20×), Cheeto (1.30×), Sebastian (1.45×). Trunk/Kurama/Shelly/Kermit/Sihans se quedan en 1.0× (Rafa los marcó OK o decentes).
- [~] **Sergei mesh bug — fix real (2026-04-29)**: la causa era que `attachGlbMesh` forzaba `transparent: true` permanentemente sobre cada material del GLB (para soportar el blink de inmunidad). Eso dejaba el alpha-sort path activo siempre — y en GLBs skinned multi-submesh (Sergei es el peor caso) el alpha-sort no puede ordenar consistentemente triángulos skinned que se intersectan, así que parches de gorila se renderizaban detrás de otros parches del mismo mesh ("becoming see-through"). Fix: arrancar con `transparent: false` + `depthWrite: true`, dejar que `updateVisuals` flippee a `transparent: true` SOLO durante los frames de blink/invisibility, y vuelva a opaco al terminar. Pendiente validación de Rafa.

---

## Sergei

- [~] **Headbutt** — boost ×1.15 (impulse + shake)
- [~] **J Gorilla Rush** — sin cambios (Rafa: perfecta) + cancelAnimOnEnd
- [~] **K Shockwave** — sin cambios (Rafa: perfecta)
- [~] **L Frenzy buffada** — `frenzySpeedMult 1.45 → 1.55`, `frenzyMassMult 1.50 → 1.75`. Más empuje y velocidad sin tocar identidad gorila.
- [~] **Mesh bug — fix real aplicado (2026-04-29)**: cambio root-cause en `attachGlbMesh` para arrancar con `transparent: false`. Detalle en sección "Arreglos transversales". Pendiente validación.

---

## Trunk

- [~] **Headbutt** — sin boost (decente per Rafa)
- [~] **J Trunk Ram más larga/potente** — `impulse 20 → 25`, `duration 0.35 → 0.42`, `massMultiplier 3.5 → 4.0`. Recorre ~25 % más distancia con más knockback. Sigue siendo pesado.
- [~] **K Earthquake real** — `force 40 → 48`, `radius 4.5 → 4.8`, shake aumentado (groundPound shake × 1.25 cuando `def.shakeBoost` está set). Wind-up sigue 0.60 s.
- [~] **L Stampede más fuerte** — `frenzySpeedMult 1.25 → 1.35`, `frenzyMassMult 1.80 → 2.10`.
- [~] **L animación no colgada** — `cancelAnimOnEnd: true` añadido al frenzy de Trunk para cortar la animación de carga al terminar el buff (el clip Ability3GroundPound tail era el síntoma).

---

## Kurama

- [~] **Headbutt** — sin cambios (Rafa: muy bien)
- [~] **J Fox Dash** — sin cambios mecánicos + `cancelAnimOnEnd: true`. Animación corta al terminar dash.
- [~] **K Mirror Trick** (IMPLEMENTADO 2026-04-29): durante 1.6 s tras pulsar K, Kurama se vuelve **semi-invisible** (alpha 0.25) Y queda inmune a knockback (`immunityTimer` extendido). El "decoy" se spawna como un clon estático del mesh GLB en la posición de origen (SkeletonUtils.clone + tinted violet alpha 0.4, fade-out 30 % final, dispose automático; *2026-09-24, G7: el clon es opaco, sin tinte y con contorno hasta el fundido, y su vida va con el reloj del juego*). Cliente: alpha + decoy + emissive. Server: `immunityTimer = 1.6 s` via `selfBuffOnly + selfImmunityDuration`. **Bot confuse (K-session 1)**: bots offline (`src/bot.ts`) y server (`server/src/sim/bot.ts`) **skipean a Kurama como target** mientras `immunityTimer > 0` — mismo flag que el trick escribe. Otros críters mantienen targeting normal en su immunity post-respawn. Lectura "lost the scent" exacta como Rafa pidió.
- [~] **L Copycat** *(shipped 2026-04-30 final-L + HUD chip 2026-05-01 — see header)* — Histórico v0.11: NO implementado. Sustituido temporalmente por `Nine-Tails Frenzy` (la versión actual). El sistema necesario (last-hit tracker + ability dispatch por nombre + restricción de uso único) requiere ~2-3 h de trabajo y schema online nuevo. Documentado para post-entrega. **Marcado [!] explícitamente.**

---

## Shelly

- [~⚠] **Headbutt** — sin cambios (Rafa: decente)
- [~⚠] **J Shell Charge** — `duration 0.45 → 0.55`, `impulse 15 → 18`. Más distancia. **Recorte**: no se ocultan visualmente cabeza/patas durante el dash — la inspección de los nodos del GLB muestra que Shelly NO tiene submeshes nombrados separadamente para shell vs cabeza/patas (mesh único `tripo_part_*`). Documentado en checklist.
- [~⚠] **K Steel Shell** (IMPLEMENTADO): REEMPLAZA el slam. Durante 5 s: rooted (`slowDuringActive: 0`) + `immunityTimer = 5 s` server-authoritative (no recibe knockback online ni offline). Visual: emissive override `0xa8c0d0` (metallic blue-gray). Implementado como `ground_pound` con `selfBuffOnly: true` + `selfImmunityDuration: 5.0` + `selfTintHex: 0xa8c0d0` — sin nuevo AbilityType. Cooldown 12 s.
- [!] **K cabeza/patas ocultas** — NO posible sin submeshes nombrados. Compensado con el emissive metálico fuerte. Shelly se LEE como "encerrada", aunque la silueta sigue mostrando cabeza/patas.
- [~] **L Saw Shell rotation** *(shipped 2026-04-30 final-L: spin `glbMesh.rotation.y` 22 rad/s + contact impulse, subido a 90 en final-polish — see header)* — Histórico v0.11: NO implementado. Rotation animation logic (rotar el GLB sobre Y rápidamente) requiere modificar el animation loop o aplicar una rotación frame-by-frame durante la duración del frenzy. El frenzy tinted actual (verde tank) se mantiene como Berserker Shell con stats ya dispuestos. Marcado [!] para post-entrega.

---

## Kermit

- [~] **Headbutt** — sin cambios (Rafa: bueno)
- [~] **J Leap Forward** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Poison Cloud** — zona slow (rad 5.0 / 2.0 s / 60 % slow) clasificada como `vfxKind: 'poison'` para que el overlay local se active.
- [~] **K inside-cloud vision (2026-04-29)** — overlay screen-space CSS implementado: `<div id="poison-overlay">` zIndex 15, radial-gradient transparente al centro → toxic-green denso al borde, `mixBlendMode: multiply`, `transition: opacity 0.20s`. main.ts loop comprueba el local critter contra `isInsideZoneOfKind('poison')` cada frame y feed 0/0.85. CSS evita los issues de z-fighting que el skybox tuvo con shader quads.
- [~] **L Hypnosapo / Toxic Touch** *(shipped 2026-04-30 final-L: `toxicTouchL` + `confusedTimer` synced + input inversion server-side — see header)* — Histórico v0.11: NO IMPLEMENTADO en v0.11. La L actual sigue siendo el frenzy custom de v0.10 (slow + heavy). Implementar el status "poisoned" + invert input requiere nuevo schema online (status flag en PlayerSchema), código de física para invertir movement input, y VFX en target afectado. Marcado [!] para sesión L dedicada.

---

## Sihans

- [~] **Headbutt** — sin cambios (Rafa: perfecto)
- [~] **J Burrow Rush** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Burrow + Quicksand (2026-04-29 visual layer)** — REEMPLAZA el pound. Sihans hace blink (3.5 u en facing; 6.5 u desde el K-refinement del 2026-04-29) Y suelta una zona de slow en su POSICIÓN ORIGINAL (radius 3.5, 2.5 s, 50 % slow). Visual mejorado en K-session 1: cuando se dispara el blink con `zoneAtOrigin: true`, Sihans **se vuelve totalmente invisible** durante 0.30 s (alpha 0, distinto del 0.25 ghost de Kurama) + 8 dust-puffs en origen + 8 en destino. Lectura "se hundió en una nube de tierra, sale en otra nube de tierra". ~~Server clamp asegura no aparecer en void.~~ *(Falso: el recorte a 11,6 u no miraba los sectores hundidos y Sihans caía. Desde 2026-09-24 el destino retrocede hasta suelo vivo, ver grupo G5 en el header.)*
- [~⚠] **L Sinkhole con preview / double-tap** *(shipped 2026-04-30 en versión simplificada: cast-offset fijo 4 u delante SIN preview/double-tap, final-L; + REAL HOLE rompiendo fragmentos en final-polish — see header)* — Histórico v0.11: NO implementado. El sistema de targeting con preview + confirmación de doble pulsación requiere un modo de input nuevo y UI de preview. Marcado [!]. La L actual sigue siendo Diggy Rush (frenzy tank earth-tinted) hasta post-entrega.

---

## Kowalski

- [~] **Headbutt** — boost ×1.20
- [~] **J Ice Slide** — `cancelAnimOnEnd: true`; desde 2026-09-24 desliza de verdad (`slideFrictionMult: 3`, unas 4,7 u más que correr frente a 1,6; ver grupo H7 en el header)
- [~] **K Snowball PROYECTIL (2026-04-29)** — IMPLEMENTADO autorial. *(2026-09-24: clip a 3,5× (`clipPlaybackRate`) para que la aleta suelte la bola en el fotograma en que nace; ver grupo H7.)* Nuevo `AbilityType: 'projectile'`. Server-authoritative end-to-end:
  - **Server**: `BrawlRoom.activeProjectiles` Array, `tickPlayerAbilities` devuelve `projectileSpawns`, BrawlRoom integra cada tick (vx/vz fixed at fire), sweep collision contra todos los players alive non-owner non-immune con reach `pr.radius + 0.55`, on hit: knockback impulse + `victim.slowTimer = max(slowTimer, 2.0)`, broadcast `projectileHit`. TTL 1.2 s o salida del arena → `projectileExpired`.
  - **Cliente**: `src/projectiles.ts` nuevo módulo con sphere geometry shared + per-instance ice-blue emissive material. Offline: `spawnLocalProjectile` + `tickProjectiles` hace mismo sweep. Online: `pushNetworkProjectile` registra para mirror visual, `removeProjectile` despawn on server hit/expired.
  - **Schema**: `PlayerSchema.slowTimer: number` añadido. `effectiveSpeed` (cliente + server) multiplica por 0.5 cuando > 0.
  - **Bot**: tag `'ranged'` en `AbilityTag`. Bots offline + online evalúan condición 4..14 u y disparan con 0.022 prob/tick.
  - **Parity**: nuevo branch `kind: 'projectile'` en `verify-ability-parity.mjs` valida speed/ttl/radius/impulse/slowDur/wU/CD bit-for-bit.
- [~] **L Blizzard / Frozen Floor** *(shipped 2026-04-30 final-L: `frozenFloorL` + zona slippery, radius 6 → 8 y duración 5 → 7 s en final-polish — see header)* — Histórico v0.11: NO IMPLEMENTADO. La L actual (Blizzard frenzy) sigue siendo buff personal. Para zona de hielo deslizante necesito extender el zone system con `slippery: boolean` flag (acceleration × 0.3, control reducido). Marcado [!] para sesión L dedicada.

---

## Cheeto

- [~] **Headbutt** — boost ×1.30 (más rápido + más shake)
- [~] **J Pounce** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Shadow Step + impact** — blink (v0.10) + knockback radial en destino. **K-session 1 bump (2026-04-29)**: `blinkImpactRadius 2.2 → 2.6`, `blinkImpactForce 28 → 36` (Rafa: "ajustar si se siente débil"). Cheeto NO recibe self-pushback. Mantiene rooting durante blink window.
- [~] **L Tiger Roar / Cone Pulse** *(shipped 2026-04-30 final-L; rediseñado 2026-05-01 BLOQUE FINAL como cono frontal con ondas expansivas + ramp doubling — see header)* — Histórico v0.11: NO implementado. Cone-shaped repeating knockback durante channeling es una mecánica nueva. La L actual sigue siendo Tiger Rage (frenzy corto y rápido). Marcado [!] post-entrega.

---

## Sebastian

- [~] **Headbutt arreglado** — boost ×1.45 (el más alto del roster). Combinado con su mass × 0.75 base y `headbuttForce 16`, el cabezazo de Sebastian ahora es la firma más violenta de las distancias cortas.
- [~] **J Claw Rush más fuerte** — `impulse 28 → 33`, `massMultiplier 1.4 → 1.7`. Más knockback al cargar.
- [~⚠] **K Claw Wave (frontal)** — REEMPLAZA el pound radial. Implementado como un **ground_pound direccional con cone**: solo aplica knockback a críters dentro de un cono de ±60° alineado con el facing de Sebastian (radius 3.5, force 38). VFX: el shockwave ring se reemplaza por un **disco semicircular orientado al frente** (custom shader simple — half-disc). Cooldown 6.5 s. **Recorte**: la onda no es un proyectil que viaje; es un cone-restricted instant pound (escala fácil, server-authoritative trivial).
- [~] **L All-in Side Slash** *(shipped 2026-04-30 final-L; iterado en final-polish + microfixes y convertido a hold-to-fire con ground preview en 2026-05-01 BLOQUE FINAL — see header)* — Histórico v0.11: NO implementado. La mecánica multi-fase (windup vibrante + side dash con hit detection durante movimiento + miss → self-fail/fall) requiere un mini state-machine de ability y modificación de la integración de física. La L actual sigue siendo Red Claw (frenzy corto). Marcado [!] post-entrega como prioridad.

---

## QA final

Ejecutado:
- [~] `npm run check` — verde
- [~] `npm run build` — verde
- [~] server `tsc --noEmit` — verde
- [~] `verify-ability-parity.mjs` — actualizado y verde
- [ ] Smoke offline manual — pendiente Rafa
- [ ] Smoke online — pendiente Rafa
- [ ] Validación caracter por caracter — pendiente Rafa

Bot AI:
- [~] Tags inalterados (mobility / aoe_push / buff / steel_shell). El nuevo tag `steel_shell` se interpreta como defensive — los bots intentan usarlo cuando reciben golpes, fallback a `aoe_push` si no.

Schema online:
- [~] AbilityType inalterado — todas las K nuevas reusan `ground_pound` o `blink` con flags adicionales. **Cero cambios de schema** sobre v0.10. *(Superado después: K-session 1 añadió `AbilityType: 'projectile'` + `PlayerSchema.slowTimer` — see header.)*
- [~] Status flags NO añadidos — el `immunityTimer` existente cubre Shelly Steel Shell + Kurama Mirror Trick; no hicimos falta poisoned/slippery porque las habilidades que los necesitaban quedaron diferidas a [!]. *(Superado después: el final-L pass de 2026-04-30 añadió `confusedTimer`, `lastHitTargetCritter` y los flags `slippery/sinkhole/pullForce` en ActiveZone; el BLOQUE FINAL añadió `nickname` — see header.)*

Pending — genuinamente abierto (reconciliado 2026-08-16, H0 doc-sync):
1. **Shelly — hide head/legs (Steel Shell / Saw Shell)** `[!]` — limitación del GLB: sin submeshes nombrados shell vs cabeza/patas; requiere mapping bone→mesh offline (ver K-session 1). Compensado con emissive metálico.
2. **Sergei mesh bug — validación** — fix root-cause aplicado (`transparent: false` por defecto en `attachGlbMesh`, 2026-04-29); falta que Rafa confirme que el see-through no reaparece.
3. **Pase de validación manual de Rafa de TODOS los items `[~]`/`[~⚠]`** — los passes finales (final-K, final-L, final-polish, microfixes 05-01, BLOQUE FINAL) entraron sin pase manual completo; smoke offline/online + validación caracter-por-caracter siguen `[ ]` arriba.

<details>
<summary>Lista v0.11 original (histórica — 9 de sus 11 items acabaron shipped antes de la entrega, ver header)</summary>

1. Sergei mesh bug — fix preventivo aplicado, validar Rafa *(→ sigue abierto como validación, item 2 arriba)*
2. Kurama L Copycat (sistema de last-hit + ability dispatch) *(shipped 2026-04-30)*
3. Shelly L Saw Shell rotation (rotation animation logic) *(shipped 2026-04-30)*
4. Shelly visual hide head/legs (limitación GLB — sin submeshes) *(→ sigue abierto, item 1 arriba)*
5. Sihans L Sinkhole con preview/double-tap *(shipped 2026-04-30 sin preview/double-tap — `[~⚠]`)*
6. Cheeto L Tiger Roar cone pulse (channeling cone repeat) *(shipped 2026-04-30 + rediseño 05-01)*
7. Sebastian L All-in Side Slash (multi-fase + miss-fail) *(shipped 2026-04-30 + hold-to-fire 05-01)*
8. Kermit K inside-cloud vision overlay (screen-space mask) *(ya estaba implementado el 2026-04-29 — item obsoleto incluso en v0.11)*
9. Kermit L poison-touch + inverted controls (status system) *(shipped 2026-04-30)*
10. Kowalski K Snowball como proyectil real *(ya implementado el 2026-04-29, K-session 1 — item obsoleto incluso en v0.11)*
11. Kowalski L Frozen Floor / slippery zone *(shipped 2026-04-30)*

</details>
