# Plan de afilado — investigación 2026-08-19

> Producido por el workflow afilado-investigacion (5 auditorías de código
> + 3 investigaciones web + síntesis). Objetivo: herramientas más útiles
> PARA la fase de mecánicas y assets. La checklist operativa vive en
> NEXT_STEPS.md cuando Rafa elija; esto es el plan completo con evidencia.

## Top picks (impacto/esfuerzo)

### 1. FEEL tuner en vivo + tool type 'feel-patch' en ToolPatch — esfuerzo M

Es el hueco número uno señalado por las 4 auditorías: el bucle central de la fase (tunear hit stop, shake, squash, knockback) hoy es editar gamefeel.ts a ciegas + full reload + recrear la situación (~30-60s por iteración). FEEL ya está centralizado y se lee en call-time por frame, así que sliders en runtime funcionan sin tocar gameplay; el patrón de sliders ya existe (ANIM_PARAMS en sidebar.ts) y el mutador de feel-patch es MÁS simple que el merge de anim-lab (solo reemplaza tokens numéricos en líneas existentes, los comentarios de tuning sobreviven). Cierra el círculo: tunear en partida → Apply to source en 2 clicks. Es la primera vez que el pipeline H3 paga de verdad su inversión. Se descarta Tweakpane: el UI kit propio ya cubre esto.

**Anclaje**: src/gamefeel.ts:8-144 (FEEL), src/tools/sidebar.ts:756-868 (tuningGroup, patrón en :759-786), scripts/tool-patch-core.mjs:44-53 (tablas extensibles), src/tools/apply-ui.ts (flujo preview→diff→apply reutilizable)

### 2. Control de tiempo completo en el match lab: hotkeys pause/slow-mo + step-frame — esfuerzo S

El caso de uso central del slow-mo (congelar ESTE impacto para verlo) es inutilizable hoy: Playback está colapsado y requiere soltar WASD e ir al ratón — el momento ya pasó. Hotkeys (F8 pausa, F9 0.3x, F10 restart same seed) llamando devApi.setSpeed son ~20 líneas; el añadido que justifica el pick es step de 1 tick en DevApi (nuevo) para revisar squash/hit-stop frame a frame. Es el complemento indispensable del FEEL tuner: sin poder congelar, los sliders se tunean a ciegas igualmente. El mismo multiplicador de timeScale es luego la implementación del hit-stop de producción (patrón de restauración por reloj real, no reloj de juego).

**Anclaje**: src/tools/main.ts (keydown listener nuevo), src/tools/sidebar.ts:661 (Playback), :1480-1484 (__lab.setSpeed), src/tools/dev-api.ts:282 (setSpeed, añadir stepTick)

### 3. Tuner en vivo de AbilityDef del critter seleccionado (state.def + export JSON) — esfuerzo M

Es el surface de mayor tráfico según el histórico: 25 anotaciones 'Rafa:' en abilities.ts, cada knob convergió en 2-3 ciclos edit→reload→partida (slamStun 2.0→1.7→1.5, gripStun 5.0→4.25→3.80). La fase de 'distinct behavior por critter' multiplicará esto por decenas de knobs. Paso intermedio honesto (no feel-patch v2 todavía): sliders que muten state.def del critter vivo (cooldown/force/radius/impulse/duration) + export JSON con persistencia manual — las defs se construyen con factories en init, así que el ToolPatch sobre CRITTER_ABILITIES es más delicado y se pospone hasta validar el flujo.

**Anclaje**: src/abilities.ts:354-465 (factories makeX + overrides), src/tools/dev-api.ts:344-359 (force-ability ya existe), src/tools/sidebar.ts (nueva sección en tuningGroup)

### 4. Hitbox visible y per-critter en calibrate (overlay + physicsRadius en CalibratePatch) — esfuerzo M

roster.ts:52 lleva desde la jam diciendo 'per-character tuning comes later after playtesting' — la fase de mecánicas ES ese later. Trunk (scale 2.84) y Cheeto (2.3) golpean con el mismo círculo invisible de 0.55, y el desajuste golpe-visual no se puede VER en ninguna herramienta: se debuggearía a ciegas en partida. Dos partes: overlay wireframe del radio por slot (~30 líneas, patrón chk-animate) y physicsRadius como campo tuneable incluido en CalibratePatch + tool-patch-core.mjs. La parte de re-balancear los valores es decisión de Rafa (open question) — la herramienta solo lo hace visible y editable.

**Anclaje**: src/roster.ts:52 (const R = 0.55), src/calibrate/main.ts:750 (export hardcodea 'physicsRadius: R'), calibrate.html:155-158 (patrón checkbox), scripts/tool-patch-core.mjs:244 (applyCalibrate)

### 5. HUD compartido: extraer CSS/markup del HUD a fuente única para tools.html e index.html — esfuerzo M

Tercera capa de drift detectada tras las que motivaron H3 slice 7: el lab tiene un HUD de una generación anterior (timer 18px vs hero 44px dorado, sin medallones de cooldown, sin countdown 3-2-1-GO, sin preload de sprites). Lo que ves al evaluar game feel en el lab NO es lo que ve el jugador — la legibilidad de cooldowns y el punch del countdown solo se validan en la build real, que es exactamente lo que el lab existe para evitar. Extraer a fichero único (no portar a mano) mata la clase de bug entera, coherente con la lección de H3 slice 7.

**Anclaje**: tools.html:44-53 vs index.html:124-151/203-247/298-359 (drift), src/main.ts:46-47 (enableSpriteClassOnLoad sin equivalente en src/tools/main.ts)

### 6. Determinismo solo-bots (PRNG sembrado) + batch runner con agregación de winrates — esfuerzo L

Hoy 'Replay Last' reproduce la arena pero no la partida (bot.ts usa Math.random), y todo dato de balance exige jugar a mano: responder '¿está Shelly OP contra pesados?' cuesta 10+ partidas manuales y hoja de cálculo. Con RNG sembrado en bots + timestep fijo, las partidas solo-bots son reproducibles SIN resolver input humano (smallest working solution); encima se apoya el batch runner: autopilot del slot player, N partidas, agregar los RecordingSession (winrate, headbutts, muertes por colapso vs empuje). Sin esto el balance de 9+ critters x2 habilidades se decide por anécdota. Habilita después el golden sim test headless (detectar cambios de balance no intencionados al tocar physics/abilities). Es L: va después de que los tuners (picks 1-3) generen los cambios que hay que medir.

**Anclaje**: src/bot.ts:109-141 (Math.random sin seed), src/game.ts:2045-2080 (debugStartOfflineMatch siempre humano), src/tools/dev-api.ts:199-206 (RecordingSession sin consumidor de agregación)

### 7. Punto de aterrizaje del Animation tuner: tabla de overrides por critter + salida ToolPatch — esfuerzo S

El tuner existente es un pipeline sin salida: los sliders mutan animPersonality en vivo pero SIEMPRE se re-deriva de (mass, speed) — no existe tabla donde pegar el JSON de 'Copy Values', así que cada sesión de tuning se tira a la basura. Una tabla opcional PERSONALITY_OVERRIDES que deriveAnimationPersonality consulte primero + convertir Copy Values en patch aplicable da paridad con el estándar H3 (es el único tuning del match lab por portapapeles) y es el ensayo perfecto del mutador de campos anidados que el feel-patch del pick 1 también necesita — hacedlos en el mismo slice o consecutivos.

**Anclaje**: src/critter.ts:348 (deriveAnimationPersonality), src/critter-animation.ts:60-92 (derivación), src/tools/sidebar.ts:795-801 (clipboard.writeText a sustituir)

### 8. Port del fork mesh2motion a upstream pineado (slice de 1 sesión) — esfuerzo L

La fase de assets choca de frente con el dolor documentado en BUILD_LOG ('los no-humanoides salían demasiado deformados'): upstream trae ExtremityWeightCorrector, exclusión de leaf bones y huesos de nariz en fox/kaiju (Shelly, Sebastian, Kermit, Sihans, trompa de Trunk), más el flujo Retarget maduro — la ruta realista a los signature moves que no existen en ninguna librería stock. Coste medido, no estimado: 43 marcadores en 11 ficheros + 3 ficheros sin marcador; 2 anclajes DOM muertos; los solvers se sustituyen enteros (0 marcadores). Alinea fork(0.183)→upstream(0.185)→juego(0.185). Ojo al portar: el guard de NORMAL va ahora en ModelCleanupUtility.ts (se movió de fichero — un diff ciego lo perdería) y el marcador de frustumCulled ya es redundante. Probar issue #139 (GLB de Tripo en retarget) antes de apostar el pipeline de signature moves.

**Anclaje**: repo hermano bichitos-mesh2motion (grep -rn BICHITOS-FORK src/), vite.config.js/environment.js/create.html (sin marcador), ModelCleanupUtility.ts upstream (re-aplicar guard NORMAL)

## Batch de quick-wins (<1h cada uno, agrupables en un slice)

1. Match lab — selector de pack de arena en Matchup: select con ARENA_PACK_IDS + '(random)' pasando opts.packId; el plumbing completo ya existe (src/tools/dev-api.ts:249 → src/game.ts:2080). ~15 líneas en src/tools/sidebar.ts:547-566
2. Match lab — persistir setup entre reloads con tool-storage ('match-lab:setup': playerPick, botPicks, lastSeed, speedScale) y rehidratar en mountLabSidebar (sidebar.ts:537-539) + auto-start de tools/main.ts:84. Es el único lab que no usa el helper compartido
3. Labs — persistir posición de UI para sobrevivir el reload post-apply: selectedSlotIdx de calibrate (src/calibrate/main.ts:377), currentPack de decor (src/decoreditor/main.ts:135), critter actual de anim-lab, bajo clave '<tool>:ui'. ~10 líneas por lab; elimina la fricción nº1 del pipeline (la re-navegación desincentiva applies pequeños)
4. Match lab — warning de recording sin descargar: flag downloadedAt en RecordingSession (dev-api.ts:727-743) + confirm() en startMatch del sidebar. El comentario de dev-api.ts:254-256 ya promete este comportamiento
5. Match lab — botón 'Mark moment' en el panel Recording via devApi.pushEvent con type propio; anota timestamps de playtest en el JSON/MD exportado. ~10 líneas en sidebar.ts:708-716
6. Calibrate — fix del bug 'Re-fit all to target': añadir rosterOverride.scale en el bucle de btnRefit (src/calibrate/main.ts:653-656). UNA línea; hoy el botón exporta valores que el usuario nunca vio (persiste en localStorage de los 9 critters un scale que el tick procedural revierte en pantalla)
7. Calibrate — aceptar status 'wip' en el filtro (main.ts:242) y console.warn en vez de continue silencioso cuando falta preset (main.ts:272-273): permite calibrar un GLB recién importado sin exponerlo en character select
8. Calibrate/decor/critter — exportar IN_GAME_TARGET_HEIGHT desde src/critter.ts:164 e importarlo en RULER_TARGET (calibrate/main.ts:139) y en el ratio de decor (decoreditor/main.ts:420): mata la sincronización manual a 3 bandas del 1.7
9. Decor — duplicar prop (botón + Ctrl+D): clonar placements[selectedIdx] con angle+0.15. Ataca la operación dominante (clusters de 3-5 props en los 5 layouts). ~15 líneas junto a deletePlacement (decoreditor/main.ts:449)
10. Decor — wheel-zoom (VIEW_HALF_EXTENT clamp 4-20, decoreditor/main.ts:80), snap con Shift (ángulo π/12, r 0.25) y botón 'mirar al centro' (rotY = angle + π — el cálculo que kitsune_shrine documenta hecho a mano). ~35 líneas en total
11. Decor — ambiente de pack en el editor: setClearColor(getPackFogColor) + skybox con GLB preview activo; loaders ya cacheados y exportados (src/arena-decorations.ts:318, 360). Además: console.warn cuando una key de DECOR_TYPES no matchea ningún packSuffix (mata el fallo silencioso de decorTypesForPack)
12. Decor — reescribir la cabecera obsoleta de src/decoreditor/main.ts:18-34 (dice que drag-to-move y undo/redo no existen; ambos están implementados). En un repo AI-first la cabecera ES la spec
13. FEEL — mover hardcodes de combate a FEEL: bounce Steel Shell ×1.4 (src/physics.ts:61), vulnerabilidad de stun ×4 (physics.ts:101-102), y unificar shakes del path online (game.ts:1429 con 0.15 mágico, game.ts:1489 con ×0.55) — online y offline ya no vibran igual hoy. Prerequisito para que el feel-patch del pick 1 los alcance
14. CI — check de byte-identidad de pws-stats cliente/servidor en 'npm run check': el header de src/pws-stats.ts:24-27 la EXIGE pero nada la verifica. Script de ~10 líneas
15. Studio — deep link por hash a tab (~6 líneas en studio.html:160), indicador de working copy sucia por tab (scan localStorage + listener 'storage', ~15 líneas), forwarder de atajos 1-4 vía postMessage desde lab-kit (hoy casi nunca funcionan: el foco vive en el iframe), y timeout de seguridad en el toast de apply ('escrito en disco — recarga manual' a los 4s)
16. Pipeline — reconciliar nombre del patch descargado con el CLI: downloadPatch emite tool-patch-<tool>-<stamp>.json pero el CLI busca tool-patch.json (tool-storage.ts:294 vs apply-tool-patch.mjs:50). El CLI debería aceptar el tool-patch-*.json más reciente
17. Docs — actualizar DEV_TOOLS.md al pipeline post-H3: flujo endpoint/botón Apply, studio.html, y los 4 paneles omitidos de la tabla (Skeletal clips, Badges, P/W/S, Critter parts). Doc desfasada en repo AI-first = el próximo agente ejecuta el workflow viejo de abril

## Descartados (y por qué)

- Tweakpane + plugin-essentials: llamativo, pero H3 acaba de construir un UI kit propio (src/tools/ui/) y el patrón de sliders ya está escrito (ANIM_PARAMS en sidebar.ts). Meter una dep de UI paralela crea dos sistemas de paneles a mantener por una persona. Lo único que aporta de verdad (mini-gráfica de un valor en vivo) se porta como canvas de ~50 líneas al UI kit si se echa de menos durante el tuning
- Theatre.js: dep gorda para un problema que no tenemos — las habilidades son config-driven en FEEL, no keyframes. Apuntado en BUILD_LOG como opción futura si el tuning por sliders se queda corto para curvas temporales; no antes
- three-inspect como tab del studio: pre-1.0, 63 estrellas, breaking changes probables. El devtools OFICIAL de three.js (carpeta /devtools del repo de mrdoob, r185 ya emite los eventos) cubre lo mismo desde fuera de la página con CERO código en el repo — instalar la extensión y documentarla en BUILD_LOG, junto con Spector.js (extensión, no embebido) y gltf.report para la dieta de payload. Herramientas externas: usar, no integrar
- Golden screenshots con Playwright: baselines dependientes de OS/GPU, solo ejecutables en la máquina de Rafa, mantenimiento continuo de snapshots para una persona. El golden sim test headless (hash del outcome de N ticks deterministas) da más señal de regresión con cero flakiness visual — y también se pospone hasta que exista el determinismo del pick 6
- Replay determinista con input humano + reproductor de timeline con scrub: proyecto grande (auditar TODO Math.random, garantizar fixed timestep con input, construir el player de snapshots). El 80% del valor lo dan slow-mo + step-frame (pick 2) para ver impactos, y el determinismo solo-bots (pick 6) para reproducibilidad de balance. Input humano grabado: solo si tras la fase se demuestra necesario
- Heatmap viewer de recordings: barato (~1 tarde) y los datos ya se graban, pero pospuesto deliberadamente hasta que el batch runner (pick 6) genere volumen — con grabaciones manuales de una en una no hay densidad que pintar. Hacerlo justo después del batch runner, no antes
- Editor de catálogo DECOR_TYPES dentro de la herramienta: el alta de props nuevos sigue en TS esta fase. Con el warn de sufijo inválido (quick win) muere el fallo silencioso, que era el 80% del dolor; un ToolPatch para el catálogo es abstracción especulativa hasta que la fase de assets demuestre el volumen de props nuevos
- Cámara orbit 3D con contexto real en el decor editor: caro para lo que da; el ambiente de pack (clearColor + skybox, quick win) cubre el juicio de color, y el juicio de composición in-game se resuelve mejor con un modo ?arenaView=1 barato en el juego (open question) que duplicando un renderer 3D en el editor
- Eruda/vConsole para debug móvil: 5 líneas, pero no es el cuello de botella de ESTA fase (mecánicas y assets se tunean en desktop). Apuntado para cuando haya una sesión real de debugging móvil pre-submission
- Consola de DB / browse de localStorage como tab del studio: no hay DB; br-stats-v2 ya está cubierto por el panel Badges + clearAllStats, y las devtools del navegador hacen el resto. La propia auditoría lo marca como nota negativa deliberada
- Rigs horse/shark y tanda nueva de animaciones humanas como motivo del port: vienen GRATIS con el pick 8, pero no re-riggear critters que ya funcionan solo por novedad — horse se evalúa para Trunk/cuadrúpedos nuevos cuando toque contenido, shark solo si el roster va hacia acuáticos
- Hot-reload de FEEL con import.meta.hot.accept: idea elegante pero redundante con los picks 1+2 — con sliders en vivo mutando el objeto FEEL en runtime, el 'ver sin recargar' ya está resuelto DENTRO del lab; el accept handler solo aportaría en el camino apply→partida en curso, que es un caso menor una vez el tuning pasa por sliders. Revisitar solo si el flujo real demuestra que los applies matan sesiones valiosas pese a la persistencia de setup

## Preguntas abiertas para Rafa

1. Doble fuente cliente/servidor ANTES del tuning intensivo: cada feel-patch/ability-patch genera drift con server/src/sim/config.ts + server/src/sim/abilities.ts (950 líneas espejo) + la tabla expected de verify-ability-parity.mjs. ¿Declaramos el tuning offline-first y resincronizamos por lotes al final de la fase (mi recomendación: simple, no bloquea), o invertimos ya en extraer módulo común/codegen client→server?
2. physicsRadius per-critter (pick 4): hacerlo visible y editable es seguro, pero CAMBIAR los valores rompe el balance actual que ya se ha playtesteado con R=0.55 uniforme. ¿Se abre ese melón dentro de esta fase (junto al tuner de abilities) o primero solo visualización y el re-tuning de hitboxes va en un slice propio con playtest dedicado?
3. Curvas de knockback/falloff: hoy no existen como concepto (falloff lineal hardcoded en abilities.ts:1375, knockback = impulso instantáneo). Sin el concepto en el código no hay nada que una herramienta pueda tunear. ¿Introducimos un shape parametrizable (lineal/cuadrático/step) en FEEL/AbilityDef esta fase, o 'otra dimensión' de game feel se busca primero con los knobs existentes?
4. Timing del port mesh2motion (pick 8): ¿lo hacemos AHORA como primer slice de la fase de assets (alinea three 0.185 y desbloquea retarget/signature moves antes de producir clips), o tras la primera tanda de mecánicas para no cortar el momentum de tuning? Relacionado: ¿abrimos PR upstream con el guard de NORMAL (menos marcadores que mantener para siempre) y con la persistencia de sesión estilo H3 slice 2 (issue #64)?
5. Umbral del batch runner (pick 6, esfuerzo L): ¿lo disparamos ya en esta fase, o el juicio manual + recordings marcados bastan hasta que (a) el roster pase de 9 critters o (b) haya una decisión de balance concreta que no sepamos responder a ojo? Definir el trigger evita construirlo por si acaso
6. Cámara: camera.ts:14-18 documenta que el último experimento de encuadre costó un commit-revert ('ruined gameplay framing'). ¿Merece una mini-herramienta A/B en el lab (FOV/pose/decay con vuelta a pose canónica en un click, esfuerzo M) para explorar 'otra dimensión', o congelamos encuadre esta fase y la cámara queda explícitamente fuera de scope?
7. Modo ?arenaView=1 en el juego (arena vacía + cámara libre, sin title→select→countdown): resolvería el juicio de composición del decor-editor por una fracción del coste de la cámara orbit descartada. ¿Entra como slice S de la fase de assets?
8. Presets de escenario reproducibles ('bot quieto a 3u, fuerza K, mide distancia empujada'): DevApi ya tiene teleport + force-ability + control de bots. ¿Lo añadimos al slice del tuner de abilities (pick 3) para que cada knob tenga un experimento repetible de 5 segundos con antes/después objetivo, o es sobre-ingeniería para tu forma real de tunear?
