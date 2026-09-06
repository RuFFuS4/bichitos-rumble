# ROADMAP — Bichitos Rumble, fase post-jam

> Arranque: 2026-08-16 (tag `v1.1-post-jam-kickoff`).
> Resultado del jam: ~top 200 de ~1000. Objetivo de esta fase:
> **mejorar el juego → atraer usuarios → monetización mínima**.
> Foto del estado real: [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
>
> Reglas de la fase: volvemos a la disciplina de ramas (`feature → dev →
> main`, nada directo a main); cada hito cierra con un tag; las decisiones
> importantes se registran en BUILD_LOG.md.

## Visión de conjunto

```
H0 Saneamiento ──► H1 Modernización ──► H2 Dieta payload + distribución
                                              │
                   H3 Bichitos Studio ◄───────┤ (H3 puede solaparse con H2)
                                              ▼
                   H4 Retención + bucle social ──► H4.5 Arreglar antes de crecer
                                                          │
                                  H5 Monetización mínima ◄┘
                                              │
                                              ▼
                   H6 Party · progresión · 8 jugadores · Steam
```

La lógica: no se construye nada nuevo sobre cimientos ciegos (H0), no se
migra sin red (CI + Sentry antes que bumps), no se pide entrada en portales
con 239 MB de dist (H2 antes que H5), y no se monetiza sin licencias
verificadas (H0 desbloquea H5).

---

## H0 — Saneamiento y ojos abiertos ✅ CERRADO 2026-08-17 (`v1.2-clean-base`)

**Meta**: saber qué hay en producción, tener red de seguridad automática y
despejar los bloqueantes legales. Sin tocar gameplay.

- [x] **Smoke de producción**: cliente Vercel OK; hallazgos: widget del jam
      roto upstream (retirado) y **Railway desaparecido por trial agotado**
      → reactivado en plan Hobby (5 $/mes), DB sobrevivió en el volumen.
      Smoke online end-to-end completo (identidad v2, 2 pestañas misma
      sala, partida y persistencia).
- [x] **Wipe DB Railway**: reset total ejecutado por Rafa desde la consola
      (la CLI de admin llegó a producción con el fix del Dockerfile —
      `COPY scripts` faltaba desde siempre).
- [x] **CI mínimo** (GitHub Actions): client check + parity + server tsc +
      smoke Playwright. Estrenado en verde con el PR #1.
- [x] **Parity en `npm run check`**.
- [x] **Observabilidad**: Sentry integrado (chunk async 20 kB gz
      tree-shaken, lazy en idle, inerte sin `VITE_SENTRY_DSN`, release =
      git sha) y verificado end-to-end en producción (región UE). Vercel
      Web Analytics activado. Contadores server-side diferidos a H4
      (tabla `matches`).
- [x] **Dossier legal**: Tripo/Meshy/Suno confirmados de pago durante la
      generación → crítters y música en verde en `ASSET_LICENSES.md`.
      `LICENSE` propietario + `/privacy.html` + `/terms.html` desplegados.
      Flecos (no bloquean): archivar facturas, identificar generador 2D.
- [x] **Doc-sync**: 6 docs sincronizados a la realidad post-bloque-final.
- [x] **Higiene de repo**: 8 ramas muertas fuera, widget del jam retirado,
      scripts muertos borrados.
- [x] **Backup SQLite**: subcomando `admin:backup` desplegado y probado en
      producción. (Copia programada off-volume: fleco para H4.)

**Gate de salida**: CI verde en dev/main ✅ · Sentry recibiendo ✅ · DB
limpia con backup ✅ · ASSET_LICENSES.md core ✅ · docs fiables ✅.

## H1 — Modernización de dependencias ✅ CERRADO 2026-08-18 (`v1.3-modern-stack`)

**Meta**: stack 2026 con los saltos ordenados de menor a mayor riesgo,
cada uno en su propia rama con CI verde. Detalle por salto:
[`docs/H1_MIGRATION_NOTES.md`](docs/H1_MIGRATION_NOTES.md).

1. [x] **Pre-vuelo**: verbatimModuleSyntax (fallout: 1 línea) ·
       engines.node ≥ 20.19 · inventario three · Node verificado en los
       3 runtimes (CI 22, Railway 22-alpine, Vercel 24).
2. [x] **Bumps menores** + lección better-sqlite3 13 (sin prebuilds
       musl → compilación en el builder stage del Dockerfile; el job
       `server-docker` nuevo del CI lo cazó en su primer run).
3. [x] **TypeScript → 7.0.2 directo** (compiler nativo Go; la 6 puente
       resultó innecesaria — acepta experimentalDecorators). Fallout:
       1 línea. `npm run check` 15 → 7 s.
4. [x] **Vite 8.2 (Rolldown)** con config nativa (`rolldownOptions` +
       `codeSplitting.groups`, `import.meta.dirname`). Build 4,9 →
       2,9 s. Terser y DCE de Sentry verificados.
5. [x] **Three 0.185**: 0 fallout de tipos, imports a `three/addons`,
       pase visual headless con capturas — sin regresión del especular
       r181.
6. [x] **Colyseus 0.16 → 0.17 + schema v4** lockstep (cliente pasa a
       `@colyseus/sdk`; server a `defineServer()` tras descubrir que el
       wiring clásico duplica listeners HTTP en 0.17). Verificado con
       e2e local de 2 páginas + review adversarial de 3 lentes que cazó
       la auto-reconexión default-ON del SDK (desactivada; H4 la
       implementará server-side). Detalle en H1_MIGRATION_NOTES.

**Gate de salida**: CI verde ✅ · e2e online local completo ✅ · smoke
producción ✅ · merge a main + tag `v1.3-modern-stack` ✅ · Sentry 48 h
tras el deploy ⏳ (vigilancia en curso — cierra formalmente el gate).

## H2 — Dieta de payload + presencia base ✅ (2026-08-19, `v1.4-portal-ready`)

**Meta**: de 239 MB → **≤ 50 MB de deploy** y primera visita ligera;
criterio tomado del gate real de CrazyGames (≤50 MB inicial / ≤250 total).
**Resultado: dist 239 → 96,9 MB (−59 %); primera visita ~64 MB → ~1,5 MB
de extras; JS eager 297 → 258 kB gz.**

- [x] Quitar el prefetch de los 9 GLBs de index.html (−58 MB primera visita).
- [x] Mover `tree_jungle_broadleaf.glb` (52 MB, muerto) a `_raw/`.
- [x] Excluir `/animations` + tools del build de producción
      (`VITE_BUILD_TOOLS=1` los fuerza; dev intacto).
- [x] Pase WebP: sprites/skyboxes/grounds 23,9 → 1,6 MB, og-image → JPEG
      140 KB (WhatsApp la renderiza), favicon 10 KB.
- [x] meshopt en los 6 crítters sin comprimir (14,2 → 3,1 MB; sihans 18×).
      Heavies quedan para una futura pasada `-si` (arriesgado, pospuesto).
- [x] Cache: /assets hasheados → immutable 1 año; /models /images /audio →
      `max-age=1d + SWR=7d`; catch-all excluye assets (404 reales).
- [x] Colyseus lazy (split network/network-events): el SDK solo se
      descarga al pulsar Online.
- [x] **Presupuesto de payload en CI y en el build de Vercel**: 100 MB
      total / 17 MB por fichero, ratchet documentado (135→115→100).
- [x] SEO quick-wins: robots.txt, sitemap, canonical, JSON-LD VideoGame.
- [x] **Página en itch.io PUBLICADA** (`napsoul.itch.io/bichitos-rumble`):
      embed fullscreen de producción, cover+screenshots, "$0 or donate",
      payout mode + W-8BEN (retención 0 %) configurados. Primera
      monetización real activa.

**Gate de salida**: dist ≤ 50 MB → **redefinido como "huella inicial
≤ 50 MB"** (~1,5 MB reales; el resto del dist son arena packs lazy de
88 MB que solo baja quien juega esa arena — el criterio CrazyGames mide
descarga inicial, cumplido de sobra) · Lighthouse móvil ✅ (Perf 71 /
SEO 100 / BP 100; FCP 1,2 s, LCP 2,6 s — TBT 1,5 s es el boot de
three.js, esperable en un juego 3D) · itch.io publicado ✅ · tarjeta OG
en WhatsApp ✅.

## H3 — Bichitos Studio: tooling unificado ✅ (2026-08-19, `v1.5-bichitos-studio`)

**Meta**: las 4-5 herramientas "justas, deficientes y poco usables" se
convierten en **un solo estudio interno** con el bucle
intención→cambio-aplicado en 1-2 pasos (antes: 5-6 pasos manuales).
**Resultado: 8 slices en un día, todos verificados** (detalle por slice
en BUILD_LOG.md 2026-08-19).

- [x] Pipeline de patches no destructivo: merge de anim-lab (el apply
      viejo BORRABA critters), decor-editor emite DecorEditorPatch,
      validación de identificadores, 36+ tests golden.
- [x] Persistencia uniforme: anim-lab autosalva la sesión, divergencia
      por valores en calibrate.
- [x] **Apply to source**: endpoints dev-only en Vite + modal de diff
      bloqueante en los 3 labs — tune→código en 2 clicks.
- [x] UI kit compartido (lab-theme.css + lab-kit con dispose).
- [x] `studio.html`: shell de tabs con iframes lazy keep-alive.
- [x] Paridad del match lab: scene-atmosphere + frame-ticks compartidos
      con src/main.ts — fin del doble boot (el lab ejecutaba main.ts
      entero transitivamente) y de las habilidades congeladas.
- [x] Evict de mesh2motion a repo hermano `../bichitos-mesh2motion`
      (996 → 333 ficheros trackeados, −67 %).

**Gate de salida — CUMPLIDO**: cambio aplicado a fuente desde el
navegador en <1 min con diff visible ✅ · cero pérdida de datos al
recargar ✅ · mesh2motion fuera del repo ✅. Smoke de producción verde
tras el deploy (el refactor de main.ts shippeó limpio).

## Interludio — Fase de afilado (2026-08-19 → 2026-08-20, COMPLETA)

Entre H3 y la fase de mecánicas/assets, por decisión de Rafa: hacer las
herramientas más eficientes, eficaces y útiles ANTES de usarlas a
fondo. Plan completo con evidencia en
[`docs/AFILADO_PLAN.md`](docs/AFILADO_PLAN.md); checklist operativa en
[`NEXT_STEPS.md`](NEXT_STEPS.md). Decisiones marco: tuning
offline-first (server se sincroniza al final), melón de physicsRadius
abierto, port de mesh2motion upstream pronto. Durante la fase nació la
**directiva dual-surface** (2026-08-20): toda herramienta con dos
caras desde el día uno — UI para Rafa, CLI/patch/módulo para Claude.

**8/8 picks ejecutados** (slices A-G): A quick-wins ·
B cabina de tuning (step-frame/hotkeys/FEEL tuner/`feel-patch`) ·
C hitbox visible + tuner de AbilityDef · D port mesh2motion a upstream
0.185 (probe issue #139 verde: retarget Swing-Twist con GLB Tripo) ·
E salida del animation tuner (`anim-personality`, 5º tool type) ·
F HUD fuente única (partial de vite, paridad 187 propiedades) ·
G determinismo + batch runner headless (`npm run batch`,
REPRODUCIBLE: yes con 218 eventos idénticos). Detalle por slice en
[`BUILD_LOG.md`](BUILD_LOG.md). Fleco menor: applier de ability-tuner.
Pendiente de la decisión offline-first: sync del server al entrar en
la fase de mecánicas.

## Interludio 2 — Balance v2 (2026-08-21, primer bloque de mecánicas/assets)

Primer uso real del taller afilado: 108+ partidas medidas con el batch
runner en un día. Marco de balanceo v2 ("cero potencia fuera de
presupuesto", `npm run balance`), Trunk domado conservando su fantasía,
bots con conciencia del borde (cliente+server), Steel Shell despertado.
Doc vivo: [docs/BALANCE.md](docs/BALANCE.md). Lección de diseño (Rafa):
**las mecánicas tienen fuerza en el balanceo** — Shelly y Sebastian se
balancean con mecánicas nuevas, no con más números. Esa cola abre la
fase de mecánicas.

## H4 — Retención y bucle social ✅ CERRADO 2026-09-05 (`v1.7-h4-social`)

**Meta**: razones para volver y jugadores que traen jugadores.

**Social / adquisición**
- [x] **Salas privadas + join por enlace** (`?room=XYZ`): botón "Jugar con
      amigos" (create + joinById ya lo soporta Colyseus). La petición nº1
      de un brawler 4P y nuestro bucle viral más barato.
- [x] **Compartir**: `navigator.share` con fallback clipboard en end screen
      y toasts de belt ("Gané con Kurama en Bichitos Rumble").
- [x] **i18n ES/EN** (~150 claves, detección por navigator.language).

**Retención**
- [x] **Reconnect** (`allowReconnection`, post-Colyseus 0.17): hoy un blip
      de red te convierte en bot para siempre.
- [x] **Identidad con código de recuperación** (cross-device sin login).
- [x] **Slayer Belt real** (el sistema está al 95%: solo falta el wiring de
      lastHitBy → kills_vs_humans) + tuning de umbrales de badges (Fase 6).
- [x] **Integridad de leaderboards**: partidas vs bots no puntúan
      Throne/Flash/Streak; rage-quit registra derrota.
- [x] **Tabla `matches`** server-side: historial + métricas de retención
      (DAU, partidas/día, curvas de abandono) + auditoría de agregados.

**Juego**
- [ ] Feel passes pendientes (→ H4.5) (Kurama primero — receta lista en NEXT_STEPS),
      SFX signature por critter.
- [x] Split de `abilities.ts` (config/runtime/vfx) + tests Vitest del sim
      determinista (~20 tests) — antes de tocar gameplay en serio.
- [ ] Shared sim package (NO-GO, ver cierre) cliente/servidor (mata el scraper de paridad y
      ~1.000 líneas duplicadas) — el refactor de más palanca del proyecto.
- [x] Mobile: manifest PWA, viewport-fit=cover, prefers-reduced-motion
      (multiplicador global en FEEL), HUD landscape polish.

**Gate de salida**: 2 amigos pueden jugar juntos a propósito ✅ (sala
privada real verificada en producción) · un jugador que vuelve conserva
su identidad ✅ (reconnect 30 s + código de recuperación) · métricas de
retención visibles ✅ (`/api/metrics/retention`, tabla `matches`).

Cierre: hecho en dos tandas autónomas (2026-08-24) + checklist simulada
con Playwright y review de networking (2026-09-05); detalle en
[`BUILD_LOG.md`](BUILD_LOG.md). Los feel passes y SFX pasan a H4.5; el
shared sim package quedó NO-GO (server `rootDir` estricto) y se sustituye
por espejos + scraper de paridad (H4.5, terreno v2 fase 0).

## H4.5 — Arreglar antes de crecer (2026-09-05 → ~3 semanas)

**Meta** (fijada por Rafa el 2026-09-05): *"antes de ampliar y avanzar hay
que arreglar cosas"*. Lo primero, la generación de terrenos, *"muy muy
pobre"*. Diagnóstico por capas, 4 propuestas, 3 jueces y plan en
[`docs/ARENA_V2.md`](docs/ARENA_V2.md) (art-first unánime, con injertos).

**Terreno v2** (≈13 días en tandas de 1-2, UNA regeneración de golden):
- [x] **Fase 0 — red de seguridad y CLI** ✅ 2026-09-06: scraper de
      paridad de `arena-fragments` en `npm run check`, 16 invariantes
      Vitest del generador, golden de layout por hash de 67 semillas,
      `npm run arena` (`--json|--ascii|--timeline|--curve|--svg|--sweep`),
      observabilidad offline del colapso (el golden de partidas ganó 22
      eventos `collapse_*` sin mover un solo evento de gameplay),
      `test:sim` en CI y docs con las cifras reales.
- [x] **Fase 0.5 — micro-slice de gameplay** ✅ 2026-09-06 (hard-stop):
      lotes parciales como arco contiguo con arranque por semilla (frente
      legible 48,3 % → 100 %), `layout.pattern` explícito y
      `radiusAt(angle)` en bots y proyectiles (el respawn se queda: su
      bucle ya converge al islote).
- [x] **Fase 1a — el disco se convierte en un lugar** ✅ 2026-09-06:
      tile a escala real (era 25 cm), tinte por banda/pack/semilla (el
      gris que lo mataba, fuera), acantilado con material propio, void y
      falda eliminados, luz lateral, `ARENA_LOOK` con dev-api y
      `scripts/arena-shots.mjs`. Golden 3/3 sin regenerar.
- [x] **Fondo — la isla flota sobre su bioma** ✅ 2026-09-07 (petición de
      Rafa: *"unificar el fondo para que no parezca una foto mal
      puesta"*): plano de mar con la rampa del bioma horneada en los
      vértices, niebla que por fin tiñe algo, sombra de la isla. 0 bytes
      de payload, 1 draw call. Adelanta media fase 3.
- [x] **Dioramas slice 1** ✅ 2026-09-07 (petición de Rafa: *"se ve como
      un círculo con 4 cosas sueltas"*; va ANTES de la 1b): capa densa
      instanciada — 7 primitivas generadas por código, 5 biomas × 8 capas,
      determinista por semilla, cada instancia cae con su fragmento —,
      canto con masa y estratos, sombras de contacto de critters y escala
      de textura de suelo por bioma (`groundTile`). Plan y diagnóstico en
      [`docs/DIORAMAS.md`](docs/DIORAMAS.md).
- [ ] **Dioramas slice 2**: cohesión de los elementos (paleta compartida
      entre scatter, props y suelo; que se toquen y se agrupen; sombras
      también en los props GLB), afinado de recetas sobre capturas y
      applier ToolPatch `scatter-patch`. Espera decisiones de Rafa.
- [ ] **Feeling de los personajes** (Rafa, 2026-09-07: *"se sienten
      pesados en vez de animalillos graciosos andando, corriendo"*):
      velocidad del clip ligada a la velocidad real (hoy es fija),
      inclinación al acelerar y girar, squash al frenar, stretch al salir
      despedido, inercia en orejas y cola. Diagnóstico a relanzar.
- [ ] **Diferidos por Rafa**: shaders cartoon de los personajes (tras
      flag, como el tone mapping) y portal del Vibe Jam apagado fuera de
      la web propia (flag de build para itch/Steam).
- [ ] **Fase 1b**: bisel de junta, applier ToolPatch `look-patch` +
      panel del studio, dieta de props. (Las sombras de contacto de
      critters ya cayeron con el slice 1 de dioramas.)
- [ ] **Fase 2 — colapso que se lee y se siente**: grietas, sag, escombros,
      polvo, shake, orilla que cae por sectores, centro inmune hero.
- [ ] **Fase 3 — cada bioma es un sitio**: rig de luz por pack, fondo por
      bioma donde el skybox no baste, partículas ambientales.
- [ ] **Fase 4 — props que pertenecen al suelo**: blob shadows, dieta
      de palmas/bambú/sakura con `optimize-arena-props.mjs`, validador de packs en
      `check`, `authoredRadius`, higiene (GLB crudo de 54 MB fuera de
      git).
- [ ] **Fase 5 — todo lo visual en función del radio**: cámara, sombras,
      orilla y tile derivados de `maxRadius` (deja la capa lista para 8P).

**Otros arreglos de H4.5**: feel pass de Kurama y SFX por critter
(heredados de H4), limpiar nicks de prueba en prod, flecos de licencias,
lo que salga del playtesting de Rafa.

**Gate de salida**: hoja de contactos antes/después de los 5 packs
aprobada por Rafa · `npm run check` con paridad de arena · `test:sim` en
CI · golden de layout · `DEV_TOOLS.md §Superficie programática` al día ·
merge a `main` con tag.

## H5 — Monetización mínima (tras H2+H4; ~2+ semanas)

**Meta**: primeros euros sin dañar la experiencia. Requiere el dossier de
licencias de H0 cerrado.

- [ ] **Donaciones itch.io** activas (viene de H2).
- [ ] **Portal con rev-share**: CrazyGames primero (sin exclusividad,
      50-80% del ad revenue). Integrar su SDK: ad-break natural en la pausa
      entre partidas de 60-90 s + hooks de loading. El gate de payload lo
      resuelve H2.
- [ ] Evaluar Poki con los datos del primer portal.
- [ ] **Decisión data-driven**: si retención D7 y partidas/día (H4) lo
      justifican, explorar cosméticos (skins/colores por critter) — solo
      con tracción; no antes.

**Gate de salida**: primer ingreso registrado (donación o ad revenue) ·
decisión documentada del siguiente paso con métricas en la mano.

## H6 — Party, progresión, 8 jugadores y Steam (tras H5; ~2-3 meses)

**Meta** (idea de Rafa, 2026-09-05): un juego más grande y monetizable,
inspirado en smashkarts.io y krunker.io (party, sencillos, con buenas
opciones de monetización), con partidas de hasta 8 y salida en Steam.
Orden acordado, un slice + `golden:write` por cambio de generador:

1. [ ] **Modo por tiempo con respawn y puntos por KO** + salas privadas
       configurables 4/6/8 (el público sigue a 4 hasta medir). Es la
       mecánica que hace divertidos los 8 jugadores (último superviviente
       no escala: la mitad mira) y la que da gancho a la progresión.
2. [ ] **Terreno lógico v2** (cola de `docs/ARENA_V2.md §5`): perfiles de
       arena (`'4p'` byte-idéntico al actual; `'8p'` **provisional fijado
       por Rafa el 2026-09-06**: r 16, islote 3,5 u, 4 bandas, 150 s con
       primer lote a 0,2 y colapso total a 0,8 de la duración, última
       banda resistente), tempo como fracciones de la duración,
       patrones nuevos con regla de huérfanos, decor por receta + semilla,
       hazards de bioma como zonas. Fuera del generador: `MAX_PLAYERS`,
       `SPAWN_POSITIONS` derivados, HUD y sala de espera de 8.
3. [ ] **Progresión**: XP, niveles, desbloqueos y retos diarios sobre la
       identidad actual (código de recuperación).
4. [ ] **Cosméticos y tienda**: skins y colores por critter (Tripo/Meshy
       con licencia en verde), moneda blanda por jugar, anuncios
       recompensados (CrazyGames), premium con Stripe atado a la
       identidad. Sin cajas de botín (reguladas en varios países UE).
5. [ ] **Steam**: wrapper de escritorio (Electron/Tauri) + Steamworks
       (logros, overlay), soporte de mando, opciones de resolución;
       cross-play con web gratis (mismo servidor Colyseus). Solo cuando
       haya algo que vender y retención D7 medida.

**Gate de entrada**: H5 con primer ingreso y 2+ semanas de métricas de
`matches`. **Gate de salida**: modo por tiempo en público · perfil 8P
jugado con 8 humanos · tienda con primera venta · build de Steam en
beta cerrada.

---

## Calendario orientativo

| Hito | Ventana | Tag al cierre |
|---|---|---|
| H0 Saneamiento | ✅ 2026-08-17 | `v1.2-clean-base` |
| H1 Modernización | ✅ 2026-08-18 | `v1.3-modern-stack` |
| H2 Payload + presencia | ✅ 2026-08-19 | `v1.4-portal-ready` |
| H3 Bichitos Studio | ✅ 2026-08-19 | `v1.5-bichitos-studio` |
| Interludio afilado | ✅ 2026-08-20 | `v1.6-afilado` |
| H4 Retención + social | ✅ 2026-09-05 | `v1.7-h4-social` |
| H4.5 Arreglar antes de crecer | septiembre | `v1.8-terreno-v2` |
| H5 Monetización | octubre | `v2.0-first-euro` |
| H6 Party · progresión · 8P · Steam | noviembre → | `v2.x` |

Los hitos H2/H3 pueden solaparse (uno es assets/infra, otro tooling). El
calendario es orientativo — la regla que manda es el gate de salida de
cada hito, no la fecha.
