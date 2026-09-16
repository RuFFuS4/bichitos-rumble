# Carril INTERFAZ — HUD, menús, entrada, idiomas, cinturones y audio

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`DEV_TOOLS.md`, `BADGES_DESIGN.md` y `NEXT_STEPS.md`.

## Pendiente (por orden)

1. **Portal del Vibe Jam fuera de itch y Steam.** Hoy `#portal-legend`
   (`src/hud/hud.partial.html`) y el portal de salida (`src/portal.ts`)
   están **siempre** activos, y el jam terminó en mayo.
   Dato verificado (BUILD_LOG 2026-08-19): **itch no sirve un zip, sirve
   un embed fullscreen de producción** — el mismo build que la web. Por
   eso un flag de build a secas no vale: apagaría el portal también donde
   sí lo queremos.
   - Mecanismo tuyo: leer el interruptor de la URL (`?portal=0`).
   - El flag de build para el empaquetado de Steam (`VITE_PORTAL=off`) es
     del carril DISTRIBUCIÓN → nota en su buzón.
   - **Falta que Rafa decida el alcance**: ¿fuera también en itch, o solo
     en Steam?
2. **Reestructura del HUD en móvil** (diferido de la era jam: "la versión
   actual es correcta, no ideal"). Mide antes de rediseñar.
3. **Audio**: eres el dueño de `src/audio.ts`. Si cambias las claves
   `bichitos.sfxMuted` / `bichitos.musicMuted`, avisa a todos los
   carriles — las lee `scripts/lib/headless-browser.mjs` y de ellas
   depende que las instancias de prueba nazcan mudas (directiva de Rafa).
   El carril PERSONAJES tiene pendiente pedirte SFX por critter.

## Lo que no puedes romper

- **La lectura del borde y de los critters manda sobre la decoración del
  HUD**: es un juego de tirar al rival al vacío.
- El naranja del aviso de colapso es **información de gameplay**, no
  decorado; ningún elemento de UI compite con él.
- Los botones de audio tienen que ser alcanzables desde **todas** las
  pantallas (regla de Rafa; ya hubo un bug por ocultarlos fuera de
  partida).
- Nada de gameplay ni de arena desde aquí. Si el golden se mueve, algo va
  mal.

## Buzón

*(Notas que te dejan otros carriles. Vacío.)*

## Cómo retomar

**2026-09-16** — carril recién creado, sin trabajo empezado. El punto 1
está a la espera de una decisión de Rafa sobre el alcance; el mecanismo ya
está identificado y es media tarde de trabajo.
