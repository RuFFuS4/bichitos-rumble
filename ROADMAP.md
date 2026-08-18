# ROADMAP — Bichitos Rumble, fase post-jam

> Arranque: 2026-08-16 (tag `v1.1-post-jam-kickoff`).
> Resultado del jam: ~top 200 de ~1000. Objetivo de esta fase:
> **mejorar el juego → atraer usuarios → monetización mínima**.
> Foto del estado real: [`docs/POST_JAM_AUDIT.md`](docs/POST_JAM_AUDIT.md).
>
> Reglas de la fase: volvemos a la disciplina de ramas (`feature → dev →
> main`, nada directo a main); cada hito cierra con un tag; las decisiones
> importantes se registran en BUILD_LOG.md.

## Visión de conjunto

```
H0 Saneamiento ──► H1 Modernización ──► H2 Dieta payload + distribución
                                              │
                   H3 Bichitos Studio ◄───────┤ (H3 puede solaparse con H2)
                                              ▼
                   H4 Retención + bucle social ──► H5 Monetización mínima
```

La lógica: no se construye nada nuevo sobre cimientos ciegos (H0), no se
migra sin red (CI + Sentry antes que bumps), no se pide entrada en portales
con 239 MB de dist (H2 antes que H5), y no se monetiza sin licencias
verificadas (H0 desbloquea H5).

---

## H0 — Saneamiento y ojos abiertos ✅ CERRADO 2026-08-17 (`v1.2-clean-base`)

**Meta**: saber qué hay en producción, tener red de seguridad automática y
despejar los bloqueantes legales. Sin tocar gameplay.

- [x] **Smoke de producción**: cliente Vercel OK; hallazgos: widget del jam
      roto upstream (retirado) y **Railway desaparecido por trial agotado**
      → reactivado en plan Hobby (5 $/mes), DB sobrevivió en el volumen.
      Smoke online end-to-end completo (identidad v2, 2 pestañas misma
      sala, partida y persistencia).
- [x] **Wipe DB Railway**: reset total ejecutado por Rafa desde la consola
      (la CLI de admin llegó a producción con el fix del Dockerfile —
      `COPY scripts` faltaba desde siempre).
- [x] **CI mínimo** (GitHub Actions): client check + parity + server tsc +
      smoke Playwright. Estrenado en verde con el PR #1.
- [x] **Parity en `npm run check`**.
- [x] **Observabilidad**: Sentry integrado (chunk async 20 kB gz
      tree-shaken, lazy en idle, inerte sin `VITE_SENTRY_DSN`, release =
      git sha) y verificado end-to-end en producción (región UE). Vercel
      Web Analytics activado. Contadores server-side diferidos a H4
      (tabla `matches`).
- [x] **Dossier legal**: Tripo/Meshy/Suno confirmados de pago durante la
      generación → crítters y música en verde en `ASSET_LICENSES.md`.
      `LICENSE` propietario + `/privacy.html` + `/terms.html` desplegados.
      Flecos (no bloquean): archivar facturas, identificar generador 2D.
- [x] **Doc-sync**: 6 docs sincronizados a la realidad post-bloque-final.
- [x] **Higiene de repo**: 8 ramas muertas fuera, widget del jam retirado,
      scripts muertos borrados.
- [x] **Backup SQLite**: subcomando `admin:backup` desplegado y probado en
      producción. (Copia programada off-volume: fleco para H4.)

**Gate de salida**: CI verde en dev/main ✅ · Sentry recibiendo ✅ · DB
limpia con backup ✅ · ASSET_LICENSES.md core ✅ · docs fiables ✅.

## H1 — Modernización de dependencias ✅ CERRADO 2026-08-18 (`v1.3-modern-stack`)

**Meta**: stack 2026 con los saltos ordenados de menor a mayor riesgo,
cada uno en su propia rama con CI verde. Detalle por salto:
[`docs/H1_MIGRATION_NOTES.md`](docs/H1_MIGRATION_NOTES.md).

1. [x] **Pre-vuelo**: verbatimModuleSyntax (fallout: 1 línea) ·
       engines.node ≥ 20.19 · inventario three · Node verificado en los
       3 runtimes (CI 22, Railway 22-alpine, Vercel 24).
2. [x] **Bumps menores** + lección better-sqlite3 13 (sin prebuilds
       musl → compilación en el builder stage del Dockerfile; el job
       `server-docker` nuevo del CI lo cazó en su primer run).
3. [x] **TypeScript → 7.0.2 directo** (compiler nativo Go; la 6 puente
       resultó innecesaria — acepta experimentalDecorators). Fallout:
       1 línea. `npm run check` 15 → 7 s.
4. [x] **Vite 8.2 (Rolldown)** con config nativa (`rolldownOptions` +
       `codeSplitting.groups`, `import.meta.dirname`). Build 4,9 →
       2,9 s. Terser y DCE de Sentry verificados.
5. [x] **Three 0.185**: 0 fallout de tipos, imports a `three/addons`,
       pase visual headless con capturas — sin regresión del especular
       r181.
6. [x] **Colyseus 0.16 → 0.17 + schema v4** lockstep (cliente pasa a
       `@colyseus/sdk`; server a `defineServer()` tras descubrir que el
       wiring clásico duplica listeners HTTP en 0.17). Verificado con
       e2e local de 2 páginas + review adversarial de 3 lentes que cazó
       la auto-reconexión default-ON del SDK (desactivada; H4 la
       implementará server-side). Detalle en H1_MIGRATION_NOTES.

**Gate de salida**: CI verde ✅ · e2e online local completo ✅ · smoke
producción ✅ · merge a main + tag `v1.3-modern-stack` ✅ · Sentry 48 h
tras el deploy ⏳ (vigilancia en curso — cierra formalmente el gate).

## H2 — Dieta de payload + presencia base ✅ (2026-08-19, `v1.4-portal-ready`)

**Meta**: de 239 MB → **≤ 50 MB de deploy** y primera visita ligera;
criterio tomado del gate real de CrazyGames (≤50 MB inicial / ≤250 total).
**Resultado: dist 239 → 96,9 MB (−59 %); primera visita ~64 MB → ~1,5 MB
de extras; JS eager 297 → 258 kB gz.**

- [x] Quitar el prefetch de los 9 GLBs de index.html (−58 MB primera visita).
- [x] Mover `tree_jungle_broadleaf.glb` (52 MB, muerto) a `_raw/`.
- [x] Excluir `/animations` + tools del build de producción
      (`VITE_BUILD_TOOLS=1` los fuerza; dev intacto).
- [x] Pase WebP: sprites/skyboxes/grounds 23,9 → 1,6 MB, og-image → JPEG
      140 KB (WhatsApp la renderiza), favicon 10 KB.
- [x] meshopt en los 6 crítters sin comprimir (14,2 → 3,1 MB; sihans 18×).
      Heavies quedan para una futura pasada `-si` (arriesgado, pospuesto).
- [x] Cache: /assets hasheados → immutable 1 año; /models /images /audio →
      `max-age=1d + SWR=7d`; catch-all excluye assets (404 reales).
- [x] Colyseus lazy (split network/network-events): el SDK solo se
      descarga al pulsar Online.
- [x] **Presupuesto de payload en CI y en el build de Vercel**: 100 MB
      total / 17 MB por fichero, ratchet documentado (135→115→100).
- [x] SEO quick-wins: robots.txt, sitemap, canonical, JSON-LD VideoGame.
- [x] **Página en itch.io PUBLICADA** (`napsoul.itch.io/bichitos-rumble`):
      embed fullscreen de producción, cover+screenshots, "$0 or donate",
      payout mode + W-8BEN (retención 0 %) configurados. Primera
      monetización real activa.

**Gate de salida**: dist ≤ 50 MB → **redefinido como "huella inicial
≤ 50 MB"** (~1,5 MB reales; el resto del dist son arena packs lazy de
88 MB que solo baja quien juega esa arena — el criterio CrazyGames mide
descarga inicial, cumplido de sobra) · Lighthouse móvil ✅ (Perf 71 /
SEO 100 / BP 100; FCP 1,2 s, LCP 2,6 s — TBT 1,5 s es el boot de
three.js, esperable en un juego 3D) · itch.io publicado ✅ · tarjeta OG
en WhatsApp ✅.

## H3 — Bichitos Studio: tooling unificado ✅ (2026-08-19, `v1.5-bichitos-studio`)

**Meta**: las 4-5 herramientas "justas, deficientes y poco usables" se
convierten en **un solo estudio interno** con el bucle
intención→cambio-aplicado en 1-2 pasos (antes: 5-6 pasos manuales).
**Resultado: 8 slices en un día, todos verificados** (detalle por slice
en BUILD_LOG.md 2026-08-19).

- [x] Pipeline de patches no destructivo: merge de anim-lab (el apply
      viejo BORRABA critters), decor-editor emite DecorEditorPatch,
      validación de identificadores, 36+ tests golden.
- [x] Persistencia uniforme: anim-lab autosalva la sesión, divergencia
      por valores en calibrate.
- [x] **Apply to source**: endpoints dev-only en Vite + modal de diff
      bloqueante en los 3 labs — tune→código en 2 clicks.
- [x] UI kit compartido (lab-theme.css + lab-kit con dispose).
- [x] `studio.html`: shell de tabs con iframes lazy keep-alive.
- [x] Paridad del match lab: scene-atmosphere + frame-ticks compartidos
      con src/main.ts — fin del doble boot (el lab ejecutaba main.ts
      entero transitivamente) y de las habilidades congeladas.
- [x] Evict de mesh2motion a repo hermano `../bichitos-mesh2motion`
      (996 → 333 ficheros trackeados, −67 %).

**Gate de salida — CUMPLIDO**: cambio aplicado a fuente desde el
navegador en <1 min con diff visible ✅ · cero pérdida de datos al
recargar ✅ · mesh2motion fuera del repo ✅. Smoke de producción verde
tras el deploy (el refactor de main.ts shippeó limpio).

## Interludio — Fase de afilado (2026-08-19, en curso)

Entre H3 y la fase de mecánicas/assets, por decisión de Rafa: hacer las
herramientas más eficientes, eficaces y útiles ANTES de usarlas a
fondo. Plan completo con evidencia en
[`docs/AFILADO_PLAN.md`](docs/AFILADO_PLAN.md); checklist operativa en
[`NEXT_STEPS.md`](NEXT_STEPS.md). Decisiones marco: tuning
offline-first (server se sincroniza al final), melón de physicsRadius
abierto, port de mesh2motion upstream pronto.

Estado: slices A (17 quick-wins) y B (cabina de tuning: step-frame +
hotkeys + FEEL tuner + `feel-patch`) completados. Pendientes: C (tuner
de AbilityDef + hitbox visible) y D (port mesh2motion upstream).

## H4 — Retención y bucle social (~3-4 semanas)

**Meta**: razones para volver y jugadores que traen jugadores.

**Social / adquisición**
- [ ] **Salas privadas + join por enlace** (`?room=XYZ`): botón "Jugar con
      amigos" (create + joinById ya lo soporta Colyseus). La petición nº1
      de un brawler 4P y nuestro bucle viral más barato.
- [ ] **Compartir**: `navigator.share` con fallback clipboard en end screen
      y toasts de belt ("Gané con Kurama en Bichitos Rumble").
- [ ] **i18n ES/EN** (~150 claves, detección por navigator.language).

**Retención**
- [ ] **Reconnect** (`allowReconnection`, post-Colyseus 0.17): hoy un blip
      de red te convierte en bot para siempre.
- [ ] **Identidad con código de recuperación** (cross-device sin login).
- [ ] **Slayer Belt real** (el sistema está al 95%: solo falta el wiring de
      lastHitBy → kills_vs_humans) + tuning de umbrales de badges (Fase 6).
- [ ] **Integridad de leaderboards**: partidas vs bots no puntúan
      Throne/Flash/Streak; rage-quit registra derrota.
- [ ] **Tabla `matches`** server-side: historial + métricas de retención
      (DAU, partidas/día, curvas de abandono) + auditoría de agregados.

**Juego**
- [ ] Feel passes pendientes (Kurama primero — receta lista en NEXT_STEPS),
      SFX signature por critter.
- [ ] Split de `abilities.ts` (config/runtime/vfx) + tests Vitest del sim
      determinista (~20 tests) — antes de tocar gameplay en serio.
- [ ] Shared sim package cliente/servidor (mata el scraper de paridad y
      ~1.000 líneas duplicadas) — el refactor de más palanca del proyecto.
- [ ] Mobile: manifest PWA, viewport-fit=cover, prefers-reduced-motion
      (multiplicador global en FEEL), HUD landscape polish.

**Gate de salida**: 2 amigos pueden jugar juntos a propósito · un jugador
que vuelve conserva su identidad · métricas de retención visibles.

## H5 — Monetización mínima (tras H2+H4; ~2+ semanas)

**Meta**: primeros euros sin dañar la experiencia. Requiere el dossier de
licencias de H0 cerrado.

- [ ] **Donaciones itch.io** activas (viene de H2).
- [ ] **Portal con rev-share**: CrazyGames primero (sin exclusividad,
      50-80% del ad revenue). Integrar su SDK: ad-break natural en la pausa
      entre partidas de 60-90 s + hooks de loading. El gate de payload lo
      resuelve H2.
- [ ] Evaluar Poki con los datos del primer portal.
- [ ] **Decisión data-driven**: si retención D7 y partidas/día (H4) lo
      justifican, explorar cosméticos (skins/colores por critter) — solo
      con tracción; no antes.

**Gate de salida**: primer ingreso registrado (donación o ad revenue) ·
decisión documentada del siguiente paso con métricas en la mano.

---

## Calendario orientativo

| Hito | Ventana | Tag al cierre |
|---|---|---|
| H0 Saneamiento | 2ª quincena agosto | `v1.2-clean-base` |
| H1 Modernización | 1ª quincena septiembre | `v1.3-modern-stack` |
| H2 Payload + presencia | 2ª quincena septiembre | `v1.4-portal-ready` |
| H3 Bichitos Studio | octubre | `v1.5-studio` |
| H4 Retención + social | noviembre | `v2.0-social` |
| H5 Monetización | diciembre | `v2.1-first-euro` |

Los hitos H2/H3 pueden solaparse (uno es assets/infra, otro tooling). El
calendario es orientativo — la regla que manda es el gate de salida de
cada hito, no la fecha.
