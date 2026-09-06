// ---------------------------------------------------------------------------
// Scatter — recetas por bioma (hoja de números, hermana de ARENA_LOOK)
// ---------------------------------------------------------------------------
//
// docs/DIORAMAS.md parte 2, fase 5. Cada bioma traduce SU referencia
// (resources/Terrenos/<Bioma>/<NOMBRE>.png) a capas del contrato de
// arena-scatter-types.ts. Aquí solo hay datos: ni geometría, ni RNG, ni
// three. El motor (arena-scatter.ts) los consume.
//
// Lo que las cinco referencias tienen en común y que estas capas ponen:
//   (1) rasante interior  — decal / pebble ≤ 0,3 u, poca densidad y
//       clearCenterR 2,6-3,0 para que la pista central respire
//       (SCATTER_LIMITS.innerMaxH = 0,4 es la ley; nos quedamos debajo).
//       Las bandas rasantes se solapan un poco con las exteriores
//       (rMax 9-9,5) para que r = 8,5 no se lea como una costura.
//   (2) rasante exterior  — r 8,2-11,8, denso, en racimos: la marea, el
//       viento y la nieve AMONTONAN, no reparten.
//   (3) bajo exterior     — tuft / grassCross / dome / shard ≤ 1,15 u
//       (SCATTER_LIMITS.frontMaxH = 1,2: legal en todo el arco).
//   (4) franja del borde  — anchor 'fringe': lo que muerde el canto.
//       rMin/rMax son profundidad desde el arco exterior; un pebble de
//       escala 0,8 asoma hasta 0,6 u por fuera del labio. Eso es lo que
//       se busca: rocas que sobresalen, coral en el agua, raíces.
//       Sin blobShadow: el disco de sombra va a ras de la tapa y la parte
//       que asoma flotaría sobre el vacío.
//   (5) acentos medios    — dome / shard 1,3-2,6 u en racimos, 24-30 por
//       bioma. Solo caben en el arco trasero (backMaxH 2,6); el contrato
//       no tiene campo angular, así que en el arco frontal el motor los
//       recorta a 1,2 y avisa por consola (ver concerns del informe).
//
// Convenciones de escala (primitivas de 1 u de alto con base en y=0):
//   dome  → alto = scale, ancho = 2,6 × scale.   pebble → alto = scale,
//   ancho = 1,5 × scale.   shard / grassCross / tuft → alto = scale.
//   decal → plano (1 × 0,6 u a escala 1), altura 0, `tilt` siempre 0;
//   con yaw 'wind' su eje largo se alinea con el viento.   log → scale =
//   diámetro, largo = 3,2 × scale.
//
// Paletas: hex muestreados de cada referencia (cuantización por regiones
// centro / anillo / borde) y, para los decals, del webp de suelo del pack
// (public/images/arena-ground/): una mancha tiene que ser una variación
// del suelo REAL del juego, no del suelo de la ilustración. Saturación
// siempre por debajo de la de los critters y sin emisivo: el naranja del
// aviso de colapso es información. `colorJitter` en fracción por canal.
//
// Eje de viento (rad, atan2: 0 = +X, π/2 = +Z = hacia la cámara). Uno por
// bioma: lo usan yaw 'wind' y la dirección de inclinación de hierba y
// matas (windJitter del motor rompe el clonado). Nunca alineado con un
// eje de pantalla: una diagonal lee como viento, una horizontal como
// rejilla.
// ---------------------------------------------------------------------------

import type { ArenaPackId } from './arena-decorations';
import type { ScatterRecipe } from './arena-scatter-types';

export const SCATTER_RECIPES: Record<ArenaPackId, ScatterRecipe> = {

  // -------------------------------------------------------------------------
  // JUNGLE — "la cima de un templo tragado por la selva"
  // Referencia: JUNGLE TROPIC.png. Empedrado central, un anillo de tierra
  // ocre sembrado de guijarros, hierba verde-oliva hasta el labio, plantas
  // de hoja ancha y helechos bajo las palmeras, sillares, y un canto de
  // piedra apilada con la hierba colgando por encima.
  // -------------------------------------------------------------------------
  jungle: {
    // Brisa que entra por el arco trasero-derecho y sale hacia la cámara
    // por la izquierda (dirección (−0,63, +0,78)): la hierba se inclina
    // hacia el jugador y enseña la cara de las hojas, no el canto. Las
    // palmeras del layout viven en 0,3-0,85 y 2,3-2,65 rad; el viento
    // cruza entre ellas en vez de tumbarlas de frente.
    wind: 2.25,
    layers: [
      // Hojarasca ocre y hojas caídas sobre la senda de tierra que rodea
      // el empedrado (el anillo ocre de la referencia, r 4-8 en la
      // ilustración). Corros, no moqueta.
      {
        id: 'jungle_leaf_litter',
        primitive: 'decal',
        anchor: 'disc',
        count: 170,
        rMin: 2.6,
        rMax: 9.2,
        clearCenterR: 2.6,
        clusterCount: 10,
        clusterRadius: 1.8,
        scale: [0.2, 0.36],
        tilt: 0,
        colors: [0xb27d2f, 0x9c6c24, 0xcb8e33, 0x6d7903],
        colorJitter: 0.08,
        yaw: 'random',
        blobShadow: false,
      },
      // Briznas cortas que se cuelan por las juntas de las losas del
      // interior (micro-relieve sobre la textura de hierba).
      {
        id: 'jungle_grass_short',
        primitive: 'grassCross',
        anchor: 'disc',
        count: 150,
        rMin: 2.8,
        rMax: 8.5,
        clearCenterR: 2.8,
        clusterCount: 12,
        clusterRadius: 1.4,
        scale: [0.18, 0.3],
        tilt: 14,
        colors: [0x767006, 0x898704, 0x6d7903, 0x9d980d],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Guijarros y trozos de sillar (ocre arenisca) sobre la tierra de
      // la senda: la referencia los siembra por todo el anillo ocre.
      {
        id: 'jungle_path_pebbles',
        primitive: 'pebble',
        anchor: 'disc',
        count: 90,
        rMin: 4.0,
        rMax: 9.5,
        clearCenterR: 4.0,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.1, 0.22],
        tilt: 12,
        colors: [0xb7871f, 0xa27916, 0xc9a45a],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Hierba alta de la corona exterior, verde-oliva como la de la
      // referencia: claros y espesuras (racimos anchos), no césped.
      {
        id: 'jungle_grass_tall',
        primitive: 'grassCross',
        anchor: 'disc',
        count: 280,
        rMin: 8.5,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 20,
        clusterRadius: 1.5,
        scale: [0.28, 0.55],
        tilt: 16,
        colors: [0x767006, 0x898704, 0x9d980d, 0x495802],
        colorJitter: 0.08,
        yaw: 'wind',
        blobShadow: false,
      },
      // Plantas de hoja ancha y helechos bajo las palmeras: los verdes
      // oscuros que en la referencia rodean cada tronco y cada sillar.
      {
        id: 'jungle_ferns',
        primitive: 'tuft',
        anchor: 'disc',
        count: 130,
        rMin: 8.8,
        rMax: 11.7,
        clearCenterR: 0,
        clusterCount: 16,
        clusterRadius: 1.2,
        scale: [0.6, 1.15],
        tilt: 14,
        colors: [0x405002, 0x495802, 0x2c3f02, 0x5d7a10],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Raíces y ramas caídas cruzadas sobre el labio, tumbadas en
      // cualquier dirección: lo que muerde el canto de piedra.
      {
        id: 'jungle_fringe_roots',
        primitive: 'log',
        anchor: 'fringe',
        count: 60,
        rMin: 0.1,
        rMax: 0.7,
        clearCenterR: 0,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.28, 0.55],
        tilt: 18,
        colors: [0x654810, 0x7e5a10, 0x49370e],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Helechos que asoman por el labio: la vegetación desborda el borde
      // (lo único de este bioma según DIORAMAS.md §4).
      {
        id: 'jungle_fringe_ferns',
        primitive: 'tuft',
        anchor: 'fringe',
        count: 60,
        rMin: 0.0,
        rMax: 0.6,
        clearCenterR: 0,
        clusterCount: 12,
        clusterRadius: 1.0,
        scale: [0.5, 0.9],
        tilt: 18,
        colors: [0x405002, 0x495802, 0x5d7a10],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Matorrales redondos densos del arco trasero: los que en la
      // referencia rodean el árbol grande y el tótem.
      {
        id: 'jungle_bushes',
        primitive: 'dome',
        anchor: 'disc',
        arc: 'back',
        count: 30,
        rMin: 9.0,
        rMax: 11.4,
        clearCenterR: 0,
        clusterCount: 7,
        clusterRadius: 1.2,
        // 2026-09-07, sobre captura: a 1,4-2,4 u eran pedruscos casi negros
        // que tapaban el canto. Arbusto de verdad: ≤1,3 u y verdes con luz.
        scale: [0.7, 1.2],
        tilt: 8,
        colors: [0x4f7a2a, 0x5c8c34, 0x3f6b24, 0x6a9a3c],
        colorJitter: 0.07,
        yaw: 'random',
        blobShadow: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // FROZEN TUNDRA — "una placa de hielo a la deriva"
  // Referencia: FROZEN TUNDRA.png. Pista de hielo azul pálido agrietada,
  // un anillo exterior de nieve BLANCA con montículos y rocas azul-gris
  // con gorro, racimos de cristales azules al pie de témpanos torcidos,
  // pinos nevados, y un canto de bloques de hielo con rocas al pie.
  // -------------------------------------------------------------------------
  frozen_tundra: {
    // Viento polar que baja de los icebergs del arco trasero (layout:
    // 4,45-4,85 rad, es decir −Z) hacia la cámara, un pelo a la izquierda
    // (dirección (−0,28, +0,96)): los cristales y la nieve se inclinan
    // hacia el jugador y la silueta lee "a la deriva".
    wind: 1.85,
    layers: [
      // Placas de hielo y grietas más claras de la pista central,
      // variaciones del webp de suelo (0xdfe4f1), no de la ilustración.
      {
        id: 'tundra_ice_cracks',
        primitive: 'decal',
        anchor: 'disc',
        count: 110,
        rMin: 2.6,
        rMax: 8.5,
        clearCenterR: 2.6,
        clusterCount: 0,
        clusterRadius: 0,
        // 2026-09-07, sobre captura (dos pases): blancas puras leían como
        // papeles sobre el hielo, y a 0xd8dff0 seguían leyendo igual —el
        // suelo de la tundra renderiza en un gris-azul de L≈146, no blanco.
        // Vetas: el tono del suelo, apenas un punto más claras.
        scale: [0.35, 0.7],
        tilt: 0,
        // Ojo: es color BASE, antes de la luz (key 1,35 + hemi): un decal
        // horizontal a 0,85 satura a blanco puro. Y los "papeles blancos"
        // que se veían en la tundra NO eran esta capa (medido apagando el
        // scatter: mismos 277 píxeles blancos): son las placas claras de la
        // propia TEXTURA de suelo, enormes a 4 u de losa. Tema de arte de la
        // textura, anotado. Aquí, vetas sutiles un punto sobre el suelo.
        colors: [0x8d97a8, 0x98a2b2, 0x81899a],
        colorJitter: 0.04,
        yaw: 'random',
        blobShadow: false,
      },
      // Bolas de nieve y piedrecitas azul-gris sueltas sobre el hielo (la
      // referencia salpica la pista de puntos blancos y grises).
      {
        id: 'tundra_snow_pebbles',
        primitive: 'pebble',
        anchor: 'disc',
        count: 90,
        rMin: 2.8,
        rMax: 9.0,
        clearCenterR: 2.8,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.1, 0.24],
        tilt: 8,
        colors: [0xf2f4fb, 0xdde4fa, 0x556294],
        colorJitter: 0.05,
        yaw: 'random',
        blobShadow: false,
      },
      // La nieve del anillo exterior: en la referencia el borde es blanco
      // y la pista azul, y hoy el disco es del mismo gris-lavanda entero.
      // Manchas grandes en corros que blanquean el anillo sin taparlo.
      {
        id: 'tundra_snow_patches',
        primitive: 'decal',
        anchor: 'disc',
        count: 220,
        rMin: 8.2,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 14,
        clusterRadius: 1.8,
        scale: [0.7, 1.4],
        tilt: 0,
        colors: [0xf2f4fb, 0xeceefb, 0xfafbfe, 0xe6eafc],
        colorJitter: 0.03,
        yaw: 'random',
        blobShadow: false,
      },
      // Montículos de nieve acumulados contra pinos, rocas y témpanos
      // (racimos: la nieve se amontona). Sin sombra: nieve sobre nieve no
      // proyecta una mancha oscura.
      {
        id: 'tundra_snow_mounds',
        primitive: 'dome',
        anchor: 'disc',
        count: 140,
        rMin: 8.5,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 16,
        clusterRadius: 1.4,
        scale: [0.25, 0.6],
        tilt: 6,
        colors: [0xf2f4fb, 0xe6eafc, 0xd4ddf9],
        colorJitter: 0.04,
        yaw: 'random',
        blobShadow: false,
      },
      // Rocas azul-gris con gorro de nieve del anillo exterior (en la
      // referencia son azuladas, no grises neutras).
      {
        id: 'tundra_grey_rocks',
        primitive: 'pebble',
        anchor: 'disc',
        count: 100,
        rMin: 8.6,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 12,
        clusterRadius: 1.2,
        scale: [0.22, 0.55],
        tilt: 14,
        colors: [0x556294, 0x384678, 0x7588ca],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: true,
      },
      // Racimos de cristales de hielo azules al pie de los icebergs: el
      // detalle más repetido de la referencia. Un punto por debajo de la
      // saturación de la ilustración (los critters mandan).
      {
        id: 'tundra_ice_crystals',
        primitive: 'shard',
        anchor: 'disc',
        count: 120,
        rMin: 8.8,
        rMax: 11.7,
        clearCenterR: 0,
        clusterCount: 18,
        clusterRadius: 0.9,
        scale: [0.4, 1.15],
        tilt: 18,
        colors: [0x5a9ada, 0x7ab8ee, 0x9fd0f6, 0x4a86cc],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Bloques de hielo y nieve apilados del canto, con alguna roca
      // azul-gris, asomando por el labio.
      {
        id: 'tundra_fringe_ice_blocks',
        primitive: 'pebble',
        anchor: 'fringe',
        count: 90,
        rMin: 0.0,
        rMax: 0.7,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.1,
        scale: [0.3, 0.8],
        tilt: 16,
        colors: [0x7ea0e5, 0xc9daf7, 0x97d1f8, 0x556294],
        colorJitter: 0.05,
        yaw: 'random',
        blobShadow: false,
      },
      // Témpanos pequeños del arco trasero, torcidos: un témpano recto
      // lee "cubo", uno inclinado lee "hielo a la deriva".
      {
        id: 'tundra_icebergs',
        primitive: 'shard',
        anchor: 'disc',
        arc: 'back',
        count: 30,
        rMin: 9.2,
        rMax: 11.4,
        clearCenterR: 0,
        clusterCount: 7,
        clusterRadius: 1.2,
        scale: [1.5, 2.6],
        tilt: 12,
        colors: [0x478eda, 0x3d80d7, 0x6eacee],
        colorJitter: 0.05,
        yaw: 'random',
        blobShadow: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // DESERT DUNES — "una meseta partida en un cañón"
  // Referencia: DESERT DUNES.png. Arena dorada con ondas, piedrecitas
  // rojas por todas partes, rocas rojas redondeadas en montones al pie de
  // cactus y agujas, hierba seca, agaves verdes, huesos, y un canto de
  // roca roja estratificada en bloques redondeados.
  // -------------------------------------------------------------------------
  desert_dunes: {
    // Viento que cruza la meseta en diagonal, de la bandera y el minecart
    // (layout: 3,55-3,85 rad, atrás-izquierda) hacia las agujas (1,3-1,85
    // rad, delante): dirección (+0,83, +0,56). Las manchas de arena y la
    // hierba seca dibujan líneas que no coinciden con ningún eje de
    // pantalla. Un solo eje para todo el bioma: lo único del desierto
    // según DIORAMAS.md §4 es el viento.
    wind: 0.6,
    layers: [
      // Ondulaciones de arena arrastrada, todas paralelas al viento (eje
      // largo del decal = viento). Variaciones del webp de suelo
      // (0xe5aa44): un punto más clara y un punto más oscura.
      {
        id: 'desert_sand_streaks',
        primitive: 'decal',
        anchor: 'disc',
        count: 130,
        rMin: 2.6,
        rMax: 9.0,
        clearCenterR: 2.6,
        clusterCount: 0,
        clusterRadius: 0,
        // 2026-09-07, sobre captura: naranjas saturados leían como losetas.
        // Rizos de viento: el tono de la arena, un pelo más claro u oscuro.
        scale: [0.5, 1.0],
        tilt: 0,
        colors: [0xd8ae5a, 0xbf9448, 0xe0b866],
        colorJitter: 0.04,
        yaw: 'wind',
        blobShadow: false,
      },
      // Piedrecitas rojas sembradas por toda la pista (la referencia las
      // pone hasta el centro, más finas hacia dentro).
      {
        id: 'desert_red_gravel',
        primitive: 'pebble',
        anchor: 'disc',
        count: 110,
        rMin: 2.8,
        rMax: 9.0,
        clearCenterR: 2.8,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.08, 0.2],
        tilt: 12,
        colors: [0xad4d27, 0xce6232, 0x8d351e],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Costillas y huesos medio enterrados en pilas, como los que rodean
      // la calavera de la referencia (el prop bones_desert pone la
      // calavera; esto pone el resto del esqueleto).
      {
        id: 'desert_bones',
        primitive: 'log',
        anchor: 'disc',
        count: 30,
        rMin: 3.0,
        rMax: 8.5,
        clearCenterR: 3.0,
        clusterCount: 5,
        clusterRadius: 0.9,
        scale: [0.12, 0.22],
        tilt: 6,
        colors: [0xe4dfd3, 0xfcfcfa, 0xd8d0c0],
        colorJitter: 0.03,
        yaw: 'random',
        blobShadow: false,
      },
      // Rocas rojas redondeadas amontonadas en el anillo exterior, al pie
      // de cactus y agujas (montones, como en la referencia).
      {
        id: 'desert_red_rocks',
        primitive: 'pebble',
        anchor: 'disc',
        count: 230,
        rMin: 8.5,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 16,
        clusterRadius: 1.3,
        scale: [0.15, 0.45],
        tilt: 14,
        colors: [0xad4d27, 0xce6232, 0x80351c, 0xda7339],
        colorJitter: 0.07,
        yaw: 'random',
        blobShadow: true,
      },
      // Hierba seca y matojos pardos a sotavento de las rocas.
      {
        id: 'desert_dry_grass',
        primitive: 'grassCross',
        anchor: 'disc',
        count: 150,
        rMin: 8.5,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 14,
        clusterRadius: 1.2,
        scale: [0.3, 0.8],
        tilt: 18,
        colors: [0xb0793b, 0x99602a, 0xc9a25a],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Agaves y cactus jóvenes: los brotes verdes que la referencia
      // planta entre las rocas rojas. Un agave no se peina con el viento,
      // de ahí yaw 'random' y poca inclinación.
      {
        id: 'desert_agaves',
        primitive: 'tuft',
        anchor: 'disc',
        count: 50,
        rMin: 8.8,
        rMax: 11.7,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.0,
        scale: [0.45, 1.0],
        tilt: 10,
        colors: [0x5f8f3a, 0x4f7f34, 0x6f9a5a],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Bloques de roca roja estratificada que sobresalen del canto: el
      // borde de la referencia es un apilado de bloques REDONDEADOS (por
      // eso pebble y no shard) que asoma por encima del labio.
      {
        id: 'desert_fringe_blocks',
        primitive: 'pebble',
        anchor: 'fringe',
        count: 90,
        rMin: 0.0,
        rMax: 0.8,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.1,
        scale: [0.35, 0.85],
        tilt: 16,
        colors: [0xad4d27, 0x8d351e, 0xce6232, 0x5a2f19],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Agujas de roca roja del arco trasero: las torres de la
      // referencia, en pequeño y en racimo.
      {
        id: 'desert_rock_spires',
        primitive: 'shard',
        anchor: 'disc',
        arc: 'back',
        count: 24,
        rMin: 9.2,
        rMax: 11.4,
        clearCenterR: 0,
        clusterCount: 6,
        clusterRadius: 1.3,
        scale: [1.5, 2.6],
        tilt: 10,
        colors: [0xad4d27, 0x8d351e, 0xce6232],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // CORAL BEACH — "un banco de arena en marea baja"
  // Referencia: CORAL REEF BEACH.png. Arena seca con conchas y estrellas
  // sueltas, una línea de marea con restos acumulados, matas amarillo-
  // verdes entre rocas grises mojadas, corales bola rosa/morados, y ramas
  // de coral rojo que salen del canto hacia el agua.
  // -------------------------------------------------------------------------
  coral_beach: {
    // Brisa marina que entra por el arco frontal (donde el jugador ve el
    // mar bajo la isla) y cruza hacia el fondo, un pelo a la derecha:
    // dirección (+0,22, −0,98). Las matas se peinan alejándose de la
    // cámara, como en la referencia.
    wind: -1.35,
    layers: [
      // Conchas y caracolas sueltas en la arena seca del centro.
      {
        id: 'beach_shells_inner',
        primitive: 'pebble',
        anchor: 'disc',
        count: 110,
        rMin: 2.8,
        rMax: 9.0,
        clearCenterR: 2.8,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.08, 0.16],
        tilt: 10,
        colors: [0xf4dcb7, 0xf2eeea, 0xe9b882, 0xd9c8bd],
        colorJitter: 0.04,
        yaw: 'random',
        blobShadow: false,
      },
      // Estrellas de mar naranjas que salpican la arena. Naranja APAGADO
      // a propósito: el naranja vivo es el aviso de colapso.
      {
        id: 'beach_starfish',
        primitive: 'decal',
        anchor: 'disc',
        count: 34,
        rMin: 3.0,
        rMax: 9.5,
        clearCenterR: 3.0,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.22, 0.34],
        tilt: 0,
        colors: [0xcf7f3e, 0xd98b47, 0xc4703a],
        colorJitter: 0.05,
        yaw: 'random',
        blobShadow: false,
      },
      // Conchas, guijarros y restos ACUMULADOS en la línea de marea (con
      // algo de espuma blanca y gris de roca): la marea ordena los restos
      // en racimos, no los reparte.
      {
        id: 'beach_tideline',
        primitive: 'pebble',
        anchor: 'disc',
        count: 260,
        rMin: 8.2,
        rMax: 11.6,
        clearCenterR: 0,
        clusterCount: 14,
        clusterRadius: 1.4,
        scale: [0.1, 0.22],
        tilt: 14,
        colors: [0xf4dcb7, 0xe9b882, 0x8a8765, 0xf2eeea, 0xb16d4d],
        colorJitter: 0.05,
        yaw: 'random',
        blobShadow: false,
      },
      // Matas de hierba de playa y algas amarillo-verdes entre las rocas
      // (los penachos claros que en la referencia crecen en cada hueco).
      {
        id: 'beach_seagrass',
        primitive: 'tuft',
        anchor: 'disc',
        count: 150,
        rMin: 8.8,
        rMax: 11.7,
        clearCenterR: 0,
        clusterCount: 18,
        clusterRadius: 1.2,
        scale: [0.3, 0.7],
        tilt: 16,
        colors: [0xaaa871, 0x508e6b, 0x56674b, 0xc7d1a2],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Corales bola y cerebro (rosa, morado) entre las rocas del borde.
      {
        id: 'beach_coral_domes',
        primitive: 'dome',
        anchor: 'disc',
        count: 45,
        rMin: 9.2,
        rMax: 11.6,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.1,
        scale: [0.35, 0.75],
        tilt: 10,
        colors: [0xd98a9a, 0xc96a80, 0x8f5aa8, 0xd6a0b6],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: true,
      },
      // Rocas grises mojadas del borde, medio en el agua: el anillo de
      // piedra de la referencia que hoy no existe.
      {
        id: 'beach_fringe_rocks',
        primitive: 'pebble',
        anchor: 'fringe',
        count: 60,
        rMin: 0.0,
        rMax: 0.8,
        clearCenterR: 0,
        clusterCount: 9,
        clusterRadius: 1.2,
        scale: [0.4, 0.85],
        tilt: 14,
        colors: [0x68614d, 0x8a8765, 0x414235, 0x7e6c4e],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Ramas de coral rojo y tubos morados que muerden el canto y asoman
      // al agua (lo único de este bioma: el borde es agua).
      {
        id: 'beach_fringe_coral',
        primitive: 'shard',
        anchor: 'fringe',
        count: 60,
        rMin: 0.05,
        rMax: 0.7,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.0,
        scale: [0.4, 0.9],
        tilt: 18,
        colors: [0xb8453e, 0xa63a35, 0xc45850, 0x8f5aa8],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Abanicos de coral rojo grandes del arco trasero, en racimo.
      {
        id: 'beach_coral_fans',
        primitive: 'shard',
        anchor: 'disc',
        arc: 'back',
        count: 24,
        rMin: 9.5,
        rMax: 11.4,
        clearCenterR: 0,
        clusterCount: 6,
        clusterRadius: 1.3,
        scale: [1.5, 2.4],
        tilt: 12,
        colors: [0xb8453e, 0xa63a35, 0xc45850],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // KITSUNE SHRINE — "el patio de un santuario en la niebla, con pétalos"
  // Referencia: KITSUNE SHRINE.png. Losas tostadas con musgo en las
  // juntas, pétalos de sakura por TODO el empedrado, hierba y musgo entre
  // las piedras del anillo exterior, bambú entre las linternas, azaleas
  // en flor, y un canto de piedra musgosa apilada con el musgo colgando.
  // -------------------------------------------------------------------------
  kitsune_shrine: {
    // De la sakura (layout: 4,71 rad, es decir −Z, al fondo) hacia el
    // patio y la cámara, un pelo a la derecha: dirección (+0,32, +0,95).
    // Los corros de pétalos cruzan el empedrado en la dirección en que
    // caen de verdad desde el árbol.
    wind: 1.25,
    layers: [
      // Pétalos de sakura sobre el empedrado, en corros a sotavento.
      {
        id: 'shrine_petals_inner',
        primitive: 'decal',
        anchor: 'disc',
        count: 180,
        rMin: 2.6,
        rMax: 9.0,
        clearCenterR: 2.6,
        clusterCount: 10,
        clusterRadius: 1.6,
        scale: [0.12, 0.2],
        tilt: 0,
        colors: [0xe7beac, 0xd99e8f, 0xf2a6c4, 0xf5c3d3],
        colorJitter: 0.04,
        yaw: 'wind',
        blobShadow: false,
      },
      // Musgo en las juntas de las losas (verde apagado, a ras).
      {
        id: 'shrine_moss_joints',
        primitive: 'decal',
        anchor: 'disc',
        count: 100,
        rMin: 3.0,
        rMax: 9.0,
        clearCenterR: 3.0,
        clusterCount: 0,
        clusterRadius: 0,
        scale: [0.25, 0.5],
        tilt: 0,
        colors: [0x6a7f3a, 0x58702e, 0x7d8f48],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Pétalos acumulados contra linternas, bambúes y el labio.
      {
        id: 'shrine_petals_outer',
        primitive: 'decal',
        anchor: 'disc',
        count: 150,
        rMin: 8.5,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 12,
        clusterRadius: 1.3,
        scale: [0.12, 0.2],
        tilt: 0,
        colors: [0xe7beac, 0xd99e8f, 0xf2a6c4, 0xf5c3d3],
        colorJitter: 0.04,
        yaw: 'wind',
        blobShadow: false,
      },
      // Hierba corta y musgo que asoma entre las piedras del anillo
      // exterior (la referencia no tiene grava: tiene verde entre losas).
      {
        id: 'shrine_moss_tufts',
        primitive: 'grassCross',
        anchor: 'disc',
        count: 170,
        rMin: 8.3,
        rMax: 11.8,
        clearCenterR: 0,
        clusterCount: 14,
        clusterRadius: 1.3,
        scale: [0.15, 0.3],
        tilt: 12,
        colors: [0x6a7f3a, 0x58702e, 0x8a9a4e],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Brotes de bambú al pie de los bambúes y entre las linternas.
      {
        id: 'shrine_bamboo_shoots',
        primitive: 'grassCross',
        anchor: 'disc',
        count: 120,
        rMin: 8.8,
        rMax: 11.7,
        clearCenterR: 0,
        clusterCount: 12,
        clusterRadius: 1.0,
        scale: [0.5, 1.1],
        tilt: 10,
        colors: [0x5a8a3a, 0x7aa848, 0x4a7a30],
        colorJitter: 0.07,
        yaw: 'wind',
        blobShadow: false,
      },
      // Piedras musgosas apiladas del canto asomando por el labio: la
      // muralla de piedra de la referencia.
      {
        id: 'shrine_fringe_moss_rocks',
        primitive: 'pebble',
        anchor: 'fringe',
        count: 70,
        rMin: 0.05,
        rMax: 0.7,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.0,
        scale: [0.3, 0.7],
        tilt: 14,
        colors: [0x947564, 0x756446, 0x806c52, 0x6a7f3a],
        colorJitter: 0.06,
        yaw: 'random',
        blobShadow: false,
      },
      // Musgo y hierba que cuelga por el labio de piedra (en la
      // referencia el verde desborda el canto por todo el perímetro).
      {
        id: 'shrine_fringe_moss',
        primitive: 'tuft',
        anchor: 'fringe',
        count: 50,
        rMin: 0.0,
        rMax: 0.5,
        clearCenterR: 0,
        clusterCount: 10,
        clusterRadius: 1.0,
        scale: [0.22, 0.45],
        tilt: 18,
        colors: [0x6a7f3a, 0x58702e, 0x8a9a4e],
        colorJitter: 0.06,
        yaw: 'wind',
        blobShadow: false,
      },
      // Matorrales de azalea del arco trasero, alguno en flor rosa o
      // morada (las matas floridas de las esquinas de la referencia).
      {
        id: 'shrine_azaleas',
        primitive: 'dome',
        anchor: 'disc',
        arc: 'back',
        count: 26,
        rMin: 9.0,
        rMax: 11.4,
        clearCenterR: 0,
        clusterCount: 6,
        clusterRadius: 1.2,
        // 2026-09-07, sobre captura: a 1,3-2,2 u leían como rocas moradas
        // gigantes. Mata de azalea: ≤1,1 u, verdes y rosas con luz.
        scale: [0.6, 1.1],
        tilt: 8,
        colors: [0x6a9a48, 0x7fae56, 0xc27a99, 0x9b86b8],
        colorJitter: 0.07,
        yaw: 'random',
        blobShadow: true,
      },
    ],
  },
};

/** Receta del bioma. El Record es exhaustivo sobre ArenaPackId, así que
 *  no hay fallback que inventar: cada pack tiene la suya. */
export function getScatterRecipe(packId: ArenaPackId): ScatterRecipe {
  return SCATTER_RECIPES[packId];
}
