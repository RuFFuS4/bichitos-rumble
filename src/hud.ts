import type { AbilityState } from './abilities';
import { createAbilityStates } from './abilities';
import type { Critter, CritterConfig } from './critter';
import { getRosterEntry, type RosterEntry } from './roster';
import { getCritterThumbnail } from './slot-thumbnail';

const aliveEl = document.getElementById('hud-alive')!;
const timerEl = document.getElementById('hud-timer')!;
const livesContainer = document.getElementById('hud-lives')!;
const overlayEl = document.getElementById('overlay')!;
const abilityContainer = document.getElementById('ability-bar-container')!;
const hudRoot = document.getElementById('hud')!;
const titleScreen = document.getElementById('title-screen')!;
const characterSelect = document.getElementById('character-select')!;
const critterGrid = document.getElementById('critter-grid')!;
const infoName = document.getElementById('critter-info-name')!;
const infoRole = document.getElementById('critter-info-role')!;
const infoTagline = document.getElementById('critter-info-tagline')!;
const infoStats = document.getElementById('critter-info-stats')!;
const infoAbilities = document.getElementById('critter-info-abilities')!;
const endScreen = document.getElementById('end-screen')!;
const endResultEl = document.getElementById('end-result')!;
const endSubtitleEl = document.getElementById('end-subtitle')!;
// portal-legend itself is styled entirely via CSS (body.match-active gate),
// so we only need a handle to the return-row to toggle its visibility
// when a return portal actually exists.
const portalLegendReturnEl = document.getElementById('portal-legend-return')!;
const portalToggleBtn = document.getElementById('btn-portal-toggle')!;

// Waiting screen (online 4P). Nullable because /tools.html doesn't include
// these nodes — the lab launches matches directly without a waiting phase.
const waitingScreen = document.getElementById('waiting-screen');
const waitingCountdownEl = document.getElementById('waiting-countdown');
const waitingSlotsEl = document.getElementById('waiting-slots');
// Spectator prompt (dead in online match). Same nullable pattern.
const spectatorPrompt = document.getElementById('spectator-prompt');
// End-screen per-match stats block (null on /tools.html).
const endStatsEl = document.getElementById('end-stats');

export function updateHUD(aliveCount: number, timeLeft: number): void {
  aliveEl.textContent = `Alive: ${aliveCount}`;
  const mins = Math.floor(timeLeft / 60);
  const secs = Math.floor(timeLeft % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Lives HUD — shows all critters' lives with colored indicators
// ---------------------------------------------------------------------------

let liveEls: { root: HTMLElement; hearts: HTMLElement }[] = [];

/** Build lives display for all critters. Call once at init and on restart. */
export function initAllLivesHUD(critters: Critter[]): void {
  livesContainer.innerHTML = '';
  liveEls = [];

  for (const c of critters) {
    const row = document.createElement('div');
    row.className = 'lives-row';

    const dot = document.createElement('span');
    dot.className = 'lives-dot';
    dot.style.background = '#' + c.config.color.toString(16).padStart(6, '0');

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

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function showOverlay(main: string, sub?: string): void {
  const html = main + (sub ? `<div class="sub">${sub}</div>` : '');
  // Only pop when the visible text actually changes (e.g. countdown tick),
  // so setting the same value back-to-back doesn't re-trigger the animation.
  const changed = overlayEl.innerHTML !== html;
  overlayEl.style.display = 'block';
  overlayEl.innerHTML = html;
  if (changed) {
    overlayEl.classList.remove('pop');
    // Force reflow so re-adding the class restarts the animation
    void overlayEl.offsetWidth;
    overlayEl.classList.add('pop');
  }
}

export function hideOverlay(): void {
  overlayEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Waiting screen (online 4P)
// ---------------------------------------------------------------------------
//
// Shown while the server is in phase 'waiting'. Renders:
//   - A big countdown indicating seconds left until bot-fill
//   - A row of 4 slots (filled/empty, human/bot)
//   - A hint about bot-fill behaviour
//
// Null-safe: every function is a no-op on pages where the DOM nodes don't
// exist (e.g. /tools.html, which skips the waiting flow entirely).

export type WaitingSlotKind = 'human' | 'bot' | 'empty';

export interface WaitingSlotData {
  /** 'human' | 'bot' | 'empty'. */
  kind: WaitingSlotKind;
  /** Critter name (e.g. "Sergei"). Empty string for empty slots. */
  name: string;
  /** Display colour hex (e.g. 0xff5577). 0 for empty. */
  color: number;
}

export interface WaitingScreenData {
  secondsLeft: number;
  slots: WaitingSlotData[];   // exactly MAX_PLAYERS entries (padded with empty)
  maxPlayers: number;
}

export function showWaitingScreen(): void {
  if (!waitingScreen) return;
  waitingScreen.classList.remove('hidden');
}

export function hideWaitingScreen(): void {
  if (!waitingScreen) return;
  waitingScreen.classList.add('hidden');
}

/**
 * Refresh the waiting-screen DOM with server-driven data. Called every
 * frame while phase === 'waiting'. Only touches the nodes whose content
 * actually changed (the countdown goes down every tick; slot contents
 * change only when a player joins/leaves/becomes a bot).
 */
export function updateWaitingScreen(data: WaitingScreenData): void {
  if (!waitingScreen || !waitingCountdownEl || !waitingSlotsEl) return;

  // Countdown: round up so "0.4s left" reads as "1s left" until it truly hits 0.
  const sec = Math.max(0, Math.ceil(data.secondsLeft));
  if (waitingCountdownEl.textContent !== String(sec)) {
    waitingCountdownEl.textContent = String(sec);
  }
  // Last 10s: urgency pulse.
  const urgent = sec > 0 && sec <= 10;
  waitingCountdownEl.classList.toggle('urgent', urgent);

  // Slots — re-render the set. Small enough that an innerHTML replace is fine.
  const fp = waitingSlotsFingerprint(data.slots);
  if (waitingSlotsEl.dataset.fp !== fp) {
    waitingSlotsEl.innerHTML = '';
    for (const s of data.slots) {
      waitingSlotsEl.appendChild(buildWaitingSlotEl(s));
    }
    waitingSlotsEl.dataset.fp = fp;
  }
}

function waitingSlotsFingerprint(slots: WaitingSlotData[]): string {
  return slots.map(s => `${s.kind}:${s.name}:${s.color}`).join('|');
}

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

// ---------------------------------------------------------------------------
// End-screen per-match stats
// ---------------------------------------------------------------------------

export interface EndMatchStats {
  /** Headbutt lunges performed this match (attempts, not contacts). */
  headbutts: number;
  /** Total ability casts across slots (J + K + L). */
  abilitiesUsed: number;
  /** Times the player fell off the arena. */
  falls: number;
  /** Times the player respawned from a fall. */
  respawns: number;
}

/** Show the stats row on the end-screen with the player's counters. */
export function setEndMatchStats(stats: EndMatchStats): void {
  if (!endStatsEl) return;
  // Order + icon per stat. Emojis chosen to read at a glance in the
  // small 13px row — no custom asset pipeline required. If we ever
  // want themed glyphs, swap these for CSS masked SVGs without
  // touching the rest.
  const rows: Array<{ icon: string; label: string; value: number }> = [
    { icon: '⚡', label: 'Headbutts',  value: stats.headbutts     },
    { icon: '✨', label: 'Abilities',  value: stats.abilitiesUsed },
    { icon: '💀', label: 'Falls',      value: stats.falls         },
    { icon: '🔁', label: 'Respawns',   value: stats.respawns      },
  ];
  endStatsEl.innerHTML = '';
  const valueEls: Array<{ el: HTMLSpanElement; target: number }> = [];
  for (const { icon, label, value } of rows) {
    const col = document.createElement('div');
    col.className = 'stat';
    const i = document.createElement('span');
    i.className = 'stat-icon';
    i.textContent = icon;
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = '0';
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    col.appendChild(i);
    col.appendChild(v);
    col.appendChild(l);
    endStatsEl.appendChild(col);
    valueEls.push({ el: v, target: value });
  }
  endStatsEl.style.display = 'flex';
  // Trigger the entry animation (CSS handles the look) by toggling a
  // class. Using the next frame so the display:flex has committed.
  endStatsEl.classList.remove('stats-enter');
  requestAnimationFrame(() => {
    endStatsEl.classList.add('stats-enter');
  });
  // Count-up: each number eases from 0 to its final value over ~700 ms.
  // Pure RAF loop, no extra deps. Safe to re-invoke — the previous loop's
  // stored el is overwritten on the next setEndMatchStats() call.
  animateCountUp(valueEls, 700);
}

function animateCountUp(
  entries: Array<{ el: HTMLSpanElement; target: number }>,
  durationMs: number,
): void {
  const start = performance.now();
  function step(now: number) {
    const t = Math.min(1, (now - start) / durationMs);
    // easeOutCubic — fast first, soft landing
    const eased = 1 - Math.pow(1 - t, 3);
    for (const { el, target } of entries) {
      el.textContent = String(Math.round(target * eased));
    }
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Hide the stats row (called on match start, title return, etc.). */
export function clearEndMatchStats(): void {
  if (!endStatsEl) return;
  endStatsEl.style.display = 'none';
  endStatsEl.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Gamepad toast — auto-hiding notification for connect/disconnect events
// ---------------------------------------------------------------------------
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

function buildWaitingSlotEl(s: WaitingSlotData): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'waiting-slot ' + s.kind;

  // Avatar: starts as a coloured tile (instant fallback) and upgrades to a
  // 3D thumbnail once getCritterThumbnail resolves. No await so the slot
  // renders immediately; the cached thumbnails from character-select
  // usually resolve synchronously.
  const avatar = document.createElement('span');
  avatar.className = 'waiting-slot-avatar';
  if (s.color) {
    avatar.style.background = '#' + s.color.toString(16).padStart(6, '0');
  }
  if (s.kind !== 'empty' && s.name) {
    const entry = getRosterEntry(s.name);
    if (entry) {
      getCritterThumbnail(entry).then(url => {
        if (!url) return;
        // Keep the tinted background as a subtle halo behind the avatar.
        avatar.style.backgroundImage = `url(${url})`;
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
      }).catch(() => { /* keep fallback tile */ });
    }
  }
  el.appendChild(avatar);

  // Critter name for filled slots ("Sergei", "Trunk"); placeholder
  // "Open" for empty slots so the animated-dots CSS reads as
  // "waiting for player…" instead of pointing at a dash.
  const name = document.createElement('span');
  name.className = 'waiting-slot-name';
  name.textContent = s.name || (s.kind === 'empty' ? 'Open' : '—');
  el.appendChild(name);

  // Badge: HUMAN / 🤖 BOT / OPEN — type of participant, below the name.
  const badge = document.createElement('span');
  badge.className = 'waiting-slot-badge';
  badge.textContent =
    s.kind === 'human' ? 'HUMAN' :
    s.kind === 'bot'   ? '🤖 BOT' :
                         'OPEN';
  el.appendChild(badge);

  return el;
}

// ---------------------------------------------------------------------------
// Ability cooldown HUD
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Full-screen menus (title / character select / end)
// ---------------------------------------------------------------------------

/** Show/hide the main in-match HUD (top bar + ability bar + overlay). */
function setMatchHudVisible(visible: boolean): void {
  hudRoot.style.display = visible ? 'block' : 'none';
}

export function showTitleScreen(): void {
  setMatchHudVisible(false);
  titleScreen.classList.remove('hidden');
}

export function hideTitleScreen(): void {
  titleScreen.classList.add('hidden');
}

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

/** Callback registered by the game layer — invoked when a slot is clicked/tapped. */
let slotClickHandler: ((idx: number) => void) | null = null;
export function setSlotClickHandler(handler: (idx: number) => void): void {
  slotClickHandler = handler;
}

// Tap-anywhere handler on the end screen — mobile menu UX.
// Title screen uses explicit mode buttons, not tap-anywhere, to avoid
// starting a match accidentally.
let endTapHandler: (() => void) | null = null;

export function setEndTapHandler(handler: () => void): void {
  endTapHandler = handler;
}

endScreen.addEventListener('click', (e) => {
  // Don't trigger if clicking on the kbd hint elements (let them be passive)
  const target = e.target as HTMLElement;
  if (target.closest('kbd')) return;
  endTapHandler?.();
});

// --- Title screen mode buttons -------------------------------------------

const btnVsBots = document.getElementById('btn-vs-bots') as HTMLButtonElement | null;
const btnOnline = document.getElementById('btn-online') as HTMLButtonElement | null;

export type TitleMode = 'bots' | 'online';

let titleModeSelectHandler: ((mode: TitleMode) => void) | null = null;
let titleModeConfirmHandler: ((mode: TitleMode) => void) | null = null;

/**
 * Wire the title screen's mode buttons.
 *  onSelect  — fired when the user hovers/focuses a mode (arrow keys too)
 *  onConfirm — fired when the user clicks a mode or presses Enter
 */
export function setTitleModeHandlers(
  onSelect: (mode: TitleMode) => void,
  onConfirm: (mode: TitleMode) => void,
): void {
  titleModeSelectHandler = onSelect;
  titleModeConfirmHandler = onConfirm;
}

btnVsBots?.addEventListener('click', () => {
  titleModeSelectHandler?.('bots');
  titleModeConfirmHandler?.('bots');
});
btnOnline?.addEventListener('click', () => {
  titleModeSelectHandler?.('online');
  titleModeConfirmHandler?.('online');
});
// Hover on desktop highlights the mode (keyboard focus stays in sync)
btnVsBots?.addEventListener('mouseenter', () => titleModeSelectHandler?.('bots'));
btnOnline?.addEventListener('mouseenter', () => titleModeSelectHandler?.('online'));

/** Visually mark which title-mode button is currently selected. */
export function updateTitleModeSelection(mode: TitleMode): void {
  btnVsBots?.classList.toggle('selected', mode === 'bots');
  btnOnline?.classList.toggle('selected', mode === 'online');
}

/** True if the online button is present (feature-gated by main.ts). */
export function isOnlineModeAvailable(): boolean {
  return !!btnOnline && btnOnline.isConnected;
}

/** Cached roster + presets for repaint calls. */
let cachedRoster: RosterEntry[] = [];
let cachedPresets: CritterConfig[] = [];

/**
 * Build the slot avatar: a coloured placeholder circle that gets swapped
 * for a real 3D thumbnail once the GLB thumbnail module has rendered it.
 * If the critter has no GLB (internal placeholders), the placeholder
 * stays as a solid colour.
 */
function buildSlotAvatar(entry: RosterEntry): HTMLDivElement {
  const avatar = document.createElement('div');
  avatar.className = 'slot-avatar';
  // Placeholder colour while the thumbnail is rendering. Also the final
  // appearance if the critter has no GLB (procedural bots don't reach
  // this code path, so this is mostly dead-safe).
  avatar.style.background = '#' + entry.baseColor.toString(16).padStart(6, '0');

  getCritterThumbnail(entry).then((url) => {
    if (!url) return;
    avatar.style.backgroundImage = `url(${url})`;
    avatar.style.backgroundSize = 'contain';
    avatar.style.backgroundRepeat = 'no-repeat';
    avatar.style.backgroundPosition = 'center';
    avatar.style.backgroundColor = 'transparent';
  });

  return avatar;
}

/**
 * Build the character select grid. Roster entries control layout and status;
 * presets provide gameplay stats for the info pane (only playable characters).
 */
export function showCharacterSelect(
  roster: RosterEntry[],
  presets: CritterConfig[],
  selectedIdx: number,
): void {
  setMatchHudVisible(false);
  critterGrid.innerHTML = '';
  cachedRoster = roster;
  cachedPresets = presets;

  for (let i = 0; i < roster.length; i++) {
    const entry = roster[i];
    const slot = document.createElement('div');
    slot.dataset.idx = String(i);
    // Per-critter glow colour — picked up by the slot CSS (glow bg +
    // hover + selected ring). Gives each slot its own visual identity
    // without needing a per-critter style sheet.
    const hex = '#' + entry.baseColor.toString(16).padStart(6, '0');
    slot.style.setProperty('--slot-glow', hex);

    if (entry.status === 'playable') {
      slot.className = 'critter-slot' + (i === selectedIdx ? ' selected' : '');
      slot.appendChild(buildSlotAvatar(entry));

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = entry.displayName;
      slot.appendChild(name);

      const capturedIdx = i;
      slot.addEventListener('click', () => {
        slotClickHandler?.(capturedIdx);
      });
    } else if (entry.status === 'wip') {
      slot.className = 'critter-slot wip' + (i === selectedIdx ? ' selected' : '');
      const avatar = buildSlotAvatar(entry);
      avatar.style.opacity = '0.5';
      slot.appendChild(avatar);

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = entry.displayName;
      slot.appendChild(name);

      const badge = document.createElement('div');
      badge.className = 'slot-badge';
      badge.textContent = 'WIP';
      slot.appendChild(badge);

      const capturedIdx = i;
      slot.addEventListener('click', () => {
        slotClickHandler?.(capturedIdx);
      });
    } else {
      // locked
      slot.className = 'critter-slot locked';

      const lock = document.createElement('div');
      lock.className = 'slot-lock';
      lock.textContent = '🔒';

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = 'Coming Soon';

      slot.appendChild(lock);
      slot.appendChild(name);
    }

    critterGrid.appendChild(slot);
  }

  paintInfoPane(roster, presets, selectedIdx);
  characterSelect.classList.remove('hidden');
}

/** Update the selected slot highlight and refresh the info pane. Cheap call per navigation. */
export function updateCharacterSelect(selectedIdx: number): void {
  const slots = critterGrid.querySelectorAll('.critter-slot');
  slots.forEach((slot, i) => {
    const entry = cachedRoster[i];
    if (entry && entry.status !== 'locked') {
      slot.classList.toggle('selected', i === selectedIdx);
    }
  });
  paintInfoPane(cachedRoster, cachedPresets, selectedIdx);
}

export function hideCharacterSelect(): void {
  characterSelect.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Info pane — name, role, tagline, animated stat bars
// ---------------------------------------------------------------------------

/** Relative normalization: bars fill based on min/max across the current preset pool. */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function paintInfoPane(roster: RosterEntry[], presets: CritterConfig[], idx: number): void {
  const entry = roster[idx];
  if (!entry) return;

  // Name / role / tagline always come from the roster entry
  infoName.textContent = entry.displayName;
  infoRole.textContent = entry.role;
  infoTagline.textContent = entry.status === 'wip'
    ? entry.tagline + ' (coming soon)'
    : entry.tagline;

  infoStats.innerHTML = '';
  infoAbilities.innerHTML = '';

  // Stat bars only if this character has a gameplay config
  const config = presets.find(p => p.name === entry.displayName);
  if (config) {
    const speedMin = Math.min(...presets.map(p => p.speed));
    const speedMax = Math.max(...presets.map(p => p.speed));
    const massMin = Math.min(...presets.map(p => p.mass));
    const massMax = Math.max(...presets.map(p => p.mass));
    const powerMin = Math.min(...presets.map(p => p.headbuttForce));
    const powerMax = Math.max(...presets.map(p => p.headbuttForce));

    const MIN_FILL = 0.18;
    const rel = (v: number, min: number, max: number) =>
      MIN_FILL + normalize(v, min, max) * (1 - MIN_FILL);

    const stats: { label: string; pct: number }[] = [
      { label: 'Speed',  pct: rel(config.speed, speedMin, speedMax) * 100 },
      { label: 'Weight', pct: rel(config.mass, massMin, massMax) * 100 },
      { label: 'Power',  pct: rel(config.headbuttForce, powerMin, powerMax) * 100 },
    ];

    for (const s of stats) {
      const row = document.createElement('div');
      row.className = 'stat-row';

      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = s.label;

      const bg = document.createElement('div');
      bg.className = 'stat-bar-bg';

      const fill = document.createElement('div');
      fill.className = 'stat-bar';
      fill.style.width = '0%';
      bg.appendChild(fill);

      row.appendChild(label);
      row.appendChild(bg);
      infoStats.appendChild(row);

      requestAnimationFrame(() => {
        fill.style.width = s.pct.toFixed(1) + '%';
      });
    }
  }

  // --- Ability list ---
  // Source 1: real abilities from gameplay config (playable characters)
  if (config) {
    const states = createAbilityStates(config.name);
    for (const s of states) {
      appendAbilityRow(s.def.key, s.def.name, s.def.description, false);
    }
  }
  // Source 2: planned abilities from roster (WIP characters)
  else if (entry.plannedAbilities) {
    for (const a of entry.plannedAbilities) {
      appendAbilityRow(a.key, a.name, a.description, true);
    }
  }
}

function appendAbilityRow(key: string, name: string, desc: string, planned: boolean): void {
  const row = document.createElement('div');
  row.className = 'ability-info-row';

  const keyEl = document.createElement('span');
  keyEl.className = 'ability-info-key';
  keyEl.textContent = `[${key}]`;

  const nameEl = document.createElement('span');
  nameEl.className = 'ability-info-name';
  nameEl.textContent = name;

  const descEl = document.createElement('span');
  descEl.className = 'ability-info-desc';
  descEl.textContent = '— ' + desc;

  row.appendChild(keyEl);
  row.appendChild(nameEl);
  row.appendChild(descEl);

  if (planned) {
    const badge = document.createElement('span');
    badge.className = 'ability-info-planned';
    badge.textContent = '(planned)';
    row.appendChild(badge);
  }

  infoAbilities.appendChild(row);
}

export type EndResult = 'win' | 'lose' | 'draw';

export function showEndScreen(result: EndResult, title: string, subtitle: string, showPortalOptions = false): void {
  endResultEl.textContent = title;
  endResultEl.className = 'end-result ' + result;
  endSubtitleEl.textContent = subtitle;
  // Show portal prompt only for players who arrived via portal
  const portalPrompt = document.getElementById('end-portal-prompt');
  if (portalPrompt) portalPrompt.style.display = showPortalOptions ? '' : 'none';
  endScreen.classList.remove('hidden');
  // Keep the match HUD visible behind the end screen so player sees final state
  setMatchHudVisible(true);
}

export function hideEndScreen(): void {
  endScreen.classList.add('hidden');
}

/** Called when match starts, to ensure HUD is visible and menus are hidden. */
export function showMatchHud(): void {
  setMatchHudVisible(true);
  titleScreen.classList.add('hidden');
  characterSelect.classList.add('hidden');
  endScreen.classList.add('hidden');
}
