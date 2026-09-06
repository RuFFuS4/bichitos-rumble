# Next Steps — Bichitos Rumble

> **Doc operativo de la fase post-jam.** Solo la **checklist del hito EN
> CURSO**. Plan completo: [`ROADMAP.md`](ROADMAP.md) · foto del proyecto:
> [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
> Al cerrar un hito: tag, y esta checklist se reescribe para el siguiente.

**H0 Saneamiento: ✅ `v1.2-clean-base`** · **H1 Modernización: ✅
`v1.3-modern-stack`** · **H2 Dieta de payload + presencia base: ✅
`v1.4-portal-ready`** (2026-08-19 — dist −59 %, huella inicial ~1,5 MB,
itch.io publicado con donaciones) · **H3 Bichitos Studio: ✅
`v1.5-bichitos-studio`** · **Afilado: ✅ `v1.6-afilado`** · **H4 Retención
+ social: ✅ `v1.7-h4-social`** (2026-09-05, Vercel + Railway verificados,
sala privada real en prod; detalle en [`ROADMAP.md`](ROADMAP.md) y
[`BUILD_LOG.md`](BUILD_LOG.md)).

---

## Cómo retomar — cierre del 2026-09-07

Árbol limpio y todo empujado. En producción sigue **`v1.7-h4-social`**:
todo el terreno v2, el fondo y los dioramas viven solo en `dev`, **sin
desplegar** (`git log --oneline main..dev` los lista).

**Lo primero de la próxima sesión, por orden:**
1. **Rafa mira capturas y decide.** La ÚNICA hoja de contactos que
   enseña el estado de hoy es **`.tmp/shots-cierre/`** (los 5 biomas,
   t=0, tomada al cerrar sobre el `dev` de hoy). Las otras son
   históricas y **engañan si se miran como estado actual**:
   `shots-despues/` son las capturas rotas del segundo ~52 (ver
   ERROR_LOG), `shots-fondo/` es anterior a los dioramas y
   `shots-dioramas/`/`shots-discmap/` son anteriores a la escala de suelo
   por bioma. De `shots-cierre/` salen las tres decisiones que hoy
   bloquean el afinado: techos del scatter (M2), isla como cono, y si el
   fondo ya vale. Sin ellas, afinar recetas es afinar contra el techo
   equivocado. Para rehacerla: dev server vivo +
   `node scripts/arena-shots.mjs --out .tmp/shots-<lo-que-sea>`.
2. **Relanzar el diagnóstico del feeling desde cero.** El de hoy se cortó
   sin entregar y su caché solo vive dentro de la sesión que lo lanzó. Lo
   ya medido está en el punto "Feeling de los personajes" de la cola.
3. **Decidir el despliegue**: merge `dev` → `main` con tag cuando las
   capturas convenzan. Railway autodeploya el servidor desde `main`, así
   que cliente y servidor salen a la vez.

**Esperando respuesta de Rafa** (bloquean trabajo, no son opinión):
- **Portal del Vibe Jam**: ¿fuera también en **itch** —que es un embed
  de nuestra propia web, no un zip— o solo en la build de Steam? El
  mecanismo ya está identificado; falta el alcance.
- **Techos de altura del scatter**: contrato actual vs reglas de
  `docs/DIORAMAS.md §3` (decisión M2, más abajo).
- **¿Isla como cono** flotando en mar / aire / hielo según el bioma?
- **¿El fondo** (mar por bioma) te vale como está?

**Estado de la máquina**: quedaron ~70 procesos de Chrome de las tandas de
hoy, sin cerrar a petición de Rafa. Los lanzaron agentes anteriores al
helper mudo; a partir de ahora toda instancia de prueba nace muda
(`scripts/lib/headless-browser.mjs`).

---

## H4.5 — Arreglar antes de crecer (EN CURSO desde 2026-09-05)

Contexto: Rafa quiere un juego más grande y monetizable (referencias
smashkarts.io y krunker.io), hasta 8 por partida y Steam — eso es **H6**
tras H5 (orden acordado: modo por tiempo → progresión → cosméticos →
Steam; ver ROADMAP). Pero *"antes de ampliar y avanzar hay que arreglar
cosas… la generación de los terrenos es muy muy pobre"*. Diagnóstico y
plan completo: [`docs/ARENA_V2.md`](docs/ARENA_V2.md).

**Decisiones de Rafa — TOMADAS el 2026-09-06** ("vamos con los 4 puntos",
las cuatro por la recomendación; razones en `docs/ARENA_V2.md §6`):
1. [x] **Micro-slice de gameplay SÍ, ahora** (fase 0.5): medios lotes
       contiguos del patrón A con rotación por semilla, `layout.pattern`
       explícito y `radiusAt(angle)`, aprovechando el único
       `golden:write` de H4.5. Zona hard-stop: bots, respawn y
       proyectiles; despliegue cliente+servidor a la vez.
2. [x] **Fuera el void** (cilindro + disco negro de `src/arena.ts`) y a
       confiar en el skybox del pack; fondo por bioma solo donde no
       baste (fase 3). Se decide sobre capturas de los 5 packs, y hay
       que conservar `VOID_FLOOR` y el descarte de fragmentos que caen.
3. [x] **Dieta de props SÍ** (palmas, bambú, sakura: 112-131k → ≤20k
       tris con `scripts/optimize-arena-props.mjs`) antes de encender
       ninguna sombra de props, con galería antes/después para tu ojo.
4. [x] **Perfil 8P provisional fijado**: r 16 (804 u², ~100 u²/jugador),
       islote 3,5 u, 4 bandas, 150 s de partida (primer lote a 0,2 y
       colapso total a 0,8 de la duración), última banda resistente.
       Solo condiciona la parametrización de la fase 5; se valida con
       `?arenaView=1&profile=8p` cuando exista el perfil en H6.

**Terreno v2 — fases** (alcance, ficheros y criterios en
`docs/ARENA_V2.md §3`; cada fase en su rama, hoja de contactos como
entregable):
- [x] **Fase 0 — red de seguridad + CLI** (2026-09-06): scraper de
      paridad de los espejos del sim en `npm run check`, 16 invariantes
      Vitest del generador, golden de layout por hash (67 semillas, ms),
      CLI `npm run arena` (ascii/json/timeline/curve/svg/sweep),
      observabilidad real del colapso offline (el golden de partidas ya
      registra `collapse_warn`/`collapse_batch`), `test:sim` en CI y
      docs con las cifras reales. Revisado por 2 agentes adversariales.
- [x] **Fase 0.5 — micro-slice de gameplay** (2026-09-06): lotes
      parciales como ARCO CONTIGUO con arranque por semilla (frente
      legible en el 100 % de las partidas, antes 48,3 %),
      `layout.pattern` explícito y `radiusAt(angle)` en bots (los dos
      lados) y expiración de proyectiles. Golden de partidas y de layout
      regenerados; verificado en pantalla.
- [x] **Fase 1a — el disco se convierte en un lugar** (2026-09-06):
      tile de textura a escala real, tinte por banda/pack/semilla,
      acantilado con material propio, fuera el void y fuera la falda,
      luz lateral, `ARENA_LOOK` + `arena-shots`. Golden 3/3 SIN
      regenerar (todo visual). *(Las capturas de `.tmp/shots-despues/`
      con las que se juzgó esta fase estaban ROTAS —segundo ~52 de
      partida, ver ERROR_LOG 2026-09-07—; el estado real está en
      `.tmp/shots-cierre/`.)*
- [ ] **DIORAMAS — prioridad de Rafa (2026-09-07)**: *"hay que mejorar
      muy mucho o directamente rehacer la generación de los dioramas,
      ahora simplemente se ve como un círculo con 4 cosas sueltas e
      interesa que se vea como algo denso, como un ambiente real, esto es
      muy importante para darle identidad visual"*. Medido: 11-18 props
      por bioma, casi todos entre r 7 y 11,5 (solo 1 por pack a r<8,5) y
      cero instancing en el proyecto *(medido ANTES del slice 1; hoy ya
      hay dos `InstancedMesh`)*. Diagnóstico y plan en
      [`docs/DIORAMAS.md`](docs/DIORAMAS.md). Va ANTES que la fase 1b.
      - [x] **Fase 0 (ojo limpio)** 2026-09-07: capturas honestas, props
            en paralelo.
      - [x] **Slice 1** 2026-09-07 (`claude/feature/dioramas-1`): contrato +
            motor instanciado + 7 primitivas + recetas de los 5 biomas +
            masa del canto (cuña con estratos por bioma) + sombras de
            contacto de critters + 6 tests. Referencias: las imágenes de
            `resources/Terrenos/*/`. **← MIRA `.tmp/shots-cierre/*.png`**
            (`shots-dioramas/` es anterior a la escala de suelo por bioma).
      - [x] **Escala del suelo por bioma** 2026-09-07 (idea de Rafa):
            `PackDef.groundTile`. Las texturas traen el detalle pintado y
            a 4 u se repetían 6 veces por diámetro. Probado el mapa único
            del disco: gana en kitsune, pierde en coral → la escala es de
            cada bioma. Descartado modelar la referencia con IA (no se
            puede fragmentar para el colapso).
      - [ ] Slice 2: afinar recetas sobre capturas (grietas de hielo,
            escala de acentos, `backOnly` para los altos), fleco del borde
            que se regenera al caer un sector, viento animado barato,
            recomponer los 73 props autorados (muro caído de sillares,
            héroes fuera del arco frontal), `SCATTER_DENSITY` en el studio
            y applier ToolPatch `scatter-patch`.
      - [ ] Decisión de Rafa (review M2): los techos de altura del scatter
            (`SCATTER_LIMITS`: interior 0,4 u · arco frontal ±90° 1,2 u ·
            trasero 2,6 u) son más permisivos que las "reglas duras" de
            `docs/DIORAMAS.md §3` (combate 0,55 · arco cercano ±55° 0,55 ·
            fleco ≤0,6 · nada cruza r=12). Hay que cerrar UNA de las dos
            antes de afinar recetas contra el techo equivocado. Mi
            recomendación: mantener el contrato actual (lo que se ve en
            las capturas) y corregir el doc — el fleco que asoma 0,6 u
            fuera del labio es justo lo que piden tus referencias.
      - [ ] Decisión de Rafa: ¿la isla como CONO (base que se estrecha
            mucho más, o cerrada en punta) flotando en mar / aire / hielo
            según el bioma? El taper de 0,82 ya apunta ahí; subirlo es un
            número (`ARENA_LOOK.cliffTaper`) y cerrarlo en punta es media
            tarde. El desprendimiento no se complica: cada sector lleva su
            cuña y cae con ella.
- [x] **FONDO — primer slice hecho (2026-09-07)**: la isla flota sobre el
      mar de su bioma en vez de estar recortada sobre una panorámica.
      0 bytes, 1 draw call, golden intacto. Plan completo en
      [`docs/DIORAMAS.md`](docs/DIORAMAS.md) (relieves, cresta de
      siluetas y luz por bioma quedan para las fases 2-5).
      **← DECIDE**: ¿te vale que el vacío deje de estar vacío? El fondo
      actual se ve en `.tmp/shots-cierre/` (`shots-fondo/` es de antes de
      los dioramas).
- [ ] Fase 1b — bisel de junta, applier ToolPatch `look-patch`, panel
      del studio y dieta de props. *(Las sombras de contacto de critters
      salieron adelantadas en el slice 1 de dioramas: `blob-shadows.ts`.)*
- [ ] Fase 2 — colapso que se lee y se siente.
- [ ] Fase 3 — cada bioma es un sitio.
- [ ] Fase 4 — props que pertenecen al suelo (+ higiene: GLB crudo de
      54 MB versionado en `public/models/arenas/jungle/_raw/`).
- [ ] Fase 5 — todo lo visual en función del radio.

**Cola de Rafa (2026-09-07, por orden de lo que dijo)**:
- [ ] **Feeling de los personajes** (PENDIENTE; el diagnóstico del
      2026-09-07 se cortó sin entregar — relanzar de cero): *"se
      sienten pesados en vez de animalillos graciosos andando, corriendo
      y demás"*. Dato de partida: los 9 GLB SÍ traen 6-10 clips (Idle,
      Run, Fall, Victory, Defeat, habilidades), pero el clip de Run se
      reproduce a velocidad FIJA (`meta.speed ?? 1`), así que un critter
      a 8 u/s y otro a 18 u/s mueven las patas igual y los pies patinan.
      Falta además el vocabulario cartoon: inclinación al acelerar y al
      girar, squash al frenar, stretch al salir despedido, anticipación,
      e inercia en orejas y cola.
- [ ] **Shaders cartoon para los personajes** (Rafa: "más adelante").
      Ojo al precedente de la fase 1a: activar tone mapping o PMREM toca
      TODA la escena; un toon shader es lo mismo pero peor. Va tras flag
      y con comparativa del roster de nueve delante.
- [ ] **Dioramas, segunda pasada** (Rafa: "no parecen muy cohesionados
      los elementos"). Cohesión = paleta compartida entre scatter, props
      GLB y suelo; que los elementos se toquen y se agrupen en vez de
      flotar sueltos; sombras de contacto también en los props.
- [ ] **Portal del Vibe Jam fuera de itch y Steam**: hoy `#portal-legend`
      (`src/hud/hud.partial.html`) y el portal de salida (`src/portal.ts`)
      están SIEMPRE activos, y el jam terminó en mayo. **Dato verificado**
      (BUILD_LOG 2026-08-19, cierre de H2): itch.io **no sirve un zip**,
      es un *embed fullscreen de producción* — el mismo build de nuestra
      web dentro de un iframe. Por eso un flag de build a secas no vale:
      apagaría el portal también en la web propia, que es donde sí lo
      queremos. Plan: leer el interruptor de la URL (`?portal=0`), que
      Rafa lo añada a la URL del embed en los ajustes de itch, y dejar el
      flag de build (`VITE_PORTAL=off`) para el empaquetado de Steam, que
      ése sí es una build aparte. **Lo único que falta decidir**: ¿fuera
      también en itch, o solo en Steam?

- [x] **Instancias de prueba mudas** (2026-09-07, commit `0bb2044`):
      *"cuando lances instancias para las pruebas silencia la musica y
      sonidos"*. `scripts/lib/headless-browser.mjs` con doble capa
      (`--mute-audio` + banderas de `src/audio.ts` en localStorage antes
      del primer script), aplicado en `arena-shots.mjs`,
      `run-match-batch.mjs` y `playwright.config.ts`. Regla escrita en
      `CLAUDE.md` y `DEV_TOOLS.md`.

**Otros arreglos candidatos de H4.5**: feel pass de Kurama · SFX por
critter · limpiar nicks `SMOKE*`/`Test*` de la DB de prod
(`admin:delete-test`) · facturas y generador 2D (licencias) · tabla
multi-dispositivo de tokens (diferido del review). Lo que solo pueden
hacer tus manos sigue en §CHECKLIST más abajo.

---

## H3 — Bichitos Studio: tooling unificado (✅ cerrado 2026-08-19, histórico)

**Meta**: las 4-5 herramientas internas (anim-lab, calibrate,
decor-editor, tools.html, mesh2motion) se convierten en **un solo
estudio** con el bucle intención→cambio-aplicado en 1-2 pasos
(hoy: 5-6 pasos manuales). Detalle y racional en
[`ROADMAP.md`](ROADMAP.md) §H3.

1. [x] **Pipeline de patches completo y no destructivo** (slices 1+3):
   merge de anim-lab (nunca borra), decor-editor emite DecorEditorPatch,
   validación de identificadores, notas de diseño a headers de pack.
2. [x] **Persistencia uniforme** (slice 2): anim-lab autosalva/restaura
   la sesión; divergencia por valores en calibrate; Re-fit persiste.
3. [x] **Apply directo desde la UI** (slice 4): plugin Vite dev-only
   (`/__tool-patch/preview|apply`) + botón "⚡ Apply to source" con
   modal de diff bloqueante en los 3 labs. Bucle tune→código en
   2 clicks, verificado e2e.
4. [x] **UI kit compartido de labs** (slice 5): lab-theme.css + lab-kit
   (orbit/resize con dispose, escapeHtml) en las 3 páginas; decor
   adopta la paleta común.
5. [x] **studio.html** (slice 6): shell de tabs con iframes lazy
   keep-alive (aislamiento gratis, estado preservado al cambiar de
   tab, standalone pages intactas). Match Lab ya es una tab.
6. [x] **Paridad del match lab** (slice 7): scene-atmosphere +
   frame-ticks compartidos — fin del doble boot (ciclo arena→main
   roto), habilidades con zonas/proyectiles vivas en el lab, atmósfera
   de producción. Ya era tab del studio desde el slice 6.
7. [x] **Evict mesh2motion** (slice 8): repo hermano
   `../bichitos-mesh2motion` con contratos parametrizados
   (BICHITOS_GAME_ROOT); el juego pasa de 996 → 333 ficheros
   trackeados. Sin reescritura de historia (decisión de Rafa).

**H3 CERRADO (2026-08-19)** — tag `v1.5-bichitos-studio` (main 432511b),
smoke de producción verde (title → vs Bots → match con el loop
refactorizado, 0 errores). Gate completo: apply en 2 clicks con diff ✅
· cero pérdida al recargar ✅ · mesh2motion fuera ✅.

**Decisiones de Rafa (2026-08-19)**: borrar overrides = edición manual
del fuente (sin tombstones por ahora) · comentarios de DECOR_LAYOUTS →
docstrings por pack antes de activar el apply JSON (slice 3) ·
mesh2motion: evict solo working tree, SIN reescritura de historia ·
match lab: SE EMBEBE como tab del studio (slices 6-7, aunque cueste
más — unificación completa).

---

## Fase de afilado (✅ completa 2026-08-20 — plan en docs/AFILADO_PLAN.md)

**Decisiones de Rafa (2026-08-19)**: (1) tuning **offline-first**, el
server (server/src/sim/*) se sincroniza al FINAL de la fase — el check
de paridad de habilidades pasa a modo aviso durante la fase con flag
explícito y vuelve a bloquear en la sync; (2) el melón de
physicsRadius per-critter SE ABRE (visible + editable + rebalanceo);
(3) el port de mesh2motion upstream va PRONTO (tras la cabina de
tuning, antes de producir clips).

Orden acordado:

1. [x] **Slice A — batch de quick-wins**: los 17 items del plan (pack
   picker + setup persistente + Mark moment + aviso de recording en el
   match lab; fix Re-fit + wip + slot persistente en calibrate;
   duplicar/snap/zoom/ambiente de pack/cabecera-spec en decor; FEEL
   centralizado (physics/game); check pws en CI; deep-links + dirty
   dots + atajos en studio; CLI acepta el nombre de downloadPatch;
   DEV_TOOLS.md al día). Implementado por 5 agentes en paralelo sobre
   ficheros disjuntos, verificado con tsc + 36 tests + e2e.
2. [x] **Slice B — cabina de tuning**: F7 step-frame / F8 pausa / F9
   slow-mo / F10 mismo seed + FEEL tuner de 66 sliders auto-generados
   mutando en vivo + `feel-patch` (4º tool type, 42 tests) con Apply
   to source. Verificado e2e.
3. [x] **Slice C — tuner de habilidades + hitbox**: anillos de
   physicsRadius en calibrate (slider + persistencia + campo sparse en
   CalibratePatch que solo reescribe la R compartida al divergir) +
   tuner de AbilityDef del critter vivo en el match lab (defs mutadas
   en vivo, baselines cacheados, Copy JSON para porte manual — sin
   ToolPatch deliberadamente). 43 tests, e2e verde.
4. [x] **Slice D — port mesh2motion upstream** (pick 8, repo hermano,
   2026-08-19): árbol upstream 0.185 encima + 40/41 marcadores
   reaplicados (1 obsoleto) por 4 agentes + integración manual
   (create.html, package sin wrangler, tsconfig, meshopt decoder — el
   lab llevaba roto para GLBs comprimidos desde H2 y el port lo
   destapó — y barrido de rutas root-absolute). Verificado: build,
   67/67 vitest, e2e create flow (Cheeto pre-rigged → 162 clips) y
   **probe issue #139 OK**: GLB Tripo en el retarget Swing-Twist nuevo
   de upstream (auto-map + bake + preview) → pipeline de signature
   moves des-riesgado. Merge --no-ff en main del hermano (f6d603e).
   Detalle: PORT_MAP.md del repo hermano. Los 365 .webm heredados
   (7,9 MB) que 0.185 ya no usaba se borraron a continuación (11c4692).
5. [x] **Slice E — salida del animation tuner** (pick 7, 2026-08-20):
   tabla PERSONALITY_OVERRIDES consultada por derive + 5º tool type
   `anim-personality` (merge no destructivo, 8 tests golden → 51/51,
   CLI + endpoint) + tuner con persistencia que sobrevive F10 y trío
   Copy/Download/Apply. E2e del círculo completo verificado (slider →
   tabla real → reload → derive consume la tabla).
6. [x] **Slice F — HUD fuente única** (pick 5, 2026-08-20): el HUD
   in-match extraído a src/hud/hud.partial.html e inyectado por plugin
   de vite en ambos entries (index −702 líneas, tools −587); el lab
   gana la familia .lives-* y el preload de sprites compartido.
   Paridad verificada: 187 propiedades computadas en index, cero
   diferencias. La clase de drift muere estructuralmente.
7. [x] **Slice G — determinismo + batch runner** (pick 6, 2026-08-20):
   un seed = una partida entera (match-rng sembrado con el seed del
   arena; bots/respawn/drops), autopilot del slot player, fixed-step
   con render decimado, y `npm run batch` (playwright headless):
   winrates agregados + `--verify` → REPRODUCIBLE: yes con 218
   eventos idénticos. Cierra el hueco dual-surface del match runner
   headless y el volcado de recordings.

**FASE DE AFILADO COMPLETA** (8/8 picks, slices A-G). Hueco menor que
queda del dual-surface: applier de ability-tuner (ToolPatch a
CRITTER_ABILITIES).

## Balance v2 (2026-08-21 — primer bloque de la etapa de mecánicas)

Marco, reglas, estado del roster y cola de mecánicas en
[docs/BALANCE.md](docs/BALANCE.md). Ejecutado en un día con las
herramientas del afilado (108+ partidas medidas):

1. [x] Auditoría de balance (54 partidas, 9 critters autopilot).
2. [x] Marco v2: `npm run balance` — cero potencia fuera de
   presupuesto (boost y overrides tasados). Hallazgo: Trunk +50.4 de
   presupuesto efectivo con el roster en 0..+5.
3. [x] Ronda 1: Shelly boost 1.30, Kurama 1.15, Sebastian masa 0.8.
4. [x] Ronda 2 (decisiones de Rafa): Trunk domado (boost→1.0, elefante
   intacto) + bots con conciencia del borde (cliente+server) — caídas ↓
   en 6/9, partidas 51→68s.
5. [x] It3: Steel Shell despierta (retag defensive + trigger
   anticipatorio del cerebro).
6. [ ] **Siguiente**: mecánicas de balanceo para Shelly (shell que
   refleja knockback) y Sebastian (que el cañón conecte en meta-bot) —
   principio nuevo de Rafa: las mecánicas tienen fuerza en el
   balanceo. Arranque natural de la fase de mecánicas y assets.

## Tanda grande 2026-08-24 (autónoma) — H4 en marcha

Hecho y en dev (detalle en BUILD_LOG): salas privadas + enlace + share
(e2e verde) · i18n ES/EN 131 claves · dieta de payload 96.9→69.7 MB ·
golden sim guardian + ability-patch (dual-surface 100%) · paridad bot
server · 9 fixes del review adversarial aplicados.

## CHECKLIST — verificada por Claude el 2026-09-05 (campaña Playwright)

Evidencia en .tmp/checklist/ (report.json + capturas) y BUILD_LOG.

| # | Item | Estado |
|---|---|---|
| 1 | Shell-reflect offline | ✅ mecánica (tests exactos + golden) — *feel* pendiente de Rafa |
| 2 | Claw Wave de Sebastian | ✅ mecánica (test del cono + batch) — *feel* pendiente |
| 3 | Bots con conciencia del borde | ✅ batch (caídas ↓ 6/9, partidas 51→68s) |
| 4 | Reconnect | ✅✅ e2e: setOffline → Reconectando… → RECONNECTED en server → humano de vuelta |
| 5 | Sala privada | ✅ e2e: A crea, B entra por enlace a la misma sala, quickmatch aislado |
| 6 | Código de recuperación | ✅ e2e: mismo playerId+nick en contexto limpio |
| 7 | Reflect online | ✅ mecánica (broadcast testeado) — sonido pendiente de oído |
| 8 | Métricas | ✅ partida real → totalMatches 1, duración media 94s |
| 9 | PWA | ✅ manifest/iconos/viewport-fit — **instalar en móvil: Rafa** |
| 10 | Reduced motion | ✅ motionScale 0.3 con la media query, 1.0 sin ella |
| 11 | ES en móvil | ✅ cero desbordes landscape+portrait, capturas revisadas |
| 12 | Pase visual | ✅ 5 arenas + Hall of Belts 16/16 revisados a ojo: sin artefactos |
| 13 | Revisión networking | ✅ review de 17 agentes → 13 confirmados, 10 arreglados (7b4a4e6) + e2e del zombi |
| 14 | Merge dev→main + tag | ✅ hecho el 2026-09-05 (`v1.7-h4-social`). El SIGUIENTE merge, el de H4.5, sigue esperando decisión de Rafa |

**Solo tus manos (lo que no se puede simular):**
- [ ] Sentir shell-reflect, Claw Wave y el reflect online con sonido.
- [ ] Instalar la PWA en Android (standalone, apaisada, icono).
- [ ] Con 2 dispositivos reales: reconnect con wifi de verdad; recuperar
      el nick en el móvil y ver el aviso "identidad usada en otro
      dispositivo" en el PC; entrar por enlace a una sala ya empezada
      (alert legible); que el rival cierre la pestaña en un 1v1 (tú +1
      win, él +1 loss); una privada completa NO debe mover el Hall of Belts.
- [x] Merge dev→main + tag — hecho 2026-09-05 (`v1.7-h4-social`, Vercel y
      Railway verificados, sala privada real contra prod OK).

Diferido del review (estructural): tabla multi-dispositivo para tokens
(hoy recuperar en B invalida el token de A con aviso explícito).

**Para Rafa (pendientes que solo puedes hacer tú):**
- [ ] Playtesting: shell-reflect y Claw Wave (de la sesión anterior) +
      probar una sala privada con alguien de verdad + ojear las 10
      traducciones de autor (BUILD_LOG 2026-08-24 / i18n.ts).
- [ ] Pase visual de arenas y belts tras el gltfpack (cuantiza; golden
      no ve píxeles) y del juego en ES en móvil.
- [ ] Revisión de la zona networking (salas privadas tocan BrawlRoom).
- [x] Merge dev→main + tag — hecho 2026-09-05 (`v1.7-h4-social`).

**Backlog H4 restante (por tamaño):**
- [ ] Reconnect (allowReconnection) — el más valioso de retención.
- [ ] Slayer Belt real (wiring lastHitBy→kills_vs_humans) + integridad
      de leaderboards (vs bots no puntúa; rage-quit = derrota).
- [ ] Identidad con código de recuperación · tabla matches server.
- [ ] PWA manifest + prefers-reduced-motion (pequeños, quedaron fuera
      de la tanda).
- [ ] Split abilities.ts + ~20 tests Vitest del sim · shared sim
      package (el refactor de más palanca — con el golden de guardián).
- [ ] Diferidos del review: feedback visual del shell-reflect online,
      calibrate en comentarios de bloque, validación del partial.
- [ ] Payload frontera: simplificar sebastian/kermit/kurama (44 MB)
      para el ≤50 MB de H2 (hard-stop: decisión de diseño).

## Dirección post-H3 (fijada por Rafa, 2026-08-19)

1. **Afilado de herramientas + investigación**: al cerrar los slices,
   valorar ampliar/optimizar las herramientas de control del juego e
   investigar qué se nos puede haber pasado para hacerlas más
   eficientes, eficaces y sobre todo útiles (candidato natural: cierre
   de H3 o mini-fase H3.5 antes de H4).
2. **Mecánicas y assets a fondo**: después de las fases de tooling,
   entrar de lleno en mecánicas del juego y assets — mejorarlos,
   ampliarlos y darle al juego "otra dimensión". Encaja con H4
   (retención/social) pero con más ambición en game feel y contenido.

## Flecos heredados (no bloquean H3)

- [x] **Sentry revisado (2026-08-19)**: cero errores reales de los
  deploys H1/H2 (solo los 2 smoke-tests del H0, ya resueltos → feed a
  cero). **Gates H1 y H2 formalmente cerrados.**
- [x] **Devlog de lanzamiento publicado**: "From Vibe Jam to itch.io —
  Bichitos Rumble is live!" (tipo Major Update or Launch, tag launch,
  screenshots adjuntos).
- **itch.io post-publish**: vigilar comentarios/analytics la primera
  semana.
- Rafa: archivar facturas abril 2026 (Meshy/Tripo/Suno) →
  `docs/licencias-evidencia/`.
- Rafa: identificar el generador 2D de sprites/skyboxes/badges
  (ASSET_LICENSES.md §5).
- Rafa: limpiar los jugadores TestSmoke*/TestC*/TestD* de la DB de
  producción (`npm run admin:delete-test -- --confirm` en Railway).
- H4 (anotados): reactivar reconexión del SDK cuando el server tenga
  `allowReconnection` + `onDrop`; rutas HTTP tipadas de 0.17 para la
  tabla `matches`; heavies GLB con `-si` si hace falta más dieta.
