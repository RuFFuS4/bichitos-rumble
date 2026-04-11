import type { AbilityState } from './abilities';
import type { Critter, CritterConfig } from './critter';

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
const endScreen = document.getElementById('end-screen')!;
const endResultEl = document.getElementById('end-result')!;
const endSubtitleEl = document.getElementById('end-subtitle')!;

/** Total slots on the grid. Must match CSS grid-template-columns × rows. */
export const GRID_SLOTS = 9;

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
  overlayEl.style.display = 'block';
  overlayEl.innerHTML = main + (sub ? `<div class="sub">${sub}</div>` : '');
}

export function hideOverlay(): void {
  overlayEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Ability cooldown HUD
// ---------------------------------------------------------------------------

let slotEls: { root: HTMLElement; fill: HTMLElement }[] = [];

export function initAbilityHUD(states: AbilityState[]): void {
  abilityContainer.innerHTML = '';
  slotEls = [];

  for (const s of states) {
    const slot = document.createElement('div');
    slot.className = 'ability-slot';

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
    abilityContainer.appendChild(slot);

    slotEls.push({ root: slot, fill });
  }
}

export function updateAbilityHUD(states: AbilityState[]): void {
  for (let i = 0; i < states.length && i < slotEls.length; i++) {
    const s = states[i];
    const el = slotEls[i];

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

/**
 * Build the character select grid once on show. Fills `GRID_SLOTS` slots:
 * the first N match the presets (N = presets.length), the rest are shown
 * as locked "Coming Soon" placeholders.
 * Also paints the right-side info panel with the currently selected critter.
 */
export function showCharacterSelect(presets: CritterConfig[], selectedIdx: number): void {
  setMatchHudVisible(false);
  critterGrid.innerHTML = '';

  for (let i = 0; i < GRID_SLOTS; i++) {
    const slot = document.createElement('div');
    slot.dataset.idx = String(i);

    if (i < presets.length) {
      const c = presets[i];
      slot.className = 'critter-slot' + (i === selectedIdx ? ' selected' : '');

      const dot = document.createElement('div');
      dot.className = 'slot-dot';
      dot.style.background = '#' + c.color.toString(16).padStart(6, '0');

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = c.name;

      slot.appendChild(dot);
      slot.appendChild(name);
    } else {
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

  // Paint the info pane for the current selection
  paintInfoPane(presets, selectedIdx);
  characterSelect.classList.remove('hidden');
}

/** Update the selected slot highlight and refresh the info pane. Cheap call per navigation. */
export function updateCharacterSelect(presets: CritterConfig[], selectedIdx: number): void {
  const slots = critterGrid.querySelectorAll('.critter-slot');
  slots.forEach((slot, i) => {
    if (i < presets.length) {
      slot.classList.toggle('selected', i === selectedIdx);
    }
  });
  paintInfoPane(presets, selectedIdx);
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

function paintInfoPane(presets: CritterConfig[], idx: number): void {
  const c = presets[idx];
  if (!c) return;

  infoName.textContent = c.name;
  infoRole.textContent = c.role;
  infoTagline.textContent = c.tagline;

  // Compute min/max across all presets for relative bars
  const speedMin = Math.min(...presets.map(p => p.speed));
  const speedMax = Math.max(...presets.map(p => p.speed));
  const massMin = Math.min(...presets.map(p => p.mass));
  const massMax = Math.max(...presets.map(p => p.mass));
  const powerMin = Math.min(...presets.map(p => p.headbuttForce));
  const powerMax = Math.max(...presets.map(p => p.headbuttForce));

  // Bars never show empty — map the true 0 of the relative scale to a small
  // minimum fill so every critter has a visible stat presence
  const MIN_FILL = 0.18;
  const rel = (v: number, min: number, max: number) =>
    MIN_FILL + normalize(v, min, max) * (1 - MIN_FILL);

  const stats: { label: string; pct: number }[] = [
    { label: 'Speed',  pct: rel(c.speed, speedMin, speedMax) * 100 },
    { label: 'Weight', pct: rel(c.mass, massMin, massMax) * 100 },
    { label: 'Power',  pct: rel(c.headbuttForce, powerMin, powerMax) * 100 },
  ];

  infoStats.innerHTML = '';
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
    // Start at 0 so the CSS transition animates the bar in
    fill.style.width = '0%';
    bg.appendChild(fill);

    row.appendChild(label);
    row.appendChild(bg);
    infoStats.appendChild(row);

    // Trigger the CSS transition on next frame
    requestAnimationFrame(() => {
      fill.style.width = s.pct.toFixed(1) + '%';
    });
  }
}

export type EndResult = 'win' | 'lose' | 'draw';

export function showEndScreen(result: EndResult, title: string, subtitle: string): void {
  endResultEl.textContent = title;
  endResultEl.className = 'end-result ' + result;
  endSubtitleEl.textContent = subtitle;
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
