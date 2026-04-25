// ---------------------------------------------------------------------------
// tool-storage — small shared helper for /<tool>.html localStorage workflows
// ---------------------------------------------------------------------------
//
// Status: NEW (2026-04-25). Currently used only by /decor-editor.html.
// /calibrate.html and /anim-lab.html continue to use their own inline
// implementations until we explicitly opt-in (deferred to avoid
// regressions on tools that already work).
//
// Why this module exists
// ----------------------
// Each editor (calibrate / anim-lab / decor-editor) needs roughly the
// same workflow:
//   - load a working-copy from localStorage; on miss / corrupt, fall
//     back to the authored layout in code.
//   - auto-save on every meaningful change.
//   - clear the working copy ("Reset local") and reload from code.
//   - know whether the working copy diverges from code (for the
//     "Using local changes" indicator).
//
// We had three almost-identical implementations of this in the wild;
// this module standardises the contract without forcing every editor
// to migrate at once. New tools should consume this from day one.
//
// Key shape (convention):
//   `<tool-name>:<entity-id>`
//
// Examples:
//   decor-editor:jungle           — the layout for the jungle pack
//   calibrate:roster              — (future) calibrate working copy
//   anim-lab:overrides            — (future) anim-lab session overrides
//
// Failure modes
// -------------
//   - quotaExceeded → the setter returns false; callers should
//     log-once-per-session and continue (working copy stays in memory).
//   - SecurityError (e.g. Safari private mode) → same as above.
//   - corrupt JSON → loadStorage returns null; caller falls through to
//     code default.
//
// SSR-safe: every helper guards `typeof window === 'undefined'` so a
// build-time evaluation doesn't crash. Bichitos Rumble doesn't SSR
// today but the cost of the guard is one type check.
// ---------------------------------------------------------------------------

/** Build a fully-qualified storage key from (toolName, entityId). */
export function toolStorageKey(toolName: string, entityId: string): string {
  return `${toolName}:${entityId}`;
}

/** Read a JSON-serialised value from localStorage and validate it.
 *  Returns null on miss, corrupt JSON, or failed validation.
 *  The validator is optional — callers that don't need shape checks
 *  can skip it, but specifying one prevents stale schema drift from
 *  silently producing broken UI state. */
export function loadFromStorage<T>(
  key: string,
  validator?: (v: unknown) => v is T,
): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) {
      console.warn('[tool-storage] discarding non-conforming entry for', key);
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** Write a JSON-serialisable value to localStorage. Returns false on
 *  quota / disabled / corrupt-input failures so callers can degrade
 *  gracefully (working copy survives in memory). */
export function saveToStorage(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remove a single key from localStorage. No-op on miss / disabled. */
export function clearStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** True when a key exists and is non-empty. Useful for the "is there a
 *  working copy at all?" check that drives the Reset button enable
 *  state without needing the full payload. */
export function hasStorageKey(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Compare a stored value to a "code-truth" reference and report
 *  divergence. `codeRef` should be the authored value the working copy
 *  was forked from. Comparison is structural (JSON-stringify) — it's
 *  cheap and the editor payloads are small (<1 KB typical). */
export function storageDivergesFromCode(key: string, codeRef: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return false;
    const codeJson = JSON.stringify(codeRef);
    return raw !== codeJson;
  } catch {
    return false;
  }
}
