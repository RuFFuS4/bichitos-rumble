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
import { getBeltThumbnail } from './belt-thumbnail';
import { t, tContent } from './i18n';

const AUTO_DISMISS_MS = 6000;
/** Leaving the end screen hides the toast; it only counts as seen (slot
 *  consumed) after this long on screen — a quick "play again" would
 *  otherwise announce the belt for a few frames and never again. */
const MIN_SEEN_MS = 1500;

let toastEl: HTMLDivElement | null = null;
let dismissTimer: number | null = null;
let shownAt = 0;

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
      <div class="badge-toast-label">${t('belt-toast-label')}</div>
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
  // Name = proper noun (i18n contract); description = content text.
  renderToast(badge.icon, badge.imgPath, badge.name, tContent(badge.description));
  // BLOQUE FINAL micropass v2 — upgrade the 2D PNG to the rendered 3D
  // thumbnail asynchronously, same pattern Hall of Belts uses. The
  // PNG remains the immediate fallback so the toast never flashes
  // empty while the GLB resolves.
  getBeltThumbnail(badge.id).then((url) => {
    if (!url || !toastEl) return;
    const img = toastEl.querySelector('img.belt-img') as HTMLImageElement | null;
    if (img) img.src = url;
  }).catch(() => { /* keep PNG fallback */ });
}

/**
 * Close the toast and clear the `recentlyUnlocked` slot so the next
 * end-screen doesn't re-show the same badge. Called from the toast's
 * click handler and the auto-dismiss timer. No-op while hidden: a belt
 * unlocked but not shown yet must keep its slot.
 */
export function dismissBadgeToast(): void {
  if (!toastEl || toastEl.classList.contains('hidden')) return;
  hideToastEl();
  clearRecentlyUnlocked();
}

/**
 * The end screen is closing (hud/end.ts): the toast belongs to it, so it
 * goes too — left up, on phones it sat on the joystick in the next match.
 * The slot is only consumed if the toast was on screen long enough to be
 * read (MIN_SEEN_MS); otherwise the next end screen shows it again.
 */
export function hideBadgeToast(): void {
  if (!toastEl || toastEl.classList.contains('hidden')) return;
  const seen = performance.now() - shownAt >= MIN_SEEN_MS;
  hideToastEl();
  if (seen) clearRecentlyUnlocked();
}

function hideToastEl(): void {
  if (!toastEl) return;
  toastEl.classList.add('hidden');
  toastEl.classList.remove('badge-toast-enter');
  document.body.classList.remove('badge-toast-visible');
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderToast(icon: string, imgPath: string, name: string, desc: string): void {
  if (!toastEl) return;
  const iconEl = toastEl.querySelector('.badge-toast-icon') as HTMLDivElement;
  const nameEl = toastEl.querySelector('.badge-toast-name') as HTMLDivElement;
  const descEl = toastEl.querySelector('.badge-toast-desc') as HTMLDivElement;
  // Prefer the AI-generated PNG; if it 404s the onerror handler swaps
  // in a plain span with the emoji character.
  iconEl.innerHTML = `<img class="belt-img" src="${imgPath}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${icon}'}))">`;
  nameEl.textContent = name;
  descEl.textContent = desc;

  // Force reflow so the enter animation re-fires on a second unlock
  // during the same session (toast still in DOM from a previous hide).
  toastEl.classList.remove('hidden', 'badge-toast-enter');
  void toastEl.offsetWidth;
  toastEl.classList.add('badge-toast-enter');
  // Mid-height desktops park the toast where the timer is (index.html).
  document.body.classList.add('badge-toast-visible');
  shownAt = performance.now();

  if (dismissTimer !== null) window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => dismissBadgeToast(), AUTO_DISMISS_MS);
}
