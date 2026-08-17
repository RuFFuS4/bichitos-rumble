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

## H2 — Dieta de payload + presencia base (técnico 5/5 ✅ · 2026-08-18)

Los 5 slices técnicos completados y desplegados (PRs #9-#13):
**dist 239 → 96,9 MB (−59 %)** · JS eager 297 → 258 kB gz · primera
visita ~64 MB → ~1,5 MB de extras.

1. [x] Prefetch de los 9 GLBs fuera (−58 MB por primera visita).
2. [x] `tree_jungle_broadleaf.glb` muerto (52 MB) → `_raw/`.
3. [x] `/animations` (55 MB) + labs fuera del build de producción
   (`VITE_BUILD_TOOLS=1` los fuerza; dev intacto).
4. [x] Imágenes: sprites/skyboxes/grounds → WebP (23,9 → 1,6 MB),
   og-image → JPEG 140 KB (WhatsApp la renderiza), favicon 10 KB.
   Masters en `_raw/` (¡`images/_raw` está gitignorado — forzados!).
5. [x] meshopt en los 6 crítters sin comprimir (14,2 → 3,1 MB;
   sihans 18×). Heavies se quedan (siguiente palanca = `-si`, arriesgado).
6. [x] Cache: /assets hasheados → immutable; /models /images /audio →
   `max-age=1d + SWR=7d`; catch-all excluye assets (404 reales).
7. [x] Colyseus lazy (split network/network-events): el SDK solo se
   descarga al pulsar Online. `optimizeDeps.include` para dev.
8. [x] Presupuesto en CI **y en el build de Vercel**: 100 MB total /
   17 MB por fichero, con ratchet documentado (135→115→100).
9. [x] SEO: robots.txt, sitemap.xml, canonical, JSON-LD VideoGame.
10. [~] **Página en itch.io**: borrador COMPLETO en
    `napsoul.itch.io/bichitos-rumble` (HTML embed fullscreen, cover,
    screenshots, tags, pricing $0-or-donate). Pendiente ← RAFA:
    1) verificar email de la cuenta (correo enviado a
    `rgr93.4@outlook.es` — sin verificar itch NO acepta el ZIP del
    juego), 2) avisar a Claude para subir el ZIP (30 s), 3) revisar y
    publicar el borrador, 4) configurar pagos en
    `/user/settings/seller` para que las donaciones cobren.

**Gate de salida H2**: dist ≤ 50 MB (hoy 96,9 — el resto grande son los
arena packs de 88 MB, lazy per-match; revisar si el gate literal aplica
o se redefine como "huella inicial ≤ 50", que YA se cumple de sobra) ·
Lighthouse móvil decente · itch.io publicado · tarjeta OG en WhatsApp ✅.

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
