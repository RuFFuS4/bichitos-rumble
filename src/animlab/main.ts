// ---------------------------------------------------------------------------
// Animation Lab — `/anim-lab.html`
// ---------------------------------------------------------------------------
//
// Per-critter, per-logical-state clip assignment lab. The mental model
// players don't need to learn this UX uses:
//
//   logical state → assigned clip → play
//
// One unified table per critter:
//
//   ┌──────────────┬────────────────────┬──────┬──────────┐
//   │ State        │ Clip               │ Play │ Status   │
//   ├──────────────┼────────────────────┼──────┼──────────┤
//   │ idle         │ [Idle ▼]           │  ▶   │ auto     │
//   │ run          │ [Run ▼]            │  ▶   │ auto     │
//   │ ability_1    │ [(auto: Slam) ▼]   │  ▶   │ auto     │
//   │ ability_2    │ [Custom ▼]         │  ▶   │ override │
//   │ ability_3    │ [(auto: KO) ▼]     │  ▶   │ auto     │
//   │ victory      │ ...                │      │          │
//   │ defeat       │                    │      │          │
//   │ fall         │                    │      │          │
//   └──────────────┴────────────────────┴──────┴──────────┘
//
// Interactions:
//   · Dropdown change       → clip auto-plays for instant preview AND
//                             the override is recorded in sessionOverrides.
//   · Row Play button       → replays the currently-selected clip.
//   · Apply overrides       → rebuilds the SkeletalAnimator so the
//                             resolver re-runs with the new override map
//                             (only needed to verify auto behaviour).
//   · Reset overrides       → clears every override for this critter +
//                             rebuilds clean.
//   · Preview all           → cycles primary states sequentially (~2 s
//                             each) so you can sanity-check the whole
//                             mapping in one go.
//   · Export TS / JSON      → unchanged from previous iteration; the
//                             JSON path feeds `npm run apply-tool-patch`.
//
// Secondary states (walk / headbutt_anticip / headbutt_lunge / hit /
// respawn) live in a collapsed "Advanced" section with the raw clip
// list. Those states are usually procedural in code — clip overrides
// for them are the exception.
//
// Override merge semantics — preserved from the previous iteration:
//   · `AUTHORED_BASELINE` is a deep clone of ANIMATION_OVERRIDES at
//     page load. Session edits merge ON TOP of this baseline, then are
//     written into the live ANIMATION_OVERRIDES so the next
//     SkeletalAnimator construction reads them via getClipOverride().
//   · Without the baseline snapshot, loading a critter with no session
//     override would `delete ANIMATION_OVERRIDES[id]` and wipe its
//     authored entries — the bug the original lab hit on first QA.
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
} from '../tools/tool-storage';

const AUTHORED_BASELINE: Record<string, ClipOverrideMap> = JSON.parse(
  JSON.stringify(ANIMATION_OVERRIDES),
);

// ---------------------------------------------------------------------------
// State sets (drives the two tables)
// ---------------------------------------------------------------------------

const PRIMARY_STATES: SkeletalState[] = [
  'idle', 'run', 'ability_1', 'ability_2', 'ability_3',
  'victory', 'defeat', 'fall',
];
const SECONDARY_STATES: SkeletalState[] = [
  'walk', 'headbutt_anticip', 'headbutt_lunge', 'hit', 'respawn',
];

// Sentinels in the dropdown beyond raw clip names. UI-only — neither
// reaches the patch payload (both clear the override).
const AUTO = '__auto__';
const NONE = '__none__';
type DropdownChoice = typeof AUTO | typeof NONE | string;

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

/** Session-scoped real overrides. Only contains entries the user has
 *  pinned to a SPECIFIC clip name — Auto and None do not appear here.
 *  Every export reads from this directly so the patch is always sparse. */
const sessionOverrides: Record<string, Partial<Record<SkeletalState, string>>> = {};

/** Per-critter dropdown memory: tracks which option the user picked in
 *  each row, including UI-only ones (Auto / None). Lets the table
 *  re-render with the right value across critter swaps within the
 *  session. Backed onto sessionOverrides by setDropdownChoice. */
const userChoices: Record<string, Map<SkeletalState, DropdownChoice>> = {};

let currentId: string | null = null;
let needsPanelRefresh = false;

/** What is being previewed right now (driven by Play column / dropdown
 *  auto-play / Preview all / row click). null when stopped. */
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
  // Merge authored baseline + session real overrides into the live map
  // so the new SkeletalAnimator's getClipOverride hits read it.
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
const chkLoop = document.getElementById('chk-loop') as HTMLInputElement;
const ctlSpeed = document.getElementById('ctl-speed') as HTMLInputElement;
const valSpeed = document.getElementById('val-speed')!;

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
// Dropdown choice helpers
// ---------------------------------------------------------------------------

function getUserChoiceMap(id: string): Map<SkeletalState, DropdownChoice> {
  return userChoices[id] ??= new Map();
}

function getDropdownChoice(id: string, state: SkeletalState): DropdownChoice {
  const choice = getUserChoiceMap(id).get(state);
  if (choice !== undefined) return choice;
  // No explicit choice yet — if there's an authored override, surface
  // it as the row's initial value so the user sees what's in code.
  const authored = AUTHORED_BASELINE[id]?.[state];
  if (authored) return authored;
  return AUTO;
}

function setDropdownChoice(id: string, state: SkeletalState, choice: DropdownChoice): void {
  getUserChoiceMap(id).set(state, choice);
  // Sync to sessionOverrides — only specific clip names persist; AUTO
  // and NONE both clear the entry (both mean "no override").
  const session = (sessionOverrides[id] ??= {});
  if (choice === AUTO || choice === NONE) {
    delete session[state];
    if (Object.keys(session).length === 0) delete sessionOverrides[id];
  } else {
    session[state] = choice;
  }
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
  // anything works. Only fires once per critter load (controlled by
  // the call site in frame()'s needsPanelRefresh handler).
  if (currentId && critter.skeletal && currentlyPlayingState === null) {
    const idleClip = resolvedClipFor('idle');
    if (idleClip) playClipForState('idle', idleClip);
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
  const choice = getDropdownChoice(currentId!, state);

  // Build dropdown — Auto + None + every clip in the GLB. Auto's label
  // surfaces the resolver's choice so the user sees what would be used
  // without having to think about tiers.
  const autoLabel = autoClipName
    ? `(auto: ${autoClipName})`
    : '(auto: unresolved)';
  const opts = [
    `<option value="${AUTO}">${escapeHtml(autoLabel)}</option>`,
    `<option value="${NONE}">(none — explicitly no clip)</option>`,
    ...available.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`),
  ].join('');

  // Status badge — what would happen at runtime, in plain language.
  // "auto" means the resolver picks; "override" means a specific clip;
  // "missing" means no clip will play at all (auto with no match).
  const badgeHtml = badgeForChoice(choice, autoClipName);

  // Tier label only in the secondary table — power users sometimes
  // care WHY auto picked a particular clip, but it's clutter for the
  // primary table.
  const tierHtml = autoSource && autoSource !== 'missing'
    ? `<span class="badge tier-${autoSource}">${autoSource}</span>`
    : '<span class="badge missing">—</span>';

  if (isPrimary) {
    tr.innerHTML = `
      <td class="state-name">${state}</td>
      <td class="clip-cell"><select aria-label="Clip for ${state}">${opts}</select></td>
      <td class="play-cell"><button class="play-btn" aria-label="Play ${state}">▶</button></td>
      <td class="status-cell">${badgeHtml}</td>
    `;
  } else {
    tr.innerHTML = `
      <td class="state-name">${state}</td>
      <td class="clip-cell"><select aria-label="Clip for ${state}">${opts}</select></td>
      <td class="play-cell"><button class="play-btn" aria-label="Play ${state}">▶</button></td>
      <td class="tier-cell">${tierHtml}</td>
    `;
  }

  // Wire the select.
  const select = tr.querySelector('select') as HTMLSelectElement;
  select.value = choice;
  if (choice !== AUTO && choice !== NONE) select.classList.add('override');
  select.addEventListener('change', () => {
    onDropdownChange(state, select.value as DropdownChoice, tr, autoClipName);
  });

  // Wire the row Play button.
  const playBtn = tr.querySelector('.play-btn') as HTMLButtonElement;
  const canPlay = choice === NONE
    ? false
    : choice === AUTO
      ? autoClipName !== null
      : true;
  playBtn.disabled = !canPlay;
  playBtn.addEventListener('click', () => {
    const clipName = clipNameForChoice(choice, autoClipName);
    if (!clipName) return;
    playClipForState(state, clipName);
  });

  return tr;
}

function clipNameForChoice(choice: DropdownChoice, autoClipName: string | null): string | null {
  if (choice === NONE) return null;
  if (choice === AUTO) return autoClipName;
  return choice;
}

function badgeForChoice(choice: DropdownChoice, autoClipName: string | null): string {
  if (choice === NONE) return '<span class="badge missing">none</span>';
  if (choice === AUTO) {
    return autoClipName
      ? '<span class="badge auto">auto</span>'
      : '<span class="badge missing">missing</span>';
  }
  return '<span class="badge override">override</span>';
}

/** Resolve the clip that would play for `state` right now — taking the
 *  user's dropdown choice into account, falling back to the resolver's
 *  auto choice. Returns null if nothing should play (None or missing). */
function resolvedClipFor(state: SkeletalState): string | null {
  if (!currentId || !critter?.skeletal) return null;
  const choice = getDropdownChoice(currentId, state);
  if (choice === NONE) return null;
  if (choice !== AUTO) return choice;
  const r = critter.skeletal.getResolveReport().find((x) => x.state === state);
  return r?.clipName ?? null;
}

function onDropdownChange(
  state: SkeletalState,
  v: DropdownChoice,
  tr: HTMLTableRowElement,
  autoClipName: string | null,
): void {
  if (!currentId) return;
  setDropdownChoice(currentId, state, v);

  // Update visual cues for THIS row in place.
  const select = tr.querySelector('select') as HTMLSelectElement;
  select.classList.toggle('override', v !== AUTO && v !== NONE);
  const statusCell = tr.querySelector('.status-cell');
  if (statusCell) statusCell.innerHTML = badgeForChoice(v, autoClipName);
  const playBtn = tr.querySelector('.play-btn') as HTMLButtonElement;
  const canPlay = v === NONE ? false : v === AUTO ? autoClipName !== null : true;
  playBtn.disabled = !canPlay;

  // Auto-play: instant feedback. None stops playback; Auto/specific
  // play their resolved clip.
  if (v === NONE) {
    if (critter?.skeletal && currentlyPlayingState === state) {
      critter.skeletal.stopAll();
      updateNowPlaying(null, null);
    }
  } else {
    const clipName = clipNameForChoice(v, autoClipName);
    if (clipName) playClipForState(state, clipName);
  }

  refreshDuplicateWarning();
}

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
      // Raw clip play — no state association, used only for direct
      // inspection in the Advanced section.
      if (!critter?.skeletal) return;
      const ok = critter.skeletal.playClipByName(c.name, chkLoop.checked);
      if (!ok) return;
      currentlyPlayingState = null;
      currentlyPlayingClip = c.name;
      updateNowPlaying(null, c.name);
    });
    clipListEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Now-playing indicator + row highlight
// ---------------------------------------------------------------------------

function updateNowPlaying(state: SkeletalState | null, clipName: string | null): void {
  if (!state && !clipName) {
    npBox.classList.add('idle');
    npStateEl.textContent = '—';
    npClipEl.textContent = 'none';
  } else {
    npBox.classList.remove('idle');
    npStateEl.textContent = state ?? '(raw clip)';
    npClipEl.textContent = clipName ?? '(no clip)';
  }
  // Highlight rows matching the active state (mapping tables) or the
  // active raw clip (clip-list rows).
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
  // Map clipName → states using it (across primary + secondary).
  const usage = new Map<string, SkeletalState[]>();
  const allStates = [...PRIMARY_STATES, ...SECONDARY_STATES];
  for (const state of allStates) {
    const clipName = resolvedClipFor(state);
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
// Playback
// ---------------------------------------------------------------------------

function playClipForState(state: SkeletalState, clipName: string): void {
  if (!critter?.skeletal) return;
  const ok = critter.skeletal.playClipByName(clipName, chkLoop.checked);
  if (!ok) return;
  currentlyPlayingState = state;
  currentlyPlayingClip = clipName;
  updateNowPlaying(state, clipName);
}

btnStop.addEventListener('click', () => {
  if (!critter?.skeletal) return;
  critter.skeletal.stopAll();
  currentlyPlayingState = null;
  currentlyPlayingClip = null;
  updateNowPlaying(null, null);
  stopPreviewAll();
});

chkLoop.addEventListener('change', () => {
  // Re-trigger current playback so the new loop setting takes effect.
  if (currentlyPlayingState && currentlyPlayingClip) {
    playClipForState(currentlyPlayingState, currentlyPlayingClip);
  } else if (currentlyPlayingClip) {
    // Raw clip preview — replay with the new loop setting.
    if (!critter?.skeletal) return;
    critter.skeletal.playClipByName(currentlyPlayingClip, chkLoop.checked);
  }
});

ctlSpeed.addEventListener('input', () => {
  valSpeed.textContent = (+ctlSpeed.value).toFixed(2) + '×';
});

// ---------------------------------------------------------------------------
// Apply / Reset / Preview all
// ---------------------------------------------------------------------------

btnApply.addEventListener('click', () => {
  // Reload the current critter so the SkeletalAnimator constructs with
  // the merged ANIMATION_OVERRIDES applied — gives the resolver a
  // chance to re-pick auto clips for any state still on Auto.
  const activeCard = document.querySelector('.roster-card.active') as HTMLElement | null;
  const id = activeCard?.dataset.id;
  if (!id) return;
  const entry = playableRoster.find((e) => e.id === id);
  if (entry) loadCritter(entry);
});

btnReset.addEventListener('click', () => {
  if (!currentId) return;
  delete sessionOverrides[currentId];
  delete userChoices[currentId];
  delete ANIMATION_OVERRIDES[currentId];
  // Restore the authored baseline (if any) so the next reload has the
  // SAME starting point as a fresh page load — Reset doesn't wipe
  // authored entries, just session overrides on top.
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
    const clip = resolvedClipFor(state);
    if (clip) {
      playClipForState(state, clip);
      previewAllTimer = window.setTimeout(tickPreview, PREVIEW_ALL_MS);
    } else {
      // Skip missing/none — short delay so the UI tick is visible.
      previewAllTimer = window.setTimeout(tickPreview, 200);
    }
  };
  tickPreview();
  btnPreviewAll.textContent = '⏹ Stop preview';
});

// ---------------------------------------------------------------------------
// Export — TS snippet, JSON patch, download
// ---------------------------------------------------------------------------

function buildAnimLabPatchData(): AnimLabPatch['data'] {
  const data: AnimLabPatch['data'] = {};
  const ids = Object.keys(sessionOverrides).sort();
  for (const id of ids) {
    const map = sessionOverrides[id];
    if (!map) continue;
    const inner: Record<string, string> = {};
    const keys = Object.keys(map).sort() as SkeletalState[];
    for (const k of keys) {
      const v = map[k];
      if (typeof v === 'string') inner[k] = v;
    }
    if (Object.keys(inner).length > 0) data[id] = inner;
  }
  return data;
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
      lines.push(`    ${k}: ${JSON.stringify(data[id]![k])},`);
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
  const patch = makeToolPatch<AnimLabPatch>('anim-lab', buildAnimLabPatchData());
  const out = JSON.stringify(patch, null, 2);
  exportOut.textContent = out;
  await copyPatchToClipboard(patch);
  console.log(out);
});

btnDownloadJson.addEventListener('click', () => {
  const patch = makeToolPatch<AnimLabPatch>('anim-lab', buildAnimLabPatchData());
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
  const rightW = 520; // right panel (wider for the new layout)
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
  const speed = +ctlSpeed.value;
  const dt = rawDt * speed;

  if (critter) {
    critter.update(dt);
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
    userChoices: Object.fromEntries(
      Object.entries(userChoices).map(([id, m]) => [id, Object.fromEntries(m.entries())]),
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
