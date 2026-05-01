// ---------------------------------------------------------------------------
// Belt 3D viewer modal — click a belt slot, see it big and rotating
// ---------------------------------------------------------------------------
//
// 2026-05-01 final block — answers Rafa's "click to see the belt close-up"
// ask. Lazy-init the modal DOM on first open so the renderer/scene only
// exist when the user actually wants the viewer (no boot-time overhead).
// One render loop runs while the modal is open; closing disposes the
// loop + the GLB scene graph but keeps the WebGL renderer alive for
// the next open.
//
// Public surface:
//   openBeltViewer(beltId, displayName, description?)
//   closeBeltViewer()
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loadModel } from './model-loader';

let modalEl: HTMLDivElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let titleEl: HTMLDivElement | null = null;
let descEl: HTMLDivElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let holder: THREE.Group | null = null;
let currentGlb: THREE.Group | null = null;
let rafHandle = 0;
let dragging = false;
let dragStartX = 0;
let dragStartRotY = 0;

function ensureDom(): void {
  if (modalEl) return;
  const root = document.createElement('div');
  root.id = 'belt-viewer-modal';
  root.className = 'belt-viewer-modal hidden';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="belt-viewer-backdrop" data-bv-close="1"></div>
    <div class="belt-viewer-panel" role="dialog" aria-label="Belt preview">
      <button class="belt-viewer-close" aria-label="Close" data-bv-close="1">&times;</button>
      <canvas class="belt-viewer-canvas" width="640" height="640"></canvas>
      <div class="belt-viewer-title"></div>
      <div class="belt-viewer-desc"></div>
      <div class="belt-viewer-hint">Drag to rotate · click outside to close</div>
    </div>
  `;
  document.body.appendChild(root);

  modalEl = root;
  canvasEl = root.querySelector('canvas.belt-viewer-canvas');
  titleEl = root.querySelector('.belt-viewer-title');
  descEl = root.querySelector('.belt-viewer-desc');

  // Click/tap on the backdrop or the close button → close.
  root.addEventListener('click', (e) => {
    const tgt = e.target as HTMLElement | null;
    if (tgt?.dataset.bvClose === '1') closeBeltViewer();
  });

  // Drag-to-rotate on the canvas (mouse + touch).
  if (canvasEl) {
    const onDown = (clientX: number) => {
      if (!currentGlb) return;
      dragging = true;
      dragStartX = clientX;
      dragStartRotY = currentGlb.rotation.y;
    };
    const onMove = (clientX: number) => {
      if (!dragging || !currentGlb || !canvasEl) return;
      const delta = (clientX - dragStartX) / canvasEl.clientWidth;
      currentGlb.rotation.y = dragStartRotY + delta * Math.PI * 2;
    };
    const onUp = () => { dragging = false; };
    canvasEl.addEventListener('mousedown', (e) => onDown(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onUp);
    canvasEl.addEventListener('touchstart', (e) => onDown(e.touches[0]?.clientX ?? 0), { passive: true });
    canvasEl.addEventListener('touchmove', (e) => onMove(e.touches[0]?.clientX ?? 0), { passive: true });
    canvasEl.addEventListener('touchend', onUp);
  }

  // Esc closes.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.classList.contains('hidden')) {
      e.preventDefault();
      closeBeltViewer();
    }
  });
}

function ensureRenderer(): void {
  if (renderer || !canvasEl) return;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(640, 640, false);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
  camera.position.set(0, 0.6, 3.4);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffe8b8, 1.6);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.55);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  holder = new THREE.Group();
  scene.add(holder);
}

function disposeCurrentGlb(): void {
  if (!holder || !currentGlb) return;
  holder.remove(currentGlb);
  currentGlb.traverse((n) => {
    if (n instanceof THREE.Mesh) {
      n.geometry?.dispose();
      const m = n.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) (m as THREE.Material).dispose();
    }
  });
  currentGlb = null;
}

function loop(): void {
  rafHandle = requestAnimationFrame(loop);
  if (!renderer || !scene || !camera || !currentGlb) return;
  // Idle auto-rotate when the user isn't dragging.
  if (!dragging) currentGlb.rotation.y += 0.005;
  renderer.render(scene, camera);
}

export async function openBeltViewer(
  beltId: string,
  displayName: string,
  description?: string,
): Promise<void> {
  ensureDom();
  ensureRenderer();
  if (!modalEl || !holder || !titleEl || !descEl) return;

  modalEl.classList.remove('hidden');
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('belt-viewer-open');
  titleEl.textContent = displayName;
  descEl.textContent = description ?? '';

  disposeCurrentGlb();

  try {
    const glb = await loadModel(`./models/belts/${beltId}.glb`);
    glb.position.set(0, 0, 0);
    glb.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(glb);
    const size = bbox.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z);
    if (maxAxis > 0.001) glb.scale.setScalar(1.7 / maxAxis);
    glb.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(glb).getCenter(new THREE.Vector3());
    glb.position.set(-c.x, -c.y + 0.05, -c.z);
    holder.add(glb);
    currentGlb = glb;
  } catch (e) {
    console.warn('[belt-viewer] failed to load', beltId, e);
    descEl.textContent = '(model failed to load — view artwork in the grid)';
  }

  if (rafHandle === 0) loop();
}

export function closeBeltViewer(): void {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('belt-viewer-open');
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = 0;
  }
  disposeCurrentGlb();
}
