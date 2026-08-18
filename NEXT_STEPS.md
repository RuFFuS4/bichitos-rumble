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
3. [ ] **Slice C — tuner de habilidades + hitbox** (picks 3+4):
   sliders de AbilityDef del critter vivo + overlay de physicsRadius
   en calibrate con campo en CalibratePatch.
4. [ ] **Slice D — port mesh2motion upstream** (pick 8, repo hermano):
   diff-and-port de los 43 marcadores, probar issue #139 con GLB Tripo.
5. [ ] Después, según demanda: HUD fuente única (pick 5), salida del
   animation tuner (pick 7), determinismo+batch runner (pick 6).

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
