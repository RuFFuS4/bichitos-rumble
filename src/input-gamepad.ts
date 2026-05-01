// ---------------------------------------------------------------------------
// Gamepad input backend
// ---------------------------------------------------------------------------
//
// Writes into the shared abstract input state (move vector + held actions +
// menu edge actions) just like keyboard and touch do. The rest of the game
// never needs to know a gamepad is in play.
//
// Mapping (standard Xbox/PS layout; browsers expose a 'standard' gamepad
// with buttons indexed 0..16):
//
//   Gameplay (held):
//     A  (0)  → headbutt
//     X  (2)  → ability1 (J equivalent)
//     Y  (3)  → ability2 (K equivalent)
//     RB (5)  → ultimate (L equivalent) — easier trigger than Y mid-combat
//
//   Menu (edge, fire-once per press):
//     A       → confirm  (SPACE/Enter)
//     B  (1)  → back     (T/Escape)
//     Start (9) → restart (R)
//     D-Pad   → up/down/left/right
//     Left stick direction edges → same as D-Pad (with hysteresis)
//
// A (headbutt) is also menu 'confirm', following the keyboard convention
// where SPACE does both — the menu routes consume through consumeMenuAction
// (edge-clearing) while gameplay reads isHeld (continuous). No conflict.
//
// Only ONE gamepad is supported at a time (the first connected). Local
// split-screen isn't in the game's plan; adding a second pad later is a
// small extension to this file only.
// ---------------------------------------------------------------------------

import {
  _setMove, _setHeld, _pushMenuAction,
  clearAllHeldInputs,
  type MenuAction,
} from './input';
import { showGamepadToast } from './hud';
import { setGamepadGlyphMode } from './input-glyphs';

// Deadzone for the left stick: below this magnitude we treat input as zero.
// Prevents drifting sticks from nudging the critter and suppresses jitter
// in menu navigation. 0.2 matches the common game-engine default.
const DEADZONE = 0.2;

// Hysteresis for stick-as-DPad menu edges. Entering a direction needs
// STICK_EDGE_ON; releasing requires dropping below STICK_EDGE_OFF. Without
// hysteresis, a stick held at exactly the threshold would spam edges.
const STICK_EDGE_ON = 0.6;
const STICK_EDGE_OFF = 0.3;

// Button indices on the "standard" gamepad layout used by most browsers.
const BTN = {
  HEADBUTT: 0,      // A / Cross  — held + menu confirm
  BACK:     1,      // B / Circle — menu back
  ABILITY1: 2,      // X / Square — held
  ABILITY2: 3,      // Y / Triangle — held
  ULTIMATE: 5,      // RB / R1    — held
  RESTART:  9,      // Start / Options — menu restart
  DPAD_UP:   12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT:15,
} as const;

interface PadState {
  connected: boolean;
  index: number;     // index into navigator.getGamepads()
  id: string;        // human-readable id reported by the browser
  lastButton: boolean[];   // per-button pressed-state from the previous tick
  stickX: -1 | 0 | 1;
  stickY: -1 | 0 | 1;
}

const pad: PadState = {
  connected: false,
  index: -1,
  id: '',
  lastButton: new Array(17).fill(false),
  stickX: 0,
  stickY: 0,
};

// ---------------------------------------------------------------------------
// Public init — idempotent. Safe to call once at startup from main.ts.
// ---------------------------------------------------------------------------

let started = false;

export function initGamepadInput(): void {
  if (started) return;
  started = true;

  window.addEventListener('gamepadconnected', (e) => {
    // First gamepad wins. Ignore later connections for now — split-screen
    // isn't on the roadmap.
    if (pad.connected) return;
    pad.connected = true;
    pad.index = e.gamepad.index;
    pad.id = e.gamepad.id;
    pad.lastButton.fill(false);
    pad.stickX = 0;
    pad.stickY = 0;
    console.log('[Gamepad] connected:', e.gamepad.id);
    showGamepadToast(`🎮 ${shortenId(e.gamepad.id)}`);
    // BLOQUE FINAL micropass — flip every "[J]/[K]/[L]" chip in the
    // UI to its gamepad equivalent (X/Y/RB) and let CSS swap the
    // title-screen legend block.
    setGamepadGlyphMode(true);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (!pad.connected || e.gamepad.index !== pad.index) return;
    pad.connected = false;
    pad.index = -1;
    pad.id = '';
    // Prevent held-action keys from staying pressed after disconnect.
    clearAllHeldInputs();
    showGamepadToast('🎮 Gamepad disconnected');
    // Restore the keyboard glyphs everywhere.
    setGamepadGlyphMode(false);
  });

  // Poll at render-loop cadence. getGamepads() in Chrome/Firefox mutates
  // every frame — no event-driven axis updates exist in the API.
  const poll = () => {
    if (pad.connected) tickPad();
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

// ---------------------------------------------------------------------------
// Per-frame tick
// ---------------------------------------------------------------------------

function tickPad(): void {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  const gp = pads[pad.index];
  if (!gp) return;

  // --- Left stick → normalized move vector with radial deadzone ---
  let mx = gp.axes[0] ?? 0;
  let my = gp.axes[1] ?? 0;
  const mag = Math.sqrt(mx * mx + my * my);
  if (mag < DEADZONE) {
    mx = 0;
    my = 0;
  } else {
    // Rescale so magnitude at the deadzone edge reads as 0 and
    // magnitude 1 reads as 1. Avoids the "cliff" where the stick
    // suddenly jumps from 0 to full speed when crossing the threshold.
    const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
    mx = (mx / mag) * scaled;
    my = (my / mag) * scaled;
  }
  // Our engine's move vector uses `z` for the forward/back axis.
  // getMoveVector returns { x, z } — axes[1] maps to z straight.
  _setMove(mx, my);

  // --- Held actions ---
  _setHeld('headbutt', pressed(gp, BTN.HEADBUTT));
  _setHeld('ability1', pressed(gp, BTN.ABILITY1));
  _setHeld('ability2', pressed(gp, BTN.ABILITY2));
  _setHeld('ultimate', pressed(gp, BTN.ULTIMATE));

  // --- Edge actions (menu navigation) ---
  edge(gp, BTN.HEADBUTT, 'confirm');
  edge(gp, BTN.BACK, 'back');
  edge(gp, BTN.RESTART, 'restart');
  edge(gp, BTN.DPAD_UP, 'up');
  edge(gp, BTN.DPAD_DOWN, 'down');
  edge(gp, BTN.DPAD_LEFT, 'left');
  edge(gp, BTN.DPAD_RIGHT, 'right');

  // --- Left stick direction edges (same menu actions as D-Pad) ---
  const nextX = stickDirection(gp.axes[0] ?? 0, pad.stickX);
  if (nextX !== pad.stickX) {
    if (nextX === -1) _pushMenuAction('left');
    else if (nextX === 1) _pushMenuAction('right');
    pad.stickX = nextX;
  }
  const nextY = stickDirection(gp.axes[1] ?? 0, pad.stickY);
  if (nextY !== pad.stickY) {
    if (nextY === -1) _pushMenuAction('up');
    else if (nextY === 1) _pushMenuAction('down');
    pad.stickY = nextY;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pressed(gp: Gamepad, i: number): boolean {
  return !!gp.buttons[i]?.pressed;
}

/**
 * Edge-detect a button: fire `action` as a menu push the first frame
 * the button goes from not-pressed to pressed. Subsequent frames while
 * the button remains pressed do nothing.
 */
function edge(gp: Gamepad, i: number, action: MenuAction): void {
  const now = pressed(gp, i);
  const prev = pad.lastButton[i];
  if (now && !prev) _pushMenuAction(action);
  pad.lastButton[i] = now;
}

/**
 * Convert an analog axis into a -1/0/+1 direction state with hysteresis.
 * Entering a direction requires crossing ON; releasing requires falling
 * below OFF. Avoids the stick "dithering" between states when held near
 * a threshold.
 */
function stickDirection(v: number, curr: -1 | 0 | 1): -1 | 0 | 1 {
  if (curr === 0) {
    if (v <= -STICK_EDGE_ON) return -1;
    if (v >=  STICK_EDGE_ON) return 1;
    return 0;
  }
  if (Math.abs(v) <= STICK_EDGE_OFF) return 0;
  // Allow direct flip if slammed hard the opposite way in a single frame.
  if (curr === -1 && v >=  STICK_EDGE_ON) return 1;
  if (curr ===  1 && v <= -STICK_EDGE_ON) return -1;
  return curr;
}

function shortenId(id: string): string {
  return id.length <= 30 ? id : id.slice(0, 27) + '…';
}
