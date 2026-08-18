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

1. [ ] **Shell único** (`studio.html`): tabs Match Lab / Animations /
   Calibrate / Decor sobre UI kit compartido (orbit camera, resize,
   paneles, tema). Mata ~1.200 líneas de CSS duplicado y el fork de
   950 líneas de tools.html.
2. [ ] **Pipeline de patches completo y no destructivo**: todas las tabs
   emiten ToolPatch; el apply de anim-lab pasa a merge (hoy borra
   overrides de critters no tocados); decor-editor emite patch desde
   la UI.
3. [ ] **Apply directo desde la UI**: endpoint de apply en el dev-server
   (plugin de Vite) → botón "Apply to source" con diff previo.
4. [ ] **Persistencia uniforme**: tool-storage en todas las tabs
   (anim-lab hoy pierde la sesión con F5).
5. [ ] **Evict mesh2motion** a repo hermano/submodule (43 % de los
   ficheros trackeados) y documentar el flujo de animación.
6. [ ] Quick-wins: pack picker en match lab, indicador de divergencia
   real en calibrate, snippet TS pegable.

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
