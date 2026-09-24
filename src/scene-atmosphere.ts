// ---------------------------------------------------------------------------
// scene-atmosphere — shared scene look: clear colour, fog, lights, skybox
// ---------------------------------------------------------------------------
//
// H3 slice 7. Extracted from src/main.ts for two reasons:
//
//   1. PARITY — /tools.html (match lab) rendered with a pre-rework
//      dark-void fog + flat AmbientLight while the game ships the
//      "high-altitude golden hour" rig (hemisphere + warm key + cool
//      rim + sky fog + per-pack skybox). What you tuned in the lab was
//      not what production rendered. Both entries now call
//      `initSceneAtmosphere` and get the exact same look, including
//      the per-pack skybox pipeline.
//
//   2. CYCLE BREAK — arena.ts imported `setSceneSkyboxTexture` /
//      `setSceneFogColor` FROM src/main.ts, so ANY entry that touched
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
import { ARENA_LOOK } from './arena-look';
import { setArenaTextureAnisotropy } from './arena-decorations';
import { applyGameplayCameraPose, type CameraPose } from './camera';

const DEFAULT_FOG_COLOR = 0xb6d1e8;
const DEFAULT_CLEAR_COLOR = 0x87b0d8;
/** Hemisferio de siempre (cielo cian, suelo tierra). El fondo v2 cambia el
 *  suelo por el rebote del cielo de abajo, por pack (`setSceneHemiGround`). */
const DEFAULT_HEMI_SKY = 0x9cc7ea;
const DEFAULT_HEMI_GROUND = 0x4a3a26;
const DEFAULT_HEMI_INTENSITY = 0.55;

let boundScene: THREE.Scene | null = null;
let boundRenderer: THREE.WebGLRenderer | null = null;
let hemi: THREE.HemisphereLight | null = null;
let cameraOverride: CameraPose | null = null;
let restoreGameplayPose = false;

/**
 * Apply the game's canonical atmosphere to a scene + renderer and bind
 * them as the target for the skybox/fog setters below.
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
  // `toneMapped` (los 9 critters, el selector de personaje, el lab) y el
  // skybox no se tone-mapea, así que cambiaría el contraste de la escena
  // entera. Vive tras `ARENA_LOOK.toneMapping` para poder compararlo con
  // el roster delante.
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
  const key = new THREE.DirectionalLight(0xfff1d4, 1.35);
  key.position.set(-11, 17, 13);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.bias = -0.002;
  key.shadow.radius = 2.5;   // borde suave sin PCFSoft (deprecado en r185)
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9fb4e8, 0.55);
  rim.position.set(-10, 14, -14);
  scene.add(rim);
}

/**
 * Bind the pack's equirect panorama as the scene background, or pass
 * `null` to drop it (menu / no-pack state). Three.js renders this in
 * its built-in skybox pass — guaranteed full-screen coverage, no
 * mesh / depth / transparency stack to worry about.
 *
 * Caller is responsible for ensuring `tex.mapping ===
 * THREE.EquirectangularReflectionMapping` (set in
 * `loadPackSkyboxTexture` so we never have to think about it here).
 */
export function setSceneSkyboxTexture(tex: THREE.Texture | null): void {
  if (!boundScene) return; // entry hasn't initialised its atmosphere yet
  if (tex) {
    if (tex.mapping !== THREE.EquirectangularReflectionMapping) {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
    }
    boundScene.background = tex;
  } else {
    boundScene.background = null;
  }
}

/**
 * Retune the global fog colour. FogExp2 uses a Color, so we mutate it in
 * place (no Scene re-assignment needed). Pass `null` to restore the
 * default menu-time horizon colour. Also tints the clear colour so the
 * 1-frame gap before the skybox paints isn't jarring.
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
