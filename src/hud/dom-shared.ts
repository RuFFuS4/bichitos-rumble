// ---------------------------------------------------------------------------
// Shared DOM handles + helpers used by multiple hud/ submodules
// ---------------------------------------------------------------------------
//
// Kept minimal: only items touched by 2+ modules. Anything scoped to a
// single file (e.g. the ability HUD container) lives in its own module
// and queries the DOM there — no need to funnel every handle through
// here.
// ---------------------------------------------------------------------------

export const hudRoot = document.getElementById('hud')!;

/**
 * Show/hide the in-match-only HUD elements (alive count, timer, lives,
 * ability bars, countdown overlay). The settings cluster (#hud-settings)
 * stays visible on every screen — it must be reachable from the title
 * so users can mute before starting a match, per SUBMISSION_CHECKLIST.
 *
 * Implementation: togglea `.match-active` on `<body>`. The CSS in
 * index.html gates the match-only children via `body:not(.match-active)`
 * selectors, while #hud root + #hud-settings stay visible.
 *
 * Game code also calls `document.body.classList.add('match-active')`
 * directly in a few places (countdown start, restart flow). That's
 * fine — this wrapper just centralises the "no longer in match" path
 * for the hud/ submodules.
 */
export function setMatchHudVisible(visible: boolean): void {
  // Guard: the title screen transitions into match via a separate path
  // that adds .match-active *before* the hud submodules run; we only
  // need to remove it here on the way out.
  if (visible) {
    document.body.classList.add('match-active');
  } else {
    document.body.classList.remove('match-active');
  }
  // Keep the hud root itself visible so #hud-settings (SFX + music
  // toggles) is reachable from every screen. Individual children are
  // gated by CSS.
  hudRoot.style.display = 'block';
}
