# Next Steps — Bichitos Rumble

> **Doc operativo de la fase post-jam (reescrito 2026-08-16, pasada de
> doc-sync del hito H0).** Este archivo es solo la **checklist de trabajo
> del hito EN CURSO**. El plan completo (H0-H5) vive en
> [`ROADMAP.md`](ROADMAP.md) y la foto real del proyecto en
> [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
> Al cerrar un hito: tag, y esta checklist se reescribe para el siguiente.

El contenido histórico de la era del jam (roadmap Fases 1-4, barrido de
mapping de animaciones, tickets bloqueados, notas MCP, etc.) se eliminó
de este archivo: queda preservado en el historial de git y en
[`BUILD_LOG.md`](BUILD_LOG.md).

---

## ✅ Resuelto: Railway (2026-08-17)

El "Application not found" era el **trial agotado**. Rafa activó el plan
Hobby (5 $/mes), el proyecto se reanudó con el **mismo dominio** y **la
DB sobrevivió** en el volumen. Con el fix del Dockerfile (`COPY scripts`)
la CLI de admin funciona en producción por primera vez:

- Wipe ejecutado: 9 jugadores `%test%` borrados desde la consola.
- Primer backup de producción escrito (`/data/backups/br-online-*.sqlite`).
- Smoke online end-to-end verificado: identidad v2, nicknames en sala,
  partida completa y escritura en DB.

Fleco: quedan ~11 filas basura de la era del jam que no casan con los
patrones test (`Prueba*`, `asd*`, `123`, `RuFFuS`, `Rgr14`…). Todo en la
DB es de testing — un `admin:reset-players` la deja impecable (decisión
de Rafa; comando en [`ONLINE.md`](ONLINE.md)).

---

## H0 — Saneamiento (en curso)

Checklist de [`ROADMAP.md §H0`](ROADMAP.md), estado a 2026-08-17:

- [x] **Smoke de producción (cliente)**: Vercel sirve el build post-jam,
      widget del jam retirado (adiós al único error de consola),
      Privacy/Terms desplegados y verificados en vivo.
- [x] **Smoke online end-to-end**: server reactivado, 2 pestañas en la
      misma sala, identidad v2 completa, partida y persistencia OK.
- [x] **Wipe DB producción**: `admin:delete-test` ejecutado (9 filas).
      Fleco opcional: reset total de las ~11 filas basura restantes.
- [x] **CI mínimo** (GitHub Actions): client check + parity + server tsc
      + smoke Playwright. Estrenado en verde con el PR #1.
- [x] **Parity en `npm run check`**.
- [x] **Observabilidad (código)**: Sentry integrado (decisión de Rafa
      2026-08-17) — cliente mínimo tree-shaken (20 kB gz) en chunk async
      cargado en idle, buffer pre-init, release = git sha, inerte sin
      `VITE_SENTRY_DSN`. Activación pendiente de Rafa: DSN en Vercel +
      toggle de Web Analytics (ver abajo). Contadores server-side
      diferidos a H4 (tabla `matches`).
- [x] **Dossier legal (core)**: Tripo/Meshy/Suno confirmados de pago
      durante la generación → crítters y música en verde
      ([`ASSET_LICENSES.md`](ASSET_LICENSES.md)). `LICENSE` + privacy +
      terms desplegados. Flecos: archivar facturas (evidencia) e
      identificar el generador 2D de sprites/skyboxes/badges.
- [x] **Doc-sync** (2026-08-16).
- [x] **Higiene de repo**: ramas muertas fuera, widget fuera, scripts
      muertos fuera. Queda una rama backup remota opcional (abajo).
- [x] **Backup SQLite**: subcomando `admin:backup` desplegado y probado
      en producción. Fleco: programar copia periódica fuera del volumen.

**Gate de salida H0**: CI verde en dev/main ✅ · observabilidad
recibiendo ⏳ · DB limpia con backup ✅ · `ASSET_LICENSES.md` core ✅
(flecos de evidencia) · docs fiables ✅.

→ **Lo único que separa H0 del tag `v1.2-clean-base` es la
observabilidad.**

---

## Qué necesita Rafa

- **Activar Sentry** (último bloqueante de H0, ~5 min):
  1. Cuenta en sentry.io (free) → Create Project → Browser JavaScript
     → `bichitos-rumble` → copiar el **DSN**.
  2. Vercel → Settings → Environment Variables →
     `VITE_SENTRY_DSN` = DSN (Production) → redeploy.
  3. Vercel → Analytics → **Enable** (Web Analytics).
- **Archivar evidencia de licencias** (~10 min): facturas de abril 2026
  de Meshy, Tripo y Suno → `docs/licencias-evidencia/`.
- **Identificar el generador 2D** de sprites/favicon/og/badges/skyboxes
  (checklist punto 5 de ASSET_LICENSES.md).
- Opcional: reset total de la DB (`admin:reset-players -- --confirm
  --i-know-what-im-doing`) para borrar las ~11 filas basura restantes.
- Opcional: `git push origin --delete backup/pre-glb-rename-20260427-1940`
