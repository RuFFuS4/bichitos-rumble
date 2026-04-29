# Ability QA Checklist — Candidate Final v0.11

Status legend:
- `[ ]` pendiente — sin implementar
- `[~]` implementado, falta validación de Rafa
- `[x]` validado por Rafa
- `[!]` problema detectado / requiere ajuste / NO se cierra antes de la entrega
- `[~⚠]` implementado con simplificación documentada (versión fiel al espíritu, no idéntica al diseño)

Last updated: v0.11 + K-session 1 + K-refinement + final-K-polish + 2026-04-30 final-L (deadline candidate).
Use `git log --grep abilities` to see the commit trail behind each item.

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
> - **Kowalski L Frozen Floor** — frenzy 1.10/1.10 + flag `frozenFloorL`. Spawn slippery zone radius 6, duración 5 s. Server + cliente offline: friction halfLife × 5 + accel × 0.35 cuando dentro. Owner exempt. Status icon ❄️ frozen sobre afectados.
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
> - **Kurama K (lógica corregida)**: orden ahora correcto — primero spawnDecoy en posición original, después move backward (rotación + 180°) por `decoyEscapeDistance = 7 u`. NO más facing-forward / nearest-enemy seek. Server mirror.
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
- [~] **K Mirror Trick** (IMPLEMENTADO 2026-04-29): durante 1.6 s tras pulsar K, Kurama se vuelve **semi-invisible** (alpha 0.25) Y queda inmune a knockback (`immunityTimer` extendido). El "decoy" se spawna como un clon estático del mesh GLB en la posición de origen (SkeletonUtils.clone + tinted violet alpha 0.4, fade-out 30 % final, dispose automático). Cliente: alpha + decoy + emissive. Server: `immunityTimer = 1.6 s` via `selfBuffOnly + selfImmunityDuration`. **Bot confuse (K-session 1)**: bots offline (`src/bot.ts`) y server (`server/src/sim/bot.ts`) **skipean a Kurama como target** mientras `immunityTimer > 0` — mismo flag que el trick escribe. Otros críters mantienen targeting normal en su immunity post-respawn. Lectura "lost the scent" exacta como Rafa pidió.
- [!] **L Copycat** — NO implementado. Sustituido temporalmente por `Nine-Tails Frenzy` (la versión actual). El sistema necesario (last-hit tracker + ability dispatch por nombre + restricción de uso único) requiere ~2-3 h de trabajo y schema online nuevo. Documentado para post-entrega. **Marcado [!] explícitamente.**

---

## Shelly

- [~⚠] **Headbutt** — sin cambios (Rafa: decente)
- [~⚠] **J Shell Charge** — `duration 0.45 → 0.55`, `impulse 15 → 18`. Más distancia. **Recorte**: no se ocultan visualmente cabeza/patas durante el dash — la inspección de los nodos del GLB muestra que Shelly NO tiene submeshes nombrados separadamente para shell vs cabeza/patas (mesh único `tripo_part_*`). Documentado en checklist.
- [~⚠] **K Steel Shell** (IMPLEMENTADO): REEMPLAZA el slam. Durante 5 s: rooted (`slowDuringActive: 0`) + `immunityTimer = 5 s` server-authoritative (no recibe knockback online ni offline). Visual: emissive override `0xa8c0d0` (metallic blue-gray). Implementado como `ground_pound` con `selfBuffOnly: true` + `selfImmunityDuration: 5.0` + `selfTintHex: 0xa8c0d0` — sin nuevo AbilityType. Cooldown 12 s.
- [!] **K cabeza/patas ocultas** — NO posible sin submeshes nombrados. Compensado con el emissive metálico fuerte. Shelly se LEE como "encerrada", aunque la silueta sigue mostrando cabeza/patas.
- [!] **L Saw Shell rotation** — NO implementado. Rotation animation logic (rotar el GLB sobre Y rápidamente) requiere modificar el animation loop o aplicar una rotación frame-by-frame durante la duración del frenzy. El frenzy tinted actual (verde tank) se mantiene como Berserker Shell con stats ya dispuestos. Marcado [!] para post-entrega.

---

## Kermit

- [~] **Headbutt** — sin cambios (Rafa: bueno)
- [~] **J Leap Forward** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Poison Cloud** — zona slow (rad 5.0 / 2.0 s / 60 % slow) clasificada como `vfxKind: 'poison'` para que el overlay local se active.
- [~] **K inside-cloud vision (2026-04-29)** — overlay screen-space CSS implementado: `<div id="poison-overlay">` zIndex 15, radial-gradient transparente al centro → toxic-green denso al borde, `mixBlendMode: multiply`, `transition: opacity 0.20s`. main.ts loop comprueba el local critter contra `isInsideZoneOfKind('poison')` cada frame y feed 0/0.85. CSS evita los issues de z-fighting que el skybox tuvo con shader quads.
- [!] **L Hypnosapo / Toxic Touch** — NO IMPLEMENTADO en v0.11. La L actual sigue siendo el frenzy custom de v0.10 (slow + heavy). Implementar el status "poisoned" + invert input requiere nuevo schema online (status flag en PlayerSchema), código de física para invertir movement input, y VFX en target afectado. Marcado [!] para sesión L dedicada.

---

## Sihans

- [~] **Headbutt** — sin cambios (Rafa: perfecto)
- [~] **J Burrow Rush** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Burrow + Quicksand (2026-04-29 visual layer)** — REEMPLAZA el pound. Sihans hace blink (3.5 u en facing) Y suelta una zona de slow en su POSICIÓN ORIGINAL (radius 3.5, 2.5 s, 50 % slow). Visual mejorado en K-session 1: cuando se dispara el blink con `zoneAtOrigin: true`, Sihans **se vuelve totalmente invisible** durante 0.30 s (alpha 0, distinto del 0.25 ghost de Kurama) + 8 dust-puffs en origen + 8 en destino. Lectura "se hundió en una nube de tierra, sale en otra nube de tierra". Server clamp asegura no aparecer en void.
- [!] **L Sinkhole con preview / double-tap** — NO implementado. El sistema de targeting con preview + confirmación de doble pulsación requiere un modo de input nuevo y UI de preview. Marcado [!]. La L actual sigue siendo Diggy Rush (frenzy tank earth-tinted) hasta post-entrega.

---

## Kowalski

- [~] **Headbutt** — boost ×1.20
- [~] **J Ice Slide** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Snowball PROYECTIL (2026-04-29)** — IMPLEMENTADO autorial. Nuevo `AbilityType: 'projectile'`. Server-authoritative end-to-end:
  - **Server**: `BrawlRoom.activeProjectiles` Array, `tickPlayerAbilities` devuelve `projectileSpawns`, BrawlRoom integra cada tick (vx/vz fixed at fire), sweep collision contra todos los players alive non-owner non-immune con reach `pr.radius + 0.55`, on hit: knockback impulse + `victim.slowTimer = max(slowTimer, 2.0)`, broadcast `projectileHit`. TTL 1.2 s o salida del arena → `projectileExpired`.
  - **Cliente**: `src/projectiles.ts` nuevo módulo con sphere geometry shared + per-instance ice-blue emissive material. Offline: `spawnLocalProjectile` + `tickProjectiles` hace mismo sweep. Online: `pushNetworkProjectile` registra para mirror visual, `removeProjectile` despawn on server hit/expired.
  - **Schema**: `PlayerSchema.slowTimer: number` añadido. `effectiveSpeed` (cliente + server) multiplica por 0.5 cuando > 0.
  - **Bot**: tag `'ranged'` en `AbilityTag`. Bots offline + online evalúan condición 4..14 u y disparan con 0.022 prob/tick.
  - **Parity**: nuevo branch `kind: 'projectile'` en `verify-ability-parity.mjs` valida speed/ttl/radius/impulse/slowDur/wU/CD bit-for-bit.
- [!] **L Blizzard / Frozen Floor** — NO IMPLEMENTADO. La L actual (Blizzard frenzy) sigue siendo buff personal. Para zona de hielo deslizante necesito extender el zone system con `slippery: boolean` flag (acceleration × 0.3, control reducido). Marcado [!] para sesión L dedicada.

---

## Cheeto

- [~] **Headbutt** — boost ×1.30 (más rápido + más shake)
- [~] **J Pounce** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Shadow Step + impact** — blink (v0.10) + knockback radial en destino. **K-session 1 bump (2026-04-29)**: `blinkImpactRadius 2.2 → 2.6`, `blinkImpactForce 28 → 36` (Rafa: "ajustar si se siente débil"). Cheeto NO recibe self-pushback. Mantiene rooting durante blink window.
- [!] **L Tiger Roar / Cone Pulse** — NO implementado. Cone-shaped repeating knockback durante channeling es una mecánica nueva. La L actual sigue siendo Tiger Rage (frenzy corto y rápido). Marcado [!] post-entrega.

---

## Sebastian

- [~] **Headbutt arreglado** — boost ×1.45 (el más alto del roster). Combinado con su mass × 0.75 base y `headbuttForce 16`, el cabezazo de Sebastian ahora es la firma más violenta de las distancias cortas.
- [~] **J Claw Rush más fuerte** — `impulse 28 → 33`, `massMultiplier 1.4 → 1.7`. Más knockback al cargar.
- [~⚠] **K Claw Wave (frontal)** — REEMPLAZA el pound radial. Implementado como un **ground_pound direccional con cone**: solo aplica knockback a críters dentro de un cono de ±60° alineado con el facing de Sebastian (radius 3.5, force 38). VFX: el shockwave ring se reemplaza por un **disco semicircular orientado al frente** (custom shader simple — half-disc). Cooldown 6.5 s. **Recorte**: la onda no es un proyectil que viaje; es un cone-restricted instant pound (escala fácil, server-authoritative trivial).
- [!] **L All-in Side Slash** — NO implementado. La mecánica multi-fase (windup vibrante + side dash con hit detection durante movimiento + miss → self-fail/fall) requiere un mini state-machine de ability y modificación de la integración de física. La L actual sigue siendo Red Claw (frenzy corto). Marcado [!] post-entrega como prioridad.

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
- [~] AbilityType inalterado — todas las K nuevas reusan `ground_pound` o `blink` con flags adicionales. **Cero cambios de schema** sobre v0.10.
- [~] Status flags NO añadidos — el `immunityTimer` existente cubre Shelly Steel Shell + Kurama Mirror Trick; no hicimos falta poisoned/slippery porque las habilidades que los necesitaban quedaron diferidas a [!].

Pending [!] para post-entrega (lista resumen, v0.11):
1. Sergei mesh bug — fix preventivo aplicado, validar Rafa
2. Kurama L Copycat (sistema de last-hit + ability dispatch)
3. Shelly L Saw Shell rotation (rotation animation logic)
4. Shelly visual hide head/legs (limitación GLB — sin submeshes)
5. Sihans L Sinkhole con preview/double-tap
6. Cheeto L Tiger Roar cone pulse (channeling cone repeat)
7. Sebastian L All-in Side Slash (multi-fase + miss-fail)
8. Kermit K inside-cloud vision overlay (screen-space mask)
9. Kermit L poison-touch + inverted controls (status system)
10. Kowalski K Snowball como proyectil real
11. Kowalski L Frozen Floor / slippery zone
