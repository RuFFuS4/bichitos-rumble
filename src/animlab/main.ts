// ---------------------------------------------------------------------------
// Animation Lab — `/anim-lab.html`
// ---------------------------------------------------------------------------
//
// Per-critter, per-state clip + playback config. Mental model:
//
//   logical state → (clip, speed, loop) → play
//
// Single primary table per critter:
//
//   ┌────────────┬────────────────────┬───────┬────┬─────┬──────────┐
//   │ State      │ Clip               │ Speed │ ⤴  │Play │ Status   │
//   ├────────────┼────────────────────┼───────┼────┼─────┼──────────┤
//   │ idle       │ [Idle ▼]           │[1.00] │ ✓  │  ▶  │ auto     │
//   │ run        │ [Run ▼]            │[1.15] │ ✓  │  ▶  │ override │
//   │ ability_1  │ [(auto: Slam) ▼]   │[1.00] │    │  ▶  │ auto     │
//   │ ability_2  │ [Custom ▼]         │[0.90] │    │  ▶  │ override │
//   │ ability_3  │ [(auto: KO) ▼]     │[1.00] │    │  ▶  │ auto     │
//   │ victory    │ ...                │       │    │     │          │
//   │ defeat     │                    │       │    │     │          │
//   │ fall       │                    │       │    │     │          │
//   └────────────┴────────────────────┴───────┴────┴─────┴──────────┘
//
// Single source of truth per row: `getRowState(id, state)` reads from
// (in priority order) the user's session edits, the authored baseline,
// or sensible defaults. Every other surface — Play button, dropdown,
// speed input, loop checkbox, status badge, export — derives from that
// one read. This is the fix for the previous build's stale-closure bug
// where Play replayed the original auto clip after the user had
// changed the dropdown.
//
// State sync
//   · `rowStates[id]` is per-critter Map<SkeletalState, RowState>.
//   · Every interaction routes through `updateRowState(id, state,
//     partial)` which:
//        1. Stores the new RowState.
//        2. Calls `syncToSession(id)` which projects the row state
//           into `sessionOverrides[id]` in the AnimLabStateValue
//           shape (string shorthand if only `clip`, object form if
//           `speed`/`loop` differ from defaults).
//        3. The export builders read `sessionOverrides` directly and
//           bump the patch version to 2 if any object-form entry is
//           present.
//   · `loadCritter()` merges `AUTHORED_BASELINE[id]` with
//     `sessionOverrides[id]` into the live `ANIMATION_OVERRIDES[id]`
//     so the new SkeletalAnimator's resolver sees both.
//
// Speed/loop runtime
//   · The lab applies speed via the extended
//     `SkeletalAnimator.playClipByName(clip, loop, speed)` (third arg
//     was added 2026-04-27, defaults to 1).
//   · The GAME runtime currently only reads `clip` via
//     `getClipOverride()`. speed/loop are TOOLING METADATA — they
//     ship in `ANIMATION_OVERRIDES` source but the resolver doesn't
//     act on them yet. Documented in `animation-overrides.ts`.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getDisplayRoster, type RosterEntry } from '../roster';
import { Critter, CRITTER_PRESETS } from '../critter';
import type { SkeletalState } from '../critter-skeletal';
import { ANIMATION_OVERRIDES, type ClipOverrideMap } from '../animation-overrides';
import {
  makeToolPatch,
  copyPatchToClipboard,
  downloadPatch,
  type AnimLabPatch,
  type AnimLabClipMeta,
  type AnimLabStateValue,
} from '../tools/tool-storage';

const AUTHORED_BASELINE: Record<string, ClipOverrideMap> = JSON.parse(
  JSON.stringify(ANIMATION_OVERRIDES),
);

// ---------------------------------------------------------------------------
// State sets + defaults
// ---------------------------------------------------------------------------

const PRIMARY_STATES: SkeletalState[] = [
  'idle', 'run', 'ability_1', 'ability_2', 'ability_3',
  'victory', 'defeat', 'fall',
];
const SECONDARY_STATES: SkeletalState[] = [
  'walk', 'headbutt_anticip', 'headbutt_lunge', 'hit', 'respawn',
];

/** Loop default per state — mirrors LOOPING_STATES in critter-skeletal.ts.
 *  States not in this set play once and don't loop by default. */
const LOOPING_DEFAULT = new Set<SkeletalState>(['idle', 'walk', 'run']);
function defaultLoopFor(state: SkeletalState): boolean {
  return LOOPING_DEFAULT.has(state);
}

const AUTO = '__auto__';
const NONE = '__none__';
type DropdownChoice = typeof AUTO | typeof NONE | string;

interface RowState {
  /** Dropdown selection: AUTO / NONE / specific clip name. */
  clipChoice: DropdownChoice;
  /** Playback speed multiplier (1 = real-time). */
  speed: number;
  /** Loop flag. `null` means "follow the state's default" (idle/walk/
   *  run loop, others don't). User-set true/false overrides. */
  loop: boolean | null;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.body.firstChild);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x12131a);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0x9cc7ea, 0x2a261a, 0.55));
const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9cb8ff, 0.45);
rim.position.set(-4, 4, -3);
scene.add(rim);
scene.add(new THREE.GridHelper(10, 10, 0x444a5c, 0x2a2f3d));

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 2.2, 5.5);
camera.lookAt(0, 1, 0);

// ---------------------------------------------------------------------------
// Critter holder + state
// ---------------------------------------------------------------------------

const holder = new THREE.Group();
scene.add(holder);
let critter: Critter | null = null;

/** Per-critter row states. Lazy: an entry only lands here once the
 *  user has interacted with a row. Read via `getRowState(id, state)`
 *  which falls back to authored / defaults when no entry exists. */
const rowStates: Record<string, Map<SkeletalState, RowState>> = {};

/** Projected from `rowStates` by `syncToSession` after every edit.
 *  Read-only mirror used by:
 *    · `loadCritter` — to merge into `ANIMATION_OVERRIDES`.
 *    · The export builders — to emit the patch payload. */
const sessionOverrides: Record<string, Partial<Record<SkeletalState, AnimLabStateValue>>> = {};

let currentId: string | null = null;
let needsPanelRefresh = false;
let currentlyPlayingState: SkeletalState | null = null;
let currentlyPlayingClip: string | null = null;

function disposeMeshTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) for (const mm of mat) mm.dispose();
      else if (mat) (mat as THREE.Material).dispose();
    }
  });
}

function loadCritter(entry: RosterEntry): void {
  const preset = CRITTER_PRESETS.find((c) => c.name === entry.displayName);
  if (!preset) {
    console.warn('[anim-lab] no preset found for', entry.displayName);
    return;
  }
  if (critter) {
    holder.remove(critter.mesh);
    disposeMeshTree(critter.mesh);
    critter = null;
  }
  // Merge authored baseline + session real overrides into the live
  // ANIMATION_OVERRIDES so the new SkeletalAnimator's getClipOverride
  // hits read them. Both maps store AnimLabStateValue (string OR
  // object), the resolver normalises on read.
  const entryId = entry.id;
  const authored = AUTHORED_BASELINE[entryId] ?? {};
  const session = sessionOverrides[entryId] ?? {};
  const merged: ClipOverrideMap = { ...authored, ...session };
  if (Object.keys(merged).length > 0) {
    ANIMATION_OVERRIDES[entryId] = merged;
  } else {
    delete ANIMATION_OVERRIDES[entryId];
  }

  const c = new Critter(preset, scene);
  scene.remove(c.mesh);
  holder.add(c.mesh);
  critter = c;
  currentId = entryId;
  currentlyPlayingState = null;
  currentlyPlayingClip = null;

  refreshAllPanels();
  needsPanelRefresh = true;
}

// ---------------------------------------------------------------------------
// Roster panel (left)
// ---------------------------------------------------------------------------

const playableRoster = getDisplayRoster().filter((e) => e.status === 'playable');

const rosterCards = document.getElementById('roster-cards')!;
for (const entry of playableRoster) {
  const card = document.createElement('div');
  card.className = 'roster-card';
  card.dataset.id = entry.id;
  card.innerHTML = `${entry.displayName}<span class="role">${entry.role}</span>`;
  card.addEventListener('click', () => {
    document.querySelectorAll('.roster-card').forEach((el) => el.classList.remove('active'));
    card.classList.add('active');
    loadCritter(entry);
  });
  rosterCards.appendChild(card);
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const selectedName = document.getElementById('selected-name')!;
const selectedSub = document.getElementById('selected-sub')!;

const npBox = document.getElementById('np-box')!;
const npStateEl = document.getElementById('np-state')!;
const npClipEl = document.getElementById('np-clip')!;

const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;

const mappingRowsEl = document.getElementById('mapping-rows')!;
const auxMappingRowsEl = document.getElementById('aux-mapping-rows')!;
const clipListEl = document.getElementById('clip-list')!;
const duplicateWarningEl = document.getElementById('duplicate-warning')!;

const btnApply = document.getElementById('btn-apply') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnPreviewAll = document.getElementById('btn-preview-all') as HTMLButtonElement;

const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;
const btnDownloadJson = document.getElementById('btn-download-json') as HTMLButtonElement;
const exportOut = document.getElementById('export-out')!;

// ---------------------------------------------------------------------------
// Row state helpers — single source of truth
// ---------------------------------------------------------------------------

/** Read the current row state for (id, state). Order of resolution:
 *
 *   1. Session edit in `rowStates[id]` (user has touched this row).
 *   2. Authored baseline in `ANIMATION_OVERRIDES` source — string or
 *      object form.
 *   3. Defaults: AUTO / 1.0 / null (follow state default loop).
 */
function getRowState(id: string, state: SkeletalState): RowState {
  const stored = rowStates[id]?.get(state);
  if (stored) return stored;
  const authored = AUTHORED_BASELINE[id]?.[state];
  if (authored != null) {
    if (typeof authored === 'string') {
      return { clipChoice: authored, speed: 1, loop: null };
    }
    return {
      clipChoice: authored.clip,
      speed: typeof authored.speed === 'number' ? authored.speed : 1,
      loop: typeof authored.loop === 'boolean' ? authored.loop : null,
    };
  }
  return { clipChoice: AUTO, speed: 1, loop: null };
}

/** Mutate a row's state and rebuild the sessionOverrides projection.
 *  Every UI handler funnels through here — no other surface writes
 *  to `rowStates` directly. */
function updateRowState(id: string, state: SkeletalState, patch: Partial<RowState>): void {
  const cur = getRowState(id, state);
  const next: RowState = { ...cur, ...patch };
  (rowStates[id] ??= new Map()).set(state, next);
  syncToSession(id);
}

/** Project `rowStates[id]` into `sessionOverrides[id]` in the
 *  AnimLabStateValue shape the patch + ANIMATION_OVERRIDES merge
 *  consume. Called after every UI edit. */
function syncToSession(id: string): void {
  const map = rowStates[id];
  if (!map || map.size === 0) {
    delete sessionOverrides[id];
    return;
  }
  const entry: Partial<Record<SkeletalState, AnimLabStateValue>> = {};
  for (const [state, rs] of map.entries()) {
    const v = buildSessionValueFor(state, rs);
    if (v !== null) entry[state] = v;
  }
  if (Object.keys(entry).length === 0) delete sessionOverrides[id];
  else sessionOverrides[id] = entry;
}

/** Compute the single AnimLabStateValue for a row, or null if the row
 *  contributes nothing to the patch (Auto with no metadata; None;
 *  Auto with metadata but no resolvable clip name). */
function buildSessionValueFor(state: SkeletalState, rs: RowState): AnimLabStateValue | null {
  if (rs.clipChoice === NONE) return null;
  const speedNonDefault = rs.speed !== 1;
  const loopNonDefault = rs.loop !== null && rs.loop !== defaultLoopFor(state);
  let clipName: string | null;
  if (rs.clipChoice === AUTO) {
    // Auto + no metadata = nothing to export. Auto + metadata snapshots
    // the auto-resolved clip so the patch is self-contained.
    if (!speedNonDefault && !loopNonDefault) return null;
    clipName = resolveAutoClipFor(state);
    if (!clipName) return null;
  } else {
    clipName = rs.clipChoice;
  }
  if (!speedNonDefault && !loopNonDefault) return clipName;
  const obj: AnimLabClipMeta = { clip: clipName };
  if (speedNonDefault) obj.speed = rs.speed;
  if (loopNonDefault) obj.loop = rs.loop!;
  return obj;
}

/** Live-resolve what the auto-tier resolver would pick for `state`.
 *  Returns null when missing. Used by the dropdown's `(auto: …)`
 *  label, the Play button's clip resolution, and `buildSessionValueFor`. */
function resolveAutoClipFor(state: SkeletalState): string | null {
  if (!critter?.skeletal) return null;
  const r = critter.skeletal.getResolveReport().find((x) => x.state === state);
  return r?.clipName ?? null;
}

/** Resolve the actual clip that should play for a state, taking the
 *  user's current dropdown choice into account. Returns null when
 *  None or missing. */
function resolveClipForRow(state: SkeletalState): string | null {
  if (!currentId) return null;
  const rs = getRowState(currentId, state);
  if (rs.clipChoice === NONE) return null;
  if (rs.clipChoice === AUTO) return resolveAutoClipFor(state);
  return rs.clipChoice;
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

function refreshAllPanels(): void {
  if (!critter) {
    selectedName.textContent = '—';
    selectedSub.textContent = 'select a critter';
    mappingRowsEl.innerHTML = '';
    auxMappingRowsEl.innerHTML = '';
    clipListEl.innerHTML = '';
    duplicateWarningEl.style.display = 'none';
    updateNowPlaying(null, null);
    return;
  }
  selectedName.textContent = critter.config.name;
  const clipsCount = critter.skeletal?.availableClipNames.length ?? 0;
  selectedSub.textContent = `id: ${currentId} · ${clipsCount} clip${clipsCount === 1 ? '' : 's'} in GLB`;

  buildMappingTable();
  buildAuxMappingTable();
  buildClipList();
  refreshDuplicateWarning();

  // Auto-play idle on first load if it has a clip — otherwise the
  // viewport is just a frozen pose and the user has no signal that
  // anything works.
  if (currentId && critter.skeletal && currentlyPlayingState === null) {
    if (resolveClipForRow('idle')) playRow('idle');
  }
}

function buildMappingTable(): void {
  mappingRowsEl.innerHTML = '';
  if (!critter?.skeletal || !currentId) return;
  for (const state of PRIMARY_STATES) {
    mappingRowsEl.appendChild(buildMappingRow(state, /*primary=*/ true));
  }
}

function buildAuxMappingTable(): void {
  auxMappingRowsEl.innerHTML = '';
  if (!critter?.skeletal || !currentId) return;
  for (const state of SECONDARY_STATES) {
    auxMappingRowsEl.appendChild(buildMappingRow(state, /*primary=*/ false));
  }
}

function buildMappingRow(state: SkeletalState, isPrimary: boolean): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset.state = state;
  if (currentlyPlayingState === state) tr.classList.add('playing');

  const report = critter!.skeletal!.getResolveReport();
  const reportRow = report.find((r) => r.state === state)!;
  const autoClipName = reportRow.clipName;
  const autoSource = reportRow.source;
  const available = critter!.skeletal!.getRawClipNames();
  const rs = getRowState(currentId!, state);
  const effectiveLoop = rs.loop ?? defaultLoopFor(state);

  const autoLabel = autoClipName ? `(auto: ${autoClipName})` : '(auto: unresolved)';
  const opts = [
    `<option value="${AUTO}">${escapeHtml(autoLabel)}</option>`,
    `<option value="${NONE}">(none — explicitly no clip)</option>`,
    ...available.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`),
  ].join('');

  const tierHtml = autoSource && autoSource !== 'missing'
    ? `<span class="badge tier-${autoSource}">${autoSource}</span>`
    : '<span class="badge missing">—</span>';

  if (isPrimary) {
    tr.innerHTML = `
      <td class="state-name">${state}</td>
      <td class="clip-cell"><select aria-label="Clip for ${state}">${opts}</select></td>
      <td class="speed-cell"><input class="speed-input" type="number" min="0.1" max="3.0" step="0.05" value="${rs.speed.toFixed(2)}" aria-label="Speed for ${state}" /></td>
      <td class="loop-cell"><input class="loop-input" type="checkbox" aria-label="Loop ${state}" ${effectiveLoop ? 'checked' : ''} /></td>
      <td class="play-cell"><button class="play-btn" aria-label="Play ${state}">▶</button></td>
      <td class="status-cell"></td>
    `;
  } else {
    tr.innerHTML = `
      <td class="state-name">${state}</td>
      <td class="clip-cell"><select aria-label="Clip for ${state}">${opts}</select></td>
      <td class="speed-cell"><input class="speed-input" type="number" min="0.1" max="3.0" step="0.05" value="${rs.speed.toFixed(2)}" aria-label="Speed for ${state}" /></td>
      <td class="loop-cell"><input class="loop-input" type="checkbox" aria-label="Loop ${state}" ${effectiveLoop ? 'checked' : ''} /></td>
      <td class="play-cell"><button class="play-btn" aria-label="Play ${state}">▶</button></td>
      <td class="tier-cell">${tierHtml}</td>
    `;
  }

  // Wire the select.
  const select = tr.querySelector('select') as HTMLSelectElement;
  select.value = rs.clipChoice;
  syncRowVisualState(tr, state);
  select.addEventListener('change', () => {
    onClipChange(state, select.value as DropdownChoice, tr);
  });

  // Speed input.
  const speedInput = tr.querySelector('.speed-input') as HTMLInputElement;
  speedInput.addEventListener('input', () => {
    const v = +speedInput.value;
    if (!Number.isFinite(v) || v <= 0) return;
    onSpeedChange(state, v, tr);
  });
  speedInput.addEventListener('change', () => {
    // Re-format on commit so half-typed values normalise.
    if (!currentId) return;
    const live = getRowState(currentId, state);
    speedInput.value = live.speed.toFixed(2);
  });

  // Loop checkbox.
  const loopInput = tr.querySelector('.loop-input') as HTMLInputElement;
  loopInput.addEventListener('change', () => {
    onLoopChange(state, loopInput.checked, tr);
  });

  // Play button — reads LIVE state every click. Fixes the previous
  // build's bug where stale closure over `rs` made Play replay the
  // original auto clip even after the dropdown changed.
  const playBtn = tr.querySelector('.play-btn') as HTMLButtonElement;
  playBtn.addEventListener('click', () => {
    playRow(state);
  });

  return tr;
}

/** Refresh the row's badge + override-styling based on the LIVE row
 *  state. Called after every onClipChange / onSpeedChange / onLoopChange. */
function syncRowVisualState(tr: HTMLTableRowElement, state: SkeletalState): void {
  if (!currentId) return;
  const rs = getRowState(currentId, state);
  const select = tr.querySelector('select') as HTMLSelectElement;
  select.classList.toggle('override', rs.clipChoice !== AUTO && rs.clipChoice !== NONE);

  const playBtn = tr.querySelector('.play-btn') as HTMLButtonElement;
  const clipName = resolveClipForRow(state);
  playBtn.disabled = clipName === null;

  const statusCell = tr.querySelector('.status-cell');
  if (statusCell) statusCell.innerHTML = computeBadge(state, rs);

  // Sync speed/loop input visual state — slight yellow tint when
  // non-default so user sees at a glance which rows are tuned.
  const speedInput = tr.querySelector('.speed-input') as HTMLInputElement | null;
  if (speedInput) speedInput.classList.toggle('override', rs.speed !== 1);
  const loopInput = tr.querySelector('.loop-input') as HTMLInputElement | null;
  if (loopInput) {
    const loopOverridden = rs.loop !== null && rs.loop !== defaultLoopFor(state);
    loopInput.classList.toggle('override', loopOverridden);
  }
}

function computeBadge(state: SkeletalState, rs: RowState): string {
  if (rs.clipChoice === NONE) return '<span class="badge missing">none</span>';
  const hasMetadata = rs.speed !== 1 || (rs.loop !== null && rs.loop !== defaultLoopFor(state));
  if (rs.clipChoice === AUTO) {
    const auto = resolveAutoClipFor(state);
    if (!auto) return '<span class="badge missing">missing</span>';
    return hasMetadata
      ? '<span class="badge override">override</span>'
      : '<span class="badge auto">auto</span>';
  }
  return '<span class="badge override">override</span>';
}

function onClipChange(state: SkeletalState, v: DropdownChoice, tr: HTMLTableRowElement): void {
  if (!currentId) return;
  updateRowState(currentId, state, { clipChoice: v });
  syncRowVisualState(tr, state);
  refreshDuplicateWarning();

  if (v === NONE) {
    if (critter?.skeletal && currentlyPlayingState === state) {
      critter.skeletal.stopAll();
      currentlyPlayingState = null;
      currentlyPlayingClip = null;
      updateNowPlaying(null, null);
    }
    return;
  }
  // Skip replay when the resolved clip is unchanged (e.g. picking
  // "Idle" explicitly when the row was already on Auto-resolves-to-
  // Idle). Avoids the visible snap-back-to-t=0 when the user is just
  // confirming the current selection.
  const newClip = resolveClipForRow(state);
  if (currentlyPlayingState === state && currentlyPlayingClip === newClip) {
    return;
  }
  playRow(state);
}

function onSpeedChange(state: SkeletalState, v: number, tr: HTMLTableRowElement): void {
  if (!currentId) return;
  updateRowState(currentId, state, { speed: v });
  syncRowVisualState(tr, state);
  // Live-update the running action's time scale instead of a full
  // replay. Each keystroke in the speed input fires `input`, so a
  // replay-per-keystroke would `action.reset()` + fadeIn the clip
  // every character — bones flicker back to t=0 visibly. The live
  // path keeps the clip's playhead and just changes the rate.
  if (currentlyPlayingState === state && currentlyPlayingClip && critter?.skeletal) {
    const updated = critter.skeletal.setRunningClipTimeScale(currentlyPlayingClip, v);
    const rs = getRowState(currentId, state);
    const exportLoop = rs.loop ?? defaultLoopFor(state);
    if (updated) {
      updateNowPlaying(state, currentlyPlayingClip, v, exportLoop);
    } else {
      // Action wasn't found (shouldn't happen mid-preview but guard).
      playRow(state);
    }
  }
}

function onLoopChange(state: SkeletalState, v: boolean, tr: HTMLTableRowElement): void {
  if (!currentId) return;
  // The loop checkbox drives the EXPORT (what ships in the patch +
  // ANIMATION_OVERRIDES) but does NOT affect lab preview — preview
  // always loops so one-shot states (ability/victory/fall/...) don't
  // freeze at the last frame and look "broken" while the user is
  // browsing. See playRow for the preview-always-loops decision.
  updateRowState(currentId, state, { loop: v });
  syncRowVisualState(tr, state);
  // Refresh the now-playing label so the user sees what their
  // current loop setting will export as.
  if (currentlyPlayingState === state && currentlyPlayingClip) {
    const rs = getRowState(currentId, state);
    updateNowPlaying(state, currentlyPlayingClip, rs.speed, v);
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/** Play whatever clip the LIVE row state resolves to. Preview ALWAYS
 *  loops — the row's loop checkbox is the EXPORT setting (what ends
 *  up in `ANIMATION_OVERRIDES`), not the lab playback flag. Without
 *  this decoupling, one-shot states (ability_*, victory, defeat,
 *  fall) clamp at the last frame after one play and look frozen, even
 *  though the clip itself is fine.
 *
 *  Speed honours the row's value so the user can preview at the
 *  intended playback rate.
 *
 *  The "Now playing" banner displays the row's EXPORT loop value, not
 *  the preview's `true` — so the user can see what their patch will
 *  contain even though the visualisation cycles. */
function playRow(state: SkeletalState): void {
  if (!currentId || !critter?.skeletal) return;
  const rs = getRowState(currentId, state);
  const clipName = resolveClipForRow(state);
  if (!clipName) return;
  const PREVIEW_LOOP = true;
  const ok = critter.skeletal.playClipByName(clipName, PREVIEW_LOOP, rs.speed);
  if (!ok) return;
  currentlyPlayingState = state;
  currentlyPlayingClip = clipName;
  const exportLoop = rs.loop ?? defaultLoopFor(state);
  updateNowPlaying(state, clipName, rs.speed, exportLoop);
}

btnStop.addEventListener('click', () => {
  if (!critter?.skeletal) return;
  critter.skeletal.stopAll();
  currentlyPlayingState = null;
  currentlyPlayingClip = null;
  updateNowPlaying(null, null);
  stopPreviewAll();
});

// ---------------------------------------------------------------------------
// Apply / Reset / Preview all
// ---------------------------------------------------------------------------

btnApply.addEventListener('click', () => {
  const activeCard = document.querySelector('.roster-card.active') as HTMLElement | null;
  const id = activeCard?.dataset.id;
  if (!id) return;
  const entry = playableRoster.find((e) => e.id === id);
  if (entry) loadCritter(entry);
});

btnReset.addEventListener('click', () => {
  if (!currentId) return;
  delete rowStates[currentId];
  delete sessionOverrides[currentId];
  delete ANIMATION_OVERRIDES[currentId];
  const authored = AUTHORED_BASELINE[currentId];
  if (authored && Object.keys(authored).length > 0) {
    ANIMATION_OVERRIDES[currentId] = { ...authored };
  }
  const activeCard = document.querySelector('.roster-card.active') as HTMLElement | null;
  const id = activeCard?.dataset.id;
  if (!id) return;
  const entry = playableRoster.find((e) => e.id === id);
  if (entry) loadCritter(entry);
});

let previewAllTimer: number | null = null;
let previewAllIdx = 0;
const PREVIEW_ALL_MS = 2000;

function stopPreviewAll(): void {
  if (previewAllTimer !== null) {
    window.clearTimeout(previewAllTimer);
    previewAllTimer = null;
  }
  btnPreviewAll.textContent = '▶ Preview all';
}

btnPreviewAll.addEventListener('click', () => {
  if (previewAllTimer !== null) {
    stopPreviewAll();
    return;
  }
  previewAllIdx = 0;
  const tickPreview = (): void => {
    if (previewAllIdx >= PRIMARY_STATES.length) {
      stopPreviewAll();
      return;
    }
    const state = PRIMARY_STATES[previewAllIdx]!;
    previewAllIdx++;
    const clip = resolveClipForRow(state);
    if (clip) {
      playRow(state);
      previewAllTimer = window.setTimeout(tickPreview, PREVIEW_ALL_MS);
    } else {
      previewAllTimer = window.setTimeout(tickPreview, 200);
    }
  };
  tickPreview();
  btnPreviewAll.textContent = '⏹ Stop preview';
});

// ---------------------------------------------------------------------------
// Now-playing indicator + row highlight
// ---------------------------------------------------------------------------

function updateNowPlaying(
  state: SkeletalState | null,
  clipName: string | null,
  speed?: number,
  loop?: boolean,
): void {
  if (!state && !clipName) {
    npBox.classList.add('idle');
    npStateEl.textContent = '—';
    npClipEl.textContent = 'none';
  } else {
    npBox.classList.remove('idle');
    npStateEl.textContent = state ?? '(raw clip)';
    let label = clipName ?? '(no clip)';
    if (typeof speed === 'number') label += ` · ${speed.toFixed(2)}×`;
    if (typeof loop === 'boolean') label += ` · loop ${loop ? 'on' : 'off'}`;
    npClipEl.textContent = label;
  }
  document.querySelectorAll('#mapping-rows tr, #aux-mapping-rows tr').forEach((tr) => {
    tr.classList.toggle('playing', tr.getAttribute('data-state') === state);
  });
  document.querySelectorAll('.clip-row').forEach((row) => {
    row.classList.toggle('playing', row.getAttribute('data-clip') === clipName);
  });
}

// ---------------------------------------------------------------------------
// Duplicate-clip warning
// ---------------------------------------------------------------------------

function refreshDuplicateWarning(): void {
  if (!currentId || !critter?.skeletal) {
    duplicateWarningEl.style.display = 'none';
    duplicateWarningEl.innerHTML = '';
    return;
  }
  const usage = new Map<string, SkeletalState[]>();
  const allStates = [...PRIMARY_STATES, ...SECONDARY_STATES];
  for (const state of allStates) {
    const clipName = resolveClipForRow(state);
    if (!clipName) continue;
    const arr = usage.get(clipName) ?? [];
    arr.push(state);
    usage.set(clipName, arr);
  }
  const dupes = [...usage.entries()].filter(([, arr]) => arr.length >= 2);
  if (dupes.length === 0) {
    duplicateWarningEl.style.display = 'none';
    duplicateWarningEl.innerHTML = '';
    return;
  }
  duplicateWarningEl.style.display = 'block';
  duplicateWarningEl.innerHTML = dupes
    .map(
      ([clip, states]) =>
        `⚠ <b>${escapeHtml(states.join(' + '))}</b> all use <code>${escapeHtml(clip)}</code>`,
    )
    .join('<br>');
}

// ---------------------------------------------------------------------------
// Raw clip list (Advanced)
// ---------------------------------------------------------------------------

function buildClipList(): void {
  clipListEl.innerHTML = '';
  if (!critter?.skeletal) {
    clipListEl.innerHTML = '<div class="clip-row"><span class="name" style="grid-column:1/-1;opacity:0.55">(no skeletal animator — this GLB ships no clips)</span></div>';
    return;
  }
  const clips = critter.skeletal.listClips();
  if (clips.length === 0) {
    clipListEl.innerHTML = '<div class="clip-row"><span class="name" style="grid-column:1/-1;opacity:0.55">(empty clip list)</span></div>';
    return;
  }
  for (const c of clips) {
    const row = document.createElement('div');
    row.className = 'clip-row';
    row.dataset.clip = c.name;
    if (currentlyPlayingClip === c.name) row.classList.add('playing');
    const stateLabel = c.state
      ? `<span class="state-tag resolved">→ ${c.state}</span>`
      : '<span class="state-tag none">(unmapped)</span>';
    row.innerHTML = `
      <span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      <span class="dur">${c.duration.toFixed(2)}s</span>
      ${stateLabel}
      <button data-clip="${escapeHtml(c.name)}">▶</button>
    `;
    row.querySelector('button')?.addEventListener('click', () => {
      // Raw-clip preview — bypasses per-row config; uses default loop=true,
      // speed=1. For per-state preview the user clicks Play in the table.
      if (!critter?.skeletal) return;
      const ok = critter.skeletal.playClipByName(c.name, true, 1);
      if (!ok) return;
      currentlyPlayingState = null;
      currentlyPlayingClip = c.name;
      updateNowPlaying(null, c.name, 1, true);
    });
    clipListEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Export — TS snippet, JSON patch, download
// ---------------------------------------------------------------------------

function buildAnimLabPatchData(): AnimLabPatch['data'] {
  const data: AnimLabPatch['data'] = {};
  const ids = Object.keys(sessionOverrides).sort();
  for (const id of ids) {
    const map = sessionOverrides[id];
    if (!map) continue;
    const inner: Record<string, AnimLabStateValue> = {};
    const keys = Object.keys(map).sort() as SkeletalState[];
    for (const k of keys) {
      const v = map[k];
      if (v == null) continue;
      inner[k] = v;
    }
    if (Object.keys(inner).length > 0) data[id] = inner;
  }
  return data;
}

/** Auto-detect the right patch version: 2 if any value is object form
 *  (i.e. has speed/loop metadata), 1 otherwise. */
function detectAnimLabVersion(data: AnimLabPatch['data']): 1 | 2 {
  for (const id of Object.keys(data)) {
    const inner = data[id];
    if (!inner) continue;
    for (const v of Object.values(inner)) {
      if (typeof v === 'object') return 2;
    }
  }
  return 1;
}

/** Render a single value for the TS snippet — same logic as the
 *  apply-script's `formatAnimLabValue`. Kept in sync by hand. */
function formatAnimLabValueForTs(v: AnimLabStateValue): string {
  if (typeof v === 'string') return JSON.stringify(v);
  const hasSpeed = typeof v.speed === 'number' && v.speed !== 1;
  const hasLoop = typeof v.loop === 'boolean';
  if (!hasSpeed && !hasLoop) return JSON.stringify(v.clip);
  const parts = [`clip: ${JSON.stringify(v.clip)}`];
  if (hasSpeed) parts.push(`speed: ${v.speed}`);
  if (hasLoop) parts.push(`loop: ${v.loop}`);
  return `{ ${parts.join(', ')} }`;
}

btnExport.addEventListener('click', () => {
  const data = buildAnimLabPatchData();
  if (Object.keys(data).length === 0) {
    exportOut.textContent = '(no overrides set — pick a critter, change the mapping, then Export)';
    return;
  }
  const lines: string[] = [];
  lines.push('// Paste inside ANIMATION_OVERRIDES in src/animation-overrides.ts');
  for (const id of Object.keys(data)) {
    lines.push(`  ${id}: {`);
    for (const k of Object.keys(data[id]!)) {
      lines.push(`    ${k}: ${formatAnimLabValueForTs(data[id]![k]!)},`);
    }
    lines.push(`  },`);
  }
  const out = lines.join('\n');
  exportOut.textContent = out;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(out).catch(() => {
      /* on-screen pre is the fallback */
    });
  }
  console.log(out);
});

btnExportJson.addEventListener('click', async () => {
  const data = buildAnimLabPatchData();
  const version = detectAnimLabVersion(data);
  const patch = makeToolPatch<AnimLabPatch>('anim-lab', data, version);
  const out = JSON.stringify(patch, null, 2);
  exportOut.textContent = out;
  await copyPatchToClipboard(patch);
  console.log(out);
});

btnDownloadJson.addEventListener('click', () => {
  const data = buildAnimLabPatchData();
  const version = detectAnimLabVersion(data);
  const patch = makeToolPatch<AnimLabPatch>('anim-lab', data, version);
  exportOut.textContent = JSON.stringify(patch, null, 2);
  downloadPatch(patch);
});

// ---------------------------------------------------------------------------
// Orbit camera + frame loop
// ---------------------------------------------------------------------------

let orbitTheta = 0;
let orbitPhi = 0.35;
let orbitRadius = 5.5;
const orbitTarget = new THREE.Vector3(0, 1, 0);

let dragging = false;
let lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (ev) => {
  dragging = true; lastX = ev.clientX; lastY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  orbitTheta -= (ev.clientX - lastX) * 0.005;
  orbitPhi = Math.max(0.05, Math.min(1.35, orbitPhi + (ev.clientY - lastY) * 0.003));
  lastX = ev.clientX; lastY = ev.clientY;
});
canvas.addEventListener('pointerup', (ev) => {
  dragging = false; canvas.releasePointerCapture(ev.pointerId);
});
canvas.addEventListener('wheel', (ev) => {
  orbitRadius = Math.max(2, Math.min(14, orbitRadius + ev.deltaY * 0.01));
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

function resize(): void {
  const leftW = 180; // roster panel
  const rightW = 560; // right panel (wider to fit Speed + Loop columns)
  const bannerH = 40;
  const w = window.innerWidth - leftW - rightW;
  const h = window.innerHeight - bannerH;
  renderer.setSize(Math.max(200, w), Math.max(200, h), false);
  canvas.style.position = 'fixed';
  canvas.style.top = `${bannerH}px`;
  canvas.style.left = `${leftW}px`;
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
  const rawDt = Math.min((now - prevTime) / 1000, 0.1);
  prevTime = now;

  if (critter) {
    critter.update(rawDt);
    if (
      needsPanelRefresh
      && critter.skeletal
      && critter.skeletal.availableClipNames.length > 0
    ) {
      refreshAllPanels();
      needsPanelRefresh = false;
    }
  }

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook — DevTools inspection.
if (typeof window !== 'undefined') {
  (window as unknown as { __animLab?: () => unknown }).__animLab = () => ({
    currentId,
    critter,
    sessionOverrides: structuredClone(sessionOverrides),
    rowStates: Object.fromEntries(
      Object.entries(rowStates).map(([id, m]) => [id, Object.fromEntries(m.entries())]),
    ),
    effectiveOverrides: structuredClone(ANIMATION_OVERRIDES),
    currentlyPlaying: { state: currentlyPlayingState, clip: currentlyPlayingClip },
  });
}

if (playableRoster.length > 0) {
  const first = playableRoster[0]!;
  const firstCard = rosterCards.querySelector<HTMLElement>(`[data-id="${first.id}"]`);
  firstCard?.click();
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
