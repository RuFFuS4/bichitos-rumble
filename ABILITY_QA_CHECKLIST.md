# Ability QA Checklist — Candidate Final v0.11

Status legend:
- `[ ]` pendiente — sin implementar
- `[~]` implementado, falta validación de Rafa
- `[x]` validado por Rafa
- `[!]` problema detectado / requiere ajuste / NO se cierra antes de la entrega
- `[~⚠]` implementado con simplificación documentada (versión fiel al espíritu, no idéntica al diseño)

Last updated: v0.11 implementation pass + 2026-04-29 skybox close-out + Sergei mesh-bug real fix.
Use `git log --grep abilities` to see the commit trail behind each item.

> **Out-of-scope but cerrado entre tomas (no es habilidad pero estaba bloqueando QA visual):**
> - **Skybox 360 final** (`b054e96`). Cuatro iteraciones (camera-parented sphere → world-anchored sphere PBR → backdrop toggle hacks → cortes verticales en bordes) fallaron por interacciones entre depth/transparency/grazing-angle. Solución definitiva: `scene.background = equirectTexture` con `EquirectangularReflectionMapping` — pre-pass built-in de Three.js, full-screen guaranteed, sin meshes ni z-buffer involucrado. Eliminados: skydome esférico, backdrop screen-space, cloudsBelow plano. Las 5 panorámicas en `public/images/skyboxes/<id>.png` se enchufan vía `setSceneSkyboxTexture`.

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
- [~⚠] **K Mirror Trick simplificado** (IMPLEMENTADO): durante 1.6 s tras pulsar K, Kurama se vuelve **semi-invisible** (alpha 0.25) Y queda inmune a knockback (`immunityTimer` extendido). El "decoy" se spawna como un clon estático del mesh GLB en la posición de origen (SkeletonUtils.clone + tinted violet alpha 0.4, fade-out 30 % final, dispose automático). Cliente: alpha + decoy + emissive. Server: solo `immunityTimer = 1.6 s` via `selfBuffOnly + selfImmunityDuration`. **Recorte**: bots NO siguen al decoy preferentemente — siguen targetando a Kurama por sessionId. La invisibilidad NO afecta physics ni colisiones, solo es visual + immunity.
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
- [~] **K Poison Cloud** — zona slow ya existente (rad 5.0 / 2.0 s / 60 % slow) con visual mejorado: el ring del shockwave inicial usa una trail de partículas verdes aleatorias en addition al ring para que se lea como humo, no solo círculo plano. Visualmente más cloud-like.
- [!] **K inside-cloud vision** — NO implementado. Vignette/overlay local cuando un jugador está dentro de la zona requiere modificación del render pass o un quad screen-space adicional con alpha mask. Marcado [!] post-entrega — el slow real ya hace que la zona sea funcionalmente peligrosa.
- [!] **L Hypnosapo / Toxic Touch** — NO IMPLEMENTADO en v0.11. La L actual sigue siendo el frenzy custom de v0.10 (slow + heavy). Implementar el status "poisoned" + invert input requiere nuevo schema online (status flag en PlayerSchema), código de física para invertir movement input, y VFX en target afectado. Marcado [!] post-jam — riesgo / scope superior al disponible para esta sesión. La L actual sigue siendo funcional como buff personal pesado.

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
- [!] **K Snowball** — NO IMPLEMENTADO en v0.11. La K actual (Arctic Burst con zona de hielo de 1.6 s + 55 % slow) es la versión v0.10 — funciona como zona de control de área pero NO es un proyectil. Implementar bola de nieve real requiere proyectil entity con tick de movimiento, detección de colisión por sweep, y schema de status `snowballSlowTimer`. Marcado [!] post-jam.
- [!] **L Blizzard / Frozen Floor** — NO IMPLEMENTADO en v0.11. La L actual (Blizzard con frenzy spd × 1.40 / mass × 1.10) sigue siendo buff personal, no zona. Para implementar zona de hielo deslizante necesito extender el zone system con `slippery: boolean` flag (acceleration × 0.3, control reducido). Marcado [!] post-jam.

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
