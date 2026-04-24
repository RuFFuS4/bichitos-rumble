// ---------------------------------------------------------------------------
// Roster Calibration Lab — `/calibrate.html`
// ---------------------------------------------------------------------------
//
// Dedicated 3-column grid of all 9 playable critters side-by-side at their
// current roster transform. Click one to select → sliders on the right
// mutate its scale / pivotY / rotationY live. Export the tuned values as
// a `roster.ts` diff snippet ready to paste.
//
// Why a separate page instead of a /tools.html panel:
//   - /tools.html is oriented around a running match (single active
//     critter as "player"). Calibration is fundamentally a compare-9-at-
//     once task — forcing it into the match viewport fights the existing
//     dev-api wiring.
//   - Separate page keeps the lab isolated: no Colyseus setup, no bot
//     AI, no HUD. Pure 3D preview + DOM controls. Fast iteration.
//   - Third HTML entry is a Vite one-liner (vite.config.ts rollupOptions)
//     so the cost is essentially zero.
//
// Non-goals:
//   - No animation lab — that's already in /animations (Mesh2Motion).
//   - No material / colour tuning. Calibration is about silhouette size,
//     pose orientation, and ground alignment only.
//   - No match simulation. Drop-in critters, inspect, export, done.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { Critter, CRITTER_PRESETS } from '../critter';
import { getDisplayRoster } from '../roster';
import type { RosterEntry } from '../roster';

// ---------------------------------------------------------------------------
// Scene / renderer setup
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.body.firstChild);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x12131a);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();

// Global lighting — three-point so silhouettes read without baking into
// the material editor. Key warm, rim cool, hemi lifts the underside.
const hemi = new THREE.HemisphereLight(0x9cc7ea, 0x2a261a, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
key.position.set(4, 8, 4);
scene.add(key);

const rim = new THREE.DirectionalLight(0x9cb8ff, 0.45);
rim.position.set(-5, 5, -4);
scene.add(rim);

// Ground grid — reference surface under the critters so we can see
// if pivot-Y is off (a crítter whose feet hang above the grid needs
// pivotY down; clipping through means pivotY up).
const gridHelper = new THREE.GridHelper(18, 18, 0x444a5c, 0x2a2f3d);
scene.add(gridHelper);

// Camera — orthographic-ish framing via perspective with a long lens
// so the 3x3 grid reads without strong perspective distortion.
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
camera.position.set(0, 6, 14);
camera.lookAt(0, 1, 0);

// ---------------------------------------------------------------------------
// Grid layout of 9 critters
// ---------------------------------------------------------------------------

interface Slot {
  entry: RosterEntry;
  holder: THREE.Group;          // transforms applied per critter (scale etc.)
  critter: Critter;             // owns the mesh + skeletal animator
  worldPos: THREE.Vector3;
  label: HTMLDivElement;
  bindPoseHeight: number | null; // reported by Critter once GLB loads
  rosterTransform: {
    scale: number;
    pivotY: number;
    rotationY: number;
  };
}

const slots: Slot[] = [];
const COLS = 3;
const CELL = 3.0; // world units between cell centres

const playableRoster = getDisplayRoster().filter((e) => e.status === 'playable');

// Calibrate used to create all 9 Critters synchronously at boot — which
// kicked off 9 parallel GLB fetches (~56 MB total) and froze the page
// until the biggest one landed. Two optimisations:
//
//   1. Create holder + label synchronously for every slot so the grid
//      layout / camera framing don't reflow as critters land.
//   2. Create the actual Critter (triggers the async GLB load) for the
//      first slot immediately; schedule the rest with a small stagger
//      so the browser has time to paint + respond to input between
//      loads. Uses requestIdleCallback when available to piggyback on
//      browser idle time; falls back to setTimeout with a growing delay
//      so the first 2-3 land fast and the rest stream in behind.
//
// Side effect the user should know: the slots populate over a few
// seconds instead of all at once. Labels already read so it's obvious
// what's loading. No change to the sliders / export flow.

interface PendingSlot {
  entry: RosterEntry;
  preset: ReturnType<typeof CRITTER_PRESETS.find>;
  holder: THREE.Group;
  label: HTMLDivElement;
  worldPos: THREE.Vector3;
}
const pendingSlots: PendingSlot[] = [];

for (let i = 0; i < playableRoster.length; i++) {
  const entry = playableRoster[i]!;
  const preset = CRITTER_PRESETS.find((c) => c.name === entry.displayName);
  if (!preset) continue;

  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // Centre the grid around origin: columns span -2*CELL .. +2*CELL.
  const x = (col - (COLS - 1) / 2) * CELL;
  const z = (row - 1) * CELL; // 3 rows → -1, 0, 1

  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  scene.add(holder);

  const label = document.createElement('div');
  label.className = 'critter-label';
  label.textContent = entry.displayName;
  label.style.position = 'fixed';
  label.style.pointerEvents = 'none';
  label.style.fontSize = '11px';
  label.style.fontWeight = '700';
  label.style.letterSpacing = '0.1em';
  label.style.color = '#ffdc5c';
  label.style.textShadow = '0 1px 2px rgba(0,0,0,0.9)';
  label.style.zIndex = '3';
  document.body.appendChild(label);

  pendingSlots.push({
    entry, preset, holder, label,
    worldPos: new THREE.Vector3(x, 0, z),
  });
}

// Kick off critter creation staggered. First one immediate; others with
// a growing delay so the page is interactive and the network has
// headroom. With 9 critters at 180 ms stagger the last lands at ~1.6 s,
// but the page is fully responsive from frame one.
function spawnCritterForSlot(p: PendingSlot): void {
  if (!p.preset) return;
  const critter = new Critter(p.preset, scene);
  scene.remove(critter.mesh);
  p.holder.add(critter.mesh);
  slots.push({
    entry: p.entry,
    holder: p.holder,
    critter,
    worldPos: p.worldPos,
    label: p.label,
    bindPoseHeight: null,
    rosterTransform: {
      scale: p.entry.scale,
      pivotY: p.entry.pivotY,
      rotationY: p.entry.rotation,
    },
  });
}

// First slot: synchronous (no wait — user sees something immediately).
if (pendingSlots.length > 0) {
  spawnCritterForSlot(pendingSlots[0]!);
}
// Remaining slots: staggered schedule. Prefer requestIdleCallback to
// ride browser idle; fall back to a simple setTimeout ladder.
const STAGGER_MS = 180;
const ric = (window as unknown as {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
}).requestIdleCallback;
for (let i = 1; i < pendingSlots.length; i++) {
  const p = pendingSlots[i]!;
  const scheduleAt = i * STAGGER_MS;
  if (ric) {
    setTimeout(() => ric(() => spawnCritterForSlot(p), { timeout: 2000 }), scheduleAt);
  } else {
    setTimeout(() => spawnCritterForSlot(p), scheduleAt);
  }
}

// (The original synchronous slots.push() block used to live here. Moved
// into `spawnCritterForSlot` above so it runs lazily with the staggered
// schedule. Removed verbatim to avoid confusing future readers.)

// ---------------------------------------------------------------------------
// Selection + sidebar wiring
// ---------------------------------------------------------------------------

let selectedSlotIdx: number | null = null;

const infoEl = document.getElementById('selector-info')!;
const ctlScale = document.getElementById('ctl-scale') as HTMLInputElement;
const ctlPivot = document.getElementById('ctl-pivotY') as HTMLInputElement;
const ctlRot = document.getElementById('ctl-rotation') as HTMLInputElement;
const ctlTarget = document.getElementById('ctl-target') as HTMLInputElement;
const valScale = document.getElementById('val-scale')!;
const valPivot = document.getElementById('val-pivotY')!;
const valRot = document.getElementById('val-rotation')!;
const valTarget = document.getElementById('val-target')!;
const btnRefit = document.getElementById('btn-refit')!;
const btnExport = document.getElementById('btn-export')!;
const exportOut = document.getElementById('export-out')!;

function selectSlot(idx: number): void {
  selectedSlotIdx = idx;
  const slot = slots[idx];
  if (!slot) return;
  // Sliders enabled + synced with current values.
  [ctlScale, ctlPivot, ctlRot].forEach((el) => (el.disabled = false));
  ctlScale.value = String(slot.rosterTransform.scale);
  ctlPivot.value = String(slot.rosterTransform.pivotY);
  ctlRot.value = String(slot.rosterTransform.rotationY);
  valScale.textContent = slot.rosterTransform.scale.toFixed(3);
  valPivot.textContent = slot.rosterTransform.pivotY.toFixed(3);
  valRot.textContent = slot.rosterTransform.rotationY.toFixed(3);

  infoEl.innerHTML = `
    <div class="row"><span class="k">Name</span><span class="v">${escapeHtml(slot.entry.displayName)}</span></div>
    <div class="row"><span class="k">Role</span><span class="v">${escapeHtml(slot.entry.role)}</span></div>
    <div class="row"><span class="k">GLB</span><span class="v">${escapeHtml(slot.entry.glbPath ?? 'none')}</span></div>
    <div class="row"><span class="k">Post-fit height</span><span class="v">${slot.bindPoseHeight?.toFixed(3) ?? '…'}</span></div>
  `;
}

// Click on a critter → raycast picks the closest slot and selects it.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  // Raycast against every slot's holder subtree; pick the slot whose
  // intersection is nearest the camera.
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i++) {
    const hits = raycaster.intersectObject(slots[i]!.holder, true);
    if (hits.length === 0) continue;
    if (hits[0]!.distance < bestDist) {
      bestDist = hits[0]!.distance;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) selectSlot(bestIdx);
});

// Slider handlers — each mutates the selected slot's mesh transform and
// records the new value in rosterTransform so Export has the data.
//
// In addition to writing the transform directly on glbMesh, each slider
// also pushes the value into `critter.rosterOverride`. Without that push,
// `tickProceduralAnimation` re-reads `rosterEntry.scale` / `.pivotY` and
// re-writes `glbMesh.scale.{x,y,z}` / `position.y` on every frame,
// clobbering the direct mutation ~16 ms after the user releases the
// slider — the classic "why doesn't the slider do anything" symptom.
// Rotation is unaffected by procedural (it only writes `.x` / `.z`),
// but we still track it in the override for symmetry + future-proofing.
ctlScale.addEventListener('input', () => {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  const v = +ctlScale.value;
  slot.rosterTransform.scale = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, scale: v };
  // Apply to glbMesh (if loaded) — the Critter's inner group scale.
  if (slot.critter.glbMesh) {
    slot.critter.glbMesh.scale.setScalar(v);
  }
  valScale.textContent = v.toFixed(3);
});
ctlPivot.addEventListener('input', () => {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  const v = +ctlPivot.value;
  slot.rosterTransform.pivotY = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, pivotY: v };
  if (slot.critter.glbMesh) {
    // PivotY in the roster is applied as position.y += entry.pivotY on
    // the inner group. Mutating it means resetting to offset.y then
    // adding the new pivotY.
    slot.critter.glbMesh.position.y = slot.entry.offset[1] + v;
  }
  valPivot.textContent = v.toFixed(3);
});
ctlRot.addEventListener('input', () => {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  const v = +ctlRot.value;
  slot.rosterTransform.rotationY = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, rotation: v };
  if (slot.critter.glbMesh) {
    slot.critter.glbMesh.rotation.y = v;
  }
  valRot.textContent = v.toFixed(3);
});
ctlTarget.addEventListener('input', () => {
  valTarget.textContent = (+ctlTarget.value).toFixed(2);
});

btnRefit.addEventListener('click', () => {
  const target = +ctlTarget.value;
  for (const slot of slots) {
    if (!slot.critter.glbMesh || !slot.bindPoseHeight) continue;
    // Our in-game auto-fit already ran once at GLB load — here we
    // re-apply a fresh one to the new target. Scale from current
    // bindPoseHeight (which reflects the post-fit value = previous
    // target) to the new target.
    const k = target / slot.bindPoseHeight;
    slot.critter.glbMesh.scale.multiplyScalar(k);
    slot.rosterTransform.scale *= k;
    slot.bindPoseHeight = target;
  }
  // Refresh the sidebar if a slot is selected.
  if (selectedSlotIdx !== null) selectSlot(selectedSlotIdx);
});

btnExport.addEventListener('click', () => {
  // Emit a pastable roster.ts diff: one line per modified critter with
  // the new scale / pivotY / rotation. We match on `id:` so the user
  // can grep the original roster and replace each block.
  const lines: string[] = [];
  lines.push('// --- Roster calibration export ---');
  for (const slot of slots) {
    const t = slot.rosterTransform;
    lines.push(
      `// ${slot.entry.displayName} (${slot.entry.id}): ` +
        `scale: ${t.scale.toFixed(3)}, rotation: ${t.rotationY.toFixed(3)}, ` +
        `pivotY: ${t.pivotY.toFixed(3)}`,
    );
  }
  const out = lines.join('\n');
  exportOut.textContent = out;
  // Best-effort clipboard copy; silently ignore if permission denied.
  if (navigator.clipboard) {
    navigator.clipboard.writeText(out).catch(() => {
      /* user still has the on-screen text to copy manually */
    });
  }
  console.log(out);
});

// ---------------------------------------------------------------------------
// Orbit camera (drag + wheel zoom)
// ---------------------------------------------------------------------------

let orbitTheta = 0;
let orbitPhi = 0.4; // slight downward tilt
let orbitRadius = 14;
const orbitTarget = new THREE.Vector3(0, 1, 0);

let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (ev) => {
  dragging = true;
  lastX = ev.clientX;
  lastY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const dx = ev.clientX - lastX;
  const dy = ev.clientY - lastY;
  lastX = ev.clientX;
  lastY = ev.clientY;
  orbitTheta -= dx * 0.005;
  orbitPhi = Math.max(0.05, Math.min(1.35, orbitPhi + dy * 0.003));
});
canvas.addEventListener('pointerup', (ev) => {
  dragging = false;
  canvas.releasePointerCapture(ev.pointerId);
});
canvas.addEventListener('wheel', (ev) => {
  orbitRadius = Math.max(6, Math.min(30, orbitRadius + ev.deltaY * 0.01));
  ev.preventDefault();
}, { passive: false });

function updateCamera(): void {
  const y = orbitRadius * Math.sin(orbitPhi);
  const r = orbitRadius * Math.cos(orbitPhi);
  camera.position.set(
    orbitTarget.x + r * Math.sin(orbitTheta),
    orbitTarget.y + y,
    orbitTarget.z + r * Math.cos(orbitTheta),
  );
  camera.lookAt(orbitTarget);
}

// ---------------------------------------------------------------------------
// Label projection
// ---------------------------------------------------------------------------
//
// Each critter has a DOM label pinned to its worldPos. Project once per
// frame from world → screen so the text tracks as the camera orbits.

const projected = new THREE.Vector3();
function updateLabels(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const slot of slots) {
    projected.copy(slot.worldPos);
    projected.y = 2.4; // label floats above the critter
    projected.project(camera);
    const x = (projected.x * 0.5 + 0.5) * w;
    const y = (-projected.y * 0.5 + 0.5) * h;
    if (projected.z > 1) {
      slot.label.style.display = 'none';
    } else {
      slot.label.style.display = '';
      slot.label.style.left = `${x}px`;
      slot.label.style.top = `${y}px`;
      slot.label.style.transform = 'translate(-50%, -50%)';
      // Highlight selected
      const isSel = selectedSlotIdx !== null && slots[selectedSlotIdx] === slot;
      slot.label.style.color = isSel ? '#ffffff' : '#ffdc5c';
      slot.label.style.background = isSel ? 'rgba(255, 220, 92, 0.85)' : 'transparent';
      slot.label.style.padding = isSel ? '2px 6px' : '0';
      slot.label.style.borderRadius = isSel ? '4px' : '0';
    }
  }
}

// ---------------------------------------------------------------------------
// Animation loop
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let prevTime = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min((now - prevTime) / 1000, 0.1);
  prevTime = now;

  // Tick each critter (drives skeletal update + procedural bob).
  for (const slot of slots) {
    slot.critter.update(dt);
    // Pick up bindPoseHeight once the GLB loader finishes populating it.
    if (slot.bindPoseHeight === null && slot.critter.bindPoseHeight !== null) {
      slot.bindPoseHeight = slot.critter.bindPoseHeight;
      // If this slot is already selected, refresh the readout.
      if (selectedSlotIdx !== null && slots[selectedSlotIdx] === slot) {
        selectSlot(selectedSlotIdx);
      }
    }
  }

  updateCamera();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook — lets the preview MCP / devtools inspect every slot's
// critter + skeletal state without a dedicated panel. Removed before
// ship (not a concern for /calibrate.html since it's internal-only).
if (typeof window !== 'undefined') {
  (window as unknown as { __labSnap?: () => unknown }).__labSnap = () => slots.map((s) => ({
    name: s.entry.displayName,
    id: s.entry.id,
    bindPoseHeight: s.bindPoseHeight,
    glbLoaded: !!s.critter.glbMesh,
    scaleX: s.critter.glbMesh?.scale.x ?? null,
    rosterScale: s.rosterTransform.scale,
    clipNames: s.critter.skeletal?.availableClipNames ?? [],
    currentState: s.critter.skeletal?.getCurrentState?.() ?? null,
    resolvedStates: s.critter.skeletal?.listClips().map((c) => ({ clip: c.name, state: c.state })) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
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
