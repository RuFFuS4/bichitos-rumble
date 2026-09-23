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
   - [x] **Velocidad de suelo** — hecha el 2026-09-22 (`FEELING.md
         §7.7`): zona muerta arreglada, `accelerationScale` 2,2, bots a
         0,7 en los dos lados, retoques acoplados, paridad `FEEL`↔`SIM`,
         y capa visual (giro de ~150 ms, patas a la velocidad real).
         **No sale a producción** sin el suavizado online del bicho local
         (buzón de DISTRIBUCIÓN).
   - [x] Sesgos de `FEEL.runCadence` quitados (Rafa, 2026-09-23): los
         nueve pisan con el pie apoyado salvo los que tocan el techo.
   - [x] Kowalski ya no patina (`§7.8`): Run nuevo por receta, derecho y
         con bamboleo (Rafa, 2026-09-23).
   - [ ] **Gusto pendiente** (`§7.7`): si las rondas se sienten cortas al
         jugar (−13 % en solo-bots), hablarlo con ARENA (colapso) o tocar
         vidas.
   - [ ] **Corte 2** (`§5`): ~~giro con peso~~ (hecho con la velocidad),
         acentos de arranque y frenada, reacciones al golpe/cabezazo que
         hoy se pintan en mallas ocultas, y personalidad con el rango real
         del roster (velocidad 8..18).
   - [ ] Vocabulario que sigue faltando después del corte 2: stretch al
         salir despedido, anticipación antes de la habilidad, inercia en
         orejas y cola.
   - `CLAUDE.md §Separation of concerns` exige que todo esto viva en la
     capa visual, sin tocar la física. Si el golden se mueve, te has
     pasado de capa.
2. **Mejora gráfica de los nueve** (Rafa, 2026-09-23: *«¿podemos
   mejorar gráficamente los personajes?»*). El estudio (seis agentes y
   dos refutadores) está en `.tmp/graficos/_informe/` del worktree de
   PERSONAJES. Decisiones de Rafa: **1** empezar por la fase 1 · **2**
   Kowalski derecho · **3** solo colores, sin tocar las formas de los
   modelos · **4** Kermit se queda granulado · **5** contorno sobre el
   sombreado actual (no toon) · **6** sin Tripo por ahora · **7** sí a
   los Run más vivos.
   - [x] **F1** — Kowalski (`FEELING.md §7.8`) y el encuadre de la
         selección (tamaños iguales para los nueve). Herramientas:
         `critter-recipe.mjs`, `stamp-critter-glbs.mjs`, `inspect-stride
         --check`.
   - [ ] **F2** — dieta de polígonos: Kurama 20 k, Sebastian 15 k y Kermit
         30 k (granulado intacto a 30 k). La emisiva duplicada, fuera.
         Texturas de los Tripo de JPEG a WebP. El límite de peso lo baja
         DISTRIBUCIÓN (buzón). Regenerar `RUN_GAIT`.
   - [ ] **Run más vivos** (decisión 7): Cheeto y Kermit a 3-4 ciclos/s,
         Shelly y Trunk a ~2, y el IK del Run de Sebastian (pie en 1,33).
         Cada uno, receta propia.
   - [ ] **Pulido de clips**: bucles que saltan (Victory de Sihans 143°,
         Kurama, Sergei; Fall de Kurama, Kermit, Cheeto), Victory largos,
         el segundo «Fall» de Sebastian.
   - [ ] **Paleta** (decisión 3, solo color): Sergei de negro a carbón,
         Kowalski de negro a azul marino con la cresta amarilla, Kermit de
         oliva a lima con la barriga amarilla, Shelly con el caparazón
         verde y beige, y blancos de los Tripo a ~0,85. Referencia:
         `.tmp/graficos/visual/bocetos/01.jpg`.
   - [ ] **Contorno** (decisión 5): casco invertido solo en los bichos,
         detrás de un flag, grosor relativo al tamaño en pantalla.
         Primero se actualiza `STYLE_LOCK.md`. `slot-thumbnail.ts` es de
         INTERFAZ (buzón) y `dev-api.ts` necesita permiso.
   - [ ] Texturas nuevas de los Tripo: aparcado, Rafa no tiene acceso a
         Tripo ahora mismo.
3. **Feel pass de Kurama** (heredado de H4; receta en `NEXT_STEPS.md`).
4. **Shaders cartoon**: Rafa eligió el 2026-09-23 contorno sobre el
   sombreado actual, no toon (punto 2). Si vuelve el toon, el precedente
   sigue en pie: en la fase 1a se vio que tone mapping y PMREM tocan
   **toda** la escena. Un toon shader sería lo mismo pero peor, así que iría
   detrás de un flag y con el roster de nueve delante para comparar.
5. **SFX por critter**: el diseño es tuyo (identidad del bicho), pero el
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

- **De ARENA, 2026-09-21: fondo v2, «la isla en el cielo»**
  (`docs/DIORAMAS.md` §«Fondo v2»). La isla pasa a flotar en el cielo, y
  caer es «que te trague el abismo». Hay tres cosas que tocan vuestro
  terreno; **solo la 3 ya está en marcha, y ninguna es urgente**.
  1. **Caída** (llega con la F4 del fondo; hasta entonces, nada). En
     `updateFalling` (`critter.ts:1137-1149`): que la escala baje de 1 a
     0,2 en los últimos 0,3 s y, si os gusta, que la caída acelere en vez
     de ir a 12 u/s constantes.
     - Sin tocar la opacidad: `fadeAlpha` fuerza `transparent` y
       `depthWrite=false` (`critter.ts:806-812`), y ese es el camino de
       ordenación del bug de Sergei (`critter.ts:704-716`).
     - Los valores, en `FEEL.lives` (`gamefeel.ts:108-114`), con
       `respawnDelay` en 0,8 s.
     - Comprobad `npm run golden` 3/3.
  2. **Eliminación** (también F4): el mismo encogido antes del
     `visible=false` de `eliminate()` (`critter.ts:1182`). El destello de
     «desaparece en el cielo» lo pone ARENA detectando el flanco de caída,
     sin tocar `critter.ts`.
  3. **Rebote de luz: YA está en la rama del slice F0.**
     - Qué cambia: el suelo del hemisferio pasa de tierra (`0x4a3a26` ·
       0,55) a un color por bioma a 0,7 (coral `0x6fb3b5`, jungle
       `0x5f7a55`, tundra `0x8a9cc0`, desert `0xa8784a`, kitsune
       `0x9a7890`). Es lo que ilumina la panza del cono, y aclara y enfría
       un poco la parte de abajo de los 9 bichos.
     - La hoja A/B: `R:\Proyectos_Trabajos\WorkSpaces\Claude\bichitos-rumble\.tmp\shots-cielo\_roster_ab.png`,
       con los 9 bichos en fila, antes y después, en coral. Va en ruta
       absoluta porque `.tmp/` no existe en vuestro worktree.
     - Si no os convence, decídnoslo: ARENA tiene un plan B que no os toca
       (emisivo solo en el canto de la isla, sin mover el hemisferio).

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

**2026-09-23** — en `dev`: feeling corte 1, tamaño 1,7, velocidad ×1,375
(`docs/FEELING.md` §7.7), sin sesgos de ritmo, y la **fase 1 de la mejora
gráfica** (§7.8): Kowalski derecho y sin patinar, y la selección con los
nueve a la misma altura. Lo siguiente es el punto 2 de arriba (F2, la
dieta), y después los Run más vivos, la paleta y el contorno.

Herramientas nuevas:
- `critter-recipe.mjs` y su receta por bicho. Toda edición de un clip va
  ahí, nunca a mano en el binario.
- `stamp-critter-glbs.mjs`.
- `inspect-stride --check`.

Los hallazgos de la F1 (ERROR_LOG 2026-09-23) valen para cada Run que se
rehaga: mide el pie contra el suelo del Idle, no solo el ritmo.

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
