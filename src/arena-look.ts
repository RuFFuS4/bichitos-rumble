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
  /** Lado del tile por defecto, EN UNIDADES DE MUNDO. Cada bioma manda
   *  sobre este valor con `PackDef.groundTile` (la escala buena depende de
   *  lo que la textura tenga pintado); esto solo se usa sin pack.
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
  /** Altura VISUAL del canto (u): cuánto acantilado cuelga bajo la tapa.
   *  NO es la de gameplay (`FRAG.arenaHeight`, 1,2 u, espejada en el
   *  servidor y blindada por golden): el suelo pisable no se entera. Las
   *  referencias de Rafa llevan un canto de ~1/5 del diámetro; 2,6 u
   *  sobre 24 u se queda algo por debajo para no robar cuadro al mar. */
  cliffVisualHeight: number;
  /** Radio de la base respecto al de la tapa (1 = cilindro). 0,82 es la
   *  cuña de un tronco de cono: deja preparada la lectura "la isla es un
   *  cono" sin comprometerla. La cuña apunta al eje del disco, no al
   *  centro de cada sector, para que las paredes de bandas contiguas
   *  sigan coincidiendo. */
  cliffTaper: number;
  /** Filas de vértices de la pared (≥ 2): `cliffStrata − 1` estratos,
   *  cada uno una hilada de bloques con su color de la rampa del bioma.
   *  Estructural: cada fila cuesta 2 tris por columna y pared. */
  cliffStrata: number;
  /** Rizado radial ±u por fila y por columna de la pared, determinista
   *  por índice de fragmento. 0 = cilindro perfecto. La fila de la tapa
   *  no se riza nunca: el contorno jugable es sagrado. */
  cliffRoughness: number;
  /** 0 = degradado continuo entre paradas de la rampa; 1 = cada estrato
   *  de un color plano (sillares). */
  cliffStrataHardness: number;
  /** Variación de brillo por bloque (±fracción): lo que hace que dos
   *  sillares vecinos no sean el mismo. */
  cliffBlockJitter: number;
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
  cliffVisualHeight: 2.6,
  cliffTaper: 0.82,
  cliffStrata: 5,
  cliffRoughness: 0.16,
  cliffStrataHardness: 0.65,
  cliffBlockJitter: 0.07,
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
// CliffRamp — los estratos del canto de la isla (docs/DIORAMAS.md parte 2)
// ---------------------------------------------------------------------------

/** Rampa de estratos del canto: paradas [t, color] con t = 0 en el labio
 *  (justo bajo la tapa) y t = 1 en la base. Cada bioma cuenta su corte
 *  vertical con ella: tierra → raíz → roca en jungle, nieve → hielo azul
 *  en tundra, roca roja estratificada en desert. Misma forma que SeaRamp
 *  a propósito: son la misma idea (color por vértice a lo largo de una
 *  coordenada), sobre superficies distintas. */
export interface CliffRamp {
  stops: Array<[number, number]>;
}

/** Canto sin pack (menús, lab sin bioma): roca neutra que no compite con
 *  los colores de banda planos. */
export const CLIFF_RAMP_DEFAULT: CliffRamp = {
  stops: [[0, 0x7a7466], [0.4, 0x6a655a], [1, 0x45413a]],
};

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
