// ---------------------------------------------------------------------------
// Critter status icons — DOM overlay above each critter's head
// ---------------------------------------------------------------------------
//
// Tiny <div> per critter, absolutely positioned at the projected world
// position of the critter's head plus a short upward offset. Renders 1-3
// emoji glyphs ordered by priority so the most-severe status reads first.
// Pure DOM (not Three.js sprites) — emoji rendering is free in the
// browser, billboards trivially, and we already paid the CSS overlay
// cost for the Kermit poison vision layer.
//
// Public surface:
//   ensureCritterStatusEl(critter)   create/get the el for a critter
//   setCritterStatus(critter, set)   replace the active status set
//   disposeCritterStatus(critter)    remove the el (call on dispose)
//   updateAllStatusPositions(camera) project all els each frame
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { Critter } from '../critter';

/**
 * Catalogue of status keys recognised by the renderer. Game code emits
 * these into a Set<CritterStatus> per critter each frame; the HUD
 * sorts them by priority and renders the first three.
 *
 * Keys map to single-emoji glyphs (easy to extend, no asset pipeline).
 */
export type CritterStatus =
  | 'frozen'        // Kowalski Snowball hit (slowTimer > 0, source = projectile)
  | 'slowed'        // generic slow (Sihans Quicksand zone, etc.)
  | 'poisoned'      // Kermit Poison Cloud
  | 'stunned'       // Trunk Grip stun window (stunTimer > 0)
  | 'vulnerable'    // post-stun "everyone hits double" window
  | 'frenzy'        // L active
  | 'steel-shell'   // Shelly Steel Shell
  | 'decoy-ghost';  // Kurama Mirror Trick caster

const ICONS: Record<CritterStatus, string> = {
  frozen: '❄️',
  slowed: '🐌',
  poisoned: '☠️',
  stunned: '💫',
  vulnerable: '💥',
  frenzy: '🔥',
  'steel-shell': '🛡️',
  'decoy-ghost': '👻',
};

/** Render priority — higher index = lower priority. The first 3 from
 *  this order survive the slice() in `setCritterStatus`. */
const PRIORITY: CritterStatus[] = [
  'stunned',
  'frozen',
  'steel-shell',
  'frenzy',
  'vulnerable',
  'poisoned',
  'slowed',
  'decoy-ghost',
];

interface StatusEntry {
  el: HTMLDivElement;
  current: Set<CritterStatus>;
}

const STATES = new Map<Critter, StatusEntry>();
let stylesInjected = false;

function injectStylesOnce(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'critter-status-icons-style';
  style.textContent = `
    .critter-status-icons {
      position: fixed;
      top: 0; left: 0;
      pointer-events: none;
      display: flex;
      gap: 2px;
      font-size: 22px;
      line-height: 1;
      transform-origin: 0 0;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
      z-index: 12;
      user-select: none;
      white-space: nowrap;
      will-change: transform, opacity;
      transition: opacity 0.18s ease-out;
    }
    .critter-status-icons.hidden {
      opacity: 0;
    }
    .critter-status-icons span {
      display: inline-block;
      animation: critter-status-pulse 1.4s infinite ease-in-out;
    }
    .critter-status-icons span:nth-child(2) { animation-delay: 0.18s; }
    .critter-status-icons span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes critter-status-pulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.18); }
    }
  `;
  document.head.appendChild(style);
}

function ensureEntry(critter: Critter): StatusEntry {
  let s = STATES.get(critter);
  if (s) return s;
  injectStylesOnce();
  const el = document.createElement('div');
  el.className = 'critter-status-icons hidden';
  document.body.appendChild(el);
  s = { el, current: new Set() };
  STATES.set(critter, s);
  return s;
}

/** Replace the active status set for a critter. Diffed internally so the
 *  DOM only mutates when the rendered glyphs actually change. */
export function setCritterStatus(critter: Critter, active: ReadonlySet<CritterStatus>): void {
  const s = ensureEntry(critter);
  // Cheap equality check — same size + every key present.
  let same = active.size === s.current.size;
  if (same) {
    for (const k of active) { if (!s.current.has(k)) { same = false; break; } }
  }
  if (!same) {
    const sorted = [...active].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
    const top3 = sorted.slice(0, 3);
    s.el.innerHTML = top3.map(k => `<span aria-label="${k}">${ICONS[k]}</span>`).join('');
    s.current = new Set(top3);
  }
  if (active.size === 0) s.el.classList.add('hidden');
  else s.el.classList.remove('hidden');
}

/** Drop the icons element when a critter is being disposed. */
export function disposeCritterStatus(critter: Critter): void {
  const s = STATES.get(critter);
  if (!s) return;
  s.el.parentElement?.removeChild(s.el);
  STATES.delete(critter);
}

/** Wipe every tracked icon — used on phase transitions (match restart,
 *  return to title) so dangling DOM nodes don't survive into the next
 *  match. */
export function clearAllCritterStatus(): void {
  for (const [, s] of STATES) {
    s.el.parentElement?.removeChild(s.el);
  }
  STATES.clear();
}

/** Project every tracked critter's head position to screen space and
 *  update its icon transform. Called once per frame from the main loop
 *  after physics + visuals. */
const _tmp = new THREE.Vector3();
export function updateAllStatusPositions(
  camera: THREE.Camera,
  rendererSize: { width: number; height: number },
): void {
  const w = rendererSize.width;
  const h = rendererSize.height;
  for (const [critter, s] of STATES) {
    if (!critter.alive || !critter.mesh.visible || critter.falling) {
      s.el.classList.add('hidden');
      continue;
    }
    if (s.current.size === 0) continue;
    // Critter head height: bind-pose height if available, else 1.5 u above ground.
    const headY = (critter.bindPoseHeight ?? 1.5) + 0.4; // small lift so emojis float above the silhouette
    _tmp.set(critter.x, headY, critter.z);
    _tmp.project(camera);
    if (_tmp.z < -1 || _tmp.z > 1) {
      // Behind the camera or beyond far plane — hide.
      s.el.classList.add('hidden');
      continue;
    }
    const x = (_tmp.x + 1) * 0.5 * w;
    const y = (1 - (_tmp.y + 1) * 0.5) * h;
    s.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    s.el.classList.remove('hidden');
  }
}
