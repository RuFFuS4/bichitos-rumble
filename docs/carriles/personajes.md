# Carril PERSONAJES — modelos, animaciones, texturas, habilidades y feeling

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`NEXT_STEPS.md §H4.5`, `CHARACTER_DESIGN.md`, `ULTI_DESIGN.md` y
`ABILITY_QA_CHECKLIST.md`.

**Tienes el testigo del golden.** Eres el único carril que puede correr
`npm run golden:write`, y siempre con `npm run golden` detrás viendo 3/3
antes de commitear el JSON.

## Pendiente (por orden)

1. **El feeling — la petición viva de Rafa** (2026-09-07): *"se sienten
   pesados en vez de animalillos graciosos andando, corriendo y demás"*.
   **Diagnóstico medido y corte 1 hechos el 2026-09-21** → todo en
   [`docs/FEELING.md`](../FEELING.md) (causas con cifras, qué cambió,
   vídeos antes/después en `.tmp/feeling/v2/`). Lo que queda:
   - [ ] **Esperando a Rafa — tamaños** (`FEELING.md §6-A`): la capa
         procedural borra el ajuste a 1,7 y cada bicho cambia de tamaño
         en el «¡YA!» (+64 % Trunk, −21 % Sebastian). Recomendación:
         que funcione el 1,7. Afecta a cómo se lee todo lo demás, así que
         va antes de afinar el ritmo.
   - [ ] **Esperando a Rafa — ritmo por bicho** (`§6-C`): mirar
         `feeling-corte1-antes-despues.mp4` y tocar `FEEL.runCadence`.
   - [ ] **Corte 2** (`§5`): giro con peso en el hijo visual, acentos de
         arranque y frenada, reacciones al golpe/cabezazo que hoy se
         pintan en mallas ocultas, y personalidad con el rango real del
         roster (velocidad 8..18).
   - [ ] Vocabulario que sigue faltando después del corte 2: stretch al
         salir despedido, anticipación antes de la habilidad, inercia en
         orejas y cola.
   - `CLAUDE.md §Separation of concerns` exige que todo esto viva en la
     capa visual, sin tocar la física. Si el golden se mueve, te has
     pasado de capa.
2. **Feel pass de Kurama** (heredado de H4; receta en `NEXT_STEPS.md`).
3. **Shaders cartoon** (Rafa: "más adelante"). Precedente que no se puede
   ignorar: en la fase 1a se vio que tone mapping y PMREM tocan **toda**
   la escena. Un toon shader es lo mismo pero peor → detrás de un flag, y
   con el roster de nueve delante para comparar.
4. **SFX por critter**: el diseño es tuyo (identidad del bicho), pero el
   motor de audio (`src/audio.ts`) es del carril INTERFAZ → deja la nota
   en su buzón en vez de editarlo.

## Lo que no puedes romper

- **Espejos del sim**: `server/src/sim/{abilities,bot,physics,config}.ts`
  son copias byte a byte de sus hermanos de `src/`; los dos lados en el
  mismo commit (`npm run check` lo verifica).
- **Zona hard-stop de `CLAUDE.md`**: física, colisiones, habilidades,
  respawn. Plan antes de tocar, y despliegue cliente+servidor a la vez.
- Todo valor de tuning va a config (FEEL / definiciones por critter),
  nunca incrustado en la lógica.
- Doble superficie: lo que se pueda tocar con un slider tiene que poder
  tocarse desde CLI o `dev-api` el mismo día.

## Buzón

*(Notas que te dejan otros carriles. Vacío.)*

## Cómo retomar

**2026-09-21** — diagnóstico del feeling entregado y corte 1 en `dev`
(golden 3/3 sin regenerar: todo visual). Lee `docs/FEELING.md` §6: sin
la decisión de tamaños de Rafa no afines el ritmo por bicho. Si no ha
contestado, el corte 2 (§5) no depende de ella y se puede empezar.

Herramientas del carril: `scripts/critter-motion.mjs` (mide velocidad
real, ritmo de patas, patinaje, inclinación, balanceo, fotogramas de la
media vuelta y altura en partida, a paso fijo 1/60; con `--video` graba
el MP4 del recorrido) y `scripts/inspect-stride.mjs` (zancada de cada
Run, sin navegador). Para un antes/después: `--label=antes` en la base,
`--label=despues` en tu rama, mismo `--pack`.

**Cómo se trabajó**: las cuatro sesiones de carril estaban vivas a la vez
en la carpeta compartida, así que este carril se fue a un worktree
(`.claude/worktrees/personajes`, rama propia, `npm install` de 5 s desde
caché). Dos lecciones: el panel de preview del app lee `launch.json` de
la carpeta PRINCIPAL, así que el dev server del worktree se arranca a
mano (`npx vite --port 5181 --strictPort`) y el golden se corre con
`npm run golden -- --url=http://localhost:5181`; y el headless por
defecto renderiza por software (18 s/fotograma a 1400×900) — con
`channel: 'chromium'` + `--use-angle=d3d11 --enable-gpu` usa la GPU
(sigue mudo: el helper añade `--mute-audio` igual).
