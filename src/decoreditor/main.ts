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

/** Group holding the placement disc meshes. Rebuilt on every layout
 *  change; kept tiny so this is fine. */
const placementsGroup = new THREE.Group();
scene.add(placementsGroup);

/** Map from placement index to the disc Mesh that visualises it. We use
 *  this for raycaster picking and for highlighting the selection. */
const discMeshes: THREE.Mesh[] = [];

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
  selectedInfo.innerHTML = `<strong>#${selectedIdx}</strong> &middot; ${decorTypeLabel(p.type)}`;
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

canvas.addEventListener('click', (ev) => {
  const wp = screenToWorldXZ(ev);
  if (!wp) return;
  // Hit-test placements first (so clicking an existing prop selects it).
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const px = Math.cos(p.angle) * p.r;
    const pz = Math.sin(p.angle) * p.r;
    const d = Math.hypot(wp.x - px, wp.z - pz);
    if (d < 0.6 && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) {
    selectPlacement(bestIdx);
    return;
  }
  // Empty space → place a new prop with the currently-selected type.
  const r = Math.hypot(wp.x, wp.z);
  if (r > FRAG.maxRadius - 0.1) return;     // outside playable arena
  if (r < FRAG.immuneRadius + 0.3) return;  // too close to centre
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
  // Restart from the authored layout for that pack. Note: switching
  // packs DROPS unsaved edits to the current pack — show a warning?
  // For now we only print a console hint. The user knows the editor
  // is ephemeral.
  console.info('[decor-editor] switching pack →', currentPack, '— unsaved edits to the previous pack are kept in memory but won\'t persist on a second switch');
  placements = JSON.parse(JSON.stringify(DECOR_LAYOUTS[currentPack] ?? []));
  selectedIdx = -1;
  refreshAllUI();
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
  rebuildDiscs();
});
ctlSelType.addEventListener('change', () => {
  if (selectedIdx < 0) return;
  if (DECOR_TYPES[ctlSelType.value]) {
    placements[selectedIdx]!.type = ctlSelType.value;
    rebuildDiscs();
    rebuildPlacementsList();
  }
});

btnDelete.addEventListener('click', () => {
  if (selectedIdx >= 0) deletePlacement(selectedIdx);
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

// ---------------------------------------------------------------------------
// Boot — load the initial pack's layout
// ---------------------------------------------------------------------------

placements = JSON.parse(JSON.stringify(DECOR_LAYOUTS[currentPack] ?? []));
refreshAllUI();

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
