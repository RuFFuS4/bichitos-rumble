// ---------------------------------------------------------------------------
// Decor Editor — `/decor-editor.html`
// ---------------------------------------------------------------------------
//
// MVP visual editor for in-arena decoration placements. Reads the current
// layout from arena-decor-layouts.ts, renders it top-down, and lets the
// user click to place / select / adjust / delete props. Final step:
// "Copy snippet" → paste into arena-decor-layouts.ts.
//
// Sibling of /calibrate.html (roster) and /anim-lab.html (clips). All
// three pages share the same lab pattern: standalone HTML entry, no
// Colyseus, no HUD, no physics. Just a focused tool.
//
// Scope (deliberately minimal — no overengineering):
//   · top-down ortho camera
//   · arena radii circles drawn as wireframes for reference
//   · click on empty space = add placement (with currently-selected type)
//   · click on a prop disc = select that placement
//   · sliders for r / angle / rotY / scale + type select for the chosen
//   · Delete key or button removes selected
//   · Export writes a TypeScript snippet to clipboard + a <pre> block
//
// NOT in scope (yet):
//   · drag-to-move (delete + click-new is enough for MVP)
//   · undo / redo
//   · loading the actual GLB props (placeholder cylinders are fast and
//     legible — the goal is positioning, not visual fidelity)
//   · auto-write to disk (export only — keeps SoT in code review)
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { ARENA_PACK_IDS, type ArenaPackId } from '../arena-decorations';
import {
  DECOR_LAYOUTS,
  DECOR_TYPES,
  decorTypesForPack,
  decorTypeLabel,
  type DecorPlacement,
} from '../arena-decor-layouts';
import { FRAG } from '../arena-fragments';
import { loadModel } from '../model-loader';
import {
  toolStorageKey,
  loadFromStorage,
  saveToStorage,
  clearStorage,
  hasStorageKey,
  storageDivergesFromCode,
} from '../tools/tool-storage';

// ---------------------------------------------------------------------------
// Scene + ortho top-down camera
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.body.firstChild);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x12131a);

const scene = new THREE.Scene();

const hemi = new THREE.HemisphereLight(0xffffff, 0x404858, 0.85);
scene.add(hemi);

// Top-down ortho camera: world XZ plane mapped 1:1 to the canvas.
// Frustum width is set to roughly fit the arena (radius 12) plus a margin.
// We update it in resize() to maintain aspect.
const VIEW_HALF_EXTENT = 14;     // world units visible from centre to edge (roughly)
const camera = new THREE.OrthographicCamera(
  -VIEW_HALF_EXTENT, VIEW_HALF_EXTENT,
   VIEW_HALF_EXTENT, -VIEW_HALF_EXTENT,
   0.1, 100,
);
camera.position.set(0, 50, 0);
camera.up.set(0, 0, -1);          // so +X is right and +Z is DOWN on screen (Three.js default)
camera.lookAt(0, 0, 0);

// ---------------------------------------------------------------------------
// Reference geometry — arena radii circles
// ---------------------------------------------------------------------------

function makeRingWireframe(radius: number, color: number, opacity: number): THREE.LineLoop {
  const SEG = 96;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineLoop(geo, mat);
}

// Reference rings: immune (centre), inner-band, mid-band, max (playable edge),
// max+0.5 (skirt outer edge), max+2 (former extended terrain — kept faintly
// for context).
scene.add(makeRingWireframe(FRAG.immuneRadius,    0x88ddff, 0.55));     // immune
scene.add(makeRingWireframe(FRAG.bands[0]!.outer, 0x6fa35f, 0.35));     // band 1 outer
scene.add(makeRingWireframe(FRAG.bands[1]!.outer, 0x4a6741, 0.35));     // band 2 outer
scene.add(makeRingWireframe(FRAG.maxRadius,       0xffdc5c, 0.85));     // playable edge ★

// Cardinal axis crosshair (mostly to anchor the eye)
{
  const len = FRAG.maxRadius + 1;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-len, 0, 0), new THREE.Vector3(len, 0, 0),
    new THREE.Vector3(0, 0, -len), new THREE.Vector3(0, 0, len),
  ]);
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x444a5c, transparent: true, opacity: 0.4,
  })));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Working copy of the layout. We never mutate DECOR_LAYOUTS at runtime —
 *  switching packs reloads from there. The user "saves" by clicking
 *  Export and pasting the snippet. */
let placements: DecorPlacement[] = [];
let selectedIdx = -1;
let currentPack: ArenaPackId = 'jungle';

/** Group holding the placement disc meshes (the fast top-down editing
 *  preview). Rebuilt on every layout change; kept tiny so this is fine. */
const placementsGroup = new THREE.Group();
scene.add(placementsGroup);

/** Map from placement index to the disc Mesh that visualises it. We use
 *  this for raycaster picking and for highlighting the selection. */
const discMeshes: THREE.Mesh[] = [];

/** Optional GLB preview layer. Same placements but rendered with the
 *  real arena GLBs instead of placeholder discs. Hidden by default;
 *  toggled by `ctlPreviewGlb`. Re-built async whenever placements
 *  change AND preview is on. The placeholder layer stays visible
 *  during drags for snappy feedback (preview rebuilds on pointerup). */
const previewGroup = new THREE.Group();
previewGroup.visible = false;
scene.add(previewGroup);

/** True while the GLB preview layer is the visible one. */
let previewMode = false;

/** Token used to detect superseded async rebuilds — same pattern as
 *  applyPack in arena.ts. Each call increments the token and aborts
 *  any in-flight build that doesn't match it. Prevents stale GLBs
 *  from leaking into the scene when the user clicks rapidly. */
let previewToken = 0;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const ctlPack       = qSelect('ctl-pack');
const ctlType       = qSelect('ctl-type');
const ctlSelType    = qSelect('ctl-sel-type');
const ctlSelR       = qInput('ctl-sel-r');
const ctlSelAngle   = qInput('ctl-sel-angle');
const ctlSelRotY    = qInput('ctl-sel-rotY');
const ctlSelScale   = qInput('ctl-sel-scale');
const valSelR       = qSpan('val-sel-r');
const valSelAngle   = qSpan('val-sel-angle');
const valSelRotY    = qSpan('val-sel-rotY');
const valSelScale   = qSpan('val-sel-scale');
const btnDelete     = qBtn('btn-delete');
const btnUndo       = qBtn('btn-undo');
const btnRedo       = qBtn('btn-redo');
const historyLabel  = qSpan('history-label');
const btnResetLocal = qBtn('btn-reset-local');
const localIndicator= qSpan('local-indicator');
const ctlPreviewGlb = qInput('ctl-preview-glb');
const btnPreviewIngame = qBtn('btn-preview-ingame');
const btnExport     = qBtn('btn-export');
const exportOut     = qPre('export-out');
const placementsList= qDiv('placements-list');
const placementCount= qSpan('placement-count');
const selectedInfo  = qDiv('selected-info');

function qSelect(id: string): HTMLSelectElement { return document.getElementById(id) as HTMLSelectElement; }
function qInput(id: string):  HTMLInputElement  { return document.getElementById(id) as HTMLInputElement; }
function qBtn(id: string):    HTMLButtonElement { return document.getElementById(id) as HTMLButtonElement; }
function qSpan(id: string):   HTMLElement       { return document.getElementById(id) as HTMLElement; }
function qDiv(id: string):    HTMLElement       { return document.getElementById(id) as HTMLElement; }
function qPre(id: string):    HTMLElement       { return document.getElementById(id) as HTMLElement; }

// ---------------------------------------------------------------------------
// UI population
// ---------------------------------------------------------------------------

for (const id of ARENA_PACK_IDS) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = id;
  ctlPack.appendChild(opt);
}
ctlPack.value = currentPack;

function refreshTypeDropdown(target: HTMLSelectElement, current?: string): void {
  target.innerHTML = '';
  const types = decorTypesForPack(currentPack);
  for (const key of types) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = decorTypeLabel(key);
    target.appendChild(opt);
  }
  if (current && types.includes(current)) {
    target.value = current;
  }
}

function refreshAllUI(): void {
  refreshTypeDropdown(ctlType);
  refreshTypeDropdown(ctlSelType);
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
}

// ---------------------------------------------------------------------------
// Disc visualisation
// ---------------------------------------------------------------------------

const DISC_GEO = new THREE.CircleGeometry(0.45, 24);
DISC_GEO.rotateX(-Math.PI / 2);
const ARROW_GEO = new THREE.ConeGeometry(0.18, 0.55, 4);   // small triangle to show rotY
ARROW_GEO.rotateX(-Math.PI / 2);
ARROW_GEO.translate(0, 0, 0.4);

function discMaterial(typeKey: string, selected: boolean): THREE.MeshBasicMaterial {
  // Hash type to a hue so each prop type has a stable colour. Selected
  // overrides hue with our highlight yellow.
  if (selected) return new THREE.MeshBasicMaterial({ color: 0xffdc5c });
  const hash = typeKey.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const hue = (Math.abs(hash) % 360) / 360;
  const col = new THREE.Color().setHSL(hue, 0.55, 0.55);
  return new THREE.MeshBasicMaterial({ color: col });
}

/** Schedule a preview-layer rebuild if we're in preview mode AND not
 *  currently dragging (where placeholders remain the source of truth
 *  for fast feedback). No-op otherwise. */
function maybeRebuildPreview(): void {
  if (!previewMode) return;
  if (gesture && gesture.isDragging) return;
  void rebuildPreviewGroup();
}

function rebuildDiscs(): void {
  // Dispose old
  for (const m of discMeshes) {
    placementsGroup.remove(m);
    (m.material as THREE.Material).dispose();
  }
  discMeshes.length = 0;

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const x = Math.cos(p.angle) * p.r;
    const z = Math.sin(p.angle) * p.r;
    const mat = discMaterial(p.type, i === selectedIdx);
    const disc = new THREE.Mesh(DISC_GEO, mat);
    disc.position.set(x, 0, z);
    // Scale the disc slightly with the placement's scale so visual
    // density matches the runtime feel.
    disc.scale.setScalar(0.85 + p.scale * 0.4);
    // Pointer for rotY direction
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const arrow = new THREE.Mesh(ARROW_GEO, arrowMat);
    arrow.rotation.y = -p.rotY;     // visual rotation matches the world rotY of the prop
    arrow.position.y = 0.01;        // tiny lift so it draws above the disc
    disc.add(arrow);
    placementsGroup.add(disc);
    discMeshes.push(disc);
    // Stash the index on the mesh for raycaster lookup
    (disc.userData as { idx: number }).idx = i;
  }
  maybeRebuildPreview();
}

// ---------------------------------------------------------------------------
// GLB preview layer — optional toggle
// ---------------------------------------------------------------------------
//
// Cheap-by-default: disabled at boot, placeholders run the show. When
// the user enables the toggle, every placement is loaded as its real
// GLB and rendered in `previewGroup`. The `model-loader` cache makes
// repeated rebuilds essentially free after the first warm-up.
//
// Drag is special-cased: during a drag we KEEP the placeholders visible
// (so the moving prop reads instantly without waiting for any GLB), and
// rebuild the preview only on pointerup. The maybeRebuildPreview() hook
// in rebuildDiscs() respects this.
//
// Failures (missing GLB, decode error) are logged at debug level and
// the placement silently drops out of the preview — placeholders stay
// in place, so the user always has SOMETHING to interact with.

const previewMeshes: THREE.Group[] = [];

async function rebuildPreviewGroup(): Promise<void> {
  const myToken = ++previewToken;

  // Clear previous frame
  for (const m of previewMeshes) {
    previewGroup.remove(m);
    m.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const mesh = c as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) for (const mm of mat) mm.dispose();
        else if (mat) (mat as THREE.Material).dispose();
      }
    });
  }
  previewMeshes.length = 0;

  for (const p of placements) {
    if (myToken !== previewToken) return;     // superseded
    const type = DECOR_TYPES[p.type];
    if (!type) continue;
    try {
      const mesh = await loadModel(type.glbPath);
      if (myToken !== previewToken) return;
      // Auto-fit by bbox to the type's displayHeight, exactly mirroring
      // arena-decorations.loadInArenaDecorations. Critical: the editor
      // preview MUST match what the game renders — otherwise the user
      // calibrates against a lie. Same two-pass scale: measure unit-
      // scale → factor → apply factor × placement.scale.
      mesh.scale.setScalar(1);
      mesh.rotation.y = p.rotY;
      mesh.position.set(
        Math.cos(p.angle) * p.r,
        0,
        Math.sin(p.angle) * p.r,
      );
      mesh.updateMatrixWorld(true);
      const rawBbox = new THREE.Box3().setFromObject(mesh);
      const measuredH = Number.isFinite(rawBbox.max.y - rawBbox.min.y)
        ? Math.max(0.001, rawBbox.max.y - rawBbox.min.y)
        : 1;
      const fitFactor = type.displayHeight / measuredH;
      mesh.scale.setScalar(fitFactor * p.scale);
      mesh.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(mesh);
      if (Number.isFinite(bbox.min.y)) mesh.position.y = -bbox.min.y;
      previewGroup.add(mesh);
      previewMeshes.push(mesh);
    } catch (err) {
      console.debug('[decor-editor] preview load failed:', p.type, err);
    }
  }
}

function setPreviewMode(on: boolean): void {
  previewMode = on;
  placementsGroup.visible = !on;
  previewGroup.visible = on;
  if (on) {
    void rebuildPreviewGroup();
  }
}

// ---------------------------------------------------------------------------
// Placements list (right sidebar)
// ---------------------------------------------------------------------------

function rebuildPlacementsList(): void {
  placementsList.innerHTML = '';
  placementCount.textContent = String(placements.length);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const row = document.createElement('div');
    row.className = 'placement-row' + (i === selectedIdx ? ' selected' : '');
    row.innerHTML = `
      <span><span class="idx">#${i}</span>${p.type}</span>
      <span>r=${p.r.toFixed(1)} ∠${p.angle.toFixed(2)}</span>
    `;
    row.addEventListener('click', () => selectPlacement(i));
    placementsList.appendChild(row);
  }
}

function refreshSelectedInfo(): void {
  if (selectedIdx < 0 || !placements[selectedIdx]) {
    selectedInfo.textContent = '(none — click on a prop to select)';
    [ctlSelR, ctlSelAngle, ctlSelRotY, ctlSelScale, ctlSelType, btnDelete]
      .forEach((el) => ((el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = true));
    valSelR.textContent = valSelAngle.textContent = valSelRotY.textContent = valSelScale.textContent = '—';
    return;
  }
  const p = placements[selectedIdx]!;
  // Show the final approximate height the prop will render at in-game.
  // displayHeight × placement.scale, with a critter-relative comparison
  // so the user can eyeball "how tall is this versus a critter (1.7 u)".
  const type = DECOR_TYPES[p.type];
  const finalH = type ? type.displayHeight * p.scale : null;
  const ratioCritter = finalH !== null ? finalH / 1.7 : null;
  const ratioBadge = ratioCritter !== null
    ? ` <span style="opacity:0.65;font-weight:400">≈ ${finalH!.toFixed(2)} u (${ratioCritter.toFixed(1)}× critter)</span>`
    : '';
  selectedInfo.innerHTML = `<strong>#${selectedIdx}</strong> &middot; ${decorTypeLabel(p.type)}${ratioBadge}`;
  [ctlSelR, ctlSelAngle, ctlSelRotY, ctlSelScale, ctlSelType, btnDelete]
    .forEach((el) => ((el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = false));
  ctlSelR.value = String(p.r);
  ctlSelAngle.value = String(p.angle);
  ctlSelRotY.value = String(p.rotY);
  ctlSelScale.value = String(p.scale);
  valSelR.textContent = p.r.toFixed(2);
  valSelAngle.textContent = p.angle.toFixed(2);
  valSelRotY.textContent = p.rotY.toFixed(2);
  valSelScale.textContent = p.scale.toFixed(2);
  ctlSelType.value = p.type;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function selectPlacement(idx: number): void {
  selectedIdx = idx;
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
}

function deletePlacement(idx: number): void {
  if (idx < 0 || idx >= placements.length) return;
  placements.splice(idx, 1);
  if (selectedIdx === idx) selectedIdx = -1;
  else if (selectedIdx > idx) selectedIdx--;
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
  pushSnapshot();
}

/** Convert a screen-space mouse event to a world (x, z) point on the
 *  ground plane (y=0). Uses the ortho camera's projection. */
function screenToWorldXZ(ev: MouseEvent): { x: number; z: number } | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  // Ortho camera: ray direction is straight down. Just unproject the NDC
  // and grab x, z directly.
  const v = new THREE.Vector3(ndcX, ndcY, 0).unproject(camera);
  return { x: v.x, z: v.z };
}

// ---------------------------------------------------------------------------
// Drag & drop state
// ---------------------------------------------------------------------------
//
// The canvas uses pointer events instead of click to support drag-to-move:
//
//   pointerdown — hit-test placements; if hit → arm drag with offset;
//                 otherwise mark as a pending "place new" gesture.
//   pointermove — once movement crosses DRAG_THRESHOLD_PX, drag begins.
//                 Subsequent moves update the dragged prop's r / angle.
//   pointerup   — if drag happened: commit (no further work).
//                 If no drag and we hit a prop: selection already done in
//                 pointerdown — done.
//                 If no drag and empty space: place a new prop.
//
// `dragOffsetX/Z` records the world-space delta between the prop centre
// and the click point, so dragging doesn't snap the prop to the cursor.

const DRAG_THRESHOLD_PX = 4;
const HIT_RADIUS = 0.6;
const PLAYABLE_INNER = FRAG.immuneRadius + 0.3;
const PLAYABLE_OUTER = FRAG.maxRadius - 0.1;

interface PointerGesture {
  startScreenX: number;
  startScreenY: number;
  draggedIdx: number;       // -1 if pointerdown landed on empty space
  dragOffsetX: number;
  dragOffsetZ: number;
  isDragging: boolean;
}

let gesture: PointerGesture | null = null;

/** Hit-test placements at world (x,z). Returns nearest within HIT_RADIUS, or -1. */
function hitTestPlacement(wx: number, wz: number): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const px = Math.cos(p.angle) * p.r;
    const pz = Math.sin(p.angle) * p.r;
    const d = Math.hypot(wx - px, wz - pz);
    if (d < HIT_RADIUS && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

canvas.addEventListener('pointerdown', (ev) => {
  const wp = screenToWorldXZ(ev);
  if (!wp) return;
  const hitIdx = hitTestPlacement(wp.x, wp.z);
  gesture = {
    startScreenX: ev.clientX,
    startScreenY: ev.clientY,
    draggedIdx: hitIdx,
    dragOffsetX: 0,
    dragOffsetZ: 0,
    isDragging: false,
  };
  if (hitIdx >= 0) {
    // Pre-compute offset so the prop won't snap to the cursor on drag start.
    const p = placements[hitIdx]!;
    gesture.dragOffsetX = wp.x - Math.cos(p.angle) * p.r;
    gesture.dragOffsetZ = wp.z - Math.sin(p.angle) * p.r;
    selectPlacement(hitIdx);
    canvas.setPointerCapture(ev.pointerId);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!gesture || gesture.draggedIdx < 0) return;
  const dx = ev.clientX - gesture.startScreenX;
  const dy = ev.clientY - gesture.startScreenY;
  if (!gesture.isDragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  const wp = screenToWorldXZ(ev);
  if (!wp) return;
  if (!gesture.isDragging) {
    gesture.isDragging = true;
    // Snapshot taken at drag END (post-commit) — see pointerup. Pre-drag
    // state is already in the history because every prior change pushed
    // its own snapshot. So undo from here returns to the pre-drag layout.
    // Show placeholders during the drag for snappy feedback even when
    // GLB preview is on; setPreviewMode flips them back on pointerup.
    if (previewMode) {
      placementsGroup.visible = true;
      previewGroup.visible = false;
    }
  }
  const targetX = wp.x - gesture.dragOffsetX;
  const targetZ = wp.z - gesture.dragOffsetZ;
  // Clamp to the playable ring so a drag never produces an invalid export.
  let r = Math.hypot(targetX, targetZ);
  if (r < PLAYABLE_INNER) r = PLAYABLE_INNER;
  if (r > PLAYABLE_OUTER) r = PLAYABLE_OUTER;
  const angle = Math.atan2(targetZ, targetX);
  const p = placements[gesture.draggedIdx]!;
  p.r = round3(r);
  p.angle = round3(angle);
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
});

canvas.addEventListener('pointerup', (ev) => {
  if (!gesture) return;
  const wasDragging = gesture.isDragging;
  const hadHit = gesture.draggedIdx >= 0;
  if (canvas.hasPointerCapture(ev.pointerId)) {
    canvas.releasePointerCapture(ev.pointerId);
  }
  gesture = null;
  if (wasDragging) {
    // Drag committed. Snapshot the new state for undo. autoSave hooks
    // into pushSnapshot so localStorage is updated as well. Restore
    // preview-vs-placeholder visibility now that movement is over.
    if (previewMode) {
      placementsGroup.visible = false;
      previewGroup.visible = true;
      void rebuildPreviewGroup();
    }
    pushSnapshot();
    return;
  }
  if (hadHit) {
    // Click on prop — already selected on pointerdown. Nothing to do.
    return;
  }
  // Click on empty space → place a new prop with the currently-selected type.
  const wp = screenToWorldXZ(ev);
  if (!wp) return;
  const r = Math.hypot(wp.x, wp.z);
  if (r > PLAYABLE_OUTER) return;            // outside playable arena
  if (r < PLAYABLE_INNER) return;            // too close to centre
  const angle = Math.atan2(wp.z, wp.x);
  const type = ctlType.value || decorTypesForPack(currentPack)[0];
  if (!type) return;
  const newP: DecorPlacement = {
    r: round3(r),
    angle: round3(angle),
    rotY: 0,
    scale: 1.0,
    type,
  };
  placements.push(newP);
  selectedIdx = placements.length - 1;
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
  pushSnapshot();
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (document.activeElement instanceof HTMLInputElement
     || document.activeElement instanceof HTMLSelectElement) return;
    if (selectedIdx >= 0) {
      deletePlacement(selectedIdx);
      ev.preventDefault();
    }
  }
});

ctlPack.addEventListener('change', () => {
  currentPack = ctlPack.value as ArenaPackId;
  console.info('[decor-editor] switching pack →', currentPack);
  // Prefer the local working copy when present; fall back to authored
  // code layout. saveLocal() will fire on the next mutation, so we
  // don't overwrite anything just by switching.
  placements = loadLocalOrCode(currentPack);
  selectedIdx = -1;
  refreshAllUI();
  resetHistoryToCurrent();
  refreshLocalIndicator();
});

ctlSelR.addEventListener('input', () => {
  if (selectedIdx < 0) return;
  placements[selectedIdx]!.r = round3(+ctlSelR.value);
  valSelR.textContent = placements[selectedIdx]!.r.toFixed(2);
  rebuildDiscs(); rebuildPlacementsList();
});
ctlSelAngle.addEventListener('input', () => {
  if (selectedIdx < 0) return;
  placements[selectedIdx]!.angle = round3(+ctlSelAngle.value);
  valSelAngle.textContent = placements[selectedIdx]!.angle.toFixed(2);
  rebuildDiscs(); rebuildPlacementsList();
});
ctlSelRotY.addEventListener('input', () => {
  if (selectedIdx < 0) return;
  placements[selectedIdx]!.rotY = round3(+ctlSelRotY.value);
  valSelRotY.textContent = placements[selectedIdx]!.rotY.toFixed(2);
  rebuildDiscs();
});
ctlSelScale.addEventListener('input', () => {
  if (selectedIdx < 0) return;
  placements[selectedIdx]!.scale = round3(+ctlSelScale.value);
  valSelScale.textContent = placements[selectedIdx]!.scale.toFixed(2);
  // Refresh the selected-info badge so the "≈ X u (n× critter)" line
  // tracks the slider live. Without this it stays anchored to the
  // value the prop had at selection time, which feels broken when
  // the slider is supposed to drive the displayed height.
  refreshSelectedInfo();
  rebuildDiscs();
});
ctlSelType.addEventListener('change', () => {
  if (selectedIdx < 0) return;
  if (DECOR_TYPES[ctlSelType.value]) {
    placements[selectedIdx]!.type = ctlSelType.value;
    refreshSelectedInfo();      // keep the "≈ X u" badge in sync with the new type's displayHeight
    rebuildDiscs();
    rebuildPlacementsList();
    pushSnapshot();
  }
});

// Snapshot only when a slider drag *finishes* (change event fires on
// release / focus loss), not on every input event. Keeps the history
// from being spammed by drag-as-you-tune motion while still capturing
// every meaningful tuning step.
[ctlSelR, ctlSelAngle, ctlSelRotY, ctlSelScale].forEach((el) => {
  el.addEventListener('change', () => {
    if (selectedIdx < 0) return;
    pushSnapshot();
  });
});

btnDelete.addEventListener('click', () => {
  if (selectedIdx >= 0) deletePlacement(selectedIdx);
});

btnUndo.addEventListener('click', () => undo());
btnRedo.addEventListener('click', () => redo());
btnResetLocal.addEventListener('click', () => {
  if (confirm(`Reset local edits for pack "${currentPack}"?\n\nThis wipes the browser-saved working copy and reloads the code layout from arena-decor-layouts.ts.`)) {
    resetLocalState();
  }
});

ctlPreviewGlb.addEventListener('change', () => {
  setPreviewMode(ctlPreviewGlb.checked);
});

btnPreviewIngame.addEventListener('click', () => {
  // Force-save the working copy first so the game reads the freshest
  // version of localStorage (saveLocal also fires automatically on
  // every change, but defending against any race / disabled case).
  saveLocal();
  // Open the game with the pack pinned and the preview flag on.
  // window.open in a new tab keeps the editor available for tweaks
  // without losing the working copy. Falls back to same-tab navigation
  // if the popup blocker intervenes.
  const url = `/?arenaPack=${encodeURIComponent(currentPack)}&decorPreview=1`;
  const win = window.open(url, '_blank');
  if (!win) {
    // Pop-up blocked — degrade gracefully to in-tab navigation.
    window.location.href = url;
  }
});

btnExport.addEventListener('click', () => {
  const lines: string[] = [];
  lines.push(`// --- Decor layout export for pack: ${currentPack} ---`);
  lines.push('// Paste inside DECOR_LAYOUTS in src/arena-decor-layouts.ts');
  lines.push('');
  lines.push(`  ${currentPack}: [`);
  for (const p of placements) {
    lines.push(
      `    { r: ${p.r.toFixed(2)}, angle: ${p.angle.toFixed(2)}, ` +
        `rotY: ${p.rotY.toFixed(2)}, scale: ${p.scale.toFixed(2)}, ` +
        `type: ${JSON.stringify(p.type)} },`,
    );
  }
  lines.push(`  ],`);
  const out = lines.join('\n');
  exportOut.textContent = out;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(out).catch(() => {/* user has the on-screen pre */});
  }
  console.log(out);
});

// ---------------------------------------------------------------------------
// Render loop + resize
// ---------------------------------------------------------------------------

function resize(): void {
  const sidebarW = 340;
  const bannerH = 40;
  const w = window.innerWidth - sidebarW;
  const h = window.innerHeight - bannerH;
  renderer.setSize(w, h, false);
  canvas.style.position = 'fixed';
  canvas.style.top = `${bannerH}px`;
  canvas.style.left = '0';
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  // Keep aspect square-equivalent so circles stay circular: scale frustum
  // along whichever axis the canvas is taller in.
  const aspect = w / h;
  if (aspect >= 1) {
    camera.left   = -VIEW_HALF_EXTENT * aspect;
    camera.right  =  VIEW_HALF_EXTENT * aspect;
    camera.top    =  VIEW_HALF_EXTENT;
    camera.bottom = -VIEW_HALF_EXTENT;
  } else {
    camera.left   = -VIEW_HALF_EXTENT;
    camera.right  =  VIEW_HALF_EXTENT;
    camera.top    =  VIEW_HALF_EXTENT / aspect;
    camera.bottom = -VIEW_HALF_EXTENT / aspect;
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Undo / Redo — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
// ---------------------------------------------------------------------------
//
// Snapshot-based history of `placements`. Every "real change" pushes a
// deep clone after applying the mutation:
//
//   place new      → push (in pointerup)
//   delete         → push (in deletePlacement)
//   drag end       → push (in pointerup, only if isDragging was true)
//   slider change  → push (on `change` event, NOT on `input` so a slow
//                    drag-as-you-tune doesn't spam 80 entries)
//   type change    → push
//   pack change    → resets the stack and pushes the loaded layout
//
// Boot pushes the initial layout so the very first user action (which is
// probably a delete or a drag) has a previous state to undo into.
//
// HISTORY_MAX caps memory: 50 snapshots × ~12 props × ~80 bytes ≈ 48 KB
// worst case. Older entries fall off the front.
//
// `historyIdx` points at the CURRENT state — undo decrements, redo
// increments. Pushing a new snapshot drops anything past historyIdx
// (the redo branch is invalidated by a fresh edit, standard semantics).

const HISTORY_MAX = 50;
const history: DecorPlacement[][] = [];
let historyIdx = -1;

/** Snapshot the current placements into the history stack. Drops the
 *  redo branch (everything past historyIdx). Caps at HISTORY_MAX by
 *  shifting the oldest entry off the front when full. */
function pushSnapshot(): void {
  // Drop redo branch so a new edit invalidates "future" states
  if (historyIdx < history.length - 1) {
    history.length = historyIdx + 1;
  }
  history.push(JSON.parse(JSON.stringify(placements)));
  if (history.length > HISTORY_MAX) {
    history.shift();
  }
  historyIdx = history.length - 1;
  saveLocal();
  refreshHistoryButtons();
}

function undo(): boolean {
  if (historyIdx <= 0) return false;
  historyIdx--;
  placements = JSON.parse(JSON.stringify(history[historyIdx]));
  selectedIdx = -1;
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
  refreshHistoryButtons();
  saveLocal();
  return true;
}

function redo(): boolean {
  if (historyIdx >= history.length - 1) return false;
  historyIdx++;
  placements = JSON.parse(JSON.stringify(history[historyIdx]));
  selectedIdx = -1;
  rebuildDiscs();
  rebuildPlacementsList();
  refreshSelectedInfo();
  refreshHistoryButtons();
  saveLocal();
  return true;
}

/** Clear history and seed it with the current placements. Used when the
 *  user switches packs (new context, no point keeping the old stack)
 *  and at boot. */
function resetHistoryToCurrent(): void {
  history.length = 0;
  history.push(JSON.parse(JSON.stringify(placements)));
  historyIdx = 0;
  refreshHistoryButtons();
}

/** Toggle the disabled state of the undo/redo buttons + update the
 *  textual indicator. Called from anywhere the stack changes. */
function refreshHistoryButtons(): void {
  if (btnUndo)  btnUndo.disabled  = historyIdx <= 0;
  if (btnRedo)  btnRedo.disabled  = historyIdx >= history.length - 1;
  if (historyLabel) {
    historyLabel.textContent = `${historyIdx + 1} / ${history.length}`;
  }
}

window.addEventListener('keydown', (ev) => {
  // Don't steal Ctrl+Z while typing in an input (slider focused, etc.)
  if (document.activeElement instanceof HTMLInputElement
   || document.activeElement instanceof HTMLSelectElement) return;
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const isZ = ev.key.toLowerCase() === 'z';
  const isY = ev.key.toLowerCase() === 'y';
  if (isZ && !ev.shiftKey) {
    if (undo()) ev.preventDefault();
  } else if ((isZ && ev.shiftKey) || isY) {
    if (redo()) ev.preventDefault();
  }
});

// ---------------------------------------------------------------------------
// localStorage persistence — per-pack auto-save
// ---------------------------------------------------------------------------
//
// Key shape:  decor-editor:<packId>          → JSON of DecorPlacement[]
//
// The editor is otherwise ephemeral — a reload would lose everything. With
// this layer the user can iterate across days without remembering to
// Export every time. Export still defines the SoT (only thing that
// updates `arena-decor-layouts.ts`); localStorage is the working copy.
//
// Lifecycle:
//   boot                    → if storage[packId] exists, load it
//                             instead of DECOR_LAYOUTS[packId]
//   any push / undo / redo  → save to storage[packId]
//   pack switch             → save current pack first, then load next
//   "Reset local state"     → wipe storage[packId], reload from
//                             DECOR_LAYOUTS[packId], reset history
//
// Failures:
//   - quotaExceeded → silently degrade (keep working in-memory).
//   - corrupt JSON  → fall back to code layout, console.warn once.
//
// This pattern is meant to be lifted into a tiny shared module later
// (calibrate + anim-lab can use the same shape) but we keep it inline
// here to avoid scope creep on this iteration.

// Tool name used by tool-storage helpers. Must stay 'decor-editor' so
// existing browser localStorage entries (and the preview-in-game URL
// flow that arena-decor-layouts.ts reads) keep working.
const STORAGE_TOOL = 'decor-editor';

function isDecorPlacementArray(v: unknown): v is DecorPlacement[] {
  if (!Array.isArray(v)) return false;
  return v.every((p) =>
    typeof p?.r === 'number'
    && typeof p?.angle === 'number'
    && typeof p?.rotY === 'number'
    && typeof p?.scale === 'number'
    && typeof p?.type === 'string',
  );
}

function saveLocal(): void {
  saveToStorage(toolStorageKey(STORAGE_TOOL, currentPack), placements);
  refreshLocalIndicator();
}

function loadLocalOrCode(packId: ArenaPackId): DecorPlacement[] {
  const local = loadFromStorage<DecorPlacement[]>(
    toolStorageKey(STORAGE_TOOL, packId),
    isDecorPlacementArray,
  );
  if (local) return local;
  return JSON.parse(JSON.stringify(DECOR_LAYOUTS[packId] ?? []));
}

function clearLocal(packId: ArenaPackId): void {
  clearStorage(toolStorageKey(STORAGE_TOOL, packId));
}

function refreshLocalIndicator(): void {
  if (!localIndicator || !btnResetLocal) return;
  const key = toolStorageKey(STORAGE_TOOL, currentPack);
  const has = hasStorageKey(key);
  if (!has) {
    localIndicator.textContent = '— using code layout';
    localIndicator.dataset.kind = 'code';
    btnResetLocal.disabled = true;
  } else if (storageDivergesFromCode(key, DECOR_LAYOUTS[currentPack] ?? [])) {
    localIndicator.textContent = '⚠ using local changes (≠ code) — Reset to discard';
    localIndicator.dataset.kind = 'diverged';
    btnResetLocal.disabled = false;
  } else {
    localIndicator.textContent = '✓ saved locally (matches code)';
    localIndicator.dataset.kind = 'matches';
    btnResetLocal.disabled = false;
  }
}

function resetLocalState(): void {
  clearLocal(currentPack);
  placements = JSON.parse(JSON.stringify(DECOR_LAYOUTS[currentPack] ?? []));
  selectedIdx = -1;
  refreshAllUI();
  resetHistoryToCurrent();
  refreshLocalIndicator();
}

// ---------------------------------------------------------------------------
// Boot — load the initial pack's layout
// ---------------------------------------------------------------------------
//
// Must run AFTER every const/let declaration above this line, because
// boot calls resetHistoryToCurrent() which reads `history` and
// `historyIdx`, and refreshLocalIndicator() which reads `localIndicator`.
// JS hoists function declarations, but TDZ on the const/let they touch
// throws silently if boot runs before those bindings exist. Hence:
// keep the boot block at the very bottom of the file.

placements = loadLocalOrCode(currentPack);
refreshAllUI();
resetHistoryToCurrent();
refreshLocalIndicator();
