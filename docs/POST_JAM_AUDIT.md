# Auditoría post-jam — 2026-08-16

> Recopilación del estado real del proyecto al retomar el desarrollo tras el
> Vibe Jam 2026 (resultado: ~top 200 de ~1000). Base: auditoría paralela de
> 6 agentes (herramientas, cliente, servidor, assets, pendientes documentados,
> gaps de producto) sobre el tag `v1.0-vibejam-submit` + docs (`e80a4b3`).
> El plan que sale de aquí vive en [`ROADMAP.md`](../ROADMAP.md) — este doc
> es la foto, aquel es el plan.

## Resumen ejecutivo

**La salud de ingeniería es inusualmente buena para un proyecto de jam**:
`tsc` limpio con gates estrictos, paridad cliente/servidor verde, cero
TODOs en el cliente, config centralizada (FEEL/FRAG) que aguantó el crunch,
y un ERROR_LOG con solo incidentes resueltos. Lo que está en deuda es todo
lo que rodea al código: documentación de planificación congelada en abril
(describe como pendiente lo que el bloque final ya implementó), cero CI,
cero telemetría, un dist de 239 MB hostil para portales, herramientas
internas fragmentadas en 5 shells duplicados, y **ninguna superficie
legal/comercial** (licencias de assets IA sin documentar, sin privacy/ToS
pese a tratar datos de usuarios UE).

Los dos bloqueantes reales de la monetización no son técnicos:
1. **Licencia comercial de los assets IA sin verificar** — los 9 critters
   salieron de Meshy/Tripo y no consta bajo qué plan (el tier gratuito de
   Meshy licencia CC BY 4.0 con atribución; los de pago transfieren
   propiedad). Verificar en las cuentas antes de mover un euro.
2. **Cero superficie legal** — el servidor ya guarda nicknames, tokens
   hasheados y usa IPs (rate limiting) sin política de privacidad ni ToS.

## 1. Cliente (25.488 líneas, 56 módulos TS)

**Salud**: muy buena. `tsc --noEmit` limpio, paridad 100%, 0 TODO/FIXME.

**Deudas estructurales** (por severidad):
- 🔴 `abilities.ts` (2.923 líneas) mezcla config + gameplay + VFX en un
  módulo — viola la propia regla de separación del proyecto. Split natural:
  `abilities-config` / `abilities-runtime` / `abilities-vfx` (las costuras
  ya están limpias).
- 🔴 Duplicación cliente/servidor (~2.100 líneas espejadas a mano en
  `server/src/sim/`) protegida solo por `verify-ability-parity.mjs`: un
  scraper de regexes frágil, con tabla de valores esperados hardcodeada,
  que **no está en `npm run check` ni en ningún CI**. `physics.ts` ya
  divergió 431 líneas de diff.
- 🟡 Sin CI (no existe `.github/workflows`). Todos los gates son rituales
  manuales.
- 🟡 `game.ts` (2.154 líneas) God class offline+online — split necesario
  ANTES de invertir en netcode (predicción, reconnect), no antes.
- 🟡 Cero tests del sim determinista (solo 1 smoke de Playwright). El peor
  bug del proyecto (fragmentos espejados) era exactamente del tipo que un
  unit test habría cazado.
- ⚪ `mesh2motion/` vendorizado = 552 de 1.287 ficheros trackeados (43%).

## 2. Servidor (Node + Colyseus 0.16 + SQLite en Railway)

**Salud**: compacto y bien comentado. `BrawlRoom.ts` (1.312 líneas) es un
tercio del servidor y tiene 5 mecánicas per-critter inline en el tick loop.

**Hallazgos clave**:
- 🔴 Mismos problemas de paridad/duplicación que el cliente (es la otra cara).
- 🔴 Puntos de acoplamiento Colyseus v3 identificados para la migración 0.17:
  `getStateCallbacks`/`$()` en `game.ts:842-859`, lecturas `as any` con
  guards de decode v3 en `game.ts:1095-1220`, el split
  PlayerSchema/InternalPlayerData (diseñado alrededor de un anti-pattern
  v3), semántica de `onJoin` throw-to-reject. `colyseus.js` cliente debe
  moverse en lockstep.
- 🟡 Integridad de leaderboards: los belts online son farmeables contra bots
  (solo Slayer exige humanos) y el rage-quit preserva la racha.
- 🟡 SQLite único en un volumen Railway **sin backup** y solo agregados
  (sin tabla `matches` → sin métricas de retención posibles, sin auditoría).
- ⚪ Docs del server mienten: ONLINE.md dice "no hay base de datos" (existe
  desde el 04-23); api.ts documenta un endpoint que no existe.

**Primitivas de retención que YA existen**: filas de jugador persistentes,
rachas, 5 leaderboards, toasts de cambio de belt, nicknames sin login.
**Lo que falta**: identidad cross-device (muere con localStorage), historial
de partidas, cualquier tipo de analytics.

## 3. Assets / payload (dist = 239 MB — hostil para portales)

Contexto de mercado: **CrazyGames exige ≤ 50 MB de descarga inicial y
≤ 250 MB de paquete total**; Poki similar. Hoy:

| Problema | Peso | Fix |
|---|---|---|
| 🔴 `index.html` prefetchea los 9 GLBs de critters en la primera visita (contradice la estrategia lazy ya codificada) | ~58 MB | borrar 9 líneas |
| 🔴 `tree_jungle_broadleaf.glb` MUERTO (nada lo carga desde que PACKS se vació) | 52 MB (¡22% del deploy!) | mover a `_raw/` |
| 🟡 Subsite `/animations` (tool interno) desplegado en producción | 57 MB | excluir del build |
| 🟡 Sprites/skyboxes/grounds/favicon/og en PNG sin comprimir | ~24 MB → ~6 MB | pase WebP (sharp ya instalado) |
| 🟡 Cache `immutable` 1 año sobre URLs mutables sin hash (ya mordió una vez con kermit.glb) | — | versionar URLs |
| ⚪ Chunk colyseus (39 KB gz) eager para jugadores offline | — | split del event-bus |

Primera carga real interactiva: ~253 KB gz de JS (bien) + ~5,7 MB de
imágenes (mal, todo comprimible). Con los tres primeros fixes el deploy
baja de 239 → ~74 MB y la primera visita pierde ~50 MB de prefetch.

## 4. Herramientas internas (la queja principal — confirmada)

5 superficies web nacidas en iteraciones distintas + capa CLI:

| Tool | Estado | Deficiencia principal |
|---|---|---|
| `/tools.html` (match lab) | El más maduro (DevApi 1.099 LOC bien diseñado) | Fork de ~950 líneas del markup de index.html — ya se rompió una vez por drift |
| `/anim-lab.html` | Frágil | **SIN persistencia** (F5 pierde la sesión); su apply reescribe `ANIMATION_OVERRIDES` entero borrando critters no tocados (pérdida de datos real) |
| `/calibrate.html` | Funcional | Snippet TS no pegable tal cual; indicador de divergencia impreciso |
| `/decor-editor.html` | Mejor UX (undo/redo, autosave) | **No emite ToolPatch** — su soporte en `apply-tool-patch.mjs` es código muerto; el bucle sigue siendo copy-paste manual |
| `/animations` (mesh2motion) | Aislado y pesado | node_modules propio, build separado, 2 pasos manuales de fichero; rigs débiles para Shelly/Kermit/Sihans |

**Síntomas transversales**: ~1.200 líneas de CSS duplicado entre 4 shells,
3 patrones de persistencia distintos, lógica compartible (orbit camera,
resize, escapeHtml, formateo TS) duplicada "kept in sync by hand", y un
bucle intención→cambio-aplicado de 5-6 pasos manuales (exportar → guardar
JSON en raíz → `npm run apply-tool-patch` → diff → commit).

**La base es buena** (DevApi, dry-run+diff del apply, doctor/verify como
gates) — el problema es la fragmentación. El plan de unificación
("Bichitos Studio") está en el ROADMAP, hito H3.

## 5. Documentación de planificación — DESACTUALIZADA (riesgo activo)

El bloque final del jam (04-29 → 05-01) implementó casi todo lo que los
docs de planificación siguen listando como pendiente:

- `CHARACTER_DESIGN.md` dice que 6/9 ULTIs son placeholder → **falso**, las
  9 L signature shipearon (proyectiles, conos, zonas resbaladizas, input
  inversion, agujeros reales de arena, copycat, decoys — todo existe).
- `NEXT_STEPS.md` (el autodeclarado single source of truth) marca el
  auto-apply de patches como no implementado → existe desde el 04-26.
- `ABILITY_QA_CHECKLIST.md` se contradice entre cabecera (implementado) y
  cuerpo (lista [!] 90% falsa).
- `ONLINE.md` niega la existencia de la DB que el propio server usa.
- `BADGES_DESIGN.md` y `MEMORY.md` congelados en el 04-23.

**Además**: la build final nunca pasó el QA de producción
(FINAL_JAM_QA_CHECKLIST casi entero en blanco) y el wipe de la DB de
Railway nunca se confirmó. Estado real del deploy = desconocido a día de hoy.

## 6. Gaps de producto/mercado (lo que ninguna auditoría técnica miraba)

- 🔴 **Licencias**: sin LICENSE en la raíz; assets IA sin dossier de términos.
- 🔴 **Legal**: sin privacy/ToS con tratamiento de datos UE ya activo.
- 🟡 **Viralidad cero**: sin `navigator.share`, sin salas privadas ni
  join-por-enlace (la petición nº1 de un brawler 4P: jugar con amigos).
- 🟡 **Distribución**: cero menciones a itch.io/Poki/CrazyGames en el repo;
  el único canal es el portal del jam, y su widget (script externo de un
  dominio de jam terminado) sigue cargándose en producción.
- 🟡 **Producción ciega**: sin Sentry ni window.onerror, y terser borra los
  console.log — un fallo en el móvil de un usuario es invisible.
- ⚪ SEO base buena (OG completo, la og-image existe pese al TODO obsoleto)
  pero: og-image 2 MB (WhatsApp descarta previews > ~600 KB), sin
  canonical/robots/sitemap/JSON-LD.
- ⚪ Sin manifest PWA (sin Add to Home Screen), sin `prefers-reduced-motion`
  en un juego cargado de screen-shake.
- ⚪ Todo el texto de UI en inglés sin i18n — marca española, mercado
  hispanohablante sin atender.

## 7. Dependencias (verificado 2026-08-16 con npm outdated + research)

| Paquete | Actual | Última | Notas de migración |
|---|---|---|---|
| typescript | ^5.7 (¡no 5.9!) | 7.0.2 | TS7 = compiler nativo Go (GA jul-2026, 8-12× más rápido). Ruta oficial: **5.x → 6.x primero** (resolver deprecations) → 7.0. `--strict` por defecto en 7. Prerequisito práctico: activar `verbatimModuleSyntax` YA bajo 5.x. Tools que importan la API del compiler esperan a 7.1 |
| vite | 6.4.2 | 8.2.1 | Vite 8 = Rolldown (builds 10-30× más rápidos). Ruta: 6→7→8. `build.rollupOptions` → `rolldownOptions`. **Exige Node 20.19+/22+** (verificar Vercel). Revalidar terser + manualChunks |
| three | 0.172 | 0.185 | Migración suave para nuestro uso: `Clock` deprecado (usar `Timer`), cambio visual de especular PBR en r181 (revisar look), `Object3D.dispose()` nuevo, `RGBELoader`→`HDRLoader` |
| colyseus (server) | 0.16.5 | 0.17.10 | Schema v3→v4. `Room<State>` → `Room<{state}>`, `onLeave(client, code)` numérico, `seatReservationTimeout`, protected→private. Migrar detrás de un adapter de acceso a estado; lockstep con colyseus.js cliente |
| better-sqlite3 | 12.9 | 13.0.3 | Menor |
| resto (gltf-transform, playwright, terser, sharp, tsx) | — | minors | Bumps triviales |

## Anexo: lo que SÍ está hecho y los docs niegan

Kit completo 9/9 L signature · proyectil Snowball · Cone Pulse frontal por
ondas · Frozen Floor slippery · Toxic Touch inversión de input · Sinkhole
con agujero REAL de arena · Copycat con chip HUD · Mirror Trick + decoy ·
hold-to-fire de Sebastian con preview · identidad multi-tab v2 · nicknames
en waiting room · Hall of Belts con tab online + render 3D + viewer ·
toasts 3D · gamepad glyph swap + LB portal · apply-tool-patch pipeline ·
leaderboards online 5 belts + toasts.
