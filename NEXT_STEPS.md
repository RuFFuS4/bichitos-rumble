# Next Steps — Bichitos Rumble

> **Doc operativo de la fase post-jam.** Solo la **checklist del hito EN
> CURSO**. Plan completo: [`ROADMAP.md`](ROADMAP.md) · foto del proyecto:
> [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
> Al cerrar un hito: tag, y esta checklist se reescribe para el siguiente.

**H0 Saneamiento: ✅ CERRADO 2026-08-17, tag `v1.2-clean-base`** (detalle
en [`ROADMAP.md §H0`](ROADMAP.md) y BUILD_LOG). Producción tiene: CI,
Sentry verificado (región UE), Railway Hobby con DB a cero y backup,
pack legal desplegado, docs fiables.

---

## H1 — Modernización de dependencias (5/6 — solo falta Colyseus)

Checklist de [`ROADMAP.md §H1`](ROADMAP.md). Todo lo completado está
mergeado en `dev` (PRs #3-#7, CI verde en todos). Detalle técnico por
salto en [`docs/H1_MIGRATION_NOTES.md`](docs/H1_MIGRATION_NOTES.md).

1. [x] **Pre-vuelo** (2026-08-17): `verbatimModuleSyntax` (fallout: 1
   línea), `engines.node >= 20.19`, inventario three. Node verificado:
   CI 22 · Railway 22-alpine · Vercel 24.x.
2. [x] **Bumps menores**: gltf-transform 4.4, playwright 1.62,
   gltfpack/meshopt 1.2, sharp 0.35, terser 5.50, tsx 4.23,
   better-sqlite3 13 (sin prebuilds musl → se compila en el builder
   stage; el job `server-docker` nuevo del CI lo cazó en su estreno).
3. [x] **TypeScript 5.7 → 7.0.2 directo** (la 6 puente resultó
   innecesaria — el compiler nativo acepta `experimentalDecorators`).
   Fallout: 1 línea. `npm run check`: 15 → 7 s.
4. [x] **Vite 6 → 7 → 8 (Rolldown)**: `rolldownOptions` +
   `codeSplitting.groups`, terser y DCE de Sentry verificados.
   Build: 4,9 → 2,9 s.
5. [x] **Three 0.172 → 0.185**: 0 fallout de tipos, imports a
   `three/addons`, pase visual headless con capturas (selector, match,
   belts, decor) — sin regresión del especular r181.
6. [ ] **Colyseus 0.16 → 0.17 + schema v4** ← MAÑANA. Plan: adapter de
   acceso a estado en el cliente (`game.ts:842-859` y `1095-1220`),
   bump lockstep server + colyseus.js, smoke online completo en
   producción. Los 6 acoplamientos v3 están mapeados en las notas.

**Al cerrar el paso 6**: merge `dev` → `main` (deploy real) + tag
`v1.3-modern-stack` + vigilancia Sentry 48 h (gate del hito).

---

## Flecos heredados (no bloquean H1)

- Rafa: archivar facturas abril 2026 (Meshy/Tripo/Suno) →
  `docs/licencias-evidencia/` (evidencia del dossier).
- Rafa: identificar el generador 2D de sprites/skyboxes/badges
  (checklist §5 de [`ASSET_LICENSES.md`](ASSET_LICENSES.md)).
- Rafa (opcional): `git push origin --delete backup/pre-glb-rename-20260427-1940`
- H4: copia programada off-volume de `admin:backup` + tabla `matches`
  (contadores/retención).
