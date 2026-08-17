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

## H2 — Dieta de payload + presencia base (~1-2 semanas)

**Meta**: de 239 MB → **≤ 50 MB de deploy** y primera visita ligera;
criterio tomado del gate real de CrazyGames (≤50 MB inicial / ≤250 total).

- [ ] Quitar el prefetch de los 9 GLBs de index.html (−50 MB primera visita,
      la estrategia lazy ya existe en código).
- [ ] Mover `tree_jungle_broadleaf.glb` (52 MB, muerto) a `_raw/`.
- [ ] Excluir `/animations` + tools del build de producción (−57 MB).
- [ ] Pase WebP/quantización: sprites (4,4 MB), skyboxes+grounds (~17 MB),
      favicon 632 KB, og-image → **< 600 KB** (límite de preview de WhatsApp).
- [ ] meshopt para sihans (+resize textura 5,3 MB) y resto sin comprimir;
      evaluar `-si` para los heavies (sebastian/kermit/kurama).
- [ ] Cache: versionar URLs de /models /images /audio (o
      `stale-while-revalidate`), excluirlas del catch-all SPA rewrite.
- [ ] Colyseus lazy real para jugadores offline (split del event-bus).
- [ ] **Presupuesto de payload en CI**: assert postbuild que falla si dist
      > 50 MB o un fichero > 8 MB (el modo de fallo ya ocurrió dos veces).
- [ ] SEO quick-wins: robots.txt, sitemap, canonical, JSON-LD VideoGame.
- [ ] **Página en itch.io** embebiendo la URL de producción: segundo canal
      de descubrimiento + botón de donaciones (primera monetización real).

**Gate de salida**: dist ≤ 50 MB · Lighthouse decente en móvil · itch.io
publicado · tarjeta OG renderizando en WhatsApp/Twitter.

## H3 — Bichitos Studio: tooling unificado (~2-3 semanas)

**Meta**: las 4-5 herramientas "justas, deficientes y poco usables" se
convierten en **un solo estudio interno** con el bucle
intención→cambio-aplicado en 1-2 pasos (hoy: 5-6 pasos manuales).

- [ ] **Shell único** (`studio.html`): tabs Match Lab / Animations /
      Calibrate / Decor sobre UI kit compartido (orbit camera, resize,
      paneles, tema). Mata ~1.200 líneas de CSS duplicado y el fork de
      950 líneas de tools.html que ya se rompió una vez por drift.
- [ ] **Pipeline de patches completo y no destructivo**: todas las tabs
      emiten ToolPatch; el apply de anim-lab pasa a merge (hoy borra los
      overrides de critters no tocados — pérdida de datos real);
      decor-editor emite patch desde la UI (hoy su soporte en
      apply-tool-patch es código muerto).
- [ ] **Apply directo desde la UI**: endpoint de apply en el dev-server
      (plugin de Vite) → botón "Apply to source" con diff previo. Adiós al
      paso "guarda el JSON en la raíz y corre el script".
- [ ] **Persistencia uniforme**: tool-storage en todas las tabs (anim-lab
      hoy pierde la sesión con F5).
- [ ] **Evict mesh2motion** a repo hermano/submodule (43% de los ficheros
      trackeados) y documentar el flujo de animación resultante.
- [ ] Quick-wins ya especificados: pack picker en match lab, indicador de
      divergencia real en calibrate, snippet TS pegable.

**Gate de salida**: un cambio de calibración/animación/decoración se aplica
a fuente desde el navegador en < 1 min con diff visible · cero pérdida de
datos al recargar · mesh2motion fuera del repo.

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
