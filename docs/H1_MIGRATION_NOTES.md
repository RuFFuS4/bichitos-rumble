# H1 — Notas de migración (pre-vuelo 2026-08-17)

> Resultado del pre-vuelo del hito H1 (`ROADMAP.md §H1`): inventario de
> superficie y riesgos por salto, para que cada bump sea un checklist y
> no una exploración. Actualizar este doc conforme caigan los bumps.

## Estado del pre-vuelo

| Item | Resultado |
|---|---|
| `verbatimModuleSyntax` (ambos tsconfig) | ✅ Activado. Fallout total: **1 línea** (`BrawlRoom.ts` — `Client` a type-only import). La disciplina de `import type` del código ya era correcta. |
| `engines.node >= 20.19` | ✅ Añadido a ambos package.json (requisito Vite 8). |
| Node en runtimes | CI: 22 ✅ · Railway: `node:22-alpine` (Dockerfile) ✅ · Vercel: **24.x** ✅ (verificado por Rafa 2026-08-17 en Settings → Node.js Version). |
| Bumps menores | ✅ 2026-08-17: gltf-transform 4.4.2, playwright 1.62, gltfpack/meshoptimizer 1.2, sharp 0.35.3, terser 5.50 (cliente) · tsx 4.23, **better-sqlite3 13** (nativo verificado local + job Docker nuevo en CI), @types/better-sqlite3 9.6, @types/node 22.20 (fijado a 22.x = runtime real) (server). Excluidos a propósito: typescript/vite/three/@types/three/colyseus — cada uno es su propio paso. |

## Superficie three.js real (grep 2026-08-17)

Sorprendentemente pequeña — el riesgo del bump 0.172 → 0.185 es BAJO:

| API | Dónde | Acción en el bump |
|---|---|---|
| `three/examples/jsm/loaders/GLTFLoader` + `utils/SkeletonUtils` | `src/model-loader.ts:15-16` (únicos imports de examples) | Cambiar a `three/addons/...` (ruta canónica moderna; examples/jsm sigue funcionando como alias, pero addons es lo future-proof) |
| `THREE.Clock` | **No se usa** (el loop usa timestamps de rAF) | Nada — la deprecación de r182 no nos toca |
| ShaderMaterial / onBeforeCompile | **No hay** shaders custom | Nada |
| `tex.colorSpace = SRGBColorSpace` | `arena-decorations.ts` | Ya es la API moderna — nada |
| `EquirectangularReflectionMapping` (skybox como `scene.background`) | `arena-decorations.ts`, `main.ts` | r184 alinea la rotación de background con la del objeto — no rotamos backgrounds, revisar visualmente igualmente |
| Multiply/SubtractiveBlending, `toTrianglesDrawMode`, RGBELoader | **No se usan** | Nada |
| Materiales PBR (MeshStandardMaterial en todos los GLBs) | Todo el juego | ⚠️ **r181 cambia el cálculo de especular indirecto** — ÚNICO riesgo real: pase visual por los 9 crítters + belts + 5 packs tras el bump (los materiales van con metalness 0 forzado, que amortigua el cambio) |
| `Object3D.dispose()` nuevo (r185) | `Critter.dispose`, belt viewer/thumbnail | Sin objetos custom con dispose propio — revisar que no colisione, esperado nada |

## Vite 6 → 7 → 8 (checklist)

- `build.rollupOptions` → `build.rolldownOptions` (input multi-entry +
  manualChunks — revalidar la función de chunks con Rolldown).
- Revalidar `minify: 'terser'` + `pure_funcs` (Rolldown trae minifier
  propio Oxc; decidir si terser sigue siendo necesario o el drop de
  console se hace con Oxc).
- `define: __BUILD_COMMIT__` — revalidar que el define sigue eliminando
  el camino muerto de Sentry sin DSN (test: build sin env var → grep
  del bundle).
- `build.target: 'es2020'` — Vite 8 sube defaults a Baseline 2026;
  mantener es2020 explícito o subir con datos de audiencia.
- Ruta recomendada oficial: 6→7 primero, luego 7→8 (opcional
  `rolldown-vite` en 7 para aislar issues de Rolldown).

## Colyseus 0.16 → 0.17 + schema v4 (el mayor riesgo — el último)

Puntos de acoplamiento v3 mapeados por la auditoría:

1. `src/game.ts:842-859` — `getStateCallbacks(room)` + `$(room.state)`
   (API de proxies v3).
2. `src/game.ts:1095-1220` — lecturas `as any` con guards de decode v3
   ("players puede ser plain object antes de reconstruir MapSchema",
   acceso por índice a ArraySchema).
3. `PlayerSchema` / `InternalPlayerData` split (diseñado alrededor del
   anti-pattern v3 de mezclar campos sync/no-sync).
4. `onJoin` throw-to-reject + `onLeave(client, consented)` →
   `onLeave(client, code: number)` en 0.17.
5. `Room<GameState>` → `Room<{ state: GameState }>`.
6. `colyseus.js` cliente en lockstep con el server.

Plan: PRIMERO envolver 1-2 en un adapter de acceso a estado (sin bump),
CI verde, y solo entonces bump lockstep + smoke online completo.

## Orden de ejecución y red de seguridad

Cada salto en su rama → PR → CI verde → merge dev → (al completar H1)
dev → main. Sentry vigila producción tras cada deploy: el gate del hito
exige **cero errores nuevos en 48 h**.
