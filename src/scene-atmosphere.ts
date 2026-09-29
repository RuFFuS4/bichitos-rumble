// ---------------------------------------------------------------------------
// scene-atmosphere — shared scene look: clear colour, fog, lights
// ---------------------------------------------------------------------------
//
// H3 slice 7. Extracted from src/main.ts for two reasons:
//
//   1. PARITY — /tools.html (match lab) rendered with a pre-rework
//      dark-void fog + flat AmbientLight while the game ships the
//      "high-altitude golden hour" rig (hemisphere + warm key + cool
//      rim + sky fog + per-pack sky). What you tuned in the lab was
//      not what production rendered. Both entries now call
//      `initSceneAtmosphere` and get the exact same look. (Entonces el
//      cielo era una foto por pack en `scene.background`; desde la F4 del
//      fondo v2 es la cúpula de `arena-backdrop.ts`.)
//
//   2. CYCLE BREAK — arena.ts imported the sky/fog setters (then
//      `setSceneSkyboxTexture`) FROM src/main.ts, so ANY entry that touched
//      arena code (the lab imports Game → … → arena.ts) transitively
//      executed main.ts's module side effects: a second renderer, a
//      second `new Game`, a second rAF loop and a hard dependency on
//      index.html's DOM ids. The setters now live here, main.ts keeps
//      zero importers, and the lab boots exactly one game.
//
// The setters act on the scene/renderer registered by
// `initSceneAtmosphere` — a module singleton, which is correct because
// each browser context (page or studio iframe) boots exactly one entry.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  ARENA_LOOK, LEGACY_KEY_POSITION, LEGACY_LIGHT, LEGACY_RIM_POSITION, keyIntensityOf, lightDirection,
  LOOK_REF_RADIUS, type PackLight,
} from './arena-look';
import { setArenaTextureAnisotropy } from './arena-decorations';
import { applyGameplayCameraPose, type CameraPose } from './camera';

const DEFAULT_FOG_COLOR = 0xb6d1e8;
const DEFAULT_CLEAR_COLOR = 0x87b0d8;
/** Hemisferio de siempre (cielo cian, suelo tierra). El fondo v2 cambia el
 *  suelo por el rebote del cielo de abajo, por pack (`setSceneHemiGround`). */
const DEFAULT_HEMI_SKY = 0x9cc7ea;
const DEFAULT_HEMI_GROUND = 0x4a3a26;
const DEFAULT_HEMI_INTENSITY = 0.55;

/** Distancia de la key y la rim al origen (u), las de la luz de siempre.
 *  La de la key cuenta: su cámara de sombra (near 5, far 60, ±(R + 6) u)
 *  va desde ahí. */
const KEY_DISTANCE = Math.hypot(...LEGACY_KEY_POSITION);
const RIM_DISTANCE = Math.hypot(...LEGACY_RIM_POSITION);

let boundScene: THREE.Scene | null = null;
let boundRenderer: THREE.WebGLRenderer | null = null;
let hemi: THREE.HemisphereLight | null = null;
let key: THREE.DirectionalLight | null = null;
let rim: THREE.DirectionalLight | null = null;
/** Margen (u) del frustum de la sombra de la key sobre el radio del disco:
 *  ±(R + 6), ±18 con el disco de hoy (fase 5 de ARENA_V2). */
const KEY_SHADOW_MARGIN = 6;
/** Radio al que está ajustado ese frustum ahora mismo. */
let shadowRadius = LOOK_REF_RADIUS;
let cameraOverride: CameraPose | null = null;
let restoreGameplayPose = false;

/**
 * Apply the game's canonical atmosphere to a scene + renderer and bind
 * them as the target for the fog / clear colour / light setters below.
 *
 *   · clear colour: sky blue (fallback before the skydome paints)
 *   · FogExp2 keyed to the horizon colour, density 0.008
 *   · hemisphere ambient (cyan sky / warm ground)
 *   · warm key light with the arena-sized shadow frustum
 *   · cool rim backlight (no shadows — cost we don't need)
 */
export function initSceneAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  boundScene = scene;
  boundRenderer = renderer;

  renderer.setClearColor(DEFAULT_CLEAR_COLOR);
  scene.fog = new THREE.FogExp2(DEFAULT_FOG_COLOR, 0.008);

  // Terreno v2 fase 1: sombras suaves y anisotropía de las texturas de
  // suelo. El tone mapping NO se activa aquí: afecta a TODO material
  // `toneMapped` (los 9 critters, el selector de personaje, el lab, la
  // cúpula del cielo), así que cambiaría el contraste de la escena entera.
  // Vive tras `ARENA_LOOK.toneMapping` para poder compararlo con el
  // roster delante.
  // (PCFSoftShadowMap está deprecado en three r185 — el renderer avisa y
  // cae a PCFShadowMap; el suavizado se pide con `shadow.radius`.)
  setArenaTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
  if (ARENA_LOOK.toneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ARENA_LOOK.exposure;
  }

  hemi = new THREE.HemisphereLight(DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY);
  scene.add(hemi);

  // Pose forzada para capturas (`setCameraPoseOverride`). Va en el hook de
  // la escena, que three llama antes de calcular el frustum, para no tocar
  // los bucles de main.ts / tools/main.ts. Hace falta updateMatrixWorld:
  // las matrices del frame ya se calcularon antes de este hook.
  scene.onBeforeRender = (_r, _s, camera) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (cameraOverride) {
      camera.position.set(...cameraOverride.position);
      camera.up.set(0, 1, 0);
      camera.lookAt(...cameraOverride.lookAt);
      camera.updateMatrixWorld();
    } else if (restoreGameplayPose) {
      // El bucle solo reescribe la POSICIÓN cada frame; la orientación del
      // override se quedaría pegada sin esto.
      applyGameplayCameraPose(camera);
      camera.updateMatrixWorld();
      restoreGameplayPose = false;
    }
  };

  // Key con más componente LATERAL que antes (8,25,12 → elevación 60°,
  // casi cenital: aplastaba el relieve y dejaba las paredes del canto sin
  // gradiente). Bajarla da sombra larga y separa tapa de acantilado.
  // Arranca con la luz de siempre (LEGACY_LIGHT); cada bioma pone la suya
  // con `setSceneLighting` (fondo v2, F3).
  key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 60;
  fitKeyShadow(key, shadowRadius);
  key.shadow.bias = -0.002;
  key.shadow.radius = 2.5;   // borde suave sin PCFSoft (deprecado en r185)
  scene.add(key);

  rim = new THREE.DirectionalLight();
  scene.add(rim);
  setSceneLighting(null);
}

/** Frustum ortográfico de la sombra de la key: el disco y su margen. */
function fitKeyShadow(light: THREE.DirectionalLight, radius: number): void {
  const e = radius + KEY_SHADOW_MARGIN;
  light.shadow.camera.left = -e;
  light.shadow.camera.right = e;
  light.shadow.camera.top = e;
  light.shadow.camera.bottom = -e;
}

/**
 * Ajusta el frustum de la sombra al radio del disco (lo llama la arena al
 * construir el layout). Con el radio que ya tiene no hace nada: el disco
 * de hoy nunca lo toca. El mapa sigue en 1024²; el plan pide 2048² en
 * escritorio si R > 14, y eso se decide midiendo con el perfil 8P (H6).
 */
export function setSceneShadowRadius(radius: number): void {
  if (!key || radius === shadowRadius) return;
  shadowRadius = radius;
  fitKeyShadow(key, radius);
  key.shadow.camera.updateProjectionMatrix();
}

/**
 * Luz del bioma (fondo v2, F3): rumbo, altura, color e intensidad de la key
 * y la rim. `null` vuelve a la de siempre (menús y el A/B de
 * `BACKDROP_LOOK.legacyLight`). La altura la acota `lightDirection` (5-89°)
 * y la intensidad de la key sale de `keyIntensityOf`. Afecta a los bichos
 * (nota en el buzón de PERSONAJES, 2026-09-29).
 */
export function setSceneLighting(light: PackLight | null): void {
  if (!key || !rim) return;
  const l = light ?? LEGACY_LIGHT;
  const [kx, ky, kz] = lightDirection(l.keyAzimuthDeg, l.keyElevationDeg);
  key.position.set(kx * KEY_DISTANCE, ky * KEY_DISTANCE, kz * KEY_DISTANCE);
  key.color.setHex(l.keyColor);
  key.intensity = keyIntensityOf(l);
  const [rx, ry, rz] = lightDirection(l.rimAzimuthDeg, l.rimElevationDeg);
  rim.position.set(rx * RIM_DISTANCE, ry * RIM_DISTANCE, rz * RIM_DISTANCE);
  rim.color.setHex(l.rimColor);
  rim.intensity = l.rimIntensity;
}

/**
 * Retune the global fog colour. FogExp2 uses a Color, so we mutate it in
 * place (no Scene re-assignment needed). Pass `null` to restore the
 * default menu-time horizon colour. Also tints the clear colour; with a
 * pack, `Arena.applyBackdrop` then sets it to the pit colour
 * (`setSceneClearColor`), so a frame without sky never flashes light.
 */
export function setSceneFogColor(color: number | null): void {
  if (!boundScene || !boundRenderer) return;
  const target = color ?? DEFAULT_FOG_COLOR;
  if (boundScene.fog && 'color' in boundScene.fog) {
    (boundScene.fog as THREE.FogExp2).color.setHex(target);
  }
  boundRenderer.setClearColor(color ?? DEFAULT_CLEAR_COLOR);
}

/**
 * Suelo del hemisferio: el rebote de luz que viene de abajo. En el fondo
 * v2 debajo hay cielo iluminado, no tierra, y es lo único que ilumina la
 * panza del cono (mira 51° hacia abajo: ni la key ni la rim la tocan).
 * `null` vuelve al de siempre. Afecta también a la parte de abajo de los
 * bichos (nota en el buzón de PERSONAJES).
 */
export function setSceneHemiGround(color: number | null, intensity?: number): void {
  if (!hemi) return;
  hemi.groundColor.setHex(color ?? DEFAULT_HEMI_GROUND);
  hemi.intensity = color === null ? DEFAULT_HEMI_INTENSITY : (intensity ?? DEFAULT_HEMI_INTENSITY);
}

/**
 * Color de limpiado. El fondo v2 lo pone al del pozo para que un frame sin
 * fondo nunca salga claro. Llamar DESPUÉS de `setSceneFogColor`, que lo
 * reescribe con el color de niebla.
 */
export function setSceneClearColor(color: number | null): void {
  boundRenderer?.setClearColor(color ?? DEFAULT_CLEAR_COLOR);
}

/**
 * Fuerza una pose de cámara en todos los frames (capturas de las poses de
 * fin de partida y de la pose baja sin jugar una partida entera). `null`
 * la suelta y devuelve la cámara a la pose de juego.
 */
export function setCameraPoseOverride(pose: CameraPose | null): void {
  if (!pose && cameraOverride) restoreGameplayPose = true;
  cameraOverride = pose;
}
