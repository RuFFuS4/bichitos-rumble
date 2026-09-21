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
   - [x] **Tamaños** — Rafa eligió el 1,7 para todos (2026-09-21). Hecho:
         los nueve miden 1,66-1,71 en partida y no hay salto en el «¡YA!»
         (`FEELING.md §3.1`).
   - [x] **Ritmo por bicho** — Rafa: *"bastante mejor que antes"*.
   - [ ] **Velocidad de suelo** — Rafa pide recomendación (`FEELING.md
         §7`). Es gameplay: zona hard-stop, golden:write, espejo del
         servidor y despliegue cliente+servidor a la vez.
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

*(Notas que te dejan otros carriles.)*

- **De DISTRIBUCIÓN, 2026-09-21 — derivas offline↔online que salieron en
  la verificación previa al despliegue de H4.5.** Todas estaban ya en
  producción (v1.7), H4.5 no las toca y nada bloquea. Pero significan
  que **el golden de balance (offline) no representa lo que se juega
  online**. Medido con `kit-parity.mjs` y `bot-kits.mjs`, que están en
  `.tmp/distribucion/predeploy-h45/` del checkout principal:
  1. **Kurama, K (Mirror Trick).** Online queda clavado 2,8 s y offline
     se mueve libre. En el cliente, `src/abilities.ts:794-800` tiene
     `slowDuringActive: 1.0` (decisión tuya del 2026-04-30,
     `ABILITY_QA_CHECKLIST.md:97`); en el servidor,
     `server/src/sim/abilities.ts:213-214` aplica `...ROOTED_K` → 0.
  2. **Enraizado en los wind-up.**
     - K ground_pound: offline ×0,15 y online ×0 (`ROOTED_K`), en
       Sergei, Trunk, Kurama, Shelly, Kermit y Sebastian.
     - L frenzy: offline ×0,10 y online ×1,0, porque los kits del
       servidor no traen `slowDuringWindUp`.
     - Kowalski K activo: cliente ×1 y servidor ×0.
     - Las masas efectivas coinciden hoy, pero por casualidad: el
       cliente aplica `massMultiplier` a cualquier tipo y el servidor
       solo a charge y frenzy.
  3. **Charge Rush.** El steer ×0,15 existe solo offline
     (`src/player.ts:24-29`, `src/bot.ts:96-100`): online la carga se
     dirige.
  4. **Los bots offline y online no son el mismo bot.**
     - El online acelera ×1,69: `src/bot.ts:147` multiplica por 0.55 y
       `server/src/BrawlRoom.ts:957` aplica la aceleración completa.
     - El K blink de Sihans y Cheeto no se lanza nunca offline (tag
       `mobility` + `findAbilityByTag` devuelve el primero); online sí.
     - El L se lanza offline y nunca online
       (`server/src/sim/bot.ts:191`, `ultimate = false`).
     - El reflejo defensivo de Shelly mira cosas distintas en cada lado.
  5. **Gates.** `verify-ability-parity` no revisa J ni `slowDuring*`.
     Comparar los multiplicadores efectivos por fase (lo que hace
     `kit-parity.mjs`) lo habría cazado.

  La decisión de qué perfil es el bueno es tuya. Si al unificar hay que
  tocar `BrawlRoom.ts` (lo del ×0.55 del bot vive ahí), es mío: déjame
  en el buzón de `docs/carriles/distribucion.md` qué quieres y lo hago
  yo.

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
