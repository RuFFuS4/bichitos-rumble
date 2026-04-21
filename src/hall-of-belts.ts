// ---------------------------------------------------------------------------
// Hall of Belts — full-screen modal listing every achievement
// ---------------------------------------------------------------------------
//
// Phase 4 (light) of BADGES_DESIGN.md. Opens from the character-select
// screen via a dedicated button or the B key, shows all 16 belts in a
// grid — unlocked ones in full colour, locked ones as grey silhouettes
// with the criterion visible so the player knows what to chase.
//
// No gameplay wiring beyond that. The runtime just reads the current
// `stats.unlockedBadges` list every time the modal opens.
//
// When the Phase 5 PNG assets ship, swap the emoji in the .belt-icon
// element for an <img>. Everything else in this file stays.
// ---------------------------------------------------------------------------

import { BADGE_CATALOG, type BadgeDef } from './badges';
import { getStats } from './stats';

let modalEl: HTMLDivElement | null = null;
let openTriggeredByB = false;   // ignore the keyup of the same press

/**
 * One-time DOM setup. Idempotent. Call at boot from main.ts.
 */
export function initHallOfBelts(): void {
  if (modalEl) return;

  modalEl = document.createElement('div');
  modalEl.id = 'belts-modal';
  modalEl.className = 'belts-modal hidden';
  modalEl.setAttribute('aria-hidden', 'true');
  modalEl.innerHTML = `
    <div class="belts-backdrop" data-belts-close="1"></div>
    <div class="belts-panel" role="dialog" aria-label="Hall of Belts">
      <div class="belts-header">
        <h2 class="belts-title">🏆 Hall of Belts</h2>
        <div class="belts-progress"></div>
        <button class="belts-close" data-belts-close="1" aria-label="Close">✕</button>
      </div>
      <div class="belts-grid" role="list"></div>
      <div class="belts-footer">
        <kbd>B</kbd> or <kbd>Esc</kbd> to close · locked belts show the criterion
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // Close on backdrop click, close button, or explicit [data-belts-close]
  modalEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target && target.closest('[data-belts-close]')) {
      closeHallOfBelts();
    }
  });

  // Key handling — scoped globally but only acts while the modal is
  // visible OR we're on character-select (the "open" trigger).
  window.addEventListener('keydown', onKeydown);
}

/**
 * Show the modal + render the grid against the current stats snapshot.
 * Cheap — the grid is rebuilt each open so state is always fresh.
 */
export function openHallOfBelts(): void {
  if (!modalEl) initHallOfBelts();
  if (!modalEl) return;
  rebuildGrid();
  modalEl.classList.remove('hidden');
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('belts-modal-open');
}

export function closeHallOfBelts(): void {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('belts-modal-open');
}

export function isHallOfBeltsOpen(): boolean {
  return !!(modalEl && !modalEl.classList.contains('hidden'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function rebuildGrid(): void {
  if (!modalEl) return;
  const stats = getStats();
  const unlocked = new Set(stats.unlockedBadges);

  const grid = modalEl.querySelector('.belts-grid') as HTMLDivElement;
  const progress = modalEl.querySelector('.belts-progress') as HTMLDivElement;

  grid.innerHTML = '';
  for (const badge of BADGE_CATALOG) {
    grid.appendChild(renderSlot(badge, unlocked.has(badge.id)));
  }

  const won = BADGE_CATALOG.filter((b) => unlocked.has(b.id)).length;
  progress.textContent = `${won} / ${BADGE_CATALOG.length} unlocked`;
}

function renderSlot(badge: BadgeDef, isUnlocked: boolean): HTMLDivElement {
  const slot = document.createElement('div');
  slot.className = `belt-slot ${isUnlocked ? 'unlocked' : 'locked'} belt-${badge.category}`;
  slot.setAttribute('role', 'listitem');
  // Tooltip content for desktop hover — on touch, the description is
  // inline below the name.
  slot.setAttribute('title', `${badge.name}\n${badge.description}`);
  slot.innerHTML = `
    <div class="belt-icon">${isUnlocked ? badge.icon : '🔒'}</div>
    <div class="belt-name">${escapeHtml(badge.name)}</div>
    <div class="belt-desc">${escapeHtml(badge.description)}</div>
  `;
  return slot;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default:  return c;
    }
  });
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function onKeydown(e: KeyboardEvent): void {
  // Esc closes unconditionally when open
  if (e.key === 'Escape' && isHallOfBeltsOpen()) {
    e.preventDefault();
    closeHallOfBelts();
    return;
  }
  // B toggles only while character-select is visible OR the modal is
  // already open. This avoids hijacking B during a match (online portal
  // shortcut) or the title screen.
  if (e.key.toLowerCase() === 'b') {
    const selectVisible = !document
      .getElementById('character-select')
      ?.classList.contains('hidden');
    if (isHallOfBeltsOpen()) {
      e.preventDefault();
      closeHallOfBelts();
    } else if (selectVisible) {
      e.preventDefault();
      openTriggeredByB = true;
      openHallOfBelts();
    }
  }
}

// Exported to suppress a stale `unused` warning for openTriggeredByB if
// the value isn't read in this file (we reserve it for future "focus
// restoration" logic — closing should return focus to the button that
// opened the modal, which depends on the trigger path).
export function wasOpenedByB(): boolean {
  return openTriggeredByB;
}
