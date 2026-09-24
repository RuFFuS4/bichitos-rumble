# Informe del repaso de habilidades (síntesis, 2026-09-24)

> Foto del momento: nueve revisores, un escéptico por bicho y una síntesis, antes de aplicar nada. Qué se arregló y qué falta está en [`REPASO_HABILIDADES.md`](REPASO_HABILIDADES.md). Las rutas `.tmp/…` son de las pruebas locales del worktree de PERSONAJES y no están en el repo.

**Antes de medir nada:**
- El servidor de capturas 5182 sirve código antiguo. Usa `vite.snapshot.config.mjs` con `watch.ignored: ['**/*']` y en la página `K.moveX` sale undefined. Hojas, sondas y tanda se grabaron con la orientación anterior a 9019794, en la que el retroceso del cabezazo giraba al bicho 180°.
- El laboratorio no conecta el arena, así que el Sinkhole no ha abierto agujero en ninguna captura, tanda ni golden.
- Las cifras de balance son de bots offline y cargan con esos dos sesgos. Sirven para ordenar prioridades, no para afinar números.

**Etiquetas de carril:**
- **[tdn]**: tierra de nadie (game.ts, main.ts, frame-ticks.ts). Hay que pedir permiso.
- **[dist]**: carril distribución (BrawlRoom.ts, network-events.ts, protocolo). Aviso en su buzón y despliegue de cliente y servidor a la vez.
- **[arena]**: carril arena.
- **[interfaz]**: status-icons, status-legend, i18n.
- Sin etiqueta: carril personajes, que incluye `server/src/sim/*`.

---

## 1. Patrones transversales

1. **Offline, las habilidades no respetan la inmunidad; el servidor sí.** Pasa en el bucle radial y de cono de fireGroundPound, en la elección de objetivo del Grip, en el impacto del blink y en el tirón del Sinkhole.
   - Rompe Steel Shell: hubo 25 saltos con Shelly anclada, 20 de ellos por K enemigas, y Trunk Slam la lanza a 20 u/s.
   - Rompe también Mirror Trick y la inmunidad al reaparecer.
   - Como checkFalloff no deja caer a un inmune, el que sale empujado se queda flotando sobre el vacío.
   - Hallazgos: SERGEI-1, TRUNK-3, SHELLY-1, KERMIT-9, CHEETO-5, SEB-8a, SIHANS-8a.
2. **Las velocidades de clip de ANIMATION_OVERRIDES no se aplican nunca a las habilidades.** `clipPlaybackRate ?? 1` siempre tiene valor y gana a `meta.speed`. Son unas 19 entradas en 8 bichos: lo que Rafa afina en anim-lab no llega al juego desde 47728db. Explica los clips desfasados de Sergei K/L, Trunk L, Sebastian K, Sihans J/L y Kowalski.
3. **Todo empujón por encima de maxSpeed (20) integra un paso entero antes del tope.** Por eso el resultado depende de los Hz:
   - la K de Sergei empuja un 27 % menos a 144 Hz;
   - online, a 30 Hz, la K empuja un 29 % más, el cabezazo de Trunk sobre Sergei un 67 % más y Cone Pulse 10,8 u frente a 5,8;
   - a 60 Hz se ve como un teletransporte: 6,1 u en un solo paso en el combo Grip→cabezazo, y Sergei atraviesa a Trunk con el pulso ×4.
   - Además, el tope aplana la potencia: K de fuerza 76, 68 y 50 empujan todas entre 1,42 y 1,66 u, y el frenesí da +80 % de impulso pero solo +27 % de distancia.
4. **El hit stop no congela tickLOffline, tickProjectiles ni tickAbilityZones**, que reciben el dt crudo después de game.update.
   - La sierra de Shelly suma +90 en cada fotograma y llega a 599 u/s (9 casos, todos a exactamente 1,10 u).
   - Cone Pulse mete pulsos de más.
   - Las bolas de nieve siguen volando con el mundo parado.
5. **tickLOffline también corre online** sobre los bichos que llegan del servidor. Cone Pulse sale dos veces y Kermit escribe un `confusedTimer` predicho que hace parpadear el ☠️.
6. **Caer no limpia ningún estado:**
   - el aturdido, la confusión y la ralentización sobreviven a la reaparición;
   - las habilidades activas siguen después de reaparecer (Cone Pulse en 9 de 58 usos);
   - el jugador puede armar J o K mientras cae, y se disparan al reaparecer;
   - Sebastian puede lanzar el All-in desde el vacío y eliminar a quien lo tiró.
7. **Online no hay feedback de impacto en ninguna víctima, y el evento `abilityFired` se queda corto:**
   - no dice qué ranura se usó;
   - la posición se toma después del efecto, así que el blink y Mirror Trick pintan el origen en el destino;
   - todo ground_pound sale como un aro de 3,5 u con hit stop, aunque falle.
8. **Hay diferencias de enraizado y de giro entre cliente y servidor que ningún script detecta:**

   | Qué | Cliente | Servidor |
   |---|---|---|
   | Carga de las K (ground_pound) | 0,15 | 0 |
   | Carga de las L (frenzy) | 0,1 | 1,0 |
   | Giro durante la J (steerFactor) | 0,15 | no existe (el Ram recorre unas 5 u más online) |
   | Mirror Trick | se mueve | enraizado 2,8 s |

   `feel-sim-parity` da verde comparando constantes que nadie usa.
9. **La IA elige habilidad por etiqueta y se queda con la primera que coincide.** Por eso Trunk Grip, Sand Trap y Shadow Step tienen 0 lanzamientos en 72 grabaciones; el registro funciona bien.
10. **Las J no golpean.** El contacto del dash es el roce normal: empuja entre 0,13 y 0,72 u, sin destello.
11. **Varios efectos usan reloj de pared** (`performance.now`): los anillos de zona, el señuelo de Kurama y la línea del All-in. Tras una pausa la zona sigue frenando sin verse, y la nube de Kermit sobrevive a un reinicio. Online, el tipo y el color de la zona salen del nombre del lanzador, no del tipo de zona.
12. **El brillo de estado es genérico.** Toda L se pinta con el pulso rojo y 🔥, y la carga de la K y la de la L usan el mismo amarillo en los 9 bichos.
13. **Copycat modifica la definición compartida** (en cliente y en servidor, donde la comparten todas las salas). Cualquier campo nuevo de una L tiene que ir en la lista de copia o en FEEL.

---

## 2. Arreglos (bugs y paridad), por prioridad

Orden de trabajo: commitear antes la rama de locomoción y orientación. Después, el corte A con un solo `golden:write` + `golden` 3/3 anotado en BUILD_LOG (el testigo del golden es de este carril), y luego B, C y D.

### Corte A: bugs altos

**A1. Inmunidad offline** (patrón 1)
- `abilities-runtime.ts:287` → `if (other === critter || !other.alive || other.falling || other.isImmune) continue;`. Quitar el `!other.isImmune` que sobra en :308.
- En :240 (elección de objetivo del Grip), el mismo filtro, para que Trunk agarre al siguiente en vez de fallar. En :268 → `target.stunTimer = Math.max(target.stunTimer, def.gripStunDuration ?? 2.0);`.
- En :743 (impacto del blink), el mismo filtro. En el callback de forEachSinkhole (:583-594) → `if (c.isImmune) return;`.
- Caso nuevo en lab o golden: Trunk Slam y Shockwave contra Shelly en Steel Shell deben dar desplazamiento 0 y aturdido 0.

**A2. Caída y reaparición** (patrón 6)
- `critter.ts startFalling()` (~:1194-1213): nuevo `cancelActiveAbilities()`. Para cada estado activo: `active=false; windUpLeft=0; durationLeft=0; cooldownLeft=def.cooldown`. Además `lHoldCharging=false; lHoldChargeTime=0; lastAbilityActive.fill(false)`, para que el flanco de bajada no corte el clip de reaparición.
- `critter.ts respawnAt()` (~:1222-1256): `stunTimer = confusedTimer = slowTimer = 0`.
- `player.ts:18` → `if (!critter.alive || critter.falling) { critter.lHoldCharging = false; critter.lHoldChargeTime = 0; return; }`. En `fireAllInResolution` (~:1040), `if (critter.falling) return;` como red de seguridad.
- [tdn] `frame-ticks.ts:37`: computeCritterStatuses devuelve el conjunto vacío si `c.falling`.
- [dist] Bloque de reaparición (`BrawlRoom.ts:1565-1581`): `p.stunTimer = p.confusedTimer = p.slowTimer = 0`. Donde se pone `falling = true` (`sim/physics.ts:216`, `BrawlRoom.ts:1458`) y en la rama de caída del bucle de carga (`BrawlRoom.ts:998`): cancelar las `p.abilities` activas y `data.pulseLastActive = data.lHoldCharging = data.allInActive = data.lHoldPrevInput = false`.

**A3. Que el hit stop congele los ticks compartidos, y la sierra de Shelly** (patrón 4)
- `gamefeel.ts applyHitStop`: guardar `frozenThisFrame = hitStopTimer > 0` antes de descontar y exportar `isFrameFrozen()`. tickLOffline, tickProjectiles y tickAbilityZones salen al principio si el fotograma está congelado. Así no hace falta tocar frame-ticks.
- Sierra (`abilities-runtime.ts:550-564`):
  - enfriamiento por pareja `FEEL.abilities.contactRehitCooldown: 0.3`, con un WeakMap. Va en FEEL y no en la definición, por Copycat. Es compartido por sierra, embestida y toque tóxico;
  - fijar la velocidad en vez de sumarla: `other.vx = nx*impulse; other.vz = nz*impulse`.
- [dist] El mismo cambio en `BrawlRoom.ts:1318-1331`.

**A4. Copycat** (KURAMA-1 y KURAMA-2)
- `abilities.ts`: `export const COPYCAT_KEYS = [...] as const`, **sin** `allInL/allInDashSpeed/allInDashRange/allInHitForce/allInMissSelfForce`. Hoy copiar a Sebastian acaba en suicidio si falla o en eliminación segura si acierta; está reproducido.
- fireFrenzy recibe el estado y hace `state.def = src ? { ...base, ...pick(src, COPYCAT_KEYS) } : base; critter.lastHitTargetCritter = '';`. Las ramas que siguen leen `state.def`. Al terminar, `if (s.def.copycatL) s.def = base`.
- **No** clonar las definiciones en createAbilityStates: rompe el afinador de la barra lateral (`sidebar.ts:1325/1410`).
- Servidor (`sim/abilities.ts:621-706`): un override por jugador en los datos internos de la sala, vaciar `lastHitTargetCritter` antes de **cada** return (:671-701) y ofrecer `getLDef(p, data)`. [dist] Usarlo en `BrawlRoom.ts:1212-1213` y `:1401-1402`.

**A5. El Sinkhole se come la baldosa de Sihans** (16,7 % de los lanzamientos; reproducido: cae y pierde una vida). El lab no tiene arena.
- `src/tools/main.ts:78`: `setArenaForAbilities(game.arena)`. La versión limpia, con permiso [tdn], es ponerlo en el constructor de Game (`game.ts:212`) y quitar `main.ts:311`.
- Añadir a ArenaForAbilities (`abilities-runtime.ts:46-49`) `getLayout()` e `isOnArena()`. En fireFrenzy (:912-917): `const under = lay ? lay.fragments.findIndex(f => pointInFragment(critter.x, critter.z, f)) : -1;` y filtrar `i !== under`. `pointInFragment` viene de arena-fragments, que es un módulo puro.
- [dist]+[arena] El mismo filtro en `BrawlRoom.ts:1109-1115` usando `p`, más un getter del layout en ArenaSim.
- Va junto con conectar el arena: si se conecta sin este arreglo, la tanda mide los autoagujeros.

**A6. Aterrizajes sobre el vacío.** Sand Trap cae al vacío (reproducido) y Mirror Trick anda 1,8 s sobre el vacío mientras es inmune.
- Helper `pickSafeLanding(...)` en cliente y en sim:
  - blink (`abilities-runtime.ts:721-726`; sim :822-826): retroceder por la línea en pasos de 0,5 u hasta encontrar suelo vivo; si no hay, quedarse en el origen (la zona se suelta igual);
  - Mirror Trick (`:189-196`; sim :872-879): `decoyEscapeFallbacks: [1, 0.7, 0.4]` en la definición.
- [dist] BrawlRoom pasa `(x,z) => this.arenaSim.isOnArena(x,z)`.
- Corregir el comentario «never land in the void» y `ABILITY_QA_CHECKLIST.md:237`, que además dice 3,5 u cuando son 6,5.

**A7. All-in de Sebastian**
- La caja de acierto alcanza por detrás: el barrido cubre de −1,15 a 10,65 u, y está reproducido que elimina a quien está pegado a su espalda. En `abilities-runtime.ts:1063-1078` y [dist] `BrawlRoom.ts:1422-1437`: contar solo objetivos con `dot(d, dir) >= 0` y poner el margen lateral en config.
- Fallar no garantiza caer: desde el borde mirando al centro es un escape de unas 17 u, y si Sebastian es inmune flota 1,45 s. En `:1128-1134` y `BrawlRoom.ts:1470-1474`: recorrer la línea en pasos de `FEEL.allIn.missProbeStep = 0.5` hasta el primer punto fuera de la arena, teletransportar ahí y llamar a `startFalling()` explícitamente, ignorando la inmunidad. Quitar el ×1,5.

**A8. Mirror Trick se ve al revés.** La Kurama real sale blanca, opaca y con 👻; el alfa 0,08 que pidió Rafa nunca se ha pintado, desde 69e7609.
- `critter.ts updateVisuals` (~:795-826):
  - la rama de invisibilidad va antes que la de inmunidad;
  - el parpadeo de inmunidad solo se aplica si no hay un selfBuffOnly activo: `const selfBuff = abilityStates.some(s => s.active && s.windUpLeft <= 0 && s.def.selfBuffOnly)`. Esto arregla también el Steel Shell que parece un fantasma (SHELLY-10);
  - sin el brillo de ground_pound activo cuando es selfBuffOnly (:726-735).
- `abilities-runtime.ts:197-222`: el anillo va en el origen, donde está el señuelo; en la llegada, 2 puffs como mucho.
- `abilities-vfx.ts spawnDecoyAt`: clon opaco (`transparent=false`, `depthWrite=true`, con contorno) hasta el fundido del 30 % final. Su vida con el dt del juego. `FEEL.decoy = { ghostAlpha: 0.08, fadeFrom: 0.7 }`.
- [tdn] `frame-ticks.ts:47`: `'decoy-ghost'` solo si `c === game.player`.
- Corregir `ABILITY_QA_CHECKLIST.md:40` y `CHARACTER_DESIGN.md:34`, y anotarlo en ERROR_LOG.

**A9. Kowalski: offline el hielo no reduce la aceleración**, aunque el diseño y el servidor piden ×0,35.
- Definición de la L (`abilities.ts:1006-1029`), kit del servidor (`sim/abilities.ts:294-296`) y las ramas de Copycat: `floorFrictionMult: 5, floorAccelMult: 0.35`. La zona lleva esos campos y `getSlipperyZone()` sustituye a `isOnSlipperyZone`.
- `critter.ts:~625` → `halfLife *= zone.frictionMult`. En `player.ts:41` y `bot.ts:149` → `accel *= zone?.accelMult ?? 1`, **antes** de calcular `moveAccel`. [dist] `BrawlRoom.ts:984/1501` leen los mismos campos.
- Medido con el parche: Kowalski mejora (sus caídas bajan de 2,88 a 1,83/min) y las caídas enemigas en el hielo no bajan (9,03 frente a 8,15). No hay que subir floorAccelMult por eso.

**A10.** Kowalski se queda en bucle con la pose de la ulti: añadir `cancelAnimOnEnd: true` en la llamada makeFrenzy de Frozen Floor (`abilities.ts:1006`).

**A11.** La nube de Kermit ciega al propio Kermit: `isInsideZoneOfKind(x, z, kind, ownerKey?)` en `abilities-runtime.ts:646-654`, saltándose la zona si `zone.ownerKey === ownerKey`. [tdn] En `main.ts:414`, pasar `localPos.critterName` (una línea).

**A12. Velocidades de clip** (patrón 2): `critter.ts:~1145` → `timeScale: state.def.clipPlaybackRate`, sin `?? 1`.
- Cambia lo que se ve en 8 bichos: regrabar las hojas J/K/L y revisar sobre todo Shelly ability_3 (×10 en bucle) y Kowalski ability_3 (×1,8 en bucle).
- La L de Sergei a 1,0 o a 2,0 (su ajuste del lab) la elige Rafa con dos capturas.
- Actualizar las duraciones de clip en `abilities.ts:618-631` y `CHARACTER_DESIGN.md:85-86`.

**A13. Shelly embiste anclada** y acaba flotando inmune fuera del disco: 41 de 76 escudos solapan un J, y 11 de sus 63 caídas llegan ≤0,6 s después del escudo.
- En `activateAbility(state, critter)`: rechazar charge_rush y blink si otra ranura está activa (incluida su carga) con `selfAnchorWhileBuffed`.
- Al disparar el K, cancelar el J activo (`active=false; durationLeft=0`).
- En el servidor, la misma compuerta antes de `tryActivate`.

**A14. Cone Pulse:** el sexto pulso (×8) se pierde siempre a 75 Hz y en el 2-6 % de los lanzamientos si el dt varía. Añadir `pulseCount: 6` en la definición, en el kit del servidor (`sim/abilities.ts:320-323`) y en COPYCAT_KEYS. Con eso se acota también el Cone Pulse copiado por Kurama, que hoy da 11 pulsos y llega a 15,4 u.

**A15. Trunk Grip:** la dirección del impacto debe ser el desplazamiento real `(tx-ox, tz-oz)`, con −facing de respaldo si mide menos de 0,05 u (`abilities-runtime.ts:271`).

### Corte B: física (autorizada por Rafa)

**B1. Que el empujón no dependa de los Hz** (patrón 3).
- **Arreglo de raíz:** paso fijo de 1/60.
  - [tdn] `src/main.ts` acumula el dt real y llama a `game.update(1/60)` hasta 4 veces por fotograma. Es el mismo camino que ya usan el lab y el golden, así que golden y tanda no cambian.
  - [dist] En el servidor, `SIM.physicsSubsteps = 2`: integrar, frenar y recortar a 1/60 dentro del tick de 30 Hz, para que online empuje lo mismo que offline.
- **Parche parcial**, si hoy no hay permiso, en `critter.ts:~615` y `BrawlRoom.ts:1493`, conservando el orden integrar→fricción→tope:
  - `over = max(0, sp−M); x += (vx/sp)*(min(sp,M)*dt + over*FEEL.movement.knockbackOverflowTime)`, con knockbackOverflowTime = 1/60 también en el servidor.
  - A 60 Hz da exactamente lo de hoy. A 144 Hz el cabezazo pasa a 1,28 u (hoy 1,16; referencia a 60 Hz: 1,58). A 30 Hz, 1,80 (hoy 2,00), y Cone Pulse 6,37 (hoy 10,84).
- Documentarlo en FEELING.

### Corte C: paridad online [dist]/[tdn], con despliegue conjunto

**C1. Evento `abilityFired`** (`sim/abilities.ts:375-381`, emisiones en :472 y :486; `network-events.ts:40`): añadir `slot`, `originX/originZ` (capturados antes de fireEffect), `hits: {sid, dirX, dirZ}[]` y el tipo `'projectile'`.

En handleAbilityFired (`game.ts:1607-1676`), un helper compartido con offline, `playGroundPoundFx(def,…)`:

| Tipo de K | Qué pinta |
|---|---|
| selfBuffOnly | aro de 1,6, shake ×0,4, sin hit stop, sonido 'abilityFire' |
| gripK | aro de 1,4 + cuerda de la trompa |
| Cono | abanico |
| Radial | radio de la definición, shake × shakeBoost |

- En todos: hit stop solo si hay víctimas, y applyImpactFeedback a cada víctima con la dirección que manda el servidor.
- Blink: marcas en el origen y en el destino, y el fantasma de Sihans por tiempo, no por el flag de la ranura (hoy dura 0,10 s frente a 0,30).
- Señuelo de Kurama en el origen y con `invisibilityDuration` de su definición, no con 2.8 escrito a mano.
- Mientras no se cambie el protocolo, se puede leer `c.abilityStates[i].active` sincronizado para saber qué ranura fue.

**C2.** En el servidor, la K de Kurama con `slowDuringActive: 1.0` (`sim/abilities.ts:213-216`). Hoy queda enraizada 2,8 s online.

**C3.** En `sim/physics.ts:388-391`: `const wu = def.slowDuringWindUp ?? (a.abilityType === 'frenzy' ? SIM.frenzy.slowDuringWindUp : undefined); if (wu !== undefined) s *= wu;`.

**C4.** `SIM.chargeRush.steerFactor: 0.15`, aplicado a la entrada en `BrawlRoom.ts:985-990` con el J activo tras la carga. Acorta el Ram online de todos (el de Trunk, unas 5 u): hay que avisar.

**C5.** Carga de las K: 0,15 en el cliente frente a 0 en el servidor. La decisión está pendiente en el buzón (punto 2). Recomiendo `FEEL.groundPound.slowDuringWindUp` 0,15 → 0: es lo que pretendía ROOTED_K, y hoy el bicho desliza y puede re-apuntar el Grip.

**C6.** Añadir `'projectile'` a la condición de slowDuringActive (`abilities-runtime.ts:1159-1161`).

**C7.** [tdn] Saltarse tickLOffline en la fase online (`frame-ticks.ts:83`, pasando `game.isOnlinePhase()`).

**C8. Handlers que faltan:**
- `onLAllInResolve`: hoy el servidor lo emite en `BrawlRoom.ts:1476` y nadie lo escucha.
- onProjectileHit con applyImpactFeedback y hit stop; `removeProjectile` devuelve `{vx, vz}`.
- `lPulse` con `hits: string[]`.
- Tipo de zona online según `ev.slippery`/`ev.sinkhole` (`game.ts:1045-1062`).

**C9.** Helper `markAttacker()` en el acierto del All-in y en todos los empujones de habilidad del servidor. Hoy solo los cabezazos dan crédito de eliminación (`sim/physics.ts:174/189`).

**C10.** Ampliar `verify-ability-parity.mjs`: slowDuringWindUp y slowDuringActive resueltos (incluidos los valores por defecto de las fábricas), steerFactor, la J completa, decoyEscapeDistance, COPYCAT_KEYS y los campos nuevos. `feel-sim-parity` debe comparar los valores que se usan de verdad.

### Corte D: bajos, config y textos

- **D1.** `spawnZoneRing` (`abilities-vfx.ts:350-351, 469-477`) devuelve `{update(ttlLeft,duration), dispose()}`, guardado en ActiveZone y movido desde tickAbilityZones. clearActiveZones (`abilities-runtime.ts:608`) hace dispose. Colores por tipo de zona (`ZONE_KIND_PALETTE`), no por lanzador. La línea del All-in pasa a tener handle, con dispose al soltar, caer o cancelar.
- **D2.** `abilities-runtime.ts:814` → `FEEL.shake.groundPound * FEEL.shake.frenzyFactor`.
- **D3. Valores a config, con espejo en SIM:**
  - `FEEL.collision.anchorMassMult 9999` (`abilities-runtime.ts:1181`, `sim/physics.ts:314`);
  - `contactReachMargin 0.10` con alcance `c.radius + other.radius + margin` en sierra, toque y embestida;
  - quitar los `?? 32` de la sierra y el `?? 14` de `BrawlRoom.ts:1372`;
  - Sinkhole: `holeSlowMultiplier 0.55`, `holeMinCenterDist 4.0`. Mantener el recorte radial, sin empujarlo nunca al otro lado del islote;
  - Cone Pulse: `pulseWaveStep 1.4, pulseWaveThickness 2.0, pulseRampBase 2, pulseRampMax 8`; pulseRadius debe pasar a ser el alcance real (9,4) o desaparecer;
  - All-in: `allInHitMargin, allInSamples, allInArrivalBackoff`; quitar allInDashSpeed (nadie lo lee) y unificar los valores por defecto a 9;
  - `FEEL.shake.blinkImpactFactor 0.7`.
- **D4.** El retroceso ×4 de un aturdido que cabecea (`physics.ts:128-129/142-143` y su espejo en sim) espera a la decisión de TRUNK-10.
- **D5.** [tdn] El shake del dash solo cuando lo hace el bicho local (`game.ts:1612-1615`). Aro de salida y estela también online.
- **D6. Textos:**
  - [interfaz] i18n `status-vulnerable-desc`: «Los choques y cabezazos empujan ×4» (hoy dice «el doble»). `status-frozen-desc` debe cubrir la bola y el hielo.
  - Descripción del Grip: «bumps and headbutts… ×4». Cambiar ×2 por ×4 en `critter.ts:244` y `abilities.ts:207-208`, y «Grip K» por L.
  - Comentarios del Ram (`abilities.ts:694-698`), del frenesí de Sergei (:660-667), de Mirror Trick («hacia atrás del facing», en cliente y servidor), de makeBlink (:405) y de Frozen Floor (:1014, dice «neutro» y el buff es 1,10/1,10).
  - Fichas de Shelly: el reflejo existe, el giro no y los huesos sí están; y la línea 216 del checklist.

---

## 3. Ajustes (tuning sin cambiar qué hace la habilidad)

| Bicho · slot | Actual → propuesto | Medida que lo justifica |
|---|---|---|
| Todos · J (solo visual) | Contacto sin nada → applyImpactFeedback con dirección, sonido `headbuttHit` y shake chargeRush, en el primer contacto de cada víctima por activación (Set `rammed`). Sin hit stop (si se añade, cambia el golden) | Nadie destella al ser embestido en ninguna hoja J |
| Trunk · J | steer 0,15 / 0,55 s → probar (a) `steerFactor: 0.6` como campo de la definición o (b) duración 0,30 | Hoy gana +1,19 u sobre correr y en la segunda mitad cae a 1,54 u/s, menos que andando (4,06). (a) da +3,86 u; (b) +1,89 u y conserva el compromiso. Mismo caso para Shelly y Sihans (+1,12 u) |
| Shelly · J (*dudoso*) | Impulso 15 → 18; duración 0,45 → 0,30-0,35; CD 5,5 sin tocar | Durante la J la entrada va ×0,15, así que cuanto más larga, menos recorre. «El J más débil» no se sostiene: conecta un 27 %, como Sergei y Kurama |
| Sebastian · K | Override speed 1,3 (corre a 1,0) → 2,5, tras A12 | Hoy el golpe cae en el impulso hacia atrás; `k-rate-2.5.png` muestra la pinza extendida en el paso 18 |
| Kowalski · K | → `clipPlaybackRate: 3.6` | La suelta está a 1,8 s del clip; hoy se ve el 13 % |
| Trunk · L | Clip a 1× → probar Ability2TrunkGrip en anim-lab; si no, `clipPlaybackRate: 2.15` | El pico del clip está a 0,97 s y el tirón a 0,45 s; hoy vuelve a idle antes del golpe |
| Trunk · K (*dudoso*) | clipPlaybackRate 2,8 → 3,2 | Grabar los dos y comparar el fotograma congelado del hit stop |
| Sergei · K | `FEEL.groundPound.windUpSquashUnderClip ≈ 0.8` + mantener la pose del golpe hasta el fin del hit stop | Hoja K, pasos 0-12: solo cambia el tinte. No usar el clip de la L, que Rafa ya descartó |
| Los 9 · K/L | → `FEEL.stateGlow` + `activeGlowHex`/`windUpGlowHex` por definición: Kowalski J 0x9fe3ff, L 0xcfeeff, carga de la K 0x88c1ff; Sihans L 0xc89a3c a 0,4; sierra de Shelly 0x6ddfa9; carga del frenesí en rojo oscuro latiendo | La carga de la K (aléjate) y la de la L (buff) salen del mismo 0xffff00 |
| Kermit · K | → `shakeBoost: 0.5` + `hitStopKey: 'ability'` (0,04) | Empuja a 6,1 u/s y sacude igual que la Shockwave de 68 (20 u/s) |
| Kermit · L | Flanco `prevConfused` en Critter → `spawnToxicTouchHit` con la paleta de Kermit fija, destello sin dirección y hit stop ability. Tinte lento en la víctima, ≤1,5 Hz. [interfaz] icono 🌀 'confused' vía buzón | En la hoja L no se ve nada al tocar; la víctima lleva el mismo ☠️ que dentro de la nube |
| Kowalski · K/J | Impacto: hit stop ability, polvo 0xeaf6ff en los 3 sitios, anillo de nieve. J: `trailColor: 0xdff4ff` | Manchas beige; la bola no se ve a menos de 2 u |
| Shelly · L (tras A3) | Ventana de lanzamiento `maxLaunchSpeed 45` + `launchGrace 0.25`; `sawContactImpulse` 90 → 45 (es un cambio de unidades, no un recorte); feedback en cada contacto | Hoy 3,8 u a 60 Hz y 2,9 a 144, lo mismo que un cabezazo; con la ventana, entre 5,4 y 6,0 u a cualquier frecuencia |
| Shelly · J/K/L (visual) | Sierra girando sobre el centro de la caja posada (grupo pivote); J rodando y pose de encierro escalando las raíces de cadena (NeckTwist01, Forearm, Calf) | El caparazón invade a Sergei a 1,8 u sin golpear (el alcance real es 1,2) |
| Cheeto · K | Hit stop ability + `headbuttHit`; shake solo si hay víctimas | La pose de impacto dura un solo fotograma |
| Cheeto · L | Disco de 360° (spawnFrenzyBurst, 4,75 u) → cuña plana del cono (±45°, 9,4 u). Tras A3 y C7, feedback por pulso (también para Kurama cuando lo copia) | Rafa ya rechazó en Claw Wave «dice frontal y veo 360°» |
| Kurama · L | Giro y parpadeo condicionados a `def.sawL` / `def.toxicTouchL` (con un flag `sawSpinning`, no por nombre); estallido y tinte con la paleta del bicho copiado | Hoy lo copiado es indistinguible |
| Sebastian · L | Sin teletransportar a la víctima: deriva `fallVx/fallVz` de ≈22 u/s con arrastre en FEEL y un arco visual; rastro del tajo de 0,18 s; carga con brillo, pose y vibración (`FEEL.allIn`) y applyLandingFeedback en vez de applyImpactFeedback | allInHitForce 220 hoy no hace nada, y al cargar Sebastian se destella a sí mismo |
| Sebastian · J | `dashVisualYawDeg: 90` (45 si no se lee) | No tiene clip de J y lo documentado no existe |
| Kermit · J | `hopHeight: 0.6` (solo altura visual), después del commit de locomoción | Hoy es el dash por defecto |
| Trunk · L | Desplazamiento visual del tirón `FEEL.grip.yankVisualTime 0.15` + cuerda de la trompa | Hoy la víctima se teletransporta 7,4 u en un paso |
| Todos (visual) | Retraso visual en el reactionRig `FEEL.movement.launchVisualTime ≈ 0.12`; la física no cambia | Salto de 6,1 u en un paso (combo Grip→cabezazo) |
| Todo el roster | `applyKnockback()` central con tope `knockbackMaxSpeed 40` durante `knockbackWindow 0.25` (FEEL + SIM); Claw Wave con `falloffMin 0.7` | Las K de 76, 68 y 50 empujan todas 1,42-1,66 u; el cabezazo de Sebastian tiene +20 % de impulso y solo +7 % de distancia. Va en un corte propio, después de B1; vigilar a Trunk y el ×4 |
| Todo el roster (*dudoso*) | Retroceso del cabezazo × clamp(2·mV/(mA+mV), 0,5, 1,5), sin quitar el boost | Sergei retrocede el 65-77 % de lo que empuja. Favorece a Trunk: solo con tanda completa y recálculo P/W/S |
| Sihans · L (*dudoso*) | Medir antes con víctimas en movimiento; si hace falta, `holePullMinFalloff 0.3` | La prueba actual usa muñecos quietos |
| Trunk (*dudoso*) | Después de A1, A2 y la IA, si sigue por delante: `gripFrontalRange` 28 → 10-12; después, aturdido 3,8 → 2,5 | Eliminado el 28 % sin usar nunca el Grip. La velocidad 16 es decisión de Rafa: no tocarla |

---

## 4. Diseño (necesita el visto bueno de Rafa)

- **Golpe de dash en las J.** Campo `dashHitForce` por definición, 0 por defecto. Valores de partida:
  - Sergei 22-25, por debajo del tope para que sea un palmetazo sin igualar al cabezazo (Rafa marcó esta J como «perfecta»);
  - Cheeto 30;
  - Sebastian 24-28, solo con la víctima por delante;
  - Kurama en su lugar `dashPhaseThrough`: un amago que atraviesa al rival.
  - Hay que decidir si este golpe alimenta Copycat.
  - Por qué: 106 de 213 Gorilla Rush tocan a alguien y no pasa nada.
- **Que el aturdido bloquee acciones** (cabezazo, J, K y L). Si sí, bajar el aturdido del Grip de 3,8 a 2,5 y actualizar i18n. Hoy el agarrado cabecea o escapa con la J o con Mirror Trick.
- **Frenesí de Sergei «casi inamovible»:** `knockbackTakenMult: 0.4` en su L, aplicado con applyKnockback. El cabezazo de Trunk pasaría de 1,54 a unos 0,6 u; hoy solo resiste un 40 % a los cabezazos y nada a las habilidades.
- **All-in de Sebastian:** carga mínima de 350 ms y poder apuntar mientras carga. Hoy un toque elimina en un paso (unos 33 ms). Los bots usarían la misma vía. Alternativa si el fallo suicida no convence: embestir y quedar aturdido.
- **Copycat:**
  - copiar también la L de Sergei (1,55/5,5) y la de Trunk (con alcance y aturdido reducidos);
  - usar la duración de la L original;
  - Sebastian con una variante segura (`allInSafeMiss`, 1,0 s);
  - feedback cuando no hay objetivo o cooldown reducido. Hoy es un fizzle silencioso con buff, y eso es una decisión documentada.
- **Mirror Trick:** hoy salta hacia atrás del facing, así que quien huye y pulsa K aparece 7 u hacia su perseguidor. ¿Se mantiene, o se cambia a alejarse del enemigo más cercano a menos de 6 u? Aparte: un señuelo que reciba golpes. También, enseñarle el clip de J de 1,03 s en anim-lab (*dudoso*).
- **Shelly:**
  - al activar Steel Shell, ¿frena en seco o solo cancela la J?
  - ¿cae si el suelo se hunde bajo el caparazón? Subiría sus muertes en el borde.
  - Shell Charge como embestida que rueda y golpea (`ramContactImpulse 30`).
- **Kowalski:**
  - Ice Slide que desliza de verdad (`slideFrictionMult: 3`, unas 4,7 u frente a 2,2);
  - buff de Frozen Floor: 1,10/1,10 o neutro (de eso depende el 🔥);
  - bola que se desliza por el suelo, como dice el diseño (hoy vuela a y 0,7);
  - estado ⛸️ separado de ❄️.
- **Kermit:** aspecto de la nube, que hoy tapa a Kermit y a sus víctimas 10 s. Fue una decisión del 29-04. Propuesta: pasar los parámetros a config sin cambiar valores y enseñarle dos capturas.
- **Sihans:** arenas también a la salida del túnel (`exitZone` 2,0 / 1,5 s / 0,6), y el nombre y la descripción de la J («Clawed lunge»).
- **Cheeto:** Shadow Step con la «potencia aumentada» de la ficha (48 sin caída sobre el objetivo, +78 %) o aterrizando a la espalda; hoy da 27 u/s y aterriza delante. Girar el cono durante la canalización es *dudoso*: anula el contrajuego.
- **Global:** que los bots online usen la L (hoy `ultimate = false`, buzón punto 4) y qué lado manda en la carga de las K (buzón punto 2).

---

## 5. IA de los bots

**Nunca se lanzan offline:** Trunk Grip, Sand Trap y Shadow Step. La causa es que la IA se queda con la primera habilidad que tiene la etiqueta. Lo ideal es elegir por la forma de la definición, como ya hace el servidor. Si no, etiquetas únicas:

| Habilidad | Etiqueta | Cuándo lanzarla | Tasa |
|---|---|---|---|
| Trunk Grip | `'targeted'` | 3,0 < d < min(alcance, 10), rival dentro del cono de 35° | 0,5 |
| Shadow Step | `'targeted'` | `blinkSeekNearest`, 3 < d < 9, objetivo no inmune y empujón hacia el borde: `(n.x-b.x)*n.x + (n.z-b.z)*n.z > 0` | 0,702 |
| Sand Trap | `'utility'` | `zoneAtOrigin`, rival a menos de zone.radius×0,8 y aterrizaje (por la mirada) sobre arena | tasa propia `trap` |
| Mirror Trick | `'utility'` | carga entrante o nearbyCount ≥ 2, y destino seguro (A6) | — |

- En Mirror Trick, «perder el rastro» debe mirar el estado del truco y no la inmunidad (hoy lo pierden también 1,5 s tras reaparecer), manteniendo el filtro de Kurama.
- Cada regla, espejada en `sim/bot.ts` y con su fila en feel-sim-parity.

**Radiales:** Sergei hizo 0 Shockwave en 135 s de 1v1, y el 48 % de las que lanzó tenían como mucho un enemigo dentro del radio.
- Regla: `pushes = r>0 && force>0 && !selfBuffOnly && !gripK; rr = min(r, 4); fires = pushes ? (inR >= 2 || nearestDist < rr*0.7) : nearbyCount >= 2`, con `radialSoloFrac 0.7` en FEEL.bots.
- Trunk Slam va aparte y después de volver a medir a Trunk: radio máximo entre 4 y 5,6, y basta un rival porque aturde.

**Suicidios:**
- **All-in de Sebastian:** es el 50 % de sus caídas (46 de 92).
  - Etiqueta `'risky'`.
  - Pasillo con la geometría real de acierto (tras A7) en FEEL.bots.
  - Misma vía de cargar y soltar que el jugador, con `allInReactionSec`.
  - Recomprobar el pasillo al soltar y cancelar sin gastar el cooldown si no hay objetivo.
- **Toxic Touch de Kermit:** los bots confundidos invierten también su protección del borde. El 73 % de los tocados cae (18 % sin la L), y cerca del centro el 62 % (frente al 14 %).
  - `FEEL.bots.confusedReactionTime ≈ 0.6`: pánico total los primeros 0,6 s; después solo se invierte la persecución y la sonda del borde usa el vector ya invertido.
  - Esto revisa la decisión de BUILD_LOG:1232 (2026-08-21): hay que decírselo a Rafa.
  - En el servidor, `BrawlRoom.ts:978 && !p.isBot` y la misma lógica en sim/bot.ts.
- **Burrow Rush de Sihans:** 12 de sus 16 caídas tras la J llegan entre 0,01 y 0,14 s después. Sondear por la **mirada** a 1,0 y a 3,0 u (`dashProbe`) antes de lanzar el dash. Aplicarlo a todo el roster.

**Mal apuntadas:**
- Snowball: puerta de cono `rangedAimDeg 35`. Hay que volver a medirlo con un servidor nuevo, porque 17 de 51 bolas salieron de espaldas por el giro antiguo.
- Claw Wave y Cone Pulse: comprobar el coseno del cono antes de lanzar.
- Frozen Floor: lanzarla con al menos min(2, rivales vivos) enemigos dentro de 4,8 u.
- Shelly: no lanzar la K con su L activa (salvo con presión de borde), ni la L estando anclada o cargando la K. Hoy 27 de 51 sierras van con el escudo y solo aciertan el 26 % (58 % sin escudo).

**Online:** los bots no lanzan ninguna L y SIM.bots no tiene tasa 'buff'. Eligen por la forma de la definición, así que lanzan Sand Trap, Shadow Step y Mirror Trick solo con 2 o más rivales cerca. Por eso la tanda offline no representa lo que pasa online.

---

## 6. Qué medir después de aplicar

**Primero:** levantar un servidor de capturas nuevo con la orientación de 9019794 commiteada y repetir la tanda de referencia de los 9 bichos.

**Tras el corte A** (golden 3/3), 8 partidas por bicho con las mismas semillas:

| Qué comprobar | Herramienta | Resultado esperado |
|---|---|---|
| Uso de las habilidades que faltaban | `summary.json` | Trunk Grip, Sand Trap y Shadow Step por encima de 0 usos/min |
| All-in de Sebastian | `allin-outcomes.cjs` | Autocaídas de 46/52 a casi 0; bajar su 91 % de eliminado |
| Estados tras la caída | `cheeto-respawn-l.py`, `grip-fall.mjs` | 0 reapariciones con la L activa; aturdido 0 al reaparecer |
| Inmunidad | `an5.py`, `sergei-immune.cjs` | 0 desplazamientos de inmunes |
| Sierra | `an4.py` | Ninguna víctima por encima de 45 u/s |
| Sihans | `sihans-probe2` (caso B), `sihans-probe3`, `sihans-jfalls.py` | No se cae por su agujero; aterriza en suelo; menos caídas en los 0,25 s tras la J |
| All-in (sondas) | `void-probe.mjs`, `behind.json` | Ninguna eliminación desde el vacío ni por detrás |
| Kermit | `kermit_falls2.py` + `kermit-verify-falls3.py` | Caída tras un toque entre el 18 % y el 73 %; se ajusta con confusedReactionTime, no con la duración |
| Kowalski | `fix.mjs` (semillas 900-907), `aim.mjs` | Unas 1,8 caídas propias por minuto; bolas de espaldas cerca de 0 |
| Trunk | Semillas iguales, antes de TRUNK-12/13 | Si sigue por debajo del ~25 % de eliminado, la palanca es gripFrontalRange |

**Tras A12:** hojas J/K/L con `--video` de los 8 bichos afectados, más:
- Sergei L a 1,0 y a 2,0;
- Trunk K a 2,8 y a 3,2;
- Kowalski K a 3,6 y Sebastian K a 2,5;
- Sihans L con el arena conectado: debe abrirse el hoyo y Sihans quedar en pie; elegir su clip de L en anim-lab.

**Tras B1:**
- `sergei-probe3` / `kb-hz.js` a 60 y 144 Hz, más el cálculo a 30 Hz: distancias iguales ±5 %.
- `ability-shots` de Cheeto L: el `pushed` a 60 Hz no cambia y no hay atravesamiento entre los pasos 72 y 78.

**Tras el corte C:** prueba online manual con dos clientes. Comprobar:
- el radio del aro de cada K;
- el señuelo de Kurama en el origen y que Kurama se mueve durante el truco;
- que el Ram online recorre lo mismo que offline;
- los efectos de la resolución del All-in;
- que las víctimas destellan y que hay hit stop solo cuando alguien recibe.

Además, `verify-ability-parity` ampliado en verde.

**Cortes de tuning de todo el roster** (tope de empujón, retroceso por masas): tanda completa de los 9 antes y después, y recálculo P/W/S con `balance-report.mjs`.