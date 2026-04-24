// ---------------------------------------------------------------------------
// Animation Validation Lab — `/anim-lab.html`
// ---------------------------------------------------------------------------
//
// A dedicated page to inspect, preview, and OVERRIDE per-critter animation
// clip mappings. Sibling of `/calibrate.html` (which handles visual size)
// but focused exclusively on skeletal animation:
//
//   - Roster picker (left panel): click any of the 9 critters → reloads
//     the viewport with that GLB + freshly-built SkeletalAnimator.
//   - Viewport (centre): Three.js scene with orbit camera, lit, no HUD,
//     no physics. Just the critter on a pedestal-free floor.
//   - Right panel:
//       · Playback row (Play / Pause / Restart / Stop / Loop / Speed).
//       · Clips in GLB (list of every clip with duration + resolved
//         state + Play button per row).
//       · Resolved mapping (table of all logical states with the clip
//         chosen + tier source + dropdown to override).
//       · Export overrides → clipboard snippet for
//         `src/animation-overrides.ts`.
//
// Why a separate page instead of a /tools.html panel:
//   - /tools.html is oriented around a running match (single active
//     critter). Animation work means switching critters constantly +
//     viewing all clips, not just the active mapping.
//   - Dedicated page removes Colyseus, bot AI, HUD, arena — faster
//     iteration and cleaner mental space.
//   - Tooling architecture mirrors /calibrate.html (third HTML entry
//     added 2026-04-24). Same precedent.
//
// Runtime overrides — design choice:
//   Overrides entered in the lab are held in a SESSION-SCOPED record
//   (not persisted). Clicking "Apply & reload critter" rebuilds the
//   Critter with those overrides in effect FOR THIS SESSION — enough to
//   preview the result. To make overrides permanent, the user clicks
//   "Export" and pastes the generated block into
//   `src/animation-overrides.ts`. This keeps the SoT in code,
//   reviewable via PR, not hidden behind browser state.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getDisplayRoster, type RosterEntry } from '../roster';
import { Critter, CRITTER_PRESETS } from '../critter';
import type { SkeletalState } from '../critter-skeletal';
import { ANIMATION_OVERRIDES } from '../animation-overrides';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.body.firstChild);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x12131a);

const scene = new THREE.Scene();

// Three-point lighting — same palette as /calibrate.html for consistency.
scene.add(new THREE.HemisphereLight(0x9cc7ea, 0x2a261a, 0.55));
const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9cb8ff, 0.45);
rim.position.set(-4, 4, -3);
scene.add(rim);

// Ground grid for scale reference.
const grid = new THREE.GridHelper(10, 10, 0x444a5c, 0x2a2f3d);
scene.add(grid);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 2.2, 5.5);
camera.lookAt(0, 1, 0);

// ---------------------------------------------------------------------------
// Critter holder — swapped on every roster pick
// ---------------------------------------------------------------------------

const holder = new THREE.Group();
scene.add(holder);
let critter: Critter | null = null;

/** Session-scoped overrides. Merged on top of ANIMATION_OVERRIDES when
 *  rebuilding the critter, but NOT persisted anywhere. Exporting dumps
 *  a snippet that the user then pastes into animation-overrides.ts. */
const sessionOverrides: Record<string, Partial<Record<SkeletalState, string>>> = {};

/** Critter id currently loaded. Null while nothing is selected. */
let currentId: string | null = null;

/** One-shot flag: true after a critter swap until the async GLB
 *  populates the SkeletalAnimator, then the frame loop re-pins the
 *  clip list + mapping table and clears the flag. Avoids pinning
 *  every frame while still catching the moment clips become available. */
let needsPanelRefresh = false;

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

  // Dispose previous
  if (critter) {
    holder.remove(critter.mesh);
    disposeMeshTree(critter.mesh);
    critter = null;
  }

  // Apply session override into the live map so SkeletalAnimator
  // constructor sees it. We merge into ANIMATION_OVERRIDES (mutating the
  // shared record) because that's what getClipOverride() consults. Since
  // this is a dev page with a single global instance, the mutation is
  // harmless — the only thing that reads ANIMATION_OVERRIDES is the
  // anim lab itself + newly-constructed critters.
  const entryId = entry.id;
  const overrides = sessionOverrides[entryId];
  if (overrides) {
    ANIMATION_OVERRIDES[entryId] = { ...overrides };
  } else {
    delete ANIMATION_OVERRIDES[entryId];
  }

  const c = new Critter(preset, scene);
  // The Critter constructor adds the mesh to `scene`; move it under our holder.
  scene.remove(c.mesh);
  holder.add(c.mesh);
  critter = c;
  currentId = entryId;

  refreshAllPanels();
  // Flag a one-shot re-paint for when the async GLB load completes and
  // SkeletalAnimator populates. See frame() for the trigger condition.
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
// Right panel — playback + clips + mapping
// ---------------------------------------------------------------------------

const selectedName = document.getElementById('selected-name')!;
const selectedSub = document.getElementById('selected-sub')!;
const nowPlaying = document.getElementById('now-playing')!;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const chkLoop = document.getElementById('chk-loop') as HTMLInputElement;
const ctlSpeed = document.getElementById('ctl-speed') as HTMLInputElement;
const valSpeed = document.getElementById('val-speed')!;
const clipList = document.getElementById('clip-list')!;
const mappingRows = document.getElementById('mapping-rows')!;
const btnApply = document.getElementById('btn-apply') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const exportOut = document.getElementById('export-out')!;

/** Currently-active manual clip (one-shot preview), if any. null when
 *  the auto loop (idle) is playing. */
let manualActiveClip: string | null = null;
let manualPaused = false;

function refreshAllPanels(): void {
  if (!critter) {
    selectedName.textContent = '—';
    selectedSub.textContent = 'select a critter';
    clipList.innerHTML = '';
    mappingRows.innerHTML = '';
    return;
  }
  selectedName.textContent = critter.config.name;
  selectedSub.textContent = `id: ${currentId} · clips: ${critter.skeletal?.availableClipNames.length ?? 0}`;
  refreshClipList();
  refreshMappingTable();
}

function refreshClipList(): void {
  clipList.innerHTML = '';
  if (!critter?.skeletal) {
    clipList.innerHTML = '<div class="clip-row"><span class="name" style="grid-column:1/-1;opacity:0.55">(no skeletal animator — this GLB ships no clips)</span></div>';
    return;
  }
  const clips = critter.skeletal.listClips();
  if (clips.length === 0) {
    clipList.innerHTML = '<div class="clip-row"><span class="name" style="grid-column:1/-1;opacity:0.55">(empty clip list — unexpected)</span></div>';
    return;
  }
  for (const c of clips) {
    const row = document.createElement('div');
    row.className = 'clip-row';
    if (manualActiveClip === c.name) row.classList.add('playing');
    const stateLabel = c.state ? `<span class="state resolved">→ ${c.state}</span>` : '<span class="state none">—</span>';
    row.innerHTML = `
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="dur">${c.duration.toFixed(2)}s</span>
      ${stateLabel}
      <button data-clip="${escapeHtml(c.name)}">Play</button>
    `;
    row.querySelector('button')?.addEventListener('click', () => {
      playManualClip(c.name);
    });
    clipList.appendChild(row);
  }
}

function refreshMappingTable(): void {
  mappingRows.innerHTML = '';
  if (!critter?.skeletal || !currentId) return;
  const report = critter.skeletal.getResolveReport();
  const available = critter.skeletal.getRawClipNames();
  const sessionMap = sessionOverrides[currentId] ?? {};

  for (const row of report) {
    const tr = document.createElement('tr');
    const overriddenNow = Object.prototype.hasOwnProperty.call(sessionMap, row.state);

    // Build dropdown: auto + every clip. The first option reflects the
    // resolver's auto choice and clears any override when selected.
    const autoLabel = row.clipName
      ? `(auto: ${row.clipName} — ${row.source})`
      : '(auto: unresolved)';
    const opts = [
      `<option value="__auto__">${escapeHtml(autoLabel)}</option>`,
      ...available.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`),
    ].join('');

    const currentSel = sessionMap[row.state] ?? '__auto__';

    tr.innerHTML = `
      <td class="state">${row.state}</td>
      <td><select ${overriddenNow ? 'class="override"' : ''}>${opts}</select></td>
      <td class="source ${row.source}">${row.source}</td>
    `;
    const select = tr.querySelector('select') as HTMLSelectElement;
    select.value = currentSel;
    select.addEventListener('change', () => {
      if (!currentId) return;
      const v = select.value;
      const map = (sessionOverrides[currentId] ??= {});
      if (v === '__auto__') {
        delete map[row.state];
        if (Object.keys(map).length === 0) delete sessionOverrides[currentId];
      } else {
        map[row.state] = v;
      }
      // Visual cue — mark select as override immediately; real effect
      // happens on Apply & reload.
      select.classList.toggle('override', v !== '__auto__');
    });
    mappingRows.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------

function playManualClip(clipName: string): void {
  if (!critter?.skeletal) return;
  const ok = critter.skeletal.playClipByName(clipName, chkLoop.checked);
  if (!ok) return;
  manualActiveClip = clipName;
  manualPaused = false;
  nowPlaying.textContent = `${clipName} (${chkLoop.checked ? 'loop' : 'once'})`;
  refreshClipList();
}

btnPlay.addEventListener('click', () => {
  if (!critter?.skeletal) return;
  // Resume paused playback — re-issue the last manual clip, or idle if none.
  if (manualActiveClip) {
    playManualClip(manualActiveClip);
  } else {
    critter.skeletal.play('idle');
    manualPaused = false;
    nowPlaying.textContent = 'idle (resolver)';
  }
});

btnPause.addEventListener('click', () => {
  // AnimationMixer doesn't expose a trivial global pause; simulate by
  // zeroing timeScale until resume.
  manualPaused = !manualPaused;
  btnPause.textContent = manualPaused ? '▶ Resume' : '⏸ Pause';
});

btnRestart.addEventListener('click', () => {
  if (!critter?.skeletal) return;
  if (manualActiveClip) {
    playManualClip(manualActiveClip);
  } else {
    critter.skeletal.play('idle', { force: true });
  }
});

btnStop.addEventListener('click', () => {
  if (!critter?.skeletal) return;
  critter.skeletal.stopAll();
  manualActiveClip = null;
  manualPaused = false;
  nowPlaying.textContent = 'none';
  btnPause.textContent = '⏸ Pause';
  refreshClipList();
});

chkLoop.addEventListener('change', () => {
  if (manualActiveClip) playManualClip(manualActiveClip);
});

ctlSpeed.addEventListener('input', () => {
  valSpeed.textContent = (+ctlSpeed.value).toFixed(2) + '×';
});

btnApply.addEventListener('click', () => {
  // Reload current critter so the animator rebuilds with the session
  // overrides in effect.
  const activeCard = document.querySelector('.roster-card.active') as HTMLElement | null;
  const id = activeCard?.dataset.id;
  if (!id) return;
  const entry = playableRoster.find((e) => e.id === id);
  if (entry) loadCritter(entry);
});

btnReset.addEventListener('click', () => {
  if (!currentId) return;
  delete sessionOverrides[currentId];
  delete ANIMATION_OVERRIDES[currentId];
  // Reload the current critter cleanly (no overrides in effect).
  const activeCard = document.querySelector('.roster-card.active') as HTMLElement | null;
  const id = activeCard?.dataset.id;
  if (!id) return;
  const entry = playableRoster.find((e) => e.id === id);
  if (entry) loadCritter(entry);
});

btnExport.addEventListener('click', () => {
  // Build a pasteable snippet for animation-overrides.ts. Includes only
  // critters that have at least one session override.
  const ids = Object.keys(sessionOverrides).sort();
  if (ids.length === 0) {
    exportOut.textContent = '(no overrides set — pick a critter, change the mapping, then Export)';
    return;
  }
  const lines: string[] = [];
  lines.push('// Paste inside ANIMATION_OVERRIDES in src/animation-overrides.ts');
  for (const id of ids) {
    const map = sessionOverrides[id];
    if (!map) continue;
    const keys = Object.keys(map).sort() as SkeletalState[];
    if (keys.length === 0) continue;
    lines.push(`  ${id}: {`);
    for (const k of keys) {
      lines.push(`    ${k}: ${JSON.stringify(map[k])},`);
    }
    lines.push(`  },`);
  }
  const out = lines.join('\n');
  exportOut.textContent = out;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(out).catch(() => {
      /* user still has the on-screen text to copy manually */
    });
  }
  console.log(out);
});

// ---------------------------------------------------------------------------
// Orbit camera + loop
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
  const rightW = 480; // right panel
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
  const dt = manualPaused ? 0 : rawDt * speed;

  if (critter) {
    critter.update(dt);
    // One-shot panel refresh the moment the async GLB landed + the
    // SkeletalAnimator populated. Avoids a spin on every frame; only
    // re-pins when the needed state flipped.
    if (needsPanelRefresh && critter.skeletal && critter.skeletal.availableClipNames.length > 0) {
      refreshAllPanels();
      needsPanelRefresh = false;
    }
  }

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook — lets DevTools inspect the currently-loaded critter.
if (typeof window !== 'undefined') {
  (window as unknown as { __animLab?: () => unknown }).__animLab = () => ({
    currentId,
    critter,
    sessionOverrides: structuredClone(sessionOverrides),
    effectiveOverrides: structuredClone(ANIMATION_OVERRIDES),
  });
}

// Auto-load the first critter on boot for a populated first paint.
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
