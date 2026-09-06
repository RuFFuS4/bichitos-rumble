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

// ---------------------------------------------------------------------------
// BACKDROP_LOOK — el decorado lejano (docs/DIORAMAS.md)
// ---------------------------------------------------------------------------

/** Rampa de color del mar de un bioma: paradas [t, color] con t = 0 pegado
 *  al disco y t = 1 en el borde exterior. Oscuro cerca y claro lejos: es
 *  lo que recorta el canto de la isla y lee como distancia. */
export interface SeaRamp {
  stops: Array<[number, number]>;
}

export interface BackdropLookConfig {
  /** Altura del mar. 32 u por debajo del disco, y por debajo de
   *  VOID_FLOOR (-30) y de FRAGMENT_KILL_Y (-25): nada del juego lo
   *  atraviesa nunca, y a esa distancia no se puede confundir con suelo
   *  pisable. */
  seaY: number;
  /** Radio interior (bajo el borde del disco) y exterior. 300 u tapa la
   *  panorámica al 100 % en 16:9, 21:9 y móvil retrato; con 170 asomaba
   *  una línea de horizonte falsa en la pantalla de fin de partida. */
  seaInnerR: number;
  seaOuterR: number;
  seaSegments: number;
  seaRings: number;
  /** Radio donde ARRANCA la rampa (el tono más oscuro). Lo que queda por
   *  dentro no se ve nunca: lo tapa la propia isla. */
  rampInnerR: number;
  /** Radio donde la rampa de color se agota. La cámara solo ve de r≈40 a
   *  r≈120, así que estirar el degradado hasta el borde del plano (300)
   *  dejaba todo el bioma comprimido en un tercio de la escala. */
  rampSpanR: number;
  /** Exponente de la rampa: <1 concentra el degradado cerca del disco,
   *  que es donde se mira. */
  rampCurve: number;
  /** Potencia con la que se reparten los anillos del plano: >1 concentra
   *  geometría cerca de la isla (donde el degradado tiene que ser fino) y
   *  la ahorra lejos, donde el color ya es constante. */
  ringDistribution: number;
  /** Perspectiva aérea horneada: cuánto se funde el mar hacia el color de
   *  niebla del pack al alejarse, y con qué curva. Tope por debajo de 1
   *  para que el horizonte no acabe en un color liso — que es el defecto
   *  que arrastraba la panorámica. */
  hazeMax: number;
  hazeCurve: number;
  /** Sombra proyectada de la isla sobre el mar: cuánto oscurece y hasta
   *  qué distancia llega. Es lo que ancla la isla en vez de dejarla
   *  recortada sobre el fondo. */
  islandShadow: number;
  islandShadowReach: number;
  /** Dirección de la luz key en el plano (debe seguir a la de
   *  scene-atmosphere) para que la sombra caiga del lado correcto. */
  keyDirX: number;
  keyDirZ: number;
}

export const BACKDROP_LOOK: BackdropLookConfig = {
  seaY: -32,
  seaInnerR: 0.6,
  seaOuterR: 300,
  seaSegments: 96,
  seaRings: 36,
  rampInnerR: 18,
  rampSpanR: 115,
  rampCurve: 0.62,
  ringDistribution: 2.2,
  hazeMax: 0.42,
  hazeCurve: 0.85,
  islandShadow: 0.55,
  islandShadowReach: 34,
  keyDirX: -11,
  keyDirZ: 13,
};
