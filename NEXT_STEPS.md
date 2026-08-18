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
6. [ ] **Match lab como tab** (slice 7, decisión de Rafa): paridad de
   loop (runFrame compartido con src/main.ts) y de atmósfera + embed
   en el studio.
7. [ ] **Evict mesh2motion** (slice 8): repo hermano, working tree
   only (sin reescritura de historia), rutas de contrato
   parametrizadas, doc del fork actualizada (11 ficheros reales).

**Gate de salida H3**: un cambio de calibración/animación/decoración se
aplica a fuente desde el navegador en < 1 min con diff visible · cero
pérdida de datos al recargar · mesh2motion fuera del repo.

**Decisiones de Rafa (2026-08-19)**: borrar overrides = edición manual
del fuente (sin tombstones por ahora) · comentarios de DECOR_LAYOUTS →
docstrings por pack antes de activar el apply JSON (slice 3) ·
mesh2motion: evict solo working tree, SIN reescritura de historia ·
match lab: SE EMBEBE como tab del studio (slices 6-7, aunque cueste
más — unificación completa).

---

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
