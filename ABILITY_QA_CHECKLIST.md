# Ability QA Checklist — Candidate Final v0.11

Status legend:
- `[ ]` pendiente — sin implementar
- `[~]` implementado, falta validación de Rafa
- `[x]` validado por Rafa
- `[!]` problema detectado / requiere ajuste / NO se cierra antes de la entrega
- `[~⚠]` implementado con simplificación documentada (versión fiel al espíritu, no idéntica al diseño)

Last updated: v0.11 implementation pass.
Use `git log --grep abilities` to see the commit trail behind each item.

---

## Arreglos transversales

- [~] **J/dash anim sync**: `cancelAnimOnEnd: true` añadido a TODAS las charge_rush. La animación se corta a idle/run cuando el dash termina. Cubre Trunk, Sergei, Kurama, Shelly, Kermit, Sihans, Kowalski, Cheeto, Sebastian.
- [~] **Headbutt feedback per-critter**: nuevo campo `headbuttBoost` en `CritterConfig` (multiplicador local del impulso de cabezazo + shake escalado). Aplicado a Sergei (1.15×), Kowalski (1.20×), Cheeto (1.30×), Sebastian (1.45×). Trunk/Kurama/Shelly/Kermit/Sihans se quedan en 1.0× (Rafa los marcó OK o decentes).
- [!] **Sergei mesh bug**: investigado. Causa probable: `transparent: true` aplicado por defecto al cargar el GLB (en `attachGlbMesh`) combinado con render order ambiguo cuando el frenzy emisivo está activo. Aplicado fix mínimo (forzar `depthWrite: true` en materiales de Sergei sin opacidad < 1) — pendiente validación visual de Rafa porque puede haber casos que el repro sea distinto. Si reaparece, marcar como [!] persistente.

---

## Sergei

- [~] **Headbutt** — boost ×1.15 (impulse + shake)
- [~] **J Gorilla Rush** — sin cambios (Rafa: perfecta) + cancelAnimOnEnd
- [~] **K Shockwave** — sin cambios (Rafa: perfecta)
- [~] **L Frenzy buffada** — `frenzySpeedMult 1.45 → 1.55`, `frenzyMassMult 1.50 → 1.75`. Más empuje y velocidad sin tocar identidad gorila.
- [!] **Mesh bug** — fix preventivo aplicado (depthWrite forzado), pendiente validación. Si persiste, abrir issue separado y desactivar transparency en Sergei únicamente.

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
- [~⚠] **K Mirror Trick simplificado**: durante 1.6 s tras pulsar K, Kurama se vuelve **semi-invisible** (alpha 0.25) Y obtiene immunity ampliada (no recibe knockback). El "decoy" se representa como un afterimage estático de Kurama en la posición original (clone visual del mesh, alpha 0.4, sin colisión, sin gameplay). **Recorte**: bots NO siguen al decoy preferentemente — siguen targetando a Kurama por sessionId. Online: el alpha se ve correctamente porque el material se sincroniza vía estado de buff. **NO** hay redirección de bot AI ni invisibility "real" para physics — solo visual + immunity.
- [!] **L Copycat** — NO implementado. Sustituido temporalmente por `Nine-Tails Frenzy` (la versión actual). El sistema necesario (last-hit tracker + ability dispatch por nombre + restricción de uso único) requiere ~2-3 h de trabajo y schema online nuevo. Documentado para post-entrega. **Marcado [!] explícitamente.**

---

## Shelly

- [~⚠] **Headbutt** — sin cambios (Rafa: decente)
- [~⚠] **J Shell Charge** — `duration 0.45 → 0.55`, `impulse 15 → 18`. Más distancia. **Recorte**: no se ocultan visualmente cabeza/patas durante el dash — la inspección de los nodos del GLB muestra que Shelly NO tiene submeshes nombrados separadamente para shell vs cabeza/patas (mesh único `tripo_part_*`). Documentado en checklist.
- [~] **K Steel Shell modo defensivo** — REEMPLAZA el ground pound. Durante 5 s: rooted (no movimiento), invulnerable a knockback Y a effect zones, glow gris/acero (override de `getCritterVfxPalette` durante el estado). Implementado vía nueva ability type `'steel_shell'` con `slowDuringActive: 0` + `setImmunityTimer(5.0)` + flag visual. Cooldown 12 s.
- [!] **K cabeza/patas ocultas** — NO posible sin submeshes nombrados. Compensado con tint metálico fuerte que hace que Shelly se lea como "encerrada en su caparazón".
- [!] **L Saw Shell rotation** — NO implementado. Rotation animation logic (rotar el GLB sobre Y rápidamente) requiere modificar el animation loop o aplicar una rotación frame-by-frame durante la duración del frenzy. El frenzy tinted actual (verde tank) se mantiene como Berserker Shell con stats ya dispuestos. Marcado [!] para post-entrega.

---

## Kermit

- [~] **Headbutt** — sin cambios (Rafa: bueno)
- [~] **J Leap Forward** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Poison Cloud** — zona slow ya existente (rad 5.0 / 2.0 s / 60 % slow) con visual mejorado: el ring del shockwave inicial usa una trail de partículas verdes aleatorias en addition al ring para que se lea como humo, no solo círculo plano. Visualmente más cloud-like.
- [!] **K inside-cloud vision** — NO implementado. Vignette/overlay local cuando un jugador está dentro de la zona requiere modificación del render pass o un quad screen-space adicional con alpha mask. Marcado [!] post-entrega — el slow real ya hace que la zona sea funcionalmente peligrosa.
- [~⚠] **L Hypnosapo / Toxic Touch** — durante el buff (4.0 s), si Kermit hace **headbutt** sobre un enemigo, le aplica un **status `poisoned`** durante 2.5 s: input invertido (X y Z multiplicados por -1 en la simulación). VFX: tint morado en el target afectado. **Recorte**: el invert solo afecta al input del jugador local del target; bots no se ven afectados (no tienen "input" sino lógica de targeting). En online: el server propaga el status flag y el cliente del target afectado invierte su input localmente antes de mandarlo al server. Documentado.

---

## Sihans

- [~] **Headbutt** — sin cambios (Rafa: perfecto)
- [~] **J Burrow Rush** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~⚠] **K Burrow + Quicksand** — REEMPLAZA el pound. Sihans hace blink (3.5 u en facing) Y suelta una zona de slow en su POSICIÓN ORIGINAL (radius 3.5, 2.5 s, 50 % slow). Visual: ring marrón/arena en el origen. **Recorte**: no hay "underground tunnel" 3D real (Sihans no se hunde literalmente — desaparece como Cheeto blink), pero el efecto + VFX da la lectura de "se hundió aquí, salió allá, y dejó arenas movedizas atrás". Server clamp asegura no aparecer en void.
- [!] **L Sinkhole con preview / double-tap** — NO implementado. El sistema de targeting con preview + confirmación de doble pulsación requiere un modo de input nuevo y UI de preview. Marcado [!]. La L actual sigue siendo Diggy Rush (frenzy tank earth-tinted) hasta post-entrega.

---

## Kowalski

- [~] **Headbutt** — boost ×1.20
- [~] **J Ice Slide** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~⚠] **K Snowball** — REEMPLAZA el ground_pound + zona. Implementado como un **proyectil simple** server-authoritative: lanza una bola de nieve desde Kowalski en su facing direction con velocidad 22 u/s, vida 0.8 s. Al impactar contra un crítter: knockback radial pequeño + slow 50 % durante 2.0 s aplicado al target via status flag. Si no impacta: desaparece tras 0.8 s. VFX: sphere blanca pequeña con glow azul. Cooldown 6 s. **Recorte**: detección de colisión es radial alrededor del proyectil (no precisa); afecta al primer crítter que entre en su radio.
- [~] **L Blizzard / Frozen Floor** — REEMPLAZA el frenzy actual. Crea una **zona de hielo grande** (radius 6.5, 3.0 s) en la posición de Kowalski. Dentro de la zona: speed × 1.5 (deslizamiento — los críters van más rápido pero pierden 70 % del control de input vía un nuevo flag `slipperyZone`). Visual: ring azul brillante con disco semi-transparente. Cooldown 17 s. Kowalski también queda dentro pero como fue su L, recibe tratamiento "owner immune". **Importante**: este L no es buff personal sino zona de control — más cerca del diseño Rafa pidió.

---

## Cheeto

- [~] **Headbutt** — boost ×1.30 (más rápido + más shake)
- [~] **J Pounce** — sin cambios mecánicos + `cancelAnimOnEnd: true`
- [~] **K Shadow Step + impact** — el blink ya implementado en v0.10 ahora aplica un **knockback radial** en la posición de DESTINO (radius 2.0, force 28) — los enemigos cerca del punto de aterrizaje salen disparados. VFX: shockwave naranja en el destino + afterimage en origen. Cheeto NO recibe self-pushback. Mantiene el rooting durante el blink window.
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
- [~] AbilityType extendido: `'snowball'`, `'steel_shell'`. Server propaga via abilityFired event.
- [~] Status flags `poisoned`, `slipperyZone` sincronizados via PlayerSchema (campos opcionales nuevos).

Pending [!] para post-entrega (lista resumen):
1. Sergei mesh bug visual (validar fix)
2. Kurama L Copycat
3. Shelly L Saw Shell rotation
4. Shelly visual hide head/legs (limitación GLB)
5. Sihans L Sinkhole con preview/confirm
6. Cheeto L Tiger Roar cone pulse
7. Sebastian L All-in Side Slash
8. Kermit K inside-cloud vision overlay
