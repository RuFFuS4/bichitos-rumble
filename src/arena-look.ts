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
   *  servidor y blindada por golden): el suelo pisable no se entera.
   *  Decisión de Rafa (2026-09-21): la isla es un CONO EN PUNTA que flota,
   *  así que el canto es la panza entera — 9 u sobre 24 de diámetro. La
   *  cámara de juego no la ve nunca (A/B en `.tmp/shots-cono/`); se lee
   *  con cámara baja: pantalla final, capturas de tienda y sectores que
   *  vuelcan al caer. */
  cliffVisualHeight: number;
  /** Radio de la base respecto al de la tapa (1 = cilindro, 0 = punta).
   *  0,08 cierra el cono casi en punta sin degenerar los triángulos del
   *  fondo. La cuña apunta al eje del disco, no al centro de cada sector,
   *  para que las paredes de bandas contiguas sigan coincidiendo. */
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
  // Cono en punta (2026-09-21): el doble de estratos para que 9 u de
  // panza sigan leyéndose como hiladas de ~1 u, más rizado y jitter para
  // que la punta sea roca y no una peonza lisa. Coste medido: +10,5k tris
  // (0,5 % en jungle), +0 draws.
  cliffVisualHeight: 9,
  cliffTaper: 0.08,
  cliffStrata: 10,
  cliffRoughness: 0.45,
  cliffStrataHardness: 0.9,
  cliffBlockJitter: 0.14,
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

/** Sal del stream del cielo (fondo v2). Cada capa la mezcla además con su
 *  propio id, así que tocar el número de una no reordena las otras. */
export const SALT_BACKDROP = 0x3c6e_f372;

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

/** Cielo de un bioma (fondo v2, docs/DIORAMAS.md §«Fondo v2»). Lo global y
 *  estructural vive en BACKDROP_LOOK; esto es lo que cambia de un pack a
 *  otro. El horizonte no está aquí: es el `fogColor` del pack. */
export interface PackSky {
  /** Cénit de la cúpula. Solo se ve en las poses bajas (victoria). */
  zenith: number;
  /** Color del pozo justo detrás del canto. */
  abyss: number;
  /** Pozo OSCURO (el fondo más oscuro que el canto) o CLARO (más claro,
   *  la arena se recorta a contraluz) — decisión 2 del plan. El contraste
   *  del canto pide |ΔL| ≥ 45 contra la banda exterior (plan §4), así que
   *  el `abyss` tiene un TECHO de luma si es oscuro y un SUELO si es claro.
   *  Son datos y no comentario para que `corridorViolations` pueda fallar:
   *  techo = L_arena·0,906 − 45 · suelo = L_arena·0,906 + 45 (luma sRGB
   *  0-255; el 0,906 es `bandTint` 0,82 medido en sRGB). */
  pit: 'dark' | 'light';
  abyssCeiling: number;
  abyssFloor: number;
  /** Fondo del abismo (−90°), más oscuro que `abyss`. */
  abyssDeep: number;
  /** Tinte de las nubes cercanas (C2); la panza sale de `cloudBelly`. */
  cloudTop: number;
  /** Tinte de las nubes lejanas (C3) antes de fundirse con el horizonte. */
  cloudFar: number;
  /** Fracción del mar de nubes cubierta (0..0,7). Por encima de 0,7 se
   *  lee como moqueta (riesgo 1 del plan). */
  coverage: number;
  /** Tapa de los islotes. Más oscura y desaturada que la arena para que
   *  no parezcan una plataforma a la que saltar (riesgo 7). */
  isletTop: number;
  /** Rebote de luz desde el cielo de abajo: `groundColor` e intensidad del
   *  hemisferio. Es lo que ilumina la panza del cono (plan §6). */
  hemiGround: number;
  hemiIntensity: number;
}

export interface BackdropLookConfig {
  /** 'sky' = fondo v2 (la isla en el cielo). 'sea' = el mar a y=−32 con
   *  la foto de fondo, que se conserva solo para el A/B hasta la F4. */
  mode: 'sky' | 'sea';
  /** Cúpula pegada a la cámara: radio (dentro del `far` 500) y columnas.
   *  Sin UV, color por latitud: sin costuras (lección de b054e96). */
  domeRadius: number;
  domeColumns: number;
  /** Elevación (°) hasta la que la cúpula sigue siendo EXACTAMENTE el
   *  color del horizonte. El plan pide al menos −13° (por debajo, C3 deja
   *  de fundirse con lo que tiene detrás desde la victoria, plan §5); con
   *  la cámara baja C3 se ve hasta −16°, así que se estira hasta ahí. */
  horizonHoldDeg: number;
  /** Elevación (°) desde la que la cúpula ya es color de pozo. −22° es el
   *  techo del cuadro de juego en 16:9 (esquinas; −25,8° en móvil): así el
   *  degradado hacia el horizonte solo se ve con cámara baja, y en juego no
   *  suma fondo claro (decisión 1: ≤8 % del fondo sobre el p75 de la arena). */
  abyssStartDeg: number;
  /** Margen del pasillo del canto (°): 1,0 visual + 1,5 de temblor de
   *  cámara en el peor caso (Trunk Slam, 0,63 u sobre el labio frontal). */
  corridorMarginDeg: number;
  /** Bruma hacia el horizonte por radio: 0 en `hazeStartR`, 1 en
   *  `hazeEndR`. En juego se ve hasta r≈154-193, así que ahí se queda en
   *  0,1-0,4; desde la victoria, a r 280 las nubes son horizonte puro. */
  hazeStartR: number;
  hazeEndR: number;
  /** Brillo de la panza de un bulto de nube respecto a su cima. */
  cloudBelly: number;
  /** Cuánto se nota la luz key horneada en las nubes cercanas: 0 = plano,
   *  1 = el lado de sombra baja al 55 %. Sin esto, vistas desde arriba son
   *  discos planos. La dirección es la de la key (`keyDirX/Y/Z`). */
  cloudShade: number;
  /** Nubes cercanas (C2): cúmulos candidatos (cada uno 3-4 bultos),
   *  anillo, altura de las cimas (más hondas junto al pozo, subiendo hacia
   *  fuera) y tamaño del bulto principal. */
  nearCount: number;
  nearRMin: number;
  nearRMax: number;
  nearTopYIn: number;
  nearTopYOut: number;
  nearRiseR: number;
  nearSizeMin: number;
  nearSizeMax: number;
  /** Escala del ruido que agrupa las nubes en bancos y deja huecos (u). */
  nearClusterScale: number;
  /** Cuello de nubes en sombra alrededor de la punta del cono. */
  neckCount: number;
  neckRMin: number;
  neckRMax: number;
  neckYMin: number;
  neckYMax: number;
  neckSizeMin: number;
  neckSizeMax: number;
  /** Nubes lejanas (C3), en malla plana: centros en [farRMin, farRMax]. */
  farCount: number;
  farRMin: number;
  farRMax: number;
  farTopYMin: number;
  farTopYMax: number;
  farSizeMin: number;
  farSizeMax: number;
  /** Alto de un bulto lejano respecto a su ancho: planas, para que no
   *  cuelguen por debajo de la franja del horizonte de la cúpula. */
  farFlatten: number;
  /** Islotes hermanos: cuántos, cuántos como mínimo dentro del cuadro de
   *  juego 16:9, dónde y de qué tamaño. Alto de la panza = radio × ratio. */
  isletCount: number;
  isletMinInFrame: number;
  isletRMin: number;
  isletRMax: number;
  isletTopYMin: number;
  isletTopYMax: number;
  isletRadiusMin: number;
  isletRadiusMax: number;
  isletDepthRatio: number;
  /** Cuánto se oscurece un islote hacia el abismo en la cota más honda. */
  isletDepthDarken: number;
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
  keyDirY: number;
  keyDirZ: number;
}

export const BACKDROP_LOOK: BackdropLookConfig = {
  mode: 'sky',
  domeRadius: 420,
  // 128 columnas: con 48 el degradado del horizonte salía en facetas
  // rectas con la cámara baja.
  domeColumns: 128,
  horizonHoldDeg: -16,
  abyssStartDeg: -22,
  corridorMarginDeg: 2.5,
  hazeStartR: 120,
  hazeEndR: 280,
  cloudBelly: 0.8,
  cloudShade: 0.6,
  // 110 cúmulos × 3-4 bultos ≈ las 330 instancias del plan. El tamaño lo
  // limita la decisión 1 de Rafa: como mucho el 8 % del fondo más claro
  // que el p75 de la arena (medido con `arena-shots --metrics`).
  nearCount: 110,
  nearRMin: 45,
  nearRMax: 220,
  nearTopYIn: -64,
  nearTopYOut: -48,
  nearRiseR: 190,
  nearSizeMin: 4.5,
  nearSizeMax: 10,
  nearClusterScale: 55,
  // Bajo el disco (r ≤ 11), abrazando la punta del cono. En juego asoma
  // bajo el labio frontal y por los lados, al pie del cuadro, más oscuro
  // que el pozo (lo prevé el plan §5); con r hasta 19 salían discos
  // oscuros enormes. neckYMin/Max acotan el bulto ENTERO (cima incluida):
  // nada del fondo sube de y=−5 dentro de r<25 (plan §8).
  neckCount: 16,
  neckRMin: 3,
  neckRMax: 11,
  neckYMin: -15,
  neckYMax: -7,
  neckSizeMin: 1.8,
  neckSizeMax: 3.2,
  farCount: 160,
  farRMin: 225,
  farRMax: 340,
  farTopYMin: -56,
  farTopYMax: -48,
  farSizeMin: 25,
  farSizeMax: 45,
  farFlatten: 0.3,
  isletCount: 7,
  isletMinInFrame: 3,
  isletRMin: 45,
  isletRMax: 110,
  isletTopYMin: -60,
  isletTopYMax: -28,
  isletRadiusMin: 1.5,
  isletRadiusMax: 6,
  isletDepthRatio: 1.6,
  isletDepthDarken: 0.45,
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
  keyDirY: 17,
  keyDirZ: 13,
};
