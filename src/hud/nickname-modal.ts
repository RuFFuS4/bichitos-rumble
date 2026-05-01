// ---------------------------------------------------------------------------
// Nickname modal — gates access to Online Multiplayer the first time
// ---------------------------------------------------------------------------
//
// Single-use flow:
//   game.ts calls `ensureOnlineIdentity()` before connecting. If a cached
//   identity exists, it resolves immediately. Otherwise the modal opens,
//   the player types a nickname, hits Play, we POST to the server, and
//   resolve once we have a valid OnlineIdentity (or reject on cancel).
//
// Validation mirrors the server rules (3–16 chars, [a-zA-Z0-9_-]) so the
// happy path doesn't even round-trip. Errors from the server (e.g. a
// nickname collision with a different token) surface below the input.
// ---------------------------------------------------------------------------

import {
  getCachedIdentity,
  getPreferredNickname,
  registerNickname,
  type OnlineIdentity,
} from '../online-identity';

const modalEl       = document.getElementById('nickname-modal')!;
const inputEl       = document.getElementById('nickname-input') as HTMLInputElement;
const errorEl       = document.getElementById('nickname-error')!;
const confirmBtn    = document.getElementById('btn-nickname-confirm') as HTMLButtonElement;
const cancelBtn     = document.getElementById('btn-nickname-cancel') as HTMLButtonElement;

// Same regex as server/src/db.ts#validateNickname for snap-feedback.
const NICK_RE = /^[a-zA-Z0-9_\-]{3,16}$/;
const RESERVED = new Set(['admin', 'root', 'anonymous', 'null', 'undefined', 'guest']);

function errorMessage(reasonCode: string): string {
  switch (reasonCode) {
    case 'too_short': return 'Nickname must be at least 3 characters.';
    case 'too_long': return 'Nickname must be at most 16 characters.';
    case 'invalid_chars': return 'Only letters, digits, "-" and "_" allowed.';
    case 'reserved': return 'That nickname is reserved. Pick another.';
    case 'nickname_taken': return 'That nickname is already taken. Pick another.';
    case 'nickname_required': return 'Nickname is required.';
    case 'invalid_token': return 'Session invalid. Refresh the page.';
    case 'rate_limited': return 'Too many attempts — wait a moment.';
    case 'network_error': return 'Could not reach the server. Check your connection.';
    default: return 'Something went wrong. Try again.';
  }
}

function clientSideValidation(nick: string): string | null {
  const trimmed = nick.trim();
  if (trimmed.length < 3) return 'too_short';
  if (trimmed.length > 16) return 'too_long';
  if (!NICK_RE.test(trimmed)) return 'invalid_chars';
  if (RESERVED.has(trimmed.toLowerCase())) return 'reserved';
  return null;
}

function showError(reason: string | null): void {
  errorEl.textContent = reason ? errorMessage(reason) : '';
}

function setBusy(busy: boolean): void {
  confirmBtn.disabled = busy;
  cancelBtn.disabled = busy;
  inputEl.disabled = busy;
  confirmBtn.textContent = busy ? 'Registering…' : '▶ Play online';
}

/**
 * Ensure we have an online identity before starting a connection. Opens
 * the nickname modal if none is cached. Resolves with the identity on
 * success, rejects on cancel.
 *
 * Idempotent: if the cache hit happens, the modal never shows.
 */
export function ensureOnlineIdentity(): Promise<OnlineIdentity> {
  // 2026-05-01 final block — only the per-tab session identity
  // counts as "cached". A new tab always gets the modal with the
  // device-preferred nickname pre-filled (so accepting is one tap).
  const cached = getCachedIdentity();
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    // Fresh state on every open (the modal can be re-used).
    // Pre-fill with the device's preferred nickname so the user
    // can confirm their usual identity with a single Enter press.
    inputEl.value = getPreferredNickname();
    showError(null);
    setBusy(false);
    modalEl.classList.remove('hidden');
    // Defer focus to next frame so the browser has the element laid out.
    requestAnimationFrame(() => {
      inputEl.focus();
      // If we pre-filled, select the text so a quick re-type
      // doesn't require a manual delete.
      if (inputEl.value) inputEl.select();
    });

    const close = () => {
      modalEl.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onKeydown);
    };

    const onConfirm = async () => {
      const raw = inputEl.value;
      const clientReason = clientSideValidation(raw);
      if (clientReason) {
        showError(clientReason);
        return;
      }
      setBusy(true);
      showError(null);
      try {
        const identity = await registerNickname(raw.trim());
        close();
        resolve(identity);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'server_error';
        showError(reason);
        setBusy(false);
        inputEl.focus();
      }
    };

    const onCancel = () => {
      close();
      reject(new Error('cancelled'));
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onKeydown);
  });
}

/**
 * Force the modal even if the cache is populated — used by the "Change
 * nickname" button if we ever add one. For now it's not wired; kept here
 * so the bridge is ready.
 */
export function openNicknameModalForReplacement(): Promise<OnlineIdentity> {
  // Reusing ensureOnlineIdentity while temporarily hiding the cache.
  // Simplest path: let the caller decide to clear cache first.
  return ensureOnlineIdentity();
}
