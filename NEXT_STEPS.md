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

## H1 — Modernización de dependencias (en curso)

Checklist de [`ROADMAP.md §H1`](ROADMAP.md). Regla: cada salto en su
propia rama con CI verde; Sentry como red de detección de regresiones
en producción. Orden de menor a mayor riesgo:

1. [ ] **Pre-vuelo** (sin dependencia de Rafa):
   - `verbatimModuleSyntax` en ambos tsconfig bajo TS 5.x + arreglar
     el fallout de imports.
   - `engines.node >= 20.19` en package.json + verificar versión de
     Node en Vercel y Railway (requisito Vite 8).
   - Inventario grep de superficie three: `three/examples|three/addons`,
     ShaderMaterial custom, color management, `THREE.Clock`.
2. [ ] **Bumps menores**: gltf-transform, playwright, terser, sharp,
   tsx, gltfpack/meshoptimizer, better-sqlite3 13, @types/*.
3. [ ] **TypeScript 5.7 → 6.x** (cliente + server). TS 7 (nativo Go)
   cuando 6.x quede limpio — no usamos la API del compiler, así que
   el salto a 7 puede ser directo si el ecosistema acompaña.
4. [ ] **Vite 6 → 7 → 8** (Rolldown): `rollupOptions` →
   `rolldownOptions`, revalidar terser/manualChunks/build.target y el
   define de `__BUILD_COMMIT__`.
5. [ ] **Three 0.172 → 0.185**: `Clock` → `Timer`, revisar el cambio
   visual de especular PBR (r181) en los 9 crítters + belts + arenas,
   `Object3D.dispose()`.
6. [ ] **Colyseus 0.16 → 0.17 + schema v4** (el mayor riesgo, el
   último): primero adapter de acceso a estado en el cliente
   (`game.ts:842-859` y `1095-1220`), luego bump lockstep server +
   colyseus.js. Smoke online completo tras el bump.

**Gate de salida H1**: todo verde en CI · partida offline y online sin
regresión visual ni de feel · cero errores nuevos en Sentry tras 48 h
del deploy.

---

## Flecos heredados (no bloquean H1)

- Rafa: archivar facturas abril 2026 (Meshy/Tripo/Suno) →
  `docs/licencias-evidencia/` (evidencia del dossier).
- Rafa: identificar el generador 2D de sprites/skyboxes/badges
  (checklist §5 de [`ASSET_LICENSES.md`](ASSET_LICENSES.md)).
- Rafa (opcional): `git push origin --delete backup/pre-glb-rename-20260427-1940`
- H4: copia programada off-volume de `admin:backup` + tabla `matches`
  (contadores/retención).
