// ---------------------------------------------------------------------------
// Touch input backend — virtual joystick + action buttons
// ---------------------------------------------------------------------------
//
// Second device backend for the input abstraction. Lives independently from
// the keyboard backend (which is in input.ts). Both can be active at the
// same time — whichever one has the most recent input wins.
//
// Layout (see index.html + CSS):
//   - Left bottom: circular joystick (base + draggable handle)
//   - Right bottom: 3 action buttons (J, headbutt, K)
//
// Activation: call `initTouchInput()` from main.ts only when
// `isLikelyMobile()` returns true (or optionally always, since the DOM
// elements just stay hidden on desktop).
// ---------------------------------------------------------------------------

import { _setMove, _setHeld, type HeldAction } from './input';

const JOYSTICK_RADIUS = 50;          // max pixel distance the handle can travel
const DEAD_ZONE = 0.12;              // input vector magnitude below this = 0

let initialized = false;

export function initTouchInput(): void {
  if (initialized) return;
  initialized = true;

  // Enable touch-controls overlay via the body class
  document.body.classList.add('touch-mode');

  setupJoystick();
  setupActionButtons();
}

// ---------------------------------------------------------------------------
// Joystick
// ---------------------------------------------------------------------------

function setupJoystick(): void {
  const joystick = document.getElementById('touch-joystick');
  const handle = joystick?.querySelector('.joystick-handle') as HTMLElement | null;
  if (!joystick || !handle) return;

  let active = false;
  let activePointerId: number | null = null;
  let centerX = 0;
  let centerY = 0;

  function recomputeCenter(): void {
    const rect = joystick!.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
  }

  function resetHandle(): void {
    handle!.style.transform = 'translate(0, 0)';
  }

  function onPointerDown(e: PointerEvent): void {
    if (active) return;
    active = true;
    activePointerId = e.pointerId;
    joystick!.classList.add('active');
    recomputeCenter();
    joystick!.setPointerCapture(e.pointerId);
    updateFromPointer(e);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!active || e.pointerId !== activePointerId) return;
    updateFromPointer(e);
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!active || e.pointerId !== activePointerId) return;
    active = false;
    activePointerId = null;
    joystick!.classList.remove('active');
    try { joystick!.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    resetHandle();
    _setMove(0, 0);
    e.preventDefault();
  }

  function updateFromPointer(e: PointerEvent): void {
    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Clamp to JOYSTICK_RADIUS
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    // Visual: move the handle to follow the finger
    handle!.style.transform = `translate(${dx}px, ${dy}px)`;

    // Normalize to -1..1
    let nx = dx / JOYSTICK_RADIUS;
    let nz = dy / JOYSTICK_RADIUS;
    // Dead zone (ignore tiny jitters)
    const mag = Math.sqrt(nx * nx + nz * nz);
    if (mag < DEAD_ZONE) {
      _setMove(0, 0);
      return;
    }
    // Note: screen-down Y means "forward" in arena space (camera looks -Z)
    // so we pass dy directly as the z axis. Matches WASD mapping in input.ts.
    _setMove(nx, nz);
  }

  joystick.addEventListener('pointerdown', onPointerDown);
  joystick.addEventListener('pointermove', onPointerMove);
  joystick.addEventListener('pointerup', onPointerUp);
  joystick.addEventListener('pointercancel', onPointerUp);
  joystick.addEventListener('pointerleave', onPointerUp);

  window.addEventListener('resize', recomputeCenter);
  window.addEventListener('orientationchange', recomputeCenter);
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

function setupActionButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.touch-button[data-action]');
  buttons.forEach((btn) => {
    const action = btn.dataset.action as HeldAction | undefined;
    if (!action) return;

    const press = (e: PointerEvent) => {
      _setHeld(action, true);
      btn.classList.add('pressed');
      btn.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const release = (e: PointerEvent) => {
      _setHeld(action, false);
      btn.classList.remove('pressed');
      try { btn.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });
}
