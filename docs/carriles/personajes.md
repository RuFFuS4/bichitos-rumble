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
   El diagnóstico se lanzó y **se cortó sin entregar**; hay que relanzarlo
   de cero (la caché de una tanda no sobrevive a la sesión que la lanzó).
   Lo que ya está medido y no hace falta volver a medir:
   - Los 9 GLB **sí** traen 6-10 clips (Idle, Run, Fall, Victory, Defeat,
     habilidades). No falta material.
   - El clip de Run se reproduce a **velocidad fija** (`meta.speed ?? 1`):
     un critter a 8 u/s y otro a 18 u/s mueven las patas igual, y los pies
     patinan. Ligar la velocidad del clip a la velocidad real es el
     arreglo más barato y el que más se nota.
   - Falta el vocabulario cartoon: inclinación al acelerar y al girar,
     squash al frenar, stretch al salir despedido, anticipación antes de
     la habilidad, e inercia en orejas y cola.
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

**2026-09-16** — carril recién creado, sin trabajo empezado. Lo primero es
relanzar el diagnóstico del feeling apoyándote en lo ya medido (punto 1):
no repitas la medición de clips, ya está hecha.
