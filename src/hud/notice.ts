// ---------------------------------------------------------------------------
// Notice — the game's own alert() / confirm()
// ---------------------------------------------------------------------------
//
// For the outcomes of connecting online (src/game.ts connectOnlineWith):
// maintenance, a new version, a nickname in use… Not the browser's dialogs
// (2026-09-29): they freeze the game loop, a gamepad can't answer them, the
// browser stamps the site's address on top, and in an iframe sandboxed
// without allow-modals they don't show at all — confirm() just returns false.
//
// While open it owns the menu input (input.ts setMenuCapture): Enter/Space
// or gamepad A take the focused button (the main one unless the player
// tabbed to the other), Esc/T or gamepad Back dismiss it, and the screen
// behind never sees those presses. Focus starts on the main button and
// can't wander to the screen behind. The text goes in as textContent —
// server text included, never parsed as HTML — and a blank line starts a
// new paragraph.
// ---------------------------------------------------------------------------

import { setMenuCapture } from '../input';
import { t } from '../i18n';

// Null-safe: tools.html has no notice and imports this through game.ts.
const modalEl   = document.getElementById('notice-modal');
const textEl    = document.getElementById('notice-text');
const okBtn     = document.getElementById('btn-notice-ok') as HTMLButtonElement | null;
const cancelBtn = document.getElementById('btn-notice-cancel') as HTMLButtonElement | null;

export interface NoticeOptions {
  /** Main button label (default: OK). */
  okLabel?: string;
  /** Second button. Without it the notice is a plain alert. */
  cancelLabel?: string;
}

let settle: ((ok: boolean) => void) | null = null;

/**
 * Show a notice. Resolves true on the main button, false when dismissed
 * (second button, Esc / T / gamepad Back). A new notice replaces an open
 * one, which resolves false. Without the DOM it resolves false at once.
 */
export function showNotice(text: string, opts: NoticeOptions = {}): Promise<boolean> {
  if (!modalEl || !textEl || !okBtn || !cancelBtn) return Promise.resolve(false);
  close(false);
  textEl.replaceChildren(...text.split(/\n\s*\n/).map((para) => {
    const p = document.createElement('p');
    p.textContent = para;
    return p;
  }));
  okBtn.textContent = opts.okLabel ?? t('notice-ok');
  cancelBtn.textContent = opts.cancelLabel ?? '';
  cancelBtn.hidden = !opts.cancelLabel;
  modalEl.classList.remove('hidden');
  okBtn.focus({ preventScroll: true });
  setMenuCapture((action) => {
    // Enter on a focused "Not now" means "Not now" (the old confirm()
    // honoured the focused button too).
    if (action === 'confirm') close(document.activeElement !== cancelBtn);
    else if (action === 'back') close(false);
  });
  return new Promise((resolve) => { settle = resolve; });
}

function close(ok: boolean): void {
  if (!settle) return;
  const resolve = settle;
  settle = null;
  // A button left focused while hidden would take the next Space as a click.
  if (modalEl?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  modalEl?.classList.add('hidden');
  setMenuCapture(null);
  resolve(ok);
}

// Keep Tab inside the notice: behind it, a focused title button would take
// the same Enter that answers the notice.
document.addEventListener('focusin', (e) => {
  if (settle && modalEl && !modalEl.contains(e.target as Node)) okBtn?.focus({ preventScroll: true });
});

for (const [btn, ok] of [[okBtn, true], [cancelBtn, false]] as const) {
  // No focus on press: a focused button would take the next Enter/Space
  // as a second click on top of the menu action.
  btn?.addEventListener('mousedown', (e) => e.preventDefault());
  btn?.addEventListener('click', () => close(ok));
}
