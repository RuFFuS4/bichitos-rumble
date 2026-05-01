// ---------------------------------------------------------------------------
// Input glyph mode — swaps keyboard labels for gamepad equivalents
// ---------------------------------------------------------------------------
//
// BLOQUE FINAL micropass — when a gamepad connects we want every "press J"
// chip in the UI to read "press X" instead. When the gamepad disconnects
// we want the keyboard glyphs back. Implemented as a DOM walker driven by
// the gamepad backend's connect/disconnect events:
//
//   keyboard ↔ gamepad mapping (Xbox/PS standard layout):
//     J    → X       (square / X)
//     K    → Y       (triangle / Y)
//     L    → RB      (R1 / right bumper)
//     SPACE→ A       (cross / A)
//     R    → ↺       (Start / Options — "↺" reads as restart)
//     B    → B       (circle / B — same letter, no swap needed)
//     T    → B       (back to title — also B)
//     ESC  → Start   (pause / menu open)
//
// The mapping is intentionally narrow: every chip in the UI is built from
// one of these source labels, and every other label (WASD, arrows, etc.)
// stays as-is. Untouched chips continue to read keyboard-only.
//
// Public surface:
//   tagGlyph(el, source) — call once when creating a chip so the swap
//     can find its original text on later mode flips. Cheap; no-op if
//     the element is null.
//   setGamepadGlyphMode(on) — flip the mode + walk the DOM to retext
//     every tagged chip. Idempotent.
//   isGamepadGlyphMode() — read the current mode (used by callers that
//     emit fresh chips and want to render with the active glyphs).
// ---------------------------------------------------------------------------

const KEYBOARD_TO_GAMEPAD: Record<string, string> = {
  'J': 'X',
  'K': 'Y',
  'L': 'RB',
  'SPACE': 'A',
  'R': '↺',
  'ESC': 'Start',
};

let gamepadActive = false;

export function isGamepadGlyphMode(): boolean {
  return gamepadActive;
}

/**
 * Translate a single source label to the active mode. Returns the
 * original label when no mapping exists (e.g. WASD, arrows). Useful
 * for code that builds chips on-demand and wants the right text from
 * the start instead of relying on the post-walk swap.
 */
export function glyph(source: string): string {
  if (!gamepadActive) return source;
  return KEYBOARD_TO_GAMEPAD[source] ?? source;
}

/**
 * Tag a chip element so it can be re-textted by setGamepadGlyphMode.
 * Stores the original source on `data-glyph-source` and (re)applies the
 * current-mode text. Pass an optional wrapper string like '[%s]' if the
 * chip text is decorated (e.g. the in-match "[J]" label).
 */
export function tagGlyph(el: HTMLElement | null, source: string, wrapper?: string): void {
  if (!el) return;
  el.dataset.glyphSource = source;
  if (wrapper) el.dataset.glyphWrapper = wrapper;
  el.textContent = renderGlyphText(source, wrapper);
}

function renderGlyphText(source: string, wrapper?: string): string {
  const text = glyph(source);
  if (!wrapper) return text;
  return wrapper.replace('%s', text);
}

/**
 * Flip the active glyph mode and rewrite every tagged chip currently in
 * the DOM. Also toggles `body.using-gamepad` so CSS-only swaps (title
 * screen legend) can react.
 */
export function setGamepadGlyphMode(on: boolean): void {
  if (gamepadActive === on) return;
  gamepadActive = on;
  document.body.classList.toggle('using-gamepad', on);
  const els = document.querySelectorAll<HTMLElement>('[data-glyph-source]');
  for (const el of Array.from(els)) {
    const source = el.dataset.glyphSource ?? '';
    const wrapper = el.dataset.glyphWrapper;
    el.textContent = renderGlyphText(source, wrapper);
  }
}
