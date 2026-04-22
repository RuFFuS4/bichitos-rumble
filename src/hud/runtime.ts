// ---------------------------------------------------------------------------
// In-match HUD — top bar (alive + timer), lives, abilities, overlay,
// portal legend, gamepad toast, spectator prompt
// ---------------------------------------------------------------------------
//
// All UI that's actually visible DURING gameplay. The full-screen menus
// (title / character-select / end / waiting) live in separate modules.
// ---------------------------------------------------------------------------

import type { AbilityState } from '../abilities';
import type { Critter } from '../critter';
import { getRosterEntry } from '../roster';
import { getCritterThumbnail } from '../slot-thumbnail';

// ---- Top bar -------------------------------------------------------------

const aliveEl = document.getElementById('hud-alive')!;
const timerEl = document.getElementById('hud-timer')!;
const livesContainer = document.getElementById('hud-lives')!;
const overlayEl = document.getElementById('overlay')!;
const abilityContainer = document.getElementById('ability-bar-container')!;
const portalLegendReturnEl = document.getElementById('portal-legend-return')!;
const portalToggleBtn = document.getElementById('btn-portal-toggle')!;
const spectatorPrompt = document.getElementById('spectator-prompt');

export function updateHUD(aliveCount: number, timeLeft: number): void {
  aliveEl.textContent = `Alive: ${aliveCount}`;
  const mins = Math.floor(timeLeft / 60);
  const secs = Math.floor(timeLeft % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---- Lives HUD ----------------------------------------------------------

let liveEls: { root: HTMLElement; hearts: HTMLElement }[] = [];

/** Build lives display for all critters. Call once at init and on restart. */
export function initAllLivesHUD(critters: Critter[]): void {
  livesContainer.innerHTML = '';
  liveEls = [];

  for (const c of critters) {
    const row = document.createElement('div');
    row.className = 'lives-row';

    // Avatar: coloured dot as instant fallback, upgraded to a 3D
    // thumbnail once getCritterThumbnail resolves. Same pattern the
    // character-select slots + waiting-room slots use, so the cache
    // hit rate is high by the time the match actually starts (the
    // thumbnails were rendered when the user browsed the roster).
    const dot = document.createElement('span');
    dot.className = 'lives-dot';
    dot.style.background = '#' + c.config.color.toString(16).padStart(6, '0');
    const entry = getRosterEntry(c.config.name);
    if (entry) {
      getCritterThumbnail(entry).then((url) => {
        if (!url) return;
        dot.style.backgroundImage = `url(${url})`;
        dot.style.backgroundSize = 'cover';
        dot.style.backgroundPosition = 'center';
        // Keep the tint as a subtle halo behind the avatar for the
        // critter-identity cue at 10-pixel sizes.
        dot.classList.add('has-avatar');
      }).catch(() => { /* leave the coloured dot */ });
    }

    const hearts = document.createElement('span');
    hearts.className = 'lives-hearts';
    hearts.textContent = '\u2764'.repeat(c.lives);

    row.appendChild(dot);
    row.appendChild(hearts);

    // Bot badge (online 4P fill). Never set for offline — offline bots are
    // identified by index, not by this flag.
    if (c.isBot) {
      const badge = document.createElement('span');
      badge.className = 'lives-bot-badge';
      badge.textContent = '🤖';
      badge.title = 'Bot';
      row.appendChild(badge);
    }

    livesContainer.appendChild(row);

    liveEls.push({ root: row, hearts });
  }
}

/** Update lives display each frame. */
export function updateAllLivesHUD(critters: Critter[]): void {
  for (let i = 0; i < critters.length && i < liveEls.length; i++) {
    const c = critters[i];
    const el = liveEls[i];
    if (!c.alive) {
      el.hearts.textContent = '\u2716'; // ✖
      el.root.style.opacity = '0.35';
    } else {
      el.hearts.textContent = '\u2764'.repeat(c.lives);
      el.root.style.opacity = '1';
    }
  }
}

// ---- Overlay (countdown) ------------------------------------------------

/** Countdown digit classes we toggle for the gradient-per-number look.
 *  Kept as a list so clearing on every change is a single loop. */
const DIGIT_VARIANT_CLASSES = [
  'overlay-digit',
  'overlay-d-3', 'overlay-d-2', 'overlay-d-1', 'overlay-d-go',
];

export function showOverlay(main: string, sub?: string): void {
  const html = main + (sub ? `<div class="sub">${sub}</div>` : '');
  // Only pop when the visible text actually changes (e.g. countdown tick),
  // so setting the same value back-to-back doesn't re-trigger the animation.
  const changed = overlayEl.innerHTML !== html;
  overlayEl.style.display = 'block';
  overlayEl.innerHTML = html;

  // Detect countdown digit / GO! content (no sub, main is short enough to
  // be a digit or GO!) and toggle the CSS variant classes. Anything longer
  // ("Get Ready!") falls through to the neutral default style.
  overlayEl.classList.remove(...DIGIT_VARIANT_CLASSES);
  if (!sub) {
    const trimmed = main.trim();
    const variant = digitVariant(trimmed);
    if (variant) {
      overlayEl.classList.add('overlay-digit', variant);
    }
  }

  if (changed) {
    overlayEl.classList.remove('pop');
    // Force reflow so re-adding the class restarts the animation
    void overlayEl.offsetWidth;
    overlayEl.classList.add('pop');
  }
}

function digitVariant(text: string): string | null {
  if (text === '3') return 'overlay-d-3';
  if (text === '2') return 'overlay-d-2';
  if (text === '1') return 'overlay-d-1';
  if (text === 'GO!' || text === 'GO' || text === '0') return 'overlay-d-go';
  return null;
}

export function hideOverlay(): void {
  overlayEl.style.display = 'none';
  overlayEl.classList.remove(...DIGIT_VARIANT_CLASSES, 'pop');
}

// ---- Ability cooldown HUD -----------------------------------------------

let slotEls: { root: HTMLElement; fill: HTMLElement; unavailable: boolean }[] = [];

/**
 * Build the ability HUD slots.
 * @param states  ability states to render (one slot per entry)
 * @param unavailable optional set of indices to render as disabled + "SOON".
 *                   Used in online mode for abilities not yet wired server-side.
 */
export function initAbilityHUD(states: AbilityState[], unavailable?: Set<number>): void {
  abilityContainer.innerHTML = '';
  slotEls = [];

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const isUnavailable = unavailable?.has(i) ?? false;
    const slot = document.createElement('div');
    slot.className = 'ability-slot' + (isUnavailable ? ' unavailable' : '');

    const keyLabel = document.createElement('div');
    keyLabel.className = 'ability-key';
    keyLabel.textContent = `[${s.def.key}]`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'ability-name';
    nameLabel.textContent = s.def.name;

    const fillBg = document.createElement('div');
    fillBg.className = 'ability-fill-bg';

    const fill = document.createElement('div');
    fill.className = 'ability-fill';
    fill.style.width = '100%';
    fillBg.appendChild(fill);

    slot.appendChild(keyLabel);
    slot.appendChild(nameLabel);
    slot.appendChild(fillBg);

    if (isUnavailable) {
      const soon = document.createElement('div');
      soon.className = 'ability-soon-badge';
      soon.textContent = 'SOON';
      slot.appendChild(soon);
    }

    abilityContainer.appendChild(slot);
    slotEls.push({ root: slot, fill, unavailable: isUnavailable });
  }
}

export function updateAbilityHUD(states: AbilityState[]): void {
  for (let i = 0; i < states.length && i < slotEls.length; i++) {
    const s = states[i];
    const el = slotEls[i];

    // Unavailable slots stay visually disabled — skip live updates.
    if (el.unavailable) continue;

    if (s.active) {
      el.root.className = 'ability-slot active';
      el.fill.style.width = '100%';
    } else if (s.cooldownLeft > 0) {
      el.root.className = 'ability-slot on-cooldown';
      const pct = ((s.def.cooldown - s.cooldownLeft) / s.def.cooldown) * 100;
      el.fill.style.width = `${pct}%`;
    } else {
      el.root.className = 'ability-slot';
      el.fill.style.width = '100%';
    }
  }
}

// ---- Portal legend (top-left, visible during match) ---------------------

/** Configure the portal HUD legend: visibility and which rows to show. */
export function setPortalLegend(showReturn: boolean): void {
  portalLegendReturnEl.style.display = showReturn ? '' : 'none';
}

/** Register a handler for the mobile portal toggle button. */
let portalToggleHandler: (() => void) | null = null;
export function setPortalToggleHandler(handler: () => void): void {
  portalToggleHandler = handler;
}
portalToggleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  portalToggleBtn.blur();
  portalToggleHandler?.();
});

// ---- Spectator prompt (online — "you're out, press T") ------------------

/**
 * Show the "you're out — press T to leave" prompt. Called only by the
 * online path when the local player's lives hit 0 while the server is
 * still in 'playing'. Hidden automatically on phase change to ended.
 */
export function showSpectatorPrompt(): void {
  if (!spectatorPrompt) return;
  spectatorPrompt.style.display = 'flex';
}

export function hideSpectatorPrompt(): void {
  if (!spectatorPrompt) return;
  spectatorPrompt.style.display = 'none';
}

// ---- Gamepad toast (auto-hiding) ----------------------------------------
//
// Created lazily on first call so no extra HTML/CSS lives in the page. The
// same element is reused on subsequent toasts (re-armed timer).

let gamepadToastEl: HTMLDivElement | null = null;
let gamepadToastTimer: number | null = null;

function ensureGamepadToast(): HTMLDivElement {
  if (gamepadToastEl) return gamepadToastEl;
  // Scoped styles injected once.
  if (!document.getElementById('gamepad-toast-style')) {
    const style = document.createElement('style');
    style.id = 'gamepad-toast-style';
    style.textContent = `
      #gamepad-toast {
        position: fixed;
        bottom: 18px;
        right: 18px;
        padding: 8px 14px;
        background: rgba(10, 10, 24, 0.92);
        border: 1px solid rgba(255, 220, 92, 0.55);
        border-radius: 18px;
        color: #ffdc5c;
        font: 600 13px/1 'Segoe UI', Arial, sans-serif;
        letter-spacing: 0.5px;
        z-index: 10001;
        pointer-events: none;
        box-shadow: 0 4px 18px rgba(0,0,0,0.5);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      #gamepad-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'gamepad-toast';
  document.body.appendChild(el);
  gamepadToastEl = el;
  return el;
}

/**
 * Pop a small non-interactive toast in the bottom-right corner. Used by
 * the gamepad backend to signal connect/disconnect events. Fades out
 * after ~2s; consecutive calls re-arm the timer instead of stacking.
 */
export function showGamepadToast(message: string): void {
  const el = ensureGamepadToast();
  el.textContent = message;
  // Force reflow so class toggle actually animates if re-triggered fast.
  void el.offsetWidth;
  el.classList.add('visible');
  if (gamepadToastTimer !== null) window.clearTimeout(gamepadToastTimer);
  gamepadToastTimer = window.setTimeout(() => {
    el.classList.remove('visible');
    gamepadToastTimer = null;
  }, 2200);
}
