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

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| `cheeto.glb` | Tripo AI + Tripo Animate | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 (anim 2026-04-21) | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `kermit.glb` | Tripo AI + Tripo Animate | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `kowalski.glb` | Tripo AI + Tripo Animate | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 (anim 2026-04-21) | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `trunk.glb` | Tripo AI + Tripo Animate | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 (anim 2026-04-21) | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `shelly.glb` | Tripo AI + Tripo Animate | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `kurama.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04-24 (pipeline Meshy) | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `sebastian.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04-24+ | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `sihans.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04-24+ | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `sergei.glb` | Tripo AI (mesh) + Meshy AI (rig/anims) | ⚠️ PENDIENTE — verificar en la cuenta | regen 2026-04-24 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |

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

**Riesgo alto**: los derechos comerciales de Suno **dependen del plan
bajo el que se generó cada track** (ver riesgos abajo).

| Asset | Generator | Account/Tier | Generation date | License terms | Commercial use OK? | Attribution required? |
|---|---|---|---|---|---|---|
| `intro.mp3` (title / select / waiting loop) | Suno (Advanced: Lyrics + Styles + Title) | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `ingame.mp3` (countdown + match loop) | Suno | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |
| `special.mp3` (victory stinger) | Suno | ⚠️ PENDIENTE — verificar en la cuenta | ~2026-04 | ⚠️ PENDIENTE — verificar en la cuenta | ⚠️ Sin verificar | ⚠️ Sin verificar |

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

1. [ ] **Meshy AI** — entrar en la cuenta y registrar aquí: plan
   activo hoy Y plan bajo el que se generaron Kurama / Sebastian /
   Sihans / Sergei (~2026-04-24). Pegar en este doc la cita textual
   de los license terms de ese plan.
2. [ ] **Tripo AI** — ídem: plan de la cuenta durante abril 2026
   (generación de los 9 meshes + animaciones Tripo Animate de
   Cheeto / Kermit / Kowalski / Trunk / Shelly). Pegar cita textual
   de los términos.
3. [ ] **Suno** — ídem: plan bajo el que se generaron `intro.mp3`,
   `ingame.mp3` y `special.mp3`. Pegar cita textual de los términos
   (sección commercial use).
4. [ ] **Identificar el generador de imagen 2D** usado para sprites,
   favicon, og-image/portada, badges PNG, skyboxes y ground textures
   (¿Midjourney? ¿DALL·E/ChatGPT? ¿SD local?) y el de los GLBs de
   cinturones y props de arena. Revisar historial de las cuentas y
   completar las filas "generador sin registrar".
5. [ ] Completar **fecha de generación exacta** por asset donde ponga
   `~` (el historial de cada cuenta las tiene).
6. [ ] Con todo lo anterior: marcar cada fila `Commercial use OK?`
   con ✅/❌ real, y decidir remediación para los ❌ (upgrade de plan,
   regeneración bajo plan de pago, o sustitución del asset).
7. [ ] Actualizar [ROADMAP](ROADMAP.md) H5 cuando el dossier quede
   en verde.

### ⚠️ Riesgos ya conocidos (a confirmar contra los términos vigentes)

- **Meshy free tier**: licencia los outputs como **CC BY 4.0** —
  exige **atribución** y los assets pueden quedar en **galería
  pública**. Si algún crítter se generó/animó en free tier, habría
  que atribuir a Meshy en el juego o regenerar bajo plan de pago.
- **Suno free tier**: **NO concede uso comercial** — Suno retiene la
  propiedad y el uso queda limitado a no comercial. Si los 3 tracks
  salieron del free tier, monetizar el juego con ellos sería una
  infracción directa: upgrade + regeneración (o verificación de que
  el plan de pago cubre tracks generados antes del upgrade — los
  términos de Suno varían en esto).
- **Tripo**: términos por tier menos conocidos — no asumir nada;
  verificar qué concede el plan usado (algunos generadores 3D
  también publican los outputs free en galería pública).
