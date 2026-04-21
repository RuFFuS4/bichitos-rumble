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

/** Show/hide the main in-match HUD (top bar + ability bar + overlay). */
export function setMatchHudVisible(visible: boolean): void {
  hudRoot.style.display = visible ? 'block' : 'none';
}
