// ---------------------------------------------------------------------------
// lab-kit — shared browser helpers for the internal labs (H3 slice 5)
// ---------------------------------------------------------------------------
//
// Extracted from the byte-identical copies in src/animlab/main.ts and
// src/calibrate/main.ts. Everything here returns a `dispose()` — that
// is the teardown contract the studio shell (slice 6) relies on to
// mount/unmount labs without leaking listeners.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Orbit camera (drag + wheel zoom) — spherical coords around a target
// ---------------------------------------------------------------------------

export interface OrbitCameraOptions {
  theta?: number;
  phi?: number;
  radius?: number;
  minRadius: number;
  maxRadius: number;
  /** Orbit centre. Defaults to (0, 1, 0) — both labs look at torso height. */
  target?: THREE.Vector3;
}

export interface OrbitCamera {
  /** Recompute the camera position from the current spherical coords. */
  update(): void;
  /** Jump to a named viewpoint (camera presets). */
  set(theta: number, phi: number, radius: number): void;
  readonly target: THREE.Vector3;
  dispose(): void;
}

export function createOrbitCamera(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  opts: OrbitCameraOptions,
): OrbitCamera {
  let theta = opts.theta ?? 0;
  let phi = opts.phi ?? 0.35;
  let radius = opts.radius ?? (opts.minRadius + opts.maxRadius) / 2;
  const target = opts.target ?? new THREE.Vector3(0, 1, 0);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (ev: PointerEvent) => {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (!dragging) return;
    theta -= (ev.clientX - lastX) * 0.005;
    phi = Math.max(0.05, Math.min(1.35, phi + (ev.clientY - lastY) * 0.003));
    lastX = ev.clientX;
    lastY = ev.clientY;
    update();
  };
  const onPointerUp = (ev: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture(ev.pointerId);
  };
  const onWheel = (ev: WheelEvent) => {
    radius = Math.max(opts.minRadius, Math.min(opts.maxRadius, radius + ev.deltaY * 0.01));
    ev.preventDefault();
    update();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function update(): void {
    const y = radius * Math.sin(phi);
    const r = radius * Math.cos(phi);
    camera.position.set(
      target.x + r * Math.sin(theta),
      target.y + y,
      target.z + r * Math.cos(theta),
    );
    camera.lookAt(target);
  }

  update();

  return {
    update,
    set(t, p, r) { theta = t; phi = p; radius = r; update(); },
    target,
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}

// ---------------------------------------------------------------------------
// Viewport resize — canvas between fixed panels
// ---------------------------------------------------------------------------

export interface LabResizeOptions {
  /** Fixed panel widths flanking the canvas (px). */
  left?: number;
  right?: number;
  /** Banner height (px). */
  top?: number;
  /** Floor for the canvas size so a tiny window can't zero it out. */
  minSize?: number;
}

export interface LabResize {
  resize(): void;
  dispose(): void;
}

export function createLabResize(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  opts: LabResizeOptions,
): LabResize {
  const leftW = opts.left ?? 0;
  const rightW = opts.right ?? 0;
  const topH = opts.top ?? 40;
  const min = opts.minSize ?? 200;

  function resize(): void {
    const w = window.innerWidth - leftW - rightW;
    const h = window.innerHeight - topH;
    renderer.setSize(Math.max(min, w), Math.max(min, h), false);
    canvas.style.position = 'fixed';
    canvas.style.top = `${topH}px`;
    canvas.style.left = `${leftW}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    resize,
    dispose() { window.removeEventListener('resize', resize); },
  };
}

// ---------------------------------------------------------------------------
// escapeHtml — the third copy dies here
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
