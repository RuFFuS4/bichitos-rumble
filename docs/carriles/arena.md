# Carril ARENA — terreno, dioramas, fondo, colapso y la física de las cosas

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). El detalle de
cada punto vive en [`docs/ARENA_V2.md`](../ARENA_V2.md),
[`docs/DIORAMAS.md`](../DIORAMAS.md) y `NEXT_STEPS.md §H4.5`; aquí solo está
el orden de trabajo.

## Pendiente (por orden)

1. **Bloqueado por Rafa** — tres decisiones que hay que cerrar ANTES de
   afinar nada, porque determinan contra qué techo se afina. Se deciden
   mirando `.tmp/shots-cierre/*.png` (la única hoja de contactos que
   enseña el estado actual):
   - Techos de altura del scatter: ¿manda el contrato del código
     (`SCATTER_LIMITS`) o las reglas de `docs/DIORAMAS.md §3`? Son
     distintos. Recomendación registrada: mantener el código y corregir
     el doc.
   - ¿La isla pasa a **cono** (flotando en mar / aire / hielo según
     bioma)? `ARENA_LOOK.cliffTaper` ya apunta ahí.
   - ¿El fondo (mar por bioma) vale como está?
2. **Dioramas slice 2** — afinar recetas sobre capturas (grietas de hielo,
   escala de acentos), fleco del borde que se regenera al caer un sector,
   viento animado barato, recomponer los 73 props autorados,
   `SCATTER_DENSITY` en el studio y applier ToolPatch `scatter-patch`
   (doble superficie).
3. **Cohesión de los elementos** (Rafa, 2026-09-07: *"no parecen muy
   cohesionados"*): paleta compartida entre scatter, props GLB y suelo;
   que los elementos se toquen y se agrupen en vez de flotar sueltos;
   sombras de contacto también en los props.
4. **Fase 2 — el colapso que se lee y se siente**: grietas, hundimiento,
   escombros, polvo, shake. Es literalmente *"las físicas de las cosas"*
   que pidió Rafa: lo que le pasa al decorado cuando su sector cae.
5. **Fase 1b** — bisel de junta, applier `look-patch`, panel del studio y
   dieta de props (palmas, bambú y sakura: 112-131k → ≤20k tris).
6. **Fase 3** — rig de luz por bioma (en `docs/DIORAMAS.md` figura como
   "fase 0, va sola y primero" del fondo, y sigue sin hacer).
7. **Fase 4** — props que pertenecen al suelo + sacar de git el GLB crudo
   de 54 MB de `public/models/arenas/jungle/_raw/`.
8. **Fase 5** — todo lo visual derivado del radio (deja la capa lista para
   las arenas de 8 jugadores de H6).

## Lo que no puedes romper

- **Golden de partidas**: todo lo de este carril debería pasar
  `npm run golden` 3/3 **sin regenerar**. Si se mueve, has tocado
  gameplay sin querer. El testigo del golden es del carril PERSONAJES.
- **Espejos del sim**: `src/arena-fragments.ts` ↔
  `server/src/sim/arena-fragments.ts`, idénticos salvo cabecera; los dos
  en el mismo commit (`npm run check` lo verifica).
- **Determinismo**: cada sistema visual con su propio stream
  `mulberry32(seed ^ SALT_<feature>)`. Nunca el del generador de layout.
- Nada de este carril colisiona ni entra en `isOnArena`.
- Capturas: `node scripts/arena-shots.mjs --out .tmp/shots-<algo>` con el
  dev server vivo. Nacen mudas; no las tomes sin comprobar el reloj del
  HUD (el 2026-09-07 se juzgó el terreno sobre capturas del segundo 52).

## Buzón

*(Notas que te dejan otros carriles. Vacío.)*

## Cómo retomar

**2026-09-16** — carril recién creado. El trabajo está donde lo dejó el
cierre del 2026-09-07: slice 1 de dioramas, fondo y escala de suelo por
bioma hechos y **sin desplegar**. Lo primero es el punto 1: sin esas tres
decisiones de Rafa, afinar recetas es tirar el tiempo.
