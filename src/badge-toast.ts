// ---------------------------------------------------------------------------
// Badge unlock toast (BADGES_DESIGN Phase 3)
// ---------------------------------------------------------------------------
//
// End-screen notification that surfaces when the player newly unlocks a
// belt. Reads from `stats.recentlyUnlocked` (populated by
// addUnlockedBadges in stats.ts), renders a floating card with the
// badge's icon + name + description, and offers a click/tap to dismiss
// that also clears the stats slot.
//
// Pure presentation — this module does NOT evaluate conditions. The
// caller (game.ts endMatch) is responsible for running checkBadgeUnlocks
// first; this just reads what `recentlyUnlocked` already contains.
//
// Placeholder icons for now (emojis in BadgeDef.icon). When the PNG
// assets ship (BADGES_DESIGN Phase 5), swap the `.badge-toast-icon`
// innerHTML for an <img src="/badges/<id>.png"> and the CSS can stay
// the same.
// ---------------------------------------------------------------------------

import { clearRecentlyUnlocked, getStats } from './stats';
import { getBadgeById } from './badges';

const AUTO_DISMISS_MS = 6000;

let toastEl: HTMLDivElement | null = null;
let dismissTimer: number | null = null;

/**
 * One-time DOM setup. Called from main.ts at boot so the toast node
 * exists before the first match ends. Idempotent.
 */
export function initBadgeToast(): void {
  if (toastEl) return;
  toastEl = document.createElement('div');
  toastEl.id = 'badge-toast';
  toastEl.className = 'badge-toast hidden';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.innerHTML = `
    <div class="badge-toast-shine"></div>
    <div class="badge-toast-icon"></div>
    <div class="badge-toast-body">
      <div class="badge-toast-label">NEW BELT UNLOCKED</div>
      <div class="badge-toast-name"></div>
      <div class="badge-toast-desc"></div>
    </div>
  `;
  toastEl.addEventListener('click', () => dismissBadgeToast());
  document.body.appendChild(toastEl);
}

/**
 * If `stats.recentlyUnlocked` holds a badge id, render the toast for
 * that badge and start the auto-dismiss timer. No-op otherwise. Safe to
 * call on every end-screen transition — if nothing new was unlocked,
 * nothing happens.
 */
export function maybeShowBadgeToast(): void {
  if (!toastEl) initBadgeToast();
  const stats = getStats();
  const id = stats.recentlyUnlocked;
  if (!id) return;
  const badge = getBadgeById(id);
  if (!badge) {
    // Unknown id shouldn't happen — the catalog is static. But if it
    // does, clear the slot so a stale value doesn't block future toasts.
    clearRecentlyUnlocked();
    return;
  }
  renderToast(badge.icon, badge.name, badge.description);
}

/**
 * Close the toast and clear the `recentlyUnlocked` slot so the next
 * end-screen doesn't re-show the same badge. Called from the toast's
 * click handler AND from the auto-dismiss timer.
 */
export function dismissBadgeToast(): void {
  if (!toastEl) return;
  toastEl.classList.add('hidden');
  toastEl.classList.remove('badge-toast-enter');
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  clearRecentlyUnlocked();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderToast(icon: string, name: string, desc: string): void {
  if (!toastEl) return;
  const iconEl = toastEl.querySelector('.badge-toast-icon') as HTMLDivElement;
  const nameEl = toastEl.querySelector('.badge-toast-name') as HTMLDivElement;
  const descEl = toastEl.querySelector('.badge-toast-desc') as HTMLDivElement;
  iconEl.textContent = icon;
  nameEl.textContent = name;
  descEl.textContent = desc;

  // Force reflow so the enter animation re-fires on a second unlock
  // during the same session (toast still in DOM from a previous hide).
  toastEl.classList.remove('hidden', 'badge-toast-enter');
  void toastEl.offsetWidth;
  toastEl.classList.add('badge-toast-enter');

  if (dismissTimer !== null) window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => dismissBadgeToast(), AUTO_DISMISS_MS);
}
