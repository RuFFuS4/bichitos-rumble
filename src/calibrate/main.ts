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
import { getDisplayRoster, getRosterEntry } from '../roster';
import type { RosterEntry } from '../roster';
import {
  makeToolPatch,
  copyPatchToClipboard,
  downloadPatch,
  toolStorageKey,
  loadFromStorage,
  saveToStorage,
  clearStorage,
  hasStorageKey,
  type CalibratePatch,
} from '../tools/tool-storage';

// ---------------------------------------------------------------------------
// localStorage working copy
// ---------------------------------------------------------------------------
//
// Each critter id has its own slot in localStorage:
//   `calibrate:<critterId>` → { scale, pivotY, rotation }
//
// Mirrors decor-editor's per-pack persistence: every slider tweak writes
// the latest transform for the selected critter; on page reload, the
// values are reapplied as the GLB lands. A "Reset local for this critter"
// button discards the working copy and reverts to the authored roster.ts
// values.
//
// Why per-critter (not per-roster): the calibration session is naturally
// scoped to "I'm tuning Trunk right now". Wiping a single critter's work
// copy without touching the others keeps the workflow snappy when one
// critter feels right but another still needs work.

const STORAGE_TOOL = 'calibrate';

interface LocalCalibrate {
  scale: number;
  pivotY: number;
  rotation: number;
}

function isLocalCalibrate(v: unknown): v is LocalCalibrate {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.scale === 'number'
    && typeof o.pivotY === 'number'
    && typeof o.rotation === 'number';
}

function saveLocalFor(critterId: string, t: LocalCalibrate): void {
  saveToStorage(toolStorageKey(STORAGE_TOOL, critterId), t);
}

function loadLocalFor(critterId: string): LocalCalibrate | null {
  return loadFromStorage<LocalCalibrate>(
    toolStorageKey(STORAGE_TOOL, critterId),
    isLocalCalibrate,
  );
}

function clearLocalFor(critterId: string): void {
  clearStorage(toolStorageKey(STORAGE_TOOL, critterId));
}

function hasLocalFor(critterId: string): boolean {
  return hasStorageKey(toolStorageKey(STORAGE_TOOL, critterId));
}

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

// ---------------------------------------------------------------------------
// Reference ruler — vertical bar with integer + 0.5 ticks up to 4 u.
// Yellow tick at 1.7 u marks the in-game target height (mirrors
// IN_GAME_TARGET_HEIGHT in src/critter.ts). The 1.7 u rectangle on the
// floor extends across the whole stage so each critter's head can be
// eyeballed against the same height regardless of grid cell.
// ---------------------------------------------------------------------------

const RULER_TARGET = 1.7; // IN_GAME_TARGET_HEIGHT — keep in sync with critter.ts

const rulerGroup = new THREE.Group();
rulerGroup.position.set(-6, 0, -3);

// Main vertical line 0..4u
{
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4, 0)];
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  rulerGroup.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xc0c5d0 })));
}

// Tick marks every 0.5u. Integer ticks longer + brighter, half ticks shorter + dimmer.
for (let y = 0; y <= 4 + 1e-9; y += 0.5) {
  const isInt = Math.abs(y - Math.round(y)) < 1e-6;
  const len = isInt ? 0.45 : 0.22;
  const colour = isInt ? 0xc0c5d0 : 0x808591;
  const pts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(len, y, 0)];
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  rulerGroup.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: colour })));
}

// Highlighted tick at the in-game target height. Drawn last so it
// renders on top of any nearby half/integer tick.
{
  const pts = [new THREE.Vector3(0, RULER_TARGET, 0), new THREE.Vector3(0.65, RULER_TARGET, 0)];
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  rulerGroup.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xffdc5c })));
}

scene.add(rulerGroup);

// Horizontal reference rectangle at y = RULER_TARGET around the stage —
// translucent yellow border so it doesn't compete with the grid for
// attention but is unmistakeably visible at the target height.
{
  const half = 6;
  const pts = [
    new THREE.Vector3(-half, RULER_TARGET, -half),
    new THREE.Vector3( half, RULER_TARGET, -half),
    new THREE.Vector3( half, RULER_TARGET,  half),
    new THREE.Vector3(-half, RULER_TARGET,  half),
    new THREE.Vector3(-half, RULER_TARGET, -half),
  ];
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: 0xffdc5c, transparent: true, opacity: 0.35 }),
  ));
}

// DOM labels for the ruler. Created once at boot and re-projected each
// frame from world → screen, same pattern the critter labels use. We
// only label a few values to keep the viewport clean: 0, 1, target, 2, 3, 4.
interface RulerLabel { worldPos: THREE.Vector3; el: HTMLDivElement; }
const rulerLabels: RulerLabel[] = [];
function addRulerLabel(text: string, world: THREE.Vector3, highlight: boolean): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.style.font = (highlight ? 'bold ' : '') + '10px ui-monospace, monospace';
  el.style.color = highlight ? '#ffdc5c' : 'rgba(220,220,230,0.55)';
  el.style.textShadow = '0 1px 2px rgba(0,0,0,0.9)';
  el.style.zIndex = '3';
  document.body.appendChild(el);
  rulerLabels.push({ worldPos: world.clone(), el });
}
addRulerLabel('0u',   new THREE.Vector3(-5.4, 0,             -3), false);
addRulerLabel('1u',   new THREE.Vector3(-5.4, 1,             -3), false);
addRulerLabel('1.7u', new THREE.Vector3(-5.0, RULER_TARGET,  -3), true);
addRulerLabel('2u',   new THREE.Vector3(-5.4, 2,             -3), false);
addRulerLabel('3u',   new THREE.Vector3(-5.4, 3,             -3), false);
addRulerLabel('4u',   new THREE.Vector3(-5.4, 4,             -3), false);

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
  // Reapply any saved working-copy transform for this critter so refresh
  // doesn't lose tuning. If localStorage diverges from the authored
  // RosterEntry, those values win in the lab (export still diffs against
  // code, so the user can still see what changed when they go to apply).
  const local = loadLocalFor(p.entry.id);
  const initial = local ?? {
    scale: p.entry.scale,
    pivotY: p.entry.pivotY,
    rotation: p.entry.rotation,
  };
  // Push the initial transform into the rosterOverride so procedural
  // animation tick doesn't clobber the loaded values.
  critter.rosterOverride = { ...critter.rosterOverride, scale: initial.scale, pivotY: initial.pivotY, rotation: initial.rotation };
  slots.push({
    entry: p.entry,
    holder: p.holder,
    critter,
    worldPos: p.worldPos,
    label: p.label,
    bindPoseHeight: null,
    rosterTransform: {
      scale: initial.scale,
      pivotY: initial.pivotY,
      rotationY: initial.rotation,
    },
  });
  // If the GLB is already bound to glbMesh by here (synchronous code path),
  // apply the transforms directly; the procedural tick will keep them
  // consistent on subsequent frames via rosterOverride.
  if (critter.glbMesh) {
    critter.glbMesh.scale.setScalar(initial.scale);
    critter.glbMesh.position.y = p.entry.offset[1] + initial.pivotY;
    critter.glbMesh.rotation.y = initial.rotation;
  }
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
// `val-*` IDs are now editable number inputs — typing a value drives
// the corresponding slider + the underlying transform. The ID kept
// the same so we don't break the existing markup convention.
const valScale = document.getElementById('val-scale') as HTMLInputElement;
const valPivot = document.getElementById('val-pivotY') as HTMLInputElement;
const valRot = document.getElementById('val-rotation') as HTMLInputElement;
const valTarget = document.getElementById('val-target') as HTMLInputElement;
const btnRefit = document.getElementById('btn-refit')!;
const btnExportTS = document.getElementById('btn-export-ts') as HTMLButtonElement;
const btnExportJSON = document.getElementById('btn-export-json') as HTMLButtonElement;
const btnDownloadJSON = document.getElementById('btn-download-json') as HTMLButtonElement;
const exportOut = document.getElementById('export-out')!;

// Optional UI added 2026-04-26: animation pause + camera presets. All
// query with null guards so the JS still works if the markup is rolled
// back / customised — the lab is internal-only and forks happen.
const chkAnimate = document.getElementById('chk-animate') as HTMLInputElement | null;
const btnCamFront = document.getElementById('btn-cam-front') as HTMLButtonElement | null;
const btnCamTop = document.getElementById('btn-cam-top') as HTMLButtonElement | null;
const btnCamSide = document.getElementById('btn-cam-side') as HTMLButtonElement | null;

// Optional UI: divergence indicator + per-critter reset button. Both are
// added in calibrate.html below the transform sliders. Querying with
// getElementById + null guards keeps the JS from breaking if the markup
// is rolled back / customised in the future.
const localIndicator = document.getElementById('local-indicator');
const btnResetLocal = document.getElementById('btn-reset-local') as HTMLButtonElement | null;

function selectSlot(idx: number): void {
  selectedSlotIdx = idx;
  const slot = slots[idx];
  if (!slot) return;
  // Sliders + numeric inputs enabled + synced with current values.
  [ctlScale, ctlPivot, ctlRot, valScale, valPivot, valRot].forEach((el) => (el.disabled = false));
  ctlScale.value = String(slot.rosterTransform.scale);
  ctlPivot.value = String(slot.rosterTransform.pivotY);
  ctlRot.value = String(slot.rosterTransform.rotationY);
  valScale.value = slot.rosterTransform.scale.toFixed(3);
  valPivot.value = slot.rosterTransform.pivotY.toFixed(3);
  valRot.value = slot.rosterTransform.rotationY.toFixed(3);

  infoEl.innerHTML = `
    <div class="row"><span class="k">Name</span><span class="v">${escapeHtml(slot.entry.displayName)}</span></div>
    <div class="row"><span class="k">Role</span><span class="v">${escapeHtml(slot.entry.role)}</span></div>
    <div class="row"><span class="k">GLB</span><span class="v">${escapeHtml(slot.entry.glbPath ?? 'none')}</span></div>
    <div class="row"><span class="k">Post-fit height</span><span class="v">${slot.bindPoseHeight?.toFixed(3) ?? '…'}</span></div>
  `;

  refreshLocalIndicator();
}

/** Update the "uses local working copy" hint + Reset button enabled
 *  state so they reflect the currently-selected slot. Called from
 *  selectSlot + every slider tick. */
function refreshLocalIndicator(): void {
  if (selectedSlotIdx === null) {
    if (localIndicator) {
      localIndicator.textContent = '';
      localIndicator.dataset.kind = 'none';
    }
    if (btnResetLocal) btnResetLocal.disabled = true;
    return;
  }
  const slot = slots[selectedSlotIdx]!;
  const has = hasLocalFor(slot.entry.id);
  if (localIndicator) {
    if (!has) {
      localIndicator.textContent = '— using authored roster.ts values';
      localIndicator.dataset.kind = 'code';
    } else {
      localIndicator.textContent = '⚠ local working copy active — Reset to revert to roster.ts';
      localIndicator.dataset.kind = 'local';
    }
  }
  if (btnResetLocal) btnResetLocal.disabled = !has;
}

// Set initial state of the indicator before a slot is selected.
refreshLocalIndicator();

if (btnResetLocal) {
  btnResetLocal.addEventListener('click', () => {
    if (selectedSlotIdx === null) return;
    const slot = slots[selectedSlotIdx]!;
    clearLocalFor(slot.entry.id);
    // Revert the in-memory transform to the authored roster values.
    const code: LocalCalibrate = {
      scale: slot.entry.scale,
      pivotY: slot.entry.pivotY,
      rotation: slot.entry.rotation,
    };
    slot.rosterTransform.scale = code.scale;
    slot.rosterTransform.pivotY = code.pivotY;
    slot.rosterTransform.rotationY = code.rotation;
    slot.critter.rosterOverride = {
      ...slot.critter.rosterOverride,
      scale: code.scale,
      pivotY: code.pivotY,
      rotation: code.rotation,
    };
    if (slot.critter.glbMesh) {
      slot.critter.glbMesh.scale.setScalar(code.scale);
      slot.critter.glbMesh.position.y = slot.entry.offset[1] + code.pivotY;
      slot.critter.glbMesh.rotation.y = code.rotation;
    }
    // Refresh sliders + indicator.
    selectSlot(selectedSlotIdx);
  });
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
/** Persist the current rosterTransform for a slot to localStorage and
 *  refresh the divergence indicator if the slot is selected. Called
 *  from every slider input — keystrokes are cheap to write and the UI
 *  feedback is instant. */
function persistSlot(slot: typeof slots[number]): void {
  saveLocalFor(slot.entry.id, {
    scale: slot.rosterTransform.scale,
    pivotY: slot.rosterTransform.pivotY,
    rotation: slot.rosterTransform.rotationY,
  });
  if (selectedSlotIdx !== null && slots[selectedSlotIdx] === slot) {
    refreshLocalIndicator();
  }
}

/** Apply a transform field change to the selected slot. Single source
 *  of truth for both slider drag and number-input typing — they each
 *  parse their value and call this with the parsed number plus a hint
 *  about which control originated the change so we only sync the other
 *  one (avoids fighting the user mid-edit). */
function applyScale(v: number, source: 'slider' | 'num'): void {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  if (!Number.isFinite(v)) return;
  slot.rosterTransform.scale = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, scale: v };
  if (slot.critter.glbMesh) slot.critter.glbMesh.scale.setScalar(v);
  if (source !== 'slider') ctlScale.value = String(v);
  if (source !== 'num')    valScale.value = v.toFixed(3);
  persistSlot(slot);
}
function applyPivot(v: number, source: 'slider' | 'num'): void {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  if (!Number.isFinite(v)) return;
  slot.rosterTransform.pivotY = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, pivotY: v };
  if (slot.critter.glbMesh) {
    // PivotY is layered onto offset.y on the inner group, so reset to
    // offset.y then add the new pivotY (procedural tick reads the same).
    slot.critter.glbMesh.position.y = slot.entry.offset[1] + v;
  }
  if (source !== 'slider') ctlPivot.value = String(v);
  if (source !== 'num')    valPivot.value = v.toFixed(3);
  persistSlot(slot);
}
function applyRot(v: number, source: 'slider' | 'num'): void {
  if (selectedSlotIdx === null) return;
  const slot = slots[selectedSlotIdx]!;
  if (!Number.isFinite(v)) return;
  slot.rosterTransform.rotationY = v;
  slot.critter.rosterOverride = { ...slot.critter.rosterOverride, rotation: v };
  if (slot.critter.glbMesh) slot.critter.glbMesh.rotation.y = v;
  if (source !== 'slider') ctlRot.value = String(v);
  if (source !== 'num')    valRot.value = v.toFixed(3);
  persistSlot(slot);
}

ctlScale.addEventListener('input', () => applyScale(+ctlScale.value, 'slider'));
ctlPivot.addEventListener('input', () => applyPivot(+ctlPivot.value, 'slider'));
ctlRot.addEventListener('input',   () => applyRot(+ctlRot.value,   'slider'));

// Number-input listeners — fire on every keystroke (`input`) for
// snappy preview, and again on blur/Enter (`change`) to commit a
// rounded value back to the field if the user typed an out-of-range
// number. Browser already clamps via min/max attributes; we only
// re-format on change so half-typed values aren't normalised mid-edit.
valScale.addEventListener('input',  () => applyScale(+valScale.value, 'num'));
valScale.addEventListener('change', () => {
  if (selectedSlotIdx !== null) valScale.value = slots[selectedSlotIdx]!.rosterTransform.scale.toFixed(3);
});
valPivot.addEventListener('input',  () => applyPivot(+valPivot.value, 'num'));
valPivot.addEventListener('change', () => {
  if (selectedSlotIdx !== null) valPivot.value = slots[selectedSlotIdx]!.rosterTransform.pivotY.toFixed(3);
});
valRot.addEventListener('input',  () => applyRot(+valRot.value, 'num'));
valRot.addEventListener('change', () => {
  if (selectedSlotIdx !== null) valRot.value = slots[selectedSlotIdx]!.rosterTransform.rotationY.toFixed(3);
});

// Apply-target slider has no rosterTransform behind it (it's a
// session-only fitting target read by btnRefit), so we just keep the
// numeric input + slider in sync here.
ctlTarget.addEventListener('input', () => { valTarget.value = (+ctlTarget.value).toFixed(2); });
valTarget.addEventListener('input', () => {
  const v = +valTarget.value;
  if (Number.isFinite(v)) ctlTarget.value = String(v);
});
valTarget.addEventListener('change', () => {
  valTarget.value = (+ctlTarget.value).toFixed(2);
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

// ---------------------------------------------------------------------------
// Export — three modes, all reading from the same `slots[].rosterTransform`
// ---------------------------------------------------------------------------
//
// 1. TS snippet — pastable directly into roster.ts replacing the
//    matching fields of each critter's RosterEntry. Snaps rotation
//    near multiples of π/2 to stay consistent with how roster.ts
//    expresses common rotations.
// 2. JSON patch — machine-applicable via scripts/apply-tool-patch.mjs.
//    Sparse: only critters whose values DIFFER from the authored
//    roster.ts are included.
// 3. JSON download — same as #2 but as a file the user can stash for
//    a later batch apply or share.

const EPSILON = 0.001;

interface CalibrateValues {
  scale: number;
  pivotY: number;
  rotation: number;
}

function getCodeValuesFor(id: string): CalibrateValues | null {
  const entry = getRosterEntry(slotsByIdLookup(id) ?? '');
  if (!entry) return null;
  return { scale: entry.scale, pivotY: entry.pivotY, rotation: entry.rotation };
}

function slotsByIdLookup(id: string): string | null {
  // Map roster id (lowercase) → display name used by getRosterEntry.
  const slot = slots.find((s) => s.entry.id === id);
  return slot ? slot.entry.displayName : null;
}

/** Detect which slots have been modified vs the authored roster. Used
 *  to keep the JSON patch sparse and the TS snippet focused. */
function modifiedSlots(): Array<{ slot: typeof slots[number]; current: CalibrateValues; code: CalibrateValues }> {
  const out: Array<{ slot: typeof slots[number]; current: CalibrateValues; code: CalibrateValues }> = [];
  for (const slot of slots) {
    const code = getCodeValuesFor(slot.entry.id);
    if (!code) continue;
    const current: CalibrateValues = {
      scale: slot.rosterTransform.scale,
      pivotY: slot.rosterTransform.pivotY,
      rotation: slot.rosterTransform.rotationY,
    };
    const diff =
      Math.abs(current.scale - code.scale) > EPSILON
      || Math.abs(current.pivotY - code.pivotY) > EPSILON
      || Math.abs(current.rotation - code.rotation) > EPSILON;
    if (diff) out.push({ slot, current, code });
  }
  return out;
}

/** Format a rotation value preserving roster.ts conventions: snap to
 *  ±π/2, ±π, 0 if within ~0.01 rad of those anchors; otherwise emit
 *  a 4-decimal literal. Keeps the diff readable when the user nudged
 *  rotation slightly off a clean angle. */
function formatRotation(r: number): string {
  const SNAP = 0.01;
  if (Math.abs(r) < SNAP) return '0';
  if (Math.abs(r - Math.PI / 2) < SNAP) return 'Math.PI / 2';
  if (Math.abs(r + Math.PI / 2) < SNAP) return '-Math.PI / 2';
  if (Math.abs(r - Math.PI) < SNAP) return 'Math.PI';
  if (Math.abs(r + Math.PI) < SNAP) return '-Math.PI';
  return r.toFixed(4);
}

function buildTsSnippet(): string {
  const mods = modifiedSlots();
  if (mods.length === 0) {
    return '(no changes — modify any slider, then export)';
  }
  const lines: string[] = [];
  lines.push('// --- Calibrate export — paste each block inside the');
  lines.push('//     matching RosterEntry in src/roster.ts ---');
  lines.push('');
  for (const { slot, current } of mods) {
    lines.push(`// ${slot.entry.displayName} (id: '${slot.entry.id}')`);
    lines.push(
      `    scale: ${current.scale.toFixed(3)}, rotation: ${formatRotation(current.rotation)}, ` +
      `offset: [0, 0, 0],`,
    );
    lines.push(
      `    physicsRadius: R, pivotY: ${current.pivotY.toFixed(3)},`,
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function buildJsonPatch(): CalibratePatch {
  const data: CalibratePatch['data'] = {};
  for (const { slot, current } of modifiedSlots()) {
    data[slot.entry.id] = {
      scale: +current.scale.toFixed(4),
      pivotY: +current.pivotY.toFixed(4),
      rotation: +current.rotation.toFixed(4),
    };
  }
  return makeToolPatch<CalibratePatch>('calibrate', data);
}

btnExportTS.addEventListener('click', () => {
  const out = buildTsSnippet();
  exportOut.textContent = out;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(out).catch(() => { /* on-screen pre is the fallback */ });
  }
  console.log(out);
});

btnExportJSON.addEventListener('click', async () => {
  const patch = buildJsonPatch();
  const out = JSON.stringify(patch, null, 2);
  exportOut.textContent = out;
  await copyPatchToClipboard(patch);
  console.log(out);
});

btnDownloadJSON.addEventListener('click', () => {
  const patch = buildJsonPatch();
  exportOut.textContent = JSON.stringify(patch, null, 2);
  downloadPatch(patch);
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

// Camera presets — three named viewpoints tuned to the 3×3 grid + ruler:
//   · frontal  — slight perspective, full grid in frame, ruler visible.
//   · cenital  — straight down, useful for spacing checks (less so for
//     calibration, but handy to see the layout).
//   · lateral  — from +X (3 o'clock), shows height profile against the
//     ruler clearly. Best preset for size calibration.
function setCamera(theta: number, phi: number, radius: number): void {
  orbitTheta = theta;
  orbitPhi = phi;
  orbitRadius = radius;
  updateCamera();
}
btnCamFront?.addEventListener('click', () => setCamera(0,            0.30, 14));
btnCamTop?.addEventListener('click',   () => setCamera(0,            Math.PI / 2 - 0.05, 14));
btnCamSide?.addEventListener('click',  () => setCamera(Math.PI / 2,  0.20, 14));

// ---------------------------------------------------------------------------
// Animation pause toggle
// ---------------------------------------------------------------------------
//
// Idle bob makes the 9-up grid jittery for size calibration. Default
// off (paused) — flip the checkbox to verify silhouette under motion.
// We pass dt=0 to critter.update when paused: the procedural tick
// still runs (so rosterOverride re-applies after slider drags) but
// the skeletal mixer + bob phase don't advance time.

let animationPaused = !(chkAnimate?.checked ?? false);
chkAnimate?.addEventListener('change', () => {
  animationPaused = !chkAnimate.checked;
});

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
  // Ruler tick labels — same projection trick. Pinned to fixed world
  // positions next to the vertical ruler bar at (-6, *, -3).
  for (const r of rulerLabels) {
    projected.copy(r.worldPos);
    projected.project(camera);
    if (projected.z > 1) {
      r.el.style.display = 'none';
    } else {
      r.el.style.display = '';
      r.el.style.left = `${(projected.x * 0.5 + 0.5) * w}px`;
      r.el.style.top = `${(-projected.y * 0.5 + 0.5) * h}px`;
      r.el.style.transform = 'translate(0, -50%)';
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
  // When animation is paused (default) we pass dt=0 — the procedural
  // tick still re-applies rosterOverride (so slider drags survive a
  // frame) but mixer + bob phase don't advance time.
  const effectiveDt = animationPaused ? 0 : dt;
  for (const slot of slots) {
    slot.critter.update(effectiveDt);
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
