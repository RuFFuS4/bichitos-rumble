# Next Steps — Bichitos Rumble

> **Doc operativo de la fase post-jam.** Solo la **checklist del hito EN
> CURSO**. Plan completo: [`ROADMAP.md`](ROADMAP.md) · foto del proyecto:
> [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
> Al cerrar un hito: tag, y esta checklist se reescribe para el siguiente.

**H0 Saneamiento: ✅ `v1.2-clean-base`** · **H1 Modernización: ✅
`v1.3-modern-stack`** (2026-08-18 — TS 7 nativo, Vite 8 Rolldown, three
r185, Colyseus 0.17 + schema v4; detalle en
[`docs/H1_MIGRATION_NOTES.md`](docs/H1_MIGRATION_NOTES.md)).
⏳ Fleco del gate H1: **cero errores nuevos en Sentry hasta 2026-08-20**
(vigilancia post-deploy).

---

## H2 — Dieta de payload + presencia base (siguiente)

Checklist de [`ROADMAP.md §H2`](ROADMAP.md). Meta: dist 239 MB →
**≤ 50 MB** (gate real de CrazyGames) y primera visita ligera.

1. [ ] Quitar el prefetch de los 9 GLBs de `index.html` (−50 MB de
   primera visita; la estrategia lazy ya existe en `game.ts`/`roster.ts`).
2. [ ] Mover `tree_jungle_broadleaf.glb` (52 MB, MUERTO — nada lo carga)
   a `_raw/` (la convención de `clean-dist-raw.mjs` lo excluye del dist).
3. [ ] Excluir `/animations` (57 MB, tool interno) + entries de dev
   (tools/calibrate/anim-lab/decor-editor) del build de producción.
4. [ ] Pase WebP/quantización: sprites (4,4 MB), skyboxes + grounds
   (~17 MB), favicon 632 KB, og-image → < 600 KB (límite WhatsApp).
5. [ ] meshopt para sihans (+resize textura 5,3 MB) y crítters sin
   comprimir; evaluar `-si` para los heavies (sebastian/kermit/kurama).
6. [ ] Cache: versionar URLs de /models /images /audio (o
   `stale-while-revalidate`) + excluirlas del catch-all SPA rewrite.
7. [ ] Colyseus lazy real para offline (split del event-bus — el aviso
   `INEFFECTIVE_DYNAMIC_IMPORT` de Rolldown apunta al mismo sitio).
8. [ ] **Presupuesto de payload en CI**: assert postbuild (dist ≤ 50 MB,
   ningún fichero > 8 MB) — el modo de fallo ya ocurrió dos veces.
9. [ ] SEO quick-wins: robots.txt, sitemap, canonical, JSON-LD VideoGame.
10. [ ] **Página en itch.io** embebiendo la URL de producción (segundo
    canal + botón de donaciones = primera monetización).

**Gate de salida H2**: dist ≤ 50 MB · Lighthouse móvil decente · itch.io
publicado · tarjeta OG renderizando en WhatsApp.

---

## Flecos heredados (no bloquean H2)

- **Sentry 48 h** (gate H1): revisar el panel el 2026-08-20; si hay
  errores nuevos del deploy, tratarlos antes de seguir.
- Rafa: archivar facturas abril 2026 (Meshy/Tripo/Suno) →
  `docs/licencias-evidencia/`.
- Rafa: identificar el generador 2D de sprites/skyboxes/badges
  (ASSET_LICENSES.md §5).
- Rafa: limpiar los jugadores TestSmoke* que dejó el smoke de producción
  (`npm run admin:delete-test -- --confirm` en la consola de Railway).
- H4 (anotados desde H1): reactivar la reconexión del SDK cuando el
  server implemente `allowReconnection` + `onDrop`; rutas HTTP tipadas
  de 0.17 para la tabla `matches`.
