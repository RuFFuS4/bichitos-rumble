// ---------------------------------------------------------------------------
// Input abstraction layer
// ---------------------------------------------------------------------------
//
// Device-agnostic input. The game and player code never read from physical
// keys — they read from this module's abstract API. Adding a new input
// device (e.g. touch, gamepad) = add a new backend file that writes into
// this module's internal state via the `_set*` / `_push*` hooks. No game
// logic needs to change.
//
// Current backends:
//   - Keyboard (always on)
//
// Planned backends (not implemented yet):
//   - Touch (on-screen joystick + buttons)
//
// How to add a new backend:
//   1. Create `src/input-touch.ts` (or similar)
//   2. Listen to the device's events (touchstart, touchmove, ...)
//   3. Call `_setMove`, `_setHeld`, `_pushMenuAction` from here
//   4. Import it from `main.ts` conditionally via `hasTouchSupport()`
//
// Device detection uses capability probing (not user-agent sniffing).
// ---------------------------------------------------------------------------

export type HeldAction = 'headbutt' | 'ability1' | 'ability2';
export type MenuAction =
  | 'confirm'    // SPACE / Enter (menus) or headbutt (in game — separate slot)
  | 'back'       // T / Escape
  | 'left'       // ArrowLeft / A
  | 'right'      // ArrowRight / D
  | 'up'         // ArrowUp / W
  | 'down'       // ArrowDown / S
  | 'restart';   // R

export interface MoveVector {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Internal abstract state (shared across backends)
// ---------------------------------------------------------------------------

const moveVec: MoveVector = { x: 0, z: 0 };
const heldActions: Record<HeldAction, boolean> = {
  headbutt: false,
  ability1: false,
  ability2: false,
};
const freshMenuActions = new Set<MenuAction>();

// ---------------------------------------------------------------------------
// Public read API (used by game.ts, player.ts)
// ---------------------------------------------------------------------------

/** Continuous movement vector, already normalized to unit length. */
export function getMoveVector(): MoveVector {
  return moveVec;
}

/** True while the action is currently held. */
export function isHeld(action: HeldAction): boolean {
  return heldActions[action];
}

/** Edge-detected: returns true exactly once per press. Clears on read. */
export function consumeMenuAction(action: MenuAction): boolean {
  if (freshMenuActions.has(action)) {
    freshMenuActions.delete(action);
    return true;
  }
  return false;
}

/** Drop all pending edge-detected actions (use on phase transitions). */
export function clearMenuActions(): void {
  freshMenuActions.clear();
}

// ---------------------------------------------------------------------------
// Public write API (used by device backends)
// ---------------------------------------------------------------------------

export function _setMove(x: number, z: number): void {
  moveVec.x = x;
  moveVec.z = z;
}

export function _setHeld(action: HeldAction, value: boolean): void {
  heldActions[action] = value;
}

export function _pushMenuAction(action: MenuAction): void {
  freshMenuActions.add(action);
}

// ---------------------------------------------------------------------------
// Device capability detection
// ---------------------------------------------------------------------------

/** Capability probe: does this browser report touch input support? */
export function hasTouchSupport(): boolean {
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

/** Capability probe: is the viewport narrow enough to suggest a mobile device? */
export function isNarrowViewport(): boolean {
  return window.innerWidth < 900;
}

/** True if we should treat this session as mobile-leaning. */
export function isLikelyMobile(): boolean {
  return hasTouchSupport() && isNarrowViewport();
}

// ---------------------------------------------------------------------------
// Keyboard backend (always active)
// ---------------------------------------------------------------------------

const keyState: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  if (e.repeat) {
    return; // don't fire edge actions on key repeat
  }
  keyState[e.code] = true;
  pushEdgeActionsForKey(e.code);
  updateContinuousFromKeyboard();
});

window.addEventListener('keyup', (e) => {
  keyState[e.code] = false;
  updateContinuousFromKeyboard();
});

function pushEdgeActionsForKey(code: string): void {
  // Menu edge actions (edge-detected, one-shot).
  // Note: WASD also push menu actions for player convenience. Stale edges
  // are cleared on every phase transition via clearMenuActions().
  if (code === 'Space' || code === 'Enter') _pushMenuAction('confirm');
  if (code === 'KeyT' || code === 'Escape') _pushMenuAction('back');
  if (code === 'ArrowLeft' || code === 'KeyA') _pushMenuAction('left');
  if (code === 'ArrowRight' || code === 'KeyD') _pushMenuAction('right');
  if (code === 'ArrowUp' || code === 'KeyW') _pushMenuAction('up');
  if (code === 'ArrowDown' || code === 'KeyS') _pushMenuAction('down');
  if (code === 'KeyR') _pushMenuAction('restart');
}

function updateContinuousFromKeyboard(): void {
  // Movement
  let mx = 0;
  let mz = 0;
  if (keyState['KeyW'] || keyState['ArrowUp']) mz = -1;
  if (keyState['KeyS'] || keyState['ArrowDown']) mz = 1;
  if (keyState['KeyA'] || keyState['ArrowLeft']) mx = -1;
  if (keyState['KeyD'] || keyState['ArrowRight']) mx = 1;
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }
  _setMove(mx, mz);

  // Held actions
  _setHeld('headbutt', !!keyState['Space']);
  _setHeld('ability1', !!keyState['KeyJ']);
  _setHeld('ability2', !!keyState['KeyK']);
}
