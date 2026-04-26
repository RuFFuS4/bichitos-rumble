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

// ---------------------------------------------------------------------------
// ToolPatch — unified export format for /<tool>.html → apply-tool-patch.mjs
// ---------------------------------------------------------------------------
//
// Every internal lab emits the SAME shape so a single Node script
// (scripts/apply-tool-patch.mjs) can route the patch to the correct
// source file (roster.ts / animation-overrides.ts / arena-decor-
// layouts.ts) without per-tool special-casing in the entry point.
//
// Contract:
//   tool      — discriminator. The apply-script uses this to pick
//               which source file to mutate and which regex pattern
//               to feed it.
//   version   — numeric. Bump on incompatible payload changes; the
//               apply-script bails out hard on unknown versions
//               instead of writing garbage.
//   generated — ISO 8601. Timestamp + tool name go into the source
//               diff log so we can trace which lab session produced
//               which change.
//   data      — tool-specific payload. Each tool defines its own
//               structure; the discriminated union below documents
//               the contracts.
//
// All payloads are sparse: only the entries the user actually edited
// in the lab are emitted. The apply-script merges in-place — entries
// not in `data` are left untouched in the source file.

export type ToolName = 'calibrate' | 'anim-lab' | 'decor-editor';

export interface ToolPatchBase {
  tool: ToolName;
  version: number;
  generated: string;
}

/**
 * `calibrate` patch: per-critter visual transform tweaks.
 *
 * Maps to `RosterEntry` fields in src/roster.ts. The apply-script
 * locates each entry by `id: '<critterId>'` and rewrites only the
 * fields present in the patch. Fields that look the same as the code
 * default (within epsilon) are kept in the patch so the diff still
 * shows what was reviewed.
 */
export interface CalibratePatch extends ToolPatchBase {
  tool: 'calibrate';
  version: 1;
  data: Record<string, {
    scale?: number;
    pivotY?: number;
    rotation?: number;
  }>;
}

/**
 * `anim-lab` patch: per-critter clip overrides for skeletal states.
 *
 * Two value shapes supported (round-tripped by the apply-script):
 *
 *   1. **String shorthand** (v1 patches + simple v2 entries) — clip
 *      name only. Most overrides need just this:
 *
 *        "ability_2": "Ability3GroundPound"
 *
 *   2. **Object form** (v2) — clip + optional `speed` and `loop`. Used
 *      when the lab user pinned a non-default playback rate or loop
 *      flag for that state:
 *
 *        "idle": { "clip": "Idle", "speed": 1.15, "loop": true }
 *
 * Versioning
 * ----------
 *   - `version: 1` — every value is a string. Legacy patches still
 *     accepted indefinitely; the apply-script writes string shorthand
 *     when no metadata is present.
 *   - `version: 2` — values may be string OR object. The lab emits
 *     this when any state has speed/loop set; the source file ends up
 *     mixing the two forms (object only where metadata matters).
 *
 * Speed/loop are TOOLING METADATA only as of 2026-04-27 — the game's
 * runtime resolver path reads `clip` and ignores the rest. /anim-lab
 * uses `playClipByName(clip, loop, speed)` so what the user sees in
 * the lab matches their tuning intent. Promotion to runtime is a
 * Phase-2 change in critter-skeletal.ts.
 */
export interface AnimLabClipMeta {
  clip: string;
  speed?: number;
  loop?: boolean;
}

export type AnimLabStateValue = string | AnimLabClipMeta;

export interface AnimLabPatch extends ToolPatchBase {
  tool: 'anim-lab';
  version: 1 | 2;
  data: Record<string, Record<string, AnimLabStateValue>>;
}

/**
 * `decor-editor` patch: full layout per pack.
 *
 * Maps to `DECOR_LAYOUTS` in src/arena-decor-layouts.ts. Each pack's
 * placement array is replaced wholesale (placements are positional —
 * partial merges don't make sense).
 */
export interface DecorEditorPatch extends ToolPatchBase {
  tool: 'decor-editor';
  version: 1;
  data: Record<string, Array<{
    r: number;
    angle: number;
    rotY: number;
    scale: number;
    type: string;
  }>>;
}

export type ToolPatch = CalibratePatch | AnimLabPatch | DecorEditorPatch;

/** Build a fresh ToolPatch envelope with `generated` set to now. The
 *  caller fills `data`. `version` defaults to 1; pass 2 for anim-lab
 *  when any state ships object-form metadata (speed/loop). */
export function makeToolPatch<T extends ToolPatch>(
  tool: T['tool'],
  data: T['data'],
  version: T['version'] = 1 as T['version'],
): T {
  return {
    tool,
    version,
    generated: new Date().toISOString(),
    data,
  } as T;
}

/** Best-effort copy a ToolPatch to the clipboard as pretty-printed
 *  JSON. Returns true on success, false if the API is unavailable
 *  (browser quirk, file:// origin, etc.) so the UI can fall back to
 *  showing the JSON inline. */
export async function copyPatchToClipboard(patch: ToolPatch): Promise<boolean> {
  const json = JSON.stringify(patch, null, 2);
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(json);
      return true;
    } catch { /* fall through */ }
  }
  return false;
}

/** Trigger a browser file download for a ToolPatch (filename =
 *  `tool-patch-<tool>-<timestamp>.json`). Useful when clipboard is
 *  blocked or the user wants to keep multiple patches around for
 *  later batch apply. */
export function downloadPatch(patch: ToolPatch): void {
  if (typeof window === 'undefined') return;
  const json = JSON.stringify(patch, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = patch.generated.replace(/[:.]/g, '-');
  a.href = url;
  a.download = `tool-patch-${patch.tool}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
