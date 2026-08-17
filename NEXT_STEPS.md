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

## 🔴 BLOQUEANTE: Railway (modo online caído)

La app del servidor en Railway **ya no existe** ("Application not found"
en `wss://bichitos-rumble-production.up.railway.app`) → **el online está
caído en producción** y la DB SQLite (players/belts) posiblemente perdida.
Redeploy pendiente — **necesita el dashboard de Railway de Rafa**.

Al redesplegar, en orden:

1. `npm run admin:list-players` → ver qué sobrevivió en la DB.
2. Si la DB está sucia/corrupta: wipe con `admin:reset-players`.
3. Programar `npm run admin:backup` (copia fuera del volumen).
4. Cerrar el smoke online pendiente (Sihans L con agujero real, 2 tabs).

---

## H0 — Saneamiento (en curso)

Rama de trabajo: `claude/infra/h0-saneamiento`. Checklist de
[`ROADMAP.md §H0`](ROADMAP.md), estado a 2026-08-16:

- [x] **Smoke de producción (cliente)**: Vercel sirve el build final en
      www.bichitosrumble.com, consola limpia tras retirar el widget del
      jam. ⚠️ La mitad online del smoke queda bloqueada por Railway.
- [ ] **Wipe DB Railway**: bloqueado por el redeploy (ver arriba).
- [x] **CI mínimo** (GitHub Actions): `npm run check` + parity + server
      tsc + smoke Playwright en push/PR a dev/main.
- [x] **Parity en `npm run check`** (`verify-ability-parity.mjs`).
- [ ] **Observabilidad**: Sentry browser (o beacon propio) + Vercel Web
      Analytics + contadores diarios server-side. Pendiente de la
      decisión de Rafa (ver abajo). ANTES de los bumps de H1.
- [ ] **Dossier legal**: verificar tiers Meshy/Tripo → `ASSET_LICENSES.md`;
      `LICENSE` propietario en raíz; `/privacy.html` + `/terms.html`
      enlazados desde el título. Necesita las cuentas de Rafa.
- [x] **Doc-sync**: docs actualizados al estado real post-bloque-final
      (esta pasada, 2026-08-16).
- [x] **Higiene de repo**: ramas backup/agente ya mergeadas borradas;
      widget vibej.am retirado de `index.html`/`tools.html` (el widget.js
      upstream está roto y hacía heartbeat-ping a los usuarios). Queda
      una rama backup remota opcional (ver "Qué necesita Rafa") y el
      barrido de scripts muertos.
- [x] **Backup SQLite**: subcomando `npm run admin:backup` en el script
      admin del server. (La copia programada depende del redeploy.)

**Gate de salida H0**: CI verde en dev/main · observabilidad recibiendo ·
DB limpia con backup · `ASSET_LICENSES.md` completo · docs fiables.

---

## Qué necesita Rafa

- **Railway dashboard** (crítico): redesplegar el server y comprobar si
  el volumen/DB sobrevivió. Todo el modo online depende de esto.
- **Meshy/Tripo**: entrar en las cuentas y verificar bajo qué tier se
  generó cada critter (bloquea el dossier legal → y la monetización H5).
- **Decisión de observabilidad**: cuenta Sentry vs beacon de errores
  self-hosted en el propio server.
- Opcional: borrar la rama remota de backup ya obsoleta:
  `git push origin --delete backup/pre-glb-rename-20260427-1940`
