# ASSET_LICENSES.md — Dossier de derechos comerciales

> **Por qué existe este archivo.** El hito **H5 (monetización)** del
> [ROADMAP](ROADMAP.md) — portales de juegos, ads, cualquier ingreso —
> exige tener **derechos comerciales verificados sobre cada asset
> generado con IA** que se distribuye con el juego. Los términos de
> uso de los generadores dependen del plan/cuenta bajo el que se generó
> cada asset, y eso **no está registrado** en el repo. Este dossier
> inventaría cada familia de assets, su generador y el estado de
> verificación. **H5 queda bloqueado hasta que todas las filas ⚠️
> estén resueltas.**
>
> Regla de oro: aquí no se inventan términos. Todo lo no verificado
> en la cuenta correspondiente queda como `⚠️ PENDIENTE`.

Fuentes de atribución usadas: [STACK.md](STACK.md) ("Content
generation"), [ASSET_PIPELINE.md](ASSET_PIPELINE.md),
[CHARACTER_DESIGN.md](CHARACTER_DESIGN.md) (tabla de fuente de
animación por crítter), [AI_PROMPTS.md](AI_PROMPTS.md),
[ARENA_PROMPTS.md](ARENA_PROMPTS.md) y [BUILD_LOG.md](BUILD_LOG.md).

---

## 1 · Crítters — 9 GLBs (`public/models/critters/*.glb`)

Todos los modelos base se generaron en **Tripo AI** (ver STACK.md).
La animación final vino por dos rutas: **Tripo Animate** (mismo
producto/cuenta que Tripo) o **Meshy AI** (re-rig + librería de
animaciones stock). Para los crítters ruta Meshy aplican **ambas**
licencias (mesh origen Tripo + export animado Meshy).

> **✅ Actualización 2026-08-17** — Rafa confirma que tanto **Tripo
> como Meshy estuvieron bajo plan de pago durante toda la creación del
> juego** (abril 2026; hoy ninguna de las dos suscripciones está
> activa). Términos verificados contra la documentación oficial:
> · **Meshy** ([help center](https://help.meshy.ai/en/articles/9992023-if-i-cancel-my-subscription-will-all-my-models-revert-to-a-cc-by-4-0-license)):
> los assets generados bajo plan de pago son **propiedad privada
> completa del usuario y NO revierten a CC BY 4.0 al cancelar** — uso
> comercial sin atribución, permanente.
> · **Tripo** ([licensing guide](https://www.tripo3d.ai/game-development/3d-assets-license-game-development)):
> los planes de pago conceden derechos amplios de uso, modificación,
> distribución y **monetización** de los outputs generados durante la
> suscripción; la retención post-cancelación es la práctica declarada,
> con la recomendación estándar de **archivar evidencia** (factura del
> plan + fechas de generación + snapshot de los ToS vigentes).
> **Único deber restante para estas filas: archivar la evidencia**
> (capturas del historial de facturación de abril 2026 en ambas
> cuentas) en `docs/licencias-evidencia/` (fuera del bundle del juego).

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| `cheeto.glb` | Tripo AI + Tripo Animate | Plan de pago (abr 2026) — archivar factura | ~2026-04 (anim 2026-04-21) | Derechos comerciales del plan de pago (ver nota) | ✅ Sí | No |
| `kermit.glb` | Tripo AI + Tripo Animate | Plan de pago (abr 2026) — archivar factura | ~2026-04 | Derechos comerciales del plan de pago (ver nota) | ✅ Sí | No |
| `kowalski.glb` | Tripo AI + Tripo Animate | Plan de pago (abr 2026) — archivar factura | ~2026-04 (anim 2026-04-21) | Derechos comerciales del plan de pago (ver nota) | ✅ Sí | No |
| `trunk.glb` | Tripo AI + Tripo Animate | Plan de pago (abr 2026) — archivar factura | ~2026-04 (anim 2026-04-21) | Derechos comerciales del plan de pago (ver nota) | ✅ Sí | No |
| `shelly.glb` | Tripo AI + Tripo Animate | Plan de pago (abr 2026) — archivar factura | ~2026-04 | Derechos comerciales del plan de pago (ver nota) | ✅ Sí | No |
| `kurama.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | Ambos de pago (abr 2026) — archivar facturas | ~2026-04-24 (pipeline Meshy) | Meshy paid: propiedad completa, no revierte al cancelar | ✅ Sí | No |
| `sebastian.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | Ambos de pago (abr 2026) — archivar facturas | ~2026-04-24+ | Meshy paid: propiedad completa, no revierte al cancelar | ✅ Sí | No |
| `sihans.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | Ambos de pago (abr 2026) — archivar facturas | ~2026-04-24+ | Meshy paid: propiedad completa, no revierte al cancelar | ✅ Sí | No |
| `sergei.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | Ambos de pago (abr 2026) — archivar facturas | regen 2026-04-24 | Meshy paid: propiedad completa, no revierte al cancelar | ✅ Sí | No |

**Nota de verificación**: para los 4 crítters ruta Meshy hay que
confirmar si el mesh que Meshy animó era el de Tripo (subida propia)
o una regeneración dentro de Meshy — CHARACTER_DESIGN.md sugiere
"regen" en Sergei. Cambia qué cuenta/licencia manda por asset.

## 2 · Cinturones y badges — 21 GLBs (`public/models/belts/`) + 21 PNGs (`public/images/belts/`)

Generados con IA a partir de los prompts de diseño de
[BADGES_DESIGN.md](BADGES_DESIGN.md) / AI_PROMPTS.md ("AI-generated
render prompt", ~2026-04-23). El generador concreto (imagen y 3D) no
quedó registrado en el repo.

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| 21 belt GLBs (9 Champion + 12 globales/online) | IA 3D — ⚠️ generador sin registrar (¿Tripo/Meshy?) | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04-23/24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| 21 badge PNGs (`public/images/belts/` + `_raw/`) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04-23/24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |

## 3 · Sprites HUD, iconos, favicon y og-image

AI_PROMPTS.md lista los generadores candidatos (Midjourney, DALL·E 3,
Stable Diffusion) pero no registra cuál produjo cada asset final.

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| `public/images/hud-icons.png` (4×7, 26 iconos) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `public/images/ability-icons.png` (3×9, 27 iconos) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `public/favicon-br.png` (marca BR) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `public/og-image.png` (crop de `Portada/BichitosRumble_Horizontal.png`) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-21 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |

`favicon.svg` / `favicon.ico` (fallback anterior) son hechos a mano
en el proyecto — propios, sin restricción.

## 4 · Arena packs — 5 skyboxes + 5 ground textures + 33 prop GLBs

Cada pack (`jungle`, `frozen_tundra`, `desert_dunes`, `coral_beach`,
`kitsune_shrine`) son 3 generaciones separadas: skybox panorama
2048×1024, ground texture tileable 1024×1024 y 5-8 props GLB (ver
ARENA_PROMPTS.md). El "generador IA" usado (con budget de prompt de
800 chars para props) no quedó registrado por nombre en el repo.

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| 5 skyboxes (`public/images/skyboxes/*.png`) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23/24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| 5 ground textures (`public/images/arena-ground/*.png`) | IA imagen — ⚠️ generador sin registrar | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23/24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| 33 prop GLBs (`public/models/arenas/<pack>/*.glb`) | IA 3D — ⚠️ generador sin registrar (¿Tripo/Meshy?) | ⚠️ PENDIENTE — verificar en la cuenta | 2026-04-23/24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |

## 5 · Música — 3 MP3 de Suno (`public/audio/`)

> **✅ Actualización 2026-08-17** — Rafa confirma **suscripción de pago
> de Suno activa** (también durante la generación en abril 2026).
> Términos verificados ([Suno Rights & Ownership](https://help.suno.com/en/categories/550145)
> + [análisis](https://dynamoi.com/learn/ai-music-distribution/suno-commercial-rights-explained)):
> las canciones creadas bajo Pro/Premier **son propiedad del usuario
> con derechos comerciales permanentes**, aunque la suscripción
> termine después — lo que manda es el plan activo **en el momento de
> crear** el track. Deber restante: archivar factura de abril 2026.

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| `intro.mp3` (title / select / waiting loop) | Suno (Advanced: Lyrics + Styles + Title) | Plan de pago (activo; también en abr 2026) | ~2026-04 | Propiedad del usuario, derechos comerciales perpetuos | ✅ Sí | No |
| `ingame.mp3` (countdown + match loop) | Suno | Plan de pago (activo; también en abr 2026) | ~2026-04 | Propiedad del usuario, derechos comerciales perpetuos | ✅ Sí | No |
| `special.mp3` (victory stinger) | Suno | Plan de pago (activo; también en abr 2026) | ~2026-04 | Propiedad del usuario, derechos comerciales perpetuos | ✅ Sí | No |

## 6 · SFX sintetizados — código propio

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| Todos los SFX (Web Audio API, `src/audio.ts`) | Sintetizados por código propio — sin IA | n/a | 2026-03/04 | Propios (código del proyecto) | ✅ Sí | No |

## 7 · Fork mesh2motion (`mesh2motion/` → `/animations`) — el caso CLARO

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| Código del lab (fork de [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app)) | Open source upstream | n/a | fork 2026-04 | MIT (`mesh2motion/LICENSE-MIT.MD`) | ✅ Sí | Aviso de copyright MIT (mantener el fichero de licencia) |
| Librería de animaciones GLB (`public/animations/animations/*.glb`) | Assets upstream | n/a | upstream | CC0 (`mesh2motion/LICENSE-CC0.MD`) | ✅ Sí | No |
| Sample FBX CMU (`public/animations/animations/CarnegieMellonAnimations/`) | Mocap CMU vía pack gratuito (rancidmilk.itch.io, incluido en upstream) | n/a | upstream | CC0/libre según upstream — ver `readme.txt` del directorio | ✅ Sí (verificación trivial) | No |

Este es el único bloque con derechos claros hoy. Nota: el lab es
interno (`noindex`) pero **se despliega y se sirve** en
`/animations`, así que cuenta como distribución.

---

## ✅ Checklist de acción para Rafa (desbloquea H5)

> **Estado 2026-08-17**: los tres frentes grandes (crítters Tripo/Meshy
> + música Suno) quedaron en verde al confirmarse que se generaron bajo
> planes de pago. Lo que queda es archivado de evidencia + identificar
> el generador de los assets 2D.

1. [x] **Meshy AI** — ✅ plan de pago durante abril 2026 (confirmado
   por Rafa 2026-08-17). Términos verificados: propiedad completa,
   sin reversión a CC BY al cancelar, sin atribución.
2. [x] **Tripo AI** — ✅ plan de pago durante abril 2026 (confirmado
   por Rafa 2026-08-17). Derechos comerciales del plan de pago.
3. [x] **Suno** — ✅ suscripción de pago (activa hoy y en abril 2026).
   Derechos comerciales perpetuos sobre los tracks creados bajo plan
   de pago.
4. [ ] **Archivar evidencia** (~10 min): capturas/PDF del historial de
   facturación de abril 2026 de Meshy, Tripo y Suno →
   `docs/licencias-evidencia/` (carpeta fuera del bundle; los ToS
   pueden cambiar y la prueba de qué plan estaba activo al generar es
   lo que sostiene el dossier).
5. [ ] **Identificar el generador de imagen 2D** usado para sprites,
   favicon, og-image/portada, badges PNG, skyboxes y ground textures
   (¿Midjourney? ¿DALL·E/ChatGPT? ¿SD local?) y confirmar que los
   GLBs de cinturones y props de arena salieron de las mismas cuentas
   de pago Tripo/Meshy (si es así, heredan el ✅ de arriba).
6. [ ] Con el punto 5: cerrar las filas pendientes de las secciones
   2, 3 y 4.
7. [ ] Actualizar [ROADMAP](ROADMAP.md) H5 cuando el dossier quede
   100 % en verde.

### 📌 Decisión de suscripciones futuras (anotada 2026-08-17)

Hoy no hay suscripción activa de Meshy ni Tripo, y **no hace falta
hasta que se generen assets nuevos** (fase H4: crítters/skins/packs
nuevos). Intención de Rafa: retomar **solo una** de las dos.
Recomendación registrada: decidir en H4 según lo que pida el pipeline
— **Tripo** cubrió mesh + animación (Tripo Animate) de la mayoría del
roster con una sola cuenta, Meshy fue la ruta alternativa de rigging
para 4 crítters; los términos post-cancelación de Meshy son los más
explícitos legalmente. Mientras tanto: 0 €/mes en generadores 3D.

### ⚠️ Riesgos residuales

- ~~Meshy free tier CC BY 4.0~~ — **no aplica**: plan de pago
  confirmado durante la generación.
- ~~Suno free tier sin uso comercial~~ — **no aplica**: plan de pago
  confirmado.
- **Assets 2D con generador sin identificar** (secciones 2-4): es el
  único frente con incertidumbre real. Si salieron de un tier gratuito
  de algún generador de imagen, la remediación típica es barata
  (regenerar bajo plan de pago o sustituir); resolver antes de H5.
- **Evidencia sin archivar**: hasta completar el punto 4, la
  confirmación es declarativa. Con las facturas archivadas, el dossier
  queda defendible.
