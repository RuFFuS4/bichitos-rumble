// ---------------------------------------------------------------------------
// ARENA_LOOK — todo lo que decide cómo SE VE el suelo de la arena
// ---------------------------------------------------------------------------
//
// Terreno v2, fase 1 (docs/ARENA_V2.md §3). Hermano de FEEL (gamefeel.ts):
// hojas numéricas planas, cero lógica, un solo sitio donde tocar.
//
// Regla de la casa (CLAUDE.md): gameplay y visual separados. NADA de aquí
// entra en física, colisiones ni `isOnArena` — el suelo jugable lo define
// `arena-fragments.ts` y no se entera de estos valores. Si un número de
// aquí cambiara dónde se puede pisar, está en el fichero equivocado.
//
// Superficie programática (directiva dual-surface): el lab expone
// `__devApi.getArenaLook()` / `setArenaLook(partial)` para tocar esto en
// vivo sin recompilar; los cambios que solo son color/intensidad se
// aplican al vuelo y los estructurales (tamaño de tile, bisel) piden un
// `rebuildArenaVisuals()` que conserva semilla y pack.
// ---------------------------------------------------------------------------

export interface ArenaLookConfig {
  /** Lado del tile de la textura de suelo, EN UNIDADES DE MUNDO.
   *  Un critter mide ~1,7 u de ancho, así que 4 u ≈ 2,5 critters por
   *  losa: se ve el patrón y se lee la escala. Antes la textura se
   *  repetía 4 veces por unidad (tile de 0,25 u) y el mipmap la
   *  colapsaba a color plano — la causa nº1 de "parece un plato liso". */
  tileSize: number;
  /** Multiplicador de brillo por banda (0 = centro inmune, 1-3 hacia
   *  fuera). El suelo se oscurece hacia el borde: da profundidad y hace
   *  legible dónde acaba una banda y empieza la siguiente. */
  bandTint: [number, number, number, number];
  /** Base sobre la que multiplican los tintes. Casi blanco: la textura
   *  del pack pone el color, esto solo modula. */
  tintBase: number;
  /** Variación de brillo por fragmento (±fracción). Rompe la uniformidad
   *  de banda sin que se note como "manchas". Determinista por semilla. */
  fragmentTintJitter: number;
  /** Multiplicador de brillo de la pared lateral (canto del acantilado)
   *  respecto a la tapa del mismo fragmento. */
  cliffTint: number;
  /** Sombra de contacto bajo cada critter (blob). Radio en múltiplos del
   *  radio del critter, y opacidad máxima cuando está en el suelo. */
  critterShadowScale: number;
  critterShadowOpacity: number;
  /** Intensidad del emisivo naranja del aviso previo al colapso. Es
   *  información crítica (ese trozo se cae en 3 s), así que se toca con
   *  cuidado: demasiado poco y no se ve, demasiado y tapa el suelo. */
  warningEmissive: number;
  /** Exposición del render. `toneMapping` es un flag aparte porque afecta
   *  a TODA la escena (los 9 critters incluidos), no solo al suelo: se
   *  activa a conciencia y con comparativa, no de refilón. */
  toneMapping: boolean;
  exposure: number;
}

export const ARENA_LOOK: ArenaLookConfig = {
  tileSize: 4.0,
  bandTint: [1.0, 0.94, 0.88, 0.82],
  tintBase: 0xe6e6e6,
  fragmentTintJitter: 0.05,
  cliffTint: 0.62,
  critterShadowScale: 1.15,
  critterShadowOpacity: 0.34,
  warningEmissive: 0.34,
  toneMapping: false,
  exposure: 1.15,
};

/** Semilla derivada para lo VISUAL. Un stream propio por feature
 *  (mulberry32(seed ^ SALT)) para que añadir variación visual no desplace
 *  la salida del generador de terreno, que es gameplay y está en golden. */
export const SALT_VISUAL = 0x9e37_79b9;
