// ---------------------------------------------------------------------------
// Scatter — contrato de datos de la capa densa del diorama
// ---------------------------------------------------------------------------
//
// docs/DIORAMAS.md parte 2. Objetivo visual: las cinco referencias de Rafa
// en resources/Terrenos/*/<NOMBRE EN MAYÚSCULAS>.png — un anillo perimetral
// CARGADO en capas (alto / medio / bajo / rasante), un centro LIMPIO donde
// se juega, un canto con masa, y detalle rasante (conchas, pétalos,
// guijarros, hierba) que hace que todo parezca crecido del suelo y no
// colocado encima.
//
// Este fichero solo define TIPOS. Las recetas por bioma viven en
// arena-scatter-recipes.ts (hoja de números), las primitivas en
// arena-scatter-geometry.ts (geometría pura, cero bytes de payload) y el
// motor en arena-scatter.ts (InstancedMesh por capa, determinista por
// semilla, caída por fragmento).
//
// Reglas que no se negocian (medidas en el diagnóstico):
//   - Gameplay manda: nada de esto colisiona ni entra en isOnArena.
//   - En el interior (r < 8,5) solo cabe altura ≤ 0,4 u sin ensuciar la
//     lectura del critter (1,7 u); en el arco frontal del borde, ≤ 1,2 u.
//   - Todo cae con su fragmento: cada instancia sabe qué fragmento la
//     hospeda (findFragmentAt) y se recompone su matriz cuando ese sector
//     colapsa.
//   - Determinista: mulberry32(seed ^ SALT_SCATTER ^ hash(layer.id)). Un
//     stream por capa, para poder tocar una sin reorganizar las demás.
//   - Prohibido emisivo y saturación alta: el naranja del aviso de
//     colapso es INFORMACIÓN de gameplay, no decorado.
// ---------------------------------------------------------------------------

/** Primitivas generadas por código. Altura normalizada a 1 u, base en y=0,
 *  centradas en el origen del plano XZ. La receta las escala. */
export type ScatterPrimitive =
  | 'grassCross'   // dos quads cruzados (hierba, algas, hierba seca): 4 tris
  | 'tuft'         // tres quads en abanico (mata, helecho pequeño): 6 tris
  | 'pebble'       // icosaedro achatado (guijarro, concha, huevo de nieve): 20 tris
  | 'dome'         // semiesfera baja (arbusto, montón de nieve, coral bola): 36 tris
  | 'shard'        // prisma afilado (cristal de hielo, roca puntiaguda, coral rama): 8 tris
  | 'decal'        // quad plano a ras (pétalo, hoja, mancha, charco): 2 tris
  | 'log';         // cilindro tumbado (tronco, rama, hueso): 16 tris

/** Cómo se orienta cada instancia en Y. */
export type ScatterYaw = 'random' | 'toCenter' | 'wind';

/** Dónde se coloca la capa respecto a la geometría del disco. */
export type ScatterAnchor =
  | 'disc'     // sobre la tapa, en la banda radial [rMin, rMax]
  | 'fringe';  // pegada al arco EXTERIOR de cada fragmento vivo (el borde
               // vestido: cuando un sector cae, el siguiente ya tiene su
               // franja). rMin/rMax se interpretan como offset hacia dentro.

export interface ScatterLayer {
  /** Identificador estable: sala la semilla y nombra el InstancedMesh. */
  id: string;
  primitive: ScatterPrimitive;
  anchor: ScatterAnchor;
  /** Arco del disco donde se coloca la capa. 'back' = solo la mitad que
   *  NO da a la cámara (z < 0): es donde caben los acentos altos sin
   *  tapar la acción. Sin él, el motor recortaba esas piezas al techo
   *  frontal y salían como arbustos enanos (review M1). Opcional y
   *  aditivo: las capas sin `arc` se reparten por todo el disco. */
  arc?: 'any' | 'back';
  /** Instancias objetivo ANTES de multiplicar por SCATTER_DENSITY. */
  count: number;
  /** Banda radial (u de mundo) para 'disc'; profundidad de franja para 'fringe'. */
  rMin: number;
  rMax: number;
  /** Radio libre alrededor del centro: por debajo no se coloca nada. */
  clearCenterR: number;
  /** Racimos: si clusterCount > 0, las instancias se agrupan alrededor de
   *  clusterCount centros con radio clusterRadius (Poisson aproximado).
   *  0 = reparto uniforme con jitter. */
  clusterCount: number;
  clusterRadius: number;
  /** Escala [min, max] sobre la primitiva de 1 u. La ALTURA resultante
   *  (scale × 1 u) debe respetar los techos de gameplay: el motor
   *  recorta y avisa en consola si una receta se pasa. */
  scale: [number, number];
  /** Inclinación máxima en grados (±). Lo que más rompe el clonado. */
  tilt: number;
  /** Paleta: cada instancia coge un color y lo perturba ±colorJitter. */
  colors: number[];
  colorJitter: number;
  yaw: ScatterYaw;
  /** Sombra de contacto instanciada bajo cada elemento (solo tiene
   *  sentido en primitivas con volumen: dome, pebble, shard, log). */
  blobShadow: boolean;
}

export interface ScatterRecipe {
  /** Eje de viento único del bioma (rad, convención atan2: 0 = +X). Lo
   *  usan yaw:'wind' y la inclinación de hierba y matas. */
  wind: number;
  layers: ScatterLayer[];
}

/** Techos de gameplay que el motor hace cumplir (u de mundo). */
export const SCATTER_LIMITS = {
  /** Radio del disco jugable — se lee del layout, esto es solo el techo
   *  de diseño para las recetas. */
  arenaRadius: 12,
  /** Interior: por debajo de este radio la altura máxima es innerMaxH. */
  innerR: 8.5,
  innerMaxH: 0.4,
  /** Borde frontal (arco que da a la cámara): altura máxima. */
  frontMaxH: 1.2,
  /** Borde trasero: altura máxima (silueta contra el fondo, no tapa). */
  backMaxH: 2.6,
} as const;

/** Un solo número para afinar toda la capa sin tocar siete recetas. */
export const SCATTER_DENSITY = 0.5;

/** Sal del stream de scatter — hermana de SALT_VISUAL en arena-look.ts. */
export const SALT_SCATTER = 0x5c4f_3a11;
