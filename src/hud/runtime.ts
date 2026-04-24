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

const aliveEl = document.getElementById('hud-alive');
const timerEl = document.getElementById('hud-timer');
// Four per-player life corners (top-left, top-right, bottom-left, bottom-right).
// Populated by initAllLivesHUD per critter index. Each one is nullable
// because `/tools.html` and other secondary entries ship a reduced HUD
// without the corner divs (legacy — the main index.html has them all).
// Any loop/writer below must null-check before reading `.innerHTML` etc.
const lifeCornerEls: Array<HTMLElement | null> = [
  document.getElementById('player-life-0'),
  document.getElementById('player-life-1'),
  document.getElementById('player-life-2'),
  document.getElementById('player-life-3'),
];
const overlayEl = document.getElementById('overlay');
const abilityContainer = document.getElementById('ability-bar-container');
const portalLegendReturnEl = document.getElementById('portal-legend-return');
const portalToggleBtn = document.getElementById('btn-portal-toggle');
const spectatorPrompt = document.getElementById('spectator-prompt');

export function updateHUD(aliveCount: number, timeLeft: number): void {
  if (aliveEl) aliveEl.textContent = `Alive: ${aliveCount}`;
  if (timerEl) {
    const mins = Math.floor(timeLeft / 60);
    const secs = Math.floor(timeLeft % 60);
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// ---- Lives HUD ----------------------------------------------------------

let liveEls: { root: HTMLElement; hearts: HTMLElement }[] = [];

/**
 * Build lives display. One corner per critter (up to 4):
 *   index 0 → top-left, 1 → top-right, 2 → bottom-left, 3 → bottom-right.
 * Each corner shows a big avatar, critter name, hearts, optional bot badge.
 *
 * `localPlayerIndex` (optional) highlights that corner with a gold ring
 * so the user finds their own lives at a glance.
 */
export function initAllLivesHUD(critters: Critter[], localPlayerIndex: number = -1): void {
  // Clear any stale content in all four corners — a restart can land
  // in the same corner elements. Corners may be null in secondary
  // entries (e.g. `/tools.html` without the 4-corner HUD); skip
  // silently if so.
  for (const corner of lifeCornerEls) {
    if (!corner) continue;
    corner.innerHTML = '';
    corner.classList.remove('is-local', 'is-dead');
    corner.style.display = 'none';
  }
  liveEls = [];

  for (let i = 0; i < critters.length && i < lifeCornerEls.length; i++) {
    const c = critters[i];
    const corner = lifeCornerEls[i];
    if (!corner) continue; // missing corner element → skip this slot
    corner.style.display = '';
    if (i === localPlayerIndex) corner.classList.add('is-local');

    // Avatar: prefer the AI-generated HUD sprite (public/images/hud-icons.png)
    // — same chibi head the user designed for the HUD spritesheet. Falls
    // back to the 3D thumbnail render if the sprite sheet hasn't loaded
    // (body.has-hud-sprites not set), and to the coloured dot if even
    // that fails (no GLB yet).
    const dot = document.createElement('span');
    dot.className = 'lives-dot has-avatar';
    dot.style.background = '#' + c.config.color.toString(16).padStart(6, '0');

    // Sprite layer: a child span that only paints when the body class
    // 'has-hud-sprites' is active (CSS rule in index.html). If it paints,
    // it covers the coloured dot AND the 3D thumbnail behind it, so the
    // layering is fallback-on-fallback and doesn't flicker.
    const slug = c.config.name.toLowerCase();
    const spriteOverlay = document.createElement('span');
    spriteOverlay.className = `sprite-hud sprite-hud-${slug} lives-avatar-sprite`;
    dot.appendChild(spriteOverlay);

    // 3D thumbnail is ONLY a fallback for when the sprite sheet didn't load.
    // If it loaded (body.has-hud-sprites set), skip the thumbnail so the
    // sprite sits on a clean coloured dot — each cell in the PNG has
    // transparent padding around the chibi head, and a 3D thumbnail behind
    // leaks through those edges, making slots with tighter silhouettes
    // (Shelly turtle, Kowalski penguin) look blurry-3D rather than chibi-2D
    // while slots with bulkier silhouettes (Sergei gorilla, Sebastian crab)
    // look fine. Dropping the thumbnail when sprites are live makes all 4
    // corners visually consistent.
    const entry = getRosterEntry(c.config.name);
    if (entry && !document.body.classList.contains('has-hud-sprites')) {
      getCritterThumbnail(entry).then((url) => {
        if (!url) return;
        // Recheck: sprite sheet may have finished loading asynchronously
        // while the thumbnail was being generated — if so, skip the paint.
        if (document.body.classList.contains('has-hud-sprites')) return;
        dot.style.backgroundImage = `url(${url})`;
        dot.style.backgroundSize = 'cover';
        dot.style.backgroundPosition = 'center';
      }).catch(() => { /* leave the coloured dot + sprite overlay */ });
    }

    const name = document.createElement('span');
    name.className = 'lives-name';
    name.textContent = c.config.name;

    const hearts = document.createElement('span');
    hearts.className = 'lives-hearts';
    hearts.textContent = '\u2764'.repeat(c.lives);

    corner.appendChild(dot);
    corner.appendChild(name);
    corner.appendChild(hearts);

    // Bot badge (online 4P fill). Never set for offline — offline bots are
    // identified by index, not by this flag.
    if (c.isBot) {
      const badge = document.createElement('span');
      badge.className = 'lives-bot-badge';
      badge.textContent = '🤖';
      badge.title = 'Bot';
      corner.appendChild(badge);
    }

    liveEls.push({ root: corner, hearts });
  }
}

/** Update lives display each frame. */
export function updateAllLivesHUD(critters: Critter[]): void {
  for (let i = 0; i < critters.length && i < liveEls.length; i++) {
    const c = critters[i];
    const el = liveEls[i];
    if (!c.alive) {
      el.hearts.textContent = '\u2716'; // ✖
      el.root.classList.add('is-dead');
    } else {
      el.hearts.textContent = '\u2764'.repeat(c.lives);
      el.root.classList.remove('is-dead');
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
  if (!overlayEl) return;
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
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  overlayEl.classList.remove(...DIGIT_VARIANT_CLASSES, 'pop');
}

// ---- Ability cooldown HUD -----------------------------------------------

let slotEls: { root: HTMLElement; fill: HTMLElement; unavailable: boolean }[] = [];

const ABILITY_SLOT_SUFFIX = ['j', 'k', 'l'] as const;

/**
 * Build the ability HUD slots.
 * @param states       ability states to render (one slot per entry)
 * @param critterSlug  lowercase critter id (matches roster.id) used to pick
 *                     the per-ability sprite. Falls back to emoji-free
 *                     layout if the sprite sheet hasn't loaded.
 * @param unavailable  optional set of indices to render as disabled + "SOON".
 *                     Used in online mode for abilities not yet wired server-side.
 */
export function initAbilityHUD(
  states: AbilityState[],
  critterSlug: string | null = null,
  unavailable?: Set<number>,
): void {
  if (!abilityContainer) return;
  abilityContainer.innerHTML = '';
  slotEls = [];

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const isUnavailable = unavailable?.has(i) ?? false;
    const slot = document.createElement('div');
    slot.className = 'ability-slot' + (isUnavailable ? ' unavailable' : '');

    // AI-generated per-ability icon. Appears only when the sprite sheet
    // actually loaded (body.has-ability-sprites); otherwise the slot
    // keeps its original key+name+bar layout clean.
    if (critterSlug) {
      const slotSuffix = ABILITY_SLOT_SUFFIX[i] ?? 'j';
      const icon = document.createElement('span');
      icon.className = `sprite-ability sprite-ability-${critterSlug}-${slotSuffix} ability-slot-icon`;
      slot.appendChild(icon);
    }

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
  if (!portalLegendReturnEl) return;
  portalLegendReturnEl.style.display = showReturn ? '' : 'none';
}

/** Register a handler for the mobile portal toggle button. */
let portalToggleHandler: (() => void) | null = null;
export function setPortalToggleHandler(handler: () => void): void {
  portalToggleHandler = handler;
}
if (portalToggleBtn) {
  portalToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    portalToggleBtn.blur();
    portalToggleHandler?.();
  });
}

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
