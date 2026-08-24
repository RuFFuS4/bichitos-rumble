# Next Steps — Bichitos Rumble

> **Doc operativo de la fase post-jam.** Solo la **checklist del hito EN
> CURSO**. Plan completo: [`ROADMAP.md`](ROADMAP.md) · foto del proyecto:
> [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
> Al cerrar un hito: tag, y esta checklist se reescribe para el siguiente.

**H0 Saneamiento: ✅ `v1.2-clean-base`** · **H1 Modernización: ✅
`v1.3-modern-stack`** · **H2 Dieta de payload + presencia base: ✅
`v1.4-portal-ready`** (2026-08-19 — dist −59 %, huella inicial ~1,5 MB,
itch.io publicado con donaciones; detalle en [`ROADMAP.md`](ROADMAP.md)
y [`BUILD_LOG.md`](BUILD_LOG.md)).

---

## H3 — Bichitos Studio: tooling unificado (en curso)

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

## Fase de afilado (en curso — plan completo en docs/AFILADO_PLAN.md)

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

## CHECKLIST DE RAFA (actualizada 2026-08-24, sesión larga)

Pruebas manuales pendientes, en orden de valor:

- [ ] **Reconnect (la estrella)**: partida online en el móvil →
      desactiva el wifi 5-10 s → debe salir "Reconnecting…", un bot te
      cubre, y al volver el wifi recuperas tu critter donde esté.
      Más de 30 s fuera = derrota registrada (rage-quit = derrota).
- [ ] **Sala privada real**: "👥 Jugar con amigos" → comparte el
      enlace con alguien → jugad. Verifica que un tercero con
      "Multijugador online" NO cae en vuestra sala.
- [ ] **PWA**: en Android/Chrome → "Instalar app" → abre standalone,
      apaisada, icono BR, sin barras blancas en el notch.
- [ ] **Reduced motion**: Windows → Accesibilidad → Efectos de
      animación OFF → recarga → el shake/hit-stop casi desaparece.
- [ ] **Playtesting de mecánicas** (pendiente de la sesión anterior):
      shell-reflect de Shelly (¿duele pegarle?) y Claw Wave de
      Sebastian (¿asusta?).
- [ ] **Pase visual** post-dieta: arenas y belts (gltfpack cuantiza) +
      el juego entero en ES (¿algún texto desborda en móvil?).
- [ ] **Las 10 traducciones de autor** (BUILD_LOG 2026-08-24): ¿tono OK?
- [ ] **Revisión de networking**: BrawlRoom (salas privadas, gracia de
      reconnect, integridad de belts) — tu zona sensible.
- [ ] **Merge dev→main + tag** cuando todo lo anterior te cuadre.

**Para verificar con 2 dispositivos (no lo pude simular)**: el rejoin
real del SDK (cierre 1006), y que humansAtStart cuenta bien a 2
humanos verificados (en mi e2e salía 0 con un solo nick automatizado
— puede ser identidad no registrada del flujo rápido; si con humanos
reales sale <2 y no puntúa, avisa).

**Para Rafa (pendientes que solo puedes hacer tú):**
- [ ] Playtesting: shell-reflect y Claw Wave (de la sesión anterior) +
      probar una sala privada con alguien de verdad + ojear las 10
      traducciones de autor (BUILD_LOG 2026-08-24 / i18n.ts).
- [ ] Pase visual de arenas y belts tras el gltfpack (cuantiza; golden
      no ve píxeles) y del juego en ES en móvil.
- [ ] Revisión de la zona networking (salas privadas tocan BrawlRoom).
- [ ] Merge dev→main + tag cuando lo des por bueno (deploy a prod).

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
